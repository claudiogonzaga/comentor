package expo.modules.spokennudges

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.PowerManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale

/**
 * Foreground service curto que fala um lembrete com a tela apagada / app fechado.
 * Dois modos:
 *  - se vier `audioPath` (WAV pré-renderizado), toca via MediaPlayer;
 *  - senão, FALA o `body` com a voz do sistema (Android TextToSpeech) — grátis,
 *    offline, sem consumir a API. É o modo usado pelos nudges/lembretes.
 * Segura um wakelock durante a fala e se encerra ao terminar. Usa o stream de
 * ALARME para ser ouvido mesmo com volume de notificação baixo.
 */
class SpokenSpeechService : Service() {
  private var player: MediaPlayer? = null
  private var tts: TextToSpeech? = null
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val audioPath = intent?.getStringExtra("audioPath")
    val title = intent?.getStringExtra("title")?.ifEmpty { "Comentora" } ?: "Comentora"
    val body = intent?.getStringExtra("body") ?: ""

    startInForeground(title, body)
    acquireWake()

    if (!audioPath.isNullOrEmpty()) {
      playWav(audioPath)
    } else if (body.isNotEmpty()) {
      speakWithSystemTts(body)
    } else {
      Log.w(SpokenScheduler.TAG, "service: sem áudio nem texto")
      stopEverything()
    }
    return START_NOT_STICKY
  }

  private fun playWav(audioPath: String) {
    try {
      val path = if (audioPath.startsWith("file://")) Uri.parse(audioPath).path ?: audioPath else audioPath
      val mp = MediaPlayer()
      mp.setAudioAttributes(alarmSpeechAttrs())
      mp.setDataSource(path)
      mp.setOnPreparedListener { it.start() }
      mp.setOnCompletionListener { stopEverything() }
      mp.setOnErrorListener { _, what, extra ->
        Log.e(SpokenScheduler.TAG, "MediaPlayer error what=$what extra=$extra")
        stopEverything()
        true
      }
      mp.prepareAsync()
      player = mp
      Log.d(SpokenScheduler.TAG, "service: tocando WAV $path")
    } catch (e: Exception) {
      Log.e(SpokenScheduler.TAG, "service: WAV falhou ${e.message}; tentando voz do sistema")
      stopEverything()
    }
  }

  private fun speakWithSystemTts(text: String) {
    try {
      val engine = TextToSpeech(applicationContext) { status ->
        val t = tts
        if (status != TextToSpeech.SUCCESS || t == null) {
          Log.e(SpokenScheduler.TAG, "TTS init falhou ($status)")
          stopEverything()
          return@TextToSpeech
        }
        try {
          t.setAudioAttributes(alarmSpeechAttrs())
        } catch (_: Exception) {}
        try {
          // pt-BR se disponível; senão segue na voz padrão do aparelho.
          t.language = Locale("pt", "BR")
        } catch (_: Exception) {}
        t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
          override fun onStart(utteranceId: String?) {}
          override fun onDone(utteranceId: String?) { stopEverything() }
          @Suppress("OVERRIDE_DEPRECATION", "DEPRECATION")
          override fun onError(utteranceId: String?) { stopEverything() }
          override fun onError(utteranceId: String?, errorCode: Int) { stopEverything() }
        })
        val params = Bundle()
        params.putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, "nudge")
        val res = t.speak(text, TextToSpeech.QUEUE_FLUSH, params, "nudge")
        if (res == TextToSpeech.ERROR) {
          Log.e(SpokenScheduler.TAG, "TTS speak retornou ERROR")
          stopEverything()
        } else {
          Log.d(SpokenScheduler.TAG, "service: falando via sistema (TTS)")
        }
      }
      tts = engine
    } catch (e: Exception) {
      Log.e(SpokenScheduler.TAG, "TTS falhou: ${e.message}")
      stopEverything()
    }
  }

  private fun alarmSpeechAttrs(): AudioAttributes =
    AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ALARM)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .build()

  private fun startInForeground(title: String, body: String) {
    val channelId = "comentor-spoken-fgs"
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val ch = NotificationChannel(
        channelId,
        "Comentora falando",
        NotificationManager.IMPORTANCE_LOW,
      )
      ch.description = "Aparece enquanto a Comentora fala um lembrete em voz alta."
      ch.setShowBadge(false)
      nm.createNotificationChannel(ch)
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, channelId)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    val notif = builder
      .setContentTitle(title)
      .setContentText(if (body.isNotEmpty()) body else "Tocando lembrete…")
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .build()

    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
      } else {
        startForeground(NOTIF_ID, notif)
      }
    } catch (e: Exception) {
      Log.e(SpokenScheduler.TAG, "startForeground failed: ${e.message}")
    }
  }

  private fun acquireWake() {
    try {
      val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
      val wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "comentor:spoken")
      wl.setReferenceCounted(false)
      wl.acquire(2 * 60 * 1000L) // teto de 2 min — solto ao terminar
      wakeLock = wl
    } catch (e: Exception) {
      Log.w(SpokenScheduler.TAG, "wakelock failed: ${e.message}")
    }
  }

  private fun stopEverything() {
    try { player?.release() } catch (_: Exception) {}
    player = null
    try {
      tts?.stop()
      tts?.shutdown()
    } catch (_: Exception) {}
    tts = null
    try { if (wakeLock?.isHeld == true) wakeLock?.release() } catch (_: Exception) {}
    wakeLock = null
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        stopForeground(STOP_FOREGROUND_REMOVE)
      } else {
        @Suppress("DEPRECATION")
        stopForeground(true)
      }
    } catch (_: Exception) {}
    stopSelf()
  }

  override fun onDestroy() {
    super.onDestroy()
    stopEverything()
  }

  companion object {
    private const val NOTIF_ID = 1011
  }
}
