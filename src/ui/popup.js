// popup.js

let showAllScripts = false;
let lastScripts = [];

// Persist open state across rerenders (script + spike + metrics accordions)
let openKeys = new Set();

// ---------- helpers ----------
function fmtSeconds(ms) {
    if (!Number.isFinite(ms)) return '—';
    return Math.max(0, ms / 1000).toFixed(0);
}

function safeLen(arr) {
    return Array.isArray(arr) ? arr.length : 0;
}

function clamp01(x) {
    if (!Number.isFinite(x)) return null;
    return Math.max(0, Math.min(1, x));
}

function fmtDelta(ms) {
    if (!Number.isFinite(ms)) return '—';
    const s = ms / 1000;
    return s >= 1 ? `${s.toFixed(2)}s` : `${ms.toFixed(0)}ms`;
}

function safeUrlParts(url) {
    try {
        const u = new URL(url);
        return { host: u.host, path: (u.pathname || '/') + (u.search || '') };
    } catch {
        // fallback: keep it readable
        return { host: '', path: url ?? '' };
    }
}

function getHostFromUrl(url) {
    try {
        return new URL(url).host;
    } catch {
        return '';
    }
}

function getPathFromUrl(url) {
    try {
        const u = new URL(url);
        return (u.pathname || '/') + (u.search || '');
    } catch {
        return url ?? '';
    }
}

function pickImportantRequestFields(req) {
    // We don't know your exact HttpRequest shape, so we show the most likely useful fields if present.
    // Add/remove keys as your actual structure evolves.
    const fields = [
        ['Method', req?.method],
        ['URL', req?.url],
        ['Host', req?.host ?? getHostFromUrl(req?.url)],
        ['Time', Number.isFinite(req?.timeStamp) ? new Date(req.timeStamp).toLocaleTimeString() : undefined],
        ['Frame ID', req?.frameId],
        ['Document ID', req?.documentId],
        ['Initiator', req?.initiator],
        ['Type', req?.type],
        ['Resource', req?.resourceType],
        ['Referrer', req?.referrer],
        ['Status', req?.statusCode],
        ['Script URL', req?.scriptUrl],
        ['CNAME destination', Array.isArray(req?.cRecords) && req.cRecords.length ? req.cRecords[req.cRecords.length - 1].target : undefined],
    ];

    // only include those that have a value
    return fields.filter(([, v]) => v !== undefined && v !== null && v !== '');
}

// Pick main frame deterministically (lowest numeric key)
function pickMainDocument(snapshot) {
    if (!snapshot?.frames) return null;
    const entries = Object.entries(snapshot.frames);
    if (!entries.length) return null;

    entries.sort(([a], [b]) => Number(a) - Number(b));
    return entries[0]?.[1]?.document ?? null;
}

function scoreClass(score) {
    if (!Number.isFinite(score)) return '';
    if (score >= 0.7) return 'bad';
    if (score >= 0.4) return 'warn';
    return 'good';
}

function dnsScoreClass(score) {
    // use same thresholds you requested
    if (!Number.isFinite(score)) return '';
    if (score > 0.6) return 'bad';
    if (score > 0.2) return 'warn';
    return 'good';
}

function setDot(el, state) {
    const map = {
        good: 'var(--good)',
        warn: 'var(--warn)',
        bad: 'var(--bad)',
        muted: 'var(--muted)',
    };
    if (el) el.style.background = map[state] ?? map.muted;
}

function humanFpSentence(m) {
    const intensity = m?.intensity ?? 0;
    const durationSec = fmtSeconds(m?.durationMs);
    const apis = safeLen(m?.distinctFpApis);
    const cats = safeLen(m?.distinctFpCategories);
    return `${intensity} events over ${durationSec} seconds using ${apis} fingerprint APIs across ${cats} different categories.`;
}

