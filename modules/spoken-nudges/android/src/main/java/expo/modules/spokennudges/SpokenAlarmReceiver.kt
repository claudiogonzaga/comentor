package expo.modules.spokennudges

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * Dispara quando o alarme exato toca (mesmo com app fechado). Inicia o
 * foreground service que reproduz o áudio e re-agenda o próximo dia se diário.
 */
class SpokenAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra(SpokenScheduler.EXTRA_ID) ?: return
    val alarm = SpokenStore.get(context, id) ?: run {
      Log.w(SpokenScheduler.TAG, "fire for unknown id=$id")
      return
    }
    Log.d(SpokenScheduler.TAG, "FIRE id=$id audio=${alarm.audioPath}")

    val svc = Intent(context.applicationContext, SpokenSpeechService::class.java).apply {
      putExtra("id", alarm.id)
      putExtra("audioPath", alarm.audioPath)
      putExtra("title", alarm.title)
      putExtra("body", alarm.body)
    }
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.applicationContext.startForegroundService(svc)
      } else {
        context.applicationContext.startService(svc)
      }
    } catch (e: Exception) {
      Log.e(SpokenScheduler.TAG, "failed to start service: ${e.message}")
    }

    // Re-agenda próximo dia (alarme exato é one-shot).
    if (alarm.repeatDaily) {
      val next = alarm.atEpochMs + 24L * 60 * 60 * 1000
      SpokenStore.put(context, alarm.copy(atEpochMs = next))
      SpokenScheduler.arm(context, alarm.id, next)
    } else {
      SpokenStore.remove(context, alarm.id)
    }
  }
}
