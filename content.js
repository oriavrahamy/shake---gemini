const DEFAULT_SETTINGS = {
  sensitivity: 10,
  requiredTurns: 8,
  detectionWindowMs: 1000,
  minimumShakeMs: 600,
  shiftHoldMs: 700,
  buttonOffsetPx: 15,
  maxPointerDistancePx: 270
};

const STATE = {
  settings: { ...DEFAULT_SETTINGS },
  lastX: 0,
  lastY: 0,
  lastDirectionX: 0,
  lastDirectionY: 0,
  lastMoveAt: 0,
  lastHandledAt: 0,
  shakeCooldownUntil: 0,
  turns: [],
  button: null,
  closeButton: null,
  circleSearchButton: null,
  actionButton: null,
  overlay: null,
  highlightedElement: null,
  hoveredTarget: null,
  clearHoverTimer: null,
  buttonMotion: null,
  shiftHoldTimer: null,
  shiftIsDown: false,
  pointer: {
    x: 0,
    y: 0,
    previousX: 0,
    previousY: 0,
    speed: 0,
    elapsed: 16,
    lastAt: 0
  }
};

loadSettings();
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") {
    return;
  }

  STATE.settings = {
    ...STATE.settings,
    sensitivity: changes.sensitivity?.newValue ?? STATE.settings.sensitivity,
    maxPointerDistancePx: changes.maxPointerDistancePx?.newValue ?? STATE.settings.maxPointerDistancePx
  };
});

window.addEventListener("mousemove", handleMouseMove, { passive: true });
window.addEventListener("keydown", handleKeyDown, true);
window.addEventListener("keyup", handleKeyUp, true);

function loadSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    STATE.settings = { ...DEFAULT_SETTINGS, ...settings };
    if (STATE.settings.maxPointerDistancePx < 220) {
      STATE.settings.maxPointerDistancePx = DEFAULT_SETTINGS.maxPointerDistancePx;
      chrome.storage.sync.set({ maxPointerDistancePx: DEFAULT_SETTINGS.maxPointerDistancePx });
    }
  });
}

function handleMouseMove(event) {
  const now = performance.now();
  updatePointer(event, now);
  updateButtonBehavior();
  updateHoverTarget(event);

  if (now - STATE.lastHandledAt < 16) {
    return;
  }

  STATE.lastHandledAt = now;

  if (!STATE.lastMoveAt) {
    rememberMove(event, now);
    return;
  }

  const deltaX = event.clientX - STATE.lastX;
  const deltaY = event.clientY - STATE.lastY;
  const elapsed = Math.max(now - STATE.lastMoveAt, 1);
  const velocity = Math.hypot(deltaX, deltaY) / elapsed;
  const minDistance = Math.max(3, STATE.settings.sensitivity * 0.45);

  trackDirectionChange(deltaX, STATE.lastDirectionX, "x", now, minDistance, velocity);
  trackDirectionChange(deltaY, STATE.lastDirectionY, "y", now, minDistance * 1.35, velocity);

  if (Math.abs(deltaX) >= minDistance) {
    STATE.lastDirectionX = Math.sign(deltaX);
  }

  if (Math.abs(deltaY) >= minDistance * 1.35) {
    STATE.lastDirectionY = Math.sign(deltaY);
  }

  rememberMove(event, now);
  pruneTurns(now);

  if (isSustainedShake(now) && !STATE.button && now > STATE.shakeCooldownUntil) {
    showGeminiButton(event.clientX, event.clientY);
    STATE.turns = [];
    STATE.shakeCooldownUntil = now + 1200;
  }
}

function handleKeyDown(event) {
  if (event.key === "Escape" && STATE.button) {
    event.preventDefault();
    removeGeminiButton("swallow");
    return;
  }

  if (event.key !== "Shift" || STATE.shiftIsDown || isEditableTarget(event.target)) {
    return;
  }

  STATE.shiftIsDown = true;
  STATE.shiftHoldTimer = window.setTimeout(() => {
    showGeminiButton(STATE.pointer.x || window.innerWidth / 2, STATE.pointer.y || window.innerHeight / 2);
  }, STATE.settings.shiftHoldMs);
}

