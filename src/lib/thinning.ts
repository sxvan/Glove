// Keeps long-lived documents (single-page apps open for hours: YouTube, Gmail, Slack) from growing
// without limit. Above a limit, a script's raw calls and requests are thinned out to what the
// analysis still needs, so its scores stay what they were:
// - all calls of its strongest bursts and of the page's strongest bursts, which give the scores;
// - one call per API and place in the code (line, column, generated or not), so the different APIs,
//   "from one place" and "generated code" stay the same;
// - the most recent calls, so a burst still going on stays whole.
// Call counts and places are counted as calls arrive (ScriptState.calls), so they stay exact.
// Requests are thinned likewise: those near kept bursts, the cloaked ones, one per host (for the
// lists of hosts) and the most recent.

import type { FpSpike, HttpRequest } from '@/types/analysis';
import type { FpMonkeyEvent, HttpMonkeyEvent } from '@/types/events';
import type { DocumentState } from '@/types/session';

// From how many raw calls a script is thinned out, and how many of the newest it keeps.
const MAX_CALLS = 20000;
const RECENT_CALLS = 2000;
// Likewise for a script's recorded requests and the document's requests seen by the browser.
const MAX_REQUESTS = 5000;
const RECENT_REQUESTS = 1000;
// Bursts kept whole, the strongest first, per script and for the page.
const KEPT_BURSTS = 5;

/** Thins out the document's scripts and requests that went over their limits (see above). */
export function thinDocument(document: DocumentState, requestWindowMs: number) {
    const scripts = Object.values(document.scripts);
    const overLimit = document.httpRequests.length > MAX_REQUESTS || scripts.some((s) => s.fpEvents.length > MAX_CALLS || s.httpEvents.length > MAX_REQUESTS);
    if (!overLimit) return;

    // The calls of the bursts that give the scores, and the time spans requests count in.
    const keptBursts = [...strongest(document.spikes), ...scripts.flatMap((s) => strongest(s.fpSpikes))];
    const keptCalls = new Set<FpMonkeyEvent>(keptBursts.flatMap((burst) => burst.events));
    const spans = keptBursts.map((burst) => [burst.events[0]!.timeStamp, burst.events[burst.events.length - 1]!.timeStamp + requestWindowMs] as const);
    const inSpan = (time: number) => spans.some(([start, end]) => time >= start && time <= end);

    const keptRequests = new Set<HttpRequest>();
    for (const script of scripts) {
        if (script.fpEvents.length > MAX_CALLS) script.fpEvents = thinCalls(script.fpEvents, keptCalls);
        if (script.httpEvents.length > MAX_REQUESTS) {
            const recent = script.httpEvents.length - RECENT_REQUESTS;
            script.httpEvents = script.httpEvents.filter((event: HttpMonkeyEvent, i) => i >= recent || inSpan(event.timeStamp));
        }
        for (const { httpEvent, httpRequest } of script.httpConsolidatedEvents) if (inSpan(httpEvent.timeStamp)) keptRequests.add(httpRequest);
    }

    if (document.httpRequests.length > MAX_REQUESTS) {
        const hosts = new Set<string | null>();
        const recent = document.httpRequests.length - RECENT_REQUESTS;
        document.httpRequests = document.httpRequests.filter((request, i) => {
            const firstOfHost = !hosts.has(request.hostname);
            hosts.add(request.hostname);
            return i >= recent || firstOfHost || request.isCnameCloaked || keptRequests.has(request);
        });
    }
}

/** The calls to keep of a script's, in time order: those of kept bursts, one per API and place, the newest. */
function thinCalls(calls: FpMonkeyEvent[], keptCalls: Set<FpMonkeyEvent>): FpMonkeyEvent[] {
    const places = new Set<string>();
    const recent = calls.length - RECENT_CALLS;
    return calls.filter((call, i) => {
        const place = `${call.id}|${call.line}|${call.column}|${call.generated}`;
        const firstAtPlace = !places.has(place);
        places.add(place);
        return i >= recent || firstAtPlace || keptCalls.has(call);
    });
}

function strongest(bursts: FpSpike[]): FpSpike[] {
    return [...bursts].sort((a, b) => (b.fpMetrics?.score ?? 0) - (a.fpMetrics?.score ?? 0)).slice(0, KEPT_BURSTS);
}
