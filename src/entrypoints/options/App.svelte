<script lang="ts">
    import { onMount } from 'svelte';
    import {
        DEFAULT_SETTINGS,
        APIS_LEVEL_LABELS,
        BURST_DETECTION_FIELDS,
        type BurstDetection,
        LEVEL_LABELS,
        loadScoringSettings,
        resetScoringSettings,
        saveScoringSettings,
        type ApisFullAt,
        type ApisLevel,
        type ApiTraits,
        type ScoreLevel,
        type ScoringSettings,
    } from '@/lib/scoring';
    import { FP_APIS, FP_CATEGORIES, type FpApi, type FpCategory } from '@/lib/fp-apis';
    import { percent, percentFromInput, positiveFromInput, unitFromInput } from './inputs';
    import LevelSettings, { sectionId } from './LevelSettings.svelte';
    import ThemeSwitch from './ThemeSwitch.svelte';

    // Saves after typing pauses, so every keystroke doesn't re-score all open pages.
    const SAVE_DELAY_MS = 400;

    let settings = $state<ScoringSettings | null>(null);
    let status = $state('');
    let saveTimer: ReturnType<typeof setTimeout> | undefined;

    onMount(async () => {
        settings = await loadScoringSettings();
    });

    function setStrength(level: ScoreLevel, key: string, value: number) {
        if (!settings) return;
        (settings.strengths[level] as Record<string, number>)[key] = value;
        scheduleSave();
    }

    function setFullAt(level: ApisLevel, which: keyof ApisFullAt, event: Event) {
        const value = positiveFromInput(event);
        if (!settings || value === null) return;
        settings.fullAt[level][which] = value;
        scheduleSave();
    }

    function setCutoff(kind: keyof ScoringSettings['cutoffs'], which: 'possible' | 'likely', event: Event) {
        const value = percentFromInput(event);
        if (!settings || value === null) return;
        settings.cutoffs[kind][which] = value;
        scheduleSave();
    }

    function setBurstDetection(key: keyof BurstDetection, event: Event) {
        const value = positiveFromInput(event);
        if (!settings || value === null) return;
        settings.bursts[key] = value;
        scheduleSave();
    }

    function setRarityPower(event: Event) {
        const value = positiveFromInput(event);
        if (!settings || value === null) return;
        settings.rarityPower = value;
        scheduleSave();
    }

    function setApiTrait(id: string, trait: keyof ApiTraits, event: Event) {
        // Bits have no upper end; rarity goes from 0 to 1.
        const value = trait === 'rarity' ? unitFromInput(event) : positiveFromInput(event);
        if (!settings || value === null) return;
        settings.apis[id] = { ...settings.apis[id]!, [trait]: value };
        scheduleSave();
    }

    // The levels in the order they are listed: from the overall score down to its parts.
    const LEVELS: { level: ScoreLevel; note: string }[] = [
        { level: 'page', note: 'The fingerprinting score of a page.' },
        { level: 'script', note: 'The fingerprinting score of a script.' },
        { level: 'burst', note: 'A burst of calls: one collection of details, read in quick succession.' },
        { level: 'request', note: 'A request a script makes right after a burst of calls.' },
        { level: 'hostname', note: 'How much a hostname looks like it carries an ID.' },
    ];
    const APIS_LEVELS: ApisLevel[] = ['page', 'script', 'pageBurst', 'burst'];

    // The APIs grouped by category, in the order of the API list.
    const API_GROUPS = Object.entries(Object.groupBy(FP_APIS, (api) => api.category)) as [FpCategory, FpApi[]][];

    function scheduleSave() {
        status = '';
        clearTimeout(saveTimer);
        saveTimer = setTimeout(async () => {
            await saveScoringSettings($state.snapshot(settings!));
            status = 'Saved. Open pages are scored again.';
        }, SAVE_DELAY_MS);
    }

    async function reset() {
        clearTimeout(saveTimer);
        await resetScoringSettings();
        settings = await loadScoringSettings();
        status = 'Reset to the defaults.';
    }

    /** True when the cutoffs don't make sense: "likely" has to be above "possible". */
    const invalidCutoffs = $derived(
        settings !== null && Object.values(settings.cutoffs).some((cutoffs) => cutoffs.likely <= cutoffs.possible)
    );
</script>

