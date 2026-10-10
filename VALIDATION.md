# 실시간 원화/USDT 및 화면 유지 수정 검증

기준 커밋: 0348caff88ddf8880d50aaaaca58fc2855abbf93. 로컬 검증 결과와 개선 내용을 기록합니다. 배포는 기존 main 브랜치 루트(/) 기반 GitHub Pages 절차를 사용합니다.

## 최종 적용 내용

- **시세**: 업비트 KRW-BTC와 바이낸스 BTCUSDT의 공개 WebSocket push. 원화/USDT 선택과 마지막 선택을 btc-kiosk-settings의 currency 필드에 저장합니다. 티커·밝기·디버그 설정도 함께 보존합니다. 선택한 소스만 연결하며 환율 API, 환산, polling, 관련 UI와 타이머를 제거했습니다. 이전 환율 저장 키도 정리합니다.
- **단위·기준**: USDT를 USD 또는 달러 기호로 표시하지 않습니다. 업비트 signed_change_rate는 전일 종가 대비이므로 '전일 대비', 바이낸스 P는 24시간 rolling 기준이므로 '24h'로 구분합니다.
- **연결 수명**: 선택 변경 시 이전 가격과 등락률을 먼저 지우고 소켓·타이머를 정리합니다. 세대 번호와 소켓 신원을 확인해 늦은 이벤트·Blob 디코딩·이전 close/open을 무시합니다. 동시 중복 연결과 반복 구독/polling을 제거했습니다.
- **복구**: 연결만 열려도 정상 시세로 표시하지 않습니다. 유효한 최근 ticker가 도착해야 '실시간 연결됨'이 됩니다. 15초간 새 시세가 없거나 거래소 이벤트가 오래되면 마지막 가격을 과거 데이터로 표시하고 backoff로 복구합니다. heartbeat UP만으로 가격의 신선도를 갱신하지 않습니다. 데이터 순서와 유한수·양수·필수 값도 검증합니다. 잘못된 구독 파라미터 오류는 자동 반복하지 않고 재시도 방법을 제공합니다.
- **제한**: Origin을 보내는 브라우저의 업비트 연결은 최소 10초, 바이낸스는 최소 2초 간격. backoff는 1→2→4→8→16→30초에 최대 25% jitter를 더하며 rate-limit 오류는 최소 30초 대기합니다. 세션 저장으로 reload 직후에도 간격을 유지합니다. 다른 탭/기기와 공유하는 IP의 요청량까지 조정하지는 못합니다.
- **heartbeat**: 업비트는 30초 간격 text PING. 바이낸스는 브라우저의 프로토콜 PING/PONG을 사용하며 JSON ping을 보내지 않습니다. 24시간 연결 종료/serverShutdown도 일반 복구 경로로 처리합니다. 24시간 실시간 유지 자체는 실측하지 않았습니다.
- **모바일·배터리**: 숨김/pagehide 때 시세 소켓, heartbeat, watchdog, 상태·번인 타이머를 중지하고 복귀 시 새 시세를 기다립니다. offline에서는 자동 연결 시도를 중지하고 online에서 복구합니다. 타이머 ID 누적 배열을 제거했고 Intl.NumberFormat을 재사용하며 변하지 않은 가격 텍스트는 다시 쓰지 않습니다.
- **화면 유지**: 기존 wake-lock.js의 중복 획득 방지, 시스템 해제 감지, 지연 완료 폐기, 앱 복귀, 오류·미지원 안내 및 사용자 재시도를 보존했습니다. 시스템 거부/해제를 무한 재요청하거나 수동 잠금을 우회하지 않습니다.
- **PWA·접근성**: scope별 v3 앱 셸 캐시(index/manifest/icon/wake-lock/market-data), root/index 공통 offline HTML, network-first 및 5초 제한, 앱 캐시만 정리. 선택 버튼 aria-pressed, 관리자 키보드 진입/dialog·포커스 복원·Tab 순환, 작은 화면 관리자 너비를 개선했습니다.

기존 고정 v1 캐시 이름만으로 HTML이 항상 갱신되지 않는 것은 아닙니다. worker 변경 시 install addAll이 index를 갱신할 수 있지만 HTML만 변경하거나 root 응답을 따로 저장하면 오래된 응답이 유지될 수 있었습니다.

## 검증 결과

