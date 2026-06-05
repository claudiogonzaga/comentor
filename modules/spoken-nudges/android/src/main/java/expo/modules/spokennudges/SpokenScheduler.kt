package expo.modules.spokennudges

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log

/** Arma/cancela alarmes exatos que disparam o SpokenAlarmReceiver. */
object SpokenScheduler {
  const val TAG = "SpokenNudges"
  const val ACTION_FIRE = "expo.modules.spokennudges.FIRE"
  const val EXTRA_ID = "id"
  private const val DAY_MS = 24L * 60 * 60 * 1000

  private fun pendingIntent(ctx: Context, id: String): PendingIntent {
    val intent = Intent(ctx.applicationContext, SpokenAlarmReceiver::class.java).apply {
      action = ACTION_FIRE
      // data único por id => PendingIntents distintos (extras não contam p/ matching)
      data = Uri.parse("spoken://$id")
      putExtra(EXTRA_ID, id)
    }
    var flags = PendingIntent.FLAG_UPDATE_CURRENT
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      flags = flags or PendingIntent.FLAG_IMMUTABLE
    }
    return PendingIntent.getBroadcast(ctx.applicationContext, 0, intent, flags)
  }

  fun schedule(
    ctx: Context,
    id: String,
    atEpochMs: Long,
    audioPath: String,
    repeatDaily: Boolean,
    title: String,
    body: String,
  ) {
    var fireAt = atEpochMs
    if (repeatDaily) {
      val now = System.currentTimeMillis()
      while (fireAt <= now) fireAt += DAY_MS
    }
    SpokenStore.put(ctx, SpokenAlarm(id, fireAt, audioPath, repeatDaily, title, body))
    arm(ctx, id, fireAt)
    Log.d(TAG, "scheduled id=$id at=$fireAt repeatDaily=$repeatDaily audio=$audioPath")
  }

  fun arm(ctx: Context, id: String, fireAt: Long) {
    val am = ctx.applicationContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pi = pendingIntent(ctx, id)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, fireAt, pi)
      } else {
        am.setExact(AlarmManager.RTC_WAKEUP, fireAt, pi)
      }
    } catch (e: SecurityException) {
      // Sem permissão de alarme exato (Android 12+): cai para inexato.
      Log.w(TAG, "exact alarm denied, using inexact: ${e.message}")
      am.set(AlarmManager.RTC_WAKEUP, fireAt, pi)
    }
  }

  fun cancel(ctx: Context, id: String) {
    val am = ctx.applicationContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    am.cancel(pendingIntent(ctx, id))
    SpokenStore.remove(ctx, id)
    Log.d(TAG, "cancelled id=$id")
  }

  fun cancelAll(ctx: Context) {
    val am = ctx.applicationContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    for (a in SpokenStore.all(ctx)) am.cancel(pendingIntent(ctx, a.id))
    SpokenStore.clear(ctx)
    Log.d(TAG, "cancelled all")
  }

  /** Re-arma tudo que está no store (chamado no boot e no launch do app). */
  fun rearmAll(ctx: Context) {
    val now = System.currentTimeMillis()
    for (a in SpokenStore.all(ctx)) {
      var fireAt = a.atEpochMs
      if (a.repeatDaily) {
        while (fireAt <= now) fireAt += DAY_MS
        if (fireAt != a.atEpochMs) SpokenStore.put(ctx, a.copy(atEpochMs = fireAt))
        arm(ctx, a.id, fireAt)
      } else if (fireAt > now) {
        arm(ctx, a.id, fireAt)
      } else {
        // one-shot já passou: descarta
        SpokenStore.remove(ctx, a.id)
      }
    }
    Log.d(TAG, "rearmAll done")
  }
}
