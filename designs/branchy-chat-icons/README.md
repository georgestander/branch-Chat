# Branchy Chat icons

Black branching-tree mark on white, prepared for macOS and the browser.

## Files

- `BranchyChat.icns` — packaged macOS icon for Electron
- `branchy-chat-app-icon.png` — 1024×1024 macOS/web app master
- `branchy-chat-browser-logo.png` — 1024×1024 black tree with transparency
- `favicon.ico` — multi-size browser favicon
- `icon-192.png` and `icon-512.png` — web manifest icons
- `apple-touch-icon.png` — 180×180 Apple touch icon

## Electron

Copy `BranchyChat.icns` into your app’s build/assets folder and point the
packager at it. For electron-builder:

```json
{
  "build": {
    "mac": {
      "icon": "build/BranchyChat.icns"
    }
  }
}
```

The packaged app must be rebuilt before Finder and the Dock show the new icon.

## Browser

Copy the web assets into the site’s public folder, then add:

```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
```

For a web manifest:

```json
{
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```
