import { IMPORT_MAX_AGE_S, IMPORT_MAX_FUTURE_S, QUEUE_CAPACITY } from "./constants";

export type QueuedPhase = "work" | "short" | "long";

export interface QueuedSession {
  client_id: string;
  type: QueuedPhase;
  duration: number;
  completed: true;
  start?: number;
  tag?: string;
}

const PHASES = new Set<string>(["work", "short", "long"]);

function asPhase(value: unknown): QueuedPhase | null {
  return typeof value === "string" && PHASES.has(value) ? (value as QueuedPhase) : null;
}

export function parseQueuedSession(row: unknown): QueuedSession | null {
  if (typeof row !== "object" || row === null) return null;
  const record = row as Record<string, unknown>;
  const clientId = String(record.client_id ?? "");
  const type = asPhase(record.type);
  const duration = Number(record.duration);
  if (clientId.length === 0 || type === null || !Number.isInteger(duration) || duration <= 0) return null;
  const item: QueuedSession = { client_id: clientId, type, duration, completed: true };
  if (record.start !== undefined && record.start !== null) {
    const start = Number(record.start);
    if (Number.isInteger(start) && start > 0) item.start = start;
  }
  const tag = String(record.tag ?? "");
  if (tag.length > 0) item.tag = tag;
  return item;
}

export class SessionQueue {
  items: QueuedSession[] = [];

  constructor(
    private readonly capacity = QUEUE_CAPACITY,
    rows: unknown[] = [],
  ) {
    this.load(rows);
  }

  load(rows: unknown[]): void {
    this.items = [];
    for (const row of rows) {
      if (this.items.length >= this.capacity) break;
      const item = parseQueuedSession(row);
      if (item !== null) this.items.push(item);
    }
  }

  count(): number {
    return this.items.length;
  }

  empty(): boolean {
    return this.items.length === 0;
  }

  at(index: number): QueuedSession | undefined {
    return this.items[index];
  }

  toRows(): QueuedSession[] {
    return this.items.map((item) => {
      const row: QueuedSession = {
        client_id: item.client_id,
        type: item.type,
        duration: item.duration,
        completed: true,
      };
      if (item.start !== undefined && item.start > 0) row.start = item.start;
      if (item.tag !== undefined && item.tag.length > 0) row.tag = item.tag;
      return row;
    });
  }

  enqueue(clientId: string, type: QueuedPhase, durationSec: number, startEpoch: number | null, tag = ""): boolean {
    if (clientId.length === 0) return false;
    if (asPhase(type) === null) return false;
    const duration = Math.floor(durationSec);
    if (!Number.isInteger(duration) || duration <= 0) return false;
    if (this.items.length >= this.capacity) this.dropOldest();
    const item: QueuedSession = { client_id: clientId, type, duration, completed: true };
    if (startEpoch !== null && Number.isInteger(startEpoch) && startEpoch >= 0) item.start = startEpoch;
    if (tag.length > 0) item.tag = tag;
    this.items.push(item);
    return true;
  }

  dropOldest(): void {
    if (this.items.length > 0) this.items.shift();
  }

  dropByClientId(clientIds: string[]): number {
    if (clientIds.length === 0 || this.items.length === 0) return 0;
    const drop = new Set(clientIds);
    const kept: QueuedSession[] = [];
    let dropped = 0;
    for (const item of this.items) {
      if (drop.has(item.client_id)) {
        dropped += 1;
        continue;
      }
      kept.push(item);
    }
    this.items = kept;
    return dropped;
  }

  stripImplausibleStarts(nowEpoch: number): number {
    if (!Number.isInteger(nowEpoch) || nowEpoch <= 0 || this.items.length === 0) return 0;
    const maxFuture = nowEpoch + IMPORT_MAX_FUTURE_S;
    const minStart = nowEpoch - IMPORT_MAX_AGE_S;
    let stripped = 0;
    for (const item of this.items) {
      if (item.start === undefined) continue;
      if (item.start > maxFuture || item.start < minStart) {
        delete item.start;
        stripped += 1;
      }
    }
    return stripped;
  }
}
