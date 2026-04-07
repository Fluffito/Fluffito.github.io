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
      console.warn("[aphelion checkout] could not persist api base:", error);
    }
  }

  const API_BASE = String(
    window.APHELION_API_BASE
      || apiBaseFromUrl
      || localStorage.getItem("aphelionApiBase")
      || DEFAULT_API_BASE
  ).replace(/\/$/, "");

  const checkoutLinks = Array.from(document.querySelectorAll(".checkout-link[data-plan]"));
  if (!checkoutLinks.length) return;

  async function startCheckout(event) {
    const link = event.currentTarget;
    const plan = link.getAttribute("data-plan");
    const fallbackUrl = link.getAttribute("href");
    if (!plan || !fallbackUrl) return;

    event.preventDefault();

    const originalLabel = link.textContent;
    link.classList.add("btn-disabled");
    if (link.classList.contains("btn")) {
      link.textContent = "Opening checkout...";
    }

    try {
      const response = await fetch(`${API_BASE}/create-checkout-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ plan })
      });

      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.url) {
        try {
          localStorage.setItem("aphelionApiBase", API_BASE);
        } catch (error) {
          console.warn("[aphelion checkout] could not save api base:", error);
        }
        window.location.href = data.url;
        return;
      }

      window.location.href = data?.fallbackUrl || fallbackUrl;
    } catch (error) {
      console.warn("[aphelion checkout] falling back to direct Stripe link:", error);
      window.location.href = fallbackUrl;
    } finally {
      setTimeout(() => {
        link.classList.remove("btn-disabled");
        if (link.classList.contains("btn")) {
          link.textContent = originalLabel;
        }
      }, 250);
    }
  }

  checkoutLinks.forEach((link) => {
    link.addEventListener("click", startCheckout);
  });
})();
