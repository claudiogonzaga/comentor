package expo.modules.spokennudges

import android.app.AlarmManager
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
  }
}
