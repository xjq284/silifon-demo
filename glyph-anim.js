/**
 * GlyphUI 单字构形动画插件。
 * 依赖 window.GlyphUI；挂到弹窗 #glyphExtra。
 */
(() => {
  if (!window.GlyphUI) {
    console.warn("glyph-anim.js needs GlyphUI first");
    return;
  }

  let token = 0;
  let busy = false;
  let gifencMod = null;
  let hostEl = null;

  function svgDataUrl(svg) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function introPose(index, total, size) {
    const mid = (total - 1) / 2;
    const dx = (index - mid) * Math.min(size * 0.18, 28);
    return { x: dx, y: size * 0.08, scale: 0.4, scale_y: 0.4, rotate: 0, alpha: 0 };
  }

  function finalPose(tr, size) {
    return {
      x: (((tr && tr.x) || 0) / 1000) * size,
      y: (((tr && tr.y) || 0) / 1000) * size,
      scale: tr && tr.scale != null ? tr.scale : 1,
      scale_y:
        tr && tr.scale_y != null ? tr.scale_y : tr && tr.scale != null ? tr.scale : 1,
      rotate: (tr && tr.rotate) || 0,
      alpha: 1,
    };
  }

  function mixPose(a, b, t) {
    return {
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
      scale: lerp(a.scale, b.scale, t),
      scale_y: lerp(a.scale_y, b.scale_y, t),
      rotate: lerp(a.rotate, b.rotate, t),
      alpha: lerp(a.alpha, b.alpha, t),
    };
  }

  function loadSvgImage(svg) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = svgDataUrl(svg);
    });
  }

  function activeFontFamily() {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--active-font").trim();
    return v || "var(--kai), serif";
  }

  async function buildAnimAssets(ch, size, data) {
    const info = data.anim && data.anim[ch];
    const structComp = data.structure && data.structure[ch];
    const svgList = (structComp && structComp.components) || [];
    const comps = (info && info.components) || [];
    const pieces = [];
    for (let i = 0; i < comps.length; i++) {
      const comp = comps[i];
      const byIndex = svgList[i];
      const byName = svgList.find((s) => s && s.name === comp.name);
      const svg = (byIndex && byIndex.svg) || (byName && byName.svg) || null;
      let img = null;
      if (svg) {
        try {
          img = await loadSvgImage(svg);
        } catch (_) {
          img = null;
        }
      }
      pieces.push({
        name: comp.name || "",
        transform: comp.transform || {},
        img,
      });
    }
    return {
      char: ch,
      structure: (info && info.structure) || "",
      pieces,
      size,
      family: activeFontFamily(),
    };
  }

  function ensureCanvas(stage, size) {
    stage.style.setProperty("--anim-size", `${size}px`);
    let canvas = stage.querySelector("canvas");
    if (!canvas) {
      stage.innerHTML = "";
      canvas = document.createElement("canvas");
      stage.appendChild(canvas);
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { canvas, ctx, dpr };
  }

  function drawPiece(ctx, piece, pose, size, family, highlight) {
    if (!pose || pose.alpha <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, pose.alpha));
    ctx.translate(pose.x, pose.y);
    ctx.rotate(((pose.rotate || 0) * Math.PI) / 180);
    ctx.scale(pose.scale, pose.scale_y);
    if (highlight) {
      ctx.shadowColor = "rgba(21, 101, 192, 0.45)";
      ctx.shadowBlur = 8;
    }
    if (piece.img) {
      ctx.drawImage(piece.img, 0, 0, size, size);
    } else {
      ctx.fillStyle = "#111";
      ctx.font = `${size}px ${family}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(piece.name || "·", size / 2, size / 2);
    }
    ctx.restore();
  }

  function drawAnimFrame(ctx, assets, state) {
    const size = assets.size;
    const pad = Math.max(3, size * 0.05);
    const scale = (size - pad * 2) / size;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.save();
    ctx.translate(pad, pad);
    ctx.scale(scale, scale);
    for (let i = 0; i < assets.pieces.length; i++) {
      const pose = state.poses[i];
      if (!pose) continue;
      drawPiece(ctx, assets.pieces[i], pose, size, assets.family, state.highlight === i);
    }
    if (state.finalAlpha > 0.01) {
      ctx.save();
      ctx.globalAlpha = state.finalAlpha;
      const s = state.finalScale || 1;
      ctx.translate(size / 2, size / 2);
      ctx.scale(s, s);
      ctx.translate(-size / 2, -size / 2);
      ctx.fillStyle = "#111";
      ctx.font = `${size}px ${assets.family}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(assets.char, size / 2, size / 2);
      ctx.restore();
    }
    ctx.restore();
  }

  function buildAnimTimeline(assets) {
    const n = assets.pieces.length;
    const size = assets.size;
    const events = [];
    let t = 0;
    if (!n) {
      events.push({ t0: 0, t1: 400, kind: "final", from: 0, to: 1 });
      return { duration: 900, events };
    }
    for (let i = 0; i < n; i++) {
      const intro = introPose(i, n, size);
      intro.alpha = 0;
      const shown = Object.assign({}, intro, { alpha: 1 });
      const fin = finalPose(assets.pieces[i].transform, size);
      events.push({ t0: t, t1: t + 280, kind: "piece", index: i, from: intro, to: shown });
      t += 280;
      events.push({ t0: t, t1: t + 720, kind: "piece", index: i, from: shown, to: fin });
      t += 720;
      events.push({ t0: t, t1: t + 120, kind: "hold" });
      t += 120;
    }
    events.push({ t0: t, t1: t + 500, kind: "toFinal" });
    t += 500;
    events.push({ t0: t, t1: t + 700, kind: "holdFinal" });
    t += 700;
    return { duration: t, events };
  }

  function sampleAnimState(assets, timeline, timeMs) {
    const n = assets.pieces.length;
    const poses = [];
    for (let i = 0; i < n; i++) {
      const p = introPose(i, n, assets.size);
      p.alpha = 0;
      poses.push(p);
    }
    let highlight = -1;
    let finalAlpha = 0;
    let finalScale = 1;
    let status = "";
    for (const ev of timeline.events) {
      if (timeMs < ev.t0) break;
      const u = ev.t1 === ev.t0 ? 1 : Math.max(0, Math.min(1, (timeMs - ev.t0) / (ev.t1 - ev.t0)));
      const e = easeOutCubic(u);
      const active = timeMs < ev.t1;
      if (ev.kind === "piece") {
        poses[ev.index] = active ? mixPose(ev.from, ev.to, e) : Object.assign({}, ev.to);
        if (active) {
          highlight = ev.index;
          status = `放入「${assets.pieces[ev.index].name}」（${ev.index + 1}/${n}）`;
        }
      } else if (ev.kind === "toFinal") {
        for (let i = 0; i < n; i++) {
          const base = finalPose(assets.pieces[i].transform, assets.size);
          poses[i] = Object.assign({}, base, { alpha: 1 - 0.78 * (active ? e : 1) });
        }
        finalAlpha = active ? e : 1;
        finalScale = active ? lerp(0.86, 1, e) : 1;
        highlight = -1;
        status = "合成整字";
      } else if (ev.kind === "holdFinal" || ev.kind === "final") {
        for (let i = 0; i < n; i++) {
          poses[i] = Object.assign({}, finalPose(assets.pieces[i].transform, assets.size), {
            alpha: 0,
          });
        }
        finalAlpha = 1;
        finalScale = 1;
        highlight = -1;
        status = "完成";
      }
    }
    if (timeMs >= timeline.duration) status = "完成";
    return { poses, highlight, finalAlpha, finalScale, status };
  }

  function setBusy(ui, on) {
    busy = !!on;
    ui.play.disabled = busy;
    ui.replay.disabled = busy;
    ui.exportBtn.disabled = busy;
  }

  function stop() {
    token += 1;
    busy = false;
  }

  async function play(ui, ch, data) {
    if (busy) return;
    const size = Math.min(280, Math.max(48, Number(ui.size.value) || 96));
    ui.size.value = String(size);
    ui.meta.textContent = "";
    ui.status.textContent = "";
    const my = ++token;
    setBusy(ui, true);
    try {
      await GlyphUI.ensureData();
      const assets = await buildAnimAssets(ch, size, data);
      if (!assets.pieces.length) {
        ui.meta.textContent = `${ch} · 暂无构形数据，直接显示整字`;
      } else {
        ui.meta.textContent = `${ch} · ${assets.structure} · ${assets.pieces.map((p) => p.name).join(" + ")}`;
      }
      const { ctx } = ensureCanvas(ui.stage, size);
      const timeline = buildAnimTimeline(assets);
      const t0 = performance.now();
      await new Promise((resolve) => {
        function frame(now) {
          if (my !== token) {
            resolve();
            return;
          }
          const t = now - t0;
          const state = sampleAnimState(assets, timeline, t);
          drawAnimFrame(ctx, assets, state);
          if (state.status) ui.status.textContent = state.status;
          if (t >= timeline.duration) {
            ui.status.textContent = "完成";
            resolve();
            return;
          }
          requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      });
    } catch (err) {
      console.error(err);
      if (my === token) ui.status.textContent = "播放失败";
    } finally {
      if (my === token) setBusy(ui, false);
    }
  }

  async function loadGifenc() {
    if (gifencMod) return gifencMod;
    gifencMod = await import("https://cdn.jsdelivr.net/npm/gifenc@1.0.3/+esm");
    return gifencMod;
  }

  async function exportGif(ui, ch, data) {
    if (busy) return;
    let size = Math.min(180, Math.max(48, Number(ui.size.value) || 96));
    const my = ++token;
    setBusy(ui, true);
    ui.status.textContent = "正在生成 GIF…";
    try {
      await GlyphUI.ensureData();
      const assets = await buildAnimAssets(ch, size, data);
      if (!assets.pieces.length) {
        ui.meta.textContent = `${ch} · 暂无构形数据，直接显示整字`;
      } else {
        ui.meta.textContent = `${ch} · ${assets.structure} · ${assets.pieces.map((p) => p.name).join(" + ")}`;
      }
      const timeline = buildAnimTimeline(assets);
      const { GIFEncoder, quantize, applyPalette } = await loadGifenc();
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const view = ensureCanvas(ui.stage, Math.min(280, Math.max(48, Number(ui.size.value) || 96)));
      const fps = 12;
      const frameDelay = Math.round(1000 / fps);
      const gif = GIFEncoder();
      let written = 0;
      for (let t = 0; t <= timeline.duration; t += frameDelay) {
        if (my !== token) return;
        const state = sampleAnimState(assets, timeline, t);
        drawAnimFrame(ctx, assets, state);
        view.ctx.clearRect(0, 0, view.canvas.width, view.canvas.height);
        view.ctx.setTransform(1, 0, 0, 1, 0, 0);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        view.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        view.ctx.drawImage(canvas, 0, 0, Number(ui.size.value) || size, Number(ui.size.value) || size);
        const pixels = ctx.getImageData(0, 0, size, size).data;
        const palette = quantize(pixels, 256);
        const index = applyPalette(pixels, palette);
        gif.writeFrame(index, size, size, { palette, delay: frameDelay });
        written += 1;
        if (written % 4 === 0) {
          ui.status.textContent = `正在生成 GIF… ${Math.min(100, Math.round((t / timeline.duration) * 100))}%`;
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      gif.finish();
      const blob = new Blob([gif.bytes()], { type: "image/gif" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `silifon-anim-${ch}.gif`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      ui.status.textContent = `已导出 silifon-anim-${ch}.gif`;
    } catch (err) {
      console.error(err);
      ui.status.textContent = "导出 GIF 失败（需能访问 CDN 加载编码器）";
    } finally {
      if (my === token) setBusy(ui, false);
    }
  }

  function mount(host, ctx) {
    stop();
    hostEl = host;
    const ch = ctx.ch;
    const hasAnim = !!(ctx.anim && (ctx.anim.components || []).length);
    host.innerHTML = `
      <div class="glyph-anim">
        <div class="glyph-anim-title">单字动画</div>
        <div class="glyph-anim-row">
          <label>字号 <input type="number" class="glyph-anim-size" min="48" max="280" step="8" value="96" /></label>
          <button type="button" class="glyph-anim-play">播放</button>
          <button type="button" class="glyph-anim-replay">重播</button>
          <button type="button" class="glyph-anim-export">导出 GIF</button>
        </div>
        <p class="glyph-anim-meta"></p>
        <div class="glyph-anim-stage"></div>
        <p class="glyph-anim-status">${hasAnim ? "" : "此字暂无分步构形，可仍播放整字淡入。"}</p>
      </div>`;
    const ui = {
      size: host.querySelector(".glyph-anim-size"),
      play: host.querySelector(".glyph-anim-play"),
      replay: host.querySelector(".glyph-anim-replay"),
      exportBtn: host.querySelector(".glyph-anim-export"),
      meta: host.querySelector(".glyph-anim-meta"),
      stage: host.querySelector(".glyph-anim-stage"),
      status: host.querySelector(".glyph-anim-status"),
    };
    const run = () => play(ui, ch, ctx.data);
    ui.play.addEventListener("click", run);
    ui.replay.addEventListener("click", run);
    ui.exportBtn.addEventListener("click", () => exportGif(ui, ch, ctx.data));
  }

  function dispose() {
    stop();
    if (hostEl) hostEl.innerHTML = "";
    hostEl = null;
  }

  GlyphUI.register({ name: "compose-anim", mount, dispose });
})();
