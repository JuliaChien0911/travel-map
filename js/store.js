// 資料讀寫：一般使用者讀 data.json；編輯者用 GitHub Token 直接讀寫同一個 repo 的 data.json
const K = { cfg: 'tm.cfg', cache: 'tm.cache' };
export const jget = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
export const jset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 容量滿或無痕模式 */ } };

export const getCfg = () => jget(K.cfg, null);
export const setCfg = c => jset(K.cfg, c);
export const clearCfg = () => localStorage.removeItem(K.cfg);
export const hasToken = () => !!getCfg()?.token;

// 從網址推測 owner / repo（GitHub Pages：owner.github.io/repo/）
export function guessRepo() {
  const m = location.hostname.match(/^(.+)\.github\.io$/i);
  return { owner: m ? m[1] : '', repo: m ? (location.pathname.split('/')[1] || '') : '', branch: 'main' };
}

const api = (c, path) => `https://api.github.com/repos/${c.owner}/${c.repo}/contents/${path}`;
const hdr = c => ({ Authorization: `Bearer ${c.token}`, Accept: 'application/vnd.github+json' });
const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), ch => ch.charCodeAt(0)));
const b64enc = s => { let r = ''; new TextEncoder().encode(s).forEach(x => { r += String.fromCharCode(x); }); return btoa(r); };

let sha = null, timer = null, chain = Promise.resolve(), statusCb = () => {};
export const onStatus = f => { statusCb = f; };

export async function load() {
  const c = getCfg();
  let data = null, from = '', error = '';
  if (c?.token) {
    try {
      const r = await fetch(`${api(c, 'data.json')}?ref=${encodeURIComponent(c.branch)}&t=${Date.now()}`, { headers: hdr(c) });
      if (r.ok) { const j = await r.json(); data = JSON.parse(b64dec(j.content)); sha = j.sha; from = 'api'; }
      else if (r.status === 401 || r.status === 403) error = 'Token 無效或沒有權限';
      else if (r.status !== 404) error = `GitHub 回應 ${r.status}`;
    } catch { error = '無法連到 GitHub'; }
  }
  if (!data) {
    try { const r = await fetch(`data.json?t=${Date.now()}`, { cache: 'no-store' }); if (r.ok) { data = await r.json(); from = 'site'; } } catch { /* 離線 */ }
  }
  if (!data) { data = jget(K.cache, null); if (data) from = 'cache'; }
  if (data) jset(K.cache, data);
  return { data, from, error };
}

export function scheduleSave(data) {
  jset(K.cache, data);
  if (!hasToken()) return;
  statusCb('pending');
  clearTimeout(timer);
  timer = setTimeout(() => { chain = chain.then(() => doSave(data)).catch(() => {}); }, 700);
}

async function put(c, data) {
  return fetch(api(c, 'data.json'), {
    method: 'PUT', headers: hdr(c),
    body: JSON.stringify({ message: 'update places', content: b64enc(JSON.stringify(data, null, 1)), branch: c.branch, ...(sha ? { sha } : {}) })
  });
}
async function doSave(data) {
  const c = getCfg(); if (!c?.token) return;
  statusCb('saving');
  try {
    let r = await put(c, data);
    if (r.status === 409 || r.status === 422) {
      const g = await fetch(`${api(c, 'data.json')}?ref=${encodeURIComponent(c.branch)}&t=${Date.now()}`, { headers: hdr(c) });
      sha = g.ok ? (await g.json()).sha : null;
      r = await put(c, data);
    }
    if (!r.ok) { statusCb('error', r.status === 401 || r.status === 403 ? 'Token 沒有寫入權限' : `儲存失敗（${r.status}）`); return; }
    sha = (await r.json()).content.sha;
    statusCb('saved');
  } catch { statusCb('error', '網路不通，稍後會再試（資料已暫存在本機）'); }
}
