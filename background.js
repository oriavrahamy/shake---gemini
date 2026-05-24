const GEMINI_URL = "https://gemini.google.com/u/0/app";
const SESSION_RESTORE_KEY = "geminiWindowRestore";
const LAYOUT_VERSION = 3;
const BOTTOM_DOCK_SAFE_INSET = 72;
const WINDOW_GAP = 0;
const GEMINI_HEIGHT_EXTRA = 96;
const LAYOUT_RETRY_DELAYS_MS = [120, 450];
const DEFAULT_WINDOW_SETTINGS = {
  popupWidthPercent: 27,
  popupHeightPercent: 100
};

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getWindowBounds(windowId) {
  if (!windowId) {
    return { left: 80, top: 60, width: 1440, height: 900 };
  }

  try {
    return await chrome.windows.get(windowId);
  } catch {
    return { left: 80, top: 60, width: 1440, height: 900 };
  }
}

async function getWorkAreaForWindow(windowBounds) {
  try {
    const displays = await chrome.system.display.getInfo();
    const windowCenterX = (windowBounds.left ?? 0) + (windowBounds.width ?? 0) / 2;
    const windowCenterY = (windowBounds.top ?? 0) + (windowBounds.height ?? 0) / 2;
    const matchingDisplay = displays.find(({ bounds }) => {
      return (
        windowCenterX >= bounds.left &&
        windowCenterX <= bounds.left + bounds.width &&
        windowCenterY >= bounds.top &&
        windowCenterY <= bounds.top + bounds.height
      );
    });
    const display = matchingDisplay ?? displays.find((item) => item.isPrimary);
    const workArea = display?.workArea;

    if (workArea && display?.bounds) {
      return withDockSafeInset(workArea, display.bounds);
    }
  } catch {
    // Fall back to the current window bounds when display information is unavailable.
  }

  return {
    left: windowBounds.left ?? 80,
    top: windowBounds.top ?? 60,
    width: windowBounds.width ?? 1440,
    height: windowBounds.height ?? 900
  };
}

function withDockSafeInset(workArea, displayBounds) {
  const adjusted = { ...workArea };
  const workAreaBottom = adjusted.top + adjusted.height;
  const displayBottom = displayBounds.top + displayBounds.height;
  const bottomInset = displayBottom - workAreaBottom;

  if (bottomInset < 24) {
    adjusted.height = Math.max(560, adjusted.height - BOTTOM_DOCK_SAFE_INSET);
  }

  return adjusted;
}

async function rememberRestoreState(geminiWindowId, sourceWindow) {
  if (!geminiWindowId || !sourceWindow?.id) {
    return;
  }

  const restoreState = {
    sourceWindowId: sourceWindow.id,
    sourceBounds: {
      left: sourceWindow.left,
      top: sourceWindow.top,
      width: sourceWindow.width,
      height: sourceWindow.height,
      state: sourceWindow.state
    }
  };
  const existing = await chrome.storage.session.get({ [SESSION_RESTORE_KEY]: {} });
  await chrome.storage.session.set({
    [SESSION_RESTORE_KEY]: {
      ...existing[SESSION_RESTORE_KEY],
      [geminiWindowId]: restoreState
    }
  });
}

async function closeTrackedGeminiWindows() {
  const stored = await chrome.storage.session.get({ [SESSION_RESTORE_KEY]: {} });
  const restoreMap = stored[SESSION_RESTORE_KEY];
  const entries = Object.entries(restoreMap);

  await chrome.storage.session.set({ [SESSION_RESTORE_KEY]: {} });

  for (const [, restoreState] of entries) {
    try {
      await applySourceWindowRestore(restoreState);
    } catch {
      // The source window may already be gone.
    }
  }

  for (const [windowId] of entries) {
    try {
      await chrome.windows.remove(Number(windowId));
    } catch {
      // The tracked window may already be gone.
    }
  }
}

async function applySourceWindowRestore(restoreState) {
  await chrome.windows.update(restoreState.sourceWindowId, { state: "normal" });
  await chrome.windows.update(restoreState.sourceWindowId, {
    left: restoreState.sourceBounds.left,
    top: restoreState.sourceBounds.top,
    width: restoreState.sourceBounds.width,
    height: restoreState.sourceBounds.height
  });

  if (restoreState.sourceBounds.state && restoreState.sourceBounds.state !== "normal") {
    await chrome.windows.update(restoreState.sourceWindowId, { state: restoreState.sourceBounds.state });
  }
}

async function restoreSourceWindow(geminiWindowId) {
  const stored = await chrome.storage.session.get({ [SESSION_RESTORE_KEY]: {} });
  const restoreMap = stored[SESSION_RESTORE_KEY];
  const restoreState = restoreMap[geminiWindowId];

  if (!restoreState) {
    return;
  }

  delete restoreMap[geminiWindowId];
  await chrome.storage.session.set({ [SESSION_RESTORE_KEY]: restoreMap });

  try {
    await applySourceWindowRestore(restoreState);
  } catch {
    // The source window may already be closed; there is nothing left to restore.
  }
}

