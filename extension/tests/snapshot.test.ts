import { describe, expect, test } from "bun:test";
import { buildEnvelope, decryptEnvelope } from "../src/crew/snapshot";
import type { CrewStatsExtras, DailyAggregate, SnapshotPlain } from "../src/crew/types";

const CREW_KEY = "ef".repeat(32);

function stats(overrides: Partial<CrewStatsExtras> = {}): CrewStatsExtras {
  return {
    hourBuckets: Array(24).fill(0),
    weekdayBuckets: Array(7).fill(0),
    allTimeWorkBlocks: 4,
    allTimeActiveDays: 2,
    bestStreak: 1,
    firstFocusLocalDate: "2024-01-01",
    historyStartDate: "2024-01-01",
    historyFocusMinutes: [30, 90],
    historyWorkBlocks: [1, 3],
    bestDayLocalDate: "2024-01-02",
    bestDayFocusMinutes: 30,
    bestDayWorkBlocks: 1,
    bestWeekStartDate: "2024-01-01",
    bestWeekFocusMinutes: 120,
    bestWeekWorkBlocks: 4,
    ...overrides,
  };
}

function aggregates(entries: Array<[string, number, number]>): DailyAggregate[] {
  return entries.map(([localDate, focusMinutes, completedWorkBlocks]) => ({
    localDate,
    focusMinutes,
    completedWorkBlocks,
  }));
}

function snapshot(overrides: Partial<SnapshotPlain> = {}): SnapshotPlain {
  const base: SnapshotPlain = {
    crewId: "ab".repeat(16),
    identityPublicKey: "cd".repeat(32),
    displayName: "Test Crew",
    avatarBase64: null,
    allTimeFocusMinutes: 120,
    publishedAtEpochSeconds: 1700000000,
    localDate: "2024-01-02",
    utcOffsetMinutes: 330,
    dailyAggregates: aggregates([
      ["2024-01-02", 30, 1],
      ["2024-01-01", 90, 3],
    ]),
    currentStreak: 1,
    lastFocusedAtEpochSeconds: 1700000100,
    version: 2,
    stats: stats(),
  };
  return { ...base, ...overrides };
}

