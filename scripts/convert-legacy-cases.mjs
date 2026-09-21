#!/usr/bin/env node
/**
 * 옛 형식 성공사례를 공통 템플릿으로 옮긴다 — node scripts/convert-legacy-cases.mjs [--only slug]
 *
 * 왜 필요한가
 *   초기 사례 글들은 파일마다 CSS 를 통째로 품고 있어 19~86KB 다.
 *   같은 내용을 담은 최신 글(case-article.css 를 링크하는 형식)은 5KB 다.
 *   모바일에서 이 차이가 그대로 로딩 시간이 된다. 글마다 디자인이 달라 보이는 문제도 같은 원인이다.
 *
 * 무엇을 보장하나
 *   내용을 지우지 않는다. 변환 뒤 순수 텍스트 길이가 원본의 85% 미만이면 실패로 보고 되돌린다.
 *   글을 새로 쓰는 게 아니라 **형식만 옮기는** 작업이다.
 *
 * 되돌리기
 *   원본은 .bak-legacy/ 에 복사해 둔다. 잘못되면 그걸 되돌리면 된다.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BLOG = path.join(ROOT, 'blog');
const BAK = path.join(ROOT, '.bak-legacy');
const LOG = path.join(ROOT, 'convert-cases.log');

const TIMEOUT = 20 * 60 * 1000;
const MAX_BYTES = 12000;        // 템플릿 형식이면 5~8KB 면 충분하다
const KEEP_RATIO = 0.85;        // 본문이 이보다 줄면 내용이 날아간 것으로 본다

const CLAUDE = [
  'C:\\Users\\c\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe\\claude.exe',
  'claude',
].find((p) => p === 'claude' || fs.existsSync(p));

const stamp = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
function log(m) {
  const line = `[${stamp()}] ${m}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch { }
}

const plain = (html) => html
  .replace(/<script[\s\S]*?<\/script>/g, ' ')
  .replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&[a-z]+;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/* ---------- 검사 ---------- */
function validate(slug, beforeText) {
  const f = path.join(BLOG, `${slug}.html`);
  if (!fs.existsSync(f)) return ['파일이 없습니다'];
  const h = fs.readFileSync(f, 'utf8');
  const e = [];

  if (Buffer.byteLength(h) > MAX_BYTES) e.push(`파일이 ${Math.round(Buffer.byteLength(h) / 1024)}KB (최대 ${MAX_BYTES / 1000}KB)`);
  if (!h.includes('/case-article.css')) e.push('case-article.css 를 링크하지 않았습니다');
  if (/<style[\s>]/.test(h)) e.push('인라인 <style> 이 남아 있습니다');

  for (const need of ['class="hero"', 'class="facts"', 'class="content"', 'class="result"', 'class="cta"', 'class="foot"']) {
    if (!h.includes(need)) e.push(`${need} 블록이 없습니다`);
  }
  if (!/<h1[\s>]/.test(h)) e.push('h1 이 없습니다');
  if ((h.match(/<h1[\s>]/g) || []).length > 1) e.push('h1 이 2개 이상입니다');
  if (!h.includes('application/ld+json')) e.push('구조화 데이터가 없습니다');
  if (!h.includes(`/blog/${slug}`)) e.push('canonical 주소가 slug 와 다릅니다');
  if (!h.includes('class="note"')) e.push('결과를 보장하지 않는다는 고지(.note)가 없습니다');

  const after = plain(h).length;
  const ratio = after / Math.max(1, beforeText);
  if (ratio < KEEP_RATIO) e.push(`본문이 ${Math.round(ratio * 100)}%만 남았습니다 (원본 ${beforeText}자 → ${after}자)`);

  return e;
}

