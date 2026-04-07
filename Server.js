// Server.js — APHELION helper server
// Provides:
// 1) variant generation for blacklist expansion
// 2) Stripe checkout session creation
// 3) automatic post-purchase license delivery on the success page

try {
  require("dotenv").config();
} catch (error) {
  // Optional dependency for local .env usage.
}

const express = require("express");
const bodyParser = require("body-parser");
const https = require("https");
const querystring = require("querystring");
const { createLicenseKey } = require("./license-tools");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_SITE_URL = String(process.env.PUBLIC_SITE_URL || "https://fluffito.github.io/APHELIION").replace(/\/$/, "");
const STRIPE_SECRET_KEY = String(process.env.STRIPE_SECRET_KEY || "").trim();

app.use(bodyParser.json({ limit: "1mb" }));
app.use(bodyParser.urlencoded({ extended: false }));
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

const STRIPE_FALLBACK_LINKS = {
  "unlimited-monthly": "https://buy.stripe.com/7sYdRa04M72W6Fg2gA0Ba00",
  "unlimited-quarterly": "https://buy.stripe.com/14A3cw04M9b48Nof3m0Ba03",
  "unlimited-yearly": "https://buy.stripe.com/bJecN6eZGcngaVwaN60Ba04",
  "kitsune-onetime": "https://buy.stripe.com/5kQ8wQ3gY870aVwdZi0Ba01",
  "kitsune-monthly": "https://buy.stripe.com/28E4gAcRyaf85BcdZi0Ba02"
};

const PLAN_CONFIG = {
  "unlimited-monthly": {
    mode: "subscription",
    priceId: String(process.env.STRIPE_PRICE_UNLIMITED_MONTHLY || "").trim(),
    licenseArg: "unlimited-bonk",
    licenseType: "Unlimited Bonk",
    fallbackUrl: STRIPE_FALLBACK_LINKS["unlimited-monthly"]
  },
  "unlimited-quarterly": {
    mode: "subscription",
    priceId: String(process.env.STRIPE_PRICE_UNLIMITED_QUARTERLY || "").trim(),
    licenseArg: "unlimited-bonk",
    licenseType: "Unlimited Bonk",
    fallbackUrl: STRIPE_FALLBACK_LINKS["unlimited-quarterly"]
  },
  "unlimited-yearly": {
    mode: "subscription",
    priceId: String(process.env.STRIPE_PRICE_UNLIMITED_YEARLY || "").trim(),
    licenseArg: "unlimited-bonk",
    licenseType: "Unlimited Bonk",
    fallbackUrl: STRIPE_FALLBACK_LINKS["unlimited-yearly"]
  },
  "kitsune-onetime": {
    mode: "payment",
    priceId: String(process.env.STRIPE_PRICE_KITSUNE_ONETIME || "").trim(),
    licenseArg: "noads",
    licenseType: "No-Ads Kitsune",
    fallbackUrl: STRIPE_FALLBACK_LINKS["kitsune-onetime"]
  },
  "kitsune-monthly": {
    mode: "subscription",
    priceId: String(process.env.STRIPE_PRICE_KITSUNE_MONTHLY || "").trim(),
    licenseArg: "noads",
    licenseType: "No-Ads Kitsune",
    fallbackUrl: STRIPE_FALLBACK_LINKS["kitsune-monthly"]
  }
};

// Small confusable map (should mirror content.js). For production, load Unicode confusables.
const CONFUSABLE_MAP = {
  "a": ["\u0391", "\u0410", "\uFF21"],
  "e": ["\u0395", "\u0415", "\uFF25"],
  "o": ["\u039F", "\u041E", "\uFF2F"],
  "i": ["\u0406", "\u0131", "\uFF29"],
  "s": ["\u0455", "\uFF33"],
  "c": ["\u03F2", "\uFF23"],
  "p": ["\u03C1", "\uFF30"]
};

const EMOJI_FAMILIES = {
  eye: ["\u{1F441}", "\u{1F440}", "\u{1F9FF}"],
  mouth: ["\u{1F444}", "\u{1F445}", "\u{1F48B}"]
};

