// One request in flight; retries only on an explicit action or a new visible session.
(function () {
  "use strict";
  var status = document.getElementById("wake-lock-status");
  var retry = document.getElementById("wake-lock-retry");
  var sentinel = null;
  var pending = null;
  var epoch = 0;
  var suspended = document.visibilityState !== "visible";

  function show(message, canRetry) {
    status.textContent = message;
    retry.hidden = !canRetry;
    retry.disabled = !!pending;
  }

  function release(lock) {
    if (lock && !lock.released) {
      return lock.release().catch(function (error) {
        console.warn("Wake Lock release failed:", error);
      });
    }
    return Promise.resolve();
  }

  function acquire() {
    if (!window.isSecureContext || !("wakeLock" in navigator)) {
      show("화면 켜짐 유지 미지원 · HTTPS 및 브라우저 지원을 확인하세요", false);
      return Promise.resolve();
    }
    if (suspended || document.visibilityState !== "visible") return Promise.resolve();
    if (pending) return pending;
    if (sentinel && !sentinel.released) return Promise.resolve();
    var requestEpoch = epoch;
    show("화면 켜짐 유지 요청 중…", false);
    pending = Promise.resolve().then(async function () {
      try {
        var lock = await navigator.wakeLock.request("screen");
        if (requestEpoch !== epoch || suspended || document.visibilityState !== "visible") {
          await release(lock);
          return;
        }
        sentinel = lock;
        lock.addEventListener("release", function () {
          if (sentinel !== lock) return;
          sentinel = null;
          show(suspended ? "화면 켜짐 유지 대기 · 앱으로 돌아오면 재요청합니다" :
            "화면 켜짐 유지 해제됨 · 시스템 설정을 확인하고 다시 시도하세요", !suspended);
        }, { once: true });
        if (lock.released) {
          sentinel = null;
          show("화면 켜짐 유지 해제됨 · 다시 시도하세요", true);
        } else {
          show("화면 켜짐 유지 활성 · 시스템에서 해제할 수 있습니다", false);
        }
      } catch (error) {
        console.warn("Wake Lock request failed:", error);
        if (requestEpoch === epoch && !suspended) {
          show("화면 켜짐 유지 실패 (" + error.name + ") · 저전력 모드·배터리·권한을 확인하세요", true);
        }
      } finally {
        pending = null;
        retry.disabled = false;
      }
    });
    // A hide/show transition during a request invalidates it. Finish disposing
    // of the old lock before making one request for the current visible session.
    pending.then(function () {
      if (requestEpoch !== epoch && !suspended && document.visibilityState === "visible") acquire();
    });
    return pending;
  }

  function suspend() {
    if (!suspended) epoch++;
    suspended = true;
    var oldLock = sentinel;
    sentinel = null;
    show("화면 켜짐 유지 대기 · 앱으로 돌아오면 재요청합니다", false);
    release(oldLock);
  }

  function resume() {
    if (document.visibilityState !== "visible") return;
    if (!suspended) return;
    suspended = false;
    acquire();
  }

  retry.addEventListener("click", acquire);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") resume();
    else suspend();
  });
  window.addEventListener("pagehide", suspend);
  window.addEventListener("pageshow", resume);
  acquire();
})();
