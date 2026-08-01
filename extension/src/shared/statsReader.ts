import { HistoryDao } from "../db/dao";
import { openDb } from "../db/schema";
import { dateStringOf, utcOffsetMinutesAt } from "../engine/dateLogic";
import { currentStreak, totals } from "../engine/stats";

export interface SurfaceStats {
  todayEarned: number;
  totalFocusMinutes: number;
  streak: number;
}

export async function readSurfaceStats(): Promise<SurfaceStats> {
  const db = await openDb();
  const dao = new HistoryDao(db);
  const days = await dao.dayStats();
  const now = Math.floor(Date.now() / 1000);
  const offset = utcOffsetMinutesAt(now);
  const today = dateStringOf(now, offset);
  const sum = totals(days);
  return {
    todayEarned: days.find((day) => day.date === today)?.earnedBlocks ?? 0,
    totalFocusMinutes: sum.focusMinutes,
    streak: currentStreak(days.map((day) => day.date), today, offset),
  };
}