const EMOJI_TO_FAMILY = {
  "\u{1F441}": "eye",
  "\u{1F440}": "eye",
  "\u{1F9FF}": "eye",
  "\u{1F444}": "mouth",
  "\u{1F445}": "mouth",
  "\u{1F48B}": "mouth"
};

function normalizeSimple(s) {
  if (s == null) return "";
  return String(s).normalize("NFKC").replace(/[\u0300-\u036f]/g, "").replace(/[\u200D\uFE0E\uFE0F]/g, "").toLowerCase().trim();
}

function getPlanConfig(planKey) {
  return PLAN_CONFIG[String(planKey || "").trim().toLowerCase()] || null;
}

function getMissingStripeFields(plan) {
  const missing = [];
  if (!STRIPE_SECRET_KEY) missing.push("STRIPE_SECRET_KEY");
  if (!plan?.priceId) missing.push("priceId for selected plan");
  return missing;
}

function stripeRequest(path, method = "GET", formData = null) {
  return new Promise((resolve) => {
    if (!STRIPE_SECRET_KEY) {
      resolve({
        ok: false,
        status: 503,
        data: { error: { message: "STRIPE_SECRET_KEY is not configured yet." } }
      });
      return;
    }

    const payload = formData ? querystring.stringify(formData) : "";
    const headers = {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`
    };

    if (payload) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }

    const req = https.request({
      hostname: "api.stripe.com",
      port: 443,
      path: `/v1${path}`,
      method,
      headers
    }, (stripeRes) => {
      let raw = "";
      stripeRes.on("data", (chunk) => {
        raw += chunk;
      });
      stripeRes.on("end", () => {
        let data = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch (error) {
          data = { raw };
        }
        resolve({
          ok: stripeRes.statusCode >= 200 && stripeRes.statusCode < 300,
          status: stripeRes.statusCode || 500,
          data
        });
      });
    });

    req.on("error", (error) => {
      resolve({
        ok: false,
        status: 500,
        data: { error: { message: error.message } }
      });
    });

    if (payload) req.write(payload);
    req.end();
  });
}

function expandConfusables(s, maxVariants = 50) {
  const chars = Array.from(String(s));
  const slots = chars.map((ch) => {
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

function expandEmojiFamilies(s, maxVariants = 100) {
  const units = Array.from(String(s));
  const slots = units.map((u) => {
    if (EMOJI_TO_FAMILY[u]) {
      return EMOJI_FAMILIES[EMOJI_TO_FAMILY[u]] || [u];
    }
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

function getPlanKeyFromSession(session) {
  const metaPlan = session?.metadata?.aphelion_plan;
  if (metaPlan && PLAN_CONFIG[metaPlan]) return metaPlan;

  const stripePriceId = session?.line_items?.data?.[0]?.price?.id;
  if (!stripePriceId) return null;

  return Object.keys(PLAN_CONFIG).find((key) => PLAN_CONFIG[key].priceId && PLAN_CONFIG[key].priceId === stripePriceId) || null;
}

function getBuyerReference(session) {
  return session?.customer_details?.email
    || session?.customer_email
    || session?.customer
    || session?.id
    || `paid-${Date.now()}`;
}

function getRequestOrigin(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  if (!forwardedHost) return "";
  return `${forwardedProto}://${forwardedHost}`.replace(/\/$/, "");
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "aphelion-server",
    stripeReady: Boolean(STRIPE_SECRET_KEY),
    publicSiteUrl: PUBLIC_SITE_URL,
    checkoutPlans: Object.fromEntries(Object.entries(PLAN_CONFIG).map(([key, value]) => [key, Boolean(value.priceId)]))
  });
});

