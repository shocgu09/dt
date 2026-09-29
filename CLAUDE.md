# DT Club

DT Club은 드라이브를 사랑하는 사람들의 커뮤니티 웹앱 (PWA)입니다.

## Tech Stack
- Vanilla HTML/CSS/JS (no framework, no bundler)
- Firebase (Auth, Firestore, Functions)
- Cloudflare Pages hosting
- PWA (service worker, manifest.json)

## Design Context

### Brand: 테크 / 스마트 / 미래지향
- 신뢰와 안정감을 주는 스마트 플랫폼
- 네오 브루탈리스트 기반 테크 감성 (0px radius, offset box-shadow, bold border accents)

### Color System
- **단일 출처: `tokens.css`** — 메인과 모든 서브페이지가 각자 style.css 보다 먼저 불러온다. 색은 여기서만 바꾸고, 페이지 전용 값(재테크 시세 색 등)만 각 페이지 style.css 에 둔다.
- Primary(앰버): `#d97706` / Light: `#f59e0b` / Dark: `#b45309` (라이트 테마 `#b45309` / `#d97706` / `#92400e`). 보라(`#7c6fff` 계열)는 옛 색이라 쓰지 않는다.
- Accent: `#ff6b6b` (라이트 `#e05252`)
- Semantic: Driver `#4ade80`, Passenger `#60a5fa`, Warning `#fbbf24`
- Dark BG(슬레이트): `#151b24` → `#1c2330` → `#252d3c` — 순수 검정 계열은 쓰지 않는다
- Light BG: `#f4f4f8` → `#ffffff` → `#ebebf3`
- Border: `#37425a` (라이트 `#d0d0e0`) · Text: `#eef2f7` → `#9aa6bc` → `#7d8aa3`
- 버튼 글자색은 `#fff` 대신 `var(--on-primary)`

### Design Principles
1. **Smart Brutalism** — 대담한 네오 브루탈리스트 + 명확한 정보 전달
2. **Data-Driven Trust** — 숫자/상태를 명확히 시각화하여 신뢰 구축
3. **Mobile-First** — PWA 모바일 최적화, 충분한 터치 타겟
4. **Semantic Color** — 운전자(green), 동승자(blue), 위험(red), 보류(yellow) 일관 유지
5. **Progressive Disclosure** — 정보 단계적 공개로 복잡도 관리

### Typography
- Font: Pretendard Variable (본문·한글), Space Grotesk (영문 로고·영문 강조)
- 한글 제목에 `text-transform: uppercase`·자간을 걸지 않는다. 제목은 `word-break: keep-all`
- Weight: 600~800 주로 사용
- 상세 사항은 `.impeccable.md` 참조
