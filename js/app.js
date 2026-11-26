import { $, esc, uid, dist, fmtDist, walkMin } from './util.js';
import { DAYS, nowInTz, statusOf, summarize, parseHours } from './hours.js';
import * as store from './store.js';
import { search, parseMapsUrl } from './geocode.js';

const RADII = [0, 500, 1000, 2000, 5000];
const TZS = ['Asia/Tokyo', 'Asia/Seoul', 'Asia/Taipei', 'Asia/Bangkok', 'Europe/Rome', 'Europe/Paris', 'Europe/London', 'America/New_York'];
let marks = store.jget('tm.marks', {});
const ui = store.jget('tm.ui', {});

const S = {
  data: { version: 1, trips: [], tags: [], places: [] }, from: '', tripId: null, edit: false,
  origin: ui.origin || null, gps: null, gpsMsg: '', list: 'all', kinds: new Set(), openOnly: false, unvisited: false,
  radius: ui.radius || 0, view: 'list', expanded: null, sheet: null, saveSt: ''
};
let editOff = !!ui.editOff;  // 只在使用者手動切換時記住
const saveUi = () => store.jset('tm.ui', { origin: S.origin, radius: S.radius, tripId: S.tripId, editOff });

// ---------- 小工具 ----------
const trip = () => S.data.trips.find(t => t.id === S.tripId);
const tagOf = id => S.data.tags.find(t => t.id === id);
const placeOf = id => S.data.places.find(p => p.id === id);
const navUrl = p => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=walking`;
const mark = p => { const l = marks[p.id] || {}; return { visited: 'visited' in p ? !!p.visited : !!l.visited, review: 'review' in p ? (p.review || '') : (l.review || '') }; };
function setMark(p, patch) {
  if (S.edit) { Object.assign(p, patch); persist(); }
  else { marks[p.id] = { ...marks[p.id], ...patch }; store.jset('tm.marks', marks); }
}
const persist = () => store.scheduleSave(S.data);
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2400); }
const emojiOf = ids => ids.map(i => tagOf(i)).filter(Boolean).map(t => t.emoji).join('');

function originPt() {
  const o = S.origin, t = trip();
  if (!o || !t) return null;
  if (o.type === 'gps') return S.gps ? { ...S.gps, label: '我的位置' } : null;
  const a = t.anchors.find(x => x.id === o.id);
  return a ? { lat: a.lat, lng: a.lng, label: a.name } : null;
}

// ---------- 定位 ----------
function locate(cb) {
  if (!navigator.geolocation) { S.gpsMsg = '此裝置不支援定位'; render(); return; }
  S.gpsMsg = '定位中…'; render();
  navigator.geolocation.getCurrentPosition(pos => {
    S.gps = { lat: pos.coords.latitude, lng: pos.coords.longitude, at: Date.now() };
    S.gpsMsg = ''; cb ? cb() : render();
  }, err => {
    S.gpsMsg = err.code === 1 ? '定位被拒絕：到 iPhone 設定 → 隱私 → 定位服務允許 Safari / 本 App' : '定位失敗，改用基地點';
    render();
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
}

// ---------- 主畫面 ----------
function filtered(o) {
  const t = trip(); const now = nowInTz(t.tz);
  let ps = S.data.places.filter(p => p.tripId === S.tripId);
  if (S.list !== 'all') ps = ps.filter(p => p.tags.includes(S.list));
  if (S.kinds.size) ps = ps.filter(p => p.tags.some(x => S.kinds.has(x)));
  ps = ps.map(p => ({ p, d: o ? dist(o, p) : null, st: statusOf(p.hours, now), m: mark(p) }));
  if (S.openOnly) ps = ps.filter(x => x.st.state === 'open' || x.st.state === 'closing');
  if (S.unvisited) ps = ps.filter(x => !x.m.visited);
  if (S.radius && o) ps = ps.filter(x => x.d <= S.radius);
  ps.sort((a, b) => o ? a.d - b.d : a.p.name.localeCompare(b.p.name, 'zh-Hant'));
  return ps;
}

function render() {
  const root = $('#app'), t = trip();
  if (!t) {
    root.innerHTML = `<div class="empty"><h1>旅行地圖</h1><p>${S.edit ? '還沒有旅程，先建立一個吧。' : '還沒有資料。'}</p>
      ${S.edit ? '<button class="btn pri" data-act="trip-new">＋ 建立旅程</button>' : ''}
      <button class="btn" data-act="settings">⚙︎ 設定</button></div>`;
    return;
  }
  const o = originPt(), list = filtered(o), now = nowInTz(t.tz);
  const lists = S.data.tags.filter(x => x.group === 'list');
  const used = new Set(S.data.places.filter(p => p.tripId === t.id).flatMap(p => p.tags));
  const kinds = S.data.tags.filter(x => x.group === 'kind' && (used.has(x.id) || S.kinds.has(x.id)));
  const hh = `週${DAYS[now.day]} ${String(Math.floor(now.min / 60)).padStart(2, '0')}:${String(now.min % 60).padStart(2, '0')}`;
  const hasTok = store.hasToken();
  root.innerHTML = `
  <header class="top">
    <button class="tripbtn" data-act="trips"><span class="serif">${esc(t.name)}</span><small>現地 ${hh} ▾</small></button>
    <div class="top-r">
      <span id="savest" class="savest ${S.saveSt}">${saveText()}</span>
      ${hasTok ? `<button class="pill-btn ${S.edit ? 'on' : ''}" data-act="toggle-edit">${S.edit ? '✎ 編輯中' : '檢視'}</button>` : ''}
      <button class="icon-btn" data-act="settings" aria-label="設定">⚙︎</button>
    </div>
  </header>
  <section class="origin" data-act="origin">
    <span class="pin">📍</span>
    <span class="otxt"><b>${esc(o ? o.label : (S.origin?.type === 'gps' ? '我的位置' : '選擇出發點'))}</b>
      <small>${S.gpsMsg ? esc(S.gpsMsg) : (o ? '依距離由近到遠' : (S.origin?.type === 'gps' ? '尚未取得定位，點此重試' : '點此選擇基地點或使用 GPS'))}</small></span>
    ${S.origin?.type === 'gps' ? '<button class="icon-btn" data-act="regps" aria-label="重新定位">↻</button>' : ''}
    <span class="car">▾</span>
  </section>
  <nav class="seg">
    <button class="${S.list === 'all' ? 'on' : ''}" data-act="list" data-v="all">全部</button>
    ${lists.map(l => `<button class="${S.list === l.id ? 'on' : ''}" data-act="list" data-v="${l.id}">${l.emoji} ${esc(l.label)}</button>`).join('')}
  </nav>
  <div class="chips scroll">
    <button class="chip ${S.openOnly ? 'on' : ''}" data-act="f-open">🟢 營業中</button>
    <button class="chip ${S.unvisited ? 'on' : ''}" data-act="f-unv">還沒去過</button>
    <button class="chip ${S.radius ? 'on' : ''}" data-act="f-rad">範圍：${S.radius ? fmtDist(S.radius) + ' 內' : '不限'}</button>
    ${kinds.map(k => `<button class="chip ${S.kinds.has(k.id) ? 'on' : ''}" data-act="f-kind" data-v="${k.id}">${k.emoji} ${esc(k.label)}</button>`).join('')}
  </div>
  <div class="bar"><span>${list.length} 間</span>
    <span class="vt"><button class="${S.view === 'list' ? 'on' : ''}" data-act="view" data-v="list">清單</button><button class="${S.view === 'map' ? 'on' : ''}" data-act="view" data-v="map">地圖</button></span></div>
  <main>
    ${S.view === 'map' ? '<div id="map"></div>' : ''}
    <div class="cards">${list.length ? list.map(x => card(x)).join('') : `<p class="muted pad">${S.data.places.some(p => p.tripId === t.id) ? '沒有符合條件的店家，放寬一下篩選看看。' : '這趟旅程還沒有店家。' + (S.edit ? '點右下角 ＋ 新增。' : '')}</p>`}</div>
  </main>
  ${S.edit ? '<button class="fab" data-act="place-new" aria-label="新增店家">＋</button>' : ''}`;
  if (S.view === 'map') drawMap(list, o);
}

function card({ p, d, st, m }) {
  const open = S.expanded === p.id;
  const kindTxt = p.tags.map(tagOf).filter(x => x && x.group === 'kind').map(x => x.label).join('・');
  return `<article class="card ${m.visited ? 'done' : ''}" data-id="${p.id}">
    <div class="r1" data-act="expand">
      <div class="nm"><h3>${emojiOf(p.tags.filter(i => tagOf(i)?.group === 'list'))} ${esc(p.name)}</h3>
        ${p.nameLocal && p.nameLocal !== p.name ? `<p class="sub">${esc(p.nameLocal)}</p>` : ''}</div>
      ${d != null ? `<div class="ds"><b>${fmtDist(d)}</b><small>步行約 ${walkMin(d)} 分</small></div>` : ''}
    </div>
    <div class="r2"><span class="st ${st.state}">${esc(st.text)}</span>${kindTxt ? `<span class="kt">${esc(kindTxt)}</span>` : ''}</div>
    ${p.note ? `<p class="note">${esc(p.note)}</p>` : ''}
    <div class="r3">
      <a class="btn pri" href="${navUrl(p)}" target="_blank" rel="noopener">🧭 導航</a>
      <button class="btn ${m.visited ? 'ok' : ''}" data-act="visit">${m.visited ? '✓ 去過了' : '○ 去過'}</button>
      ${S.edit ? '<button class="btn" data-act="place-edit">✎</button>' : ''}
    </div>
    ${m.visited ? `<input class="rv" data-act="review" maxlength="80" placeholder="寫一句短評…" value="${esc(m.review)}">` : ''}
    ${open ? `<div class="more">
      ${p.address ? `<p>📍 ${esc(p.address)}</p>` : ''}
      ${p.hours ? `<p>🕒 ${summarize(p.hours).map(esc).join('<br>')}</p>` : '<p class="muted">🕒 未填營業時間</p>'}
      ${p.gmapsUrl ? `<p><a href="${esc(p.gmapsUrl)}" target="_blank" rel="noopener">在 Google 地圖查看評論 ↗</a></p>` : ''}
    </div>` : ''}
  </article>`;
}

function saveText() { return { pending: '…', saving: '儲存中', saved: '☁︎ 已儲存', error: '⚠︎ 未儲存' }[S.saveSt] || ''; }
store.onStatus((st, msg) => {
  S.saveSt = st; const el = $('#savest'); if (el) { el.className = 'savest ' + st; el.textContent = saveText(); }
  if (st === 'error') toast(msg);
});

// ---------- 地圖 ----------
let map = null, leaflet = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  return leaflet ||= new Promise((res, rej) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'js/vendor/leaflet.css'; document.head.appendChild(l);
    const s = document.createElement('script'); s.src = 'js/vendor/leaflet.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
}
const baseTiles = () => window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
async function drawMap(list, o) {
  const el = $('#map'); if (!el) return;
  try { await loadLeaflet(); } catch { el.innerHTML = '<p class="muted pad">地圖載入失敗</p>'; return; }
  if (!document.body.contains(el)) return;
  if (map) { map.remove(); map = null; }
  const L = window.L;
  map = L.map(el, { zoomControl: false, attributionControl: true }).setView([o?.lat ?? 0, o?.lng ?? 0], 14);
  baseTiles().addTo(map);
  const pts = [];
  list.forEach(x => {
    const first = tagOf(x.p.tags.find(i => tagOf(i)?.group === 'list'));
    L.circleMarker([x.p.lat, x.p.lng], { radius: 10, color: '#fff', weight: 2, fillColor: first?.id === 'shop' ? '#2d6cdf' : '#b4502d', fillOpacity: 1 })
      .addTo(map).bindPopup(`<b>${esc(x.p.name)}</b><br>${x.d != null ? fmtDist(x.d) + '　' : ''}<a href="${navUrl(x.p)}" target="_blank" rel="noopener">導航</a>`);
    pts.push([x.p.lat, x.p.lng]);
  });
  if (o) { L.circleMarker([o.lat, o.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#1a1a1a', fillOpacity: 1 }).addTo(map); pts.push([o.lat, o.lng]); }
  if (pts.length > 1) map.fitBounds(pts, { padding: [30, 30], maxZoom: 16 });
  else if (pts.length === 1) map.setView(pts[0], 15);
}

// ---------- Sheet（浮動面板） ----------
function openSheet(type, F = {}) { S.sheet = { type, F }; renderSheet(); }
function closeSheet() { S.sheet = null; $('#sheet-root').innerHTML = ''; document.body.classList.remove('noscroll'); }
let pickMap = null;
function renderSheet() {
  const sh = S.sheet; if (!sh) return;
  const root = $('#sheet-root'), prev = root.querySelector('.sheet')?.scrollTop || 0;
  const body = { origin: originSheet, trips: tripsSheet, settings: settingsSheet, place: placeForm, anchor: anchorForm, trip: tripForm }[sh.type];
  root.innerHTML = `<div class="backdrop" data-act="close"></div><div class="sheet" role="dialog">${sh.pick ? pickHtml() : body()}</div>`;
  document.body.classList.add('noscroll');
  const sc = root.querySelector('.sheet'); if (sc) sc.scrollTop = prev;
  if (sh.pick) initPick();
}

function originSheet() {
  const t = trip(), cur = S.origin;
  return `<h2>從哪裡出發？</h2>
  <button class="opt ${cur?.type === 'gps' ? 'on' : ''}" data-act="origin-gps">📡 <span>我的位置（GPS）</span></button>
  ${t.anchors.map(a => `<div class="opt ${cur?.type === 'anchor' && cur.id === a.id ? 'on' : ''}" data-act="origin-anchor" data-v="${a.id}">🏨 <span>${esc(a.name)}</span>
    ${S.edit ? `<button class="x" data-act="anchor-del" data-v="${a.id}" aria-label="刪除">✕</button>` : ''}</div>`).join('')}
  ${S.edit ? '<button class="opt add" data-act="anchor-new">＋ 新增基地點（飯店、車站…）</button>' : (t.anchors.length ? '' : '<p class="muted">這趟旅程還沒有基地點。</p>')}
  <button class="btn wide" data-act="close">關閉</button>`;
}

function tripsSheet() {
  return `<h2>選擇旅程</h2>
  ${S.data.trips.map(t => `<button class="opt ${t.id === S.tripId ? 'on' : ''}" data-act="trip-pick" data-v="${t.id}">✈️ <span>${esc(t.name)}<small>${esc(t.tz)}</small></span></button>`).join('')}
  ${S.edit ? '<button class="opt add" data-act="trip-new">＋ 新旅程</button><button class="opt add" data-act="trip-edit">✎ 修改目前旅程</button>' : ''}
  <button class="btn wide" data-act="close">關閉</button>`;
}

function tripForm() {
  const F = S.sheet.F;
  return `<h2>${F.id ? '修改旅程' : '新旅程'}</h2>
  <label>名稱<input data-f="name" value="${esc(F.name)}" placeholder="例：北義自駕 2026/09"></label>
  <label>當地時區（判斷營業用）<input data-f="tz" list="tzs" value="${esc(F.tz)}"><datalist id="tzs">${TZS.map(z => `<option value="${z}">`).join('')}</datalist></label>
  <div class="row2b"><button class="btn pri" data-act="trip-save">儲存</button><button class="btn" data-act="close">取消</button></div>`;
}

function settingsSheet() {
  const c = store.getCfg() || { ...store.guessRepo(), token: '' };
  const connected = store.hasToken();
  return `<h2>設定</h2>
  <p class="muted">${connected ? '已連線 GitHub，可編輯。' : '目前是檢視模式。只有你（管理者）需要連線才能新增／修改店家。'}</p>
  <details ${connected ? '' : 'open'}><summary>GitHub 連線（管理者用）</summary>
    <label>Owner<input data-f="owner" value="${esc(c.owner)}" autocapitalize="off"></label>
    <label>Repo<input data-f="repo" value="${esc(c.repo)}" autocapitalize="off"></label>
    <label>Branch<input data-f="branch" value="${esc(c.branch || 'main')}" autocapitalize="off"></label>
    <label>Token（Contents 讀寫）<input data-f="token" type="password" value="${esc(c.token)}" autocomplete="off"></label>
    <div class="row2b"><button class="btn pri" data-act="cfg-save">儲存並連線</button>${connected ? '<button class="btn" data-act="cfg-clear">中斷連線</button>' : ''}</div>
    ${connected ? '<button class="btn wide" data-act="cfg-link">🔗 複製「新裝置設定連結」</button><p class="muted small">連結含 Token，等同密碼，只傳給自己，用完刪除訊息。</p>' : ''}
  </details>
  <p class="muted small">資料來源：${{ api: 'GitHub（最新）', site: '網站', cache: '本機快取（離線）' }[S.from] || '—'}　・　「去過」與短評：${S.edit ? '寫入雲端' : '只存在這支手機'}</p>
  <button class="btn wide" data-act="close">關閉</button>`;
}

// 位置選擇區塊（店家與基地點共用）
function locBlock(F) {
  return `<div class="loc">
    ${F.lat != null ? `<div class="okbox">📍 已定位　<small>${esc((F.address || '').slice(0, 44)) || F.lat.toFixed(5) + ', ' + F.lng.toFixed(5)}</small></div>` : '<div class="warnbox">尚未設定位置</div>'}
    <div class="row"><input data-f="q" placeholder="搜尋店名或地址（日文更準）" value="${esc(F.q || '')}"><button class="btn" data-act="loc-search">搜尋</button></div>
    ${F.busy ? '<p class="muted">搜尋中…</p>' : ''}
    ${F.results ? `<ul class="results">${F.results.map((r, i) => `<li data-act="loc-pick" data-i="${i}"><b>${esc(r.name)}</b><small>${esc(r.address)}</small></li>`).join('') || '<li class="muted">找不到，換個關鍵字，或用下面的方式</li>'}</ul>` : ''}
    <div class="row"><button class="btn" data-act="loc-gps">用目前位置</button><button class="btn" data-act="loc-map">地圖點選</button></div>
    <div class="row"><input data-f="gurl" placeholder="或貼上 Google 地圖連結" value="${esc(F.gurl || '')}"><button class="btn" data-act="loc-url">解析</button></div>
  </div>`;
}

function placeForm() {
  const F = S.sheet.F, tags = S.data.tags;
  const lists = tags.filter(t => t.group === 'list'), kinds = tags.filter(t => t.group === 'kind');
  return `<h2>${F.id ? '編輯店家' : '新增店家'}</h2>
  <label>名稱<input data-f="name" value="${esc(F.name)}" placeholder="例：一蘭 道頓堀店"></label>
  <label>當地名稱（選填）<input data-f="nameLocal" value="${esc(F.nameLocal)}"></label>
  <div class="lab">位置</div>${locBlock(F)}
  <div class="lab">清單</div>
  <div class="chips wrap">${lists.map(t => `<button class="chip ${F.list === t.id ? 'on' : ''}" data-act="f-list" data-v="${t.id}">${t.emoji} ${esc(t.label)}</button>`).join('')}</div>
  <div class="lab">類型（可複選）</div>
  <div class="chips wrap">${kinds.map(t => `<button class="chip ${F.kinds.includes(t.id) ? 'on' : ''}" data-act="f-pkind" data-v="${t.id}">${t.emoji} ${esc(t.label)}</button>`).join('')}</div>
  <div class="row"><input data-f="newKind" placeholder="新增類型，如 🍣 壽司" value="${esc(F.newKind || '')}"><button class="btn" data-act="f-addkind">加入</button></div>
  <div class="lab">營業時間</div>
  <textarea data-f="hoursText" rows="3" placeholder="例：11:00-22:00　（或直接貼上 Google 地圖的營業時間）">${esc(F.hoursText)}</textarea>
  <div class="lab small">公休日（只填一個時段時用）</div>
  <div class="chips wrap">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button class="chip ${F.closed.includes(d) ? 'on' : ''}" data-act="f-closed" data-v="${d}">${DAYS[d]}</button>`).join('')}</div>
  <div id="hp" class="hint">${hoursPreview(F)}</div>
  <label>備註（想吃什麼、注意事項）<input data-f="note" value="${esc(F.note)}"></label>
  <div class="row2b"><button class="btn pri" data-act="place-save">儲存</button><button class="btn" data-act="close">取消</button></div>
  ${F.id ? `<button class="btn danger wide" data-act="place-del">${F.confirmDel ? '再按一次確定刪除' : '刪除這間店'}</button>` : ''}`;
}
function hoursPreview(F) {
  if (!F.hoursText?.trim()) return '不填也可以（就不會顯示營業狀態）';
  const w = parseHours(F.hoursText, F.closed);
  return w ? '✓ 辨識為：' + summarize(w).map(esc).join('；') : '⚠︎ 看不懂這個格式，請用 11:00-22:00，或貼上 Google 地圖的營業時間';
}
function anchorForm() {
  const F = S.sheet.F;
  return `<h2>新增基地點</h2>
  <label>名稱<input data-f="name" value="${esc(F.name)}" placeholder="例：心齋橋日航酒店"></label>
  <div class="lab">位置</div>${locBlock(F)}
  <div class="row2b"><button class="btn pri" data-act="anchor-save">儲存</button><button class="btn" data-act="close">取消</button></div>`;
}

