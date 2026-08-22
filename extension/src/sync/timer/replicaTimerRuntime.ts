import { SYNC_ACTIVATION } from "../activation";
import { ActivePhaseTimer } from "./activePhaseTimer";

let timer: ActivePhaseTimer | null = null;

export function startReplicaTimer(deviceId: string): void {
  if (!(SYNC_ACTIVATION.testArtifact || SYNC_ACTIVATION.productionActivated)) return;
  if (timer !== null) return;
  timer = new ActivePhaseTimer(deviceId);
}

export function stopReplicaTimer(): void {
  timer = null;
}

export function replicaTimer(): ActivePhaseTimer | null {
  return timer;
}

export function installReplicaTimerForTest(next: ActivePhaseTimer | null): void {
  timer = next;
}
