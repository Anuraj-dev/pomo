export interface SyncEnvelope { readonly operationId: string; readonly feedKey: string; readonly sequence: number; readonly wire: Uint8Array }
export interface DurablePeerFrontier {
  readonly sequence: number;
  readonly operationId: string;
  readonly coveredOperationIds?: ReadonlySet<string>;
}

export interface DurablePeerAck {
  readonly peerDeviceId: string;
  readonly frontier: ReadonlyMap<string, DurablePeerFrontier>;
  readonly signatureVerified: boolean;
}
export type DirectRouteState = "OFFLINE" | "CATCHING_UP" | "LIVE";

export class DirectSyncCoordinator {
  static readonly MAX_BATCH = 256;
  readonly #pending = new Map<string, SyncEnvelope>();
  #state: DirectRouteState = "OFFLINE";
  constructor(obligations: readonly SyncEnvelope[]) { for (const envelope of obligations) this.#pending.set(envelope.operationId, envelope); }
  get state(): DirectRouteState { return this.#state; }
  connected(): void { this.#state = "CATCHING_UP"; }
  disconnected(): void { this.#state = "OFFLINE"; }
  nextBatch(limit = DirectSyncCoordinator.MAX_BATCH): readonly SyncEnvelope[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > DirectSyncCoordinator.MAX_BATCH) throw new Error("invalid direct-sync batch bound");
    return [...this.#pending.values()].sort((left, right) => left.feedKey.localeCompare(right.feedKey) || left.sequence - right.sequence).slice(0, limit);
  }
  async ingest(envelopes: readonly SyncEnvelope[], kernelIngest: (wire: Uint8Array) => Promise<unknown>): Promise<void> {
    const unique = new Map(envelopes.map((envelope) => [envelope.operationId, envelope]));
    for (const envelope of unique.values()) await kernelIngest(envelope.wire.slice());
  }
  acknowledge(ack: DurablePeerAck): void {
    if (!ack.signatureVerified) throw new Error("Only signed durable acknowledgments clear obligations");
    for (const [id, envelope] of this.#pending) {
      const head = ack.frontier.get(envelope.feedKey);
      if (head !== undefined &&
          ((head.sequence === envelope.sequence && head.operationId === envelope.operationId) ||
            (head.sequence >= envelope.sequence && head.coveredOperationIds?.has(envelope.operationId) === true))) {
        this.#pending.delete(id);
      }
    }
    if (this.#pending.size === 0) this.#state = "LIVE";
  }
  liveObservationTrusted(): boolean { return this.#state === "LIVE"; }
  pendingOperationIds(): ReadonlySet<string> { return new Set(this.#pending.keys()); }
}
