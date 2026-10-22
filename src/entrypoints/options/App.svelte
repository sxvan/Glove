<script lang="ts">
    import { onMount, tick } from 'svelte';
    import { DEFAULT_SETTINGS, loadScoringSettings, resetScoringSettings, saveScoringSettings, type ScoringSettings } from '@/lib/scoring';
    import { DEFAULT_BLOCKING_OPTIONS, saveBlockingOptions } from '@/lib/blocking';
    import { DEFAULT_LIMITS, saveLimits } from '@/lib/limits';
    import { DEFAULT_PRIVACY, savePrivacy } from '@/lib/privacy';
    import { setTheme, storedTheme, type Theme } from '@/lib/theme';
    import { differs } from './inputs';
    import ApiSettings from './ApiSettings.svelte';
    import BlockingSettings from './BlockingSettings.svelte';
    import DetectionSettings from './DetectionSettings.svelte';
    import PerformanceSettings from './PerformanceSettings.svelte';
    import PrivacySettings from './PrivacySettings.svelte';
    import SectionHead from './SectionHead.svelte';
    import SignalSettings from './SignalSettings.svelte';
    import SitesSettings from './SitesSettings.svelte';
    import ThemeSwitch from './ThemeSwitch.svelte';

    // Saves after typing pauses, so every keystroke doesn't re-score all open pages.
    const SAVE_DELAY_MS = 400;

    let settings = $state<ScoringSettings | null>(null);
    let status = $state('');
    let saveTimer: ReturnType<typeof setTimeout> | undefined;

    type PageId = 'general' | 'blocking' | 'detection' | 'scoring' | 'apis';
    const PAGES: { id: PageId; title: string }[] = [
        { id: 'general', title: 'General' },
        { id: 'blocking', title: 'Blocking' },
        { id: 'detection', title: 'Detection' },
        { id: 'scoring', title: 'Scoring' },
        { id: 'apis', title: 'Fingerprinting APIs' },
    ];

    // Every page stays in the document, so each section keeps reporting `changed` (see anyChanged).
    let page = $state<PageId>('general');

    async function follow() {
        const id = decodeURIComponent(location.hash.slice(1));
        const named = PAGES.find((p) => p.id === id);
        const section = named ? null : document.getElementById(id);
        page = named?.id ?? (section?.closest<HTMLElement>('[data-page]')?.dataset.page as PageId | undefined) ?? 'general';
        await tick();
        if (section) section.scrollIntoView();
        else window.scrollTo(0, 0);
    }

    onMount(() => {
        window.addEventListener('hashchange', follow);
        return () => window.removeEventListener('hashchange', follow);
    });

    // A hash may name a section of the scoring settings, which only exist once loaded.
    onMount(async () => {
        settings = await loadScoringSettings();
        await tick();
        follow();
    });

    function scheduleSave() {
        status = '';
        clearTimeout(saveTimer);
        saveTimer = setTimeout(async () => {
            await saveScoringSettings($state.snapshot(settings!));
            status = 'Saved. Open pages are scored again.';
        }, SAVE_DELAY_MS);
    }

    let theme = $state<Theme>(storedTheme());
    function resetTheme() {
        theme = 'system';
        setTheme('system');
    }

    // Not the lists (blocked scripts, exempt scripts, sites turned off): those are the user's choices.
    async function reset() {
        if (!confirm('Set all settings back to their defaults? Blocked scripts and the sites the extension is off for stay as they are.')) return;
        clearTimeout(saveTimer);
        await Promise.all([resetScoringSettings(), savePrivacy({ ...DEFAULT_PRIVACY }), saveBlockingOptions({ ...DEFAULT_BLOCKING_OPTIONS }), saveLimits({ ...DEFAULT_LIMITS })]);
        resetTheme();
        settings = await loadScoringSettings();
        status = 'All settings reset to their defaults.';
    }

    let privacyChanged = $state(false);
    let blockingChanged = $state(false);
    let limitsChanged = $state(false);
    const anyChanged = $derived(
        theme !== 'system' ||
            privacyChanged ||
            blockingChanged ||
            limitsChanged ||
            (settings !== null && (Object.keys(DEFAULT_SETTINGS) as (keyof ScoringSettings)[]).some((key) => differs(settings![key], DEFAULT_SETTINGS[key])))
    );
