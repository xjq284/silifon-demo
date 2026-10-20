/**
 * Classical TTS：优先本地 /api/tts（edge-tts 神经语音），
 * 静态站回退百度翻译 TTS，再回退浏览器 speechSynthesis。
 */
(() => {
  const VOICE_BY_LANG = {
    "zh-CN": "zh-CN-YunxiNeural",
    "zh": "zh-CN-YunxiNeural",
    "en-US": "en-US-JennyNeural",
    "en": "en-US-JennyNeural",
    "hi-IN": "hi-IN-SwaraNeural",
    "hi": "hi-IN-SwaraNeural",
    "sa": "hi-IN-SwaraNeural",
  };

  let modePromise = null;
  let mode = null; // "edge-api" | "baidu" | "webspeech"
  let currentAudio = null;
  let gen = 0;

  function baiduLan(lang) {
    if (/^en/i.test(lang)) return "en";
    if (/^(hi|sa)/i.test(lang)) return "en";
    return "zh";
  }

  function chunkText(text, maxLen) {
    const s = String(text || "").trim();
    if (!s) return [];
    if (s.length <= maxLen) return [s];
    const parts = [];
    let buf = "";
    const pieces = s.split(/(?<=[。！？；.!?;\n])/);
    for (const p of pieces) {
      if (!p) continue;
      if ((buf + p).length > maxLen && buf) {
        parts.push(buf);
        buf = p;
      } else {
        buf += p;
      }
    }
    if (buf) parts.push(buf);
    // hard-split leftovers still too long
    const out = [];
    for (const p of parts) {
      if (p.length <= maxLen) out.push(p);
      else {
        for (let i = 0; i < p.length; i += maxLen) out.push(p.slice(i, i + maxLen));
      }
    }
    return out;
  }

  function playUrl(url, myGen) {
    return new Promise((resolve, reject) => {
      if (myGen !== gen) {
        resolve("stopped");
        return;
      }
      const audio = new Audio();
      currentAudio = audio;
      audio.preload = "auto";
      const done = (status) => {
        if (currentAudio === audio) currentAudio = null;
        audio.onended = null;
        audio.onerror = null;
        resolve(status);
      };
      audio.onended = () => done("ended");
      audio.onerror = () => done("error");
      audio.src = url;
      const p = audio.play();
      if (p && typeof p.catch === "function") {
        p.catch((err) => reject(err));
      }
    });
  }

  async function probeEdgeApi() {
    try {
      const r = await fetch("/api/tts?text=%E6%B5%8B&lang=zh-CN", {
        cache: "no-store",
      });
      if (!r.ok) return false;
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("audio")) return false;
      // drain body so connection closes cleanly
      await r.arrayBuffer();
      return true;
    } catch {
      return false;
    }
  }

  async function ensureMode() {
    if (mode) return mode;
    if (!modePromise) {
      modePromise = (async () => {
        if (await probeEdgeApi()) return "edge-api";
        // 百度 TTS 在多数浏览器可直接作 Audio 源；失败再网页语音
        return "baidu";
      })().then((m) => {
        mode = m;
        return m;
      });
    }
    return modePromise;
  }

  function cancelPlayback() {
    if (currentAudio) {
      try {
        currentAudio.pause();
        currentAudio.removeAttribute("src");
        currentAudio.load();
      } catch {
        /* ignore */
      }
      currentAudio = null;
    }
    if (window.speechSynthesis) speechSynthesis.cancel();
  }

  function stop() {
    gen += 1;
    cancelPlayback();
  }

  function pickVoice(lang) {
    if (!window.speechSynthesis) return null;
    const voices = speechSynthesis.getVoices();
    const score = (v) => {
      let s = 0;
      const blob = `${v.name} ${v.lang}`;
      if (/neural|natural|premium|enhanced|online|google|microsoft|siri|tingting|xiao/i.test(blob))
        s += 50;
      if (/^en/i.test(lang) && /^en/i.test(v.lang)) s += 20;
      else if (/^(hi|sa)/i.test(lang) && /^(hi|sa)/i.test(v.lang)) s += 20;
      else if (/^zh/i.test(lang) && /^zh/i.test(v.lang)) s += 20;
      if (/CN|China|普通话|国语|Chinese/i.test(blob) && /^zh/i.test(lang)) s += 10;
      if (v.localService === false) s += 5;
      return s;
    };
    const ranked = voices.slice().sort((a, b) => score(b) - score(a));
    if (/^en/i.test(lang)) return ranked.find((v) => /^en/i.test(v.lang)) || null;
    if (/^(hi|sa)/i.test(lang))
      return ranked.find((v) => /^(hi|sa)/i.test(v.lang)) || ranked.find((v) => /^en/i.test(v.lang)) || null;
    return ranked.find((v) => /^zh/i.test(v.lang)) || null;
  }

  function speakWeb(text, lang, myGen) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) {
        resolve("unsupported");
        return;
      }
      if (myGen !== gen) {
        resolve("stopped");
        return;
      }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = /^en/i.test(lang) ? 0.95 : /^(sa|hi)/i.test(lang) ? 0.9 : 0.85;
      u.pitch = 1;
      const voice = pickVoice(lang);
      if (voice) u.voice = voice;
      u.onend = () => resolve(myGen === gen ? "ended" : "stopped");
      u.onerror = () => resolve("error");
      speechSynthesis.speak(u);
    });
  }

  async function speakEdgeApi(text, lang, myGen) {
    const voice = VOICE_BY_LANG[lang] || VOICE_BY_LANG["zh-CN"];
    const url =
      `/api/tts?text=${encodeURIComponent(text)}` +
      `&lang=${encodeURIComponent(lang)}` +
      `&voice=${encodeURIComponent(voice)}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`tts ${r.status}`);
    const blob = await r.blob();
    if (myGen !== gen) return "stopped";
    const obj = URL.createObjectURL(blob);
    try {
      return await playUrl(obj, myGen);
    } finally {
      URL.revokeObjectURL(obj);
    }
  }

  async function speakBaidu(text, lang, myGen) {
    const lan = baiduLan(lang);
    const chunks = chunkText(text, 180);
    for (const chunk of chunks) {
      if (myGen !== gen) return "stopped";
      const url =
        `https://fanyi.baidu.com/gettts?lan=${encodeURIComponent(lan)}` +
        `&text=${encodeURIComponent(chunk)}&spd=4&source=web`;
      const status = await playUrl(url, myGen);
      if (status === "error") throw new Error("baidu tts error");
      if (status === "stopped") return "stopped";
    }
    return "ended";
  }

  async function speak(text, lang = "zh-CN") {
    const t = String(text || "").trim();
    if (!t) return "empty";
    const myGen = gen;
    const m = await ensureMode();
    try {
      if (m === "edge-api") return await speakEdgeApi(t, lang, myGen);
      if (m === "baidu") return await speakBaidu(t, lang, myGen);
    } catch (err) {
      console.warn("tts engine failed, fallback to webspeech", err);
      mode = "webspeech";
    }
    return speakWeb(t, lang, myGen);
  }

  async function speakQueue(texts, { lang = "zh-CN", onItem, onEnd } = {}) {
    const myGen = ++gen;
    cancelPlayback();
    try {
      for (let i = 0; i < texts.length; i++) {
        if (gen !== myGen) return;
        const item = texts[i];
        const text = typeof item === "string" ? item : item.text;
        const itemLang = typeof item === "string" ? lang : item.lang || lang;
        onItem?.(item, i);
        const status = await speak(text, itemLang);
        if (status === "stopped" || gen !== myGen) return;
      }
    } finally {
      if (gen === myGen) onEnd?.();
    }
  }

  window.ClassicalTTS = {
    stop,
    speak,
    speakQueue,
    ensureMode,
    get mode() {
      return mode;
    },
    bump() {
      return ++gen;
    },
    get gen() {
      return gen;
    },
  };

  // warm voice list for webspeech fallback
  if (window.speechSynthesis) {
    speechSynthesis.getVoices();
    speechSynthesis.addEventListener("voiceschanged", () => speechSynthesis.getVoices());
  }
})();
