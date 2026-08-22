import { readdir } from "node:fs/promises";

const dist = new URL("../dist/", import.meta.url);
const metadata = await Bun.file(new URL("sync-build-metadata.json", dist)).json() as { readonly productionActivation: boolean; readonly testArtifact: boolean; readonly suite: number; readonly generation: number };
const expectedTestArtifact = process.argv.includes("--test");
if (metadata.productionActivation || metadata.testArtifact !== expectedTestArtifact || metadata.suite !== 1 || metadata.generation !== 1) throw new Error(`unexpected sync package metadata: ${JSON.stringify(metadata)}`);
const manifest = await Bun.file(new URL("manifest.json", dist)).json() as Record<string, unknown>;
if (manifest["manifest_version"] !== 3 || "host_permissions" in manifest) throw new Error("packaged extension must remain MV3 with no ambient host permissions");
const files = await readdir(dist); const textFiles = files.filter((file) => /\.(?:html|js|css)$/.test(file));
for (const file of textFiles) {
  const text = await Bun.file(new URL(file, dist)).text();
  if (/<script[^>]+src=["']https?:\/\//i.test(text) || /import\s*\([^)]*https?:\/\//i.test(text)) throw new Error(`remote executable dependency in ${file}`);
}
const report = { schema: 1, evidenceClass: "PACKAGED_RUNTIME", scope: "structural package inspection; not browser execution", metadata, mv3: true, remoteExecutableDependencies: false, provider: "not measured", physical: "not measured" };
await Bun.write(new URL(`../evidence/sync-package-${expectedTestArtifact ? "test" : "production"}.json`, import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
