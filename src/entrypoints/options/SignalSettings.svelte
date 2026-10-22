<script lang="ts">
    import { DEFAULT_SETTINGS, LEVEL_LABELS, type ScoreLevel, type ScoringSettings } from '@/lib/scoring';
    import { differs } from './inputs';
    import LevelSettings, { sectionId } from './LevelSettings.svelte';
    import SectionHead from './SectionHead.svelte';

    let { settings = $bindable(), onchange }: { settings: ScoringSettings; onchange: () => void } = $props();

    // From the overall score down to its parts.
    const LEVELS: { level: ScoreLevel; note: string }[] = [
        { level: 'page', note: 'The fingerprinting score of a page: its strongest script in full, and the other scripts on top of it.' },
        { level: 'otherScripts', note: "The page's other scripts, on top of the strongest one: scored like a script, from their strongest burst and what they read beyond it." },
        { level: 'otherScriptsBeyondBurst', note: 'What the other scripts read outside their strongest burst, on top of the strongest script and the burst.' },
        { level: 'script', note: 'The fingerprinting score of a script: its strongest burst, and what it read outside it.' },
        { level: 'scriptBeyondBurst', note: 'What a script read outside its strongest burst, on top of what the burst read.' },
        { level: 'burst', note: 'A burst of calls: one collection of details, read in quick succession.' },
    ];

    function setStrength(level: ScoreLevel, key: string, value: number) {
        (settings.strengths[level] as Record<string, number>)[key] = value;
        onchange();
    }

    function resetLevel(level: ScoreLevel) {
        (settings.strengths as Record<ScoreLevel, unknown>)[level] = structuredClone(DEFAULT_SETTINGS.strengths[level]);
        onchange();
    }
</script>

<p class="intro">
    Every score is built from signals: things the extension observes, such as how many unusual fingerprinting APIs a script reads. For
    each signal you set how likely tracking is <strong>from this signal alone</strong>. Signals add up as independent
    evidence: each one closes its share of the remaining gap, so a score can never exceed 100%, and a signal that isn't
    present changes nothing. Some signals are made from another score, such as a script's strongest burst of calls:
    "made from" links to the settings that go into it.
</p>
{#each LEVELS as { level, note } (level)}
    <section class="squircle" id={sectionId(level)}>
        <SectionHead title={LEVEL_LABELS[level]} changed={differs(settings.strengths[level], DEFAULT_SETTINGS.strengths[level])} onreset={() => resetLevel(level)} />
        <p class="section-note">{note}</p>
        <LevelSettings {level} {settings} onStrength={setStrength} />
    </section>
{/each}

<style>
    .intro {
        margin: 0;
        color: var(--muted);
        line-height: 1.5;
    }

    .intro strong {
        color: var(--text);
        font-weight: 600;
    }
</style>
