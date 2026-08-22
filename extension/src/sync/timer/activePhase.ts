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
  readonly staleCommandIds: ReadonlySet<string>;
}
export interface TimerCommandRequest { readonly requesterDeviceId: string; readonly phaseId: string; readonly exactCommandHead: string; readonly action: TimerAction }
const NORMAL_OWNER_ACTIONS = new Set<TimerAction>(["PAUSE", "RESUME", "EXTEND", "SKIP", "RESET", "COMPLETE"]);

export function materializeActivePhase(input: readonly TimerFact[]): ActivePhaseProjection {
  const unique = new Map(input.map((fact) => [fact.operationId, fact]));
  const facts = [...unique.values()].sort((left, right) => left.operationId.localeCompare(right.operationId));
  if (facts.length === 0) return { phaseId: null, plan: null, heads: new Set(), ownerDeviceId: null, settlementRequired: false, completedOperationIds: new Set(), timeUncertain: false, pending: new Set(), staleCommandIds: new Set() };
  if (new Set(facts.map((fact) => fact.phaseId)).size !== 1) throw new Error("Projection must target one identified phase");
  const accepted = new Map<string, TimerFact>();
  const pending = new Set<string>();
  const ancestry = new Map<string, boolean>();
  const isCausallyReady = (operationId: string, visiting: ReadonlySet<string> = new Set()): boolean => {
    const cached = ancestry.get(operationId);
    if (cached !== undefined) return cached;
    if (visiting.has(operationId)) return false;
    const fact = unique.get(operationId);
    if (fact === undefined) return false;
    const nextVisiting = new Set(visiting).add(operationId);
    const ready = [...fact.parentHeads].every((parentId) => isCausallyReady(parentId, nextVisiting));
    ancestry.set(operationId, ready);
    return ready;
  };
  for (const fact of facts) {
    if (isCausallyReady(fact.operationId)) accepted.set(fact.operationId, fact);
    else pending.add(fact.operationId);
  }
  const starts = [...accepted.values()].filter((fact) => fact.action === "START");
  if (starts.length === 0) throw new Error("Active phase requires Start");
  const plan = starts[0]!.plan;
  for (const fact of accepted.values()) {
    if (JSON.stringify(fact.plan) !== JSON.stringify(plan)) throw new Error("Phase plan is locked");
    if (!Number.isSafeInteger(fact.elapsedMillis) || fact.elapsedMillis < 0) throw new Error("invalid elapsed time");
  }
  const staleCommandIds = new Set<string>();
  for (const fact of accepted.values()) {
    if (!NORMAL_OWNER_ACTIONS.has(fact.action)) continue;
    const parentId = fact.parentHeads.size === 1 ? [...fact.parentHeads][0] : undefined;
    const parent = parentId === undefined ? undefined : accepted.get(parentId);
    if (parent === undefined || fact.ownerDeviceId !== parent.ownerDeviceId || fact.ownershipClaimId !== parent.ownershipClaimId) {
      staleCommandIds.add(fact.operationId);
    }
  }
  for (const id of staleCommandIds) accepted.delete(id);
  let pruned = true;
  while (pruned) {
    pruned = false;
    const present = new Set(accepted.keys());
    for (const fact of [...accepted.values()]) {
      if ([...fact.parentHeads].some((parentId) => !present.has(parentId))) {
        accepted.delete(fact.operationId);
        staleCommandIds.add(fact.operationId);
        pruned = true;
      }
    }
  }
  const withoutSettles = new Map([...accepted].filter(([, fact]) => fact.action !== "SETTLE"));
  const referencedWithoutSettles = new Set([...withoutSettles.values()].flatMap((fact) => [...fact.parentHeads]));
  const headsWithoutSettles = new Set([...withoutSettles.keys()].filter((id) => !referencedWithoutSettles.has(id)));
  const validSettles = [...accepted.values()].filter((fact) => fact.action === "SETTLE" && fact.parentHeads.size === headsWithoutSettles.size && [...fact.parentHeads].every((id) => headsWithoutSettles.has(id)) && headsWithoutSettles.size >= 2);
  const canonical = new Map(withoutSettles);
  if (validSettles.length === 1) canonical.set(validSettles[0]!.operationId, validSettles[0]!);
  else for (const settle of validSettles) canonical.set(settle.operationId, settle);
  const referenced = new Set([...canonical.values()].flatMap((fact) => [...fact.parentHeads]));
  const heads = new Set([...canonical.keys()].filter((id) => !referenced.has(id)));
  const headFacts = [...heads].map((id) => canonical.get(id)!);
  const settlementRequired = heads.size > 1 || validSettles.length > 1;
  const effectiveHead = headFacts.length === 1 ? headFacts[0]! : null;
  return {
    phaseId: facts[0]!.phaseId,
    plan,
    heads,
    ownerDeviceId: effectiveHead?.ownerDeviceId ?? null,
    settlementRequired,
    completedOperationIds: new Set([...canonical.values()].filter((fact) => fact.action === "COMPLETE").map((fact) => fact.operationId)),
    timeUncertain: [...canonical.values()].some((fact) => fact.timeUncertain),
    pending,
    staleCommandIds,
  };
}
