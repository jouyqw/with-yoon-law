#!/usr/bin/env node
/**
 * Google Search Console 색인 상태 자동 점검
 * ---------------------------------------------------------------
 * 구글은 일반 페이지에 대한 "색인 요청"을 API로 허용하지 않는다.
 * (Indexing API 는 JobPosting / BroadcastEvent 전용)
 * 따라서 자동화 가능한 최대치는 다음과 같다.
 *
 *   1. sitemap.xml 자동 갱신  → 구글이 알아서 재수집 (이미 구축됨)
 *   2. URL Inspection API 로 색인 여부를 매일 자동 점검  ← 이 스크립트
 *   3. 미색인 URL 목록만 뽑아 리포트 → 사람이 GSC 에서 클릭 몇 번으로 처리
 *
 * 환경변수
 *   GSC_SA_JSON    (필수) 서비스 계정 키 JSON 전문
 *   GSC_SITE_URL   (필수) GSC 속성 식별자
 *                        - 도메인 속성:   sc-domain:with-yoon-law.com
 *                        - URL 접두어 속성: https://with-yoon-law.com/
 *   GSC_MAX_URLS   (선택) 1회 점검할 최대 URL 수 (기본 120, API 일일 쿼터 2,000)
 */

import fs from 'node:fs';
import crypto from 'node:crypto';

const SITE_URL = process.env.GSC_SITE_URL || '';
const MAX_URLS = Number(process.env.GSC_MAX_URLS || 120);
const SITEMAP = 'sitemap.xml';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** 서비스 계정 JSON 으로 서명된 JWT 를 만들어 액세스 토큰을 발급받는다. */
async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    }),
  );

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const signature = b64url(signer.sign(sa.private_key));
  const assertion = `${header}.${claim}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  const json = await res.json();
  if (!json.access_token) throw new Error(`토큰 발급 실패: ${JSON.stringify(json).slice(0, 300)}`);
  return json.access_token;
}

function sitemapUrls() {
  if (!fs.existsSync(SITEMAP)) throw new Error(`${SITEMAP} 이 없습니다.`);
  const xml = fs.readFileSync(SITEMAP, 'utf8');
  return [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)].map((m) => m[1].trim());
}

async function inspect(token, url) {
  const res = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inspectionUrl: url, siteUrl: SITE_URL, languageCode: 'ko' }),
  });

  if (res.status === 429) return { url, state: 'QUOTA', detail: '일일 쿼터 초과' };
  if (!res.ok) return { url, state: 'ERROR', detail: `HTTP ${res.status} ${(await res.text()).slice(0, 160)}` };

  const idx = (await res.json())?.inspectionResult?.indexStatusResult || {};
  return {
    url,
    state: idx.verdict || 'UNKNOWN',                 // PASS / PARTIAL / FAIL / NEUTRAL
    coverage: idx.coverageState || '',               // "Submitted and indexed" 등
    lastCrawl: (idx.lastCrawlTime || '').slice(0, 10),
  };
}

async function main() {
  if (!SITE_URL) throw new Error('GSC_SITE_URL 환경변수가 없습니다.');
  const raw = process.env.GSC_SA_JSON;
  if (!raw) throw new Error('GSC_SA_JSON 시크릿이 없습니다.');
  const sa = JSON.parse(raw);

  const token = await getAccessToken(sa);

  // 최신 콘텐츠부터 확인하는 게 유용하므로 뒤에서부터 자른다.
  const all = sitemapUrls();
  const targets = all.slice(-MAX_URLS);
  console.log(`점검 대상 ${targets.length}건 (sitemap 총 ${all.length}건)`);

  const results = [];
  for (const url of targets) {
    const r = await inspect(token, url);
    results.push(r);
    console.log(`${r.state === 'PASS' ? '✅' : '❌'} ${r.state.padEnd(8)} ${r.url}${r.coverage ? ` — ${r.coverage}` : ''}`);
    if (r.state === 'QUOTA') break;
    await new Promise((r2) => setTimeout(r2, 350)); // 분당 쿼터 여유 확보
  }

  const indexed = results.filter((r) => r.state === 'PASS');
  const missing = results.filter((r) => r.state !== 'PASS' && r.state !== 'QUOTA');
  const rate = results.length ? Math.round((indexed.length / results.length) * 100) : 0;

  const lines = [
    '## 구글 색인 상태 점검',
    '',
    `- 점검: **${results.length}건** / 색인됨 **${indexed.length}건** (${rate}%)`,
    `- 미색인: **${missing.length}건**`,
    '',
  ];

  if (missing.length) {
    lines.push('### 미색인 URL — GSC에서 수동 색인 요청 대상', '');
    lines.push('| URL | 상태 | 사유 |', '|---|---|---|');
    for (const m of missing.slice(0, 60)) {
      lines.push(`| ${m.url} | ${m.state} | ${m.coverage || m.detail || '-'} |`);
    }
    if (missing.length > 60) lines.push(`| ... 외 ${missing.length - 60}건 | | |`);
  } else {
    lines.push('전량 색인 완료. 조치 필요 없음.');
  }

  const report = lines.join('\n');
  fs.writeFileSync('gsc-report.md', `${report}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${report}\n`);

  // 후속 스텝(이슈 생성)에서 쓰도록 미색인 건수를 출력
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `missing=${missing.length}\nrate=${rate}\n`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
