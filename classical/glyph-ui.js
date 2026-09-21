/**
 * 单字展示：字元结构弹窗。
 * 动画等后续能力用 GlyphUI.register({ mount(host, ctx) }) 挂到 #glyphExtra，
 * 调用方只需要 GlyphUI.open(ch)。
 */
(() => {
  const FILES = {
    structure: "compound_structure.json",
    anim: "compose_anim.json",
    jiaguwen: "jiaguwen.json",
    variants: "glyph_variants.json",
  };

  const data = {
    structure: null,
    anim: null,
    jiaguwen: null,
    variants: null,
  };
  const features = [];
  let baseUrl = "/glyph-data/";
  let loadPromise = null;
  let overlay = null;

  function dataUrl(name) {
    const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    return base + name;
  }

  function svgDataUrl(svg) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function ensureDom() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.id = "glyphOverlay";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div id="glyphModal" role="dialog" aria-modal="true" aria-labelledby="glyphTitle">
        <div id="glyphHead">
          <span id="glyphTitle">字元结构</span>
          <button type="button" id="glyphClose">关闭</button>
        </div>
        <div id="glyphBody">
          <div id="glyphVar" hidden>
            <div class="glyph-label" id="glyphVarLabel"></div>
            <div class="glyph-var-grid" id="glyphVarGrid"></div>
          </div>
          <div id="glyphJg" hidden>
            <div class="glyph-label" id="glyphJgLabel"></div>
            <div class="glyph-jg-grid" id="glyphJgGrid"></div>
          </div>
          <p id="glyphMeta"></p>
          <div class="glyph-comp-grid" id="glyphGrid"></div>
          <div id="glyphExtra"></div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("#glyphClose").addEventListener("click", close);
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) close();
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && overlay && !overlay.hidden) close();
    });
  }

  function close() {
    if (!overlay) return;
    features.forEach((feature) => {
      try {
        feature.dispose?.();
      } catch (err) {
        console.error(err);
      }
    });
    overlay.hidden = true;
  }

  async function fetchJson(name) {
    const r = await fetch(dataUrl(name), { cache: "force-cache" });
    if (!r.ok) throw new Error(name);
    return r.json();
  }

  function ensureData() {
    if (!loadPromise) {
      loadPromise = (async () => {
        data.structure = await fetchJson(FILES.structure);
        const optional = await Promise.allSettled([
          fetchJson(FILES.anim),
          fetchJson(FILES.jiaguwen),
          fetchJson(FILES.variants),
        ]);
        data.anim = optional[0].status === "fulfilled" ? optional[0].value : {};
        data.jiaguwen = optional[1].status === "fulfilled" ? optional[1].value : {};
        data.variants = optional[2].status === "fulfilled" ? optional[2].value : {};
        return data;
      })().catch((err) => {
        loadPromise = null;
        throw err;
      });
    }
    return loadPromise;
  }

  function canOpen(comp, stack) {
    const name = (comp && comp.name) || "";
    if (!name || (stack || []).includes(name)) return false;
    if (comp.kind === "compound") return !!(data.structure && data.structure[name]);
    return true;
  }

  function buildCompCard(comp, stack) {
    const card = document.createElement("div");
    card.className = "glyph-comp-card";
    const thumb = document.createElement("div");
    thumb.className = "glyph-comp-thumb";
    if (comp.svg) {
      const img = document.createElement("img");
      img.src = svgDataUrl(comp.svg);
      img.alt = comp.name || "";
      thumb.appendChild(img);
    } else {
      thumb.textContent = comp.name || "—";
    }
    const cap = document.createElement("div");
    cap.className = "glyph-cap";
    cap.innerHTML =
      escapeHtml(comp.name || comp.ref || "") +
      (comp.ref ? `<code>${escapeHtml(comp.ref)}</code>` : "");
    card.appendChild(thumb);
    card.appendChild(cap);
    if (canOpen(comp, stack)) {
      card.classList.add("clickable");
      card.addEventListener("click", () => render(comp.name, stack));
    }
    return card;
  }

  function renderJiaguwen(ch) {
    const block = overlay.querySelector("#glyphJg");
    const grid = overlay.querySelector("#glyphJgGrid");
    const variants = data.jiaguwen && data.jiaguwen[ch];
    grid.innerHTML = "";
    if (!variants || !variants.length) {
      block.hidden = true;
      return;
    }
    block.hidden = false;
    overlay.querySelector("#glyphJgLabel").textContent = `甲骨文 · ${ch}（${variants.length}）`;
    variants.forEach((v) => {
      const card = document.createElement("div");
      card.className = "glyph-jg-card";
      const thumb = document.createElement("div");
      thumb.className = "glyph-jg-thumb";
      const img = document.createElement("img");
      img.src = svgDataUrl(v.svg);
      img.alt = `${ch} ${v.label || ""}`;
      thumb.appendChild(img);
      const cap = document.createElement("div");
      cap.className = "glyph-cap";
      cap.textContent = v.label || `表${v.table || ""}`;
      card.appendChild(thumb);
      card.appendChild(cap);
      grid.appendChild(card);
    });
  }

  function renderVariants(ch) {
    const block = overlay.querySelector("#glyphVar");
    const grid = overlay.querySelector("#glyphVarGrid");
    const variants = data.variants && data.variants[ch];
    grid.innerHTML = "";
    if (!variants || variants.length < 2) {
      block.hidden = true;
      return;
    }
    block.hidden = false;
    overlay.querySelector("#glyphVarLabel").textContent = `字元版本（${variants.length}）`;
    variants.forEach((v) => {
      const card = document.createElement("div");
      card.className = "glyph-var-card";
      const thumb = document.createElement("div");
      thumb.className = "glyph-var-thumb";
      thumb.textContent = v.name;
      const cap = document.createElement("div");
      cap.className = "glyph-cap";
      cap.textContent = v.name;
      card.appendChild(thumb);
      card.appendChild(cap);
      grid.appendChild(card);
    });
  }

  function mountFeatures(ch, entry) {
    const host = overlay.querySelector("#glyphExtra");
    host.innerHTML = "";
    const ctx = { ch, structure: entry, anim: data.anim && data.anim[ch], data };
    features.forEach((feature) => {
      try {
        feature.mount?.(host, ctx);
      } catch (err) {
        console.error(err);
      }
    });
  }

  function render(ch, stack) {
    const entry = data.structure && data.structure[ch];
    const title = overlay.querySelector("#glyphTitle");
    const meta = overlay.querySelector("#glyphMeta");
    const grid = overlay.querySelector("#glyphGrid");
    grid.innerHTML = "";
    meta.textContent = "";
    if (entry) {
      title.textContent = `字元结构 · ${ch}`;
      overlay.querySelector("#glyphVar").hidden = true;
      overlay.querySelector("#glyphJg").hidden = true;
      const comps = entry.components || [];
      let text = `${entry.structure || ""} · ${comps.length} 个构件`;
      if (entry.meaning) text += ` · ${entry.meaning}`;
      meta.textContent = text;
      const next = stack.slice();
      if (!next.includes(ch)) next.push(ch);
      comps.forEach((comp) => grid.appendChild(buildCompCard(comp, next)));
    } else {
      title.textContent = `字元详情 · ${ch}`;
      renderVariants(ch);
      renderJiaguwen(ch);
      const noVar = overlay.querySelector("#glyphVar").hidden;
      const noJg = overlay.querySelector("#glyphJg").hidden;
      if (noVar && noJg) meta.textContent = "暂无字元结构、甲骨文或多版本数据";
    }
    mountFeatures(ch, entry || null);
  }

  async function open(ch) {
    if (!ch) return;
    ensureDom();
    overlay.hidden = false;
    overlay.querySelector("#glyphTitle").textContent = `字元结构 · ${ch}`;
    overlay.querySelector("#glyphMeta").textContent = "加载字元数据…";
    overlay.querySelector("#glyphGrid").innerHTML = "";
    overlay.querySelector("#glyphVar").hidden = true;
    overlay.querySelector("#glyphJg").hidden = true;
    overlay.querySelector("#glyphExtra").innerHTML = "";
    try {
      await ensureData();
      render(ch, []);
    } catch (err) {
      overlay.querySelector("#glyphMeta").textContent = "字元数据加载失败";
      console.error(err);
    }
  }

  function init(opts = {}) {
    if (opts.baseUrl) baseUrl = opts.baseUrl;
    ensureDom();
    return { open, close, register };
  }

  function register(feature) {
    if (feature && typeof feature.mount === "function") features.push(feature);
  }

  window.GlyphUI = { init, open, close, register, ensureData };
})();
