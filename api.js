// api.js — uses a configured API server when available, then falls back to local expansion
let variantServerNoticeShown = false;

function getConfiguredApiBase() {
  try {
    const base = (
      (typeof globalThis !== "undefined" && typeof globalThis.APHELION_API_BASE === "string" && globalThis.APHELION_API_BASE)
      || (typeof localStorage !== "undefined" && localStorage.getItem("aphelionApiBase"))
      || ""
    );
    return String(base || "").trim().replace(/\/$/, "");
  } catch (error) {
    return "";
  }
}

function getVariantServerUrl() {
  const base = getConfiguredApiBase();
  if (!base) return "";
  return /\/generateVariants$/i.test(base) ? base : `${base}/generateVariants`;
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

export async function generateVariants(text) {
  const normalizedBase = normalizeSimple(text);
  const serverUrl = getVariantServerUrl();

  if (serverUrl) {
    try {
      const res = await fetchWithTimeout(serverUrl, {
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
        console.info("[api] configured variant server unavailable; using built-in variant generator.");
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
