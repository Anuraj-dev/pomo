import { decryptAes256Gcm, deriveRecoveryKey, encryptAes256Gcm } from "../crypto/PomoCrypto";
import { encodeCanonicalCbor } from "../protocol/cbor";

export type RecoveryArtifactKind = "AUTHORITY_FILE" | "DATA_ARCHIVE";
export interface RecoveryArtifact { readonly kind: RecoveryArtifactKind; readonly salt: Uint8Array; readonly nonce: Uint8Array; readonly ciphertextAndTag: Uint8Array }
export interface RecoveryFileBody { readonly protectedAuthority: Uint8Array; readonly recoveryGeneration: number; readonly frontierEvidence: readonly string[]; readonly capabilityLocators: readonly string[]; readonly mailboxLocators: readonly string[] }
export interface RecoveryArchiveManifest { readonly archiveId: string; readonly recoveryGeneration: number; readonly checkpointIds: readonly string[]; readonly packIds: readonly string[]; readonly blobIds: readonly string[]; readonly manifestDigest: Uint8Array; readonly credentialProof: Uint8Array | null }
export type RecoverySourceKind = "DEVICE" | "MAILBOX" | "ARCHIVE";
export interface ProvenancedRecoveryObject { readonly objectId: string; readonly sourceId: string; readonly sourceKind: RecoverySourceKind }

export async function sealRecoveryFile(body: RecoveryFileBody, passphrase: string): Promise<RecoveryArtifact> {
  if (body.protectedAuthority.length < 1 || body.protectedAuthority.length > 4_096 || body.capabilityLocators.length > 32 || body.mailboxLocators.length > 32) throw new Error("Recovery file is not a data dump");
  const payload = encodeCanonicalCbor([1, body.protectedAuthority, body.recoveryGeneration, [...body.frontierEvidence].sort(), [...body.capabilityLocators].sort(), [...body.mailboxLocators].sort()]);
  return seal("AUTHORITY_FILE", payload, passphrase);
}

export async function sealRecoveryArchive(canonicalArchive: Uint8Array, passphrase: string): Promise<RecoveryArtifact> {
  if (canonicalArchive.length === 0) throw new Error("Recovery archive is empty");
  return seal("DATA_ARCHIVE", canonicalArchive, passphrase);
}

export function validateRecoveryArchiveManifest(manifest: RecoveryArchiveManifest, authorityGrantRequested: boolean): void {
  const objectIds = [...manifest.checkpointIds, ...manifest.packIds, ...manifest.blobIds];
  if (manifest.archiveId.length === 0 || !Number.isSafeInteger(manifest.recoveryGeneration) || manifest.recoveryGeneration < 0 || manifest.checkpointIds.length === 0) throw new Error("invalid recovery archive manifest");
  if (new Set(objectIds).size !== objectIds.length || manifest.manifestDigest.length !== 32) throw new Error("unverified recovery archive manifest");
  if (authorityGrantRequested && (manifest.credentialProof === null || manifest.credentialProof.length === 0)) throw new Error("archive data never grants Recovery authority without credentials");
}

export async function openRecoveryArtifact(artifact: RecoveryArtifact, passphrase: string): Promise<Uint8Array> {
  const key = await deriveRecoveryKey(passphrase, artifact.salt);
  try { return await decryptAes256Gcm(key, { nonce: artifact.nonce, ciphertextAndTag: artifact.ciphertextAndTag }, aad(artifact.kind)); }
  finally { key.fill(0); }
}

async function seal(kind: RecoveryArtifactKind, plaintext: Uint8Array, passphrase: string): Promise<RecoveryArtifact> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveRecoveryKey(passphrase, salt);
  try { const sealed = await encryptAes256Gcm(key, nonce, aad(kind), plaintext); return { kind, salt, nonce: sealed.nonce, ciphertextAndTag: sealed.ciphertextAndTag }; }
  finally { key.fill(0); }
}
function aad(kind: RecoveryArtifactKind): Uint8Array { return new TextEncoder().encode(`Pomo Recovery Artifact:1:${kind}`); }

export type RestoreDomain = "HISTORY" | "TAG" | "PREFERENCE" | "PROFILE" | "CREW" | "ACTIVE_PHASE" | "DEVICE_KEY" | "CONTENT_EPOCH" | "RECOVERY_AUTHORITY";
export interface RestoreSelection { readonly domain: RestoreDomain; readonly targetId: string; readonly compensatingPayload: Uint8Array }
export interface ForwardRestorePlan { readonly safetyCheckpointId: string; readonly compensating: readonly RestoreSelection[]; readonly independentConfirmationRequired: boolean }
export type RestorePlanOrigin = "HUMAN" | "AGENT";
export interface RestoreApproval { readonly humanConfirmed: boolean; readonly independentConfirmed: boolean }
export interface HistoricalValue { readonly domain: RestoreDomain; readonly targetId: string; readonly causalVersion: number; readonly operationId: string; readonly value: Uint8Array | null }

export function compareHistoricalValues(left: HistoricalValue, right: HistoricalValue): number {
  if (left.domain !== right.domain || left.targetId !== right.targetId) throw new Error("historical comparison requires the same domain target");
  return left.causalVersion - right.causalVersion || left.operationId.localeCompare(right.operationId);
}

export function prepareForwardRestore(safetyCheckpointId: string, selections: readonly RestoreSelection[]): ForwardRestorePlan {
  if (safetyCheckpointId.length === 0) throw new Error("Safety checkpoint is required before restore");
  const prohibited = new Set<RestoreDomain>(["ACTIVE_PHASE", "DEVICE_KEY", "CONTENT_EPOCH", "RECOVERY_AUTHORITY"]);
  if (selections.some((selection) => prohibited.has(selection.domain))) throw new Error("Recovery restore cannot rewind authority or Active phases");
  if (new Set(selections.map((selection) => selection.targetId)).size !== selections.length) throw new Error("duplicate restore target");
  return { safetyCheckpointId, compensating: selections.map((selection) => ({ ...selection, compensatingPayload: selection.compensatingPayload.slice() })), independentConfirmationRequired: selections.length >= 10 };
}

export function authorizeForwardRestore(plan: ForwardRestorePlan, origin: RestorePlanOrigin, destructive: boolean, approval: RestoreApproval): void {
  if (!approval.humanConfirmed) throw new Error("Forward restore requires human confirmation");
  if ((origin === "AGENT" || destructive || plan.independentConfirmationRequired) && !approval.independentConfirmed) throw new Error("Agent-prepared, destructive, or broad restore requires independent confirmation");
}
