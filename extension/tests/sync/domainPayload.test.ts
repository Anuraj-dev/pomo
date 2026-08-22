import { expect, test } from "bun:test";
import { encodeCanonicalCbor } from "../../src/sync/protocol/cbor";
import { OperationKind } from "../../src/sync/protocol/types";
import { requireValidDomainPayload } from "../../src/sync/protocol/domainPayload";

test("rejects blank identifiers and invalid merged-into on authenticated payloads", () => {
  expect(() => requireValidDomainPayload(OperationKind.Tag, encodeCanonicalCbor([3, "", "Work", 0, false, null]))).toThrow(/Tag/);
  expect(() => requireValidDomainPayload(OperationKind.Tag, encodeCanonicalCbor([3, "tag-work", "Work", 0, false, ""]))).toThrow(/Tag/);
  expect(() => requireValidDomainPayload(OperationKind.Tag, encodeCanonicalCbor([3, "tag-work", "Work", 0, false, 1]))).toThrow(/Tag/);
  expect(() => requireValidDomainPayload(OperationKind.Profile, encodeCanonicalCbor([4, "", null]))).toThrow(/Profile/);
  expect(() => requireValidDomainPayload(OperationKind.Crew, encodeCanonicalCbor([5, "", true]))).toThrow(/Crew/);
  expect(() => requireValidDomainPayload(OperationKind.Timer, encodeCanonicalCbor([6, "START", "", [], "android", "claim-a"]))).toThrow(/Timer/);
});

test("rejects non-string History and Timer array elements", () => {
  expect(() => requireValidDomainPayload(OperationKind.History, encodeCanonicalCbor([2, "CREATE", "block-1", [1]]))).toThrow(/History/);
  expect(() => requireValidDomainPayload(OperationKind.Timer, encodeCanonicalCbor([6, "START", "phase-1", [1], "android", "claim-a"]))).toThrow(/Timer/);
});
