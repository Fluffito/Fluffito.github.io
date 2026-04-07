// content.js — APHELION (clean, worker-enabled, pattern-first, iframe+shadow support)
// This version renders the censor glyph via CSS ::before so no visible text nodes are inserted.

if (typeof globalThis.chrome === "undefined" && typeof globalThis.browser !== "undefined") {
  globalThis.chrome = globalThis.browser;
}
if (typeof globalThis.browser !== "undefined" && globalThis.chrome === globalThis.browser) {
  const runtime = globalThis.chrome && globalThis.chrome.runtime;
  let shimLastError = null;

  if (runtime && !Object.getOwnPropertyDescriptor(runtime, "lastError")) {
    Object.defineProperty(runtime, "lastError", {
      configurable: true,
      enumerable: true,
      get() {
        return shimLastError;
      }
    });
  }

  const setLastError = (error) => {
    shimLastError = error ? { message: error.message || String(error) } : null;
  };

  const wrapWebExtensionMethod = (target, methodName) => {
    if (!target || typeof target[methodName] !== "function") return;
    const original = target[methodName].bind(target);
    target[methodName] = (...args) => {
      const maybeCallback = args[args.length - 1];
      if (typeof maybeCallback !== "function") {
        return original(...args);
      }

      const callback = args.pop();
      setLastError(null);

      try {
        const result = original(...args);
        if (result && typeof result.then === "function") {
          result.then((value) => {
            callback(value);
            setTimeout(() => setLastError(null), 0);
          }).catch((error) => {
            setLastError(error);
            callback();
            setTimeout(() => setLastError(null), 0);
          });
          return;
        }
        callback(result);
        setTimeout(() => setLastError(null), 0);
      } catch (error) {
        setLastError(error);
        callback();
        setTimeout(() => setLastError(null), 0);
      }
    };
  };

  wrapWebExtensionMethod(globalThis.chrome.storage && globalThis.chrome.storage.local, "get");
  wrapWebExtensionMethod(globalThis.chrome.storage && globalThis.chrome.storage.local, "set");
  wrapWebExtensionMethod(globalThis.chrome.tabs, "sendMessage");
}
console.log("[content] content.js loaded on", document.location.href);

const DEBUG = true;
const CENSOR_CLASS = "aphelion-censor-v5";
const PROCESSED_FLAG = "data-aphelion-processed-v5";
const IMAGE_BLOCK_CLASS = "aphelion-image-blocked-v1";
const IMAGE_HIDE_CLASS = "aphelion-image-hidden-v1";
const IMAGE_PROCESSED_FLAG = "data-aphelion-image-processed-v1";
const IMAGE_ORIG_SRC_ATTR = "data-aphelion-orig-src";
const IMAGE_ORIG_SRCSET_ATTR = "data-aphelion-orig-srcset";
const DEFAULT_REPLACEMENT_IMAGE_URL = "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='360' viewBox='0 0 640 360'%3E%3Crect width='640' height='360' fill='%23111111'/%3E%3Ctext x='50%25' y='48%25' dominant-baseline='middle' text-anchor='middle' fill='%23c7b3ff' font-family='Arial,sans-serif' font-size='30'%3EAPHELION%3C/text%3E%3Ctext x='50%25' y='60%25' dominant-baseline='middle' text-anchor='middle' fill='%239a94c9' font-family='Arial,sans-serif' font-size='18'%3EBONKED%3C/text%3E%3C/svg%3E";

// Glyph rendered via CSS pseudo-element (no textContent)
const CENSOR_GLYPH = "✦✦✦";

// Minimal confusable and emoji families (extend as needed)
const CONFUSABLE_MAP = {
  "a": ["\u0391", "\u0410", "\uFF21"],
  "e": ["\u0395", "\u0415", "\uFF25"],
  "o": ["\u039F", "\u041E", "\uFF2F"],
  "i": ["\u0406", "\u0131", "\uFF29"]
};
const EMOJI_FAMILIES = {
  "eye": ["\u{1F441}", "\u{1F440}", "\u{1F9FF}"],
  "mouth": ["\u{1F444}", "\u{1F445}", "\u{1F48B}"]
};
const EMOJI_TO_FAMILY = {
  "\u{1F441}": "eye",
  "\u{1F440}": "eye",
  "\u{1F9FF}": "eye",
  "\u{1F444}": "mouth",
  "\u{1F445}": "mouth",
  "\u{1F48B}": "mouth"
};

