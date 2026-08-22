import { evaluateActivationGate } from "./activationGate";

const fixtureUrl = new URL("../../sync-protocol/fixtures/system-generation.json", import.meta.url);
const matrixUrl = new URL("../../sync-protocol/activation/physical-matrix.json", import.meta.url);
const fixture = await Bun.file(fixtureUrl).json() as { readonly productionActivation: boolean; readonly suite: number; readonly generation: number };
const matrix = await Bun.file(matrixUrl).json();
const result = evaluateActivationGate({ productionActivation: fixture.productionActivation, matrix });
if (fixture.suite !== 1 || fixture.generation !== 1) {
  throw new Error(`unexpected system generation envelope: suite=${fixture.suite} generation=${fixture.generation}`);
}
if (!result.ok) {
  throw new Error(`activation gate failed:\n${result.errors.join("\n")}`);
}
console.log(JSON.stringify({ ok: true, productionActivation: fixture.productionActivation, requiredRows: matrix.rows.length }, null, 2));
