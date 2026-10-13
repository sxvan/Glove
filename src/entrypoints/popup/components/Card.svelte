<script lang="ts">
    import type { Snippet } from 'svelte';
    import { DOT_COLORS, type DotState } from '../format';

    let {
        id,
        title,
        dot,
        badge,
        stats,
        children,
    }: {
        id: string;
        title: string;
        /** Unset until the first snapshot has been rendered. */
        dot: DotState | undefined;
        badge: string;
        stats: Snippet;
        children: Snippet;
    } = $props();
</script>

<details {id} class="card">
    <summary>
        <div class="cardHead" style="width:100%; margin:0;">
            <h3 style="margin:0;">
                <span class="dot" style:background={dot ? DOT_COLORS[dot] : undefined}></span> {title}
            </h3>

            <div style="display:flex; align-items:center; gap:8px;">
                <span class="badge">{badge}</span>
                <div class="chev" aria-hidden="true"></div>
            </div>
        </div>

        <div class="kv" style="margin-top:8px;">
            {@render stats()}
        </div>
    </summary>

    <div class="accBody">
        {@render children()}
    </div>
</details>
