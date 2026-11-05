package expo.modules.spokennudges

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

/** Avisa o JS (se estiver vivo e ouvindo) que há resposta rigorosa na fila. */
object StrictEvents {
  @Volatile var listener: (() -> Unit)? = null

  fun emit() {
    try {
      listener?.invoke()
    } catch (e: Exception) {
      Log.w(StrictScheduler.TAG, "evento para o JS falhou: ${e.message}")
    }
  }
}

/**
 * HÁBITOS RIGOROSOS: alarmes exatos no horário de cada hábito (por hora de
 * parede, nos dias ativos) e no fim de cada "Mais tempo". O alarme abre uma
 * insistência (StrictNudgeService): vibra, para, vibra… até a resposta.
 *
 * Quem decide o que é rigoroso e o que já foi respondido é o JS
 * (strictHabits.ts); aqui fica o que precisa funcionar sem ele: disparar, parar
 * com a resposta da notificação e guardá-la para o JS marcar o hábito.
 */
object StrictScheduler {
  const val TAG = "StrictHabits"

  /** Teto de uma insistência contínua: depois disso para de vibrar e deixa a notificação. */
  const val CAP_MS = 45 * 60_000L

  /** Alarme que chegou atrasado demais (aparelho em Doze sem alarme exato): não insiste. */
  private const val STALE_MS = 3 * 60 * 60_000L

  const val ACTION_DAILY = "expo.modules.spokennudges.STRICT_DAILY"
  const val ACTION_RESUME = "expo.modules.spokennudges.STRICT_RESUME"
  const val ACTION_DONE = "expo.modules.spokennudges.STRICT_DONE"
  const val ACTION_SNOOZE = "expo.modules.spokennudges.STRICT_SNOOZE"
  const val ACTION_SKIP = "expo.modules.spokennudges.STRICT_SKIP"
  const val ACTION_DISMISSED = "expo.modules.spokennudges.STRICT_DISMISSED"
  const val EXTRA_KEY = "key"
  const val EXTRA_MINUTES = "minutes"
  /** Dia (yyyy-MM-dd) do lembrete a que a notificação pertence. */
  const val EXTRA_DAY = "day"
  /** Chave do campo de texto (RemoteInput) do "Não vou fazer". */
  const val REMOTE_REASON = "reason"

  // ---- alarmes ----

