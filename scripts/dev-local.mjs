import { spawn } from "node:child_process";
import { startCodexBridge } from "./codex-bridge.mjs";

const bridge = await startCodexBridge();
const vite = spawn("vite", ["dev", "--host", "0.0.0.0"], {
  stdio: "inherit",
  env: process.env,
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  vite.kill(signal);
  await bridge.close();
}

vite.once("exit", async (code) => {
  await shutdown("SIGTERM");
  process.exitCode = code ?? 1;
});
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
