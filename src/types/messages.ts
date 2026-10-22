import type { ApiCallEvent, RequestEvent, StorageWriteEvent } from './events';
import type { TabSnapshot } from './snapshot';

/** Content script (bridge) -> background. Fingerprinting events arrive in batches (see fp-recorder). */
export type RecorderMessage =
    | { type: 'fp-batch'; payload: ApiCallEvent[] }
    | { type: 'http'; payload: RequestEvent }
    | { type: 'storage-batch'; payload: StorageWriteEvent[] };

/** Popup or dashboard -> background; answered with a TabSnapshot, or undefined without a recording. */
export interface GetTabSnapshotMessage {
    type: 'GET_TAB_SNAPSHOT';
    tabId: number;
}

/** Dashboard -> background; answered with the tab's EventLog, or undefined without a recording. */
export interface GetEventLogMessage {
    type: 'GET_EVENT_LOG';
    tabId: number;
}

/** Background -> open popups and dashboards, after an analysis. */
export interface AnalysisUpdatedMessage {
    type: 'ANALYSIS_UPDATED';
    tabId: number;
    data: TabSnapshot;
}

/** Popup -> background; answered with a SetBlockedResult. */
export interface SetBlockedMessage {
    type: 'SET_BLOCKED';
    url: string;
    blocked: boolean;
    tabId: number | null;
}

export interface SetBlockedResult {
    reloaded: boolean;
    cleared: boolean;
}

/** Popup -> background; the tab is loaded again. */
export interface SetSiteOffMessage {
    type: 'SET_SITE_OFF';
    host: string;
    off: boolean;
    tabId: number;
}
