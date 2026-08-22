import { SYNC_ACTIVATION } from "./activation";

export interface AuthenticatedOperationIngress {
  /** The only synchronization ingress; implementations delegate to OperationKernel.ingest. */
  ingest(signedEnvelope: Uint8Array): Promise<string>;
}
export interface SyncActivationMode { readonly productionActivated: boolean; readonly testArtifact: boolean }

export class DormantSyncSystem {
  #started = false;
  constructor(private readonly ingress: AuthenticatedOperationIngress, private readonly mode: SyncActivationMode = SYNC_ACTIVATION) {}
  startTestArtifact(): void {
    if (!this.mode.testArtifact || this.mode.productionActivated) throw new Error("Dormant synchronization is unavailable in production");
    this.#started = true;
  }
  start(): void {
    if (!this.mode.testArtifact && !this.mode.productionActivated) throw new Error("Dormant synchronization is unavailable in production");
    this.#started = true;
  }
  async ingestFromReplica(signedEnvelope: Uint8Array): Promise<string> {
    if (!this.#started) throw new Error("Dormant synchronization is unavailable in production");
    return await this.ingress.ingest(signedEnvelope.slice());
  }
  productionMigrationCutoverAllowed(): false { return false; }
}
