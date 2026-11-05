package expo.modules.spokennudges

import android.app.Notification
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import kotlin.random.Random

/**
 * A INSISTÊNCIA dos hábitos rigorosos: serviço em primeiro plano que vibra em
 * pulsos — três batidas (~1,2 s), pausa de 20 a 30 s, de novo — até a pessoa
 * responder na notificação. Segue com a tela apagada e o app fechado (wakelock
 * parcial; o primeiro plano mantém o processo vivo e fora do congelamento).
 *
 * A cada rodada a notificação troca a frase. A pausa varia de propósito: a
 * regularidade é o que treina o reflexo de ignorar (mesma ideia do jitter das
 * cobranças em nudges.ts).
 *
 * Salvaguardas, conferidas a cada rodada:
 *  - teto de 45 min contínuos por hábito → para e deixa a notificação parada;
 *  - janela de sono (horário de dormir até 6h) → para e deixa a notificação;
 *  - Não Perturbe do sistema ligado, chamada/reunião ou telefone tocando → não
 *    vibra nesta rodada (a notificação fica; volta a vibrar quando liberar).
 *
 * O estado (quais hábitos estão insistindo, desde quando) mora no StrictStore;
 * o serviço só o reflete. Assim um "Fiz" tocado com o serviço em qualquer estado
 * — ou o hábito marcado no app — basta encerrar a sessão lá e cutucar o serviço.
 */
