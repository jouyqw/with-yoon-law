#!/usr/bin/env node
/**
 * IndexNow 색인 요청 자동화
 * ---------------------------------------------------------------
 * 네이버 서치어드바이저 + IndexNow 공용 허브(Bing·Yandex·Seznam)에
 * "새로 생기거나 수정된 URL"을 즉시 통보한다.
 *
 * 사용법
 *   node scripts/indexnow.mjs --diff        새 URL + lastmod 변경 URL만 제출 (기본)
 *   node scripts/indexnow.mjs --all         sitemap.xml 전체 URL 제출
 *   node scripts/indexnow.mjs --url <URL>   특정 URL만 제출 (반복 지정 가능)
 *   node scripts/indexnow.mjs --dry-run     실제 전송 없이 대상만 출력
 *
 * 환경변수
 *   INDEXNOW_KEY  (필수) 사이트 루트에 <KEY>.txt 로 배치된 값과 동일해야 함
 *   SITE_HOST     (선택) 기본값 with-yoon-law.com
 */

import fs from 'node:fs';
import { execSync } from 'node:child_process';

const HOST = process.env.SITE_HOST || 'with-yoon-law.com';
const KEY = process.env.INDEXNOW_KEY || '';
const SITEMAP = 'sitemap.xml';

// IndexNow 수신 엔드포인트. 네이버는 별도 서버, 나머지는 공용 허브가 상호 전파한다.
// 공식 호스트는 searchadvisor.naver.com (api. 서브도메인은 존재하지 않아 DNS 실패한다).
// api.indexnow.org 는 참여 검색엔진 전체(Bing·Yandex·Seznam·Naver·Yep 등)로 전파하므로
// 네이버 직행 요청이 실패해도 허브 경로로 한 번 더 들어간다. 이중화 목적으로 둘 다 호출한다.
const ENDPOINTS = [
  { name: '네이버',   url: 'https://searchadvisor.naver.com/indexnow' },
  { name: 'IndexNow', url: 'https://api.indexnow.org/indexnow' },
];

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const DRY = has('--dry-run');

/** sitemap.xml 문자열에서 { url -> lastmod } 맵을 뽑는다. */
function parseSitemap(xml) {
  const map = new Map();
  const blocks = xml.match(/<url>[\s\S]*?<\/url>/g) || [];
  for (const block of blocks) {
    const loc = (block.match(/<loc>([\s\S]*?)<\/loc>/) || [])[1]?.trim();
    if (!loc) continue;
    const mod = (block.match(/<lastmod>([\s\S]*?)<\/lastmod>/) || [])[1]?.trim() || '';
    map.set(loc, mod);
  }
  return map;
}

/** 직전 커밋(HEAD)의 sitemap.xml. 최초 커밋이거나 파일이 없으면 빈 맵. */
function previousSitemap() {
  try {
    return parseSitemap(execSync(`git show HEAD:${SITEMAP}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }));
  } catch {
    return new Map();
  }
}

function collectTargets() {
  // --url 로 명시 지정한 경우가 최우선
  const explicit = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--url' && args[i + 1]) explicit.push(args[i + 1]);
  }
  if (explicit.length) return { mode: '지정 URL', urls: explicit };

  if (!fs.existsSync(SITEMAP)) {
    throw new Error(`${SITEMAP} 을 찾을 수 없습니다. 먼저 피드를 생성하세요.`);
  }
  const current = parseSitemap(fs.readFileSync(SITEMAP, 'utf8'));

  if (has('--all')) return { mode: '전체', urls: [...current.keys()] };

  // 기본값: 신규 추가 + lastmod 변경분
  const prev = previousSitemap();
  const changed = [];
  for (const [url, mod] of current) {
    if (!prev.has(url) || prev.get(url) !== mod) changed.push(url);
  }
  return { mode: '변경분', urls: changed };
}

async function submit(endpoint, urls) {
  const body = JSON.stringify({
    host: HOST,
    key: KEY,
    keyLocation: `https://${HOST}/${KEY}.txt`,
    urlList: urls,
  });

  // Node 의 fetch 는 기본 타임아웃이 없다. 색인 엔드포인트가 응답을 붙잡고 있으면
  // 워크플로가 6시간 한도까지 매달리므로 반드시 명시적으로 끊어준다.
  const res = await fetch(endpoint.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'User-Agent': 'with-yoon-law-indexnow/1.0',
    },
    body,
    signal: AbortSignal.timeout(30000),
  });

  // 200 OK / 202 Accepted 는 정상 접수. 그 외는 원인 파악용으로 본문을 남긴다.
  const ok = res.status === 200 || res.status === 202;
  let detail = '';
  if (!ok) detail = ` — ${(await res.text().catch(() => '')).slice(0, 200)}`;
  console.log(`${ok ? '✅' : '⚠️ '} ${endpoint.name}: HTTP ${res.status}${detail}`);
  return ok;
}

async function main() {
  if (!KEY) {
    console.error('INDEXNOW_KEY 환경변수가 비어 있습니다.');
    process.exit(1);
  }

  const { mode, urls } = collectTargets();

  if (!urls.length) {
    console.log(`제출 대상 없음 (${mode}). 종료합니다.`);
    return;
  }

  console.log(`[${mode}] ${urls.length}건 제출 예정`);
  urls.slice(0, 50).forEach((u) => console.log(`  - ${u}`));
  if (urls.length > 50) console.log(`  ... 외 ${urls.length - 50}건`);

  if (DRY) {
    console.log('--dry-run: 실제 전송하지 않았습니다.');
    return;
  }

  // IndexNow 규격상 1회 최대 10,000건. 여유 있게 1,000건씩 끊는다.
  const chunks = [];
  for (let i = 0; i < urls.length; i += 1000) chunks.push(urls.slice(i, i + 1000));

  let allOk = true;
  for (const endpoint of ENDPOINTS) {
    for (const chunk of chunks) {
      try {
        const ok = await submit(endpoint, chunk);
        if (!ok) allOk = false;
      } catch (e) {
        // fetch 는 네트워크 오류를 전부 "fetch failed" 로 뭉뚱그린다.
        // 실제 원인(DNS·TLS·연결거부)은 cause 에 있으므로 함께 찍어야 진단이 된다.
        const why = e.name === 'TimeoutError'
          ? '30초 내 응답 없음 (타임아웃)'
          : `${e.message}${e.cause ? ` (${e.cause.code || e.cause.message})` : ''}`;
        console.log(`⚠️  ${endpoint.name}: 전송 실패 — ${why}`);
        allOk = false;
      }
    }
  }

  // 색인 요청 실패가 배포 파이프라인을 막지 않도록 종료코드는 0으로 유지하되,
  // Actions 요약에 경고가 남도록 로그를 명확히 남긴다.
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    fs.appendFileSync(
      summary,
      `\n### IndexNow 색인 요청 (${mode})\n\n- 제출 URL: **${urls.length}건**\n- 결과: ${allOk ? '전 엔드포인트 정상 접수' : '일부 엔드포인트 실패 — 로그 확인'}\n`,
    );
  }
  if (!allOk) console.log('일부 엔드포인트가 실패했습니다. 키 파일 접근 가능 여부를 확인하세요.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
