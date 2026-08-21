import { DormantSyncSystem } from "./dormantSyncSystem";

/** Test-only sync entry point; production manifests never include this module. */
export const syncTestSystem = new DormantSyncSystem(
  { ingest: async () => "REJECTED_INVALID" },
  { productionActivated: false, testArtifact: true },
);
syncTestSystem.startTestArtifact();
