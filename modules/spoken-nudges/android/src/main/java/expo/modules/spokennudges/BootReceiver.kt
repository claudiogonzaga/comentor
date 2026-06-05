package expo.modules.spokennudges

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/** Re-arma os alarmes falados após reboot ou atualização do app. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_MY_PACKAGE_REPLACED,
      "android.intent.action.QUICKBOOT_POWERON" -> {
        Log.d(SpokenScheduler.TAG, "boot/replaced → rearmAll")
        SpokenScheduler.rearmAll(context)
      }
    }
  }
}
