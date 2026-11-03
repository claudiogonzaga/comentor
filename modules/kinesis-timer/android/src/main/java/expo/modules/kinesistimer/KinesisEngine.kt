package expo.modules.kinesistimer

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/** O que a notificação fixa do timer mostra. chronoTo = 0: sem relógio. */
data class KinesisNotif(
  val title: String,
  val text: String,
  val chronoTo: Long,
  val chronoDown: Boolean,
)

/**
 * Um momento marcado da linha do tempo do timer. A linha do tempo vem pronta do
 * JS (que é quem conhece as regras): aqui ela só é executada, com o app fechado.
 */
data class KinesisEvent(
  val at: Long,
  val sound: String?,
  // Três bipes nos 3 s antes de `at`. O alarme toca antes e o sino sai na hora certa.
  val beeps: Boolean,
  val notif: KinesisNotif?,
  val vibrate: Boolean,
  // Alerta de "não exercitou": volta a tocar a cada repeatMs, repeatLeft vezes mais.
  val repeatMs: Long,
  val repeatLeft: Int,
  // Fim do treino: depois do som, a notificação some.
  val finish: Boolean,
) {
  val fireAt: Long get() = if (beeps) at - BEEP_LEAD_MS else at

  companion object {
    const val BEEP_LEAD_MS = 3000L
  }
}

/**
 * Guarda a linha do tempo em SharedPreferences (o alarme e o boot rodam sem JS) e
 * mantém armado um único alarme exato: o do próximo evento.
 */
object KinesisEngine {
  const val TAG = "Kinesis"
  const val NOTIF_ID = 2041
  private const val ACTION_FIRE = "expo.modules.kinesistimer.FIRE"
  private const val PREFS = "kinesis_timer"
  private const val KEY_EVENTS = "events"
  private const val KEY_CURRENT = "current"
  private const val KEY_VOLUME = "volume"
  private const val CHANNEL_ID = "kinesis-timer"

  private fun prefs(ctx: Context) =
    ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun volume(ctx: Context): Float = prefs(ctx).getFloat(KEY_VOLUME, 0.6f)

  fun setVolume(ctx: Context, value: Float) {
    prefs(ctx).edit().putFloat(KEY_VOLUME, value.coerceIn(0f, 1f)).apply()
  }

  /** Troca a linha do tempo inteira: {current: {...}|null, events: [...]}. */
  @Synchronized
  fun arm(ctx: Context, json: String) {
    val root = JSONObject(json)
    val events = root.optJSONArray("events") ?: JSONArray()
    val current = root.optJSONObject("current")
    prefs(ctx).edit()
      .putString(KEY_EVENTS, events.toString())
      .putString(KEY_CURRENT, current?.toString())
      .apply()
    armNext(ctx)
    if (current != null) postNotification(ctx, parseNotif(current))
    else cancelNotification(ctx)
  }

  /** Parar o timer: sem alarme, sem notificação, sem som em curso. */
  @Synchronized
  fun disarm(ctx: Context) {
    prefs(ctx).edit().remove(KEY_EVENTS).remove(KEY_CURRENT).apply()
    alarmManager(ctx).cancel(pendingIntent(ctx))
    cancelNotification(ctx)
    KinesisPlayer.stopAll()
  }

  /** Depois de reiniciar o aparelho ou atualizar o app: o alarme se perdeu. */
  @Synchronized
  fun rearm(ctx: Context) {
    if (loadEvents(ctx).isEmpty()) return
    armNext(ctx)
    currentNotif(ctx)?.let { postNotification(ctx, it) }
  }

  /**
   * Tira da fila o que já venceu e devolve o evento a executar. Se o aparelho
   * dormiu e vários venceram, vale só o mais recente: tocar três sinos atrasados
   * em sequência não ajuda ninguém. Um alerta repetido volta para a fila.
   */
  @Synchronized
  fun popDue(ctx: Context, now: Long): KinesisEvent? {
    val events = loadEvents(ctx)
    val due = events.filter { it.fireAt <= now + 1000 }
    if (due.isEmpty()) {
      armNext(ctx)
      return null
    }
    val rest = events.filter { it.fireAt > now + 1000 }.toMutableList()
    val last = due.last()
    if (last.repeatMs > 0 && last.repeatLeft > 0) {
      rest.add(last.copy(at = maxOf(last.at, now) + last.repeatMs, repeatLeft = last.repeatLeft - 1, notif = null))
    }
    saveEvents(ctx, rest.sortedBy { it.at })
    armNext(ctx)
    // Os vencidos pulados não tocam, mas o estado deles vale: a notificação não
    // pode ficar em "Exercite-se!" se o que venceu por último foi o alerta.
    return last.copy(
      notif = due.lastOrNull { it.notif != null }?.notif,
      finish = due.any { it.finish },
    )
  }

  /** O evento venceu: passa a ser o estado da notificação. */
  @Synchronized
  fun applyNotif(ctx: Context, ev: KinesisEvent) {
    val n = ev.notif ?: return
    val o = JSONObject()
      .put("title", n.title)
      .put("text", n.text)
      .put("chronoTo", n.chronoTo)
      .put("chronoDown", n.chronoDown)
    prefs(ctx).edit().putString(KEY_CURRENT, o.toString()).apply()
    postNotification(ctx, n)
  }

