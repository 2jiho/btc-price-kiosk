# btc-price-kiosk

공개 WebSocket으로 실제 거래소 시세를 표시하는 PWA 키오스크입니다.

- **원화 · 업비트**: KRW-BTC의 원화 가격, 전일 대비 등락률.
- **USDT · 바이낸스**: BTCUSDT의 USDT 가격, 최근 24시간 대비 등락률. USD로 환산하지 않습니다.
- 상단 버튼으로 선택하고 마지막 선택을 기존 설정과 함께 저장합니다. 선택한 거래소만 연결합니다.
- 실시간 서버 push를 표시하며 환율 조회·환산·시세 polling은 없습니다.
- 끊김·수신 지연·오프라인을 표시하고 연결 요청 간격과 backoff를 지켜 재연결합니다.
- 화면 유지 상태와 재시도, OLED 번인 방지, 밝기 필터 및 관리자 설정을 제공합니다.
- 앱 셸은 network-first/오프라인 fallback으로 갱신하며 시세를 캐시하지 않습니다.

## 실행

HTTPS 또는 localhost에서 실행하세요.

~~~powershell
python -m http.server 8080
~~~

http://localhost:8080 에서 열 수 있습니다. 버튼과 보조 안내는 평소 숨겨집니다. 화면 탭/클릭이나 Tab 키로 나타나고 조작하지 않으면 5초 후 숨겨집니다. 설정 창이 열렸거나 조작 요소에 포커스가 있으면 유지되며, 화면의 빈 곳을 탭하면 포커스를 해제합니다. 시세 오류·지연 상태는 가격을 흐리게 하고 상태 제목을 남깁니다. 관리자 설정은 우측 상태 표시를 클릭하거나 키보드로 선택 후 Enter를 눌러 엽니다. 티커 변경은 각 거래소의 KRW 또는 USDT 시장이 지원하는 종목에 한합니다. 밝기 필터는 표시를 어둡게 하며 기기의 하드웨어 밝기를 바꾸지 않습니다.

## 테스트

Node.js 24 환경에서:

~~~powershell
node --test tests/*.test.cjs
node --check market-data.js
node --check wake-lock.js
node --check service-worker.js
~~~

브라우저 검증에는 Playwright와 Chrome이 필요합니다. 별도 폴더에 설치할 수 있습니다.

~~~powershell
npm install --prefix ../browser-tests --no-audit --no-fund playwright@1.64.0
$env:NODE_PATH = (Resolve-Path ../browser-tests/node_modules).Path
node tests/browser.cjs
$env:LIVE_NETWORK = '1'
node tests/browser.cjs
~~~

CHROME_PATH 환경변수로 Chrome 실행 경로를 지정할 수 있습니다. 검증 결과와 개선 제안은 [VALIDATION.md](VALIDATION.md)를 참고하세요.

## 공식 API

- [업비트 현재가](https://docs.upbit.com/kr/reference/websocket-ticker): wss://api.upbit.com/websocket/v1, ticker 구독.
- [업비트 요청 제한](https://docs.upbit.com/kr/reference/rate-limits): 브라우저 Origin 요청은 10초 간격을 지킵니다.
- [업비트 연결 관리](https://docs.upbit.com/kr/docs/websocket-best-practice): 120초 idle 종료 및 Ping 유지.
- [바이낸스 시장 스트림](https://developers.binance.com/en/docs/products/spot/web-socket-streams): wss://stream.binance.com:443/ws/btcusdt@ticker. 프로토콜 PING/PONG은 브라우저가 처리하며 종료 시 재연결합니다.

## 게시

GitHub Pages: https://2jiho.github.io/btc-price-kiosk/

기존 GitHub Pages 설정인 main 브랜치 루트(/)에서 자동 배포합니다. 별도 사용자 정의 Pages 워크플로는 추가하지 않았습니다. 설치된 구버전 앱은 새 worker 활성화 후 다시 열거나 새로고침해야 합니다. 화면 유지 API는 시스템에 의해 거부·해제될 수 있습니다.

SW 전환만 분리 검증하려면 PowerShell에서 `$env:SW_ONLY = "1"; node tests/browser.cjs`를 실행하세요. 전체 실행 전에는 `Remove-Item Env:SW_ONLY`로 해제합니다. 비동기 readiness는 `tests/browser-utils.cjs`로 확인합니다.


## 홈 화면 아이콘

홈 화면 전용 아이콘은 불투명 주황색(#F7931A) 전체 정사각형 배경과 기존 흰색 ₿ SVG 경로를 사용합니다. 페이지 안의 원형 로고와 검은 배경은 유지합니다. OS가 아이콘 모서리를 자르며 이미지에 모서리 마스크를 넣지 않습니다.

Apple touch icon은 iPhone용 180px, iPad용 167px·152px PNG를 명시합니다. manifest는 192px·512px PNG를 any/maskable 용도로 지정합니다. 흰색 심볼 전체는 중앙 반지름 40% 원형 안전 영역 안에 있습니다. 아이콘은 v5 셸 캐시에 포함됩니다.

재생성: `$env:NODE_PATH = (Resolve-Path ../browser-tests/node_modules).Path; node scripts/render-icons.cjs`. 동일 Chrome 버전에서 결정적으로 렌더링하며 모든 픽셀의 불투명도, 검정 픽셀 부재, 안전 영역을 확인합니다.

게시 후 기존 홈 화면 바로가기의 아이콘이 자동으로 바뀐다는 보장은 없습니다. 앱을 다시 열거나 새 버전을 적용해 화면 코드를 갱신한 뒤에도 아이콘이 예전 모습이면 Safari에서 사이트를 열어 홈 화면에 새로 추가해 확인하세요. 새 아이콘이 확인된 후 기존 바로가기를 정리할 수 있습니다. 기존 아이콘을 삭제·재추가하는 과정에서 앱 설정/저장소가 유지되는지는 보장하지 않습니다. iPad 실기기에서 아이콘 갱신은 검증하지 못했습니다.