/* ---------- 프롬프트 ---------- */
function buildPrompt(slug, note) {
  return `법률사무소 위드윤 성공사례 글 하나의 **형식만** 공통 템플릿으로 옮긴다. 내용은 새로 쓰지 않는다.

## 대상
blog/${slug}.html

## 기준이 되는 템플릿 (그대로 따라간다)
blog/special-assault-deferred-prosecution-case.html 을 먼저 열어 구조를 그대로 익혀라.
CSS 는 /case-article.css 를 링크만 한다. **파일 안에 <style> 을 넣지 마라.**

## 반드시 지킬 것
- **내용을 지우지 마라.** 지금 글에 있는 사실·설명·문장을 템플릿의 각 자리로 옮기는 작업이다.
  문장을 다듬는 건 괜찮지만 정보가 사라지면 안 된다. 분량이 줄면 실패로 처리된다.
- 구조: nav.top → main.page → article.article → header.hero(h1 하나 + p.lead + div.meta)
  → div.facts(fact 3개: 혐의/위험요소/최종 결과) → div.content(section 들)
  → 그 안에 div.case-summary, ul.strategy, div.result 를 적절히 사용
  → aside.cta → footer.foot
- h1 은 딱 하나. 나머지 제목은 h2.
- head 에 title·description·canonical(https://with-yoon-law.com/blog/${slug})·og·JSON-LD(Article) 를 넣는다.
  JSON-LD 의 author 는 윤성호 변호사, publisher 는 법률사무소 위드윤이다.
- 마지막 section 안에 아래 고지를 <div class="note"> 로 반드시 넣는다:
  "사안마다 사실관계와 양형 사유가 달라 결과는 달라질 수 있습니다. 이 글은 실제 수행 사건을 각색한 것으로 특정 결과를 보장하지 않습니다."
- 판결문 이미지가 원본에 없으면 .document 블록은 만들지 마라(없는 이미지를 링크하면 깨진다).
- 전화 010-9491-1567, 카카오 https://pf.kakao.com/_CNtxjX, 주소는 템플릿과 동일하게.

## 절대 하지 말 것
- 승소·결과를 보장하는 표현. 의뢰인·피해자를 특정할 수 있는 정보 추가.
- 원본에 없는 사실(날짜·금액·기관명)을 지어내기.
- 다른 파일 수정. git 명령 실행.
${note ? `\n## 직전 시도에서 걸린 문제 — 반드시 고쳐라\n${note}\n` : ''}
blog/${slug}.html 을 덮어쓰고, 파일명만 출력하고 끝내라.`;
}

function runClaude(text) {
  const res = spawnSync(CLAUDE, ['-p', text, '--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Write,Glob,Grep'],
    { cwd: ROOT, encoding: 'utf8', timeout: TIMEOUT, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (!res.error && res.status === 0) return true;
  log(`  !! claude 실패 (${res.status ?? 'error'}) — ${String(res.stderr || res.stdout || '').trim().slice(-300)}`);
  return false;
}

/* ---------- 본체 ---------- */
const LEGACY = [
  'subway-molestation-deferred-prosecution',
  'drunk-groping-deferred-prosecution',
  'crowded-place-molestation',
  'case-success-sexual-crime',
  'case-threat-execution-obstruction',
  'drunk-driving-acquittal',
  'no-charge-5-counts',
  'sexual-crime-case-results',
];

const argv = process.argv.slice(2);
const oi = argv.indexOf('--only');
const targets = oi >= 0 ? [argv[oi + 1]] : LEGACY;

fs.mkdirSync(BAK, { recursive: true });
log(`─── 형식 통일 시작 · ${targets.length}건 ───`);

let ok = 0;
for (const slug of targets) {
  const f = path.join(BLOG, `${slug}.html`);
  if (!fs.existsSync(f)) { log(`  건너뜀 — ${slug}.html 없음`); continue; }

  const original = fs.readFileSync(f, 'utf8');
  const beforeBytes = Buffer.byteLength(original);
  const beforeText = plain(original).length;
  fs.writeFileSync(path.join(BAK, `${slug}.html`), original);   // 원본 보관

  let passed = false;
  let note = '';
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    if (attempt) log(`  재시도 ${attempt}회차 — ${slug}`);
    if (!runClaude(buildPrompt(slug, note))) break;
    const errs = validate(slug, beforeText);
    if (!errs.length) { passed = true; break; }
    note = errs.map((x) => `- ${x}`).join('\n');
    log(`  !! 검사 불통과 ${slug}: ${errs.slice(0, 3).join(' / ')}`);
  }

  if (!passed) {
    fs.writeFileSync(f, original);   // 원래대로 되돌린다
    log(`  되돌림 — ${slug} (원본 유지)`);
    continue;
  }
  const afterBytes = Buffer.byteLength(fs.readFileSync(f));
  log(`  통과 ${slug} — ${Math.round(beforeBytes / 1024)}KB → ${Math.round(afterBytes / 1024)}KB (본문 ${beforeText}자 유지)`);
  ok += 1;
}

log(`─── 완료 · ${ok}/${targets.length}건 (원본은 .bak-legacy/) ───`);
