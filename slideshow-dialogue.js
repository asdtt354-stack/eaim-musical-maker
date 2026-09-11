/* ═══════════════════════════════════════════════════════════
   EAIM 슬라이드쇼 — 장면 복제 · 대사 말풍선 애드온 (slideshow-dialogue.js)
   뮤지컬메이커 슬라이드쇼용 (미디어레터에도 붙여도 무방)

   하는 일
   · ⧉  현재 장면 복제 (배경·제목·가사 그대로, 말풍선만 따로)
   · 🗨✂ 대본의 대사를 한 줄(또는 N줄)씩 화면으로 나누기 → 말풍선 자동 배치
   · 🗑  복제한 장면 삭제
   · 말풍선은 장면 데이터(scene.bubbles)에 저장돼 새로고침·녹화에도 유지
   · 말풍선 더블클릭 = 이름·대사 수정, 드래그 = 위치, ✕ = 삭제
   · 대사로 나눈 화면은 가사 자막을 숨기고, 넘버 대신 배경음악만 흐름 (가사 보기 버튼으로 다시 켤 수 있음)

   설치: slideshow.html 의 </body> 앞, slideshow-rec.js 다음 줄에
         <script src="slideshow-dialogue.js"></script>
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const DATA_KEY = 'eaim_musical_data';
  const JUMP_KEY = 'eaim_slide_jump';
  const DECO_KEYS = ['eaim_mm_slideshow_decorations', 'eaim_slideshow_decorations'];
  const POS = [
    { left: '8%',  top: '62%', tail: 'tail-left' },
    { left: '30%', top: '38%', tail: 'tail-left' },
    { left: '54%', top: '38%', tail: 'tail-right' },
    { left: '74%', top: '62%', tail: 'tail-right' },
  ];

  const $ = (id) => document.getElementById(id);
  const toast = (m) => (typeof showToast === 'function' ? showToast(m) : console.log(m));
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const scenes = () => ((typeof DATA !== 'undefined' && DATA && DATA.scenes) || []);
  const cur = () => (typeof current !== 'undefined' ? current : 0);
  const canEdit = () => new URLSearchParams(location.search).get('mode') !== 'teacher';

  const css = document.createElement('style');
  css.textContent = `
  .speech-bubble.pm-scene-bubble { cursor: move; }
  .pm-clone-badge { position:absolute; top:56px; left:28px; z-index:11; font-size:10px; letter-spacing:2px;
    color:rgba(255,255,255,.45); background:rgba(0,0,0,.35); border-radius:8px; padding:2px 8px; }
  .slide.pm-clean .main-content, .slide.pm-clean .lyrics-panel, .slide.pm-clean .top-bar { opacity:0 !important; pointer-events:none; }
  .pm-caption { position:absolute; left:0; right:0; bottom:16%; text-align:center; z-index:11;
    font-size:clamp(20px,3vw,40px); font-weight:900; color:#fff; text-shadow:0 4px 24px rgba(0,0,0,.9); letter-spacing:.02em; }
  body.rec-clean .pm-clone-badge { display:none !important; }
  `;
  document.head.appendChild(css);

  function save() {
    try { localStorage.setItem(DATA_KEY, JSON.stringify(DATA)); return true; }
    catch (e) { toast('❌ 저장 실패: ' + e.message); return false; }
  }

  // ── 대본 → 대사 줄 ──────────────────────────────────────────
  function parseScript(text) {
    if (!text) return [];
    const out = [], who = {};
    text.split('\n').forEach(raw => {
      const line = raw.trim();
      if (!line || line.startsWith('[') || line.startsWith('(')) return;
      const m = line.match(/^([^:：]{1,14})[:：]\s*(.+)$/); if (!m) return;
      const speaker = m[1].trim(), t = m[2].trim(); if (!t) return;
      if (!(speaker in who)) who[speaker] = Object.keys(who).length % POS.length;
      out.push({ speaker, text: t, posIdx: who[speaker] });
    });
    return out;
  }

  // ── 말풍선 DOM ↔ scene.bubbles ─────────────────────────────
  function bubbleEl(b) {
    const el = document.createElement('div');
    el.className = `speech-bubble pm-scene-bubble ${b.tail || 'tail-left'}`;
    el.style.left = b.left || '30%'; el.style.top = b.top || '55%';
    el.innerHTML = `${b.name ? `<div class="bubble-name">${esc(b.name)}</div>` : ''}<span>${esc(b.text)}</span><button class="bubble-del" title="삭제">✕</button>`;
    el.title = '더블클릭: 대사 수정 · 드래그: 이동';
    el.querySelector('.bubble-del').onclick = (e) => { e.stopPropagation(); el.remove(); collect(cur() - 1); };
    el.addEventListener('dblclick', (e) => { e.stopPropagation(); editBubble(el); });
    if (typeof makeDraggable === 'function') makeDraggable(el);
    return el;
  }
  function editBubble(el) {
    const nameEl = el.querySelector('.bubble-name'), textEl = el.querySelector('span');
    const name = prompt('말하는 사람 (비우면 이름 없음):', nameEl ? nameEl.textContent : '');
    if (name === null) return;
    const text = prompt('대사:', textEl ? textEl.textContent : '');
    if (text === null) return;
    if (!text.trim()) { el.remove(); collect(cur() - 1); return; }
    if (nameEl) { if (name.trim()) nameEl.textContent = name.trim(); else nameEl.remove(); }
    else if (name.trim()) { const n = document.createElement('div'); n.className = 'bubble-name'; n.textContent = name.trim(); el.prepend(n); }
    textEl.textContent = text.trim();
    collect(cur() - 1);
  }
  function collect(si) {
    const sc = scenes()[si]; const slide = $(`scene-slide-${si}`); if (!sc || !slide) return;
    sc.bubbles = [...slide.querySelectorAll('.speech-bubble:not(.auto-dialogue-bubble)')].map(b => ({
      name: b.querySelector('.bubble-name')?.textContent || '',
      text: b.querySelector('span')?.textContent || '',
      tail: (b.className.match(/tail-\S+/) || ['tail-left'])[0],
      left: b.style.left || '', top: b.style.top || '',
    }));
    save();
  }
  function render(si) {
    const sc = scenes()[si]; const slide = $(`scene-slide-${si}`); if (!sc || !slide || slide.dataset.pmBubbles) return;
    slide.dataset.pmBubbles = '1';
    if (Array.isArray(sc.bubbles)) {
      slide.querySelectorAll('.speech-bubble:not(.auto-dialogue-bubble)').forEach(b => b.remove()); // 예전 방식(인덱스 저장)과 중복 방지
      sc.bubbles.forEach(b => slide.appendChild(bubbleEl(b)));
    } else {
      // 처음 만나는 장면: 이미 놓여 있던 말풍선을 장면 데이터로 옮겨 담음
      slide.querySelectorAll('.speech-bubble:not(.auto-dialogue-bubble)').forEach(b => {
        b.classList.add('pm-scene-bubble'); b.addEventListener('dblclick', (e) => { e.stopPropagation(); editBubble(b); });
        const d = b.querySelector('.bubble-del'); if (d) d.onclick = (e) => { e.stopPropagation(); b.remove(); collect(si); };
      });
      collect(si);
    }
    if (sc.hideLyrics) {
      ['nlb-', 'lp-'].forEach(p => { const e = $(p + si); if (e) e.style.display = 'none'; });
      const t = $(`lyr-toggle-${si}`); if (t) t.textContent = '가사 보기';
    }
    if (sc.clean) {
      slide.classList.add('pm-clean');
      if (sc.caption && !slide.querySelector('.pm-caption')) { const cp = document.createElement('div'); cp.className = 'pm-caption'; cp.textContent = sc.caption; slide.appendChild(cp); }
    }
    if (sc.clonedFrom !== undefined && !slide.querySelector('.pm-clone-badge')) {
      const bd = document.createElement('div'); bd.className = 'pm-clone-badge';
      bd.textContent = sc.clean ? `${sc.clonedFrom + 1}막 · 배경만` : `${sc.clonedFrom + 1}막 · 컷 ${sc.cut || ''}`.replace(/ · 컷 $/, ' · 복제');
      slide.appendChild(bd);
    }
  }

  // 말풍선을 옮기거나 새로 추가(💬 패널)해도 장면 데이터에 반영
  document.addEventListener('mouseup', () => { const si = cur() - 1; if (si >= 0 && si < scenes().length) setTimeout(() => collect(si), 0); });

  // ── 데코(캐릭터·효과) 인덱스 보정: 장면이 끼어들거나 빠지면 번호를 같이 밀어줌 ──
  function remapDeco(insertAt, count, copyFrom) {
    DECO_KEYS.forEach(k => {
      let d; try { d = JSON.parse(localStorage.getItem(k) || 'null'); } catch { return; }
      if (!d || !d.scenes) return;
      const out = {}; Object.keys(d.scenes).forEach(key => {
        if (key === 'cover' || key === 'end') { out[key] = d.scenes[key]; return; }
        const i = Number(key);
        if (count > 0) { out[i >= insertAt ? i + count : i] = d.scenes[key]; }
        else { if (i === insertAt) return; out[i > insertAt ? i - 1 : i] = d.scenes[key]; }
      });
      if (count > 0 && copyFrom !== undefined && d.scenes[copyFrom]) {
        const src = { chars: d.scenes[copyFrom].chars || [], bubbles: [] }; // 말풍선은 scene.bubbles가 담당
        for (let j = 0; j < count; j++) out[insertAt + j] = JSON.parse(JSON.stringify(src));
      }
      d.scenes = out; localStorage.setItem(k, JSON.stringify(d));
    });
  }

  function cloneOf(sc, bubbles, extra) {
    const c = JSON.parse(JSON.stringify(sc));
    c.bubbles = bubbles; c.clonedFrom = sc.clonedFrom ?? (scenes().indexOf(sc));
    // 복제한 화면에서는 넘버(노래)를 다시 틀지 않는다 — 배경음악만 이어서 흐름
    c.dialogue = true; delete c.audioUrl; delete c.audioLocal; delete c.mrUrl;
    return Object.assign(c, extra || {});
  }
  function reloadTo(idx) { localStorage.setItem(JUMP_KEY, String(idx)); location.reload(); }

  // ── 동작 ────────────────────────────────────────────────────
  function duplicateCurrent() {
    const si = cur() - 1; if (si < 0 || si >= scenes().length) { toast('⚠️ 장면 화면에서만 복제할 수 있어요'); return; }
    if (!canEdit()) { toast('⚠️ 선생님 원격 보기 모드에서는 편집할 수 없어요'); return; }
    collect(si);
    const sc = scenes()[si];
    const copy = cloneOf(sc, JSON.parse(JSON.stringify(sc.bubbles || [])));
    scenes().splice(si + 1, 0, copy);
    if (!save()) return;
    remapDeco(si + 1, 1, si);
    reloadTo(cur() + 1);
  }
  function splitCurrentByDialogue() {
    const si = cur() - 1; if (si < 0 || si >= scenes().length) { toast('⚠️ 장면 화면에서만 나눌 수 있어요'); return; }
    if (!canEdit()) { toast('⚠️ 선생님 원격 보기 모드에서는 편집할 수 없어요'); return; }
    const sc = scenes()[si]; const lines = parseScript(sc.script || '');
    if (!lines.length) { toast('⚠️ 이 장면에는 대본 대사가 없어요 ("인물: 대사" 형식의 대본이 있어야 해요)'); return; }
    const perRaw = prompt(`대사가 ${lines.length}줄이에요. 한 화면에 몇 줄씩 넣을까요?`, '1'); if (perRaw === null) return;
    const per = Math.max(1, parseInt(perRaw, 10) || 1);
    const groups = []; for (let i = 0; i < lines.length; i += per) groups.push(lines.slice(i, i + per));
    const before = confirm(`${groups.length}개 대사 화면을 만들어요.\n\n[확인] 노래 앞에 넣기 (대사 → 노래, 뮤지컬 순서)\n[취소] 노래 뒤에 넣기`);
    const news = groups.map((g, gi) => cloneOf(sc, g.map((l, k) => {
      const p = POS[l.posIdx]; const same = g.slice(0, k).filter(x => x.posIdx === l.posIdx).length;
      return { name: l.speaker, text: l.text, tail: p.tail, left: p.left, top: (parseFloat(p.top) + same * 14) + '%' };
    }), { hideLyrics: true, cut: gi + 1 }));
    const at = before ? si : si + 1;
    scenes().splice(at, 0, ...news);
    if (!save()) return;
    remapDeco(at, news.length, si);
    toast(`✂ ${news.length}개 대사 화면을 노래 ${before ? '앞' : '뒤'}에 넣었어요 — 대사 화면엔 배경음악만 흘러요`);
    reloadTo(before ? cur() : cur() + 1);
  }
  function deleteCurrent() {
    const si = cur() - 1; if (si < 0 || si >= scenes().length) { toast('⚠️ 장면 화면에서만 삭제할 수 있어요'); return; }
    if (!canEdit()) { toast('⚠️ 선생님 원격 보기 모드에서는 편집할 수 없어요'); return; }
    if (scenes().length <= 1) { toast('⚠️ 마지막 장면은 삭제할 수 없어요'); return; }
    const sc = scenes()[si];
    if (!confirm(`"${sc.title || '장면 ' + (si + 1)}" 화면을 삭제할까요?${sc.clonedFrom === undefined ? '\n(원본 장면이에요 — 복제본만 지우려면 취소하세요)' : ''}`)) return;
    scenes().splice(si, 1);
    if (!save()) return;
    remapDeco(si, -1);
    reloadTo(Math.min(cur(), scenes().length));
  }
  /* 전체 막을 한 번에 대사 화면으로 (대사 → 노래 순서) */
  function splitAll() {
    if (!canEdit()) { toast('⚠️ 선생님 원격 보기 모드에서는 편집할 수 없어요'); return; }
    const src = scenes().filter(sc => sc.clonedFrom === undefined && (sc.script || '').trim());
    if (!src.length) { toast('⚠️ 대본 대사가 있는 막이 없어요 ("인물: 대사" 형식이 필요해요)'); return; }
    const perRaw = prompt(`대본이 있는 막 ${src.length}개를 한 번에 대사 화면으로 만들어요.\n한 화면에 대사 몇 줄씩 넣을까요?`, '1');
    if (perRaw === null) return; const per = Math.max(1, parseInt(perRaw, 10) || 1);
    let made = 0;
    // 뒤에서부터 넣어야 인덱스가 안 밀림
    for (let i = scenes().length - 1; i >= 0; i--) {
      const sc = scenes()[i]; if (sc.clonedFrom !== undefined) continue;
      const lines = parseScript(sc.script || ''); if (!lines.length) continue;
      const groups = []; for (let k = 0; k < lines.length; k += per) groups.push(lines.slice(k, k + per));
      const news = groups.map((g, gi) => cloneOf(sc, g.map((l, k) => {
        const p = POS[l.posIdx]; const same = g.slice(0, k).filter(x => x.posIdx === l.posIdx).length;
        return { name: l.speaker, text: l.text, tail: p.tail, left: p.left, top: (parseFloat(p.top) + same * 14) + '%' };
      }), { hideLyrics: true, cut: gi + 1 }));
      scenes().splice(i, 0, ...news); remapDeco(i, news.length, i + news.length); made += news.length;
    }
    if (!made) { toast('⚠️ 만들 대사가 없었어요'); return; }
    if (!save()) return;
    toast(`🎭 ${made}개 대사 화면을 만들었어요 — 각 막이 "대사 → 노래" 순서가 됐어요`);
    reloadTo(1);
  }
  /* 대사 화면 모두 지우기 (넘버만 남기기) */
  function clearDialogue() {
    if (!canEdit()) { toast('⚠️ 선생님 원격 보기 모드에서는 편집할 수 없어요'); return; }
    const n = scenes().filter(sc => sc.clonedFrom !== undefined).length;
    if (!n) { toast('지울 대사 화면이 없어요'); return; }
    if (!confirm(`복제·대사 화면 ${n}개를 모두 지우고 원래 막만 남길까요?\n(말풍선 없이 노래·그림만 보고 싶을 때)`)) return;
    for (let i = scenes().length - 1; i >= 0; i--) if (scenes()[i].clonedFrom !== undefined) { scenes().splice(i, 1); remapDeco(i, -1); }
    if (!save()) return; toast('🧹 원래 막만 남겼어요'); reloadTo(1);
  }
  /* 🖼 배경만 화면 — 노래·가사·말풍선 없이 배경 그림과 배경음악만 */
  function addCleanScene() {
    const si = cur() - 1; if (si < 0 || si >= scenes().length) { toast('⚠️ 장면 화면에서 눌러주세요'); return; }
    if (!canEdit()) { toast('⚠️ 선생님 원격 보기 모드에서는 편집할 수 없어요'); return; }
    const cap = prompt('이 화면에 크게 띄울 글 (비우면 그림만)\n예: 3년 뒤 / 그날 밤 / 막간', '');
    if (cap === null) return;
    const sc = scenes()[si];
    const c = cloneOf(sc, []);                 // cloneOf 가 노래·MR 을 이미 빼 줌
    c.clean = true; c.hideLyrics = true; c.caption = cap.trim();
    scenes().splice(si + 1, 0, c);
    if (!save()) return;
    remapDeco(si + 1, 1, si);
    toast('🖼 배경만 화면을 넣었어요 — 배경음악만 흐릅니다');
    reloadTo(cur() + 1);
  }
  /* ✎ 편집 메뉴 — 버튼이 너무 많아 보이지 않도록 하나로 모음 */
  let menuEl = null;
  function buildMenu() {
    if (menuEl) return menuEl;
    menuEl = document.createElement('div');
    menuEl.id = 'pm-menu';
    menuEl.style.cssText = 'position:fixed;bottom:86px;left:50%;transform:translateX(-50%);z-index:300;background:rgba(18,14,28,.97);border:1px solid rgba(255,255,255,.16);border-radius:16px;padding:8px;min-width:270px;box-shadow:0 12px 40px rgba(0,0,0,.6);display:none;font-family:inherit';
    menuEl.innerHTML = ACTIONS.map((a, i) => `<div class="pm-mi" data-i="${i}" style="display:flex;gap:10px;align-items:center;padding:9px 12px;border-radius:10px;cursor:pointer">
        <span style="font-size:18px;width:22px;text-align:center">${a.i}</span>
        <span><span style="display:block;font-size:13px;font-weight:700;color:${a.danger ? '#f87171' : '#fff'}">${a.t}</span>
        <span style="display:block;font-size:11px;color:rgba(255,255,255,.5)">${a.d}</span></span></div>`).join('')
      + `<div id="pm-mi-extra" style="border-top:1px solid rgba(255,255,255,.12);margin-top:6px;padding-top:6px"></div>`;
    document.body.appendChild(menuEl);
    menuEl.querySelectorAll('.pm-mi').forEach(el => {
      el.onmouseenter = () => el.style.background = 'rgba(255,255,255,.08)';
      el.onmouseleave = () => el.style.background = 'transparent';
      el.onclick = () => { closeMenu(); ACTIONS[Number(el.dataset.i)].f(); };
    });
    // ⏱ 자동 진행 · ⏺ 녹화 버튼을 메뉴 안으로 옮김 (컨트롤바 정리)
    const extra = menuEl.querySelector('#pm-mi-extra');
    ['⏱', '⏺'].forEach(sym => {
      const b = [...document.querySelectorAll('#controls button, #controls .ctrl-btn')].find(x => (x.textContent || '').trim() === sym);
      if (!b) return;
      const label = sym === '⏱' ? ['자동 진행 · 배경음악', '장면 넘김 시간과 음악 볼륨'] : ['화면 녹화', '버튼 없이 깨끗한 영상으로'];
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:10px;align-items:center;padding:9px 12px;border-radius:10px;cursor:pointer';
      row.innerHTML = `<span style="font-size:18px;width:22px;text-align:center">${sym}</span><span><span style="display:block;font-size:13px;font-weight:700;color:#fff">${label[0]}</span><span style="display:block;font-size:11px;color:rgba(255,255,255,.5)">${label[1]}</span></span>`;
      row.onmouseenter = () => row.style.background = 'rgba(255,255,255,.08)';
      row.onmouseleave = () => row.style.background = 'transparent';
      row.onclick = () => { closeMenu(); b.click(); };
      extra.appendChild(row);
      b.style.display = 'none';
    });
    document.addEventListener('click', (e) => { if (menuEl.style.display === 'block' && !menuEl.contains(e.target) && !(e.target.closest && e.target.closest('#controls'))) closeMenu(); });
    return menuEl;
  }
  function closeMenu() { if (menuEl) menuEl.style.display = 'none'; }
  function toggleMenu() { const m = buildMenu(); m.style.display = m.style.display === 'block' ? 'none' : 'block'; }
  window.pmAddClean = addCleanScene;
  window.pmDuplicateScene = duplicateCurrent; window.pmSplitDialogue = splitCurrentByDialogue; window.pmDeleteScene = deleteCurrent; window.pmSplitAll = splitAll; window.pmClearDialogue = clearDialogue;

  // ── 컨트롤바 버튼 ──
  (function addButtons() {
    const c = $('controls'); if (!c || !canEdit()) return;
    const mk = (txt, title, fn) => { const b = document.createElement('button'); b.className = 'ctrl-btn'; b.textContent = txt; b.title = title; b.setAttribute('data-tip', title); b.onclick = fn; return b; };
    const anchor = $('btn-bubble') || $('btn-char');
    const ACTIONS = [
      { i:'🎭', t:'대본대로 전체 구성',   d:'모든 막을 "대사 화면 → 노래" 순서로', f:splitAll },
      { i:'✂',  t:'이 막만 대사로 나누기', d:'지금 화면의 대본을 말풍선 화면들로',   f:splitCurrentByDialogue },
      { i:'🖼', t:'배경만 화면 추가',     d:'노래·가사·말풍선 없이 그림과 배경음악만', f:addCleanScene },
      { i:'⧉',  t:'이 장면 복제',        d:'같은 그림에 말풍선만 다르게',          f:duplicateCurrent },
      { i:'🧹', t:'대사 화면 모두 지우기', d:'노래·그림만 보고 싶을 때',            f:clearDialogue },
      { i:'🗑', t:'이 장면 삭제',        d:'되돌릴 수 없어요',                    f:deleteCurrent, danger:true },
    ];
    const menuBtn = mk('✎', '화면 구성 편집 (대사·배경·복제·녹화)', toggleMenu);
    const btns = [menuBtn];  })();

  // ── 슬라이드가 보일 때 말풍선 그리기 ──
  if (typeof window.doShowSlide === 'function') {
    const orig = window.doShowSlide;
    window.doShowSlide = function (idx) { const r = orig.apply(this, arguments); try { if (idx >= 1 && idx <= scenes().length) render(idx - 1); } catch (e) { console.warn(e); } return r; };
  }
  if (typeof window.doShowSlideInstant === 'function') { // PPT 캡처 때도
    const orig = window.doShowSlideInstant;
    window.doShowSlideInstant = function (idx) { const r = orig.apply(this, arguments); try { if (idx >= 1 && idx <= scenes().length) render(idx - 1); } catch (e) { console.warn(e); } return r; };
  }

  // ── 새로고침 후 원래 자리로 ──
  (function jumpBack() {
    const j = localStorage.getItem(JUMP_KEY); if (j === null) return;
    localStorage.removeItem(JUMP_KEY);
    let tries = 0;
    const t = setInterval(() => {
      if ($('cover-slide') && typeof showSlide === 'function' && scenes().length) {
        clearInterval(t); const idx = Math.max(0, Math.min(Number(j) || 0, scenes().length + 1));
        setTimeout(() => showSlide(idx), 400);
      } else if (++tries > 50) clearInterval(t);
    }, 100);
  })();
})();
