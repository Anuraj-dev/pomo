import { expect, test } from "bun:test";
import { SYNC_ACTIVATION } from "../../src/sync/activation";

test("shared system generation remains exact and dormant", async () => {
  const fixture = await Bun.file(new URL("../../../sync-protocol/fixtures/system-generation.json", import.meta.url)).json() as Record<string, unknown>;
  expect(fixture).toMatchObject({ suite: SYNC_ACTIVATION.suite, generation: SYNC_ACTIVATION.generation, productionActivation: false, deletionRule: "authenticated-tombstone-only", historyAuthority: "android-room" });
});
