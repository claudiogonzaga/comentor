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
import android.media.AudioFocusRequest
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
  // Foco de áudio transitório: pausa quem estiver tocando enquanto a coruja fala
  // e devolve o foco no fim, para o player retomar sozinho. null = não pedimos
  // (caso de chamada/reunião em andamento).
  private var focusRequest: AudioFocusRequest? = null

  /** Uma fala pendente. */
  private data class Utterance(val audioPath: String?, val title: String, val body: String)

  // FILA DE FALAS. O serviço é único: quando dois alarmes caem quase juntos (ex.:
  // um lembrete e uma inspiração), o segundo Intent chegava no onStartCommand
  // enquanto o primeiro ainda falava e abria um SEGUNDO player/TTS por cima —
  // as duas vozes saíam emboladas. Agora a segunda espera a primeira terminar.
  private val pending = ArrayDeque<Utterance>()
  @Volatile private var speaking = false
  /** Teto da fila: acima disso, descarta (a notificação já foi mostrada). */
  private val maxQueued = 4

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val audioPath = intent?.getStringExtra("audioPath")
    val title = intent?.getStringExtra("title")?.ifEmpty { "Comentora" } ?: "Comentora"
    val body = intent?.getStringExtra("body") ?: ""
    val u = Utterance(audioPath, title, body)

    // Já falando? Entra na fila em vez de sobrepor.
    if (speaking) {
      if (pending.size < maxQueued) {
        pending.addLast(u)
        Log.i(SpokenScheduler.TAG, "ja falando — enfileirada (${pending.size} na fila)")
      } else {
        Log.w(SpokenScheduler.TAG, "fila cheia — fala descartada (a notificacao ja apareceu)")
      }
      return START_NOT_STICKY
    }
    speaking = true
    startUtterance(u)
    return START_NOT_STICKY
  }

  /** Executa uma fala. Os portões são reavaliados a cada uma: a situação pode
   *  ter mudado entre a primeira e a segunda (entrou numa chamada, tirou o fone). */
  private fun startUtterance(u: Utterance) {
    val audioPath = u.audioPath
    val title = u.title
    val body = u.body

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
      stopEverything() // condição global: descarta a fila inteira
      return
    }
    // Horário silencioso: dentro da janela/dia escolhidos, não fala (só a
    // notificação paralela aparece) — evita voz no trabalho/academia. EXCETO
    // com fone conectado: aí a fala sai pelo fone, sem constranger ninguém.
    if (device == null && isQuietNow(this)) {
      Log.d(SpokenScheduler.TAG, "service: horário silencioso (sem fone) — não fala")
      stopEverything() // condição global: descarta a fila inteira
      return
    }

    // Com fone, o áudio sai como MÍDIA (STREAM_MUSIC). Se a mídia estiver no zero,
    // o aviso ficaria mudo — subimos temporariamente e restauramos ao terminar.
    // Em chamada/reunião a coruja fica CALADA: não interrompe e não fala por
    // cima. O lembrete já chegou como notificação — quando a pessoa sair da
    // chamada, a corrente de insistências volta a cobrar.
    if (isOnCall()) {
      Log.i(SpokenScheduler.TAG, "chamada/reuniao em andamento — nao fala")
      stopEverything() // condição global: descarta a fila inteira
      return
    }

    if (routeToHeadphones) ensureMediaAudible()

    // Pausa o que estiver tocando — o player retoma sozinho quando devolvermos
    // o foco, no stopEverything().
    requestSpeechFocus()

    acquireWake()

    // SOM COMPOSTO: o próprio serviço toca o PIADO DA CORUJA, espera 1,5s e só
    // então fala o aviso/nudge (coruja → pausa → voz). Não depende mais do piado
    // da notificação (que podia não soar). Se o piado falhar, fala direto.
    playOwlThenVoice(audioPath, body)
    return
  }

  /** Toca o canto da coruja (res/raw) e, ao terminar, espera 1,5s e fala. */
  private fun playOwlThenVoice(audioPath: String?, body: String) {
    try {
      val owl = MediaPlayer.create(this, R.raw.owl_call) ?: run {
        playVoiceNow(audioPath, body)
        return
      }
      try {
        owl.setAudioAttributes(speechAttrs())
      } catch (_: Exception) {}
      if (routeToHeadphones && preferredDevice != null &&
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
      ) {
        try { owl.setPreferredDevice(preferredDevice) } catch (_: Exception) {}
      }
      val vol = SpokenStore.getNudgeVolume(this)
      try { owl.setVolume(vol, vol) } catch (_: Exception) {}
      owl.setOnCompletionListener {
        try { it.release() } catch (_: Exception) {}
        android.os.Handler(android.os.Looper.getMainLooper())
          .postDelayed({ playVoiceNow(audioPath, body) }, 1500)
      }
      owl.start()
    } catch (e: Exception) {
      Log.w(SpokenScheduler.TAG, "service: piado falhou ${e.message}; fala direto")
      playVoiceNow(audioPath, body)
    }
  }

  private fun playVoiceNow(audioPath: String?, body: String) {
    if (!audioPath.isNullOrEmpty()) {
      playWav(audioPath)
    } else if (body.isNotEmpty()) {
      speakWithSystemTts(body)
    } else {
      Log.w(SpokenScheduler.TAG, "service: sem áudio nem texto")
      finishCurrent()
    }
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
      mp.setOnCompletionListener { finishCurrent() }
      mp.setOnErrorListener { _, what, extra ->
        Log.e(SpokenScheduler.TAG, "MediaPlayer error what=$what extra=$extra")
        finishCurrent()
        true
      }
      mp.prepareAsync()
      player = mp
      Log.d(SpokenScheduler.TAG, "service: tocando WAV $path")
    } catch (e: Exception) {
      Log.e(SpokenScheduler.TAG, "service: WAV falhou ${e.message}; tentando voz do sistema")
      finishCurrent()
    }
  }

  private fun speakWithSystemTts(text: String) {
    try {
      val engine = TextToSpeech(applicationContext) { status ->
        val t = tts
        if (status != TextToSpeech.SUCCESS || t == null) {
          Log.e(SpokenScheduler.TAG, "TTS init falhou ($status)")
          finishCurrent()
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
          override fun onDone(utteranceId: String?) { finishCurrent() }
          @Suppress("OVERRIDE_DEPRECATION", "DEPRECATION")
          override fun onError(utteranceId: String?) { finishCurrent() }
          override fun onError(utteranceId: String?, errorCode: Int) { finishCurrent() }
        })
        val params = Bundle()
        params.putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, "nudge")
        val res = t.speak(text, TextToSpeech.QUEUE_FLUSH, params, "nudge")
        if (res == TextToSpeech.ERROR) {
          Log.e(SpokenScheduler.TAG, "TTS speak retornou ERROR")
          finishCurrent()
        } else {
          Log.d(SpokenScheduler.TAG, "service: falando via sistema (TTS)")
        }
      }
      tts = engine
    } catch (e: Exception) {
      Log.e(SpokenScheduler.TAG, "TTS falhou: ${e.message}")
      finishCurrent()
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

  /**
   * Há chamada ou reunião em andamento? Teams, Meet, Zoom, WhatsApp e o telefone
   * põem o aparelho em MODE_IN_COMMUNICATION (VoIP) ou MODE_IN_CALL (celular).
   * Na dúvida (exceção ao ler o modo) devolve false: é melhor falar de mais do
   * que emudecer a coruja por um erro de leitura.
   */
  private fun isOnCall(): Boolean {
    return try {
      val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
      am.mode == AudioManager.MODE_IN_COMMUNICATION || am.mode == AudioManager.MODE_IN_CALL
    } catch (e: Exception) {
      Log.w(SpokenScheduler.TAG, "isOnCall falhou: ${e.message}")
      false
    }
  }

  /**
   * Pede foco de áudio TRANSIENTE antes de falar. Quem estiver tocando (música,
   * vídeo, podcast, audiolivro) PAUSA sozinho, e retoma quando devolvemos o foco
   * no fim da fala — é o mecanismo padrão do Android, não precisa saber quem é o
   * outro app.
   *
   * EXCEÇÃO — chamadas e reuniões: Teams, Meet, Zoom, WhatsApp e o telefone põem
   * o aparelho em MODE_IN_COMMUNICATION / MODE_IN_CALL. Nesses modos NÃO pedimos
   * foco: cortar o áudio de uma reunião no meio de uma frase é pior do que o
   * aviso que estamos tentando dar. A fala sai por cima, sem pausar ninguém.
   *
   * Nota: isto é o oposto do que a respiração faz de propósito (v1.95.0). Lá o
   * exercício acompanha o que você já ouve; aqui é uma frase curta que precisa
   * ser entendida, e disputar o áudio com uma música deixaria as duas ininteligíveis.
   */
  private fun requestSpeechFocus() {
    try {
      if (focusRequest != null) return // já temos foco (fala emendada da fila)
      val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
      if (isOnCall()) return // defesa: em chamada nem chegamos aqui
      val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        .setAudioAttributes(speechAttrs())
        .build()
      am.requestAudioFocus(req)
      focusRequest = req
    } catch (e: Exception) {
      Log.w(SpokenScheduler.TAG, "requestSpeechFocus falhou: ${e.message}")
      focusRequest = null
    }
  }

  /** Devolve o foco — é isto que faz o player do usuário voltar a tocar. */
  private fun abandonSpeechFocus() {
    val req = focusRequest ?: return
    focusRequest = null
    try {
      val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
      am.abandonAudioFocusRequest(req)
    } catch (e: Exception) {
      Log.w(SpokenScheduler.TAG, "abandonSpeechFocus falhou: ${e.message}")
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
      // Solta o anterior antes de criar outro: com a fila, isto é chamado uma vez
      // por fala, e sem isto o wakelock antigo ficaria pendurado até o timeout.
      // Recriar também renova o teto de 2 min para a fala que está começando.
      try { if (wakeLock?.isHeld == true) wakeLock?.release() } catch (_: Exception) {}
      wakeLock = null
      val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
      val wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "comentor:spoken")
      wl.setReferenceCounted(false)
      wl.acquire(2 * 60 * 1000L) // teto de 2 min — solto ao terminar
      wakeLock = wl
    } catch (e: Exception) {
      Log.w(SpokenScheduler.TAG, "wakelock failed: ${e.message}")
    }
  }

  /**
   * Terminou UMA fala. Se há outra na fila, solta os recursos dela e emenda a
   * próxima — sem derrubar o serviço, sem devolver o foco de áudio e sem soltar
   * o wakelock, para o player do usuário não voltar a tocar por um segundo entre
   * uma fala e outra. Fila vazia: encerra tudo de verdade.
   *
   * Sempre na main thread: alguns callbacks (init do TTS) chegam de outra.
   */
  private fun finishCurrent() {
    android.os.Handler(android.os.Looper.getMainLooper()).post {
      val next = if (pending.isEmpty()) null else pending.removeFirst()
      if (next == null) {
        speaking = false
        stopEverything()
        return@post
      }
      releaseSpeechResources()
      Log.i(SpokenScheduler.TAG, "proxima fala da fila (${pending.size} restantes)")
      // Respiro entre as duas, para não soarem coladas.
      android.os.Handler(android.os.Looper.getMainLooper())
        .postDelayed({ startUtterance(next) }, 900)
    }
  }

  /** Solta player e TTS da fala que acabou, mantendo serviço, foco e wakelock. */
  private fun releaseSpeechResources() {
    try { player?.release() } catch (_: Exception) {}
    player = null
    try {
      tts?.stop()
      tts?.shutdown()
    } catch (_: Exception) {}
    tts = null
  }

  private fun stopEverything() {
    pending.clear()
    speaking = false
    // Antes de restaurar o volume: devolver o foco é o que faz o player do
    // usuário retomar de onde parou.
    abandonSpeechFocus()
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
