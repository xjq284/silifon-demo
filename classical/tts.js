/**
 * Classical TTS：优先本地 /api/tts（edge-tts 神经语音），
 * 静态站回退百度翻译 TTS，再回退浏览器 speechSynthesis。
 */
(() => {
  const VOICE_BY_LANG = {
    "zh-CN": "zh-CN-YunxiNeural",
    zh: "zh-CN-YunxiNeural",
    "en-US": "en-US-JennyNeural",
    en: "en-US-JennyNeural",
    "hi-IN": "hi-IN-SwaraNeural",
    hi: "hi-IN-SwaraNeural",
    sa: "hi-IN-SwaraNeural",
  };

  // 极短静音 wav，用于在用户点击手势内解锁 Audio.play()
  const SILENT_WAV =
    "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

  let mode = null; // "edge-api" | "baidu" | "webspeech"
  let audioUnlocked = false;
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
    const out = [];
    for (const p of parts) {
      if (p.length <= maxLen) out.push(p);
      else {
        for (let i = 0; i < p.length; i += maxLen) out.push(p.slice(i, i + maxLen));
      }
    }
    return out;
  }

  /** 必须在用户点击的同步调用栈里执行，否则后续 Audio.play 会被浏览器拦住。 */
  function unlockAudio() {
    if (audioUnlocked) return;
    try {
      const a = new Audio(SILENT_WAV);
      a.volume = 0.01;
      const p = a.play();
      audioUnlocked = true;
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {
      /* ignore */
    }
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
      const r = await fetch(`/api/tts?text=${encodeURIComponent("测")}&lang=zh-CN`, {
        cache: "no-store",
      });
      if (!r.ok) return false;
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("audio")) return false;
      const buf = await r.arrayBuffer();
      return buf.byteLength > 100;
    } catch {
      return false;
    }
  }

  async function ensureMode() {
    // 每次朗诵都再探一次本地 API，避免启动时探测失败后永远卡在回退引擎
    if (await probeEdgeApi()) {
      mode = "edge-api";
      return mode;
    }
    if (mode === "edge-api") mode = null;
    if (!mode) mode = "baidu";
    return mode;
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
      return (
        ranked.find((v) => /^(hi|sa)/i.test(v.lang)) ||
        ranked.find((v) => /^en/i.test(v.lang)) ||
        null
      );
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
    if (blob.size < 100) throw new Error("tts empty audio");
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
      if (m === "edge-api") {
        const st = await speakEdgeApi(t, lang, myGen);
        console.info("[ClassicalTTS] engine=edge-api");
        return st;
      }
      if (m === "baidu") {
        const st = await speakBaidu(t, lang, myGen);
        console.info("[ClassicalTTS] engine=baidu");
        return st;
      }
    } catch (err) {
      console.warn("[ClassicalTTS] engine failed, fallback to webspeech", err);
      if (m === "edge-api") mode = null;
      else mode = "webspeech";
    }
    console.info("[ClassicalTTS] engine=webspeech");
    return speakWeb(t, lang, myGen);
  }

  async function speakQueue(texts, { lang = "zh-CN", onItem, onEnd } = {}) {
    // 关键：在点击同步阶段解锁音频，避免 await 后被自动播放策略拦截
    unlockAudio();
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
    unlockAudio,
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

  if (window.speechSynthesis) {
    speechSynthesis.getVoices();
    speechSynthesis.addEventListener("voiceschanged", () => speechSynthesis.getVoices());
  }
})();
