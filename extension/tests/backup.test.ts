import { describe, expect, test } from "bun:test";
import { decodePortableBackup, encodePortableBackup } from "../src/shared/backup";

describe("portable Android backup contract", () => {
  test("round trips the shared history and Crew shape", () => {
    const json = encodePortableBackup({
      dayStats: [{ date: "2026-08-03", earnedBlocks: 1, focusMinutes: 25, breakMinutes: 5, lastUpdated: 1 }],
      sessions: [{ start: 100, date: "2026-08-03", type: "work", duration: 1500, completed: true, tag: "Study" }],
      memberships: [{ crewId: "11".repeat(16), crewName: "Deep Work", relays: ["wss://relay.example"], key: "22".repeat(32), displayName: "Snehit", joinedAtEpochSeconds: 1 }],
      identityPrivateKey: "ab".repeat(32),
      activeCrewId: "11".repeat(16),
      snapshots: [],
      dailyAggregates: [],
      hiddenMembers: [],
    });
    const decoded = decodePortableBackup(json);
    expect(decoded.format).toBe("pomo-backup");
    expect(decoded.version).toBe(1);
    expect(decoded.history.sessions[0]?.tag).toBe("Study");
    expect(decoded.crew.memberships[0]?.protocolVersion).toBe(2);
    expect(decoded.crew.memberships[0]?.joinCode).toMatch(/^pomo-crew\.v2\./);
    expect(decoded.crew.identityPrivateKey).toBe("ab".repeat(32));
  });

  test("rejects a newer or non-Pomo document", () => {
    expect(() => decodePortableBackup('{"format":"other","version":1}')).toThrow(/not a Pomo/i);
    expect(() => decodePortableBackup(JSON.stringify({ format: "pomo-backup", version: 2 }))).toThrow(/unsupported/i);
  });

  test("rejects an invalid identity instead of silently importing it", () => {
    const raw = {
      format: "pomo-backup",
      version: 1,
      exportedAtEpochSeconds: 1,
      appVersionName: "phone",
      history: { dayStats: [], sessions: [] },
      crew: {
        identityPrivateKey: "not-a-key",
        profileAvatarBase64: null,
        activeCrewId: null,
        memberships: [],
        snapshots: [],
        dailyAggregates: [],
        hiddenMembers: [],
      },
    };
    expect(() => decodePortableBackup(JSON.stringify(raw))).toThrow(/identity/i);
  });
});
