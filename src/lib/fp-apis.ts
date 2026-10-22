export type FpApiOwner =
    | 'Navigator'
    | 'Screen'
    | 'Window'
    | 'Document'
    | 'HTMLCanvasElement'
    | 'CanvasRenderingContext2D'
    | 'OffscreenCanvas'
    | 'OffscreenCanvasRenderingContext2D'
    | 'WebGLRenderingContext'
    | 'WebGL2RenderingContext'
    | 'AudioContext'
    | 'OfflineAudioContext'
    | 'AudioBuffer'
    | 'MediaDevices'
    | 'RTCPeerConnection'
    | 'IntlDateTimeFormat'
    | 'NavigatorUAData'
    | 'GPU'
    | 'GPUAdapter'
    | 'SpeechSynthesis'
    | 'Keyboard'
    | 'StorageManager'
    | 'NetworkInformation'
    | 'Performance'
    | 'HTMLMediaElement'
    | 'MediaSource'
    | 'Date';

/** Kinds of details, by the information they reveal rather than the object they come from. */
export type FpCategory =
    | 'Browser'
    | 'Languages'
    | 'Hardware'
    | 'Plugins'
    | 'Automation'
    | 'ScreenSetup'
    | 'Cookies'
    | 'CanvasImage'
    | 'Fonts'
    | 'GraphicsCard'
    | 'Audio'
    | 'MediaDevices'
    | 'Network'
    | 'TimeZone'
    | 'Voices'
    | 'Keyboard'
    | 'Storage'
    | 'Battery'
    | 'Connection'
    | 'Codecs';

export const FP_CATEGORIES: Record<FpCategory, { name: string }> = {
    Browser: { name: 'browser details' },
    Languages: { name: 'languages' },
    Hardware: { name: 'hardware' },
    Plugins: { name: 'plugins' },
    Automation: { name: 'automation check' },
    ScreenSetup: { name: 'screen setup' },
    Cookies: { name: 'cookies' },
    CanvasImage: { name: 'canvas image' },
    Fonts: { name: 'fonts' },
    GraphicsCard: { name: 'graphics card' },
    Audio: { name: 'audio' },
    MediaDevices: { name: 'media devices' },
    Network: { name: 'network addresses' },
    TimeZone: { name: 'time zone' },
    Voices: { name: 'speech voices' },
    Keyboard: { name: 'keyboard layout' },
    Storage: { name: 'storage quota' },
    Battery: { name: 'battery' },
    Connection: { name: 'connection' },
    Codecs: { name: 'media codecs' },
};

export function fpCategoryName(category: string): string {
    return FP_CATEGORIES[category as FpCategory]?.name ?? category;
}

export type OverlapGroup = 'browser' | 'memory' | 'connection' | 'sizes' | 'fonts' | 'gpu' | 'timezone';

export interface FpApi {
    id: string;
    owner: FpApiOwner;
    prop: string;
    category: FpCategory;
    /** APIs revealing the same value share the same words. */
    reveals: string;
    /** Its entropy on its own, the average over browsers: 6 bits tell one browser in 64 apart. */
    bits: number;
    /** Measured on 4.1 million fingerprints unless said otherwise (see FP_APIS). */
    bitsBasis?: 'adjusted' | 'worldwide' | 'estimate';
    /**
     * For values overlapping with related ones, like the screen's and the window's sizes: the bits it
     * adds once another of the group is known (the study's conditional entropy).
     */
    overlap?: { group: OverlapGroup; adds: number };
    /** 1 − the share of page loads using it; below 1 even for the rarest, as ordinary code uses those too. */
    rarity: number;
    /** Chrome's use counter for it unless said otherwise (see FP_APIS). */
    rarityBasis?: 'related' | 'trackerRadar' | 'bound' | 'estimate';
    /** An API revealing the same value (e.g. webgl2.readPixels and webgl.readPixels): they count once. */
    same?: string;
    /** A particular read through another API, revealing much more than its usual use; recorded under this id. */
    readOf?: { api: string; read: SpecialRead };
}

/**
 * Particular reads, recognized by the recorder in the page:
 * - gpuName: getParameter with the graphics card's maker or model (WEBGL_debug_renderer_info)
 * - highEntropyValues: client hints asking for exact versions, the device model or architecture
 * - fontProbing: measuring text in many different fonts on one canvas, to find installed fonts
 * - hiddenCanvas: reading back the pixels of a canvas that isn't on the page
 */
