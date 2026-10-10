// Public market data only. No keys, price polling, or currency conversion.
(function (root) {
  "use strict";
  function createMarketFeed(options) {
    options = options || {};
    var WS = options.WebSocket || root.WebSocket;
    var clock = options.clock || {
      now: Date.now, setTimeout: root.setTimeout.bind(root), clearTimeout: root.clearTimeout.bind(root),
      setInterval: root.setInterval.bind(root), clearInterval: root.clearInterval.bind(root),
    };
    var onTick = options.onTick || function () {};
    var onState = options.onState || function () {};
    var random = options.random || Math.random;
    var staleMs = options.staleMs || 15000;
    var selection = null, socket = null, generation = 0, last = null;
    var retryTimer = null, healthTimer = null, heartbeatTimer = null;
    var failures = 0, active = options.active !== false, online = options.online !== false, disposed = false;
    var lastAttempt = { KRW: -Infinity, USDT: -Infinity };
    var store = options.attemptStore;
    if (store === undefined) { try { store = root.sessionStorage; } catch (_) {} }
    if (store) {
      ["KRW", "USDT"].forEach(function (currency) {
        try {
          var value = Number(store.getItem("btc-kiosk-connect-" + currency));
          if (value > 0 && value <= clock.now() && value > clock.now() - 60000) lastAttempt[currency] = value;
        } catch (_) {}
      });
    }

    function describe(currency, ticker) {
      return { currency: currency, ticker: ticker,
        exchange: currency === "KRW" ? "업비트" : "바이낸스",
        market: currency === "KRW" ? "KRW-" + ticker : ticker + "USDT",
        changeLabel: currency === "KRW" ? "전일 대비" : "24h",
      };
    }
    function emit(kind, reason, retryAt) {
      onState({ kind: kind, reason: reason || "", retryAt: retryAt || null, selection: selection, last: last });
    }
    function clearTimers() {
      if (retryTimer !== null) clock.clearTimeout(retryTimer);
      if (healthTimer !== null) clock.clearInterval(healthTimer);
      if (heartbeatTimer !== null) clock.clearInterval(heartbeatTimer);
      retryTimer = healthTimer = heartbeatTimer = null;
    }
    function disconnect() {
      generation++;
      clearTimers();
      var old = socket;
      socket = null;
      if (old) {
        old.onopen = old.onmessage = old.onerror = old.onclose = null;
        try { old.close(); } catch (_) {}
      }
    }
    function eligible() { return !disposed && active && online && !!selection; }
    function rateWait() {
      // Browsers send Origin: Upbit limits these requests to one per 10 seconds.
      // Binance: at least 2 seconds between attempts (<300 attempts / 5 min).
      var minimum = selection.currency === "KRW" ? 10000 : 2000;
      return Math.max(0, lastAttempt[selection.currency] + minimum - clock.now());
    }
    function schedule(delay, reason) {
      if (!eligible()) { emit(!online ? "offline" : "paused", reason); return; }
      delay = Math.max(delay || 0, rateWait());
      if (delay === 0) { connect(); return; }
      var token = generation;
      emit("backoff", reason || "연결 요청 간격 대기", clock.now() + delay);
      retryTimer = clock.setTimeout(function () {
        retryTimer = null;
        if (token === generation && eligible()) connect();
      }, delay);
    }
    function fail(reason, minimumDelay) {
      disconnect();
      var backoff = Math.min(30000, 1000 * Math.pow(2, Math.min(failures++, 5)));
      schedule(Math.max(minimumDelay || 0, backoff + Math.floor(random() * backoff * 0.25)), reason);
    }
    async function decode(data) {
      if (typeof data === "string") return JSON.parse(data);
      if (data && typeof data.text === "function") return JSON.parse(await data.text());
      return JSON.parse(new TextDecoder().decode(data));
    }
    function number(value) {
      if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) return NaN;
      return Number(value);
    }
    function connect() {
      if (!eligible()) return;
      if (rateWait() > 0) { schedule(0); return; }
      var current = selection;
      var token = generation;
      var startedAt = clock.now(), gotTick = false;
      lastAttempt[current.currency] = startedAt;
      if (store) {
        try { store.setItem("btc-kiosk-connect-" + current.currency, String(startedAt)); } catch (_) {}
      }
      emit("connecting");
      var connection;
      try {
        connection = new WS(current.currency === "KRW" ? "wss://api.upbit.com/websocket/v1" :
          "wss://stream.binance.com:443/ws/" + current.market.toLowerCase() + "@ticker");
        connection.binaryType = "arraybuffer";
      } catch (error) { fail("연결 생성 실패: " + error.name); return; }
      socket = connection;
      function isCurrent() { return token === generation && socket === connection && eligible(); }
      healthTimer = clock.setInterval(function () {
        if (!isCurrent()) return;
        if (!gotTick && clock.now() - startedAt >= staleMs) {
          fail("시세 수신 시간 초과");
        } else if (gotTick && Math.max(clock.now() - last.receivedAt, clock.now() - last.eventTime) >= staleMs) {
          fail("시세 업데이트 지연");
        }
      }, 1000);
      connection.onopen = function () {
        if (!isCurrent()) return;
        emit("waiting");
        if (current.currency === "KRW") {
          try {
            connection.send(JSON.stringify([
              { ticket: "btc-kiosk-" + startedAt + "-" + token },
              { type: "ticker", codes: [current.market] }, { format: "DEFAULT" },
            ]));
          } catch (error) { fail("구독 요청 실패"); return; }
          // Text PING is supported by Upbit. UP proves transport health only.
          heartbeatTimer = clock.setInterval(function () {
            if (isCurrent() && connection.readyState === WS.OPEN) {
              try { connection.send("PING"); } catch (_) { fail("연결 유지 요청 실패"); }
            }
          }, 30000);
        }
        // Binance protocol PING/PONG is handled by the browser, not JSON ping.
      };
      connection.onmessage = async function (event) {
        if (!isCurrent()) return;
        try {
          var data = await decode(event.data);
          if (!isCurrent()) return; // Includes a Blob decoding across a switch.
          if (data.error || (data.code !== undefined && data.msg)) {
            var code = data.error ? data.error.name : String(data.code);
            if (code === "TOO_MANY_REQUEST") { fail("요청 한도 초과", 30000); return; }
            disconnect();
            emit("error", "거래소 오류: " + code + " · 지원하는 티커를 확인하세요");
            return;
          }
          if (data.e === "serverShutdown") { fail("거래소 연결 재시작"); return; }
          if (data.status === "UP") return;
          var price, change, eventTime;
          if (current.currency === "KRW") {
            if (data.type !== "ticker" || data.code !== current.market) return;
            price = number(data.trade_price);
            change = number(data.signed_change_rate) * 100;
            eventTime = number(data.timestamp);
          } else {
            if (data.e !== "24hrTicker" || data.s !== current.market) return;
            price = number(data.c); change = number(data.P); eventTime = number(data.E);
          }
          if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(change) ||
              !Number.isFinite(eventTime) || eventTime <= 0 || eventTime > clock.now() + 60000) return;
          if (last && eventTime < last.eventTime) return;
          last = { price: price, change: change, eventTime: eventTime, receivedAt: clock.now(), selection: current };
          gotTick = true;
          onTick(last);
          if (clock.now() - eventTime >= staleMs) { fail("거래소 데이터 지연"); return; }
          failures = 0;
          emit("live");
        } catch (error) {
          // Corrupt payloads do not mark prices fresh. The watchdog will recover.
          if (isCurrent() && options.onError) options.onError(error);
        }
      };
      connection.onerror = function () { if (isCurrent()) fail("네트워크 연결 오류"); };
      connection.onclose = function () { if (isCurrent()) fail("거래소 연결 끊김"); };
    }
    function select(currency, ticker) {
      ticker = (ticker || "BTC").toUpperCase();
      if (!["KRW", "USDT"].includes(currency) || !/^[A-Z0-9]{1,20}$/.test(ticker)) throw new Error("Invalid market selection");
      if (selection && selection.currency === currency && selection.ticker === ticker) return;
      disconnect();
      selection = describe(currency, ticker); last = null; failures = 0;
      schedule(0);
    }
    function setActive(value) {
      value = !!value;
      if (value === active || disposed) return;
      active = value; disconnect();
      if (active) schedule(0); else emit("paused", "앱 복귀 시 새 시세를 확인합니다");
    }
    function setOnline(value) {
      value = !!value;
      if (value === online || disposed) return;
      online = value; disconnect();
      if (online) schedule(0); else emit("offline", "네트워크 연결을 확인하세요");
    }
    return {
      select: select, setActive: setActive, setOnline: setOnline,
      retry: function () { if (eligible()) { disconnect(); schedule(0); } },
      dispose: function () { disposed = true; disconnect(); },
    };
  }
  if (typeof module === "object" && module.exports) module.exports = { createMarketFeed: createMarketFeed };
  else root.createMarketFeed = createMarketFeed;
})(typeof window !== "undefined" ? window : globalThis);
