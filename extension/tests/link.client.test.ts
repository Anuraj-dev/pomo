import { describe, expect, test } from "bun:test";
import { PomoLink, type LinkEngineAdapter, type LinkEngineView, type LinkPersist } from "../src/link/client";
import type { PhoneConfig, PhoneHistorySession, PhoneTimerState } from "../src/link/phoneState";
import type { RestPort, RestResult, SocketFactory, SocketHandle } from "../src/link/rest";

class FakeEngine implements LinkEngineAdapter {
  localOwner = true;
  view: LinkEngineView = {
    status: "stopped",
    phase: "work",
    remaining: 1500,
    duration: 1500,
    startTime: 0,
    completed: 0,
    goal: 8,
    tag: "Work",
    date: "2026-08-30",
  };

  snapshot(): LinkEngineView {
    return { ...this.view };
  }

  isLive(): boolean {
    return this.view.status === "running" || this.view.status === "paused";
  }

  follow(state: PhoneTimerState, remaining: number, date: string): void {
    this.view = {
      status: state.status,
      phase: state.phase,
      remaining,
      duration: state.duration,
      startTime: state.start_time,
      completed: state.completed,
      goal: state.daily_goal,
      tag: state.tag,
      date,
    };
  }

  setLocalOwner(owns: boolean): void {
    this.localOwner = owns;
  }

  stampStartTime(): void {
    if (this.isLive() && this.view.startTime <= 0) this.view.startTime = 1_800_000_000;
  }
}

class FakeRest implements RestPort {
  routes = new Map<string, RestResult>();
  posts: Array<{ path: string; body: unknown }> = [];
  gets: string[] = [];

  configure(): void {}

  getStatus(): Promise<RestResult> {
    return Promise.resolve(this.routes.get("GET /api/status") ?? { status: 0, body: "" });
  }

  getConfig(): Promise<RestResult> {
    return Promise.resolve(this.routes.get("GET /api/config") ?? { status: 0, body: "" });
  }

  getHistory(): Promise<RestResult> {
    this.gets.push("/api/history");
    return Promise.resolve(this.routes.get("GET /api/history") ?? { status: 0, body: "" });
  }

  post(path: string, body?: unknown): Promise<RestResult> {
    this.posts.push({ path, body });
    return Promise.resolve(this.routes.get(`POST ${path}`) ?? { status: 0, body: "" });
  }
}

function phoneState(overrides: Partial<PhoneTimerState> = {}): PhoneTimerState {
  return {
    status: "stopped",
    phase: "work",
    remaining: 1500,
    duration: 1500,
    start_time: 0,
    completed: 2,
    daily_goal: 8,
    tag: "Work",
    date: "2026-08-30",
    server_time: 1_800_000_000,
    ...overrides,
  };
}

function json(status: number, value: unknown): RestResult {
  return { status, body: JSON.stringify(value) };
}

function makeLink(opts?: { persist?: LinkPersist | null; rest?: FakeRest }) {
  const rest = opts?.rest ?? new FakeRest();
  const engine = new FakeEngine();
  const persisted: LinkPersist[] = [];
  const configs: PhoneConfig[] = [];
  const histories: PhoneHistorySession[][] = [];
  let socket: SocketHandle | null = null;
  let handlers: { onOpen: () => void; onMessage: (text: string) => void; onClose: () => void } | null = null;
  const connectSocket: SocketFactory = (_url, nextHandlers) => {
    handlers = nextHandlers;
    socket = {
      send: () => undefined,
      close: () => undefined,
    };
    queueMicrotask(() => nextHandlers.onOpen());
    return socket;
  };
  const link = new PomoLink({
    rest,
    connectSocket,
    engine,
    persist: opts?.persist ?? {
      host: "10.0.0.2",
      port: 9876,
      token: "tok",
      nextSeq: 1,
      queue: [],
      localOwner: true,
    },
    clock: {
      epochSeconds: () => 1_800_000_000,
      monotonicMs: () => 50_000,
    },
    hooks: {
      persist: (data) => persisted.push(data),
      applyConfig: (config) => configs.push(config),
      applyHistory: (sessions) => {
        histories.push(sessions);
      },
      currentConfig: () => ({
        workMinutes: 25,
        shortMinutes: 5,
        longMinutes: 15,
        longBreakAfter: 4,
        dailyGoal: 8,
      }),
    },
  });
  return { link, rest, engine, persisted, configs, histories, open: () => handlers, socket: () => socket };
}

