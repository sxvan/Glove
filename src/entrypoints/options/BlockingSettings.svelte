<script lang="ts">
    // The rows of the Blocking section: what happens right after blocking a script, and blocking
    // scripts automatically (see BlockingOptions), saved as soon as changed, laid out like the scoring
    // settings, each with its default; then the scripts blocked, to unblock them.
    import { onMount } from 'svelte';
    import {
        DEFAULT_BLOCKING_OPTIONS,
        loadBlocked,
        loadBlockingOptions,
        loadExempt,
        removeExempt,
        saveBlockingOptions,
        setBlocked,
        watchBlocked,
        watchBlockingOptions,
        watchExempt,
        type BlockedScript,
        type BlockingOptions,
    } from '@/lib/blocking';
    import MiddleTruncate from '../popup/components/MiddleTruncate.svelte';
    import { day, plural } from '../popup/format';
    import { percent, percentFromInput } from './inputs';
    import Switch from '../popup/components/Switch.svelte';
    import SectionHead from './SectionHead.svelte';

    type SwitchKey = 'reload' | 'clearData' | 'autoBlock';

    // A switch still being tried out is marked so, with a warning under it and a question before it
    // is turned on.
    interface Experimental {
        warning: string;
        confirm: string;
    }

    const SWITCHES: { key: SwitchKey; label: string; description: string; experimental?: Experimental }[] = [
        {
            key: 'reload',
            label: 'Reload the page',
            description: 'After blocking a script or letting it run again, load the page again, so the change takes effect at once.',
        },
        {
            key: 'clearData',
            label: "Clear the site's data",
            description:
                "After blocking a script, clear the cookies and storage of the page's site, and of any frame's site the script ran in, then load the page again: the script's stored identifiers are gone too. This logs you out of the site. The page is left first, so none of its scripts can store again while the data is cleared.",
        },
        {
            key: 'autoBlock',
            label: 'Block scripts automatically',
            description:
                "Block every script that reaches the score below, as the switch on its page does, with the page reloaded and its site's data cleared as set above. A script you let run again is never blocked automatically after that.",
            experimental: {
                warning:
                    'This will break sites. Many sites need the scripts that fingerprint you, to sign in, to pay or to show the page at all, and they are blocked without you seeing which. When a site breaks, let its scripts run again on their page in the popup.',
                confirm:
                    'Turn on blocking scripts automatically? It is experimental and will break sites: scripts are blocked by their score alone, also those a site needs to work. When a site breaks, let its scripts run again in the popup.',
            },
        },
    ];

    let options = $state<BlockingOptions>({ ...DEFAULT_BLOCKING_OPTIONS });

    // The blocked scripts, the latest first, those blocked automatically apart from those blocked by
    // hand; and, with automatic blocking, the scripts the user let run again, which it leaves alone.
    // The lists show once opened. Each group has its action: unblocking, or letting a script be
    // blocked automatically again.
    let blocked = $state<BlockedScript[]>([]);
    let exempt = $state<string[]>([]);
    let blockedOpen = $state(false);
    let exemptOpen = $state(false);

    interface Group {
        id: string;
        title: string;
        scripts: { key: string; detail: string }[];
        action: 'Unblock' | 'Remove';
        /** Asked before acting on all of them. */
        confirm: (count: string) => string;
        act: (keys: string[]) => void;
    }

    const unblocking = {
        action: 'Unblock' as const,
        confirm: (count: string) => `Unblock the ${count}? They load again on every site, and none of them is blocked automatically after that.`,
        // As their switch would: they aren't blocked automatically after that.
        act: (keys: string[]) => setBlocked(keys, false),
    };

    const blockedGroups = $derived.by((): Group[] => {
        const sorted = [...blocked].sort((a, b) => b.since - a.since);
        const item = (script: BlockedScript) => ({ key: script.key, detail: how(script) });
        return [
            { id: 'auto', title: 'Blocked automatically', scripts: sorted.filter((script) => script.auto).map(item), ...unblocking },
            { id: 'hand', title: 'Blocked by hand', scripts: sorted.filter((script) => !script.auto).map(item), ...unblocking },
        ].filter((group) => group.scripts.length > 0);
    });

    const exemptGroup = $derived<Group>({
        id: 'exempt',
        title: 'Never blocked automatically',
        scripts: exempt.map((key) => ({ key, detail: '' })),
        action: 'Remove',
        confirm: (count: string) => `Remove the ${count}? They are blocked automatically again when they reach the score.`,
        act: (keys: string[]) => removeExempt(keys),
    });

    onMount(() => {
        loadBlockingOptions().then((loaded) => (options = loaded));
        loadBlocked().then((list) => (blocked = list));
        loadExempt().then((keys) => (exempt = keys));
        const stopBlocked = watchBlocked((list) => (blocked = list));
        const stopExempt = watchExempt((keys) => (exempt = keys));
        // Also follows a reset of all settings (see App).
        const stopOptions = watchBlockingOptions((changed) => (options = changed));
        return () => {
            stopBlocked();
            stopExempt();
            stopOptions();
        };
    });

    // A reset sets the options back, not the lists: those are the user's choices, with their own buttons.
    const optionsChanged = $derived((Object.keys(DEFAULT_BLOCKING_OPTIONS) as (keyof BlockingOptions)[]).some((key) => options[key] !== DEFAULT_BLOCKING_OPTIONS[key]));

    // Whether the section differs from its defaults, for the page's "Reset all" (see App).
    let { changed = $bindable(false) }: { changed?: boolean } = $props();
    $effect(() => {
        changed = optionsChanged;
    });
    const reset = () => saveBlockingOptions({ ...DEFAULT_BLOCKING_OPTIONS });

    function actOnAll(group: Group) {
        const count = `${plural(group.scripts.length, 'script')} ${group.title.toLowerCase()}`;
        if (confirm(group.confirm(count))) group.act(group.scripts.map((script) => script.key));
    }

    /** When it was blocked, and if automatically at which score: "At score 91, 18 Oct 2026", "18 Oct 2026". */
    function how(script: BlockedScript): string {
        return script.auto ? `At score ${Math.round(script.auto.score * 100)}, ${day(script.since)}` : day(script.since);
    }

    function setSwitch(key: SwitchKey, checked: boolean, experimental?: Experimental) {
        if (checked && experimental && !confirm(experimental.confirm)) return;
        options[key] = checked;
        saveBlockingOptions($state.snapshot(options));
    }

    // Saved once the field is left or Enter pressed, not as typed: on the way from 85 to 90, the field
    // reads 9, which would block nearly every script of a page analyzed meanwhile.
    function setAutoBlockFrom(event: Event) {
        const value = percentFromInput(event);
        if (value === null) return;
        options.autoBlockFrom = value;
        saveBlockingOptions($state.snapshot(options));
    }

    const onOff = (on: boolean) => (on ? 'on' : 'off');
    const fromChanged = $derived(options.autoBlockFrom !== DEFAULT_BLOCKING_OPTIONS.autoBlockFrom);
