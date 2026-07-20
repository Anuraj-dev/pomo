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
        val result = getTags().filter { it != name }.also { setTags(it) }
        if (getDefaultTag() == name) {
            setDefaultTag(DEFAULT_TAGS.first())
        }
        return result
    }

    public fun renameTag(
        oldName: String,
        newName: String,
    ): RenameResult {
        if (oldName == newName) return RenameResult.Success(getTags())
        val current = getTags()
        if (current.contains(newName)) return RenameResult.Duplicate(newName)
        val result = current.map { if (it == oldName) newName else it }
            .also { setTags(it) }
        if (getDefaultTag() == oldName) {
            setDefaultTag(newName)
        }
        return RenameResult.Success(result)
    }

    public sealed interface RenameResult {
        public data class Success(val tags: List<String>) : RenameResult

        public data class Duplicate(val existingTag: String) : RenameResult
    }

    public fun hasTag(name: String): Boolean = getTags().contains(name)

    public fun getDefaultTag(): String {
        val stored = prefs.getString(PREF_KEY_DEFAULT_TAG, null) ?: return DEFAULT_TAGS.first()
        return if (getTags().contains(stored)) stored else DEFAULT_TAGS.first()
    }

    public fun setDefaultTag(tag: String) {
        prefs.edit().putString(PREF_KEY_DEFAULT_TAG, tag).apply()
    }

    public companion object {
        private const val PREF_KEY_TAGS = "pomo_session_tags"
        private const val PREF_KEY_DEFAULT_TAG = "pomo_default_tag"
        internal val DEFAULT_TAGS = listOf("Work", "Study", "Personal", "Exercise")
    }
}
