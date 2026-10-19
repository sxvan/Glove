<script lang="ts">
    // A script's page, or the page's as a whole: its card's head, then a section per info line of
    // its card, in the same words, with the details behind it. Opens at the section of the line
    // whose "Details" was clicked.
    import { onMount, tick } from 'svelte';
    import ApiTable from '../components/ApiTable.svelte';
    import FingerprintCard from '../components/FingerprintCard.svelte';
    import SentList from '../components/SentList.svelte';
    import SignalLine from '../components/SignalLine.svelte';
    import StoredList from '../components/StoredList.svelte';
    import type { ScriptDetail } from '../model';
    import { bySection, sectionOf, statements } from '../statements';

    let { script, section }: { script: ScriptDetail; section: string } = $props();

    // Statements about the same are in one section, each under its own line (see sectionOf).
    const sectionId = (key: string) => `section-${sectionOf(key)}`;
    const sections = $derived(bySection(statements(script)));

    onMount(async () => {
        await tick();
        document.getElementById(sectionId(section))?.scrollIntoView({ block: 'start' });
    });
</script>

<FingerprintCard {script} headOnly />

{#each sections as lines (lines[0]!.key)}
    {@const key = lines[0]!.key}
    <section class="card section" id={sectionId(key)}>
        <ul class="heading">
            {#each lines as statement (statement.key)}
                <SignalLine text={statement.text} tone="info" detail={statement.detail} explanation={statement.explanation} lead />
            {/each}
        </ul>
        {#if key === 'read'}
            <ApiTable apis={script.apiDetails} />
        {:else if key === 'stored'}
            <StoredList items={script.stored} />
        {:else if key === 'sent'}
            <SentList requests={script.sent} />
        {/if}
    </section>
{/each}

<style>
    .section {
        display: grid;
        gap: 20px;
        /* Room for the back button above when jumped to. */
        scroll-margin-top: 16px;
    }

    .heading {
        display: grid;
        gap: 6px;
        margin: 0;
        padding: 0;
        list-style: none;
    }
</style>
