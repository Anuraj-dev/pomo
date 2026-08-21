export type PhaseKind = "WORK" | "SHORT_BREAK" | "LONG_BREAK";
export type TimerAction = "START" | "PAUSE" | "RESUME" | "EXTEND" | "SKIP" | "RESET" | "COMPLETE" | "HANDOFF" | "PROVISIONAL_TAKEOVER" | "SETTLE";
export interface PhasePlan { readonly kind: PhaseKind; readonly durationMillis: number; readonly tagId: string | null }
export interface TimerFact {
  readonly operationId: string;
  readonly phaseId: string;
  readonly action: TimerAction;
  readonly parentHeads: ReadonlySet<string>;
  readonly ownerDeviceId: string;
  readonly ownershipClaimId: string;
  readonly plan: PhasePlan;
  readonly elapsedMillis: number;
  readonly timeUncertain: boolean;
  readonly composedElapsedMillis: number | null;
}
export interface ActivePhaseProjection {
  readonly phaseId: string | null;
  readonly plan: PhasePlan | null;
  readonly heads: ReadonlySet<string>;
  readonly ownerDeviceId: string | null;
  readonly settlementRequired: boolean;
  readonly completedOperationIds: ReadonlySet<string>;
  readonly timeUncertain: boolean;
  readonly pending: ReadonlySet<string>;
}
export interface TimerCommandRequest { readonly requesterDeviceId: string; readonly phaseId: string; readonly exactCommandHead: string; readonly action: TimerAction }
const NORMAL_OWNER_ACTIONS = new Set<TimerAction>(["PAUSE", "RESUME", "EXTEND", "SKIP", "RESET", "COMPLETE"]);

export function materializeActivePhase(input: readonly TimerFact[]): ActivePhaseProjection {
  const unique = new Map(input.map((fact) => [fact.operationId, fact]));
  const facts = [...unique.values()].sort((left, right) => left.operationId.localeCompare(right.operationId));
  if (facts.length === 0) return { phaseId: null, plan: null, heads: new Set(), ownerDeviceId: null, settlementRequired: false, completedOperationIds: new Set(), timeUncertain: false, pending: new Set() };
  if (new Set(facts.map((fact) => fact.phaseId)).size !== 1) throw new Error("Projection must target one identified phase");
  const accepted = new Map<string, TimerFact>();
  const pending = new Set<string>();
  for (const fact of facts) {
    if ([...fact.parentHeads].some((id) => !unique.has(id))) pending.add(fact.operationId);
    else accepted.set(fact.operationId, fact);
  }
  const starts = [...accepted.values()].filter((fact) => fact.action === "START");
  if (starts.length === 0) throw new Error("Active phase requires Start");
  const plan = starts[0]!.plan;
  for (const fact of accepted.values()) {
    if (JSON.stringify(fact.plan) !== JSON.stringify(plan)) throw new Error("Phase plan is locked");
    if (!Number.isSafeInteger(fact.elapsedMillis) || fact.elapsedMillis < 0) throw new Error("invalid elapsed time");
    if (fact.action === "SETTLE" && fact.parentHeads.size < 2) throw new Error("Settlement must reference every conflicting head");
    if (NORMAL_OWNER_ACTIONS.has(fact.action)) {
      const parentId = fact.parentHeads.size === 1 ? [...fact.parentHeads][0] : undefined;
      const parent = parentId === undefined ? undefined : accepted.get(parentId);
      if (parent === undefined || fact.ownerDeviceId !== parent.ownerDeviceId || fact.ownershipClaimId !== parent.ownershipClaimId) {
        throw new Error("Only the uncontested owner may author a normal Timer command");
      }
    }
  }
  const referenced = new Set([...accepted.values()].flatMap((fact) => [...fact.parentHeads]));
  const heads = new Set([...accepted.keys()].filter((id) => !referenced.has(id)));
  const headFacts = [...heads].map((id) => accepted.get(id)!);
  const settlementRequired = heads.size > 1 || headFacts.filter((fact) => fact.action === "SETTLE").length > 1;
  const effectiveHead = headFacts.length === 1 ? headFacts[0]! : null;
  return {
    phaseId: facts[0]!.phaseId,
    plan,
    heads,
    ownerDeviceId: effectiveHead?.ownerDeviceId ?? null,
    settlementRequired,
    completedOperationIds: new Set([...accepted.values()].filter((fact) => fact.action === "COMPLETE").map((fact) => fact.operationId)),
    timeUncertain: [...accepted.values()].some((fact) => fact.timeUncertain),
    pending,
  };
}
