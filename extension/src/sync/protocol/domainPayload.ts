import { decodeCanonicalCbor, encodeCanonicalCbor, type CborValue } from "./cbor";
import { OperationKind } from "./types";
import { decodeSharedPreferenceFact } from "../materialize/sharedPreferences";

const KNOWN = new Set<number>([
  OperationKind.SharedPreferenceSet,
  OperationKind.History,
  OperationKind.Tag,
  OperationKind.Profile,
  OperationKind.Crew,
  OperationKind.Timer,
]);

export function requireValidDomainPayload(kind: number, payload: Uint8Array): void {
  if (!KNOWN.has(kind)) {
    decodeCanonicalCbor(payload);
    return;
  }
  if (kind === OperationKind.SharedPreferenceSet) {
    decodeSharedPreferenceFact(payload);
    return;
  }
  const fields = asArray(decodeCanonicalCbor(payload), kind);
  if (kind === OperationKind.History) {
    if (fields.length !== 4 || typeof fields[1] !== "string" || typeof fields[2] !== "string" || !Array.isArray(fields[3])) {
      throw new Error("invalid History payload");
    }
    if (!["CREATE", "CORRECT", "TOMBSTONE", "SETTLE"].includes(fields[1])) throw new Error("invalid History action");
    return;
  }
  if (kind === OperationKind.Tag) {
    if (fields.length !== 6 || typeof fields[1] !== "string" || typeof fields[2] !== "string" || typeof fields[3] !== "number" || typeof fields[4] !== "boolean") {
      throw new Error("invalid Tag payload");
    }
    return;
  }
  if (kind === OperationKind.Profile) {
    if (fields.length !== 3 || typeof fields[1] !== "string" || !(fields[2] === null || typeof fields[2] === "string")) throw new Error("invalid Profile payload");
    return;
  }
  if (kind === OperationKind.Crew) {
    if (fields.length !== 3 || typeof fields[1] !== "string" || typeof fields[2] !== "boolean") throw new Error("invalid Crew payload");
    return;
  }
  if (fields.length !== 6 || typeof fields[1] !== "string" || typeof fields[2] !== "string" || !Array.isArray(fields[3]) || typeof fields[4] !== "string" || typeof fields[5] !== "string") {
    throw new Error("invalid Timer payload");
  }
}

export function encodeHistoryPayload(action: "CREATE" | "CORRECT" | "TOMBSTONE" | "SETTLE", blockId: string, details: readonly string[]): Uint8Array {
  return encodeCanonicalCbor([OperationKind.History, action, blockId, [...details]]);
}

export function encodeTagPayload(tagId: string, name: string, paletteSlot: number, archived: boolean, mergedInto: string | null): Uint8Array {
  return encodeCanonicalCbor([OperationKind.Tag, tagId, name, paletteSlot, archived, mergedInto]);
}

export function encodeProfilePayload(name: string, photoBlobId: string | null): Uint8Array {
  return encodeCanonicalCbor([OperationKind.Profile, name, photoBlobId]);
}

export function encodeCrewPayload(crewId: string, join: boolean): Uint8Array {
  return encodeCanonicalCbor([OperationKind.Crew, crewId, join]);
}

export function encodeTimerPayload(action: string, phaseId: string, parentHeads: readonly string[], ownerDeviceId: string, ownershipClaimId: string): Uint8Array {
  return encodeCanonicalCbor([OperationKind.Timer, action, phaseId, [...parentHeads], ownerDeviceId, ownershipClaimId]);
}

export function preferenceProjectionOrEmpty(kind: number, payload: Uint8Array): { readonly key: string; readonly value: string } {
  if (kind !== OperationKind.SharedPreferenceSet) return { key: "", value: "" };
  const fact = decodeSharedPreferenceFact(payload);
  return { key: fact.key, value: fact.value };
}

function asArray(value: CborValue, kind: number): readonly CborValue[] {
  if (!Array.isArray(value) || value[0] !== kind) throw new Error("unsupported domain payload");
  return value;
}
