import type { FpMonkeyEvent, HttpMonkeyEvent, StorageMonkeyEvent } from './events';
import type { TabSnapshot } from './snapshot';

/** Content script (bridge) -> background. Fingerprinting events arrive in batches (see fp-recorder). */
export type RecorderMessage =
    | { type: 'fp-batch'; payload: FpMonkeyEvent[] }
    | { type: 'http'; payload: HttpMonkeyEvent }
    | { type: 'storage-batch'; payload: StorageMonkeyEvent[] };

/** Popup -> background; answered with a TabSnapshot */
export interface GetTabSnapshotMessage {
    type: 'GET_TAB_SNAPSHOT';
    tabId: number;
}

/** Background -> popup */
export interface AnalysisUpdatedMessage {
    type: 'ANALYSIS_UPDATED';
    tabId: number;
    data: TabSnapshot;
}

/**
 * Popup -> background: blocks the script at `url`, or lets it run again, then does what the user
 * chose for after it (see BlockingOptions) in the tab; answered with a SetBlockedResult.
 */
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

/** Popup -> background: turns the extension off on the tab's site, or on again (see lib/sites), and loads it again. */
export interface SetSiteOffMessage {
    type: 'SET_SITE_OFF';
    host: string;
    off: boolean;
    tabId: number;
}
