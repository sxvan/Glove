# Glove

See which scripts on a page fingerprint your browser and how, so you can avoid them or block them.

Glove is a Chrome extension. On every page you visit, it records which scripts read the browser
details that fingerprinting relies on (canvas and WebGL images, audio, fonts, screen, navigator, …),
scores each script by how rare and identifying what it reads is, and lets you block the ones you
don't want.

## What it shows

- **The page's score on the toolbar icon**, as a ring filled to how likely the page fingerprints you.
- **A card per script in the popup**, most suspicious first, with what it read, how identifying that
  is together ("Up to 31 bits of identifying information"), signs of fingerprinting such as reading
  from generated code or from a single place, the data it sent right after reading, CNAME aliases
  it sent data through, and identifiers it stored in cookies or storage. "How the score came about"
  breaks the score down into the signals it was made from.
- **A details page** with every API read, request sent and value stored, and the page's full event
  log, searchable and sortable.
- **A script viewer** that shows a script's code with the fingerprinting calls marked.

## Blocking

A script can be blocked from its card. Blocked scripts are refused by the browser on every site from
their next load; the popup lists those that tried to load, to let them run again. Optionally, the page
reloads at once and the site's cookies and storage are cleared, so an identifier already stored goes
too. Blocking scripts automatically from a score is available in the settings, as an experiment: it
blocks by score alone and will break sites that need the script.

Glove can also be turned off for a site from the popup: it then records, scores and blocks nothing
there.

## How scripts are scored

Each fingerprinting API has its bits, how much identifying information it reveals, from a study of
4 million fingerprints ([Andriamilanto et al.](https://arxiv.org/abs/2006.09511)) and
[AmIUnique](https://amiunique.org/fingerprints-global-statistics)'s statistics, and its rarity, how
rarely pages use it, from [Chrome's usage statistics](https://chromestatus.com/metrics/feature/popularity).
A script scores high when it reads much that is both identifying and rarely needed, in one burst of
calls. Signals such as reading from generated code or sending data right after reading add to the
score as independent evidence. Every value is a default you can change in the settings, where each
is explained with its source.

## Limits

Glove sees fingerprinting by wrapping browser APIs in the page. Its wrappers look like the originals,
but a page can still tell that APIs were wrapped, and some scripts (anti-cheat, bot detection) then
collect less, so they score lower than for other visitors. Scripts that wait for interaction, like
reCAPTCHA before its checkbox is clicked, show only part of their collection until you act. Reads in
web workers aren't recorded: Chrome gives extensions no way to run code in them.

## Privacy

What Glove records stays in your browser and is gone when the tab closes. It contacts nothing,
except where you allow it in the settings (Privacy):

- **DNS lookups**, off by default: to find CNAME cloaking, another company's tracker behind an address
  of the visited site, the site's own subdomains (not every host a page loads) are looked up at
  [Quad9](https://quad9.net), a non-profit DNS-over-HTTPS resolver that doesn't store IP addresses.
- **The script viewer** downloads a script again from its server to show it, without your cookies,
  and asks first by default.

| Permission | What it is for |
| --- | --- |
| Access to all sites, `scripting` | Recording the APIs scripts read and the requests they make, on every page |
| `webRequest`, `webNavigation` | Matching requests and frames to the page and the script they belong to |
| `declarativeNetRequest` | Blocking the scripts you block |
| `browsingData` | Clearing a site's data after blocking, if you turned that on |
| `storage` | Keeping your settings, blocked scripts and the sites Glove is off for |

## Install

Glove isn't in the Chrome Web Store yet. Download the zip of the
[latest release](https://github.com/sxvan/Glove/releases/latest), unpack it, open
`chrome://extensions`, turn on developer mode and choose "Load unpacked" with the unpacked folder.

## Development

Tool versions are pinned with [mise](https://mise.jdx.dev). With mise installed:

```sh
mise install                # the pinned Node and pnpm
mise exec -- pnpm install   # dependencies
mise exec -- pnpm dev       # Chrome with the extension, reloading on changes
```

| Script | |
| --- | --- |
| `pnpm dev` | Development mode with auto-reload |
| `pnpm build` | Production build in `.output/chrome-mv3` |
| `pnpm zip` | Packaged build, for a release or the Chrome Web Store |
| `pnpm compile` | Type-check with `svelte-check` |

See [AGENTS.md](AGENTS.md) for the conventions (commits, branches, checks before committing).

```
src/
  entrypoints/
    background.ts             the recording of each tab, blocking, and the analysis it schedules
    fp-recorder.content.ts    in the page: wraps the fingerprinting and storage APIs
    http-recorder.content.ts  in the page: wraps fetch, XMLHttpRequest, beacons and image pixels
    bridge.content.ts         forwards what the recorders saw to the background
    popup/  dashboard/  options/  viewer/   the extension's pages
  lib/                        analysis, scoring, blocking and settings
  ui/                         the model and components the pages share
  types/                      shared types
```

Built with [WXT](https://wxt.dev), TypeScript and [Svelte](https://svelte.dev).

## License

Glove is free software under the [GNU General Public License v3.0](LICENSE). The third-party
components it bundles keep their own licenses, listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