function handleKeyUp(event) {
  if (event.key !== "Shift") {
    return;
  }

  STATE.shiftIsDown = false;
  clearTimeout(STATE.shiftHoldTimer);
  STATE.shiftHoldTimer = null;
}

function trackDirectionChange(delta, previousDirection, axis, now, minDistance, velocity) {
  const distance = Math.abs(delta);
  const direction = Math.sign(delta);

  if (!direction || !previousDirection || direction === previousDirection) {
    return;
  }

  if (distance < minDistance || velocity < 0.1) {
    return;
  }

  STATE.turns.push({ axis, at: now });
}

function rememberMove(event, now) {
  STATE.lastX = event.clientX;
  STATE.lastY = event.clientY;
  STATE.lastMoveAt = now;
}

function pruneTurns(now) {
  const cutoff = now - STATE.settings.detectionWindowMs;
  STATE.turns = STATE.turns.filter((turn) => turn.at >= cutoff);
}

function isSustainedShake(now) {
  if (STATE.turns.length < STATE.settings.requiredTurns) {
    return false;
  }

  const firstTurn = STATE.turns[0];
  const lastTurn = STATE.turns[STATE.turns.length - 1];
  return now - firstTurn.at >= STATE.settings.minimumShakeMs && now - lastTurn.at <= 350;
}

function showGeminiButton(x, y) {
  removeGeminiButton();
  enableFocusMode();

  const button = document.createElement("button");
  button.type = "button";
  button.className = "shake-gemini-fab";
  button.setAttribute("aria-label", "Open Gemini");
  button.innerHTML = `<img class="shake-gemini-image" src="${chrome.runtime.getURL("assets/tap-to-ask.png")}" alt="">`;
  button.addEventListener("animationend", (event) => {
    if (event.animationName === "shake-gemini-vomit-in") {
      button.classList.add("shake-gemini-fab--ready");
    }
  });

  const position = getButtonTargetNearPointer(x, y);
  button.style.setProperty("--fab-x", `${position.x}px`);
  button.style.setProperty("--fab-y", `${position.y}px`);

  button.addEventListener("click", (event) => {
    chrome.runtime.sendMessage({ type: "SHAKE_GEMINI_OPEN", anchor: getWindowAnchor(event) });
    removeGeminiButton();
  });

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "shake-gemini-close-btn";
  closeButton.innerHTML = "×";
  closeButton.setAttribute("aria-label", "Close");
// Summary button removed per user request
  document.documentElement.append(closeButton);
  STATE.closeButton = closeButton;



  document.documentElement.append(button);
  STATE.button = button;
  STATE.buttonMotion = {
    x: position.x,
    y: position.y,
    targetX: position.x,
    targetY: position.y,
    raf: null,
    mode: "born",
    spawnedAt: performance.now()
  };
  startButtonMotion();
}

function updatePointer(event, now) {
  const elapsed = Math.max(now - (STATE.pointer.lastAt || now), 1);
  STATE.pointer.previousX = STATE.pointer.x || event.clientX;
  STATE.pointer.previousY = STATE.pointer.y || event.clientY;
  STATE.pointer.x = event.clientX;
  STATE.pointer.y = event.clientY;
  STATE.pointer.elapsed = elapsed;
  STATE.pointer.lastAt = now;
  STATE.pointer.speed = Math.hypot(
    STATE.pointer.x - STATE.pointer.previousX,
    STATE.pointer.y - STATE.pointer.previousY
  ) / elapsed;
}

