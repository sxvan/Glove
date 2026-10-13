import type { FpMonkeyEvent, HttpMonkeyEvent } from './events';
import type { TabSnapshot } from './snapshot';

/** Content script (bridge) -> background. Fingerprinting events arrive in batches (see fp-recorder). */
export type RecorderMessage = { type: 'fp-batch'; payload: FpMonkeyEvent[] } | { type: 'http'; payload: HttpMonkeyEvent };

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
