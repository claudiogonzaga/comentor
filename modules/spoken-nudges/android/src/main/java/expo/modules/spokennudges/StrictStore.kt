package expo.modules.spokennudges

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.Locale

/**
 * Um hábito RIGOROSO, espelhado pelo JS (strictHabits.ts). No horário — e ao fim
 * de cada "Mais tempo" — o celular vibra em pulsos até a pessoa responder.
 */
data class StrictHabit(
  /** Chave da tarefa, a mesma de done:<dia>:<tarefa>: o tipo do hábito ou "med:<id>". */
  val key: String,
  /** "nudge" ou "med": cada passada do JS substitui só a lista da sua fonte. */
  val source: String,
  /** O MESMO título da notificação do expo — é por ele que a duplicata sai da bandeja. */
  val title: String,
  val body: String,
  /** Frases curtas que se revezam, uma por rodada de pulsos. */
  val lines: List<String>,
  val hour: Int,
  val minute: Int,
  /** Dias ativos (bit d = dia d, 0 = domingo). */
  val days: Int,
  /** Dia (yyyy-MM-dd) já respondido: nele o horário não chama. "" = nenhum. */
  val skipDay: String,
  /** Fim do "Mais tempo" (epoch ms): ali volta a insistir. 0 = nenhum. */
  val resumeAt: Long,
)

/** Uma insistência em curso: começou em `startedAt`, pelo lembrete do dia `day`. */
data class StrictSession(val key: String, val startedAt: Long, val day: String)

/**
 * Estado dos hábitos rigorosos em SharedPreferences — independente do JS, porque
 * o alarme, o serviço e os botões da notificação rodam com o app fechado.
 *
 * Mesmo desenho do SpokenStore: cada leitura/gravação é @Synchronized no objeto;
 * quem precisa de várias operações juntas usa synchronized(StrictStore) { … }.
 */
object StrictStore {
  private const val PREFS = "strict_habits_store"
  private const val KEY_HABITS = "habits"
  private const val KEY_SESSIONS = "sessions"
  /** Respostas dadas na notificação, à espera do JS (que marca feito/adiado/pulado). */
  private const val KEY_ANSWERS = "answers"
  /** "Mais tempo" usados hoje, por hábito: {key: {day, n}}. */
  private const val KEY_SNOOZES = "snoozes"
  /** Janelas de sono (minutos do dia), espelhadas pelo JS: [{start, end}]. */
  private const val KEY_SLEEP = "sleep_windows"
  /** Teto da fila de respostas (o JS esvazia a cada abertura). */
  private const val MAX_ANSWERS = 60

  private fun prefs(ctx: Context) =
    ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  // ---- hábitos ----

  @Synchronized
  fun habits(ctx: Context): List<StrictHabit> {
    val raw = prefs(ctx).getString(KEY_HABITS, "[]") ?: "[]"
    return try {
      val arr = JSONArray(raw)
      (0 until arr.length()).mapNotNull { i -> parseHabit(arr.optJSONObject(i), null) }
    } catch (_: Exception) {
      emptyList()
    }
  }

  @Synchronized
  fun habit(ctx: Context, key: String): StrictHabit? = habits(ctx).firstOrNull { it.key == key }

  @Synchronized
  fun saveHabits(ctx: Context, list: List<StrictHabit>) {
    val arr = JSONArray()
    for (h in list) arr.put(habitJson(h))
    prefs(ctx).edit().putString(KEY_HABITS, arr.toString()).apply()
  }

  @Synchronized
  fun putHabit(ctx: Context, h: StrictHabit) {
    saveHabits(ctx, habits(ctx).filter { it.key != h.key } + h)
  }

  /** Lê um hábito do JSON (do JS ou do próprio store). `source` != null força a fonte. */
  fun parseHabit(o: JSONObject?, source: String?): StrictHabit? {
    if (o == null) return null
    val key = o.optString("key", "")
    if (key.isEmpty()) return null
    val linesArr = o.optJSONArray("lines")
    val lines = if (linesArr == null) emptyList() else
      (0 until linesArr.length()).map { linesArr.optString(it, "") }.filter { it.isNotBlank() }
    return StrictHabit(
      key = key,
      source = source ?: o.optString("source", if (key.startsWith("med:")) "med" else "nudge"),
      title = o.optString("title", ""),
      body = o.optString("body", ""),
      lines = lines,
      hour = o.optInt("hour", -1),
      minute = o.optInt("minute", -1),
      days = o.optInt("days", 127),
      skipDay = o.optString("skipDay", ""),
      resumeAt = o.optLong("resumeAt", 0L),
    )
  }

  private fun habitJson(h: StrictHabit): JSONObject {
    val lines = JSONArray()
    for (l in h.lines) lines.put(l)
    return JSONObject()
      .put("key", h.key)
      .put("source", h.source)
      .put("title", h.title)
      .put("body", h.body)
      .put("lines", lines)
      .put("hour", h.hour)
      .put("minute", h.minute)
      .put("days", h.days)
      .put("skipDay", h.skipDay)
      .put("resumeAt", h.resumeAt)
  }

  // ---- insistências em curso ----