// --- normalization functions ---
function normalizeNFKC(s) { return String(s || "").normalize("NFKC"); }
function stripDiacritics(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
function removeZWJAndVS(s) { return String(s || "").replace(/[\u200D\uFE0E\uFE0F]/g, ""); }
function mapFullwidthToAscii(s) { return s.replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFF01 + 0x21)); }
function applyConfusableMapChar(ch) {
  for (const base in CONFUSABLE_MAP) {
    if (CONFUSABLE_MAP[base].includes(ch)) return base;
  }
  return ch.toLowerCase();
}
function collapseWhitespace(s) { return s.replace(/\s+/g, " ").trim(); }
function heavyNormalize(s) {
  if (s == null) return "";
  let t = String(s);
  t = normalizeNFKC(t);
  t = stripDiacritics(t);
  t = removeZWJAndVS(t);
  t = mapFullwidthToAscii(t);
  let out = "";
  for (const ch of Array.from(t)) out += applyConfusableMapChar(ch);
  return collapseWhitespace(out).toLowerCase();
}

function escapeForRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPatternFromRaw(raw) {
  if (!raw) return /(?:)/g;
  const units = Array.from(String(raw));
  const parts = units.map(u => {
    if (EMOJI_TO_FAMILY[u]) {
      const family = EMOJI_FAMILIES[EMOJI_TO_FAMILY[u]] || [u];
      return "(?:" + family.map(escapeForRegex).join("|") + ")";
    }
    const mapped = applyConfusableMapChar(normalizeNFKC(u));
    return escapeForRegex(mapped);
  });
  const spacer = "(?:[\\s\\uFE0E\\uFE0F\\u200D]*)";
  try {
    return new RegExp(parts.join(spacer), "g");
  } catch (e) {
    const fallback = escapeForRegex(heavyNormalize(raw));
    return new RegExp(fallback, "g");
  }
}

// --- Worker code (string) ---
const workerCode = `
  const CONFUSABLE_MAP = ${JSON.stringify(CONFUSABLE_MAP)};
  const EMOJI_FAMILIES = ${JSON.stringify(EMOJI_FAMILIES)};
  const EMOJI_TO_FAMILY = ${JSON.stringify(EMOJI_TO_FAMILY)};

  function normalizeNFKC(s) { return String(s || "").normalize("NFKC"); }
  function stripDiacritics(s) { return String(s || "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, ""); }
  function removeZWJAndVS(s) { return String(s || "").replace(/[\\u200D\\uFE0E\\uFE0F]/g, ""); }
  function mapFullwidthToAscii(s) { return s.replace(/[\\uFF01-\\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFF01 + 0x21)); }
  function applyConfusableMapChar(ch) {
    for (const base in CONFUSABLE_MAP) {
      if (CONFUSABLE_MAP[base].includes(ch)) return base;
    }
    return ch.toLowerCase();
  }
  function collapseWhitespace(s) { return s.replace(/\\s+/g, " ").trim(); }
  function heavyNormalize(s) {
    if (s == null) return "";
    let t = String(s);
    t = normalizeNFKC(t);
    t = stripDiacritics(t);
    t = removeZWJAndVS(t);
    t = mapFullwidthToAscii(t);
    let out = "";
    for (const ch of Array.from(t)) out += applyConfusableMapChar(ch);
    return collapseWhitespace(out).toLowerCase();
  }
  function escapeForRegex(s) { return String(s).replace(/[.*+?^\${}()|[\]\\]/g, (match) => '\\' + match); }

  function buildPatternFromRaw(raw) {
    if (!raw) return new RegExp("", "g");
    const units = Array.from(String(raw));
    const parts = units.map(u => {
      if (EMOJI_TO_FAMILY[u]) {
        const family = EMOJI_FAMILIES[EMOJI_TO_FAMILY[u]] || [u];
        const escaped = family.map(e => e.replace(/[.*+?^\${}()|[\]\\]/g, (match) => '\\' + match)).join("|");
        return "(?:" + escaped + ")";
      } else {
        const mapped = applyConfusableMapChar(normalizeNFKC(u));
        return escapeForRegex(mapped);
      }
    });
    const spacer = "(?:[\\\\s\\\\uFE0E\\\\uFE0F\\\\u200D]*)";
    try {
      return new RegExp(parts.join(spacer), "g");
    } catch (e) {
      const fallback = heavyNormalize(raw).replace(/[.*+?^\${}()|[\]\\]/g, (match) => '\\' + match);
      return new RegExp(fallback, "g");
    }
  }

  let patterns = []; // { id, raw, regex }

  self.onmessage = (ev) => {
    const msg = ev.data;
    if (!msg || !msg.type) return;
    if (msg.type === "init" || msg.type === "updateBlacklist") {
      const list = Array.isArray(msg.blacklist) ? msg.blacklist : [];
      patterns = [];
      for (const entry of list) {
        const baseRaw = entry && typeof entry.raw === "string" ? entry.raw : (entry && typeof entry.key === "string" ? entry.key : "");
        const addPattern = (text, useExplicitPattern = false) => {
          if (!text) return;
          const regex = useExplicitPattern && entry && entry.pattern ? (() => {
            try { return new RegExp(entry.pattern, "g"); } catch(e) { return buildPatternFromRaw(text); }
          })() : buildPatternFromRaw(text);
          patterns.push({ id: entry.id || null, raw: text, regex });
        };
        addPattern(baseRaw, true);
        if (Array.isArray(entry.variants)) {
          for (const variant of entry.variants) {
            if (typeof variant === "string" && variant && variant !== baseRaw) {
              addPattern(variant, false);
            }
          }
        }
      }
      self.postMessage({ type: "inited" });
    } else if (msg.type === "scan") {
      const id = msg.id;
      const text = String(msg.text || "");
      const normChars = [];
      const map = [];
      const nfkd = normalizeNFKC(text);
      const stripped = stripDiacritics(nfkd);
      const noZWJ = removeZWJAndVS(stripped);
      const fullMapped = mapFullwidthToAscii(noZWJ);
      for (let i = 0; i < fullMapped.length; i++) {
        const ch = fullMapped[i];
        const mapped = applyConfusableMapChar(ch);
        for (let j = 0; j < mapped.length; j++) {
          normChars.push(mapped[j]);
          map.push(i);
        }
      }
      const normalized = normChars.join("");
      const matches = [];
      for (const p of patterns) {
        try {
          const re = new RegExp(p.regex.source, "g");
          let m;
          while ((m = re.exec(normalized)) !== null) {
            const startNorm = m.index;
            const endNorm = m.index + m[0].length;
            const origStart = map[startNorm];
            const origEnd = map[endNorm - 1] + 1;
            matches.push({ start: origStart, end: origEnd });
            if (m.index === re.lastIndex) re.lastIndex++;
          }
        } catch (e) {
          // ignore pattern errors
        }
      }
      self.postMessage({ type: "scanResult", id, matches });
    }
  };
`;

