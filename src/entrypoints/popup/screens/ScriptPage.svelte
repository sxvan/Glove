<script lang="ts">
    // A script's page, or the page's as a whole: its card's head, then a section per info line of
    // its card, in the same words, with the details behind it. Opens at the section of the line
    // whose "Details" was clicked.
    import { onMount, tick } from 'svelte';
    import ApiTable from '../components/ApiTable.svelte';
    import FingerprintCard from '../components/FingerprintCard.svelte';
    import SignalLine from '../components/SignalLine.svelte';
    import type { ScriptDetail } from '../model';
    import { statements } from '../statements';

    let { script, section }: { script: ScriptDetail; section: string } = $props();

    const sectionId = (key: string) => `section-${key}`;

    onMount(async () => {
        await tick();
        document.getElementById(sectionId(section))?.scrollIntoView({ block: 'start' });
    });
</script>

<FingerprintCard {script} headOnly />

{#each statements(script) as statement (statement.key)}
    <section class="card section" id={sectionId(statement.key)}>
        <ul class="heading">
            <SignalLine text={statement.text} tone="info" detail={statement.detail} lead />
        </ul>
        {#if statement.key === 'read'}
            <ApiTable apis={script.apiDetails} />
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
        margin: 0;
        padding: 0;
        list-style: none;
    }
</style>
