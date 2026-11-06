package expo.modules.readaloudaudio

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

// O áudio das leituras longas do "Leia para mim", gerado e montado fora do
// JavaScript (ver ReadAloudService e WavFiles).
class ReadAloudAudioModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ReadAloudAudio")
    Events("onJob")

    OnCreate {
      ReadAloudService.emitter = { e -> this@ReadAloudAudioModule.sendEvent("onJob", e) }
    }

    OnDestroy {
      ReadAloudService.emitter = null
    }

    // Pede o áudio completo de uma leitura. Se o mesmo pedido já está em andamento,
    // não começa outro (devolve false) — basta acompanhar pelo id.
    Function("startJob") { spec: Map<String, Any?> ->
      @Suppress("UNCHECKED_CAST")
      val chunks = (spec["chunks"] as? List<Any?>)?.mapNotNull { it as? String }?.filter { it.isNotBlank() }
        ?: throw IllegalArgumentException("sem texto")
      if (chunks.isEmpty()) throw IllegalArgumentException("sem texto")
      fun str(k: String) = (spec[k] as? String) ?: throw IllegalArgumentException("faltou $k")
      ReadAloudService.enqueue(
        context,
        ReadAloudJob(
          id = str("id"),
          chunks = chunks,
          model = str("model"),
          legacyModel = str("legacyModel"),
          voice = str("voice"),
          legacyVoice = str("legacyVoice"),
          interactions = spec["interactions"] as? Boolean ?: false,
          apiKey = str("apiKey"),
          outPath = str("outPath"),
          workDir = str("workDir"),
          tag = (spec["tag"] as? String) ?: "",
          title = (spec["title"] as? String) ?: "",
        ),
      )
    }

    Function("isActive") { id: String -> ReadAloudService.isActive(id) }

    Function("jobStatus") { id: String -> JobStore.get(context, id) }

    Function("jobs") { JobStore.all(context) }

    Function("forgetJob") { id: String -> JobStore.remove(context, id) }

    Function("cancelJob") { id: String -> ReadAloudService.cancel(context, id) }

    // Junta WAVs (os trechos da leitura progressiva) num WAV só, em disco.
    AsyncFunction("concatWav") { paths: List<String>, outPath: String ->
      WavFiles.concat(paths.map { File(it) }, File(outPath), raw = false).toDouble()
    }
  }
}