</script>

<div class="layout">
    <nav aria-label="Settings pages">
        <h1>Settings</h1>
        <ul>
            {#each PAGES as p (p.id)}
                <li><a href="#{p.id}" aria-current={page === p.id ? 'page' : undefined}>{p.title}</a></li>
            {/each}
        </ul>
        <button type="button" class="button reset-all" disabled={!anyChanged} title={anyChanged ? undefined : 'All settings are at their defaults'} onclick={reset}>
            Reset all to defaults
        </button>
        <p class="status" role="status">{status}</p>
    </nav>

    <main>
        <div class="page" data-page="general" hidden={page !== 'general'}>
            <section class="squircle">
                <SectionHead title="Appearance" changed={theme !== 'system'} onreset={resetTheme} />
                <div class="row">
                    <div>
                        <div class="name">Theme</div>
                        <div class="description">The extension's pages in light or dark, or as the system is set.</div>
                    </div>
                    <ThemeSwitch bind:theme />
                </div>
            </section>

            <section class="squircle">
                <PrivacySettings bind:changed={privacyChanged} />
            </section>

            <section class="squircle">
                <PerformanceSettings bind:changed={limitsChanged} />
            </section>
        </div>

        <div class="page" data-page="blocking" hidden={page !== 'blocking'}>
            <section class="squircle">
                <BlockingSettings bind:changed={blockingChanged} />
            </section>

            <section class="squircle">
                <SitesSettings />
            </section>
        </div>

        <div class="page" data-page="detection" hidden={page !== 'detection'}>
            {#if settings}<DetectionSettings bind:settings={() => settings!, (value) => (settings = value)} onchange={scheduleSave} />{/if}
        </div>

        <div class="page" data-page="scoring" hidden={page !== 'scoring'}>
            {#if settings}<SignalSettings bind:settings={() => settings!, (value) => (settings = value)} onchange={scheduleSave} />{/if}
        </div>

        <div class="page" data-page="apis" hidden={page !== 'apis'}>
            {#if settings}<ApiSettings bind:settings={() => settings!, (value) => (settings = value)} onchange={scheduleSave} />{/if}
        </div>
    </main>
</div>

<style>
    .layout {
        display: grid;
        grid-template-columns: auto minmax(0, 760px);
        justify-content: center;
        align-items: start;
        gap: 32px;
        --page-top: 24px;
        padding: var(--page-top) 20px 48px;
    }

    nav {
        position: sticky;
        top: var(--page-top);
        display: grid;
        gap: 16px;
    }

    h1 {
        margin: 0 12px;
        font-size: 20px;
    }

    nav ul {
        display: grid;
        gap: 2px;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    nav a {
        display: block;
        padding: 6px 12px;
        border-radius: 8px;
        color: var(--muted);
        text-decoration: none;
        white-space: nowrap;
    }

    nav a:hover {
        color: var(--text);
    }

    nav a[aria-current='page'] {
        background: var(--surface);
        color: var(--text);
        font-weight: 600;
    }

    @media (max-width: 760px) {
        .layout {
            grid-template-columns: minmax(0, 1fr);
            gap: 16px;
        }

        nav {
            position: static;
        }

        nav ul {
            display: flex;
            flex-wrap: wrap;
        }

        .reset-all {
            justify-self: start;
        }
    }

    .page {
        display: grid;
        gap: 24px;
    }

    .page[hidden] {
        display: none;
    }

    .reset-all {
        padding: 6px 12px;
        font-size: inherit;
    }

    /* Its length doesn't change the navigation's width. */
    .status {
        contain: inline-size;
        margin: 0 12px;
        color: var(--unlikely);
        font-size: 12px;
    }

</style>