- **단위 회귀 26개 통과**: Wake Lock 6개, 실시간 소켓 14개, SW 응답/캐시/버전 4개, 비동기 브라우저 대기 2개. KRW binary/USDT text 메시지, signed change, 반복 전환 100회, 지연 Blob 및 이전 소켓 이벤트, 요청 간격, 단일 backoff, malformed/다른 페어/Infinity/null/빈 값, 이벤트 역순, stale timestamp, heartbeat만 도착, 숨김/오프라인/복귀, 파라미터 오류, rate limit, serverShutdown, constructor 실패 및 reload 간격.
- **정적 검사 통과**: 각 JS 및 인라인 JS 구문, git diff --check, 전체 패치 reverse --check. 잔존 환율 조회 endpoint 및 polling 코드 없음(기존 저장 키 삭제 문구만 남음).
- **Chrome mock 회귀 통과**: 실제 브라우저에서 선택별 가격·단위·등락 기준, 반복 전환 10회, 지연 이벤트, 마지막 선택 저장/reload, pagehide/pageshow, 오래된 시세 오버레이와 복구, 티커 입력 검증, 키보드 관리자 진입, 환율 HTTP 요청 없음, pageerror 없음. 네이티브 Wake Lock 획득/해제/사용자 재시도와 SW 새 버전 버튼도 통과했습니다.
- **최종 전체 실행의 PWA 캐시 통과**: 원본 v1 worker를 설치한 뒤 root와 index에서 각각 v3 전환. HTML만 변경한 root/index 갱신, 양쪽 offline 셸, 오프라인 상태 표시, 가격 미캐시, 5개 셸 캐시 키와 다른 앱 캐시 보존. 열린 v3→v4 전환에서 사용자 적용 버튼과 새로고침 확인.
- **실제 공개 거래소 네트워크 통과**: 같은 로컬 앱을 mock 없이 Windows Chrome에서 실행해 업비트 KRW-BTC 및 바이낸스 BTCUSDT의 가격과 각 원본 등락률을 수신했습니다. 첫 실행 관측값은 각각 ₩112,952,000, 82,566.00 USDT이며 시점에 따라 변합니다. 이 값은 환산이나 테스트 fixture가 아닙니다. 장시간 안정성·거래소 24시간 강제 종료·공유 IP 제한은 별도 실측 대상입니다.
- **화면 QA**: evidence/live-krw.png 및 live-usdt.png를 확인했습니다. 검은 배경·BTC 아이콘·중앙 가격/등락 배치를 유지하고 상단 선택 버튼·거래소 라벨·하단 화면 유지 상태를 추가했습니다.

## 타임아웃 원인과 해결

PC 명령 실행 및 수정 파일 저장은 정상 확인했습니다. 남았던 migration 타임아웃은 테스트 대기 조건의 경합으로 판별했습니다. 사용한 Playwright 1.64.0의 waitForFunction은 async predicate가 반환한 Promise 자체를 truthy로 판정합니다. 이 환경에서 async () => false가 즉시 완료되고 실제 반환 값은 false인 것을 재현했습니다. 설치된 coreBundle.js도 predicate()를 await하지 않고 if(success)로 처리하는 경로임을 확인했습니다.

캐시 목록·active 상태를 조회하는 기존 async 조건은 값이 false여도 대기를 끝냈습니다. 최소 재현에서 이 잘못된 준비 완료 판정 뒤의 실제 active/controller는 여전히 v1이고, navigation 응답도 기존 캐시 HTML인 것을 기록했습니다. 열린 WebSocket이나 networkidle 대기가 원인이라는 근거는 없었습니다. 테스트는 DOMContentLoaded 및 명시적인 앱 상태를 기다리며, WebSocket이 열린 실제 앱에서도 수정 후 navigation이 완료됐습니다.

tests/browser-utils.cjs는 page.evaluate의 비동기 결과를 Node에서 끝까지 await하고 true가 될 때까지 제한 시간 내 다시 확인합니다. SW install/activate/waiting 상태와 GET_APP_VERSION 응답을 확인해 실제 제어 worker가 v3인 경우만 전환 완료로 인정합니다. offline 전환 전에도 HTML 캐시 쓰기가 끝났는지 실제 결과를 확인합니다. production SW에는 읽기 전용 버전 응답만 추가했습니다. 강제 새로고침이나 기기 정책 우회는 추가하지 않았습니다.

