// Bundle the action into dist/index.js and collect the licenses of everything bundled.
import { build } from "esbuild";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const result = await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outfile: "dist/index.js",
  minify: true,
  legalComments: "none",
  metafile: true,
  banner: { js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" },
});

const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  const match = input.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
  if (match && !packages.has(match[1])) packages.set(match[1], path.join("node_modules", match[1]));
}

const sections = [];
for (const [name, dir] of [...packages].sort()) {
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const file = readdirSync(dir).find((f) => /^(licen[sc]e|copying)(\.|$)/i.test(f));
  const text = file ? readFileSync(path.join(dir, file), "utf8").trim() : `License: ${pkg.license ?? "unknown"}`;
  sections.push(`${name}@${pkg.version}\n${pkg.license ?? ""}\n\n${text}`);
}
if (!existsSync("dist")) mkdirSync("dist");
writeFileSync("dist/licenses.txt", sections.join("\n\n" + "-".repeat(72) + "\n\n") + "\n");
writeFileSync("dist/package.json", JSON.stringify({ type: "module" }) + "\n");
console.log(`Bundled ${packages.size} packages into dist/index.js`);
