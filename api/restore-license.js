const CORS_ORIGIN = String(process.env.CORS_ORIGIN || "*");
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Stripe-Signature");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function lookupLicenseByEmail(email) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured in Vercel.");
  }

  if (typeof fetch !== "function") {
    throw new Error("This runtime does not expose fetch(), so purchase recovery is unavailable.");
  }

  const query = new URLSearchParams({
    select: "email,license_key",
    email: `eq.${email}`,
    limit: "1"
  });

  const response = await fetch(`${SUPABASE_URL}/rest/v1/licenses?${query.toString()}`, {
    method: "GET",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Supabase lookup failed (${response.status}): ${details}`);
  }

  const rows = await response.json().catch(() => []);
  const row = Array.isArray(rows) ? rows.find((item) => item && item.license_key) : null;
  return row || null;
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
    return;
  }

  try {
    const rawEmail = req.method === "GET" ? req.query?.email : req.body?.email;
    const email = normalizeEmail(rawEmail);

    if (!isValidEmail(email)) {
      res.status(400).json({ ok: false, error: "INVALID_EMAIL" });
      return;
    }

    const record = await lookupLicenseByEmail(email);
    if (!record) {
      res.status(404).json({ ok: false, error: "LICENSE_NOT_FOUND" });
      return;
    }

    res.status(200).json({
      ok: true,
      email,
      licenseKey: String(record.license_key || "").trim(),
      instructions: "Paste this key into the APHELION popup and click Unlock."
    });
  } catch (error) {
    console.error("restore-license error:", error);
    res.status(500).json({ ok: false, error: "RESTORE_LICENSE_SERVER_ERROR", details: error.message });
  }
};
