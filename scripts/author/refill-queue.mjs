/**
 * 법률사무소 위드윤 — 예약분 자동 보충
 *
 *   node scripts/author/refill-queue.mjs             대기가 THRESHOLD 미만이면 TARGET 까지 채운다
 *   node scripts/author/refill-queue.mjs --force 10  대기와 무관하게 10건 추가
 *   node scripts/author/refill-queue.mjs --check     쓰지 않고 현재 큐 상태만 출력
 *
 * 하는 일
 *   1) blog/scheduled.json 의 대기 편수를 센다
 *   2) 부족하면 하루 PER_DAY 건씩 자리를 만들고 주제를 배정한다(기존 글과 겹치지 않는 것만)
 *   3) 하루치씩 claude 를 headless 로 띄워 content/drafts/<slug>.json 을 쓰게 한다
 *   4) 배치마다 렌더링 → 주소 정규화 → 점검(verify) → 큐 적재(enqueue) 를 돌린다
 *      렌더러의 컴플라이언스 검사(전문 표기·결과 보장)와 verify 의 분량 기준을 통과해야 넘어간다
 *      실패하면 그 배치를 되돌리고 다시 쓰게 한다(최대 RETRY 회)
 *   5) 실패하면 바탕화면에 알림 파일을 남긴다
 *
 * 발행은 .github/workflows/publish-scheduled.yml 이 매일 00:05 KST 에 한다.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DRAFTS = path.join(ROOT, 'content', 'drafts');
const BLOG = path.join(ROOT, 'blog');
const LOG = path.join(ROOT, 'refill.log');
const LOCK = path.join(ROOT, '.refill.lock');
const DESK = path.join(process.env.USERPROFILE || '', 'Desktop', '위드윤_칼럼보충_실패.txt');

const THRESHOLD = 10;   // 대기가 이 편수 미만이면 보충 (하루 2건 → 5일치)
const TARGET = 20;      // 보충 후 목표 대기 편수 (10일치)
const PER_DAY = 2;
const MAX_ADD = 60;
const RETRY = 2;
const BATCH_TIMEOUT = 30 * 60 * 1000;

const CLAUDE = [
  'C:\\Users\\c\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe\\claude.exe',
  'claude',
].find((p) => p === 'claude' || fs.existsSync(p));

/* ---------- 주제 풀 ----------
 * 기존 100편과 겹치지 않는 것만 담았다. slug 는 그대로 주소가 되므로 바꾸지 않는다.
 * hub 가 있으면 분야 안내 페이지로 연결된다(practice 아래 실제 존재하는 것만).
 */
