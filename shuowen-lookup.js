/**
 * 静态说文解字检索（依赖 docs/shuowen.json）。
 */
(() => {
  let dataPromise = null;
  let data = null;
  let baseUrl = "./";

  function dataUrl(name) {
    const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    return base + name;
  }

  async function ensureData() {
    if (data) return data;
    if (!dataPromise) {
      dataPromise = fetch(dataUrl("shuowen.json"), { cache: "force-cache" })
        .then(async (r) => {
          if (!r.ok) throw new Error("无法加载 shuowen.json");
          return r.json();
        })
        .then((j) => {
          const byId = new Map();
          (j.entries || []).forEach((e) => byId.set(e.id, e));
          data = {
            source: j.source || "shuowenjiezi/shuowen",
            sourceUrl: j.sourceUrl || "https://github.com/shuowenjiezi/shuowen",
            viewBase: j.viewBase || "https://www.shuowen.org/view/",
            index: j.index || {},
            byId,
          };
          return data;
        })
        .catch((err) => {
          dataPromise = null;
          throw err;
        });
    }
    return dataPromise;
  }

  function firstChar(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    return [...s][0] || "";
  }

  async function lookup(char) {
    const inp = firstChar(char);
    const out = {
      input: inp,
      found: false,
      entries: [],
      source: "shuowenjiezi/shuowen",
      sourceUrl: "https://github.com/shuowenjiezi/shuowen",
      dbExists: false,
    };
    if (!inp) return out;
    const db = await ensureData();
    out.source = db.source;
    out.sourceUrl = db.sourceUrl;
    out.dbExists = true;
    const ids = db.index[inp] || [];
    const seen = new Set();
    const entries = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const e = db.byId.get(id);
      if (!e) continue;
      entries.push({
        ...e,
        url: `${db.viewBase}${e.id}`,
      });
    }
    out.entries = entries;
    out.found = entries.length > 0;
    return out;
  }

  function init(opts = {}) {
    if (opts.baseUrl) baseUrl = opts.baseUrl;
    return { lookup, ensureData };
  }

  window.ShuowenLookup = { init, lookup, ensureData };
})();
