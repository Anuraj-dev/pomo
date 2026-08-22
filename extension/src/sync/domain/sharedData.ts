export interface SharedPreferencePatch {
  readonly field: string;
  readonly value: string;
  readonly operationId: string;
  readonly effectiveAfterPhaseId: string | null;
}

const SHARED_FIELDS = new Set(["focusMinutes", "shortBreakMinutes", "longBreakMinutes", "longBreakAfter", "defaultTagId"]);
const LOCAL_FIELDS = new Set(["theme", "cueMode", "notificationPermission", "navigation", "routeHealth", "selectedCrew", "hiddenMembers"]);

export function materializeSharedPreferences(patches: readonly SharedPreferencePatch[]): ReadonlyMap<string, SharedPreferencePatch> {
  const result = new Map<string, SharedPreferencePatch>();
  const ordered = [...patches]
    .filter((patch) => SHARED_FIELDS.has(patch.field))
    .sort((left, right) => left.operationId.localeCompare(right.operationId));
  for (const patch of ordered) result.set(patch.field, patch);
  return result;
}

export function isDeviceLocalPreference(field: string): boolean { return LOCAL_FIELDS.has(field); }

export interface ProfileVersion { readonly operationId: string; readonly name: string; readonly photoBlobId: string | null }
export interface ProfileProjection { readonly complete: ProfileVersion | null; readonly pending: ProfileVersion | null }

export function applyProfile(current: ProfileProjection, incoming: ProfileVersion, verifiedBlobIds: ReadonlySet<string>): ProfileProjection {
  return incoming.photoBlobId === null || verifiedBlobIds.has(incoming.photoBlobId) ?
    { complete: incoming, pending: null } : { complete: current.complete, pending: incoming };
}

export type MembershipIntent = "JOIN" | "LEAVE";
export interface CrewMembershipFact { readonly operationId: string; readonly crewId: string; readonly intent: MembershipIntent }

export function materializeCrewMembership(facts: readonly CrewMembershipFact[]): {
  readonly joined: boolean | null; readonly decisionRequired: boolean; readonly publicationPaused: boolean;
} {
  const intents = new Set(facts.map((fact) => fact.intent));
  if (intents.size > 1) return { joined: null, decisionRequired: true, publicationPaused: true };
  return { joined: intents.has("JOIN"), decisionRequired: false, publicationPaused: false };
}

export async function crewPseudonym(memberSecret: Uint8Array, crewId: string): Promise<string> {
  if (memberSecret.length < 32 || crewId.trim().length === 0) throw new Error("invalid Crew pseudonym input");
  const encodedCrew = new TextEncoder().encode(crewId);
  const joined = new Uint8Array(memberSecret.length + encodedCrew.length);
  joined.set(memberSecret);
  joined.set(encodedCrew, memberSecret.length);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", joined))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function classifyDataFamily(version: number): "ACCEPTED" | "PENDING_FORWARD" {
  return version === 1 ? "ACCEPTED" : "PENDING_FORWARD";
}
