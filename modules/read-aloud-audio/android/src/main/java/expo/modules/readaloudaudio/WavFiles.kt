package expo.modules.readaloudaudio

import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.RandomAccessFile

/**
 * O WAV da leitura (24 kHz, mono, 16 bits) montado em disco, de arquivo em arquivo.
 * Juntar ~20 minutos de fala na memória do JavaScript (três cópias de ~60 MB) era
 * o que derrubava o "Leia para mim" com textos longos.
 */
object WavFiles {
  private const val CHANNELS = 1
  private const val BITS = 16

  fun u32(b: ByteArray, off: Long): Long {
    val o = off.toInt()
    return (b[o].toLong() and 0xff) or ((b[o + 1].toLong() and 0xff) shl 8) or
      ((b[o + 2].toLong() and 0xff) shl 16) or ((b[o + 3].toLong() and 0xff) shl 24)
  }

  /** Onde começa o áudio de um WAV ("data"), ou null se não for RIFF. */
  fun dataOffset(b: ByteArray): Long? {
    if (b.size < 12 || b[0] != 'R'.code.toByte() || b[1] != 'I'.code.toByte() ||
      b[2] != 'F'.code.toByte() || b[3] != 'F'.code.toByte()
    ) return null
    var off = 12L
    while (off + 8 <= b.size) {
      val id = String(b, off.toInt(), 4, Charsets.US_ASCII)
      val size = u32(b, off + 4)
      if (id == "data") return off + 8
      off += 8 + size + (size % 2)
    }
    return 44L
  }

  fun header(dataLen: Long, sampleRate: Int = TtsEngine.SAMPLE_RATE): ByteArray {
    val byteRate = sampleRate * CHANNELS * BITS / 8
    val h = ByteArray(44)
    fun str(off: Int, s: String) = s.forEachIndexed { i, c -> h[off + i] = c.code.toByte() }
    fun le32(off: Int, v: Long) {
      for (i in 0 until 4) h[off + i] = ((v shr (8 * i)) and 0xff).toByte()
    }
    fun le16(off: Int, v: Int) {
      h[off] = (v and 0xff).toByte()
      h[off + 1] = ((v shr 8) and 0xff).toByte()
    }
    str(0, "RIFF"); le32(4, 36 + dataLen); str(8, "WAVE")
    str(12, "fmt "); le32(16, 16); le16(20, 1); le16(22, CHANNELS)
    le32(24, sampleRate.toLong()); le32(28, byteRate.toLong()); le16(32, CHANNELS * BITS / 8); le16(34, BITS)
    str(36, "data"); le32(40, dataLen)
    return h
  }

  /** O trecho de áudio de um arquivo: PCM cru inteiro, ou o bloco "data" de um WAV. */
  private fun audioRange(f: File, raw: Boolean): Pair<Long, Long> {
    if (raw) return 0L to f.length()
    val head = ByteArray(minOf(4096L, f.length()).toInt())
    RandomAccessFile(f, "r").use { it.readFully(head) }
    val off = dataOffset(head) ?: return 0L to f.length()
    val declared = if (off >= 4) u32(head, off - 4) else 0L
    val avail = f.length() - off
    val len = if (declared in 1..avail) declared else avail
    return off to (len - len % 2)
  }

  /**
   * Junta os arquivos (PCM cru ou WAV) num WAV só, gravado num temporário e
   * renomeado no fim: um processo morto no meio nunca deixa um WAV pela metade com
   * o nome final. Devolve o tamanho do arquivo.
   */
  fun concat(inputs: List<File>, out: File, raw: Boolean): Long {
    val ranges = inputs.map { f ->
      if (!f.exists()) throw IOException("faltou um trecho do áudio (${f.name})")
      audioRange(f, raw)
    }
    val total = ranges.sumOf { it.second }
    out.parentFile?.mkdirs()
    val tmp = File(out.path + ".tmp")
    FileOutputStream(tmp).use { os ->
      os.write(header(total))
      val buf = ByteArray(1 shl 16)
      inputs.forEachIndexed { i, f ->
        val (start, len) = ranges[i]
        FileInputStream(f).use { ins ->
          var skip = start
          while (skip > 0) {
            val s = ins.skip(skip)
            if (s <= 0) throw IOException("trecho ilegível (${f.name})")
            skip -= s
          }
          var left = len
          while (left > 0) {
            val n = ins.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
            if (n < 0) throw IOException("trecho truncado (${f.name})")
            os.write(buf, 0, n)
            left -= n
          }
        }
      }
      os.fd.sync()
    }
    if (tmp.length() != 44 + total) {
      tmp.delete()
      throw IOException("não consegui gravar o áudio completo (espaço em disco?)")
    }
    if (out.exists()) out.delete()
    if (!tmp.renameTo(out)) {
      tmp.delete()
      throw IOException("não consegui gravar o áudio completo")
    }
    return out.length()
  }
}
