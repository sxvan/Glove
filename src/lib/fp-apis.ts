export type FpApiOwner =
    | 'Navigator'
    | 'Screen'
    | 'Window'
    | 'Document'
    | 'HTMLCanvasElement'
    | 'CanvasRenderingContext2D'
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

/** The kinds with the name the popup uses for what they reveal. */
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

/** The popup's name for a category, e.g. "audio" for AudioContext; unknown ones keep their key. */
export function fpCategoryName(category: string): string {
    return FP_CATEGORIES[category as FpCategory]?.name ?? category;
}

/** Groups of APIs whose values overlap (see FpApi.overlap). */
export type OverlapGroup = 'browser' | 'memory' | 'connection' | 'sizes' | 'fonts' | 'gpu' | 'timezone';

export interface FpApi {
    id: string;
    owner: FpApiOwner;
    prop: string;
    category: FpCategory;
    /**
     * What reading it tells a script about the device, in a few words, e.g. "graphics card name";
     * shown grouped by category. APIs revealing the same value share the same words.
     */
    reveals: string;
    /**
     * How much identifying information it reveals on its own: its entropy in bits, the average over
     * browsers (6 bits tell one browser in 64 apart). Where it comes from, see bitsBasis.
     */
    bits: number;
    /**
     * Where its bits come from: measured on 4.1 million fingerprints unless said otherwise (see
     * FP_APIS); lowered where Chrome has changed since ("adjusted"), measured worldwide where that
     * study's French users differ most ("worldwide"), or an estimate without data ("estimate").
     */
    bitsBasis?: 'adjusted' | 'worldwide' | 'estimate';
    /**
     * For an API whose value overlaps with related ones, like the screen's and the window's sizes:
     * their group, and the bits it adds once another API of the group is known (from the same study,
     * the conditional entropy given the attribute telling the most about it). Of a group read
     * together, the API with the most bits counts all of them, the others what they add (see apisSums).
     */
    overlap?: { group: OverlapGroup; adds: number };
    /**
     * How rarely ordinary code needs it, from 0 (read by almost every site) to 1 (read practically
     * only to fingerprint or detect bots). Reading a rare API shows intent even if it reveals little.
     */
    rarity: number;
    /**
     * Where its rarity comes from: Chrome's use counter for it unless said otherwise; a counter of a
     * related feature ("related"), how often DuckDuckGo's Tracker Radar saw third-party scripts read
     * it compared with APIs that have a counter ("trackerRadar", see FP_APIS), or an estimate without
     * data ("estimate").
     */
    rarityBasis?: 'related' | 'trackerRadar' | 'estimate';
    /**
     * The id of an API that reveals the same value (e.g. webgl2.readPixels and webgl.readPixels, or
     * screen.pixelDepth and screen.colorDepth): they count once together, as the highest of them.
     * Values that only overlap, like a height and its width, are in an overlap group instead.
     */
    same?: string;
    /**
     * For a particular read through another API, which reveals much more than its usual use: the id
     * of that API and which read it is (the recorder recognizes the calls). Such calls are recorded
     * under this id instead.
     */
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

// Defaults for the bits and rarity (users can change them; scoring turns them into the identifying
// information and unusual APIs signals). The bits are Andriamilanto et al. 2021, 4.1 million
// fingerprints (arxiv.org/abs/2006.09511, Table 16): the normalized entropy times 21.98 bits, what
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
// that use the API, from Chrome's use counters (chromestatus.com/data/featurepopularity, 2026-10-15):
// innerWidth is read on 72% of page loads (0.28), deviceMemory on 43% (0.57), getChannelData on 7%
// (0.93). Where a related counter is all there is, it is used: webgl2.getParameter and
// getShaderPrecisionFormat from WebGL 1, speech.getVoices from reading speechSynthesis (an upper
// bound), createDataChannel from creating an RTCPeerConnection, resolvedOptions from creating a
// DateTimeFormat, mediasource.isTypeSupported from canPlayType, which answers the same question.
// Chrome counts no use of navigator.webdriver (its IDL has no MeasureAs). DuckDuckGo's Tracker
// Radar (github.com/duckduckgo/tracker-radar, US crawl) saw third-party scripts read it on 118,868
// sites, about as often as deviceMemory (116,222; 43% of page loads in Chrome) and languages
// (128,367; 41%): across such APIs with a counter, a page load share of about 3.4e-6 per site,
// which makes webdriver about 40% (0.6). Probably rather less, as mostly third parties (bot
// detection) read it, which the crawl sees all of, while first-party code reads the others too.
// Rarity estimates without data: uadata.detailedHints,
// document.referrer, date.getTimezoneOffset, webgl readPixels and getContextAttributes,
// webgpu.adapterInfo, and the special
// reads (hidden canvas, font probing, graphics card name), which are rarer than the API they use.
export const FP_APIS: FpApi[] = [
    // Navigator
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
    // automation is what bot detection does, and that runs on a large part of the web: read about
    // as often as deviceMemory.
    { id: 'navigator.webdriver', owner: 'Navigator', prop: 'webdriver', category: 'Automation', reveals: 'automation flag', bits: 0.4, rarity: 0.6, rarityBasis: 'trackerRadar', bitsBasis: 'adjusted' },
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
    { id: 'speech.getVoices', owner: 'SpeechSynthesis', prop: 'getVoices', category: 'Voices', reveals: 'speech voices', bits: 4.5, rarity: 0.86, rarityBasis: 'related' },

    // Screen
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
    { id: 'canvas.toDataURL', owner: 'HTMLCanvasElement', prop: 'toDataURL', category: 'CanvasImage', reveals: 'canvas image', bits: 7.8, rarity: 0.86 },
    { id: 'canvas.hiddenToDataURL', owner: 'HTMLCanvasElement', prop: 'toDataURL', category: 'CanvasImage', reveals: 'hidden canvas image', bits: 7.8, rarity: 1, same: 'canvas.toDataURL', readOf: { api: 'canvas.toDataURL', read: 'hiddenCanvas' }, rarityBasis: 'estimate' },
    { id: 'canvas.toBlob', owner: 'HTMLCanvasElement', prop: 'toBlob', category: 'CanvasImage', reveals: 'canvas image', bits: 7.8, rarity: 0.99, same: 'canvas.toDataURL' },
    { id: 'canvas.hiddenToBlob', owner: 'HTMLCanvasElement', prop: 'toBlob', category: 'CanvasImage', reveals: 'hidden canvas image', bits: 7.8, rarity: 1, same: 'canvas.toDataURL', readOf: { api: 'canvas.toBlob', read: 'hiddenCanvas' }, rarityBasis: 'estimate' },
    { id: 'canvas.getImageData', owner: 'CanvasRenderingContext2D', prop: 'getImageData', category: 'CanvasImage', reveals: 'canvas image', bits: 7.8, rarity: 0.92, same: 'canvas.toDataURL' },
    { id: 'canvas.hiddenGetImageData', owner: 'CanvasRenderingContext2D', prop: 'getImageData', category: 'CanvasImage', reveals: 'hidden canvas image', bits: 7.8, rarity: 1, same: 'canvas.toDataURL', readOf: { api: 'canvas.getImageData', read: 'hiddenCanvas' }, rarityBasis: 'estimate' },
    // Whether a point lies in a path drawn with the even-odd rule: the same in practically every
    // browser, but part of a canvas fingerprint (FingerprintJS's "winding"), and rare otherwise.
    { id: 'canvas.isPointInPath', owner: 'CanvasRenderingContext2D', prop: 'isPointInPath', category: 'CanvasImage', reveals: 'canvas path handling', bits: 0.4, rarity: 0.96, bitsBasis: 'estimate' },
    // Measuring text is everyday; measuring it in many different fonts is finding out which are installed.
    { id: 'canvas.measureText', owner: 'CanvasRenderingContext2D', prop: 'measureText', category: 'Fonts', reveals: 'text measurements', bits: 4, rarity: 0.92, overlap: { group: 'fonts', adds: 0.5 } },
    { id: 'canvas.fontProbing', owner: 'CanvasRenderingContext2D', prop: 'measureText', category: 'Fonts', reveals: 'installed fonts', bits: 6.7, rarity: 1, readOf: { api: 'canvas.measureText', read: 'fontProbing' }, rarityBasis: 'estimate', overlap: { group: 'fonts', adds: 2.4 } },

    // WebGL: 3D engines check capabilities and shader precision when they start, and read pixels
    // back to find what was clicked. The graphics card's maker and model (through
    // WEBGL_debug_renderer_info) are recorded on their own, as almost nothing but fingerprinting
    // needs them.
    { id: 'webgl.getParameter', owner: 'WebGLRenderingContext', prop: 'getParameter', category: 'GraphicsCard', reveals: 'graphics capabilities', bits: 2.8, rarity: 0.71, overlap: { group: 'gpu', adds: 0.3 } },
    { id: 'webgl.gpuName', owner: 'WebGLRenderingContext', prop: 'getParameter', category: 'GraphicsCard', reveals: 'graphics card name', bits: 5.9, rarity: 1, readOf: { api: 'webgl.getParameter', read: 'gpuName' }, rarityBasis: 'estimate', overlap: { group: 'gpu', adds: 1.6 } },
    { id: 'webgl.getExtension', owner: 'WebGLRenderingContext', prop: 'getExtension', category: 'GraphicsCard', reveals: 'graphics extensions', bits: 0.8, rarity: 0.73, overlap: { group: 'gpu', adds: 0.1 }, bitsBasis: 'estimate' },
    { id: 'webgl.getSupportedExtensions', owner: 'WebGLRenderingContext', prop: 'getSupportedExtensions', category: 'GraphicsCard', reveals: 'supported graphics extensions', bits: 4.6, rarity: 0.93, overlap: { group: 'gpu', adds: 0.6 } },
    { id: 'webgl.readPixels', owner: 'WebGLRenderingContext', prop: 'readPixels', category: 'GraphicsCard', reveals: 'rendered 3D image', bits: 5.8, rarity: 0.6, rarityBasis: 'estimate', overlap: { group: 'gpu', adds: 0.5 } },
    // The precision of the graphics card's shaders: 3D engines ask when they start, fingerprinters always do.
    { id: 'webgl.getShaderPrecisionFormat', owner: 'WebGLRenderingContext', prop: 'getShaderPrecisionFormat', category: 'GraphicsCard', reveals: 'shader precision', bits: 1.6, rarity: 0.94, overlap: { group: 'gpu', adds: 0 } },
    // The context's settings (antialiasing and the like): mostly what was asked for, read back.
    { id: 'webgl.getContextAttributes', owner: 'WebGLRenderingContext', prop: 'getContextAttributes', category: 'GraphicsCard', reveals: 'graphics settings', bits: 0.4, rarity: 0.9, rarityBasis: 'estimate', overlap: { group: 'gpu', adds: 0.2 }, bitsBasis: 'adjusted' },

    { id: 'webgl2.getParameter', owner: 'WebGL2RenderingContext', prop: 'getParameter', category: 'GraphicsCard', reveals: 'graphics capabilities', bits: 2.8, rarity: 0.71, same: 'webgl.getParameter', rarityBasis: 'related', overlap: { group: 'gpu', adds: 0.3 } },
    { id: 'webgl2.gpuName', owner: 'WebGL2RenderingContext', prop: 'getParameter', category: 'GraphicsCard', reveals: 'graphics card name', bits: 5.9, rarity: 1, same: 'webgl.gpuName', readOf: { api: 'webgl2.getParameter', read: 'gpuName' }, rarityBasis: 'estimate', overlap: { group: 'gpu', adds: 1.6 } },
    { id: 'webgl2.getExtension', owner: 'WebGL2RenderingContext', prop: 'getExtension', category: 'GraphicsCard', reveals: 'graphics extensions', bits: 0.8, rarity: 0.94, same: 'webgl.getExtension', overlap: { group: 'gpu', adds: 0.1 }, bitsBasis: 'estimate' },
    { id: 'webgl2.getSupportedExtensions', owner: 'WebGL2RenderingContext', prop: 'getSupportedExtensions', category: 'GraphicsCard', reveals: 'supported graphics extensions', bits: 4.6, rarity: 0.98, same: 'webgl.getSupportedExtensions', overlap: { group: 'gpu', adds: 0.6 } },
    { id: 'webgl2.readPixels', owner: 'WebGL2RenderingContext', prop: 'readPixels', category: 'GraphicsCard', reveals: 'rendered 3D image', bits: 5.8, rarity: 0.6, same: 'webgl.readPixels', rarityBasis: 'estimate', overlap: { group: 'gpu', adds: 0.5 } },
    { id: 'webgl2.getShaderPrecisionFormat', owner: 'WebGL2RenderingContext', prop: 'getShaderPrecisionFormat', category: 'GraphicsCard', reveals: 'shader precision', bits: 1.6, rarity: 0.94, same: 'webgl.getShaderPrecisionFormat', rarityBasis: 'related', overlap: { group: 'gpu', adds: 0 } },
    { id: 'webgl2.getContextAttributes', owner: 'WebGL2RenderingContext', prop: 'getContextAttributes', category: 'GraphicsCard', reveals: 'graphics settings', bits: 0.4, rarity: 0.9, same: 'webgl.getContextAttributes', rarityBasis: 'estimate', overlap: { group: 'gpu', adds: 0.2 }, bitsBasis: 'adjusted' },

    // WebGPU: asking for an adapter is how WebGPU content starts; its info names the graphics card's
    // maker and architecture, which only fingerprinting needs.
    { id: 'webgpu.requestAdapter', owner: 'GPU', prop: 'requestAdapter', category: 'GraphicsCard', reveals: 'WebGPU support', bits: 0.4, rarity: 0.9, bitsBasis: 'estimate' },
    { id: 'webgpu.adapterInfo', owner: 'GPUAdapter', prop: 'info', category: 'GraphicsCard', reveals: 'graphics card maker and architecture', bits: 3.6, rarity: 0.95, rarityBasis: 'estimate', overlap: { group: 'gpu', adds: 0.5 }, bitsBasis: 'estimate' },

    // Audio: setting up nodes is ordinary; rendering silently and reading the samples is fingerprinting.
    { id: 'audiocontext.createAnalyser', owner: 'AudioContext', prop: 'createAnalyser', category: 'Audio', reveals: 'audio setup', bits: 0.8, rarity: 0.97 },
    { id: 'audiocontext.createOscillator', owner: 'AudioContext', prop: 'createOscillator', category: 'Audio', reveals: 'audio setup', bits: 0.8, rarity: 0.93 },
    { id: 'offlineaudiocontext.startRendering', owner: 'OfflineAudioContext', prop: 'startRendering', category: 'Audio', reveals: 'rendered audio', bits: 3.4, rarity: 0.93 },
    { id: 'audiobuffer.getChannelData', owner: 'AudioBuffer', prop: 'getChannelData', category: 'Audio', reveals: 'rendered audio', bits: 3.4, rarity: 0.93, same: 'offlineaudiocontext.startRendering' },

    // Codecs: which audio and video formats the browser plays, which depends on the browser, its
    // build and the operating system. Video players ask too, for the formats they have.
    { id: 'media.canPlayType', owner: 'HTMLMediaElement', prop: 'canPlayType', category: 'Codecs', reveals: 'supported media formats', bits: 1.2, rarity: 0.77, bitsBasis: 'adjusted' },
    { id: 'mediasource.isTypeSupported', owner: 'MediaSource', prop: 'isTypeSupported', category: 'Codecs', reveals: 'supported media formats', bits: 1.2, rarity: 0.77, same: 'media.canPlayType', rarityBasis: 'related', bitsBasis: 'adjusted' },
    // Media devices: the list of cameras and microphones is read silently; without permission it
    // only tells how many of each kind there are. getUserMedia asks first.
    { id: 'mediadevices.enumerateDevices', owner: 'MediaDevices', prop: 'enumerateDevices', category: 'MediaDevices', reveals: 'cameras and microphones', bits: 1.2, rarity: 0.86, bitsBasis: 'estimate' },
    { id: 'mediadevices.getUserMedia', owner: 'MediaDevices', prop: 'getUserMedia', category: 'MediaDevices', reveals: 'camera or microphone access', bits: 0.4, rarity: 1, bitsBasis: 'estimate' },

    // WebRTC: can reveal local network addresses; video calls use it legitimately.
    { id: 'webrtc.createDataChannel', owner: 'RTCPeerConnection', prop: 'createDataChannel', category: 'Network', reveals: 'WebRTC connection', bits: 0.4, rarity: 0.93, rarityBasis: 'related', bitsBasis: 'estimate' },
    { id: 'webrtc.addIceCandidate', owner: 'RTCPeerConnection', prop: 'addIceCandidate', category: 'Network', reveals: 'local network addresses', bits: 2.4, rarity: 0.94, same: 'webrtc.setLocalDescription', bitsBasis: 'adjusted' },
    { id: 'webrtc.setLocalDescription', owner: 'RTCPeerConnection', prop: 'setLocalDescription', category: 'Network', reveals: 'local network addresses', bits: 2.4, rarity: 0.94, bitsBasis: 'adjusted' },

    // Intl: the time zone; date libraries read it too.
    { id: 'intl.datetimeformat.resolvedOptions', owner: 'IntlDateTimeFormat', prop: 'resolvedOptions', category: 'TimeZone', reveals: 'time zone', bits: 3.7, rarity: 0.64, rarityBasis: 'related', overlap: { group: 'timezone', adds: 0.3 }, bitsBasis: 'worldwide' },
    { id: 'date.getTimezoneOffset', owner: 'Date', prop: 'getTimezoneOffset', category: 'TimeZone', reveals: 'time zone', bits: 3.5, rarity: 0.1, rarityBasis: 'estimate', overlap: { group: 'timezone', adds: 0.1 }, bitsBasis: 'worldwide' },
];

export const FP_APIS_BY_ID: Record<string, FpApi> = Object.fromEntries(FP_APIS.map((api) => [api.id, api]));