// --- create worker ---
let worker = null; // Disabled to avoid CSP issues on restricted sites
console.log("[content] worker disabled, using main-thread scanning");

// --- state ---
let aphelionEntries = [];
let censorGlyph = "✦✦✦"; // Default
const pendingNodes = new Map(); // id -> { node, text }
let nodeIdCounter = 1;
let processingScheduled = false;
let periodicScanId = null;
let imagePatterns = [];
const pendingImages = new Set();
let imageProcessingScheduled = false;
let imageBlockMode = "blur";
let replacementImageUrl = "";
let subscriptionPlan = "free";
let blockSoundEnabled = false;
let blockSoundDataUrl = "";
let blockSoundVolume = 0.65;
let lastBlockSoundAt = 0;
let sharedAudioContext = null;
let pendingBlockSound = false;
let activeCustomBlockAudio = null;
const FREE_IMAGE_LIMIT = 50;
const PLAN_UNLIMITED = "unlimited-bonk";
const UPGRADE_URL = "https://fluffito.github.io/APHELIION/#pricing";
let imageLimitNoticeShown = false;
let featureGateNoticeTimer = null;

// --- helpers ---
function log(...args) { if (DEBUG) console.log("[aphelion]", ...args); }

// --- CSS-driven censor span (no text nodes) ---
function injectStyles() {
  if (document.getElementById("aphelion-censor-style-v5")) return;
  const style = document.createElement("style");
  style.id = "aphelion-censor-style-v5";
  style.textContent = `
    /* Render the glyph via textContent now */
    .${CENSOR_CLASS} {
      display: inline-block;
      width: auto;
      vertical-align: baseline;
      pointer-events: none;
      user-select: none;
      line-height: inherit;
      font-family: inherit;
      color: inherit;
      background: transparent;
      all: unset;
      white-space: nowrap;
    }

    .${IMAGE_BLOCK_CLASS} {
      filter: blur(24px) saturate(0.8) !important;
      transition: filter 140ms ease;
      pointer-events: none !important;
      user-select: none !important;
    }

    .${IMAGE_HIDE_CLASS} {
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function createCensorSpan() {
  const span = document.createElement("span");
  span.className = CENSOR_CLASS;
  span.setAttribute(PROCESSED_FLAG, "1");
  span.textContent = censorGlyph;
  return span;
}

function isInsideCensor(node) {
  let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  while (el) {
    if (el.classList && el.classList.contains(CENSOR_CLASS)) return true;
    el = el.parentElement;
  }
  return false;
}

// --- load blacklist and init worker ---
function normalizeEntryObject(e) {
  const raw = typeof e === "string"
    ? e
    : (typeof e?.raw === "string" ? e.raw : (typeof e?.key === "string" ? e.key : ""));
  return {
    id: e && typeof e === "object" && e.id ? e.id : `b_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
    raw,
    pattern: typeof e?.pattern === "string" && e.pattern.length ? e.pattern : null,
    key: typeof e?.key === "string" ? e.key : null,
    variants: Array.isArray(e?.variants) ? e.variants.slice() : []
  };
}