function renderMetricsListInto(containerEl, metrics) {
    containerEl.innerHTML = '';

    const rows = [
        ['intensity', metrics?.intensity ?? '—'],
        ['density', Number.isFinite(metrics?.density) ? metrics.density.toFixed(2) : '—'],
        ['duration', `${fmtSeconds(metrics?.durationMs)} sec`],
    ];

    for (const [k, v] of rows) {
        const row = document.createElement('div');
        row.className = 'row';

        const kEl = document.createElement('div');
        kEl.className = 'k';
        kEl.textContent = k;

        const vEl = document.createElement('div');
        vEl.className = 'v';
        vEl.textContent = String(v);

        row.appendChild(kEl);
        row.appendChild(vEl);
        containerEl.appendChild(row);
    }
}

function getSpikeMetrics(spike) {
    if (spike?.fpMetrics) return spike.fpMetrics;

    const ev = Array.isArray(spike?.events) ? spike.events : [];
    const intensity = ev.length;

    // best-effort duration if timestamp exists
    const ts = ev
        .map((e) => e?.timestamp)
        .filter((t) => Number.isFinite(t))
        .sort((a, b) => a - b);

    const durationMs = ts.length >= 2 ? ts[ts.length - 1] - ts[0] : 0;

    return {
        intensity,
        durationMs,
        density: durationMs > 0 ? intensity / (durationMs / 1000) : 0,
        distinctFpApis: [],
        distinctFpCategories: [],
    };
}

// ---------- open state persistence ----------
function captureOpenKeysFromDom() {
    const keys = new Set();
    document.querySelectorAll('details[open][data-key]').forEach((d) => {
        keys.add(d.getAttribute('data-key'));
    });
    return keys;
}

function applyOpenState(detailsEl, key) {
    // Always mark key on element
    detailsEl.setAttribute('data-key', key);

    // Re-open if key was open before
    if (openKeys.has(key)) detailsEl.open = true;
}

// ---------- rendering: fingerprint top metrics ----------
function renderFingerprintMetrics(metrics, snapshot) {
    const pill = document.getElementById('pillStatus');
    const pageUrl = document.getElementById('pageUrl');

    const doc = pickMainDocument(snapshot);

    pill.textContent = snapshot ? 'Live' : 'No data';
    pageUrl.textContent = doc?.url ?? '—';
    pageUrl.title = doc?.url ?? '';

    const intensity = metrics?.intensity ?? 0;
    const durationSec = fmtSeconds(metrics?.durationMs);
    const apis = safeLen(metrics?.distinctFpApis);
    const cats = safeLen(metrics?.distinctFpCategories);

    document.getElementById('fpIntensity').textContent = String(intensity);
    document.getElementById('fpDuration').textContent = durationSec === '—' ? '0' : durationSec;
    document.getElementById('fpApis').textContent = apis.toString();
    document.getElementById('fpCats').textContent = cats.toString();

    const badgeFp = document.getElementById('badgeFp');
    const dotFp = document.getElementById('dotFp');

    let fpState = 'muted';
    if (intensity > 0) fpState = 'warn';
    if (Number.isFinite(metrics?.score) && metrics.score >= 0.7) fpState = 'bad';
    if (Number.isFinite(metrics?.score) && metrics.score < 0.4 && intensity > 0) fpState = 'good';

    setDot(dotFp, fpState);
    badgeFp.textContent = Number.isFinite(metrics?.score) ? `score ${metrics.score.toFixed(2)}` : intensity > 0 ? 'detected' : 'none';

    const sentenceEl = document.getElementById('fpSentence');
    if (!metrics) {
        sentenceEl.innerHTML = `<span class="muted">No document metrics available.</span>`;
    } else {
        sentenceEl.textContent = humanFpSentence(metrics);
    }

    renderMetricsListInto(document.getElementById('fpMetricsList'), metrics);
}

