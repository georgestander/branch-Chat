export const THEME_STORAGE_KEY = "connexus:ui:theme";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

function resolveSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") {
    return resolveSystemTheme();
  }
  return preference;
}

export function applyThemePreference(preference: ThemePreference) {
  if (typeof document === "undefined") {
    return;
  }

  const resolved = resolveTheme(preference);
  const root = document.documentElement;

  root.classList.toggle("dark", resolved === "dark");
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;

  try {
    if (preference === "system") {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    }
  } catch {
    // Ignore localStorage failures in restricted browser contexts.
  }
}

export function getInitialThemePreference(): ThemePreference {
  if (typeof document === "undefined") {
    return "system";
  }

  const raw = document.documentElement.dataset.themePreference;
  if (raw === "light" || raw === "dark" || raw === "system") {
    return raw;
  }

  return "system";
}