검증 결과:
- 단위 회귀 26개, 각 JS 및 인라인 구문, diff 검사와 전체 patch reverse-check 통과.
- 최소 재현: 단순 HTML 및 실제 구버전 앱, unload/fetch/mock 조건 분리와 CDP navigation/SW 버전 관측. evidence/sw-minimal.json에 경합 증거 보존.
- SW_ONLY=1 실행: root/index v1→v3, HTML만 변경한 갱신, 양쪽 offline 셸, 다른 앱 캐시 보존 통과(종료 코드 0).
- 최종 전체 브라우저 실행: 비동기 false 회귀 재현과 수정 헬퍼 검증, 통화/피드/복귀/stale/설정/Wake Lock/업데이트 버튼, root/index migration/offline, 실제 업비트·바이낸스 수신 및 업비트 첫 text PING 이후 지속 수신 모두 통과(종료 코드 0).

최종 시점에 SW 전환 타임아웃 차단은 남아 있지 않습니다. iPad 실기기 및 24시간 연속 운용은 여전히 미검증입니다. 보존 자료는 evidence/btc-price-kiosk.patch, unit-tests.txt, browser-tests.txt, sw-migration-tests.txt, browser-server-history.json, sw-minimal.json, verification-status.json 및 화면 PNG입니다.

## 미적용 개선 제안

1. 여러 탭의 연결 간격을 공유하는 BroadcastChannel/저장소 조정과 장시간 연결 관측. 현재 앱 한 탭의 요청 간격만 보장합니다.
2. 15초 freshness 기준을 저유동성 관리자 티커에 맞게 조정하거나 마지막 체결 시각과 연결 상태를 더 세분화. BTC에서 수신 지연을 빨리 발견하도록 보수적으로 설정했습니다.
3. 연속 시세 aria-live 안내 빈도 및 reduced-motion 대응. 가격 텍스트 중복 갱신은 줄였지만 연속 가격 변경을 읽는 빈도는 추가 조정할 수 있습니다.
4. 앱 UI 스크립트 분리와 배포 자동 정적 검사/브라우저 회귀 CI. 기능 구현에 필요한 연결 관리만 분리했고 빌드 체계는 도입하지 않았습니다.

## 게시 및 iPad 검증

main 브랜치 push 후 GitHub가 생성한 pages-build-deployment의 최종 커밋과 성공 상태를 확인합니다. 이미 열린 v1 HTML에는 새 버전 버튼이 없으므로 새 worker 활성화 후 한 번 앱을 다시 열거나 새로고침해야 합니다. 오프라인에서는 앱 셸만 실행되며 실시간 가격이 있는 것처럼 표시하지 않습니다.

iPadOS 27.0.1 실기기는 검증하지 못했습니다. 특정 OS 버그로 단정하지 않습니다. 게시 후 홈 화면 앱에서 저전력 모드 on/off, 자동 잠금 시간 초과 방치, 원화/USDT 반복 전환, 앱 전환/복귀, 수동 잠금/해제를 확인해야 합니다.

## 공식 문서 확인

