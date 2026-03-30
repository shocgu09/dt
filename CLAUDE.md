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
- Primary: `#7c6fff` / Light: `#a09aff` / Dark: `#5a54e0`
- Accent: `#ff6b6b`
- Semantic: Driver `#4ade80`, Passenger `#60a5fa`, Warning `#fbbf24`
- Dark BG: `#0a0a0e` → `#111118` → `#1a1a24`
- Light BG: `#f4f4f8` → `#ffffff` → `#ebebf3`

### Design Principles
1. **Smart Brutalism** — 대담한 네오 브루탈리스트 + 명확한 정보 전달
2. **Data-Driven Trust** — 숫자/상태를 명확히 시각화하여 신뢰 구축
3. **Mobile-First** — PWA 모바일 최적화, 충분한 터치 타겟
4. **Semantic Color** — 운전자(green), 동승자(blue), 위험(red), 보류(yellow) 일관 유지
5. **Progressive Disclosure** — 정보 단계적 공개로 복잡도 관리

### Typography
- Font: Inter, Apple SD Gothic Neo
- Weight: 600~800 주로 사용
- 상세 사항은 `.impeccable.md` 참조
