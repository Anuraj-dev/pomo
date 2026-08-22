import { describe, expect, test } from "bun:test";
import {
  applyProfile,
  classifyDataFamily,
  crewPseudonym,
  isDeviceLocalPreference,
  materializeCrewMembership,
  materializeSharedPreferences,
} from "../../src/sync/domain/sharedData";

describe("shared preferences, Profile, and Crew boundaries", () => {
  test("converges shared fields per field while local settings remain local", () => {
    const projection = materializeSharedPreferences([
      { field: "focusMinutes", value: "30", operationId: "b", effectiveAfterPhaseId: "active" },
      { field: "theme", value: "dark", operationId: "c", effectiveAfterPhaseId: null },
      { field: "focusMinutes", value: "25", operationId: "a", effectiveAfterPhaseId: "active" },
    ]);
    expect(projection.get("focusMinutes")?.value).toBe("30");
    expect(projection.has("theme")).toBeFalse();
    expect(isDeviceLocalPreference("routeHealth")).toBeTrue();
  });

  test("keeps the last complete Profile until its referenced photo verifies", () => {
    const current = { operationId: "a", name: "Snehit", photoBlobId: "old" };
    const incoming = { operationId: "b", name: "Snehit Rai", photoBlobId: "new" };
    const pending = applyProfile({ complete: current, pending: null }, incoming, new Set(["old"]));
    expect(pending.complete).toEqual(current);
    expect(pending.pending).toEqual(incoming);
    expect(applyProfile(pending, incoming, new Set(["old", "new"]))).toEqual({ complete: incoming, pending: null });
  });

  test("pauses publication for concurrent membership and forwards unknown versions", async () => {
    expect(materializeCrewMembership([
      { operationId: "a", crewId: "crew", intent: "JOIN" },
      { operationId: "b", crewId: "crew", intent: "LEAVE" },
    ])).toEqual({ joined: null, decisionRequired: true, publicationPaused: true });
    expect(classifyDataFamily(2)).toBe("PENDING_FORWARD");
    expect(await crewPseudonym(new Uint8Array(32).fill(7), "crew")).toHaveLength(64);
  });
});
