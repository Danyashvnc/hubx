// Post-build obfuscation of the production bundle (defense-in-depth).
//
// NOTE: obfuscation raises the bar for casual reverse-engineering of the
// client bundle; it is NOT a security control on its own. Real protection
// comes from the server (auth, TLS, rate limits). Run with: npm run build:secure

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import JavaScriptObfuscator from "javascript-obfuscator";

const ASSETS = join(process.cwd(), "dist", "assets");

const OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.4,
  deadCodeInjection: false,
  identifierNamesGenerator: "mangled-shuffled",
  numbersToExpressions: true,
  simplify: true,
  stringArray: true,
  stringArrayEncoding: ["base64"],
  stringArrayThreshold: 0.7,
  splitStrings: true,
  splitStringsChunkLength: 8,
  transformObjectKeys: true,
  selfDefending: false, // keep off: can break minified vendor code
  disableConsoleOutput: false,
};

const files = (await readdir(ASSETS)).filter((f) => f.endsWith(".js"));
let total = 0;
for (const f of files) {
  const p = join(ASSETS, f);
  const code = await readFile(p, "utf8");
  const before = code.length;
  const out = JavaScriptObfuscator.obfuscate(code, OPTIONS).getObfuscatedCode();
  await writeFile(p, out, "utf8");
  total++;
  console.log(`  obfuscated ${f}: ${(before / 1024).toFixed(0)}KB -> ${(out.length / 1024).toFixed(0)}KB`);
}
console.log(`[obfuscate] done (${total} file${total === 1 ? "" : "s"}).`);
