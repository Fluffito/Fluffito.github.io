(() => {
  const params = new URLSearchParams(window.location.search);
  const apiBaseFromUrl = String(params.get("api_base") || "").trim();
  const DEFAULT_API_BASE = window.location.hostname && !/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)
    ? window.location.origin
    : "http://localhost:3000";

  if (apiBaseFromUrl) {
    try {
      localStorage.setItem("aphelionApiBase", apiBaseFromUrl.replace(/\/$/, ""));
    } catch (error) {
      console.warn("[aphelion success] could not persist api base:", error);
    }
  }

  const API_BASE = String(
    window.APHELION_API_BASE
      || apiBaseFromUrl
      || localStorage.getItem("aphelionApiBase")
      || DEFAULT_API_BASE
  ).replace(/\/$/, "");

  const statusTag = document.getElementById("statusTag");
  const statusCopy = document.getElementById("purchaseStatus");
  const licensePanel = document.getElementById("licensePanel");
  const licenseTypeLabel = document.getElementById("licenseTypeLabel");
  const licenseKeyOutput = document.getElementById("licenseKeyOutput");
  const copyLicenseBtn = document.getElementById("copyLicenseBtn");
  const restoreEmailInput = document.getElementById("restoreEmailInput");
  const restoreEmailBtn = document.getElementById("restoreEmailBtn");

  function setStatus(message, isError = false) {
    if (statusCopy) {
      statusCopy.textContent = message;
      statusCopy.classList.toggle("is-error", Boolean(isError));
    }
    if (statusTag) {
      statusTag.textContent = isError ? "Needs setup" : "Payment success";
    }
  }

  function showLicense(data) {
    if (licensePanel) licensePanel.hidden = false;
    if (licenseTypeLabel) {
      licenseTypeLabel.textContent = `${data.licenseType || "APHELION"} key`;
    }
    if (licenseKeyOutput) {
      licenseKeyOutput.textContent = data.licenseKey || "Unavailable";
    }
    const buyerEmail = data?.email ? ` for ${data.email}` : "";
    setStatus(`${data.licenseType || "Paid plan"} is ready${buyerEmail}. Copy the key below now and keep your purchase email as a backup for Restore Purchase.`);
  }

  async function fetchJsonWithRetry(url, attempts = 5) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await fetch(url);
        const data = await response.json().catch(() => ({}));
        if (response.ok && data?.ok) {
          return data;
        }
        lastError = new Error(data?.details || data?.error || `HTTP_${response.status}`);
        if (!/SESSION_NOT_PAID|STRIPE_SESSION_LOOKUP_FAILED|CHECKOUT_STATUS_SERVER_ERROR/i.test(String(lastError.message || "")) || attempt === attempts) {
          throw lastError;
        }
      } catch (error) {
        lastError = error;
        if (attempt === attempts) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(1500 * attempt, 5000)));
    }
    throw lastError || new Error("UNKNOWN_LOOKUP_ERROR");
  }

  async function loadLicenseKey() {
    const sessionId = params.get("session_id");
    const keyFromUrl = String(params.get("license_key") || "").trim();
    const typeFromUrl = String(params.get("license_type") || "").trim();
    const emailFromUrl = String(params.get("email") || "").trim();

    if (keyFromUrl) {
      showLicense({ licenseKey: keyFromUrl, licenseType: typeFromUrl || "APHELION", email: emailFromUrl });
      return;
    }

    if (!sessionId) {
      setStatus("No Stripe session ID was found in the URL yet. Finish checkout first or use the Restore Purchase field in the extension popup.", true);
      return;
    }

    setStatus("Checking your Stripe session and pulling your APHELION license key...");

    try {
      const data = await fetchJsonWithRetry(`${API_BASE}/checkout-status?session_id=${encodeURIComponent(sessionId)}`, 6);
      showLicense(data);
    } catch (error) {
      console.warn("[aphelion success] automatic license lookup failed:", error);
      setStatus("We could not pull the key automatically yet. If you paid with an email, try the recovery box below or reopen this page in a moment.", true);
    }
  }

  async function restoreByEmail() {
    const email = String(restoreEmailInput?.value || "").trim().toLowerCase();
    if (!email) {
      setStatus("Enter the email you used during checkout first.", true);
      return;
    }

    setStatus("Looking up your saved APHELION license...");

    try {
      const response = await fetch(`${API_BASE}/restore-license?email=${encodeURIComponent(email)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error(data?.details || data?.error || `HTTP_${response.status}`);
      }
      showLicense({ ...data, email });
    } catch (error) {
      console.warn("[aphelion success] restore by email failed:", error);
      setStatus("No saved purchase was found for that email yet. Double-check the address or wait a moment for the webhook to finish.", true);
    }
  }

  if (copyLicenseBtn) {
    copyLicenseBtn.addEventListener("click", async () => {
      const key = String(licenseKeyOutput?.textContent || "").trim();
      if (!key || key === "Unavailable") return;

      try {
        await navigator.clipboard.writeText(key);
        copyLicenseBtn.textContent = "Copied!";
      } catch (error) {
        console.warn("[aphelion success] clipboard copy failed:", error);
        copyLicenseBtn.textContent = "Copy failed";
      }

      setTimeout(() => {
        copyLicenseBtn.textContent = "Copy key";
      }, 1200);
    });
  }

  if (restoreEmailBtn) {
    restoreEmailBtn.addEventListener("click", restoreByEmail);
  }

  if (restoreEmailInput) {
    restoreEmailInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        restoreByEmail();
      }
    });
  }

  loadLicenseKey();
})();