  /** O treino acabou: só resta tirar a notificação, se nada novo começou nesse meio-tempo. */
  @Synchronized
  fun finishIfIdle(ctx: Context) {
    if (loadEvents(ctx).isNotEmpty()) return
    prefs(ctx).edit().remove(KEY_CURRENT).apply()
    cancelNotification(ctx)
  }

  fun currentNotif(ctx: Context): KinesisNotif? {
    val raw = prefs(ctx).getString(KEY_CURRENT, null) ?: return null
    return try {
      parseNotif(JSONObject(raw))
    } catch (_: Exception) {
      null
    }
  }

  private fun parseNotif(o: JSONObject) = KinesisNotif(
    o.optString("title", "Kinesis"),
    o.optString("text", ""),
    o.optLong("chronoTo", 0L),
    o.optBoolean("chronoDown", true),
  )

  private fun loadEvents(ctx: Context): List<KinesisEvent> {
    val raw = prefs(ctx).getString(KEY_EVENTS, null) ?: return emptyList()
    return try {
      val arr = JSONArray(raw)
      (0 until arr.length()).map { i ->
        val o = arr.getJSONObject(i)
        KinesisEvent(
          o.getLong("at"),
          if (o.isNull("sound")) null else o.optString("sound").ifEmpty { null },
          o.optBoolean("beeps", false),
          o.optJSONObject("notif")?.let { parseNotif(it) },
          o.optBoolean("vibrate", false),
          o.optLong("repeatMs", 0L),
          o.optInt("repeatLeft", 0),
          o.optBoolean("finish", false),
        )
      }
    } catch (e: Exception) {
      Log.w(TAG, "linha do tempo ilegível: ${e.message}")
      emptyList()
    }
  }

  private fun saveEvents(ctx: Context, list: List<KinesisEvent>) {
    val arr = JSONArray()
    for (e in list) {
      val o = JSONObject()
        .put("at", e.at)
        .put("sound", e.sound ?: JSONObject.NULL)
        .put("beeps", e.beeps)
        .put("vibrate", e.vibrate)
        .put("repeatMs", e.repeatMs)
        .put("repeatLeft", e.repeatLeft)
        .put("finish", e.finish)
      e.notif?.let { n ->
        o.put(
          "notif",
          JSONObject()
            .put("title", n.title)
            .put("text", n.text)
            .put("chronoTo", n.chronoTo)
            .put("chronoDown", n.chronoDown),
        )
      }
      arr.put(o)
    }
    prefs(ctx).edit().putString(KEY_EVENTS, arr.toString()).apply()
  }

  private fun alarmManager(ctx: Context) =
    ctx.applicationContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager

  private fun pendingIntent(ctx: Context): PendingIntent {
    val intent = Intent(ctx.applicationContext, KinesisAlarmReceiver::class.java).setAction(ACTION_FIRE)
    return PendingIntent.getBroadcast(
      ctx.applicationContext,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun armNext(ctx: Context) {
    val am = alarmManager(ctx)
    val pi = pendingIntent(ctx)
    val next = loadEvents(ctx).minByOrNull { it.fireAt }
    if (next == null) {
      am.cancel(pi)
      return
    }
    // Um evento pouco à frente (ou já vencido) não pode ser armado no passado.
    val at = maxOf(next.fireAt, System.currentTimeMillis() + 200)
    try {
      am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    } catch (e: SecurityException) {
      Log.w(TAG, "alarme exato negado, usando inexato: ${e.message}")
      am.set(AlarmManager.RTC_WAKEUP, at, pi)
    }
  }

  fun buildNotification(ctx: Context, n: KinesisNotif?): Notification {
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel = NotificationChannel(CHANNEL_ID, "Kinesis — timer", NotificationManager.IMPORTANCE_LOW)
    channel.description = "O timer de pausas ativas enquanto ele roda. Os sinos saem do próprio timer."
    channel.setShowBadge(false)
    channel.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    nm.createNotificationChannel(channel)

    // Tocar na notificação abre direto a aba do Kinesis.
    val open = PendingIntent.getActivity(
      ctx,
      0,
      Intent(Intent.ACTION_VIEW, Uri.parse("askesis://kinesis")).setPackage(ctx.packageName),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val b = Notification.Builder(ctx, CHANNEL_ID)
      .setContentTitle(n?.title ?: "Kinesis")
      .setContentText(n?.text ?: "")
      .setSmallIcon(ctx.applicationInfo.icon)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setCategory(Notification.CATEGORY_STOPWATCH)
      .setContentIntent(open)
    if (n != null && n.chronoTo > 0L) {
      b.setShowWhen(true)
      b.setWhen(n.chronoTo)
      b.setUsesChronometer(true)
      b.setChronometerCountDown(n.chronoDown)
    } else {
      b.setShowWhen(false)
    }
    return b.build()
  }

  private fun postNotification(ctx: Context, n: KinesisNotif) {
    try {
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      nm.notify(NOTIF_ID, buildNotification(ctx, n))
    } catch (e: Exception) {
      Log.w(TAG, "notificação falhou: ${e.message}")
    }
  }

  private fun cancelNotification(ctx: Context) {
    try {
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      nm.cancel(NOTIF_ID)
    } catch (_: Exception) {}
  }
}
