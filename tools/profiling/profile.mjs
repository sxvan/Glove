// Measures what the extension costs, from outside it, so nothing in src/ needs to know:
//
// 1. In the page: script and task time, long tasks and heap, each site loaded with and without the
//    extension (fresh browser each time), plus how many calls and bytes the recorders hand to the
//    bridge (their events, counted by listening for them in the page).
// 2. In the background: a CPU profile of the service worker while the sites load, its heaviest
//    functions, and its heap. The profiles are saved to open in DevTools (Performance panel).
// 3. Over time: one site used for a few minutes (scrolling, following links), the background's
//    heap sampled meanwhile and its CPU profiled.
// 4. Many tabs (--tabs N): N tabs of the sites open at once for --minutes, half of them closed
//    halfway, the background's heap sampled and its CPU profiled; replaces 1 to 3.
//
// usage: node profile.mjs [--ext <build dir>] [--runs N] [--wait seconds] [--minutes M] [--tabs N] [site ...]
// Build first (pnpm run build here: unminified, into .output/profile); results go to results/<time>/.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SITES = [
    'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    'https://www.walgreens.com/',
    'https://www.cnn.com/',
    'https://fingerprint.com/',
    'https://en.wikipedia.org/wiki/Browser_fingerprinting',
];

const args = process.argv.slice(2);
const option = (name, fallback) => {
    const at = args.indexOf(`--${name}`);
    if (at < 0) return fallback;
    const [value] = args.splice(at, 2).slice(1);
    return value;
};
const extPath = path.resolve(here, option('ext', '../../.output/profile/chrome-mv3'));
const runs = Number(option('runs', 2));
const waitMs = Number(option('wait', 12)) * 1000;
const minutes = Number(option('minutes', 3));
const tabs = Number(option('tabs', 0));
const sites = args.length > 0 ? args : DEFAULT_SITES;
const outDir = path.join(here, 'results', new Date().toISOString().replace(/[:.]/g, '-'));

if (!fs.existsSync(path.join(extPath, 'manifest.json'))) {
    console.error(`No build at ${extPath}; run pnpm --filter profiling run build first.`);
    process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

// Runs in every page before its scripts: counts long tasks and the recorders' events.
function pageProbe() {
    const probe = (window.__profile = { longTasks: 0, longTaskMs: 0, events: {} });
    try {
        new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                probe.longTasks += 1;
                probe.longTaskMs += entry.duration;
            }
        }).observe({ type: 'longtask', buffered: true });
    } catch {}
    // The recorders dispatch their events on the document element; a capturing listener on the
    // window sees them although they don't bubble.
    for (const type of ['fp-monkey', 'http-monkey']) {
        window.addEventListener(
            type,
            (event) => {
                const counts = (probe.events[type] ??= { batches: 0, calls: 0, bytes: 0 });
                const detail = event.detail;
                counts.batches += 1;
                counts.calls += Array.isArray(detail) ? detail.length : 1;
                try {
                    counts.bytes += JSON.stringify(detail).length;
                } catch {}
            },
            true
        );
    }
}

async function launch(withExtension) {
    const browser = await puppeteer.launch({ headless: true, pipe: true, ...(withExtension ? { enableExtensions: [extPath] } : {}) });
    const worker = withExtension ? await browser.waitForTarget((t) => t.type() === 'service_worker') : null;
    return { browser, worker };
}

/** Loads `site` in a fresh browser and measures the page, and with the extension its background. */
async function measure(site, withExtension) {
    const { browser, worker } = await launch(withExtension);
    let workerSession = null;
    if (worker) {
        workerSession = await worker.createCDPSession();
        await workerSession.send('Profiler.enable');
        await workerSession.send('Profiler.setSamplingInterval', { interval: 200 });
        await workerSession.send('Profiler.start');
    }
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(pageProbe);
    // Script and task time count from here on, so they are switched on before the page loads.
    const pageSession = await page.createCDPSession();
    await pageSession.send('Performance.enable');
    const started = Date.now();
    await page.goto(site, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, waitMs));

    const { metrics } = await pageSession.send('Performance.getMetrics');
    const metric = (name) => metrics.find((m) => m.name === name)?.value ?? 0;
    const probe = await page.evaluate(() => window.__profile).catch(() => null);

    const result = {
        site,
        withExtension,
        seconds: (Date.now() - started) / 1000,
        scriptMs: metric('ScriptDuration') * 1000,
        taskMs: metric('TaskDuration') * 1000,
        pageHeapMb: metric('JSHeapUsedSize') / 1e6,
        longTasks: probe?.longTasks ?? 0,
        longTaskMs: probe?.longTaskMs ?? 0,
        recorderEvents: probe?.events ?? {},
    };

    if (workerSession) {
        const { profile } = await workerSession.send('Profiler.stop');
        const { usedSize } = await workerSession.send('Runtime.getHeapUsage');
        result.backgroundHeapMb = usedSize / 1e6;
        Object.assign(result, summarizeProfile(profile));
        const name = `${new URL(site).hostname}-${Date.now()}.cpuprofile`;
        fs.writeFileSync(path.join(outDir, name), JSON.stringify(profile));
        result.profileFile = name;
    }
    await browser.close();
    return result;
}

