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
    // Ler + re-agendar/remover como UMA operação: o módulo pode estar agendando
    // (sync do JS, em outra thread) neste mesmo instante — sem o lock, um dos dois
    // perdia a gravação do outro. Re-agenda o próximo dia já aqui (alarme exato é
    // one-shot); a ordem em relação ao start do serviço não importa.
    val alarm = synchronized(SpokenStore) {
      val a = SpokenStore.get(context, id)
      if (a != null) {
        if (a.repeatDaily) {
          // Próximo dia pela hora de PAREDE (não +24 h absolutas): fuso/horário
          // de verão não deslocam a fala.
          // Se o horário guardado já está no futuro, alguém (rearmAll no TIME_SET/
          // fuso, ou o sync do JS) já o avançou antes desta entrega: mantém e só
          // re-arma — pular de novo perderia a fala de amanhã.
          val now = System.currentTimeMillis()
          val next = if (a.atEpochMs > now + 60_000L) a.atEpochMs
            else SpokenScheduler.nextDailyFire(a, now, skipCurrent = true)
          SpokenStore.put(context, a.copy(atEpochMs = next))
          SpokenScheduler.arm(context, a.id, next)
        } else {
          SpokenStore.remove(context, a.id)
        }
      }
      a
    } ?: run {
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
  }
}