<main>
    <header>
        <h1>Scoring settings</h1>
        <button type="button" onclick={reset}>Reset to defaults</button>
    </header>

    <p class="intro">
        Every score is built from signals: things the extension observes, such as how many unusual fingerprinting APIs a script reads. For
        each signal you set how likely tracking is <strong>from this signal alone</strong>. Signals add up as independent
        evidence: each one closes its share of the remaining gap, so a score can never exceed 100%, and a signal that isn't
        present changes nothing. Some signals are made from another score, such as a script's strongest burst of calls:
        "made from" links to the settings that go into it.
    </p>
    <p class="status" role="status">{status}</p>

    <!-- Not a scoring setting: kept apart from them, and not reset with them. -->
    <section class="squircle">
        <h2>Appearance</h2>
        <div class="row">
            <div>
                <div class="name">Theme</div>
                <div class="description">The extension's pages in light or dark, or as the system is set.</div>
            </div>
            <ThemeSwitch />
        </div>
    </section>

    {#if settings}
        <section class="squircle">
            <h2>Likelihood</h2>
            <p class="section-note">Where a score counts as possible or likely tracking.</p>
            {#each [['fingerprinting', 'Fingerprinting (pages and scripts)'], ['hostname', 'ID-like hostnames']] as const as [kind, label] (kind)}
                <div class="row cutoffs">
                    <div class="name">{label}</div>
                    <label class="field">
                        Possible from
                        <input type="number" min="0" max="100" step="1" value={percent(settings.cutoffs[kind].possible)} oninput={(e) => setCutoff(kind, 'possible', e)} />
                        %
                    </label>
                    <label class="field">
                        Likely from
                        <input type="number" min="0" max="100" step="1" value={percent(settings.cutoffs[kind].likely)} oninput={(e) => setCutoff(kind, 'likely', e)} />
                        %
                    </label>
                </div>
            {/each}
            {#if invalidCutoffs}
                <p class="warning">"Likely" should be above "possible".</p>
            {/if}
        </section>

        <section class="squircle" id="bursts">
            <h2>Bursts of calls</h2>
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
                        <span class="unit">{field.unit}</span>
                    </label>
                    <span class="default" class:changed>default {DEFAULT_SETTINGS.bursts[field.key]} {field.unit}</span>
                </div>
            {/each}
        </section>

        {#each LEVELS as { level, note } (level)}
            <section class="squircle" id={sectionId(level)}>
                <h2>{LEVEL_LABELS[level]}</h2>
                <p class="section-note">{note}</p>
                <LevelSettings {level} {settings} onStrength={setStrength} />
            </section>
        {/each}

        <section class="squircle" id="apis">
            <h2>Fingerprinting APIs</h2>
            <p class="section-note">
                Each fingerprinting API has its <strong>bits</strong>: how much identifying information it reveals on its own, its entropy,
                so 6 bits tell one browser in 64 apart. They come from a study of 4 million fingerprints
                (<a href="https://arxiv.org/abs/2006.09511" target="_blank" rel="noopener noreferrer">Andriamilanto et al.</a>), lowered where
                Chrome has changed since, with the time zone and languages from
                <a href="https://amiunique.org/fingerprints-global-statistics" target="_blank" rel="noopener noreferrer">AmIUnique</a>'s worldwide statistics.
                APIs whose values overlap, such as the screen's and the window's sizes, also have what they <strong>add</strong> once another of
                them is known, from the same study: of those read together, the one with the most bits counts all of them, the others only
                what they add. <strong>Rarity</strong> is how rarely pages use it: 1 minus the share of page loads in Chrome that use it, from
                Chrome's usage statistics (<a href="https://chromestatus.com/metrics/feature/popularity" target="_blank" rel="noopener noreferrer">chromestatus.com</a>,
                October 2026). The user agent, read on 91% of page loads, has 0.09; reading audio samples, on 7%, has 0.93. They make two
                independent signals: "Identifying information" adds up the bits of the different fingerprinting APIs read,
                how much they reveal; "Unusual fingerprinting APIs" adds up their rarity, rare ones counting more (see below), as reading rare ones shows
                intent even when they reveal little. Fingerprinting APIs that reveal the same value, such as the WebGL and WebGL2 versions
                of a call or a canvas exported in two formats, count once.
            </p>

            <div class="row">
                <div>
                    <div class="name">Rare APIs count more</div>
                    <div class="description">
                        Each API counts its rarity to this power in the unusual fingerprinting APIs signals. 1 counts rarity as it is;
                        at 4, rarity 0.6 counts 0.13 and 0.93 counts 0.75, so everyday reads add up to little.
                    </div>
                </div>
                <label class="field">
                    rarity ^
                    <input type="number" min="0" step="0.25" value={settings.rarityPower} oninput={setRarityPower} />
                </label>
                <span class="default" class:changed={settings.rarityPower !== DEFAULT_SETTINGS.rarityPower}>default {DEFAULT_SETTINGS.rarityPower}</span>
            </div>

            {#each APIS_LEVELS as level (level)}
                {@const fullAt = settings.fullAt[level]}
                {@const defaults = DEFAULT_SETTINGS.fullAt[level]}
                <div class="row cutoffs">
                    <div class="name">{APIS_LEVEL_LABELS[level]}</div>
                    <label class="field" class:changed={fullAt.identifying !== defaults.identifying} title="Default {defaults.identifying}">
                        Identifying full at
                        <input type="number" min="0" step="1" value={fullAt.identifying} oninput={(e) => setFullAt(level, 'identifying', e)} />
                        bits
                    </label>
                    <label class="field" class:changed={fullAt.unusual !== defaults.unusual} title="Default {defaults.unusual}">
                        Unusual full at
                        <input type="number" min="0" step="0.5" value={fullAt.unusual} oninput={(e) => setFullAt(level, 'unusual', e)} />
                    </label>
                </div>
            {/each}

            {#each API_GROUPS as [category, apis] (category)}
                <h3>{FP_CATEGORIES[category].name} <span class="category-key">{category}</span></h3>
                {#each apis as api (api.id)}
                    {@const defaults = DEFAULT_SETTINGS.apis[api.id] ?? { bits: api.bits, adds: api.bits, rarity: api.rarity }}
                    {@const traits = settings.apis[api.id] ?? defaults}
                    <div class="row api">
                        <div class="api-id">{api.id}</div>
                        <label class="field" class:changed={traits.bits !== defaults.bits} title="Default {defaults.bits}">
                            bits
                            <input type="number" min="0" step="0.1" value={traits.bits} oninput={(e) => setApiTrait(api.id, 'bits', e)} />
                        </label>
                        <!-- Only APIs overlapping with others have what they add beside them. -->
                        {#if api.overlap}
                            <label class="field" class:changed={traits.adds !== defaults.adds} title="Default {defaults.adds}: what it adds beside the other {api.overlap.group} APIs">
                                adds
                                <input type="number" min="0" step="0.1" value={traits.adds} oninput={(e) => setApiTrait(api.id, 'adds', e)} />
                            </label>
                        {:else}
                            <span></span>
                        {/if}
                        <label class="field" class:changed={traits.rarity !== defaults.rarity} title="Default {defaults.rarity}">
                            rarity
                            <input type="number" min="0" max="1" step="0.05" value={traits.rarity} oninput={(e) => setApiTrait(api.id, 'rarity', e)} />
                        </label>
                    </div>
                {/each}
            {/each}
        </section>
    {/if}
</main>

<style>
    main {
        max-width: 760px;
        margin: 0 auto;
        padding: 24px 20px 48px;
    }

    header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
    }

    h1 {
        margin: 0;
        font-size: 20px;
    }

    h2 {
        margin: 0 0 4px;
        font-size: 15px;
    }

    header button {
        padding: 6px 12px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--surface);
        cursor: pointer;
    }

    header button:hover {
        border-color: var(--muted);
    }

    .intro {
        margin: 12px 0 0;
        color: var(--muted);
        line-height: 1.5;
    }

    .intro strong {
        color: var(--text);
        font-weight: 600;
    }

    .status {
        min-height: 18px;
        margin: 8px 0 0;
        color: var(--unlikely);
        font-size: 12px;
    }

    /* Sections are cards: no border, room inside, squircle corners (the .squircle class). */
    section {
        margin-top: 24px;
        padding: 20px 24px;
        border-radius: 18px;
        background: var(--surface);
    }

    /* The section a "made from" link jumped to. */
    section:target {
        border-color: var(--muted);
    }

    /* Room above a section a link jumped to, so it doesn't stick to the window's edge. */
    section {
        scroll-margin-top: 16px;
    }

    .section-note {
        margin: 0 0 6px;
        color: var(--muted);
        font-size: 12px;
    }

    /* Sources of the default values. */
    .section-note a {
        color: var(--info);
        text-underline-offset: 2px;
    }

    /* Room for the widest unit ("APIs"), so the fields line up whatever their unit. */
    .unit {
        width: 3ch;
    }

    .row.cutoffs + .row.cutoffs {
        margin-top: 4px;
    }

    h3 {
        margin: 24px 0 4px;
        font-size: 13px;
    }

    .category-key {
        margin-left: 6px;
        color: var(--muted);
        font-family: var(--mono);
        font-size: 12px;
        font-weight: 400;
    }

    /* APIs are listed compactly: one line each, with bits, what they add and rarity. */
    .row.api {
        grid-template-columns: 1fr auto auto auto;
        padding: 6px 0;
    }

    .api-id {
        font-family: var(--mono);
        font-size: 12px;
    }

    .warning {
        margin: 6px 0 0;
        color: var(--possible);
        font-size: 12px;
    }
</style>
