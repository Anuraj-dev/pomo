export interface CompatibilityProfile { readonly deviceId: string; readonly readableSchemas: ReadonlySet<number>; readonly writableSchemas: ReadonlySet<number>; readonly materializers: ReadonlySet<number>; readonly checkpointFormats: ReadonlySet<number>; readonly suiteGenerations: ReadonlySet<number>; readonly recoveryFormats: ReadonlySet<number>; readonly safeStorageGeneration: number; readonly authenticated: boolean }
export interface AuthoringBaseline { readonly schema: number; readonly materializer: number; readonly checkpoint: number; readonly suiteGeneration: number; readonly recoveryFormat: number; readonly storageGeneration: number }
export type CompatibilityMode = "READY" | "LIMITED_FORWARD_ONLY" | "BLOCKED_AUTHORITY";
export interface UnknownAuthenticatedFact { readonly operationId: string; readonly canonicalWire: Uint8Array; readonly retainedForForwarding: true }
export function compatibilityMode(profile: CompatibilityProfile, baseline: AuthoringBaseline): CompatibilityMode {
  if (!profile.authenticated || !profile.suiteGenerations.has(baseline.suiteGeneration) || !profile.recoveryFormats.has(baseline.recoveryFormat)) return "BLOCKED_AUTHORITY";
  const ready = profile.writableSchemas.has(baseline.schema) && profile.materializers.has(baseline.materializer) && profile.checkpointFormats.has(baseline.checkpoint) && profile.safeStorageGeneration >= baseline.storageGeneration;
  return ready ? "READY" : "LIMITED_FORWARD_ONLY";
}
export type ActivationDecision = "PROPOSED" | "CONFIRMED" | "LIMITED_NAMED_DEVICES" | "QUARANTINED_CONCURRENT";
export interface GenerationActivation { readonly generation: number; readonly frontierId: string; readonly readerReadyDeviceIds: ReadonlySet<string>; readonly proposerDeviceId: string; readonly confirmerDeviceId: string | null; readonly confirmedByRecovery: boolean; readonly explicitlyLimitedDeviceIds: ReadonlySet<string> }
export function evaluateActivation(value: GenerationActivation, concurrentGenerations: ReadonlySet<number>): ActivationDecision {
  if (value.frontierId.length === 0 || !value.readerReadyDeviceIds.has(value.proposerDeviceId)) throw new Error("reader support must ship before proposal");
  if ([...concurrentGenerations].some((generation) => generation !== value.generation)) return "QUARANTINED_CONCURRENT";
  if (value.confirmerDeviceId === value.proposerDeviceId && !value.confirmedByRecovery) throw new Error("another Full device or Recovery must confirm");
  if (value.confirmerDeviceId !== null && !value.readerReadyDeviceIds.has(value.confirmerDeviceId) && !value.confirmedByRecovery) {
    throw new Error("confirmer must be a reader-ready Full device or Recovery");
  }
  if (value.confirmerDeviceId === null && !value.confirmedByRecovery) return "PROPOSED";
  return value.explicitlyLimitedDeviceIds.size === 0 ? "CONFIRMED" : "LIMITED_NAMED_DEVICES";
}
export function oldBuildDataDisposition(isSynchronizedHistory: boolean, laterIndependentData: boolean): "READ_ONLY" | "EXPLICIT_IMPORT_REQUIRED" | "LOCAL_ONLY" {
  return isSynchronizedHistory ? "READ_ONLY" : laterIndependentData ? "EXPLICIT_IMPORT_REQUIRED" : "LOCAL_ONLY";
}
