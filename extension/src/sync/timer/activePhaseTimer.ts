import { materializeActivePhase, type ActivePhaseProjection, type PhasePlan, type TimerFact } from "./activePhase";

function nextId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

/**
 * Kernel-backed live timer. Phase truth is the materializer projection; the
 * wall clock only derives remaining time for the accepted head.
 */
export class ActivePhaseTimer {
  private readonly facts: TimerFact[] = [];
  private phaseAnchorMillis = 0;
  private running = false;
  private ownershipClaimId = "";

  constructor(
    private readonly deviceId: string,
    private readonly nowMillis: () => number = () => Date.now(),
  ) {}

  get projection(): ActivePhaseProjection {
    return materializeActivePhase(this.facts);
  }

  remainingMillis(): number {
    const current = this.projection;
    if (current.plan === null) return 0;
    const head = this.facts
      .filter((fact) => current.heads.has(fact.operationId))
      .sort((left, right) => left.operationId.localeCompare(right.operationId))
      .at(-1);
    if (head === undefined) return current.plan.durationMillis;
    const live = this.running && (head.action === "START" || head.action === "RESUME")
      ? Math.max(0, this.nowMillis() - this.phaseAnchorMillis)
      : 0;
    return Math.max(0, current.plan.durationMillis - head.elapsedMillis - live);
  }

  start(plan: PhasePlan, phaseId: string = crypto.randomUUID()): ActivePhaseProjection {
    this.facts.length = 0;
    this.running = true;
    this.phaseAnchorMillis = this.nowMillis();
    this.ownershipClaimId = nextId();
    return this.append({
      operationId: nextId(),
      phaseId,
      action: "START",
      parentHeads: new Set(),
      ownerDeviceId: this.deviceId,
      ownershipClaimId: this.ownershipClaimId,
      plan,
      elapsedMillis: 0,
      timeUncertain: false,
      composedElapsedMillis: null,
    });
  }

  pause(): ActivePhaseProjection {
    const current = this.requireActive();
    const elapsed = current.plan!.durationMillis - this.remainingMillis();
    this.running = false;
    return this.append({
      operationId: nextId(),
      phaseId: current.phaseId!,
      action: "PAUSE",
      parentHeads: current.heads,
      ownerDeviceId: this.deviceId,
      ownershipClaimId: this.ownershipClaimId,
      plan: current.plan!,
      elapsedMillis: Math.max(0, elapsed),
      timeUncertain: false,
      composedElapsedMillis: null,
    });
  }

  resume(): ActivePhaseProjection {
    const current = this.requireActive();
    this.running = true;
    this.phaseAnchorMillis = this.nowMillis();
    return this.append({
      operationId: nextId(),
      phaseId: current.phaseId!,
      action: "RESUME",
      parentHeads: current.heads,
      ownerDeviceId: this.deviceId,
      ownershipClaimId: this.ownershipClaimId,
      plan: current.plan!,
      elapsedMillis: current.plan!.durationMillis - this.remainingMillis(),
      timeUncertain: false,
      composedElapsedMillis: null,
    });
  }

  complete(): ActivePhaseProjection {
    const current = this.requireActive();
    this.running = false;
    return this.append({
      operationId: nextId(),
      phaseId: current.phaseId!,
      action: "COMPLETE",
      parentHeads: current.heads,
      ownerDeviceId: this.deviceId,
      ownershipClaimId: this.ownershipClaimId,
      plan: current.plan!,
      elapsedMillis: current.plan!.durationMillis,
      timeUncertain: false,
      composedElapsedMillis: null,
    });
  }

  private append(fact: TimerFact): ActivePhaseProjection {
    this.facts.push(fact);
    return materializeActivePhase(this.facts);
  }

  private requireActive(): ActivePhaseProjection {
    const current = this.projection;
    if (current.phaseId === null || current.plan === null) throw new Error("no active phase");
    return current;
  }
}
