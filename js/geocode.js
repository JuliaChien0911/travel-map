// 用 OpenStreetMap Nominatim 搜尋店名／地址（免 API Key）
export async function search(q, near) {
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.search = new URLSearchParams({ format: 'jsonv2', q, limit: '8', 'accept-language': 'zh-TW' });
  if (near) { const d = 0.4; u.searchParams.set('viewbox', `${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`); }
  const r = await fetch(u);
  if (!r.ok) throw new Error('搜尋失敗');
  return (await r.json()).map(x => ({ name: x.name || x.display_name.split(',')[0], address: x.display_name, lat: +x.lat, lng: +x.lon }));
}

// 解析 Google 地圖長連結（短網址 maps.app.goo.gl 無法在瀏覽器解析，只會保留連結）
export function parseMapsUrl(s) {
  const t = (s || '').trim();
  if (!/^https?:\/\//i.test(t)) return null;
  const m = t.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ||
    t.match(/[?&](?:q|ll|destination|query)=(-?\d+\.\d+)(?:,|%2C)(-?\d+\.\d+)/);
  const nm = t.match(/\/place\/([^/@?]+)/);
  let name = null;
  if (nm) { try { name = decodeURIComponent(nm[1].replace(/\+/g, ' ')); } catch { name = nm[1]; } }
  return { url: t, lat: m ? +m[1] : null, lng: m ? +m[2] : null, name };
}
