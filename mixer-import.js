/* ═══════════════════════════════════════════════════════════
   EAIM 오디오 믹서 — 뮤지컬메이커 노래 불러오기 애드온 (mixer-import.js)

   · 뮤지컬메이커에서 만든 넘버(Lyria 노래)를 목록으로 보여줌
   · 한 번 클릭으로 BGM / MR / 앰비언스 채널에 올림
   · "큐에 자동 배치": 오프닝·N막·커튼콜 큐의 MR 채널에 해당 넘버를 연결
   · 같은 기기(브라우저)의 보관함(IndexedDB)에서 읽으므로 인터넷·저장소 설정 불필요

   설치: audio-mixer.html 의 </body> 바로 앞에
         <script src="mixer-import.js"></script>
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const IDB = {
    db: null,
    open() { return new Promise((res, rej) => { if (this.db) return res(this.db); const r = indexedDB.open('eaim-media', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('media', { keyPath: 'key' });
      r.onsuccess = () => { this.db = r.result; res(this.db); }; r.onerror = () => rej(r.error); }); },
    async all() { try { const db = await this.open(); return await new Promise((res, rej) => { const r = db.transaction('media').objectStore('media').getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); }); } catch { return []; } },
    async del(key) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('media', 'readwrite'); t.objectStore('media').delete(key); t.oncomplete = res; t.onerror = () => rej(t.error); }); },
  };
  const say = (m) => (typeof toast === 'function' ? toast(m) : console.log(m));
  const urls = {};
  const urlOf = (rec) => urls[rec.key] || (urls[rec.key] = URL.createObjectURL(rec.blob));
  const SCENE_LABEL = (id) => id === 'opening' ? '오프닝' : id === 'curtain' ? '커튼콜' : id === 'rsong' ? '낭독극 노래' : (/^scene-(\d+)$/.test(id) ? (Number(id.slice(6)) + 1) + '막' : id);

  const css = document.createElement('style');
  css.textContent = `
  #mm-songs{background:var(--panel);border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:2px}
  #mm-songs .hd{padding:12px 14px;border-bottom:1px solid var(--border);font-size:11px;color:var(--purple);letter-spacing:2px;display:flex;justify-content:space-between;align-items:center}
  #mm-songs .hd button{background:rgba(206,147,216,.12);border:1px solid rgba(206,147,216,.4);color:var(--purple);border-radius:6px;padding:3px 8px;font-size:10px;cursor:pointer;font-family:inherit}
  #mm-songs .list{padding:8px 10px;max-height:240px;overflow-y:auto}
  .mm-work{font-size:9px;color:var(--subtext);letter-spacing:1px;margin:6px 0 4px}
  .mm-row{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:6px;background:var(--panel2);border:1px solid var(--border);margin-bottom:5px}
  .mm-row .nm{flex:1;min-width:0;font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .mm-row .nm small{display:block;font-weight:400;color:var(--subtext);font-size:9px}
  .mm-row button{border-radius:5px;padding:3px 7px;font-size:10px;cursor:pointer;font-family:inherit;border:1px solid var(--border);background:var(--panel);color:var(--text)}
  .mm-row button.p{border-color:rgba(105,240,174,.4);color:var(--green)}
  .mm-row button.x{border-color:#333;color:var(--subtext)}
  #mm-songs .empty{padding:14px;font-size:11px;color:var(--subtext);line-height:1.7;text-align:center}
  `;
  document.head.appendChild(css);

  const box = document.createElement('div');
  box.id = 'mm-songs';
  box.innerHTML = `<div class="hd"><span>🎭 뮤지컬메이커 노래</span><div><button id="mm-assign" title="오프닝·막·커튼콜 큐의 MR 채널에 넘버를 연결해요">큐에 자동 배치</button> <button id="mm-refresh">새로고침</button></div></div><div class="list" id="mm-list"></div>`;
  const rightCol = document.querySelector('.right-col');
  const sfx = document.querySelector('.sfx-board');
  if (rightCol && sfx) rightCol.insertBefore(box, sfx.nextSibling); else document.body.appendChild(box);

  let songs = [];
  async function refresh() {
    const all = await IDB.all();
    songs = all.filter(r => r.kind === 'audio' && r.blob).sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const list = document.getElementById('mm-list');
    if (!songs.length) { list.innerHTML = '<div class="empty">아직 만든 노래가 없어요.<br>뮤지컬메이커에서 넘버 아래 "노래 만들기"를 누르면<br>여기에 자동으로 나타나요.</div>'; return; }
    const byWork = {};
    songs.forEach(r => { const k = r.title || '(제목 없음)'; (byWork[k] = byWork[k] || []).push(r); });
    list.innerHTML = Object.entries(byWork).map(([title, rs]) => `<div class="mm-work">🎼 ${esc(title)}</div>` + rs.map(r => `
      <div class="mm-row" data-key="${esc(r.key)}">
        <div class="nm">${esc(r.song || SCENE_LABEL(r.id))}<small>${SCENE_LABEL(r.id)} · ${r.full ? '전체 곡' : '30초'} · ${new Date(r.ts || 0).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}</small></div>
        <button class="p" data-ch="bgm" title="BGM 채널에 올리기">BGM</button>
        <button class="p" data-ch="mr" title="넘버 MR 채널에 올리기">MR</button>
        <button class="p" data-ch="sfx2" title="앰비언스 채널에 올리기">AMB</button>
        <button class="x" data-del="1" title="보관함에서 삭제">✕</button>
      </div>`).join('')).join('');
    list.querySelectorAll('.mm-row').forEach(row => {
      const rec = songs.find(r => r.key === row.dataset.key);
      row.querySelectorAll('[data-ch]').forEach(b => b.onclick = () => loadTo(b.dataset.ch, rec));
      row.querySelector('[data-del]').onclick = async () => { if (!confirm('이 노래를 보관함에서 지울까요?')) return; await IDB.del(rec.key).catch(() => {}); refresh(); };
    });
  }
  function loadTo(ch, rec) {
    if (typeof setAudioSrc !== 'function') { say('⚠️ 믹서 함수를 찾을 수 없어요'); return; }
    setAudioSrc(ch, urlOf(rec));
    const fn = document.getElementById('fname-' + ch); if (fn) fn.textContent = '🎭 ' + (rec.song || SCENE_LABEL(rec.id));
    const z = document.getElementById('zone-' + ch); if (z) z.classList.add('loaded');
    say(`🎭 "${rec.song || SCENE_LABEL(rec.id)}" → ${ch.toUpperCase()} 채널`);
  }

  // 큐 자동 배치: eaim_musical_data 의 audioLocal 키로 큐와 노래를 짝지음
  async function assignToCues() {
    if (typeof cues === 'undefined' || !Array.isArray(cues) || !cues.length) { say('⚠️ 큐가 없어요. 뮤지컬메이커에서 슬라이드쇼를 한 번 열면 큐가 자동으로 생겨요'); return; }
    let data = null; try { data = JSON.parse(localStorage.getItem('eaim_musical_data') || 'null'); } catch {}
    if (!songs.length) await refresh();
    const byKey = Object.fromEntries(songs.map(r => [r.key, r]));
    const byId = {}; songs.forEach(r => { if (!byId[r.id]) byId[r.id] = r; }); // 최신 우선
    let n = 0;
    cues.forEach((c, i) => {
      let rec = null;
      if (data && Array.isArray(data.scenes)) {
        if (/^오프닝/.test(c.name)) { const s = data.scenes.find(x => x.type === 'opening'); rec = s && (byKey[s.audioLocal] || byId.opening); }
        else if (/^커튼콜/.test(c.name)) rec = byKey[data.curtainAudioLocal] || byId.curtain;
        else { const m = c.name.match(/^(\d+)막/); if (m) { const s = data.scenes[Number(m[1])]; rec = (s && byKey[s.audioLocal]) || byId['scene-' + (Number(m[1]) - 1)]; } }
      } else {
        if (/^오프닝/.test(c.name)) rec = byId.opening; else if (/^커튼콜/.test(c.name)) rec = byId.curtain;
        else { const m = c.name.match(/^(\d+)막/); if (m) rec = byId['scene-' + (Number(m[1]) - 1)]; }
      }
      if (rec) { c.mr = { ...(c.mr || {}), url: urlOf(rec), fname: '🎭 ' + (rec.song || SCENE_LABEL(rec.id)), vol: Math.max(c.mr?.vol ?? 1, 0.9), loop: false }; n++; }
    });
    if (typeof rebuildCueList === 'function') rebuildCueList();
    say(n ? `🎭 ${n}개 큐에 넘버를 연결했어요 — 큐를 누르면 MR 채널에 올라와요` : '⚠️ 큐 이름과 맞는 노래를 못 찾았어요');
  }

  function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  document.getElementById('mm-refresh').onclick = refresh;
  document.getElementById('mm-assign').onclick = assignToCues;
  refresh();
})();
