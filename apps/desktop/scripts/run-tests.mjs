import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = join(desktopRoot, "src");

async function discoverTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return discoverTests(path);
      }
      return entry.isFile() && entry.name.endsWith(".test.ts") ? [path] : [];
    }),
  );
  return paths.flat();
}

const tests = (await discoverTests(sourceRoot)).sort();
if (tests.length === 0) {
  throw new Error("No desktop tests were discovered");
}

const child = spawn(
  process.execPath,
  ["--experimental-strip-types", "--test", ...tests],
  {
    cwd: desktopRoot,
    stdio: "inherit",
  },
);

child.once("error", (error) => {
  throw error;
});
child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
