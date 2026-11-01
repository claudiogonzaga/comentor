package expo.modules.aspismedia

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.Collections
import java.util.concurrent.Executors
import java.util.concurrent.locks.ReentrantReadWriteLock
import kotlin.concurrent.read
import kotlin.concurrent.write

// Baixa o áudio ou o vídeo de um vídeo do YouTube para o armazenamento privado
// do app (yt-dlp embarcado), para tocar DENTRO do Aspis — nunca no app do
// YouTube. Os arquivos são temporários: vencem conforme a retenção escolhida.
class AspisMediaModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("AspisMedia")
    Events("onProgress", "onModelProgress", "onTranscribeProgress")

    OnCreate {
      appContext.reactContext?.applicationContext?.let { ctx ->
        runCatching { MediaCleanupWorker.schedule(ctx) }
      }
    }

    Function("list") {
      MediaFiles.completed(context).map(::describe)
    }

    Function("getRetentionHours") {
      MediaFiles.retentionHours(context)
    }

    Function("setRetentionHours") { hours: Int ->
      MediaFiles.setRetentionHours(context, hours)
    }

    Function("purgeExpired") {
      MediaFiles.purgeExpired(context, activeBases())
    }

    Function("delete") { base: String ->
      MediaFiles.allFor(context, base).count { it.delete() }
    }

    Function("deleteAll") {
      MediaFiles.dir(context).listFiles()
        ?.filter { f -> active.none { f.name.startsWith("$it.") } }
        ?.count { it.delete() } ?: 0
    }

    // url: link do vídeo; kind: "audio" | "video"; base: "<videoId>.<kind>"
    AsyncFunction("download") { url: String, kind: String, base: String, promise: Promise ->
      executor.execute { runDownload(url, kind, base, promise) }
    }

    Function("cancel") { base: String ->
      YoutubeDL.destroyProcessById(base)
    }

    // Atualiza o yt-dlp para a última versão estável (o YouTube muda com
    // frequência; o binário que vem no APK envelhece).
    AsyncFunction("updateEngine") { promise: Promise ->
      executor.execute {
        try {
          ensureInit()
          val status = engineLock.write { YoutubeDL.updateYoutubeDL(context) }
          promise.resolve(
            mapOf(
              "status" to (status?.name ?: "UNKNOWN"),
              "version" to YoutubeDL.versionName(context),
            ),
          )
        } catch (e: Throwable) {
          promise.reject("E_UPDATE", e.message ?: "Falha ao atualizar o yt-dlp", e)
        }
      }
    }

    Function("engineVersion") {
      runCatching { YoutubeDL.versionName(context) }.getOrNull()
    }

    // --- Transcrição no celular (Parakeet) ------------------------------------

    Function("modelStatus") {
      mapOf(
        "installed" to ParakeetModel.isInstalled(context),
        "downloadedBytes" to ParakeetModel.downloadedBytes(context).toDouble(),
        "totalBytes" to ParakeetModel.TOTAL_BYTES.toDouble(),
        "downloading" to modelDownloading,
      )
    }

    AsyncFunction("downloadModel") { promise: Promise ->
      if (modelDownloading) {
        promise.reject("E_BUSY", "O modelo já está sendo baixado.", null)
      } else {
        modelDownloading = true
        val ctx = context
        executor.execute {
          try {
            ParakeetModel.download(ctx) { got, total ->
              sendEvent("onModelProgress", mapOf("received" to got.toDouble(), "total" to total.toDouble()))
            }
            promise.resolve(true)
          } catch (e: ParakeetModel.Canceled) {
            promise.reject("E_CANCELED", e.message, e)
          } catch (e: Throwable) {
            promise.reject("E_MODEL", e.message ?: "Falha ao baixar o modelo", e)
          } finally {
            modelDownloading = false
          }
        }
      }
    }

    Function("cancelModelDownload") {
      ParakeetModel.cancelRequested = true
    }

    Function("deleteModel") {
      Transcriber.release()
      ParakeetModel.delete(context)
    }

    // Transcreve um arquivo de áudio local (file://). Um por vez; devolve
    // trechos {start, end, text} em segundos.
    AsyncFunction("transcribe") { uri: String, id: String, promise: Promise ->
      val ctx = context
      executor.execute {
        try {
          val path = Uri.parse(uri).path ?: uri
          ensureInit() // ffmpeg descompactado
          val segments = Transcriber.transcribe(ctx, path, id) { p ->
            sendEvent("onTranscribeProgress", mapOf("id" to id, "progress" to p))
          }
          promise.resolve(
            segments.map { mapOf("start" to it.start, "end" to it.end, "text" to it.text) },
          )
        } catch (e: Transcriber.Canceled) {
          promise.reject("E_CANCELED", e.message, e)
        } catch (e: Throwable) {
          promise.reject("E_TRANSCRIBE", e.message ?: "Falha na transcrição", e)
        }
      }
    }

    Function("cancelTranscription") { id: String ->
      Transcriber.cancel(id)
    }

    // Libera ~1 GB de RAM do modelo quando a fila esvazia.
    Function("releaseModel") {
      executor.execute { Transcriber.release() }
    }

    Function("startKeepAlive") { text: String ->
      keepAlive = true
      WorkService.start(context, text)
    }

    Function("updateKeepAlive") { text: String ->
      if (keepAlive) WorkService.update(context, text)
    }

    Function("stopKeepAlive") {
      keepAlive = false
      WorkService.stop(context)
    }

    // Wi-Fi (ou outra rede sem cobrança por dados) — o pré-download só roda
    // nela por padrão, para não gastar a franquia do celular.
    Function("isUnmeteredNetwork") {
      val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      cm.getNetworkCapabilities(cm.activeNetwork)
        ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == true
    }
  }

  private fun runDownload(url: String, kind: String, base: String, promise: Promise) {
    if (!active.add(base)) {
      promise.reject("E_BUSY", "Esse download já está em andamento.", null)
      return
    }
    val ctx = context
    try {
      ensureInit()
      MediaFiles.allFor(ctx, base).forEach { it.delete() } // restos de tentativas

      val request = YoutubeDLRequest(url).apply {
        addOption("--no-playlist")
        addOption("--no-mtime") // mtime = hora do download (base da retenção)
        addOption("--newline")
        addOption("--concurrent-fragments", "4")
        addOption("-o", File(MediaFiles.dir(ctx), "$base.%(ext)s").absolutePath)
        if (kind == "audio") {
          // m4a (AAC) toca em qualquer player; opus/webm como reserva.
          addOption("-f", "bestaudio[ext=m4a]/bestaudio/best")
        } else {
          // Até 720p: boa imagem num celular sem gastar gigabytes.
          addOption(
            "-f",
            "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/" +
              "bv*[height<=720]+ba/b[height<=720]/b",
          )
          addOption("--merge-output-format", "mp4")
        }
      }

      // Vídeo em DASH baixa duas faixas (imagem, depois som) e cada uma vai de
      // 0 a 100% — agrega numa barra só (imagem pesa ~85%).
      var pass = 0
      var last = 0f
      engineLock.read {
        YoutubeDL.execute(request, base, false) { progress, eta, _ ->
          if (progress < 0) return@execute
          if (progress + 50 < last) pass++
          last = progress
          val overall = when {
            kind == "audio" -> progress
            pass == 0 -> progress * 0.85f
            else -> 85f + progress * 0.15f
          }
          sendEvent(
            "onProgress",
            mapOf("base" to base, "progress" to overall.toDouble(), "eta" to eta),
          )
        }
      }

      val file = MediaFiles.allFor(ctx, base)
        .filter { !MediaFiles.isTemp(it) }
        .maxByOrNull { it.length() }
        ?: throw IllegalStateException("O yt-dlp terminou, mas o arquivo não apareceu.")
      file.setLastModified(System.currentTimeMillis())
      promise.resolve(describe(file))
    } catch (e: YoutubeDL.CanceledException) {
      MediaFiles.allFor(ctx, base).forEach { it.delete() }
      promise.reject("E_CANCELED", "Download cancelado.", e)
    } catch (e: Throwable) {
      MediaFiles.allFor(ctx, base).forEach { it.delete() }
      promise.reject("E_DOWNLOAD", friendlyError(e), e)
    } finally {
      active.remove(base)
    }
  }

  private fun describe(f: File): Map<String, Any?> = mapOf(
    "name" to f.name,
    "uri" to Uri.fromFile(f).toString(),
    "size" to f.length().toDouble(),
    "downloadedAt" to f.lastModified().toDouble(),
  )

  // Da saída do yt-dlp, só a última linha "ERROR: ..." interessa ao usuário.
  private fun friendlyError(e: Throwable): String {
    val raw = e.message ?: e.toString()
    val line = raw.lines().lastOrNull { it.startsWith("ERROR:") } ?: raw.lines().lastOrNull { it.isNotBlank() }
    return (line ?: raw).removePrefix("ERROR:").trim().take(400)
  }

  private fun ensureInit() {
    synchronized(initLock) {
      if (initialized) return
      // Primeira vez: descompacta o Python (~alguns segundos).
      YoutubeDL.init(context)
      FFmpeg.init(context)
      initialized = true
    }
  }

  companion object {
    private val executor = Executors.newCachedThreadPool()
    private val engineLock = ReentrantReadWriteLock()
    private val initLock = Any()
    @Volatile private var initialized = false
    @Volatile private var modelDownloading = false
    @Volatile private var keepAlive = false
    private val active: MutableSet<String> = Collections.synchronizedSet(mutableSetOf())

    fun activeBases(): Set<String> = synchronized(active) { active.toSet() }
  }
}
