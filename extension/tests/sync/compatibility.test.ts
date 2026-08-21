import { describe, expect, test } from "bun:test";
import { compatibilityMode, evaluateActivation, oldBuildDataDisposition } from "../../src/sync/compat/compatibility";

describe("authenticated compatibility and reader-first activation", () => {
  const baseline = { schema: 2, materializer: 2, checkpoint: 2, suiteGeneration: 2, recoveryFormat: 2, storageGeneration: 6 };
  const current = { deviceId: "full", readableSchemas: new Set([1, 2]), writableSchemas: new Set([2]), materializers: new Set([2]), checkpointFormats: new Set([2]), suiteGenerations: new Set([2]), recoveryFormats: new Set([2]), safeStorageGeneration: 6, authenticated: true };
  test("DeviceReady requires the complete authenticated authoring baseline", () => {
    expect(compatibilityMode(current, baseline)).toBe("READY");
    expect(compatibilityMode({ ...current, writableSchemas: new Set<number>() }, baseline)).toBe("LIMITED_FORWARD_ONLY");
    expect(compatibilityMode({ ...current, suiteGenerations: new Set([1]) }, baseline)).toBe("BLOCKED_AUTHORITY");
  });
  test("ships readers first, independently confirms, and quarantines concurrent activation", () => {
    const proposed = { generation: 2, frontierId: "frontier", readerReadyDeviceIds: new Set(["full"]), proposerDeviceId: "full", confirmerDeviceId: null, confirmedByRecovery: false, explicitlyLimitedDeviceIds: new Set<string>() };
    expect(evaluateActivation(proposed, new Set([2]))).toBe("PROPOSED");
    expect(evaluateActivation({ ...proposed, confirmerDeviceId: "other" }, new Set([2]))).toBe("CONFIRMED");
    expect(evaluateActivation(proposed, new Set([2, 3]))).toBe("QUARANTINED_CONCURRENT");
    expect(() => evaluateActivation({ ...proposed, readerReadyDeviceIds: new Set<string>() }, new Set([2]))).toThrow(/reader support/);
  });
  test("old builds cannot mutate shared history and later data needs import", () => {
    expect(oldBuildDataDisposition(true, false)).toBe("READ_ONLY");
    expect(oldBuildDataDisposition(false, true)).toBe("EXPLICIT_IMPORT_REQUIRED");
  });
});
