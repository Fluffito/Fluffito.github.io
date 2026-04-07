(() => {
  const STORAGE_KEY = "aphelionWebSettings";
  const DEFAULTS = {
    censorGlyph: "✦✦✦",
    imageBlockMode: "blur",
    imageBlockSoundEnabled: false,
    blockSoundVolume: 0.65,
    aphelionApiBase: ""
  };

  const menuToggle = document.getElementById("siteMenuToggle");
  const menuClose = document.getElementById("siteMenuClose");
  const overlay = document.getElementById("siteMenuOverlay");
  const panel = document.getElementById("siteMenuPanel");
  const form = document.getElementById("siteSettingsForm");
  const censorGlyph = document.getElementById("siteCensorGlyph");
  const imageMode = document.getElementById("siteImageMode");
  const soundEnabled = document.getElementById("siteSoundEnabled");
  const soundVolume = document.getElementById("siteSoundVolume");
  const soundVolumeValue = document.getElementById("siteSoundVolumeValue");
  const apiBase = document.getElementById("siteApiBase");
  const status = document.getElementById("siteSettingsStatus");
  const testBonkBtn = document.getElementById("siteTestBonkBtn");
  let syncTimer = null;

  if (!menuToggle || !menuClose || !overlay || !panel || !form || !censorGlyph || !imageMode || !soundEnabled || !soundVolume || !soundVolumeValue || !apiBase || !status || !testBonkBtn) {
    return;
  }

  function setStatus(message) {
    status.textContent = message;
  }

  function startSyncTimeout(message) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      setStatus(message);
    }, 1200);
  }

  function loadLocalSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return { ...DEFAULTS, ...(parsed && typeof parsed === "object" ? parsed : {}) };
    } catch (error) {
      return { ...DEFAULTS };
    }
  }

  function saveLocalSettings(settings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    if (settings.aphelionApiBase) {
      localStorage.setItem("aphelionApiBase", settings.aphelionApiBase);
    } else {
      localStorage.removeItem("aphelionApiBase");
    }
  }

  function updateVolumeLabel() {
    const percent = Math.max(0, Math.min(100, Number(soundVolume.value) || 65));
    soundVolumeValue.textContent = `${percent}%`;
  }

  function applySettings(settings) {
    censorGlyph.value = settings.censorGlyph || DEFAULTS.censorGlyph;
    imageMode.value = ["blur", "hide", "replace"].includes(settings.imageBlockMode) ? settings.imageBlockMode : DEFAULTS.imageBlockMode;
    soundEnabled.value = settings.imageBlockSoundEnabled ? "on" : "off";
    soundVolume.value = String(Math.max(0, Math.min(100, Math.round((Number(settings.blockSoundVolume) || DEFAULTS.blockSoundVolume) * 100))));
    apiBase.value = String(settings.aphelionApiBase || localStorage.getItem("aphelionApiBase") || "").trim();
    updateVolumeLabel();
  }

  function readFormSettings() {
    return {
      censorGlyph: String(censorGlyph.value || DEFAULTS.censorGlyph).trim() || DEFAULTS.censorGlyph,
      imageBlockMode: imageMode.value,
      imageBlockSoundEnabled: soundEnabled.value === "on",
      blockSoundVolume: Math.max(0, Math.min(1, (Number(soundVolume.value) || 65) / 100)),
      aphelionApiBase: String(apiBase.value || "").trim().replace(/\/$/, "")
    };
  }

  function openPanel() {
    document.body.classList.add("panel-open");
    overlay.hidden = false;
    panel.hidden = false;
    requestAnimationFrame(() => {
      overlay.classList.add("is-open");
      panel.classList.add("is-open");
      panel.setAttribute("aria-hidden", "false");
    });
  }

  function closePanel() {
    document.body.classList.remove("panel-open");
    overlay.classList.remove("is-open");
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
    setTimeout(() => {
      if (!panel.classList.contains("is-open")) {
        overlay.hidden = true;
        panel.hidden = true;
      }
    }, 180);
  }

  function playPreviewBonk() {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) {
      setStatus("Sound preview is unavailable in this browser.");
      return;
    }
    try {
      const ctx = new AudioCtor();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const volume = Math.max(0, Math.min(1, (Number(soundVolume.value) || 65) / 100));
      osc.type = "triangle";
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(70, now + 0.16);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.02, volume * 0.35), now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
      setStatus("Playing the bonk preview.");
    } catch (error) {
      setStatus("The browser blocked the sound preview. Click again after interacting.");
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || typeof msg !== "object" || msg.sender !== "aphelion-extension") return;

    if (msg.type === "APHELION_WEBSITE_SETTINGS" && msg.settings) {
      clearTimeout(syncTimer);
      const merged = { ...loadLocalSettings(), ...msg.settings };
      applySettings(merged);
      setStatus("Connected to the installed APHELION extension.");
      return;
    }

    if (msg.type === "APHELION_WEBSITE_SYNC_ACK") {
      clearTimeout(syncTimer);
      setStatus(msg.ok ? "Saved on the site and synced to APHELION." : `Could not sync to the extension: ${msg.error || "unknown error"}`);
    }
  });

  menuToggle.addEventListener("click", openPanel);
  menuClose.addEventListener("click", closePanel);
  overlay.addEventListener("click", closePanel);
  soundVolume.addEventListener("input", updateVolumeLabel);
  testBonkBtn.addEventListener("click", playPreviewBonk);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panel.classList.contains("is-open")) {
      closePanel();
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const settings = readFormSettings();
    saveLocalSettings(settings);
    setStatus("Saved on the website. Trying to sync to APHELION...");
    startSyncTimeout("Saved on the website. Install or refresh APHELION here to sync these settings into the extension.");
    window.postMessage({
      sender: "aphelion-site-panel",
      type: "APHELION_WEBSITE_SAVE_SETTINGS",
      settings
    }, "*");
  });

  applySettings(loadLocalSettings());
  setStatus("These controls save on the website and sync if APHELION is installed.");
  startSyncTimeout("Saved on the website. Install or refresh APHELION here to sync these settings into the extension.");
  window.postMessage({ sender: "aphelion-site-panel", type: "APHELION_WEBSITE_GET_SETTINGS" }, "*");
})();
