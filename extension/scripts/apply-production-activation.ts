import { evaluateActivationGate } from "./activationGate";

const fixtureUrl = new URL("../../sync-protocol/fixtures/system-generation.json", import.meta.url);
const matrixUrl = new URL("../../sync-protocol/activation/physical-matrix.json", import.meta.url);
const fixtureText = await Bun.file(fixtureUrl).text();
const fixture = JSON.parse(fixtureText) as { productionActivation: boolean; suite: number; generation: number };
const matrix = await Bun.file(matrixUrl).json();
const result = evaluateActivationGate({ productionActivation: true, matrix });
if (!result.ok) {
  throw new Error(
    `refusing to activate; physical matrix is incomplete:\n${result.errors.join("\n")}\n\nFill docs/sync-validation-runbook.md results first.`,
  );
}
if (fixture.productionActivation === true) {
  console.log("productionActivation is already true");
  process.exit(0);
}
const updated = fixtureText.replace(/"productionActivation"\s*:\s*false/, '"productionActivation": true');
if (updated === fixtureText) throw new Error("could not find productionActivation false in system-generation.json");
await Bun.write(fixtureUrl, updated);
console.log("wrote sync-protocol/fixtures/system-generation.json productionActivation=true");
console.log("Open an isolated PR with that file and the completed physical-matrix.json only.");
