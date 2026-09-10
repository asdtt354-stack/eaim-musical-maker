/* ═══════════════════════════════════════════════════════════
   EAIM 프로덕션 — 미디어 생성 애드온 (production-media.js)
   뮤지컬메이커에 "그림 만들기 / 노래 만들기" 버튼을 추가합니다.
   · 그림: Gemini 3.1 Flash Image (Nano Banana), 16:9 배경 1K
   · 노래: Lyria 3 Clip(30초) / Lyria 3 Pro(전체 곡)
   · 같은 Gemini API 키(settings.apiKey) 사용
   · 결과물은 Firebase Storage에 저장 → 없으면 브라우저에서만 재생/다운로드
   설치: index.html 의 </body> 바로 앞에
         <script src="production-media.js"></script>
         그리고 <head> 에 firebase-storage-compat.js 추가 (안내 문서 참고)
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── 모델 (2026-09 기준 문서 확인) ─────────────────────────
  const MODELS = {
    image:   'gemini-3.1-flash-lite-image', // 가장 저렴·빠름, 1K 고정
    imageHQ: 'gemini-3.1-flash-image',      // 고품질 (텍스트 렌더링 등)
    clip:    'lyria-3-clip-preview',        // 30초 미리듣기
    song:    'lyria-3-pro-preview',         // 전체 곡 (2분 내외)
  };
  const API = 'https://generativelanguage.googleapis.com/v1beta/models/';

  // ── 스타일 (본체 CSS 변수 재사용) ───────────────────────────
  const css = document.createElement('style');
  css.textContent = `
  .pm-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center}
  .pm-btn{padding:6px 12px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:.78rem;font-weight:700;
    border:1px solid rgba(124,58,237,.35);background:rgba(124,58,237,.08);color:#7c3aed;transition:all .2s}
  .pm-btn:hover{background:rgba(124,58,237,.16)}
  .pm-btn:disabled{opacity:.45;cursor:wait}
  .pm-btn.music{border-color:rgba(199,120,221,.45);background:rgba(199,120,221,.1);color:#a83fb0}
  .pm-btn.quiet{border-color:rgba(45,36,56,.15);background:#fff;color:#5a4f70;font-weight:600}
  .pm-status{font-size:.72rem;color:#5a4f70;flex-basis:100%}
  .pm-status.err{color:#c0392b}
  .pm-preview{margin-top:8px;display:none}
  .pm-preview.show{display:block}
  .pm-preview img{width:100%;border-radius:8px;border:1px solid rgba(124,58,237,.15);display:block;background:#f3ecff}
  .pm-preview audio{width:100%;margin-top:4px}
  .pm-lyric{font-size:.72rem;color:#5a4f70;white-space:pre-wrap;line-height:1.6;margin-top:6px;max-height:120px;overflow:auto;
    background:#faf8ff;border-radius:6px;padding:8px}
  .pm-local{font-size:.68rem;color:#b26a00;margin-top:4px}
  .pm-bar{height:4px;border-radius:2px;background:rgba(124,58,237,.12);overflow:hidden;flex-basis:100%;display:none}
  .pm-bar.show{display:block}
  .pm-bar i{display:block;height:100%;width:30%;background:linear-gradient(90deg,#7c3aed,#c778dd);animation:pmSlide 1.2s infinite}
  @keyframes pmSlide{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}
  @media(prefers-reduced-motion:reduce){.pm-bar i{animation:none;width:100%}}
  `;
  document.head.appendChild(css);

  // ── 공용 유틸 ───────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const toast = (m) => (typeof showToast === 'function' ? showToast(m) : console.log(m));
  const key = () => ((typeof settings !== 'undefined' && settings.apiKey) || '').trim();
  const mediaOn = () => (typeof settings === 'undefined' ? true : settings.mediaOn !== false);
  const limitOf = (k) => (typeof settings === 'undefined' ? 0 : (Number(settings[k]) || 0)); // 0 = 무제한
  const isStudent = () => (typeof isStudentMode !== 'undefined' && isStudentMode);

  function todayKey() {
    const d = new Date(); const s = typeof stuName === 'string' ? stuName : 'x';
    return `pm_use_${d.getFullYear()}${d.getMonth() + 1}${d.getDate()}_${s}`;
  }
  function usage() { try { return JSON.parse(localStorage.getItem(todayKey()) || '{}'); } catch { return {}; } }
  function bump(kind) { const u = usage(); u[kind] = (u[kind] || 0) + 1; localStorage.setItem(todayKey(), JSON.stringify(u)); }
  function checkLimit(kind) {
    if (!isStudent()) return true;
    const lim = limitOf(kind === 'image' ? 'imgLimit' : 'songLimit');
    if (!lim) return true;
    const used = usage()[kind] || 0;
    if (used >= lim) { toast(`오늘 ${kind === 'image' ? '그림' : '노래'} 생성 한도(${lim}회)를 다 썼어요`); return false; }
    return true;
  }

  async function b64ToBlob(b64, mime) { return (await fetch(`data:${mime};base64,${b64}`)).blob(); }

  /* ═══ MR 만들기: 만든 노래에서 보컬 빼기 (가운데 소리 상쇄 + 중역 살짝 깎기) ═══ */
  let AC = null;
  const audioCtx = () => (AC = AC || new (window.AudioContext || window.webkitAudioContext)());
  async function makeMR(blob, { amount = 1, keepBass = true } = {}) {
    const ctx = audioCtx();
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const off = new OfflineAudioContext(2, buf.length, buf.sampleRate);
    const src = off.createBufferSource(); src.buffer = buf;
    const out = off.createGain();
    if (buf.numberOfChannels < 2) {
      // 모노는 좌우 차이가 없어 상쇄가 안 됨 → 보컬 대역만 살짝 눌러줌
      const notch = off.createBiquadFilter(); notch.type = 'peaking'; notch.frequency.value = 1200; notch.Q.value = .7; notch.gain.value = -10 * amount;
      src.connect(notch); notch.connect(out);
    } else {
      const sp = off.createChannelSplitter(2), mg = off.createChannelMerger(2);
      const inv = off.createGain(); inv.gain.value = -1;
      const side = off.createGain(); side.gain.value = amount;      // L−R (가운데 제거)
      const mid = off.createGain(); mid.gain.value = 1 - amount;    // 원본 살짝 남기기
      src.connect(sp); sp.connect(side, 0); sp.connect(inv, 1); inv.connect(side);
      src.connect(mid);
      let node = side;
      if (keepBass) { // 베이스·킥은 가운데에 있어 같이 지워지므로 저역만 원본에서 되살림
        const low = off.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 180;
        const lowG = off.createGain(); lowG.gain.value = .9 * amount;
        src.connect(low); low.connect(lowG); lowG.connect(out);
      }
      node.connect(mg, 0, 0); node.connect(mg, 0, 1); mg.connect(out); mid.connect(out);
    }
    out.connect(off.destination); src.start();
    const rendered = await off.startRendering();
    return bufferToWavBlob(rendered);
  }
  function bufferToWavBlob(buf) {
    const ch = Math.min(2, buf.numberOfChannels), len = buf.length, rate = buf.sampleRate;
    const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
    const wr = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
    wr(0, 'RIFF'); data.setUint32(4, 36 + len * ch * 2, true); wr(8, 'WAVEfmt ');
    data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true);
    data.setUint32(24, rate, true); data.setUint32(28, rate * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true);
    wr(36, 'data'); data.setUint32(40, len * ch * 2, true);
    const chans = []; for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
    let off = 44; for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, chans[c][i])); data.setInt16(off, v < 0 ? v * 32768 : v * 32767, true); off += 2; }
    return new Blob([data.buffer], { type: 'audio/wav' });
  }

  // ── 이 기기 보관함 (IndexedDB) — Storage 없이도 슬라이드쇼·믹서가 같은 기기에서 꺼내 씀 ──
  const IDB = {
    db: null,
    open() { return new Promise((res, rej) => { if (this.db) return res(this.db); const r = indexedDB.open('eaim-media', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('media', { keyPath: 'key' });
      r.onsuccess = () => { this.db = r.result; res(this.db); }; r.onerror = () => rej(r.error); }); },
    async put(rec) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('media', 'readwrite'); t.objectStore('media').put(rec); t.oncomplete = res; t.onerror = () => rej(t.error); }); },
    async get(key) { const db = await this.open(); return new Promise((res, rej) => { const r = db.transaction('media').objectStore('media').get(key); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); }); },
  };
  const workKey = () => ((typeof currentWorkId === 'string' && currentWorkId) || 'draft');

  // ── 대본 생성 지시문: Suno 프롬프트 → Lyria(제미나이)용 노래 스타일 지시문으로 바꿔 보냄 ──
  const LYRIA_SPEC = '영문 노래 스타일 지시문 40단어 이내: 장르, 주요 악기, 보컬(성별·음색·솔로/듀엣/합창), 분위기, 빠르기 BPM. 예: warm acoustic pop ballad, piano and strings, female alto solo, hopeful, 88 BPM. 실제 가수 이름이나 기존 곡 제목은 쓰지 말 것';
  if (typeof window.callGemini === 'function') {
    const orig = window.callGemini;
    window.callGemini = function (prompt, ...rest) {
      if (typeof prompt === 'string' && /Suno/.test(prompt)) {
        prompt = prompt
          .replace(/영문 Suno\(emotional finale,\s*50단어이내\)/g, LYRIA_SPEC + ' (감동적인 피날레, 전체 합창)')
          .replace(/영문 Suno 프롬프트\(50단어이내\)/g, LYRIA_SPEC)
          .replace(/영문 Suno\(50단어이내\)/g, LYRIA_SPEC);
      }
      return orig.call(this, prompt, ...rest);
    };
  }
  // 화면 글자에 남은 "Suno" 표기 정리
  const RENAMES = [['🎵 Suno & 이미지 프롬프트 완성', '🎵 노래 스타일 & 배경 설계 완성'], ['Suno 프롬프트', '노래 스타일'], ['Suno', '노래 스타일']];
  function renameText(root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) { if (n.nodeValue.includes('Suno')) { let v = n.nodeValue; RENAMES.forEach(([a, b]) => { v = v.split(a).join(b); }); n.nodeValue = v; } }
  }
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(nd => { if (nd.nodeType === 1) renameText(nd); else if (nd.nodeType === 3 && nd.nodeValue.includes('Suno')) renameText(nd.parentNode); })))
    .observe(document.body, { childList: true, subtree: true });

  // ── 줄 서기 + 재시도 (한 기기에서 동시 요청 방지, 429/503이면 기다렸다 다시) ──
  let chain = Promise.resolve();
  const queued = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };
  async function withRetry(doFetch, onWait) {
    const delays = [3000, 6000, 12000, 20000];
    for (let i = 0; ; i++) {
      const r = await doFetch();
      if (r.ok) return r;
      if ((r.status === 429 || r.status === 503 || r.status === 500) && i < delays.length) {
        const ra = Number(r.headers.get('retry-after')) * 1000; const wait = ra > 0 ? Math.min(ra, 40000) : delays[i];
        onWait && onWait(Math.round(wait / 1000), i + 1); await new Promise(res => setTimeout(res, wait)); continue;
      }
      return r;
    }
  }

  // ── Gemini 미디어 호출 (이미지·음악 공용) ───────────────────
  async function geminiMedia(model, parts, generationConfig, onWait) {
    const k = key();
    if (!k) throw new Error('API 키가 설정되지 않았어요. 선생님께 문의하세요.');
    const body = { contents: [{ parts }] };
    if (generationConfig) body.generationConfig = generationConfig;
    return queued(async () => {
    const res = await withRetry(() => fetch(API + model + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': k },
      body: JSON.stringify(body),
    }), onWait);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      const msg = res.status === 429 ? '지금 요청이 몰려 있어요. 1분쯤 뒤에 다시 눌러주세요 (모둠별로 순서대로 누르면 좋아요).' : (e?.error?.message || `오류 ${res.status}`);
      const err = new Error(msg); err.status = res.status; throw err;
    }
    const data = await res.json();
    const ps = data.candidates?.[0]?.content?.parts || [];
    const inline = ps.filter(p => p.inlineData && !p.thought).pop();
    const text = ps.filter(p => p.text && !p.thought).map(p => p.text).join('\n').trim();
    if (!inline) {
      const reason = data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || '';
      throw new Error('결과에 미디어가 없어요' + (reason ? ` (${reason})` : '') + '. 프롬프트를 조금 바꿔서 다시 해보세요.');
    }
    return { mime: inline.inlineData.mimeType, b64: inline.inlineData.data, text };
    });
  }

  async function genImage(prompt, hq, onWait) {
    const p = [{ text: prompt.replace(/--ar\s*[\d:]+/g, '').trim() + ' No text or letters in the image.' }];
    const model = hq ? MODELS.imageHQ : MODELS.image;
    // responseFormat(신규) → imageConfig(구형) → 없이 순서로 시도
    const cfgs = [
      { responseModalities: ['IMAGE'], responseFormat: { image: { aspectRatio: '16:9' } } },
      { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9' } },
      { responseModalities: ['IMAGE'] },
    ];
    let last;
    for (const cfg of cfgs) {
      try { return await geminiMedia(model, p, cfg, onWait); }
      catch (e) { last = e; if (e.status !== 400) throw e; }
    }
    throw last;
  }

  /* 배경음악(연주곡): 보컬 없이, 대사 위에 깔리게, 반복 가능하게 */
  const MOOD_EN = { '기쁨':'warm and bright','신남':'lively and upbeat','설렘':'gentle and hopeful','평온':'calm and still','슬픔':'wistful and tender','외로움':'lonely and sparse','화남':'tense and driving','무서움':'dark and suspenseful','신비':'mysterious and floating','뿌듯':'proud and rising' };
  function bgmPrompt(kind, ctx) {
    const base = 'Instrumental only, absolutely no vocals, no singing, no lyrics, no vocal chops. Soft background underscore that sits under spoken dialogue: gentle dynamics, simple repeating harmony, no sudden loud hits, seamless loop feel.';
    const inst = ctx.inst || 'soft piano with light strings and warm pad';
    const mood = ctx.mood || 'gentle';
    const bpm = ctx.bpm || 76;
    const K = {
      scene:  `Background music for a scene of a Korean middle-school musical. Mood: ${mood}. ${inst}. About ${bpm} BPM.`,
      intro:  `Opening prelude before a school musical begins — the audience is settling in, curtain about to rise. Mood: ${mood}, expectant. ${inst}. About ${bpm} BPM.`,
      transition: `Short transition music between two acts of a school musical — a bridge that carries the mood from one scene to the next. Mood: ${mood}. ${inst}. About ${bpm} BPM.`,
      ending: `Closing music after the curtain call of a school musical — warm, satisfied, letting the audience go home. Mood: ${mood}, tender. ${inst}. About ${bpm} BPM.`,
    };
    const head = K[kind] || K.scene;
    return `${head}\n\n${base}${ctx.story ? `\n\nScene: ${ctx.story}` : ''}`;
  }
  async function genBgm(kind, ctx, onWait) {
    return geminiMedia(MODELS.clip, [{ text: bgmPrompt(kind, ctx) }], undefined, onWait);
  }

  async function genMusic(stylePrompt, lyrics, full, onWait) {
    const model = full ? MODELS.song : MODELS.clip;
    let text = (stylePrompt || 'A musical theatre number').trim();
    text += full ? '. A full song about 2 minutes long with verse and chorus.' : '. A 30-second clip.';
    text += ' Sing in Korean.';
    if (lyrics && lyrics.trim()) text += '\n\nLyrics:\n' + lyrics.trim();
    return geminiMedia(model, [{ text }], undefined, onWait);
  }

  // ── Firebase Storage 업로드 (없으면 null) ───────────────────
  async function upload(blob, path) {
    try {
      if (!(window.firebase && firebase.storage)) return null;
      const ref = firebase.storage().ref().child(path);
      await ref.put(blob, { contentType: blob.type });
      return await ref.getDownloadURL();
    } catch (e) { console.warn('Storage 업로드 실패 → 브라우저에만 보관', e); return null; }
  }
  function mediaPath(id, ext) {
    const t = typeof teacherUid === 'string' ? teacherUid : 'unknown';
    const w = (typeof currentWorkId === 'string' && currentWorkId) || 'draft';
    return `teachers/${t}/media/${w}/${id}_${Date.now()}.${ext}`;
  }

  // ── 결과 기록 ───────────────────────────────────────────────
  const localUrls = {}; // Storage 실패 시 세션 한정 object URL
  function record(id, field, url, extra) {
    if (typeof generatedData === 'undefined' || !generatedData) return;
    generatedData.media = generatedData.media || {};
    generatedData.media[id] = { ...(generatedData.media[id] || {}), [field]: url, ...(extra || {}) };
    try { if (typeof LS !== 'undefined') LS.set(DRAFT_KEY, generatedData); } catch {}
    try {
      if (url && !url.startsWith('blob:') && typeof currentWorkId === 'string' && currentWorkId && typeof worksColRef === 'function') {
        worksColRef(teacherUid).doc(currentWorkId).set({ media: generatedData.media }, { merge: true }).catch(() => {});
      }
    } catch {}
  }

  const SCENE_KO = (id) => id === 'opening' ? '오프닝' : id === 'curtain' ? '커튼콜' : id === 'rsong' ? '낭독극' : (/^scene-(\d+)$/.test(id) ? (Number(id.slice(6)) + 1) + '막' : id);
  function sceneCtx(id, sc) {
    sc = sc || {};
    const style = (sc.sunoPrompt || '').toLowerCase();
    const bpmM = style.match(/(\d{2,3})\s*bpm/);
    const slow = /ballad|slow|gentle|tender|sad/.test(style), fast = /dance|upbeat|fast|energetic|driving/.test(style);
    return {
      mood: sc.emotion ? (MOOD_EN[sc.emotion] || sc.emotion) : (slow ? 'tender and calm' : fast ? 'bright and moving' : 'gentle'),
      bpm: bpmM ? Number(bpmM[1]) : (slow ? 68 : fast ? 100 : 80),
      inst: /rock|band|guitar/.test(style) ? 'clean electric guitar, soft bass and brushed drums' : /synth|electronic|dance/.test(style) ? 'warm synth pad and soft arpeggio' : 'soft piano with light strings and warm pad',
      story: (sc.sceneTitle || '') + (sc.script ? ' — ' + String(sc.script).replace(/\n/g, ' ').slice(0, 160) : ''),
    };
  }

  // ── 장면 id ↔ 데이터 ────────────────────────────────────────
  function sceneOf(id) {
    const d = typeof generatedData !== 'undefined' ? generatedData : null; if (!d) return {};
    if (id === 'opening') return d.opening || {};
    if (id === 'curtain') return d.curtain || {};
    if (id === 'rsong') return d.song || {};
    const m = id.match(/^scene-(\d+)$/); if (m) return (d.scenes || [])[+m[1]] || {};
    return {};
  }
  function lyricsBox(id) { return $(id === 'rsong' ? 'rsong-lyrics' : `lyrics-${id}`); }

  // ── UI 주입 ─────────────────────────────────────────────────
  function inject() {
    if (typeof generatedData === 'undefined' || !generatedData) return;
    const media = generatedData.media || {};
    document.querySelectorAll('textarea.prompt-text').forEach((ta) => {
      if (ta.dataset.pm) return;
      let kind, id;
      if (/^bg-/.test(ta.id)) { kind = 'image'; id = ta.id.slice(3); }
      else if (ta.id === 'rsong-bg') { kind = 'image'; id = 'rsong'; }
      else if (/^suno-/.test(ta.id)) { kind = 'music'; id = ta.id.slice(5); }
      else if (ta.id === 'rsong-suno') { kind = 'music'; id = 'rsong'; }
      else return;
      ta.dataset.pm = '1';
      const box = ta.closest('.prompt-box') || ta.parentElement;
      const wrap = document.createElement('div');
      wrap.className = 'pm-wrap';
      const prev = `pm-prev-${kind}-${id}`;
      if (kind === 'image') {
        wrap.innerHTML = `
          <div class="pm-row">
            <button class="pm-btn" data-act="img">🎨 그림 만들기</button>
            <button class="pm-btn quiet" data-act="imghq" title="글자·세부 묘사가 중요할 때">고품질</button>
            <div class="pm-bar"><i></i></div>
            <div class="pm-status"></div>
          </div>
          <div class="pm-preview" id="${prev}"></div>`;
      } else {
        wrap.innerHTML = `
          <div class="pm-row">
            <button class="pm-btn music" data-act="clip">🎵 30초 들어보기</button>
            <button class="pm-btn music" data-act="song">🎼 전체 곡 만들기</button>
            <button class="pm-btn" data-act="bgm" title="가사·보컬 없이 대사 아래 깔리는 연주곡">🎻 배경음악 (연주곡)</button>
            <div class="pm-bar"><i></i></div>
            <div class="pm-status"></div>
          </div>
          <div class="pm-preview" id="${prev}"></div>
          <div class="pm-bgm" style="display:none;margin-top:6px"></div>`;
      }
      box.appendChild(wrap);
      if (kind === 'music') { // 화면 이름: Suno → 노래 스타일
        const lbl = box.querySelector('.prompt-label');
        if (lbl && lbl.firstChild && lbl.firstChild.nodeType === 3) lbl.firstChild.textContent = '🎵 노래 스타일 (Gemini가 이 느낌으로 불러요) ';
        ta.placeholder = '예: warm acoustic pop ballad, female alto, soft piano, 90 BPM';
      }
      if (!mediaOn()) { wrap.querySelectorAll('.pm-btn').forEach(b => { b.disabled = true; b.title = '선생님이 미디어 생성을 꺼두었어요'; }); }
      wrap.querySelectorAll('.pm-btn').forEach(b => b.addEventListener('click', () => run(b.dataset.act, id, ta, wrap)));
      // 이전 결과 복원 (원격 URL → 세션 URL → 이 기기 보관함 순서)
      const m = media[id] || {};
      if (kind === 'image') {
        if (m.imageUrl || localUrls[id + ':image']) showImage(wrap, m.imageUrl || localUrls[id + ':image'], !m.imageUrl);
        else if (m.imageLocal) IDB.get(m.imageLocal).then(r => { if (r && r.blob) { localUrls[id + ':image'] = URL.createObjectURL(r.blob); showImage(wrap, localUrls[id + ':image'], true); } }).catch(() => {});
      }
      if (kind === 'music') {
        if (m.audioUrl || localUrls[id + ':music']) showAudio(wrap, m.audioUrl || localUrls[id + ':music'], m.audioLyrics, !m.audioUrl, id);
        else if (m.audioLocal) IDB.get(m.audioLocal).then(r => { if (r && r.blob) { localUrls[id + ':music'] = URL.createObjectURL(r.blob); showAudio(wrap, localUrls[id + ':music'], m.audioLyrics, true, id); } }).catch(() => {});
      }
    });
  }

  function showImage(wrap, url, isLocal) {
    const p = wrap.querySelector('.pm-preview');
    p.innerHTML = `<img src="${url}" alt="생성된 배경 그림">
      <div class="pm-row">
        <a class="pm-btn quiet" href="${url}" download="eaim_bg.png" ${isLocal ? '' : 'target="_blank"'}>⬇ 그림 저장</a>
        ${isLocal ? '' : `<button class="pm-btn quiet" data-copy="${url}">🔗 링크 복사</button>`}
      </div>
      ${isLocal ? '<div class="pm-local">이 기기에 보관됐어요 (같은 기기의 슬라이드쇼·믹서에서 바로 써요). 다른 기기로 옮기려면 "그림 저장"으로 내려받으세요.</div>' : ''}`;
    p.classList.add('show');
    const c = p.querySelector('[data-copy]'); if (c) c.onclick = () => navigator.clipboard.writeText(c.dataset.copy).then(() => toast('✅ 링크 복사됨'));
  }
  function showAudio(wrap, url, lyrics, isLocal, id) {
    const p = wrap.querySelector('.pm-preview');
    p.innerHTML = `<audio controls src="${url}"></audio>
      <div class="pm-row">
        <a class="pm-btn quiet" href="${url}" download="eaim_song.mp3" ${isLocal ? '' : 'target="_blank"'}>⬇ 노래 저장</a>
        <button class="pm-btn" data-mr="${id || ''}">🎤 MR 만들기 (보컬 빼기)</button>
        ${isLocal ? '' : `<button class="pm-btn quiet" data-copy="${url}">🔗 믹서용 링크 복사</button>`}
      </div>
      <div class="pm-mr" style="display:none;margin-top:6px"></div>
      ${lyrics ? `<div class="pm-lyric">${lyrics.replace(/</g, '&lt;')}</div>` : ''}
      ${isLocal ? '<div class="pm-local">이 기기에 보관됐어요 (같은 기기의 슬라이드쇼·믹서에서 바로 써요). 다른 기기로 옮기려면 "노래 저장"으로 내려받으세요.</div>' : ''}`;
    p.classList.add('show');
    const c = p.querySelector('[data-copy]'); if (c) c.onclick = () => navigator.clipboard.writeText(c.dataset.copy).then(() => toast('✅ 링크 복사됨 — 오디오 믹서의 "오디오 URL 입력"에 붙여넣으세요'));
    const mr = p.querySelector('[data-mr]'); if (mr) mr.onclick = () => buildMR(wrap, url, mr.dataset.mr, mr);
  }

  /* MR 만들기 실행 */
  async function buildMR(wrap, url, id, btn) {
    const box = wrap.querySelector('.pm-mr'); box.style.display = 'block';
    box.innerHTML = '<div class="pm-status">🎤 보컬을 빼는 중…</div>'; btn.disabled = true;
    try {
      const blob = await (await fetch(url)).blob();
      const mrBlob = await makeMR(blob, { amount: 1 });
      const remote = await upload(mrBlob, mediaPath((id || 'song') + '_mr', 'wav'));
      const mrUrl = remote || URL.createObjectURL(mrBlob);
      if (id) { localUrls[id + ':mr'] = mrUrl; try { await IDB.put({ key: `${workKey()}|mr|${id}`, kind: 'audio', id: id + '_mr', blob: mrBlob, work: workKey(), title: (generatedData && generatedData.title) || '', song: (sceneOf(id).songTitle || '') + ' (MR)', ts: Date.now() }); } catch {} 
        record(id, 'mrUrl', remote ? remote : null, { mrLocal: `${workKey()}|mr|${id}` }); }
      box.innerHTML = `<div class="pm-status">🎤 MR (보컬 뺀 반주) — 이 위에서 직접 불러보세요</div>
        <audio controls src="${mrUrl}" style="width:100%"></audio>
        <div class="pm-row"><a class="pm-btn quiet" href="${mrUrl}" download="eaim_mr.wav" ${remote ? 'target="_blank"' : ''}>⬇ MR 저장</a>
        <span class="pm-status">오디오 믹서 "🎭 뮤지컬메이커 노래" 목록에도 들어가요</span></div>
        <div class="pm-local">가운데 소리를 지우는 방식이라 잔향이 조금 남을 수 있어요. 베이스·드럼은 살려 두었습니다.</div>`;
    } catch (e) { box.innerHTML = `<div class="pm-status err">❌ ${e.message}</div>`; }
    finally { btn.disabled = false; }
  }

  function setBusy(wrap, on, msg, isErr) {
    wrap.querySelectorAll('.pm-btn').forEach(b => { if (mediaOn()) b.disabled = on; });
    wrap.querySelector('.pm-bar').classList.toggle('show', on);
    const s = wrap.querySelector('.pm-status'); s.textContent = msg || ''; s.classList.toggle('err', !!isErr);
  }

  async function run(act, id, ta, wrap) {
    const kind = (act === 'img' || act === 'imghq') ? 'image' : 'music';
    if (!checkLimit(kind)) return;
    try {
      if (kind === 'image') {
        setBusy(wrap, true, '배경 그림을 그리고 있어요 (10~30초)…');
        const r = await genImage(ta.value, act === 'imghq', (sec, n) => setBusy(wrap, true, `⏳ 요청이 몰려서 ${sec}초 기다렸다 다시 보내요 (${n}번째)…`));
        const blob = await b64ToBlob(r.b64, r.mime);
        const remote = await upload(blob, mediaPath(id, 'png'));
        const url = remote || URL.createObjectURL(blob);
        if (!remote) localUrls[id + ':image'] = url;
        const lk = `${workKey()}|image|${id}`;
        await IDB.put({ key: lk, kind: 'image', id, blob, work: workKey(), title: (generatedData && generatedData.title) || '', song: sceneOf(id).songTitle || '', ts: Date.now() }).catch(() => {});
        record(id, 'imageUrl', remote ? remote : null, { imageLocal: lk });
        showImage(wrap, url, !remote);
        bump('image'); setBusy(wrap, false, remote ? '✅ 저장됨' : '✅ 완성 (이 기기에 보관)');
      } else if (act === 'bgm') {
        const sc = sceneOf(id);
        const box = wrap.querySelector('.pm-bgm'); box.style.display = 'block';
        setBusy(wrap, true, '배경음악(연주곡)을 만들고 있어요 (30초~1분)…');
        const r = await genBgm('scene', sceneCtx(id, sc), (sec, n) => setBusy(wrap, true, `⏳ 요청이 몰려서 ${sec}초 기다렸다 다시 보내요 (${n}번째)…`));
        const blob = await b64ToBlob(r.b64, r.mime || 'audio/mpeg');
        const remote = await upload(blob, mediaPath(id + '_bgm', 'mp3'));
        const url = remote || URL.createObjectURL(blob);
        const lk = `${workKey()}|bgm|${id}`;
        await IDB.put({ key: lk, kind: 'audio', id: id + '_bgm', blob, work: workKey(), title: (generatedData && generatedData.title) || '', song: (sc.songTitle || SCENE_KO(id)) + ' 배경음악', ts: Date.now() }).catch(() => {});
        record(id, 'bgmUrl', remote ? remote : null, { bgmLocal: lk });
        box.innerHTML = `<div class="pm-status">🎻 배경음악 — 대사 장면에 깔아 보세요</div>
          <audio controls src="${url}" style="width:100%"></audio>
          <div class="pm-row"><a class="pm-btn quiet" href="${url}" download="eaim_bgm.mp3" ${remote ? 'target="_blank"' : ''}>⬇ 저장</a>
          <span class="pm-status">오디오 믹서 목록에 "${SCENE_KO(id)} BGM"으로 들어가요</span></div>`;
        bump('music'); setBusy(wrap, false, '✅ 배경음악 완성');
      } else {
        const full = act === 'song';
        setBusy(wrap, true, full ? '전체 곡을 만들고 있어요 (1~3분 걸려요)…' : '30초 미리듣기를 만들고 있어요 (30초~1분)…');
        const lb = lyricsBox(id);
        const r = await genMusic(ta.value, lb ? lb.value : sceneOf(id).lyrics, full, (sec, n) => setBusy(wrap, true, `⏳ 노래 요청이 몰려서 ${sec}초 기다렸다 다시 보내요 (${n}번째)…`));
        const blob = await b64ToBlob(r.b64, r.mime || 'audio/mpeg');
        const remote = await upload(blob, mediaPath(id, 'mp3'));
        const url = remote || URL.createObjectURL(blob);
        if (!remote) localUrls[id + ':music'] = url;
        const lk = `${workKey()}|audio|${id}`;
        await IDB.put({ key: lk, kind: 'audio', id, blob, work: workKey(), title: (generatedData && generatedData.title) || '', song: sceneOf(id).songTitle || '', full, ts: Date.now() }).catch(() => {});
        record(id, 'audioUrl', remote ? remote : null, { audioLyrics: r.text || '', audioFull: full, audioLocal: lk });
        showAudio(wrap, url, r.text, !remote, id);
        bump('music'); setBusy(wrap, false, remote ? '✅ 저장됨' : '✅ 완성 (이 기기에 보관)');
      }
    } catch (e) {
      console.error(e);
      setBusy(wrap, false, '❌ ' + e.message, true);
    }
  }

  // ── 본체 함수 후킹 ──────────────────────────────────────────
  function hook(name, after) {
    const orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function () { const r = orig.apply(this, arguments); try { after.apply(this, arguments); } catch (e) { console.warn(e); } return r; };
  }

  /* ═══ 공연 음악: 인트로(전주) · 막간 전환 · 커튼콜 후(엔딩) ═══ */
  const STAGE = [
    { k: 'intro', n: '🎬 인트로 (전주)', d: '공연 시작 전, 관객이 자리에 앉는 동안' },
    { k: 'transition', n: '↔️ 막간 전환', d: '막과 막 사이를 이어 주는 짧은 음악' },
    { k: 'ending', n: '🌙 커튼콜 후 (엔딩)', d: '인사가 끝나고 관객이 돌아갈 때' },
  ];
  function injectStage() {
    if (typeof generatedData === 'undefined' || !generatedData) return;
    if (document.getElementById('pm-stage')) return;
    const first = document.querySelector('.scene-card'); if (!first) return;
    const card = document.createElement('div');
    card.className = 'card'; card.id = 'pm-stage'; card.style.marginBottom = '14px';
    card.innerHTML = `<div class="card-title" style="margin-bottom:6px">🎻 공연 음악 (연주곡)</div>
      <div style="font-size:.78rem;color:var(--sub);line-height:1.7;margin-bottom:10px">노래(넘버)와 달리 <b>가사·보컬 없이</b> 흐르는 음악이에요. 만들면 오디오 믹서 목록과 슬라이드쇼로 함께 넘어가요.</div>
      ${STAGE.map(x => `<div class="pm-stage-row" data-k="${x.k}" style="border-top:1px solid var(--border);padding:10px 0">
        <div class="pm-row"><b style="font-size:.9rem">${x.n}</b><span class="pm-status" style="flex-basis:auto">${x.d}</span></div>
        <div class="pm-row"><button class="pm-btn" data-stage="${x.k}">🎻 만들기</button><div class="pm-bar"><i></i></div><div class="pm-status"></div></div>
        <div class="pm-out"></div></div>`).join('')}`;
    first.parentNode.insertBefore(card, first);
    if (!mediaOn()) card.querySelectorAll('.pm-btn').forEach(b => { b.disabled = true; b.title = '선생님이 미디어 생성을 꺼두었어요'; });
    card.querySelectorAll('[data-stage]').forEach(b => b.addEventListener('click', () => runStage(b.dataset.stage, b.closest('.pm-stage-row'))));
    // 이전 결과 복원
    const media = generatedData.media || {};
    STAGE.forEach(x => { const m = media['stage_' + x.k] || {}; const row = card.querySelector(`.pm-stage-row[data-k="${x.k}"]`);
      if (m.bgmUrl) showStage(row, m.bgmUrl, x, false);
      else if (m.bgmLocal) IDB.get(m.bgmLocal).then(r => { if (r && r.blob) showStage(row, URL.createObjectURL(r.blob), x, true); }).catch(() => {}); });
  }
  function showStage(row, url, x, isLocal) {
    row.querySelector('.pm-out').innerHTML = `<audio controls src="${url}" style="width:100%;margin-top:6px"></audio>
      <div class="pm-row"><a class="pm-btn quiet" href="${url}" download="eaim_${x.k}.mp3" ${isLocal ? '' : 'target="_blank"'}>⬇ 저장</a></div>`;
  }
  async function runStage(kind, row) {
    if (!checkLimit('music')) return;
    const bar = row.querySelector('.pm-bar'), st = row.querySelector('.pm-status:last-of-type') || row.querySelectorAll('.pm-status')[1];
    const btn = row.querySelector('[data-stage]');
    btn.disabled = true; bar.classList.add('show'); st.textContent = '만들고 있어요 (30초~1분)…';
    try {
      const d = generatedData || {};
      const scenes = d.scenes || [];
      const base = kind === 'intro' ? (d.opening || scenes[0] || {}) : kind === 'ending' ? (d.curtain || scenes[scenes.length - 1] || {}) : (scenes[Math.floor(scenes.length / 2)] || {});
      const ctx = sceneCtx(kind, base);
      ctx.story = (d.title ? `"${d.title}" — ` : '') + (d.synopsis ? String(d.synopsis).slice(0, 150) : ctx.story);
      const r = await genBgm(kind, ctx, (sec, n) => { st.textContent = `⏳ 요청이 몰려서 ${sec}초 기다렸다 다시 보내요 (${n}번째)…`; });
      const blob = await b64ToBlob(r.b64, r.mime || 'audio/mpeg');
      const id = 'stage_' + kind;
      const remote = await upload(blob, mediaPath(id, 'mp3'));
      const url = remote || URL.createObjectURL(blob);
      const lk = `${workKey()}|bgm|${id}`;
      await IDB.put({ key: lk, kind: 'audio', id, blob, work: workKey(), title: d.title || '', song: STAGE.find(x => x.k === kind).n.replace(/^\S+\s/, ''), ts: Date.now() }).catch(() => {});
      record(id, 'bgmUrl', remote ? remote : null, { bgmLocal: lk });
      showStage(row, url, STAGE.find(x => x.k === kind), !remote);
      bump('music'); st.textContent = '✅ 완성 — 믹서 목록에도 들어갔어요';
    } catch (e) { st.textContent = '❌ ' + e.message; }
    finally { btn.disabled = false; bar.classList.remove('show'); }
  }

  // 결과 화면이 그려질 때마다 버튼 주입
  hook('renderResult', () => setTimeout(() => { inject(); injectStage(); }, 0));
  hook('renderReadingResult', () => setTimeout(() => { inject(); injectStage(); }, 0));

  // TXT/Word 내보내기의 [Suno] 표기 → [노래 스타일], 만든 노래·그림 링크도 함께
  ['buildFullText', 'buildReadingFullText'].forEach(fn => {
    const orig = window[fn]; if (typeof orig !== 'function') return;
    window[fn] = function (d) {
      let t = orig.apply(this, arguments).replace(/\[Suno\]/g, '[노래 스타일]');
      const media = (d && d.media) || {};
      const lines = Object.entries(media).flatMap(([id, m]) => [
        m.audioUrl ? `  ${id}: 노래 ${m.audioUrl}` : null, m.imageUrl ? `  ${id}: 배경 ${m.imageUrl}` : null]).filter(Boolean);
      if (lines.length) t += `\n\n【 만든 미디어 】\n${'─'.repeat(36)}\n${lines.join('\n')}`;
      return t;
    };
  });

  // 슬라이드쇼로 보낼 때 그림·노래 URL 동봉
  hook('launchSlideshow', () => {
    try {
      const raw = localStorage.getItem('eaim_musical_data'); if (!raw) return;
      const data = JSON.parse(raw); const media = (generatedData && generatedData.media) || {};
      (data.scenes || []).forEach((s, i) => {
        const id = s.type === 'opening' ? 'opening' : `scene-${i - 1}`;
        const m = media[id] || {};
        if (m.imageUrl) s.imageUrl = m.imageUrl;
        if (m.audioUrl) s.audioUrl = m.audioUrl;
        if (m.imageLocal) s.imageLocal = m.imageLocal;
        if (m.audioLocal) s.audioLocal = m.audioLocal;
        if (m.mrUrl) s.mrUrl = m.mrUrl;
        if (m.bgmUrl) s.bgmUrl = m.bgmUrl;
        if (m.bgmLocal) s.bgmLocal = m.bgmLocal;
        if (m.mrLocal) s.mrLocal = m.mrLocal;
      });
      if (media.curtain?.imageUrl) data.curtainImageUrl = media.curtain.imageUrl;
      if (media.curtain?.audioUrl) data.curtainAudioUrl = media.curtain.audioUrl;
      if (media.curtain?.imageLocal) data.curtainImageLocal = media.curtain.imageLocal;
      if (media.curtain?.audioLocal) data.curtainAudioLocal = media.curtain.audioLocal;
      ['intro','transition','ending'].forEach(k => { const m = media['stage_' + k] || {}; if (m.bgmUrl) data['stage_' + k + 'Url'] = m.bgmUrl; if (m.bgmLocal) data['stage_' + k + 'Local'] = m.bgmLocal; });
      localStorage.setItem('eaim_musical_data', JSON.stringify(data));
    } catch (e) { console.warn(e); }
  });

  // 교사 대시보드 설정 탭에 미디어 카드 추가
  hook('renderDashContent', () => {
    if (typeof dashTab === 'undefined' || dashTab !== 'settings') return;
    const el = $('dash-content'); if (!el || $('pm-teacher-card')) return;
    const on = mediaOn(), il = limitOf('imgLimit'), sl = limitOf('songLimit');
    const card = document.createElement('div');
    card.className = 'card'; card.id = 'pm-teacher-card';
    card.innerHTML = `
      <div class="card-title">🎨 그림·노래 생성 (프로덕션)</div>
      <div class="toggle-row">
        <div><div style="font-weight:700;font-size:.95rem">${on ? '학생 미디어 생성 켜짐' : '학생 미디어 생성 꺼짐'}</div>
          <div style="font-size:.72rem;color:var(--sub);margin-top:3px">같은 Gemini 키로 배경 그림(Nano Banana)과 노래(Lyria 3)를 만들어요</div></div>
        <div class="toggle-track ${on ? 'on' : ''}" id="pm-toggle"><div class="toggle-thumb"></div></div>
      </div>
      <div class="row2" style="margin-top:12px">
        <div><div class="field-label">학생 1인 하루 그림 한도 (0 = 무제한)</div>
          <input class="t-input" type="number" min="0" id="pm-img-limit" value="${il}"></div>
        <div><div class="field-label">학생 1인 하루 노래 한도 (0 = 무제한)</div>
          <input class="t-input" type="number" min="0" id="pm-song-limit" value="${sl}"></div>
      </div>
      <div style="font-size:.72rem;color:var(--sub);line-height:1.7">
        전체 곡 1개는 30초 클립보다 훨씬 비싸요. 처음엔 그림 5 · 노래 2 정도로 시작해보세요.<br>
        한도는 학생 기기 기준으로 세어요(브라우저를 바꾸면 초기화). 결과물 저장은 Firebase Storage가 켜져 있어야 해요.
      </div>`;
    el.appendChild(card);
    $('pm-toggle').onclick = () => { setSettings(teacherUid, { mediaOn: !on }); renderDashContent(); };
    $('pm-img-limit').oninput = (e) => setSettings(teacherUid, { imgLimit: Number(e.target.value) || 0 });
    $('pm-song-limit').oninput = (e) => setSettings(teacherUid, { songLimit: Number(e.target.value) || 0 });
  });

  /* ═══ 이전에 만든 대본 이어서 하기 ═══
     maker.html 은 대본을 mm_draft 에 저장하지만 다시 열 때 복원하지 않는다.
     프로덕션 2·3번(노래·그림)으로 들어오면 대본이 사라진 것처럼 보이므로, 입력 화면 위에 이어서 하기 띠를 띄운다. */
  function draftPeek() { try { const d = JSON.parse(localStorage.getItem('mm_draft') || 'null'); return (d && d.title) ? d : null; } catch { return null; } }
  function injectResume() {
    const main = document.getElementById('student-main'); if (!main) return;
    if (document.querySelector('.scene-card')) return;            // 이미 결과 화면
    if (document.getElementById('pm-resume')) return;
    const d = draftPeek(); if (!d) return;
    const bar = document.createElement('div');
    bar.id = 'pm-resume';
    bar.style.cssText = 'background:#f3ecff;border:1.5px solid rgba(124,58,237,.35);border-radius:14px;padding:12px 16px;margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap';
    const n = (d.scenes || []).length;
    bar.innerHTML = `<div style="flex:1;min-width:200px;font-size:.9rem;line-height:1.6">
        📝 이전에 만든 대본 <b>"${(d.title || '').replace(/</g, '&lt;')}"</b>${n ? ` · ${n}막` : ''}이 있어요.
        <div style="font-size:.76rem;color:#5a4f70">이어서 하면 넘버 노래·배경 그림·배경음악을 그 대본에 이어서 만들 수 있어요.</div></div>
      <button id="pm-resume-go" style="padding:9px 16px;border-radius:9px;border:0;background:linear-gradient(135deg,#d4a843,#e8a020);font-weight:700;cursor:pointer;font-family:inherit">이어서 하기 →</button>
      <button id="pm-resume-new" style="padding:9px 14px;border-radius:9px;border:1px solid rgba(124,58,237,.3);background:#fff;cursor:pointer;font-family:inherit;font-size:.85rem">새로 만들기</button>`;
    main.insertBefore(bar, main.firstChild);
    document.getElementById('pm-resume-go').onclick = () => resumeDraft(d);
    document.getElementById('pm-resume-new').onclick = () => { bar.remove(); };
  }
  function resumeDraft(d) {
    try {
      generatedData = d;
      if (typeof performanceType !== 'undefined') performanceType = d.performanceType || 'general';
      if (typeof actCount !== 'undefined' && (d.scenes || []).length) actCount = d.scenes.length;
      if (typeof castCount !== 'undefined' && (d.characters || []).length) castCount = d.characters.length;
      if (d.performanceType === 'reading' && typeof renderReadingResult === 'function') renderReadingResult();
      else renderResult();
      setTimeout(() => { inject(); injectStage(); }, 0);
      toast('📝 이전 대본을 불러왔어요');
    } catch (e) { alert('불러오기 실패: ' + e.message); }
  }
  hook('renderStudentInput', () => setTimeout(injectResume, 0));
  hook('renderStudent', () => setTimeout(injectResume, 0));
  setTimeout(injectResume, 400);

  // 이미 결과 화면이 떠 있으면 바로 주입
  if (document.querySelector('textarea.prompt-text')) { inject(); injectStage(); }

  window.EAIM_MEDIA = { genImage, genMusic, genBgm, MODELS }; // 다른 앱(포스터·감상문)에서 재사용
})();
