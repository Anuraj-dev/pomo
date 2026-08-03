import type { DayStatRow, SessionRow } from "./types";

export interface CrewSnapshotRow {
  crewId: string;
  identityPublicKey: string;
  displayName: string;
  avatarBase64: string | null;
  allTimeFocusMinutes: number;
  publishedAtEpochSeconds: number;
  localDate: string;
  utcOffsetMinutes: number;
  currentStreak: number;
  lastFocusedAtEpochSeconds: number;
  protocolVersion: number;
  statsJson: string | null;
}

export interface CrewDailyRow {
  crewId: string;
  identityPublicKey: string;
  localDate: string;
  focusMinutes: number;
  completedWorkBlocks: number;
}

export interface CrewRelayStateRow {
  crewId: string;
  relayUrl: string;
  lastAttemptEpochSeconds: number;
  lastSuccessEpochSeconds: number | null;
  lastError: string | null;
}

interface CrewHiddenRow {
  crewId: string;
  identityPublicKey: string;
  hiddenAtEpochSeconds: number;
}

export function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function tx<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  fn: (transaction: IDBTransaction) => Promise<T>,
): Promise<T> {
  const transaction = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  const result = Promise.resolve(fn(transaction));
  result.catch(() => undefined);
  return done.then(() => result);
}

export class HistoryDao {
  constructor(private readonly db: IDBDatabase) {}

  insertSessionWithDayStats(
    row: SessionRow,
    delta: { earnedBlocks: number; focusMinutes: number; breakMinutes: number },
  ): Promise<void> {
    return tx(this.db, ["sessions", "dayStats"], "readwrite", async (transaction) => {
      await req(transaction.objectStore("sessions").put(row));
      const store = transaction.objectStore("dayStats");
      const existing = await req<DayStatRow | undefined>(store.get(row.date));
      const merged: DayStatRow =
        existing === undefined
          ? {
              date: row.date,
              earnedBlocks: delta.earnedBlocks,
              focusMinutes: delta.focusMinutes,
              breakMinutes: delta.breakMinutes,
              lastUpdated: Date.now(),
            }
          : {
              date: row.date,
              earnedBlocks: existing.earnedBlocks + delta.earnedBlocks,
              focusMinutes: existing.focusMinutes + delta.focusMinutes,
              breakMinutes: existing.breakMinutes + delta.breakMinutes,
              lastUpdated: Date.now(),
            };
      await req(store.put(merged));
    });
  }

  insertSession(row: SessionRow): Promise<void> {
    return tx(this.db, ["sessions"], "readwrite", async (transaction) => {
      await req(transaction.objectStore("sessions").put(row));
    });
  }

  mergeBackup(
    backupDayStats: DayStatRow[],
    backupSessions: SessionRow[],
  ): Promise<{ sessionsAdded: number; daysAffected: number }> {
    return tx(this.db, ["sessions", "dayStats"], "readwrite", async (transaction) => {
      const sessionsStore = transaction.objectStore("sessions");
      const dayStatsStore = transaction.objectStore("dayStats");
      const existingSessions = await req<SessionRow[]>(sessionsStore.getAll());
      const existingDayStats = await req<DayStatRow[]>(dayStatsStore.getAll());
      const byStart = new Map(existingSessions.map((row) => [row.start, row]));
      let sessionsAdded = 0;
      for (const row of backupSessions) {
        if (byStart.has(row.start)) continue;
        byStart.set(row.start, row);
        sessionsAdded++;
      }

      const derived = new Map<string, DayStatRow>();
      for (const session of byStart.values()) {
        const current = derived.get(session.date) ?? {
          date: session.date,
          earnedBlocks: 0,
          focusMinutes: 0,
          breakMinutes: 0,
          lastUpdated: Date.now(),
        };
        const minutes = Math.ceil(session.duration / 60);
        if (session.type === "work") {
          current.focusMinutes += minutes;
          if (session.completed) current.earnedBlocks += 1;
        } else if (session.completed) {
          current.breakMinutes += minutes;
        }
        derived.set(session.date, current);
      }

      const oldByDate = new Map(existingDayStats.map((row) => [row.date, row]));
      const backupByDate = new Map(backupDayStats.map((row) => [row.date, row]));
      const dates = new Set([...derived.keys(), ...oldByDate.keys(), ...backupByDate.keys()]);
      const mergedDays = [...dates].map((date) => {
        const fromSessions = derived.get(date);
        const fromDevice = oldByDate.get(date);
        const fromBackup = backupByDate.get(date);
        return {
          date,
          earnedBlocks: Math.max(fromSessions?.earnedBlocks ?? 0, fromDevice?.earnedBlocks ?? 0, fromBackup?.earnedBlocks ?? 0),
          focusMinutes: Math.max(fromSessions?.focusMinutes ?? 0, fromDevice?.focusMinutes ?? 0, fromBackup?.focusMinutes ?? 0),
          breakMinutes: Math.max(fromSessions?.breakMinutes ?? 0, fromDevice?.breakMinutes ?? 0, fromBackup?.breakMinutes ?? 0),
          lastUpdated: Date.now(),
        };
      });

      for (const row of byStart.values()) await req(sessionsStore.put(row));
      for (const row of mergedDays) await req(dayStatsStore.put(row));
      const daysAffected = mergedDays.filter((row) => {
        const old = oldByDate.get(row.date);
        return old === undefined || old.earnedBlocks !== row.earnedBlocks || old.focusMinutes !== row.focusMinutes || old.breakMinutes !== row.breakMinutes;
      }).length;
      return { sessionsAdded, daysAffected };
    });
  }

