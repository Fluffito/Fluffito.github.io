// background.js — APHELION (object schema, migration, merge API, notifications)
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
  wrapWebExtensionMethod(globalThis.chrome.storage && globalThis.chrome.storage.local, "remove");
  wrapWebExtensionMethod(globalThis.chrome.tabs, "query");
  wrapWebExtensionMethod(globalThis.chrome.tabs, "sendMessage");
  wrapWebExtensionMethod(globalThis.chrome.runtime, "sendMessage");
}
console.log("[BG] background.js starting");
const LOG = true;
const PLAN_FREE = "free";
const PLAN_UNLIMITED = "unlimited-bonk";
const FREE_WORD_LIMIT = 50;
const LICENSE_SECRET = "APHELION::KITSUNE::2026";
const LICENSE_VERSION = "APH1";

function normalizePlanTier(value) {
  return value === PLAN_UNLIMITED ? PLAN_UNLIMITED : PLAN_FREE;
}

function normalizeLicenseKeyInput(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function computeLicenseChecksum(seed) {
  const raw = `${seed}|${LICENSE_SECRET}`;
  let acc = 17;
  for (let i = 0; i < raw.length; i++) {
    acc = (acc * 31 + raw.charCodeAt(i) * (i + 3)) % 1679616;
  }
  return acc.toString(36).toUpperCase().padStart(4, "0").slice(-4);
}

function getLicenseLabel(code) {
  if (code === "UNL") return "Unlimited Bonk";
  if (code === "KIT") return "No-Ads Kitsune";
  return "Founder Bundle";
}

function parseLicenseKey(value) {
  const clean = normalizeLicenseKeyInput(value);
  const match = clean.match(/^APH1(UNL|KIT|MAX)([A-Z0-9]{4})([A-Z0-9]{4})$/);
  if (!match) return null;

  const [, code, seed, providedChecksum] = match;
  const expectedChecksum = computeLicenseChecksum(`${LICENSE_VERSION}-${code}-${seed}`);
  if (providedChecksum !== expectedChecksum) return null;

  return {
    cleanKey: clean,
    licenseCode: code,
    licenseType: getLicenseLabel(code),
    planTier: code === "UNL" || code === "MAX" ? PLAN_UNLIMITED : PLAN_FREE,
    noAdsKitsune: code === "KIT" || code === "MAX",
    licenseKeyMasked: `${LICENSE_VERSION}-${code}-${seed}-${providedChecksum}`
  };
}

function getStoredLicenseState(cb) {
  try {
    chrome.storage.local.get(["planTier", "noAdsKitsune", "licenseType", "licenseKeyMasked", "licenseActivatedAt"], (res) => {
      if (chrome.runtime.lastError) {
        if (LOG) console.warn("[BG] getStoredLicenseState error:", chrome.runtime.lastError);
        cb({ planTier: PLAN_FREE, noAdsKitsune: false, licenseType: null, licenseKeyMasked: "", licenseActivatedAt: null });
        return;
      }
      cb({
        planTier: normalizePlanTier(res?.planTier),
        noAdsKitsune: !!res?.noAdsKitsune,
        licenseType: res?.licenseType || null,
        licenseKeyMasked: res?.licenseKeyMasked || "",
        licenseActivatedAt: res?.licenseActivatedAt || null
      });
    });
  } catch (err) {
    if (LOG) console.error("[BG] getStoredLicenseState threw:", err);
    cb({ planTier: PLAN_FREE, noAdsKitsune: false, licenseType: null, licenseKeyMasked: "", licenseActivatedAt: null });
  }
}

function activateLicenseKey(licenseKey, cb) {
  const parsed = parseLicenseKey(licenseKey);
  if (!parsed) {
    cb({ ok: false, error: "INVALID_LICENSE_KEY" });
    return;
  }

  getStoredLicenseState((current) => {
    const payload = {
      planTier: parsed.planTier === PLAN_UNLIMITED ? PLAN_UNLIMITED : current.planTier,
      noAdsKitsune: Boolean(current.noAdsKitsune || parsed.noAdsKitsune),
      licenseType: parsed.licenseType,
      licenseKeyMasked: parsed.licenseKeyMasked,
      licenseActivatedAt: new Date().toISOString()
    };

    chrome.storage.local.set(payload, () => {
      if (chrome.runtime.lastError) {
        cb({ ok: false, error: chrome.runtime.lastError.message || "LICENSE_SAVE_FAILED" });
        return;
      }
      notifyAllTabs();
      cb({ ok: true, ...payload });
    });
  });
}

function fullNormalize(s) {
  if (s == null) return "";
  return String(s)
    .normalize("NFKC")
    .replace(/\p{M}/gu, "")
    .replace(/[\u200D\uFE0E\uFE0F]/g, "")
    .replace(/\p{Emoji_Modifier}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function escapeForRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dedupePreserveOrder(arr) {
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    if (!v) continue;
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function notifyAllTabs() {
  try {
    chrome.tabs.query({}, (tabs) => {
      if (chrome.runtime.lastError) {
        if (LOG) console.warn("[BG] tabs.query error:", chrome.runtime.lastError);
        return;
      }
      for (const t of tabs) {
        try {
          chrome.tabs.sendMessage(t.id, { type: "RELOAD_CENSOR" }, () => {
            if (chrome.runtime.lastError && LOG) {
              const msg = chrome.runtime.lastError.message || "unknown tab message error";
              // Expected on tabs without content script or restricted pages.
              if (!/Receiving end does not exist|The message port closed/i.test(msg)) {
                console.warn("[BG] tab message warning", t.id, msg);
              }
            }
          });
        } catch (err) {
          if (LOG) console.warn("[BG] sendMessage error for tab", t.id, err);
        }
      }
    });
  } catch (err) {
    if (LOG) console.error("[BG] notifyAllTabs error:", err);
  }
}

// ---------- Storage helpers for object schema ----------
function getBlacklistEntries(cb) {
  try {
    chrome.storage.local.get(["blacklist"], (res) => {
      if (chrome.runtime.lastError) {
        if (LOG) console.warn("[BG] storage.get error:", chrome.runtime.lastError);
        cb([]);
        return;
      }
      const raw = Array.isArray(res?.blacklist) ? res.blacklist : [];
      cb(raw.slice());
    });
  } catch (err) {
    if (LOG) console.error("[BG] getBlacklistEntries error:", err);
    cb([]);
  }
}

function saveBlacklistEntries(entries, cb) {
  try {
    chrome.storage.local.set({ blacklist: entries }, () => {
      if (chrome.runtime.lastError) {
        if (LOG) console.error("[BG] storage.set error:", chrome.runtime.lastError);
        if (cb) cb(false);
        return;
      }
      if (LOG) console.log("[BG] saved blacklist entries:", entries.length);
      notifyAllTabs();
      if (cb) cb(true);
    });
  } catch (err) {
    if (LOG) console.error("[BG] saveBlacklistEntries error:", err);
    if (cb) cb(false);
  }
}

function buildCompactPatternFromKey(key) {
  // Hyphenated keys are used only for stable IDs; treat hyphens as whitespace/hyphen separators.
  const raw = String(key || "");
  return raw
    .split("-")
    .map(part => escapeForRegex(part))
    .join("(?:[\\s\\-]+)");
}

function mergeVariantsIntoEntry(baseKey, newVariants, cb) {
  try {
    getBlacklistEntries((list) => {
      const entries = list.slice();
      let entry = entries.find(e => e.key === baseKey || e.raw === baseKey || e.id === baseKey);
      if (!entry) {
        const id = `b_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
        entry = { id, raw: newVariants[0] || baseKey, key: baseKey, pattern: "", variants: [], count: 0 };
        entries.push(entry);
      }
      const seen = new Set(entry.variants || []);
      for (const v of newVariants) {
        if (!v) continue;
        if (!seen.has(v)) {
          entry.variants.push(v);
          seen.add(v);
        }
      }
      const CAP = 12;
      if (entry.variants.length > CAP) entry.variants = entry.variants.slice(0, CAP);
      entry.count = entry.variants.length;
      // Keep pattern blank when no explicit regex is provided so content scripts build from raw/variants.
      saveBlacklistEntries(entries, (ok) => cb && cb(ok));
    });
  } catch (err) {
    if (LOG) console.error("[BG] mergeVariantsIntoEntry error:", err);
    if (cb) cb(false);
  }
}

function deleteEntryById(id, cb) {
  try {
    getBlacklistEntries((list) => {
      const entries = list.filter(e => e.id !== id);
      saveBlacklistEntries(entries, (ok) => cb && cb(ok));
    });
  } catch (err) {
    if (LOG) console.error("[BG] deleteEntryById error:", err);
    if (cb) cb(false);
  }
}

// ---------- Migration from old string[] schema ----------
function migrateBlacklistIfNeeded() {
  try {
    chrome.storage.local.get(["blacklist"], (res) => {
      if (chrome.runtime.lastError) {
        if (LOG) console.warn("[BG] migration storage.get error:", chrome.runtime.lastError);
        return;
      }
      const raw = res?.blacklist;
      if (!raw) return;
      if (Array.isArray(raw) && raw.length && typeof raw[0] === "object" && raw[0].id) {
        if (LOG) console.log("[BG] blacklist already in object schema");
        return;
      }
      const newList = (Array.isArray(raw) ? raw : []).map(s => {
        const base = String(s || "");
        const id = `b_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
        const key = fullNormalize(base).replace(/\s+/g, "-").slice(0,120);
        return { id, raw: base, key, pattern: "", variants: [base], count: 1 };
      });
      chrome.storage.local.set({ blacklist: newList }, () => {
        if (chrome.runtime.lastError) {
          if (LOG) console.error("[BG] migration save error:", chrome.runtime.lastError);
        } else {
          if (LOG) console.log("[BG] migrated blacklist to object schema:", newList.length);
          notifyAllTabs();
        }
      });
    });
  } catch (err) {
    if (LOG) console.error("[BG] migrateBlacklistIfNeeded error:", err);
  }
}

// ---------- Message handler ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (!msg || typeof msg !== "object") return;
    if (LOG) console.log("[BG] onMessage", msg.type, { id: msg.id, key: msg.key, data: msg.data });

    if (msg.type === "SET_BLACKLIST" && msg.data && typeof msg.data === "object") {
      chrome.storage.local.get(["planTier", "blacklist"], (res) => {
        const planTier = normalizePlanTier(res?.planTier);
        const entries = Array.isArray(res?.blacklist) ? res.blacklist.slice() : [];
        const exists = entries.find(e => e.key === msg.data.key || e.id === msg.data.id);
        if (!exists && planTier !== PLAN_UNLIMITED && entries.length >= FREE_WORD_LIMIT) {
          sendResponse({ ok: false, error: "FREE_WORD_LIMIT_REACHED", limit: FREE_WORD_LIMIT, planTier });
          return;
        }
        if (!exists) entries.push(msg.data);
        saveBlacklistEntries(entries, (ok) => sendResponse({ ok, limit: FREE_WORD_LIMIT, planTier }));
      });
      return true;
    }

    if (msg.type === "SET_BLACKLIST_MERGE" && msg.key && Array.isArray(msg.variants)) {
      // msg.variants expected to be normalized strings
      mergeVariantsIntoEntry(msg.key, msg.variants, (ok) => sendResponse({ ok }));
      return true;
    }

    if (msg.type === "GET_LICENSE_STATE") {
      getStoredLicenseState((state) => sendResponse({ ok: true, ...state }));
      return true;
    }

    if (msg.type === "ACTIVATE_LICENSE") {
      activateLicenseKey(msg.licenseKey, (result) => sendResponse(result));
      return true;
    }

    if (msg.type === "DELETE_BLACKLIST_ENTRY" && msg.id) {
      deleteEntryById(msg.id, (ok) => sendResponse({ ok }));
      return true;
    }

    if (msg.type === "GET_BLACKLIST") {
      getBlacklistEntries((list) => sendResponse({ ok: true, blacklist: list }));
      return true;
    }

    if (msg.type === "CLEAR_BLACKLIST") {
      chrome.storage.local.remove(["blacklist"], () => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        notifyAllTabs();
        sendResponse({ ok: true });
      });
      return true;
    }

    if (msg.type === "RELOAD_CENSOR") {
      notifyAllTabs();
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === "PING") {
      sendResponse({ ok: true, ts: Date.now() });
      return false;
    }

  } catch (err) {
    if (LOG) console.error("[BG] onMessage error:", err);
    try { sendResponse({ ok: false, error: String(err) }); } catch (e) {}
    return true;
  }
});

// React to external storage changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.blacklist) {
    if (LOG) console.log("[BG] storage.onChanged blacklist updated");
    notifyAllTabs();
  }
});

// Ensure default and run migration
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["blacklist"], (res) => {
    if (chrome.runtime.lastError) {
      if (LOG) console.warn("[BG] onInstalled storage.get error:", chrome.runtime.lastError);
      return;
    }
    if (!Array.isArray(res?.blacklist)) {
      chrome.storage.local.set({ blacklist: [] }, () => {
        if (chrome.runtime.lastError) {
          if (LOG) console.error("[BG] onInstalled storage.set error:", chrome.runtime.lastError);
        } else {
          if (LOG) console.log("[BG] initialized empty blacklist on install");
        }
      });
    }
    migrateBlacklistIfNeeded();
  });
});

chrome.runtime.onStartup.addListener(() => {
  migrateBlacklistIfNeeded();
  getBlacklistEntries((list) => {
    if (LOG) console.log("[BG] onStartup loaded blacklist entries:", list.length);
    notifyAllTabs();
  });
});

if (LOG) console.log("[BG] background.js loaded and running");