/** The background's busy time and its heaviest functions (self time) in the extension's own code. */
function summarizeProfile(profile) {
    const byId = new Map(profile.nodes.map((node) => [node.id, node]));
    const self = new Map();
    let busy = 0;
    for (let i = 0; i < profile.samples.length; i++) {
        const node = byId.get(profile.samples[i]);
        const ms = (profile.timeDeltas[i] ?? 0) / 1000;
        const { functionName, url, lineNumber } = node.callFrame;
        if (functionName === '(idle)' || functionName === '(program)') continue;
        busy += ms;
        if (!url.startsWith('chrome-extension://')) continue;
        const key = `${functionName || '(anonymous)'} ${url.split('/').pop()}:${lineNumber + 1}`;
        self.set(key, (self.get(key) ?? 0) + ms);
    }
    const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([fn, ms]) => ({ fn, ms: +ms.toFixed(1) }));
    return { backgroundBusyMs: +busy.toFixed(1), backgroundTop: top };
}

/**
 * One site used for `minutes` like a visitor would: scrolling every 15 seconds and following a
 * random link to the same site every 30, sampling the background's and the page's heap every 30
 * seconds, with a CPU profile of the background over the whole run.
 */
async function memoryOverTime(site) {
    const { browser, worker } = await launch(true);
    const workerSession = await worker.createCDPSession();
    await workerSession.send('Profiler.enable');
    // Coarser sampling than for single loads: the run is long.
    await workerSession.send('Profiler.setSamplingInterval', { interval: 1000 });
    await workerSession.send('Profiler.start');
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(site, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    const origin = new URL(page.url()).origin;
    const samples = [];
    let clicks = 0;
    const started = Date.now();
    for (let tick = 0; tick <= minutes * 4; tick++) {
        if (tick > 0) await new Promise((r) => setTimeout(r, 15000));
        await page.mouse.wheel({ deltaY: 900 }).catch(() => {});
        if (tick > 0 && tick % 2 === 0) {
            // A random visible link to the same site, opened in this tab.
            const followed = await page
                .evaluate((origin) => {
                    const links = [...document.querySelectorAll('a[href]')].filter((a) => {
                        const box = a.getBoundingClientRect();
                        return a.href.startsWith(origin) && box.width > 0 && box.height > 0 && box.top >= 0 && box.top < innerHeight;
                    });
                    const link = links[Math.floor(Math.random() * links.length)];
                    if (!link) return null;
                    link.removeAttribute('target');
                    link.click();
                    return link.href;
                }, origin)
                .catch(() => null);
            if (followed) clicks += 1;
        }
        if (tick % 2 === 0) {
            const { usedSize } = await workerSession.send('Runtime.getHeapUsage');
            const pageHeap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0).catch(() => 0);
            const second = Math.round((Date.now() - started) / 1000);
            samples.push({ second, clicks, backgroundHeapMb: +(usedSize / 1e6).toFixed(2), pageHeapMb: +(pageHeap / 1e6).toFixed(2) });
            console.log(`   ${String(second).padStart(4)} s  ${String(clicks).padStart(2)} clicks  background ${samples.at(-1).backgroundHeapMb} MB  page ${samples.at(-1).pageHeapMb} MB`);
        }
    }
    const { profile } = await workerSession.send('Profiler.stop');
    const name = `long-${new URL(site).hostname}.cpuprofile`;
    fs.writeFileSync(path.join(outDir, name), JSON.stringify(profile));
    const summary = summarizeProfile(profile);
    console.log(`   background busy ${summary.backgroundBusyMs} ms over ${Math.round((Date.now() - started) / 1000)} s`);
    for (const { fn, ms } of summary.backgroundTop.slice(0, 6)) console.log(`      ${String(ms).padStart(7)} ms  ${fn}`);
    await browser.close();
    return { site, samples, clicks, profileFile: name, ...summary };
}

