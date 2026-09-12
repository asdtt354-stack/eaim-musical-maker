/* ═══════════════════════════════════════════════════════════
   EAIM 슬라이드쇼 — 깨끗한 녹화 애드온 (slideshow-rec.js)
   뮤지컬메이커 슬라이드쇼 · 미디어레터 슬라이드쇼 공용

   해결하는 문제
   · 녹화 영상에 하단 컨트롤바·패널·힌트·커서까지 찍히던 것
   · 화면 전체가 아니라 "이 탭"만 잡히도록 선택창을 제한
   · 두 번째 녹화에서 오디오 노드 중복 생성 오류 (미디어레터)

   녹화 중 조작
   · ← → 장면 이동 (그대로)
   · R 또는 Esc  : 녹화 종료
   · 커튼콜 크레딧이 끝나거나, 편곡 음악이 끝나면 자동 종료

   설치: 슬라이드쇼 HTML의 </body> 바로 앞에
         <script src="slideshow-rec.js"></script>
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── 녹화 중 숨길 것들 ───────────────────────────────────────
  const css = document.createElement('style');
  css.textContent = `
  body.rec-clean #controls, body.rec-clean #key-hint, body.rec-clean #api-status,
  body.rec-clean #signal-indicator, body.rec-clean #rec-indicator, body.rec-clean #music-upload-bar,
  body.rec-clean #char-panel, body.rec-clean #char-anim-panel, body.rec-clean #bubble-panel,
  body.rec-clean #fx-panel, body.rec-clean #dialogue-bar, body.rec-clean #hover-tooltip, body.rec-clean #pm-menu,
  body.rec-clean #back-btn, body.rec-clean #toast-msg, body.rec-clean #ppt-progress,
  body.rec-clean .lyrics-toggle-btn, body.rec-clean .char-del-btn, body.rec-clean .bubble-del,
  body.rec-clean [id^="src-badge-"] { display: none !important; }
  body.rec-clean .char-wrap.selected { outline: none !important; }
  body.rec-clean, body.rec-clean * { cursor: none !important; }
  #rec-prep { position: fixed; inset: 0; z-index: 9990; background: #000; display: none;
    align-items: center; justify-content: center; flex-direction: column; gap: 14px; color: #fff; }
  #rec-prep.show { display: flex; }
  #rec-prep .n { font-size: 96px; font-weight: 900; line-height: 1; color: #ff5252; }
  #rec-prep .t { font-size: 14px; color: rgba(255,255,255,.55); letter-spacing: 1px; text-align: center; line-height: 1.8; }
  #timing-panel { position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%); z-index: 210; width: 320px;
    background: rgba(0,0,0,.85); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,.15); border-radius: 16px; padding: 14px; display: none; color: #fff; font-size: 12px; }
  #timing-panel.show { display: block; }
  #timing-panel h4 { font-size: 12px; color: rgba(255,255,255,.55); margin-bottom: 10px; }
  #timing-panel label { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,.1); margin-bottom: 6px; cursor: pointer; line-height: 1.5; }
  #timing-panel label:has(input:checked) { border-color: #5DADE2; background: rgba(93,173,226,.12); }
  #timing-panel input[type=radio] { margin-top: 3px; accent-color: #5DADE2; }
  #timing-panel input[type=number] { width: 54px; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.2); color: #fff; border-radius: 6px; padding: 2px 6px; font-family: inherit; }
  #timing-panel .info { color: rgba(255,255,255,.45); font-size: 11px; margin: 4px 0 10px; line-height: 1.6; }
  #timing-panel .row { display: flex; gap: 6px; }
  #timing-panel button { flex: 1; padding: 7px; border-radius: 8px; border: 1px solid rgba(93,173,226,.4); background: rgba(93,173,226,.18); color: #5DADE2; cursor: pointer; font-family: inherit; font-size: 12px; }
  #timing-panel button.quiet { border-color: rgba(255,255,255,.15); background: rgba(255,255,255,.06); color: rgba(255,255,255,.6); }
  body.rec-clean #timing-panel { display: none !important; }
  `;
  document.head.appendChild(css);

  const prep = document.createElement('div');
  prep.id = 'rec-prep';
  prep.innerHTML = '<div class="n">3</div><div class="t"></div>';
  document.body.appendChild(prep);

  const $ = (id) => document.getElementById(id);
  const toast = (m) => (typeof showToast === 'function' ? showToast(m) : console.log(m));

  // ── 이 기기 보관함 (뮤지컬메이커가 IndexedDB에 넣어둔 노래·그림) ──
  const IDB = {
    db: null,
    open() { return new Promise((res, rej) => { if (this.db) return res(this.db); const r = indexedDB.open('eaim-media', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('media', { keyPath: 'key' });
      r.onsuccess = () => { this.db = r.result; res(this.db); }; r.onerror = () => rej(r.error); }); },
    async get(key) { try { const db = await this.open(); return await new Promise((res, rej) => { const r = db.transaction('media').objectStore('media').get(key); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); }); } catch { return null; } },
  };
  const blobToDataUrl = (blob) => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(null); fr.readAsDataURL(blob); });
  const localAudioUrls = {};
  async function localAudio(key) { if (!key) return null; if (localAudioUrls[key]) return localAudioUrls[key]; const r = await IDB.get(key); if (!r || !r.blob) return null; return (localAudioUrls[key] = URL.createObjectURL(r.blob)); }

  // 배경 그림: 원격 URL이 없고 보관함 키가 있으면 꺼내서 씀
  /* 배경 이미지가 들어와도 "AI 배경 생성 중…" 스피너가 남는 문제 (원본 setImgSrc 가 스피너를 안 끔) */
  if (typeof window.setImgSrc === 'function') {
    const origSet = window.setImgSrc;
    window.setImgSrc = function (idx, src, label) {
      const r = origSet.apply(this, arguments);
      const sp = document.getElementById(`bg-spinner-${idx}`);
      const img = document.getElementById(`bgimg-${idx}`);
      const hide = () => { if (sp) sp.style.display = 'none'; };
      if (img) { img.addEventListener('load', hide, { once: true }); img.addEventListener('error', () => setTimeout(hide, 1200), { once: true }); if (img.complete && img.naturalWidth) hide(); }
      setTimeout(hide, 4000);                    // 그래도 남으면 4초 뒤 정리
      return r;
    };
  }
  /* 화면 아래쪽이 컨트롤바에 가리는 문제 · 커튼콜 버튼 겹침 · 긴 제목 넘침 */
  (function layoutFix() {
    const st = document.createElement('style');
    st.textContent = `
      .number-lyrics-bar{ bottom:96px !important; }
      #subtitle-bar{ bottom:96px !important; }
      .lyrics-toggle-btn{ bottom:100px !important; }
      .main-content{ padding-bottom:72px; }
      .curtain-lyrics-wrap{ padding-bottom:86px; }
      .scene-title{ font-size:clamp(18px,2.4vw,30px) !important; max-height:2.6em; overflow:hidden; }
      .lyrics-panel{ max-height:58% !important; }
      body.rec-clean .number-lyrics-bar, body.rec-clean #subtitle-bar{ bottom:40px !important; }
      body.rec-clean .main-content{ padding-bottom:16px; }
      body.rec-clean .curtain-lyrics-wrap{ padding-bottom:20px; }`;
    document.head.appendChild(st);
  })();

  if (typeof window.loadBgImage === 'function') {
    const orig = window.loadBgImage;
    window.loadBgImage = async function (scene, idx) {
      try { if (scene && !scene.imageUrl && scene.imageLocal) { const r = await IDB.get(scene.imageLocal); if (r && r.blob) scene.imageUrl = await blobToDataUrl(r.blob); } } catch {}
      return orig.apply(this, arguments);
    };
  }


  // ══════════════════════════════════════════════════════════
  // ⏱ 자동 진행 타이밍 — 음악 길이에 장면을 맞추기
  //   music : 편곡본 1곡을 장면 수로 균등 분배 (2분 ÷ 4장면 = 30초씩)
  //   scene : 장면마다 붙은 노래(audioUrl)가 끝나면 다음 장면
  //   fixed : N초마다
  // ══════════════════════════════════════════════════════════
  const TIMING_KEY = 'eaim_slide_timing';
  let timing = { mode: 'scene', fixedSec: 7 };   // 뮤지컬메이커는 장면마다 노래를 따로 만든다
  try { timing = { ...timing, ...JSON.parse(localStorage.getItem(TIMING_KEY) || '{}') }; } catch {}
  if (timing.mode === 'music') timing.mode = 'scene';   // 쓰지 않는 모드가 저장돼 있던 경우
  function saveTiming() { localStorage.setItem(TIMING_KEY, JSON.stringify(timing)); }

  const sceneCount = () => (typeof TOTAL !== 'undefined' ? TOTAL : ((typeof SCENES !== 'undefined' && SCENES.length) || 0));
  const arrangement = () => ((typeof arrangementAudioEl !== 'undefined') ? arrangementAudioEl : null);
  const goto = (i) => { if (typeof showSlide === 'function') showSlide(i); };

  let syncRunning = false, syncHandler = null, fixedTimer = null, syncAudio = null;

  function stopSync() {
    syncRunning = false;
    if (syncAudio && syncHandler) { syncAudio.removeEventListener('timeupdate', syncHandler); syncAudio.removeEventListener('ended', syncEnded); }
    syncHandler = null; syncAudio = null;
    clearInterval(fixedTimer); fixedTimer = null;
  }
  function syncEnded() { if (syncRunning) { stopSync(); goto(sceneCount() + 1); } } // 곡 끝 → 커튼콜

  // ── 곡 길이 읽기 (생성한 음악은 길이를 Infinity 로 주는 경우가 많아 우회함) ──
  function readDuration(audio, cb) {
    let done = false;
    const ok = (d) => { if (!done) { done = true; cb(d); } };
    const tryNow = () => {
      const d = audio.duration;
      if (isFinite(d) && d > 0) { ok(d); return true; }
      return false;
    };
    if (tryNow()) return;
    const onMeta = () => {
      if (tryNow()) return;
      // Infinity → 끝으로 한 번 감아 보면 실제 길이가 잡힌다
      const onDur = () => {
        const d = audio.duration;
        if (isFinite(d) && d > 0) {
          audio.removeEventListener('durationchange', onDur);
          try { audio.currentTime = 0; } catch {}
          ok(d);
        }
      };
      audio.addEventListener('durationchange', onDur);
      try { audio.currentTime = 1e6; } catch {}
    };
    audio.addEventListener('loadedmetadata', onMeta, { once: true });
    tryNow() || onMeta();
    setTimeout(() => ok(0), 5000);   // 그래도 못 읽으면 0 → 고정 시간으로 넘어감
  }

  // ── 화면 종류별로 필요한 시간 (대사는 읽는 시간, 배경만은 짧게, 노래는 나머지) ──
  const READ_CPS = 7;          // 초당 읽는 글자 수
  const MIN_DIALOGUE = 3;      // 대사 화면 최소 초
  const CLEAN_SEC = 4;         // 배경만 화면 초
  const MIN_SONG = 2.5;        // 노래 화면 최소 초

  function sceneKind(i) {      // i: 1..N
    const S = (typeof SCENES !== 'undefined') ? SCENES : [];
    const sc = S[i - 1] || {};
    if (sc.clean) return { kind: 'clean', sec: CLEAN_SEC };
    if (sc.dialogue || sc.clonedFrom !== undefined) {
      const chars = (sc.bubbles || []).reduce((s, b) => s + String(b.text || '').length, 0);
      return { kind: 'dialogue', sec: Math.max(MIN_DIALOGUE, chars / READ_CPS + 1.5) };
    }
    return { kind: 'song', sec: 0 };
  }



  // 장면별 노래가 끝나면 다음 장면
  function startSceneSync() {
    const N = sceneCount(); if (!N) return false;
    syncRunning = true;
    window._pmSceneAudioEnded = () => { if (!syncRunning) return; const c = (typeof current !== 'undefined') ? current : 0; if (c <= N) goto(c + 1); else stopSync(); };
    return true;
  }

  // N초 고정
  function startFixedSync(sec) {
    const N = sceneCount(); if (!N) return false;
    syncRunning = true;
    fixedTimer = setInterval(() => { const c = (typeof current !== 'undefined') ? current : 0; if (c <= N) goto(c + 1); else stopSync(); }, Math.max(2, sec) * 1000);
    return true;
  }

  // 현재 설정으로 자동 진행 시작 (1장면부터)
  function stopAutoRun() { stopSync(); stopSceneAudio(); stopBgm(); const a = arrangement(); if (a) { a.pause(); a.loop = true; } }
  window.pmStartAutoRun = () => startAutoRun();
  window.pmStopAutoRun = stopAutoRun;
  window.pmToggleAutoRun = function () { if (syncRunning) { stopAutoRun(); toast('■ 자동 진행 멈춤'); } else startAutoRun(); return syncRunning; };
  function startAutoRun() {
    stopSync();
    goto(1);
    if (timing.mode === 'scene') {
      const anyScene = (typeof SCENES !== 'undefined') && SCENES.some(s => s.audioUrl || s.audioLocal);
      if (anyScene) return startSceneSync();
      toast('⚠️ 아직 장면에 붙은 노래가 없어 고정 시간으로 진행해요');
      return startFixedSync(timing.fixedSec);
    }
    return startFixedSync(timing.fixedSec);
  }

  // ── 설정 패널 ──
  const tp = document.createElement('div');
  tp.id = 'timing-panel';
  document.body.appendChild(tp);
  function renderTimingPanel() {
    const N = sceneCount();
    const hasSceneSongs = (typeof SCENES !== 'undefined') && SCENES.some(s => s.audioUrl || s.audioLocal);
    tp.innerHTML = `
      <h4>⏱ 장면 자동 진행</h4>
      <label><input type="radio" name="tm" value="scene" ${timing.mode === 'scene' ? 'checked' : ''}>
        <span><b>노래에 맞추기</b><br><span class="info" style="margin:0">${hasSceneSongs ? `넘버는 노래가 끝나면, 대사·배경 화면은 글자 수만큼 보여줘요 (전체 ${N}화면)` : '아직 장면에 붙은 노래가 없어요 — 대본팀 화면에서 넘버를 만들어 주세요'}</span></span></label>
      <label><input type="radio" name="tm" value="fixed" ${timing.mode === 'fixed' ? 'checked' : ''}>
        <span><b>고정 시간</b> &nbsp;<input type="number" id="tm-sec" min="2" max="120" value="${timing.fixedSec}"> 초마다</span></label>
      <div class="info" style="border-top:1px solid rgba(255,255,255,.12);padding-top:8px;margin-top:8px">
        <label style="display:flex;align-items:center;gap:6px;color:#fff"><input type="checkbox" id="tm-bgm" ${bgmPref.on ? 'checked' : ''}> 🎻 배경음악 깔기</label>
        <div style="display:flex;align-items:center;gap:6px;margin-top:4px">볼륨 <input type="range" id="tm-bgmvol" min="10" max="80" value="${Math.round(bgmPref.vol * 100)}"> <span id="tm-bgmvol-l">${Math.round(bgmPref.vol * 100)}</span></div>
        표지=인트로 · 막=그 막 배경음악(없으면 막간 전환) · 커튼콜=엔딩. 노래가 나오는 동안엔 저절로 작아져요.
      </div>
      <div class="info">녹화를 시작하면 이 설정대로 1장면부터 자동으로 넘어가요. 녹화 중에도 ← → 로 직접 넘길 수 있어요.</div>
      <div class="row"><button id="tm-preview">▶ 미리보기</button><button class="quiet" id="tm-stop">■ 멈춤</button><button class="quiet" id="tm-close">닫기</button></div>`;
    tp.querySelectorAll('input[name=tm]').forEach(r => r.onchange = () => { timing.mode = r.value; saveTiming(); });
    tp.querySelector('#tm-sec').oninput = (e) => { timing.fixedSec = Number(e.target.value) || 7; saveTiming(); };
    tp.querySelector('#tm-preview').onclick = () => { startAutoRun(); };
    tp.querySelector('#tm-stop').onclick = () => { stopSync(); stopBgm(); const a2 = arrangement(); if (a2) { a2.pause(); a2.loop = true; } toast('■ 자동 진행 멈춤'); };
    tp.querySelector('#tm-close').onclick = () => tp.classList.remove('show');
    tp.querySelector('#tm-bgm').onchange = (e) => { bgmPref.on = e.target.checked; saveBgm(); if (!bgmPref.on) stopBgm(); else { const b = bgmForSlide(typeof current !== 'undefined' ? current : 0); setBgm(b.url, b.lkey, b.key); } };
    tp.querySelector('#tm-bgmvol').oninput = (e) => { bgmPref.vol = Number(e.target.value) / 100; tp.querySelector('#tm-bgmvol-l').textContent = e.target.value; saveBgm(); if (bgmAudio) bgmAudio.volume = bgmPref.vol; };
  }
  function toggleTimingPanel() { if (tp.classList.contains('show')) tp.classList.remove('show'); else { renderTimingPanel(); tp.classList.add('show'); } }
  window.toggleTimingPanel = toggleTimingPanel;

  // 컨트롤바에 ⏱ 버튼 추가
  (function addBtn() {
    const c = $('controls'); if (!c) return;
    const b = document.createElement('button');
    b.className = 'ctrl-btn'; b.id = 'btn-timing'; b.textContent = '⏱'; b.title = '장면 자동 진행 (음악 길이에 맞추기)';
    b.setAttribute('data-tip', '음악 길이에 맞춰 장면이 자동으로 넘어가게 해요');
    b.onclick = toggleTimingPanel;
    const rec = $('btn-rec'); if (rec && rec.parentElement === c) c.insertBefore(b, rec); else c.appendChild(b);
  })();

  let recorder = null, chunks = [], timer = null, seconds = 0, displayStream = null, mixCtx = null;

  function isRecording() { return recorder && recorder.state === 'recording'; }

  // ── 탭만 캡처 (브라우저가 지원하는 옵션은 적용, 나머지는 무시됨) ──
  async function captureThisTab() {
    const opts = {
      video: { displaySurface: 'browser', cursor: 'never', frameRate: 30 },
      audio: true,                       // 탭 소리(배경음·생성한 노래)까지 함께
      preferCurrentTab: true,            // Chrome: 현재 탭을 기본 선택
      selfBrowserSurface: 'include',
      surfaceSwitching: 'exclude',
      monitorTypeSurfaces: 'exclude',    // 전체 화면 선택지 숨김
      systemAudio: 'exclude',
    };
    return navigator.mediaDevices.getDisplayMedia(opts);
  }

  // ── 오디오 트랙 결정: 탭 오디오가 있으면 그대로, 없으면 편곡 음악을 직접 섞기 ──
  function buildStream(ds) {
    const v = ds.getVideoTracks();
    let a = ds.getAudioTracks();
    const el = (typeof arrangementAudioEl !== 'undefined') ? arrangementAudioEl : null; // 미디어레터 편곡본
    if (!a.length && el) {
      mixCtx = mixCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (mixCtx.state === 'suspended') mixCtx.resume();
      if (!el._pmSource) {              // 같은 <audio>에 소스는 한 번만 만들 수 있음
        el._pmSource = mixCtx.createMediaElementSource(el);
        el._pmSource.connect(mixCtx.destination);
      }
      const dest = mixCtx.createMediaStreamDestination();
      el._pmSource.connect(dest);
      a = dest.stream.getAudioTracks();
    }
    return new MediaStream([...v, ...a]);
  }

  function pickMime() {
    const list = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    return list.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
  }

  async function countdown() {
    const n = prep.querySelector('.n'), t = prep.querySelector('.t');
    t.innerHTML = '녹화가 시작되면 화면의 버튼은 모두 숨겨져요<br>← → 로 장면을 넘기고, <b>R</b> 또는 <b>Esc</b> 로 끝내요';
    prep.classList.add('show');
    for (let i = 3; i >= 1; i--) { n.textContent = i; await new Promise(r => setTimeout(r, 900)); }
    prep.classList.remove('show');
  }

  async function startClean() {
    if (isRecording()) return;
    try { displayStream = await captureThisTab(); }
    catch (e) { toast('⚠️ 화면 공유가 취소됐어요. 공유 창에서 "이 탭"을 선택해주세요'); return; }

    if (typeof deselectAllChars === 'function') deselectAllChars();
    if (typeof stopAutoIfPlaying === 'function') stopAutoIfPlaying();

    await countdown();
    document.body.classList.add('rec-clean');

    // 설정한 타이밍대로 1장면부터 자동 진행 (편곡본이 있으면 곡 길이에 맞춰 균등 분배)
    tp.classList.remove('show');
    const el = arrangement();
    if (el) { el.pause(); if (typeof updateMusicPlayBtn === 'function') updateMusicPlayBtn(); }

    const stream = buildStream(displayStream);
    chunks = []; seconds = 0;
    const mime = pickMime();
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined);
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: (mime.split(';')[0]) || 'video/webm' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const title = (typeof DATA !== 'undefined' && DATA && DATA.title) ? DATA.title.trim() : 'EAIM';
      a.download = `${title}_슬라이드쇼_${new Date().toISOString().slice(0, 10)}.webm`;
      a.click();
      displayStream.getTracks().forEach(t => t.stop());
      toast('🎬 영상 저장 완료');
    };
    displayStream.getVideoTracks()[0].addEventListener('ended', () => { if (isRecording()) stopClean(); }); // 브라우저 "공유 중지" 눌렀을 때
    recorder.start(1000);
    startAutoRun();

    timer = setInterval(() => { seconds++; document.title = `● ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} 녹화 중`; }, 1000);
    const btn = $('btn-rec'); if (btn) { btn.textContent = '⏹'; btn.classList.add('is-recording'); btn.style.color = '#ff5252'; }
  }

  function stopClean(msg) {
    if (!isRecording()) return;
    stopSync(); stopSceneAudio();
    recorder.stop();
    clearInterval(timer); document.title = document.title.replace(/^● .*녹화 중$/, 'EAIM 슬라이드쇼');
    document.body.classList.remove('rec-clean');
    const el = (typeof arrangementAudioEl !== 'undefined') ? arrangementAudioEl : null;
    if (el) { el.loop = true; if (typeof updateMusicPlayBtn === 'function') updateMusicPlayBtn(); }
    const btn = $('btn-rec'); if (btn) { btn.textContent = '⏺'; btn.classList.remove('is-recording'); btn.style.color = ''; }
    toast(msg || '⏹ 녹화 종료 — 저장 중…');
  }

  // ── 키보드: R / Esc 로 종료 (Esc의 "나가기"는 녹화 중엔 막음) ──
  document.addEventListener('keydown', (e) => {
    if (!isRecording()) return;
    if (e.key === 'Escape' || e.key === 'r' || e.key === 'R') { e.stopImmediatePropagation(); e.preventDefault(); stopClean(); }
  }, true);

  // ── 커튼콜 크레딧이 다 올라가면 자동 종료 ──
  if (typeof window.startCreditsScroll === 'function') {
    const orig = window.startCreditsScroll;
    window.startCreditsScroll = function () {
      const r = orig.apply(this, arguments);
      const dur = (typeof window._pmCreditsDur === 'number' && window._pmCreditsDur > 0)
        ? window._pmCreditsDur
        : Math.max(12, ((typeof DATA !== 'undefined' && DATA && DATA.credits) || []).length * 2.2 + 10);
      setTimeout(() => { if (isRecording()) stopClean('🎭 막이 내려 녹화를 마쳤어요'); }, dur * 1000 + 1500);
      return r;
    };
  }

  // ── 기존 녹화 함수를 교체 ──
  if (typeof window.beginScreenRecording === 'function') {
    // 미디어레터판: 체크리스트 → confirmStartRecording → beginScreenRecording
    window.beginScreenRecording = startClean;
    window.stopScreenRecording = () => stopClean();
    window.toggleRecording = function () { if (isRecording()) stopClean(); else if (typeof openRecChecklist === 'function') openRecChecklist(); else startClean(); };
  } else {
    // 뮤지컬메이커판: toggleRecording 하나
    window.toggleRecording = function () { if (isRecording()) stopClean(); else startClean(); };
  }

  /* ═══ 배경음악(BGM) 층: 표지=인트로, 장면=그 막 배경음악(없으면 막간 전환), 커튼콜=엔딩 ═══
     노래(넘버)가 흐르는 동안에는 볼륨을 낮춰(더킹) 대사·노래를 가립니다. */
  let bgmAudio = null, bgmKeyNow = '';
  const BGM_ON = () => bgmPref.on, BGM_VOL = () => bgmPref.vol;
  let bgmPref = { on: true, vol: .35 };
  try { bgmPref = { ...bgmPref, ...JSON.parse(localStorage.getItem('eaim_slide_bgm') || '{}') }; } catch {}
  const saveBgm = () => localStorage.setItem('eaim_slide_bgm', JSON.stringify(bgmPref));
  function stopBgm() { if (bgmAudio) { const a = bgmAudio; bgmAudio = null; bgmKeyNow = ''; fade(a, 0, .35, () => a.pause()); } }
  function fade(a, to, sec, done) { if (!a) return; const from = a.volume, t0 = performance.now();
    const step = () => { const k = Math.min(1, (performance.now() - t0) / (sec * 1000)); a.volume = Math.max(0, Math.min(1, from + (to - from) * k)); if (k < 1) requestAnimationFrame(step); else done && done(); }; step(); }
  function duck(on) { if (bgmAudio) fade(bgmAudio, on ? BGM_VOL() * .45 : BGM_VOL(), .5); }
  let bgmGen = 0;
  async function setBgm(url, lkey, key) {
    const myGen = ++bgmGen;
    if (!BGM_ON()) { stopBgm(); return; }
    if ((typeof arrangementAudioEl !== 'undefined') && arrangementAudioEl && !arrangementAudioEl.paused) { stopBgm(); return; }  // 편곡본이 있으면 양보
    if (!url && !lkey) { stopBgm(); return; }
    if (key && key === bgmKeyNow) return;                       // 같은 곡이면 끊지 않고 이어서
    const src = (await localAudio(lkey)) || url; if (myGen !== bgmGen) return; if (!src) { stopBgm(); return; }
    const old = bgmAudio;
    const a = new Audio(src); if (!src.startsWith('blob:')) a.crossOrigin = 'anonymous';
    a.loop = true; a.volume = 0; bgmAudio = a; bgmKeyNow = key || src;
    a.play().then(() => fade(a, BGM_VOL(), .8)).catch(() => {});
    if (old) fade(old, 0, .8, () => old.pause());
  }
  function bgmForSlide(idx) {
    const scenes = (typeof SCENES !== 'undefined') ? SCENES : [];
    const total = scenes.length, D = (typeof DATA !== 'undefined' && DATA) ? DATA : {};
    if (idx <= 0) return { url: D.stage_introUrl, lkey: D.stage_introLocal, key: D.stage_introUrl || D.stage_introLocal || 'intro' };
    if (idx >= 1 && idx <= total) {
      const sc = scenes[idx - 1] || {};
      if (sc.bgmUrl || sc.bgmLocal) return { url: sc.bgmUrl, lkey: sc.bgmLocal, key: sc.bgmUrl || sc.bgmLocal };   // 키가 같으면 대사 화면을 넘겨도 이어서 흐름
      return { url: D.stage_transitionUrl, lkey: D.stage_transitionLocal, key: D.stage_transitionUrl || D.stage_transitionLocal || 'transition' };   // 막에 배경음악이 없으면 전환 음악을 깔아 줌
    }
    const eu = D.stage_endingUrl || D.curtainBgmUrl, el2 = D.stage_endingLocal || D.curtainBgmLocal;
    return { url: eu, lkey: el2, key: eu || el2 || 'ending' };
  }

  // ── 보너스: 장면에 audioUrl(생성한 노래)이 있으면 그 장면에서 자동 재생 ──
  let sceneAudio = null, audioGen = 0;
  function stopSceneAudio() { audioGen++; if (sceneAudio) { try { sceneAudio.pause(); sceneAudio.currentTime = 0; } catch {} sceneAudio = null; } duck(false); }
  if (typeof window.doShowSlide === 'function') {
    const orig = window.doShowSlide;
    window.doShowSlide = function (idx) {
      const r = orig.apply(this, arguments);
      try {
        stopSceneAudio();
        { const b = bgmForSlide(idx); setBgm(b.url, b.lkey, b.key); }
        const scenes = (typeof SCENES !== 'undefined') ? SCENES : [];
        const total = scenes.length;
        let url = null, lkey = null;
        if (idx >= 1 && idx <= total) { const sc0 = scenes[idx - 1] || {}; if (!sc0.dialogue && !sc0.clean) { url = sc0.audioUrl || null; lkey = sc0.audioLocal || null; } }
        else if (idx === total + 1 && typeof DATA !== 'undefined' && DATA) { url = DATA.curtainAudioUrl || null; lkey = DATA.curtainAudioLocal || null; }
        const hasArrangement = (typeof arrangementAudioEl !== 'undefined') && arrangementAudioEl && !arrangementAudioEl.paused;
        if ((url || lkey) && !hasArrangement) {
          const myIdx = idx, myGen = ++audioGen;
          (async () => {
            const src = (await localAudio(lkey)) || url; if (!src) return;
            if (myGen !== audioGen) return;                                   // 그 사이 슬라이드가 넘어갔으면 재생하지 않음
            if (typeof current !== 'undefined' && current !== myIdx) return;
            sceneAudio = new Audio(src); if (!src.startsWith('blob:')) sceneAudio.crossOrigin = 'anonymous'; sceneAudio.volume = 0.8;
            // 커튼콜 곡이면 길이를 읽어 커튼콜·크레딧 시간을 다시 잡는다
            if (myIdx === total + 1 && typeof window.pmRetimeEnding === 'function') {
              readDuration(sceneAudio, (D) => { if (D) window.pmRetimeEnding(D); });
            }
            sceneAudio.addEventListener('play', () => duck(true));
            sceneAudio.addEventListener('ended', () => { duck(false); if (window._pmSceneAudioEnded) window._pmSceneAudioEnded(); }, { once: true });
            sceneAudio.play().catch(() => {});
          })();
        } else if (!url && !lkey && window._pmSceneAudioEnded && typeof timing !== 'undefined' && timing.mode === 'scene') {
          // 노래 없는 화면(대사·배경만)은 글자 수만큼 읽을 시간을 준다 — 예전에는 무조건 7초였다
          const w = (idx >= 1 && idx <= total) ? sceneKind(idx).sec : (timing.fixedSec || 7);
          setTimeout(() => { if (typeof current !== 'undefined' && current === idx) window._pmSceneAudioEnded(); }, Math.max(2, w) * 1000);
        }
      } catch (e) { console.warn(e); }
      return r;
    };
  }
})();
