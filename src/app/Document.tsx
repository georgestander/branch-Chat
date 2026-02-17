import type { AppContext } from "@/app/context";
import type { RequestInfo } from "rwsdk/worker";

import styles from "./styles.css?url";

const themeBootstrapScript = `
(() => {
  try {
    const key = "connexus:ui:theme";
    const stored = window.localStorage.getItem(key);
    const preference =
      stored === "light" || stored === "dark" ? stored : "system";
    const resolved =
      preference === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : preference;
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.dataset.theme = resolved;
    root.dataset.themePreference = preference;
  } catch {}
})();
`;

type DocumentProps = RequestInfo<any, AppContext> & {
  children: React.ReactNode;
};

export const Document: React.FC<DocumentProps> = ({ children, rw }) => (
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Branch-Chat</title>
      <script
        nonce={rw.nonce}
        dangerouslySetInnerHTML={{ __html: themeBootstrapScript }}
      />
      <link rel="modulepreload" href="/src/client.tsx" />
      <link rel="stylesheet" href={styles} />
    </head>
    <body>
      {children}
      <script nonce={rw.nonce} type="module" src="/src/client.tsx"></script>
    </body>
  </html>
);
