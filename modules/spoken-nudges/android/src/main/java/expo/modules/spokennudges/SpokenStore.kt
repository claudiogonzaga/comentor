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

  /** Volume da voz dos nudges (0–1), barra da Home. Lido no disparo do WAV. */
  fun getNudgeVolume(ctx: Context): Float = prefs(ctx).getFloat(KEY_NUDGE_VOLUME, 1f)
  fun setNudgeVolume(ctx: Context, value: Float) {
    prefs(ctx).edit().putFloat(KEY_NUDGE_VOLUME, value.coerceIn(0f, 1f)).apply()
  }

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
        )
      }
    } catch (e: Exception) {
      emptyList()
    }
  }

  fun get(ctx: Context, id: String): SpokenAlarm? = all(ctx).firstOrNull { it.id == id }

  fun put(ctx: Context, alarm: SpokenAlarm) {
    val list = all(ctx).filter { it.id != alarm.id }.toMutableList()
    list.add(alarm)
    save(ctx, list)
  }

  fun remove(ctx: Context, id: String) {
    save(ctx, all(ctx).filter { it.id != id })
  }

  fun clear(ctx: Context) {
    prefs(ctx).edit().remove(KEY).apply()
  }

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
      arr.put(o)
    }
    prefs(ctx).edit().putString(KEY, arr.toString()).apply()
  }
}
