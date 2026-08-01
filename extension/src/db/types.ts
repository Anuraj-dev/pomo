import type { DayStat } from "../engine/stats";
import type { Phase } from "../engine/timer";

export interface SessionRow {
  start: number;
  date: string;
  type: Phase;
  duration: number;
  completed: boolean;
  tag: string | null;
}

export type DayStatRow = DayStat & { lastUpdated: number };
