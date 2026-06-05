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

  private fun prefs(ctx: Context) =
    ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

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