class StrictNudgeService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private var wakeLock: PowerManager.WakeLock? = null
  private var tick: Runnable? = null
  /** Hábito cuja notificação é a do primeiro plano. */
  private var fgKey: String? = null
  /** Rodada de cada insistência: escolhe a frase. Ausente = ainda não vibrou. */
  private val rounds = HashMap<String, Int>()

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // startForegroundService exige startForeground em poucos segundos: primeiro isso.
    if (!goForeground()) {
      // Android recusou o primeiro plano (início em segundo plano não permitido,
      // ou reinício do sistema): sem serviço não há vibração confiável. As
      // notificações ficam, paradas, com as respostas.
      StrictScheduler.parkAll(this, StrictNotifier.PARK_FAILED)
      finish()
      return START_NOT_STICKY
    }
    refresh()
    // Morto pelo sistema no meio: volta e retoma do StrictStore (com o teto contado
    // desde o início de cada insistência, não do reinício).
    return START_STICKY
  }

  override fun onDestroy() {
    instance = null
    tick?.let { handler.removeCallbacks(it) }
    tick = null
    cancelVibration()
    releaseWake()
    super.onDestroy()
  }

  /** Sobe em primeiro plano com a notificação do hábito mais antigo (ou a provisória). */
  private fun goForeground(): Boolean {
    val primary = StrictStore.sessions(this).minByOrNull { it.startedAt }
    val h = primary?.let { StrictStore.habit(this, it.key) }
    val id: Int
    val notif: Notification
    if (primary != null && h != null) {
      id = StrictNotifier.idOf(primary.key)
      notif = StrictNotifier.active(this, h, primary, rounds[primary.key] ?: 0)
    } else {
      id = StrictNotifier.PLACEHOLDER_ID
      notif = StrictNotifier.placeholder(this)
    }
    return try {
      startForegroundTyped(id, notif)
      fgKey = if (h != null) primary?.key else null
      true
    } catch (e: Exception) {
      Log.w(StrictScheduler.TAG, "startForeground recusado: ${e.message}")
      false
    }
  }

  private fun startForegroundTyped(id: Int, notif: Notification) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(id, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(id, notif)
    }
  }

  /** O estado mudou (nova insistência, resposta, sincronização): reflete e segue. */
  fun refresh() {
    if (!reconcile(post = true)) {
      finish()
      return
    }
    acquireWake()
    // Insistência nova: a primeira rodada é já, não daqui a 30 s.
    val fresh = StrictStore.sessions(this).any { it.key !in rounds }
    if (fresh || tick == null) {
      tick?.let { handler.removeCallbacks(it) }
      scheduleTick(if (fresh) 300L else 1_000L)
    }
  }

  /**
   * Aplica o que está no StrictStore: encerra o que passou do teto ou entrou no
   * sono (deixando a notificação parada), troca a notificação do primeiro plano
   * se o hábito dela acabou e, com `post`, republica as das insistências vivas
   * (inclusive a que a pessoa arrastou para o lado). false = não sobrou nenhuma.
   */
  private fun reconcile(post: Boolean): Boolean {
    val now = System.currentTimeMillis()
    val sleeping = StrictStore.inSleepWindow(this, now)
    // Hábito → (motivo, dia do lembrete) das insistências que param aqui.
    val parked = LinkedHashMap<String, Pair<String, String>>()
    synchronized(StrictStore) {
      for (s in StrictStore.sessions(this)) {
        val why = when {
          StrictStore.habit(this, s.key) == null -> ""
          now - s.startedAt >= StrictScheduler.CAP_MS -> StrictNotifier.PARK_CAP
          sleeping -> StrictNotifier.PARK_SLEEP
          else -> null
        } ?: continue
        StrictStore.endSession(this, s.key)
        if (why.isNotEmpty()) parked[s.key] = why to s.day
      }
    }
    val sessions = StrictStore.sessions(this).sortedBy { it.startedAt }
    rounds.keys.retainAll(sessions.map { it.key }.toSet())
    val nm = getSystemService(NotificationManager::class.java)
    val oldFg = fgKey

    if (sessions.isEmpty()) {
      stopForegroundRemove()
      fgKey = null
      if (oldFg != null && oldFg !in parked) nm?.cancel(StrictNotifier.idOf(oldFg))
      for ((k, p) in parked) StrictNotifier.postParked(this, k, p.first, p.second)
      return false
    }

    val primary = sessions.first()
    if (oldFg != primary.key) {
      val h = StrictStore.habit(this, primary.key)
      if (h != null) {
        try {
          startForegroundTyped(
            StrictNotifier.idOf(primary.key),
            StrictNotifier.active(this, h, primary, rounds[primary.key] ?: 0),
          )
          fgKey = primary.key
        } catch (e: Exception) {
          Log.w(StrictScheduler.TAG, "troca do primeiro plano falhou: ${e.message}")
        }
      }
      if (oldFg != null && sessions.none { it.key == oldFg } && oldFg !in parked) {
        nm?.cancel(StrictNotifier.idOf(oldFg))
      }
    }
    if (post) {
      for (s in sessions) {
        val h = StrictStore.habit(this, s.key) ?: continue
        try {
          nm?.notify(StrictNotifier.idOf(s.key), StrictNotifier.active(this, h, s, rounds[s.key] ?: 0))
        } catch (_: Exception) {}
      }
    }
    // Depois da troca do primeiro plano: a parada de quem acabou não pode sumir junto.
    for ((k, p) in parked) StrictNotifier.postParked(this, k, p.first, p.second)
    return true
  }

  private fun scheduleTick(delayMs: Long) {
    val r = Runnable {
      tick = null
      onRound()
    }
    tick = r
    handler.postDelayed(r, delayMs)
  }

  /** Uma rodada: frase nova em cada notificação, a duplicata sai, e vibra (se puder). */
  private fun onRound() {
    if (!reconcile(post = false)) {
      finish()
      return
    }
    val nm = getSystemService(NotificationManager::class.java)
    val titles = HashSet<String>()
    for (s in StrictStore.sessions(this)) {
      val h = StrictStore.habit(this, s.key) ?: continue
      val r = rounds[s.key]?.plus(1) ?: 0
      rounds[s.key] = r
      if (h.title.isNotBlank()) titles.add(h.title)
      try {
        nm?.notify(StrictNotifier.idOf(s.key), StrictNotifier.active(this, h, s, r))
      } catch (_: Exception) {}
    }
    dropDuplicates(titles)
    if (mayVibrate()) vibrateOnce()
    scheduleTick(Random.nextLong(20_000L, 30_001L))
  }

  /**
   * A notificação comum do mesmo hábito (âncora, cobrança, fim do adiamento —
   * postadas pelo expo-notifications) sai da bandeja enquanto a rigorosa está lá:
   * um hábito, uma notificação, três respostas. Reconhecida pelo título, que é o
   * mesmo (o JS manda o título exato).
   */
  private fun dropDuplicates(titles: Set<String>) {
    if (titles.isEmpty()) return
    try {
      val nm = getSystemService(NotificationManager::class.java) ?: return
      for (sbn in nm.activeNotifications) {
        val n = sbn.notification ?: continue
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && n.channelId == StrictNotifier.CHANNEL_ID) continue
        if (n.flags and Notification.FLAG_FOREGROUND_SERVICE != 0) continue
        val title = n.extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: continue
        if (title in titles) nm.cancel(sbn.tag, sbn.id)
      }
    } catch (e: Exception) {
      Log.w(StrictScheduler.TAG, "limpar duplicata falhou: ${e.message}")
    }
  }

  /**
   * Pode vibrar AGORA? Não com o Não Perturbe do sistema ligado (qualquer modo
   * além de "tudo"), nem em chamada/reunião ou com o telefone tocando.
   */
  private fun mayVibrate(): Boolean {
    return try {
      val nm = getSystemService(NotificationManager::class.java)
      val filter = nm?.currentInterruptionFilter ?: NotificationManager.INTERRUPTION_FILTER_UNKNOWN
      if (filter != NotificationManager.INTERRUPTION_FILTER_ALL &&
        filter != NotificationManager.INTERRUPTION_FILTER_UNKNOWN
      ) {
        return false
      }
      val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
      am.mode != AudioManager.MODE_IN_CALL &&
        am.mode != AudioManager.MODE_IN_COMMUNICATION &&
        am.mode != AudioManager.MODE_RINGTONE
    } catch (_: Exception) {
      true
    }
  }

  private fun vibrator(): Vibrator? {
    return try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        getSystemService(VibratorManager::class.java)?.defaultVibrator
      } else {
        @Suppress("DEPRECATION")
        getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
      }
    } catch (_: Exception) {
      null
    }
  }

  /**
   * Três batidas (~1,2 s). Uso de ALARME: atravessa a vibração de notificação
   * desligada e não é ignorada com o app em segundo plano — o Não Perturbe já foi
   * conferido acima.
   */
  private fun vibrateOnce() {
    val v = vibrator() ?: return
    if (!v.hasVibrator()) return
    val effect = VibrationEffect.createWaveform(longArrayOf(0, 320, 140, 320, 140, 320), -1)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        v.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM))
      } else {
        @Suppress("DEPRECATION")
        v.vibrate(
          effect,
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build(),
        )
      }
    } catch (e: Exception) {
      Log.w(StrictScheduler.TAG, "vibração falhou: ${e.message}")
    }
  }

  private fun cancelVibration() {
    try {
      vibrator()?.cancel()
    } catch (_: Exception) {}
  }

  private fun acquireWake() {
    try {
      val wl = wakeLock ?: (getSystemService(Context.POWER_SERVICE) as PowerManager)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "comentor:rigoroso")
        .also {
          it.setReferenceCounted(false)
          wakeLock = it
        }
      // Teto: o da insistência + folga. Renovado a cada insistência nova.
      wl.acquire(StrictScheduler.CAP_MS + 2 * 60_000L)
    } catch (e: Exception) {
      Log.w(StrictScheduler.TAG, "wakelock falhou: ${e.message}")
    }
  }

  private fun releaseWake() {
    try {
      if (wakeLock?.isHeld == true) wakeLock?.release()
    } catch (_: Exception) {}
    wakeLock = null
  }

  private fun stopForegroundRemove() {
    try {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } catch (_: Exception) {}
  }

  private fun finish() {
    tick?.let { handler.removeCallbacks(it) }
    tick = null
    cancelVibration()
    releaseWake()
    stopForegroundRemove()
    fgKey = null
    stopSelf()
  }

  companion object {
    @Volatile private var instance: StrictNudgeService? = null

    /** Sobe o serviço (o alarme acabou de abrir uma insistência). */
    fun start(ctx: Context) {
      val app = ctx.applicationContext
      val intent = Intent(app, StrictNudgeService::class.java)
      try {
        app.startForegroundService(intent)
      } catch (e: Exception) {
        // Android 12+ pode recusar o início em segundo plano (sem alarme exato, por
        // exemplo). Sem serviço, a notificação fica parada, com as respostas.
        Log.w(StrictScheduler.TAG, "serviço recusado: ${e.message}")
        StrictScheduler.parkAll(app, StrictNotifier.PARK_FAILED)
      }
    }

    /** Cutuca o serviço, se estiver rodando, para refletir o estado novo. */
    fun poke(ctx: Context) {
      Handler(Looper.getMainLooper()).post { instance?.refresh() }
    }
  }
}
