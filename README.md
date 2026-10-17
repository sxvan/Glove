# web-tracking-extension

A Chrome extension that detects web tracking on the pages you visit:

- **Fingerprinting**: records calls to fingerprinting-related browser APIs (canvas, WebGL, audio, navigator, screen, …), attributes them to the calling script, and scores bursts of activity.
- **CNAME cloaking**: flags first-party-looking requests whose DNS CNAME chain ends at a different domain.
- **DNS tracking**: scores high-entropy subdomains that look like encoded identifiers.

Built with [WXT](https://wxt.dev), TypeScript and [Svelte](https://svelte.dev).

## Development

Tool versions are pinned with [mise](https://mise.jdx.dev). With mise installed:

```sh
mise install   # installs the pinned Node and pnpm versions
pnpm install   # installs dependencies
pnpm dev       # starts Chrome with the extension loaded and reloads on changes
```

Without mise, use Node 22 or newer and pnpm 12.

| Script         | Description                              |
| -------------- | ---------------------------------------- |
| `pnpm dev`     | Development mode with auto-reload        |
| `pnpm build`   | Production build in `.output/chrome-mv3` |
| `pnpm zip`     | Packaged build for the Chrome Web Store  |
| `pnpm compile` | Type-check with `svelte-check`           |

To load a production build manually, open `chrome://extensions`, enable developer mode, and choose "Load unpacked" with `.output/chrome-mv3`.

## Project layout

```
src/
  entrypoints/
    background.ts             session state, webRequest/webNavigation listeners, analysis scheduling
    fp-recorder.content.ts    main world: wraps fingerprinting APIs
    http-recorder.content.ts  main world: wraps fetch and XMLHttpRequest
    bridge.content.ts         isolated world: forwards recorder events to the background
    popup/                    toolbar popup UI (Svelte components)
  lib/                        analysis, DNS lookup, session management
  types/                      shared types
```

## Limits of the measurement

The extension sees fingerprinting by wrapping browser APIs in the page. Its wrappers take over the
original functions' names and source text, but a page can still tell that APIs were wrapped, e.g.
from a stack trace or another frame's untouched functions. Some scripts check for that and then
behave differently: anti-cheat and bot-detection scripts may collect less or skip parts of their
checks while the extension is installed. Their scores can then come out lower than what they do
for other visitors. Scripts that wait for interaction, like reCAPTCHA before its checkbox is
clicked, also show only part of their collection until the user acts.

## Privacy note

To detect CNAME cloaking, the extension resolves the hostname of every request through Google's public DNS-over-HTTPS resolver (`dns.google`).