/**
 * `tabs` tabs of the sites (taking turns) open at once for `minutes`, each scrolled now and then;
 * half of them closed halfway, to see their recording let go. Samples the background's heap every
 * 30 seconds and profiles its CPU over the whole run.
 */
async function manyTabs() {
    const { browser, worker } = await launch(true);
    const workerSession = await worker.createCDPSession();
    await workerSession.send('Profiler.enable');
    await workerSession.send('Profiler.setSamplingInterval', { interval: 1000 });
    await workerSession.send('Profiler.start');
    const started = Date.now();
    const pages = [];
    for (let i = 0; i < tabs; i++) {
        const page = await browser.newPage();
        page.goto(sites[i % sites.length], { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        pages.push(page);
        // A little apart, as people open tabs; and Chrome loads them more evenly.
        await new Promise((r) => setTimeout(r, 1000));
    }
    const samples = [];
    let closed = 0;
    for (let tick = 0; tick <= minutes * 2; tick++) {
        if (tick > 0) await new Promise((r) => setTimeout(r, 30000));
        for (const page of pages) if (!page.isClosed()) page.mouse.wheel({ deltaY: 600 }).catch(() => {});
        if (tick === minutes && closed === 0) {
            for (const page of pages.slice(0, Math.floor(tabs / 2))) await page.close().catch(() => {});
            closed = Math.floor(tabs / 2);
        }
        const { usedSize } = await workerSession.send('Runtime.getHeapUsage');
        const second = Math.round((Date.now() - started) / 1000);
        samples.push({ second, open: tabs - closed, backgroundHeapMb: +(usedSize / 1e6).toFixed(2) });
        console.log(`   ${String(second).padStart(4)} s  ${String(tabs - closed).padStart(2)} tabs  background ${samples.at(-1).backgroundHeapMb} MB`);
    }
    const { profile } = await workerSession.send('Profiler.stop');
    const name = `tabs-${tabs}.cpuprofile`;
    fs.writeFileSync(path.join(outDir, name), JSON.stringify(profile));
    const summary = summarizeProfile(profile);
    console.log(`   background busy ${summary.backgroundBusyMs} ms over ${Math.round((Date.now() - started) / 1000)} s`);
    for (const { fn, ms } of summary.backgroundTop.slice(0, 6)) console.log(`      ${String(ms).padStart(7)} ms  ${fn}`);
    await browser.close();
    return { tabs, samples, profileFile: name, ...summary };
}

if (tabs > 0) {
    console.log(`== ${tabs} tabs for ${minutes} minutes, half closed halfway`);
    const result = await manyTabs();
    fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ extPath, tabs: result }, null, 1));
    console.log(`\nResults and CPU profile in ${outDir}`);
    process.exit(0);
}

const average = (list, key) => list.reduce((sum, r) => sum + (r[key] ?? 0), 0) / Math.max(1, list.length);
const results = [];
for (const site of sites) {
    console.log(`== ${site}`);
    for (const withExtension of [false, true]) {
        for (let run = 0; run < runs; run++) results.push(await measure(site, withExtension));
    }
    const without = results.filter((r) => r.site === site && !r.withExtension);
    const withExt = results.filter((r) => r.site === site && r.withExtension);
    const fmt = (n) => n.toFixed(0).padStart(6);
    console.log(`   script ms   without ${fmt(average(without, 'scriptMs'))}   with ${fmt(average(withExt, 'scriptMs'))}`);
    console.log(`   task ms     without ${fmt(average(without, 'taskMs'))}   with ${fmt(average(withExt, 'taskMs'))}`);
    console.log(`   long tasks  without ${fmt(average(without, 'longTasks'))}   with ${fmt(average(withExt, 'longTasks'))}`);
    console.log(`   background busy ${fmt(average(withExt, 'backgroundBusyMs'))} ms, heap ${average(withExt, 'backgroundHeapMb').toFixed(1)} MB`);
    const events = withExt[0]?.recorderEvents ?? {};
    for (const [type, e] of Object.entries(events)) console.log(`   ${type}: ${e.calls} calls in ${e.batches} batches, ${(e.bytes / 1024).toFixed(0)} KB`);
    for (const { fn, ms } of withExt[0]?.backgroundTop?.slice(0, 5) ?? []) console.log(`      ${String(ms).padStart(7)} ms  ${fn}`);
}

let memory = null;
if (minutes > 0) {
    console.log(`== ${minutes} minutes of use on ${sites[0]}`);
    memory = await memoryOverTime(sites[0]);
}

fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ extPath, runs, waitMs, results, memory }, null, 1));
console.log(`\nResults and CPU profiles in ${outDir}`);
