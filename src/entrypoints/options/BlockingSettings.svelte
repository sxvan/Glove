<script lang="ts">
    import { onMount } from 'svelte';
    import {
        blockPattern,
        DEFAULT_BLOCKING_OPTIONS,
        editBlocked,
        loadAllowed,
        loadBlocked,
        loadBlockingOptions,
        loadExempt,
        removeExempt,
        saveBlockingOptions,
        setAllowed,
        setBlocked,
        watchAllowed,
        watchBlocked,
        watchBlockingOptions,
        watchExempt,
        type AllowedScript,
        type BlockedScript,
        type BlockingOptions,
    } from '@/lib/blocking';
    import MiddleTruncate from '@/ui/components/MiddleTruncate.svelte';
    import { day, plural } from '@/ui/format';
    import { percent, percentFromInput } from './inputs';
    import Switch from '@/ui/components/Switch.svelte';
    import SectionHead from './SectionHead.svelte';

    type SwitchKey = 'reload' | 'clearData' | 'autoBlock';

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

    let blocked = $state<BlockedScript[]>([]);
    let exempt = $state<string[]>([]);
    let allowed = $state<AllowedScript[]>([]);
    let allowedOpen = $state(false);
    let blockedOpen = $state(false);
    let exemptOpen = $state(false);

    interface Group {
        id: string;
        title: string;
        scripts: { key: string; detail: string }[];
        action: 'Unblock' | 'Remove';
        editable?: boolean;
        confirm: (count: string) => string;
        act: (keys: string[]) => void;
    }

    const unblocking = {
        action: 'Unblock' as const,
        editable: true,
        confirm: (count: string) => `Unblock the ${count}? They load again on every site, and none of them is blocked automatically after that.`,
        // They aren't blocked automatically after that.
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

    const allowedGroup = $derived<Group>({
        id: 'allowed',
        title: 'Allowed scripts',
        scripts: [...allowed].sort((a, b) => b.since - a.since).map((script) => ({ key: script.key, detail: day(script.since) })),
        action: 'Remove',
        confirm: (count: string) => `Remove the ${count}? Where a pattern covers them, they are blocked again.`,
        act: (keys: string[]) => setAllowed(keys, false),
    });

    onMount(() => {
        loadBlockingOptions().then((loaded) => (options = loaded));
        loadAllowed().then((list) => (allowed = list));
        const stopAllowed = watchAllowed((list) => (allowed = list));
        loadBlocked().then((list) => (blocked = list));
        loadExempt().then((keys) => (exempt = keys));
        const stopBlocked = watchBlocked((list) => (blocked = list));
        const stopExempt = watchExempt((keys) => (exempt = keys));
        // Also follows a reset of all settings (see App).
        const stopOptions = watchBlockingOptions((changed) => (options = changed));
        return () => {
            stopBlocked();
            stopExempt();
            stopAllowed();
            stopOptions();
        };
    });

    // A reset sets the options back, not the lists: those are the user's choices, with their own buttons.
    const optionsChanged = $derived((Object.keys(DEFAULT_BLOCKING_OPTIONS) as (keyof BlockingOptions)[]).some((key) => options[key] !== DEFAULT_BLOCKING_OPTIONS[key]));

    let { changed = $bindable(false) }: { changed?: boolean } = $props();
    $effect(() => {
        changed = optionsChanged;
    });
    const reset = () => saveBlockingOptions({ ...DEFAULT_BLOCKING_OPTIONS });

    // The address being edited, and what is typed for it.
    let editing = $state<string | null>(null);
    let draft = $state('');
    const draftKey = $derived(blockPattern(draft));

    function startEdit(key: string) {
        editing = key;
        draft = key;
    }

    async function saveEdit() {
        if (editing === null || draftKey === null) return;
        if (draftKey !== editing) await editBlocked(editing, draftKey);
        editing = null;
    }

    function editKey(event: KeyboardEvent) {
        if (event.key === 'Enter') saveEdit();
        else if (event.key === 'Escape') editing = null;
    }

    function actOnAll(group: Group) {
        const count = `${plural(group.scripts.length, 'script')} ${group.title.toLowerCase()}`;
        if (confirm(group.confirm(count))) group.act(group.scripts.map((script) => script.key));
    }

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
        <div class="description">
            Blocked on every site; unblocked scripts load again from their next load. Edit an address to put <code>*</code> where a site changes a
            part of it, such as a name it makes up for every visit.
        </div>
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

<div class="row">
    <div>
        <div class="name">Allowed scripts <span class="count">{allowed.length}</span></div>
        <div class="description">Run even where a pattern of the blocked scripts covers them, and are never blocked automatically.</div>
    </div>
    <div class="actions">
        {#if allowed.length > 0}
            <button type="button" class="button" aria-expanded={allowedOpen} onclick={() => (allowedOpen = !allowedOpen)}>{allowedOpen ? 'Hide' : 'Show'}</button>
            <button type="button" class="button" onclick={() => actOnAll(allowedGroup)}>Remove all</button>
        {/if}
    </div>
</div>
{#if allowedOpen && allowed.length > 0}
    {@render scripts(allowedGroup)}
{/if}

{#snippet scripts(group: Group)}
    <ul class="blocked">
        {#each group.scripts as script (script.key)}
            {@const { host, pathname } = new URL(script.key)}
            <li>
                {#if editing === script.key}
                    <div class="script">
                        <!-- svelte-ignore a11y_autofocus -->
                        <input class="pattern" type="text" spellcheck="false" aria-label="Address to block" bind:value={draft} onkeydown={editKey} autofocus />
                        <div class="description" class:invalid={draftKey === null}>
                            {draftKey === null ? 'An http or https address with a path, without ? or #' : '* stands for any characters'}
                        </div>
                    </div>
                    <div class="buttons">
                        <button type="button" class="button" onclick={() => (editing = null)}>Cancel</button>
                        <button type="button" class="button" disabled={draftKey === null} onclick={saveEdit}>Save</button>
                    </div>
                {:else}
                    <div class="script" title={script.key}>
                        <div class="address"><MiddleTruncate text={pathname} path /></div>
                        <div class="description">{[host, script.detail].filter(Boolean).join(' · ')}</div>
                    </div>
                    <div class="buttons">
                        {#if group.editable}<button type="button" class="button" onclick={() => startEdit(script.key)}>Edit</button>{/if}
                        <button type="button" class="button" onclick={() => group.act([script.key])}>{group.action}</button>
                    </div>
                {/if}
            </li>
        {/each}
    </ul>
{/snippet}

<style>
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

    .warning {
        margin-top: 6px;
        color: var(--likely);
        font-size: 12px;
        font-weight: 500;
    }

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

    .address {
        min-width: 0;
        font-family: var(--mono);
        font-size: 12px;
    }

    .buttons {
        display: flex;
        gap: 8px;
    }

    .pattern {
        box-sizing: border-box;
        width: 100%;
        padding: 5px 8px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--bg);
        color: var(--text);
        font-family: var(--mono);
        font-size: 12px;
    }

    .description.invalid {
        color: var(--possible);
    }
</style>
