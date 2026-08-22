import { expect, test } from "bun:test";
import { evaluateActivationGate, REQUIRED_ROW_IDS, type PhysicalMatrix } from "../../scripts/activationGate";

const COMMIT = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DEV_SHA = "aa".repeat(32);
const PROD_SHA = "bb".repeat(32);
const CHROME_SHA = "cc".repeat(32);

const blockedRow = (id: string) => ({
  id,
  scenario: id,
  required: true,
  status: "BLOCKED" as const,
  evidence: "",
  blockedReason: "not run",
});

const passRow = (id: string) => ({
  id,
  scenario: id,
  required: true,
  status: "PASS_PHYSICAL" as const,
  evidence: `evidence/${id}.log#${COMMIT}`,
});

const dormantMatrix = (): PhysicalMatrix => ({
  schema: 1,
  suite: 1,
  generation: 1,
  rows: REQUIRED_ROW_IDS.map(blockedRow),
});

test("checked-in physical matrix is dormant-legal", async () => {
  const fixture = await Bun.file(new URL("../../../sync-protocol/fixtures/system-generation.json", import.meta.url)).json() as { readonly productionActivation: boolean };
  const matrix = await Bun.file(new URL("../../../sync-protocol/activation/physical-matrix.json", import.meta.url)).json();
  expect(fixture.productionActivation).toBeFalse();
  expect(evaluateActivationGate({ productionActivation: fixture.productionActivation, matrix }).ok).toBeTrue();
  expect(evaluateActivationGate({ productionActivation: true, matrix }).ok).toBeFalse();
});

test("dormant productionActivation is allowed with blocked physical rows", () => {
  const result = evaluateActivationGate({ productionActivation: false, matrix: dormantMatrix() });
  expect(result.ok).toBeTrue();
});

test("activation is rejected while any required row is blocked", () => {
  const result = evaluateActivationGate({ productionActivation: true, matrix: dormantMatrix() });
  expect(result.ok).toBeFalse();
  expect(result.errors.some((error) => error.includes("android-android"))).toBeTrue();
});

test("activation requires pass evidence, artifacts, and commit", () => {
  const matrix: PhysicalMatrix = {
    schema: 1,
    suite: 1,
    generation: 1,
    commit: COMMIT,
    artifactVersions: {
      androidDevDebugSha256: DEV_SHA,
      androidProdDebugSha256: PROD_SHA,
      chromeTestZipSha256: CHROME_SHA,
    },
    rows: REQUIRED_ROW_IDS.map(passRow),
  };
  expect(evaluateActivationGate({ productionActivation: true, matrix }).ok).toBeTrue();
  const missingEvidence = {
    ...matrix,
    rows: matrix.rows.map((row, index) => (index === 0 ? { ...row, evidence: "" } : row)),
  };
  expect(evaluateActivationGate({ productionActivation: true, matrix: missingEvidence }).ok).toBeFalse();
  const placeholderHashes = {
    ...matrix,
    artifactVersions: {
      androidDevDebugSha256: "aa",
      androidProdDebugSha256: "bb",
      chromeTestZipSha256: "cc",
    },
  };
  expect(evaluateActivationGate({ productionActivation: true, matrix: placeholderHashes }).ok).toBeFalse();
});

test("fail physical must keep evidence and still blocks activation", () => {
  const matrix: PhysicalMatrix = {
    schema: 1,
    suite: 1,
    generation: 1,
    commit: COMMIT,
    artifactVersions: {
      androidDevDebugSha256: DEV_SHA,
      androidProdDebugSha256: PROD_SHA,
      chromeTestZipSha256: CHROME_SHA,
    },
    rows: REQUIRED_ROW_IDS.map((id, index) =>
      index === 0
        ? { id, scenario: id, required: true, status: "FAIL_PHYSICAL", evidence: `evidence/fail.log#${COMMIT}` }
        : passRow(id),
    ),
  };
  const result = evaluateActivationGate({ productionActivation: true, matrix });
  expect(result.ok).toBeFalse();
  expect(evaluateActivationGate({ productionActivation: false, matrix }).ok).toBeTrue();
});
