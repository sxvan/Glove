<script lang="ts">
    // The rows of the Blocking section: what happens right after blocking a script, and blocking
    // scripts automatically (see BlockingOptions), saved as soon as changed, laid out like the scoring
    // settings, each with its default; then the scripts blocked, to unblock them.
    import { onMount } from 'svelte';
    import {
        DEFAULT_BLOCKING_OPTIONS,
        loadBlocked,
        loadBlockingOptions,
        saveBlockingOptions,
        setBlocked,
        watchBlocked,
        type BlockedScript,
        type BlockingOptions,
    } from '@/lib/blocking';
    import MiddleTruncate from '../popup/components/MiddleTruncate.svelte';
    import { percent, percentFromInput } from './inputs';
    import Switch from './Switch.svelte';

    type SwitchKey = 'reload' | 'clearData' | 'autoBlock';

    const SWITCHES: { key: SwitchKey; label: string; description: string }[] = [
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
                "Block every script that reaches the score below, as the switch on its page does, with the page reloaded and its site's data cleared as set above. A script you let run again is never blocked automatically after that. Blocking can break sites.",
        },
    ];

    let options = $state<BlockingOptions>({ ...DEFAULT_BLOCKING_OPTIONS });

    // The blocked scripts, the latest first; the list shows once opened.
    let blocked = $state<BlockedScript[]>([]);
    let listOpen = $state(false);
    const sorted = $derived([...blocked].sort((a, b) => b.since - a.since));

    onMount(() => {
        loadBlockingOptions().then((loaded) => (options = loaded));
        loadBlocked().then((list) => (blocked = list));
        return watchBlocked((list) => (blocked = list));
    });

    /** Lets the scripts run again, as their switch would: they aren't blocked automatically after that. */
    function unblock(keys: string[]) {
        setBlocked(keys, false);
    }

    function unblockAll() {
        if (confirm(`Unblock all ${blocked.length} scripts? They load again on every site, and none of them is blocked automatically after that.`)) {
            unblock(blocked.map((script) => script.key));
        }
    }

    /** How and when it was blocked: "Automatically at score 91, 18 Oct 2026", "By hand, 18 Oct 2026". */
    function how(script: BlockedScript): string {
        const day = new Date(script.since).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
        return script.auto ? `Automatically at score ${Math.round(script.auto.score * 100)}, ${day}` : `By hand, ${day}`;
    }

    function setSwitch(key: SwitchKey, checked: boolean) {
        options[key] = checked;
        saveBlockingOptions($state.snapshot(options));
    }

    function setAutoBlockFrom(event: Event) {
        const value = percentFromInput(event);
        if (value === null) return;
        options.autoBlockFrom = value;
        saveBlockingOptions($state.snapshot(options));
    }

    const onOff = (on: boolean) => (on ? 'on' : 'off');
    const fromChanged = $derived(options.autoBlockFrom !== DEFAULT_BLOCKING_OPTIONS.autoBlockFrom);
</script>

{#each SWITCHES as { key, label, description } (key)}
    {@const changed = options[key] !== DEFAULT_BLOCKING_OPTIONS[key]}
    <label class="row">
        <div>
            <div class="name">{label}</div>
            <div class="description">{description}</div>
        </div>
        <Switch checked={options[key]} onchange={(checked) => setSwitch(key, checked)} />
        <span class="default" class:changed>default {onOff(DEFAULT_BLOCKING_OPTIONS[key])}</span>
    </label>
{/each}

<div class="row">
    <div>
        <div class="name">From score</div>
        <div class="description">Scripts scoring this much or more, from 0 to 100, are blocked automatically.</div>
    </div>
    <label class="field" class:changed={fromChanged}>
        <input type="number" min="0" max="100" step="1" value={percent(options.autoBlockFrom)} oninput={setAutoBlockFrom} />
    </label>
    <span class="default" class:changed={fromChanged}>default {percent(DEFAULT_BLOCKING_OPTIONS.autoBlockFrom)}</span>
</div>

<div class="row">
    <div>
        <div class="name">Blocked scripts <span class="count">{blocked.length}</span></div>
        <div class="description">Blocked on every site. Unblocked scripts load again from their next load.</div>
    </div>
    <div class="actions">
        {#if blocked.length > 0}
            <button type="button" aria-expanded={listOpen} onclick={() => (listOpen = !listOpen)}>{listOpen ? 'Hide' : 'Show'}</button>
            <button type="button" onclick={unblockAll}>Unblock all</button>
        {/if}
    </div>
</div>
{#if listOpen && blocked.length > 0}
    <ul class="blocked">
        {#each sorted as script (script.key)}
            {@const { host, pathname } = new URL(script.key)}
            <!-- Named like the popup's script cards: the path with its file name kept, then who serves it. -->
            <li>
                <div class="script" title={script.key}>
                    <div class="address"><MiddleTruncate text={pathname} path /></div>
                    <div class="description">{host} · {how(script)}</div>
                </div>
                <button type="button" onclick={() => unblock([script.key])}>Unblock</button>
            </li>
        {/each}
    </ul>
{/if}

<style>
    .count {
        margin-left: 4px;
        color: var(--muted);
        font-weight: 400;
    }

    /* Spans the input and default columns: two buttons are wider than one input. */
    .actions {
        display: flex;
        grid-column: 2 / 4;
        justify-content: flex-end;
        gap: 8px;
    }

    /* Like the page's other buttons (see the header's). */
    button {
        padding: 5px 10px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--surface);
        color: var(--text);
        font: inherit;
        font-size: 12px;
        cursor: pointer;
    }

    button:hover {
        border-color: var(--muted);
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

    /* The switch sits where the other settings have their input, at its end. */
    .row > :global(input[role='switch']) {
        justify-self: end;
    }
</style>
