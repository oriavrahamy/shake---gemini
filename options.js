const DEFAULTS = {
  sensitivity: 10,
  popupWidthPercent: 27,
  popupHeightPercent: 100,
  maxPointerDistancePx: 270,
  layoutVersion: 3
};

const form = document.getElementById("options-form");
const sensitivity = document.getElementById("sensitivity");
const popupWidthPercent = document.getElementById("popupWidthPercent");
const maxPointerDistancePx = document.getElementById("maxPointerDistancePx");
const status = document.getElementById("status");
const restoreDefaults = document.getElementById("restore-defaults");

const outputs = {
  sensitivity: document.getElementById("sensitivity-output"),
  popupWidthPercent: document.getElementById("popup-width-output"),
  maxPointerDistancePx: document.getElementById("distance-output")
};

chrome.storage.sync.get({ ...DEFAULTS, layoutVersion: 0 }, (settings) => {
  if (settings.layoutVersion < DEFAULTS.layoutVersion) {
    if (settings.popupWidthPercent === 25) {
      settings.popupWidthPercent = DEFAULTS.popupWidthPercent;
    }

    settings.layoutVersion = DEFAULTS.layoutVersion;
    chrome.storage.sync.set({
      popupWidthPercent: settings.popupWidthPercent,
      layoutVersion: DEFAULTS.layoutVersion
    });
  }

  if (settings.maxPointerDistancePx < 220) {
    settings.maxPointerDistancePx = DEFAULTS.maxPointerDistancePx;
    chrome.storage.sync.set({ maxPointerDistancePx: DEFAULTS.maxPointerDistancePx });
  }

  applySettings(settings);
});

form.addEventListener("input", updateOutputs);
form.addEventListener("submit", (event) => {
  event.preventDefault();

  const settings = readSettings();
  chrome.storage.sync.set(settings, () => {
    showStatus("נשמר");
  });
});

restoreDefaults.addEventListener("click", () => {
  applySettings(DEFAULTS);
  chrome.storage.sync.set(DEFAULTS, () => {
    showStatus("ההגדרות אופסו");
  });
});

function applySettings(settings) {
  sensitivity.value = settings.sensitivity;
  popupWidthPercent.value = settings.popupWidthPercent ?? settings.panelWidthPercent ?? DEFAULTS.popupWidthPercent;
  maxPointerDistancePx.value = settings.maxPointerDistancePx;
  updateOutputs();
}

function readSettings() {
  return {
    sensitivity: Number(sensitivity.value),
    popupWidthPercent: Number(popupWidthPercent.value),
    popupHeightPercent: DEFAULTS.popupHeightPercent,
    layoutVersion: DEFAULTS.layoutVersion,
    maxPointerDistancePx: Number(maxPointerDistancePx.value)
  };
}

function updateOutputs() {
  outputs.sensitivity.textContent = `${sensitivity.value} - ערך נמוך מזהה ניענוע מהר יותר`;
  outputs.popupWidthPercent.textContent = `${popupWidthPercent.value}% מרוחב שטח העבודה הזמין`;
  outputs.maxPointerDistancePx.textContent = `${maxPointerDistancePx.value} פיקסלים - בתנועה איטית הכפתור ינסה לעקוב`;
}

function showStatus(message) {
  status.textContent = message;
  window.setTimeout(() => {
    status.textContent = "";
  }, 1800);
}