function rebuildImagePatterns() {
  const seen = new Set();
  const out = [];
  for (const entry of aphelionEntries) {
    if (!entry) continue;
    const sources = [];
    if (entry.raw) sources.push(entry.raw);
    if (entry.key) sources.push(entry.key);
    if (Array.isArray(entry.variants)) sources.push(...entry.variants);
    for (const source of sources) {
      const norm = heavyNormalize(source);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      try {
        out.push(buildPatternFromRaw(source));
      } catch (e) {
        // ignore invalid pattern source
      }
    }
  }
  imagePatterns = out;
  log("rebuilt image patterns", imagePatterns.length);
}

function normalizeImageMode(value) {
  return value === "hide" || value === "replace" ? value : "blur";
}

function safeReplacementUrl(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v) || /^data:image\//i.test(v)) return v;
  return "";
}

function normalizePlanTier(value) {
  return value === PLAN_UNLIMITED ? PLAN_UNLIMITED : "free";
}

function isUnlimitedPlan() {
  return subscriptionPlan === PLAN_UNLIMITED;
}

function safeSoundUrl(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v) || /^data:audio\//i.test(v)) return v;
  return "";
}

function normalizeSoundVolume(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.65;
  return Math.max(0, Math.min(1, n));
}

function getSharedAudioContext() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  if (!sharedAudioContext) {
    try {
      sharedAudioContext = new AudioCtor();
    } catch (error) {
      return null;
    }
  }
  return sharedAudioContext;
}

function playDefaultBlockSound() {
  const ctx = getSharedAudioContext();
  if (!ctx) return Promise.resolve(false);

  const startPlayback = () => {
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(70, now + 0.16);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.02, blockSoundVolume * 0.35), now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
      return true;
    } catch (error) {
      return false;
    }
  };

  if (ctx.state === "running") {
    return Promise.resolve(startPlayback());
  }

  return ctx.resume()
    .then(() => (ctx.state === "running" ? startPlayback() : false))
    .catch(() => false);
}

function playCustomBlockSound() {
  if (!blockSoundDataUrl) return Promise.resolve(false);

  try {
    if (activeCustomBlockAudio) {
      try {
        activeCustomBlockAudio.pause();
      } catch (error) {
        // ignore old audio cleanup issues
      }
    }

    const audio = new Audio(blockSoundDataUrl);
    activeCustomBlockAudio = audio;
    audio.volume = blockSoundVolume;
    audio.currentTime = 0;
    return audio.play().then(() => true).catch(() => false);
  } catch (error) {
    return Promise.resolve(false);
  }
}

function playImageBlockSound(force = false) {
  if (!blockSoundEnabled || !isUnlimitedPlan()) return;

  const now = Date.now();
  if (!force && now - lastBlockSoundAt < 225) return;
  lastBlockSoundAt = now;
  pendingBlockSound = true;

  playCustomBlockSound()
    .then((playedCustom) => {
      if (playedCustom) {
        pendingBlockSound = false;
        return true;
      }
      return playDefaultBlockSound().then((playedDefault) => {
        pendingBlockSound = !playedDefault;
        return playedDefault;
      });
    })
    .catch(() => {
      pendingBlockSound = true;
    });
}

if (typeof window !== "undefined") {
  const unlockBlockSound = () => {
    const ctx = getSharedAudioContext();
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    if (pendingBlockSound) {
      playImageBlockSound(true);
    }
  };

  ["pointerdown", "keydown", "mousedown"].forEach((eventName) => {
    window.addEventListener(eventName, unlockBlockSound, { passive: true, capture: true });
  });
}

function currentBlockedImageCount() {
  return document.querySelectorAll(`img[${IMAGE_PROCESSED_FLAG}="1"]`).length;
}

function showUpgradeNotice(message) {
  if (imageLimitNoticeShown || !document || !document.body) return;
  imageLimitNoticeShown = true;

  const notice = document.createElement("div");
  notice.setAttribute("data-aphelion-upgrade-notice", "1");
  notice.style.cssText = [
    "position:fixed",
    "right:16px",
    "bottom:16px",
    "z-index:2147483647",
    "max-width:320px",
    "padding:12px 14px",
    "border-radius:14px",
    "border:1px solid rgba(155,107,255,0.45)",
    "background:rgba(12,12,18,0.96)",
    "box-shadow:0 16px 36px rgba(0,0,0,0.35)",
    "color:#f3f0ff",
    "font:13px/1.45 system-ui,sans-serif"
  ].join(";");

  const text = document.createElement("div");
  text.textContent = message;

  const link = document.createElement("a");
  link.href = UPGRADE_URL;
  link.target = "_blank";
  link.rel = "noreferrer noopener";
  link.textContent = "See pricing";
  link.style.cssText = "display:inline-block;margin-top:8px;color:#c7b3ff;font-weight:700;text-decoration:none;";

  notice.appendChild(text);
  notice.appendChild(link);
  document.body.appendChild(notice);

  clearTimeout(featureGateNoticeTimer);
  featureGateNoticeTimer = setTimeout(() => {
    try { notice.remove(); } catch (error) {}
  }, 6500);
}

