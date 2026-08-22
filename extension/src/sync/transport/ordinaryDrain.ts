import type { ReconstructedSyncState } from "../storage/IndexedDbOperationDao";
import { DirectSyncCoordinator, type DurablePeerAck, type SyncEnvelope } from "./directSync";

export interface DrainExchange {
  readonly inbound?: readonly SyncEnvelope[];
  readonly ack?: DurablePeerAck;
  readonly connected?: boolean;
}

export interface DrainRoute {
  readonly name: string;
  exchange(batch: readonly SyncEnvelope[]): Promise<DrainExchange> | DrainExchange;
}

export interface DrainResult {
  readonly delivered: ReadonlySet<string>;
  readonly remaining: ReadonlySet<string>;
  readonly inbound: number;
  readonly localOnly: boolean;
  readonly live: boolean;
}

export function envelopesFrom(snapshot: ReconstructedSyncState): SyncEnvelope[] {
  const byId = new Map(snapshot.operations.map((operation) => [operation.operationId, operation]));
  return snapshot.outbox.flatMap((row) => {
    const operation = byId.get(row.operationId);
    if (operation === undefined) return [];
    return [{
      operationId: row.operationId,
      feedKey: operation.feedKey,
      sequence: operation.sequence,
      wire: row.rawWire.slice(),
    }];
  });
}

export async function drainOrdinaryOutbox(input: {
  readonly obligations: readonly SyncEnvelope[];
  readonly routes: readonly DrainRoute[];
  readonly ingest: (wire: Uint8Array) => Promise<unknown> | unknown;
  readonly markDelivered: (operationId: string) => Promise<void> | void;
}): Promise<DrainResult> {
  const coordinator = new DirectSyncCoordinator(input.obligations);
  if (input.routes.length === 0) {
    return { delivered: new Set(), remaining: coordinator.pendingOperationIds(), inbound: 0, localOnly: true, live: false };
  }
  const delivered = new Set<string>();
  let inboundCount = 0;
  let anyConnected = false;
  for (const route of input.routes) {
    const batch = coordinator.nextBatch();
    let exchange: DrainExchange;
    try {
      exchange = await route.exchange(batch);
    } catch {
      continue;
    }
    if (exchange.connected === true) {
      coordinator.connected();
      anyConnected = true;
    }
    const inbound = exchange.inbound ?? [];
    try {
      await coordinator.ingest(inbound, async (wire) => input.ingest(wire));
      inboundCount += new Set(inbound.map((envelope) => envelope.operationId)).size;
    } catch {
      continue;
    }
    if (exchange.ack === undefined) continue;
    const before = coordinator.pendingOperationIds();
    try {
      coordinator.acknowledge(exchange.ack);
    } catch {
      continue;
    }
    for (const operationId of before) {
      if (coordinator.pendingOperationIds().has(operationId)) continue;
      await input.markDelivered(operationId);
      delivered.add(operationId);
    }
  }
  if (!anyConnected) coordinator.disconnected();
  return {
    delivered,
    remaining: coordinator.pendingOperationIds(),
    inbound: inboundCount,
    localOnly: !anyConnected,
    live: coordinator.liveObservationTrusted(),
  };
}
