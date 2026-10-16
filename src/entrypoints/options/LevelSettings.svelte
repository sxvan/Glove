<script module lang="ts">
    import type { SignalSource } from '@/lib/scoring';

    /** The id of a level's section on the options page, which "made from" links point to. */
    export const sectionId = (source: SignalSource) => (source === 'apis' ? 'apis' : `level-${source}`);
</script>

<script lang="ts">
    import {
        DEFAULT_SETTINGS,
        LEVEL_LABELS,
        SIGNALS,
        SIGNAL_SOURCES,
        type ScoreLevel,
        type ScoringSettings,
        type SignalDefinition,
    } from '@/lib/scoring';
    import { percent, percentFromInput } from './inputs';

    interface Props {
        level: ScoreLevel;
        settings: ScoringSettings;
        onStrength: (level: ScoreLevel, key: string, value: number) => void;
    }

    let { level, settings, onStrength }: Props = $props();

    interface Group {
        /** What the group's signals are made from; null for signals observed directly. */
        source: SignalSource | null;
        signals: [string, SignalDefinition][];
    }

    // Signals made from the same thing are grouped, in the order the first of them is listed.
    const groups = $derived.by(() => {
        const sources = (SIGNAL_SOURCES[level] ?? {}) as Record<string, SignalSource>;
        const groups: Group[] = [];
        for (const [key, signal] of Object.entries(SIGNALS[level]) as [string, SignalDefinition][]) {
            const source = sources[key] ?? null;
            const group = source && groups.find((g) => g.source === source);
            if (group) group.signals.push([key, signal]);
            else groups.push({ source, signals: [[key, signal]] });
        }
        return groups;
    });

    const strengthOf = (key: string) => (settings.strengths[level] as Record<string, number>)[key] ?? 0;
    const defaultOf = (key: string) => (DEFAULT_SETTINGS.strengths[level] as Record<string, number>)[key] ?? 0;
    const sourceLabel = (source: SignalSource) => (source === 'apis' ? 'Fingerprinting APIs' : LEVEL_LABELS[source]);

    function setStrength(key: string, event: Event) {
        const value = percentFromInput(event);
        if (value !== null) onStrength(level, key, value);
    }
</script>

{#snippet signalRows(signals: [string, SignalDefinition][])}
    {#each signals as [key, signal] (key)}
        {@const value = strengthOf(key)}
        <div class="row">
            <div>
                <div class="name">{signal.label}</div>
                <div class="description">{signal.description}</div>
            </div>
            <label class="field">
                Alone up to
                <input type="number" min="0" max="100" step="1" value={percent(value)} oninput={(e) => setStrength(key, e)} />
                %
            </label>
            <span class="default" class:changed={percent(value) !== percent(defaultOf(key))}>default {percent(defaultOf(key))}%</span>
        </div>
    {/each}
{/snippet}

{#each groups as group, i (i)}
    <div class="group">
        {#if !group.source}
            {@render signalRows(group.signals)}
        {:else}
            <!-- The bar brackets the signals made from the same source and ends in a link to its section. -->
            <div class="bracketed">
                <div class="bracket-rows">{@render signalRows(group.signals)}</div>
                <a class="bracket-link" href="#{sectionId(group.source)}">made from <strong>{sourceLabel(group.source)}</strong></a>
            </div>
        {/if}
    </div>
{/each}
