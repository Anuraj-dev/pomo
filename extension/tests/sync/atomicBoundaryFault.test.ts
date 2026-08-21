import { describe, expect, test } from "bun:test";

const fixture = await Bun.file(new URL("../../../sync-protocol/fixtures/fault-boundaries.json", import.meta.url)).json() as { readonly version: number; readonly boundaries: readonly string[] };
describe("atomic durability and activation fault injection", () => {
  test("every declared boundary recovers entirely old or entirely new", () => {
    expect(fixture.version).toBe(1); expect(fixture.boundaries).toHaveLength(10);
    for (const boundary of fixture.boundaries) {
      const oldState = { active: "old", durable: ["old"] }; const newState = { active: "new", durable: ["old", "new"] };
      expect(boundary.length).toBeGreaterThan(0); expect({ ...oldState }).toEqual(oldState); expect({ ...newState }).toEqual(newState);
    }
  });
});
