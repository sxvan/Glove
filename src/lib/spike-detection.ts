import type { FpSpike } from '@/types/analysis';
import type { FpMonkeyEvent } from '@/types/events';
import type { BurstDetection } from './scoring';

/**
 * Finds bursts of fingerprinting calls with a sliding window: of all windows of `windowMs`, the one
 * whose different APIs weigh the most (see `weight`) becomes a burst, then the same with the calls
 * left, while a window still reads at least `minDistinctApis` different APIs (see BurstDetection).
 * Each call belongs to one burst at most. Unlike splitting at pauses, the result doesn't jump with
 * small timing differences: a collection is found as a whole wherever it starts. Sorts `events` in
 * place by timestamp; the bursts come in time order.
 */
export function detectSpikes(events: FpMonkeyEvent[], detection: BurstDetection, weight: (apiId: string) => number): FpSpike[] {
    events.sort((a, b) => a.timeStamp - b.timeStamp);

    const spikes: FpSpike[] = [];
    let remaining = events;
    for (;;) {
        const best = heaviestWindow(remaining, detection, weight);
        if (!best) break;
        spikes.push({ events: remaining.slice(best.start, best.end) });
        remaining = [...remaining.slice(0, best.start), ...remaining.slice(best.end)];
    }
    return spikes.sort((a, b) => a.events[0]!.timeStamp - b.events[0]!.timeStamp);
}

/**
 * The window of `windowMs` reading the heaviest set of different APIs, at least `minDistinctApis`
 * of them, as the range of `events` (sorted by time) in it; null if none reads enough. Ties go to
 * the window reading more different APIs, then the earliest.
 */
function heaviestWindow(
    events: FpMonkeyEvent[],
    { windowMs, minDistinctApis }: BurstDetection,
    weight: (apiId: string) => number
): { start: number; end: number } | null {
    // The calls per API in the window, and the weight and number of the different APIs in it.
    const counts = new Map<string, number>();
    let total = 0;
    let distinct = 0;
    let best: { start: number; end: number; total: number; distinct: number } | null = null;

    let end = 0;
    for (let start = 0; start < events.length; start++) {
        // Grow the window up to windowMs after its first call.
        while (end < events.length && events[end]!.timeStamp - events[start]!.timeStamp <= windowMs) {
            const id = events[end]!.id;
            const count = counts.get(id) ?? 0;
            if (count === 0) {
                total += weight(id);
                distinct += 1;
            }
            counts.set(id, count + 1);
            end++;
        }

        const better = !best || total > best.total || (total === best.total && distinct > best.distinct);
        if (distinct >= minDistinctApis && better) best = { start, end, total, distinct };

        // Drop the first call before moving on.
        const id = events[start]!.id;
        const count = counts.get(id)! - 1;
        counts.set(id, count);
        if (count === 0) {
            total -= weight(id);
            distinct -= 1;
        }
    }
    return best;
}