export type SpecialRead = 'gpuName' | 'highEntropyValues' | 'fontProbing' | 'hiddenCanvas';

// The bits are Andriamilanto et al. 2021, 4.1 million fingerprints (arxiv.org/abs/2006.09511, Table 16): the normalized entropy times 21.98 bits, what
// an overlapping API adds its minimum normalized conditional entropy (MinNCE) the same way. Their
// users were French, and only a quarter of them used Chrome:
// - adjusted: lowered where Chrome has changed since (the reduced user agent, the fixed plugin list,
//   WebRTC's hidden local addresses, Do Not Track only on or off), or where the measured entropy
//   came from differences between browsers that the user agent already tells (codecs, WebGL context
//   attributes, webdriver: a fraction of a bit once another attribute is known);
// - worldwide: the time zone and languages, which vary by region, from AmIUnique's statistics
//   (amiunique.org/api/statistics/global, 5.6 million fingerprints, 2026-10-18): 3.5 to 3.7 bits for
//   the UTC offset, 2.2 for the primary language;
// - estimate: what the study didn't measure.
// The canvas counts like the study's canvas modelled on AmIUnique's (7.8 bits; its own elaborate
// one reached 9.2), the font measurements like its fallback font text. Rarity is 1 − the share of page loads
// that use the API, from Chrome's use counters (chromestatus.com/data/featurepopularity, 2026-10-16):
// innerWidth is read on 72% of page loads (0.28), deviceMemory on 43% (0.57), getChannelData on 7%
// (0.93). Where that rounds to 1, a third decimal keeps it: a counter shows a use is rare, never that
// nothing but fingerprinting uses it. An OffscreenCanvas, a canvas that is never on the page, has
// counters of its own: convertToBlob 0.29% (0.997), getImageData 2.3% (0.98), measureText 1.3%
// (0.99), the last two listed as obsolete but still counting; copyFromChannel, reading the audio
// samples like getChannelData, 0.28% (0.997); getUserMedia 0.22% (0.998), addIceCandidate 0.16%
// (0.998). Without a counter of its own:
// - related: a related feature's counter. The graphics card name needs WEBGL_debug_renderer_info,
//   which 28% of page loads get (0.72); getShaderPrecisionFormat in WebGL 2 from WebGL 1;
//   createDataChannel from creating an RTCPeerConnection (8%); resolvedOptions from creating a
//   DateTimeFormat (36%); mediasource.isTypeSupported from pages using Media Source (8%) plus the
//   third-party scripts checking it (0.9).
// - trackerRadar: DuckDuckGo's Tracker Radar (github.com/duckduckgo/tracker-radar, US crawl) counts
//   on how many sites third-party scripts read an API. Against APIs that have a counter, a site
//   stands for a share of page loads of about 2e-6 for APIs mostly third parties read
//   (getChannelData 1.8e-6, getImageData 2.1e-6, getHighEntropyValues and RTCPeerConnection 2.2e-6)
//   and 3e-6 to 5e-6 for those first-party code reads too (languages 3.2e-6, deviceMemory 3.7e-6,
//   canPlayType 4.7e-6): navigator.webdriver, read almost only by bot detection, on 118,868 sites
//   is about 26% (0.7); speech.getVoices on 22,793 about 6% (0.93); WebGL getContextAttributes on
//   35,507 about 10% (0.9), in WebGL 2 on 502 (0.99); webgl2.getParameter on 2,719 (0.97, first-
//   party 3D content aside); readPixels on about 2,000 (0.95, leaving room for first-party 3D
//   content: maps, games); getTimezoneOffset on 266,303, most of the web with date libraries on top
//   (0.1). (Chrome counts no use of navigator.webdriver: its IDL has no MeasureAs.)
// - bound: a particular read is at most as common as the API it uses. Hidden canvases are read
//   through toDataURL (14%), getImageData (8%) and toBlob (0.6%), most of those reads fingerprinting
//   (0.9, 0.95, and 0.994 from toBlob's 0.6%, which toBlob itself rounds to 0.99);
//   font probing through measureText (8%), most of which is laying out text (0.96); the graphics
//   card name in WebGL 2 through webgl2.getParameter (0.97, as rare as that); the WebGPU adapter's
//   info after requestAdapter (10%; 0.95).
// - estimate: the detailed client hints (Google Analytics asks for them by default, so about half
//   of the 64% asking for client hints at all) and document.referrer.
export const FP_APIS: FpApi[] = [
    { id: 'navigator.userAgent', owner: 'Navigator', prop: 'userAgent', category: 'Browser', reveals: 'browser and version', bits: 4.8, rarity: 0.09, overlap: { group: 'browser', adds: 1 }, bitsBasis: 'adjusted' },
    // Client hints: brands are everyday. The exact OS version, device model, architecture and full
    // browser version identify more, but analytics asks for them routinely too (Google Analytics does
    // by default), so they count only moderately.
    { id: 'uadata.getHighEntropyValues', owner: 'NavigatorUAData', prop: 'getHighEntropyValues', category: 'Browser', reveals: 'client hints', bits: 1.6, rarity: 0.38, overlap: { group: 'browser', adds: 0.3 }, bitsBasis: 'estimate' },
    { id: 'uadata.detailedHints', owner: 'NavigatorUAData', prop: 'getHighEntropyValues', category: 'Browser', reveals: 'exact OS version, device model and architecture', bits: 4, rarity: 0.5, readOf: { api: 'uadata.getHighEntropyValues', read: 'highEntropyValues' }, rarityBasis: 'estimate', overlap: { group: 'browser', adds: 2.5 }, bitsBasis: 'estimate' },
    { id: 'navigator.platform', owner: 'Navigator', prop: 'platform', category: 'Browser', reveals: 'operating system', bits: 1.5, rarity: 0.37, overlap: { group: 'browser', adds: 0 } },
    { id: 'navigator.language', owner: 'Navigator', prop: 'language', category: 'Languages', reveals: 'languages', bits: 2.2, rarity: 0.44, same: 'navigator.languages', bitsBasis: 'worldwide' },
    { id: 'navigator.languages', owner: 'Navigator', prop: 'languages', category: 'Languages', reveals: 'languages', bits: 2.6, rarity: 0.59, bitsBasis: 'worldwide' },
    { id: 'navigator.hardwareConcurrency', owner: 'Navigator', prop: 'hardwareConcurrency', category: 'Hardware', reveals: 'CPU cores', bits: 1.9, rarity: 0.62 },
    { id: 'navigator.deviceMemory', owner: 'Navigator', prop: 'deviceMemory', category: 'Hardware', reveals: 'memory', bits: 1.6, rarity: 0.57, overlap: { group: 'memory', adds: 0.3 }, bitsBasis: 'estimate' },
    // The JS heap's size limit, which depends on the device's memory and the browser's build; the
    // used size changes all the time. Chrome only, read by bot detection like reCAPTCHA too.
    { id: 'performance.memory', owner: 'Performance', prop: 'memory', category: 'Hardware', reveals: 'memory limits', bits: 1.8, rarity: 0.58, overlap: { group: 'memory', adds: 0.05 } },
    { id: 'navigator.maxTouchPoints', owner: 'Navigator', prop: 'maxTouchPoints', category: 'Hardware', reveals: 'touch support', bits: 2.2, rarity: 0.48 },
    { id: 'navigator.vendor', owner: 'Navigator', prop: 'vendor', category: 'Browser', reveals: 'browser vendor', bits: 1.4, rarity: 0.63, overlap: { group: 'browser', adds: 0 } },
    // Says almost nothing about the device (false in practically every real browser). Checking for
    // automation is what bot detection does, and that runs on a large part of the web: read on
    // about a quarter of page loads.
    { id: 'navigator.webdriver', owner: 'Navigator', prop: 'webdriver', category: 'Automation', reveals: 'automation flag', bits: 0.4, rarity: 0.7, bitsBasis: 'adjusted', rarityBasis: 'trackerRadar' },
    // The same fixed list in modern Chrome, so it tells little about the device, but it's read
    // almost only by fingerprinting.
    { id: 'navigator.plugins', owner: 'Navigator', prop: 'plugins', category: 'Plugins', reveals: 'plugins', bits: 0.8, rarity: 0.68, bitsBasis: 'adjusted' },
    { id: 'navigator.mimeTypes', owner: 'Navigator', prop: 'mimeTypes', category: 'Plugins', reveals: 'plugins', bits: 0.8, rarity: 0.86, same: 'navigator.plugins', bitsBasis: 'adjusted' },
    { id: 'navigator.pdfViewerEnabled', owner: 'Navigator', prop: 'pdfViewerEnabled', category: 'Plugins', reveals: 'PDF viewer', bits: 0.4, rarity: 0.92, bitsBasis: 'estimate' },
    // Settings almost every browser has the same way, but fingerprinters read them as a matter of course.
    { id: 'navigator.cookieEnabled', owner: 'Navigator', prop: 'cookieEnabled', category: 'Cookies', reveals: 'whether cookies are enabled', bits: 0, rarity: 0.56 },
    { id: 'navigator.doNotTrack', owner: 'Navigator', prop: 'doNotTrack', category: 'Browser', reveals: 'Do Not Track setting', bits: 0.6, rarity: 0.72, bitsBasis: 'adjusted' },
    // The battery's level and charging state: short-lived, but enough to link visits for a while.
    { id: 'navigator.getBattery', owner: 'Navigator', prop: 'getBattery', category: 'Battery', reveals: 'battery level and charging', bits: 1.2, rarity: 0.82, bitsBasis: 'estimate' },
    // The keyboard layout: tells regions and setups apart, and only a few games need it.
    { id: 'keyboard.getLayoutMap', owner: 'Keyboard', prop: 'getLayoutMap', category: 'Keyboard', reveals: 'keyboard layout', bits: 2.4, rarity: 0.91, bitsBasis: 'estimate' },
    // The storage quota depends on the free disk space and is much smaller in private windows.
    { id: 'storage.estimate', owner: 'StorageManager', prop: 'estimate', category: 'Storage', reveals: 'storage quota', bits: 1.6, rarity: 0.88, bitsBasis: 'estimate' },
    // The connection: the type is read for adaptive loading, the measured speed and latency rarely.
    { id: 'connection.effectiveType', owner: 'NetworkInformation', prop: 'effectiveType', category: 'Connection', reveals: 'connection type', bits: 0.6, rarity: 0.56, overlap: { group: 'connection', adds: 0.2 } },
    { id: 'connection.rtt', owner: 'NetworkInformation', prop: 'rtt', category: 'Connection', reveals: 'connection latency', bits: 0.8, rarity: 0.63, overlap: { group: 'connection', adds: 0.2 }, bitsBasis: 'estimate' },
    { id: 'connection.downlink', owner: 'NetworkInformation', prop: 'downlink', category: 'Connection', reveals: 'connection speed', bits: 0.7, rarity: 0.65, overlap: { group: 'connection', adds: 0.1 } },
    // The installed voices depend on the operating system, its version and language packs; only
    // text-to-speech needs them.
    { id: 'speech.getVoices', owner: 'SpeechSynthesis', prop: 'getVoices', category: 'Voices', reveals: 'speech voices', bits: 4.5, rarity: 0.93, rarityBasis: 'trackerRadar' },

    { id: 'screen.width', owner: 'Screen', prop: 'width', category: 'ScreenSetup', reveals: 'screen size', bits: 4.2, rarity: 0.31, overlap: { group: 'sizes', adds: 0.1 } },
    { id: 'screen.height', owner: 'Screen', prop: 'height', category: 'ScreenSetup', reveals: 'screen size', bits: 4.1, rarity: 0.31, overlap: { group: 'sizes', adds: 0.3 } },
    // The space left by the taskbar, which tells operating systems and setups apart.
    { id: 'screen.availWidth', owner: 'Screen', prop: 'availWidth', category: 'ScreenSetup', reveals: 'available screen size', bits: 4.4, rarity: 0.68, overlap: { group: 'sizes', adds: 0.4 } },
    { id: 'screen.availHeight', owner: 'Screen', prop: 'availHeight', category: 'ScreenSetup', reveals: 'available screen size', bits: 5.9, rarity: 0.67, overlap: { group: 'sizes', adds: 1.3 } },
    { id: 'screen.colorDepth', owner: 'Screen', prop: 'colorDepth', category: 'ScreenSetup', reveals: 'color depth', bits: 0.7, rarity: 0.65 },
    { id: 'screen.pixelDepth', owner: 'Screen', prop: 'pixelDepth', category: 'ScreenSetup', reveals: 'color depth', bits: 0.7, rarity: 0.88, same: 'screen.colorDepth' },
    { id: 'screen.orientation', owner: 'Screen', prop: 'orientation', category: 'ScreenSetup', reveals: 'screen orientation', bits: 2.4, rarity: 0.86, overlap: { group: 'sizes', adds: 0.1 } },
    // Where the available space starts: the taskbar's or menu bar's side, and the screen's place
    // among several.
    { id: 'screen.availTop', owner: 'Screen', prop: 'availTop', category: 'ScreenSetup', reveals: 'screen position', bits: 1.3, rarity: 0.83, overlap: { group: 'sizes', adds: 0.1 } },
    { id: 'screen.availLeft', owner: 'Screen', prop: 'availLeft', category: 'ScreenSetup', reveals: 'screen position', bits: 1.1, rarity: 0.85, overlap: { group: 'sizes', adds: 0.1 } },

    // Window: the inner size is everyday layout, the outer size and position rarely needed.
    { id: 'window.innerWidth', owner: 'Window', prop: 'innerWidth', category: 'ScreenSetup', reveals: 'window size', bits: 5.8, rarity: 0.28, overlap: { group: 'sizes', adds: 0.5 } },
    { id: 'window.innerHeight', owner: 'Window', prop: 'innerHeight', category: 'ScreenSetup', reveals: 'window size', bits: 8.5, rarity: 0.3, overlap: { group: 'sizes', adds: 4 } },
    { id: 'window.outerWidth', owner: 'Window', prop: 'outerWidth', category: 'ScreenSetup', reveals: 'browser window size', bits: 6.4, rarity: 0.68, overlap: { group: 'sizes', adds: 1.6 } },
    { id: 'window.outerHeight', owner: 'Window', prop: 'outerHeight', category: 'ScreenSetup', reveals: 'browser window size', bits: 7.2, rarity: 0.7, overlap: { group: 'sizes', adds: 2.6 } },
    { id: 'window.devicePixelRatio', owner: 'Window', prop: 'devicePixelRatio', category: 'ScreenSetup', reveals: 'pixel density', bits: 2.3, rarity: 0.4, overlap: { group: 'sizes', adds: 0.6 } },
    { id: 'window.screenX', owner: 'Window', prop: 'screenX', category: 'ScreenSetup', reveals: 'window position', bits: 2.7, rarity: 0.83, overlap: { group: 'sizes', adds: 1 } },
    { id: 'window.screenY', owner: 'Window', prop: 'screenY', category: 'ScreenSetup', reveals: 'window position', bits: 2.8, rarity: 0.82, overlap: { group: 'sizes', adds: 1.1 } },
    // Older names for screenX and screenY, with the same values.
    { id: 'window.screenLeft', owner: 'Window', prop: 'screenLeft', category: 'ScreenSetup', reveals: 'window position', bits: 2.7, rarity: 0.86, same: 'window.screenX', overlap: { group: 'sizes', adds: 1 } },
    { id: 'window.screenTop', owner: 'Window', prop: 'screenTop', category: 'ScreenSetup', reveals: 'window position', bits: 2.8, rarity: 0.86, same: 'window.screenY', overlap: { group: 'sizes', adds: 1.1 } },

    // Document: more tracking than fingerprinting, and read everywhere.
    { id: 'document.referrer', owner: 'Document', prop: 'referrer', category: 'Cookies', reveals: 'previous page', bits: 0.4, rarity: 0.15, rarityBasis: 'estimate', bitsBasis: 'estimate' },
    { id: 'document.cookie', owner: 'Document', prop: 'cookie', category: 'Cookies', reveals: 'cookies', bits: 0.4, rarity: 0.22, bitsBasis: 'estimate' },

    // Canvas: reading back what was drawn shows how this device renders. Exporting or editing a
    // visible canvas is common; reading back a canvas that isn't on the page is canvas fingerprinting.
    // Exporting a canvas nothing was drawn on (checking which formats can be encoded) isn't recorded.
    { id: 'canvas.toDataURL', owner: 'HTMLCanvasElement', prop: 'toDataURL', category: 'CanvasImage', reveals: 'canvas image', bits: 7.8, rarity: 0.86 },
    { id: 'canvas.hiddenToDataURL', owner: 'HTMLCanvasElement', prop: 'toDataURL', category: 'CanvasImage', reveals: 'hidden canvas image', bits: 7.8, rarity: 0.9, same: 'canvas.toDataURL', readOf: { api: 'canvas.toDataURL', read: 'hiddenCanvas' }, rarityBasis: 'bound' },
    { id: 'canvas.toBlob', owner: 'HTMLCanvasElement', prop: 'toBlob', category: 'CanvasImage', reveals: 'canvas image', bits: 7.8, rarity: 0.99, same: 'canvas.toDataURL' },
    { id: 'canvas.hiddenToBlob', owner: 'HTMLCanvasElement', prop: 'toBlob', category: 'CanvasImage', reveals: 'hidden canvas image', bits: 7.8, rarity: 0.994, same: 'canvas.toDataURL', readOf: { api: 'canvas.toBlob', read: 'hiddenCanvas' }, rarityBasis: 'bound' },
    { id: 'canvas.getImageData', owner: 'CanvasRenderingContext2D', prop: 'getImageData', category: 'CanvasImage', reveals: 'canvas image', bits: 7.8, rarity: 0.92, same: 'canvas.toDataURL' },
    { id: 'canvas.hiddenGetImageData', owner: 'CanvasRenderingContext2D', prop: 'getImageData', category: 'CanvasImage', reveals: 'hidden canvas image', bits: 7.8, rarity: 0.95, same: 'canvas.toDataURL', readOf: { api: 'canvas.getImageData', read: 'hiddenCanvas' }, rarityBasis: 'bound' },
    // Whether a point lies in a path drawn with the even-odd rule: the same in practically every
    // browser, but part of a canvas fingerprint (FingerprintJS's "winding"), and rare otherwise.
    { id: 'canvas.isPointInPath', owner: 'CanvasRenderingContext2D', prop: 'isPointInPath', category: 'CanvasImage', reveals: 'canvas path handling', bits: 0.4, rarity: 0.96, bitsBasis: 'estimate' },
    // Measuring text is everyday; measuring it in many different fonts is finding out which are installed.
    { id: 'canvas.measureText', owner: 'CanvasRenderingContext2D', prop: 'measureText', category: 'Fonts', reveals: 'text measurements', bits: 4, rarity: 0.92, overlap: { group: 'fonts', adds: 0.5 } },
    { id: 'canvas.fontProbing', owner: 'CanvasRenderingContext2D', prop: 'measureText', category: 'Fonts', reveals: 'installed fonts', bits: 6.7, rarity: 0.96, readOf: { api: 'canvas.measureText', read: 'fontProbing' }, overlap: { group: 'fonts', adds: 2.4 }, rarityBasis: 'bound' },
    // The same reads on an OffscreenCanvas (in the page; in a worker they aren't recorded): it is
    // never on the page, so its image is always a hidden canvas's.
    { id: 'offscreencanvas.convertToBlob', owner: 'OffscreenCanvas', prop: 'convertToBlob', category: 'CanvasImage', reveals: 'hidden canvas image', bits: 7.8, rarity: 0.997, same: 'canvas.toDataURL' },
    { id: 'offscreencanvas.getImageData', owner: 'OffscreenCanvasRenderingContext2D', prop: 'getImageData', category: 'CanvasImage', reveals: 'hidden canvas image', bits: 7.8, rarity: 0.98, same: 'canvas.toDataURL' },
    { id: 'offscreencanvas.measureText', owner: 'OffscreenCanvasRenderingContext2D', prop: 'measureText', category: 'Fonts', reveals: 'text measurements', bits: 4, rarity: 0.99, same: 'canvas.measureText', overlap: { group: 'fonts', adds: 0.5 } },
    { id: 'offscreencanvas.fontProbing', owner: 'OffscreenCanvasRenderingContext2D', prop: 'measureText', category: 'Fonts', reveals: 'installed fonts', bits: 6.7, rarity: 0.99, same: 'canvas.fontProbing', readOf: { api: 'offscreencanvas.measureText', read: 'fontProbing' }, overlap: { group: 'fonts', adds: 2.4 }, rarityBasis: 'bound' },

    // WebGL: 3D engines check capabilities and shader precision when they start, and read pixels
    // back to find what was clicked. The graphics card's maker and model (through
    // WEBGL_debug_renderer_info) are recorded on their own, as almost nothing but fingerprinting
    // needs them.
    { id: 'webgl.getParameter', owner: 'WebGLRenderingContext', prop: 'getParameter', category: 'GraphicsCard', reveals: 'graphics capabilities', bits: 2.8, rarity: 0.71, overlap: { group: 'gpu', adds: 0.3 } },
    { id: 'webgl.gpuName', owner: 'WebGLRenderingContext', prop: 'getParameter', category: 'GraphicsCard', reveals: 'graphics card name', bits: 5.9, rarity: 0.72, readOf: { api: 'webgl.getParameter', read: 'gpuName' }, overlap: { group: 'gpu', adds: 1.6 }, rarityBasis: 'related' },
    { id: 'webgl.getExtension', owner: 'WebGLRenderingContext', prop: 'getExtension', category: 'GraphicsCard', reveals: 'graphics extensions', bits: 0.8, rarity: 0.73, overlap: { group: 'gpu', adds: 0.1 }, bitsBasis: 'estimate' },
    { id: 'webgl.getSupportedExtensions', owner: 'WebGLRenderingContext', prop: 'getSupportedExtensions', category: 'GraphicsCard', reveals: 'supported graphics extensions', bits: 4.6, rarity: 0.93, overlap: { group: 'gpu', adds: 0.6 } },
    { id: 'webgl.readPixels', owner: 'WebGLRenderingContext', prop: 'readPixels', category: 'GraphicsCard', reveals: 'rendered 3D image', bits: 5.8, rarity: 0.95, overlap: { group: 'gpu', adds: 0.5 }, rarityBasis: 'trackerRadar' },
    // The precision of the graphics card's shaders: 3D engines ask when they start, fingerprinters always do.
    { id: 'webgl.getShaderPrecisionFormat', owner: 'WebGLRenderingContext', prop: 'getShaderPrecisionFormat', category: 'GraphicsCard', reveals: 'shader precision', bits: 1.6, rarity: 0.94, overlap: { group: 'gpu', adds: 0 } },
    // The context's settings (antialiasing and the like): mostly what was asked for, read back.
    { id: 'webgl.getContextAttributes', owner: 'WebGLRenderingContext', prop: 'getContextAttributes', category: 'GraphicsCard', reveals: 'graphics settings', bits: 0.4, rarity: 0.9, overlap: { group: 'gpu', adds: 0.2 }, bitsBasis: 'adjusted', rarityBasis: 'trackerRadar' },

    { id: 'webgl2.getParameter', owner: 'WebGL2RenderingContext', prop: 'getParameter', category: 'GraphicsCard', reveals: 'graphics capabilities', bits: 2.8, rarity: 0.97, same: 'webgl.getParameter', overlap: { group: 'gpu', adds: 0.3 }, rarityBasis: 'trackerRadar' },
    { id: 'webgl2.gpuName', owner: 'WebGL2RenderingContext', prop: 'getParameter', category: 'GraphicsCard', reveals: 'graphics card name', bits: 5.9, rarity: 0.97, same: 'webgl.gpuName', readOf: { api: 'webgl2.getParameter', read: 'gpuName' }, overlap: { group: 'gpu', adds: 1.6 }, rarityBasis: 'bound' },
    { id: 'webgl2.getExtension', owner: 'WebGL2RenderingContext', prop: 'getExtension', category: 'GraphicsCard', reveals: 'graphics extensions', bits: 0.8, rarity: 0.94, same: 'webgl.getExtension', overlap: { group: 'gpu', adds: 0.1 }, bitsBasis: 'estimate' },
    { id: 'webgl2.getSupportedExtensions', owner: 'WebGL2RenderingContext', prop: 'getSupportedExtensions', category: 'GraphicsCard', reveals: 'supported graphics extensions', bits: 4.6, rarity: 0.98, same: 'webgl.getSupportedExtensions', overlap: { group: 'gpu', adds: 0.6 } },
    { id: 'webgl2.readPixels', owner: 'WebGL2RenderingContext', prop: 'readPixels', category: 'GraphicsCard', reveals: 'rendered 3D image', bits: 5.8, rarity: 0.95, same: 'webgl.readPixels', overlap: { group: 'gpu', adds: 0.5 }, rarityBasis: 'trackerRadar' },
    { id: 'webgl2.getShaderPrecisionFormat', owner: 'WebGL2RenderingContext', prop: 'getShaderPrecisionFormat', category: 'GraphicsCard', reveals: 'shader precision', bits: 1.6, rarity: 0.94, same: 'webgl.getShaderPrecisionFormat', rarityBasis: 'related', overlap: { group: 'gpu', adds: 0 } },
    { id: 'webgl2.getContextAttributes', owner: 'WebGL2RenderingContext', prop: 'getContextAttributes', category: 'GraphicsCard', reveals: 'graphics settings', bits: 0.4, rarity: 0.99, same: 'webgl.getContextAttributes', overlap: { group: 'gpu', adds: 0.2 }, bitsBasis: 'adjusted', rarityBasis: 'trackerRadar' },

    // WebGPU: asking for an adapter is how WebGPU content starts; its info names the graphics card's
    // maker and architecture, which only fingerprinting needs.
    { id: 'webgpu.requestAdapter', owner: 'GPU', prop: 'requestAdapter', category: 'GraphicsCard', reveals: 'WebGPU support', bits: 0.4, rarity: 0.9, bitsBasis: 'estimate' },
    { id: 'webgpu.adapterInfo', owner: 'GPUAdapter', prop: 'info', category: 'GraphicsCard', reveals: 'graphics card maker and architecture', bits: 3.6, rarity: 0.95, overlap: { group: 'gpu', adds: 0.5 }, bitsBasis: 'estimate', rarityBasis: 'bound' },

    // Audio: setting up nodes is ordinary; rendering silently and reading the samples is fingerprinting.
    { id: 'audiocontext.createAnalyser', owner: 'AudioContext', prop: 'createAnalyser', category: 'Audio', reveals: 'audio setup', bits: 0.8, rarity: 0.97 },
    { id: 'audiocontext.createOscillator', owner: 'AudioContext', prop: 'createOscillator', category: 'Audio', reveals: 'audio setup', bits: 0.8, rarity: 0.93 },
    { id: 'offlineaudiocontext.startRendering', owner: 'OfflineAudioContext', prop: 'startRendering', category: 'Audio', reveals: 'rendered audio', bits: 3.4, rarity: 0.93 },
    { id: 'audiobuffer.getChannelData', owner: 'AudioBuffer', prop: 'getChannelData', category: 'Audio', reveals: 'rendered audio', bits: 3.4, rarity: 0.93, same: 'offlineaudiocontext.startRendering' },
    { id: 'audiobuffer.copyFromChannel', owner: 'AudioBuffer', prop: 'copyFromChannel', category: 'Audio', reveals: 'rendered audio', bits: 3.4, rarity: 0.997, same: 'offlineaudiocontext.startRendering' },

    // Codecs: which audio and video formats the browser plays, which depends on the browser, its
    // build and the operating system. Video players ask too, for the formats they have.
    { id: 'media.canPlayType', owner: 'HTMLMediaElement', prop: 'canPlayType', category: 'Codecs', reveals: 'supported media formats', bits: 1.2, rarity: 0.77, bitsBasis: 'adjusted' },
    { id: 'mediasource.isTypeSupported', owner: 'MediaSource', prop: 'isTypeSupported', category: 'Codecs', reveals: 'supported media formats', bits: 1.2, rarity: 0.9, same: 'media.canPlayType', bitsBasis: 'adjusted', rarityBasis: 'related' },
    // Media devices: the list of cameras and microphones is read silently; without permission it
    // only tells how many of each kind there are. getUserMedia asks first.
    { id: 'mediadevices.enumerateDevices', owner: 'MediaDevices', prop: 'enumerateDevices', category: 'MediaDevices', reveals: 'cameras and microphones', bits: 1.2, rarity: 0.86, bitsBasis: 'estimate' },
    { id: 'mediadevices.getUserMedia', owner: 'MediaDevices', prop: 'getUserMedia', category: 'MediaDevices', reveals: 'camera or microphone access', bits: 0.4, rarity: 0.998, bitsBasis: 'estimate' },

    // WebRTC: can reveal local network addresses; video calls use it legitimately.
    { id: 'webrtc.createDataChannel', owner: 'RTCPeerConnection', prop: 'createDataChannel', category: 'Network', reveals: 'WebRTC connection', bits: 0.4, rarity: 0.93, rarityBasis: 'related', bitsBasis: 'estimate' },
    { id: 'webrtc.addIceCandidate', owner: 'RTCPeerConnection', prop: 'addIceCandidate', category: 'Network', reveals: 'local network addresses', bits: 2.4, rarity: 0.998, same: 'webrtc.setLocalDescription', bitsBasis: 'adjusted' },
    { id: 'webrtc.setLocalDescription', owner: 'RTCPeerConnection', prop: 'setLocalDescription', category: 'Network', reveals: 'local network addresses', bits: 2.4, rarity: 0.94, bitsBasis: 'adjusted' },

    // Intl: the time zone; date libraries read it too.
    { id: 'intl.datetimeformat.resolvedOptions', owner: 'IntlDateTimeFormat', prop: 'resolvedOptions', category: 'TimeZone', reveals: 'time zone', bits: 3.7, rarity: 0.64, rarityBasis: 'related', overlap: { group: 'timezone', adds: 0.3 }, bitsBasis: 'worldwide' },
    { id: 'date.getTimezoneOffset', owner: 'Date', prop: 'getTimezoneOffset', category: 'TimeZone', reveals: 'time zone', bits: 3.5, rarity: 0.1, overlap: { group: 'timezone', adds: 0.1 }, bitsBasis: 'worldwide', rarityBasis: 'trackerRadar' },
];

export const FP_APIS_BY_ID: Record<string, FpApi> = Object.fromEntries(FP_APIS.map((api) => [api.id, api]));
