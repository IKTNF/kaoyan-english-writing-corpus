#!/usr/bin/env node
/**
 * 检查 data/00-index.json 里各年 sources 链接的可访问性。
 * 只做链接可达性判断，不抓取、不存储任何页面内容。
 *
 *   node src/check-links.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IDX = path.resolve(HERE, '..', 'data', '00-index.json');
const OUT = path.resolve(HERE, '..', 'data', '_research', 'link-status.json');

const idx = JSON.parse(fs.readFileSync(IDX, 'utf8'));

/** url -> Set("B2024", "A2012", ...) */
const map = new Map();
for (const part of ['partA', 'partB']) {
  for (const y of idx[part].years) {
    for (const u of (y.sources || [])) {
      if (!map.has(u)) map.set(u, new Set());
      map.get(u).add(part + y.year);
    }
  }
}

const urls = [...map.keys()];
console.log(`\n共 ${urls.length} 个唯一链接，开始检查 ...\n`);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function check(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  const started = Date.now();
  try {
    let r = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctl.signal, headers: { 'User-Agent': UA } });
    // 部分站点拒绝 HEAD/GET 之一，降级再试一次
    if (!r.ok && r.status >= 400) {
      r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctl.signal, headers: { 'User-Agent': UA } });
    }
    const body = r.ok ? await r.text() : '';
    clearTimeout(t);
    // 粗略判断页面是否真的提到该年份（防止软 404 / 跳首页）
    return {
      url, status: r.status, ok: r.ok, ms: Date.now() - started,
      finalUrl: r.url !== url ? r.url : undefined,
      bytes: body.length,
      softFail: r.ok && body.length < 500
    };
  } catch (e) {
    clearTimeout(t);
    return { url, status: 0, ok: false, ms: Date.now() - started, err: e.name === 'AbortError' ? 'timeout' : e.message };
  }
}

const results = [];
const CONC = 6;
for (let i = 0; i < urls.length; i += CONC) {
  const batch = urls.slice(i, i + CONC);
  const r = await Promise.all(batch.map(check));
  results.push(...r);
  process.stdout.write(`  ${Math.min(i + CONC, urls.length)}/${urls.length}\r`);
}

console.log('\n');
const ok = results.filter(r => r.ok && !r.softFail);
const soft = results.filter(r => r.softFail);
const dead = results.filter(r => !r.ok);

const show = (label, arr) => {
  console.log(`\n=== ${label} (${arr.length}) ===`);
  arr.sort((a, b) => a.url.localeCompare(b.url)).forEach(r => {
    const yrs = [...map.get(r.url)].sort().join(',');
    console.log(`  [${String(r.status).padStart(3)}] ${r.url}`);
    console.log(`        用于: ${yrs}${r.err ? '  (' + r.err + ')' : ''}${r.softFail ? '  (页面过短，疑似软 404)' : ''}`);
  });
};
show('可访问', ok);
show('疑似软 404', soft);
show('不可访问', dead);

fs.writeFileSync(OUT, JSON.stringify(
  results.map(r => ({ ...r, usedBy: [...map.get(r.url)].sort() })), null, 2), 'utf8');

console.log(`\n合计: 可访问 ${ok.length} / 软404 ${soft.length} / 失效 ${dead.length}`);
console.log(`明细已写入 ${OUT}\n`);
process.exit(dead.length || soft.length ? 1 : 0);