function pickHtml() {
  return `<h2>在地圖上點選位置</h2><div id="pickmap"></div><p class="muted small">點一下地圖放置圖釘，可拖曳放大縮小。</p>
  <div class="row2b"><button class="btn pri" data-act="pick-ok">確定</button><button class="btn" data-act="pick-cancel">返回</button></div>`;
}
async function initPick() {
  const el = $('#pickmap'); if (!el) return;
  try { await loadLeaflet(); } catch { el.innerHTML = '<p class="muted pad">地圖載入失敗</p>'; return; }
  const F = S.sheet.F, L = window.L, o = originPt() || trip()?.anchors[0];
  const c = F.lat != null ? [F.lat, F.lng] : [o?.lat ?? 35.68, o?.lng ?? 139.76];
  if (pickMap) { pickMap.remove(); pickMap = null; }
  pickMap = L.map(el, { zoomControl: true }).setView(c, F.lat != null ? 17 : 15);
  baseTiles().addTo(pickMap);
  let mk = F.lat != null ? L.marker(c).addTo(pickMap) : null;
  pickMap.on('click', e => { if (mk) mk.setLatLng(e.latlng); else mk = L.marker(e.latlng).addTo(pickMap); S.sheet.picked = e.latlng; });
}

// ---------- 事件 ----------
const H = {
  close: () => closeSheet(),
  list: (el) => { S.list = el.dataset.v; render(); },
  'f-open': () => { S.openOnly = !S.openOnly; render(); },
  'f-unv': () => { S.unvisited = !S.unvisited; render(); },
  'f-rad': () => { S.radius = RADII[(RADII.indexOf(S.radius) + 1) % RADII.length]; saveUi(); render(); },
  'f-kind': (el) => { const v = el.dataset.v; S.kinds.has(v) ? S.kinds.delete(v) : S.kinds.add(v); render(); },
  view: (el) => { S.view = el.dataset.v; render(); },
  expand: (el, id) => { S.expanded = S.expanded === id ? null : id; render(); },
  visit: (el, id) => { const p = placeOf(id), m = mark(p); setMark(p, { visited: !m.visited }); render(); },
  regps: (el, id, e) => { e.stopPropagation(); locate(); },
  origin: () => openSheet('origin'),
  'origin-gps': () => { S.origin = { type: 'gps' }; saveUi(); closeSheet(); locate(); },
  'origin-anchor': (el) => { S.origin = { type: 'anchor', id: el.dataset.v }; saveUi(); closeSheet(); render(); },
  trips: () => openSheet('trips'),
  'trip-pick': (el) => { S.tripId = el.dataset.v; S.list = 'all'; S.kinds.clear(); S.origin = defaultOrigin(); saveUi(); closeSheet(); render(); },
  'toggle-edit': () => { S.edit = !S.edit; editOff = !S.edit; saveUi(); render(); toast(S.edit ? '編輯模式：修改會存到雲端' : '檢視模式'); },
  settings: () => openSheet('settings', { ...(store.getCfg() || store.guessRepo()) }),

  // 旅程
  'trip-new': () => openSheet('trip', { name: '', tz: 'Asia/Tokyo' }),
  'trip-edit': () => { const t = trip(); openSheet('trip', { id: t.id, name: t.name, tz: t.tz }); },
  'trip-save': () => {
    const F = S.sheet.F; if (!F.name.trim()) return toast('請輸入旅程名稱');
    try { new Intl.DateTimeFormat('en', { timeZone: F.tz.trim() }); } catch { return toast('時區格式不對，例：Asia/Tokyo'); }
    if (F.id) { const t = trip(); t.name = F.name.trim(); t.tz = F.tz.trim(); }
    else { const t = { id: uid(), name: F.name.trim(), country: '', tz: F.tz.trim(), anchors: [] }; S.data.trips.push(t); S.tripId = t.id; S.origin = null; S.list = 'all'; S.kinds.clear(); }
    persist(); saveUi(); closeSheet(); render();
  },

  // 基地點
  'anchor-new': () => openSheet('anchor', { name: '', lat: null, lng: null, q: '' }),
  'anchor-save': () => {
    const F = S.sheet.F; if (!F.name.trim()) return toast('請輸入名稱'); if (F.lat == null) return toast('請先設定位置');
    const a = { id: uid(), name: F.name.trim(), lat: F.lat, lng: F.lng }; trip().anchors.push(a);
    S.origin = { type: 'anchor', id: a.id }; persist(); saveUi(); closeSheet(); render();
  },
  'anchor-del': (el, id, e) => {
    e.stopPropagation(); const t = trip(); t.anchors = t.anchors.filter(a => a.id !== el.dataset.v);
    if (S.origin?.id === el.dataset.v) S.origin = defaultOrigin(); persist(); saveUi(); renderSheet(); render();
  },

  // 店家
  'place-new': () => {
    const o = originPt();
    openSheet('place', { name: '', nameLocal: '', lat: null, lng: null, address: '', list: S.list !== 'all' ? S.list : 'food', kinds: [], hoursText: '', closed: [], note: '', gmapsUrl: '', q: '', near: o });
  },
  'place-edit': (el, id) => {
    const p = placeOf(id), lt = p.tags.find(i => tagOf(i)?.group === 'list');
    openSheet('place', { id, name: p.name, nameLocal: p.nameLocal || '', lat: p.lat, lng: p.lng, address: p.address || '', list: lt || 'food',
      kinds: p.tags.filter(i => tagOf(i)?.group === 'kind'), hoursText: p.hoursText || (p.hours ? summarize(p.hours).join('\n') : ''), closed: p.closed || [], note: p.note || '', gmapsUrl: p.gmapsUrl || '', q: '' });
  },
  'f-list': (el) => { S.sheet.F.list = el.dataset.v; renderSheet(); },
  'f-pkind': (el) => { const k = S.sheet.F.kinds, v = el.dataset.v; const i = k.indexOf(v); i < 0 ? k.push(v) : k.splice(i, 1); renderSheet(); },
  'f-closed': (el) => { const k = S.sheet.F.closed, v = +el.dataset.v; const i = k.indexOf(v); i < 0 ? k.push(v) : k.splice(i, 1); renderSheet(); },
  'f-addkind': () => {
    const F = S.sheet.F, raw = (F.newKind || '').trim(); if (!raw) return;
    const m = raw.match(/^(\p{Extended_Pictographic}️?)\s*(.*)$/u);
    const tag = { id: uid(), label: (m ? m[2] : raw) || raw, emoji: m ? m[1] : '🏷️', group: 'kind' };
    S.data.tags.push(tag); F.kinds.push(tag.id); F.newKind = ''; persist(); renderSheet();
  },
  'place-save': () => {
    const F = S.sheet.F;
    if (!F.name.trim()) return toast('請輸入名稱'); if (F.lat == null) return toast('請先設定位置');
    const hours = F.hoursText.trim() ? parseHours(F.hoursText, F.closed) : null;
    if (F.hoursText.trim() && !hours) return toast('營業時間格式看不懂，請修正或清空');
    const base = F.id ? placeOf(F.id) : { id: uid(), tripId: S.tripId };
    Object.assign(base, { name: F.name.trim(), nameLocal: F.nameLocal.trim(), lat: F.lat, lng: F.lng, address: F.address, tags: [F.list, ...F.kinds],
      hours, hoursText: F.hoursText.trim(), closed: F.closed.slice(), note: F.note.trim(), gmapsUrl: F.gmapsUrl || undefined });
    delete base.sample;
    if (!F.id) S.data.places.push(base);
    persist(); closeSheet(); render(); toast('已儲存');
  },
  'place-del': () => {
    const F = S.sheet.F; if (!F.confirmDel) { F.confirmDel = true; return renderSheet(); }
    S.data.places = S.data.places.filter(p => p.id !== F.id); persist(); closeSheet(); render();
  },

  // 位置選擇
  'loc-search': async () => {
    const F = S.sheet.F, q = (F.q || F.name || '').trim(); if (!q) return toast('請輸入要搜尋的名稱');
    F.q = q; F.busy = true; F.results = null; renderSheet();
    try { F.results = await search(q, F.near || originPt() || trip()?.anchors[0]); } catch { F.results = []; toast('搜尋失敗，請檢查網路'); }
    F.busy = false; renderSheet();
  },
  'loc-pick': (el) => {
    const F = S.sheet.F, r = F.results[+el.dataset.i];
    F.lat = r.lat; F.lng = r.lng; F.address = r.address; if (!F.name.trim()) F.name = r.name; F.results = null; renderSheet();
  },
  'loc-gps': () => {
    const F = S.sheet.F;
    if (!navigator.geolocation) return toast('此裝置不支援定位');
    navigator.geolocation.getCurrentPosition(pos => { F.lat = pos.coords.latitude; F.lng = pos.coords.longitude; F.address = F.address || ''; renderSheet(); },
      () => toast('定位失敗，請允許定位權限'), { enableHighAccuracy: true, timeout: 12000 });
  },
  'loc-map': () => { S.sheet.pick = true; S.sheet.picked = null; renderSheet(); },
  'pick-ok': () => { const s = S.sheet; if (s.picked) { s.F.lat = s.picked.lat; s.F.lng = s.picked.lng; } s.pick = false; renderSheet(); },
  'pick-cancel': () => { S.sheet.pick = false; renderSheet(); },
  'loc-url': () => {
    const F = S.sheet.F, r = parseMapsUrl(F.gurl);
    if (!r) return toast('請貼上以 http 開頭的 Google 地圖連結');
    F.gmapsUrl = r.url;
    if (r.lat != null) { F.lat = r.lat; F.lng = r.lng; if (r.name && !F.name.trim()) F.name = r.name; toast('已從連結取得位置'); }
    else toast('短連結無法取得座標，已保存連結；請再用名稱搜尋或地圖點選');
    renderSheet();
  },

  // 設定
  'cfg-save': async () => {
    const F = S.sheet.F; const c = { owner: (F.owner ?? '').trim(), repo: (F.repo ?? '').trim(), branch: (F.branch ?? 'main').trim() || 'main', token: (F.token ?? '').trim() };
    if (!c.owner || !c.repo || !c.token) return toast('請填完整 Owner / Repo / Token');
    store.setCfg(c); editOff = false; await reload(); closeSheet(); S.edit = store.hasToken() && !S.loadErr; saveUi(); render();
    toast(S.loadErr ? S.loadErr : '已連線，可以編輯了');
  },
  'cfg-clear': () => { store.clearCfg(); S.edit = false; saveUi(); closeSheet(); render(); },
  'cfg-link': async () => {
    const c = store.getCfg(), b = btoa(unescape(encodeURIComponent(JSON.stringify(c)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const url = `${location.origin}${location.pathname}#setup=${b}`;
    try { await navigator.clipboard.writeText(url); toast('已複製設定連結'); } catch { prompt('複製這個連結：', url); }
  }
};

function defaultOrigin() { const t = trip(); return t?.anchors[0] ? { type: 'anchor', id: t.anchors[0].id } : { type: 'gps' }; }

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el || el.tagName === 'INPUT') return;
  const a = el.dataset.act, fn = H[a]; if (!fn) return;
  fn(el, el.closest('[data-id]')?.dataset.id, e);
});
document.addEventListener('input', e => {
  const el = e.target; if (!el.dataset.f || !S.sheet) return;
  S.sheet.F[el.dataset.f] = el.value;
  if (el.dataset.f === 'hoursText') { const hp = $('#hp'); if (hp) hp.innerHTML = hoursPreview(S.sheet.F); }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.act === 'review') { const id = el.closest('[data-id]').dataset.id; setMark(placeOf(id), { review: el.value.trim() }); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset.f === 'q') { e.preventDefault(); H['loc-search'](); }
  if (e.key === 'Enter' && e.target.dataset.act === 'review') e.target.blur();
});

