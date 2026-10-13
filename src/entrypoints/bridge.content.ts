import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import type { FpMonkeyEvent, HttpMonkeyEvent } from '@/types/events';
import type { RecorderMessage } from '@/types/messages';

// Runs in the isolated world and forwards events dispatched by the main-world recorders
// (fp-recorder, http-recorder) to the background.
export default defineContentScript({
    matches: ['<all_urls>'],
    runAt: 'document_start',
    allFrames: true,
    matchAboutBlank: true,
    matchOriginAsFallback: true,
    noScriptStartedPostMessage: true,

    main() {
        document.documentElement.addEventListener('fp-monkey', (event) => {
            const { detail } = event as CustomEvent<FpMonkeyEvent[]>;
            if (Array.isArray(detail) && detail.length > 0) {
                const message: RecorderMessage = { type: 'fp-batch', payload: detail };
                browser.runtime.sendMessage(message);
            }
        });

        document.documentElement.addEventListener('http-monkey', (event) => {
            const { detail } = event as CustomEvent<HttpMonkeyEvent>;
            if (detail) {
                const message: RecorderMessage = { type: 'http', payload: detail };
                browser.runtime.sendMessage(message);
            }
        });
    },
});
