package expo.modules.aspismedia

import android.content.Context
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineTransducerModelConfig
import java.io.File
import java.io.InputStream
import java.util.Collections
import kotlin.math.sqrt

// Transcrição NO CELULAR com o Parakeet (sherpa-onnx), sem internet:
//   arquivo de áudio → ffmpeg (já embarcado com o yt-dlp) → PCM 16 kHz mono
//   → trechos de até ~28 s cortados num silêncio → Parakeet → texto com tempo.
object Transcriber {
  private const val SR = 16_000
  private const val MAX_CHUNK = 28 * SR // o Parakeet vai bem com trechos < 30 s
  private const val MIN_CUT = 18 * SR // procura o silêncio entre 18 e 28 s
  private const val FRAME = SR * 30 / 1000 // janelas de 30 ms para achar o silêncio
  private const val SILENT_RMS = 0.004f // trecho inteiro abaixo disso = silêncio

  data class Segment(val start: Double, val end: Double, val text: String)

  class Canceled : Exception("Transcrição cancelada.")

  private val canceled: MutableSet<String> = Collections.synchronizedSet(mutableSetOf())
  private val lock = Any()
  @Volatile private var recognizer: OfflineRecognizer? = null

  fun cancel(id: String) {
    canceled.add(id)
  }

  fun release() {
    synchronized(lock) {
      recognizer?.release()
      recognizer = null
    }
  }

  private fun recognizer(context: Context): OfflineRecognizer {
    recognizer?.let { return it }
    check(ParakeetModel.isInstalled(context)) { "O modelo de transcrição ainda não foi baixado." }
    val m = { name: String -> ParakeetModel.file(context, name).absolutePath }
    val config = OfflineRecognizerConfig(
      featConfig = FeatureConfig(sampleRate = SR, featureDim = 80),
      modelConfig = OfflineModelConfig(
        transducer = OfflineTransducerModelConfig(
          encoder = m("encoder.int8.onnx"),
          decoder = m("decoder.int8.onnx"),
          joiner = m("joiner.int8.onnx"),
        ),
        tokens = m("tokens.txt"),
        modelType = "nemo_transducer",
        numThreads = 4,
      ),
    )
    return OfflineRecognizer(config = config).also { recognizer = it }
  }

  // ffmpeg/ffprobe do youtubedl-android: binários em nativeLibraryDir e libs
  // descompactadas em noBackupFilesDir (mesmo ambiente que a biblioteca usa).
  private fun process(context: Context, bin: String, vararg args: String): Process {
    val packages = File(context.noBackupFilesDir, "youtubedl-android/packages")
    val libs = listOf("python", "ffmpeg", "aria2c").joinToString(":") { "${packages.absolutePath}/$it/usr/lib" }
    val exe = File(context.applicationInfo.nativeLibraryDir, bin).absolutePath
    return ProcessBuilder(listOf(exe) + args).apply {
      environment()["LD_LIBRARY_PATH"] = libs
      environment()["TMPDIR"] = context.cacheDir.absolutePath
    }.start()
  }

  private fun durationSeconds(context: Context, path: String): Double {
    val p = process(
      context, "libffprobe.so",
      "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path,
    )
    val out = p.inputStream.bufferedReader().readText().trim()
    p.waitFor()
    return out.toDoubleOrNull() ?: 0.0
  }

  fun transcribe(
    context: Context,
    path: String,
    id: String,
    onProgress: (Double) -> Unit,
  ): List<Segment> = synchronized(lock) {
    canceled.remove(id)
    val rec = recognizer(context)
    val total = durationSeconds(context, path).coerceAtLeast(1.0)
    val ffmpeg = process(
      context, "libffmpeg.so",
      "-nostdin", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", SR.toString(), "-f", "s16le", "-",
    )
    // stderr precisa ser drenado, senão o ffmpeg trava com o buffer cheio
    Thread { ffmpeg.errorStream.use { it.readBytes() } }.start()

    val segments = mutableListOf<Segment>()
    val buf = FloatArray(MAX_CHUNK + SR)
    var len = 0
    var offset = 0L // amostras já consumidas antes de buf[0]

    fun decode(count: Int) {
      val chunk = buf.copyOfRange(0, count)
      if (rms(chunk, 0, count) >= SILENT_RMS) {
        val stream = rec.createStream()
        try {
          stream.acceptWaveform(chunk, SR)
          rec.decode(stream)
          val text = rec.getResult(stream).text.trim()
          if (text.isNotEmpty()) {
            segments.add(Segment(offset.toDouble() / SR, (offset + count).toDouble() / SR, text))
          }
        } finally {
          stream.release()
        }
      }
      System.arraycopy(buf, count, buf, 0, len - count)
      len -= count
      offset += count
      onProgress((offset.toDouble() / SR / total).coerceIn(0.0, 1.0))
    }

    try {
      val input: InputStream = ffmpeg.inputStream
      val bytes = ByteArray(SR * 2) // 1 s de PCM 16 bits
      var carry = -1 // byte ímpar que sobrou de uma leitura
      while (true) {
        if (canceled.contains(id)) throw Canceled()
        val n = input.read(bytes)
        if (n < 0) break
        var i = 0
        if (carry >= 0 && n > 0) {
          buf[len++] = ((bytes[0].toInt() shl 8) or carry).toShort() / 32768f
          i = 1
          carry = -1
        }
        while (i + 1 < n) {
          val s = ((bytes[i + 1].toInt() shl 8) or (bytes[i].toInt() and 0xff)).toShort()
          buf[len++] = s / 32768f
          i += 2
        }
        if (i < n) carry = bytes[i].toInt() and 0xff
        while (len >= MAX_CHUNK) decode(cutPoint(buf, len))
      }
      if (len > SR / 3) decode(len)
      if (ffmpeg.waitFor() != 0 && segments.isEmpty()) {
        throw IllegalStateException("Não consegui ler o áudio desse vídeo.")
      }
      onProgress(1.0)
      segments
    } finally {
      canceled.remove(id)
      ffmpeg.destroy()
    }
  }

  // Corta no trecho mais silencioso entre 18 e 28 s (evita partir palavras).
  private fun cutPoint(buf: FloatArray, len: Int): Int {
    val end = minOf(len, MAX_CHUNK)
    var best = end
    var bestRms = Float.MAX_VALUE
    var start = MIN_CUT
    while (start + FRAME <= end) {
      val r = rms(buf, start, FRAME)
      if (r < bestRms) {
        bestRms = r
        best = start + FRAME / 2
      }
      start += FRAME
    }
    return best
  }

  private fun rms(a: FloatArray, from: Int, count: Int): Float {
    var sum = 0.0
    for (k in from until from + count) sum += (a[k] * a[k]).toDouble()
    return sqrt(sum / count.coerceAtLeast(1)).toFloat()
  }
}
