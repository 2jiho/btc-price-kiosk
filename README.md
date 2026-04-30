# btc-price-kiosk

비트코인 실시간 가격을 보여주는 PWA 웹 애플리케이션입니다. Binance WebSocket을 통해 BTC/USDT 가격을 실시간으로 받아오고, 환율 API를 통해 KRW 가격을 함께 표시합니다. 태블릿이나 모니터에 전체 화면으로 띄워두는 키오스크 용도로 제작되었습니다.

## 실행 방법

PWA(Service Worker)가 필요하므로 로컬 서버가 필요합니다.

```bash
python3 -m http.server 8080
# → http://localhost:8080
```

## 기능

- 실시간 BTC/USDT 가격 (Binance WebSocket)
- 24시간 가격 변화율 표시 (상승/하락 색상)
- KRW 환산 가격 (Frankfurter + exchange-api CDN 이중화)
- WebSocket 장애 시 마지막 가격 + 경과 시간 표시
- OLED 번인 방지 (주기적 픽셀 시프트)
- Wake Lock API (화면 꺼짐 방지)
- 전체 화면 시 커서 자동 숨김
- PWA 오프라인 지원 (Service Worker)
- WebSocket ping/pong 헬스체크 (30초 간격)
- Content Security Policy 적용

### 관리자 설정

우측 상단 상태 표시줄 클릭 → 관리자 패널:
- 코인 티커 변경 (BTC, ETH, SOL 등 Binance USDT 페어)
- 업데이트 주기 조절 (1~30초)
- 화면 밝기 조절 (10~100%)
- 디버그 모드

## 기술 스택

| 영역 | 기술 |
|------|------|
| BTC 가격 | Binance WebSocket API v3 (`ticker.24hr`) |
| 환율 (Primary) | Frankfurter API (ECB 55개 중앙은행) |
| 환율 (Secondary) | fawazahmed0/exchange-api (jsDelivr CDN) |
| PWA | Service Worker (cache-first + CDN 런타임 캐싱) |
| 배포 | GitHub Pages |

## GitHub Pages

[2jiho.github.io/btc-price-kiosk](https://2jiho.github.io/btc-price-kiosk)
