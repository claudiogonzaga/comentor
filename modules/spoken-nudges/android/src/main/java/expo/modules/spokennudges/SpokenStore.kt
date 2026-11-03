package expo.modules.spokennudges

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Um alarme falado persistido (sobrevive a reboot via SharedPreferences). */
data class SpokenAlarm(
  val id: String,
  val atEpochMs: Long,
  val audioPath: String,
  val repeatDaily: Boolean,
  val title: String,
  val body: String,
  // Hora/minuto de PAREDE do disparo diário (-1 = desconhecido, alarme antigo).
  // O epoch é absoluto: depois de mudar o fuso/horário, é daqui que se recalcula
  // o próximo disparo para a fala continuar na mesma hora do relógio.
  val hour: Int = -1,
  val minute: Int = -1,
)

/**
 * Persistência simples dos alarmes falados em SharedPreferences (JSON).
 * Precisa ser independente do JS porque, no boot, o app não roda — só o
 * BootReceiver, que re-arma a partir daqui.
 */
object SpokenStore {
  private const val PREFS = "spoken_nudges_store"
  private const val KEY = "alarms"
  private const val KEY_HEADPHONES_ONLY = "headphones_only"
  private const val KEY_QUIET_ENABLED = "quiet_enabled"
  private const val KEY_QUIET_START = "quiet_start" // minutos do dia
  private const val KEY_QUIET_END = "quiet_end" // minutos do dia
  private const val KEY_QUIET_DAYS = "quiet_days" // bitmask (bit d = dia d, 0=dom)
  private const val KEY_NUDGE_VOLUME = "nudge_volume" // 0–1
  private const val KEY_OWL_PAUSE_SEC = "owl_pause_sec" // segundos entre o canto e a fala
  private const val KEY_SILENCED_AT = "silenced_at" // epoch ms do último "Calar agora"
  private const val KEY_FOREGROUND_VOICE = "foreground_voice" // o JS fala com o app na tela
  // Lista COMPLETA dos períodos sem som (JSON [{start,end,days}], minutos do dia).
  // Substitui a janela única acima quando presente: o app tem vários períodos
  // (trabalho, sono derivado do horário de dormir…) e o serviço precisa de todos.
  private const val KEY_QUIET_PERIODS = "quiet_periods"

  private fun prefs(ctx: Context) =
    ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /**
   * Preferência GLOBAL "só falar com fone de ouvido". Fica aqui (SharedPreferences)
   * porque o serviço nativo a lê na hora do disparo, sem o JS rodar (alarme/boot).
   */
  fun getHeadphonesOnly(ctx: Context): Boolean =
    prefs(ctx).getBoolean(KEY_HEADPHONES_ONLY, false)

  fun setHeadphonesOnly(ctx: Context, value: Boolean) {
    prefs(ctx).edit().putBoolean(KEY_HEADPHONES_ONLY, value).apply()
  }

  /** Horário silencioso (janela + dias em que NÃO se fala). Lido no disparo. */
  fun setQuiet(ctx: Context, enabled: Boolean, startMin: Int, endMin: Int, daysMask: Int) {
    prefs(ctx)
      .edit()
      .putBoolean(KEY_QUIET_ENABLED, enabled)
      .putInt(KEY_QUIET_START, startMin)
      .putInt(KEY_QUIET_END, endMin)
      .putInt(KEY_QUIET_DAYS, daysMask)
      .apply()
  }

  fun getQuietEnabled(ctx: Context): Boolean = prefs(ctx).getBoolean(KEY_QUIET_ENABLED, false)
  fun getQuietStart(ctx: Context): Int = prefs(ctx).getInt(KEY_QUIET_START, 9 * 60)
  fun getQuietEnd(ctx: Context): Int = prefs(ctx).getInt(KEY_QUIET_END, 18 * 60)
  fun getQuietDays(ctx: Context): Int = prefs(ctx).getInt(KEY_QUIET_DAYS, 127)

  /** Lista completa dos períodos sem som (JSON). null = nunca espelhada (usa a janela única). */
  fun setQuietPeriods(ctx: Context, json: String) {
    prefs(ctx).edit().putString(KEY_QUIET_PERIODS, json).apply()
  }
  fun getQuietPeriods(ctx: Context): String? = prefs(ctx).getString(KEY_QUIET_PERIODS, null)

