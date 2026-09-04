import { canAdopt } from "./adopt";
import {
  CONFIG_REFRESH_MS,
  CONFIG_RETRY_MS,
  EXTEND_SECONDS,
  OFFLINE_PROBE_MS,
  QUEUE_CAPACITY,
  RECONNECT_INTERVAL_MS,
  SOFT_RESYNC_MAX,
  SOURCE,
  STALE_AFTER_MS,
  UNPAIRED_RETRY_MS,
  type LinkMode,
} from "./constants";
import { pairingFromParsed, parsePairingPayload, phoneWsUrl, type Pairing } from "./pairing";
import {
  configBody,
  parsePhoneConfig,
  parsePhoneHistory,
  parsePhoneState,
  projectRemaining,
  shouldIgnoreSnapshot,
  type PhoneConfig,
  type PhoneHistorySession,
  type PhoneTimerState,
} from "./phoneState";
import { jsonOf, type RestPort, type RestResult, type SocketFactory, type SocketHandle } from "./rest";
import { SessionQueue, type QueuedPhase, type QueuedSession } from "./queue";

export interface LinkClock {
  epochSeconds(): number;
  monotonicMs(): number;
}

export interface LinkEngineView {
  status: string;
  phase: string;
  remaining: number;
  duration: number;
  startTime: number;
  completed: number;
  goal: number;
  tag: string;
  date: string;
}

export interface LinkEngineAdapter {
  localOwner: boolean;
  snapshot(): LinkEngineView;
  isLive(): boolean;
  follow(state: PhoneTimerState, remaining: number, date: string): void;
  setLocalOwner(owns: boolean): void;
  stampStartTime(): void;
}

export interface LinkPersist {
  host: string;
  port: number;
  token: string;
  nextSeq: number;
  queue: QueuedSession[];
  localOwner: boolean;
  linkRevision?: number;
}

export interface LinkStatus {
  mode: LinkMode;
  paired: boolean;
  host: string;
  port: number;
  message: string;
  queued: number;
  localOwner: boolean;
  revision: number;
}

export interface LinkHooks {
  persist(data: LinkPersist): void;
  applyConfig(config: PhoneConfig): void;
  applyHistory(sessions: PhoneHistorySession[]): void | Promise<void>;
  currentConfig(): PhoneConfig;
  onPhaseComplete?(phase: QueuedPhase): void;
  onChange?(): void;
}

export interface LinkDeps {
  rest: RestPort;
  connectSocket: SocketFactory;
  engine: LinkEngineAdapter;
  clock?: LinkClock;
  hooks: LinkHooks;
  persist?: LinkPersist | null;
}

