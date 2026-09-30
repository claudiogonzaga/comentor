package expo.modules.spokennudges

import android.app.AlarmManager
import android.app.AppOpsManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SpokenNudgesModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("SpokenNudges")

    Function("isExactAlarmAllowed") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        am.canScheduleExactAlarms()
      } else {
        true
      }
    }

    Function("openExactAlarmSettings") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val i = Intent(
          Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
          Uri.parse("package:" + context.packageName),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(i)
      }
    }

    Function("isIgnoringBatteryOptimizations") {
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    Function("requestIgnoreBatteryOptimizations") {
      val i = Intent(
        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
        Uri.parse("package:" + context.packageName),
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(i)
    }

    AsyncFunction("schedule") {
      id: String, atEpochMs: Double, audioPath: String,
      repeatDaily: Boolean, title: String, body: String ->
      SpokenScheduler.schedule(
        context, id, atEpochMs.toLong(), audioPath, repeatDaily, title, body,
      )
    }

    AsyncFunction("cancel") { id: String ->
      SpokenScheduler.cancel(context, id)
    }

    AsyncFunction("cancelAll") {
      SpokenScheduler.cancelAll(context)
    }

    Function("scheduledIds") {
      SpokenStore.all(context).map { it.id }
    }

    // Permite re-armar tudo no launch do app (belt-and-suspenders além do boot).
    AsyncFunction("rearmAll") {
      SpokenScheduler.rearmAll(context)
    }

    // "Só falar com fone": guarda a preferência onde o serviço nativo a lê na
    // hora do disparo (sem o JS rodar). O JS chama isto quando a config muda.
    Function("setHeadphonesOnly") { enabled: Boolean ->
      SpokenStore.setHeadphonesOnly(context, enabled)
    }

    // Estado AGORA: há fone conectado? (para a UI refletir/explicar).
    Function("isHeadphonesConnected") {
      headphonesConnected(context)
    }

    // Horário silencioso: guarda janela (minutos do dia) + dias (bitmask) onde os
    // avisos não falam. O serviço nativo lê no disparo.
    Function("setQuietHours") { enabled: Boolean, startMin: Int, endMin: Int, daysMask: Int ->
      SpokenStore.setQuiet(context, enabled, startMin, endMin, daysMask)
    }

    // Volume da voz dos nudges (0–1), barra da Home. O serviço aplica no WAV.
    Function("setNudgeVolume") { volume: Double ->
      SpokenStore.setNudgeVolume(context, volume.toFloat())
    }

    // Pausa (s) entre o canto da coruja e a fala. O serviço lê no disparo.
    Function("setOwlPauseSeconds") { seconds: Int ->
      SpokenStore.setOwlPauseSeconds(context, seconds)
    }

    // Último "Calar agora" (epoch ms) — a fala de primeiro plano confere depois da pausa.
    Function("getSilencedAt") {
      SpokenStore.getSilencedAt(context).toDouble()
    }

    // Acesso ao uso (PACKAGE_USAGE_STATS): concedido pelo usuário em
    // Configurações > Acesso ao uso. Base da fase 2 (coleta de uso do celular).
    Function("hasUsageAccess") {
      try {
        val aom = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          aom.unsafeCheckOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS,
            android.os.Process.myUid(),
            context.packageName,
          )
        } else {
          @Suppress("DEPRECATION")
          aom.checkOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS,
            android.os.Process.myUid(),
            context.packageName,
          )
        }
        if (mode == AppOpsManager.MODE_DEFAULT) {
          context.checkCallingOrSelfPermission(android.Manifest.permission.PACKAGE_USAGE_STATS) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
        } else {
          mode == AppOpsManager.MODE_ALLOWED
        }
      } catch (_: Exception) {
        false
      }
    }

    // Abre a tela "Acesso ao uso" já no app, quando o sistema aceita; senão a lista.
    Function("openUsageAccessSettings") {
      val direct = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).apply {
        data = Uri.fromParts("package", context.packageName, null)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      try {
        context.startActivity(direct)
      } catch (_: Exception) {
        try {
          context.startActivity(
            Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
          )
        } catch (_: Exception) {}
      }
    }

    // "Informações do app" — onde fica o menu ⋮ > "Permitir configurações
    // restritas", exigido quando o APK foi instalado por um gerenciador de
    // arquivos (Android 13+).
    Function("openAppDetails") {
      try {
        context.startActivity(
          Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.fromParts("package", context.packageName, null)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          },
        )
      } catch (_: Exception) {}
    }
  }
}