describe("PomoLink client", () => {
  test("enter SYNC from idle phone with empty queue", async () => {
    const { link, rest, engine, open } = makeLink();
    rest.routes.set("GET /api/status", json(200, phoneState()));
    await link.start();
    expect(link.mode).toBe("CONNECTING");
    await link.deliverFrame(JSON.stringify({ type: "state", data: phoneState() }));
    expect(link.mode).toBe("SYNCED");
    expect(engine.localOwner).toBe(false);
    expect(engine.view.completed).toBe(2);
    expect(open()).not.toBeNull();
  });

  test("flush then adopt when Chrome is live and phone is stopped", async () => {
    const rest = new FakeRest();
    rest.routes.set("GET /api/status", json(200, phoneState({ status: "stopped" })));
    rest.routes.set(
      "POST /api/sessions/import",
      json(200, { success: true, accepted: ["chrome-0001"], rejected: [] }),
    );
    rest.routes.set(
      "POST /api/timer/adopt",
      json(200, {
        success: true,
        state: phoneState({ status: "running", remaining: 900, start_time: 1_800_000_100 }),
      }),
    );
    const { link, engine } = makeLink({ rest });
    engine.view = {
      ...engine.view,
      status: "running",
      remaining: 900,
      duration: 1500,
      startTime: 1_800_000_100,
    };
    link.enqueueCompleted("work", 1500, 1_799_998_500, "Work");
    await link.start();
    await link.deliverFrame(JSON.stringify({ type: "state", data: phoneState({ status: "stopped" }) }));
    expect(link.mode).toBe("SYNCED");
    expect(rest.posts.map((row) => row.path)).toEqual(["/api/sessions/import", "/api/timer/adopt"]);
    expect(engine.view.status).toBe("running");
    expect(engine.view.remaining).toBe(900);
  });

  test("adopt 409 snaps to phone", async () => {
    const rest = new FakeRest();
    rest.routes.set("GET /api/status", json(200, phoneState({ status: "running", remaining: 400, start_time: 10 })));
    rest.routes.set(
      "POST /api/timer/adopt",
      json(409, {
        success: false,
        error: "timer_busy",
        state: phoneState({ status: "running", remaining: 400, start_time: 10 }),
      }),
    );
    const { link, engine } = makeLink({ rest });
    engine.view = {
      ...engine.view,
      status: "running",
      remaining: 1400,
      duration: 1500,
      startTime: 99,
    };
    await link.start();
    await link.deliverFrame(
      JSON.stringify({ type: "state", data: phoneState({ status: "running", remaining: 400, start_time: 10 }) }),
    );
    expect(link.mode).toBe("SYNCED");
    expect(engine.view.startTime).toBe(10);
    expect(engine.view.remaining).toBe(400);
  });

  test("401 on probe enters UNPAIRED", async () => {
    const rest = new FakeRest();
    rest.routes.set("GET /api/status", json(401, { success: false, error: "unauthorized" }));
    const { link } = makeLink({ rest });
    await link.start();
    expect(link.mode).toBe("UNPAIRED");
  });

  test("commands go to REST while synced", async () => {
    const { link, rest } = makeLink();
    rest.routes.set("GET /api/status", json(200, phoneState()));
    rest.routes.set("POST /api/toggle", json(200, { success: true, state: phoneState({ status: "running" }) }));
    await link.start();
    await link.deliverFrame(JSON.stringify({ type: "state", data: phoneState() }));
    expect(await link.sendGesture("toggle")).toBe(true);
    expect(rest.posts.at(-1)?.path).toBe("/api/toggle");
  });

  test("stale same-session remaining inflation is ignored", async () => {
    const harness = makeLink();
    harness.rest.routes.set(
      "GET /api/status",
      json(200, phoneState({ status: "running", remaining: 1000, start_time: 50 })),
    );
    await harness.link.start();
    await harness.link.deliverFrame(
      JSON.stringify({
        type: "state",
        data: phoneState({
          status: "running",
          remaining: 1000,
          duration: 1500,
          start_time: 50,
          server_time: 1_800_000_000,
        }),
      }),
    );
    expect(harness.link.mode).toBe("SYNCED");
    await harness.link.deliverFrame(
      JSON.stringify({
        type: "state",
        data: phoneState({
          status: "running",
          remaining: 1400,
          duration: 1500,
          start_time: 50,
          server_time: 1_799_999_990,
        }),
      }),
    );
    expect(harness.engine.view.remaining).toBe(1000);
  });

  test("enter SYNC pulls GET /api/history", async () => {
    const harness = makeLink();
    harness.rest.routes.set("GET /api/status", json(200, phoneState()));
    harness.rest.routes.set(
      "GET /api/history",
      json(200, {
        "2026-08-30": {
          completed: 1,
          work_minutes: 25,
          break_minutes: 0,
          sessions: [{ type: "work", start: 1_799_998_500, duration: 1500, completed: true }],
        },
      }),
    );
    await harness.link.start();
    await harness.link.deliverFrame(JSON.stringify({ type: "state", data: phoneState() }));
    expect(harness.link.mode).toBe("SYNCED");
    expect(harness.rest.gets).toContain("/api/history");
    expect(harness.histories.at(-1)).toEqual([
      {
        date: "2026-08-30",
        type: "work",
        start: 1_799_998_500,
        duration: 1500,
        completed: true,
        tag: null,
      },
    ]);
  });

  test("phase_complete while SYNCED pulls history again", async () => {
    const harness = makeLink();
    harness.rest.routes.set("GET /api/status", json(200, phoneState()));
    harness.rest.routes.set("GET /api/history", json(200, {}));
    await harness.link.start();
    await harness.link.deliverFrame(JSON.stringify({ type: "state", data: phoneState() }));
    const before = harness.rest.gets.filter((path) => path === "/api/history").length;
    await harness.link.deliverFrame(JSON.stringify({ type: "event", event: "phase_complete", phase: "work" }));
    expect(harness.rest.gets.filter((path) => path === "/api/history").length).toBe(before + 1);
  });

  test("history 401 unpairs", async () => {
    const harness = makeLink();
    harness.rest.routes.set("GET /api/status", json(200, phoneState()));
    harness.rest.routes.set("GET /api/history", json(401, { success: false, error: "unauthorized" }));
    await harness.link.start();
    await harness.link.deliverFrame(JSON.stringify({ type: "state", data: phoneState() }));
    expect(harness.link.mode).toBe("UNPAIRED");
  });
});
