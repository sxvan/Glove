<script lang="ts">
    // How many calls are kept (see lib/limits), laid out like the other settings, each with its
    // default; saved once a field is left, not as typed.
    import { onMount } from 'svelte';
    import { DEFAULT_LIMITS, LIMIT_FIELDS, loadLimits, saveLimits, type PerformanceLimits } from '@/lib/limits';
    import { positiveFromInput } from './inputs';

    let limits = $state<PerformanceLimits>({ ...DEFAULT_LIMITS });

    onMount(async () => {
        limits = await loadLimits();
    });

    function set(key: keyof PerformanceLimits, event: Event) {
        const value = positiveFromInput(event);
        if (value === null) return;
        limits[key] = Math.round(value);
        saveLimits($state.snapshot(limits));
    }

    const number = (value: number) => value.toLocaleString('en-US');
</script>

{#each LIMIT_FIELDS as field (field.key)}
    {@const changed = limits[field.key] !== DEFAULT_LIMITS[field.key]}
    <div class="row">
        <div>
            <div class="name">{field.label}</div>
            <div class="description">{field.description}</div>
        </div>
        <label class="field" class:changed>
            <input type="number" min="1" step="1" value={limits[field.key]} onchange={(e) => set(field.key, e)} />
            <span class="unit">calls</span>
        </label>
        <span class="default" class:changed>default {number(DEFAULT_LIMITS[field.key])}</span>
    </div>
{/each}