  sessionsForDate(date: string): Promise<SessionRow[]> {
    return tx(this.db, ["sessions"], "readonly", (transaction) =>
      req<SessionRow[]>(transaction.objectStore("sessions").index("date").getAll(date)),
    );
  }

  allSessions(): Promise<SessionRow[]> {
    return tx(this.db, ["sessions"], "readonly", (transaction) =>
      req<SessionRow[]>(transaction.objectStore("sessions").getAll()),
    );
  }

  dayStats(): Promise<DayStatRow[]> {
    return tx(this.db, ["dayStats"], "readonly", (transaction) =>
      req<DayStatRow[]>(transaction.objectStore("dayStats").getAll()),
    );
  }

  dayStatsForDate(date: string): Promise<DayStatRow | undefined> {
    return tx(this.db, ["dayStats"], "readonly", (transaction) =>
      req<DayStatRow | undefined>(transaction.objectStore("dayStats").get(date)),
    );
  }

  async earnedBlocksForDate(date: string): Promise<number> {
    return (await this.dayStatsForDate(date))?.earnedBlocks ?? 0;
  }

  async lastSession(): Promise<SessionRow | undefined> {
    return tx(this.db, ["sessions"], "readonly", (transaction) => {
      return new Promise<SessionRow | undefined>((resolve, reject) => {
        const request = transaction.objectStore("sessions").openCursor(null, "prev");
        request.onsuccess = () => resolve(request.result?.value as SessionRow | undefined);
        request.onerror = () => reject(request.error);
      });
    });
  }
}

export class CrewDao {
  constructor(private readonly db: IDBDatabase) {}

  upsertLatest(snapshot: CrewSnapshotRow, daily: CrewDailyRow[]): Promise<boolean> {
    return tx(this.db, ["crewSnapshots", "crewDailyAggregates"], "readwrite", async (transaction) => {
      const snapshots = transaction.objectStore("crewSnapshots");
      const aggregates = transaction.objectStore("crewDailyAggregates");
      const key = [snapshot.crewId, snapshot.identityPublicKey];
      const existing = await req<CrewSnapshotRow | undefined>(snapshots.get(key));
      if (existing !== undefined && existing.publishedAtEpochSeconds >= snapshot.publishedAtEpochSeconds) {
        return false;
      }
      await req(snapshots.put(snapshot));
      const oldDaily = await req<CrewDailyRow[]>(aggregates.index("crewId_key").getAll(key));
      for (const row of oldDaily) {
        await req(aggregates.delete([row.crewId, row.identityPublicKey, row.localDate]));
      }
      for (const row of daily) {
        await req(aggregates.put(row));
      }
      return true;
    });
  }

