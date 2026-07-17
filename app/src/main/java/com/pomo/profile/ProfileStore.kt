package com.pomo.profile

import android.content.Context
import com.pomo.crew.CrewStore
import com.pomo.crew.CrewValidation

/**
 * The member's Profile: one Display name, owned by the member identity rather than by any Crew.
 *
 * The name used to live per-membership inside [CrewStore], so a member who was in no Crew had
 * nowhere to be anybody. It is lifted out on first read and this store is authoritative from then
 * on. See docs/adr/0004-profile-replaces-settings-in-the-nav.md.
 */
public class ProfileStore(context: Context) {
    private val app: Context = context.applicationContext
    private val prefs = app.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /** The Display name, or empty if the member has never set one. */
    public fun displayName(): String {
        if (!prefs.contains(KEY_DISPLAY_NAME)) {
            return migrateFromCrew()
        }
        return prefs.getString(KEY_DISPLAY_NAME, "").orEmpty()
    }

    /**
     * Returns the normalized name that was stored, or null if [value] is not a usable name.
     *
     * This only persists the Profile's own copy. Crews still read the name off their membership
     * rows, and a rename has to be *published* to reach them, so the caller must also put the name
     * through `CrewRepository.updateDisplayName` — which pairs the membership write with a snapshot
     * publish. Writing to `CrewStore` from here would update the rows and never tell anybody.
     */
    public fun updateDisplayName(value: String): String? {
        val name = CrewValidation.normalizeDisplayName(value) ?: return null
        prefs.edit().putString(KEY_DISPLAY_NAME, name).apply()
        return name
    }

    /**
     * One-time lift of the name out of [CrewStore]. The key is written either way, so a name the
     * member has deliberately cleared is never re-migrated back out of their Crews.
     */
    private fun migrateFromCrew(): String {
        val inherited = inheritedName(CrewStore(app).loadMemberships().map { it.displayName })
        prefs.edit().putString(KEY_DISPLAY_NAME, inherited).apply()
        return inherited
    }

    public companion object {
        private const val PREFS_NAME: String = "profile_prefs"
        private const val KEY_DISPLAY_NAME: String = "display_name"

        /**
         * The name a member inherits from Crew when the Profile arrives: the first usable name they
         * already gave themselves, or empty if they never gave one.
         */
        public fun inheritedName(crewDisplayNames: List<String>): String =
            crewDisplayNames.firstNotNullOfOrNull { CrewValidation.normalizeDisplayName(it) }
                .orEmpty()
    }
}
