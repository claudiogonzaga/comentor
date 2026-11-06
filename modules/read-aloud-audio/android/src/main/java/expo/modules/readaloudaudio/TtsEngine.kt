package expo.modules.readaloudaudio

import android.util.Base64
import android.util.JsonReader
import android.util.JsonToken
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.IOException
import java.io.InputStream
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/** Falha que não adianta repetir (chave, cota diária, recusa do modelo). */
class TtsFatal(message: String, val dailyQuota: Boolean = false) : Exception(message)

/** A pessoa cancelou a geração. */
class TtsCanceled : Exception("geração cancelada")

/**
 * Uma voz do Gemini, trecho a trecho — o mesmo que src/services/geminiTTS.ts faz
 * (fetchPcm), mas fora do JavaScript, para seguir com a tela apagada:
 *  - modelos 3.8 pela Interactions API; se ela recusar o formato, generateContent;
 *    se o modelo não existir para a chave, o 2.5 com uma voz clássica;
 *  - novas tentativas para 429 por minuto, 5xx, rede/tempo e resposta sem áudio;
 *  - o 429 DIÁRIO não se repete (só volta à meia-noite no Pacífico);
 *  - ritmo de 9 pedidos por minuto (o gargalo da API) e volume normalizado.
 */
class TtsEngine(
  private val apiKey: String,
  private var model: String,
  private val legacyModel: String,
  private var voice: String,
  private val legacyVoice: String,
  private var interactions: Boolean,
  private val canceled: () -> Boolean,
  private val onConnection: (HttpURLConnection?) -> Unit,
) {
  private class Reply(
    val code: Int,
    val audio: ByteArray?,
    val detail: String,
    val errorBody: String,
    val retryAfter: String?,
  )

  fun synth(text: String): ByteArray {
    var attempt = 0
    while (true) {
      checkCanceled()
      acquireSlot()
      val r = try {
        call(text)
      } catch (e: IOException) {
        checkCanceled()
        if (attempt < MAX_RETRIES) {
          pause(backoff(attempt++))
          continue
        }
        throw TtsFatal("o Gemini não respondeu (${e.message ?: "rede"})")
      }
      if (r.code in 200..299) {
        r.audio?.let { return normalize(toPcm(it)) }
        if (attempt < MAX_RETRIES) {
          pause(backoff(attempt++))
          continue
        }
        throw TtsFatal("o Gemini respondeu sem áudio${if (r.detail.isNotEmpty()) " (${r.detail})" else ""}")
      }
      if (r.code in 500..599 && attempt < MAX_RETRIES) {
        pause(backoff(attempt++))
        continue
      }
      val keyProblem = KEY_PROBLEM.containsMatchIn(r.errorBody)
      // A Interactions API recusou o formato: generateContent, uma vez.
      if (interactions && r.code in listOf(400, 404, 405) && !keyProblem) {
        interactions = false
        continue
      }
      // O modelo não existe para esta chave: o 2.5, uma vez.
      if (!interactions && r.code == 404 && model != legacyModel) {
        model = legacyModel
        voice = legacyVoice
        continue
      }
      if (r.code == 429) {
        if (PER_DAY.containsMatchIn(r.errorBody)) {
          throw TtsFatal("a cota diária do Gemini acabou — ela volta à meia-noite do Pacífico (4h ou 5h em Brasília)", true)
        }
        if (attempt < MAX_RETRIES) {
          pause(retryDelay429(r.errorBody, r.retryAfter, attempt++))
          continue
        }
      }
      val msg = MESSAGE.find(r.errorBody)?.groupValues?.get(1) ?: "HTTP ${r.code}"
      throw TtsFatal("Gemini: $msg")
    }
  }

  private fun call(text: String): Reply {
    val url = if (interactions) {
      URL("$API/interactions")
    } else {
      URL("$API/models/$model:generateContent?key=" + URLEncoder.encode(apiKey, "UTF-8"))
    }
    val body = if (interactions) {
      JSONObject()
        .put("model", model)
        .put(
          "input",
          JSONArray().put(
            JSONObject()
              .put("type", "user_input")
              .put("content", JSONArray().put(JSONObject().put("type", "text").put("text", text))),
          ),
        )
        .put(
          "response_format",
          JSONObject().put("type", "audio").put("mime_type", "audio/wav").put("sample_rate", SAMPLE_RATE),
        )
        .put("generation_config", JSONObject().put("speech_config", JSONArray().put(JSONObject().put("voice", voice))))
    } else {
      JSONObject()
        .put("contents", JSONArray().put(JSONObject().put("parts", JSONArray().put(JSONObject().put("text", text)))))
        .put(
          "generationConfig",
          JSONObject()
            .put("responseModalities", JSONArray().put("AUDIO"))
            .put(
              "speechConfig",
              JSONObject().put("voiceConfig", JSONObject().put("prebuiltVoiceConfig", JSONObject().put("voiceName", voice))),
            ),
        )
    }
    val conn = url.openConnection() as HttpURLConnection
    conn.requestMethod = "POST"
    conn.doOutput = true
    conn.connectTimeout = 30_000
    // Gerar 2 minutos de fala leva de 20 s a alguns minutos: o limite cresce com o trecho.
    conn.readTimeout = max(90_000, text.length * 90)
    conn.setRequestProperty("Content-Type", "application/json")
    if (interactions) conn.setRequestProperty("x-goog-api-key", apiKey)
    onConnection(conn)
    try {
      conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
      val code = conn.responseCode
      if (code in 200..299) {
        val (audio, detail) = conn.inputStream.use { pickAudio(it) }
        return Reply(code, audio, detail, "", null)
      }
      val err = conn.errorStream?.use { it.readBytes().toString(Charsets.UTF_8).take(4000) } ?: ""
      return Reply(code, null, "", err, conn.getHeaderField("retry-after"))
    } finally {
      onConnection(null)
      conn.disconnect()
    }
  }

  /**
   * Acha o áudio (base64) na resposta, em qualquer formato (generateContent ou
   * Interactions), lendo o JSON em fluxo: a resposta tem ~8 MB e não precisa virar
   * um texto inteiro na memória. Guarda o motivo quando não há áudio.
   */
  private fun pickAudio(input: InputStream): Pair<ByteArray?, String> {
    val reader = JsonReader(InputStreamReader(BufferedInputStream(input, 1 shl 16), Charsets.UTF_8))
    var best: String? = null
    val detail = StringBuilder()
    fun walk(depth: Int, name: String?) {
      if (depth > 12) {
        reader.skipValue()
        return
      }
      when (reader.peek()) {
        JsonToken.BEGIN_OBJECT -> {
          reader.beginObject()
          while (reader.hasNext()) walk(depth + 1, reader.nextName())
          reader.endObject()
        }
        JsonToken.BEGIN_ARRAY -> {
          reader.beginArray()
          while (reader.hasNext()) walk(depth + 1, name)
          reader.endArray()
        }
        JsonToken.STRING -> {
          val s = reader.nextString()
          val atual = best
          if (s.length > 1000 && (atual == null || s.length > atual.length) && BASE64_HEAD.matches(s.take(200))) {
            best = s
          } else if (name in DETAIL_KEYS) {
            detail.append("$name=${s.take(120)} ")
          }
        }
        else -> reader.skipValue()
      }
    }
    walk(0, null)
    val b64 = best ?: return null to detail.toString().trim()
    best = null
    val flags = if (b64.contains('-') || b64.contains('_')) Base64.URL_SAFE else Base64.DEFAULT
    return Base64.decode(b64, flags) to ""
  }

  private fun checkCanceled() {
    if (canceled()) throw TtsCanceled()
  }

  /** Espera em fatias curtas, para o cancelar valer na hora. */
  private fun pause(ms: Long) {
    var left = ms
    while (left > 0) {
      checkCanceled()
      val step = min(left, 500L)
      Thread.sleep(step)
      left -= step
    }
    checkCanceled()
  }

  private fun acquireSlot() {
    while (true) {
      checkCanceled()
      val wait: Long
      synchronized(WINDOW) {
        val now = System.currentTimeMillis()
        while (WINDOW.isNotEmpty() && (now - WINDOW.first() > 60_000 || WINDOW.first() > now)) WINDOW.removeFirst()
        if (WINDOW.size < RPM) {
          WINDOW.addLast(now)
          return
        }
        wait = max(250L, 60_000 - (now - WINDOW.first()) + 250)
      }
      pause(min(wait, 60_250L))
    }
  }

  companion object {
    private const val API = "https://generativelanguage.googleapis.com/v1beta"
    const val SAMPLE_RATE = 24000
    private const val MAX_RETRIES = 6
    private const val RPM = 9
    private const val TARGET_RMS = 5000.0
    private val WINDOW = ArrayDeque<Long>()
    private val KEY_PROBLEM = Regex("api key|API_KEY|permission", RegexOption.IGNORE_CASE)
    private val PER_DAY = Regex("PerDay|per day|RequestsPerDay", RegexOption.IGNORE_CASE)
    private val RETRY_DELAY = Regex("\"retryDelay\"\\s*:\\s*\"(\\d+(?:\\.\\d+)?)s\"")
    private val MESSAGE = Regex("\"message\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.){1,300})\"")
    private val BASE64_HEAD = Regex("^[A-Za-z0-9+/_=\\s-]+$")
    private val DETAIL_KEYS = setOf("finishReason", "finishMessage", "blockReason")

    /** 2 s, 4 s, 8 s, 16 s, 30 s, 30 s. */
    private fun backoff(attempt: Int): Long = min(30_000L, 2_000L shl attempt)

    private fun retryDelay429(body: String, retryAfter: String?, attempt: Int): Long {
      RETRY_DELAY.find(body)?.groupValues?.get(1)?.toDoubleOrNull()?.let {
        return min(65_000L, (it * 1000).toLong() + 500)
      }
      retryAfter?.toDoubleOrNull()?.takeIf { it > 0 }?.let { return min(65_000L, (it * 1000).toLong()) }
      return min(60_000L, 12_000L shl attempt)
    }

    /** Os modelos 3.8 respondem WAV completo: fica só com o bloco "data". PCM cru passa direto. */
    fun toPcm(bytes: ByteArray): ByteArray {
      val off = WavFiles.dataOffset(bytes) ?: return bytes
      val size = WavFiles.u32(bytes, off - 4)
      val end = if (size > 0 && off + size <= bytes.size) (off + size).toInt() else bytes.size
      return bytes.copyOfRange(off.toInt(), end)
    }

    /**
     * Volume uniforme entre os trechos (cada um vem de uma chamada independente):
     * leva o RMS a ~-16 dBFS, com ganho entre 0,5 e 3 e sem passar do pico.
     */
    fun normalize(pcm: ByteArray): ByteArray {
      val n = pcm.size / 2
      if (n == 0) return pcm
      var sumSq = 0.0
      var peak = 1
      for (i in 0 until n) {
        val s = sample(pcm, i)
        sumSq += s.toDouble() * s
        val a = abs(s)
        if (a > peak) peak = a
      }
      val rms = sqrt(sumSq / n)
      if (rms < 1) return pcm
      var gain = (TARGET_RMS / rms).coerceIn(0.5, 3.0)
      if (peak * gain > 30000) gain = 30000.0 / peak
      if (abs(gain - 1) < 0.02) return pcm
      val out = pcm.copyOf()
      for (i in 0 until n) {
        val v = (sample(pcm, i) * gain).roundToInt().coerceIn(-32768, 32767)
        out[i * 2] = (v and 0xff).toByte()
        out[i * 2 + 1] = ((v shr 8) and 0xff).toByte()
      }
      return out
    }

    private fun sample(pcm: ByteArray, i: Int): Int =
      ((pcm[i * 2].toInt() and 0xff) or (pcm[i * 2 + 1].toInt() shl 8)).toShort().toInt()
  }
}
