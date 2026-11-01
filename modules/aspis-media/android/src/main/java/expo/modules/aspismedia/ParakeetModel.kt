package expo.modules.aspismedia

import android.content.Context
import java.io.File
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

// Modelo NVIDIA Parakeet TDT 0.6B v3 (int8, exportado para sherpa-onnx; licença
// CC-BY-4.0). Não vai no APK (~670 MB): é baixado sob demanda para o
// armazenamento privado do app, com retomada e checagem de SHA-256 fixada numa
// revisão do repositório.
object ParakeetModel {
  private const val DIR = "models/parakeet-tdt-0.6b-v3-int8"
  private const val REPO =
    "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/" +
      "2bda32ec70b097a55adaa07d9a7173915b43cc78"

  data class Part(val name: String, val size: Long, val sha256: String)

  val PARTS = listOf(
    Part("encoder.int8.onnx", 652_184_281, "acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247"),
    Part("decoder.int8.onnx", 11_845_275, "179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e"),
    Part("joiner.int8.onnx", 6_355_277, "3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3"),
    Part("tokens.txt", 93_939, "e83f7c1ab02db8a3791a5e1e86f5cf4adb4ad36defe20e13a8d0ce7b387ad3a0"),
  )
  val TOTAL_BYTES = PARTS.sumOf { it.size }

  class Canceled : Exception("Download do modelo cancelado.")

  @Volatile var cancelRequested = false

  fun dir(context: Context): File = File(context.filesDir, DIR)
  fun file(context: Context, name: String) = File(dir(context), name)

  // Pronto = todos os arquivos no lugar (a verificação de hash acontece no
  // download; um arquivo só recebe o nome final depois de conferido).
  fun isInstalled(context: Context): Boolean =
    PARTS.all { file(context, it.name).let { f -> f.exists() && f.length() == it.size } }

  fun downloadedBytes(context: Context): Long = PARTS.sumOf { p ->
    val done = file(context, p.name)
    val part = File(dir(context), p.name + ".part")
    when {
      done.exists() -> done.length()
      part.exists() -> part.length()
      else -> 0L
    }
  }

  fun delete(context: Context) {
    dir(context).deleteRecursively()
  }

  /** Baixa o que falta (retomando parciais). onProgress(bytesBaixados, total). */
  fun download(context: Context, onProgress: (Long, Long) -> Unit) {
    cancelRequested = false
    val d = dir(context).apply { mkdirs() }
    var doneBefore = 0L
    for (p in PARTS) {
      val target = File(d, p.name)
      if (target.exists() && target.length() == p.size) {
        doneBefore += p.size
        continue
      }
      val part = File(d, p.name + ".part")
      fetch("$REPO/${p.name}", part, p.size) { got -> onProgress(doneBefore + got, TOTAL_BYTES) }
      if (sha256(part) != p.sha256) {
        part.delete()
        throw IllegalStateException("Arquivo ${p.name} veio corrompido — tente de novo.")
      }
      if (!part.renameTo(target)) throw IllegalStateException("Não consegui salvar ${p.name}.")
      doneBefore += p.size
      onProgress(doneBefore, TOTAL_BYTES)
    }
  }

  private fun fetch(url: String, dest: File, expected: Long, onBytes: (Long) -> Unit) {
    var have = if (dest.exists()) dest.length() else 0L
    if (have > expected) {
      dest.delete()
      have = 0
    }
    if (have == expected) return
    val conn = (URL(url).openConnection() as HttpURLConnection).apply {
      instanceFollowRedirects = true
      connectTimeout = 20_000
      readTimeout = 60_000
      if (have > 0) setRequestProperty("Range", "bytes=$have-")
    }
    try {
      val code = conn.responseCode
      if (code != 200 && code != 206) throw IllegalStateException("HTTP $code ao baixar o modelo.")
      if (code == 200 && have > 0) have = 0 // servidor ignorou o Range → recomeça
      RandomAccessFile(dest, "rw").use { raf ->
        raf.setLength(have)
        raf.seek(have)
        conn.inputStream.use { input ->
          val buf = ByteArray(1 shl 16)
          var lastEmit = 0L
          while (true) {
            if (cancelRequested) throw Canceled()
            val n = input.read(buf)
            if (n < 0) break
            raf.write(buf, 0, n)
            have += n
            if (have - lastEmit > 2_000_000) {
              lastEmit = have
              onBytes(have)
            }
          }
        }
      }
      if (have != expected) throw IllegalStateException("Download incompleto (${have}/${expected} bytes).")
      onBytes(have)
    } finally {
      conn.disconnect()
    }
  }

  private fun sha256(f: File): String {
    val md = MessageDigest.getInstance("SHA-256")
    f.inputStream().use { input ->
      val buf = ByteArray(1 shl 20)
      while (true) {
        val n = input.read(buf)
        if (n < 0) break
        md.update(buf, 0, n)
      }
    }
    return md.digest().joinToString("") { "%02x".format(it) }
  }
}
