<script lang="ts">
    import { APIS_LEVEL_LABELS, DEFAULT_SETTINGS, type ApisFullAt, type ApisLevel, type ApiTraits, type ScoringSettings } from '@/lib/scoring';
    import { FP_APIS, FP_CATEGORIES, type FpApi, type FpCategory } from '@/lib/fp-apis';
    import { differs, positiveFromInput, resetPart, unitFromInput } from './inputs';
    import SectionHead from './SectionHead.svelte';

    let { settings = $bindable(), onchange }: { settings: ScoringSettings; onchange: () => void } = $props();

    const APIS_LEVELS: ApisLevel[] = ['page', 'script', 'pageBurst', 'burst'];
    const API_GROUPS = Object.entries(Object.groupBy(FP_APIS, (api) => api.category)) as [FpCategory, FpApi[]][];

    function setRarityPower(event: Event) {
        const value = positiveFromInput(event);
        if (value === null) return;
        settings.rarityPower = value;
        onchange();
    }

    function setFullAt(level: ApisLevel, which: keyof ApisFullAt, event: Event) {
        const value = positiveFromInput(event);
        if (value === null) return;
        settings.fullAt[level][which] = value;
        onchange();
    }

    function setApiTrait(id: string, trait: keyof ApiTraits, event: Event) {
        // Bits have no upper end; rarity goes from 0 to 1.
        const value = trait === 'rarity' ? unitFromInput(event) : positiveFromInput(event);
        if (value === null) return;
        settings.apis[id] = { ...settings.apis[id]!, [trait]: value };
        onchange();
    }

    function reset() {
        resetPart(settings, 'apis');
        resetPart(settings, 'rarityPower');
        resetPart(settings, 'fullAt');
        onchange();
    }

    const changed = $derived(
        differs(settings.apis, DEFAULT_SETTINGS.apis) || settings.rarityPower !== DEFAULT_SETTINGS.rarityPower || differs(settings.fullAt, DEFAULT_SETTINGS.fullAt)
    );
</script>

<section class="squircle" id="apis">
    <SectionHead title="Fingerprinting APIs" {changed} onreset={reset} />
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
        October 2026). The user agent, read on 91% of page loads, has 0.09; reading audio samples, on 7%, has 0.93. Together they make
        "Rare identifying fingerprinting APIs": each API's bits times its rarity, rare ones counting more (see below), added up. What
        reveals a lot but everyone reads counts little, and so does what is rarely read but reveals little; what a fingerprinter
        collects is both. Fingerprinting APIs that reveal the same value, such as the WebGL and WebGL2 versions of a call or a canvas
        exported in two formats, count once.
    </p>

    <div class="row">
        <div>
            <div class="name">Rare APIs count more</div>
            <div class="description">
                Each API's bits count times its rarity to this power. 1 counts rarity as it is; at 4, rarity 0.6 counts 0.13
                and 0.93 counts 0.75, so everyday reads add up to little.
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
            <label class="field" class:changed={fullAt.rareIdentifying !== defaults.rareIdentifying} title="Default {defaults.rareIdentifying}">
                Rare identifying full at
                <input type="number" min="0" step="1" value={fullAt.rareIdentifying} oninput={(e) => setFullAt(level, 'rareIdentifying', e)} />
                bits
            </label>
        </div>
    {/each}

    <div class="apis">
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
                    {#if api.overlap}
                        <label class="field" class:changed={traits.adds !== defaults.adds} title="Default {defaults.adds}: what it adds beside the other {api.overlap.group} APIs">
                            adds
                            <input type="number" min="0" step="0.1" value={traits.adds} oninput={(e) => setApiTrait(api.id, 'adds', e)} />
                        </label>
                    {:else}
                        <span></span>
                    {/if}
                    <span class="counts" title="Its bits times its rarity to the power {settings.rarityPower}: the rare bits it counts when read alone">
                        {+(traits.bits * traits.rarity ** settings.rarityPower).toFixed(2)} rare bits
                    </span>
                    <label class="field" class:changed={traits.rarity !== defaults.rarity} title="Default {defaults.rarity}">
                        rarity
                        <input type="number" min="0" max="1" step="0.05" value={traits.rarity} oninput={(e) => setApiTrait(api.id, 'rarity', e)} />
                    </label>
                </div>
            {/each}
        {/each}
    </div>
</section>

<style>
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

    /* Shared columns, so the numbers line up also where an API has no "adds" (an empty cell). */
    .apis {
        display: grid;
        grid-template-columns: minmax(0, 1fr) repeat(4, auto);
        column-gap: 16px;
    }

    .apis > * {
        grid-column: 1 / -1;
    }

    .row.api {
        padding: 6px 0;
    }

    .counts {
        color: var(--muted);
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        text-align: right;
    }

    .api-id {
        font-family: var(--mono);
        font-size: 12px;
    }
</style>
