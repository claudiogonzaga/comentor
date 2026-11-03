package expo.modules.kinesistimer

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class KinesisTimerModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("KinesisTimer")

    // Linha do tempo do timer: {current, events}. Substitui a anterior.
    Function("arm") { json: String ->
      KinesisEngine.arm(context, json)
    }

    Function("disarm") {
      KinesisEngine.disarm(context)
    }

    // Som na hora: prévia nas configurações e o sino dos toques (EXERCITEI etc.).
    Function("play") { sound: String ->
      KinesisPlayer.play(context, sound)
    }

    Function("setVolume") { volume: Double ->
      KinesisEngine.setVolume(context, volume.toFloat())
    }
  }
}
