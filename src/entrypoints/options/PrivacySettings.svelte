<script lang="ts">
    // What the extension may contact on the user's behalf (see lib/privacy), saved as soon as switched.
    import { onMount } from 'svelte';
    import { DEFAULT_PRIVACY, loadPrivacy, savePrivacy, watchPrivacy, type PrivacyOptions } from '@/lib/privacy';
    import Switch from '@/ui/components/Switch.svelte';
    import SectionHead from './SectionHead.svelte';

    const SWITCHES: { key: keyof PrivacyOptions; label: string; description: string }[] = [
        {
            key: 'dnsLookups',
            label: 'DNS lookups',
            description:
                "To find CNAME cloaking, another company's tracker behind an address of the site, the page's own subdomains are looked up at Quad9 (dns.quad9.net), a non-profit DNS resolver that doesn't store IP addresses, but learns the names asked. Off, nothing is looked up, and cloaking isn't detected or scored.",
        },
        {
            key: 'askBeforeDownload',
            label: 'Ask before downloading a script',
            description:
                "The script viewer shows a script by downloading it again from its server, without your cookies, but the server sees the request coming from your IP address. On, the viewer asks first; off, it downloads right away.",
        },
    ];

    let options = $state<PrivacyOptions>({ ...DEFAULT_PRIVACY });

    // Also follows a reset of all settings (see App), and the viewer's "Don't ask again".
    onMount(() => {
        loadPrivacy().then((loaded) => (options = loaded));
        return watchPrivacy((changed) => (options = changed));
    });

    const reset = () => savePrivacy({ ...DEFAULT_PRIVACY });

    function setSwitch(key: keyof PrivacyOptions, on: boolean) {
        options[key] = on;
        savePrivacy($state.snapshot(options));
    }

    const sectionChanged = $derived(SWITCHES.some(({ key }) => options[key] !== DEFAULT_PRIVACY[key]));

    // Whether the section differs from its defaults, for the page's "Reset all" (see App).
    let { changed = $bindable(false) }: { changed?: boolean } = $props();
    $effect(() => {
        changed = sectionChanged;
    });
</script>

<SectionHead title="Privacy" changed={sectionChanged} onreset={reset} />

{#each SWITCHES as { key, label, description } (key)}
    <label class="row">
        <div>
            <div class="name">{label}</div>
            <div class="description">{description}</div>
        </div>
        <Switch checked={options[key]} onchange={(on) => setSwitch(key, on)} />
        <span class="default" class:changed={options[key] !== DEFAULT_PRIVACY[key]}>default {DEFAULT_PRIVACY[key] ? 'on' : 'off'}</span>
    </label>
{/each}
