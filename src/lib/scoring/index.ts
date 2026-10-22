// The one place that defines how the extension scores what it observes.
//
// Every score is made of signals. A signal is something observed, as a value from 0 to 1 (e.g. how
// many unusual fingerprinting APIs a script read, 1 meaning "a lot"). Each signal has a strength:
// how high the score gets from this signal alone, e.g. 0.6 for "up to 60% likely". Signals combine
// as independent evidence, each closing its share of the remaining gap to 1:
//
//     score = 1 - (1 - strength1 * value1) * (1 - strength2 * value2) * ...
//
// So a signal that isn't present changes nothing, adding a signal never needs the others adjusted,
// and a score can never exceed 1. Every setting here is a default the user can change on the options
// page.
export { SIGNALS, SIGNAL_SOURCES, LEVEL_LABELS, APIS_LEVEL_LABELS, DEFAULT_SETTINGS, BURST_DETECTION_FIELDS, IDENTIFIER_RULE_FIELDS } from './definitions';
export type { SignalDefinition, ScoreLevel, SignalValues, SignalSource, Cutoffs, ApisLevel, ApisFullAt, ApiTraits, ScoringSettings, BurstDetection } from './definitions';
export { combineParts, apisSums, EVERYONE_BITS, apisSumsBeyond, rareAmounts, rareIdentifyingBits, identifyingBits } from './combine';
export type { SignalPart, ScoredParts, ApiAmount, ApisSum, ApisSums } from './combine';
export { loadScoringSettings, saveScoringSettings, resetScoringSettings, watchScoringSettings } from './settings';