function collectImageSignals(img) {
  if (!img || img.nodeType !== Node.ELEMENT_NODE) return "";
  const parts = [];
  const push = (v) => {
    if (!v) return;
    const t = String(v).trim();
    if (t) parts.push(t);
  };
  push(img.getAttribute("alt"));
  push(img.getAttribute("title"));
  push(img.getAttribute("aria-label"));
  push(img.getAttribute("src"));
  push(img.getAttribute("data-src"));
  push(img.currentSrc || img.src);

  const figure = img.closest && img.closest("figure");
  if (figure) {
    const cap = figure.querySelector && figure.querySelector("figcaption");
    if (cap) push(cap.textContent);
  }

  const parent = img.parentElement;
  if (parent) {
    push(parent.getAttribute && parent.getAttribute("aria-label"));
    const parentText = (parent.textContent || "").trim();
    if (parentText) push(parentText.slice(0, 240));
  }
  return parts.join(" ");
}

function isImageBlockedByPatterns(img) {
  if (!imagePatterns.length) return false;
  const signal = heavyNormalize(collectImageSignals(img));
  if (!signal) return false;
  for (const re of imagePatterns) {
    try {
      const flags = re.flags.includes("g") ? re.flags : (re.flags + "g");
      const probe = new RegExp(re.source, flags);
      if (probe.test(signal)) return true;
    } catch (e) {
      // ignore malformed regex and continue
    }
  }
  return false;
}

function applyImageBlock(img) {
  if (!img || img.nodeType !== Node.ELEMENT_NODE) return;
  img.classList.remove(IMAGE_BLOCK_CLASS, IMAGE_HIDE_CLASS);
  if (imageBlockMode === "hide") {
    img.classList.add(IMAGE_HIDE_CLASS);
  } else if (imageBlockMode === "replace" && replacementImageUrl) {
    if (!img.hasAttribute(IMAGE_ORIG_SRC_ATTR)) {
      img.setAttribute(IMAGE_ORIG_SRC_ATTR, img.getAttribute("src") || "");
    }
    if (!img.hasAttribute(IMAGE_ORIG_SRCSET_ATTR)) {
      img.setAttribute(IMAGE_ORIG_SRCSET_ATTR, img.getAttribute("srcset") || "");
    }
    img.setAttribute("src", replacementImageUrl);
    img.removeAttribute("srcset");
  } else if (imageBlockMode === "replace") {
    if (!img.hasAttribute(IMAGE_ORIG_SRC_ATTR)) {
      img.setAttribute(IMAGE_ORIG_SRC_ATTR, img.getAttribute("src") || "");
    }
    if (!img.hasAttribute(IMAGE_ORIG_SRCSET_ATTR)) {
      img.setAttribute(IMAGE_ORIG_SRCSET_ATTR, img.getAttribute("srcset") || "");
    }
    img.setAttribute("src", DEFAULT_REPLACEMENT_IMAGE_URL);
    img.removeAttribute("srcset");
  } else {
    img.classList.add(IMAGE_BLOCK_CLASS);
  }
  img.setAttribute(IMAGE_PROCESSED_FLAG, "1");
}

function removeImageBlock(img) {
  if (!img || img.nodeType !== Node.ELEMENT_NODE) return;
  img.classList.remove(IMAGE_BLOCK_CLASS, IMAGE_HIDE_CLASS);
  if (img.hasAttribute(IMAGE_ORIG_SRC_ATTR)) {
    const origSrc = img.getAttribute(IMAGE_ORIG_SRC_ATTR) || "";
    if (origSrc) img.setAttribute("src", origSrc);
    else img.removeAttribute("src");
    img.removeAttribute(IMAGE_ORIG_SRC_ATTR);
  }
  if (img.hasAttribute(IMAGE_ORIG_SRCSET_ATTR)) {
    const origSrcset = img.getAttribute(IMAGE_ORIG_SRCSET_ATTR) || "";
    if (origSrcset) img.setAttribute("srcset", origSrcset);
    else img.removeAttribute("srcset");
    img.removeAttribute(IMAGE_ORIG_SRCSET_ATTR);
  }
  img.removeAttribute(IMAGE_PROCESSED_FLAG);
}

function scanSingleImage(img) {
  if (!img || img.tagName !== "IMG") return;
  const alreadyBlocked = img.getAttribute(IMAGE_PROCESSED_FLAG) === "1";
  if (isImageBlockedByPatterns(img)) {
    if (!alreadyBlocked && !isUnlimitedPlan() && currentBlockedImageCount() >= FREE_IMAGE_LIMIT) {
      removeImageBlock(img);
      showUpgradeNotice(`Free blocks up to ${FREE_IMAGE_LIMIT} images per page. Upgrade to Unlimited Bonk for unlimited image blocking.`);
      return;
    }
    applyImageBlock(img);
    if (!alreadyBlocked) {
      playImageBlockSound();
    }
  } else {
    removeImageBlock(img);
  }
}

function queueImageForScan(img) {
  if (!img || img.tagName !== "IMG") return;
  pendingImages.add(img);
  scheduleImageProcessing();
}