</script>

<SectionHead title="Blocking" changed={optionsChanged} onreset={reset} />

{#each SWITCHES as { key, label, description, experimental } (key)}
    {@const changed = options[key] !== DEFAULT_BLOCKING_OPTIONS[key]}
    <label class="row">
        <div>
            <div class="name">{label}{#if experimental}<span class="experimental">Experimental</span>{/if}</div>
            <div class="description">{description}</div>
            {#if experimental}<div class="warning">{experimental.warning}</div>{/if}
        </div>
        <Switch checked={options[key]} onchange={(checked) => setSwitch(key, checked, experimental)} />
        <span class="default" class:changed>default {onOff(DEFAULT_BLOCKING_OPTIONS[key])}</span>
    </label>
{/each}

<div class="row">
    <div>
        <div class="name">From score</div>
        <div class="description">Scripts scoring this much or more, from 0 to 100, are blocked automatically.</div>
    </div>
    <label class="field" class:changed={fromChanged}>
        <input type="number" min="0" max="100" step="1" value={percent(options.autoBlockFrom)} onchange={setAutoBlockFrom} />
    </label>
    <span class="default" class:changed={fromChanged}>default {percent(DEFAULT_BLOCKING_OPTIONS.autoBlockFrom)}</span>
</div>

<div class="row">
    <div>
        <div class="name">Never blocked automatically <span class="count">{exempt.length}</span></div>
        <div class="description">Scripts you let run again: blocking them automatically again would undo that. Remove one to let it be blocked automatically again.</div>
    </div>
    <div class="actions">
        {#if exempt.length > 0}
            <button type="button" class="button" aria-expanded={exemptOpen} onclick={() => (exemptOpen = !exemptOpen)}>{exemptOpen ? 'Hide' : 'Show'}</button>
            <button type="button" class="button" onclick={() => actOnAll(exemptGroup)}>Remove all</button>
        {/if}
    </div>
</div>
{#if exemptOpen && exempt.length > 0}
    {@render scripts(exemptGroup)}
{/if}

<div class="row">
    <div>
        <div class="name">Blocked scripts <span class="count">{blocked.length}</span></div>
        <div class="description">Blocked on every site; unblocked scripts load again from their next load.</div>
    </div>
    <div class="actions">
        {#if blocked.length > 0}
            <button type="button" class="button" aria-expanded={blockedOpen} onclick={() => (blockedOpen = !blockedOpen)}>{blockedOpen ? 'Hide' : 'Show'}</button>
        {/if}
    </div>
</div>
{#if blockedOpen}
    {#each blockedGroups as group (group.id)}
        <div class="group-head">
            <h3>{group.title} <span class="count">{group.scripts.length}</span></h3>
            <button type="button" class="button" onclick={() => actOnAll(group)}>{group.action} all</button>
        </div>
        {@render scripts(group)}
    {/each}
{/if}

<!-- A group's scripts, each with its action. -->
{#snippet scripts(group: Group)}
    <ul class="blocked">
        {#each group.scripts as script (script.key)}
            {@const { host, pathname } = new URL(script.key)}
            <!-- Named like the popup's script cards: the path with its file name kept, then who serves it. -->
            <li>
                <div class="script" title={script.key}>
                    <div class="address"><MiddleTruncate text={pathname} path /></div>
                    <div class="description">{[host, script.detail].filter(Boolean).join(' · ')}</div>
                </div>
                <button type="button" class="button" onclick={() => group.act([script.key])}>{group.action}</button>
            </li>
        {/each}
    </ul>
{/snippet}

<style>
    /* Marks a setting still being tried out: a small tag after its name, in the color of a warning. */
    .experimental {
        margin-left: 8px;
        padding: 1px 7px;
        border: 1px solid currentColor;
        border-radius: 999px;
        color: var(--likely);
        font-size: 11px;
        font-weight: 600;
        vertical-align: 1px;
    }

    /* What it does wrong, under the description: as clear as its name, in the warning's color. */
    .warning {
        margin-top: 6px;
        color: var(--likely);
        font-size: 12px;
        font-weight: 500;
    }

    /* A group's heading, with its button at the end. */
    .group-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-top: 12px;
        padding: 8px 0;
    }

    h3 {
        margin: 0;
        font-size: 13px;
    }

    .blocked {
        display: grid;
        gap: 2px;
        margin: 0 0 8px;
        padding: 0;
        list-style: none;
    }

    .blocked li {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 16px;
        padding: 8px 0;
        border-top: 1px solid var(--border);
    }

    .script {
        min-width: 0;
    }

    /* Its path, on one line; the tooltip has the whole address. */
    .address {
        min-width: 0;
        font-family: var(--mono);
        font-size: 12px;
    }
</style>
