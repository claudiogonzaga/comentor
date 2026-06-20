package expo.modules.spokennudges

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.PowerManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Calendar
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
  // Roteia a fala pro fone (USAGE_MEDIA) quando há fone que carrega MÍDIA; senão
  // alto-falante (USAGE_ALARM). @Volatile: lido no callback de init do TTS (outra thread).
  @Volatile private var routeToHeadphones = false
  // O dispositivo de fone detectado (para cravar a saída via setPreferredDevice).
  private var preferredDevice: AudioDeviceInfo? = null
  // Se subimos o volume de MÍDIA (estava 0) para o aviso ser ouvido no fone,
  // guardamos o valor original para restaurar ao terminar.
  private var savedMusicVolume = -1

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val audioPath = intent?.getStringExtra("audioPath")
    val title = intent?.getStringExtra("title")?.ifEmpty { "Comentora" } ?: "Comentora"
    val body = intent?.getStringExtra("body") ?: ""

    startInForeground(title, body)

    // Roteamento de áudio: detecta um fone que carregue MÍDIA (fio/BT-A2DP/USB/BLE
    // — SCO de telefonia NÃO conta, pois mídia não sai por ele e cairia no alto-
    // falante). Com fone → som sai pelo fone (USAGE_MEDIA + setPreferredDevice);
    // sem fone → USAGE_ALARM (alto-falante, alto). E se o usuário marcou "só com
    // fone" e não há fone de mídia → não fala (a notificação paralela já aparece).
    val device = mediaHeadphoneDevice(this)
    routeToHeadphones = device != null
    preferredDevice = device
    if (SpokenStore.getHeadphonesOnly(this) && device == null) {
      Log.d(SpokenScheduler.TAG, "service: 'só com fone' ligado e sem fone — não fala")
      stopEverything()
      return START_NOT_STICKY
    }
    // Horário silencioso: dentro da janela/dia escolhidos, não fala (só a
    // notificação paralela aparece) — evita voz no trabalho/academia. EXCETO
    // com fone conectado: aí a fala sai pelo fone, sem constranger ninguém.
    if (device == null && isQuietNow(this)) {
      Log.d(SpokenScheduler.TAG, "service: horário silencioso (sem fone) — não fala")
      stopEverything()
      return START_NOT_STICKY
    }

    // Com fone, o áudio sai como MÍDIA (STREAM_MUSIC). Se a mídia estiver no zero,
    // o aviso ficaria mudo — subimos temporariamente e restauramos ao terminar.
    if (routeToHeadphones) ensureMediaAudible()

    acquireWake()

    // Toca o PIADO DA CORUJA ~1,5s ANTES da voz: a notificação paralela já emite
    // o canto da coruja no instante do disparo; atrasando a fala, o piado passa
    // a anteceder o aviso (chama a atenção antes de a Comentora falar).
    android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
      if (!audioPath.isNullOrEmpty()) {
        playWav(audioPath)
      } else if (body.isNotEmpty()) {
        speakWithSystemTts(body)
      } else {
        Log.w(SpokenScheduler.TAG, "service: sem áudio nem texto")
        stopEverything()
      }
    }, 1500)
    return START_NOT_STICKY
  }

  private fun playWav(audioPath: String) {
    try {
      val path = if (audioPath.startsWith("file://")) Uri.parse(audioPath).path ?: audioPath else audioPath
      val mp = MediaPlayer()
      mp.setAudioAttributes(speechAttrs())
      // Crava a saída no fone detectado (reforça o roteamento do USAGE_MEDIA).
      if (routeToHeadphones && preferredDevice != null &&
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
      ) {
        try {
          mp.setPreferredDevice(preferredDevice)
        } catch (_: Exception) {}
      }
      mp.setDataSource(path)
      val vol = SpokenStore.getNudgeVolume(this)
      mp.setOnPreparedListener {
        try { it.setVolume(vol, vol) } catch (_: Exception) {}
        it.start()
      }
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
          t.setAudioAttributes(speechAttrs())
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

  /**
   * Atributos de áudio da fala. Com FONE conectado, roteia como MÍDIA (sai pelo
   * fone — BT/fio/USB); sem fone, USAGE_ALARM (alto-falante, alto, fura volume de
   * notificação baixo). O USAGE_ALARM é justamente o que força o alto-falante
   * mesmo com fone — por isso trocamos para MEDIA quando há fone.
   */
  private fun speechAttrs(): AudioAttributes {
    val usage =
      if (routeToHeadphones) AudioAttributes.USAGE_MEDIA else AudioAttributes.USAGE_ALARM
    return AudioAttributes.Builder()
      .setUsage(usage)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .build()
  }

  /**
   * Garante audibilidade ao rotear pro fone: se o volume de MÍDIA (STREAM_MUSIC)
   * estiver no zero, sobe para ~60% do máximo e guarda o original p/ restaurar.
   * No-op se já houver volume. Best-effort (DND pode bloquear).
   */
  private fun ensureMediaAudible() {
    try {
      val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
      if (am.getStreamVolume(AudioManager.STREAM_MUSIC) <= 0) {
        val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        savedMusicVolume = 0
        am.setStreamVolume(
          AudioManager.STREAM_MUSIC,
          (max * 0.6f).toInt().coerceAtLeast(1),
          0,
        )
      }
    } catch (e: Exception) {
      Log.w(SpokenScheduler.TAG, "ensureMediaAudible falhou: ${e.message}")
      savedMusicVolume = -1
    }
  }

  private fun restoreMediaVolume() {
    if (savedMusicVolume < 0) return
    try {
      val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
      am.setStreamVolume(AudioManager.STREAM_MUSIC, savedMusicVolume, 0)
    } catch (_: Exception) {}
    savedMusicVolume = -1
  }

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
    restoreMediaVolume()
    preferredDevice = null
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

/**
 * Retorna um dispositivo de saída de FONE que carrega MÍDIA (com fio, Bluetooth
 * A2DP, USB ou BLE), ou null. O SCO (telefonia/mono) é EXCLUÍDO de propósito:
 * mídia não sai por SCO e cairia no alto-falante — o oposto do que queremos.
 * Usado para (a) rotear a fala pro fone e (b) o gate "só com fone". Top-level
 * para o serviço E o módulo reusarem.
 */
fun mediaHeadphoneDevice(ctx: Context): AudioDeviceInfo? {
  return try {
    val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).firstOrNull { d ->
      when (d.type) {
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
        AudioDeviceInfo.TYPE_WIRED_HEADSET,
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
        AudioDeviceInfo.TYPE_USB_HEADSET -> true
        else ->
          Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            d.type == AudioDeviceInfo.TYPE_BLE_HEADSET
      }
    }
  } catch (e: Exception) {
    null
  }
}

/** Há um fone que carrega MÍDIA conectado? (gate "só com fone" + estado p/ a UI). */
fun headphonesConnected(ctx: Context): Boolean = mediaHeadphoneDevice(ctx) != null

/**
 * Estamos AGORA dentro do "horário silencioso" (janela + dia escolhidos)? Se sim,
 * os avisos não falam. `quietDays` é bitmask (bit d = dia d, 0=domingo).
 */
fun isQuietNow(ctx: Context): Boolean {
  if (!SpokenStore.getQuietEnabled(ctx)) return false
  return try {
    val cal = Calendar.getInstance()
    val dow = cal.get(Calendar.DAY_OF_WEEK) - 1 // Calendar: domingo=1 → 0
    if ((SpokenStore.getQuietDays(ctx) shr dow) and 1 == 0) return false
    val nowMin = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
    val start = SpokenStore.getQuietStart(ctx)
    val end = SpokenStore.getQuietEnd(ctx)
    if (start <= end) nowMin >= start && nowMin < end
    else nowMin >= start || nowMin < end // janela que cruza a meia-noite
  } catch (e: Exception) {
    false
  }
}