app.post("/create-checkout-session", async (req, res) => {
  try {
    const planKey = String(req.body?.plan || "").trim().toLowerCase();
    const customerEmail = String(req.body?.customerEmail || "").trim();
    const plan = getPlanConfig(planKey);

    if (!plan) {
      res.status(400).json({ ok: false, error: "UNKNOWN_PLAN" });
      return;
    }

    const missing = getMissingStripeFields(plan);
    if (missing.length) {
      res.status(503).json({
        ok: false,
        error: "STRIPE_NOT_READY",
        missing,
        fallbackUrl: plan.fallbackUrl
      });
      return;
    }

    const apiBase = getRequestOrigin(req) || `http://localhost:${PORT}`;

    const stripe = await stripeRequest("/checkout/sessions", "POST", {
      mode: plan.mode,
      success_url: `${PUBLIC_SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}&api_base=${encodeURIComponent(apiBase)}`,
      cancel_url: `${PUBLIC_SITE_URL}/#pricing`,
      "line_items[0][price]": plan.priceId,
      "line_items[0][quantity]": "1",
      "metadata[aphelion_plan]": planKey,
      "metadata[license_arg]": plan.licenseArg,
      "metadata[license_type]": plan.licenseType,
      ...(customerEmail ? { customer_email: customerEmail } : {})
    });

    if (!stripe.ok || !stripe.data?.url) {
      res.status(stripe.status || 502).json({
        ok: false,
        error: "STRIPE_CHECKOUT_CREATE_FAILED",
        details: stripe.data?.error?.message || stripe.data,
        fallbackUrl: plan.fallbackUrl
      });
      return;
    }

    res.json({ ok: true, url: stripe.data.url, sessionId: stripe.data.id });
  } catch (error) {
    console.error("create-checkout-session error:", error);
    res.status(500).json({ ok: false, error: "CHECKOUT_SERVER_ERROR" });
  }
});

app.get("/checkout-status", async (req, res) => {
  try {
    const sessionId = String(req.query?.session_id || "").trim();
    if (!sessionId) {
      res.status(400).json({ ok: false, error: "MISSING_SESSION_ID" });
      return;
    }

    if (!STRIPE_SECRET_KEY) {
      res.status(503).json({ ok: false, error: "STRIPE_NOT_READY" });
      return;
    }

    const stripe = await stripeRequest(`/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items.data.price`);
    if (!stripe.ok) {
      res.status(stripe.status || 502).json({
        ok: false,
        error: "STRIPE_SESSION_LOOKUP_FAILED",
        details: stripe.data?.error?.message || stripe.data
      });
      return;
    }

    const session = stripe.data || {};
    const isPaid = session.payment_status === "paid" || session.status === "complete";
    if (!isPaid) {
      res.status(409).json({
        ok: false,
        error: "SESSION_NOT_PAID",
        paymentStatus: session.payment_status || "unknown",
        status: session.status || "unknown"
      });
      return;
    }

    const planKey = getPlanKeyFromSession(session) || String(session?.metadata?.aphelion_plan || "");
    const plan = getPlanConfig(planKey) || {
      licenseArg: String(session?.metadata?.license_arg || "unlimited-bonk"),
      licenseType: String(session?.metadata?.license_type || "APHELION Paid Plan")
    };

    const buyerReference = getBuyerReference(session);
    const licenseKey = createLicenseKey(plan.licenseArg, buyerReference);

    res.json({
      ok: true,
      sessionId,
      plan: planKey || plan.licenseArg,
      email: session?.customer_details?.email || session?.customer_email || "",
      licenseType: plan.licenseType,
      licenseKey,
      instructions: "Paste this key into the APHELION popup and click Unlock or Restore Purchase."
    });
  } catch (error) {
    console.error("checkout-status error:", error);
    res.status(500).json({ ok: false, error: "CHECKOUT_STATUS_SERVER_ERROR" });
  }
});

app.post("/generateVariants", (req, res) => {
  try {
    const text = String(req.body?.text || "");
    if (!text) return res.json([]);
    const base = normalizeSimple(text);
    const conf = expandConfusables(text, 40);
    const emojiExpanded = expandEmojiFamilies(text, 80);
    const combined = new Set();
    combined.add(base);
    conf.forEach((x) => combined.add(normalizeSimple(x)));
    emojiExpanded.forEach((x) => combined.add(normalizeSimple(x)));
    const out = [base, ...Array.from(combined).filter((x) => x !== base)];
    res.json(out.slice(0, 200));
  } catch (error) {
    console.error("generateVariants error:", error);
    res.status(500).json([]);
  }
});

app.listen(PORT, () => {
  console.log(`APHELION helper server running on http://localhost:${PORT}`);
});
