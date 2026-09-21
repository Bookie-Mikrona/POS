package si.bookie.fiscal

import android.content.Context
import android.app.NotificationChannel
import android.app.NotificationManager
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

class FiscalSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val server = BookieFiscalHttpServer(applicationContext)
        return try {
            val completed = server.syncOnce()
            notifyDeadline(server.overdueSyncCount())
            if (completed) Result.success() else Result.retry()
        } catch (_: Exception) {
            Result.retry()
        } finally {
            server.close()
        }
    }

    private fun notifyDeadline(count: Int) {
        if (count <= 0) return
        val manager = applicationContext.getSystemService(NotificationManager::class.java)
        val channel = "bookie_fiscal_deadlines"
        manager.createNotificationChannel(NotificationChannel(channel, "Fiskalni roki",
            NotificationManager.IMPORTANCE_HIGH))
        val notification = android.app.Notification.Builder(applicationContext, channel)
            .setSmallIcon(android.R.drawable.stat_notify_error)
            .setContentTitle("Fiskalna sinhronizacija zahteva ukrep")
            .setContentText("$count računov je doseglo rok dveh delovnih dni.")
            .setAutoCancel(true).build()
        manager.notify(17831, notification)
    }

    companion object {
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<FiscalSyncWorker>(15, TimeUnit.MINUTES).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                "bookie-fiscal-sync-v1", ExistingPeriodicWorkPolicy.UPDATE, request)
        }
    }
}