function updateButtonBehavior() {
  if (!STATE.button || !STATE.buttonMotion) {
    return;
  }

  const motion = STATE.buttonMotion;
  const centerX = motion.x + 89;
  const centerY = motion.y + 25;
  const pointerX = STATE.pointer.x;
  const pointerY = STATE.pointer.y;
  const distanceX = pointerX - centerX;
  const distanceY = pointerY - centerY;
  const distance = Math.hypot(distanceX, distanceY);
  const pointerDeltaX = STATE.pointer.x - STATE.pointer.previousX;
  const pointerDeltaY = STATE.pointer.y - STATE.pointer.previousY;
  const radialSpeed = distance
    ? (pointerDeltaX * distanceX + pointerDeltaY * distanceY) / distance / STATE.pointer.elapsed
    : 0;
  const approaching = distance < 210 && radialSpeed < -0.18;
  const followSlowly = distance > 135 && STATE.pointer.speed <= 0.8;

  if (approaching) {
    setButtonMode("hovering");
    return;
  }

  if (followSlowly) {
    const target = getButtonTargetNearPointer(pointerX, pointerY);
    motion.targetX = target.x;
    motion.targetY = target.y;
    setButtonMode("following");
    return;
  }

  setButtonMode("idle");
}

function startButtonMotion() {
  if (!STATE.button || !STATE.buttonMotion) {
    return;
  }

  const tick = () => {
    if (!STATE.button || !STATE.buttonMotion) {
      return;
    }

    const motion = STATE.buttonMotion;
    const ease = motion.mode === "following" ? 0.13 : 0.065;
    motion.x += (motion.targetX - motion.x) * ease;
    motion.y += (motion.targetY - motion.y) * ease;
    STATE.button.style.setProperty("--fab-x", `${motion.x}px`);
    STATE.button.style.setProperty("--fab-y", `${motion.y}px`);
    positionExtraButtons();
    motion.raf = requestAnimationFrame(tick);
  };

  STATE.buttonMotion.raf = requestAnimationFrame(tick);
}

function setButtonMode(mode) {
  if (!STATE.button || !STATE.buttonMotion || STATE.buttonMotion.mode === mode) {
    return;
  }

  STATE.buttonMotion.mode = mode;
  STATE.button.classList.toggle("shake-gemini-fab--hovering", mode === "hovering");
  STATE.button.classList.toggle("shake-gemini-fab--following", mode === "following");
}

function getButtonTargetNearPointer(x, y) {
  const preferLeft = x > window.innerWidth - 230;
  const preferTop = y > window.innerHeight - 126;
  const offsetX = preferLeft ? -178 - STATE.settings.buttonOffsetPx : STATE.settings.buttonOffsetPx;
  const offsetY = preferTop ? -96 - STATE.settings.buttonOffsetPx : STATE.settings.buttonOffsetPx;

  return {
    x: clamp(x + offsetX, 8, window.innerWidth - 186),
    y: clamp(y + offsetY, 8, window.innerHeight - 98)
  };
}

function enableFocusMode() {
  // Page dim overlay disabled per user request
}

function disableFocusMode() {
  document.documentElement.classList.remove("shake-gemini-active");
  clearHighlightedElement();
  removeActionButton();

  if (STATE.overlay) {
    STATE.overlay.remove();
    STATE.overlay = null;
  }

  if (STATE.closeButton) {
    STATE.closeButton.remove();
    STATE.closeButton = null;
  }

  if (STATE.circleSearchButton) {
    STATE.circleSearchButton.remove();
    STATE.circleSearchButton = null;
  }

  if (STATE.clearHoverTimer) {
    clearTimeout(STATE.clearHoverTimer);
    STATE.clearHoverTimer = null;
  }
  STATE.hoveredTarget = null;
}

