// popup.js — APHELION (UI, optimistic entry create, background merge)
// Inlined api.js functions to avoid module import issues in some browsers

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
  wrapWebExtensionMethod(globalThis.chrome.runtime, "sendMessage");
}
console.log("[popup] script loaded");

// --- Inlined from api.js ---
const SERVER_URL = "http://localhost:3000/generateVariants";
const USE_LOCAL_VARIANT_SERVER = false;
let variantServerNoticeShown = false;
const FREE_WORD_LIMIT = 50;
const PLAN_FREE = "free";
const PLAN_UNLIMITED = "unlimited-bonk";

function normalizeLicenseKeyInput(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15);
}

function formatLicenseKeyInput(value) {
  const clean = normalizeLicenseKeyInput(value);
  if (!clean) return "";
  const part1 = clean.slice(0, 4);
  const part2 = clean.slice(4, 7);
  const part3 = clean.slice(7, 11);
  const part4 = clean.slice(11, 15);
  return [part1, part2, part3, part4].filter(Boolean).join("-");
}

function normalizeSimple(s) {
  if (s == null) return "";
  return String(s).normalize("NFKC").replace(/[\u0300-\u036f]/g, "").replace(/[\u200D\uFE0E\uFE0F]/g, "").toLowerCase().trim();
}

const CONFUSABLE_MAP = {
  "a": ["\u0391", "\u0410", "\uFF21"],
  "e": ["\u0395", "\u0415", "\uFF25"],
  "o": ["\u039F", "\u041E", "\uFF2F"]
};

function expandConfusablesLocal(s, maxVariants = 30) {
  const chars = Array.from(String(s));
  const slots = chars.map(ch => {
    const lower = ch.toLowerCase();
    const base = [lower];
    if (CONFUSABLE_MAP[lower]) base.push(...CONFUSABLE_MAP[lower]);
    return base;
  });
  const results = new Set();
  function backtrack(i, acc) {
    if (results.size >= maxVariants) return;
    if (i === slots.length) {
      results.add(acc.join(""));
      return;
    }
    for (const opt of slots[i]) {
      acc.push(opt);
      backtrack(i + 1, acc);
      acc.pop();
      if (results.size >= maxVariants) return;
    }
  }
  backtrack(0, []);
  return Array.from(results);
}

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

function expandEmojiLocal(s, maxVariants = 60) {
  const units = Array.from(String(s));
  const slots = units.map(u => {
    if (EMOJI_TO_FAMILY[u]) return EMOJI_FAMILIES[EMOJI_TO_FAMILY[u]] || [u];
    return [u];
  });
  const results = new Set();
  function backtrack(i, acc) {
    if (results.size >= maxVariants) return;
    if (i === slots.length) {
      results.add(acc.join(""));
      results.add(acc.join(" "));
      return;
    }
    for (const opt of slots[i]) {
      acc.push(opt);
      backtrack(i + 1, acc);
      acc.pop();
      if (results.size >= maxVariants) return;
    }
  }
  backtrack(0, []);
  return Array.from(results);
}

async function fetchWithTimeout(url, opts = {}, timeout = 2500) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function generateVariants(text) {
  const normalizedBase = normalizeSimple(text);
  if (USE_LOCAL_VARIANT_SERVER) {
    try {
      const res = await fetchWithTimeout(SERVER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      }, 2500);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length) {
          const dedup = [];
          const seen = new Set();
          dedup.push(normalizedBase);
          seen.add(normalizedBase);
          for (const v of data) {
            const n = normalizeSimple(v);
            if (!seen.has(n)) {
              seen.add(n);
              dedup.push(n);
            }
          }
          return dedup;
        }
      }
    } catch (e) {
      if (!variantServerNoticeShown) {
        variantServerNoticeShown = true;
        console.info("[api] local variant server unavailable; using built-in variant generator.");
      }
    }
  }
  const conf = expandConfusablesLocal(text, 30).map(normalizeSimple);
  const emoji = expandEmojiLocal(text, 60).map(normalizeSimple);
  const combined = [normalizedBase, ...conf, ...emoji];
  const seen = new Set();
  const out = [];
  for (const v of combined) {
    if (!v) continue;
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}
// --- End inlined api.js ---

