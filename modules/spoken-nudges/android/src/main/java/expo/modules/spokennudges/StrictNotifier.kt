package expo.modules.spokennudges

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build

/**
 * As notificações dos hábitos rigorosos: uma por hábito, no canal próprio
 * "Hábitos rigorosos", com as TRÊS respostas — Fiz / Mais N min / Não vou fazer.
 * Tocar no corpo abre o app (na Home, onde o hábito está), mas NÃO cala: só uma
 * das três respostas (ou o hábito marcado no app) para a vibração.
 */
object StrictNotifier {
  const val CHANNEL_ID = "comentor-strict-v1"
  /** Notificação provisória do serviço, quando a insistência acabou antes de ele subir. */
  const val PLACEHOLDER_ID = 51999

  const val PARK_CAP =
    "Chamei por 45 minutos e parei de vibrar. Quando puder, me diga: fez, precisa de mais tempo ou hoje não?"
  const val PARK_SLEEP =
    "Hora de dormir: não vou vibrar. Quando puder, me diga como ficou."
  const val PARK_FAILED =
    "O Android não me deixou vibrar agora. Quando puder, me responda por aqui."

  /** Id estável da notificação de cada hábito (faixa própria, longe dos outros serviços). */
  fun idOf(key: String): Int = 52000 + (key.hashCode() and 0x0fff)

  /** "Mais tempo" cada vez menos generoso no mesmo dia: 30 → 10 → 5 min. */
  fun snoozeMinutes(usedToday: Int): Int = when (usedToday) {
    0 -> 30
    1 -> 10
    else -> 5
  }

  fun ensureChannel(ctx: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
    if (nm.getNotificationChannel(CHANNEL_ID) != null) return
    val ch = NotificationChannel(CHANNEL_ID, "Hábitos rigorosos", NotificationManager.IMPORTANCE_HIGH)
    ch.description =
      "Vibra em pulsos (vibra, para, vibra…) até você responder a um hábito marcado como rigoroso."
    // Sem som e sem a vibração do canal: quem vibra, em pulsos, é o serviço.
    ch.setSound(null, null)
    ch.enableVibration(false)
    ch.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    nm.createNotificationChannel(ch)
  }