// ---------- rendering: spikes ----------
function buildSpikeAccordion(spike, idx, scriptKey) {
    const m = getSpikeMetrics(spike);
    const score = spike?.fpMetrics?.score;

    const spikeDetails = document.createElement('details');
    spikeDetails.className = 'spikeDetails';

    const spikeKey = `spike::${scriptKey}::${idx}`;
    applyOpenState(spikeDetails, spikeKey);

    const sum = document.createElement('summary');

    /* LEFT */
    const left = document.createElement('div');
    left.className = 'spikeLeft';

    const title = document.createElement('div');
    title.className = 'spikeTitle';
    title.textContent = `Spike #${idx + 1}`;

    const meta = document.createElement('div');
    meta.className = 'spikeMeta';
    meta.textContent = `${m?.intensity ?? 0} events · ${fmtSeconds(m?.durationMs)}s · ` + `${safeLen(m?.distinctFpApis)} APIs · ${safeLen(m?.distinctFpCategories)} cats`;

    left.appendChild(title);
    left.appendChild(meta);

    /* RIGHT */
    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '8px';

    if (Number.isFinite(score)) {
        const scoreEl = document.createElement('div');
        scoreEl.className = `score ${scoreClass(score)}`;
        scoreEl.textContent = score.toFixed(2);
        right.appendChild(scoreEl);
    }

    const chev = document.createElement('div');
    chev.className = 'chev';
    chev.setAttribute('aria-hidden', 'true');

    right.appendChild(chev);

    sum.appendChild(left);
    sum.appendChild(right);

    const body = document.createElement('div');
    body.className = 'spikeBody';

    body.appendChild(renderCorrelatedHttpList(spike?.httpCorrelations ?? []));
    body.appendChild(renderSpikeFpEventsTimeline(spike?.events ?? []));

    spikeDetails.appendChild(sum);
    spikeDetails.appendChild(body);

    return spikeDetails;
}

function renderSpikesSection(spikes = [], scriptKey) {
    const wrap = document.createElement('div');

    const title = document.createElement('div');
    title.className = 'sectionTitle';
    title.textContent = 'Spikes';
    wrap.appendChild(title);

    if (!spikes.length) {
        const empty = document.createElement('div');
        empty.className = 'state';
        empty.textContent = 'No spikes detected.';
        wrap.appendChild(empty);
        return wrap;
    }

    const sorted = [...spikes].sort((a, b) => {
        const as = a?.fpMetrics?.score ?? -1;
        const bs = b?.fpMetrics?.score ?? -1;
        if (bs !== as) return bs - as;

        // fallback if no score
        const ai = a?.fpMetrics?.intensity ?? a?.events?.length ?? 0;
        const bi = b?.fpMetrics?.intensity ?? b?.events?.length ?? 0;
        return bi - ai;
    });

    sorted.forEach((spike, idx) => {
        wrap.appendChild(buildSpikeAccordion(spike, idx, scriptKey));
    });

    return wrap;
}

// ---------- rendering: scripts ----------
function buildScriptAccordion(script, indexForKey) {
    const name = script?.name ?? '(unknown script)';
    const m = script?.fpMetrics ?? {};
    const spikes = Array.isArray(script?.fpSpikes) ? script.fpSpikes : [];

    const details = document.createElement('details');
    details.className = 'scriptDetails';

    // IMPORTANT: unique key so open state survives rerenders
    // Using index + name is usually stable enough for a snapshot.
    // If you later add a stable script id, swap it in here.
    const scriptKey = `script::${indexForKey}::${name}`;
    applyOpenState(details, scriptKey);

    // summary
    const summary = document.createElement('summary');

    const left = document.createElement('div');
    left.className = 'scriptSummaryLeft';

    const nameEl = document.createElement('div');
    nameEl.className = 'scriptName';
    nameEl.textContent = name;
    nameEl.title = name;

    const subEl = document.createElement('div');
    subEl.className = 'scriptSub';
    subEl.textContent = `${m?.intensity ?? 0} events · ${fmtSeconds(m?.durationMs)}s · ${safeLen(m?.distinctFpApis)} APIs · ${safeLen(m?.distinctFpCategories)} cats`;

    left.appendChild(nameEl);
    left.appendChild(subEl);

    const right = document.createElement('div');
    right.className = 'scriptRight';

    const score = m?.score;
    const scoreEl = document.createElement('div');
    scoreEl.className = `score ${scoreClass(score)}`;
    scoreEl.textContent = Number.isFinite(score) ? score.toFixed(2) : '—';

    const chev = document.createElement('div');
    chev.className = 'chev';
    chev.setAttribute('aria-hidden', 'true');

    right.appendChild(scoreEl);
    right.appendChild(chev);

    summary.appendChild(left);
    summary.appendChild(right);

    // body
    const body = document.createElement('div');
    body.className = 'scriptBody';

    const sentence = document.createElement('p');
    sentence.className = 'sentence';
    sentence.textContent = humanFpSentence(m);
    body.appendChild(sentence);

    // metrics accordion inside script
    const metricsDetails = document.createElement('details');
    metricsDetails.className = 'miniDetails';

    // Keyed open-state for script metrics accordion
    const metricsKey = `metrics::${scriptKey}`;
    applyOpenState(metricsDetails, metricsKey);

    const metricsSummary = document.createElement('summary');
    const metricsTitle = document.createElement('div');
    metricsTitle.className = 'miniTitle';
    metricsTitle.textContent = 'Metrics';
    const metricsChev = document.createElement('div');
    metricsChev.className = 'chev';
    metricsChev.setAttribute('aria-hidden', 'true');

    metricsSummary.appendChild(metricsTitle);
    metricsSummary.appendChild(metricsChev);

    const metricsBody = document.createElement('div');
    metricsBody.className = 'miniBody';

    const metricsList = document.createElement('div');
    metricsList.className = 'list';
    renderMetricsListInto(metricsList, m);
    metricsBody.appendChild(metricsList);

    metricsDetails.appendChild(metricsSummary);
    metricsDetails.appendChild(metricsBody);
    body.appendChild(metricsDetails);

    // spikes section
    body.appendChild(renderSpikesSection(spikes, scriptKey));

    details.appendChild(summary);
    details.appendChild(body);

    return details;
}

