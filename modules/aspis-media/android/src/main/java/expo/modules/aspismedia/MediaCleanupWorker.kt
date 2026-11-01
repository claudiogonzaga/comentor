package expo.modules.aspismedia

import android.content.Context
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

// Apaga os arquivos vencidos a cada ~6 h pelo WorkManager — funciona com o
// app fechado, sem precisar do JS. (O app também limpa ao abrir.)
class MediaCleanupWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result {
    MediaFiles.purgeExpired(applicationContext, AspisMediaModule.activeBases())
    return Result.success()
  }

  companion object {
    private const val NAME = "aspis-media-cleanup"

    fun schedule(context: Context) {
      val request = PeriodicWorkRequestBuilder<MediaCleanupWorker>(6, TimeUnit.HOURS).build()
      WorkManager.getInstance(context)
        .enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, request)
    }
  }
}
