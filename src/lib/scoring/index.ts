// Every score is made of signals, each a value from 0 to 1 with a strength: how high the score gets
// from it alone. They combine as independent evidence:
//
//     score = 1 - (1 - strength1 * value1) * (1 - strength2 * value2) * ...
//
// so a signal that isn't present changes nothing, adding one needs no others adjusted, and a score
// never exceeds 1.
export { SIGNALS, SIGNAL_SOURCES, LEVEL_LABELS, APIS_LEVEL_LABELS, DEFAULT_SETTINGS, BURST_DETECTION_FIELDS, IDENTIFIER_RULE_FIELDS } from './definitions';
export type { SignalDefinition, ScoreLevel, SignalValues, SignalSource, Cutoffs, ApisLevel, ApisFullAt, ApiTraits, ScoringSettings, BurstDetection } from './definitions';
export { combineParts, apisSums, EVERYONE_BITS, apisSumsBeyond, rareAmounts, rareIdentifyingBits, identifyingBits } from './combine';
export type { SignalPart, ScoredParts, ApiAmount, ApisSum, ApisSums } from './combine';
export { loadScoringSettings, saveScoringSettings, resetScoringSettings, watchScoringSettings } from './settings';
