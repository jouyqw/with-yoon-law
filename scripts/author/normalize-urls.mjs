/**
 * 주소 정규화 — node scripts/author/normalize-urls.mjs [--dry]
 *
 * Cloudflare Pages 는 /blog/x.html 을 /blog/x 로, /index.html 을 / 로, /board.html 을
 * /board 로 308 리디렉션한다. 그런데 각 글의 canonical·og:url·구조화 데이터와
 * 페이지들의 내부 링크가 .html 주소를 쓰고 있었다. 사이트맵은 이미 확장자 없는 주소라
 * "사이트맵이 가리키는 주소"와 "그 페이지가 스스로 밝히는 정식 주소"가 어긋났고,
 * 구글은 이런 페이지를 "리디렉션이 포함된 페이지"로 보고 색인에서 뺀다.
 *
 * 이 스크립트는 저장소 안의 .html 주소를 최종 주소로 바꾼다. 여러 번 돌려도 결과가 같다.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const DRY = process.argv.includes('--dry');

const targets = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'scripts'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(html|json|xml|txt)$/.test(entry.name)) targets.push(full);
  }
})(ROOT);

// 순서가 중요하다. 긴 패턴부터 바꿔야 /index.html 이 먼저 먹지 않는다.
const rules = [
  // 절대 주소
  [/(https:\/\/with-yoon-law\.com\/blog\/[^"<>]+?)\.html/g, '$1'],
  [/https:\/\/with-yoon-law\.com\/index\.html/g, 'https://with-yoon-law.com/'],
  [/https:\/\/with-yoon-law\.com\/board\.html/g, 'https://with-yoon-law.com/board'],
  // 루트 상대 주소
  [/(href="\/blog\/[^"<>]+?)\.html/g, '$1'],
  [/href="\/index\.html"/g, 'href="/"'],
  [/href="\/board\.html/g, 'href="/board'],
];

let changedFiles = 0;
let changedHits = 0;
for (const file of targets) {
  const before = fs.readFileSync(file, 'utf8');
  let after = before;
  for (const [re, to] of rules) after = after.replace(re, to);
  if (after === before) continue;

  const hits = before.split('').length - after.split('').length; // 대략치
  changedFiles += 1;
  changedHits += Math.max(1, Math.round(hits / 5));
  console.log(`${DRY ? '[dry] ' : ''}${path.relative(ROOT, file)}`);
  if (!DRY) fs.writeFileSync(file, after, 'utf8');
}

console.log(`\n${DRY ? '바뀔 파일' : '바꾼 파일'}: ${changedFiles}개`);