  /** Volume da voz dos nudges (0–1), barra da Home. Lido no disparo do WAV. */
  /**
   * Pausa entre o CANTO da coruja e a FALA, em ms. É o tempo para a pessoa baixar
   * o volume ou tocar "Calar agora" se o ambiente não permitir. Padrão 15 s.
   */
  fun getOwlPauseMs(ctx: Context): Long =
    prefs(ctx).getInt(KEY_OWL_PAUSE_SEC, 15).coerceIn(0, 120) * 1000L
  fun setOwlPauseSeconds(ctx: Context, seconds: Int) {
    prefs(ctx).edit().putInt(KEY_OWL_PAUSE_SEC, seconds.coerceIn(0, 120)).apply()
  }

  /** Último "Calar agora" (epoch ms): o caminho JS de primeiro plano também respeita. */
  fun getSilencedAt(ctx: Context): Long = prefs(ctx).getLong(KEY_SILENCED_AT, 0L)
  fun setSilencedAt(ctx: Context, at: Long) {
    prefs(ctx).edit().putLong(KEY_SILENCED_AT, at).apply()
  }

  /** "Falar as notificações" (app aberto): com o app na tela, é o JS quem fala a tarefa. */
  fun getForegroundVoice(ctx: Context): Boolean = prefs(ctx).getBoolean(KEY_FOREGROUND_VOICE, false)
  fun setForegroundVoice(ctx: Context, value: Boolean) {
    prefs(ctx).edit().putBoolean(KEY_FOREGROUND_VOICE, value).apply()
  }

  fun getNudgeVolume(ctx: Context): Float = prefs(ctx).getFloat(KEY_NUDGE_VOLUME, 1f)
  fun setNudgeVolume(ctx: Context, value: Float) {
    prefs(ctx).edit().putFloat(KEY_NUDGE_VOLUME, value.coerceIn(0f, 1f)).apply()
  }

  // Ler-filtrar-regravar a lista: as AsyncFunction do módulo (schedule/cancel)
  // rodam fora da main thread e o SpokenAlarmReceiver roda na main. Sem lock, um
  // interleaving perdia uma das gravações (alarme armado sem registro, ou o +1 dia
  // do diário). @Synchronized trava no próprio objeto: quem precisa de várias
  // operações atômicas usa synchronized(SpokenStore) { ... } (reentrante).
  @Synchronized
  fun all(ctx: Context): List<SpokenAlarm> {
    val raw = prefs(ctx).getString(KEY, "[]") ?: "[]"
    return try {
      val arr = JSONArray(raw)
      (0 until arr.length()).map { i ->
        val o = arr.getJSONObject(i)
        SpokenAlarm(
          o.getString("id"),
          o.getLong("atEpochMs"),
          o.getString("audioPath"),
          o.getBoolean("repeatDaily"),
          o.optString("title", ""),
          o.optString("body", ""),
          o.optInt("hour", -1),
          o.optInt("minute", -1),
        )
      }
    } catch (e: Exception) {
      emptyList()
    }
  }

  @Synchronized
  fun get(ctx: Context, id: String): SpokenAlarm? = all(ctx).firstOrNull { it.id == id }

  @Synchronized
  fun put(ctx: Context, alarm: SpokenAlarm) {
    val list = all(ctx).filter { it.id != alarm.id }.toMutableList()
    list.add(alarm)
    save(ctx, list)
  }

  @Synchronized
  fun remove(ctx: Context, id: String) {
    save(ctx, all(ctx).filter { it.id != id })
  }

  @Synchronized
  fun clear(ctx: Context) {
    prefs(ctx).edit().remove(KEY).apply()
  }

  @Synchronized
  private fun save(ctx: Context, list: List<SpokenAlarm>) {
    val arr = JSONArray()
    for (a in list) {
      val o = JSONObject()
      o.put("id", a.id)
      o.put("atEpochMs", a.atEpochMs)
      o.put("audioPath", a.audioPath)
      o.put("repeatDaily", a.repeatDaily)
      o.put("title", a.title)
      o.put("body", a.body)
      o.put("hour", a.hour)
      o.put("minute", a.minute)
      arr.put(o)
    }
    prefs(ctx).edit().putString(KEY, arr.toString()).apply()
  }
}
