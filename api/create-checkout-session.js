const https = require("https");
const querystring = require("querystring");

const PUBLIC_SITE_URL = String(process.env.PUBLIC_SITE_URL || "https://fluffito.github.io/APHELIION").replace(/\/$/, "");
const STRIPE_SECRET_KEY = String(process.env.STRIPE_SECRET_KEY || "").trim();
const CORS_ORIGIN = String(process.env.CORS_ORIGIN || "*");

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

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Stripe-Signature");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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

    const stripeReq = https.request({
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
        } catch {
          data = { raw };
        }
        resolve({
          ok: stripeRes.statusCode >= 200 && stripeRes.statusCode < 300,
          status: stripeRes.statusCode || 500,
          data
        });
      });
    });

    stripeReq.on("error", (error) => {
      resolve({
        ok: false,
        status: 500,
        data: { error: { message: error.message } }
      });
    });

    if (payload) stripeReq.write(payload);
    stripeReq.end();
  });
}

function getRequestOrigin(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  if (!forwardedHost) return "";
  return `${forwardedProto}://${forwardedHost}`.replace(/\/$/, "");
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
    return;
  }

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

    const apiBase = getRequestOrigin(req) || PUBLIC_SITE_URL;

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

    res.status(200).json({ ok: true, url: stripe.data.url, sessionId: stripe.data.id });
  } catch (error) {
    console.error("create-checkout-session error:", error);
    res.status(500).json({ ok: false, error: "CHECKOUT_SERVER_ERROR" });
  }
};
