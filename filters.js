/**
 * Live webcam filters — object-fit: cover layout, mirrored selfie view.
 */
const FilterRender = (() => {
  const DITHER_W = 200;
  const FX_W = 480;

  let ditherCanvas, ditherCtx, ditherImageData;
  let fxCanvas, fxCtx, fxImageData;
  let rippleCanvas, rippleCtx;
  let effectCanvas, effectCtx;
  let bayerMatrix;
  let sparkleSeed = [];

  function computeCoverLayout(canvasWidth, canvasHeight, videoWidth, videoHeight) {
    const videoRatio = videoWidth / videoHeight;
    const canvasRatio = canvasWidth / canvasHeight;

    let drawWidth;
    let drawHeight;
    let offsetX;
    let offsetY;

    if (videoRatio > canvasRatio) {
      drawHeight = canvasHeight;
      drawWidth = videoWidth * (canvasHeight / videoHeight);
      offsetX = (canvasWidth - drawWidth) / 2;
      offsetY = 0;
    } else {
      drawWidth = canvasWidth;
      drawHeight = videoHeight * (canvasWidth / videoWidth);
      offsetX = 0;
      offsetY = (canvasHeight - drawHeight) / 2;
    }

    return {
      canvasWidth,
      canvasHeight,
      videoWidth,
      videoHeight,
      drawWidth,
      drawHeight,
      offsetX,
      offsetY,
    };
  }

  function drawVideoCover(ctx, video, canvasWidth, canvasHeight) {
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    if (!videoWidth || !videoHeight) return null;

    const layout = computeCoverLayout(
      canvasWidth,
      canvasHeight,
      videoWidth,
      videoHeight
    );

    ctx.save();
    ctx.translate(canvasWidth, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(
      video,
      layout.offsetX,
      layout.offsetY,
      layout.drawWidth,
      layout.drawHeight
    );
    ctx.restore();

    return layout;
  }

  function ensureBuffers(outW, outH) {
    if (!ditherCanvas) {
      ditherCanvas = document.createElement("canvas");
      ditherCtx = ditherCanvas.getContext("2d", { willReadFrequently: true });
      bayerMatrix = [
        [0, 8, 2, 10],
        [12, 4, 14, 6],
        [3, 11, 1, 9],
        [15, 7, 13, 5],
      ];
    }
    if (!fxCanvas) {
      fxCanvas = document.createElement("canvas");
      fxCtx = fxCanvas.getContext("2d", { willReadFrequently: true });
    }
    if (!rippleCanvas) {
      rippleCanvas = document.createElement("canvas");
      rippleCtx = rippleCanvas.getContext("2d");
    }

    const ditherH = Math.round((outH / outW) * DITHER_W);
    if (ditherCanvas.width !== DITHER_W || ditherCanvas.height !== ditherH) {
      ditherCanvas.width = DITHER_W;
      ditherCanvas.height = ditherH;
      ditherImageData = ditherCtx.createImageData(DITHER_W, ditherH);
    }

    const fxH = Math.round((outH / outW) * FX_W);
    if (fxCanvas.width !== FX_W || fxCanvas.height !== fxH) {
      fxCanvas.width = FX_W;
      fxCanvas.height = fxH;
      fxImageData = fxCtx.createImageData(FX_W, fxH);
    }

    if (rippleCanvas.width !== outW || rippleCanvas.height !== outH) {
      rippleCanvas.width = outW;
      rippleCanvas.height = outH;
    }
    if (!effectCanvas) {
      effectCanvas = document.createElement("canvas");
      effectCtx = effectCanvas.getContext("2d");
    }
    if (effectCanvas.width !== outW || effectCanvas.height !== outH) {
      effectCanvas.width = outW;
      effectCanvas.height = outH;
    }
    if (sparkleSeed.length === 0) {
      for (let i = 0; i < 48; i++) {
        sparkleSeed.push({
          angle: Math.random() * Math.PI * 2,
          dist: 0.2 + Math.random() * 0.8,
          size: 1 + Math.random() * 3,
          speed: 0.5 + Math.random() * 1.5,
        });
      }
    }
  }

  function renderDither(ctx, video, w, h) {
    const sw = ditherCanvas.width;
    const sh = ditherCanvas.height;
    drawVideoCover(ditherCtx, video, sw, sh);
    const src = ditherCtx.getImageData(0, 0, sw, sh);
    const out = ditherImageData.data;
    const s = src.data;

    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const i = (y * sw + x) * 4;
        const lum = s[i] * 0.299 + s[i + 1] * 0.587 + s[i + 2] * 0.114;
        const threshold = bayerMatrix[y & 3][x & 3] * 16;
        const level = lum + threshold < 128 ? 0 : lum < 200 ? 136 : 255;
        out[i] = level;
        out[i + 1] = level;
        out[i + 2] = level;
        out[i + 3] = 255;
      }
    }

    ditherCtx.putImageData(ditherImageData, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(ditherCanvas, 0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
  }

  function renderVHS(ctx, video, w, h, time) {
    const sw = fxCanvas.width;
    const sh = fxCanvas.height;
    const jitter = Math.sin(time * 0.012) * 2 + Math.sin(time * 0.041) * 1;

    fxCtx.save();
    drawVideoCover(fxCtx, video, sw, sh);
    fxCtx.restore();

    const base = fxCtx.getImageData(0, 0, sw, sh);
    const px = base.data;
    const shift = 2 + Math.round(Math.sin(time * 0.02) * 1);

    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const i = (y * sw + x) * 4;
        const xr = Math.min(sw - 1, x + shift);
        const xb = Math.max(0, x - shift);
        const ir = (y * sw + xr) * 4;
        const ib = (y * sw + xb) * 4;
        const r = px[ir];
        const g = px[i + 1];
        const b = px[ib + 2];
        const noise = (Math.random() - 0.5) * 28;
        px[i] = Math.min(255, Math.max(0, r + noise));
        px[i + 1] = Math.min(255, Math.max(0, g + noise * 0.6));
        px[i + 2] = Math.min(255, Math.max(0, b + noise));
      }
    }

    fxCtx.putImageData(base, 0, 0);
    ctx.drawImage(fxCanvas, 0, 0, w, h);

    ctx.save();
    ctx.globalCompositeOperation = "overlay";
    for (let y = 0; y < h; y += 3) {
      ctx.fillStyle =
        y % 6 === 0 ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.04)";
      ctx.fillRect(0, y, w, 1);
    }
    ctx.globalCompositeOperation = "source-over";
    const bandY = ((time * 0.08) % 1) * h;
    const bandGrad = ctx.createLinearGradient(0, bandY - 40, 0, bandY + 40);
    bandGrad.addColorStop(0, "rgba(255,255,255,0)");
    bandGrad.addColorStop(0.5, "rgba(255,255,255,0.06)");
    bandGrad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = bandGrad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function renderSpotlight(ctx, video, w, h, tip) {
    const x = tip?.x ?? w * 0.5;
    const y = tip?.y ?? h * 0.5;
    const radius = Math.min(w, h) * 0.22;

    drawVideoCover(ctx, video, w, h);
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "destination-out";
    const hole = ctx.createRadialGradient(x, y, 0, x, y, radius);
    hole.addColorStop(0, "rgba(0, 0, 0, 1)");
    hole.addColorStop(0.55, "rgba(0, 0, 0, 0.45)");
    hole.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = hole;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";

    ctx.globalCompositeOperation = "lighter";
    const hot = ctx.createRadialGradient(x, y, 0, x, y, radius * 0.35);
    hot.addColorStop(0, "rgba(255, 255, 240, 0.35)");
    hot.addColorStop(1, "rgba(255, 255, 240, 0)");
    ctx.fillStyle = hot;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function renderRipple(ctx, video, w, h, palm, time) {
    const layout = computeCoverLayout(w, h, video.videoWidth, video.videoHeight);
    const cx = palm?.x ?? w * 0.5;
    const cy = palm?.y ?? h * 0.5;
    const step = 4;
    const amp = 10;
    const freq = 0.045;

    rippleCtx.clearRect(0, 0, w, h);

    for (let y = 0; y < h; y += step) {
      const normY = (y - layout.offsetY) / layout.drawHeight;
      if (normY < 0 || normY > 1) continue;

      const dy = y - cy;
      const dx = cx - w * 0.5;
      const dist = Math.hypot(dx, dy * 0.85);
      const falloff = Math.max(0, 1 - dist / (Math.min(w, h) * 0.45));
      const wave =
        Math.sin(dist * freq - time * 0.006) * amp * falloff +
        Math.sin(y * 0.03 + time * 0.004) * 2 * falloff;

      const srcH = Math.max(1, (step / layout.drawHeight) * layout.videoHeight);

      rippleCtx.save();
      rippleCtx.translate(w, 0);
      rippleCtx.scale(-1, 1);
      rippleCtx.drawImage(
        video,
        0,
        normY * layout.videoHeight,
        layout.videoWidth,
        srcH,
        layout.offsetX + wave,
        y,
        layout.drawWidth,
        step
      );
      rippleCtx.restore();
    }

    ctx.drawImage(rippleCanvas, 0, 0, w, h);
  }

  function renderSparkle(ctx, video, w, h, center, time) {
    const cx = center?.x ?? w * 0.5;
    const cy = center?.y ?? h * 0.35;
    const glowR = Math.min(w, h) * 0.35;

    drawVideoCover(ctx, video, w, h);

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const warm = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    warm.addColorStop(0, "rgba(255, 220, 120, 0.55)");
    warm.addColorStop(0.45, "rgba(255, 170, 60, 0.22)");
    warm.addColorStop(1, "rgba(255, 140, 0, 0)");
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, w, h);

    for (const s of sparkleSeed) {
      const t = time * 0.002 * s.speed;
      const r = glowR * s.dist * (0.85 + Math.sin(t + s.angle) * 0.15);
      const sx = cx + Math.cos(s.angle + t) * r;
      const sy = cy + Math.sin(s.angle + t * 1.3) * r;
      const alpha = 0.35 + Math.sin(t * 3 + s.angle) * 0.35;

      ctx.beginPath();
      ctx.arc(sx, sy, s.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 245, 200, ${alpha})`;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(sx - s.size * 2, sy);
      ctx.lineTo(sx + s.size * 2, sy);
      ctx.moveTo(sx, sy - s.size * 2);
      ctx.lineTo(sx, sy + s.size * 2);
      ctx.strokeStyle = `rgba(255, 255, 220, ${alpha * 0.7})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  function renderPortal(ctx, video, w, h, center, time) {
    const cx = center?.x ?? w * 0.5;
    const cy = center?.y ?? h * 0.5;
    const baseR = Math.min(w, h) * 0.09;
    const pulse = 1 + Math.sin(time * 0.005) * 0.08;

    drawVideoCover(ctx, video, w, h);

    effectCtx.clearRect(0, 0, w, h);
    drawVideoCover(effectCtx, video, w, h);

    const rings = 5;
    for (let i = 0; i < rings; i++) {
      const r = baseR * (1.2 + i * 0.55) * pulse;
      const twist = time * 0.003 + i * 0.4;

      effectCtx.save();
      effectCtx.translate(cx, cy);
      effectCtx.rotate(twist);
      effectCtx.beginPath();
      effectCtx.arc(0, 0, r, 0, Math.PI * 2);
      effectCtx.strokeStyle = `hsla(${200 + i * 22}, 90%, 65%, ${0.45 - i * 0.06})`;
      effectCtx.lineWidth = 5 - i * 0.5;
      effectCtx.stroke();
      effectCtx.restore();
    }

    const innerR = baseR * 0.95 * pulse;
    effectCtx.save();
    effectCtx.beginPath();
    effectCtx.arc(cx, cy, innerR, 0, Math.PI * 2);
    effectCtx.clip();
    effectCtx.translate(cx, cy);
    effectCtx.rotate(-time * 0.004);
    effectCtx.scale(1.12, 1.12);
    effectCtx.translate(-cx, -cy);
    drawVideoCover(effectCtx, video, w, h);
    effectCtx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(effectCanvas, 0, 0);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, baseR * 1.1 * pulse, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(180, 240, 255, 0.85)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  function punchSpotlightHole(ctx, w, h, x, y, radius) {
    const hole = ctx.createRadialGradient(x, y, 0, x, y, radius);
    hole.addColorStop(0, "rgba(0, 0, 0, 1)");
    hole.addColorStop(0.55, "rgba(0, 0, 0, 0.45)");
    hole.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = hole;
    ctx.fillRect(0, 0, w, h);
  }

  function renderRainbow(ctx, video, w, h, time) {
    drawVideoCover(ctx, video, w, h);

    const cx = w * 0.5;
    const cy = h * 0.5;
    const bloomR = Math.max(w, h) * 0.75;
    const hue = (time * 0.00012) % 1;

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const conic = ctx.createConicGradient(hue * Math.PI * 2, cx, cy);
    conic.addColorStop(0, "rgba(255, 80, 120, 0.35)");
    conic.addColorStop(0.17, "rgba(255, 200, 80, 0.3)");
    conic.addColorStop(0.33, "rgba(120, 255, 160, 0.28)");
    conic.addColorStop(0.5, "rgba(80, 180, 255, 0.32)");
    conic.addColorStop(0.67, "rgba(180, 120, 255, 0.3)");
    conic.addColorStop(0.83, "rgba(255, 100, 200, 0.28)");
    conic.addColorStop(1, "rgba(255, 80, 120, 0.35)");
    ctx.fillStyle = conic;
    ctx.fillRect(0, 0, w, h);

    const radial = ctx.createRadialGradient(cx, cy, 0, cx, cy, bloomR);
    radial.addColorStop(0, "rgba(255, 255, 255, 0.22)");
    radial.addColorStop(0.4, "rgba(255, 200, 255, 0.12)");
    radial.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    effectCtx.clearRect(0, 0, w, h);
    drawVideoCover(effectCtx, video, w, h);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const shift = 3 + Math.sin(time * 0.004) * 2;
    ctx.globalAlpha = 0.14;
    ctx.drawImage(effectCanvas, shift, 0, w, h);
    ctx.globalAlpha = 0.12;
    ctx.drawImage(effectCanvas, -shift, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = "soft-light";
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = `hsla(${(hue * 360 + 120) % 360}, 80%, 60%, 0.45)`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function renderComic(ctx, video, w, h, time) {
    const shakeX = Math.sin(time * 0.055) * 5;
    const shakeY = Math.cos(time * 0.047) * 4;
    const pulse = 0.92 + Math.sin(time * 0.08) * 0.08;

    ctx.save();
    ctx.translate(shakeX, shakeY);
    drawVideoCover(ctx, video, w, h);
    ctx.restore();

    const sw = fxCanvas.width;
    const sh = fxCanvas.height;
    drawVideoCover(fxCtx, video, sw, sh);
    const img = fxCtx.getImageData(0, 0, sw, sh);
    const px = img.data;

    for (let i = 0; i < px.length; i += 4) {
      const lum = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
      const level = lum < 70 ? 0 : lum < 150 ? 120 : lum < 210 ? 200 : 255;
      px[i] = level;
      px[i + 1] = level;
      px[i + 2] = level;
    }
    fxCtx.putImageData(img, 0, 0);

    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.55 * pulse;
    ctx.drawImage(fxCanvas, 0, 0, w, h);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    const dotGap = 7;
    for (let y = 0; y < h; y += dotGap) {
      for (let x = 0; x < w; x += dotGap) {
        const n = ((x + y + Math.floor(time * 0.02)) % (dotGap * 2)) / (dotGap * 2);
        if (n > 0.55) {
          ctx.beginPath();
          ctx.arc(x, y, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.globalCompositeOperation = "overlay";
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, 0.04 * h);
    ctx.fillRect(0, h - 0.04 * h, w, 0.04 * h);
    ctx.restore();
  }

  function renderKaleidoscope(ctx, video, w, h, time) {
    const cx = w / 2;
    const cy = h / 2;
    const slices = 8;
    const rot = time * 0.0006;
    const radius = Math.max(w, h) * 1.25;

    effectCtx.clearRect(0, 0, w, h);

    for (let i = 0; i < slices; i++) {
      const a0 = rot + (i * Math.PI * 2) / slices;
      const a1 = rot + ((i + 1) * Math.PI * 2) / slices;

      effectCtx.save();
      effectCtx.beginPath();
      effectCtx.moveTo(cx, cy);
      effectCtx.arc(cx, cy, radius, a0, a1);
      effectCtx.closePath();
      effectCtx.clip();

      effectCtx.translate(cx, cy);
      if (i % 2 === 1) {
        effectCtx.scale(-1, 1);
      }
      effectCtx.rotate(rot * 0.5);
      effectCtx.translate(-cx, -cy);
      drawVideoCover(effectCtx, video, w, h);
      effectCtx.restore();
    }

    const sw = fxCanvas.width;
    const sh = fxCanvas.height;
    fxCtx.drawImage(effectCanvas, 0, 0, sw, sh);
    const base = fxCtx.getImageData(0, 0, sw, sh);
    const px = base.data;
    const shift = 2;

    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const i = (y * sw + x) * 4;
        const xr = Math.min(sw - 1, x + shift);
        const xb = Math.max(0, x - shift);
        const ir = (y * sw + xr) * 4;
        const ib = (y * sw + xb) * 4;
        px[i] = px[ir];
        px[i + 2] = px[ib + 2];
      }
    }
    fxCtx.putImageData(base, 0, 0);

    ctx.drawImage(fxCanvas, 0, 0, w, h);

    ctx.save();
    ctx.globalCompositeOperation = "overlay";
    for (let y = 0; y < h; y += 3) {
      ctx.fillStyle =
        y % 6 === 0 ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.05)";
      ctx.fillRect(0, y, w, 1);
    }
    ctx.restore();
  }

  function renderTwinSpotlight(ctx, video, w, h, tipA, tipB) {
    const radius = Math.min(w, h) * 0.2;

    drawVideoCover(ctx, video, w, h);
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.74)";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "destination-out";

    if (tipA) punchSpotlightHole(ctx, w, h, tipA.x, tipA.y, radius);
    if (tipB) punchSpotlightHole(ctx, w, h, tipB.x, tipB.y, radius);

    ctx.globalCompositeOperation = "source-over";
    ctx.globalCompositeOperation = "lighter";

    for (const tip of [tipA, tipB]) {
      if (!tip) continue;
      const hot = ctx.createRadialGradient(
        tip.x,
        tip.y,
        0,
        tip.x,
        tip.y,
        radius * 0.38
      );
      hot.addColorStop(0, "rgba(255, 255, 245, 0.38)");
      hot.addColorStop(1, "rgba(255, 255, 245, 0)");
      ctx.fillStyle = hot;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }

  function renderHeatwave(ctx, video, w, h, time) {
    const layout = computeCoverLayout(w, h, video.videoWidth, video.videoHeight);
    const step = 5;
    const amp = 12;

    rippleCtx.clearRect(0, 0, w, h);

    for (let y = 0; y < h; y += step) {
      const normY = (y - layout.offsetY) / layout.drawHeight;
      if (normY < 0 || normY > 1) continue;

      const wave =
        Math.sin(y * 0.04 + time * 0.008) * amp +
        Math.sin(y * 0.015 - time * 0.005) * 6;
      const srcH = Math.max(1, (step / layout.drawHeight) * layout.videoHeight);

      rippleCtx.save();
      rippleCtx.translate(w, 0);
      rippleCtx.scale(-1, 1);
      rippleCtx.drawImage(
        video,
        0,
        normY * layout.videoHeight,
        layout.videoWidth,
        srcH,
        layout.offsetX + wave,
        y,
        layout.drawWidth,
        step
      );
      rippleCtx.restore();
    }

    ctx.drawImage(rippleCanvas, 0, 0, w, h);

    ctx.save();
    ctx.globalCompositeOperation = "overlay";
    const fire = ctx.createLinearGradient(0, h, 0, 0);
    fire.addColorStop(0, "rgba(255, 60, 0, 0.35)");
    fire.addColorStop(0.5, "rgba(255, 140, 0, 0.18)");
    fire.addColorStop(1, "rgba(255, 200, 80, 0.08)");
    ctx.fillStyle = fire;
    ctx.fillRect(0, 0, w, h);

    for (let y = 0; y < h; y += 18) {
      const flicker = Math.sin(time * 0.02 + y * 0.1) * 0.5 + 0.5;
      ctx.fillStyle = `rgba(255, 120, 40, ${flicker * 0.12})`;
      ctx.fillRect(0, y, w, 6);
    }
    ctx.restore();
  }

  return {
    computeCoverLayout,
    drawVideoCover,
    ensureBuffers,
    renderDither,
    renderVHS,
    renderSpotlight,
    renderRipple,
    renderSparkle,
    renderPortal,
    renderHeatwave,
    renderRainbow,
    renderComic,
    renderKaleidoscope,
    renderTwinSpotlight,
  };
})();
