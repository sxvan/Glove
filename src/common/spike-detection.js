/**
 *
 * @param {FpMonkeyEvent[] | HttpMonkeyEvent[]} events
 * @param {number} windowMs
 * @param {number} minEvents
 * @param {number} minDistinctEvents
 * @param {number} maxGapMs
 * @returns {FpSpike[]}
 */
export function detectSpikes(events, windowMs = 50, minEvents = 5, minDistinctEvents = 4, maxGapMs = 10) {
    if (events.length === 0) {
        return [];
    }

    events.sort((a, b) => a.timeStamp - b.timeStamp);

    const spikes = [];
    let startIndex = 0;

    for (let endIndex = 0; endIndex < events.length; endIndex++) {
        while (events[endIndex].timeStamp - events[startIndex].timeStamp > windowMs) {
            startIndex++;
        }

        const windowSize = endIndex - startIndex + 1;

        if (windowSize >= minEvents) {
            let extendedEndIndex = endIndex;

            while (extendedEndIndex + 1 < events.length && events[extendedEndIndex + 1].timeStamp - events[extendedEndIndex].timeStamp <= maxGapMs) {
                extendedEndIndex++;
            }

            const spikeEvents = events.slice(startIndex, extendedEndIndex + 1);
            const distinctEventsSet = new Set(spikeEvents.map((e) => e.id));
            if (distinctEventsSet.size < minDistinctEvents) {
                continue;
            }

            spikes.push({ events: spikeEvents });

            startIndex = extendedEndIndex + 1;
            endIndex = startIndex - 1;
        }
    }

    return spikes;
}
