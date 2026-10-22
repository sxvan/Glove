<script lang="ts">
    import { BURST_DETECTION_FIELDS, DEFAULT_SETTINGS, IDENTIFIER_RULE_FIELDS, type BurstDetection, type ScoringSettings } from '@/lib/scoring';
    import type { IdentifierRules } from '@/lib/identifiers';
    import { differs, percent, percentFromInput, positiveFromInput, resetPart } from './inputs';
    import SectionHead from './SectionHead.svelte';

    let { settings = $bindable(), onchange }: { settings: ScoringSettings; onchange: () => void } = $props();

    function setCutoff(which: 'possible' | 'likely', event: Event) {
        const value = percentFromInput(event);
        if (value === null) return;
        settings.cutoffs.fingerprinting[which] = value;
        onchange();
    }

    function setBurstDetection(key: keyof BurstDetection, event: Event) {
        const value = positiveFromInput(event);
        if (value === null) return;
        settings.bursts[key] = value;
        onchange();
    }

    function setIdentifierRule(key: keyof IdentifierRules, event: Event) {
        const value = positiveFromInput(event);
        if (value === null) return;
        settings.identifiers[key] = value;
        onchange();
    }

    function reset(key: 'cutoffs' | 'bursts' | 'identifiers') {
        resetPart(settings, key);
        onchange();
    }

    const invalidCutoffs = $derived(Object.values(settings.cutoffs).some((cutoffs) => cutoffs.likely <= cutoffs.possible));
</script>

<section class="squircle">
    <SectionHead title="Likelihood" changed={differs(settings.cutoffs, DEFAULT_SETTINGS.cutoffs)} onreset={() => reset('cutoffs')} />
    <p class="section-note">Where a score counts as possible or likely tracking.</p>
    <div class="row cutoffs">
        <div class="name">Fingerprinting (pages and scripts)</div>
        <label class="field">
            Possible from
            <input type="number" min="0" max="100" step="1" value={percent(settings.cutoffs.fingerprinting.possible)} oninput={(e) => setCutoff('possible', e)} />
            %
        </label>
        <label class="field">
            Likely from
            <input type="number" min="0" max="100" step="1" value={percent(settings.cutoffs.fingerprinting.likely)} oninput={(e) => setCutoff('likely', e)} />
            %
        </label>
    </div>
    {#if invalidCutoffs}
        <p class="warning">"Likely" should be above "possible".</p>
    {/if}
</section>

<section class="squircle" id="bursts">
    <SectionHead title="Bursts of calls" changed={differs(settings.bursts, DEFAULT_SETTINGS.bursts)} onreset={() => reset('bursts')} />
    <p class="section-note">
        What counts as a burst: fingerprinting APIs read in quick succession, one collection of details. Bursts are found in
        each script and across the page, all scripts together.
    </p>
    {#each BURST_DETECTION_FIELDS as field (field.key)}
        {@const changed = settings.bursts[field.key] !== DEFAULT_SETTINGS.bursts[field.key]}
        <div class="row">
            <div>
                <div class="name">{field.label}</div>
                <div class="description">{field.description}</div>
            </div>
            <label class="field" class:changed>
                <input type="number" min="0" step="1" value={settings.bursts[field.key]} oninput={(e) => setBurstDetection(field.key, e)} />
                {field.unit}
            </label>
            <span class="default" class:changed>default {DEFAULT_SETTINGS.bursts[field.key]} {field.unit}</span>
        </div>
    {/each}
</section>

<section class="squircle" id="identifiers">
    <SectionHead title="Stored identifiers" changed={differs(settings.identifiers, DEFAULT_SETTINGS.identifiers)} onreset={() => reset('identifiers')} />
    <p class="section-note">
        What a script stores in cookies and storage is a <strong>possible identifier</strong> when it is kept long enough and holds a part
        that looks like one: of a length below, with a digit, as words have none. Measurement studies tell identifier cookies apart
        the same way
        (<a href="https://senglehardt.com/papers/www15_cookie_surveil.pdf" target="_blank" rel="noopener noreferrer">Englehardt et al.</a>,
        <a href="https://www.cs.princeton.edu/~arvindn/publications/OpenWPM_1_million_site_tracking_measurement.pdf" target="_blank" rel="noopener noreferrer">Englehardt and Narayanan</a>);
        whether a value differs between browsers, their last rule, can't be told from one browser. It is a
        <strong>likely identifier</strong> when the same value is also stored in another place, to restore it from there when one is cleared,
        or stored right after a burst of calls that scores at least possible fingerprinting on its own (see Bursts of calls).
    </p>
    {#each IDENTIFIER_RULE_FIELDS as field (field.key)}
        {@const changed = settings.identifiers[field.key] !== DEFAULT_SETTINGS.identifiers[field.key]}
        <div class="row">
            <div>
                <div class="name">{field.label}</div>
                <div class="description">{field.description}</div>
            </div>
            <label class="field" class:changed>
                <input type="number" min="0" step="1" value={settings.identifiers[field.key]} oninput={(e) => setIdentifierRule(field.key, e)} />
                {field.unit}
            </label>
            <span class="default" class:changed>default {DEFAULT_SETTINGS.identifiers[field.key]} {field.unit}</span>
        </div>
    {/each}
</section>

<style>
    .warning {
        margin: 6px 0 0;
        color: var(--possible);
        font-size: 12px;
    }
</style>
