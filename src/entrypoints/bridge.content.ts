import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import type { FpMonkeyEvent, HttpMonkeyEvent, StorageMonkeyEvent } from '@/types/events';
import type { RecorderMessage } from '@/types/messages';

// Runs in the isolated world and forwards events dispatched by the main-world recorders
// (fp-recorder, http-recorder) to the background.
// Registered by the background, which leaves out the sites the extension is off for (see lib/recorders).
export default defineContentScript({
    registration: 'runtime',
    matches: ['<all_urls>'],
    runAt: 'document_start',
    allFrames: true,
    matchAboutBlank: true,
    matchOriginAsFallback: true,
    noScriptStartedPostMessage: true,

    main() {
        // Removes the listeners once the extension is gone (reloaded, updated or removed): this
        // script can't reach it anymore, and the page is recorded again only after a reload.
        const listening = new AbortController();

        function send(message: RecorderMessage) {
            // runtime.id is undefined once the extension context is invalidated.
            if (!browser.runtime?.id) {
                listening.abort();
                return;
            }
            try {
                // Rejects while the background isn't ready, e.g. as the extension is reloaded.
                browser.runtime.sendMessage(message).catch(() => {});
            } catch {
                // Throws "Extension context invalidated" when the extension went away meanwhile.
                listening.abort();
            }
        }

        document.documentElement.addEventListener(
            'fp-monkey',
            (event) => {
                const { detail } = event as CustomEvent<FpMonkeyEvent[]>;
                if (Array.isArray(detail) && detail.length > 0) send({ type: 'fp-batch', payload: detail });
            },
            { signal: listening.signal }
        );

        document.documentElement.addEventListener(
            'storage-monkey',
            (event) => {
                const { detail } = event as CustomEvent<StorageMonkeyEvent[]>;
                if (Array.isArray(detail) && detail.length > 0) send({ type: 'storage-batch', payload: detail });
            },
            { signal: listening.signal }
        );

        document.documentElement.addEventListener(
            'http-monkey',
            (event) => {
                const { detail } = event as CustomEvent<HttpMonkeyEvent>;
                if (detail) send({ type: 'http', payload: detail });
            },
            { signal: listening.signal }
        );
    },
});
