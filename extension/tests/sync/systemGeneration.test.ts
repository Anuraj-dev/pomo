import { expect, test } from "bun:test";
import { SYNC_ACTIVATION } from "../../src/sync/activation";
import { evaluateActivationGate } from "../../scripts/activationGate";

test("shared system generation remains exact and dormant until the physical gate passes", async () => {
  const fixture = await Bun.file(new URL("../../../sync-protocol/fixtures/system-generation.json", import.meta.url)).json() as {
    readonly suite: number;
    readonly generation: number;
    readonly productionActivation: boolean;
    readonly deletionRule: string;
    readonly historyAuthority: string;
  };
  const matrix = await Bun.file(new URL("../../../sync-protocol/activation/physical-matrix.json", import.meta.url)).json();
  expect(fixture).toMatchObject({ suite: SYNC_ACTIVATION.suite, generation: SYNC_ACTIVATION.generation, deletionRule: "authenticated-tombstone-only", historyAuthority: "android-room" });
  expect(evaluateActivationGate({ productionActivation: fixture.productionActivation, matrix }).ok).toBeTrue();
  expect(SYNC_ACTIVATION.productionActivated).toBeFalse();
});