function renderScriptsList(scripts = []) {
    const host = document.getElementById('scriptsList');
    const btn = document.getElementById('scriptsToggleBtn');

    lastScripts = scripts;

    host.innerHTML = '';

    if (!scripts.length) {
        const empty = document.createElement('div');
        empty.className = 'state';
        empty.textContent = 'No scripts detected.';
        host.appendChild(empty);
        btn.style.display = 'none';
        return;
    }

    // Sort by score desc, fallback intensity
    const sorted = [...scripts].sort((a, b) => {
        const as = a?.fpMetrics?.score ?? -1;
        const bs = b?.fpMetrics?.score ?? -1;
        if (bs !== as) return bs - as;
        return (b?.fpMetrics?.intensity ?? 0) - (a?.fpMetrics?.intensity ?? 0);
    });

    const total = sorted.length;
    const limit = 3;
    const visible = showAllScripts ? sorted : sorted.slice(0, limit);

    visible.forEach((s, idx) => host.appendChild(buildScriptAccordion(s, idx)));

    if (total > limit) {
        btn.style.display = 'block';
        btn.textContent = showAllScripts ? 'Show less' : `Show all scripts (${total})`;
    } else {
        btn.style.display = 'none';
    }
}

function renderCorrelatedHttpList(correlations = []) {
    const wrap = document.createElement('div');

    const title = document.createElement('div');
    title.className = 'sectionTitle';
    title.textContent = 'Correlated HTTP events';
    wrap.appendChild(title);

    if (!Array.isArray(correlations) || correlations.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'state';
        empty.textContent = 'No correlated HTTP events.';
        wrap.appendChild(empty);
        return wrap;
    }

    const sorted = [...correlations].sort((a, b) => {
        const as = a?.suspicionScore ?? -1;
        const bs = b?.suspicionScore ?? -1;
        if (bs !== as) return bs - as;

        // fallback: smaller time delta is "tighter" correlation
        const ad = a?.timeDeltaMs ?? Number.POSITIVE_INFINITY;
        const bd = b?.timeDeltaMs ?? Number.POSITIVE_INFINITY;
        return ad - bd;
    });

    const list = document.createElement('div');
    list.className = 'httpList';

    for (const c of sorted) {
        const score = clamp01(c?.suspicionScore);

        const reqUrl = c?.httpRequest?.url ?? c?.httpEvent?.url ?? '';
        const method = c?.httpRequest?.method ?? c?.httpEvent?.method ?? '';
        const { host, path } = safeUrlParts(reqUrl);

        const item = document.createElement('div');
        item.className = 'httpItem';

        const left = document.createElement('div');
        left.className = 'httpLeft';

        const t = document.createElement('div');
        t.className = 'httpTitle';

        // METHOD
        const methodSpan = document.createElement('span');
        methodSpan.className = 'mono';
        methodSpan.textContent = (method || 'REQ').toUpperCase();
        t.appendChild(methodSpan);

        // HOST
        if (host) {
            t.appendChild(document.createTextNode(' '));
            const hostSpan = document.createElement('span');
            hostSpan.className = 'mono';
            hostSpan.textContent = host;
            t.appendChild(hostSpan);
        }

        // PATH (this is the problematic long token)
        if (path) {
            t.appendChild(document.createTextNode(' '));
            const pathSpan = document.createElement('span');
            pathSpan.className = 'mono httpPath';
            pathSpan.textContent = path;
            t.appendChild(pathSpan);
        }

        const meta = document.createElement('div');
        meta.className = 'httpMeta';
        meta.textContent = `Δt ${fmtDelta(c?.timeDeltaMs)} · api: ${c?.httpEvent?.id ?? '—'} · credentials: ${c?.httpEvent?.credentials ?? '—'}`;

        left.appendChild(t);
        left.appendChild(meta);

        const badge = document.createElement('div');
        badge.className = `score ${scoreClass(score)}`;
        badge.textContent = Number.isFinite(score) ? score.toFixed(2) : '—';

        item.appendChild(left);
        item.appendChild(badge);
        list.appendChild(item);
    }

    wrap.appendChild(list);
    return wrap;
}

