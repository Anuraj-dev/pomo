export const REQUIRED_ROW_IDS = [
  "android-android",
  "android-chrome",
  "chrome-chrome",
  "lan",
  "direct-internet",
  "turn",
  "webdav-providers",
  "offline-duration",
  "lifecycle-loss",
  "recovery",
  "migration",
  "conflict",
  "performance",
] as const;

export const ALLOWED_STATUSES = ["PASS_PHYSICAL", "FAIL_PHYSICAL", "BLOCKED"] as const;

export type RowStatus = (typeof ALLOWED_STATUSES)[number];

export interface PhysicalMatrixRow {
  readonly id: string;
  readonly scenario: string;
  readonly required: boolean;
  readonly status: string;
  readonly evidence: string;
  readonly blockedReason?: string;
}

export interface PhysicalMatrix {
  readonly schema: number;
  readonly suite: number;
  readonly generation: number;
  readonly commit?: string;
  readonly artifactVersions?: Readonly<Record<string, string>>;
  readonly rows: readonly PhysicalMatrixRow[];
}

export interface ActivationGateInput {
  readonly productionActivation: boolean;
  readonly matrix: PhysicalMatrix;
}

export interface ActivationGateResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

const allowed = new Set<string>(ALLOWED_STATUSES);

export function evaluateActivationGate(input: ActivationGateInput): ActivationGateResult {
  const errors: string[] = [];
  if (input.matrix.schema !== 1) errors.push(`unsupported matrix schema ${input.matrix.schema}`);
  if (input.matrix.suite !== 1) errors.push(`matrix suite ${input.matrix.suite} is not POMO-SUITE-1`);
  if (input.matrix.generation !== 1) errors.push(`matrix generation ${input.matrix.generation} is not generation 1`);

  const byId = new Map<string, PhysicalMatrixRow>();
  for (const row of input.matrix.rows) {
    if (byId.has(row.id)) errors.push(`duplicate matrix row ${row.id}`);
    byId.set(row.id, row);
    if (!allowed.has(row.status)) errors.push(`row ${row.id} has illegal status ${row.status}`);
    if (row.status === "BLOCKED" && !row.blockedReason) errors.push(`row ${row.id} is BLOCKED without a reason`);
    if (row.status === "PASS_PHYSICAL" && row.evidence.trim() === "") {
      errors.push(`row ${row.id} is PASS_PHYSICAL without versioned evidence`);
    }
    if (row.status === "FAIL_PHYSICAL" && row.evidence.trim() === "") {
      errors.push(`row ${row.id} is FAIL_PHYSICAL without versioned evidence`);
    }
  }

  for (const id of REQUIRED_ROW_IDS) {
    const row = byId.get(id);
    if (row === undefined) {
      errors.push(`missing required row ${id}`);
      continue;
    }
    if (!row.required) errors.push(`row ${id} must stay required`);
  }

  if (input.productionActivation) {
    for (const id of REQUIRED_ROW_IDS) {
      const row = byId.get(id);
      if (row === undefined) continue;
      if (row.status !== "PASS_PHYSICAL") {
        errors.push(`productionActivation requires ${id} PASS_PHYSICAL (have ${row.status})`);
      }
    }
    const versions = input.matrix.artifactVersions ?? {};
    for (const key of ["androidDevDebugSha256", "androidProdDebugSha256", "chromeTestZipSha256"]) {
      if (!versions[key]) errors.push(`productionActivation requires artifactVersions.${key}`);
    }
    if (!input.matrix.commit) errors.push("productionActivation requires matrix commit");
  }

  return { ok: errors.length === 0, errors };
}
