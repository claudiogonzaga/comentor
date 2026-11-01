package expo.modules.aspismedia

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

// Serviço em primeiro plano ("Aspis está transcrevendo…") enquanto a fila de
// transcrição automática trabalha: impede o Android de congelar o app quando a
// tela apaga. Só roda enquanto há trabalho; o JS liga e desliga.
class WorkService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Preparando…"
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
    } else {
      0
    }
    runCatching { ServiceCompat.startForeground(this, NOTIFICATION_ID, build(this, text), type) }
      .onFailure { stopSelf() }
    return START_NOT_STICKY
  }

  // Android 15: dataSync tem teto diário; ao estourar, só encerra.
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopSelf()
  }

  companion object {
    private const val CHANNEL = "aspis-work"
    private const val NOTIFICATION_ID = 7071
    private const val EXTRA_TEXT = "text"

    private fun build(context: Context, text: String): Notification {
      val nm = context.getSystemService(NotificationManager::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
        nm.createNotificationChannel(
          NotificationChannel(CHANNEL, "Transcrição em segundo plano", NotificationManager.IMPORTANCE_LOW),
        )
      }
      val open = context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
        android.app.PendingIntent.getActivity(
          context, 0, it,
          android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT,
        )
      }
      return NotificationCompat.Builder(context, CHANNEL)
        .setSmallIcon(android.R.drawable.stat_sys_download)
        .setContentTitle("Aspis está transcrevendo")
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(open)
        .build()
    }

    fun start(context: Context, text: String) {
      val intent = Intent(context, WorkService::class.java).putExtra(EXTRA_TEXT, text)
      // Android 12+: só pode iniciar com o app visível — se não der, segue sem.
      runCatching {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
        else context.startService(intent)
      }
    }

    fun update(context: Context, text: String) {
      runCatching {
        context.getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, build(context, text))
      }
    }

    fun stop(context: Context) {
      runCatching { context.stopService(Intent(context, WorkService::class.java)) }
    }
  }
}
