import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

import { runSuites } from "../src/testUtils/vitest-shim";

const ROOT = path.resolve(process.cwd(), "src");

function collectSpecs(dir: string, out: string[]) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSpecs(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".spec.ts")) {
      out.push(full);
    }
  }
}

async function loadSpecs(files: string[]) {
  for (const file of files) {
    const url = pathToFileURL(file).href;
    await import(url);
  }
}

async function main() {
  const specs: string[] = [];
  collectSpecs(ROOT, specs);
  specs.sort();
  await loadSpecs(specs);
  await runSuites();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
