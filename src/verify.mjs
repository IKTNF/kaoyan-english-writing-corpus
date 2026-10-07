#!/usr/bin/env node
/**
 * 用 Edge/Chrome 的 DevTools 协议真实打开 index.html，检查：
 *   · 页面是否有 JS 异常 / console 报错
 *   · 卡片是否真的渲染出来
 *   · 搜索、背诵模式、分类切换、收藏/掌握等核心功能是否工作
 * 用法: node src/verify.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TARGET = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
const PORT = 9333;

const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
];
const BIN = CANDIDATES.find(p => fs.existsSync(p));
if (!BIN) { console.error('✗ 找不到 Edge/Chrome'); process.exit(1); }
if (!fs.existsSync(path.join(ROOT, 'index.html'))) { console.error('✗ 先运行 node src/build.mjs'); process.exit(1); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-verify-'));
const child = spawn(BIN, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--mute-audio',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1440,1000', 'about:blank'
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJSON(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) {}
    await sleep(250);
  }
  throw new Error('DevTools 端口未就绪: ' + url);
}

let ws, msgId = 0;
const pending = new Map();
const errors = [];
const logs = [];

function send(method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

try {
  await getJSON(`http://127.0.0.1:${PORT}/json/version`);
  const targets = await getJSON(`http://127.0.0.1:${PORT}/json/list`);
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('找不到 page target');

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = e => rej(new Error('WS 连接失败')); });

  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
      return;
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
    }    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' '));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      errors.push('[log] ' + m.params.entry.text);
    }
  };

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: TARGET });
  await sleep(2500);

  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval 失败: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };

  const out = await evaluate(`(() => {
    const vis = el => el && el.offsetParent !== null;
    const r = {};
    r.sections      = SECTIONS.length;
    r.totalEntries  = SECTIONS.reduce((n,s)=>n+s.entries.length,0);
    r.navItems      = document.querySelectorAll('.nav-i').length;
    r.cardsRendered = document.querySelectorAll('#list .card').length;
    r.firstEn       = (document.querySelector('#list .card .en')||{}).textContent || null;
    r.crumb         = document.querySelector('#crumb').textContent;
    r.brandSub      = document.querySelector('#brandSub').textContent;
    r.footerAll     = document.querySelector('#allN').textContent;
    r.hasLoadMore   = !!document.querySelector('#lm');
    r.indexNav      = [...document.querySelectorAll('.nav-i .n-t')].some(e=>e.textContent.includes('真题'));
    return r;
  })()`);

  const diag = await evaluate(`(() => ({
    typeofSECTIONS: typeof SECTIONS,
    typeofCORPUS: typeof CORPUS,
    typeofRender: typeof render,
    typeofRenderNav: typeof renderNav,
    typeofSt: typeof st,
    bodyPresent: !!document.body,
    themeBtn: !!document.querySelector('#themeBtn'),
    modeBtn: !!document.querySelector('#modeBtn'),
    allN: !!document.querySelector('#allN'),
    scripts: [...document.querySelectorAll('script')].map(s=>({id:s.id||'(none)', type:s.type||'text/javascript', len:s.textContent.length})),
    navExists: !!document.querySelector('#nav'),
    lsAccess: (()=>{ try { localStorage.getItem('x'); return 'ok'; } catch(e){ return 'THROWS: '+e.name; } })()
  }))()`);
  console.log('\n=== 诊断 ===');
  Object.entries(diag).forEach(([k, v]) => console.log('  ' + k.padEnd(15) + ' : ' + JSON.stringify(v)));

  console.log('\n=== 渲染检查 ===');
  Object.entries(out).forEach(([k, v]) => console.log('  ' + k.padEnd(15) + ' : ' + v));

  console.log('\n=== 交互检查 ===');
  const inter = {};
  const step = async (name, expr) => {
    try {
      const v = await evaluate(expr);
      inter[name] = v;
      console.log('  ' + name.padEnd(15) + ' : ' + JSON.stringify(v));
    } catch (e) {
      inter[name] = 'ERR: ' + e.message.split('\n')[0];
      console.log('  ' + name.padEnd(15) + ' : ✗ ' + e.message.split('\n')[0]);
    }
  };

  await step('navList', `[...document.querySelectorAll('.nav-i .n-t')].map(e=>e.textContent)`);
  await step('search', `(()=>{const s=document.querySelector('#search');s.value='perseverance';s.dispatchEvent(new Event('input'));
    return {cards:document.querySelectorAll('#list .card').length,
            hit:(document.querySelector('#list .card .en')||{}).textContent||null,
            marks:document.querySelectorAll('#list mark').length,
            crumb:document.querySelector('#crumb').textContent};})()`);
  await step('searchClear', `(()=>{const s=document.querySelector('#search');s.value='';s.dispatchEvent(new Event('input'));
    return document.querySelectorAll('#list .card').length;})()`);
  await step('navClick', `(()=>{const it=[...document.querySelectorAll('.nav-i')];const t=it.find(e=>e.textContent.includes('文化传承'));
    if(!t) return 'NO_TARGET'; t.click();
    return {crumb:document.querySelector('#crumb').textContent, cards:document.querySelectorAll('#list .card').length};})()`);
  await step('chineseSearch', `(()=>{[...document.querySelectorAll('.nav-i')].find(e=>e.textContent.includes('全部语料')).click();
    const s=document.querySelector('#search');s.value='坚持';s.dispatchEvent(new Event('input'));
    const n=document.querySelectorAll('#list .card').length; s.value='';s.dispatchEvent(new Event('input')); return n;})()`);
  await step('basicSearch', `(()=>{const s=document.querySelector('#search');s.value='important';s.dispatchEvent(new Event('input'));
    const n=document.querySelectorAll('#list .card').length;
    const badges=document.querySelectorAll('#list .b.basic').length;
    s.value='';s.dispatchEvent(new Event('input')); return {cards:n, basicBadges:badges};})()`);
  await step('masterStar', `(()=>{const c=document.querySelector('#list .card');c.querySelector('.done').click();
    const m=document.querySelector('#list .card').classList.contains('mastered');
    document.querySelector('#list .card').querySelector('.star').click();
    const st=document.querySelector('#list .card').classList.contains('starred');
    return {mastered:m, starred:st, doneN:document.querySelector('#doneN').textContent,
            pct:document.querySelector('#pctN').textContent, ls:!!localStorage.getItem('kaoyan-corpus-v1')};})()`);
  await step('recite', `(()=>{document.querySelector('#modeBtn').click();
    const on=document.body.classList.contains('recite');
    const c=document.querySelector('#list .card'); c.click();
    const rev=c.classList.contains('revealed');
    document.querySelector('#modeBtn').click();
    return {on,rev,off:!document.body.classList.contains('recite')};})()`);
  await step('starFilter', `(()=>{document.querySelector('#onlyStar').click();
    const n=document.querySelectorAll('#list .card').length; document.querySelector('#onlyStar').click(); return n;})()`);
  await step('idxBig', `(()=>{const t=[...document.querySelectorAll('.nav-i')].find(e=>e.textContent.includes('大作文真题'));t.click();
    return {crumb:document.querySelector('#crumb').textContent,
            cards:document.querySelectorAll('#list .yrcard').length,
            controls:document.querySelectorAll('#list .idxctl button').length,
            modelBtns:document.querySelectorAll('#list .modelbtn').length,
            notes:document.querySelectorAll('#list .idxnotes li').length,
            refs:document.querySelectorAll('#list .yrrefs a').length,
            firstRef:(document.querySelector('#list .yrrefs a')||{}).textContent||null,
            refHref:(document.querySelector('#list .yrrefs a')||{}).href||null,
            links:document.querySelectorAll('#list .lnk[data-sec]').length};})()`);
  await step('idxBigModel', `(()=>{const b=document.querySelector('#list .modelbtn');b.click();
    const box=document.querySelector('#list .model');
    const meta=box?box.querySelector('.mo-meta'):null;
    return {opened:!!box&&box.classList.contains('open'),
            label:b.textContent.trim(),
            meta:meta?meta.textContent.replace(/\\s+/g,' ').trim():null,
            enLen:box?box.querySelector('.mo-en').textContent.length:0,
            zhLen:box?box.querySelector('.mo-zh').textContent.length:0};})()`);
  await step('idxBigExpandAll', `(()=>{[...document.querySelectorAll('#list .idxctl button')].find(b=>b.dataset.act==='expand').click();
    const all=[...document.querySelectorAll('#list .model')];
    return {total:all.length, opened:all.filter(m=>m.classList.contains('open')).length};})()`);
  await step('idxBigCollapse', `(()=>{[...document.querySelectorAll('#list .idxctl button')].find(b=>b.dataset.act==='collapse').click();
    return [...document.querySelectorAll('#list .model')].filter(m=>m.classList.contains('open')).length;})()`);
  await step('idxSmall', `(()=>{const t=[...document.querySelectorAll('.nav-i')].find(e=>e.textContent.includes('小作文真题'));t.click();
    const types=[...document.querySelectorAll('#list .yrcard .yrtag')].map(e=>e.textContent.trim());
    return {crumb:document.querySelector('#crumb').textContent,
            cards:document.querySelectorAll('#list .yrcard').length,
            partA:document.querySelectorAll('#list .yrcard.partA').length,
            distinctTypes:[...new Set(types)].length,
            models:document.querySelectorAll('#list .modelbtn').length};})()`);
  await step('idxSearchInIndex', `(()=>{[...document.querySelectorAll('.nav-i')].find(e=>e.textContent.includes('大作文真题')).click();
    const s=document.querySelector('#search');s.value='龙舟';s.dispatchEvent(new Event('input'));
    const years=[...document.querySelectorAll('#list .yrcard')].map(c=>+c.dataset.year);
    const desc=document.querySelector('#list .desc').textContent.replace(/\\s+/g,' ').trim();
    s.value='';s.dispatchEvent(new Event('input'));
    s.value='important';s.dispatchEvent(new Event('input'));
    const noHit=document.querySelectorAll('#list .yrcard').length;
    s.value='';s.dispatchEvent(new Event('input'));
    return {years, desc, noHit};})()`);
  await step('indexJump', `(()=>{const l=document.querySelector('#list .lnk[data-sec]'); if(!l) return 'NO_LINK'; l.click();
    return {crumb:document.querySelector('#crumb').textContent, cards:document.querySelectorAll('#list .card').length};})()`);
  await step('variantBadge', `(()=>{[...document.querySelectorAll('.nav-i')].find(e=>e.textContent.includes('全部语料')).click();
    const s=document.querySelector('#search');s.value='integrity';s.dispatchEvent(new Event('input'));
    const cards=[...document.querySelectorAll('#list .card')];
    if(!cards.length) return {n:0, sameK:0};
    const k0=cards[0].dataset.k;
    const dupKey=Object.keys(VARIANTS).find(k=>k==='integrity')||k0;
    const same=cards.filter(c=>c.dataset.k===dupKey);
    const badges=same.map(c=>{const b=c.querySelector('.b.var');return b?b.textContent.trim():null;});
    if(same.length) same[0].querySelector('.done').click();
    const after=[...document.querySelectorAll('#list .card')].filter(c=>c.dataset.k===dupKey).map(c=>c.classList.contains('mastered'));
    [...document.querySelectorAll('#list .card')].forEach(c=>{const d=c.querySelector('.done');if(d.classList.contains('on'))d.click();});
    s.value='';s.dispatchEvent(new Event('input'));
    return {n:cards.length, sameK:same.length, badges, after};})()`);
  await step('globalKey', `(()=>{const k=Object.keys(VARIANTS).filter(x=>VARIANTS[x].length>1);
    return {uniqueExpr:UNIQUE, totalEntries:SECTIONS.reduce((n,s)=>n+s.entries.length,0), dupExpr:k.length};})()`);
  await step('theme', `(()=>{document.querySelector('#themeBtn').click();const d=document.body.classList.contains('dark');
    document.querySelector('#themeBtn').click();return {dark:d};})()`);
  await step('fontScale', `(()=>{document.querySelector('#fsUp').click();
    const v=getComputedStyle(document.documentElement).getPropertyValue('--fs').trim();
    document.querySelector('#fsDown').click(); return v;})()`);

  console.log('\n=== JS 异常 ===');
  if (errors.length) { errors.slice(0, 6).forEach(e => console.log('  ✗ ' + String(e))); }
  else console.log('  ✓ 无异常');
  if (logs.length) { console.log('\n=== console 输出 ==='); logs.slice(0, 20).forEach(l => console.log('  · ' + l)); }

  const errs = [];
  if (out.totalEntries !== 870) errs.push('条目总数 ≠ 870');
  if (out.sections !== 17) errs.push('板块数 ≠ 17');
  if (out.navItems !== 22) errs.push('导航项 ≠ 22（实为 ' + out.navItems + '）');
  if (!(out.cardsRendered > 0)) errs.push('卡片未渲染');
  if (!(inter.search && inter.search.cards > 0 && inter.search.hit && inter.search.marks > 0)) errs.push('英文搜索失败');
  if (!(inter.chineseSearch > 0)) errs.push('中文搜索失败');
  if (!(inter.basicSearch && inter.basicSearch.cards > 0 && inter.basicSearch.basicBadges > 0)) errs.push('basic 替换词检索/徽章失败');
  if (!(inter.navClick && inter.navClick.cards > 0)) errs.push('板块切换失败');
  if (!(inter.masterStar && inter.masterStar.mastered && inter.masterStar.starred && inter.masterStar.ls)) errs.push('掌握/收藏/持久化失败');
  if (!(inter.recite && inter.recite.on && inter.recite.rev && inter.recite.off)) errs.push('背诵模式失败');
  if (!(inter.starFilter > 0)) errs.push('收藏筛选失败');
  if (!(inter.idxBig && inter.idxBig.cards >= 20 && inter.idxBig.modelBtns >= 20 && inter.idxBig.links > 20)) errs.push('大作文真题索引渲染失败');
  if (!(inter.idxBig && inter.idxBig.refs > 50 && /^https?:\/\//.test(inter.idxBig.refHref || ''))) errs.push('参考范文出处链接渲染失败');
  if (!(inter.idxBigModel && inter.idxBigModel.opened && inter.idxBigModel.enLen > 400 && inter.idxBigModel.zhLen > 50)) errs.push('范文展开失败');
  if (!(inter.idxBigExpandAll && inter.idxBigExpandAll.opened === inter.idxBigExpandAll.total && inter.idxBigExpandAll.total > 0)) errs.push('展开全部范文失败');
  if (inter.idxBigCollapse !== 0) errs.push('全部收起失败');
  if (!(inter.idxSmall && inter.idxSmall.cards >= 15 && inter.idxSmall.partA === inter.idxSmall.cards && inter.idxSmall.distinctTypes >= 5)) errs.push('小作文真题索引渲染失败');
  if (!(inter.idxSearchInIndex && inter.idxSearchInIndex.years.length === 1 && inter.idxSearchInIndex.years[0] === 2023)) errs.push('索引内搜索失败（龙舟应只命中 2023）');
  if (!(inter.idxSearchInIndex && inter.idxSearchInIndex.noHit === 0)) errs.push('索引内无结果时应显示空态');
  if (!(inter.indexJump && inter.indexJump.cards > 0)) errs.push('索引跳转失败');
  if (!(inter.theme && inter.theme.dark)) errs.push('暗色主题失败');
  if (!(inter.variantBadge && inter.variantBadge.sameK >= 2 && inter.variantBadge.badges.some(Boolean))) errs.push('跨板块同表达徽章失败');
  if (!(inter.variantBadge && inter.variantBadge.after && inter.variantBadge.after.length >= 2 && inter.variantBadge.after.every(Boolean))) errs.push('同表达卡片掌握状态未同步');
  if (!(inter.globalKey && inter.globalKey.dupExpr > 0 && inter.globalKey.uniqueExpr < inter.globalKey.totalEntries)) errs.push('全局表达去重统计异常');
  if (inter.fontScale !== '1.1') errs.push('字号调节失败: ' + inter.fontScale);
  if (errors.length) errs.push('存在 JS 异常');

  const ok = errs.length === 0;
  if (!ok) { console.log('\n未通过项:'); errs.forEach(e => console.log('  ✗ ' + e)); }

  console.log('\n' + (ok ? '✅ 全部检查通过' : '❌ 存在问题'));
  ws.close(); child.kill();
  await sleep(400);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.error('✗ 验证失败: ' + e.message);
  try { ws && ws.close(); } catch (_) {}
  child.kill();
  process.exit(1);
}
