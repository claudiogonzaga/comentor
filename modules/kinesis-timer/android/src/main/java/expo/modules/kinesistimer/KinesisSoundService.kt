package expo.modules.kinesistimer

import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log

/** O alarme exato venceu: sobe o serviço que toca o sino, com a tela apagada. */
class KinesisAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val app = context.applicationContext
    try {
      app.startForegroundService(Intent(app, KinesisSoundService::class.java))
    } catch (e: Exception) {
      // Sem permissão de alarme exato o Android pode recusar o serviço. A linha do
      // tempo não pode parar por isso: ao menos a notificação acompanha.
      Log.w(KinesisEngine.TAG, "serviço recusado: ${e.message}")
      KinesisEngine.popDue(app, System.currentTimeMillis())?.let { ev ->
        KinesisEngine.applyNotif(app, ev)
        if (ev.finish) KinesisEngine.finishIfIdle(app)
      }
    }
  }
}

/** Reinício do aparelho ou atualização do app com o timer rodando. */
class KinesisBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    KinesisEngine.rearm(context.applicationContext)
  }
}

/**
 * Foreground service curto: executa um evento da linha do tempo (bipes, sino,
 * vibração, notificação) e se encerra. A notificação fica: é a fixa do timer.
 */
class KinesisSoundService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private var wakeLock: PowerManager.WakeLock? = null
  private var active = 0
  private var finishing = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    goForeground()
    acquireWake()
    val now = System.currentTimeMillis()
    val ev = KinesisEngine.popDue(this, now)
    active++
    if (ev == null) {
      oneDone()
      return START_NOT_STICKY
    }
    val untilBoundary = ev.at - now
    if (ev.beeps && untilBoundary > 1500) {
      KinesisPlayer.play(this, "beeps")
      handler.postDelayed({ boundary(ev) }, untilBoundary)
    } else {
      boundary(ev)
    }
    return START_NOT_STICKY
  }

  private fun boundary(ev: KinesisEvent) {
    KinesisEngine.applyNotif(this, ev)
    if (ev.vibrate) vibrate()
    val sound = ev.sound
    if (sound == null) {
      eventDone(ev)
    } else {
      KinesisPlayer.play(this, sound) { eventDone(ev) }
    }
  }

  private fun eventDone(ev: KinesisEvent) {
    if (ev.finish) {
      finishing = true
      KinesisEngine.finishIfIdle(this)
    }
    oneDone()
  }

  private fun oneDone() {
    active--
    if (active > 0) return
    try { if (wakeLock?.isHeld == true) wakeLock?.release() } catch (_: Exception) {}
    wakeLock = null
    // Fim do treino, ou o timer parado durante o som (o disarm não consegue tirar a
    // notificação de um serviço em primeiro plano): a notificação sai junto.
    val gone = finishing || KinesisEngine.currentNotif(this) == null
    try {
      stopForeground(if (gone) STOP_FOREGROUND_REMOVE else STOP_FOREGROUND_DETACH)
    } catch (_: Exception) {}
    stopSelf()
  }

  private fun goForeground() {
    val notif = KinesisEngine.buildNotification(this, KinesisEngine.currentNotif(this))
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(KinesisEngine.NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
      } else {
        startForeground(KinesisEngine.NOTIF_ID, notif)
      }
    } catch (e: Exception) {
      Log.w(KinesisEngine.TAG, "startForeground falhou: ${e.message}")
    }
  }

  private fun acquireWake() {
    try {
      if (wakeLock?.isHeld == true) return
      val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
      val wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "kinesis:sino")
      wl.setReferenceCounted(false)
      wl.acquire(40_000L) // bipes + sino; o shijōshō do Zazen soa uns 22 s
      wakeLock = wl
    } catch (e: Exception) {
      Log.w(KinesisEngine.TAG, "wakelock falhou: ${e.message}")
    }
  }

  @Suppress("DEPRECATION")
  private fun vibrate() {
    try {
      val v = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
      v.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 300, 180, 300), -1))
    } catch (_: Exception) {}
  }
}