const defaultClock: LinkClock = {
  epochSeconds: () => Math.floor(Date.now() / 1000),
  monotonicMs: () => Date.now(),
};

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export class PomoLink {
  mode: LinkMode = "BOOT";
  pairing: Pairing | null = null;
  message = "";
  everSynced = false;
  localOwner = true;

  private nextSeq = 1;
  private readonly queue: SessionQueue;
  private readonly rest: RestPort;
  private readonly connectSocket: SocketFactory;
  private readonly engine: LinkEngineAdapter;
  private readonly clock: LinkClock;
  private readonly hooks: LinkHooks;

  private socket: SocketHandle | null = null;
  private ignoreDisconnect = false;
  private enteringSync = false;
  private wsDroppedDuringEnter = false;
  private queueFlushPending = false;
  private pendingSyncState: PhoneTimerState | null = null;
  private softResyncCount = 0;
  private softResyncing = false;
  private lastContactAt = 0;
  private lastSocketContactAt = 0;
  private lastPollAt = 0;
  private retryStartedAt = 0;
  private retryDelayMs = 0;
  private lastConfigFetchAt = 0;
  private configFetchFailed = false;
  private historyPull: Promise<boolean> | null = null;
  private lastServerTime = 0;
  private hasFollowedState = false;
  private syncGen = 0;
  private statusRevision = 0;
  private logs: string[] = [];

  constructor(deps: LinkDeps) {
    this.rest = deps.rest;
    this.connectSocket = deps.connectSocket;
    this.engine = deps.engine;
    this.clock = deps.clock ?? defaultClock;
    this.hooks = deps.hooks;
    const stored = deps.persist;
    this.queue = new SessionQueue(undefined, stored?.queue ?? []);
    this.nextSeq = stored?.nextSeq ?? 1;
    this.statusRevision = stored?.linkRevision ?? 0;
    if (stored !== undefined && stored !== null && stored.host.length > 0 && stored.token.length > 0) {
      this.pairing = { host: stored.host, port: stored.port, token: stored.token };
      this.rest.configure(this.pairing);
    }
    this.localOwner = stored?.localOwner ?? true;
    this.engine.setLocalOwner(this.localOwner);
  }

  status(): LinkStatus {
    this.statusRevision += 1;
    return {
      mode: this.mode,
      paired: this.pairing !== null,
      host: this.pairing?.host ?? "",
      port: this.pairing?.port ?? 0,
      message: this.message,
      queued: this.queue.count(),
      localOwner: this.localOwner,
      revision: this.statusRevision,
    };
  }

  persistState(): LinkPersist {
    return {
      host: this.pairing?.host ?? "",
      port: this.pairing?.port ?? 0,
      token: this.pairing?.token ?? "",
      nextSeq: this.nextSeq,
      queue: this.queue.toRows(),
      localOwner: this.localOwner,
      linkRevision: this.statusRevision,
    };
  }

  phoneCommandsActive(): boolean {
    if (this.pairing === null) return false;
    if (this.mode === "SYNCED") return true;
    return this.everSynced && !this.localOwner && this.mode === "CONNECTING";
  }

  applyPairing(payload: unknown): boolean {
    const parsed = parsePairingPayload(payload);
    const next = pairingFromParsed(parsed, this.pairing);
    if (next === null) {
      if (parsed.token !== undefined && parsed.token.length === 0) {
        this.clearPairing("empty token");
        return true;
      }
      return false;
    }
    this.pairing = next;
    this.rest.configure(next);
    this.message = "";
    this.save();
    this.retryDelayMs = 0;
    if (this.mode === "UNPAIRED" || this.mode === "OFFLINE" || this.mode === "BOOT") {
      this.setMode("DISCOVERING");
    } else if (this.mode === "SYNCED" || this.mode === "CONNECTING") {
      this.everSynced = false;
      this.beginWebsocket("pairing changed");
    }
    this.hooks.onChange?.();
    return true;
  }

  unpair(): void {
    this.clearPairing("unpaired");
  }

  enqueueCompleted(type: QueuedPhase, durationSec: number, startEpoch: number, tag: string): void {
    if (!this.localOwner) return;
    const seq = this.nextSeq;
    this.nextSeq += 1;
    if (!Number.isSafeInteger(this.nextSeq) || this.nextSeq <= 0) this.nextSeq = 1;
    const clientId = `chrome-${seq.toString(16).padStart(4, "0")}`;
    const start = startEpoch > 0 ? startEpoch : Math.max(0, this.clock.epochSeconds() - Math.floor(durationSec));
    const wasFull = this.queue.count() >= QUEUE_CAPACITY;
    const queued = this.queue.enqueue(clientId, type, durationSec, start, tag);
    if (!queued) this.log(`enqueue rejected id=${clientId} type=${type} duration=${durationSec}`);
    else if (wasFull) this.log("queue full; oldest session dropped");
    this.save();
  }

  async start(): Promise<void> {
    if (this.pairing === null) {
      this.enterUnpaired("no token");
      return;
    }
    this.setMode("DISCOVERING");
    await this.tick();
  }

  async tick(): Promise<void> {
    const now = this.clock.monotonicMs();
    if (this.mode === "BOOT") {
      if (this.pairing === null) this.enterUnpaired("no token");
      else this.setMode("DISCOVERING");
    }
    if (this.mode === "DISCOVERING") {
      await this.tickDiscovery();
      return;
    }
    if (this.mode === "OFFLINE") {
      if (this.pairing !== null) {
        if (this.lastPollAt === 0 || now - this.lastPollAt >= OFFLINE_PROBE_MS) {
          this.lastPollAt = now;
          if (await this.fetchStatus()) {
            this.log("phone reachable while OFFLINE -> reconnect");
            this.retryDelayMs = 0;
            this.setMode("DISCOVERING");
            await this.tickDiscovery();
            return;
          }
        }
      }
      if (this.retryDelayMs > 0 && now - this.retryStartedAt >= this.retryDelayMs) {
        this.retryDelayMs = 0;
        this.setMode("DISCOVERING");
      }
      return;
    }
    if (this.mode === "UNPAIRED") {
      if (this.pairing !== null && now - this.retryStartedAt >= this.retryDelayMs) {
        this.retryDelayMs = 0;
        this.setMode("DISCOVERING");
      }
      return;
    }
    if (this.mode === "CONNECTING" && this.queueFlushPending && this.pendingSyncState !== null) {
      if (!this.retryDelayMs || now - this.retryStartedAt >= this.retryDelayMs) {
        await this.enterSyncFromPhoneState(this.pendingSyncState);
      }
      return;
    }
    if (this.mode === "SYNCED" && !this.enteringSync) {
      await this.tickConfigRefresh();
    }
    if (this.enteringSync) return;
    if (this.lastSocketContactAt > 0 && now - this.lastSocketContactAt >= STALE_AFTER_MS) {
      if (this.mode === "SYNCED" || this.mode === "CONNECTING") {
        this.log("heartbeat stale");
        await this.softResync("stale socket");
      }
    }
  }

  async sendGesture(command: "toggle" | "skip" | "reset" | "extend", seconds?: number): Promise<boolean> {
    if (!this.phoneCommandsActive()) return false;
    if (command === "extend") {
      return this.postCommand("/api/extend", { seconds_delta: seconds ?? EXTEND_SECONDS });
    }
    return this.postCommand(`/api/${command}`, "");
  }

  async pushConfig(config: PhoneConfig): Promise<boolean> {
    if (!this.phoneCommandsActive()) return false;
    return this.postCommand("/api/config", configBody(config));
  }

  private log(text: string): void {
    this.logs.push(text);
    if (this.logs.length > 50) this.logs = this.logs.slice(-50);
  }

  drainLogs(): string[] {
    const lines = this.logs;
    this.logs = [];
    return lines;
  }

  private save(): void {
    this.hooks.persist(this.persistState());
  }

  private setMode(next: LinkMode): void {
    if (this.mode === next) return;
    const prev = this.mode;
    this.mode = next;
    this.log(`mode ${prev} -> ${next}`);
    if (next === "OFFLINE" || next === "UNPAIRED") {
      this.localOwner = true;
      this.engine.setLocalOwner(true);
    } else if (next === "SYNCED") {
      this.localOwner = false;
      this.engine.setLocalOwner(false);
    }
    this.save();
    this.hooks.onChange?.();
  }

  private clearPairing(reason: string): void {
    this.pairing = null;
    this.enterUnpaired(reason);
    this.save();
  }

  private disconnectWs(): void {
    this.ignoreDisconnect = true;
    try {
      this.socket?.close();
    } finally {
      this.socket = null;
      this.ignoreDisconnect = false;
    }
  }

  private enterOffline(reason: string): void {
    if (this.mode === "OFFLINE") return;
    this.log(`leave SYNC/probe -> OFFLINE: ${reason}`);
    this.enteringSync = false;
    this.wsDroppedDuringEnter = false;
    this.softResyncCount = 0;
    this.queueFlushPending = false;
    this.pendingSyncState = null;
    this.lastPollAt = 0;
    this.message = reason;
    this.retryStartedAt = this.clock.monotonicMs();
    this.retryDelayMs = RECONNECT_INTERVAL_MS;
    this.setMode("OFFLINE");
    this.disconnectWs();
  }

  private enterUnpaired(reason: string): void {
    if (this.mode === "UNPAIRED") {
      this.message = reason;
      return;
    }
    this.log(`token rejected -> UNPAIRED: ${reason}`);
    this.enteringSync = false;
    this.wsDroppedDuringEnter = false;
    this.softResyncCount = 0;
    this.queueFlushPending = false;
    this.pendingSyncState = null;
    this.retryStartedAt = this.clock.monotonicMs();
    this.retryDelayMs = UNPAIRED_RETRY_MS;
    this.message = reason;
    this.setMode("UNPAIRED");
    this.disconnectWs();
  }

  private beginWebsocket(reason: string): boolean {
    this.log(`begin WebSocket (${reason})`);
    this.disconnectWs();
    if (this.pairing === null) {
      this.enterUnpaired("missing host/token");
      return false;
    }
    this.rest.configure(this.pairing);
    const pairing = this.pairing;
    try {
      this.socket = this.connectSocket(phoneWsUrl(pairing), {
        onOpen: () => {
          this.socket?.send(JSON.stringify({ type: "hello", token: pairing.token }));
          const now = this.clock.monotonicMs();
          this.lastContactAt = now;
          this.lastSocketContactAt = now;
          this.log("WS connected, hello sent");
        },
        onMessage: (text) => {
          void this.onWebsocketText(text);
        },
        onClose: () => {
          void this.onWebsocketDisconnected();
        },
      });
    } catch (error) {
      this.log(`WS connect failed: ${String(error)}`);
      const now = this.clock.monotonicMs();
      this.lastContactAt = now;
      this.lastSocketContactAt = now;
      this.setMode("CONNECTING");
      return false;
    }
    const now = this.clock.monotonicMs();
    this.lastContactAt = now;
    this.lastSocketContactAt = now;
    this.retryDelayMs = 0;
    this.setMode("CONNECTING");
    return true;
  }

  private applyStatusResult(result: RestResult, origin: string): boolean {
    if (result.status === 200) return true;
    if (result.status === 401) {
      this.enterUnpaired(`GET /api/status ${origin}`);
      return false;
    }
    if (result.status === 429) {
      this.log(`GET /api/status 429 (${origin}), retry`);
      this.retryStartedAt = this.clock.monotonicMs();
      this.retryDelayMs = RECONNECT_INTERVAL_MS;
      return false;
    }
    if (result.status === 0) {
      this.enterOffline("GET /api/status timed out");
      return false;
    }
    this.enterOffline(`GET /api/status HTTP ${result.status}`);
    return false;
  }

  private async tickDiscovery(): Promise<void> {
    const now = this.clock.monotonicMs();
    if (this.retryDelayMs > 0 && now - this.retryStartedAt < this.retryDelayMs) return;
    if (this.pairing === null) {
      this.enterUnpaired("no token");
      return;
    }
    this.log(`using configured host ${this.pairing.host}:${this.pairing.port}`);
    this.rest.configure(this.pairing);
    const result = await this.rest.getStatus();
    if (!this.applyStatusResult(result, "discovery")) return;
    this.beginWebsocket("discovery");
  }

  private async fetchStatus(): Promise<boolean> {
    if (this.pairing === null) return false;
    const result = await this.rest.getStatus();
    if (!this.applyStatusResult(result, "probe")) return false;
    if (this.mode === "SYNCED") {
      const data = parsePhoneState(jsonOf(result));
      if (data !== null) this.applyPhoneObject(data, false);
    }
    return true;
  }

  private applyPhoneObject(data: PhoneTimerState, force: boolean): boolean {
    const epochNow = this.clock.epochSeconds();
    const remaining = projectRemaining(data, epochNow);
    const view = this.engine.snapshot();
    const sameSession =
      this.hasFollowedState && data.start_time > 0 && view.startTime === data.start_time && view.phase === data.phase;
    if (
      shouldIgnoreSnapshot({
        force,
        localOwner: this.localOwner,
        hasState: this.hasFollowedState,
        sameSession,
        lastServerTime: this.lastServerTime,
        incoming: data,
        projectedRemaining: remaining,
        currentRemaining: view.remaining,
        currentDuration: view.duration,
      })
    ) {
      this.log("state frame ignored (stale/out-of-order)");
      return false;
    }
    const date = data.date ?? view.date;
    this.engine.follow(data, remaining, date);
    this.hasFollowedState = true;
    if (data.server_time > 0) this.lastServerTime = data.server_time;
    else if (!sameSession) this.lastServerTime = 0;
    this.hooks.onChange?.();
    return true;
  }

  private async onWebsocketText(payload: string): Promise<void> {
    if (this.mode === "UNPAIRED") return;
    let doc: unknown;
    try {
      doc = JSON.parse(payload) as unknown;
    } catch {
      this.log("bad frame");
      return;
    }
    const record = asObject(doc);
    if (record === null) return;
    const now = this.clock.monotonicMs();
    this.lastContactAt = now;
    this.lastSocketContactAt = now;
    const frameType = String(record.type ?? "");
    if (frameType === "state") {
      const data = parsePhoneState(record.data);
      if (data === null) return;
      if (this.mode === "SYNCED") {
        this.applyPhoneObject(data, false);
        return;
      }
      if (this.mode === "CONNECTING" && !this.enteringSync) {
        this.pendingSyncState = data;
        if (this.queueFlushPending) return;
        if (this.everSynced && !this.localOwner) {
          this.applyPhoneObject(data, true);
          this.softResyncCount = 0;
          this.setMode("SYNCED");
          this.log("soft resync complete -> SYNCED");
          void this.pullHistory();
          return;
        }
        await this.enterSyncFromPhoneState(data);
      }
      return;
    }
    if (frameType === "event") {
      if (this.mode !== "SYNCED") return;
      if (record.event === "phase_complete") {
        const phase = record.phase;
        if (phase === "work" || phase === "short" || phase === "long") {
          this.hooks.onPhaseComplete?.(phase);
        }
        void this.pullHistory();
      }
    }
  }

  private async onWebsocketDisconnected(): Promise<void> {
    if (this.ignoreDisconnect || this.softResyncing) return;
    if (this.mode === "UNPAIRED" || this.mode === "OFFLINE") return;
    if (this.enteringSync) {
      this.wsDroppedDuringEnter = true;
      this.log("WS drop during enter-SYNC pipeline (deferred)");
      return;
    }
    if (this.mode === "SYNCED") {
      this.log("WS drop while SYNCED -> soft resync");
      await this.softResync("ws disconnected");
      return;
    }
    if (this.mode !== "CONNECTING") return;
    this.log("WS drop while CONNECTING — token/reachability probe");
    const result = await this.rest.getStatus();
    if (result.status === 401) {
      this.enterUnpaired("ws drop 401");
      return;
    }
    if (result.status === 200) {
      if (this.everSynced && !this.localOwner) await this.softResync("ws drop phone up");
      else if (this.softResyncCount < SOFT_RESYNC_MAX) {
        this.softResyncCount += 1;
        this.beginWebsocket("ws drop retry");
      } else this.enterOffline("ws connect failed");
      return;
    }
    this.log(`WS drop CONNECTING REST code=${result.status}`);
  }

  private async softResync(reason: string): Promise<boolean> {
    if (this.softResyncing) return false;
    if (this.pairing === null) {
      this.enterOffline(reason);
      return false;
    }
    if (this.softResyncCount >= SOFT_RESYNC_MAX) {
      this.enterOffline("soft resync budget");
      return false;
    }
    this.softResyncing = true;
    const result = await this.rest.getStatus();
    if (result.status === 401) {
      this.softResyncing = false;
      this.enterUnpaired("soft resync 401");
      return false;
    }
    if (result.status !== 200) {
      this.softResyncing = false;
      this.enterOffline(reason);
      return false;
    }
    this.softResyncCount += 1;
    this.enteringSync = false;
    this.wsDroppedDuringEnter = false;
    this.localOwner = false;
    this.engine.setLocalOwner(false);
    this.log(`soft resync #${this.softResyncCount}: ${reason}`);
    const ok = this.beginWebsocket("soft resync");
    this.softResyncing = false;
    return ok;
  }

  private async enterSyncFromPhoneState(data: PhoneTimerState): Promise<void> {
    const gen = ++this.syncGen;
    this.enteringSync = true;
    this.log("enter SYNC pipeline start");
    const phoneStopped = data.status === "stopped";
    const deskLive = this.engine.isLive() && (this.localOwner || !this.everSynced);

    const flushOk = await this.flushSessionQueue();
    if (gen !== this.syncGen) return;
    this.log(`flush result=${flushOk ? "ok" : "failed"}`);
    if (this.mode === "UNPAIRED") {
      this.enteringSync = false;
      return;
    }
    if (!flushOk) {
      this.queueFlushPending = true;
      this.pendingSyncState = data;
      this.retryStartedAt = this.clock.monotonicMs();
      this.retryDelayMs = RECONNECT_INTERVAL_MS;
      this.enteringSync = false;
      this.message = "session import incomplete";
      this.log("session import incomplete; staying CONNECTING");
      this.hooks.onChange?.();
      return;
    }
    this.queueFlushPending = false;

    if (deskLive) {
      this.log("desk live -> try adopt");
      const adoptResult = await this.tryAdoptLocalTimer();
      if (gen !== this.syncGen) return;
      if (this.status().mode === "UNPAIRED") {
        this.enteringSync = false;
        return;
      }
      if (adoptResult < 0) {
        if (phoneStopped) {
          this.enteringSync = false;
          this.enterOffline("adopt transport fail");
          return;
        }
        this.applyPhoneObject(data, true);
      } else if (adoptResult === 0) {
        this.applyPhoneObject(data, true);
      }
    } else {
      this.applyPhoneObject(data, true);
    }

    this.configFetchFailed = false;
    this.lastConfigFetchAt = this.clock.monotonicMs();
    this.log("config fetch deferred until SYNC is stable");
    this.everSynced = true;
    this.enteringSync = false;
    this.softResyncCount = 0;
    this.pendingSyncState = null;
    this.lastContactAt = this.clock.monotonicMs();
    this.setMode("SYNCED");
    this.message = "";
    this.log("enter SYNC pipeline done -> SYNCED");
    await this.pullHistory();
    if (this.wsDroppedDuringEnter) {
      this.wsDroppedDuringEnter = false;
      await this.softResync("ws drop during enter");
    }
  }

  private async flushSessionQueue(): Promise<boolean> {
    if (this.queue.empty()) return true;
    if (this.pairing === null) return false;
    this.queue.stripImplausibleStarts(this.clock.epochSeconds());
    const body = {
      source: SOURCE,
      sessions: this.queue.toRows(),
    };
    this.log(`flush POST /api/sessions/import count=${this.queue.count()}`);
    const result = await this.rest.post("/api/sessions/import", body);
    if (result.status === 401) {
      this.enterUnpaired("/api/sessions/import");
      return false;
    }
    if (result.status !== 200) return false;
    const resp = asObject(jsonOf(result));
    if (resp === null) return false;
    const accepted = resp.accepted;
    if (!Array.isArray(accepted)) return false;
    const terminal: string[] = [];
    for (const item of accepted) {
      if (typeof item === "string" && item.length > 0) terminal.push(item);
    }
    const rejected = resp.rejected;
    if (Array.isArray(rejected)) {
      for (const row of rejected) {
        const rec = asObject(row);
        if (rec === null) continue;
        const cid = String(rec.client_id ?? "");
        this.log(`flush row rejected id=${cid} err=${String(rec.error ?? "")}`);
        if (cid.length > 0) terminal.push(cid);
      }
    }
    this.queue.dropByClientId(terminal);
    this.save();
    if (!this.queue.empty()) return false;
    return true;
  }

  private async tryAdoptLocalTimer(): Promise<number> {
    if (this.pairing === null) return -1;
    this.engine.stampStartTime();
    const view = this.engine.snapshot();
    const duration = view.duration > 0 ? view.duration : Math.max(view.remaining, 1);
    const remaining = Math.min(duration, Math.max(0, view.remaining));
    const body = {
      status: view.status,
      phase: view.phase,
      remaining,
      duration,
      start_time: view.startTime,
      completed: view.completed,
      daily_goal: view.goal,
      tag: view.tag,
    };
    this.log("POST /api/timer/adopt");
    const result = await this.rest.post("/api/timer/adopt", body);
    if (result.status === 401) {
      this.enterUnpaired("/api/timer/adopt");
      return -1;
    }
    if (result.status === 0) return -1;
    const resp = asObject(jsonOf(result));
    const phoneState = resp !== null ? parsePhoneState(resp.state) : null;
    if (result.status === 409) {
      this.log("adopt result=409 timer_busy");
      if (phoneState !== null) {
        this.applyPhoneObject(phoneState, true);
        return 1;
      }
      return 0;
    }
    if (result.status !== 200) {
      this.log(`adopt result=http_${result.status} (snap)`);
      return 0;
    }
    if (resp === null || resp.success !== true) return 0;
    if (phoneState !== null) this.applyPhoneObject(phoneState, true);
    else {
      const local: PhoneTimerState = {
        status: view.status as PhoneTimerState["status"],
        phase: view.phase as PhoneTimerState["phase"],
        remaining,
        duration,
        start_time: view.startTime,
        completed: view.completed,
        daily_goal: view.goal,
        tag: view.tag,
        date: view.date,
        server_time: 0,
      };
      this.applyPhoneObject(local, true);
    }
    this.log("adopt result=ok");
    return 1;
  }

  private async tickConfigRefresh(): Promise<void> {
    const now = this.clock.monotonicMs();
    const every = this.configFetchFailed ? CONFIG_RETRY_MS : CONFIG_REFRESH_MS;
    if (this.lastConfigFetchAt > 0 && now - this.lastConfigFetchAt < every) return;
    this.lastConfigFetchAt = now;
    if (await this.fetchAndCacheConfig()) this.configFetchFailed = false;
    else {
      this.configFetchFailed = true;
      this.log("config refresh failed; will retry");
    }
    await this.pullHistory();
  }

  private async fetchAndCacheConfig(): Promise<boolean> {
    if (this.pairing === null) return false;
    const result = await this.rest.getConfig();
    if (result.status === 401) {
      this.enterUnpaired("GET /api/config");
      return false;
    }
    if (result.status !== 200) return false;
    const config = parsePhoneConfig(jsonOf(result), this.hooks.currentConfig());
    if (config === null) return false;
    this.hooks.applyConfig(config);
    this.log(
      `config cached ${config.workMinutes}/${config.shortMinutes}/${config.longMinutes} after=${config.longBreakAfter} goal=${config.dailyGoal}`,
    );
    return true;
  }

  private pullHistory(): Promise<boolean> {
    if (this.historyPull !== null) return this.historyPull;
    const operation = this.pullHistoryOnce().finally(() => {
      this.historyPull = null;
    });
    this.historyPull = operation;
    return operation;
  }

  private async pullHistoryOnce(): Promise<boolean> {
    if (this.pairing === null) return false;
    const result = await this.rest.getHistory();
    if (result.status === 401) {
      this.enterUnpaired("GET /api/history");
      return false;
    }
    if (result.status !== 200) {
      this.log(`history pull failed; http ${result.status}`);
      return false;
    }
    const sessions = parsePhoneHistory(jsonOf(result));
    if (sessions === null) {
      this.log("history pull failed; malformed payload");
      return false;
    }
    await this.hooks.applyHistory(sessions);
    this.log(`history pulled sessions=${sessions.length}`);
    return true;
  }

  async refreshHistory(): Promise<void> {
    if (this.mode !== "SYNCED") return;
    if (this.historyPull !== null) {
      await this.historyPull;
      if (this.mode !== "SYNCED") return;
      await this.pullHistory();
      return;
    }
    await this.pullHistory();
  }

  private async postCommand(path: string, body: unknown): Promise<boolean> {
    const result = await this.rest.post(path, body);
    if (result.status === 401) {
      this.enterUnpaired(path);
      return false;
    }
    if (result.status === 200) {
      const doc = asObject(jsonOf(result));
      const state = doc !== null ? parsePhoneState(doc.state) : null;
      if (doc?.success === true && state !== null) this.applyPhoneObject(state, true);
      return true;
    }
    if (result.status !== 0) this.log(`${path} failed, code ${result.status}`);
    return false;
  }

  /** Exposed for tests that want to inject a phone state frame. */
  deliverFrame(text: string): Promise<void> {
    return this.onWebsocketText(text);
  }

  /** Phone-side helper used by tests that already have parsed phone/payload clocks. */
  static wouldAdopt(phone: PhoneTimerState, payload: LinkEngineView): boolean {
    return canAdopt(
      { status: phone.status, phase: phone.phase, remaining: phone.remaining, start_time: phone.start_time },
      {
        status: payload.status,
        phase: payload.phase,
        remaining: payload.remaining,
        start_time: payload.startTime,
      },
    );
  }
}
