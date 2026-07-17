package com.pomo.tags

import android.content.Context
import androidx.preference.PreferenceManager
import org.json.JSONArray

public class TagStore(context: Context) {
    private val prefs = PreferenceManager.getDefaultSharedPreferences(context.applicationContext)

    public fun getTags(): List<String> {
        val json = prefs.getString(PREF_KEY_TAGS, null) ?: return DEFAULT_TAGS
        return try {
            val array = JSONArray(json)
            (0 until array.length()).map { array.getString(it) }
        } catch (_: Exception) {
            DEFAULT_TAGS
        }
    }

    public fun setTags(tags: List<String>) {
        val array = JSONArray()
        tags.forEach { array.put(it) }
        prefs.edit().putString(PREF_KEY_TAGS, array.toString()).apply()
    }

    public fun addTag(name: String): List<String> {
        val current = getTags()
        if (current.contains(name)) return current
        return (current + name).also { setTags(it) }
    }

    public fun removeTag(name: String): List<String> {
        return getTags().filter { it != name }.also { setTags(it) }
    }

    public fun renameTag(
        oldName: String,
        newName: String,
    ): List<String> {
        if (oldName == newName) return getTags()
        return getTags().map { if (it == oldName) newName else it }.also { setTags(it) }
    }

    public fun hasTag(name: String): Boolean = getTags().contains(name)

    public companion object {
        private const val PREF_KEY_TAGS = "pomo_session_tags"
        private val DEFAULT_TAGS = listOf("Work", "Study", "Personal", "Exercise")
    }
}