function fmtTimeMs(ts) {
    if (!Number.isFinite(ts)) return '—';
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
}

/**
 *
 * @param {FpMonkeyEvent[]} events
 * @returns
 */
function renderSpikeFpEventsTimeline(events = []) {
    const wrap = document.createElement('div');

    const title = document.createElement('div');
    title.className = 'sectionTitle';
    title.textContent = 'Fingerprint events';
    wrap.appendChild(title);

    if (!Array.isArray(events) || events.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'state';
        empty.textContent = 'No fingerprint events recorded for this spike.';
        wrap.appendChild(empty);
        return wrap;
    }

    // Sort by timestamp asc (keep stable order if timestamps missing)
    const sorted = [...events].sort((a, b) => {
        const at = Number.isFinite(a?.timeStamp) ? a.timeStamp : Number.POSITIVE_INFINITY;
        const bt = Number.isFinite(b?.timeStamp) ? b.timeStamp : Number.POSITIVE_INFINITY;
        if (at !== bt) return at - bt;
        return a.id.localeCompare(b.id);
    });

    const list = document.createElement('div');
    list.className = 'fpTimeline';

    for (const ev of sorted) {
        const item = document.createElement('div');
        item.className = 'fpTimelineItem';

        const timeEl = document.createElement('div');
        timeEl.className = 'fpTime mono';
        timeEl.textContent = fmtTimeMs(ev?.timeStamp);

        const arrow = document.createElement('div');
        arrow.className = 'fpArrow';
        arrow.textContent = '';

        const eventEl = document.createElement('div');
        eventEl.className = 'fpEvent mono';
        eventEl.textContent = ev.id;

        item.appendChild(timeEl);
        item.appendChild(arrow);
        item.appendChild(eventEl);

        list.appendChild(item);
    }

    wrap.appendChild(list);
    return wrap;
}