  @Synchronized
  fun sessions(ctx: Context): List<StrictSession> {
    val raw = prefs(ctx).getString(KEY_SESSIONS, "[]") ?: "[]"
    return try {
      val arr = JSONArray(raw)
      (0 until arr.length()).mapNotNull { i ->
        val o = arr.optJSONObject(i) ?: return@mapNotNull null
        val key = o.optString("key", "")
        if (key.isEmpty()) null else StrictSession(key, o.optLong("startedAt", 0L), o.optString("day", ""))
      }
    } catch (_: Exception) {
      emptyList()
    }
  }

  @Synchronized
  fun session(ctx: Context, key: String): StrictSession? = sessions(ctx).firstOrNull { it.key == key }

  /** Começa a insistir neste hábito. false = já estava insistindo. */
  @Synchronized
  fun beginSession(ctx: Context, key: String, at: Long, day: String): Boolean {
    val list = sessions(ctx)
    if (list.any { it.key == key }) return false
    saveSessions(ctx, list + StrictSession(key, at, day))
    return true
  }

  @Synchronized
  fun endSession(ctx: Context, key: String) {
    val list = sessions(ctx)
    if (list.none { it.key == key }) return
    saveSessions(ctx, list.filter { it.key != key })
  }

  @Synchronized
  private fun saveSessions(ctx: Context, list: List<StrictSession>) {
    val arr = JSONArray()
    for (s in list) {
      arr.put(JSONObject().put("key", s.key).put("startedAt", s.startedAt).put("day", s.day))
    }
    prefs(ctx).edit().putString(KEY_SESSIONS, arr.toString()).apply()
  }

  // ---- respostas para o JS ----

  @Synchronized
  fun addAnswer(ctx: Context, answer: JSONObject) {
    val arr = try {
      JSONArray(prefs(ctx).getString(KEY_ANSWERS, "[]") ?: "[]")
    } catch (_: Exception) {
      JSONArray()
    }
    arr.put(answer)
    // Fila sem dono por muito tempo (app sem abrir): guarda só as mais recentes.
    val out = JSONArray()
    val from = maxOf(0, arr.length() - MAX_ANSWERS)
    for (i in from until arr.length()) out.put(arr.get(i))
    // commit (síncrono): a resposta não pode se perder se o processo morrer logo depois.
    prefs(ctx).edit().putString(KEY_ANSWERS, out.toString()).commit()
  }

  /** Entrega e esvazia a fila de respostas (JSON array). */
  @Synchronized
  fun takeAnswers(ctx: Context): String {
    val raw = prefs(ctx).getString(KEY_ANSWERS, "[]") ?: "[]"
    prefs(ctx).edit().remove(KEY_ANSWERS).commit()
    return raw
  }

  // ---- "Mais tempo" do dia (cada vez menos generoso) ----

  @Synchronized
  fun snoozeCount(ctx: Context, key: String, day: String): Int {
    return try {
      val o = JSONObject(prefs(ctx).getString(KEY_SNOOZES, "{}") ?: "{}").optJSONObject(key)
      if (o != null && o.optString("day") == day) o.optInt("n", 0) else 0
    } catch (_: Exception) {
      0
    }
  }

  @Synchronized
  fun bumpSnooze(ctx: Context, key: String, day: String) {
    val all = try {
      JSONObject(prefs(ctx).getString(KEY_SNOOZES, "{}") ?: "{}")
    } catch (_: Exception) {
      JSONObject()
    }
    val n = snoozeCount(ctx, key, day) + 1
    all.put(key, JSONObject().put("day", day).put("n", n))
    // Só o dia de hoje interessa: o resto sai.
    val out = JSONObject()
    for (k in all.keys()) {
      val o = all.optJSONObject(k) ?: continue
      if (o.optString("day") == day) out.put(k, o)
    }
    prefs(ctx).edit().putString(KEY_SNOOZES, out.toString()).apply()
  }

  // ---- janela de sono ----

  fun setSleepWindows(ctx: Context, json: String) {
    prefs(ctx).edit().putString(KEY_SLEEP, json).apply()
  }

  /**
   * Estamos na janela de sono? Do horário de dormir até as 6h (a mesma regra das
   * notificações e do feed), mais o período de sono da Comentora, se ligado. Sem
   * espelho do JS ainda: 23h–6h.
   */
  fun inSleepWindow(ctx: Context, now: Long): Boolean {
    val raw = prefs(ctx).getString(KEY_SLEEP, null) ?: """[{"start":1380,"end":360}]"""
    return try {
      val c = Calendar.getInstance()
      c.timeInMillis = now
      val min = c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE)
      val arr = JSONArray(raw)
      (0 until arr.length()).any { i ->
        val o = arr.optJSONObject(i) ?: return@any false
        val s = o.optInt("start", 0)
        val e = o.optInt("end", 0)
        when {
          s == e -> false
          s < e -> min in s until e
          else -> min >= s || min < e // cruza a meia-noite
        }
      }
    } catch (_: Exception) {
      false
    }
  }
}

/** Dia local (yyyy-MM-dd) de um instante — o mesmo formato do JS (todayISO). */
fun strictDayKey(ms: Long): String {
  val c = Calendar.getInstance()
  c.timeInMillis = ms
  return String.format(
    Locale.US,
    "%04d-%02d-%02d",
    c.get(Calendar.YEAR),
    c.get(Calendar.MONTH) + 1,
    c.get(Calendar.DAY_OF_MONTH),
  )
}
