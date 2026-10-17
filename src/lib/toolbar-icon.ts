// The toolbar icon of a tab as its page's fingerprinting score: a ring like the popup's, filled by
// the score and in the likelihood's color, so it can be seen without opening the popup. Tabs without
// a recording keep the extension's own icon.
import { browser } from 'wxt/browser';
import type { Cutoffs } from './scoring';

// The likelihood colors of the popup (see theme.css).
const COLORS = { unlikely: '#1a8f4c', possible: '#c96512', likely: '#d12f2f' };
// The empty part of the ring: grey with some transparency, readable on light and dark toolbars.
const TRACK: [number, number, number, number] = [128, 128, 128, 115];
// Toolbar icons are 16 pixels, 32 on high-resolution screens.
const SIZES = [16, 32];

/** What each tab's icon shows, so an unchanged score isn't set again on every analysis. */
const shown = new Map<number, string>();
// Each ring drawn once and kept, by size, color and score: only the few that occur get drawn.
const drawn = new Map<string, ImageData>();

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

    const imageData = Object.fromEntries(SIZES.map((size) => [size, ring(size, percent, COLORS[likelihood])]));
    // Fails for a tab closed meanwhile.
    browser.action.setIcon({ tabId, imageData }).catch(() => shown.delete(tabId));
}

/** The ring for `percent` at `size` pixels, drawn the first time it's needed. */
function ring(size: number, percent: number, color: string): ImageData {
    const key = `${size}|${color}|${percent}`;
    let image = drawn.get(key);
    if (!image) {
        image = drawRing(size, percent / 100, color);
        drawn.set(key, image);
    }
    return image;
}

/**
 * The ring at `size` pixels, filled clockwise from the top for `fraction` of it. Computed pixel by
 * pixel rather than on a canvas: the first canvas in the background sets up Chrome's drawing, which
 * took 30 to 270 ms per start, against well under a millisecond for these few pixels.
 */
function drawRing(size: number, fraction: number, color: string): ImageData {
    const image = new ImageData(size, size);
    const width = size * 0.17;
    const outer = size / 2 - size * 0.03;
    const inner = outer - width;
    const center = size / 2;
    const filled = parseColor(color);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = x + 0.5 - center;
            const dy = y + 0.5 - center;
            const distance = Math.hypot(dx, dy);
            // How much of the pixel lies in the ring: a soft edge one pixel wide, against jagged lines.
            const coverage = Math.min(1, Math.max(0, Math.min(distance - inner, outer - distance) + 0.5));
            if (coverage === 0) continue;
            // The pixel's place around the ring, from 0 at the top clockwise to 1.
            const turn = (Math.atan2(dx, -dy) / (Math.PI * 2) + 1) % 1;
            const [r, g, b, a] = turn < fraction ? filled : TRACK;
            const at = (y * size + x) * 4;
            image.data[at] = r;
            image.data[at + 1] = g;
            image.data[at + 2] = b;
            image.data[at + 3] = Math.round(a * coverage);
        }
    }
    return image;
}

/** "#d12f2f" as red, green, blue and alpha (0 to 255). */
function parseColor(hex: string): [number, number, number, number] {
    const value = parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
}