function buildCnameRequestAccordion(req, domainKey, idx) {
    const reqDetails = document.createElement('details');
    reqDetails.className = 'cnameReqDetails';

    const key = `cnameReq::${domainKey}::${idx}::${req?.url ?? ''}`;
    applyOpenState(reqDetails, key);

    const sum = document.createElement('summary');

    const left = document.createElement('div');
    left.className = 'cnameLeft';

    const title = document.createElement('div');
    title.className = 'cnameTitle';
    title.textContent = `${(req?.method || 'REQ').toUpperCase()} ${getPathFromUrl(req?.url)}`;

    const meta = document.createElement('div');
    meta.className = 'cnameMeta';
    meta.textContent = `${Number.isFinite(req?.timeStamp) ? new Date(req.timeStamp).toLocaleTimeString() : '—'}`;

    left.appendChild(title);
    left.appendChild(meta);

    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '8px';

    const chev = document.createElement('div');
    chev.className = 'chev';
    chev.setAttribute('aria-hidden', 'true');

    right.appendChild(chev);

    sum.appendChild(left);
    sum.appendChild(right);

    const body = document.createElement('div');
    body.className = 'cnameReqBody';

    // URL full (wrapping)
    const fullUrl = document.createElement('div');
    fullUrl.className = 'cnameUrl';
    fullUrl.textContent = req?.url ?? '';
    fullUrl.title = req?.url ?? '';
    body.appendChild(fullUrl);

    // Important details list (reuses your .row style)
    const list = document.createElement('div');
    list.className = 'list';
    list.style.marginTop = '10px';

    const important = pickImportantRequestFields(req);
    for (const [k, v] of important) {
        const row = document.createElement('div');
        row.className = 'row';

        const kEl = document.createElement('div');
        kEl.className = 'k';
        kEl.textContent = k;

        const vEl = document.createElement('div');
        vEl.className = 'v';
        vEl.textContent = String(v);
        vEl.title = String(v);

        row.appendChild(kEl);
        row.appendChild(vEl);
        list.appendChild(row);
    }

    body.appendChild(list);

    reqDetails.appendChild(sum);
    reqDetails.appendChild(body);

    return reqDetails;
}

function buildCnameDomainAccordion(domain, requests) {
    const domDetails = document.createElement('details');
    domDetails.className = 'cnameDomainDetails';

    const domainKey = `cnameDom::${domain}`;
    applyOpenState(domDetails, domainKey);

    const sum = document.createElement('summary');

    const left = document.createElement('div');
    left.className = 'cnameLeft';

    const title = document.createElement('div');
    title.className = 'cnameTitle';
    title.textContent = domain || '(unknown domain)';

    const meta = document.createElement('div');
    meta.className = 'cnameMeta';
    meta.textContent = `${requests.length} requests`;

    left.appendChild(title);
    left.appendChild(meta);

    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '8px';

    const chev = document.createElement('div');
    chev.className = 'chev';
    chev.setAttribute('aria-hidden', 'true');

    right.appendChild(chev);

    sum.appendChild(left);
    sum.appendChild(right);

    // body: list of requests (each expandable)
    const body = document.createElement('div');
    body.className = 'accBody'; // reuse same body style

    // sort requests by time (newest first) if timestamps exist
    const sortedReqs = [...requests].sort((a, b) => (b?.timeStamp ?? 0) - (a?.timeStamp ?? 0));

    sortedReqs.forEach((req, idx) => {
        body.appendChild(buildCnameRequestAccordion(req, domainKey, idx));
    });

    domDetails.appendChild(sum);
    domDetails.appendChild(body);

    return domDetails;
}

function renderCname(snapshot) {
    const listHost = document.getElementById('cnameDomainsList');
    const badge = document.getElementById('badgeCname');
    const dot = document.getElementById('dotCname');

    listHost.innerHTML = '';

    const reqs = Array.isArray(snapshot?.cNameRequests) ? snapshot.cNameRequests : [];

    // Group by domain(host)
    const byDomain = new Map();
    for (const r of reqs) {
        const host = r?.host ?? getHostFromUrl(r?.url);
        const key = host || '(unknown)';
        if (!byDomain.has(key)) byDomain.set(key, []);
        byDomain.get(key).push(r);
    }

    const domainsCount = byDomain.size;
    const requestsCount = reqs.length;

    // summary numbers on the collapsed card
    document.getElementById('cnameDomains').textContent = String(domainsCount);
    document.getElementById('cnameRequests').textContent = String(requestsCount);

    // badge + dot
    if (requestsCount === 0) {
        setDot(dot, 'good');
        badge.textContent = 'none';
    } else {
        setDot(dot, 'warn');
        badge.textContent = 'detected';
    }

    if (requestsCount === 0) {
        const empty = document.createElement('div');
        empty.className = 'state';
        empty.textContent = 'No CNAME cloaking requests detected.';
        listHost.appendChild(empty);
        return;
    }

    // Sort domains: most requests first
    const sortedDomains = [...byDomain.entries()].sort((a, b) => b[1].length - a[1].length);

    for (const [domain, requests] of sortedDomains) {
        listHost.appendChild(buildCnameDomainAccordion(domain, requests));
    }
}

