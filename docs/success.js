(() => {
  const DEFAULT_API_BASE = window.location.hostname && !/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)
    ? window.location.origin
    : "http://localhost:3000";

  const API_BASE = String(
    window.APHELION_API_BASE
      || localStorage.getItem("aphelionApiBase")
      || DEFAULT_API_BASE
  ).replace(/\/$/, "");

  const statusTag = document.getElementById("statusTag");
  const statusCopy = document.getElementById("purchaseStatus");
  const licensePanel = document.getElementById("licensePanel");
  const licenseTypeLabel = document.getElementById("licenseTypeLabel");
  const licenseKeyOutput = document.getElementById("licenseKeyOutput");
  const copyLicenseBtn = document.getElementById("copyLicenseBtn");

  function setStatus(message, isError = false) {
    if (statusCopy) {
      statusCopy.textContent = message;
      statusCopy.classList.toggle("is-error", Boolean(isError));
    }
    if (statusTag) {
      statusTag.textContent = isError ? "Needs setup" : "Payment success";
    }
  }

  async function loadLicenseKey() {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");

    if (!sessionId) {
      setStatus("No Stripe session ID was found in the URL yet. Finish checkout first or use the Restore Purchase field in the extension popup.", true);
      return;
    }

    setStatus("Checking your Stripe session and pulling your APHELION license key...");

    try {
      const response = await fetch(`${API_BASE}/checkout-status?session_id=${encodeURIComponent(sessionId)}`);
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data?.ok) {
        throw new Error(data?.details || data?.error || `HTTP_${response.status}`);
      }

      if (licensePanel) licensePanel.hidden = false;
      if (licenseTypeLabel) {
        licenseTypeLabel.textContent = `${data.licenseType || "APHELION"} key`;
      }
      if (licenseKeyOutput) {
        licenseKeyOutput.textContent = data.licenseKey || "Unavailable";
      }

      const buyerEmail = data?.email ? ` for ${data.email}` : "";
      setStatus(`${data.licenseType || "Paid plan"} is ready${buyerEmail}. Copy the key below now and keep your purchase email as a backup for Restore Purchase.`);
    } catch (error) {
      console.warn("[aphelion success] automatic license lookup failed:", error);
      setStatus("Your payment can succeed before the key server is configured. Set your deployed APHELION server URL plus Stripe secret/price IDs, then retry this page — or use the manual key flow for now.", true);
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

  loadLicenseKey();
})();