function queueImagesFromNode(node) {
  if (!node) return;
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node;
    if (el.tagName === "IMG") queueImageForScan(el);
    if (el.querySelectorAll) {
      el.querySelectorAll("img").forEach(queueImageForScan);
    }
  }
}

function processImageBatch() {
  if (!pendingImages.size) return;
  const batch = Array.from(pendingImages).slice(0, 40);
  for (const img of batch) {
    pendingImages.delete(img);
    scanSingleImage(img);
  }
  if (pendingImages.size) scheduleImageProcessing();
}

function scheduleImageProcessing() {
  if (imageProcessingScheduled) return;
  imageProcessingScheduled = true;
  const run = () => {
    imageProcessingScheduled = false;
    processImageBatch();
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 500 });
  else setTimeout(run, 120);
}

function queueAllImages(root = document) {
  try {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll("img").forEach(queueImageForScan);
  } catch (e) {
    // no-op
  }
}

function loadBlacklist(cb) {
  try {
    chrome.storage.local.get([
      "blacklist",
      "censorGlyph",
      "imageBlockMode",
      "replacementImageUrl",
      "planTier",
      "imageBlockSoundEnabled",
      "blockSoundDataUrl",
      "blockSoundVolume"
    ], res => {
      const raw = Array.isArray(res?.blacklist) ? res.blacklist : [];
      aphelionEntries = raw.map(normalizeEntryObject);
      rebuildImagePatterns();
      censorGlyph = typeof res?.censorGlyph === "string" ? res.censorGlyph : "✦✦✦";
      imageBlockMode = normalizeImageMode(res?.imageBlockMode);
      replacementImageUrl = safeReplacementUrl(res?.replacementImageUrl);
      subscriptionPlan = normalizePlanTier(res?.planTier);
      const paidUnlocked = subscriptionPlan === PLAN_UNLIMITED;
      blockSoundEnabled = paidUnlocked && Boolean(res?.imageBlockSoundEnabled);
      blockSoundDataUrl = paidUnlocked ? safeSoundUrl(res?.blockSoundDataUrl) : "";
      blockSoundVolume = normalizeSoundVolume(res?.blockSoundVolume);
      log("loaded blacklist", aphelionEntries.length, "glyph:", censorGlyph, "plan:", subscriptionPlan, "sound:", blockSoundEnabled ? "on" : "off");
      if (worker) {
        try { worker.postMessage({ type: "updateBlacklist", blacklist: aphelionEntries }); }
        catch (err) { log("worker update failed", err); }
      }
      if (typeof cb === "function") cb(aphelionEntries);
    });
  } catch (e) {
    aphelionEntries = [];
    censorGlyph = "✦✦✦";
    blockSoundEnabled = false;
    blockSoundDataUrl = "";
    blockSoundVolume = 0.65;
    log("loadBlacklist failed", e);
    if (typeof cb === "function") cb(aphelionEntries);
  }
}

// --- worker message handling ---
if (worker) {
  worker.onmessage = (ev) => {
    const msg = ev.data;
    if (!msg || !msg.type) return;
    if (msg.type === "scanResult") {
      const id = msg.id;
      const entry = pendingNodes.get(id);
      if (entry) {
        pendingNodes.delete(id);
        log("worker scanResult", id, msg.matches);
        applyMatchesToNode(entry.node, msg.matches);
      } else {
        log("worker scanResult missing pending entry", id, msg.matches);
      }
    }
  };
}

function queueTextNodeForScan(node) {
  if (!node || !node.nodeValue || !node.nodeValue.trim()) return;
  if (isInsideCensor(node)) return;
  for (const entry of pendingNodes.values()) if (entry.node === node) return;
  const id = nodeIdCounter++;
  pendingNodes.set(id, { node, text: node.nodeValue });
  scheduleProcessing();
}

function scheduleProcessing() {
  if (processingScheduled) return;
  processingScheduled = true;
  const run = () => {
    processingScheduled = false;
    processBatch();
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 500 });
  else setTimeout(run, 120);
}

function processBatch() {
  if (!pendingNodes.size) return;
  const entries = Array.from(pendingNodes.entries()).slice(0, 40);
  for (const [id, entry] of entries) {
    if (worker) {
      try {
        worker.postMessage({ type: "scan", id, text: entry.text });
      } catch (e) {
        runMainThreadScan(id, entry);
      }
    } else {
      runMainThreadScan(id, entry);
    }
  }
}

