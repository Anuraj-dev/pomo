import { describe, expect, test } from "bun:test";
import { canAdopt, isSameSession, type AdoptClock } from "../src/link/adopt";

function phone(overrides: Partial<AdoptClock> = {}): AdoptClock {
  return {
    status: "stopped",
    phase: "work",
    remaining: 1500,
    start_time: 0,
    ...overrides,
  };
}

function payload(overrides: Partial<AdoptClock> = {}): AdoptClock {
  return {
    status: "running",
    phase: "work",
    remaining: 1200,
    start_time: 1_710_000_000,
    ...overrides,
  };
}

describe("least remaining adopt", (): void => {
  test("phone stopped always adopts", (): void => {
    expect(canAdopt(phone({ status: "stopped", remaining: 1500, start_time: 0 }), payload({ remaining: 1400 }))).toBe(true);
  });

  test("same session always adopts even if payload remaining is larger", (): void => {
    const current = phone({ status: "running", phase: "work", remaining: 1100, start_time: 1_710_000_000 });
    const desk = payload({ status: "running", phase: "work", remaining: 1300, start_time: 1_710_000_000 });
    expect(isSameSession(current, desk)).toBe(true);
    expect(canAdopt(current, desk)).toBe(true);
  });

  test("laptop 20m beats phone 23m", (): void => {
    const current = phone({ status: "running", phase: "work", remaining: 23 * 60, start_time: 100 });
    const desk = payload({ status: "running", phase: "work", remaining: 20 * 60, start_time: 200 });
    expect(isSameSession(current, desk)).toBe(false);
    expect(canAdopt(current, desk)).toBe(true);
  });

  test("equal remaining on different sessions is busy", (): void => {
    expect(
      canAdopt(
        phone({ status: "running", remaining: 800, start_time: 1 }),
        payload({ status: "running", remaining: 800, start_time: 2 }),
      ),
    ).toBe(false);
  });

  test("desk longer remaining on different session is busy", (): void => {
    expect(
      canAdopt(
        phone({ status: "running", remaining: 700, start_time: 1 }),
        payload({ status: "running", remaining: 701, start_time: 2 }),
      ),
    ).toBe(false);
  });

  test("non-live payload while phone live is busy", (): void => {
    expect(
      canAdopt(
        phone({ status: "running", remaining: 500, start_time: 1 }),
        payload({ status: "stopped", remaining: 0, start_time: 2 }),
      ),
    ).toBe(false);
  });
});