// ---------- 啟動 ----------
function handleSetupHash() {
  const m = location.hash.match(/^#setup=(.+)$/); if (!m) return;
  try {
    const j = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')))));
    if (j.owner && j.repo && j.token) store.setCfg({ owner: j.owner, repo: j.repo, branch: j.branch || 'main', token: j.token });
  } catch { /* 忽略壞連結 */ }
  history.replaceState(null, '', location.pathname);
}
async function reload() {
  const { data, from, error } = await store.load();
  S.loadErr = error;
  if (data) { S.data = data; S.from = from; }
  if (!trip()) S.tripId = S.data.trips[0]?.id || null;
}
async function boot() {
  handleSetupHash();
  S.tripId = ui.tripId || null;
  $('#app').innerHTML = '<div class="empty"><p class="muted">載入中…</p></div>';
  await reload();
  if (!S.data.trips.some(t => t.id === S.tripId)) S.tripId = S.data.trips[0]?.id || null;
  S.edit = store.hasToken() && !editOff && !S.loadErr;
  if (!originPt() && S.origin?.type !== 'gps') S.origin = defaultOrigin();
  render();
  if (S.loadErr) toast(S.loadErr);
  if (S.origin?.type === 'gps') locate();
  setInterval(() => { if (!S.sheet && document.visibilityState === 'visible') render(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !S.sheet) { if (S.origin?.type === 'gps') locate(); else render(); } });
}
boot();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
