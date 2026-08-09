// offscreen.js — Glide Background Tasks
// Audio playback + GIF generation

console.log("[Glide Offscreen] Document loaded");

// ============ SW KEEPALIVE ============
// Offscreen docs aren't subject to MV3's 30s idle kill
setInterval(() => {
  chrome.runtime.sendMessage({ type: "SW_KEEPALIVE" }).catch(() => {});
}, 20000);

// ============ AUDIO PLAYBACK ============
let audioContext;
function getAudioContext() {
  if (!audioContext) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioCtx();
  }
  return audioContext;
}

async function playAudio(audioUrl, volume = 0.5) {
  const ctx = getAudioContext();
  try {
    const response = await fetch(audioUrl);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    const gainNode = ctx.createGain();
    gainNode.gain.value = volume;
    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    if (ctx.state === "suspended") await ctx.resume();
    source.start(0);
    return new Promise((resolve) => {
      source.onended = () => resolve();
    });
  } catch (error) {
    console.error("[Glide Offscreen] Audio error:", error);
    throw error;
  }
}

// ============ CLICK INDICATORS ============
function drawClickIndicator(ctx, x, y, scaleFactor = 1) {
  ctx.save();
  // Outer glow
  ctx.beginPath();
  ctx.arc(x, y, 15 * scaleFactor, 0, 2 * Math.PI);
  ctx.fillStyle = "rgba(218, 119, 86, 0.3)";
  ctx.fill();
  // Inner circle
  ctx.beginPath();
  ctx.arc(x, y, 11 * scaleFactor, 0, 2 * Math.PI);
  ctx.fillStyle = "rgba(218, 119, 86, 0.5)";
  ctx.fill();
  // Border
  ctx.beginPath();
  ctx.arc(x, y, 11 * scaleFactor, 0, 2 * Math.PI);
  ctx.strokeStyle = "rgba(218, 119, 86, 1)";
  ctx.lineWidth = 2 * scaleFactor;
  ctx.stroke();
  ctx.restore();
}