  snapshotsForCrew(crewId: string): Promise<CrewSnapshotRow[]> {
    return tx(this.db, ["crewSnapshots"], "readonly", (transaction) =>
      req<CrewSnapshotRow[]>(transaction.objectStore("crewSnapshots").index("crewId").getAll(crewId)),
    );
  }

  dailyFor(crewId: string, identityPublicKey: string): Promise<CrewDailyRow[]> {
    return tx(this.db, ["crewDailyAggregates"], "readonly", (transaction) =>
      req<CrewDailyRow[]>(
        transaction.objectStore("crewDailyAggregates").index("crewId_key").getAll([crewId, identityPublicKey]),
      ),
    );
  }

  setHidden(crewId: string, identityPublicKey: string, hiddenAtEpochSeconds: number): Promise<void> {
    return tx(this.db, ["crewHiddenMembers"], "readwrite", async (transaction) => {
      await req(
        transaction.objectStore("crewHiddenMembers").put({ crewId, identityPublicKey, hiddenAtEpochSeconds }),
      );
    });
  }

  unhide(crewId: string, identityPublicKey: string): Promise<void> {
    return tx(this.db, ["crewHiddenMembers"], "readwrite", (transaction) =>
      req(transaction.objectStore("crewHiddenMembers").delete([crewId, identityPublicKey])),
    );
  }

  async hiddenKeys(crewId: string): Promise<string[]> {
    const rows = await tx(this.db, ["crewHiddenMembers"], "readonly", (transaction) =>
      req<CrewHiddenRow[]>(transaction.objectStore("crewHiddenMembers").index("crewId").getAll(crewId)),
    );
    return rows.map((row) => row.identityPublicKey);
  }

  updateRelayState(
    crewId: string,
    relayUrl: string,
    attempt: number,
    success: number | null,
    error: string | null,
  ): Promise<void> {
    return tx(this.db, ["crewRelayState"], "readwrite", async (transaction) => {
      const store = transaction.objectStore("crewRelayState");
      const existing = await req<CrewRelayStateRow | undefined>(store.get([crewId, relayUrl]));
      const merged: CrewRelayStateRow = {
        crewId,
        relayUrl,
        lastAttemptEpochSeconds: attempt,
        lastSuccessEpochSeconds: success !== null ? success : (existing?.lastSuccessEpochSeconds ?? null),
        lastError: error !== null ? error : (existing?.lastError ?? null),
      };
      await req(store.put(merged));
    });
  }

  relayStates(crewId: string): Promise<CrewRelayStateRow[]> {
    return tx(this.db, ["crewRelayState"], "readonly", (transaction) =>
      req<CrewRelayStateRow[]>(
        transaction.objectStore("crewRelayState").getAll(IDBKeyRange.bound([crewId], [crewId, []])),
      ),
    );
  }

  deleteCrew(crewId: string): Promise<void> {
    return tx(
      this.db,
      ["crewSnapshots", "crewDailyAggregates", "crewHiddenMembers", "crewRelayState"],
      "readwrite",
      async (transaction) => {
        const snapshots = transaction.objectStore("crewSnapshots");
        for (const row of await req<CrewSnapshotRow[]>(snapshots.index("crewId").getAll(crewId))) {
          await req(snapshots.delete([row.crewId, row.identityPublicKey]));
        }
        const aggregates = transaction.objectStore("crewDailyAggregates");
        for (const row of await req<CrewDailyRow[]>(
          aggregates.index("crewId_key").getAll(IDBKeyRange.bound([crewId], [crewId, []])),
        )) {
          await req(aggregates.delete([row.crewId, row.identityPublicKey, row.localDate]));
        }
        const hidden = transaction.objectStore("crewHiddenMembers");
        for (const row of await req<CrewHiddenRow[]>(hidden.index("crewId").getAll(crewId))) {
          await req(hidden.delete([row.crewId, row.identityPublicKey]));
        }
        const relay = transaction.objectStore("crewRelayState");
        for (const row of await req<CrewRelayStateRow[]>(
          relay.getAll(IDBKeyRange.bound([crewId], [crewId, []])),
        )) {
          await req(relay.delete([row.crewId, row.relayUrl]));
        }
      },
    );
  }
}