document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("wordInput");
  const addBtn = document.getElementById("addBtn");
  const clearBtn = document.getElementById("clearBtn");
  const listContainer = document.getElementById("blacklistDisplay");
  const counter = document.getElementById("counter");
  const popupStatus = document.getElementById("popupStatus");
  const planBadge = document.getElementById("planBadge");
  const licenseKeyInput = document.getElementById("licenseKeyInput");
  const unlockBtn = document.getElementById("unlockBtn");
  const restoreBtn = document.getElementById("restoreBtn");
  const exportBtn = document.getElementById("exportBtn");
  const importInput = document.getElementById("importInput");

  if (!input || !addBtn || !listContainer || !counter) {
    console.error("[popup] Missing DOM elements. Popup cannot run.");
    return;
  }

  function fullNormalizeLocal(s) {
    if (s == null) return "";
    return String(s).normalize("NFKC").replace(/\p{M}/gu, "").replace(/[\u200D\uFE0E\uFE0F]/g, "").replace(/\p{Emoji_Modifier}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  let currentPlan = PLAN_FREE;
  let hasNoAdsKitsune = false;

  function setStatus(message = "", tone = "") {
    if (!popupStatus) return;
    popupStatus.textContent = message;
    popupStatus.className = `popup-status${tone ? ` ${tone}` : ""}`;
  }

  function updatePlanBadge() {
    if (!planBadge) return;
    if (currentPlan === PLAN_UNLIMITED && hasNoAdsKitsune) {
      planBadge.textContent = "Max + Kitsune";
      planBadge.className = "plan-badge paid";
      return;
    }
    if (currentPlan === PLAN_UNLIMITED) {
      planBadge.textContent = "Unlimited";
      planBadge.className = "plan-badge paid";
      return;
    }
    if (hasNoAdsKitsune) {
      planBadge.textContent = "No-Ads";
      planBadge.className = "plan-badge paid";
      return;
    }
    planBadge.textContent = "Free";
    planBadge.className = "plan-badge free";
  }

  function readCurrentPlan(cb) {
    chrome.storage.local.get(["planTier", "noAdsKitsune"], (res) => {
      currentPlan = res?.planTier === PLAN_UNLIMITED ? PLAN_UNLIMITED : PLAN_FREE;
      hasNoAdsKitsune = !!res?.noAdsKitsune;
      updatePlanBadge();
      if (typeof cb === "function") cb(currentPlan, hasNoAdsKitsune);
    });
  }

  function sendRuntimeMessage(message, callback) {
    try {
      chrome.runtime.sendMessage(message, (resp) => {
        const err = chrome.runtime.lastError;
        if (err) {
          console.warn("[popup] sendMessage error:", message && message.type, err.message || err);
          if (typeof callback === "function") callback(null, err);
          return;
        }
        if (typeof callback === "function") callback(resp, null);
      });
    } catch (err) {
      console.warn("[popup] sendMessage threw:", message && message.type, err);
      if (typeof callback === "function") callback(null, err);
    }
  }

  function loadAndRenderEntries() {
    sendRuntimeMessage({ type: "GET_BLACKLIST" }, (resp) => {
      console.log("[popup] GET_BLACKLIST response", resp);
      const entries = Array.isArray(resp?.blacklist) ? resp.blacklist : [];
      readCurrentPlan(() => renderEntries(entries));
    });
  }

  function renderEntries(entries) {
    listContainer.innerHTML = "";
    counter.textContent = currentPlan === PLAN_UNLIMITED
      ? `Blacklisted: ${entries.length} / ∞`
      : `Blacklisted: ${entries.length} / ${FREE_WORD_LIMIT}`;
    entries.forEach(entry => {
      const div = document.createElement("div");
      div.className = "blacklist-item";
      div.dataset.id = entry.id;
      const badge = entry.count || (entry.variants ? entry.variants.length : 1);
      div.innerHTML = `
        <span class="word-text">${escapeHtml(entry.raw)}</span>
        <span class="badge">${badge}</span>
        <button class="toggle-variants">▾</button>
        <button class="delete-btn">x</button>
        <div class="variants" style="display:none; margin-top:6px;"></div>
      `;
      const variantsDiv = div.querySelector(".variants");
      (entry.variants || []).forEach(v => {
        const vEl = document.createElement("div");
        vEl.className = "variant";
        vEl.textContent = v;
        variantsDiv.appendChild(vEl);
      });
      div.querySelector(".toggle-variants").addEventListener("click", () => {
        variantsDiv.style.display = variantsDiv.style.display === "none" ? "block" : "none";
      });
      div.querySelector(".delete-btn").addEventListener("click", () => {
        sendRuntimeMessage({ type: "DELETE_BLACKLIST_ENTRY", id: entry.id }, () => loadAndRenderEntries());
      });
      listContainer.appendChild(div);
    });
  }

  // Export
  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      chrome.storage.local.get(["blacklist"], res => {
        const data = JSON.stringify(res?.blacklist || [], null, 2);
        const blob = new Blob([data], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "aphelion-blacklist.json";
        a.click();
        URL.revokeObjectURL(url);
      });
    });
  }

  // Import
  if (importInput) {
    importInput.addEventListener("change", (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          if (!Array.isArray(parsed)) throw new Error("invalid format");
          chrome.storage.local.get(["planTier"], (res) => {
            const planTier = res?.planTier === PLAN_UNLIMITED ? PLAN_UNLIMITED : PLAN_FREE;
            const finalList = planTier === PLAN_UNLIMITED ? parsed : parsed.slice(0, FREE_WORD_LIMIT);
            if (planTier !== PLAN_UNLIMITED && parsed.length > FREE_WORD_LIMIT) {
              setStatus(`Free plan import trimmed to ${FREE_WORD_LIMIT} words.`, "error");
            }
            chrome.storage.local.set({ blacklist: finalList }, () => {
              sendRuntimeMessage({ type: "RELOAD_CENSOR" });
              loadAndRenderEntries();
            });
          });
        } catch (e) {
          console.error("[popup] import failed", e);
        }
      };
      reader.readAsText(file);
    });
  }

  // Create entry immediately (optimistic)
  function createEntryAndSave(raw) {
    const id = `b_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const key = fullNormalizeLocal(raw).replace(/\s+/g,"-").slice(0,120);
    const entry = { id, raw, key, pattern: "", variants: [raw], count: 1 };
    return new Promise((resolve, reject) => {
      sendRuntimeMessage({ type: "SET_BLACKLIST", data: entry }, (resp, err) => {
        if (err) {
          reject(err.message || "Could not add word.");
          return;
        }
        if (!resp?.ok) {
          reject(resp?.error || "Could not add word.");
          return;
        }
        loadAndRenderEntries();
        resolve(entry);
      });
    });
  }

  // Merge variants into entry (background)
  function mergeVariants(key, variants) {
    const normalized = Array.isArray(variants) ? variants.map(v => fullNormalizeLocal(v)).filter(Boolean) : [];
    sendRuntimeMessage({ type: "SET_BLACKLIST_MERGE", key, variants: normalized }, () => {
      setTimeout(loadAndRenderEntries, 200);
    });
  }

  function activateLicense(promptForKey = false) {
    let key = formatLicenseKeyInput(licenseKeyInput ? licenseKeyInput.value : "");

    if (!key && promptForKey) {
      const pasted = window.prompt("Paste your APHELION license key") || "";
      key = formatLicenseKeyInput(pasted);
      if (licenseKeyInput && key) licenseKeyInput.value = key;
    }

    if (!key) {
      if (currentPlan !== PLAN_FREE || hasNoAdsKitsune) {
        setStatus("Your purchase is already active on this browser.", "success");
      } else {
        setStatus("Paste your license key first, then click Unlock.", "error");
      }
      return;
    }

    if (unlockBtn) unlockBtn.disabled = true;
    if (restoreBtn) restoreBtn.disabled = true;
    setStatus(promptForKey ? "Restoring purchase..." : "Unlocking purchase...");

    sendRuntimeMessage({ type: "ACTIVATE_LICENSE", licenseKey: key }, (resp, err) => {
      if (unlockBtn) unlockBtn.disabled = false;
      if (restoreBtn) restoreBtn.disabled = false;

      if (err || !resp?.ok) {
        setStatus("That license key looks invalid. Double-check it and try again.", "error");
        return;
      }

      currentPlan = resp?.planTier === PLAN_UNLIMITED ? PLAN_UNLIMITED : PLAN_FREE;
      hasNoAdsKitsune = !!resp?.noAdsKitsune;
      updatePlanBadge();
      setStatus(`${resp?.licenseType || "Purchase"} activated.`, "success");
      if (licenseKeyInput) licenseKeyInput.value = "";
      loadAndRenderEntries();
    });
  }

  async function addWord() {
    const raw = input.value.trim();
    if (!raw) return;
    addBtn.disabled = true;
    setStatus("");

    try {
      const entry = await createEntryAndSave(raw);
      input.value = "";
      input.focus();

      const variants = await generateVariants(raw);
      if (Array.isArray(variants) && variants.length) {
        mergeVariants(entry.key, variants);
      }
    } catch (e) {
      const message = String(e || "");
      if (/FREE_WORD_LIMIT_REACHED/i.test(message)) {
        setStatus(`Free plan max reached: ${FREE_WORD_LIMIT} words. Upgrade to Unlimited Bonk on the web.`, "error");
      } else {
        setStatus("Could not add that word right now.", "error");
      }
      console.warn("[popup] addWord failed:", e);
    } finally {
      setTimeout(() => { addBtn.disabled = false; }, 200);
    }
  }

  addBtn.addEventListener("click", addWord);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.keyCode === 13) {
      ev.preventDefault();
      addWord();
    }
  });

  licenseKeyInput && licenseKeyInput.addEventListener("input", () => {
    licenseKeyInput.value = formatLicenseKeyInput(licenseKeyInput.value);
  });

  licenseKeyInput && licenseKeyInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.keyCode === 13) {
      ev.preventDefault();
      activateLicense(false);
    }
  });

  unlockBtn && unlockBtn.addEventListener("click", () => activateLicense(false));
  restoreBtn && restoreBtn.addEventListener("click", () => activateLicense(true));

  clearBtn && clearBtn.addEventListener("click", () => {
    sendRuntimeMessage({ type: "CLEAR_BLACKLIST" }, () => loadAndRenderEntries());
  });

  readCurrentPlan(() => loadAndRenderEntries());
  input.focus();
});
