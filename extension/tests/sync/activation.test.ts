import { expect, test } from "bun:test";
import { SYNC_ACTIVATION } from "../../src/sync/activation";

test("production activation is compile-time dormant", () => {
  expect(SYNC_ACTIVATION.productionActivated).toBeFalse();
  expect(SYNC_ACTIVATION.suite).toBe(1);
  expect(SYNC_ACTIVATION.generation).toBe(1);
});
