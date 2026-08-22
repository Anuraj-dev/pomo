import { CoseOperationVerifier } from "./crypto/CoseOperation";
import { allowAllOperationAuthorization, OperationKernel, type OperationSigner } from "./kernel/OperationKernel";
import { SharedPreferenceProjection } from "./materialize/sharedPreferences";
import { IndexedDbKernelJournal } from "./storage/IndexedDbKernelJournal";
import { DormantSyncSystem } from "./dormantSyncSystem";

const publicKeys = new Map<string, CryptoKey>();
const verifier = new CoseOperationVerifier((deviceId) => publicKeys.get(deviceId));
const signer: OperationSigner = {
  async sign(): Promise<Uint8Array> {
    throw new Error("test artifact ingress does not author Operations");
  },
};
const kernel = new OperationKernel(
  verifier,
  signer,
  new IndexedDbKernelJournal(),
  new SharedPreferenceProjection(),
  allowAllOperationAuthorization,
);

/** Test-only sync entry point; production manifests never include this module. */
export const syncTestSystem = new DormantSyncSystem(
  { ingest: (wire) => kernel.ingest(wire) },
  { productionActivated: false, testArtifact: true },
);
syncTestSystem.startTestArtifact();
