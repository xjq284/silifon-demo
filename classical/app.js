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
  };

  const FONT_CSS = {
    kai: "var(--kai)",
    silifon: "var(--silifon)",
    silifon1: "var(--silifon1)",
    seal: "var(--seal)",
  };

  const panel = document.getElementById("panel");
  const crumb = document.getElementById("crumb");
  const modes = document.getElementById("modes");
  const fontbar = document.getElementById("fontbar");

  let corpus = null;

  async function loadCorpus() {
    if (corpus) return corpus;
    const r = await fetch("./data/corpus.json", { cache: "default" });
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

  async function api(path) {
    await loadCorpus();
    const [pathname, query = ""] = path.split("?");
    const params = new URLSearchParams(query);

    if (pathname === "/api/works") {
      return corpus.works.map(({ id, title, sort, meta_json }) => ({
        id, title, sort, meta_json,
      }));
    }

    let m = pathname.match(/^\/api\/works\/(.+)$/);
    if (m) {
      const workId = decodeURIComponent(m[1]);
      const work = workById(workId);
      if (!work) throw new Error("work not found");
      const children = (work.root_ids || []).map((id) => nodeById(id)).filter(Boolean);
      return {
        work: { id: work.id, title: work.title, sort: work.sort, meta_json: work.meta_json },
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
        if (b.dataset.go === "works") {
          state.work = null;
          state.path = [];
          state.chapter = null;
          state.lines = [];
          state.lineId = null;
          state.charIndex = -1;
          setMode("browse");
          showWorks();
        } else if (b.dataset.go === "work") {
          state.path = [];
          state.chapter = null;
          state.lines = [];
          state.lineId = null;
          state.charIndex = -1;
          setMode("browse");
          showWork(state.work.id);
        } else if (b.dataset.go === "path") {
          const idx = Number(b.dataset.idx);
          const node = state.path[idx];
          state.path = state.path.slice(0, idx);
          state.chapter = null;
          state.lines = [];
          state.lineId = null;
          state.charIndex = -1;
          setMode("browse");
          openNode(node.id);
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

  function renderNodeList(title, nodes, { emptyHint } = {}) {
    panel.innerHTML = `
      <h2 class="read-title">${escapeHtml(title)}</h2>
      <div class="list" id="nodeList"></div>
      ${emptyHint ? `<p class="hint">${escapeHtml(emptyHint)}</p>` : ""}
    `;
    const box = panel.querySelector("#nodeList");
    nodes.forEach((n) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.innerHTML = `<strong>${escapeHtml(n.title || n.id)}</strong><span class="meta">${escapeHtml(typeLabel(n.type))}</span>`;
      btn.addEventListener("click", () => openNode(n.id));
      box.appendChild(btn);
    });
  }

  async function showWorks() {
    renderCrumb();
    const works = await api("/api/works");
    panel.innerHTML = `
      <h2 class="read-title">选择作品</h2>
      <div class="list" id="workList"></div>
      <p class="hint">《道德经》《诗经》《三字经》《千字文》《百家姓》· 硅体字形由 SILIFON 字体提供。</p>
    `;
    const box = panel.querySelector("#workList");
    works.forEach((w) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.innerHTML = `<strong>${escapeHtml(w.title)}</strong><span class="meta">${escapeHtml(w.id)}</span>`;
      btn.addEventListener("click", () => showWork(w.id));
      box.appendChild(btn);
    });
  }

  async function showWork(workId) {
    const data = await api(`/api/works/${encodeURIComponent(workId)}`);
    state.work = data.work;
    state.path = [];
    state.chapter = null;
    state.lines = [];
    state.lineId = null;
    renderCrumb();
    setMode("browse");
    renderNodeList(data.work.title, data.children);
  }

  async function openNode(nodeId) {
    const data = await api(`/api/nodes/${encodeURIComponent(nodeId)}`);
    const node = data.node;
    const children = data.children || [];
    const lines = data.lines || [];

    // 有子目录且非诗篇：继续浏览；诗篇或叶子：进入阅读
    const browse = children.length > 0 && node.type !== "poem";
    if (browse) {
      state.chapter = null;
      state.lines = [];
      state.lineId = null;
      state.charIndex = -1;
      state.path = [...state.path, { id: node.id, title: node.title, type: node.type }];
      renderCrumb();
      setMode("browse");
      renderNodeList(node.title, children);
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
    panel.innerHTML = `
      <h2 class="read-title">${escapeHtml(title)}</h2>
      <div class="recite-row">
        <button type="button" id="reciteBtn" class="recite-btn">朗诵全文</button>
      </div>
      <div class="read-body" id="readBody"></div>
      <p class="hint">点一句进入「逐句学习」。</p>
    `;
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

  function pickZhVoice() {
    if (!window.speechSynthesis) return null;
    const voices = speechSynthesis.getVoices();
    return (
      voices.find((v) => /^zh(-|$)/i.test(v.lang) && /CN|China|中文|普通话|国语/i.test(v.name + v.lang)) ||
      voices.find((v) => /^zh/i.test(v.lang)) ||
      null
    );
  }

  function makeUtterance(text) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    u.rate = 0.82;
    u.pitch = 1;
    const voice = pickZhVoice();
    if (voice) u.voice = voice;
    return u;
  }

  function reciteText(text, onEnd) {
    if (!window.speechSynthesis) {
      alert("当前浏览器不支持朗诵。");
      return null;
    }
    const gen = ++reciteGen;
    speechSynthesis.cancel();
    const u = makeUtterance(text);
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
    const reciteLang = isEnglishInterp(interp) ? "en-US" : "zh-CN";

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

  function interpTabLabel(it, index, list) {
    const note = it.note || "";
    if (note === "英文翻译" || note.startsWith("英文")) return "英文";
    const zhIdx = list
      .map((x, i) => ({ x, i }))
      .filter(({ x }) => !((x.note || "").startsWith("英文")))
      .findIndex(({ i }) => i === index);
    const zhTotal = list.filter((x) => !((x.note || "").startsWith("英文"))).length;
    if (zhTotal <= 1 && zhIdx === 0) return "断句";
    if (zhIdx >= 0) return `断句 ${zhIdx + 1}`;
    return `断句 ${index + 1}`;
  }

  function isEnglishInterp(it) {
    return ((it && it.note) || "").startsWith("英文");
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
    const termsHtml = (interp.terms || [])
      .map(
        (t) => `
      <div class="term">
        <div class="term-text">${escapeHtml(t.text)}</div>
        <div class="term-body">
          <div class="term-expl">${escapeHtml(t.explanation || "")}</div>
          ${t.note ? `<div class="term-note">${escapeHtml(t.note)}</div>` : ""}
        </div>
      </div>`,
      )
      .join("");
    box.innerHTML = `
      <div class="interp-tabs">${tabs}</div>
      <div class="segmentation">
        <div class="label">${en ? "英文" : "断句"}</div>
        <div class="seg-text${en ? " seg-en" : ""}">${escapeHtml(interp.segmentation || "")}</div>
      </div>
      ${
        !en && termsHtml
          ? `<div class="terms">
              <div class="label">词解</div>
              ${termsHtml}
            </div>`
          : ""
      }
      ${
        !en && interp.explanation
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
          : ""
      }
    `;
    box.querySelectorAll("[data-interp]").forEach((b) => {
      b.addEventListener("click", () => {
        state.interpIndex = Number(b.dataset.interp);
        renderLine();
      });
    });
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
        <div class="big">${escapeHtml(ch)}</div>
        <div class="code">${escapeHtml(ch)} · ${code}</div>
      </div>
      <div class="char-grid" id="charGrid"></div>
      <div class="navrow">
        <button type="button" id="prevChar" ${state.charIndex <= 0 ? "disabled" : ""}>上一字</button>
        <div class="progress">${state.charIndex + 1} / ${chars.length}</div>
        <button type="button" id="nextChar" ${state.charIndex >= chars.length - 1 ? "disabled" : ""}>下一字</button>
      </div>
      <p class="hint">当前句：${escapeHtml(line.content)}</p>
    `;
    const grid = panel.querySelector("#charGrid");
    chars.forEach((c, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = c;
      if (i === state.charIndex) b.classList.add("active");
      b.addEventListener("click", () => {
        state.charIndex = i;
        renderChar();
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
      if (state.path.length) {
        const last = state.path[state.path.length - 1];
        state.path = state.path.slice(0, -1);
        openNode(last.id);
      } else if (state.work) showWork(state.work.id);
      else showWorks();
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
  setMode("browse");
  showWorks().catch((e) => {
    panel.innerHTML = `<p class="hint">加载失败：${escapeHtml(e.message || e)}</p>`;
  });
})();
