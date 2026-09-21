// 종목 마스터 생성 — invest/stock-master.json
// 네이버 자동완성은 이름의 "앞부분"만 맞춘다 (초성도 마찬가지: SKㅎㅇㄴㅅ 은 되고 ㅎㅇㄴㅅ 은 안 된다).
// 그래서 전 종목 [코드, 이름, 시장] 목록을 정적 파일로 두고 화면에서 초성·키워드 검색을 직접 한다.
// 새로 상장한 종목은 이 파일을 다시 만들기 전까지 서버 자동완성(앞부분 일치)으로만 찾을 수 있다.
//
// 실행: node scripts/build-stock-master.mjs   (한 달에 한 번쯤, 또는 신규 상장 종목이 안 보일 때)
import fs from 'node:fs';

const H = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://m.stock.naver.com/' };
const num = (v) => Number(String(v ?? '').replace(/,/g, '')) || 0;
const rows = new Map();

for (const market of ['KOSPI', 'KOSDAQ']) {
  for (let page = 1; page < 60; page++) {
    const r = await fetch(`https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${page}&pageSize=100`, { headers: H });
    if (!r.ok) throw new Error(`${market} p${page}: ${r.status}`);
    const d = await r.json();
    const list = d.stocks || [];
    for (const s of list) {
      if (!/^[0-9A-Z]{6}$/.test(s.itemCode)) continue;
      const kind = s.stockEndType === 'etf' ? 'ETF' : (s.stockEndType === 'etn' ? 'ETN' : (market === 'KOSPI' ? '코스피' : '코스닥'));
      rows.set(s.itemCode, { c: s.itemCode, n: s.stockName, m: kind, cap: num(s.marketValueRaw ?? s.marketValue) });
    }
    process.stdout.write(`\r${market} ${page} (${rows.size})   `);
    if (list.length < 100) break;
    await new Promise((res) => setTimeout(res, 150));      // 네이버에 부담을 주지 않게 천천히
  }
}
// 시가총액 큰 순 — 검색 결과도 이 순서로 나온다
const out = [...rows.values()].sort((a, b) => b.cap - a.cap).map((x) => [x.c, x.n, x.m]);
if (out.length < 3000) throw new Error('종목 수가 너무 적습니다: ' + out.length);
fs.writeFileSync(new URL('../invest/stock-master.json', import.meta.url), JSON.stringify({ at: new Date().toISOString().slice(0, 10), items: out }));
console.log(`\n${out.length}종목 저장`);