function buildDnsRequestAccordion(req, domainKey) {
    const reqDetails = document.createElement('details');
    reqDetails.className = 'dnsReqDetails';

    // stable key (prevents collapse issues across rerenders)
    const reqKey = `dnsReq::${domainKey}::${req?.timeStamp ?? 0}::${req?.url ?? ''}`;
    applyOpenState(reqDetails, reqKey);

    const sum = document.createElement('summary');

    const left = document.createElement('div');
    left.className = 'dnsLeft';

    const title = document.createElement('div');
    title.className = 'dnsReqTitle';
    const path = getPathFromUrl(req?.url);
    title.textContent = `${(req?.method || 'REQ').toUpperCase()} ${path}`;
    title.title = req?.url ?? '';

    const meta = document.createElement('div');
    meta.className = 'dnsMeta';
    const ts = Number.isFinite(req?.timeStamp) ? new Date(req.timeStamp).toLocaleTimeString() : '—';
    meta.textContent = `${req?.type ?? '—'} · ${ts}`;

    left.appendChild(title);
    left.appendChild(meta);

    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '8px';

    const score = clamp01(req?.subdomainScore);
    const scoreEl = document.createElement('div');
    scoreEl.className = `score ${dnsScoreClass(score)}`;
    scoreEl.textContent = Number.isFinite(score) ? score.toFixed(2) : '—';

    const chev = document.createElement('div');
    chev.className = 'chev';
    chev.setAttribute('aria-hidden', 'true');

    right.appendChild(scoreEl);
    right.appendChild(chev);

    sum.appendChild(left);
    sum.appendChild(right);

    const body = document.createElement('div');
    body.className = 'dnsReqBody';

    // Important details (reuse your .row styles)
    const list = document.createElement('div');
    list.className = 'list';

    const rows = [
        ['Score', Number.isFinite(score) ? score.toFixed(3) : '—'],
        ['Method', req?.method],
        ['URL', req?.url],
        ['Hostname', req?.hostname],
        ['Document URL', req?.documentUrl],
        ['Type', req?.type],
        ['Cross-origin', String(!!req?.isCrossOrigin)],
        ['Cross-host', String(!!req?.isCrossHost)],
    ].filter(([, v]) => v !== undefined && v !== null && v !== '');

    for (const [k, v] of rows) {
        const row = document.createElement('div');
        row.className = 'row';

        const kEl = document.createElement('div');
        kEl.className = 'k';
        kEl.textContent = k;

        const vEl = document.createElement('div');
        vEl.className = 'v';
        vEl.textContent = String(v);
        vEl.title = String(v); // full on hover

        row.appendChild(kEl);
        row.appendChild(vEl);
        list.appendChild(row);
    }

    body.appendChild(list);

    reqDetails.appendChild(sum);
    reqDetails.appendChild(body);
    return reqDetails;
}

function buildDnsDomainAccordion(domain, requests) {
    const domDetails = document.createElement('details');
    domDetails.className = 'dnsDomainDetails';

    const domainKey = `dnsDom::${domain}`;
    applyOpenState(domDetails, domainKey);

    const sum = document.createElement('summary');

    const left = document.createElement('div');
    left.className = 'dnsLeft';

    const title = document.createElement('div');
    title.className = 'dnsTitle';
    title.textContent = domain || '(unknown domain)';

    const domainMax = requests.reduce((m, r) => Math.max(m, r?.subdomainScore ?? -1), -1);
    const meta = document.createElement('div');
    meta.className = 'dnsMeta';
    meta.textContent = `${requests.length} requests`;

    left.appendChild(title);
    left.appendChild(meta);

    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '8px';

    const score = clamp01(domainMax);
    const scoreEl = document.createElement('div');
    scoreEl.className = `score ${dnsScoreClass(score)}`;
    scoreEl.textContent = Number.isFinite(score) ? score.toFixed(2) : '—';

    const chev = document.createElement('div');
    chev.className = 'chev';
    chev.setAttribute('aria-hidden', 'true');

    right.appendChild(scoreEl);
    right.appendChild(chev);

    sum.appendChild(left);
    sum.appendChild(right);

    const body = document.createElement('div');
    body.className = 'accBody';

    // sort requests by score desc (then newest first)
    const sorted = [...requests].sort((a, b) => {
        const as = a?.subdomainScore ?? -1;
        const bs = b?.subdomainScore ?? -1;
        if (bs !== as) return bs - as;
        return (b?.timeStamp ?? 0) - (a?.timeStamp ?? 0);
    });

    for (const req of sorted) {
        body.appendChild(buildDnsRequestAccordion(req, domainKey));
    }

    domDetails.appendChild(sum);
    domDetails.appendChild(body);
    return domDetails;
}

