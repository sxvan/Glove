import type { FpSpike } from '@/types/analysis';
import type { FpMonkeyEvent } from '@/types/events';
import { BURST_DETECTION } from './scoring';

/**
 * Finds bursts of fingerprinting calls: runs of calls at most `maxGapMs` apart, split after
 * `maxDurationMs`, that read at least `minDistinctApis` different APIs (see BURST_DETECTION). Sorts
 * `events` in place by timestamp.
 */
export function detectSpikes(events: FpMonkeyEvent[]): FpSpike[] {
    const { maxGapMs, maxDurationMs, minDistinctApis } = BURST_DETECTION;
    events.sort((a, b) => a.timeStamp - b.timeStamp);

    const spikes: FpSpike[] = [];
    let run: FpMonkeyEvent[] = [];

    const endRun = () => {
        if (new Set(run.map((e) => e.id)).size >= minDistinctApis) spikes.push({ events: run });
        run = [];
    };

    for (const event of events) {
        const previous = run.at(-1);
        const tooLate = previous && event.timeStamp - previous.timeStamp > maxGapMs;
        const tooLong = run.length > 0 && event.timeStamp - run[0]!.timeStamp > maxDurationMs;
        if (tooLate || tooLong) endRun();
        run.push(event);
    }
    endRun();

    return spikes;
}
