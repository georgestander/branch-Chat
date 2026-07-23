import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.tsx";
import "./styles.css";

function initializeTheme(): void {
  let theme: "light" | "dark" | null = null;
  try {
    const stored = window.localStorage.getItem("branchy:theme");
    if (stored === "light" || stored === "dark") theme = stored;
  } catch {
    // The app can still use the system preference without local storage.
  }
  const resolved =
    theme ??
    (window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light");
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.style.colorScheme = resolved;
}

initializeTheme();

const root = document.getElementById("app");
if (!root) {
  throw new Error("Branchy renderer root is missing");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
