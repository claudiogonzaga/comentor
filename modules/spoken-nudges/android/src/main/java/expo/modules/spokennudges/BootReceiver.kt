package expo.modules.spokennudges

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/** Re-arma os alarmes falados após reboot, atualização do app ou mudança de fuso/horário. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_MY_PACKAGE_REPLACED,
      "android.intent.action.QUICKBOOT_POWERON" -> {
        Log.d(SpokenScheduler.TAG, "boot/replaced → rearmAll")
        SpokenScheduler.rearmAll(context)
      }
      // Mudou o fuso (viagem) ou o relógio: o epoch guardado de cada diário passou
      // a apontar para outra hora local. rearmAll recalcula pela hora de parede.
      Intent.ACTION_TIMEZONE_CHANGED,
      Intent.ACTION_TIME_CHANGED -> {
        Log.d(SpokenScheduler.TAG, "fuso/horário mudou → rearmAll")
        SpokenScheduler.rearmAll(context)
      }
    }
  }
}
