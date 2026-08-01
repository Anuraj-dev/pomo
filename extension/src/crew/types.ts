export interface DailyAggregate {
  localDate: string;
  focusMinutes: number;
  completedWorkBlocks: number;
}

export interface CrewStatsExtras {
  hourBuckets: number[];
  weekdayBuckets: number[];
  allTimeWorkBlocks: number;
  allTimeActiveDays: number;
  bestStreak: number;
  firstFocusLocalDate: string | null;
  historyStartDate: string | null;
  historyFocusMinutes: number[];
  historyWorkBlocks: number[];
  bestDayLocalDate: string | null;
  bestDayFocusMinutes: number;
  bestDayWorkBlocks: number;
  bestWeekStartDate: string | null;
  bestWeekFocusMinutes: number;
  bestWeekWorkBlocks: number;
}

export interface SnapshotPlain {
  crewId: string;
  identityPublicKey: string;
  displayName: string;
  avatarBase64: string | null;
  allTimeFocusMinutes: number;
  publishedAtEpochSeconds: number;
  localDate: string;
  utcOffsetMinutes: number;
  dailyAggregates: DailyAggregate[];
  currentStreak: number;
  lastFocusedAtEpochSeconds: number;
  version: number;
  stats: CrewStatsExtras | null;
}

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export const SNAPSHOT_EVENT_KIND = 39050;

export interface CrewMembership {
  crewId: string;
  crewName: string;
  relays: string[];
  key: string;
}

export interface StoredMembership extends CrewMembership {
  displayName: string;
  joinedAtEpochSeconds: number;
}
