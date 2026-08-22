import { rmSync, cpSync, watch, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generateIcons } from "./gen-icons";
import { evaluateActivationGate, type PhysicalMatrix } from "./activationGate";

const generation = JSON.parse(
  readFileSync(join(import.meta.dir, "../../sync-protocol/fixtures/system-generation.json"), "utf8"),
) as { readonly productionActivation: boolean; readonly suite: number; readonly generation: number };
const matrix = JSON.parse(
  readFileSync(join(import.meta.dir, "../../sync-protocol/activation/physical-matrix.json"), "utf8"),
) as PhysicalMatrix;
const gate = evaluateActivationGate({
  productionActivation: generation.productionActivation === true,
  matrix,
});
if (!gate.ok) {
  throw new Error(`physical activation gate failed:\n${gate.errors.join("\n")}`);
}
const testArtifact = process.env["POMO_SYNC_TEST_ARTIFACT"] === "true";
const productionActivation = !testArtifact && generation.productionActivation === true;

const root = join(import.meta.dir, "..");
const src = join(root, "src");
const dist = join(root, "dist");

const entries: Array<[string, string, "esm" | "iife"]> = [
  ["src/background/sw.ts", "sw.js", "iife"],
  ["src/surfaces/newtab/main.ts", "newtab.js", "esm"],
  ["src/surfaces/popup/main.ts", "popup.js", "esm"],
  ["src/surfaces/sidepanel/main.ts", "sidepanel.js", "esm"],
  ["src/surfaces/crew/main.ts", "crew.js", "esm"],
  ["src/sync/transport/offscreenWebRtc.ts", "offscreen-webrtc.js", "esm"],
];
if (testArtifact) entries.push(["src/sync/testArtifact.ts", "sync-test.js", "esm"]);

async function build() {
  rmSync(dist, { recursive: true, force: true });
  for (const [entry, outfile, format] of entries) {
    const res = await Bun.build({
      entrypoints: [join(root, entry)],
      outdir: dist,
      naming: { entry: outfile },
      target: "browser",
      format,
      sourcemap: "linked",
      define: {
        "process.env.NODE_ENV": '"production"',
        __POMO_SYNC_TEST_ARTIFACT__: testArtifact ? "true" : "false",
        __POMO_SYNC_PRODUCTION_ACTIVATION__: productionActivation ? "true" : "false",
      },
    });
    if (!res.success) {
      for (const log of res.logs) console.error(log);
      process.exit(1);
    }
  }
  cpSync(join(root, "manifest.json"), join(dist, "manifest.json"));
  for (const f of ["newtab.html", "popup.html", "sidepanel.html", "crew.html", "offscreen-webrtc.html"]) {
    cpSync(join(root, "src", "surfaces", f), join(dist, f));
  }
  for (const f of ["newtab.css", "popup.css", "sidepanel.css", "crew.css", "sync.css"]) {
    cpSync(join(root, "src", "surfaces", f), join(dist, f));
  }
  cpSync(join(src, "shared", "tokens.css"), join(dist, "tokens.css"));
  writeFileSync(
    join(dist, "sync-build-metadata.json"),
    `${JSON.stringify({ schema: 1, productionActivation, testArtifact, suite: generation.suite, generation: generation.generation }, null, 2)}\n`,
  );
  generateIcons();
  console.log("build ok -> dist/");
}

const watchMode = process.argv.includes("--watch");
await build();
if (watchMode) {
  console.log("watching src/ ...");
  watch(src, { recursive: true }, async () => {
    console.log("rebuilding...");
    await build();
  });
}
