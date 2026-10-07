#!/usr/bin/env node
/**
 * 实测「别人怎么拿到这个产物」的各种分发通道在**当前网络**下是否可用。
 * 只做可达性探测，不下载大文件。
 */
const R = 'IKTNF/kaoyan-english-writing-corpus';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const targets = [
  ['GitHub 网页（仓库主页）', `https://github.com/${R}`, 'page'],
  ['GitHub ZIP 下载', `https://codeload.github.com/${R}/zip/refs/heads/main`, 'zip'],
  ['GitHub API', `https://api.github.com/repos/${R}`, 'api'],
  ['GitHub Raw 直链', `https://raw.githubusercontent.com/${R}/main/index.html`, 'file'],
  ['GitHub Pages', `https://iktfn.github.io/${R}/`, 'page'],

  ['jsDelivr CDN（主站）', `https://cdn.jsdelivr.net/gh/${R}@main/index.html`, 'file'],
  ['jsDelivr（fastly）', `https://fastly.jsdelivr.net/gh/${R}@main/index.html`, 'file'],
  ['jsDelivr（gcore）', `https://gcore.jsdelivr.net/gh/${R}@main/index.html`, 'file'],
  ['jsDelivr（testingcf）', `https://testingcf.jsdelivr.net/gh/${R}@main/index.html`, 'file'],
  ['Statically CDN', `https://cdn.statically.io/gh/${R}/main/index.html`, 'file'],
  ['raw.githack.com', `https://raw.githack.com/${R}/main/index.html`, 'file'],

  ['Gitee 码云（国内）', 'https://gitee.com', 'page'],
  ['gh-proxy 加速', `https://gh-proxy.com/https://raw.githubusercontent.com/${R}/main/index.html`, 'file'],
  ['ghproxy.net 加速', `https://ghproxy.net/https://raw.githubusercontent.com/${R}/main/index.html`, 'file'],
  ['gitclone 加速', 'https://gitclone.com', 'page'],
];

async function probe([name, url, kind]) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 25000);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctl.signal, redirect: 'follow' });
    clearTimeout(t);
    const ct = r.headers.get('content-type') || '';
    let note = `HTTP ${r.status}`;
    if (kind === 'file' && r.ok) {
      const txt = await r.text();
      const isOurs = txt.includes('考研英语一') || txt.includes('corpus-data') || txt.includes('perseverance');
      note += ` · ${(txt.length / 1024).toFixed(0)}KB · ${isOurs ? '内容正确✓' : '内容不符✗'}`;
      if (ct) note += ` · ${ct.split(';')[0]}`;
    } else if (kind === 'zip' && r.ok) {
      const buf = await r.arrayBuffer();
      note += ` · ${(buf.byteLength / 1024 / 1024).toFixed(2)}MB · ${buf.byteLength > 100000 ? '可下载✓' : '内容异常✗'}`;
    }
    return { name, url, ok: r.ok, ms: Date.now() - t0, note };
  } catch (e) {
    clearTimeout(t);
    return { name, url, ok: false, ms: Date.now() - t0, note: e.name === 'AbortError' ? '超时（不可达）' : '不可达: ' + e.message.slice(0, 40) };
  }
}

console.log('\n正在逐个探测（每个最多 25 秒）...\n');
const out = [];
for (const t of targets) {
  const r = await probe(t);
  out.push(r);
  console.log(`  ${r.ok ? 'v' : 'x'} ${r.name.padEnd(24)} ${r.note.padEnd(46)} ${r.ms}ms`);
}

console.log('\n=== 结论 ===');
console.log('  可用：' + out.filter(r => r.ok).map(r => r.name).join(' / '));
console.log('  不可用：' + out.filter(r => !r.ok).map(r => r.name).join(' / '));
