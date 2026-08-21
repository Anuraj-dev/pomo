declare const __POMO_SYNC_TEST_ARTIFACT__: boolean;

export const SYNC_ACTIVATION = Object.freeze({
  productionActivated: false,
  testArtifact: typeof __POMO_SYNC_TEST_ARTIFACT__ !== "undefined" && __POMO_SYNC_TEST_ARTIFACT__,
  suite: 1,
  generation: 1,
} as const);
