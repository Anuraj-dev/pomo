import { rmSync, cpSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateIcons } from "./gen-icons";

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
        __POMO_SYNC_TEST_ARTIFACT__: process.env["POMO_SYNC_TEST_ARTIFACT"] === "true" ? "true" : "false",
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
    `${JSON.stringify({ schema: 1, productionActivation: false, testArtifact: process.env["POMO_SYNC_TEST_ARTIFACT"] === "true", suite: 1, generation: 1 }, null, 2)}\n`,
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