const TOPICS = [
  { slug: 'special-assault-weapon', topic: '특수폭행 — 위험한 물건 휴대', category: '형사', hub: 'criminal' },
  { slug: 'injury-charge-diagnosis', topic: '상해죄와 진단서의 무게', category: '형사', hub: 'criminal' },
  { slug: 'business-obstruction-guide', topic: '업무방해죄 성립 범위', category: '형사', hub: 'criminal' },
  { slug: 'obstruction-public-duty', topic: '공무집행방해와 직무의 적법성', category: '형사', hub: 'criminal' },
  { slug: 'property-damage-scope', topic: '재물손괴 — 효용을 해한다는 것', category: '형사', hub: 'criminal' },
  { slug: 'theft-intent-standard', topic: '절도죄 불법영득의사', category: '형사', hub: 'criminal' },
  { slug: 'embezzlement-custody', topic: '횡령죄 보관 관계', category: '형사', hub: 'criminal' },
  { slug: 'occupational-embezzlement', topic: '업무상횡령과 단순횡령의 갈림길', category: '형사', hub: 'criminal' },
  { slug: 'breach-of-trust-guide', topic: '배임죄 임무 위배', category: '형사', hub: 'criminal' },
  { slug: 'private-document-forgery', topic: '사문서위조 — 작성 권한', category: '형사', hub: 'criminal' },
  { slug: 'perjury-memory-standard', topic: '위증죄 기억에 반한 진술', category: '형사', hub: 'criminal' },
  { slug: 'evidence-destruction-crime', topic: '증거인멸죄 성립 범위', category: '형사', hub: 'criminal' },
  { slug: 'extortion-crime-guide', topic: '공갈죄와 정당한 권리행사', category: '형사', hub: 'criminal' },
  { slug: 'coercion-crime-guide', topic: '강요죄 의무 없는 일', category: '형사', hub: 'criminal' },
  { slug: 'confinement-crime-guide', topic: '감금죄 이동의 자유', category: '형사', hub: 'criminal' },
  { slug: 'trespass-residence-guide', topic: '주거침입 — 사실상 평온', category: '형사', hub: 'criminal' },
  { slug: 'gambling-place-opening', topic: '도박과 도박장소개설의 구분', category: '형사', hub: 'criminal' },
  { slug: 'drug-first-offense-response', topic: '마약 초범 수사 대응', category: '형사', hub: 'criminal' },
  { slug: 'account-lending-crime', topic: '계좌 대여와 전자금융거래법', category: '형사', hub: 'criminal' },
  { slug: 'voice-phishing-withdrawal', topic: '보이스피싱 인출책 가담 판단', category: '형사', hub: 'criminal' },
  { slug: 'stolen-goods-crime', topic: '장물취득 — 알았는지의 문제', category: '형사', hub: 'criminal' },
  { slug: 'computer-fraud-crime', topic: '컴퓨터등사용사기', category: '형사', hub: 'criminal' },
  { slug: 'child-abuse-response', topic: '아동학대 신고 이후 절차', category: '형사', hub: 'criminal' },
  { slug: 'juvenile-case-procedure', topic: '소년보호사건 처분 단계', category: '형사', hub: 'criminal' },
  { slug: 'summary-order-formal-trial', topic: '약식명령과 정식재판청구', category: '형사', hub: 'criminal' },
  { slug: 'suspension-indictment-guide', topic: '기소유예를 받는다는 것', category: '형사', hub: 'criminal' },
  { slug: 'suspended-sentence-standard', topic: '집행유예 판단 요소', category: '형사', hub: 'criminal' },
  { slug: 'appeal-brief-deadline', topic: '항소이유서 제출 기간', category: '형사', hub: 'criminal' },
  { slug: 'bail-application-guide', topic: '보석 청구 준비', category: '형사', hub: 'criminal' },
  { slug: 'search-seizure-participation', topic: '압수수색 참여권', category: '형사', hub: 'criminal' },
  { slug: 'quasi-rape-consent-issue', topic: '유사강간 혐의 대응', category: '성범죄', hub: 'sex-crime' },
  { slug: 'crowded-place-molestation', topic: '공중밀집장소 추행', category: '성범죄', hub: 'sex-crime' },
  { slug: 'telecom-obscenity-crime', topic: '통신매체이용음란', category: '성범죄', hub: 'sex-crime' },
  { slug: 'sexual-purpose-intrusion', topic: '성적 목적 다중이용장소 침입', category: '성범죄', hub: 'sex-crime' },
  { slug: 'sex-offender-registration', topic: '신상정보 등록과 공개', category: '성범죄', hub: 'sex-crime' },
  { slug: 'victim-public-defender', topic: '성범죄 피해자 국선변호사', category: '성범죄', hub: 'sex-crime' },
  { slug: 'visitation-enforcement', topic: '면접교섭 이행 확보', category: '이혼·가사', hub: 'divorce' },
  { slug: 'parental-authority-change', topic: '친권자 변경 요건', category: '이혼·가사', hub: 'divorce' },
  { slug: 'child-support-enforcement', topic: '양육비 미지급 이행확보', category: '이혼·가사', hub: 'divorce' },
  { slug: 'property-disclosure-order', topic: '재산명시와 재산조회', category: '이혼·가사', hub: 'divorce' },
  { slug: 'inheritance-renunciation', topic: '상속포기 기간 계산', category: '이혼·가사', hub: null },
  { slug: 'qualified-acceptance-guide', topic: '한정승인 재산목록', category: '이혼·가사', hub: null },
  { slug: 'legal-reserve-share', topic: '유류분 산정 기초', category: '이혼·가사', hub: null },
  { slug: 'contribution-share-guide', topic: '기여분 주장', category: '이혼·가사', hub: null },
  { slug: 'marriage-nullity-guide', topic: '혼인무효와 혼인취소', category: '이혼·가사', hub: 'divorce' },
  { slug: 'domestic-violence-order', topic: '가정폭력 접근금지 결정', category: '이혼·가사', hub: 'divorce' },
  { slug: 'surname-change-petition', topic: '성·본 변경 허가', category: '이혼·가사', hub: 'divorce' },
  { slug: 'paternity-claim-guide', topic: '인지청구와 친생자 관계', category: '이혼·가사', hub: 'divorce' },
  { slug: 'affair-evidence-collection', topic: '상간 소송 증거 수집의 한계', category: '이혼·가사', hub: 'affair-lawsuit' },
  { slug: 'affair-defense-response', topic: '상간 소송을 당한 쪽의 방어', category: '이혼·가사', hub: 'affair-lawsuit' },
  { slug: 'dui-refusal-measurement', topic: '음주측정거부 성립', category: '음주·교통', hub: 'dui' },
  { slug: 'unlicensed-driving-guide', topic: '무면허운전 인식 문제', category: '음주·교통', hub: 'dui' },
  { slug: 'reckless-driving-repeat', topic: '난폭운전 행위 반복', category: '음주·교통', hub: 'dui' },
  { slug: 'road-rage-weapon-issue', topic: '보복운전 위험한 물건', category: '음주·교통', hub: 'dui' },
  { slug: 'school-zone-accident', topic: '어린이보호구역 사고', category: '음주·교통', hub: 'dui' },
  { slug: 'failure-to-take-measures', topic: '사고후미조치 조치 범위', category: '음주·교통', hub: 'dui' },
  { slug: 'license-revocation-appeal', topic: '면허취소 행정심판 기간', category: '음주·교통', hub: 'dui' },
  { slug: 'eviction-lawsuit-guide', topic: '명도소송 점유 이전', category: '민사', hub: null },
  { slug: 'payment-order-objection', topic: '지급명령 이의 절차', category: '민사', hub: null },
  { slug: 'provisional-attachment', topic: '가압류 보전의 필요성', category: '민사', hub: null },
  { slug: 'loan-claim-evidence', topic: '대여금 청구와 차용증 없는 돈', category: '민사', hub: null },
  { slug: 'goods-payment-claim', topic: '물품대금 청구와 거래 특정', category: '민사', hub: null },
  { slug: 'construction-payment-claim', topic: '공사대금 기성고 산정', category: '민사', hub: null },
  { slug: 'lease-deposit-return', topic: '임대차보증금 반환과 대항력', category: '민사', hub: null },
  { slug: 'floor-noise-dispute', topic: '층간소음 분쟁의 수인한도', category: '민사', hub: null },
  { slug: 'defect-repair-claim', topic: '하자보수 청구 기간', category: '민사', hub: null },
  { slug: 'nominal-trust-property', topic: '명의신탁 부동산의 귀속', category: '민사', hub: null },
  { slug: 'debt-collection-limits', topic: '채권추심에서 넘지 말아야 할 선', category: '민사', hub: null },
  { slug: 'small-claims-procedure', topic: '소액사건 심판 절차', category: '민사', hub: null },
  { slug: 'jury-trial-choice', topic: '국민참여재판을 고를 때', category: '형사', hub: 'criminal' },
  { slug: 'harboring-criminal-guide', topic: '범인도피와 단순히 말하지 않은 것', category: '형사', hub: 'criminal' },
  { slug: 'juvenile-under-fourteen', topic: '촉법소년 처리 절차', category: '형사', hub: 'criminal' },
  { slug: 'summary-judgment-court', topic: '즉결심판과 정식재판', category: '형사', hub: 'criminal' },
  { slug: 'sentence-suspension-guide', topic: '선고유예의 요건', category: '형사', hub: 'criminal' },
];