// main-thread fallback (simplified normalized substring matching)
function runMainThreadScan(id, entry) {
  try {
    const original = entry.text;
    const normChars = [];
    const map = [];
    const nfkd = String(original).normalize("NFKC");
    const stripped = nfkd.normalize ? nfkd.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : nfkd;
    const noZWJ = stripped.replace(/[\u200D\uFE0E\uFE0F]/g, "");
    const fullMapped = noZWJ.replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFF01 + 0x21));
    for (let i = 0; i < fullMapped.length; i++) {
      const ch = fullMapped[i];
      let mapped = ch.toLowerCase();
      for (const base in CONFUSABLE_MAP) {
        if (CONFUSABLE_MAP[base].includes(ch)) { mapped = base; break; }
      }
      for (let j = 0; j < mapped.length; j++) {
        normChars.push(mapped[j]);
        map.push(i);
      }
    }
    const normalized = normChars.join("");
    const matches = [];
    for (const entryObj of aphelionEntries) {
      if (!entryObj) continue;
      const sources = new Set();
      if (entryObj.pattern) sources.add(entryObj.pattern);
      if (entryObj.raw) sources.add(entryObj.raw);
      if (entryObj.key) sources.add(entryObj.key);
      if (Array.isArray(entryObj.variants)) entryObj.variants.forEach(v => v && sources.add(v));
      for (const pat of sources) {
        const regex = buildPatternFromRaw(pat);
        let m;
        while ((m = regex.exec(normalized)) !== null) {
          const startNorm = m.index;
          const endNorm = m.index + m[0].length;
          const start = map[startNorm];
          const end = map[endNorm - 1] + 1;
          if (Number.isInteger(start) && Number.isInteger(end) && end > start) {
            matches.push({ start, end });
          }
          if (m.index === regex.lastIndex) regex.lastIndex++;
        }
      }
    }
    pendingNodes.delete(id);
    log("mainThreadScan", entry.text.slice(0,80), matches);
    applyMatchesToNode(entry.node, matches);
  } catch (e) {
    pendingNodes.delete(id);
    log("mainThreadScan error", e);
  }
}

function applyMatchesToNode(textNode, matches) {
  if (!matches || !matches.length) return;
  const original = textNode.nodeValue;
  log("applyMatchesToNode", original.slice(0,80), matches);
  playImageBlockSound();
  matches.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const m of matches) {
    if (!merged.length) merged.push(m);
    else {
      const last = merged[merged.length - 1];
      if (m.start <= last.end) last.end = Math.max(last.end, m.end);
      else merged.push(m);
    }
  }
  const parent = textNode.parentNode;
  if (!parent) return;
  let anchor = textNode;
  let offset = 0;
  for (const { start, end } of merged) {
    if (start > offset) {
      parent.insertBefore(document.createTextNode(original.slice(offset, start)), anchor);
    }
    parent.insertBefore(createCensorSpan(), anchor);
    offset = end;
  }
  if (offset < original.length) {
    parent.insertBefore(document.createTextNode(original.slice(offset)), anchor);
  }
  parent.removeChild(textNode);
}

// MutationObserver + initial scan
const observer = new MutationObserver(mutations => {
  let added = false;
  for (const m of mutations) {
    try {
      if (m.type === "characterData" && m.target.nodeType === Node.TEXT_NODE) {
        queueTextNodeForScan(m.target);
        added = true;
      }
      if (m.addedNodes && m.addedNodes.length) {
        m.addedNodes.forEach(n => {
          if (n.nodeType === Node.TEXT_NODE) queueTextNodeForScan(n);
          else if (n.nodeType === Node.ELEMENT_NODE) {
            queueImagesFromNode(n);
            n.querySelectorAll && n.querySelectorAll("*").forEach(ch => {
              if (ch.childNodes && ch.childNodes.length) {
                ch.childNodes.forEach(cn => {
                  if (cn.nodeType === Node.TEXT_NODE) queueTextNodeForScan(cn);
                });
              }
            });
            if (n.shadowRoot) {
              try {
                n.shadowRoot.querySelectorAll && n.shadowRoot.querySelectorAll("*").forEach(ch => {
                  if (ch.childNodes && ch.childNodes.length) {
                    ch.childNodes.forEach(cn => {
                      if (cn.nodeType === Node.TEXT_NODE) queueTextNodeForScan(cn);
                    });
                  }
                });
              } catch (e) {}
            }
          }
        });
        added = true;
      }
    } catch (e) {}
  }
  if (added) scheduleProcessing();
});

function attachObserversAndScan(root = document.body) {
  try {
    if (!root) return;
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    queueAllImages(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return NodeFilter.FILTER_REJECT;
        if (parent.closest && parent.closest(`.${CENSOR_CLASS}`)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = walker.nextNode())) queueTextNodeForScan(n);
    scheduleProcessing();
  } catch (e) {}
}

function attachToFramesAndShadows() {
  document.querySelectorAll("iframe").forEach(frame => {
    try {
      const doc = frame.contentDocument;
      if (doc && doc.body) attachObserversAndScan(doc.body);
    } catch (e) {}
  });
  document.querySelectorAll("*").forEach(el => {
    try {
      if (el.shadowRoot) attachObserversAndScan(el.shadowRoot);
    } catch (e) {}
  });
}