  /** Dá para mostrar a notificação? Sem ela não há como responder — então nem vibra. */
  fun canNotify(ctx: Context): Boolean {
    return try {
      val nm = ctx.getSystemService(NotificationManager::class.java) ?: return false
      if (!nm.areNotificationsEnabled()) return false
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val ch = nm.getNotificationChannel(CHANNEL_ID)
        if (ch != null && ch.importance == NotificationManager.IMPORTANCE_NONE) return false
      }
      true
    } catch (_: Exception) {
      true
    }
  }

  /**
   * A frase da rodada. A primeira é o próprio lembrete; depois as frases do JS se
   * revezam, uma por rodada de pulsos. Voltando de um "Mais tempo", a primeira
   * avisa que o próximo adiamento é mais curto.
   */
  fun phrase(h: StrictHabit, round: Int, snoozesToday: Int): String {
    if (round <= 0) {
      if (snoozesToday > 0) {
        val next = snoozeMinutes(snoozesToday)
        return "Voltei, como combinado. ${h.body}".trim() +
          "\nSe precisar adiar de novo, agora são só $next min."
      }
      return h.body.ifBlank { h.title }
    }
    if (h.lines.isEmpty()) return h.body.ifBlank { h.title }
    return h.lines[(round - 1) % h.lines.size]
  }

  /** A notificação de uma insistência em curso (com cronômetro desde o início). */
  fun active(ctx: Context, h: StrictHabit, s: StrictSession, round: Int): Notification {
    val day = strictDayKey(System.currentTimeMillis())
    val snoozes = StrictStore.snoozeCount(ctx, h.key, day)
    val b = builder(ctx, h, phrase(h, round, snoozes), ongoing = true, snoozes = snoozes, day = s.day)
    // O cronômetro conta há quanto tempo ela está chamando — um empurrão discreto.
    b.setWhen(s.startedAt)
    b.setShowWhen(true)
    b.setUsesChronometer(true)
    // Arrastou para o lado (Android 14+ deixa): não é resposta — ela volta.
    b.setDeleteIntent(broadcast(ctx, StrictScheduler.ACTION_DISMISSED, h.key, null, s.day, mutable = false))
    return b.build()
  }

  /**
   * A notificação PARADA (teto, sono, serviço recusado): sem vibrar, ainda com as
   * respostas. `day` = dia do lembrete: respondida na manhã seguinte, vale para ele.
   */
  fun parked(ctx: Context, h: StrictHabit, why: String, day: String): Notification {
    val snoozes = StrictStore.snoozeCount(ctx, h.key, strictDayKey(System.currentTimeMillis()))
    return builder(ctx, h, why, ongoing = false, snoozes = snoozes, day = day).build()
  }

  fun postParked(ctx: Context, key: String, why: String, day: String) {
    val h = StrictStore.habit(ctx, key) ?: return
    try {
      ensureChannel(ctx)
      ctx.getSystemService(NotificationManager::class.java)?.notify(idOf(key), parked(ctx, h, why, day))
    } catch (_: Exception) {}
  }

  fun cancel(ctx: Context, key: String) {
    try {
      ctx.getSystemService(NotificationManager::class.java)?.cancel(idOf(key))
    } catch (_: Exception) {}
  }

  /** Provisória do serviço (startForeground precisa de uma notificação já). */
  fun placeholder(ctx: Context): Notification {
    ensureChannel(ctx)
    val b = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(ctx, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(ctx)
    }
    return b.setSmallIcon(ctx.applicationInfo.icon)
      .setContentTitle("Comentora")
      .setContentText("Hábito rigoroso…")
      .setOnlyAlertOnce(true)
      .build()
  }

  private fun builder(
    ctx: Context,
    h: StrictHabit,
    text: String,
    ongoing: Boolean,
    snoozes: Int,
    day: String,
  ): Notification.Builder {
    ensureChannel(ctx)
    val b = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(ctx, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(ctx).setPriority(Notification.PRIORITY_HIGH)
    }
    b.setSmallIcon(ctx.applicationInfo.icon)
      .setContentTitle(h.title.ifBlank { "Comentora" })
      .setContentText(text)
      .setStyle(Notification.BigTextStyle().bigText(text))
      .setSubText("Rigoroso")
      .setCategory(Notification.CATEGORY_REMINDER)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setColor(0xFFC2683B.toInt())
      // A troca de frase a cada rodada não repete o alerta: quem chama é a vibração.
      .setOnlyAlertOnce(true)
      .setOngoing(ongoing)
      .setAutoCancel(false)
    openApp(ctx, h.key)?.let { b.setContentIntent(it) }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    }
    for (a in actions(ctx, h.key, snoozeMinutes(snoozes), day)) b.addAction(a)
    return b
  }

  /**
   * As três respostas. "Não vou fazer" abre um campo com motivos prontos (um toque)
   * ou texto livre — o mesmo motivo que a cobrança final já pede ("Não fiz,
   * porque…"), que vira dado no histórico do hábito.
   */
  private fun actions(ctx: Context, key: String, snoozeMin: Int, day: String): List<Notification.Action> {
    val done = Notification.Action.Builder(
      Icon.createWithResource(ctx, android.R.drawable.checkbox_on_background),
      "Fiz ✅",
      broadcast(ctx, StrictScheduler.ACTION_DONE, key, null, day, mutable = false),
    ).build()
    val snooze = Notification.Action.Builder(
      Icon.createWithResource(ctx, android.R.drawable.ic_lock_idle_alarm),
      "Mais $snoozeMin min",
      broadcast(ctx, StrictScheduler.ACTION_SNOOZE, key, snoozeMin, day, mutable = false),
    ).build()
    val reason = RemoteInput.Builder(StrictScheduler.REMOTE_REASON)
      .setLabel("O que houve?")
      .setChoices(arrayOf<CharSequence>("Sem tempo hoje", "Sem energia", "Hoje não faz sentido"))
      .setAllowFreeFormInput(true)
      .build()
    val skip = Notification.Action.Builder(
      Icon.createWithResource(ctx, android.R.drawable.ic_menu_close_clear_cancel),
      "Não vou fazer",
      // RemoteInput: o PendingIntent precisa ser mutável para receber o texto.
      broadcast(ctx, StrictScheduler.ACTION_SKIP, key, null, day, mutable = true),
    ).addRemoteInput(reason).build()
    return listOf(done, snooze, skip)
  }

  private fun broadcast(
    ctx: Context,
    action: String,
    key: String,
    minutes: Int?,
    day: String,
    mutable: Boolean,
  ): PendingIntent {
    val short = action.substringAfterLast('_').lowercase()
    val intent = Intent(ctx.applicationContext, StrictReceiver::class.java).apply {
      this.action = action
      data = Uri.parse("strict://$short/${Uri.encode(key)}")
      putExtra(StrictScheduler.EXTRA_KEY, key)
      if (minutes != null) putExtra(StrictScheduler.EXTRA_MINUTES, minutes)
      putExtra(StrictScheduler.EXTRA_DAY, day)
    }
    val mutability = when {
      !mutable -> PendingIntent.FLAG_IMMUTABLE
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> PendingIntent.FLAG_MUTABLE
      else -> 0 // antes do Android 12, mutável é o padrão
    }
    return PendingIntent.getBroadcast(
      ctx.applicationContext,
      idOf(key),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or mutability,
    )
  }

  /** Abre o app na Home (askesis://comentora/…), onde o hábito está; senão, o app. */
  private fun openApp(ctx: Context, key: String): PendingIntent? {
    return try {
      val view = Intent(Intent.ACTION_VIEW, Uri.parse("askesis://comentora/habito/${Uri.encode(key)}"))
        .setPackage(ctx.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      val intent = if (view.resolveActivity(ctx.packageManager) != null) {
        view
      } else {
        ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return null
      }
      PendingIntent.getActivity(
        ctx.applicationContext,
        idOf(key),
        intent,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
    } catch (_: Exception) {
      null
    }
  }
}
