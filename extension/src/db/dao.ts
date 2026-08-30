import { isValidDateString } from "../engine/dateLogic";
import type { DayStatRow, SessionRow } from "./types";

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
  let operationError: unknown;
  const done = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(operationError ?? transaction.error);
  });
  let result: Promise<T>;
  try {
    result = Promise.resolve(fn(transaction));
  } catch (error) {
    operationError = error;
    try {
      transaction.abort();
    } catch {
      // The transaction may already have completed or aborted.
    }
    return Promise.reject(error);
  }
  result.catch((error: unknown) => {
    operationError = error;
    try {
      transaction.abort();
    } catch {
      // The transaction may already have completed or aborted.
    }
  });
  return done.then(() => result);
}

export class HistoryDao {
  constructor(private readonly db: IDBDatabase) {}

  /**
   * Persists a whole session block (all of its calendar-day segments) in one
   * transaction. Idempotent: a segment whose `start` key already exists is
   * treated as a replay and its daily delta is not applied again, so a
   * duplicated completion can never double-count stats. Day stats are
   * accumulated once per date, regardless of how many segments share it.
   * Resolves with the `start` keys of segments that were newly inserted.
   */
  insertBlock(
    segments: Array<{ row: SessionRow; delta: { earnedBlocks: number; focusMinutes: number; breakMinutes: number } }>,
  ): Promise<number[]> {
    return tx(this.db, ["sessions", "dayStats"], "readwrite", async (transaction) => {
      const sessionsStore = transaction.objectStore("sessions");
      const dayStatsStore = transaction.objectStore("dayStats");
      const deltasByDate = new Map<string, { earnedBlocks: number; focusMinutes: number; breakMinutes: number }>();
      const insertedStarts: number[] = [];
      for (const { row } of segments) {
        if (!Number.isSafeInteger(row.start) || row.start <= 0 || !isValidDateString(row.date) || !Number.isFinite(row.duration) || row.duration < 0) {
          throw new Error(`invalid session row: ${String(row.start)} ${String(row.date)}`);
        }
      }
      for (const { row, delta } of segments) {
        const existing = await req<SessionRow | undefined>(sessionsStore.get(row.start));
        if (existing !== undefined) continue;
        await req(sessionsStore.put(row));
        insertedStarts.push(row.start);
        const accumulated = deltasByDate.get(row.date) ?? { earnedBlocks: 0, focusMinutes: 0, breakMinutes: 0 };
        accumulated.earnedBlocks += Math.max(0, delta.earnedBlocks);
        accumulated.focusMinutes += Math.max(0, delta.focusMinutes);
        accumulated.breakMinutes += Math.max(0, delta.breakMinutes);
        deltasByDate.set(row.date, accumulated);
      }
      for (const [date, delta] of deltasByDate) {
        const existing = await req<DayStatRow | undefined>(dayStatsStore.get(date));
        const merged: DayStatRow =
          existing === undefined
            ? {
                date,
                earnedBlocks: delta.earnedBlocks,
                focusMinutes: delta.focusMinutes,
                breakMinutes: delta.breakMinutes,
                lastUpdated: Date.now(),
              }
            : {
                date,
                earnedBlocks: existing.earnedBlocks + delta.earnedBlocks,
                focusMinutes: existing.focusMinutes + delta.focusMinutes,
                breakMinutes: existing.breakMinutes + delta.breakMinutes,
                lastUpdated: Date.now(),
              };
        await req(dayStatsStore.put(merged));
      }
      return insertedStarts;
    });
  }

  async insertSessionWithDayStats(
    row: SessionRow,
    delta: { earnedBlocks: number; focusMinutes: number; breakMinutes: number },
  ): Promise<void> {
    await this.insertBlock([{ row, delta }]);
  }

  insertSession(row: SessionRow): Promise<void> {
    return tx(this.db, ["sessions"], "readwrite", async (transaction) => {
      await req(transaction.objectStore("sessions").put(row));
    });
  }

  mergeBackup(
    backupDayStats: DayStatRow[],
    backupSessions: SessionRow[],
  ): Promise<{ sessionsAdded: number; daysAffected: number; conflicts: number }> {
    return tx(this.db, ["sessions", "dayStats"], "readwrite", async (transaction) => {
      const sessionsStore = transaction.objectStore("sessions");
      const dayStatsStore = transaction.objectStore("dayStats");
      const existingSessions = await req<SessionRow[]>(sessionsStore.getAll());
      const existingDayStats = await req<DayStatRow[]>(dayStatsStore.getAll());
      const byStart = new Map(existingSessions.map((row) => [row.start, row]));
      const addedSessions: SessionRow[] = [];
      let sessionsAdded = 0;
      let conflicts = 0;
      const payloadStarts = new Set<number>();
      for (const row of backupSessions) {
        if (payloadStarts.has(row.start)) {
          // Duplicate start within the backup payload: the first occurrence
          // wins and every later one is rejected and surfaced as a conflict.
          conflicts++;
          continue;
        }
        const existing = byStart.get(row.start);
        if (existing !== undefined) {
          // The local row wins; any difference across the full row is surfaced.
          if (
            existing.date !== row.date ||
            existing.type !== row.type ||
            existing.duration !== row.duration ||
            existing.completed !== row.completed ||
            existing.tag !== row.tag
          ) {
            conflicts++;
          }
          continue;
        }
        byStart.set(row.start, row);
        payloadStarts.add(row.start);
        addedSessions.push(row);
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
      // Merge policy: take the max of each metric across session-derived, local,
      // and backup totals. This never decreases recorded totals, but a row may
      // combine fields that no single source produced (documented tradeoff).
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

      for (const row of addedSessions) await req(sessionsStore.put(row));
      const changedDays = mergedDays.filter((row) => {
        const old = oldByDate.get(row.date);
        return (
          old === undefined ||
          old.earnedBlocks !== row.earnedBlocks ||
          old.focusMinutes !== row.focusMinutes ||
          old.breakMinutes !== row.breakMinutes
        );
      });
      for (const row of changedDays) await req(dayStatsStore.put(row));
      return { sessionsAdded, daysAffected: changedDays.length, conflicts };
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
