const video = document.getElementById("webcam");
const output = document.getElementById("output");
const outCtx = output.getContext("2d");
const statusEl = document.getElementById("status");

const THUMB_TIP = 4;
const INDEX_TIP = 8;
const PALM_IDS = [0, 5, 9, 13, 17];
const HAND_GRACE_MS = 300;
const GESTURE_STREAK_REQUIRED = 3;
const MAX_HANDS = 2;

const HAND_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [0, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [0, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [5, 9],
  [9, 13],
  [13, 17],
];

const HAND_STYLES = [
  {
    line: "rgba(120, 210, 255, 0.5)",
    joint: "rgba(120, 210, 255, 0.95)",
    glowInner: "rgba(120, 210, 255, 0.9)",
    glowOuter: "rgba(120, 210, 255, 0.2)",
    core: "#b8ecff",
  },
  {
    line: "rgba(255, 175, 110, 0.5)",
    joint: "rgba(255, 175, 110, 0.95)",
    glowInner: "rgba(255, 200, 130, 0.9)",
    glowOuter: "rgba(255, 160, 90, 0.2)",
    core: "#ffe0b8",
  },
];

const FILTER_LERP = 0.12;
const LANDMARK_PREV = 0.65;
const LANDMARK_CURR = 0.35;

const GESTURE = {
  UNKNOWN: "unknown",
  FIST: "fist",
  PEACE: "peace",
  POINTING: "pointing",
  OPEN: "open",
  THUMBS_UP: "thumbs_up",
  OK: "ok",
  ROCK: "rock",
  DOUBLE_OPEN: "double_open",
  DOUBLE_FIST: "double_fist",
  DOUBLE_PEACE: "double_peace",
  DOUBLE_POINT: "double_point",
};

const GESTURE_LABELS = {
  [GESTURE.UNKNOWN]: "—",
  [GESTURE.FIST]: "Pixel Punch",
  [GESTURE.PEACE]: "VHS Dream",
  [GESTURE.POINTING]: "Finger Spotlight",
  [GESTURE.OPEN]: "Ripple Palm",
  [GESTURE.THUMBS_UP]: "Solar Thumb",
  [GESTURE.OK]: "Portal Pop",
  [GESTURE.ROCK]: "Heatwave Rock",
  [GESTURE.DOUBLE_OPEN]: "Rainbow Prism Aura",
  [GESTURE.DOUBLE_FIST]: "Comic Impact",
  [GESTURE.DOUBLE_PEACE]: "Mirror Kaleidoscope",
  [GESTURE.DOUBLE_POINT]: "Twin Spotlights",
};

const FILTER_KEYS = [
  "dither",
  "vhs",
  "spotlight",
  "ripple",
  "sparkle",
  "portal",
  "heatwave",
  "rainbow",
  "comic",
  "kaleidoscope",
  "twinSpotlight",
];

let viewW = 0;
let viewH = 0;
let dpr = 1;
let lastCanvasW = 0;
let lastCanvasH = 0;
let lastCanvasDpr = 0;
let coverLayout = null;

let lastHandMs = 0;
/** @type {{ landmarks: object[], handedness: string, gesture: string }[]} */
let detectedHands = [];
const handSlots = new Map();
let rafId = null;

let activeGesture = GESTURE.UNKNOWN;
let activeStreakGesture = GESTURE.UNKNOWN;
let activeStreakCount = 0;
let lastDominantHandIndex = 0;

const filterWeights = {
  dither: 0,
  vhs: 0,
  spotlight: 0,
  ripple: 0,
  sparkle: 0,
  portal: 0,
  heatwave: 0,
  rainbow: 0,
  comic: 0,
  kaleidoscope: 0,
  twinSpotlight: 0,
};
const filterLayer = document.createElement("canvas");
const filterLayerCtx = filterLayer.getContext("2d");

const primaryTracking = {
  smoothTip: { x: 0, y: 0 },
  smoothTipB: { x: 0, y: 0 },
  smoothPalm: { x: 0, y: 0 },
  smoothThumb: { x: 0, y: 0 },
  smoothTouchCenter: { x: 0, y: 0 },
  initialized: false,
};

function setStatus(message, { error = false } = {}) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", error);
}

