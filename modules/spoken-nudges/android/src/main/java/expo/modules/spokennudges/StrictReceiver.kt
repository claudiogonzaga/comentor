package expo.modules.spokennudges

import android.app.RemoteInput
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Recebe os alarmes dos hábitos rigorosos (horário e fim do "Mais tempo") e os
 * botões da notificação (Fiz / Mais N min / Não vou fazer). Roda com o app
 * fechado: a resposta para a vibração aqui mesmo e fica guardada para o JS.
 */
class StrictReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val key = intent.getStringExtra(StrictScheduler.EXTRA_KEY) ?: return
    val ctx = context.applicationContext
    val day = intent.getStringExtra(StrictScheduler.EXTRA_DAY)
    try {
      when (intent.action) {
        StrictScheduler.ACTION_DAILY -> StrictScheduler.onFire(ctx, key, resume = false)
        StrictScheduler.ACTION_RESUME -> StrictScheduler.onFire(ctx, key, resume = true)
        StrictScheduler.ACTION_DONE -> StrictScheduler.answer(ctx, key, "done", 0, null, day)
        StrictScheduler.ACTION_SNOOZE -> StrictScheduler.answer(
          ctx,
          key,
          "snooze",
          intent.getIntExtra(StrictScheduler.EXTRA_MINUTES, 10),
          null,
          day,
        )
        StrictScheduler.ACTION_SKIP -> {
          val reason = RemoteInput.getResultsFromIntent(intent)
            ?.getCharSequence(StrictScheduler.REMOTE_REASON)
            ?.toString()
          StrictScheduler.answer(ctx, key, "skip", 0, reason, day)
        }
        // Arrastou a notificação para o lado: não é resposta. O serviço a republica.
        StrictScheduler.ACTION_DISMISSED -> StrictNudgeService.poke(ctx)
      }
    } catch (e: Exception) {
      Log.e(StrictScheduler.TAG, "falha em ${intent.action} ($key): ${e.message}")
    }
  }
}
