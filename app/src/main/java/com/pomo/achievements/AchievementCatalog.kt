package com.pomo.achievements

import com.pomo.stats.StatsSnapshot

/**
 * The fixed set of achievements, in ascending prestige. Names are product copy governed by
 * CONTEXT.md — the streak tiles are spoken numbers, never "week"/"month", because a 7-day streak is
 * seven consecutive days, not a calendar week (the same reason the Ranking window avoids those words).
 *
 * Thresholds were calibrated against a real, dense history rather than invented to sound impressive:
 * the cumulative ladders (Focus, Streak) keep low rungs for a newcomer and add real headroom above a
 * heavy user; the single-day ladder is capped at 8h so no tile ever rewards a longer waking grind;
 * and the only Milestone is earned by an act, not by the calendar. See docs/adr/0005-achievements.md.
 */
public object AchievementCatalog {
    private const val H: Int = 60

    public val all: List<Achievement> =
        listOf(
            // Milestone — the one tile a brand-new member can already have.
            Achievement("milestone_first_block", AchievementAxis.Milestone, "1", "Block one", "Your first Work block", 1),
            // Focus — lifetime focus minutes, the headline metric.
            Achievement("focus_1h", AchievementAxis.Focus, "1h", "First hour", "1 hour focused", 1 * H),
            Achievement("focus_10h", AchievementAxis.Focus, "10h", "Double figures", "10 hours focused", 10 * H),
            Achievement("focus_100h", AchievementAxis.Focus, "100h", "Century", "100 hours focused", 100 * H),
            Achievement("focus_500h", AchievementAxis.Focus, "500h", "The long haul", "500 hours focused", 500 * H),
            Achievement("focus_1000h", AchievementAxis.Focus, "1000h", "Four figures", "1,000 hours focused", 1_000 * H),
            Achievement("focus_2000h", AchievementAxis.Focus, "2000h", "The deep end", "2,000 hours focused", 2_000 * H),
            Achievement("focus_5000h", AchievementAxis.Focus, "5000h", "Lifer", "5,000 hours focused", 5_000 * H),
            // Streak — best streak ever, in days.
            Achievement("streak_3d", AchievementAxis.Streak, "3d", "Three", "3-day streak", 3),
            Achievement("streak_7d", AchievementAxis.Streak, "7d", "Seven", "7-day streak", 7),
            Achievement("streak_30d", AchievementAxis.Streak, "30d", "Thirty", "30-day streak", 30),
            Achievement("streak_100d", AchievementAxis.Streak, "100d", "Hundred days", "100-day streak", 100),
            Achievement("streak_180d", AchievementAxis.Streak, "180d", "One eighty", "180-day streak", 180),
            Achievement("streak_365d", AchievementAxis.Streak, "365d", "Three sixty-five", "365-day streak", 365),
            // Best day — capped. Nothing rewards a day longer than this.
            Achievement("day_4h", AchievementAxis.BestDay, "4h", "Deep day", "4 hours in one day", 4 * H),
            Achievement("day_8h", AchievementAxis.BestDay, "8h", "Marathon", "8 hours in one day", 8 * H),
        )

    public val size: Int get() = all.size
}

/** An achievement paired with whether the given snapshot has earned it. */
public data class AchievementStatus(val achievement: Achievement, val earned: Boolean)

/**
 * Pure, side-effect-free scoring. Unit-testable without any Android dependency (see
 * AchievementEvaluatorTest) — nothing here touches CrewStore, Keystore, or Room.
 */
public object AchievementEvaluator {
    /** The whole catalog, each tile marked earned or not. Use for your own page. */
    public fun evaluate(snapshot: StatsSnapshot): List<AchievementStatus> =
        AchievementCatalog.all.map { AchievementStatus(it, it.isEarnedBy(snapshot)) }

    /** How many of the catalog this snapshot has earned. */
    public fun earnedCount(snapshot: StatsSnapshot): Int = AchievementCatalog.all.count { it.isEarnedBy(snapshot) }

    /**
     * Only the tiles this snapshot provably earned, in catalog order. Use for a crew member: you can
     * always prove someone earned something, never that they didn't, so a peer never sees a dimmed
     * "not earned" tile that would assert something false about a real person.
     */
    public fun earnedOnly(snapshot: StatsSnapshot): List<Achievement> = AchievementCatalog.all.filter { it.isEarnedBy(snapshot) }

    /**
     * Up to three tiles for the Profile summary row: the furthest rung reached on each ladder
     * (Focus, then Streak, then Best day). Comparing rungs across axes would need an arbitrary
     * common scale, so instead of ranking them we show one-per-ladder — a truer "here's where you
     * stand". A member who has only just started, with nothing but the first block, sees that block
     * rather than an empty row.
     */
    public fun highlights(snapshot: StatsSnapshot): List<Achievement> {
        val perAxis =
            listOf(AchievementAxis.Focus, AchievementAxis.Streak, AchievementAxis.BestDay)
                .mapNotNull { axis ->
                    AchievementCatalog.all
                        .filter { it.axis == axis && it.isEarnedBy(snapshot) }
                        .maxByOrNull { it.threshold }
                }
        return perAxis.ifEmpty { earnedOnly(snapshot).take(1) }
    }
}
