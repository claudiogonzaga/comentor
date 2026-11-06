package expo.modules.readaloudaudio

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.security.MessageDigest
import java.util.concurrent.LinkedBlockingQueue

/** Um pedido de áudio completo para uma leitura. */
class ReadAloudJob(
  val id: String,
  val chunks: List<String>,
  val model: String,
  val legacyModel: String,
  val voice: String,
  val legacyVoice: String,
  val interactions: Boolean,
  val apiKey: String,
  val outPath: String,
  val workDir: String,
  val tag: String,
  val title: String,
) {
  @Volatile var canceled = false
  @Volatile var conn: HttpURLConnection? = null
}

/**
 * O estado de cada pedido, guardado no aparelho: se o app fechar no meio, ao abrir
 * de novo o JavaScript descobre o que ficou pronto (e liga o áudio ao texto salvo).
 */
object JobStore {
  private const val PREFS = "noosfera_readaloud_jobs"
  private const val KEEP = 30

  fun put(ctx: Context, id: String, fields: Map<String, Any?>) {
    val sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val cur = sp.getString(id, null)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: JSONObject().put("id", id)
    for ((k, v) in fields) cur.put(k, v ?: JSONObject.NULL)
    cur.put("updatedAt", System.currentTimeMillis())
    sp.edit().putString(id, cur.toString()).apply()
    prune(ctx)
  }

  fun get(ctx: Context, id: String): Map<String, Any?>? =
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(id, null)?.let { toMap(it) }

  fun all(ctx: Context): List<Map<String, Any?>> =
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).all.values.mapNotNull { (it as? String)?.let(::toMap) }

  fun remove(ctx: Context, id: String) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(id).apply()
  }

  private fun prune(ctx: Context) {
    val sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val entries = sp.all.mapNotNull { (k, v) ->
      (v as? String)?.let { k to (runCatching { JSONObject(it).optLong("updatedAt") }.getOrDefault(0L)) }
    }
    if (entries.size <= KEEP) return
    val ed = sp.edit()
    entries.sortedBy { it.second }.take(entries.size - KEEP).forEach { ed.remove(it.first) }
    ed.apply()
  }

  private fun toMap(s: String): Map<String, Any?>? = runCatching {
    val o = JSONObject(s)
    o.keys().asSequence().associateWith { k -> o.get(k).takeIf { it != JSONObject.NULL } }
  }.getOrNull()
}

/**
 * Gera o áudio da leitura num serviço em primeiro plano (tipo dataSync): segue com a
 * tela apagada e o app fora da tela, mostra o andamento na notificação e grava cada
 * trecho em disco assim que fica pronto — um novo pedido do mesmo texto retoma de
 * onde parou, sem pagar de novo pelos trechos prontos. Um pedido por vez, em fila.
 */
class ReadAloudService : Service() {
  companion object {
    private const val CHANNEL = "noosfera_readaloud"
    private const val NOTIF_ID = 47120
    private const val DONE_NOTIF_ID = 47121
    private val queue = LinkedBlockingQueue<ReadAloudJob>()
    @Volatile private var current: ReadAloudJob? = null
    @Volatile private var worker: Thread? = null

    /** Quem ouve o andamento (o módulo, enquanto o JavaScript está vivo). */
    @Volatile var emitter: ((Map<String, Any?>) -> Unit)? = null

    fun enqueue(ctx: Context, job: ReadAloudJob): Boolean {
      if (current?.id == job.id || queue.any { it.id == job.id }) return false // já em andamento
      JobStore.put(
        ctx, job.id,
        mapOf(
          "state" to "queued", "done" to 0, "total" to job.chunks.size, "tag" to job.tag,
          "voice" to job.voice, "title" to job.title, "uri" to null, "error" to null, "dailyQuota" to false,
        ),
      )
      queue.add(job)
      ContextCompat.startForegroundService(ctx, Intent(ctx, ReadAloudService::class.java))
      return true
    }

    fun cancel(ctx: Context, id: String) {
      queue.removeAll { it.id == id }
      current?.takeIf { it.id == id }?.let { j ->
        j.canceled = true
        runCatching { j.conn?.disconnect() }
      }
      JobStore.put(ctx, id, mapOf("state" to "canceled"))
    }

    fun isActive(id: String): Boolean = current?.id == id || queue.any { it.id == id }

    fun sha(s: String): String =
      MessageDigest.getInstance("SHA-1").digest(s.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }.take(16)
  }

