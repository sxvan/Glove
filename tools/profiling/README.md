# Profiling

Measures what the extension costs, from outside it, with puppeteer and the DevTools protocol. Nothing
in `src/` is involved. It loads a build without minification (`PROFILE=1` in `wxt.config.ts`), in
`.output/profile/chrome-mv3`, so CPU profiles show the real function names.

```sh
mise exec -- pnpm --filter profiling run build           # unminified build into .output/profile
mise exec -- pnpm --filter profiling run install-chrome  # once: downloads Chrome for Testing
mise exec -- pnpm --filter profiling run profile         # default sites, 2 runs each, 3 minutes of memory
mise exec -- pnpm --filter profiling run profile --runs 3 --minutes 0 https://www.cnn.com/
```

Options: `--ext <build dir>`, `--runs N` (loads per site with and without the extension),
`--wait S` (seconds on each page, default 12), `--minutes M` (the memory run, 0 to skip), then the
sites.

What it measures:

- **In the page**, with and without the extension: script and task time, long tasks and heap, and
  how many calls and bytes the recorders hand to the bridge.
- **In the background**: a CPU profile of the service worker while each site loads, its busy time,
  its heaviest functions and its heap. The `.cpuprofile` files open in DevTools (Performance panel,
  "Load profile").
- **Over time**: the first site used for `--minutes` like a visitor would (scrolling every 15 seconds,
  following a random link to the same site every 30), the heaps every 30 seconds and a CPU profile of
  the background over the whole run.

Results go to `results/<time>/` (ignored by git). Single loads vary a lot between visits; compare
averages over several runs, and the same sites before and after a change.