function renderDns(snapshot) {
    const listHost = document.getElementById('dnsDomainsList');
    const badge = document.getElementById('badgeDns');
    const dot = document.getElementById('dotDns');

    listHost.innerHTML = '';

    const all = Array.isArray(snapshot?.dnsTrackingRequests) ? snapshot.dnsTrackingRequests : [];

    // Only consider "detected" if score > 0.2
    const detected = all.filter((r) => (r?.subdomainScore ?? 0) > 0.2);

    // Summary counts
    const byDomain = new Map();
    for (const r of detected) {
        const dom = r?.hostname || '(unknown)';
        if (!byDomain.has(dom)) byDomain.set(dom, []);
        byDomain.get(dom).push(r);
    }

    document.getElementById('dnsDomains').textContent = String(byDomain.size);
    document.getElementById('dnsRequests').textContent = String(detected.length);

    // Highest score overall
    const maxScore = detected.reduce((m, r) => Math.max(m, r?.subdomainScore ?? -1), -1);

    // badge + dot color
    if (detected.length === 0) {
        setDot(dot, 'good'); // green if none (requested)
        badge.textContent = 'none';
        const empty = document.createElement('div');
        empty.className = 'state';
        empty.textContent = 'No DNS tracking detected (score > 0.2).';
        listHost.appendChild(empty);
        return;
    }

    // detected exists -> orange or red based on max score
    if (maxScore > 0.6) {
        setDot(dot, 'bad');
    } else {
        setDot(dot, 'warn');
    }
    badge.textContent = `max ${clamp01(maxScore).toFixed(2)}`;

    // Sort domains by domain max score desc
    const domainEntries = [...byDomain.entries()]
        .map(([domain, reqs]) => {
            const domMax = reqs.reduce((m, r) => Math.max(m, r?.subdomainScore ?? -1), -1);
            return { domain, reqs, domMax };
        })
        .sort((a, b) => b.domMax - a.domMax);

    for (const { domain, reqs } of domainEntries) {
        listHost.appendChild(buildDnsDomainAccordion(domain, reqs));
    }
}

// ---------- main render ----------
function render(snapshot) {
    openKeys = captureOpenKeysFromDom();

    const doc = pickMainDocument(snapshot);
    const metrics = doc?.fpMetrics ?? null;

    renderFingerprintMetrics(metrics, snapshot);

    // CNAME overview
    renderCname(snapshot);

    // DNS placeholder
    renderDns(snapshot);

    // Scripts
    renderScriptsList(doc?.scripts ?? []);
}

// ---------- init / wiring ----------
(function init() {
    // Toggle scripts button
    document.getElementById('scriptsToggleBtn').addEventListener('click', () => {
        showAllScripts = !showAllScripts;
        renderScriptsList(lastScripts);
    });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab) {
            console.warn('No active tab found for popup');
            return;
        }

        chrome.runtime.sendMessage({ type: 'GET_TAB_SNAPSHOT', tabId: tab.id }, (snapshot) => {
            if (chrome.runtime.lastError) {
                return;
            }
            render(snapshot);
        });
    });

    // Live updates from service worker
    chrome.runtime.onMessage.addListener((message) => {
        if (message?.type === 'ANALYSIS_UPDATED') {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0];
                if (!tab) return;
                if (tab.id !== message.tabId) return;

                render(message.data);
            });
        }
    });
})();
