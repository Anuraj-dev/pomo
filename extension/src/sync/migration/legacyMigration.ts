export type LegacyDisposition = "VALID" | "DUPLICATE" | "CONFLICTING" | "MALFORMED_QUARANTINED" | "MEMBER_EXCLUDED";
export interface LegacyInventoryItem { readonly sourceId: string; readonly durableId: string; readonly domain: string; readonly disposition: LegacyDisposition; readonly detail: string }
export interface MigrationInventory { readonly sourceId: string; readonly items: readonly LegacyInventoryItem[]; readonly durableItemCount: number }
export function validateMigrationInventory(inventory: MigrationInventory): void {
  if (inventory.sourceId.length === 0 || inventory.items.length !== inventory.durableItemCount) throw new Error("Every durable legacy item requires an explicit disposition");
  if (new Set(inventory.items.map(({ durableId }) => durableId)).size !== inventory.items.length) throw new Error("duplicate legacy inventory identity");
}

export type LegacyTimerState = "PARKED" | "RUNNING" | "PAUSED";
export interface MigrationIdentity { readonly memberId: string; readonly crewIds: ReadonlySet<string> }
export interface MigrationVerification { readonly expectedItems: number; readonly explainedItems: number; readonly projectionRootsMatch: boolean; readonly domainInvariantsHold: boolean }
export interface MigrationPrerequisites { readonly recoveryAnchorId: string | null; readonly baselineCaughtUp: boolean; readonly timerState: LegacyTimerState; readonly identitiesSelected: boolean; readonly verification: MigrationVerification }
export interface MigrationActivation { readonly journalId: string; readonly encryptedLegacyArchiveId: string; readonly phase: "ACTIVATED"; readonly dualWriteRetired: true }

export function requireIdentitySelection(sources: readonly MigrationIdentity[], selectedMemberId: string | null): void {
  const members = new Set(sources.map(({ memberId }) => memberId));
  const crews = new Set(sources.flatMap(({ crewIds }) => [...crewIds]));
  if ((members.size > 1 && (selectedMemberId === null || !members.has(selectedMemberId))) || (crews.size > 1 && selectedMemberId === null)) throw new Error("Different Members and Crews require explicit selection and cannot be blended");
}

export function verifyMigrationReady(value: MigrationPrerequisites): void {
  if (value.recoveryAnchorId === null || value.recoveryAnchorId.length === 0) throw new Error("Recovery artifact and anchor must predate authority changes");
  if (!value.baselineCaughtUp) throw new Error("Trusted baseline must catch up before proposals");
  if (value.timerState !== "PARKED") throw new Error("Legacy timer must be Parked");
  if (!value.identitiesSelected) throw new Error("identity selection incomplete");
  if (value.verification.expectedItems !== value.verification.explainedItems) throw new Error("zero unexplained omissions required");
  if (!value.verification.projectionRootsMatch || !value.verification.domainInvariantsHold) throw new Error("migration verification failed");
}
export function activateMigrationAtomically(value: MigrationPrerequisites, journalId: string, archiveId: string): MigrationActivation {
  verifyMigrationReady(value);
  if (journalId.length === 0 || archiveId.length === 0) throw new Error("activation artifacts required");
  return { journalId, encryptedLegacyArchiveId: archiveId, phase: "ACTIVATED", dualWriteRetired: true };
}
export const POMO_BACKUP_V1_WARNING = "Legacy import only: pomo-backup v1 may contain sensitive identity and Crew data; it never activates sync authority.";