  private var wake: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    ensureChannel()
    val n = progressNotification(current?.title ?: queue.peek()?.title ?: "", 0, 0)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIF_ID, n)
    }
    startWorker()
    // Sem a fila em memória não há o que retomar: o JavaScript pede de novo e os
    // trechos já gravados em disco não são gerados outra vez.
    return START_NOT_STICKY
  }

  private fun startWorker() {
    synchronized(Companion) {
      if (worker == null) {
        val t = Thread({ runQueue() }, "noosfera-readaloud")
        worker = t
        t.start()
      }
    }
  }

  private fun runQueue() {
    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "noosfera:readaloud").apply {
      setReferenceCounted(false)
      acquire(3 * 60 * 60 * 1000L)
    }
    try {
      while (true) {
        val job = queue.poll() ?: break
        current = job
        process(job)
        current = null
      }
    } finally {
      runCatching { wake?.release() }
      synchronized(Companion) {
        worker = null
      }
      // Um pedido que chegou enquanto a fila esvaziava ganha um novo trabalhador.
      Handler(Looper.getMainLooper()).post {
        if (queue.isEmpty()) {
          stopForeground(STOP_FOREGROUND_REMOVE)
          stopSelf()
        } else {
          startWorker()
        }
      }
    }
  }

  private fun process(job: ReadAloudJob) {
    val total = job.chunks.size
    val engine = TtsEngine(
      job.apiKey, job.model, job.legacyModel, job.voice, job.legacyVoice, job.interactions,
      canceled = { job.canceled },
      onConnection = { job.conn = it },
    )
    try {
      val dir = File(job.workDir).apply { mkdirs() }
      val files = ArrayList<File>(total)
      for ((i, text) in job.chunks.withIndex()) {
        if (job.canceled) throw TtsCanceled()
        report(job, "running", i, total)
        val f = File(dir, "rachunk_" + sha("${job.model}|${job.voice}:chunk:$text") + ".pcm")
        files += f
        if (f.exists() && f.length() > 0 && f.length() % 2 == 0L) continue
        val pcm = engine.synth(text)
        val tmp = File(f.path + ".tmp")
        tmp.writeBytes(pcm)
        if (tmp.length() != pcm.size.toLong() || !tmp.renameTo(f)) {
          tmp.delete()
          throw TtsFatal("não consegui gravar um trecho (espaço em disco?)")
        }
      }
      report(job, "running", total, total)
      WavFiles.concat(files, File(job.outPath), raw = true)
      files.forEach { runCatching { it.delete() } }
      val uri = "file://" + job.outPath
      JobStore.put(this, job.id, mapOf("state" to "done", "done" to total, "total" to total, "uri" to uri, "error" to null))
      emit(job, "done", total, total, uri, null, false)
      doneNotification(job.title, null)
    } catch (e: TtsCanceled) {
      JobStore.put(this, job.id, mapOf("state" to "canceled"))
      emit(job, "canceled", 0, total, null, null, false)
    } catch (e: TtsFatal) {
      fail(job, e.message ?: "falhou", e.dailyQuota)
    } catch (e: Throwable) {
      if (job.canceled) {
        JobStore.put(this, job.id, mapOf("state" to "canceled"))
        emit(job, "canceled", 0, total, null, null, false)
      } else {
        fail(job, e.message ?: e.javaClass.simpleName, false)
      }
    }
  }

  private fun fail(job: ReadAloudJob, msg: String, daily: Boolean) {
    JobStore.put(this, job.id, mapOf("state" to "error", "error" to msg, "dailyQuota" to daily))
    emit(job, "error", 0, job.chunks.size, null, msg, daily)
    doneNotification(job.title, msg)
  }

  private fun report(job: ReadAloudJob, state: String, done: Int, total: Int) {
    JobStore.put(this, job.id, mapOf("state" to state, "done" to done, "total" to total))
    emit(job, state, done, total, null, null, false)
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    runCatching { nm.notify(NOTIF_ID, progressNotification(job.title, done, total)) }
  }

  private fun emit(job: ReadAloudJob, state: String, done: Int, total: Int, uri: String?, error: String?, daily: Boolean) {
    runCatching {
      emitter?.invoke(
        mapOf(
          "id" to job.id, "state" to state, "done" to done, "total" to total, "uri" to uri,
          "error" to error, "dailyQuota" to daily, "tag" to job.tag, "voice" to job.voice,
        ),
      )
    }
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (nm.getNotificationChannel(CHANNEL) != null) return
    nm.createNotificationChannel(
      NotificationChannel(CHANNEL, "Leia para mim: gerando áudio", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Andamento da geração do áudio das leituras longas"
        setShowBadge(false)
      },
    )
  }

  private fun openApp(): PendingIntent? {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    return PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun progressNotification(title: String, done: Int, total: Int) =
    NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle("Gerando o áudio da leitura")
      .setContentText(
        if (total > 0) "${title.ifBlank { "Leia para mim" }} · parte ${minOf(done + 1, total)} de $total"
        else title.ifBlank { "Leia para mim" },
      )
      .setProgress(total, done, total == 0)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(openApp())
      .build()

  private fun doneNotification(title: String, error: String?) {
    ensureChannel()
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val n = NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle(if (error == null) "Áudio pronto" else "O áudio não foi gerado")
      .setContentText(if (error == null) title.ifBlank { "Leia para mim" } else error)
      .setStyle(NotificationCompat.BigTextStyle().bigText(if (error == null) title else error))
      .setAutoCancel(true)
      .setContentIntent(openApp())
      .build()
    runCatching { nm.notify(DONE_NOTIF_ID, n) }
  }
}
