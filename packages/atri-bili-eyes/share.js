"use strict";
// Pure, bounded extraction. Never search arbitrary card titles or arbitrary URLs for BV.
const BV = 'BV1[A-Za-z0-9]{9}';
function videoRef(value, mini = false) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  let s = value.replace(/&amp;/g, '&').replace(/\\\//g, '/');
  if (mini && /^pages\/video\/video\?/.test(s)) {
    const p = new URLSearchParams(s.split('?')[1]);
    const b = p.get('bvid');
    if (b && new RegExp('^' + BV + '$').test(b)) return b;
    return null;
  }
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port) return null;
  if (['www.bilibili.com', 'm.bilibili.com', 'bilibili.com'].includes(u.hostname)) {
    const m = u.pathname.match(new RegExp('^/(?:s/)?video/(' + BV + ')(?:/|$)'));
    return m ? m[1] : null;
  }
  if (['b23.tv', 'bili2233.cn'].includes(u.hostname) && /^\/[A-Za-z0-9]{4,14}\/?$/.test(u.pathname))
    return 'https://' + u.hostname + u.pathname.replace(/\/$/, '');
  return null;
}
function parseCard(raw) {
  try {
    if (typeof raw === 'string' && raw.length > 32768) return [];
    const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!d || typeof d !== 'object') return [];
    const meta = d.meta || d.metaData;
    const detail = meta?.detail_1, news = meta?.news;
    const refs = [];
    for (const item of [detail?.qqdocurl, detail?.url, detail?.jumpUrl, news?.jumpUrl, news?.url]) {
      const ref = videoRef(item); if (ref) refs.push(ref);
    }
    if (String(detail?.appid || '') === '1109937557') {
      const ref = videoRef(detail?.qqdocurl, true); if (ref) refs.push(ref);
    }
    return refs;
  } catch { return []; }
}
function collect(session) {
  const refs = new Set(), texts = [];
  let nodes = 0;
  function walk(es, depth = 0) {
    if (depth > 6 || !Array.isArray(es)) return;
    for (const e of es) {
      if (++nodes > 100) return;
      if (e?.type === 'text') texts.push(String(e.attrs?.content || '').slice(0, 8192));
      else if (['json', 'onebot:json'].includes(e?.type)) {
        for (const ref of parseCard(e.attrs?.data)) refs.add(ref);
      } else if (!['quote', 'forward', 'message', 'xml', 'code'].includes(e?.type)) walk(e?.children, depth + 1);
    }
  }
  walk(session.elements);
  const text = texts.join('').slice(0, 8192).trim();
  // Slash/dot commands, fenced code and explicit no-read requests are never auto-read.
  if (/^(?:\/|bili\.|eyes\.|interlude\.)/i.test(text) || /`|\/bili\b|bili\.interact|bili\.browser|不要(?:看|读|解析)|别(?:看|读|解析)|不用(?:看|读|解析)|不需要(?:看|读|解析)/.test(text))
    return { text, refs: [], ignored: true };
  for (const m of text.matchAll(/https?:\/\/[^\s<>"'，。！？）】]+/g)) {
    const ref = videoRef(m[0]); if (ref) refs.add(ref);
  }
  const bare = text.replace(/https?:\/\/[^\s<>"']+/g, '');
  for (const m of bare.matchAll(new RegExp('(?<![A-Za-z0-9_])(' + BV + ')(?![A-Za-z0-9_])', 'g'))) refs.add(m[1]);
  return { text, refs: [...refs].slice(0, 4), ignored: false };
}
module.exports = { collect, parseCard, videoRef };
