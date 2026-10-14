package expo.modules.spokennudges

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import java.util.Calendar
import kotlin.math.abs

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
    // Store + AlarmManager como uma operação só (o receiver mexe nos dois na main).
    synchronized(SpokenStore) {
      var fireAt = atEpochMs
      // Diário: guarda a hora de PAREDE pedida (o JS calcula o epoch no fuso local)
      // para recalcular depois de uma mudança de fuso/horário.
      var hour = -1
      var minute = -1
      if (repeatDaily) {
        val now = System.currentTimeMillis()
        while (fireAt <= now) fireAt += DAY_MS
        val cal = Calendar.getInstance()
        cal.timeInMillis = atEpochMs
        hour = cal.get(Calendar.HOUR_OF_DAY)
        minute = cal.get(Calendar.MINUTE)
      }
      SpokenStore.put(
        ctx,
        SpokenAlarm(id, fireAt, audioPath, repeatDaily, title, body, hour, minute),
      )
      arm(ctx, id, fireAt)
      Log.d(TAG, "scheduled id=$id at=$fireAt repeatDaily=$repeatDaily audio=$audioPath")
    }
  }

  /**
   * Próximo disparo de um alarme DIÁRIO, estritamente depois de `now`. Com a hora
   * de parede conhecida, anda por DIAS DE CALENDÁRIO, não por 24 h absolutas:
   * viagem entre fusos ou horário de verão não deslocam a fala em relação à
   * notificação diária do expo (que é por hora de parede).
   * `skipCurrent` = o disparo guardado acabou de tocar; o próximo é no dia seguinte.
   */
  fun nextDailyFire(a: SpokenAlarm, now: Long, skipCurrent: Boolean): Long {
    if (a.hour !in 0..23 || a.minute !in 0..59) {
      // Alarme gravado antes de existir a hora de parede: soma 24 h, como antes.
      var t = a.atEpochMs
      if (skipCurrent) t += DAY_MS
      while (t <= now) t += DAY_MS
      return t
    }
    val cal = Calendar.getInstance()
    cal.timeInMillis = a.atEpochMs
    cal.set(Calendar.HOUR_OF_DAY, a.hour)
    cal.set(Calendar.MINUTE, a.minute)
    cal.set(Calendar.SECOND, 0)
    cal.set(Calendar.MILLISECOND, 0)
    // Depois de mudar o fuso, o "mesmo dia" do epoch guardado pode cair na véspera
    // ou no dia seguinte do relógio local: fica com a ocorrência mais próxima dele.
    // Sem mudança de fuso, é o próprio epoch guardado (diferença zero).
    var best = cal.timeInMillis
    for (d in intArrayOf(-1, 1)) {
      val c = cal.clone() as Calendar
      c.add(Calendar.DAY_OF_YEAR, d)
      if (abs(c.timeInMillis - a.atEpochMs) < abs(best - a.atEpochMs)) best = c.timeInMillis
    }
    cal.timeInMillis = best
    if (skipCurrent) cal.add(Calendar.DAY_OF_YEAR, 1)
    while (cal.timeInMillis <= now) cal.add(Calendar.DAY_OF_YEAR, 1)
    return cal.timeInMillis
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
    synchronized(SpokenStore) {
      val am = ctx.applicationContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      am.cancel(pendingIntent(ctx, id))
      SpokenStore.remove(ctx, id)
      Log.d(TAG, "cancelled id=$id")
    }
  }

  fun cancelAll(ctx: Context) {
    synchronized(SpokenStore) {
      val am = ctx.applicationContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      for (a in SpokenStore.all(ctx)) am.cancel(pendingIntent(ctx, a.id))
      SpokenStore.clear(ctx)
      Log.d(TAG, "cancelled all")
    }
  }

  /**
   * Re-arma tudo que está no store (chamado no boot, no launch do app e quando o
   * fuso/horário muda — aí o diário é recalculado pela hora de parede).
   */
  fun rearmAll(ctx: Context) {
    synchronized(SpokenStore) {
      val now = System.currentTimeMillis()
      for (a in SpokenStore.all(ctx)) {
        var fireAt = a.atEpochMs
        if (a.repeatDaily) {
          fireAt = nextDailyFire(a, now, skipCurrent = false)
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
}
