import "./styles.css";

type PingResponse = {
  ok: boolean;
  appName: string;
  electron: string;
  node: string;
  platform: string;
};

declare global {
  interface Window {
    branchy: {
      ping: () => Promise<PingResponse>;
    };
  }
}

const status = document.getElementById("status");
const platform = document.getElementById("platform");
const electronVersion = document.getElementById("electron");
const nodeVersion = document.getElementById("node");
const refreshButton = document.getElementById("refresh");

async function refresh(): Promise<void> {
  if (!status || !platform || !electronVersion || !nodeVersion) return;
  status.textContent = "Checking the native bridge...";
  try {
    const info = await window.branchy.ping();
    status.textContent = info.ok
      ? `Bridge ready in ${info.appName}.`
      : "Bridge responded, but not cleanly.";
    platform.textContent = info.platform;
    electronVersion.textContent = info.electron;
    nodeVersion.textContent = info.node;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Bridge check failed.";
    platform.textContent = "—";
    electronVersion.textContent = "—";
    nodeVersion.textContent = "—";
  }
}

refreshButton?.addEventListener("click", () => {
  void refresh();
});

void refresh();
