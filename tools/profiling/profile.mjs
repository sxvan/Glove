// Measures what the extension costs, from outside it, so nothing in src/ needs to know:
//
// 1. In the page: script and task time, long tasks and heap, each site loaded with and without the
//    extension (fresh browser each time), plus how many calls and bytes the recorders hand to the
//    bridge (their events, counted by listening for them in the page).
// 2. In the background: a CPU profile of the service worker while the sites load, its heaviest
//    functions, and its heap. The profiles are saved to open in DevTools (Performance panel).
// 3. Over time: one page left open for a few minutes, the background's heap sampled meanwhile.
//
// usage: node profile.mjs [--ext <build dir>] [--runs N] [--wait seconds] [--minutes M] [site ...]
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

/** One page open for `minutes`, sampling the background's and the page's heap every 30 seconds. */
async function memoryOverTime(site) {
    const { browser, worker } = await launch(true);
    const workerSession = await worker.createCDPSession();
    const page = await browser.newPage();
    await page.goto(site, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    const pageSession = await page.createCDPSession();
    await pageSession.send('Performance.enable');
    const samples = [];
    for (let t = 0; t <= minutes * 60; t += 30) {
        if (t > 0) await new Promise((r) => setTimeout(r, 30000));
        const { usedSize } = await workerSession.send('Runtime.getHeapUsage');
        const { metrics } = await pageSession.send('Performance.getMetrics');
        const pageHeap = metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0;
        samples.push({ second: t, backgroundHeapMb: +(usedSize / 1e6).toFixed(2), pageHeapMb: +(pageHeap / 1e6).toFixed(2) });
        console.log(`   ${String(t).padStart(4)} s  background ${samples.at(-1).backgroundHeapMb} MB  page ${samples.at(-1).pageHeapMb} MB`);
    }
    await browser.close();
    return { site, samples };
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
    console.log(`== memory over ${minutes} minutes on ${sites[0]}`);
    memory = await memoryOverTime(sites[0]);
}

fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ extPath, runs, waitMs, results, memory }, null, 1));
console.log(`\nResults and CPU profiles in ${outDir}`);
