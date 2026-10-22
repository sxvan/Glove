// What the popup and the dashboard get of a tab's recording: copies, so they can't change it.
import { currentDocument, currentDocuments } from './session-manager';
import { carriesData } from './http-analysis';
import type { PerformanceLimits } from './limits';
import type { ScoringSettings } from './scoring';
import type { FpBurst, FpMetrics, HttpRequest } from '@/types/analysis';
import type { DocumentState, FrameState, ScriptState, Session } from '@/types/session';
import type { BurstSnapshot, CallLocation, DocumentSnapshot, EventLog, EventLogEntry, FrameSnapshot, MetricsSnapshot, ScriptSnapshot, TabSnapshot } from '@/types/snapshot';

export function callsOnPage(session: Session, tabId: number): number {
    let calls = 0;
    for (const document of currentDocuments(session, tabId)) {
        for (const script of Object.values(document.scripts)) calls += script.callCount;
    }
    return calls;
}

// Undefined for a tab without recorded data, e.g. opened before the extension was (re)loaded.
export function buildTabSnapshot(session: Session, tabId: number, settings: ScoringSettings, limits: PerformanceLimits): TabSnapshot | undefined {
    const tabState = session.tabs[tabId];
    if (!tabState) return undefined;

    const tabSnapshot: TabSnapshot = {
        cNameRequests: collectCnameCloakedRequestsForTab(session, tabId),
        frames: Object.entries(tabState.frames).map(([frameId, frameState]) => frameSnapshotFromFrame(frameState, frameId)),
        cutoffs: settings.cutoffs,
        apis: settings.apis,
        rarityPower: settings.rarityPower,
        callsCapped: callsOnPage(session, tabId) >= limits.callsPerPage,
        identifiers: settings.identifiers,
        rightAfterMs: settings.bursts.requestWindowMs,
    };

    return tabSnapshot;
}

// A request is in the lists of every script on its stack (see storeHttpEvent); here it is once.
export function buildEventLog(session: Session, tabId: number): EventLog | undefined {
    const frames = session.tabs[tabId]?.frames;
    if (!frames) return undefined;
    const entries: EventLogEntry[] = [];
    const requests = new Set<object>();
    let startTime: number | null = null;
    for (const [frameId, frame] of Object.entries(frames)) {
        const document = currentDocument(frame);
        if (!document) continue;
        if (frameId === '0') startTime = document.startTime;
        for (const [script, state] of Object.entries(document.scripts)) {
            const burstOf = new Map<object, number>();
            state.bursts.forEach((burst, i) => burst.events.forEach((event) => burstOf.set(event, i + 1)));
            for (const event of state.fpEvents) {
                entries.push({ kind: 'api', frameId, script, time: event.timeStamp, api: event.id, line: event.line, column: event.column, generated: event.generated, burst: burstOf.get(event) ?? null });
            }
            for (const event of state.httpEvents) {
                if (requests.has(event)) continue;
                requests.add(event);
                entries.push({ kind: 'request', frameId, script: String(event.scriptUrls[0] ?? event.scriptUrl), time: event.timeStamp, how: event.id, method: event.method, url: event.requestUrl });
            }
            for (const item of Object.values(state.stored)) {
                entries.push({ kind: 'stored', frameId, script, time: item.first, storage: item.kind, name: item.name, writes: item.writes });
            }
        }
    }
    return { startTime, entries: entries.sort((a, b) => a.time - b.time) };
}

function frameSnapshotFromFrame(frame: FrameState, frameId: string): FrameSnapshot | null {
    const document = currentDocument(frame);
    if (!document) return null;

    return {
        frameId: frameId,
        document: documentSnapshotFromDocument(document),
    };
}

function documentSnapshotFromDocument(document: DocumentState): DocumentSnapshot {
    return {
        documentId: document.documentId,
        url: document.currentUrl,
        startTime: document.startTime,
        fpMetrics: convertToMetricsSnapshot(document.fpMetrics),
        bursts: document.bursts.map((burst) => convertToMetricsSnapshot(burst.fpMetrics)).filter((metrics) => metrics !== null),
        scripts: Object.entries(document.scripts).map(([scriptName, script]) => scriptSnapshotFromScript(script, scriptName)),
        blockedScripts: Object.values(document.blockedScripts).map((attempt) => ({ ...attempt })),
    };
}

function scriptSnapshotFromScript(script: ScriptState, scriptName: string): ScriptSnapshot {
    const apiCounts: Record<string, number> = {};
    const apiLocations: Record<string, CallLocation[]> = {};
    const apiTimes: Record<string, { first: number; last: number }> = {};
    for (const [api, calls] of Object.entries(script.calls)) {
        apiCounts[api] = calls.count;
        apiTimes[api] = { first: calls.first, last: calls.last };
        const locations = Object.values(calls.locations);
        if (locations.length > 0) apiLocations[api] = locations.map((location) => ({ ...location })).sort((a, b) => b.calls - a.calls);
    }

    return {
        name: scriptName,
        fpMetrics: convertToMetricsSnapshot(script.fpMetrics),
        bursts: script.bursts.map(convertToBurstSnapshot),
        apiCounts,
        apiLocations,
        apiTimes,
        capped: script.capped === true,
        requests: script.httpConsolidatedEvents.filter(carriesData),
        // Only requests with data, as the score counts them.
        cloakedHosts: [
            ...new Set(
                script.httpConsolidatedEvents
                    .filter((request) => request.httpRequest?.isCnameCloaked && request.httpRequest.hostname && carriesData(request))
                    .map(({ httpRequest }) => httpRequest.hostname!)
            ),
        ],
        stored: Object.values(script.stored)
            .map((item) => ({ ...item }))
            .sort((a, b) => a.first - b.first),
    };
}

function collectCnameCloakedRequestsForTab(session: Session, tabId: number): HttpRequest[] {
    return currentDocuments(session, tabId).flatMap((document) => document.httpRequests.filter((request) => request.isCnameCloaked));
}

function convertToMetricsSnapshot(fpMetrics: FpMetrics | null | undefined): MetricsSnapshot | null {
    if (!fpMetrics) {
        return null;
    }

    return {
        distinctFpApis: Array.from(fpMetrics.distinctFpApis),
        intensity: fpMetrics.intensity,
        durationMs: fpMetrics.durationMs,
        score: fpMetrics.score,
        signals: fpMetrics.signals,
    };
}

function convertToBurstSnapshot(burst: FpBurst): BurstSnapshot {
    return {
        events: burst.events,
        fpMetrics: convertToMetricsSnapshot(burst.fpMetrics),
        httpCorrelations: burst.httpCorrelations,
    };
}
