package com.pomo.achievements

import com.pomo.stats.StatsSnapshot

/**
 * The axis an achievement measures. Each axis reads one monotonic quantity — a lifetime total or an
 * all-time maximum — so an achievement is a ratchet: once earned it never un-earns while the history
 * stands, no matter what today looks like. See docs/adr/0005-achievements.md.
 */
public enum class AchievementAxis {
    /** Lifetime focus minutes — the headline metric (see CONTEXT.md). */
    Focus,

    /** Best streak ever reached, in whole days. */
    Streak,

    /** The single best day ever, in focus minutes. Capped on purpose: no rung asks for a longer day. */
    BestDay,

    /** A one-off landmark rather than a rung on a ladder. */
    Milestone,
}

/**
 * One tile in the catalog. The badge *is* the number ([badge]); [title] names it and [fact] states
 * plainly what it took. Nothing here is stored — [isEarnedBy] recomputes from a [StatsSnapshot] on
 * read, exactly like every other stat.
 */
public data class Achievement(
    val id: String,
    val axis: AchievementAxis,
    val badge: String,
    val title: String,
    val fact: String,
    /** In the axis's native unit: minutes for Focus/BestDay, days for Streak, 1 for a Milestone. */
    val threshold: Int,
) {
    /**
     * Whether [snapshot] clears this tile. Reads only monotonic quantities, so this is safe to run
     * against a crew member's rebuilt snapshot: those quantities can only *understate* a peer, so a
     * true answer here proves they earned it, and a false one never disproves it.
     */
    public fun isEarnedBy(snapshot: StatsSnapshot): Boolean = currentValue(snapshot) >= threshold

    private fun currentValue(snapshot: StatsSnapshot): Int = when (axis) {
        AchievementAxis.Focus -> snapshot.lifetime.focusMinutes
        AchievementAxis.Streak -> snapshot.records.longestStreak
        AchievementAxis.BestDay -> snapshot.records.bestDay?.minutes ?: 0
        AchievementAxis.Milestone ->
            if (snapshot.lifetime.focusMinutes > 0 || snapshot.lifetime.sessions > 0) 1 else 0
    }
}