function scheduleFullRescan(delay = 1000) {
  if (periodicScanId) clearTimeout(periodicScanId);
  periodicScanId = setTimeout(() => {
    try {
      attachObserversAndScan(document.body || document.documentElement);
      attachToFramesAndShadows();
      queueAllImages(document);
    } catch (e) {}
  }, delay);
}

// storage change listener to reload patterns
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    if (changes.blacklist || changes.censorGlyph || changes.imageBlockMode || changes.replacementImageUrl || changes.planTier || changes.imageBlockSoundEnabled || changes.blockSoundDataUrl || changes.blockSoundVolume) {
      loadBlacklist(() => {
        if (worker) try { worker.postMessage({ type: "updateBlacklist", blacklist: aphelionEntries }); } catch (e) {}
        scheduleFullRescan(50);
      });
    }
  }
});

// message listener (allow background to trigger reload)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "RELOAD_CENSOR") {
    loadBlacklist(() => {
      if (worker) try { worker.postMessage({ type: "updateBlacklist", blacklist: aphelionEntries }); } catch (e) {}
      scheduleFullRescan(50);
    });
    sendResponse({ ok: true });
    return true;
  }
});

if (typeof window !== "undefined") {
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || typeof msg !== "object" || msg.sender !== "aphelion-site-panel") return;

    if (msg.type === "APHELION_WEBSITE_GET_SETTINGS") {
      chrome.storage.local.get([
        "censorGlyph",
        "imageBlockMode",
        "replacementImageUrl",
        "imageBlockSoundEnabled",
        "blockSoundDataUrl",
        "blockSoundVolume",
        "planTier"
      ], (res) => {
        const planTier = normalizePlanTier(res?.planTier);
        const paidUnlocked = planTier === PLAN_UNLIMITED;
        window.postMessage({
          sender: "aphelion-extension",
          type: "APHELION_WEBSITE_SETTINGS",
          settings: {
            censorGlyph: typeof res?.censorGlyph === "string" ? res.censorGlyph : "✦✦✦",
            imageBlockMode: normalizeImageMode(res?.imageBlockMode),
            replacementImageUrl: safeReplacementUrl(res?.replacementImageUrl),
            imageBlockSoundEnabled: paidUnlocked && Boolean(res?.imageBlockSoundEnabled),
            blockSoundDataUrl: paidUnlocked ? safeSoundUrl(res?.blockSoundDataUrl) : "",
            blockSoundVolume: normalizeSoundVolume(res?.blockSoundVolume),
            planTier
          }
        }, "*");
      });
      return;
    }

    if (msg.type === "APHELION_WEBSITE_SAVE_SETTINGS") {
      const settings = msg.settings && typeof msg.settings === "object" ? msg.settings : {};

      chrome.storage.local.get(["planTier"], (planRes) => {
        const planTier = normalizePlanTier(planRes?.planTier);
        const paidUnlocked = planTier === PLAN_UNLIMITED;
        const wantsPaidSound = Boolean(settings.imageBlockSoundEnabled) || Boolean(safeSoundUrl(settings.blockSoundDataUrl));
        const payload = {
          censorGlyph: typeof settings.censorGlyph === "string" && settings.censorGlyph.trim() ? settings.censorGlyph.trim().slice(0, 20) : "✦✦✦",
          imageBlockMode: normalizeImageMode(settings.imageBlockMode),
          replacementImageUrl: safeReplacementUrl(settings.replacementImageUrl),
          imageBlockSoundEnabled: paidUnlocked && Boolean(settings.imageBlockSoundEnabled),
          blockSoundDataUrl: paidUnlocked ? safeSoundUrl(settings.blockSoundDataUrl) : "",
          blockSoundVolume: normalizeSoundVolume(settings.blockSoundVolume)
        };

        chrome.storage.local.set(payload, () => {
          const runtimeError = chrome.runtime.lastError ? (chrome.runtime.lastError.message || "SYNC_FAILED") : "";
          const gateError = !paidUnlocked && wantsPaidSound ? "PAID_FEATURE_REQUIRES_UNLIMITED_BONK" : "";
          const errorMessage = runtimeError || gateError;

          window.postMessage({
            sender: "aphelion-extension",
            type: "APHELION_WEBSITE_SYNC_ACK",
            ok: !errorMessage,
            error: errorMessage
          }, "*");

          if (!runtimeError) {
            loadBlacklist(() => {
              scheduleFullRescan(50);
            });
          }
        });
      });
    }
  });
}

// bootstrap
injectStyles();
console.log("[content] bootstrapping on", document.location.href);
loadBlacklist(() => {
  if (worker) try { worker.postMessage({ type: "init", blacklist: aphelionEntries }); } catch (e) {}
  attachObserversAndScan(document.body || document.documentElement);
  attachToFramesAndShadows();
  scheduleFullRescan(700);
  scheduleFullRescan(2500);
  scheduleFullRescan(5000);
  scheduleFullRescan(9000);
  log("bootstrapped, entries:", aphelionEntries.length);
});
