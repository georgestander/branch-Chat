import type { AppContext } from "@/app/context";
import type { RequestInfo } from "rwsdk/worker";

import styles from "./styles.css?url";

type DocumentProps = RequestInfo<any, AppContext> & {
  children: React.ReactNode;
};

export const Document: React.FC<DocumentProps> = ({ children, rw }) => (
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Connexus</title>
      <link rel="modulepreload" href="/src/client.tsx" />
      <link rel="stylesheet" href={styles} />
    </head>
    <body>
      <div id="root">{children}</div>
      <script
        nonce={rw.nonce}
        type="module"
        src="/src/client.tsx"
      />
    </body>
  </html>
);
