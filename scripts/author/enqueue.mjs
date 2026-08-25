/**
 * 초안을 게시판에 올린다 — node scripts/author/enqueue.mjs [--now]
 *
 *   기본        content/drafts/*.json 을 draft.date 에 맞춰 blog/scheduled.json 에 예약
 *   --now       오늘(KST) 이전 날짜의 글은 blog/posts.json 으로 바로 올림
 *
 * scheduled.json 에 있는 글은 매일 00:05 KST 에 publish-scheduled.yml 이 하루치씩
 * posts.json 으로 옮긴다. 그래서 여기서는 날짜만 정확히 박아 두면 된다.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const NOW = process.argv.includes('--now');

const kstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, v) => fs.writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`, 'utf8');

const postsPath = path.join(ROOT, 'blog', 'posts.json');
const queuePath = path.join(ROOT, 'blog', 'scheduled.json');
const posts = readJson(postsPath);
const queue = readJson(queuePath);

const known = new Set([...posts, ...queue].map((x) => x.slug));

const draftsDir = path.join(ROOT, 'content', 'drafts');
const drafts = fs.readdirSync(draftsDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => readJson(path.join(draftsDir, f)))
  .sort((a, b) => a.date.localeCompare(b.date));

let toPosts = 0;
let toQueue = 0;

for (const d of drafts) {
  if (known.has(d.slug)) continue;
  if (!fs.existsSync(path.join(ROOT, 'blog', `${d.slug}.html`))) {
    console.error(`건너뜀 — blog/${d.slug}.html 이 없습니다. 먼저 렌더링하세요.`);
    continue;
  }

  const meta = {
    slug: d.slug,
    title: d.title,
    date: d.date.replaceAll('-', '.'),
    summary: d.description,
    tags: d.keywords || [],
  };

  if (NOW && d.date <= kstToday) {
    posts.push(meta);
    toPosts += 1;
    console.log(`게시  ${d.date}  ${d.slug}`);
  } else {
    queue.push({ ...meta, publishAt: d.date });
    toQueue += 1;
    console.log(`예약  ${d.date}  ${d.slug}`);
  }
  known.add(d.slug);
}

// board.html 이 최신순으로 다시 정렬하므로 파일에는 날짜 오름차순으로 둔다.
const key = (p) => String(p.date || '').replace(/[^0-9]/g, '').padEnd(8, '0');
posts.sort((a, b) => key(a).localeCompare(key(b)));
queue.sort((a, b) => String(a.publishAt).localeCompare(String(b.publishAt)));

writeJson(postsPath, posts);
writeJson(queuePath, queue);
console.log(`\n게시 ${toPosts}편 / 예약 ${toQueue}편  (posts ${posts.length}, queue ${queue.length})`);
