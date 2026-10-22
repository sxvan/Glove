import type { ScoringSettings } from '@/lib/scoring';
import type { BurstSnapshot, MetricsSnapshot, TabSnapshot } from '@/types/snapshot';

/** How likely tracking is; "unknown" while nothing was recorded for the tab yet. */
export type Likelihood = 'unknown' | 'unlikely' | 'possible' | 'likely';

export const LIKELIHOOD_LABELS: Record<Likelihood, string> = {
    unknown: 'Unknown',
    unlikely: 'Unlikely',
    possible: 'Possible',
    likely: 'Likely',
};

/**
 * Each API's rare bits read alone (its bits times its rarity to the exponent): to list kinds of
 * detail by what makes a script suspicious, not by what reveals most.
 */
export function rareBitsOf(snapshot: TabSnapshot): Record<string, number> {
    const power = Math.max(0, snapshot.rarityPower);
    return Object.fromEntries(Object.entries(snapshot.apis).map(([id, traits]) => [id, Math.max(0, traits.bits) * Math.min(1, Math.max(0, traits.rarity)) ** power]));
}

export function fpLikelihood(score: number, cutoffs: ScoringSettings['cutoffs']): Likelihood {
    const { possible, likely } = cutoffs.fingerprinting;
    return score >= likely ? 'likely' : score >= possible ? 'possible' : 'unlikely';
}

export function strongestBurst(bursts: BurstSnapshot[]): MetricsSnapshot | null {
    return strongest(bursts, (burst) => burst.fpMetrics?.score ?? -1)?.fpMetrics ?? null;
}

/** The item scoring highest, the first of those tied. */
export function strongest<T>(items: T[], score: (item: T) => number): T | undefined {
    return items.reduce<T | undefined>((best, item) => (best === undefined || score(item) > score(best) ? item : best), undefined);
}
