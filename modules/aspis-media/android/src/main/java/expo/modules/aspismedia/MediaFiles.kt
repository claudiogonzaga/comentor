package expo.modules.aspismedia

import android.content.Context
import java.io.File

// Arquivos de áudio/vídeo baixados. Ficam no armazenamento PRIVADO do app
// (filesDir/aspis-media — sem permissão de armazenamento, invisível para
// outros apps) com o nome "<videoId>.<audio|video>.<ext>". A data de
// modificação é o momento em que o download terminou: vence em
// mtime + retenção configurada pelo usuário.
object MediaFiles {
  private const val DIR = "aspis-media"
  private const val PREFS = "aspis-media"
  private const val KEY_RETENTION_HOURS = "retention_hours"
  const val DEFAULT_RETENTION_HOURS = 24 * 7

  // Sobras de download (parciais do yt-dlp, faixas antes do merge).
  private val TEMP = Regex("""\.(part|ytdl)$|\.part-Frag\d+|\.temp\.[^.]+$|\.f\d+\.[^.]+$""")

  fun dir(context: Context): File = File(context.filesDir, DIR).apply { mkdirs() }

  fun isTemp(f: File): Boolean = TEMP.containsMatchIn(f.name)

  fun retentionHours(context: Context): Int =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getInt(KEY_RETENTION_HOURS, DEFAULT_RETENTION_HOURS)

  fun setRetentionHours(context: Context, hours: Int) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit().putInt(KEY_RETENTION_HOURS, hours.coerceAtLeast(1)).apply()
  }

  /** Arquivos prontos (sem temporários). */
  fun completed(context: Context): List<File> =
    dir(context).listFiles()?.filter { it.isFile && !isTemp(it) } ?: emptyList()

  /** Todos os arquivos (prontos e temporários) de um download. */
  fun allFor(context: Context, base: String): List<File> =
    dir(context).listFiles()?.filter { it.name.startsWith("$base.") } ?: emptyList()

  /**
   * Apaga o que venceu. Temporários órfãos (download interrompido) vencem em
   * 6 h; `activeBases` protege os downloads em andamento.
   */
  fun purgeExpired(context: Context, activeBases: Set<String> = emptySet()): List<String> {
    val now = System.currentTimeMillis()
    val ttl = retentionHours(context) * 3_600_000L
    val tempTtl = 6 * 3_600_000L
    val deleted = mutableListOf<String>()
    dir(context).listFiles()?.forEach { f ->
      if (!f.isFile) return@forEach
      if (activeBases.any { f.name.startsWith("$it.") }) return@forEach
      val age = now - f.lastModified()
      val expired = if (isTemp(f)) age > tempTtl else age > ttl
      if (expired && f.delete()) deleted.add(f.name)
    }
    return deleted
  }
}
