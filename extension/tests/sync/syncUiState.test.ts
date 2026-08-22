import { describe, expect, test } from "bun:test";
import { DORMANT_SYNC_UI_STATE, parseSyncUiState, scheduleOrdinaryDrain } from "../../src/sync/ui/syncUiState";

describe("sync UI state", () => {
  test("strictly validates all eight domain health states and the four-signal rail", () => {
    for (const health of ["HEALTHY", "OFFLINE", "STALLED", "QUARANTINE", "CONFLICT", "LIMITED", "INCOMPLETE", "SAFE_MODE"] as const) expect(parseSyncUiState({ ...DORMANT_SYNC_UI_STATE, health }).health).toBe(health);
    expect(() => parseSyncUiState({ ...DORMANT_SYNC_UI_STATE, signals: [] })).toThrow(/Signal rail/);
  });
  test("Retry now only schedules ordinary drain and preserves safety state", () => {
    const safe = { ...DORMANT_SYNC_UI_STATE, health: "SAFE_MODE" as const, timerControlsFrozen: true };
    expect(scheduleOrdinaryDrain(safe)).toEqual({ ...safe, retryPending: true });
  });
  test("dormant state never freezes the local timer or claims protection", () => {
    expect(DORMANT_SYNC_UI_STATE.timerControlsFrozen).toBeFalse();
    expect(DORMANT_SYNC_UI_STATE.signals[2].value).toBe("Incomplete");
  });
});
