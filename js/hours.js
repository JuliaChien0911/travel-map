// 營業時間：w = 長度 7 的陣列（0=週日…6=週六），每天是 [["11:00","22:00"], ...]，空陣列＝公休
export const DAYS = ['日', '一', '二', '三', '四', '五', '六'];
const pad = n => String(n).padStart(2, '0');
export const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
const fmt = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

// 取得「旅程當地時區」的星期與分鐘數
export function nowInTz(tz, d = new Date()) {
  const opt = { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  let parts;
  try { parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opt }).formatToParts(d); }
  catch { parts = new Intl.DateTimeFormat('en-US', opt).formatToParts(d); }
  const g = t => parts.find(x => x.type === t)?.value;
  const day = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[g('weekday')];
  return { day, min: (+g('hour') % 24) * 60 + +g('minute') };
}

export function statusOf(w, now) {
  if (!w) return { state: 'unknown', text: '營業時間未填' };
  const today = w[now.day] || [], yest = w[(now.day + 6) % 7] || [];
  const openRes = (left, o, c) => {
    if (o === '00:00' && c === '24:00') return { state: 'open', text: '營業中・24 小時' };
    return left <= 60 ? { state: 'closing', text: `即將打烊・${c}` } : { state: 'open', text: `營業中・至 ${c}` };
  };
  for (const [o, c] of yest) { const om = toMin(o), cm = toMin(c); if (cm <= om && now.min < cm) return openRes(cm - now.min, o, c); }
  for (const [o, c] of today) {
    const om = toMin(o); let cm = toMin(c); if (cm <= om) cm += 1440;
    if (now.min >= om && now.min < cm) return openRes(cm - now.min, o, c);
  }
  const later = today.map(([o]) => toMin(o)).filter(m => m > now.min).sort((a, b) => a - b)[0];
  if (later != null) return { state: 'closed', text: `休息中・${fmt(later)} 開` };
  for (let i = 1; i <= 7; i++) {
    const d = (now.day + i) % 7, r = w[d] || [];
    if (r.length) return { state: 'closed', text: `${today.length ? '已打烊' : '今日公休'}・${i === 1 ? '明天' : '週' + DAYS[d]} ${r[0][0]} 開` };
  }
  return { state: 'closed', text: '公休' };
}

export function summarize(w) {
  if (!w) return [];
  const t = d => w[d].length ? w[d].map(r => r.join('–')).join('、') : '公休';
  const order = [1, 2, 3, 4, 5, 6, 0], all = order.map(t);
  if (all.every(x => x === all[0])) return [`每天 ${all[0]}`];
  const out = []; let i = 0;
  while (i < 7) {
    let j = i; while (j + 1 < 7 && all[j + 1] === all[i]) j++;
    const a = DAYS[order[i]], b = DAYS[order[j]];
    out.push(`${i === j ? '週' + a : `週${a}–${b}`} ${all[i]}`); i = j + 1;
  }
  return out;
}

// ---- 解析使用者輸入 ----
const ZH = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
const EN = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const TIME = /(上午|下午|晚上|凌晨)?\s*(\d{1,2}):(\d{2})\s*(AM|PM)?\s*-\s*(上午|下午|晚上|凌晨)?\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/gi;
function to24(zh, h, m, ap) {
  h = +h; ap = ap && ap.toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  if ((zh === '下午' || zh === '晚上') && h < 12) h += 12;
  if (zh === '凌晨' && h === 12) h = 0;
  return `${pad(h)}:${m}`;
}
function ranges(s) {
  const t = s.replace(/[–—~～〜−]/g, '-').replace(/(\d)\s*[至到]\s*(?=[上下晚凌\d])/g, '$1-');
  const out = [];
  for (const x of t.matchAll(TIME)) out.push([to24(x[1], x[2], x[3], x[4]), to24(x[5], x[6], x[7], x[8])]);
  return out;
}
function expand(a, b) { const l = [a]; let d = a; if (b == null) return l; while (d !== b && l.length < 8) { d = (d + 1) % 7; l.push(d); } return l; }
function dayRange(line) {
  let m = line.match(/(?:星期|週|周|禮拜|礼拜)\s*([日天一二三四五六])(?:\s*(?:-|–|—|~|至|到)\s*(?:星期|週|周|禮拜|礼拜)?\s*([日天一二三四五六]))?/);
  if (m) return expand(ZH[m[1]], m[2] != null ? ZH[m[2]] : null);
  m = line.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b(?:\s*(?:-|–|—|to)\s*(sun|mon|tue|wed|thu|fri|sat)[a-z]*)?/i);
  if (m) return expand(EN[m[1].toLowerCase()], m[2] ? EN[m[2].toLowerCase()] : null);
  return null;
}
const CLOSED = /休|公休|定休|closed/i;

export function parseHours(text, closedDays = []) {
  text = (text || '').replace(/[   ]/g, ' ').replace(/：/g, ':').replace(/中午(\s*12:00)?/g, '12:00').replace(/午夜(\s*12:00)?/g, '24:00').trim();
  if (!text) return null;
  const w = Array.from({ length: 7 }, () => []);
  let labeled = false, cur = null;
  const plain = [];
  // Google 地圖常見：星期一 11:30–14:00 換行 15:00–22:30（第二段沒有星期），或星期與時間分兩行
  for (const line of text.split(/\n|;|；/)) {
    const days = dayRange(line);
    const is24 = /24\s*小時|24\s*hours|open 24/i.test(line);
    const r = is24 ? [['00:00', '24:00']] : ranges(line);
    if (days) {
      labeled = true; cur = days;
      days.forEach(d => { w[d] = r.slice(); });
    } else if (cur && r.length) cur.forEach(d => { w[d] = w[d].concat(r); });
    else if (!cur) plain.push(line);
  }
  if (labeled) return w;
  const ptxt = plain.join(' ');
  const r = /24\s*小時|24\s*hours/i.test(ptxt) ? [['00:00', '24:00']] : ranges(ptxt);
  if (!r.length) return null;
  return w.map((_, d) => closedDays.includes(d) ? [] : r);
}