- [업비트 현재가](https://docs.upbit.com/kr/reference/websocket-ticker): endpoint, ticker 구조 및 전일 대비 필드.
- [업비트 제한](https://docs.upbit.com/kr/reference/rate-limits): Origin 10초당 1회, 일반 연결/메시지 제한.
- [업비트 연결 유지](https://docs.upbit.com/kr/docs/websocket-best-practice), [text PING](https://global-docs.upbit.com/reference/websocket-guide): idle 및 heartbeat.
- [바이낸스 스트림](https://developers.binance.com/en/docs/products/spot/web-socket-streams): 24hrTicker, 1초 push, 24시간 종료, PING/PONG, 연결/메시지 제한.
- [WakeLockSentinel 해제](https://developer.mozilla.org/en-US/docs/Web/API/WakeLockSentinel/released), [SW lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).


## 버튼 자동 숨김 변경 (로컬, 미게시)

- 평소 통화 버튼, Wake Lock/업데이트 안내와 설정 진입 표시를 숨깁니다. 화면 탭/클릭 또는 Tab 키로 나타나며 5초 뒤 숨깁니다. 조작 요소의 포커스 또는 설정 패널이 열려 있으면 유지합니다. 빈 화면을 탭하면 조작 포커스를 해제합니다.
- 숨겨진 요소는 visibility/pointer-events로 포인터와 탭 순서에서 제외합니다. Tab 입력은 기본 포커스 이동 전에 UI를 드러냅니다. 첫 터치가 새로 나타난 버튼을 같은 제스처로 실행하지 않도록 해당 클릭을 차단합니다.
- 시세 오류·지연 때는 가격을 흐리게 하고 상태 제목을 계속 표시합니다. 상세 안내와 재시도 버튼은 화면 조작 후 접근합니다. 시스템 거부를 재시도 루프로 우회하지 않습니다.
- SW 셸 버전을 v4로 올렸고 실제 배포된 v3와 원본 v1 각각에서 root/index 갱신, HTML-only 갱신, 오프라인 셸과 타 앱 캐시 보존을 Chrome에서 검증했고 모두 통과했습니다.
- 단위 회귀 26개, 인라인 JS 및 테스트 구문, diff 검사 통과. Chrome에서 390px 터치 첫 탭·반복 탭, 5초 자동 숨김, Tab 진입·포커스 유지, 설정 패널/Escape·복귀, stale 최소 표시 및 기존 통화·Wake Lock·업데이트 동작을 검증했고 전체 실행이 종료 코드 0으로 통과했습니다.
- 아이콘 파일과 manifest, iPad 상태표시줄 설정은 변경하지 않았습니다. 배포 SVG 모서리는 RGBA(0,0,0,0), 주황색 원은 (247,147,26,255), 중앙 ₿는 (255,255,255,255)였습니다. apple-touch-icon 및 apple-mobile-web-app-capable/status-bar-style은 배포 HTML에 없습니다. display는 fullscreen이며 앱 배경 색은 검정입니다. 실기기 아이콘 선택 및 시스템 상태표시줄 동작은 미확인입니다.
- 이 변경은 로컬 수정이며 push/배포하지 않았습니다. iPad 실기기 검증은 남아 있습니다.

근거 문서: [WebKit 홈 화면 앱과 manifest 아이콘 지원/Apple touch icon 우선순위](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/#new-fallback-icon), [Apple 브라우저 UI 숨김 및 상태표시줄 설정](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html). SVG는 manifest와 favicon에 공통 지정되며, 시스템 상태표시줄을 숨긴다는 보장은 추가하지 않았습니다.

현재 검증 자료: evidence/ui-unit-tests.txt, ui-browser-tests.txt, ui-mobile-hidden.png, ui-mobile-controls.png, ui-controls.patch, ui-verification.json.


## 최종 아이콘·버튼 변경 및 게시 검증

이 절은 앞 절의 로컬 미게시 상태를 대체합니다. 사용자의 게시 승인 후 기존 main 루트 Pages 방식을 유지하여 게시합니다. 홈 화면 아이콘은 별도 SVG 원본과 Apple PNG 152/167/180px, manifest PNG 192/512px로 제작했습니다. 기존 흰색 경로를 그대로 보존하며 원형 로고 파일/키오스크 검정 배경/시스템 상태표시줄 설정은 유지했습니다.

최종 단위 회귀 28개, JavaScript 및 diff 검사 통과. Chrome 전체 회귀(터치 최초 표시/반복 탭, 키보드·포커스, 자동 숨김, 설정, 시세 지연, 통화, Wake Lock, 사용자 업데이트) 통과. v1/v3 각각 root/index에서 v5 전환, HTML-only 갱신, offline PNG 5개와 셸 10개, 타 앱 캐시 보존을 검증했고 종료 코드 0으로 통과했습니다.

아이콘 5개 전체 픽셀은 alpha=255이며 검정/어두운 픽셀은 없습니다. 각 네 모서리는 RGBA(247,147,26,255)입니다. 512px 심볼의 최대 반지름은 166.83px로 maskable 안전 반지름 204.8px보다 작습니다. 원본 흰색 SVG 경로 동일성 및 PNG 치수도 단위 검사했습니다. 근거: evidence/icon-render.txt, icon-pixel-checks.json, final-unit-tests.txt, final-browser-tests.txt.

Apple 크기는 [Apple Web Clip 아이콘 지정](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html), 안전 영역은 [W3C manifest](https://www.w3.org/TR/appmanifest/#icon-masks-and-safe-zone)를 따릅니다. 설치 당시의 홈 화면 아이콘이 앱 코드/서비스 워커 갱신으로 자동 교체된다는 보장은 하지 않습니다. 새 아이콘이 보이지 않으면 사이트에서 새로 추가해 확인할 수 있으며, 기존 항목 삭제 시 저장소와 설정 유지도 보장하지 않습니다. iPad 실기기 검증은 남아 있습니다.
