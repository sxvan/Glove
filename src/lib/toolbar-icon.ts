// The toolbar icon of a tab as its page's fingerprinting score: a ring like the popup's, filled by
// the score and in the likelihood's color, so it can be seen without opening the popup. Tabs without
// a recording keep the extension's own icon.
import { browser } from 'wxt/browser';
import type { Cutoffs } from './scoring';

// The likelihood colors of the popup (see theme.css).
const COLORS = { unlikely: '#1a8f4c', possible: '#c96512', likely: '#d12f2f' };
// The empty part of the ring: grey with some transparency, readable on light and dark toolbars.
const TRACK = 'rgba(128, 128, 128, 0.45)';
// Toolbar icons are 16 pixels, 32 on high-resolution screens.
const SIZES = [16, 32];

/** What each tab's icon shows, so an unchanged score isn't drawn again on every analysis. */
const shown = new Map<number, string>();

/**
 * Shows `score` (0 to 1) for the page in tab `tabId`. `pageId` is its top document's id: a new page
 * draws its icon again, as Chrome may have reset it on navigating.
 */
export function showScoreIcon(tabId: number, pageId: string, score: number, cutoffs: Cutoffs) {
    const likelihood = score >= cutoffs.likely ? 'likely' : score >= cutoffs.possible ? 'possible' : 'unlikely';
    const percent = Math.round(score * 100);
    const key = `${pageId}|${likelihood}|${percent}`;
    if (shown.get(tabId) === key) return;
    shown.set(tabId, key);

    const imageData = Object.fromEntries(SIZES.map((size) => [size, drawRing(size, percent / 100, COLORS[likelihood])]));
    // Fails for a tab closed meanwhile.
    browser.action.setIcon({ tabId, imageData }).catch(() => shown.delete(tabId));
}

/** The ring at `size` pixels, filled clockwise from the top for `fraction` of it. */
function drawRing(size: number, fraction: number, color: string): ImageData {
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext('2d')!;
    const width = size * 0.17;
    const radius = size / 2 - width / 2 - size * 0.03;
    const center = size / 2;
    context.lineWidth = width;

    context.strokeStyle = TRACK;
    context.beginPath();
    context.arc(center, center, radius, 0, Math.PI * 2);
    context.stroke();

    if (fraction > 0) {
        context.strokeStyle = color;
        context.beginPath();
        context.arc(center, center, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, fraction));
        context.stroke();
    }
    return context.getImageData(0, 0, size, size);
}
