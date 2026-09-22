(() => {
  const state = {
    mode: "browse", // browse | read | line | char
    work: null,
    path: [], // browse ancestors under work: [{id,title,type}, ...]
    chapter: null,
    lines: [],
    lineId: null,
    charIndex: -1,
    interpIndex: 0,
    font: "kai",
    readSize: null,
    treeExpanded: new Set(),
    treeChildren: new Map(), // work:id | node:id -> children[]
  };

  const FONT_CSS = {
    kai: "var(--kai)",
    silifon: "var(--silifon)",
    silifon1: "var(--silifon1)",
    seal: "var(--seal)",
  };

  const READ_SIZE_MIN = 14;
  const READ_SIZE_MAX = 64;
  const READ_SIZE_DEFAULT = 25;
  const READ_SIZE_LEGACY = { s: 18, m: 25, l: 33, xl: 43 };

  function parseReadSize(raw) {
    if (raw != null && READ_SIZE_LEGACY[raw] != null) return READ_SIZE_LEGACY[raw];
    const n = Number(raw);
    if (Number.isFinite(n)) {
      return Math.min(READ_SIZE_MAX, Math.max(READ_SIZE_MIN, Math.round(n)));
    }
    return READ_SIZE_DEFAULT;
  }

  state.readSize = parseReadSize(localStorage.getItem("classical.readSize"));

  function applyReadSize() {
    const size = parseReadSize(state.readSize);
    state.readSize = size;
    document.documentElement.style.setProperty("--read-size", `${size}px`);
    const input = document.getElementById("readSizeInput");
    if (input) input.value = String(size);
  }

  const panel = document.getElementById("panel");
  const crumb = document.getElementById("crumb");
  const modes = document.getElementById("modes");
  const fontbar = document.getElementById("fontbar");

  function applyFont() {
    document.documentElement.style.setProperty(
      "--active-font",
      FONT_CSS[state.font] || FONT_CSS.kai,
    );
    fontbar.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", b.dataset.font === state.font);
    });
  }

  function setMode(mode) {
    state.mode = mode;
    modes.querySelectorAll("button").forEach((b) => {
      const m = b.dataset.mode;
      b.classList.toggle("active", m === mode);
      if (m === "browse") b.disabled = false;
      if (m === "read") b.disabled = !state.chapter;
      if (m === "line" || m === "char") b.disabled = !state.lineId && !state.lines.length;
    });
  }

  function hanChars(text) {
    return Array.from(text || "").filter((ch) => /\p{Script=Han}/u.test(ch));
  }


  const CORPUS_VERSION = "5e14118641e1";
  let corpus = null;

  async function loadCorpus() {
    if (corpus) return corpus;
    const r = await fetch(`./data/corpus.json?v=${CORPUS_VERSION}`, { cache: "no-store" });
    if (!r.ok) throw new Error("课文数据加载失败");
    corpus = await r.json();
    return corpus;
  }

  function nodeById(id) {
    return corpus.nodesById[id] || null;
  }

  function workById(id) {
    return corpus.works.find((w) => w.id === id) || null;
  }

  function descendantIds(nodeId) {
    const out = [];
    const queue = [nodeId];
    const seen = new Set();
    while (queue.length) {
      const cur = queue.shift();
      if (seen.has(cur)) continue;
      seen.add(cur);
      out.push(cur);
      const kids = nodeById(cur)?.child_ids || [];
      queue.push(...kids);
    }
    return out;
  }

  function linesUnderNode(nodeId) {
    const ordered = [];
    for (const id of descendantIds(nodeId)) {
      const lines = corpus.linesByParent[id];
      if (lines) ordered.push(...lines);
    }
    return ordered;
  }

  function nodeAncestors(nodeId) {
    const chain = [];
    let node = nodeById(nodeId);
    while (node && node.parent_id) {
      const parent = nodeById(node.parent_id);
      if (!parent) break;
      chain.push(parent);
      node = parent;
    }
    chain.reverse();
    return chain;
  }

  const CN_DIGITS = {
    零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  };

  function cnNumToInt(text) {
    const s = String(text || "").trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) return Number(s);
    if (s === "十") return 10;
    if (s.startsWith("十")) {
      const rest = s.slice(1);
      return 10 + (rest ? CN_DIGITS[rest] || 0 : 0);
    }
    if (s.includes("十")) {
      const [a, b] = s.split("十");
      if (!(a in CN_DIGITS)) return null;
      return CN_DIGITS[a] * 10 + (b ? CN_DIGITS[b] || 0 : 0);
    }
    return s in CN_DIGITS ? CN_DIGITS[s] : null;
  }

  function chapterCn(n) {
    const digits = "零一二三四五六七八九";
    if (n <= 0) return String(n);
    if (n < 10) return digits[n];
    if (n === 10) return "十";
    if (n < 20) return "十" + digits[n - 10];
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return digits[tens] + "十" + (ones ? digits[ones] : "");
  }

  function fuzzySubseq(needle, hay) {
    if (!needle) return false;
    let i = 0;
    for (const ch of hay) {
      if (ch === needle[i]) {
        i += 1;
        if (i >= needle.length) return true;
      }
    }
    return false;
  }

  function parseSearchQuery(q) {
    let raw = String(q || "").trim();
    let s = raw;
    for (const ch of "《》「」[]【】 \t　") s = s.split(ch).join("");
    s = s.replace(/[０-９]/g, (d) => "０１２３４５６７８９".indexOf(d).toString());

    let workHint = null;
    if (s.includes("道德经") || s.includes("老子")) {
      workHint = "dao_de_jing";
      s = s.replaceAll("道德经", "").replaceAll("老子", "");
    } else if (s.includes("诗经") || s.includes("毛诗")) {
      workHint = "shi_jing";
      s = s.replaceAll("诗经", "").replaceAll("毛诗", "");
    } else if (s.includes("三字经") || s.includes("三字經")) {
      workHint = "san_zi_jing";
      s = s.replaceAll("三字经", "").replaceAll("三字經", "");
    } else if (s.includes("千字文")) {
      workHint = "qian_zi_wen";
      s = s.replaceAll("千字文", "");
    } else if (s.includes("百家姓")) {
      workHint = "bai_jia_xing";
      s = s.replaceAll("百家姓", "");
    } else if (s.includes("我的mv") || s.includes("汉字之歌")) {
      workHint = "我的mv";
      s = s.replaceAll("我的mv", "").replaceAll("汉字之歌", "");
    }

    let chapterNum = null;
    const m = s.match(/第?\s*([0-9]+|[零〇一二两三四五六七八九十]+)\s*章/);
    if (m) {
      chapterNum = cnNumToInt(m[1]);
      s = (s.slice(0, m.index) + s.slice(m.index + m[0].length)).trim();
    } else if (workHint === "dao_de_jing") {
      const m2 = s.match(/^([0-9]+|[零〇一二两三四五六七八九十]+)$/);
      if (m2) {
        chapterNum = cnNumToInt(m2[1]);
        s = "";
      }
    }
    return { raw, text: s, workHint, chapterNum };
  }

  function searchNodes(q, limit = 20) {
    const parsed = parseSearchQuery(q);
    if (!parsed.raw) return [];
    if (parsed.workHint && !parsed.text && parsed.chapterNum == null) {
      const roots = Object.values(corpus.nodesById)
        .filter((n) => n.work_id === parsed.workHint && !n.parent_id)
        .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
      return roots.slice(0, limit).map((node) => {
        const work = workById(node.work_id);
        const ancestors = nodeAncestors(node.id).map((a) => ({
          id: a.id, title: a.title, type: a.type,
        }));
        const pathParts = [];
        if (work) pathParts.push(work.title);
        pathParts.push(...ancestors.map((a) => a.title), node.title);
        return { score: 850, node, work, ancestors, path_label: pathParts.join(" / ") };
      });
    }
    const scored = [];
    for (const node of Object.values(corpus.nodesById)) {
      if (parsed.workHint && node.work_id !== parsed.workHint) continue;
      const title = node.title || "";
      let score = 0;
      if (parsed.chapterNum != null && node.type === "chapter") {
        if (node.sort === parsed.chapterNum) score = Math.max(score, 1000);
        else if (title === `第${chapterCn(parsed.chapterNum)}章`) score = Math.max(score, 1000);
      }
      if (parsed.text) {
        if (title === parsed.text) score = Math.max(score, 900);
        else if (title.startsWith(parsed.text)) score = Math.max(score, 700);
        else if (title.includes(parsed.text)) score = Math.max(score, 500);
        else if (fuzzySubseq(parsed.text, title)) score = Math.max(score, 300);
      }
      if (score <= 0) continue;
      if (node.type === "poem" || node.type === "chapter") score += 20;
      else if (node.type === "section") score += 5;
      scored.push({ score, node });
    }
    scored.sort((a, b) => b.score - a.score || a.node.sort - b.node.sort);
    return scored.slice(0, limit).map(({ score, node }) => {
      const work = workById(node.work_id);
      const ancestors = nodeAncestors(node.id).map((a) => ({
        id: a.id,
        title: a.title,
        type: a.type,
      }));
      const pathParts = [];
      if (work) pathParts.push(work.title);
      pathParts.push(...ancestors.map((a) => a.title), node.title);
      return {
        score,
        node,
        work,
        ancestors,
        path_label: pathParts.join(" / "),
      };
    });
  }

  function pickExtras(obj) {
    if (!obj) return {};
    return { video: obj.video || null, remark: obj.remark || null };
  }

  async function api(path, options = {}) {
    const method = String((options && options.method) || "GET").toUpperCase();
    if (method !== "GET") {
      throw new Error("静态站只读，请在本地 classical 维护");
    }
    await loadCorpus();
    const [pathname, query = ""] = path.split("?");
    const params = new URLSearchParams(query);

    if (pathname === "/api/works") {
      return corpus.works.map(({ id, title, sort, meta_json, video, remark }) => ({
        id, title, sort, meta_json, video, remark,
      }));
    }

    let m = pathname.match(/^\/api\/works\/(.+)$/);
    if (m) {
      const workId = decodeURIComponent(m[1]);
      const work = workById(workId);
      if (!work) throw new Error("work not found");
      const children = (work.root_ids || []).map((id) => nodeById(id)).filter(Boolean);
      return {
        work: {
          id: work.id,
          title: work.title,
          sort: work.sort,
          meta_json: work.meta_json,
          ...pickExtras(work),
        },
        children,
      };
    }

    m = pathname.match(/^\/api\/nodes\/(.+)$/);
    if (m) {
      const nodeId = decodeURIComponent(m[1]);
      const node = nodeById(nodeId);
      if (!node) throw new Error("node not found");
      const children = (node.child_ids || []).map((id) => nodeById(id)).filter(Boolean);
      return { node, children, lines: linesUnderNode(nodeId) };
    }

    m = pathname.match(/^\/api\/lines\/(.+)$/);
    if (m) {
      const lineId = decodeURIComponent(m[1]);
      let line = null;
      for (const arr of Object.values(corpus.linesByParent || {})) {
        line = arr.find((l) => l.id === lineId) || null;
        if (line) break;
      }
      if (!line) throw new Error("line not found");
      const interpretations =
        line.interpretations ||
        (corpus.interpretationsByLine || {})[lineId] ||
        [];
      const detail = { ...line, interpretations };
      return { line: detail, interpretations, prev: null, next: null };
    }

    if (pathname === "/api/search") {
      const q = params.get("q") || "";
      return { q, results: searchNodes(q) };
    }

    throw new Error(`unknown api: ${pathname}`);
  }

  function askPassword(actionLabel) {
    const pw = window.prompt(`删除「${actionLabel}」需输入管理密码：`);
    return pw == null ? null : pw;
  }

  async function adminDelete(path, label) {
    const password = askPassword(label);
    if (password == null) return false;
    await api(path, { method: "DELETE", body: { password } });
    return true;
  }

  async function saveExtra(entityType, entityId, { video, remark }) {
    return api(`/api/extra/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`, {
      method: "PUT",
      body: {
        video: (video || "").trim() || null,
        remark: (remark || "").trim() || null,
      },
    });
  }

  function extraDisplayHtml(obj, { label = "引用" } = {}) {
    if (!obj) return "";
    const video = (obj.video || "").trim();
    const remark = (obj.remark || "").trim();
    if (!video && !remark) return "";
    const videoLinks = video
      ? video
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map(
            (url, i) =>
              `<p class="extra-video"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}视频${video.split(/\r?\n/).filter((s) => s.trim()).length > 1 ? i + 1 : ""}</a></p>`,
          )
          .join("")
      : "";
    return `
      <div class="extra-display">
        ${videoLinks}
        ${remark ? `<p class="extra-remark">${escapeHtml(remark)}</p>` : ""}
      </div>`;
  }

  function extraEditorHtml(entityType, entityId, obj = {}, { compact = false } = {}) {
    return `
      <form class="extra-form${compact ? " compact" : ""}" data-extra-type="${escapeHtml(entityType)}" data-extra-id="${escapeHtml(entityId)}">
        <label class="full">视频链接（每行一条）
          <textarea name="video" rows="${compact ? 2 : 3}" placeholder="https://...">${escapeHtml(obj.video || "")}</textarea>
        </label>
        <label class="full">备注
          <input name="remark" value="${escapeHtml(obj.remark || "")}" placeholder="可选备注" />
        </label>
        <button type="submit">保存挂接</button>
      </form>`;
  }

  function bindExtraForms(root, onSaved) {
    root.querySelectorAll("form.extra-form").forEach((form) => {
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const fd = new FormData(form);
        try {
          const saved = await saveExtra(form.dataset.extraType, form.dataset.extraId, {
            video: String(fd.get("video") || ""),
            remark: String(fd.get("remark") || ""),
          });
          onSaved?.(saved, form);
        } catch (e) {
          alert(e.message || e);
        }
      });
    });
  }

  function renderCrumb() {
    const parts = [];
    parts.push(`<button type="button" data-go="works">作品</button>`);
    if (state.work) {
      parts.push(` / <button type="button" data-go="work">${escapeHtml(state.work.title)}</button>`);
    }
    state.path.forEach((n, i) => {
      parts.push(
        ` / <button type="button" data-go="path" data-idx="${i}">${escapeHtml(n.title)}</button>`,
      );
    });
    if (state.chapter) {
      parts.push(` / <span>${escapeHtml(state.chapter.title)}</span>`);
    }
    crumb.innerHTML = parts.join("");
    crumb.querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => {
        stopRecite();
        const stayMaintain = state.mode === "maintain";
        if (b.dataset.go === "works") {
          state.work = null;
          state.path = [];
          state.chapter = null;
          state.lines = [];
          state.lineId = null;
          state.charIndex = -1;
          if (stayMaintain) renderMaintain();
          else {
            setMode("browse");
            showWorks();
          }
        } else if (b.dataset.go === "work") {
          state.path = [];
          state.chapter = null;
          state.lines = [];
          state.lineId = null;
          state.charIndex = -1;
          if (stayMaintain) renderMaintain();
          else {
            setMode("browse");
            showWork(state.work.id);
          }
        } else if (b.dataset.go === "path") {
          const idx = Number(b.dataset.idx);
          const node = state.path[idx];
          state.path = state.path.slice(0, idx);
          state.chapter = null;
          state.lines = [];
          state.lineId = null;
          state.charIndex = -1;
          if (stayMaintain) {
            state.path = [...state.path, { id: node.id, title: node.title, type: node.type }];
            renderMaintain();
          } else {
            setMode("browse");
            openNode(node.id);
          }
        }
      });
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function typeLabel(type) {
    return (
      {
        book: "部",
        part: "类",
        section: "什/国",
        poem: "篇",
        chapter: "章",
      }[type] || type
    );
  }

  function treeKey(kind, id) {
    return `${kind}:${id}`;
  }

  async function ensureTreeChildren(kind, id) {
    const key = treeKey(kind, id);
    if (state.treeChildren.has(key)) return state.treeChildren.get(key);
    let kids = [];
    if (kind === "work") {
      const data = await api(`/api/works/${encodeURIComponent(id)}`);
      kids = data.children || [];
    } else {
      const data = await api(`/api/nodes/${encodeURIComponent(id)}`);
      kids = data.children || [];
    }
    state.treeChildren.set(key, kids);
    return kids;
  }

  function isExpandableNode(node, children) {
    return (children?.length || 0) > 0 && node.type !== "poem";
  }

  async function showBrowseTree() {
    renderCrumb();
    setMode("browse");
    const works = await api("/api/works");
    // 若当前在某作品路径上，自动展开该路径
    if (state.work?.id) {
      state.treeExpanded.add(treeKey("work", state.work.id));
      await ensureTreeChildren("work", state.work.id);
      for (const n of state.path) {
        state.treeExpanded.add(treeKey("node", n.id));
        await ensureTreeChildren("node", n.id);
      }
    }
    panel.innerHTML = `
      <h2 class="read-title">选择作品</h2>
      <div class="tree" id="browseTree"></div>
      <p class="hint">点 ▸ 展开目录，点标题进入阅读。</p>
    `;
    const root = panel.querySelector("#browseTree");
    works.forEach((w) => root.appendChild(buildWorkTreeItem(w)));
  }

  function buildWorkTreeItem(work) {
    const key = treeKey("work", work.id);
    const expanded = state.treeExpanded.has(key);
    const wrap = document.createElement("div");
    wrap.className = "tree-branch";
    const row = document.createElement("div");
    row.className = `tree-row depth-0${state.work?.id === work.id ? " current" : ""}`;
    row.innerHTML = `
      <button type="button" class="tree-toggle" aria-label="展开">${expanded ? "▾" : "▸"}</button>
      <button type="button" class="tree-label">
        <strong>${escapeHtml(work.title)}</strong>
        <span class="meta">${escapeHtml(work.id)}</span>
      </button>
    `;
    const kidsBox = document.createElement("div");
    kidsBox.className = "tree-children";
    kidsBox.hidden = !expanded;

    row.querySelector(".tree-toggle").addEventListener("click", async (ev) => {
      ev.stopPropagation();
      await toggleTreeExpand("work", work.id, kidsBox, row.querySelector(".tree-toggle"), () =>
        renderWorkChildren(work.id, kidsBox),
      );
    });
    row.querySelector(".tree-label").addEventListener("click", async () => {
      state.work = work;
      state.path = [];
      state.chapter = null;
      state.lines = [];
      state.lineId = null;
      if (!state.treeExpanded.has(key)) {
        await toggleTreeExpand("work", work.id, kidsBox, row.querySelector(".tree-toggle"), () =>
          renderWorkChildren(work.id, kidsBox),
        );
      } else {
        renderCrumb();
      }
    });

    wrap.appendChild(row);
    wrap.appendChild(kidsBox);
    if (expanded) {
      renderWorkChildren(work.id, kidsBox).catch((e) => {
        kidsBox.innerHTML = `<p class="hint">${escapeHtml(e.message || e)}</p>`;
      });
    }
    return wrap;
  }

  async function renderWorkChildren(workId, box) {
    const kids = await ensureTreeChildren("work", workId);
    box.innerHTML = "";
    if (!kids.length) {
      box.innerHTML = `<p class="hint tree-empty">暂无章节</p>`;
      return;
    }
    kids.forEach((n) => box.appendChild(buildNodeTreeItem(n, 1, [])));
  }

  function buildNodeTreeItem(node, depth, ancestors) {
    const key = treeKey("node", node.id);
    const expanded = state.treeExpanded.has(key);
    const cached = state.treeChildren.get(key);
    const maybeExpandable = node.type !== "poem";
    const wrap = document.createElement("div");
    wrap.className = "tree-branch";
    const row = document.createElement("div");
    row.className = `tree-row depth-${Math.min(depth, 6)}${state.chapter?.id === node.id ? " current" : ""}`;
    row.innerHTML = `
      <button type="button" class="tree-toggle" aria-label="展开">${
        maybeExpandable ? (expanded ? "▾" : "▸") : "·"
      }</button>
      <button type="button" class="tree-label">
        <strong>${escapeHtml(node.title || node.id)}</strong>
        <span class="meta">${escapeHtml(typeLabel(node.type))}</span>
      </button>
    `;
    const kidsBox = document.createElement("div");
    kidsBox.className = "tree-children";
    kidsBox.hidden = !expanded;

    const toggleBtn = row.querySelector(".tree-toggle");
    if (maybeExpandable) {
      toggleBtn.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        await toggleTreeExpand("node", node.id, kidsBox, toggleBtn, () =>
          renderNodeChildren(node, depth, ancestors, kidsBox),
        );
      });
    } else {
      toggleBtn.disabled = true;
      toggleBtn.classList.add("leaf");
    }

    row.querySelector(".tree-label").addEventListener("click", async () => {
      // 先探一下是否可展开目录
      const kids = await ensureTreeChildren("node", node.id);
      if (isExpandableNode(node, kids)) {
        state.work = state.work || { id: node.work_id };
        if (!state.treeExpanded.has(key)) {
          await toggleTreeExpand("node", node.id, kidsBox, toggleBtn, () =>
            renderNodeChildren(node, depth, ancestors, kidsBox),
          );
        }
        state.path = [...ancestors, { id: node.id, title: node.title, type: node.type }];
        renderCrumb();
        return;
      }
      // 叶子：进入阅读
      state.path = [...ancestors];
      await openNode(node.id);
    });

    wrap.appendChild(row);
    wrap.appendChild(kidsBox);
    if (expanded) {
      renderNodeChildren(node, depth, ancestors, kidsBox).catch((e) => {
        kidsBox.innerHTML = `<p class="hint">${escapeHtml(e.message || e)}</p>`;
      });
    }
    return wrap;
  }

  async function renderNodeChildren(node, depth, ancestors, box) {
    const kids = await ensureTreeChildren("node", node.id);
    box.innerHTML = "";
    if (!kids.length) {
      box.innerHTML = `<p class="hint tree-empty">无子目录（点标题可读正文）</p>`;
      return;
    }
    const nextAncestors = [...ancestors, { id: node.id, title: node.title, type: node.type }];
    kids.forEach((n) => box.appendChild(buildNodeTreeItem(n, depth + 1, nextAncestors)));
  }

  async function toggleTreeExpand(kind, id, kidsBox, toggleBtn, renderKids) {
    const key = treeKey(kind, id);
    if (state.treeExpanded.has(key)) {
      state.treeExpanded.delete(key);
      kidsBox.hidden = true;
      kidsBox.innerHTML = "";
      if (toggleBtn) toggleBtn.textContent = "▸";
      return;
    }
    state.treeExpanded.add(key);
    kidsBox.hidden = false;
    if (toggleBtn) toggleBtn.textContent = "▾";
    kidsBox.innerHTML = `<p class="hint tree-empty">加载中…</p>`;
    try {
      await renderKids();
    } catch (e) {
      kidsBox.innerHTML = `<p class="hint">${escapeHtml(e.message || e)}</p>`;
    }
  }

  async function showWorks() {
    await showBrowseTree();
  }

  async function showWork(workId) {
    const data = await api(`/api/works/${encodeURIComponent(workId)}`);
    state.work = data.work;
    state.path = [];
    state.chapter = null;
    state.lines = [];
    state.lineId = null;
    state.treeExpanded.add(treeKey("work", workId));
    state.treeChildren.set(treeKey("work", workId), data.children || []);
    await showBrowseTree();
  }

  async function renderMaintain() {
    stopRecite();
    renderCrumb();
    setMode("maintain");
    try {
      if (!state.work) {
        await renderMaintainWorks();
        return;
      }
      const parentId = state.path.length ? state.path[state.path.length - 1].id : null;
      const data = parentId
        ? await api(`/api/nodes/${encodeURIComponent(parentId)}`)
        : await api(`/api/works/${encodeURIComponent(state.work.id)}`);
      const children = data.children || [];
      const lines = data.lines || [];
      const title = parentId ? data.node.title : data.work.title;
      // 若当前节点是叶子（有句子或无子节点且已进入阅读态），优先维护句子
      if (parentId && (!children.length || lines.some((l) => l.parent_id === parentId))) {
        const direct = lines.filter((l) => l.parent_id === parentId);
        if (direct.length || !children.length) {
          await renderMaintainLines(data.node, direct.length ? direct : lines);
          return;
        }
      }
      await renderMaintainNodes(title, children, parentId);
    } catch (e) {
      panel.innerHTML = `<p class="hint">维护加载失败：${escapeHtml(e.message || e)}</p>`;
    }
  }

  async function renderMaintainWorks() {
    const works = await api("/api/works");
    panel.innerHTML = `
      <h2 class="read-title">维护 · 作品</h2>
      <p class="hint">任意对象可统一挂接「视频链接 / 备注」。删除需管理密码。</p>
      <form class="maintain-form" id="addWorkForm">
        <label>作品名 <input name="title" required placeholder="如：论语" /></label>
        <label>ID（可选） <input name="id" placeholder="lun_yu" /></label>
        <button type="submit">增加作品</button>
      </form>
      <div class="list maintain-list" id="workList"></div>
    `;
    const box = panel.querySelector("#workList");
    works.forEach((w) => {
      const row = document.createElement("div");
      row.className = "maintain-row maintain-node";
      row.innerHTML = `
        <div class="maintain-node-main">
          <button type="button" class="maintain-open">
            <strong>${escapeHtml(w.title)}</strong>
            <span class="meta">${escapeHtml(w.id)}${w.video || w.remark ? " · 有挂接" : ""}</span>
          </button>
          ${extraEditorHtml("work", w.id, w, { compact: true })}
        </div>
        <button type="button" class="danger" data-del>删除</button>
      `;
      row.querySelector(".maintain-open").addEventListener("click", async () => {
        state.work = w;
        state.path = [];
        state.chapter = null;
        state.lines = [];
        await renderMaintain();
      });
      row.querySelector("[data-del]").addEventListener("click", async () => {
        try {
          if (!(await adminDelete(`/api/admin/works/${encodeURIComponent(w.id)}`, w.title))) return;
          if (state.work?.id === w.id) {
            state.work = null;
            state.path = [];
          }
          await renderMaintain();
        } catch (e) {
          alert(e.message || e);
        }
      });
      box.appendChild(row);
    });
    bindExtraForms(box, () => renderMaintain());
    panel.querySelector("#addWorkForm").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      try {
        await api("/api/admin/works", {
          method: "POST",
          body: {
            title: String(fd.get("title") || "").trim(),
            id: String(fd.get("id") || "").trim() || null,
          },
        });
        await renderMaintain();
      } catch (e) {
        alert(e.message || e);
      }
    });
  }

  async function renderMaintainNodes(title, children, parentId) {
    panel.innerHTML = `
      <h2 class="read-title">维护 · ${escapeHtml(title)}</h2>
      <form class="maintain-form" id="addNodeForm">
        <label>章节名 <input name="title" required placeholder="如：学而篇 / 第一章" /></label>
        <label>类型
          <select name="type">
            <option value="chapter">章</option>
            <option value="book">部</option>
            <option value="part">类</option>
            <option value="section">什/国</option>
            <option value="poem">篇</option>
          </select>
        </label>
        <label class="full">视频链接（可选） <input name="video" type="url" placeholder="https://..." /></label>
        <label class="full">备注（可选） <input name="remark" placeholder="可选备注" /></label>
        <label>ID（可选） <input name="id" placeholder="自动生成" /></label>
        <button type="submit">增加章节</button>
      </form>
      <div class="list maintain-list" id="nodeList"></div>
      ${!children.length ? `<p class="hint">尚无子章节。也可进入空章后直接加句子。</p>` : ""}
    `;
    const box = panel.querySelector("#nodeList");
    children.forEach((n) => {
      const row = document.createElement("div");
      row.className = "maintain-row maintain-node";
      row.innerHTML = `
        <div class="maintain-node-main">
          <button type="button" class="maintain-open">
            <strong>${escapeHtml(n.title || n.id)}</strong>
            <span class="meta">${escapeHtml(typeLabel(n.type))}${n.video || n.remark ? " · 有挂接" : ""}</span>
          </button>
          ${extraEditorHtml("node", n.id, n, { compact: true })}
        </div>
        <button type="button" class="danger" data-del>删除</button>
      `;
      row.querySelector(".maintain-open").addEventListener("click", async () => {
        state.path = [...state.path, { id: n.id, title: n.title, type: n.type }];
        await renderMaintain();
      });
      row.querySelector("[data-del]").addEventListener("click", async () => {
        try {
          if (!(await adminDelete(`/api/admin/nodes/${encodeURIComponent(n.id)}`, n.title || n.id)))
            return;
          await renderMaintain();
        } catch (e) {
          alert(e.message || e);
        }
      });
      box.appendChild(row);
    });
    bindExtraForms(box, () => renderMaintain());
    if (parentId) {
      const jump = document.createElement("p");
      jump.className = "hint";
      jump.innerHTML = `<button type="button" class="linkish" id="editLinesHere">在此节点编辑句子</button>`;
      panel.appendChild(jump);
      panel.querySelector("#editLinesHere").addEventListener("click", async () => {
        const data = await api(`/api/nodes/${encodeURIComponent(parentId)}`);
        const direct = (data.lines || []).filter((l) => l.parent_id === parentId);
        await renderMaintainLines(data.node, direct);
      });
    }
    panel.querySelector("#addNodeForm").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      try {
        await api("/api/admin/nodes", {
          method: "POST",
          body: {
            work_id: state.work.id,
            parent_id: parentId,
            title: String(fd.get("title") || "").trim(),
            type: String(fd.get("type") || "chapter"),
            id: String(fd.get("id") || "").trim() || null,
            video: String(fd.get("video") || "").trim() || null,
            remark: String(fd.get("remark") || "").trim() || null,
          },
        });
        await renderMaintain();
      } catch (e) {
        alert(e.message || e);
      }
    });
  }

  async function renderMaintainLines(node, lines) {
    state.chapter = node;
    panel.innerHTML = `
      <h2 class="read-title">维护句子 · ${escapeHtml(node.title)}</h2>
      <div class="maintain-form">
        <div class="label">本章挂接</div>
        ${extraEditorHtml("node", node.id, node)}
      </div>
      <form class="maintain-form" id="addLineForm">
        <label class="full">句子 <input name="content" required placeholder="输入一句原文" /></label>
        <label class="full">拼音（可选） <input name="pinyin" placeholder="可选" /></label>
        <button type="submit">增加句子</button>
      </form>
      <div class="list maintain-list" id="lineList"></div>
      ${!lines.length ? `<p class="hint">尚无句子。</p>` : ""}
    `;
    bindExtraForms(panel.querySelector(".maintain-form"), async (saved) => {
      Object.assign(node, { video: saved.video, remark: saved.remark });
      state.chapter = node;
    });
    const box = panel.querySelector("#lineList");
    lines.forEach((line) => {
      const row = document.createElement("div");
      row.className = "maintain-row maintain-line";
      row.innerHTML = `
        <div class="maintain-line-body">
          <input class="line-edit" value="${escapeHtml(line.content)}" />
          <span class="meta">${escapeHtml(line.id)}</span>
          ${extraEditorHtml("line", line.id, line, { compact: true })}
        </div>
        <button type="button" data-save>保存</button>
        <button type="button" class="danger" data-del>删除</button>
      `;
      row.querySelector("[data-save]").addEventListener("click", async () => {
        const content = row.querySelector(".line-edit").value.trim();
        try {
          await api(`/api/admin/lines/${encodeURIComponent(line.id)}`, {
            method: "PATCH",
            body: { content },
          });
          const data = await api(`/api/nodes/${encodeURIComponent(node.id)}`);
          await renderMaintainLines(
            data.node,
            (data.lines || []).filter((l) => l.parent_id === node.id),
          );
        } catch (e) {
          alert(e.message || e);
        }
      });
      row.querySelector("[data-del]").addEventListener("click", async () => {
        try {
          if (!(await adminDelete(`/api/admin/lines/${encodeURIComponent(line.id)}`, line.content.slice(0, 16))))
            return;
          const data = await api(`/api/nodes/${encodeURIComponent(node.id)}`);
          await renderMaintainLines(
            data.node,
            (data.lines || []).filter((l) => l.parent_id === node.id),
          );
        } catch (e) {
          alert(e.message || e);
        }
      });
      box.appendChild(row);
    });
    bindExtraForms(box);
    panel.querySelector("#addLineForm").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      try {
        await api("/api/admin/lines", {
          method: "POST",
          body: {
            parent_id: node.id,
            content: String(fd.get("content") || "").trim(),
            pinyin: String(fd.get("pinyin") || "").trim() || null,
          },
        });
        const data = await api(`/api/nodes/${encodeURIComponent(node.id)}`);
        await renderMaintainLines(
          data.node,
          (data.lines || []).filter((l) => l.parent_id === node.id),
        );
      } catch (e) {
        alert(e.message || e);
      }
    });
  }

  async function openNode(nodeId) {
    const data = await api(`/api/nodes/${encodeURIComponent(nodeId)}`);
    const node = data.node;
    const children = data.children || [];
    const lines = data.lines || [];

    // 有子目录且非诗篇：在树中展开，不钻入扁平列表
    const browse = children.length > 0 && node.type !== "poem";
    if (browse) {
      state.chapter = null;
      state.lines = [];
      state.lineId = null;
      state.charIndex = -1;
      if (!state.path.some((p) => p.id === node.id)) {
        state.path = [...state.path, { id: node.id, title: node.title, type: node.type }];
      }
      if (node.work_id && (!state.work || state.work.id !== node.work_id)) {
        const works = await api("/api/works");
        state.work = works.find((w) => w.id === node.work_id) || { id: node.work_id, title: node.work_id };
      }
      state.treeExpanded.add(treeKey("work", state.work.id));
      state.treeExpanded.add(treeKey("node", node.id));
      state.treeChildren.set(treeKey("node", node.id), children);
      await showBrowseTree();
      return;
    }

    // 阅读：只用本节点直接挂的句子；若点到 section 却无直接句子，则取全部后代
    let readLines = lines;
    if (node.type === "poem") {
      readLines = lines.filter((l) => l.parent_id === node.id);
      if (!readLines.length) readLines = lines;
    }
    state.chapter = node;
    state.lines = readLines;
    state.lineId = readLines[0]?.id || null;
    state.charIndex = 0;
    renderCrumb();
    setMode("read");
    renderRead();
  }

  async function jumpToResult(hit) {
    stopRecite();
    if (!hit?.node || !hit?.work) return;
    state.work = hit.work;
    state.path = (hit.ancestors || []).map((a) => ({
      id: a.id,
      title: a.title,
      type: a.type,
    }));
    state.chapter = null;
    state.lines = [];
    state.lineId = null;
    state.charIndex = -1;
    await openNode(hit.node.id);
  }

  function shouldAutoJump(results) {
    if (!results.length) return false;
    const top = results[0];
    if (top.score >= 900) return true;
    if (results.length === 1 && top.score >= 500) return true;
    if (results.length >= 2 && top.score >= 800 && top.score - results[1].score >= 100) {
      return true;
    }
    return false;
  }

  function renderSearchResults(q, results) {
    renderCrumb();
    setMode("browse");
    panel.innerHTML = `
      <h2 class="read-title">查找「${escapeHtml(q)}」</h2>
      <div class="list" id="searchList"></div>
      <p class="hint">${results.length ? `共 ${results.length} 条，点选进入。` : "没有匹配结果。"}</p>
    `;
    const box = panel.querySelector("#searchList");
    results.forEach((hit) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "search-hit";
      btn.innerHTML = `
        <strong>${escapeHtml(hit.node.title)}</strong>
        <span class="meta">${escapeHtml(typeLabel(hit.node.type))}</span>
        <span class="path">${escapeHtml(hit.path_label || "")}</span>
      `;
      btn.addEventListener("click", () => {
        jumpToResult(hit).catch((e) => {
          panel.innerHTML = `<p class="hint">打开失败：${escapeHtml(e.message || e)}</p>`;
        });
      });
      box.appendChild(btn);
    });
  }

  async function runSearch() {
    const input = document.getElementById("searchInput");
    const q = (input?.value || "").trim();
    if (!q) return;
    stopRecite();
    const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
    const results = data.results || [];
    if (shouldAutoJump(results)) {
      await jumpToResult(results[0]);
      return;
    }
    renderSearchResults(q, results);
  }

  function currentLine() {
    return state.lines.find((l) => l.id === state.lineId) || state.lines[0] || null;
  }

  function renderRead() {
    applyFont();
    const title = state.chapter?.title || "";
    const video = (state.chapter?.video || "").trim();
    const remark = (state.chapter?.remark || "").trim();
    panel.innerHTML = `
      <h2 class="read-title">${escapeHtml(title)}</h2>
      ${extraDisplayHtml(state.chapter, { label: "本章" })}
      <div class="read-tools">
        <div class="read-sizebar">
          <label class="read-size-label" for="readSizeInput">字号</label>
          <input id="readSizeInput" type="number" min="${READ_SIZE_MIN}" max="${READ_SIZE_MAX}" step="2" value="${state.readSize}" />
        </div>
        <button type="button" id="reciteBtn" class="recite-btn">朗诵全文</button>
      </div>
      <div class="read-body" id="readBody"></div>
      <p class="hint">点一句进入「逐句学习」。</p>
    `;
    applyReadSize();
    panel.querySelector("#readSizeInput").addEventListener("input", (ev) => {
      state.readSize = parseReadSize(ev.target.value);
      localStorage.setItem("classical.readSize", String(state.readSize));
      applyReadSize();
    });
    panel.querySelector("#readSizeInput").addEventListener("change", (ev) => {
      state.readSize = parseReadSize(ev.target.value);
      localStorage.setItem("classical.readSize", String(state.readSize));
      applyReadSize();
    });
    const body = panel.querySelector("#readBody");
    const lineEls = new Map();
    state.lines.forEach((line) => {
      const el = document.createElement("span");
      el.className = "line";
      el.textContent = line.content;
      el.addEventListener("click", () => {
        stopRecite();
        state.lineId = line.id;
        state.charIndex = 0;
        state.interpIndex = 0;
        setMode("line");
        renderLine();
      });
      body.appendChild(el);
      lineEls.set(line.id, el);
    });

    const reciteBtn = panel.querySelector("#reciteBtn");
    const setReciteIdle = () => {
      reciteBtn.textContent = "朗诵全文";
      reciteBtn.classList.remove("playing");
      body.querySelectorAll(".line.reciting").forEach((el) => el.classList.remove("reciting"));
    };
    const setRecitePlaying = () => {
      reciteBtn.textContent = "停止";
      reciteBtn.classList.add("playing");
    };
    reciteBtn.addEventListener("click", () => {
      if (speechSynthesis.speaking) {
        stopRecite();
        setReciteIdle();
        return;
      }
      if (!state.lines.length) return;
      setRecitePlaying();
      reciteLines(state.lines, {
        onLine(line) {
          body.querySelectorAll(".line.reciting").forEach((el) => el.classList.remove("reciting"));
          const el = lineEls.get(line.id);
          if (el) {
            el.classList.add("reciting");
            el.scrollIntoView({ block: "nearest", behavior: "smooth" });
          }
        },
        onEnd: setReciteIdle,
      });
    });
  }

  let reciteGen = 0;

  function stopRecite() {
    reciteGen += 1;
    if (window.speechSynthesis) speechSynthesis.cancel();
  }

  function pickVoice(lang) {
    if (!window.speechSynthesis) return null;
    const voices = speechSynthesis.getVoices();
    if (/^en/i.test(lang)) {
      return (
        voices.find((v) => /^en(-|$)/i.test(v.lang) && /US|GB|UK|EN/i.test(v.lang)) ||
        voices.find((v) => /^en/i.test(v.lang)) ||
        null
      );
    }
    if (/^(sa|hi)/i.test(lang)) {
      return (
        voices.find((v) => /^sa/i.test(v.lang)) ||
        voices.find((v) => /^hi/i.test(v.lang)) ||
        null
      );
    }
    return (
      voices.find((v) => /^zh(-|$)/i.test(v.lang) && /CN|China|中文|普通话|国语/i.test(v.name + v.lang)) ||
      voices.find((v) => /^zh/i.test(v.lang)) ||
      null
    );
  }

  function pickZhVoice() {
    return pickVoice("zh-CN");
  }

  function makeUtterance(text, lang = "zh-CN") {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = /^en/i.test(lang) ? 0.95 : /^(sa|hi)/i.test(lang) ? 0.9 : 0.82;
    u.pitch = 1;
    const voice = pickVoice(lang);
    if (voice) u.voice = voice;
    return u;
  }

  function reciteText(text, onEnd, lang = "zh-CN") {
    if (!window.speechSynthesis) {
      alert("当前浏览器不支持朗诵。");
      return null;
    }
    const gen = ++reciteGen;
    speechSynthesis.cancel();
    const u = makeUtterance(text, lang);
    const done = () => {
      if (gen === reciteGen) onEnd?.();
    };
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
    return u;
  }

  function reciteLines(lines, { onLine, onEnd } = {}) {
    if (!window.speechSynthesis) {
      alert("当前浏览器不支持朗诵。");
      return;
    }
    const gen = ++reciteGen;
    speechSynthesis.cancel();
    let i = 0;
    const next = () => {
      if (gen !== reciteGen) return;
      if (i >= lines.length) {
        onEnd?.();
        return;
      }
      const line = lines[i++];
      onLine?.(line);
      const u = makeUtterance(line.content);
      u.onend = next;
      u.onerror = () => {
        if (gen === reciteGen) onEnd?.();
      };
      speechSynthesis.speak(u);
    };
    next();
  }

  function fillLineText(el, content, interactive) {
    Array.from(content).forEach((ch) => {
      if (interactive && /\p{Script=Han}/u.test(ch)) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = ch;
        b.style.cssText =
          "border:none;background:transparent;font:inherit;font-family:inherit;padding:0 0.02em;cursor:pointer;";
        b.addEventListener("click", () => {
          const base = currentLine()?.content || content;
          const chars = hanChars(base);
          state.charIndex = Math.max(0, chars.indexOf(ch));
          stopRecite();
          setMode("char");
          renderChar();
        });
        el.appendChild(b);
      } else {
        el.appendChild(document.createTextNode(ch));
      }
    });
  }

  async function renderLine() {
    applyFont();
    const line = currentLine();
    if (!line) {
      panel.innerHTML = `<p class="hint">没有句子。</p>`;
      return;
    }
    const idx = state.lines.findIndex((l) => l.id === line.id);
    const showKaiCompare = state.font !== "kai";

    let interpretations = line.interpretations || [];
    try {
      const detail = await api(`/api/lines/${encodeURIComponent(line.id)}`);
      if (detail.line) {
        Object.assign(line, detail.line);
        interpretations = detail.interpretations || detail.line.interpretations || [];
        line.interpretations = interpretations;
      }
    } catch (_) {
      /* 无解说时仍可阅读原文 */
    }
    if (state.interpIndex >= interpretations.length) state.interpIndex = 0;
    const interp = interpretations[state.interpIndex] || null;
    const displayText = interp?.segmentation || line.content;
    const reciteLang = interpReciteLang(interp);

    panel.innerHTML = `
      <div class="line-view">
        <div class="text" id="lineText"></div>
        ${
          showKaiCompare
            ? `<div class="kai-compare">
                <div class="label">楷体</div>
                <div class="text kai" id="lineKai"></div>
              </div>`
            : ""
        }
        <div class="pinyin">${escapeHtml(line.pinyin || "（暂无拼音）")}</div>
        ${extraDisplayHtml(line, { label: "本句" })}
        <div class="extra-inline">${extraEditorHtml("line", line.id, line, { compact: true })}</div>
        <div class="recite-row">
          <button type="button" id="reciteBtn" class="recite-btn">朗诵</button>
        </div>
        <div class="study" id="lineStudy"></div>
        <div class="navrow">
          <button type="button" id="prevLine" ${idx <= 0 ? "disabled" : ""}>上一句</button>
          <div class="progress">${idx + 1} / ${state.lines.length}</div>
          <button type="button" id="nextLine" ${idx >= state.lines.length - 1 ? "disabled" : ""}>下一句</button>
        </div>
        <p class="hint">点句中汉字进入「逐字学习」。有多种断句时可切换对照。</p>
      </div>
    `;
    fillLineText(panel.querySelector("#lineText"), displayText, true);
    if (showKaiCompare) {
      fillLineText(panel.querySelector("#lineKai"), displayText, false);
    }
    renderLineStudy(panel.querySelector("#lineStudy"), interpretations);
    bindExtraForms(panel, (saved) => {
      Object.assign(line, { video: saved.video, remark: saved.remark });
    });

    const reciteBtn = panel.querySelector("#reciteBtn");
    const setReciteIdle = () => {
      reciteBtn.textContent = "朗诵";
      reciteBtn.classList.remove("playing");
    };
    const setRecitePlaying = () => {
      reciteBtn.textContent = "停止";
      reciteBtn.classList.add("playing");
    };
    reciteBtn.addEventListener("click", () => {
      if (speechSynthesis.speaking) {
        stopRecite();
        setReciteIdle();
        return;
      }
      setRecitePlaying();
      reciteText(displayText, setReciteIdle, reciteLang);
    });
    panel.querySelector("#prevLine").addEventListener("click", () => {
      if (idx > 0) {
        stopRecite();
        state.lineId = state.lines[idx - 1].id;
        state.charIndex = 0;
        state.interpIndex = 0;
        renderLine();
      }
    });
    panel.querySelector("#nextLine").addEventListener("click", () => {
      if (idx < state.lines.length - 1) {
        stopRecite();
        state.lineId = state.lines[idx + 1].id;
        state.charIndex = 0;
        state.interpIndex = 0;
        renderLine();
      }
    });
  }

  function isForeignInterp(it) {
    const note = (it && it.note) || "";
    return note.startsWith("英文") || note.startsWith("梵文");
  }

  function isEnglishInterp(it) {
    return ((it && it.note) || "").startsWith("英文");
  }

  function isSanskritInterp(it) {
    return ((it && it.note) || "").startsWith("梵文");
  }

  function interpReciteLang(it) {
    if (isEnglishInterp(it)) return "en-US";
    if (isSanskritInterp(it)) return "hi-IN";
    return "zh-CN";
  }

  function interpTabLabel(it, index, list) {
    const note = it.note || "";
    if (note === "英文翻译" || note.startsWith("英文")) return "英文";
    if (note === "梵文翻译" || note.startsWith("梵文")) return "梵文";
    const zhIdx = list
      .map((x, i) => ({ x, i }))
      .filter(({ x }) => !isForeignInterp(x))
      .findIndex(({ i }) => i === index);
    const zhTotal = list.filter((x) => !isForeignInterp(x)).length;
    if (zhTotal <= 1 && zhIdx === 0) return "断句";
    if (zhIdx >= 0) return `断句 ${zhIdx + 1}`;
    return `断句 ${index + 1}`;
  }

  function renderLineStudy(box, interpretations) {
    if (!box) return;
    if (!interpretations.length) {
      box.innerHTML = `<p class="study-empty">暂无断句解说。</p>`;
      return;
    }
    const tabs = interpretations
      .map((it, i) => {
        const label = interpTabLabel(it, i, interpretations);
        return `<button type="button" class="interp-tab${i === state.interpIndex ? " active" : ""}" data-interp="${i}">${escapeHtml(label)}</button>`;
      })
      .join("");
    const interp = interpretations[state.interpIndex];
    const en = isEnglishInterp(interp);
    const sa = isSanskritInterp(interp);
    const foreign = en || sa;
    const segClass = en ? " seg-en" : sa ? " seg-sa" : "";
    const segLabel = en ? "英文" : sa ? "梵文" : "断句";
    const termsHtml = (interp.terms || [])
      .map(
        (t) => `
      <div class="term">
        <div class="term-text">${escapeHtml(t.text)}</div>
        <div class="term-body">
          <div class="term-expl">${escapeHtml(t.explanation || "")}</div>
          ${t.note ? `<div class="term-note">${escapeHtml(t.note)}</div>` : ""}
          ${extraDisplayHtml(t, { label: "词" })}
          <div class="extra-inline">${extraEditorHtml("term", t.id, t, { compact: true })}</div>
        </div>
      </div>`,
      )
      .join("");
    box.innerHTML = `
      <div class="interp-tabs">${tabs}</div>
      <div class="segmentation">
        <div class="label">${segLabel}</div>
        <div class="seg-text${segClass}">${escapeHtml(interp.segmentation || "")}</div>
        ${extraDisplayHtml(interp, { label: "断句" })}
        <div class="extra-inline">${extraEditorHtml("interpretation", interp.id, interp, { compact: true })}</div>
      </div>
      ${
        !foreign && termsHtml
          ? `<div class="terms">
              <div class="label">词解</div>
              ${termsHtml}
            </div>`
          : ""
      }
      ${
        !foreign && interp.explanation
          ? `<div class="sent-expl">
              <div class="label">句解</div>
              <p>${escapeHtml(interp.explanation)}</p>
              ${interp.note ? `<p class="term-note">${escapeHtml(interp.note)}</p>` : ""}
            </div>`
          : ""
      }
      ${
        en
          ? `<p class="term-note">英文为按句意译，便于对照阅读。</p>`
          : sa
            ? `<p class="term-note">梵文为天城体意译，便于对照阅读。</p>`
            : ""
      }
    `;
    box.querySelectorAll("[data-interp]").forEach((b) => {
      b.addEventListener("click", () => {
        state.interpIndex = Number(b.dataset.interp);
        renderLine();
      });
    });
    bindExtraForms(box, () => renderLine());
  }

  function renderChar() {
    applyFont();
    const line = currentLine();
    if (!line) return;
    const chars = hanChars(line.content);
    if (!chars.length) {
      panel.innerHTML = `<p class="hint">此句无汉字。</p>`;
      return;
    }
    if (state.charIndex < 0 || state.charIndex >= chars.length) state.charIndex = 0;
    const ch = chars[state.charIndex];
    const code = `U+${ch.codePointAt(0).toString(16).toUpperCase()}`;
    panel.innerHTML = `
      <div class="char-focus">
        <div class="big" id="charBig" title="查看字元结构">${escapeHtml(ch)}</div>
        <div class="code">${escapeHtml(ch)} · ${code}</div>
      </div>
      <div class="char-grid" id="charGrid"></div>
      <div class="navrow">
        <button type="button" id="prevChar" ${state.charIndex <= 0 ? "disabled" : ""}>上一字</button>
        <div class="progress">${state.charIndex + 1} / ${chars.length}</div>
        <button type="button" id="nextChar" ${state.charIndex >= chars.length - 1 ? "disabled" : ""}>下一字</button>
      </div>
      <p class="hint">点大字或句中单字查看字元结构。当前句：${escapeHtml(line.content)}</p>
    `;
    const openGlyph = (c) => {
      if (window.GlyphUI) GlyphUI.open(c);
    };
    panel.querySelector("#charBig").addEventListener("click", () => openGlyph(ch));
    const grid = panel.querySelector("#charGrid");
    chars.forEach((c, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = c;
      if (i === state.charIndex) b.classList.add("active");
      b.addEventListener("click", () => {
        state.charIndex = i;
        renderChar();
        if (window.GlyphUI) GlyphUI.open(c);
      });
      grid.appendChild(b);
    });
    panel.querySelector("#prevChar").addEventListener("click", () => {
      if (state.charIndex > 0) {
        state.charIndex -= 1;
        renderChar();
      }
    });
    panel.querySelector("#nextChar").addEventListener("click", () => {
      if (state.charIndex < chars.length - 1) {
        state.charIndex += 1;
        renderChar();
      }
    });
  }

  modes.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-mode]");
    if (!b || b.disabled) return;
    const mode = b.dataset.mode;
    stopRecite();
    setMode(mode);
    if (mode === "browse") {
      state.chapter = null;
      state.lines = [];
      state.lineId = null;
      state.charIndex = -1;
      showBrowseTree();
    } else if (mode === "read") renderRead();
    else if (mode === "line") renderLine();
    else if (mode === "char") renderChar();
      });

  if (window.speechSynthesis) {
    speechSynthesis.getVoices();
    speechSynthesis.addEventListener("voiceschanged", () => {
      speechSynthesis.getVoices();
    });
  }

  fontbar.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-font]");
    if (!b) return;
    state.font = b.dataset.font;
    applyFont();
    if (state.mode === "line") renderLine();
    else if (state.mode === "char") renderChar();
  });

  const searchInput = document.getElementById("searchInput");
  const searchBtn = document.getElementById("searchBtn");
  searchBtn.addEventListener("click", () => {
    runSearch().catch((e) => {
      panel.innerHTML = `<p class="hint">查找失败：${escapeHtml(e.message || e)}</p>`;
    });
  });
  searchInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      runSearch().catch((e) => {
        panel.innerHTML = `<p class="hint">查找失败：${escapeHtml(e.message || e)}</p>`;
      });
    }
  });

  applyFont();
  applyReadSize();
  if (window.GlyphUI) {
    GlyphUI.init({ baseUrl: window.GLYPH_DATA_BASE || "/glyph-data/" });
  }
  setMode("browse");
  showWorks().catch((e) => {
    panel.innerHTML = `<p class="hint">加载失败：${escapeHtml(e.message || e)}</p>`;
  });
})();