function updateHoverTarget(event) {
  if (!STATE.button || !STATE.buttonMotion) {
    return;
  }

  const element = document.elementFromPoint(event.clientX, event.clientY);

  if (element?.closest?.(".shake-gemini-fab, .shake-gemini-action")) {
    if (STATE.clearHoverTimer) {
      clearTimeout(STATE.clearHoverTimer);
      STATE.clearHoverTimer = null;
    }
    return;
  }

  if (!element || element.closest(".shake-gemini-page-dim")) {
    scheduleClearHoverTarget();
    return;
  }

  const target = getActionTarget(element);

  if (!target) {
    scheduleClearHoverTarget();
    return;
  }

  if (STATE.clearHoverTimer) {
    clearTimeout(STATE.clearHoverTimer);
    STATE.clearHoverTimer = null;
  }

  if (STATE.hoveredTarget && STATE.hoveredTarget.element === target.element) {
    return;
  }

  STATE.hoveredTarget = target;
  setHighlightedElement(target.element);
  showActionButton(target);
}

function scheduleClearHoverTarget() {
  if (!STATE.hoveredTarget) {
    return;
  }
  if (STATE.clearHoverTimer) {
    return;
  }

  STATE.clearHoverTimer = window.setTimeout(() => {
    STATE.clearHoverTimer = null;
    STATE.hoveredTarget = null;
    clearHighlightedElement();
    removeActionButton();
  }, 500);
}

function getActionTarget(element) {
  const image = element?.closest?.("img");

  if (image?.currentSrc || image?.src) {
    return { type: "image", element: image, imageUrl: image.currentSrc || image.src };
  }

  const textElement = findTextElement(element);

  if (textElement) {
    return { type: "text", element: textElement, text: getTextForElement(textElement) };
  }

  return null;
}

function findTextElement(element) {
  let current = element;

  while (current && current !== document.documentElement && current !== document.body) {
    if (getTextForElement(current).length >= 2) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function getTextForElement(element) {
  return (element?.innerText || element?.textContent || "").trim().replace(/\s+/g, " ");
}

function setHighlightedElement(element) {
  // Highlighting disabled per user request
}

function clearHighlightedElement() {
  // Highlight clearing disabled per user request
}

function showActionButton(target) {
  // Action button disabled per user request
}

function positionExtraButtons() {
  if (!STATE.buttonMotion) {
    return;
  }

  let offsetY = 60;

  if (STATE.actionButton) {
    STATE.actionButton.style.setProperty("--action-x", `${STATE.buttonMotion.x}px`);
    STATE.actionButton.style.setProperty("--action-y", `${STATE.buttonMotion.y + offsetY}px`);
    offsetY += 50;
  }
  // Summary button is now positioned via CSS fixed bottom-right, no position here.

}

function removeActionButton() {
  if (!STATE.actionButton) {
    return;
  }

  STATE.actionButton.remove();
  STATE.actionButton = null;
  positionExtraButtons();
}

async function handleActionClick(event) {
  event.preventDefault();

  if (STATE.clearHoverTimer) {
    clearTimeout(STATE.clearHoverTimer);
    STATE.clearHoverTimer = null;
  }

  const target = STATE.hoveredTarget;
  if (!target) {
    return;
  }

  try {
    if (target.type === "image") {
      await copyImageTarget(target);
    } else {
      await copyTextTarget(target);
    }
  } catch {
    if (target.type === "image" && target.imageUrl) {
      await navigator.clipboard.writeText(target.imageUrl);
    }
  }

  chrome.runtime.sendMessage({ type: "SHAKE_GEMINI_OPEN", anchor: getWindowAnchor(event) });
  removeGeminiButton("swallow");
}

async function copyTextTarget(target) {
  const selectedText = window.getSelection()?.toString().trim();
  const text = selectedText || target.text || getTextForElement(target.element);

  if (text) {
    await navigator.clipboard.writeText(text);
  }
}

async function copyImageTarget(target) {
  const { dataUrl } = await getImgDataUrl(target.imageUrl);
  const pngBlob = await convertToPngBlob(dataUrl);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
}

function convertToPngBlob(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Canvas toBlob failed"));
          }
        }, "image/png");
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error("Failed to load image for PNG conversion"));
    img.src = dataUrl;
  });
}