  private fun alarmIntent(ctx: Context, key: String, action: String): PendingIntent {
    val short = if (action == ACTION_RESUME) "resume" else "daily"
    val intent = Intent(ctx.applicationContext, StrictReceiver::class.java).apply {
      this.action = action
      // data único por hábito e tipo: PendingIntents distintos (extras não contam).
      data = Uri.parse("strict://$short/${Uri.encode(key)}")
      putExtra(EXTRA_KEY, key)
    }
    return PendingIntent.getBroadcast(
      ctx.applicationContext,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun setExact(ctx: Context, at: Long, pi: PendingIntent) {
    val am = ctx.applicationContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    try {
      am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    } catch (e: SecurityException) {
      // Sem "Alarmes e lembretes" (Android 12+): inexato — pode atrasar.
      Log.w(TAG, "alarme exato negado, usando inexato: ${e.message}")
      am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    }
  }

  private fun cancelAlarm(ctx: Context, key: String, action: String) {
    val am = ctx.applicationContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    am.cancel(alarmIntent(ctx, key, action))
  }

  /**
   * Próximo horário do hábito estritamente depois de `now`, num dia ativo que não
   * seja o já respondido (skipDay). Anda por dias de CALENDÁRIO (hora de parede):
   * fuso e horário de verão não deslocam. -1 = nenhum dia ativo.
   */
  fun nextDailyFire(h: StrictHabit, now: Long): Long {
    if (h.hour !in 0..23 || h.minute !in 0..59 || (h.days and 0x7f) == 0) return -1
    val c = Calendar.getInstance()
    c.timeInMillis = now
    c.set(Calendar.HOUR_OF_DAY, h.hour)
    c.set(Calendar.MINUTE, h.minute)
    c.set(Calendar.SECOND, 0)
    c.set(Calendar.MILLISECOND, 0)
    for (i in 0..8) {
      if (c.timeInMillis > now) {
        val dow = c.get(Calendar.DAY_OF_WEEK) - 1 // Calendar: domingo=1 → 0
        if ((h.days shr dow) and 1 == 1 && strictDayKey(c.timeInMillis) != h.skipDay) {
          return c.timeInMillis
        }
      }
      c.add(Calendar.DAY_OF_YEAR, 1)
    }
    return -1
  }

  private fun armDaily(ctx: Context, h: StrictHabit) {
    val at = nextDailyFire(h, System.currentTimeMillis())
    if (at < 0) {
      cancelAlarm(ctx, h.key, ACTION_DAILY)
      return
    }
    setExact(ctx, at, alarmIntent(ctx, h.key, ACTION_DAILY))
  }

  private fun armResume(ctx: Context, h: StrictHabit) {
    if (h.resumeAt > System.currentTimeMillis()) {
      setExact(ctx, h.resumeAt, alarmIntent(ctx, h.key, ACTION_RESUME))
    } else {
      cancelAlarm(ctx, h.key, ACTION_RESUME)
    }
  }

  // ---- lista vinda do JS ----

  /**
   * Substitui os hábitos rigorosos de uma fonte ("nudge"/"med") pela lista do JS
   * e re-arma os alarmes. Hábito que saiu (desligado, excluído, deixou de ser
   * rigoroso, modo silencioso) para de insistir na hora.
   */
  fun sync(ctx: Context, source: String, json: String) {
    synchronized(StrictStore) {
      val now = System.currentTimeMillis()
      val today = strictDayKey(now)
      val incoming = try {
        val arr = JSONArray(json)
        (0 until arr.length()).mapNotNull { StrictStore.parseHabit(arr.optJSONObject(it), source) }
      } catch (e: Exception) {
        Log.w(TAG, "lista ilegível: ${e.message}")
        return
      }
      val old = StrictStore.habits(ctx)
      val merged = incoming.map { inc ->
        val prev = old.firstOrNull { it.key == inc.key }
        // Respondido hoje: nada de adiamento pendente. Senão, um "Mais tempo" dado
        // na notificação que o JS ainda não leu (app fechado) não pode ser apagado
        // por esta passada — fica o mais tardio dos dois.
        val resume = when {
          inc.skipDay == today -> 0L
          prev != null && prev.resumeAt > now && prev.resumeAt > inc.resumeAt -> prev.resumeAt
          inc.resumeAt > now -> inc.resumeAt
          else -> 0L
        }
        inc.copy(resumeAt = resume)
      }
      val gone = old.filter { o -> o.source == source && merged.none { it.key == o.key } }
      StrictStore.saveHabits(ctx, old.filter { it.source != source } + merged)
      for (g in gone) {
        cancelAlarm(ctx, g.key, ACTION_DAILY)
        cancelAlarm(ctx, g.key, ACTION_RESUME)
        if (StrictStore.session(ctx, g.key) != null) StrictStore.endSession(ctx, g.key)
        StrictNotifier.cancel(ctx, g.key)
      }
      for (h in merged) {
        armDaily(ctx, h)
        armResume(ctx, h)
        // Respondido hoje no app ou no Mac: a insistência de hoje acaba.
        val s = StrictStore.session(ctx, h.key)
        if (h.skipDay == today && s != null && s.day == today) {
          StrictStore.endSession(ctx, h.key)
          StrictNotifier.cancel(ctx, h.key)
        }
      }
    }
    StrictNudgeService.poke(ctx)
  }

  /**
   * Re-arma tudo (boot, atualização do app, mudança de fuso/relógio). No boot e na
   * atualização (`restartSessions`) o serviço morreu: a insistência que ainda
   * estava dentro do teto volta; a que já passou dele sai sem alarde.
   */
  fun rearmAll(ctx: Context, restartSessions: Boolean) {
    var resume = false
    synchronized(StrictStore) {
      val now = System.currentTimeMillis()
      if (restartSessions) {
        for (s in StrictStore.sessions(ctx)) {
          if (now - s.startedAt >= CAP_MS || StrictStore.habit(ctx, s.key) == null) {
            StrictStore.endSession(ctx, s.key)
          }
        }
        resume = StrictStore.sessions(ctx).isNotEmpty()
      }
      for (h in StrictStore.habits(ctx)) {
        var cur = h
        // Adiamento que venceu com o aparelho desligado: não insiste atrasado.
        if (cur.resumeAt in 1L..now) {
          cur = cur.copy(resumeAt = 0L)
          StrictStore.putHabit(ctx, cur)
        }
        armDaily(ctx, cur)
        armResume(ctx, cur)
      }
    }
    if (resume) StrictNudgeService.start(ctx) else StrictNudgeService.poke(ctx)
    Log.d(TAG, "rearmAll (restartSessions=$restartSessions, resume=$resume)")
  }

  // ---- disparo ----

  /** O alarme tocou: começa a insistir (se ainda fizer sentido). */
  fun onFire(ctx: Context, key: String, resume: Boolean) {
    val now = System.currentTimeMillis()
    val today = strictDayKey(now)
    val h = synchronized(StrictStore) {
      val cur = StrictStore.habit(ctx, key) ?: return
      if (resume) {
        StrictStore.putHabit(ctx, cur.copy(resumeAt = 0L))
      } else {
        armDaily(ctx, cur) // o alarme exato é de uma vez só: já arma o próximo
      }
      cur
    }
    if (!resume) {
      if (h.skipDay == today) return
      val c = Calendar.getInstance()
      c.timeInMillis = now
      if ((h.days shr (c.get(Calendar.DAY_OF_WEEK) - 1)) and 1 == 0) return
      c.set(Calendar.HOUR_OF_DAY, h.hour)
      c.set(Calendar.MINUTE, h.minute)
      c.set(Calendar.SECOND, 0)
      c.set(Calendar.MILLISECOND, 0)
      if (now - c.timeInMillis > STALE_MS) {
        Log.d(TAG, "alarme de $key chegou atrasado demais — não insiste")
        return
      }
      // Adiado para depois: quem chama é o fim do adiamento.
      if (h.resumeAt > now) return
    }
    if (StrictStore.session(ctx, key) != null) return // já está insistindo
    StrictNotifier.ensureChannel(ctx)
    if (!StrictNotifier.canNotify(ctx)) {
      // Sem notificação não há como responder: vibrar seria só incomodar.
      Log.w(TAG, "notificações bloqueadas — $key não insiste")
      return
    }
    if (StrictStore.inSleepWindow(ctx, now)) {
      // Hora de dormir: não vibra. Fica a notificação, para responder de manhã.
      StrictNotifier.postParked(ctx, key, StrictNotifier.PARK_SLEEP, today)
      return
    }
    if (!StrictStore.beginSession(ctx, key, now, today)) return
    Log.d(TAG, "começa a insistir: $key (resume=$resume)")
    StrictNudgeService.start(ctx)
  }

  /** O Android recusou o serviço: encerra as insistências e deixa as notificações paradas. */
  fun parkAll(ctx: Context, why: String) {
    val ended = synchronized(StrictStore) {
      val ss = StrictStore.sessions(ctx)
      for (s in ss) StrictStore.endSession(ctx, s.key)
      ss
    }
    for (s in ended) StrictNotifier.postParked(ctx, s.key, why, s.day)
  }

  // ---- respostas ----

  /**
   * Resposta tocada na notificação: "done", "skip" ou "snooze". Para a vibração
   * AGORA, guarda a resposta para o JS (marcar feito/pulado/adiado, sincronizar
   * com o Mac) e cala a voz das cobranças que ela torna sem sentido.
   */
  fun answer(ctx: Context, key: String, action: String, minutes: Int, reason: String?, dayHint: String?) {
    val now = System.currentTimeMillis()
    val today = strictDayKey(now)
    var until = 0L
    var day = today
    synchronized(StrictStore) {
      val s = StrictStore.session(ctx, key)
      // O dia do lembrete: o da insistência em curso, senão o que veio no botão (a
      // notificação parada da noite, respondida de manhã, pertence a ontem).
      day = s?.day ?: dayHint?.takeIf { it.isNotEmpty() } ?: today
      if (s != null) StrictStore.endSession(ctx, key)
      val h = StrictStore.habit(ctx, key)
      if (action == "snooze") {
        until = now + minutes.coerceIn(1, 120) * 60_000L
        StrictStore.bumpSnooze(ctx, key, today)
        if (h != null) {
          val u = h.copy(resumeAt = until)
          StrictStore.putHabit(ctx, u)
          armResume(ctx, u)
        }
      } else if (h != null) {
        val u = h.copy(resumeAt = 0L, skipDay = if (day == today) today else h.skipDay)
        StrictStore.putHabit(ctx, u)
        cancelAlarm(ctx, key, ACTION_RESUME)
        armDaily(ctx, u)
      }
      val o = JSONObject()
        .put("key", key)
        .put("action", action)
        .put("at", now)
        .put("day", day)
      if (until > 0) o.put("until", until)
      if (!reason.isNullOrBlank()) o.put("reason", reason.trim())
      StrictStore.addAnswer(ctx, o)
    }
    StrictNotifier.cancel(ctx, key)
    cancelSpokenChain(ctx, key, day, if (until > 0) until else null)
    StrictNudgeService.poke(ctx)
    StrictEvents.emit()
    Log.d(TAG, "resposta $action para $key")
  }

  /**
   * O app marcou o hábito (feito ou "não vou fazer") — pela Home, por outra
   * notificação, pela voz ou pelo Mac. Para a insistência daquele dia; se o dia é
   * hoje, o horário de hoje também não chama mais.
   */
  fun stopFromApp(ctx: Context, key: String, day: String) {
    val today = strictDayKey(System.currentTimeMillis())
    var ended = false
    synchronized(StrictStore) {
      val s = StrictStore.session(ctx, key)
      if (s != null && (day.isEmpty() || s.day == day)) {
        StrictStore.endSession(ctx, key)
        ended = true
      }
      val h = StrictStore.habit(ctx, key) ?: return@synchronized
      if (day.isEmpty() || day == today) {
        val u = h.copy(resumeAt = 0L, skipDay = today)
        StrictStore.putHabit(ctx, u)
        cancelAlarm(ctx, key, ACTION_RESUME)
        armDaily(ctx, u)
      }
    }
    // A notificação parada (teto, sono) também sai — a menos que seja a insistência
    // de HOJE e a resposta tenha sido ao lembrete de ontem.
    if (ended || StrictStore.session(ctx, key) == null) StrictNotifier.cancel(ctx, key)
    StrictNudgeService.poke(ctx)
  }

  /**
   * "Me dê mais tempo" dado no app (Home, outra notificação, voz) num hábito
   * rigoroso — ou o JS confirmando um adiamento dado aqui. Mesmo prazo de antes =
   * só confirmação: não conta de novo.
   */
  fun snoozeFromApp(ctx: Context, key: String, until: Long) {
    if (until <= System.currentTimeMillis()) return
    synchronized(StrictStore) {
      val h = StrictStore.habit(ctx, key) ?: return // não é rigoroso
      if (StrictStore.session(ctx, key) != null) StrictStore.endSession(ctx, key)
      if (kotlin.math.abs(h.resumeAt - until) > 2_000L) {
        StrictStore.bumpSnooze(ctx, key, strictDayKey(System.currentTimeMillis()))
      }
      val u = h.copy(resumeAt = until)
      StrictStore.putHabit(ctx, u)
      armResume(ctx, u)
    }
    StrictNotifier.cancel(ctx, key)
    StrictNudgeService.poke(ctx)
  }

  /**
   * Cala as cobranças FALADAS deste hábito que a resposta tornou sem sentido (o
   * mesmo que cancelSpokenChain faz no JS — aqui vale com o app fechado). Ids:
   * spk_nudge_<tipo>~<kind>~<dia>~<epoch> e spk_medf_<id>~<kind>~<dia>~<epoch>.
   */
  private fun cancelSpokenChain(ctx: Context, key: String, day: String, upTo: Long?) {
    val head = if (key.startsWith("med:")) "spk_medf_${key.removePrefix("med:")}~" else "spk_nudge_$key~"
    try {
      for (a in SpokenStore.all(ctx)) {
        if (!a.id.startsWith(head)) continue
        val parts = a.id.removePrefix(head).split("~")
        if (parts.getOrNull(0) == "anchor") continue
        val d = parts.getOrNull(1)
        if (d != null && d != day) continue
        val at = parts.getOrNull(2)?.toLongOrNull()
        if (upTo != null && at != null && at > upTo) continue
        SpokenScheduler.cancel(ctx, a.id)
      }
    } catch (e: Exception) {
      Log.w(TAG, "cancelar voz de $key falhou: ${e.message}")
    }
  }
}
