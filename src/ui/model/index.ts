// Turns a TabSnapshot into what the popup and the details page (entrypoints/dashboard) show: each
// script's fingerprinting with its score tree, and what it read, sent and stored.
export { LIKELIHOOD_LABELS } from './shared';
export type { Likelihood } from './shared';
export { pageUrl, pageHost } from './urls';
export { blockedDetails, fingerprintingDetails } from './scripts';
export type { ScriptDetail, LearnedKind, BlockedDetail, Signal } from './scripts';
export type { StoredDetail } from './stored';
export type { SentRequest } from './requests';
export { identifyingBits } from './apis';
export type { ApiDetail } from './apis';
export { fingerprintingPageDetail } from './page';
export type { ScoreNode } from './score-tree';
