declare const __POMO_SYNC_TEST_ARTIFACT__: boolean;
declare const __POMO_SYNC_PRODUCTION_ACTIVATION__: boolean;

const testArtifact = typeof __POMO_SYNC_TEST_ARTIFACT__ !== "undefined" && __POMO_SYNC_TEST_ARTIFACT__;
const fixtureProductionActivation =
  typeof __POMO_SYNC_PRODUCTION_ACTIVATION__ !== "undefined" && __POMO_SYNC_PRODUCTION_ACTIVATION__;

export const SYNC_ACTIVATION = Object.freeze({
  productionActivated: !testArtifact && fixtureProductionActivation,
  testArtifact,
  suite: 1,
  generation: 1,
} as const);
