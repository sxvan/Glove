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
     * How much lasting identifying information it reveals, from 0 to 1: its entropy in bits divided
     * by 8 (one browser in 256), at most 1. Values that change soon count less than their bits.
     */
    entropy: number;
    /**
     * How rarely ordinary code needs it, from 0 (read by almost every site) to 1 (read practically
     * only to fingerprint or detect bots). Reading a rare API shows intent even if it reveals little.
     */
    rarity: number;
    /**
     * The id of an API that reveals the same value (e.g. webgl2.readPixels and webgl.readPixels, or
     * screen.pixelDepth and screen.colorDepth): they count once together, as the highest of them.
     * Values that only overlap, like a height and its width, have their own entropy instead.
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

// Defaults for entropy and rarity (users can change them; scoring turns them into the identifying
// information and unusual APIs signals). The bits come from Andriamilanto et al. 2021, 4.1 million
// fingerprints (arxiv.org/abs/2006.09511), adjusted where Chrome has changed since (plugins, the
// user agent, WebRTC); APIs it didn't measure are estimates. Rarity is 1 − the share of page loads
// that use the API, from Chrome's use counters (chromestatus.com/data/featurepopularity, 2026-10-15):
// innerWidth is read on 72% of page loads (0.28), deviceMemory on 43% (0.57), getChannelData on 7%
// (0.93). Where a related counter is all there is, it is used: webgl2.getParameter and
// getShaderPrecisionFormat from WebGL 1, speech.getVoices from reading speechSynthesis (an upper
// bound), createDataChannel from creating an RTCPeerConnection, resolvedOptions from creating a
// DateTimeFormat, mediasource.isTypeSupported from canPlayType, which answers the same question.
// Estimates without data: uadata.detailedHints, navigator.webdriver,
// document.referrer, date.getTimezoneOffset, webgl readPixels and getContextAttributes,
// webgpu.adapterInfo, and the special
// reads (hidden canvas, font probing, graphics card name), which are rarer than the API they use.
export const FP_APIS: FpApi[] = [
    // Navigator
    { id: 'navigator.userAgent', owner: 'Navigator', prop: 'userAgent', category: 'Browser', reveals: 'browser and version', entropy: 0.6, rarity: 0.09 },
    // Client hints: brands are everyday. The exact OS version, device model, architecture and full
    // browser version identify more, but analytics asks for them routinely too (Google Analytics does
    // by default), so they count only moderately.
    { id: 'uadata.getHighEntropyValues', owner: 'NavigatorUAData', prop: 'getHighEntropyValues', category: 'Browser', reveals: 'client hints', entropy: 0.2, rarity: 0.38 },
    { id: 'uadata.detailedHints', owner: 'NavigatorUAData', prop: 'getHighEntropyValues', category: 'Browser', reveals: 'exact OS version, device model and architecture', entropy: 0.5, rarity: 0.5, readOf: { api: 'uadata.getHighEntropyValues', read: 'highEntropyValues' } },
    { id: 'navigator.platform', owner: 'Navigator', prop: 'platform', category: 'Browser', reveals: 'operating system', entropy: 0.2, rarity: 0.37 },
    { id: 'navigator.language', owner: 'Navigator', prop: 'language', category: 'Languages', reveals: 'languages', entropy: 0.2, rarity: 0.44, same: 'navigator.languages' },
    { id: 'navigator.languages', owner: 'Navigator', prop: 'languages', category: 'Languages', reveals: 'languages', entropy: 0.3, rarity: 0.59 },
    { id: 'navigator.hardwareConcurrency', owner: 'Navigator', prop: 'hardwareConcurrency', category: 'Hardware', reveals: 'CPU cores', entropy: 0.25, rarity: 0.62 },
    { id: 'navigator.deviceMemory', owner: 'Navigator', prop: 'deviceMemory', category: 'Hardware', reveals: 'memory', entropy: 0.2, rarity: 0.57 },
    // The JS heap's size limit, which depends on the device's memory and the browser's build; the
    // used size changes all the time. Chrome only, read by bot detection like reCAPTCHA too.
    { id: 'performance.memory', owner: 'Performance', prop: 'memory', category: 'Hardware', reveals: 'memory limits', entropy: 0.15, rarity: 0.58 },
    { id: 'navigator.maxTouchPoints', owner: 'Navigator', prop: 'maxTouchPoints', category: 'Hardware', reveals: 'touch support', entropy: 0.25, rarity: 0.48 },
    { id: 'navigator.vendor', owner: 'Navigator', prop: 'vendor', category: 'Browser', reveals: 'browser vendor', entropy: 0.15, rarity: 0.63 },
    // Says almost nothing about the device (false in practically every real browser), but checking
    // for automation is what bot detection does.
    { id: 'navigator.webdriver', owner: 'Navigator', prop: 'webdriver', category: 'Automation', reveals: 'automation flag', entropy: 0.05, rarity: 1 },
    // The same fixed list in modern Chrome, so it tells little about the device, but it's read
    // almost only by fingerprinting.
    { id: 'navigator.plugins', owner: 'Navigator', prop: 'plugins', category: 'Plugins', reveals: 'plugins', entropy: 0.1, rarity: 0.68 },
    { id: 'navigator.mimeTypes', owner: 'Navigator', prop: 'mimeTypes', category: 'Plugins', reveals: 'plugins', entropy: 0.1, rarity: 0.86, same: 'navigator.plugins' },
    { id: 'navigator.pdfViewerEnabled', owner: 'Navigator', prop: 'pdfViewerEnabled', category: 'Plugins', reveals: 'PDF viewer', entropy: 0.05, rarity: 0.92 },
    // Settings almost every browser has the same way, but fingerprinters read them as a matter of course.
    { id: 'navigator.cookieEnabled', owner: 'Navigator', prop: 'cookieEnabled', category: 'Cookies', reveals: 'whether cookies are enabled', entropy: 0.05, rarity: 0.56 },
    { id: 'navigator.doNotTrack', owner: 'Navigator', prop: 'doNotTrack', category: 'Browser', reveals: 'Do Not Track setting', entropy: 0.2, rarity: 0.72 },
    // The battery's level and charging state: short-lived, but enough to link visits for a while.
    { id: 'navigator.getBattery', owner: 'Navigator', prop: 'getBattery', category: 'Battery', reveals: 'battery level and charging', entropy: 0.15, rarity: 0.82 },
    // The keyboard layout: tells regions and setups apart, and only a few games need it.
    { id: 'keyboard.getLayoutMap', owner: 'Keyboard', prop: 'getLayoutMap', category: 'Keyboard', reveals: 'keyboard layout', entropy: 0.3, rarity: 0.91 },
    // The storage quota depends on the free disk space and is much smaller in private windows.
    { id: 'storage.estimate', owner: 'StorageManager', prop: 'estimate', category: 'Storage', reveals: 'storage quota', entropy: 0.2, rarity: 0.88 },
    // The connection: the type is read for adaptive loading, the measured speed and latency rarely.
    { id: 'connection.effectiveType', owner: 'NetworkInformation', prop: 'effectiveType', category: 'Connection', reveals: 'connection type', entropy: 0.1, rarity: 0.56 },
    { id: 'connection.rtt', owner: 'NetworkInformation', prop: 'rtt', category: 'Connection', reveals: 'connection latency', entropy: 0.1, rarity: 0.63 },
    { id: 'connection.downlink', owner: 'NetworkInformation', prop: 'downlink', category: 'Connection', reveals: 'connection speed', entropy: 0.1, rarity: 0.65 },
    // The installed voices depend on the operating system, its version and language packs; only
    // text-to-speech needs them.
    { id: 'speech.getVoices', owner: 'SpeechSynthesis', prop: 'getVoices', category: 'Voices', reveals: 'speech voices', entropy: 0.55, rarity: 0.86 },

    // Screen
    { id: 'screen.width', owner: 'Screen', prop: 'width', category: 'ScreenSetup', reveals: 'screen size', entropy: 0.5, rarity: 0.31 },
    { id: 'screen.height', owner: 'Screen', prop: 'height', category: 'ScreenSetup', reveals: 'screen size', entropy: 0.05, rarity: 0.31 },
    // The space left by the taskbar, which tells operating systems and setups apart. A height's entropy
    // is what it adds beyond its width (the aspect ratio, the taskbar), not what it reveals alone.
    { id: 'screen.availWidth', owner: 'Screen', prop: 'availWidth', category: 'ScreenSetup', reveals: 'available screen size', entropy: 0.55, rarity: 0.68 },
    { id: 'screen.availHeight', owner: 'Screen', prop: 'availHeight', category: 'ScreenSetup', reveals: 'available screen size', entropy: 0.15, rarity: 0.67 },
    { id: 'screen.colorDepth', owner: 'Screen', prop: 'colorDepth', category: 'ScreenSetup', reveals: 'color depth', entropy: 0.1, rarity: 0.65 },
    { id: 'screen.pixelDepth', owner: 'Screen', prop: 'pixelDepth', category: 'ScreenSetup', reveals: 'color depth', entropy: 0.1, rarity: 0.88, same: 'screen.colorDepth' },
    { id: 'screen.orientation', owner: 'Screen', prop: 'orientation', category: 'ScreenSetup', reveals: 'screen orientation', entropy: 0.15, rarity: 0.86 },
    // Where the available space starts: the taskbar's or menu bar's side, and the screen's place
    // among several.
    { id: 'screen.availTop', owner: 'Screen', prop: 'availTop', category: 'ScreenSetup', reveals: 'screen position', entropy: 0.1, rarity: 0.83 },
    { id: 'screen.availLeft', owner: 'Screen', prop: 'availLeft', category: 'ScreenSetup', reveals: 'screen position', entropy: 0.05, rarity: 0.85 },

    // Window: the inner size is everyday layout, the outer size and position rarely needed.
    { id: 'window.innerWidth', owner: 'Window', prop: 'innerWidth', category: 'ScreenSetup', reveals: 'window size', entropy: 0.6, rarity: 0.28 },
    { id: 'window.innerHeight', owner: 'Window', prop: 'innerHeight', category: 'ScreenSetup', reveals: 'window size', entropy: 0.3, rarity: 0.3 },
    { id: 'window.outerWidth', owner: 'Window', prop: 'outerWidth', category: 'ScreenSetup', reveals: 'browser window size', entropy: 0.7, rarity: 0.68 },
    { id: 'window.outerHeight', owner: 'Window', prop: 'outerHeight', category: 'ScreenSetup', reveals: 'browser window size', entropy: 0.3, rarity: 0.7 },
    { id: 'window.devicePixelRatio', owner: 'Window', prop: 'devicePixelRatio', category: 'ScreenSetup', reveals: 'pixel density', entropy: 0.3, rarity: 0.4 },
    { id: 'window.screenX', owner: 'Window', prop: 'screenX', category: 'ScreenSetup', reveals: 'window position', entropy: 0.35, rarity: 0.83 },
    { id: 'window.screenY', owner: 'Window', prop: 'screenY', category: 'ScreenSetup', reveals: 'window position', entropy: 0.15, rarity: 0.82 },
    // Older names for screenX and screenY, with the same values.
    { id: 'window.screenLeft', owner: 'Window', prop: 'screenLeft', category: 'ScreenSetup', reveals: 'window position', entropy: 0.35, rarity: 0.86, same: 'window.screenX' },
    { id: 'window.screenTop', owner: 'Window', prop: 'screenTop', category: 'ScreenSetup', reveals: 'window position', entropy: 0.15, rarity: 0.86, same: 'window.screenY' },

    // Document: more tracking than fingerprinting, and read everywhere.
    { id: 'document.referrer', owner: 'Document', prop: 'referrer', category: 'Cookies', reveals: 'previous page', entropy: 0.05, rarity: 0.15 },
    { id: 'document.cookie', owner: 'Document', prop: 'cookie', category: 'Cookies', reveals: 'cookies', entropy: 0.05, rarity: 0.22 },

    // Canvas: reading back what was drawn shows how this device renders. Exporting or editing a
    // visible canvas is common; reading back a canvas that isn't on the page is canvas fingerprinting.
    { id: 'canvas.toDataURL', owner: 'HTMLCanvasElement', prop: 'toDataURL', category: 'CanvasImage', reveals: 'canvas image', entropy: 1, rarity: 0.86 },
    { id: 'canvas.hiddenToDataURL', owner: 'HTMLCanvasElement', prop: 'toDataURL', category: 'CanvasImage', reveals: 'hidden canvas image', entropy: 1, rarity: 1, same: 'canvas.toDataURL', readOf: { api: 'canvas.toDataURL', read: 'hiddenCanvas' } },
    { id: 'canvas.toBlob', owner: 'HTMLCanvasElement', prop: 'toBlob', category: 'CanvasImage', reveals: 'canvas image', entropy: 1, rarity: 0.99, same: 'canvas.toDataURL' },
    { id: 'canvas.hiddenToBlob', owner: 'HTMLCanvasElement', prop: 'toBlob', category: 'CanvasImage', reveals: 'hidden canvas image', entropy: 1, rarity: 1, same: 'canvas.toDataURL', readOf: { api: 'canvas.toBlob', read: 'hiddenCanvas' } },
    { id: 'canvas.getImageData', owner: 'CanvasRenderingContext2D', prop: 'getImageData', category: 'CanvasImage', reveals: 'canvas image', entropy: 1, rarity: 0.92, same: 'canvas.toDataURL' },
    { id: 'canvas.hiddenGetImageData', owner: 'CanvasRenderingContext2D', prop: 'getImageData', category: 'CanvasImage', reveals: 'hidden canvas image', entropy: 1, rarity: 1, same: 'canvas.toDataURL', readOf: { api: 'canvas.getImageData', read: 'hiddenCanvas' } },
    // Whether a point lies in a path drawn with the even-odd rule: the same in practically every
    // browser, but part of a canvas fingerprint (FingerprintJS's "winding"), and rare otherwise.
    { id: 'canvas.isPointInPath', owner: 'CanvasRenderingContext2D', prop: 'isPointInPath', category: 'CanvasImage', reveals: 'canvas path handling', entropy: 0.05, rarity: 0.96 },
    // Measuring text is everyday; measuring it in many different fonts is finding out which are installed.
    { id: 'canvas.measureText', owner: 'CanvasRenderingContext2D', prop: 'measureText', category: 'Fonts', reveals: 'text measurements', entropy: 0.1, rarity: 0.92 },
    { id: 'canvas.fontProbing', owner: 'CanvasRenderingContext2D', prop: 'measureText', category: 'Fonts', reveals: 'installed fonts', entropy: 0.85, rarity: 1, readOf: { api: 'canvas.measureText', read: 'fontProbing' } },

    // WebGL: 3D engines check capabilities and shader precision when they start, and read pixels
    // back to find what was clicked. The graphics card's maker and model (through
    // WEBGL_debug_renderer_info) are recorded on their own, as almost nothing but fingerprinting
    // needs them.
    { id: 'webgl.getParameter', owner: 'WebGLRenderingContext', prop: 'getParameter', category: 'GraphicsCard', reveals: 'graphics capabilities', entropy: 0.35, rarity: 0.71 },
    { id: 'webgl.gpuName', owner: 'WebGLRenderingContext', prop: 'getParameter', category: 'GraphicsCard', reveals: 'graphics card name', entropy: 0.75, rarity: 1, readOf: { api: 'webgl.getParameter', read: 'gpuName' } },
    { id: 'webgl.getExtension', owner: 'WebGLRenderingContext', prop: 'getExtension', category: 'GraphicsCard', reveals: 'graphics extensions', entropy: 0.1, rarity: 0.73 },
    { id: 'webgl.getSupportedExtensions', owner: 'WebGLRenderingContext', prop: 'getSupportedExtensions', category: 'GraphicsCard', reveals: 'supported graphics extensions', entropy: 0.55, rarity: 0.93 },
    { id: 'webgl.readPixels', owner: 'WebGLRenderingContext', prop: 'readPixels', category: 'GraphicsCard', reveals: 'rendered 3D image', entropy: 0.7, rarity: 0.6 },
    // The precision of the graphics card's shaders: 3D engines ask when they start, fingerprinters always do.
    { id: 'webgl.getShaderPrecisionFormat', owner: 'WebGLRenderingContext', prop: 'getShaderPrecisionFormat', category: 'GraphicsCard', reveals: 'shader precision', entropy: 0.2, rarity: 0.94 },
    // The context's settings (antialiasing and the like): mostly what was asked for, read back.
    { id: 'webgl.getContextAttributes', owner: 'WebGLRenderingContext', prop: 'getContextAttributes', category: 'GraphicsCard', reveals: 'graphics settings', entropy: 0.05, rarity: 0.9 },

    { id: 'webgl2.getParameter', owner: 'WebGL2RenderingContext', prop: 'getParameter', category: 'GraphicsCard', reveals: 'graphics capabilities', entropy: 0.35, rarity: 0.71, same: 'webgl.getParameter' },
    { id: 'webgl2.gpuName', owner: 'WebGL2RenderingContext', prop: 'getParameter', category: 'GraphicsCard', reveals: 'graphics card name', entropy: 0.75, rarity: 1, same: 'webgl.gpuName', readOf: { api: 'webgl2.getParameter', read: 'gpuName' } },
    { id: 'webgl2.getExtension', owner: 'WebGL2RenderingContext', prop: 'getExtension', category: 'GraphicsCard', reveals: 'graphics extensions', entropy: 0.1, rarity: 0.94, same: 'webgl.getExtension' },
    { id: 'webgl2.getSupportedExtensions', owner: 'WebGL2RenderingContext', prop: 'getSupportedExtensions', category: 'GraphicsCard', reveals: 'supported graphics extensions', entropy: 0.55, rarity: 0.98, same: 'webgl.getSupportedExtensions' },
    { id: 'webgl2.readPixels', owner: 'WebGL2RenderingContext', prop: 'readPixels', category: 'GraphicsCard', reveals: 'rendered 3D image', entropy: 0.7, rarity: 0.6, same: 'webgl.readPixels' },
    { id: 'webgl2.getShaderPrecisionFormat', owner: 'WebGL2RenderingContext', prop: 'getShaderPrecisionFormat', category: 'GraphicsCard', reveals: 'shader precision', entropy: 0.2, rarity: 0.94, same: 'webgl.getShaderPrecisionFormat' },
    { id: 'webgl2.getContextAttributes', owner: 'WebGL2RenderingContext', prop: 'getContextAttributes', category: 'GraphicsCard', reveals: 'graphics settings', entropy: 0.05, rarity: 0.9, same: 'webgl.getContextAttributes' },

    // WebGPU: asking for an adapter is how WebGPU content starts; its info names the graphics card's
    // maker and architecture, which only fingerprinting needs.
    { id: 'webgpu.requestAdapter', owner: 'GPU', prop: 'requestAdapter', category: 'GraphicsCard', reveals: 'WebGPU support', entropy: 0.05, rarity: 0.9 },
    { id: 'webgpu.adapterInfo', owner: 'GPUAdapter', prop: 'info', category: 'GraphicsCard', reveals: 'graphics card maker and architecture', entropy: 0.45, rarity: 0.95 },

    // Audio: setting up nodes is ordinary; rendering silently and reading the samples is fingerprinting.
    { id: 'audiocontext.createAnalyser', owner: 'AudioContext', prop: 'createAnalyser', category: 'Audio', reveals: 'audio setup', entropy: 0.1, rarity: 0.97 },
    { id: 'audiocontext.createOscillator', owner: 'AudioContext', prop: 'createOscillator', category: 'Audio', reveals: 'audio setup', entropy: 0.1, rarity: 0.93 },
    { id: 'offlineaudiocontext.startRendering', owner: 'OfflineAudioContext', prop: 'startRendering', category: 'Audio', reveals: 'rendered audio', entropy: 0.45, rarity: 0.93 },
    { id: 'audiobuffer.getChannelData', owner: 'AudioBuffer', prop: 'getChannelData', category: 'Audio', reveals: 'rendered audio', entropy: 0.45, rarity: 0.93, same: 'offlineaudiocontext.startRendering' },

    // Codecs: which audio and video formats the browser plays, which depends on the browser, its
    // build and the operating system. Video players ask too, for the formats they have.
    { id: 'media.canPlayType', owner: 'HTMLMediaElement', prop: 'canPlayType', category: 'Codecs', reveals: 'supported media formats', entropy: 0.15, rarity: 0.77 },
    { id: 'mediasource.isTypeSupported', owner: 'MediaSource', prop: 'isTypeSupported', category: 'Codecs', reveals: 'supported media formats', entropy: 0.15, rarity: 0.77, same: 'media.canPlayType' },
    // Media devices: the list of cameras and microphones is read silently; without permission it
    // only tells how many of each kind there are. getUserMedia asks first.
    { id: 'mediadevices.enumerateDevices', owner: 'MediaDevices', prop: 'enumerateDevices', category: 'MediaDevices', reveals: 'cameras and microphones', entropy: 0.15, rarity: 0.86 },
    { id: 'mediadevices.getUserMedia', owner: 'MediaDevices', prop: 'getUserMedia', category: 'MediaDevices', reveals: 'camera or microphone access', entropy: 0.05, rarity: 1 },

    // WebRTC: can reveal local network addresses; video calls use it legitimately.
    { id: 'webrtc.createDataChannel', owner: 'RTCPeerConnection', prop: 'createDataChannel', category: 'Network', reveals: 'WebRTC connection', entropy: 0.05, rarity: 0.93 },
    { id: 'webrtc.addIceCandidate', owner: 'RTCPeerConnection', prop: 'addIceCandidate', category: 'Network', reveals: 'local network addresses', entropy: 0.3, rarity: 0.94, same: 'webrtc.setLocalDescription' },
    { id: 'webrtc.setLocalDescription', owner: 'RTCPeerConnection', prop: 'setLocalDescription', category: 'Network', reveals: 'local network addresses', entropy: 0.3, rarity: 0.94 },

    // Intl: the time zone; date libraries read it too.
    { id: 'intl.datetimeformat.resolvedOptions', owner: 'IntlDateTimeFormat', prop: 'resolvedOptions', category: 'TimeZone', reveals: 'time zone', entropy: 0.4, rarity: 0.64 },
    { id: 'date.getTimezoneOffset', owner: 'Date', prop: 'getTimezoneOffset', category: 'TimeZone', reveals: 'time zone', entropy: 0.35, rarity: 0.1 },
];

export const FP_APIS_BY_ID: Record<string, FpApi> = Object.fromEntries(FP_APIS.map((api) => [api.id, api]));

/** The average entropy of each kind's APIs: how identifying the kind is, for listing kinds in order. */
export const FP_CATEGORY_ENTROPY: Record<string, number> = Object.fromEntries(
    Object.entries(Object.groupBy(FP_APIS, (api) => api.category)).map(([category, apis]) => [
        category,
        apis!.reduce((sum, api) => sum + api.entropy, 0) / apis!.length,
    ])
);
