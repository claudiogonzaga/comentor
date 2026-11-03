package expo.modules.kinesistimer

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * Toca os sinos do timer. Com fone, o som sai só no fone (USAGE_MEDIA); sem fone,
 * USAGE_ALARM, para ser ouvido mesmo com a mídia no zero. Quem está tocando apenas
 * abaixa enquanto o sino soa: o timer não interrompe música nem audiolivro.
 * Em chamada ou reunião fica mudo: lá só a vibração avisa.
 */
object KinesisPlayer {
  private val handler = Handler(Looper.getMainLooper())
  private val playing = LinkedHashSet<MediaPlayer>()
  private var focus: AudioFocusRequest? = null

  // Nenhum som passa disto; se o player não avisar o fim, o serviço não fica preso.
  private const val MAX_SOUND_MS = 6000L

  private fun resId(sound: String): Int? = when (sound) {
    "schoolBell" -> R.raw.kin_schoolbell
    "zenBell" -> R.raw.kin_zenbell
    "chime" -> R.raw.kin_chime
    "gong" -> R.raw.kin_gong
    "dingdong" -> R.raw.kin_dingdong
    "whistle" -> R.raw.kin_whistle
    "alarm" -> R.raw.kin_alarm
    "siren" -> R.raw.kin_siren
    "buzzer" -> R.raw.kin_buzzer
    "gentle" -> R.raw.kin_gentle
    "prepare" -> R.raw.kin_prepare
    "exerciseEnd" -> R.raw.kin_exercise_end
    "finished" -> R.raw.kin_finished
    "beeps" -> R.raw.kin_beeps
    else -> null
  }

  private fun headphones(am: AudioManager): AudioDeviceInfo? =
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

  fun play(ctx: Context, sound: String, onDone: () -> Unit = {}) {
    val app = ctx.applicationContext
    val res = resId(sound)
    val vol = KinesisEngine.volume(app)
    val am = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val onCall =
      am.mode == AudioManager.MODE_IN_CALL ||
        am.mode == AudioManager.MODE_IN_COMMUNICATION ||
        am.mode == AudioManager.MODE_RINGTONE
    if (res == null || vol <= 0f || onCall) {
      onDone()
      return
    }
    try {
      val device = headphones(am)
      val attrs = AudioAttributes.Builder()
        .setUsage(if (device != null) AudioAttributes.USAGE_MEDIA else AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
      val mp = MediaPlayer.create(app, res, attrs, am.generateAudioSessionId())
      if (mp == null) {
        onDone()
        return
      }
      if (device != null) {
        try { mp.setPreferredDevice(device) } catch (_: Exception) {}
      }
      mp.setVolume(vol, vol)
      synchronized(this) {
        playing.add(mp)
        if (focus == null) {
          val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(attrs)
            .build()
          am.requestAudioFocus(req)
          focus = req
        }
      }
      var finished = false
      val done = Runnable {
        if (finished) return@Runnable
        finished = true
        release(am, mp)
        onDone()
      }
      mp.setOnCompletionListener { handler.post(done) }
      mp.setOnErrorListener { _, what, extra ->
        Log.w(KinesisEngine.TAG, "som $sound falhou ($what/$extra)")
        handler.post(done)
        true
      }
      handler.postDelayed(done, MAX_SOUND_MS)
      mp.start()
    } catch (e: Exception) {
      Log.w(KinesisEngine.TAG, "som $sound falhou: ${e.message}")
      onDone()
    }
  }

  private fun release(am: AudioManager, mp: MediaPlayer) {
    try { mp.release() } catch (_: Exception) {}
    synchronized(this) {
      playing.remove(mp)
      if (playing.isEmpty()) {
        focus?.let { am.abandonAudioFocusRequest(it) }
        focus = null
      }
    }
  }

  /** Parar o timer cala o sino em curso. */
  fun stopAll() {
    synchronized(this) {
      for (mp in playing) {
        try { mp.stop() } catch (_: Exception) {}
      }
    }
  }
}