/* ---------- 로그 ---------- */
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
function log(msg) {
  const line = `[${stamp()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch { }
}
const unlock = () => { try { fs.rmSync(LOCK); } catch { } };
function fail(msg, detail = '') {
  log('!! ' + msg);
  if (detail) log(String(detail).slice(0, 800));
  try {
    fs.writeFileSync(DESK,
      `${stamp()}\n위드윤 칼럼 예약분 자동 보충에 실패했습니다.\n\n${msg}\n\n${String(detail).slice(0, 1500)}\n\n` +
      `확인하려면 저장소에서:\n  node scripts/author/refill-queue.mjs --check\n  node scripts/author/verify.mjs\n`);
  } catch { }
  unlock();
  process.exit(1);
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const writeJson = (p, v) => fs.writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`, 'utf8');
const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

const node = (args) => execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/* ---------- 본체 ---------- */
const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const GIT = argv.includes('--git');
const fi = argv.indexOf('--force');
const FORCE = fi >= 0 ? Math.max(1, Math.min(MAX_ADD, Number(argv[fi + 1]) || PER_DAY)) : 0;

// 발행(publish-scheduled.yml)은 GitHub 에서 돈다. 큐가 올라가야 실제로 나간다.
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function gitPull() {
  try {
    git(['fetch', 'origin', 'main']);
    git(['merge', '--ff-only', 'origin/main']);
    log('원격 변경분 반영 완료');
  } catch (e) {
    fail('로컬과 원격이 갈라져 있어 중단했습니다', String(e.stdout || e.stderr || e.message));
  }
}
function gitPush(count) {
  try {
    git(['add', '-A']);
    git(['-c', 'user.name=publish-bot', '-c', 'user.email=bot@auto.local',
      'commit', '-m', `칼럼 예약분 ${count}편 자동 보충`]);
    git(['push', 'origin', 'main']);
    log('GitHub 푸시 완료 — 예약발행 워크플로가 이어받습니다');
  } catch (e) {
    fail('푸시에 실패했습니다 (글은 로컬에 있습니다)', String(e.stdout || e.stderr || e.message));
  }
}

