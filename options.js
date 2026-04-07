// options.js — APHELION settings

document.addEventListener("DOMContentLoaded", () => {
  const PLAN_UNLIMITED = "unlimited-bonk";
  const DEFAULT_REPLACEMENT_IMAGE_URL = "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='360' viewBox='0 0 640 360'%3E%3Crect width='640' height='360' fill='%23111111'/%3E%3Ctext x='50%25' y='48%25' dominant-baseline='middle' text-anchor='middle' fill='%23c7b3ff' font-family='Arial,sans-serif' font-size='30'%3EAPHELION%3C/text%3E%3Ctext x='50%25' y='60%25' dominant-baseline='middle' text-anchor='middle' fill='%239a94c9' font-family='Arial,sans-serif' font-size='18'%3EBONKED%3C/text%3E%3C/svg%3E";
  const DEFAULT_BLOCK_SOUND_VOLUME = 0.65;

  const glyphSelect = document.getElementById("censorGlyph");
  const customInput = document.getElementById("customGlyph");
  const imageBlockMode = document.getElementById("imageBlockMode");
  const replacementImageUrl = document.getElementById("replacementImageUrl");
  const imageDropzone = document.getElementById("imageDropzone");
  const replacementImageFile = document.getElementById("replacementImageFile");
  const filePickerBtn = document.getElementById("filePickerBtn");
  const resetReplacementBtn = document.getElementById("resetReplacementBtn");
  const replacementPreview = document.getElementById("replacementPreview");
  const imageBlockSoundEnabled = document.getElementById("imageBlockSoundEnabled");
  const blockSoundVolume = document.getElementById("blockSoundVolume");
  const blockSoundVolumeValue = document.getElementById("blockSoundVolumeValue");
  const soundDropzone = document.getElementById("soundDropzone");
  const blockSoundFile = document.getElementById("blockSoundFile");
  const soundPickerBtn = document.getElementById("soundPickerBtn");
  const testSoundBtn = document.getElementById("testSoundBtn");
  const resetSoundBtn = document.getElementById("resetSoundBtn");
  const soundPreview = document.getElementById("soundPreview");
  const soundPlanNote = document.getElementById("soundPlanNote");
  const saveBtn = document.getElementById("saveBtn");
  const status = document.getElementById("status");

  if (!glyphSelect || !customInput || !imageBlockMode || !replacementImageUrl || !imageDropzone || !replacementImageFile || !filePickerBtn || !resetReplacementBtn || !replacementPreview || !imageBlockSoundEnabled || !blockSoundVolume || !blockSoundVolumeValue || !soundDropzone || !blockSoundFile || !soundPickerBtn || !testSoundBtn || !resetSoundBtn || !soundPreview || !soundPlanNote || !saveBtn || !status) {
    console.warn("APHELION options page is missing expected elements.");
    return;
  }

  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
    const message = "Extension storage unavailable. Open this page from the extension options only.";
    console.warn(message);
    status.textContent = message;
    return;
  }

  let currentPlanTier = "free";

  function setPreview(src) {
    if (typeof src === "string" && src.trim()) {
      replacementPreview.src = src;
      replacementPreview.style.display = "block";
      return;
    }
    replacementPreview.removeAttribute("src");
    replacementPreview.style.display = "none";
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

  function setStatus(msg) {
    status.textContent = msg;
    if (!msg) return;
    setTimeout(() => {
      if (status.textContent === msg) status.textContent = "";
    }, 4000);
  }

  function updateSoundNote() {
    soundPlanNote.textContent = currentPlanTier === PLAN_UNLIMITED
      ? "Unlimited Bonk active. Your image bonk sound is live."
      : "Only active on Unlimited Bonk ($5 plan). You can still preload your sound here.";
  }

  function updateVolumeLabel() {
    const percent = Math.max(0, Math.min(100, Number(blockSoundVolume.value) || 65));
    blockSoundVolumeValue.textContent = `${percent}%`;
  }

  function playDefaultBonk(volume = DEFAULT_BLOCK_SOUND_VOLUME) {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) {
      setStatus("Audio preview is unavailable in this browser.");
      return;
    }
    try {
      const ctx = new AudioCtor();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
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
    } catch (error) {
      console.warn("Could not play default bonk preview:", error);
      setStatus("Could not play the preview sound in this tab.");
    }
  }

  function previewSound() {
    const src = soundPreview.getAttribute("src") || "";
    const volume = Math.max(0, Math.min(1, (Number(blockSoundVolume.value) || 65) / 100));
    if (!src) {
      playDefaultBonk(volume);
      setStatus("Playing the default bonk sound.");
      return;
    }
    soundPreview.volume = volume;
    soundPreview.currentTime = 0;
    soundPreview.play()
      .then(() => setStatus("Playing your custom bonk sound."))
      .catch((error) => {
        console.warn("Custom sound preview blocked:", error);
        setStatus("The browser blocked playback until you interact with the page.");
      });
  }

  function handleImageFile(file) {
    if (!file) return;
    if (!file.type || !file.type.startsWith("image/")) {
      setStatus("Please select an image file.");
      return;
    }
    if (file.size > 1_500_000) {
      setStatus("Image is too large. Use an image under 1.5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl.startsWith("data:image/")) {
        setStatus("Could not read image. Try another file.");
        return;
      }
      replacementImageUrl.value = dataUrl;
      imageBlockMode.value = "replace";
      setPreview(dataUrl);
      setStatus("Image loaded. Click Save Settings to apply.");
    };
    reader.onerror = () => setStatus("Failed to read image file.");
    reader.readAsDataURL(file);
  }

  function handleSoundFile(file) {
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
        setStatus("Could not read the sound file. Try another one.");
        return;
      }
      imageBlockSoundEnabled.value = "on";
      setSoundPreview(dataUrl);
      setStatus("Sound loaded. Click Save Settings to apply.");
    };
    reader.onerror = () => setStatus("Failed to read sound file.");
    reader.readAsDataURL(file);
  }

  chrome.storage.local.get([
    "censorGlyph",
    "imageBlockMode",
    "replacementImageUrl",
    "imageBlockSoundEnabled",
    "blockSoundDataUrl",
    "blockSoundVolume",
    "planTier"
  ], (res) => {
    const current = res.censorGlyph || "✦✦✦";
    const options = Array.from(glyphSelect.options);
    const preset = options.find((opt) => opt.value === current);
    if (preset) {
      glyphSelect.value = current;
      customInput.value = "";
    } else {
      glyphSelect.value = "";
      customInput.value = current;
    }

    imageBlockMode.value = ["blur", "hide", "replace"].includes(res.imageBlockMode) ? res.imageBlockMode : "blur";
    replacementImageUrl.value = typeof res.replacementImageUrl === "string" ? res.replacementImageUrl : "";
    if (imageBlockMode.value === "replace") setPreview(replacementImageUrl.value || DEFAULT_REPLACEMENT_IMAGE_URL);
    else setPreview(replacementImageUrl.value);

    imageBlockSoundEnabled.value = res.imageBlockSoundEnabled ? "on" : "off";
    const initialVolume = Math.max(0, Math.min(100, Math.round((Number(res.blockSoundVolume) || DEFAULT_BLOCK_SOUND_VOLUME) * 100)));
    blockSoundVolume.value = String(initialVolume || 65);
    updateVolumeLabel();
    setSoundPreview(typeof res.blockSoundDataUrl === "string" ? res.blockSoundDataUrl : "");

    currentPlanTier = res?.planTier === PLAN_UNLIMITED ? PLAN_UNLIMITED : "free";
    updateSoundNote();
  });

  replacementImageUrl.addEventListener("input", () => {
    const value = replacementImageUrl.value.trim();
    if (value) setPreview(value);
    else if (imageBlockMode.value === "replace") setPreview(DEFAULT_REPLACEMENT_IMAGE_URL);
    else setPreview("");
  });

  imageBlockMode.addEventListener("change", () => {
    const value = replacementImageUrl.value.trim();
    if (imageBlockMode.value === "replace") setPreview(value || DEFAULT_REPLACEMENT_IMAGE_URL);
    else if (value) setPreview(value);
    else setPreview("");
  });

  blockSoundVolume.addEventListener("input", updateVolumeLabel);

  ["dragenter", "dragover"].forEach((evt) => {
    imageDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      imageDropzone.classList.add("dragover");
    });
    soundDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      soundDropzone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((evt) => {
    imageDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      imageDropzone.classList.remove("dragover");
    });
    soundDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      soundDropzone.classList.remove("dragover");
    });
  });

  imageDropzone.addEventListener("drop", (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files[0]) handleImageFile(files[0]);
  });

  soundDropzone.addEventListener("drop", (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files[0]) handleSoundFile(files[0]);
  });

  imageDropzone.addEventListener("click", () => replacementImageFile.click());
  filePickerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    replacementImageFile.click();
  });
  resetReplacementBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    replacementImageUrl.value = "";
    if (imageBlockMode.value === "replace") setPreview(DEFAULT_REPLACEMENT_IMAGE_URL);
    else setPreview("");
    setStatus("Custom replacement cleared. Default APHELION image will be used in replace mode.");
  });
  imageDropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      replacementImageFile.click();
    }
  });
  replacementImageFile.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleImageFile(file);
    replacementImageFile.value = "";
  });

  soundDropzone.addEventListener("click", () => blockSoundFile.click());
  soundPickerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    blockSoundFile.click();
  });
  testSoundBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    previewSound();
  });
  resetSoundBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setSoundPreview("");
    imageBlockSoundEnabled.value = "off";
    setStatus("Custom sound cleared. APHELION will use the default bonk when sound is enabled.");
  });
  soundDropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      blockSoundFile.click();
    }
  });
  blockSoundFile.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) handleSoundFile(file);
    blockSoundFile.value = "";
  });

  saveBtn.addEventListener("click", () => {
    const selected = glyphSelect.value;
    const custom = customInput.value.trim();
    const glyph = custom || selected || "✦✦✦";
    const mode = ["blur", "hide", "replace"].includes(imageBlockMode.value) ? imageBlockMode.value : "blur";
    const replacement = replacementImageUrl.value.trim();
    const safeReplacement = (/^https?:\/\//i.test(replacement) || /^data:image\//i.test(replacement)) ? replacement : "";
    const rawSound = (soundPreview.getAttribute("src") || "").trim();
    const safeSound = (/^https?:\/\//i.test(rawSound) || /^data:audio\//i.test(rawSound)) ? rawSound : "";
    const volume = Math.max(0, Math.min(1, (Number(blockSoundVolume.value) || 65) / 100));

    chrome.storage.local.set({
      censorGlyph: glyph,
      imageBlockMode: mode,
      replacementImageUrl: safeReplacement,
      imageBlockSoundEnabled: imageBlockSoundEnabled.value === "on",
      blockSoundDataUrl: safeSound,
      blockSoundVolume: volume
    }, () => {
      if (chrome.runtime.lastError) {
        setStatus(chrome.runtime.lastError.message || "Could not save settings.");
        return;
      }
      updateSoundNote();
      setStatus("Settings saved! Reload pages to apply.");
    });
  });
});