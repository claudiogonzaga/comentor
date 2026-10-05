package expo.modules.spokennudges

import android.app.Notification
import android.app.PendingIntent
import android.graphics.drawable.Icon
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

  // A FALA agendada para depois da pausa. Guardada para poder ser CANCELADA:
  // com a pausa de 15 s, "Calar agora" durante a pausa precisa impedir a fala —
  // antes, o postDelayed disparava de qualquer jeito depois do stop.
  private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())
  private var pendingVoice: Runnable? = null
  // A PRÓXIMA fala da fila, agendada com um respiro de 900 ms — também
  // cancelável: "Calar agora" nesse intervalo não pode deixá-la começar.
  private var pendingNext: Runnable? = null
  // O canto em curso (para parar junto com a fala no "Calar agora").
  private var owlPlayer: MediaPlayer? = null
  // Perdemos o foco de áudio (telefone tocando, reunião, a pessoa deu play em
  // outra coisa) e ainda não o recuperamos: nada de falar por cima.
  @Volatile private var focusLost = false
  // Incrementa a cada fala iniciada; um runnable de uma fala antiga não fala.
  private var utteranceSeq = 0

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // "Calar agora" (botão da notificação): cala a fala atual E as da fila.
    if (intent?.action == ACTION_SILENCE) {
      Log.i(SpokenScheduler.TAG, "calar agora — fala cancelada pelo usuário")
      SpokenStore.setSilencedAt(this, System.currentTimeMillis())
      stopEverything()
      return START_NOT_STICKY
    }
    val audioPath = intent?.getStringExtra("audioPath")
    val title = intent?.getStringExtra("title")?.ifEmpty { "Askeo" } ?: "Askeo"
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
    // Calado/encerrado enquanto esta fala esperava a vez: não começa.
    if (!speaking) return
    val audioPath = u.audioPath
    val title = u.title
    val body = u.body

    utteranceSeq++
    val pauseMs = SpokenStore.getOwlPauseMs(this)
    startInForeground(
      title,
      if (pauseMs > 0) {
        "A coruja vai falar em ${pauseMs / 1000} s. Não é um bom momento? Toque em Calar agora."
      } else {
        body
      },
    )

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
    if (focusLost) {
      // Outro app segura o áudio com exclusividade (gravador, reconhecimento de
      // voz): não canta nem fala.
      Log.i(SpokenScheduler.TAG, "foco de áudio negado — não fala")
      stopEverything()
      return
    }

    acquireWake()

    // SOM COMPOSTO: o próprio serviço toca o PIADO DA CORUJA, espera a pausa
    // configurada (padrão 15 s) e só então fala o aviso/nudge/inspiração
    // (coruja → pausa → voz). Não depende do piado da notificação (que podia
    // não soar). Se o piado falhar, fala direto.
    playOwlThenVoice(audioPath, body)
    return
  }

  /**
   * Toca o canto da coruja (res/raw) e, ao terminar, espera a PAUSA configurada
   * (padrão 15 s) antes de falar. A pausa é para a pessoa baixar o volume ou
   * tocar "Calar agora" na notificação se o ambiente não permitir a fala.
   * Se o canto falhar, fala direto (sem canto não há aviso a esperar).
   */
  private fun playOwlThenVoice(audioPath: String?, body: String) {
    val seq = utteranceSeq
    try {
      val owl = MediaPlayer.create(this, R.raw.owl_call) ?: run {
        updateNotificationText(body)
        playVoiceNow(audioPath, body)
        return
      }
      owlPlayer = owl
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
        if (owlPlayer === it) owlPlayer = null
        try { it.release() } catch (_: Exception) {}
        scheduleVoiceAfterPause(seq, audioPath, body)
      }
      owl.start()
    } catch (e: Exception) {
      Log.w(SpokenScheduler.TAG, "service: piado falhou ${e.message}; fala direto")
      releaseOwl()
      updateNotificationText(body)
      playVoiceNow(audioPath, body)
    }
  }

  /** Agenda a fala para depois da pausa — cancelável por "Calar agora"/stop. */
  private fun scheduleVoiceAfterPause(seq: Int, audioPath: String?, body: String) {
    cancelPendingVoice()
    val r = Runnable {
      pendingVoice = null
      // Já substituído por outra fala nesse meio-tempo: esta não fala.
      if (seq != utteranceSeq) return@Runnable
      if (!speaking) {
        stopEverything()
        return@Runnable
      }
      // A PAUSA é longa (15 s por padrão): tudo o que foi conferido antes do
      // canto pode ter mudado. Reconfere antes de abrir a boca.
      if (!gatesStillOpen()) {
        stopEverything() // condição global: descarta a fila inteira
        return@Runnable
      }
      updateNotificationText(body)
      playVoiceNow(audioPath, body)
    }
    pendingVoice = r
    mainHandler.postDelayed(r, SpokenStore.getOwlPauseMs(this))
  }

  private fun cancelPendingVoice() {
    pendingVoice?.let { mainHandler.removeCallbacks(it) }
    pendingVoice = null
  }

  private fun releaseOwl() {
    val o = owlPlayer ?: return
    owlPlayer = null
    try { o.stop() } catch (_: Exception) {}
    try { o.release() } catch (_: Exception) {}
  }

  /**
   * Os portões de antes do canto, reavaliados DEPOIS da pausa: entrou numa
   * chamada/reunião, tirou o fone, ligou "só com fone", entrou no horário
   * silencioso ou zerou o volume do Askeo. Atualiza o roteamento se um fone
   * foi conectado durante a pausa. false = não fala.
   */
  private fun gatesStillOpen(): Boolean {
    if (focusLost) {
      Log.i(SpokenScheduler.TAG, "pausa: outro áudio assumiu (foco perdido) — não fala")
      return false
    }
    if (isOnCall()) {
      Log.i(SpokenScheduler.TAG, "pausa: entrou em chamada/reunião — não fala")
      return false
    }
    val device = mediaHeadphoneDevice(this)
    if (routeToHeadphones && device == null) {
      // O canto saiu no fone e o fone foi tirado: a fala NÃO vai para o alto-falante.
      Log.i(SpokenScheduler.TAG, "pausa: fone desconectado — não fala")
      return false
    }
    if (SpokenStore.getHeadphonesOnly(this) && device == null) {
      Log.i(SpokenScheduler.TAG, "pausa: 'só com fone' e sem fone — não fala")
      return false
    }
    if (device == null && isQuietNow(this)) {
      Log.i(SpokenScheduler.TAG, "pausa: horário silencioso — não fala")
      return false
    }
    if (SpokenStore.getNudgeVolume(this) <= 0f) {
      Log.i(SpokenScheduler.TAG, "pausa: volume do Askeo zerado — não fala")
      return false
    }
    if (device != null && !routeToHeadphones) {
      routeToHeadphones = true
      preferredDevice = device
      ensureMediaAudible()
    }
    return true
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
        // O volume do Askeo (barra da Home) vale também para a voz do sistema.
        params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, SpokenStore.getNudgeVolume(this@SpokenSpeechService))
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
      // RINGTONE: o telefone está TOCANDO — também não é hora de falar.
      am.mode == AudioManager.MODE_IN_COMMUNICATION ||
        am.mode == AudioManager.MODE_IN_CALL ||
        am.mode == AudioManager.MODE_RINGTONE
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
      val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
      if (focusRequest != null) {
        if (!focusLost) return // já temos foco (fala emendada da fila)
        // Perdemos o foco na fala anterior: devolve e pede de novo (pausa quem
        // começou a tocar nesse meio-tempo).
        try { am.abandonAudioFocusRequest(focusRequest!!) } catch (_: Exception) {}
        focusRequest = null
      }
      if (isOnCall()) return // defesa: em chamada nem chegamos aqui
      val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        .setAudioAttributes(speechAttrs())
        // Perdeu o foco para uma chamada/reunião (ou a pessoa deu play em outra
        // coisa) enquanto a fala esperava a pausa: não fala. Em chamada, cala
        // também a fala em curso.
        .setOnAudioFocusChangeListener({ change ->
          when (change) {
            AudioManager.AUDIOFOCUS_LOSS, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
              // Lembra da perda (não chega outro aviso depois): a pausa e a
              // próxima fala da fila conferem isto.
              focusLost = true
              // Durante o canto, a pausa ou o respiro da fila: cala já. Durante a
              // voz: cala se for chamada/telefone tocando.
              if (owlPlayer != null || pendingVoice != null || pendingNext != null || isOnCall()) {
                Log.i(SpokenScheduler.TAG, "perdeu o foco de áudio ($change) — não fala")
                stopEverything()
              }
            }
            AudioManager.AUDIOFOCUS_GAIN -> focusLost = false
          }
        }, mainHandler)
        .build()
      val granted = am.requestAudioFocus(req)
      focusRequest = req
      focusLost = granted != AudioManager.AUDIOFOCUS_REQUEST_GRANTED
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

  private var currentTitle = "Askeo"

  private fun buildNotification(title: String, text: String): Notification {
    val channelId = "comentor-spoken-fgs"
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val ch = NotificationChannel(
        channelId,
        "Askeo falando",
        NotificationManager.IMPORTANCE_LOW,
      )
      ch.description = "Aparece enquanto o Askeo fala um lembrete em voz alta."
      ch.setShowBadge(false)
      nm.createNotificationChannel(ch)
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, channelId)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    // "Calar agora": cala esta fala e as da fila, sem abrir o app.
    val silenceIntent = Intent(this, SpokenSpeechService::class.java).setAction(ACTION_SILENCE)
    val silencePi = PendingIntent.getService(
      this,
      1,
      silenceIntent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val action = Notification.Action.Builder(
      Icon.createWithResource(this, android.R.drawable.ic_lock_silent_mode),
      "Calar agora",
      silencePi,
    ).build()
    return builder
      .setContentTitle(title)
      .setContentText(if (text.isNotEmpty()) text else "Tocando lembrete…")
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .addAction(action)
      .build()
  }

  private fun startInForeground(title: String, body: String) {
    currentTitle = title
    val notif = buildNotification(title, body)
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

  /** Troca o texto da notificação (ex.: da contagem da pausa para o lembrete). */
  private fun updateNotificationText(text: String) {
    try {
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      nm.notify(NOTIF_ID, buildNotification(currentTitle, text))
    } catch (_: Exception) {}
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
      // teto: 2 min de fala + a pausa depois do canto — solto ao terminar
      wl.acquire(2 * 60 * 1000L + SpokenStore.getOwlPauseMs(this))
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
      val r = Runnable {
        pendingNext = null
        startUtterance(next)
      }
      pendingNext = r
      mainHandler.postDelayed(r, 900)
    }
  }

  /** Solta player e TTS da fala que acabou, mantendo serviço, foco e wakelock. */
  private fun releaseSpeechResources() {
    cancelPendingVoice()
    releaseOwl()
    try { player?.release() } catch (_: Exception) {}
    player = null
    try {
      tts?.stop()
      tts?.shutdown()
    } catch (_: Exception) {}
    tts = null
  }

  private fun stopEverything() {
    focusLost = false
    cancelPendingVoice()
    pendingNext?.let { mainHandler.removeCallbacks(it) }
    pendingNext = null
    releaseOwl()
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
    /** Ação do botão "Calar agora" da notificação. */
    const val ACTION_SILENCE = "expo.modules.spokennudges.SILENCE"
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