const postsPath = path.join(BLOG, 'posts.json');
const queuePath = path.join(BLOG, 'scheduled.json');
let posts = readJson(postsPath);
let queue = readJson(queuePath);

log(`─── 큐 점검 (KST ${TODAY}) ─── 발행 ${posts.length}편 · 대기 ${queue.length}편`);
if (CHECK) {
  queue.slice().sort((a, b) => a.publishAt.localeCompare(b.publishAt))
    .forEach((q) => console.log(`  ${q.publishAt}  ${q.slug}  ${q.title}`));
  process.exit(0);
}

if (fs.existsSync(LOCK)) {
  if (Date.now() - fs.statSync(LOCK).mtimeMs < BATCH_TIMEOUT * 2) { log('이미 실행 중 — 종료'); process.exit(0); }
  log('오래된 잠금 파일 제거'); unlock();
}

if (GIT) { gitPull(); posts = readJson(postsPath); queue = readJson(queuePath); }

let need = FORCE || (queue.length < THRESHOLD ? Math.min(MAX_ADD, TARGET - queue.length) : 0);
if (need <= 0) { log(`대기 ${queue.length}편 — 보충 불필요 (기준 ${THRESHOLD}편)`); process.exit(0); }
if (need % PER_DAY) need += PER_DAY - (need % PER_DAY);

const known = new Set([...posts, ...queue].map((x) => x.slug));
if (fs.existsSync(DRAFTS)) fs.readdirSync(DRAFTS).filter((f) => f.endsWith('.json'))
  .forEach((f) => known.add(f.replace(/\.json$/, '')));

const pool = TOPICS.filter((t) => !known.has(t.slug)).slice(0, need);
if (!pool.length) fail('배정할 주제가 남지 않았습니다', 'TOPICS 목록을 늘려야 합니다.');
if (pool.length < need) log(`※ 주제 풀이 부족해 ${pool.length}건만 배정했습니다`);

// 마지막 예약일 다음 날부터 하루 PER_DAY 건씩
const lastAt = queue.reduce((m, q) => (q.publishAt > m ? q.publishAt : m), TODAY);
pool.forEach((t, i) => { t.date = addDays(lastAt, Math.floor(i / PER_DAY) + 1); });

fs.writeFileSync(LOCK, stamp());
log(`${pool.length}편 보충 시작 → ${pool[0].date} ~ ${pool[pool.length - 1].date}`);

const titleList = () => readJson(postsPath).concat(readJson(queuePath))
  .map((p) => `- ${p.title}`).join('\n');

