import { describe, expect, test } from "bun:test";
import { QUEUE_CAPACITY } from "../src/link/constants";
import { SessionQueue } from "../src/link/queue";

describe("SessionQueue", () => {
  test("drop oldest when full", () => {
    const queue = new SessionQueue();
    for (let i = 0; i < QUEUE_CAPACITY; i++) {
      expect(queue.enqueue(`id-${String(i).padStart(2, "0")}`, "work", 1500, 1_700_000_000 + i)).toBe(true);
    }
    expect(queue.count()).toBe(QUEUE_CAPACITY);
    expect(queue.at(0)?.client_id).toBe("id-00");
    expect(queue.enqueue("id-new", "short", 300, 1_700_000_040)).toBe(true);
    expect(queue.count()).toBe(QUEUE_CAPACITY);
    expect(queue.at(0)?.client_id).toBe("id-01");
    expect(queue.at(QUEUE_CAPACITY - 1)?.client_id).toBe("id-new");
  });

  test("reload keeps cap and order", () => {
    const queue = new SessionQueue();
    for (let i = 0; i < QUEUE_CAPACITY + 3; i++) {
      queue.enqueue(`id-${String(i).padStart(2, "0")}`, "work", 60, 1_700_000_000 + i);
    }
    const reloaded = new SessionQueue(undefined, queue.toRows());
    expect(reloaded.count()).toBe(QUEUE_CAPACITY);
    expect(reloaded.at(0)?.client_id).toBe("id-03");
    expect(reloaded.at(QUEUE_CAPACITY - 1)?.client_id).toBe(`id-${String(QUEUE_CAPACITY + 2).padStart(2, "0")}`);
  });

  test("drop by client id accepted and rejected", () => {
    const queue = new SessionQueue();
    queue.enqueue("keep", "work", 1500, 1_700_000_000);
    queue.enqueue("gone-a", "short", 300, 1_700_000_100);
    queue.enqueue("gone-b", "long", 900, 1_700_000_200);
    expect(queue.dropByClientId(["gone-a", "gone-b"])).toBe(2);
    expect(queue.count()).toBe(1);
    expect(queue.at(0)?.client_id).toBe("keep");
  });

  test("strip implausible starts", () => {
    const queue = new SessionQueue();
    const now = 1_800_000_000;
    queue.enqueue("old", "work", 1500, now - 15 * 24 * 60 * 60);
    queue.enqueue("future", "work", 1500, now + 10 * 60);
    queue.enqueue("ok", "work", 1500, now - 60);
    expect(queue.stripImplausibleStarts(now)).toBe(2);
    const byId = Object.fromEntries(queue.items.map((row) => [row.client_id, row]));
    expect(byId.old?.start).toBeUndefined();
    expect(byId.future?.start).toBeUndefined();
    expect(byId.ok?.start).toBe(now - 60);
  });
});