async function getImgDataUrl(imageUrl) {
  try {
    const response = await fetch(imageUrl);
    if (response.ok) {
      const mimeType = response.headers.get("content-type")?.split(";")[0] || "image/png";
      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve({ mimeType, dataUrl: reader.result });
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }
  } catch {
    // Fall back to background fetching
  }

  const result = await chrome.runtime.sendMessage({
    type: "SHAKE_GEMINI_FETCH_IMAGE",
    imageUrl: imageUrl
  });

  if (!result?.ok || !result.dataUrl) {
    throw new Error(result?.error || "Could not fetch image");
  }

  return result;
}

function getWindowAnchor(event) {
  return {
    screenX: Math.round(event.screenX),
    screenY: Math.round(event.screenY),
    clientX: Math.round(event.clientX),
    clientY: Math.round(event.clientY)
  };
}

function isEditableTarget(target) {
  return Boolean(target?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true']"));
}

function swallowGeminiButton(x, y) {
  if (!STATE.button || !STATE.buttonMotion) {
    return;
  }

  const motion = STATE.buttonMotion;
  motion.targetX = clamp(x - 89, 8, window.innerWidth - 186);
  motion.targetY = clamp(y - 25, 8, window.innerHeight - 98);
  STATE.button.style.setProperty("--fab-x", `${motion.targetX}px`);
  STATE.button.style.setProperty("--fab-y", `${motion.targetY}px`);
  removeGeminiButton("swallow");
}

function resetButtonMotion() {
  if (!STATE.buttonMotion) {
    return;
  }

  cancelAnimationFrame(STATE.buttonMotion.raf);
  STATE.buttonMotion = null;
}

function removeGeminiButton(exitMode = "fade") {
  clearTimeout(STATE.shiftHoldTimer);
  STATE.shiftHoldTimer = null;
  STATE.shiftIsDown = false;

  if (STATE.clearHoverTimer) {
    clearTimeout(STATE.clearHoverTimer);
    STATE.clearHoverTimer = null;
  }

  if (STATE.closeButton) {
    STATE.closeButton.remove();
    STATE.closeButton = null;
  }

    if (STATE.summaryButton) {
      STATE.summaryButton.remove();
      STATE.summaryButton = null;
    }

    // Remove any remaining circle search button (if it exists)
    if (STATE.circleSearchButton) {
      STATE.circleSearchButton.remove();
      STATE.circleSearchButton = null;
    }

  if (STATE.summaryButton) {
    STATE.summaryButton.remove();
    STATE.summaryButton = null;
  }

  if (!STATE.button) {
    resetButtonMotion();
    disableFocusMode();
    return;
  }

  resetButtonMotion();
  disableFocusMode();
  const button = STATE.button;
  STATE.button = null;
  button.classList.remove("shake-gemini-fab--hovering", "shake-gemini-fab--following");
  button.classList.add(exitMode === "swallow" ? "shake-gemini-fab--swallowed" : "shake-gemini-fab--leaving");
  window.setTimeout(() => button.remove(), exitMode === "swallow" ? 260 : 180);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

async function startCircleToSearch() {
  const fab = STATE.button;
  const actionBtn = STATE.actionButton;
  const circleBtn = STATE.circleSearchButton;
  const closeBtn = STATE.closeButton;
  const overlay = STATE.overlay;

  if (fab) fab.style.display = "none";
  if (actionBtn) actionBtn.style.display = "none";
  if (circleBtn) circleBtn.style.display = "none";
  if (closeBtn) closeBtn.style.display = "none";
  if (overlay) overlay.style.display = "none";

  await new Promise((resolve) => requestAnimationFrame(resolve));

  try {
    const response = await chrome.runtime.sendMessage({ type: "SHAKE_GEMINI_CAPTURE" });
    if (!response?.ok || !response.dataUrl) {
      throw new Error(response?.error || "Capture failed");
    }

    const screenshotImg = new Image();
    screenshotImg.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      canvas.style.position = "fixed";
      canvas.style.inset = "0";
      canvas.style.zIndex = "2147483647";
      canvas.style.cursor = "crosshair";
      document.documentElement.appendChild(canvas);

      const ctx = canvas.getContext("2d");

      const drawInitial = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(screenshotImg, 0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      };

      drawInitial();

      let isDrawing = false;
      let startX = 0;
      let startY = 0;

      const handleMouseDown = (e) => {
        isDrawing = true;
        startX = e.clientX;
        startY = e.clientY;
      };

      const handleMouseMove = (e) => {
        if (!isDrawing) return;
        const currentX = e.clientX;
        const currentY = e.clientY;

        const w = Math.abs(currentX - startX);
        const h = Math.abs(currentY - startY);
        const centerX = startX + (currentX - startX) / 2;
        const centerY = startY + (currentY - startY) / 2;
        const radiusX = w / 2;
        const radiusY = h / 2;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(screenshotImg, 0, 0, canvas.width, canvas.height);

        ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (w > 5 && h > 5) {
          ctx.save();
          ctx.beginPath();
          ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
          ctx.clip();
          ctx.drawImage(screenshotImg, 0, 0, canvas.width, canvas.height);
          ctx.restore();

          ctx.save();
          ctx.beginPath();
          ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
          ctx.strokeStyle = "#4285f4";
          ctx.lineWidth = 3;
          ctx.shadowColor = "rgba(66, 133, 244, 0.8)";
          ctx.shadowBlur = 12;
          ctx.stroke();
          ctx.restore();
        }
      };

      const handleMouseUp = (e) => {
        if (!isDrawing) return;
        isDrawing = false;
        const currentX = e.clientX;
        const currentY = e.clientY;

        const x = Math.min(startX, currentX);
        const y = Math.min(startY, currentY);
        const w = Math.abs(currentX - startX);
        const h = Math.abs(currentY - startY);

        canvas.removeEventListener("mousedown", handleMouseDown);
        canvas.removeEventListener("mousemove", handleMouseMove);
        canvas.removeEventListener("mouseup", handleMouseUp);
        canvas.remove();

        removeGeminiButton("fade");

        if (w > 10 && h > 10) {
          const scaleX = screenshotImg.naturalWidth / canvas.width;
          const scaleY = screenshotImg.naturalHeight / canvas.height;

          const cropCanvas = document.createElement("canvas");
          cropCanvas.width = w * scaleX;
          cropCanvas.height = h * scaleY;
          const cropCtx = cropCanvas.getContext("2d");

          cropCtx.drawImage(
            screenshotImg,
            x * scaleX,
            y * scaleY,
            w * scaleX,
            h * scaleY,
            0,
            0,
            w * scaleX,
            h * scaleY
          );

          cropCanvas.toBlob((blob) => {
            if (!blob) return;

            const form = document.createElement("form");
            form.method = "POST";
            form.action = "https://lens.google.com/v3/upload";
            form.target = "_blank";
            form.style.display = "none";

            const fileInput = document.createElement("input");
            fileInput.type = "file";
            fileInput.name = "encoded_image";

            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(new File([blob], "lens-crop.png", { type: "image/png" }));
            fileInput.files = dataTransfer.files;

            form.appendChild(fileInput);
            document.body.appendChild(form);
            form.submit();

            setTimeout(() => form.remove(), 1000);
          }, "image/png");
        }
      };

      canvas.addEventListener("mousedown", handleMouseDown);
      canvas.addEventListener("mousemove", handleMouseMove);
      canvas.addEventListener("mouseup", handleMouseUp);
    };
    screenshotImg.src = response.dataUrl;
  } catch (err) {
    console.error("Circle to Search failed:", err);
    if (fab) fab.style.display = "";
    if (actionBtn) actionBtn.style.display = "";
    if (circleBtn) circleBtn.style.display = "";
    if (closeBtn) closeBtn.style.display = "";
    if (overlay) overlay.style.display = "";
  }
}