function prompt(batch, note) {
  const rows = batch.map((t) => `- slug: ${t.slug} / 주제: ${t.topic} / 분류: ${t.category} / 발행일: ${t.date}`
    + (t.hub ? ` / 분야허브: /practice/${t.hub}/` : ' / 분야허브: 없음')).join('\n');

  return `너는 법률사무소 위드윤(서울 서초구 서초대로 270, 윤성호 변호사)의 법률칼럼 초안을 쓴다.
지금 예약분이 없어 ${batch.length}편을 새로 써야 한다.

## 반드시 먼저 읽을 것
1. content/drafts/sex-crime-first-summons-preparation.json — 초안 형식과 문체의 기준
2. scripts/author/render-article.mjs 의 맨 위 주석 — 지켜야 할 컴플라이언스 규칙

## 이번에 쓸 초안 (각 줄이 파일 하나: content/drafts/<slug>.json)
${rows}

## 초안 JSON 필드
slug, category, crumb, date, title, description, keywords[], tldr[], sections[], faqs[], quote[], hub, related[], cta

## 통과해야 하는 기준 (scripts/author/verify.mjs 가 검사한다)
- 본문 1800자 이상
- sections 5개 이상. 각 section 은 { label, title, blocks[] }
  label 은 대문자 영문 한 단어(OVERVIEW, SCHEDULE, EVIDENCE, CONTACT, CONSULTATION, AREA 등)
- blocks 는 문자열(문단) 또는 { type: 'info'|'table'|'list'|'dialog'|'quote', ... }
  table 은 { type:'table', rows:[[머리말,내용], ...] }, list 는 { type:'list', items:[...] }
  dialog 는 { type:'dialog', title, lines:[...] }, info 는 { type:'info', text }
- quote 가 아닌 블록(표·목록·강조)이 3개 이상
- faqs 4개 이상 [{ q, a }]
- tldr 3줄 이상
- description 45~160자
- 마지막 섹션은 서초 지역 안내로 만들고 관할을 표에 담는다:
  서초경찰서·방배경찰서 / 서울중앙지방검찰청 / 서울중앙지방법원 / 서울가정법원(가사 사건)
  마지막 행에 "법률사무소 위드윤 · 서울 서초구 서초대로 270 · 010-9491-1567" 을 넣는다
- hub 가 있으면 { href: '/practice/<분야>/', badge: '<분야> 안내', label: '...' } 로 넣고, 없으면 hub 를 생략한다
- related 는 넣지 마라(존재하지 않는 주소를 걸면 점검에서 막힌다)
- cta 는 { title, sub } 한 쌍

## 절대 금지 (렌더러가 검사해서 걸리면 파일이 만들어지지 않는다)
- "형사전문변호사", "성범죄전문변호사" 같은 전문 표기. 변협 전문분야 등록이 확인되지 않았다.
- 승소율·성공률·무죄율 같은 수치, "반드시 무죄", "100%", "무조건", "보장합니다"

## 문체
- 담담한 정보 제공체. 짧은 문장. 과장·감탄사·이모지 금지.
- 실제 사건·실명·판결번호 금지. dialog 는 가상의 상담 예시로 쓴다.
- 조문은 확실한 것만 인용한다. 확실하지 않으면 조문 번호를 쓰지 말고 내용만 설명한다.
- 다른 글과 같은 문장을 쓰지 않는다. 아래 기존 제목과 주제·표현이 겹치지 않게 한다.

## 기존 글 제목
${titleList()}
${note ? `\n## 직전 시도에서 걸린 문제 — 이번에는 반드시 고쳐라\n${note}\n` : ''}
## 하지 말 것
- render-article.mjs, enqueue.mjs, git 등 명령을 실행하지 마라. 초안 JSON 만 쓰면 된다.
- 기존 content/drafts 파일을 수정하지 마라.

다 쓰면 만든 파일명만 한 줄씩 출력하고 끝내라.`;
}

const removeBatch = (batch) => batch.forEach((t) => {
  for (const p of [path.join(DRAFTS, `${t.slug}.json`), path.join(BLOG, `${t.slug}.html`)]) {
    try { fs.rmSync(p); } catch { }
  }
});

const sleep = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { } };

/**
 * claude 호출. 실패하면 이유를 남기고 쉬었다가 다시 부른다.
 * 호출 실패와 "쓴 내용이 기준에 못 미친 것" 은 다른 문제인데, 예전에는 둘을 같이 세어서
 * 일시적인 호출 실패가 재작성 기회를 다 태우고 배치를 버리게 만들었다.
 */
function runClaude(text) {
  for (let t = 1; t <= 3; t += 1) {
    const res = spawnSync(CLAUDE, [
      '-p', text,
      '--permission-mode', 'acceptEdits',
      '--allowedTools', 'Read,Write,Glob,Grep',
    ], { cwd: ROOT, encoding: 'utf8', timeout: BATCH_TIMEOUT, maxBuffer: 64 * 1024 * 1024, windowsHide: true });

    if (!res.error && res.status === 0) return res;
    const why = String(res.stderr || res.stdout || res.error?.message || '').trim().slice(-400);
    log(`  !! claude 호출 실패 (${res.status ?? 'error'}) ${t}/3 — ${why || '출력 없음'}`);
    if (t < 3) { log('  60초 쉬었다가 다시 부릅니다'); sleep(60000); }
  }
  return null;
}

const written = [];
for (let i = 0; i < pool.length; i += PER_DAY) {
  const batch = pool.slice(i, i + PER_DAY);
  const label = `${batch[0].date} (${batch.map((t) => t.slug).join(', ')})`;
  let note = '';
  let ok = false;

  for (let attempt = 0; attempt <= RETRY; attempt += 1) {
    if (attempt) log(`  재작성 ${attempt}회차 — ${label}`);
    removeBatch(batch);

    const res = runClaude(prompt(batch, note));
    if (!res) {
      removeBatch(batch);
      try { node([path.join(HERE, 'render-article.mjs'), '--all']); } catch { }
      fail('claude 를 세 번 불렀지만 모두 실패했습니다 (사용량 제한이나 네트워크 문제로 보입니다)',
        `여기까지 ${written.length}편은 정상 반영됐습니다. 잠시 뒤 다시 실행하면 이어서 채웁니다.`);
    }

    // 초안이 다 만들어졌는지, 날짜가 지정대로인지 먼저 본다
    const miss = [];
    for (const t of batch) {
      const f = path.join(DRAFTS, `${t.slug}.json`);
      if (!fs.existsSync(f)) { miss.push(`${t.slug}.json 없음`); continue; }
      try {
        const d = readJson(f);
        if (d.date !== t.date) miss.push(`${t.slug} date 가 ${d.date} (기대 ${t.date})`);
        if (d.slug !== t.slug) miss.push(`${t.slug} slug 불일치`);
      } catch (e) { miss.push(`${t.slug}.json JSON 오류: ${e.message}`); }
    }
    if (miss.length) { note = miss.join('\n'); log('  !! ' + miss.join(' / ')); continue; }

    // 렌더링 → 주소 정규화 → 점검
    try {
      node([path.join(HERE, 'render-article.mjs'), '--all']);
      node([path.join(HERE, 'normalize-urls.mjs')]);
      node([path.join(HERE, 'verify.mjs')]);
    } catch (e) {
      note = (String(e.stdout || '') + String(e.stderr || '')).slice(-1500);
      log('  !! 렌더링/점검 실패');
      log(note.slice(-400));
      continue;
    }

    ok = true;
    break;
  }

  if (!ok) {
    removeBatch(batch);
    try { node([path.join(HERE, 'render-article.mjs'), '--all']); } catch { }
    fail(`${label} 배치를 ${RETRY + 1}회 시도했지만 통과하지 못했습니다`,
      `여기까지 ${written.length}편은 정상 반영됐습니다. 다시 실행하면 이어서 채웁니다.`);
  }

  // 큐에 적재
  try { node([path.join(HERE, 'enqueue.mjs')]); }
  catch (e) { fail('enqueue 실패', String(e.stdout || e.message)); }

  written.push(...batch);
  // 오래 도는 실행이 "멈춘 잠금"으로 오인되지 않도록 배치마다 잠금 시각을 갱신한다
  try { fs.writeFileSync(LOCK, stamp()); } catch { }
  log(`  통과 ${label} — 누적 ${written.length}/${pool.length}`);
}

queue = readJson(queuePath);
log(`─── 보충 완료 · ${written.length}편 추가 (대기 ${queue.length}편, ${pool[pool.length - 1].date} 까지) ───`);
written.forEach((t) => log(`   ${t.date}  ${t.slug}`));

if (GIT && written.length) gitPush(written.length);

try { if (fs.existsSync(DESK)) fs.rmSync(DESK); } catch { }
unlock();
