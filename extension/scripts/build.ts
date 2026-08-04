import { rmSync, cpSync, watch } from "node:fs";
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
      define: { "process.env.NODE_ENV": '"production"' },
    });
    if (!res.success) {
      for (const log of res.logs) console.error(log);
      process.exit(1);
    }
  }
  cpSync(join(root, "manifest.json"), join(dist, "manifest.json"));
  for (const f of ["newtab.html", "popup.html", "sidepanel.html", "crew.html"]) {
    cpSync(join(root, "src", "surfaces", f), join(dist, f));
  }
  for (const f of ["newtab.css", "popup.css", "sidepanel.css", "crew.css"]) {
    cpSync(join(root, "src", "surfaces", f), join(dist, f));
  }
  cpSync(join(src, "shared", "tokens.css"), join(dist, "tokens.css"));
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
