import { describe, expect, test } from "bun:test";
import { decodePortableBackup, encodePortableBackup } from "../src/shared/backup";

describe("portable Android backup contract", () => {
  test("round trips history and writes an empty Crew object for the phone", () => {
    const json = encodePortableBackup({
      dayStats: [{ date: "2026-08-03", earnedBlocks: 1, focusMinutes: 25, breakMinutes: 5, lastUpdated: 1 }],
      sessions: [{ start: 100, date: "2026-08-03", type: "work", duration: 1500, completed: true, tag: "Study" }],
    });
    const decoded = decodePortableBackup(json);
    expect(decoded.format).toBe("pomo-backup");
    expect(decoded.version).toBe(1);
    expect(decoded.history.sessions[0]?.tag).toBe("Study");
    expect(decoded.crew.memberships).toEqual([]);
  });

  test("imports phone history while ignoring Crew contents", () => {
    const raw = {
      format: "pomo-backup",
      version: 1,
      exportedAtEpochSeconds: 1,
      appVersionName: "phone",
      history: {
        dayStats: [{ date: "2026-08-03", completed: 1, workMinutes: 25, breakMinutes: 5 }],
        sessions: [{ start: 100, date: "2026-08-03", type: "work", duration: 1500, completed: true, tag: "Study" }],
      },
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
    const decoded = decodePortableBackup(JSON.stringify(raw));
    expect(decoded.history.sessions).toHaveLength(1);
    expect(decoded.crew.identityPrivateKey).toBe("not-a-key");
  });

  test("rejects a newer or non-Pomo document", () => {
    expect(() => decodePortableBackup('{"format":"other","version":1}')).toThrow(/not a Pomo/i);
    expect(() => decodePortableBackup(JSON.stringify({ format: "pomo-backup", version: 2 }))).toThrow(/unsupported/i);
  });
});