function resizeCanvasesIfNeeded() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const nextDpr = window.devicePixelRatio || 1;

  if (
    width === lastCanvasW &&
    height === lastCanvasH &&
    nextDpr === lastCanvasDpr
  ) {
    return false;
  }

  lastCanvasW = width;
  lastCanvasH = height;
  lastCanvasDpr = nextDpr;

  viewW = width;
  viewH = height;
  dpr = nextDpr;

  output.style.width = `${width}px`;
  output.style.height = `${height}px`;
  output.width = Math.round(width * dpr);
  output.height = Math.round(height * dpr);

  filterLayer.width = width;
  filterLayer.height = height;

  FilterRender.ensureBuffers(width, height);
  return true;
}

function applyOutputTransform() {
  outCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function updateCoverLayout() {
  if (!video.videoWidth || !viewW || !viewH) {
    coverLayout = null;
    return;
  }
  coverLayout = FilterRender.computeCoverLayout(
    viewW,
    viewH,
    video.videoWidth,
    video.videoHeight
  );
}

function toCanvas(landmark) {
  if (!coverLayout) return { x: 0, y: 0 };

  const unmirroredX =
    coverLayout.offsetX + landmark.x * coverLayout.drawWidth;
  const y = coverLayout.offsetY + landmark.y * coverLayout.drawHeight;

  return {
    x: coverLayout.canvasWidth - unmirroredX,
    y,
  };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angle(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const magAB = Math.hypot(ab.x, ab.y);
  const magCB = Math.hypot(cb.x, cb.y);
  return Math.acos(dot / Math.max(magAB * magCB, 0.0001)) * (180 / Math.PI);
}

function fingerExtended(lm, mcp, pip, dip, tip) {
  const pipAngle = angle(lm[mcp], lm[pip], lm[dip]);
  const dipAngle = angle(lm[pip], lm[dip], lm[tip]);
  const wristDistTip = dist(lm[0], lm[tip]);
  const wristDistPip = dist(lm[0], lm[pip]);

  return pipAngle > 145 && dipAngle > 150 && wristDistTip > wristDistPip * 1.05;
}

function thumbExtended(lm) {
  const thumbTip = lm[4];
  const thumbIp = lm[3];
  const thumbMcp = lm[2];
  const wrist = lm[0];

  return (
    dist(thumbTip, wrist) > dist(thumbIp, wrist) * 1.12 &&
    angle(thumbMcp, thumbIp, thumbTip) > 145
  );
}

function thumbIndexTouching(lm) {
  const handSize = dist(lm[0], lm[9]);
  return dist(lm[4], lm[8]) < handSize * 0.38;
}

function classifyGesture(lm) {
  const index = fingerExtended(lm, 5, 6, 7, 8);
  const middle = fingerExtended(lm, 9, 10, 11, 12);
  const ring = fingerExtended(lm, 13, 14, 15, 16);
  const pinky = fingerExtended(lm, 17, 18, 19, 20);
  const thumb = thumbExtended(lm);
  const touching = thumbIndexTouching(lm);

  if (touching && middle && ring && pinky) {
    return GESTURE.OK;
  }
  if (thumb && !index && !middle && !ring && !pinky) {
    return GESTURE.THUMBS_UP;
  }
  if (index && !middle && !ring && pinky) {
    return GESTURE.ROCK;
  }
  if (index && middle && !ring && !pinky) {
    return GESTURE.PEACE;
  }
  if (index && !middle && !ring && !pinky) {
    return GESTURE.POINTING;
  }
  if (index && middle && ring && pinky) {
    return GESTURE.OPEN;
  }
  if (!index && !middle && !ring && !pinky) {
    return GESTURE.FIST;
  }

  return GESTURE.UNKNOWN;
}

function createHandSlot() {
  return {
    smoothedLandmarks: null,
    streakGesture: GESTURE.UNKNOWN,
    streakCount: 0,
    activeGesture: GESTURE.UNKNOWN,
    lastRawGesture: GESTURE.UNKNOWN,
  };
}

function getHandednessLabel(multiHandedness, index) {
  const entry = multiHandedness?.[index]?.[0];
  if (entry?.label) return entry.label;
  return `Hand ${index + 1}`;
}

function smoothLandmarksForSlot(slot, raw) {
  if (!slot.smoothedLandmarks) {
    slot.smoothedLandmarks = raw.map((lm) => ({ x: lm.x, y: lm.y, z: lm.z }));
    return slot.smoothedLandmarks;
  }

  for (let i = 0; i < raw.length; i++) {
    slot.smoothedLandmarks[i].x =
      slot.smoothedLandmarks[i].x * LANDMARK_PREV + raw[i].x * LANDMARK_CURR;
    slot.smoothedLandmarks[i].y =
      slot.smoothedLandmarks[i].y * LANDMARK_PREV + raw[i].y * LANDMARK_CURR;
    slot.smoothedLandmarks[i].z =
      slot.smoothedLandmarks[i].z * LANDMARK_PREV + raw[i].z * LANDMARK_CURR;
  }

  return slot.smoothedLandmarks;
}

function ingestDetectedGestureForSlot(slot, detected) {
  if (detected === slot.streakGesture) {
    slot.streakCount += 1;
  } else {
    slot.streakGesture = detected;
    slot.streakCount = 1;
  }

  if (slot.streakCount >= GESTURE_STREAK_REQUIRED) {
    slot.activeGesture = detected;
  }
}

function processHandResults(results) {
  const landmarkList = results.multiHandLandmarks.slice(0, MAX_HANDS);
  const handednessList = results.multiHandedness ?? [];
  const seenLabels = new Set();
  const hands = [];

  for (let i = 0; i < landmarkList.length; i++) {
    const handedness = getHandednessLabel(handednessList, i);
    seenLabels.add(handedness);

    if (!handSlots.has(handedness)) {
      handSlots.set(handedness, createHandSlot());
    }

    const slot = handSlots.get(handedness);
    const raw = landmarkList[i];
    const landmarks = smoothLandmarksForSlot(slot, raw);
    const rawGesture = classifyGesture(raw);
    if (rawGesture !== slot.lastRawGesture) {
      lastDominantHandIndex = i;
      slot.lastRawGesture = rawGesture;
    }
    ingestDetectedGestureForSlot(slot, rawGesture);

    hands.push({
      landmarks,
      handedness,
      gesture: slot.activeGesture,
    });
  }

  hands.sort((a, b) => {
    if (a.handedness === "Left") return -1;
    if (b.handedness === "Left") return 1;
    return a.handedness.localeCompare(b.handedness);
  });

  for (const label of handSlots.keys()) {
    if (!seenLabels.has(label)) {
      handSlots.delete(label);
    }
  }

  detectedHands = hands;
  updateActiveGesture(resolveRawActiveGesture(detectedHands));
}

function resolveRawActiveGesture(hands) {
  if (hands.length >= 2) {
    const gestureA = hands[0].gesture;
    const gestureB = hands[1].gesture;

    if (gestureA === GESTURE.OPEN && gestureB === GESTURE.OPEN) {
      return GESTURE.DOUBLE_OPEN;
    }
    if (gestureA === GESTURE.FIST && gestureB === GESTURE.FIST) {
      return GESTURE.DOUBLE_FIST;
    }
    if (gestureA === GESTURE.PEACE && gestureB === GESTURE.PEACE) {
      return GESTURE.DOUBLE_PEACE;
    }
    if (gestureA === GESTURE.POINTING && gestureB === GESTURE.POINTING) {
      return GESTURE.DOUBLE_POINT;
    }

    return pickSingleHandFallback(hands);
  }

  if (hands.length === 1) {
    return hands[0].gesture;
  }

  return GESTURE.UNKNOWN;
}

function pickSingleHandFallback(hands) {
  const preferred = hands[lastDominantHandIndex];
  if (preferred && preferred.gesture !== GESTURE.UNKNOWN) {
    return preferred.gesture;
  }

  for (let i = hands.length - 1; i >= 0; i--) {
    if (hands[i].gesture !== GESTURE.UNKNOWN) {
      return hands[i].gesture;
    }
  }

  return hands[0]?.gesture ?? GESTURE.UNKNOWN;
}

function updateActiveGesture(rawGesture) {
  if (rawGesture === activeStreakGesture) {
    activeStreakCount += 1;
  } else {
    activeStreakGesture = rawGesture;
    activeStreakCount = 1;
  }

  if (activeStreakCount >= GESTURE_STREAK_REQUIRED) {
    activeGesture = rawGesture;
  }
}

function handsVisible(now) {
  return lastHandMs > 0 && now - lastHandMs < HAND_GRACE_MS && detectedHands.length > 0;
}

function clearHandState() {
  detectedHands = [];
  handSlots.clear();
  primaryTracking.initialized = false;
  activeGesture = GESTURE.UNKNOWN;
  activeStreakGesture = GESTURE.UNKNOWN;
  activeStreakCount = 0;
  lastDominantHandIndex = 0;
}

function targetWeightsForGesture(gesture) {
  const weights = {
    dither: 0,
    vhs: 0,
    spotlight: 0,
    ripple: 0,
    sparkle: 0,
    portal: 0,
    heatwave: 0,
    rainbow: 0,
    comic: 0,
    kaleidoscope: 0,
    twinSpotlight: 0,
  };

  switch (gesture) {
    case GESTURE.FIST:
      weights.dither = 1;
      break;
    case GESTURE.PEACE:
      weights.vhs = 1;
      break;
    case GESTURE.POINTING:
      weights.spotlight = 1;
      break;
    case GESTURE.OPEN:
      weights.ripple = 1;
      break;
    case GESTURE.THUMBS_UP:
      weights.sparkle = 1;
      break;
    case GESTURE.OK:
      weights.portal = 1;
      break;
    case GESTURE.ROCK:
      weights.heatwave = 1;
      break;
    case GESTURE.DOUBLE_OPEN:
      weights.rainbow = 1;
      break;
    case GESTURE.DOUBLE_FIST:
      weights.comic = 1;
      break;
    case GESTURE.DOUBLE_PEACE:
      weights.kaleidoscope = 1;
      break;
    case GESTURE.DOUBLE_POINT:
      weights.twinSpotlight = 1;
      break;
    default:
      break;
  }

  return weights;
}

function updateFilterWeights(gesture) {
  const targets = targetWeightsForGesture(gesture);
  for (const key of FILTER_KEYS) {
    filterWeights[key] += (targets[key] - filterWeights[key]) * FILTER_LERP;
    if (filterWeights[key] < 0.004) filterWeights[key] = 0;
    if (filterWeights[key] > 0.996) filterWeights[key] = 1;
  }
}

function getPalmCenter(lm) {
  let x = 0;
  let y = 0;
  for (const id of PALM_IDS) {
    const p = toCanvas(lm[id]);
    x += p.x;
    y += p.y;
  }
  return { x: x / PALM_IDS.length, y: y / PALM_IDS.length };
}

function lerpPoint(target, source, amount) {
  target.x += (source.x - target.x) * amount;
  target.y += (source.y - target.y) * amount;
}

function updateFilterTracking(hands) {
  if (!hands.length) return;

  const tipA = toCanvas(hands[0].landmarks[INDEX_TIP]);
  const tipB =
    hands.length >= 2
      ? toCanvas(hands[1].landmarks[INDEX_TIP])
      : { x: tipA.x, y: tipA.y };
  const palm = getPalmCenter(hands[0].landmarks);
  const thumb = toCanvas(hands[0].landmarks[THUMB_TIP]);
  const touchCenter = {
    x: (tipA.x + thumb.x) / 2,
    y: (tipA.y + thumb.y) / 2,
  };

  if (!primaryTracking.initialized) {
    primaryTracking.smoothTip.x = tipA.x;
    primaryTracking.smoothTip.y = tipA.y;
    primaryTracking.smoothTipB.x = tipB.x;
    primaryTracking.smoothTipB.y = tipB.y;
    primaryTracking.smoothThumb.x = thumb.x;
    primaryTracking.smoothThumb.y = thumb.y;
    primaryTracking.smoothPalm.x = palm.x;
    primaryTracking.smoothPalm.y = palm.y;
    primaryTracking.smoothTouchCenter.x = touchCenter.x;
    primaryTracking.smoothTouchCenter.y = touchCenter.y;
    primaryTracking.initialized = true;
    return;
  }

  const fast = 0.28;
  const slow = 0.15;
  const tipLerp =
    filterWeights.spotlight > 0.05 || filterWeights.twinSpotlight > 0.05
      ? fast
      : slow;
  const palmLerp = filterWeights.ripple > 0.05 ? 0.2 : 0.12;
  const touchLerp = filterWeights.portal > 0.05 ? fast : slow;
  const thumbLerp = filterWeights.sparkle > 0.05 ? fast : slow;

  lerpPoint(primaryTracking.smoothTip, tipA, tipLerp);
  lerpPoint(primaryTracking.smoothTipB, tipB, tipLerp);
  lerpPoint(primaryTracking.smoothThumb, thumb, thumbLerp);
  lerpPoint(primaryTracking.smoothPalm, palm, palmLerp);
  lerpPoint(primaryTracking.smoothTouchCenter, touchCenter, touchLerp);
}

function renderFilterLayer(key, w, h, time) {
  filterLayerCtx.clearRect(0, 0, w, h);

  switch (key) {
    case "dither":
      FilterRender.renderDither(filterLayerCtx, video, w, h);
      break;
    case "vhs":
      FilterRender.renderVHS(filterLayerCtx, video, w, h, time);
      break;
    case "spotlight":
      FilterRender.renderSpotlight(
        filterLayerCtx,
        video,
        w,
        h,
        primaryTracking.smoothTip
      );
      break;
    case "ripple":
      FilterRender.renderRipple(
        filterLayerCtx,
        video,
        w,
        h,
        primaryTracking.smoothPalm,
        time
      );
      break;
    case "sparkle":
      FilterRender.renderSparkle(
        filterLayerCtx,
        video,
        w,
        h,
        primaryTracking.smoothThumb,
        time
      );
      break;
    case "portal":
      FilterRender.renderPortal(
        filterLayerCtx,
        video,
        w,
        h,
        primaryTracking.smoothTouchCenter,
        time
      );
      break;
    case "heatwave":
      FilterRender.renderHeatwave(filterLayerCtx, video, w, h, time);
      break;
    case "rainbow":
      FilterRender.renderRainbow(filterLayerCtx, video, w, h, time);
      break;
    case "comic":
      FilterRender.renderComic(filterLayerCtx, video, w, h, time);
      break;
    case "kaleidoscope":
      FilterRender.renderKaleidoscope(filterLayerCtx, video, w, h, time);
      break;
    case "twinSpotlight":
      FilterRender.renderTwinSpotlight(
        filterLayerCtx,
        video,
        w,
        h,
        primaryTracking.smoothTip,
        primaryTracking.smoothTipB
      );
      break;
  }
}

function drawHandConnectors(lm, styleIndex) {
  const style = HAND_STYLES[styleIndex % HAND_STYLES.length];
  const points = lm.map(toCanvas);

  outCtx.lineCap = "round";
  outCtx.lineJoin = "round";

  for (const [a, b] of HAND_CONNECTIONS) {
    outCtx.beginPath();
    outCtx.moveTo(points[a].x, points[a].y);
    outCtx.lineTo(points[b].x, points[b].y);
    outCtx.strokeStyle = style.line;
    outCtx.lineWidth = 2;
    outCtx.stroke();
  }

  for (const p of points) {
    outCtx.beginPath();
    outCtx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    outCtx.fillStyle = style.joint;
    outCtx.fill();
  }
}

function drawFingertipDot(lm, styleIndex) {
  const style = HAND_STYLES[styleIndex % HAND_STYLES.length];
  const tip = toCanvas(lm[INDEX_TIP]);
  const glow = outCtx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 16);
  glow.addColorStop(0, style.glowInner);
  glow.addColorStop(0.4, style.glowOuter);
  glow.addColorStop(1, "rgba(255, 255, 255, 0)");

  outCtx.beginPath();
  outCtx.arc(tip.x, tip.y, 16, 0, Math.PI * 2);
  outCtx.fillStyle = glow;
  outCtx.fill();

  outCtx.beginPath();
  outCtx.arc(tip.x, tip.y, 4, 0, Math.PI * 2);
  outCtx.fillStyle = style.core;
  outCtx.fill();
}

function drawGestureLabelText(label) {
  const padX = 16;
  const fontSize = 18;
  const pillH = 36;

  outCtx.save();
  outCtx.font = `600 ${fontSize}px Outfit, system-ui, sans-serif`;
  outCtx.textBaseline = "middle";
  const textW = outCtx.measureText(label).width;
  const pillW = textW + padX * 2;
  const x = 20;
  const y = 20;

  outCtx.fillStyle = "rgba(255, 255, 255, 0.1)";
  outCtx.strokeStyle = "rgba(255, 255, 255, 0.2)";
  outCtx.lineWidth = 1;
  roundRect(outCtx, x, y, pillW, pillH, pillH / 2);
  outCtx.fill();
  outCtx.stroke();

  outCtx.fillStyle = "#fff";
  outCtx.fillText(label, x + padX, y + pillH / 2);
  outCtx.restore();
}

function gestureDisplayName(gesture) {
  return GESTURE_LABELS[gesture] ?? gesture;
}

function drawGestureLabelForHands() {
  drawGestureLabelText(gestureDisplayName(activeGesture));
}

function drawDebugPanel(hands) {
  const x = 20;
  let y = 68;
  const lineH = 22;
  const fontSize = 14;

  const hand1 =
    hands[0]?.gesture != null
      ? `${gestureDisplayName(hands[0].gesture)} (${hands[0].gesture})`
      : "—";
  const hand2 =
    hands[1]?.gesture != null
      ? `${gestureDisplayName(hands[1].gesture)} (${hands[1].gesture})`
      : "—";
  const active = `${gestureDisplayName(activeGesture)} (${activeGesture})`;

  const lines = [
    `Hand 1 gesture: ${hand1}`,
    `Hand 2 gesture: ${hand2}`,
    `Active gesture: ${active}`,
  ];

  outCtx.save();
  outCtx.font = `400 ${fontSize}px Outfit, system-ui, sans-serif`;
  outCtx.textBaseline = "top";
  outCtx.fillStyle = "rgba(0, 0, 0, 0.45)";
  outCtx.fillRect(x - 8, y - 6, 340, lines.length * lineH + 12);
  outCtx.fillStyle = "rgba(255, 255, 255, 0.92)";
  for (const line of lines) {
    outCtx.fillText(line, x, y);
    y += lineH;
  }
  outCtx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function renderFrame(time) {
  resizeCanvasesIfNeeded();
  applyOutputTransform();
  updateCoverLayout();

  const w = viewW;
  const h = viewH;
  const now = performance.now();
  const showHands = handsVisible(now);

  const filterGesture = showHands ? activeGesture : GESTURE.UNKNOWN;
  updateFilterWeights(filterGesture);

  if (showHands) {
    updateFilterTracking(detectedHands);
  }

  outCtx.clearRect(0, 0, w, h);

  if (video.videoWidth) {
    FilterRender.drawVideoCover(outCtx, video, w, h);

    for (const key of FILTER_KEYS) {
      const weight = filterWeights[key];
      if (weight < 0.01) continue;

      renderFilterLayer(key, w, h, time);
      outCtx.globalAlpha = weight;
      outCtx.drawImage(filterLayer, 0, 0, w, h);
    }
    outCtx.globalAlpha = 1;
  }

  if (showHands) {
    detectedHands.forEach((hand, index) => {
      drawHandConnectors(hand.landmarks, index);
      drawFingertipDot(hand.landmarks, index);
    });
  } else {
    clearHandState();
  }

  drawGestureLabelForHands();
  if (showHands) {
    drawDebugPanel(detectedHands);
  }

  rafId = requestAnimationFrame(renderFrame);
}

function onResults(results) {
  if (!results.multiHandLandmarks?.length) return;

  lastHandMs = performance.now();
  processHandResults(results);
}

async function start() {
  const hands = new Hands({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  hands.setOptions({
    maxNumHands: MAX_HANDS,
    modelComplexity: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });

  hands.onResults(onResults);

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    video.srcObject = stream;
    await video.play();

    video.addEventListener("loadedmetadata", resizeCanvasesIfNeeded);
    window.addEventListener("resize", resizeCanvasesIfNeeded);

    setStatus("");

    const camera = new Camera(video, {
      onFrame: async () => {
        await hands.send({ image: video });
      },
      width: 1280,
      height: 720,
    });

    await camera.start();
    resizeCanvasesIfNeeded();
    updateCoverLayout();
    rafId = requestAnimationFrame(renderFrame);
  } catch (err) {
    console.error(err);
    setStatus(
      err.name === "NotAllowedError"
        ? "Camera permission denied"
        : "Could not access webcam",
      { error: true }
    );
  }
}

start();