async function applySplitLayout(sourceWindowId, geminiWindowId, layout) {
  if (sourceWindowId) {
    await chrome.windows.update(sourceWindowId, { state: "normal" });
    await chrome.windows.update(sourceWindowId, {
      left: layout.workArea.left,
      top: layout.workArea.top,
      width: layout.currentWidth,
      height: layout.workArea.height
    });
  }

  if (geminiWindowId) {
    await chrome.windows.update(geminiWindowId, { state: "normal" });
    await chrome.windows.update(geminiWindowId, {
      left: layout.geminiLeft,
      top: layout.workArea.top,
      width: layout.geminiWidth,
      height: layout.geminiHeight
    });
  }
}

function scheduleLayoutRetries(sourceWindowId, geminiWindowId, layout) {
  for (const delay of LAYOUT_RETRY_DELAYS_MS) {
    setTimeout(() => {
      applySplitLayout(sourceWindowId, geminiWindowId, layout).catch(() => {
        // Windows may have been closed before the retry runs.
      });
    }, delay);
  }
}

async function openGeminiWindow(sourceTab, anchor = null) {
  await closeTrackedGeminiWindows();

  const settings = await getWindowSettings();
  const currentWindow = await getWindowBounds(sourceTab?.windowId);
  const restoreState = currentWindow.id
    ? {
        sourceWindowId: currentWindow.id,
        sourceBounds: {
          left: currentWindow.left,
          top: currentWindow.top,
          width: currentWindow.width,
          height: currentWindow.height,
          state: currentWindow.state
        }
      }
    : null;
  const workArea = await getWorkAreaForWindow(currentWindow);
  const minChromeWidth = workArea.width >= 880 ? 520 : Math.round(workArea.width * 0.55);
  const maxGeminiWidth = Math.max(320, workArea.width - minChromeWidth);
  const geminiWidth = clamp(
    Math.round(workArea.width * (settings.popupWidthPercent / 100)),
    Math.min(360, maxGeminiWidth),
    maxGeminiWidth
  );
  if (anchor) {
    const anchoredHeight = clamp(geminiWidth + GEMINI_HEIGHT_EXTRA, 420, workArea.height);
    const anchoredLeft = clamp(anchor.screenX, workArea.left, workArea.left + workArea.width - geminiWidth);
    const anchoredTop = clamp(anchor.screenY, workArea.top, workArea.top + workArea.height - anchoredHeight);

    await chrome.windows.create({
      url: GEMINI_URL,
      type: "popup",
      focused: true,
      width: geminiWidth,
      height: anchoredHeight,
      left: anchoredLeft,
      top: anchoredTop
    });
    return;
  }

  const currentWidth = workArea.width - geminiWidth - WINDOW_GAP;
  const geminiLeft = workArea.left + currentWidth + WINDOW_GAP;
  const geminiHeight = clamp(Math.round(workArea.height * (settings.popupHeightPercent / 100)), 560, workArea.height);
  const layout = {
    workArea,
    currentWidth,
    geminiLeft,
    geminiWidth,
    geminiHeight
  };

  if (currentWindow.id) {
    try {
      await applySplitLayout(currentWindow.id, null, layout);
    } catch {
      // Some Chrome window states cannot be resized. Gemini should still open.
    }
  }

  let geminiWindow;
  try {
    geminiWindow = await chrome.windows.create({
      url: GEMINI_URL,
      type: "popup",
      focused: true,
      width: geminiWidth,
      height: geminiHeight,
      left: geminiLeft,
      top: workArea.top
    });
    await applySplitLayout(currentWindow.id, geminiWindow.id, layout);
    scheduleLayoutRetries(currentWindow.id, geminiWindow.id, layout);
  } catch (error) {
    if (restoreState) {
      await applySourceWindowRestore(restoreState);
    }

    throw error;
  }

  await rememberRestoreState(geminiWindow.id, currentWindow);
}

async function getWindowSettings() {
  const settings = await chrome.storage.sync.get({
    ...DEFAULT_WINDOW_SETTINGS,
    layoutVersion: 0
  });

  if (settings.layoutVersion < LAYOUT_VERSION) {
    if (settings.popupWidthPercent === 25) {
      settings.popupWidthPercent = DEFAULT_WINDOW_SETTINGS.popupWidthPercent;
    }

    settings.layoutVersion = LAYOUT_VERSION;
    await chrome.storage.sync.set({
      popupWidthPercent: settings.popupWidthPercent,
      layoutVersion: LAYOUT_VERSION
    });
  }

  return settings;
}


async function fetchImageAsDataUrl(imageUrl) {
  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error(`Image request failed with status ${response.status}`);
  }

  const mimeType = response.headers.get("content-type")?.split(";")[0] || "image/png";
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return {
    mimeType,
    dataUrl: `data:${mimeType};base64,${btoa(binary)}`
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SHAKE_GEMINI_OPEN") {
    openGeminiWindow(sender.tab, message.anchor ?? null)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message?.type === "SHAKE_GEMINI_FETCH_IMAGE") {
    fetchImageAsDataUrl(message.imageUrl)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message?.type === "SHAKE_GEMINI_CAPTURE") {
    chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" })
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  return false;
});

chrome.action.onClicked.addListener((tab) => {
  openGeminiWindow(tab);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open-gemini") {
    return;
  }

  const tab = await getActiveTab();
  await openGeminiWindow(tab);
});

chrome.windows.onRemoved.addListener((windowId) => {
  restoreSourceWindow(windowId);
});

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
