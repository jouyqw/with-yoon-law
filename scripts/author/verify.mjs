/**
 * 발행 전 점검 — node scripts/author/verify.mjs
 *
 *   1) blog/*.html 의 /blog/ 내부링크가 실제로 존재하는가
 *   2) 초안으로 만든 글의 본문 분량·구조가 기준을 넘는가
 *   3) posts.json + scheduled.json 에 slug 중복이 없고, 예약분의 HTML 이 있는가
 *   4) 예약 발행일이 하루 한 편씩 비지 않고 이어지는가
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bodyLength } from './render-article.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const DRAFTS = path.join(ROOT, 'content', 'drafts');

const errors = [];
const warn = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/* ---------- 1) 내부링크 ---------- */
const blogDir = path.join(ROOT, 'blog');
for (const file of fs.readdirSync(blogDir).filter((f) => f.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(blogDir, file), 'utf8');
  // 링크는 확장자 없는 최종 주소(/blog/x)로 쓴다. 실제 파일은 blog/x.html 이다.
  for (const m of html.matchAll(/href="(\/blog\/[^"#?]+)"/g)) {
    const href = m[1];
    if (href.endsWith('.html')) {
      fail(`blog/${file}`, `.html 주소는 308 로 리디렉션됩니다 → ${href}`);
      continue;
    }
    if (!fs.existsSync(path.join(ROOT, `${href}.html`))) {
      fail(`blog/${file}`, `깨진 내부링크 → ${href}`);
    }
  }
  const canonical = html.match(/rel="canonical" href="([^"]+)"/);
  if (canonical && canonical[1].endsWith('.html')) {
    fail(`blog/${file}`, `canonical 이 리디렉션되는 .html 주소입니다 → ${canonical[1]}`);
  }
  for (const m of html.matchAll(/href="(\/practice\/[^"#?]+)"/g)) {
    const dir = path.join(ROOT, m[1]);
    if (!fs.existsSync(dir) && !fs.existsSync(`${dir.replace(/\/$/, '')}.html`)) {
      fail(`blog/${file}`, `깨진 분야 링크 → ${m[1]}`);
    }
  }
}

/* ---------- 2) 초안 품질 ---------- */
const drafts = fs.existsSync(DRAFTS)
  ? fs.readdirSync(DRAFTS).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(DRAFTS, f)))
  : [];

for (const d of drafts) {
  const len = bodyLength(d);
  if (len < 1800) fail(d.slug, `본문이 짧습니다 (${len}자, 최소 1800)`);
  const sections = (d.sections || []).length;
  if (sections < 5) fail(d.slug, `섹션이 부족합니다 (${sections}개, 최소 5)`);
  if ((d.faqs || []).length < 4) fail(d.slug, `FAQ 가 부족합니다 (${(d.faqs || []).length}개, 최소 4)`);
  if ((d.tldr || []).length < 3) fail(d.slug, '핵심 요약이 3줄 미만입니다');
  const visuals = (d.sections || []).flatMap((s) => s.blocks).filter((b) => b && b.type && b.type !== 'quote').length;
  if (visuals < 3) fail(d.slug, `표·목록·강조 블록이 부족합니다 (${visuals}개, 최소 3)`);
  const desc = [...(d.description || '')].length;
  if (desc < 45 || desc > 160) fail(d.slug, `description 길이 (${desc}자, 45~160)`);
  if (!fs.existsSync(path.join(blogDir, `${d.slug}.html`))) fail(d.slug, 'blog/<slug>.html 이 없습니다 (렌더링하세요)');
}

/* ---------- 3) 중복·존재 ---------- */
const posts = readJson(path.join(ROOT, 'blog', 'posts.json'));
const queue = readJson(path.join(ROOT, 'blog', 'scheduled.json'));

const seen = new Map();
for (const [label, list] of [['posts.json', posts], ['scheduled.json', queue]]) {
  for (const item of list) {
    if (seen.has(item.slug)) fail(label, `slug 중복 → ${item.slug} (${seen.get(item.slug)} 에도 있음)`);
    else seen.set(item.slug, label);
  }
}
for (const item of queue) {
  if (!fs.existsSync(path.join(blogDir, `${item.slug}.html`))) {
    fail('scheduled.json', `HTML 이 없습니다 → blog/${item.slug}.html (예약일에 건너뜁니다)`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.publishAt || '')) {
    fail('scheduled.json', `publishAt 형식 오류 → ${item.slug} (${item.publishAt})`);
  }
}

/* ---------- 4) 예약일 연속성 ---------- */
const dates = queue.map((q) => q.publishAt).sort();
const dupDates = dates.filter((d, i) => dates[i - 1] === d);
if (dupDates.length) warn.push(`같은 날 두 편 이상 예약됨 → ${[...new Set(dupDates)].join(', ')}`);
for (let i = 1; i < dates.length; i += 1) {
  const prev = new Date(`${dates[i - 1]}T00:00:00Z`);
  const cur = new Date(`${dates[i]}T00:00:00Z`);
  const gap = (cur - prev) / 86400000;
  if (gap > 1) warn.push(`발행이 비는 날 → ${dates[i - 1]} 다음이 ${dates[i]} (${gap - 1}일 공백)`);
}

/* ---------- 결과 ---------- */
for (const w of warn) console.log(`알림 — ${w}`);
if (errors.length) {
  console.error(`\n점검 실패 (${errors.length}건):`);
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`\n점검 통과: 발행 ${posts.length}편, 예약 ${queue.length}편, 초안 ${drafts.length}개`);
if (dates.length) console.log(`예약 구간: ${dates[0]} ~ ${dates[dates.length - 1]}`);