function drawDragPath(ctx, startX, startY, endX, endY, scaleFactor = 1) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.strokeStyle = "#e27a63";
  ctx.lineWidth = 3 * scaleFactor;
  ctx.stroke();
  // Arrow
  const angle = Math.atan2(endY - startY, endX - startX);
  const arrowLen = 15 * scaleFactor;
  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(endX - arrowLen * Math.cos(angle - Math.PI / 6), endY - arrowLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(endX - arrowLen * Math.cos(angle + Math.PI / 6), endY - arrowLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fillStyle = "#e27a63";
  ctx.fill();
  ctx.restore();
}

function drawActionLabel(ctx, text, x, y, scaleFactor = 1) {
  ctx.save();
  const fontSize = 14 * scaleFactor;
  ctx.font = `${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const metrics = ctx.measureText(text);
  const padding = 8 * scaleFactor;
  let labelX = x + 20 * scaleFactor;
  let labelY = y - 10 * scaleFactor;
  if (labelX + metrics.width + padding * 2 > ctx.canvas.width) labelX = x - metrics.width - padding * 2 - 20 * scaleFactor;
  if (labelY < 0) labelY = y + 20 * scaleFactor;
  // Background
  ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
  ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
  ctx.shadowBlur = 4 * scaleFactor;
  ctx.beginPath();
  ctx.roundRect(labelX, labelY, metrics.width + padding * 2, 20 * scaleFactor + padding, 6 * scaleFactor);
  ctx.fill();
  ctx.shadowColor = "transparent";
  // Text
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, labelX + padding, labelY + padding);
  ctx.restore();
}

function drawProgressBar(ctx, progress, scaleFactor = 1) {
  ctx.save();
  const barHeight = 4 * scaleFactor;
  const barWidth = ctx.canvas.width;
  const y = ctx.canvas.height - barHeight;
  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  ctx.fillRect(0, y, barWidth, barHeight);
  ctx.fillStyle = "#da7756";
  ctx.fillRect(0, y, barWidth * progress, barHeight);
  ctx.restore();
}

function drawWatermark(ctx, scaleFactor = 1) {
  ctx.save();
  const padding = 8 * scaleFactor;
  const logoSize = 24 * scaleFactor;
  const x = ctx.canvas.width - padding - logoSize;
  const y = ctx.canvas.height - padding - logoSize;
  ctx.fillStyle = "rgba(218, 119, 86, 0.8)";
  ctx.font = `bold ${logoSize * 0.6}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("G", x + logoSize / 2, y + logoSize / 2);
  ctx.restore();
}

function applyActionIndicators(canvas, action, options, scaleFactor = 1) {
  const ctx = canvas.getContext("2d");
  if (!ctx || !action) return;
  if (options.showClickIndicators && action.coordinate && action.type.includes("click")) {
    const [x, y] = action.coordinate;
    drawClickIndicator(ctx, x * scaleFactor, y * scaleFactor, scaleFactor);
    if (options.showActionLabels && action.description) drawActionLabel(ctx, action.description, x * scaleFactor, y * scaleFactor, scaleFactor);
  }
  if (options.showDragPaths && action.type === "drag" && action.start_coordinate && action.coordinate) {
    const [sx, sy] = action.start_coordinate;
    const [ex, ey] = action.coordinate;
    drawDragPath(ctx, sx * scaleFactor, sy * scaleFactor, ex * scaleFactor, ey * scaleFactor, scaleFactor);
  }
}

// ============ GIF GENERATION ============
async function generateGif(frames, options = {}) {
  const enhancementOptions = {
    showClickIndicators: options.showClickIndicators ?? true,
    showDragPaths: options.showDragPaths ?? true,
    showActionLabels: options.showActionLabels ?? true,
    showProgressBar: options.showProgressBar ?? true,
    showWatermark: options.showWatermark ?? true,
  };
  const images = await Promise.all(frames.map((frame, index) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = `data:image/${frame.format || "png"};base64,${frame.base64}`;
    });
  }));
  const width = Math.max(...images.map(img => img.width));
  const height = Math.max(...images.map(img => img.height));
  const enhancedCanvases = images.map((img, index) => {
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const frame = frames[index];
    let scaleFactor = 1;
    if (frame.viewportWidth && canvas.width) scaleFactor = canvas.width / frame.viewportWidth;
    if (frame.action) applyActionIndicators(canvas, frame.action, enhancementOptions, scaleFactor);
    const progress = (index + 1) / images.length;
    if (enhancementOptions.showProgressBar) drawProgressBar(ctx, progress, scaleFactor);
    if (enhancementOptions.showWatermark) drawWatermark(ctx, scaleFactor);
    // Pad to max size
    if (canvas.width !== width || canvas.height !== height) {
      const padded = document.createElement("canvas");
      padded.width = width;
      padded.height = height;
      const pctx = padded.getContext("2d");
      pctx.fillStyle = "#ffffff";
      pctx.fillRect(0, 0, width, height);
      pctx.drawImage(canvas, 0, 0);
      return padded;
    }
    return canvas;
  });
  return new Promise((resolve, reject) => {
    const gif = new GIF({
      workers: 2,
      quality: options.quality || 10,
      width,
      height,
      workerScript: chrome.runtime.getURL("gif.worker.js"),
      repeat: 0,
    });
    gif.on("finished", (blob) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve({ base64: reader.result.split(",")[1], size: blob.size, width, height });
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    gif.on("abort", () => reject(new Error("GIF aborted")));
    enhancedCanvases.forEach((canvas, index) => {
      const delay = frames[index]?.delay || 800;
      const isLast = index === frames.length - 1;
      gif.addFrame(canvas, { delay: isLast ? delay + 2000 : delay });
    });
    gif.render();
  });
}

// ============ MESSAGE HANDLER ============
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "OFFSCREEN_PLAY_SOUND") {
    playAudio(message.audioUrl, message.volume || 0.5)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (message.type === "GENERATE_GIF") {
    generateGif(message.frames, message.options)
      .then((result) => sendResponse({ success: true, result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
});
