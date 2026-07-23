import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const documentSource = await readFile(
  new URL("./Document.tsx", import.meta.url),
  "utf8",
);

test("the web document exposes the complete Branchy icon set", () => {
  assert.match(documentSource, /href="\/favicon\.ico"/u);
  assert.match(documentSource, /href="\/apple-touch-icon\.png"/u);
  assert.match(documentSource, /href="\/site\.webmanifest"/u);
});

test("published browser icons match the supplied design assets", async () => {
  const fileNames = [
    "apple-touch-icon.png",
    "branchy-chat-app-icon.png",
    "branchy-chat-browser-logo.png",
    "favicon.ico",
    "icon-192.png",
    "icon-512.png",
  ];

  for (const fileName of fileNames) {
    assert.deepEqual(
      await readFile(new URL(`../../public/${fileName}`, import.meta.url)),
      await readFile(
        new URL(
          `../../designs/branchy-chat-icons/${fileName}`,
          import.meta.url,
        ),
      ),
      `${fileName} must stay in sync with the supplied icon set`,
    );
  }

  const manifest = JSON.parse(
    await readFile(
      new URL("../../public/site.webmanifest", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(
    manifest.icons.map(
      (icon: { sizes: string; src: string; type: string }) => icon,
    ),
    [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  );
});
