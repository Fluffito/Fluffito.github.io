(() => {
  const STORAGE_KEY = "aphelionWebSettings";
  const DEFAULTS = {
    censorGlyph: "✦✦✦",
    imageBlockMode: "blur",
    replacementImageUrl: "",
    imageBlockSoundEnabled: false,
    blockSoundDataUrl: "",
    blockSoundVolume: 0.65,
    planTier: "free"
  };

  const menuToggle = document.getElementById("siteMenuToggle");
  const menuClose = document.getElementById("siteMenuClose");
  const overlay = document.getElementById("siteMenuOverlay");
  const panel = document.getElementById("siteMenuPanel");
  const form = document.getElementById("siteSettingsForm");
  const tabButtons = Array.from(document.querySelectorAll(".site-tab-btn"));
  const tabPanels = Array.from(document.querySelectorAll(".site-tab-panel"));
  const censorGlyph = document.getElementById("siteCensorGlyph");
  const customGlyph = document.getElementById("siteCustomGlyph");
  const imageMode = document.getElementById("siteImageMode");
  const replacementImageUrl = document.getElementById("siteReplacementImageUrl");
  const previewGlyph = document.getElementById("sitePreviewGlyph");
  const previewSummary = document.getElementById("sitePreviewSummary");
  const imageDropzone = document.getElementById("siteImageDropzone");
  const imagePickerBtn = document.getElementById("siteImagePickerBtn");
  const imageResetBtn = document.getElementById("siteImageResetBtn");
  const imagePreview = document.getElementById("siteImagePreview");
  const imageFile = document.getElementById("siteImageFile");
  const soundEnabled = document.getElementById("siteSoundEnabled");
  const soundVolume = document.getElementById("siteSoundVolume");
  const soundVolumeValue = document.getElementById("siteSoundVolumeValue");
  const soundUrl = document.getElementById("siteCustomSoundUrl");
  const soundDropzone = document.getElementById("siteSoundDropzone");
  const soundPickerBtn = document.getElementById("siteSoundPickerBtn");
  const soundResetBtn = document.getElementById("siteSoundResetBtn");
  const soundPreview = document.getElementById("siteSoundPreview");
  const soundFile = document.getElementById("siteSoundFile");
  const status = document.getElementById("siteSettingsStatus");
  const testBonkBtn = document.getElementById("siteTestBonkBtn");
  const PLAN_FREE = "free";
  const PLAN_UNLIMITED = "unlimited-bonk";
  let currentPlanTier = PLAN_FREE;
  let hasConfirmedExtensionPlan = false;
  let syncTimer = null;

  if (!menuToggle || !menuClose || !overlay || !panel || !form || !tabButtons.length || !tabPanels.length || !censorGlyph || !customGlyph || !imageMode || !replacementImageUrl || !previewGlyph || !previewSummary || !imageDropzone || !imagePickerBtn || !imageResetBtn || !imagePreview || !imageFile || !soundEnabled || !soundVolume || !soundVolumeValue || !soundUrl || !soundDropzone || !soundPickerBtn || !soundResetBtn || !soundPreview || !soundFile || !status || !testBonkBtn) {
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
  }

  function updateVolumeLabel() {
    const percent = Math.max(0, Math.min(100, Number(soundVolume.value) || 65));
    soundVolumeValue.textContent = `${percent}%`;
  }

  function isUnlimitedPlan() {
    return currentPlanTier === PLAN_UNLIMITED;
  }

  function confirmPlanTier(planTier) {
    if (planTier === PLAN_UNLIMITED || planTier === PLAN_FREE) {
      currentPlanTier = planTier;
      hasConfirmedExtensionPlan = true;
    }
  }

  function isKnownFreePlan() {
    return hasConfirmedExtensionPlan && currentPlanTier === PLAN_FREE;
  }

  function promptPaidUpgrade(message, jumpToPricing = false) {
    soundEnabled.value = "off";
    setSoundPreview("");
    updateLivePreview();
    setStatus(message || "Bonk sounds are part of Unlimited Bonk. See Pricing Preview to unlock them.");
    if (jumpToPricing) {
      const pricingSection = document.getElementById("pricing");
      if (pricingSection && typeof pricingSection.scrollIntoView === "function") {
        pricingSection.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      window.location.hash = "pricing";
      closePanel();
    }
  }

  function updateLivePreview() {
    const glyph = String(customGlyph.value || censorGlyph.value || DEFAULTS.censorGlyph).trim() || DEFAULTS.censorGlyph;
    previewGlyph.textContent = glyph;

    const imageLabel = imageMode.value === "hide"
      ? "hide"
      : imageMode.value === "replace"
        ? "replace"
        : "blur";
    const hasCustomSound = Boolean(String(soundUrl.value || soundPreview.getAttribute("src") || "").trim());
    const soundLabel = isKnownFreePlan()
      ? "locked on the Free plan"
      : soundEnabled.value === "on"
        ? (hasCustomSound ? "on with your custom sound" : "on")
        : "off";
    previewSummary.textContent = `Images will ${imageLabel} and bonk sounds are ${soundLabel}.`;
  }

  function syncSettings(showMessage = false) {
    const settings = readFormSettings();
    saveLocalSettings(settings);
    updateLivePreview();
    if (showMessage) {
      setStatus("Saved on the website. Trying to sync to APHELION...");
      startSyncTimeout("Saved on the website. Install or refresh APHELION here to sync these settings into the extension.");
    }
    window.postMessage({
      sender: "aphelion-site-panel",
      type: "APHELION_WEBSITE_SAVE_SETTINGS",
      settings
    }, "*");
  }

  function setImagePreview(src) {
    const value = String(src || "").trim();
    if (value && (/^https?:\/\//i.test(value) || /^data:image\//i.test(value))) {
      imagePreview.src = value;
      imagePreview.style.display = "block";
      return;
    }
    imagePreview.removeAttribute("src");
    imagePreview.style.display = "none";
  }

  function openImagePicker() {
    if (isKnownFreePlan()) {
      promptPaidUpgrade("Custom replacement image uploads are part of Unlimited Bonk. See Pricing Preview to unlock them.", true);
      return;
    }
    try {
      if (typeof imageFile.showPicker === "function") {
        imageFile.showPicker();
      } else {
        imageFile.click();
      }
    } catch (error) {
      imageFile.click();
    }
  }

  function openSoundPicker() {
    if (isKnownFreePlan()) {
      promptPaidUpgrade("Bonk sounds are part of Unlimited Bonk. See Pricing Preview to unlock them.", true);
      return;
    }
    try {
      if (typeof soundFile.showPicker === "function") {
        soundFile.showPicker();
      } else {
        soundFile.click();
      }
    } catch (error) {
      soundFile.click();
    }
  }

  function setSoundPreview(src) {
    const value = String(src || "").trim();
    if (value && (/^data:audio\//i.test(value) || /^https?:\/\//i.test(value))) {
      soundPreview.src = value;
      soundPreview.style.display = "block";
      return;
    }
    try {
      soundPreview.pause();
    } catch (error) {
      // ignore preview pause issues
    }
    soundPreview.removeAttribute("src");
    soundPreview.style.display = "none";
  }

  function handleImageFile(file) {
    if (isKnownFreePlan()) {
      promptPaidUpgrade("Custom replacement image uploads are part of Unlimited Bonk. See Pricing Preview to unlock them.", true);
      return;
    }
    if (!file) return;
    if (!file.type || !file.type.startsWith("image/")) {
      setStatus("Please choose an image file.");
      return;
    }
    if (file.size > 5_000_000) {
      setStatus("Image is too large. Use an image under 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl.startsWith("data:image/")) {
        setStatus("Could not read that image. Try another one.");
        return;
      }
      replacementImageUrl.value = dataUrl;
      imageMode.value = "replace";
      setImagePreview(dataUrl);
      updateLivePreview();
      setStatus("Image loaded. It will sync to APHELION now.");
      syncSettings();
    };
    reader.onerror = () => setStatus("Failed to read the selected image file.");
    reader.readAsDataURL(file);
  }

  function handleSoundFile(file) {
    if (isKnownFreePlan()) {
      promptPaidUpgrade("Custom bonk uploads are part of Unlimited Bonk. See Pricing Preview to unlock them.", true);
      return;
    }
    if (!file) return;
    if (!file.type || !file.type.startsWith("audio/")) {
      setStatus("Please choose an audio file such as MP3, WAV, or OGG.");
      return;
    }
    if (file.size > 2_000_000) {
      setStatus("Sound file is too large. Use a file under 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl.startsWith("data:audio/")) {
        setStatus("Could not read that sound file. Try another one.");
        return;
      }
      soundEnabled.value = "on";
      soundUrl.value = dataUrl;
      setSoundPreview(dataUrl);
      updateLivePreview();
      setStatus("Sound loaded. It will sync to APHELION now.");
      syncSettings();
    };
    reader.onerror = () => setStatus("Failed to read the selected sound file.");
    reader.readAsDataURL(file);
  }

  function applySettings(settings, confirmPlan = false) {
    const incomingPlanTier = settings?.planTier === PLAN_UNLIMITED
      ? PLAN_UNLIMITED
      : settings?.planTier === PLAN_FREE
        ? PLAN_FREE
        : "";
    if (incomingPlanTier) {
      currentPlanTier = incomingPlanTier;
      if (confirmPlan) {
        hasConfirmedExtensionPlan = true;
      }
    }
    const glyphValue = String(settings.censorGlyph || DEFAULTS.censorGlyph).trim() || DEFAULTS.censorGlyph;
    const presetMatch = Array.from(censorGlyph.options).find((option) => option.value === glyphValue);
    censorGlyph.value = presetMatch ? presetMatch.value : DEFAULTS.censorGlyph;
    customGlyph.value = presetMatch ? "" : glyphValue;
    imageMode.value = ["blur", "hide", "replace"].includes(settings.imageBlockMode) ? settings.imageBlockMode : DEFAULTS.imageBlockMode;
    replacementImageUrl.value = typeof settings.replacementImageUrl === "string" ? settings.replacementImageUrl : "";
    setImagePreview(replacementImageUrl.value);
    soundEnabled.value = isUnlimitedPlan() && settings.imageBlockSoundEnabled ? "on" : "off";
    soundUrl.value = isUnlimitedPlan() && typeof settings.blockSoundDataUrl === "string" ? settings.blockSoundDataUrl : "";
    setSoundPreview(soundUrl.value);
    soundVolume.value = String(Math.max(0, Math.min(100, Math.round((Number(settings.blockSoundVolume) || DEFAULTS.blockSoundVolume) * 100))));
    updateVolumeLabel();
    updateLivePreview();
  }

  function readFormSettings() {
    const chosenGlyph = String(customGlyph.value || censorGlyph.value || DEFAULTS.censorGlyph).trim() || DEFAULTS.censorGlyph;
    const replacement = String(replacementImageUrl.value || "").trim();
    const safeReplacement = (/^https?:\/\//i.test(replacement) || /^data:image\//i.test(replacement)) ? replacement : "";
    const rawSound = String(soundUrl.value || soundPreview.getAttribute("src") || "").trim();
    const safeSound = (/^https?:\/\//i.test(rawSound) || /^data:audio\//i.test(rawSound)) ? rawSound : "";
    return {
      censorGlyph: chosenGlyph,
      imageBlockMode: imageMode.value,
      replacementImageUrl: safeReplacement,
      imageBlockSoundEnabled: isUnlimitedPlan() && soundEnabled.value === "on",
      blockSoundDataUrl: isUnlimitedPlan() ? safeSound : "",
      blockSoundVolume: Math.max(0, Math.min(1, (Number(soundVolume.value) || 65) / 100)),
      planTier: currentPlanTier
    };
  }

  function setActiveTab(name) {
    tabButtons.forEach((button) => {
      const isActive = button.dataset.tab === name;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    tabPanels.forEach((panelEl) => {
      const isActive = panelEl.dataset.panel === name;
      panelEl.classList.toggle("is-active", isActive);
      panelEl.hidden = !isActive;
    });
    if (panel) {
      panel.scrollTop = 0;
    }
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

  function playDefaultPreviewBonk() {
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

  function playPreviewBonk() {
    if (isKnownFreePlan()) {
      promptPaidUpgrade("Bonk sounds are part of Unlimited Bonk. See Pricing Preview to unlock them.", true);
      return;
    }
    const customSound = String(soundUrl.value || soundPreview.getAttribute("src") || "").trim();
    const volume = Math.max(0, Math.min(1, (Number(soundVolume.value) || 65) / 100));
    if (!customSound) {
      playDefaultPreviewBonk();
      return;
    }
    soundPreview.volume = volume;
    soundPreview.currentTime = 0;
    soundPreview.play()
      .then(() => setStatus("Playing your custom bonk sound."))
      .catch(() => playDefaultPreviewBonk());
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || typeof msg !== "object" || msg.sender !== "aphelion-extension") return;

    if (msg.type === "APHELION_WEBSITE_SETTINGS" && msg.settings) {
      clearTimeout(syncTimer);
      confirmPlanTier(msg.settings.planTier);
      const merged = { ...loadLocalSettings(), ...msg.settings, planTier: currentPlanTier || msg.settings.planTier };
      saveLocalSettings(merged);
      applySettings(merged, true);
      setStatus("Connected to the installed APHELION extension.");
      return;
    }

    if (msg.type === "APHELION_WEBSITE_SYNC_ACK") {
      clearTimeout(syncTimer);
      confirmPlanTier(msg.planTier);
      if (!msg.ok && /PAID_FEATURE_REQUIRES_UNLIMITED_BONK/i.test(String(msg.error || ""))) {
        promptPaidUpgrade("Bonk sounds are locked on the Free plan. See Pricing Preview to unlock them.", true);
        return;
      }
      setStatus(msg.ok ? "Saved on the site and synced to APHELION." : `Could not sync to the extension: ${msg.error || "unknown error"}`);
    }
  });

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveTab(button.dataset.tab || "general");
    });
  });

  menuToggle.addEventListener("click", openPanel);
  menuClose.addEventListener("click", closePanel);
  overlay.addEventListener("click", closePanel);
  soundVolume.addEventListener("input", () => {
    updateVolumeLabel();
    syncSettings();
  });
  [censorGlyph, customGlyph].forEach((element) => {
    element.addEventListener("change", () => syncSettings());
    element.addEventListener("input", () => syncSettings());
  });
  imageMode.addEventListener("change", () => {
    if (imageMode.value === "replace" && isKnownFreePlan()) {
      imageMode.value = "blur";
      promptPaidUpgrade("Custom replacement image mode is part of Unlimited Bonk. See Pricing Preview to unlock it.", true);
      syncSettings();
      return;
    }
    syncSettings();
  });
  imageMode.addEventListener("input", () => {
    if (imageMode.value === "replace" && isKnownFreePlan()) {
      imageMode.value = "blur";
      promptPaidUpgrade("Custom replacement image mode is part of Unlimited Bonk. See Pricing Preview to unlock it.", true);
      syncSettings();
      return;
    }
    syncSettings();
  });
  soundEnabled.addEventListener("change", () => {
    if (soundEnabled.value === "on" && isKnownFreePlan()) {
      promptPaidUpgrade("Bonk sounds are part of Unlimited Bonk. See Pricing Preview to unlock them.", true);
      syncSettings();
      return;
    }
    syncSettings();
  });
  replacementImageUrl.addEventListener("input", () => {
    setImagePreview(replacementImageUrl.value.trim());
    syncSettings();
  });
  soundUrl.addEventListener("input", () => {
    if (isKnownFreePlan() && soundUrl.value.trim()) {
      promptPaidUpgrade("Custom bonk uploads are part of Unlimited Bonk. See Pricing Preview to unlock them.", true);
      syncSettings();
      return;
    }
    setSoundPreview(soundUrl.value.trim());
    syncSettings();
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    imageDropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (isKnownFreePlan()) {
        promptPaidUpgrade("Custom replacement image uploads are part of Unlimited Bonk. See Pricing Preview to unlock them.", true);
        return;
      }
      imageDropzone.classList.add("dragover");
    });
    soundDropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      soundDropzone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    imageDropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      imageDropzone.classList.remove("dragover");
    });
    soundDropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      soundDropzone.classList.remove("dragover");
    });
  });

  imageDropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    const files = event.dataTransfer && event.dataTransfer.files;
    if (files && files[0]) handleImageFile(files[0]);
  });
  soundDropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    const files = event.dataTransfer && event.dataTransfer.files;
    if (files && files[0]) handleSoundFile(files[0]);
  });
  imageDropzone.addEventListener("click", (event) => {
    if (event.target && event.target.closest("button")) return;
    openImagePicker();
  });
  soundDropzone.addEventListener("click", (event) => {
    if (event.target && event.target.closest("button")) return;
    openSoundPicker();
  });
  imageDropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openImagePicker();
    }
  });
  soundDropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openSoundPicker();
    }
  });
  imagePickerBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openImagePicker();
  });
  soundPickerBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openSoundPicker();
  });
  imageResetBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    replacementImageUrl.value = "";
    setImagePreview("");
    updateLivePreview();
    setStatus("Custom replacement image cleared.");
    syncSettings();
  });
  soundResetBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    soundUrl.value = "";
    setSoundPreview("");
    soundEnabled.value = "off";
    updateLivePreview();
    setStatus("Custom bonk sound cleared.");
    syncSettings();
  });
  imageFile.addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) handleImageFile(file);
    imageFile.value = "";
  });
  soundFile.addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) handleSoundFile(file);
    soundFile.value = "";
  });
  testBonkBtn.addEventListener("click", playPreviewBonk);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panel.classList.contains("is-open")) {
      closePanel();
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    syncSettings(true);
  });

  setActiveTab("general");
  applySettings(loadLocalSettings());
  setStatus("These controls save on the website and sync if APHELION is installed.");
  startSyncTimeout("Saved on the website. Install or refresh APHELION here to sync these settings into the extension.");
  window.postMessage({ sender: "aphelion-site-panel", type: "APHELION_WEBSITE_GET_SETTINGS" }, "*");
})();
