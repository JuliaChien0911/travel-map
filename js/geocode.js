// 用 OpenStreetMap Nominatim 搜尋店名／地址（免 API Key）
const isAddr = q => /[縣市區鄉鎮]/.test(q) && /[路街段巷弄號]/.test(q);
// OSM 的台灣地名用「臺」，把「台中市」這類寫法換成「臺中市」才找得到
const norm = q => q.replace(/台(?=[中北南東灣])/g, '臺');

export async function search(q, near) {
  const run = async (query, mode) => {
    const u = new URL('https://nominatim.openstreetmap.org/search');
    u.search = new URLSearchParams({ format: 'jsonv2', q: query, limit: '8', 'accept-language': 'zh-TW', countrycodes: '' });
    u.searchParams.delete('countrycodes');
    if (near && mode !== 'free') {
      const d = mode === 'bounded' ? 0.5 : 2;   // 店名：先找附近約 50 公里，再放寬
      u.searchParams.set('viewbox', `${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`);
      if (mode === 'bounded') u.searchParams.set('bounded', '1');
    }
    const r = await fetch(u);
    if (!r.ok) throw new Error('搜尋失敗');
    return (await r.json()).map(x => ({ name: x.name || x.display_name.split(',')[0], address: x.display_name, lat: +x.lat, lng: +x.lon }));
  };
  // 地址：自己已經寫了縣市區，不要用位置限制，並依序退回較粗的寫法（去掉郵遞區號、里、門牌）
  if (isAddr(q)) {
    const a = norm(q), tries = [a, simplify(a)].filter((x, i, arr) => x && arr.indexOf(x) === i);
    for (const t of tries) { const r = await run(t, 'free'); if (r.length) return r; }
    return [];
  }
  // 店名：優先找旅程附近
  const r1 = near ? await run(q, 'bounded') : [];
  if (r1.length) return r1;
  const r2 = await run(q, 'wide');
  return r2;
}

// 解析 Google 地圖長連結（短網址 maps.app.goo.gl 無法在瀏覽器解析，只會保留連結）
export function parseMapsUrl(s) {
  const t = (s || '').trim().replace(/[（）()]/g, '');
  const c = t.match(/^(-?\d{1,3}\.\d+)\s*[,，\s]\s*(-?\d{1,3}\.\d+)$/);   // 直接貼座標：23.0353, 120.1478
  if (c && Math.abs(+c[1]) <= 90 && Math.abs(+c[2]) <= 180) return { url: null, lat: +c[1], lng: +c[2], name: null };
  if (!/^https?:\/\//i.test(t)) return null;
  const m = t.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ||
    t.match(/[?&](?:q|ll|destination|query)=(-?\d+\.\d+)(?:,|%2C)(-?\d+\.\d+)/);
  const nm = t.match(/\/place\/([^/@?]+)/);
  let name = null;
  if (nm) { try { name = decodeURIComponent(nm[1].replace(/\+/g, ' ')); } catch { name = nm[1]; } }
  return { url: t, lat: m ? +m[1] : null, lng: m ? +m[2] : null, name };
}

// 找不到精確門牌時，去掉門牌／樓層，退而求其次找到路段
export function simplify(q) {
  return (q || '').replace(/^\s*\d{3,6}\s*/, '').replace(/([區鄉鎮市])[\u4e00-\u9fff]{1,3}里(?=[\u4e00-\u9fff]+[路街])/, '$1').replace(/[0-9０-９]+(之[0-9]+)?\s*號.*$/, '').replace(/[0-9０-９]+\s*(樓|F|f).*$/, '').replace(/\s+/g, ' ').trim();
}