describe("snapshot codec", () => {
  test("roundtrips an encrypted snapshot", async () => {
    const s = snapshot();
    const decrypted = await decryptEnvelope(await buildEnvelope(s, CREW_KEY), CREW_KEY);
    expect(decrypted).toEqual(s);
  });

  test("roundtrips a snapshot with null stats", async () => {
    const s = snapshot({ stats: null });
    const decrypted = await decryptEnvelope(await buildEnvelope(s, CREW_KEY), CREW_KEY);
    expect(decrypted.stats).toBeNull();
  });

  test("throws when the crew key is wrong", async () => {
    const envelope = await buildEnvelope(snapshot(), CREW_KEY);
    await expect(decryptEnvelope(envelope, "ff".repeat(32))).rejects.toThrow();
  });

  test("throws when the ciphertext is tampered", async () => {
    const envelope = JSON.parse(await buildEnvelope(snapshot(), CREW_KEY)) as {
      ciphertext: string;
    };
    envelope.ciphertext = (envelope.ciphertext[0] === "A" ? "B" : "A") + envelope.ciphertext.slice(1);
    await expect(decryptEnvelope(JSON.stringify(envelope), CREW_KEY)).rejects.toThrow();
  });

  test("throws when the envelope crewId does not match", async () => {
    const envelope = JSON.parse(await buildEnvelope(snapshot(), CREW_KEY)) as { crewId: string };
    envelope.crewId = "11".repeat(16);
    await expect(decryptEnvelope(JSON.stringify(envelope), CREW_KEY)).rejects.toThrow();
  });

  test("throws when the envelope identityPublicKey does not match", async () => {
    const envelope = JSON.parse(await buildEnvelope(snapshot(), CREW_KEY)) as { identityPublicKey: string };
    envelope.identityPublicKey = "22".repeat(32);
    await expect(decryptEnvelope(JSON.stringify(envelope), CREW_KEY)).rejects.toThrow();
  });

  test("rejects snapshots with unsorted daily aggregates", async () => {
    const s = snapshot({
      dailyAggregates: aggregates([
        ["2024-01-01", 90, 3],
        ["2024-01-02", 30, 1],
      ]),
    });
    await expect(buildEnvelope(s, CREW_KEY)).rejects.toThrow(/aggregates/i);
  });

  test("rejects snapshots with duplicate daily aggregate dates", async () => {
    const s = snapshot({
      dailyAggregates: aggregates([
        ["2024-01-02", 30, 1],
        ["2024-01-02", 90, 3],
      ]),
    });
    await expect(buildEnvelope(s, CREW_KEY)).rejects.toThrow(/duplicate/i);
  });

  test("rejects snapshots with more than 30 daily aggregates", async () => {
    const entries: Array<[string, number, number]> = Array.from({ length: 31 }, (_, i) => [
      `2024-01-${String(31 - i).padStart(2, "0")}`,
      0,
      0,
    ]);
    await expect(buildEnvelope(snapshot({ dailyAggregates: aggregates(entries) }), CREW_KEY)).rejects.toThrow(
      /aggregates/i,
    );
  });

  test("rejects envelopes whose JSON exceeds the size bound", async () => {
    const envelope = JSON.parse(await buildEnvelope(snapshot(), CREW_KEY)) as { ciphertext: string };
    envelope.ciphertext = "A".repeat(64 * 1024);
    await expect(decryptEnvelope(JSON.stringify(envelope), CREW_KEY)).rejects.toThrow(/size/i);
  });

  test("rejects snapshots whose decrypted plaintext exceeds the size bound", async () => {
    const s = snapshot({ avatarBase64: "a".repeat(32 * 1024) });
    await expect(buildEnvelope(s, CREW_KEY)).rejects.toThrow(/size/i);
  });

  test("rejects aggregates with malformed dates or counts", async () => {
    await expect(
      buildEnvelope(snapshot({ dailyAggregates: aggregates([["2024/01/02", 30, 1]]) }), CREW_KEY),
    ).rejects.toThrow(/aggregate/i);
    await expect(
      buildEnvelope(snapshot({ dailyAggregates: aggregates([["2024-01-02", -1, 1]]) }), CREW_KEY),
    ).rejects.toThrow(/aggregate/i);
  });

  test("rejects aggregates with impossible calendar dates", async () => {
    await expect(
      buildEnvelope(snapshot({ dailyAggregates: aggregates([["2024-02-30", 30, 1]]) }), CREW_KEY),
    ).rejects.toThrow(/aggregate/i);
    await expect(
      buildEnvelope(snapshot({ dailyAggregates: aggregates([["2023-02-29", 30, 1]]) }), CREW_KEY),
    ).rejects.toThrow(/aggregate/i);
  });

  test("rejects snapshots with wrong stats bucket lengths", async () => {
    await expect(buildEnvelope(snapshot({ stats: stats({ hourBuckets: Array(23).fill(0) }) }), CREW_KEY)).rejects.toThrow(
      /buckets/i,
    );
    await expect(
      buildEnvelope(snapshot({ stats: stats({ weekdayBuckets: Array(6).fill(0) }) }), CREW_KEY),
    ).rejects.toThrow(/buckets/i);
  });

  test("rejects snapshots with mismatched or over-long history arrays", async () => {
    await expect(
      buildEnvelope(snapshot({ stats: stats({ historyFocusMinutes: [30, 90], historyWorkBlocks: [1] }) }), CREW_KEY),
    ).rejects.toThrow(/history/i);
    const tooLong = Array(121).fill(0) as number[];
    await expect(
      buildEnvelope(
        snapshot({ stats: stats({ historyFocusMinutes: tooLong, historyWorkBlocks: [...tooLong] }) }),
        CREW_KEY,
      ),
    ).rejects.toThrow(/history/i);
  });

  test("rejects snapshots with the wrong version", async () => {
    await expect(buildEnvelope(snapshot({ version: 1 }), CREW_KEY)).rejects.toThrow(/version/i);
  });

  test("rejects invalid envelopes", async () => {
    await expect(decryptEnvelope("not json", CREW_KEY)).rejects.toThrow();
    await expect(
      decryptEnvelope(
        JSON.stringify({ version: 2, crewId: "x", identityPublicKey: "y", nonce: "", ciphertext: "" }),
        CREW_KEY,
      ),
    ).rejects.toThrow();
  });
});
