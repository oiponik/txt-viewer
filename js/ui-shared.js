// ui-shared.js — 여러 화면(로그인/서재/뷰어)이 공통으로 쓰는 것들: 서재/뷰어 화면 전환,
// 화면 항상 켜짐(Wake Lock), 하단 상태 토스트, 시트(바텀시트) 공통 열기/닫기.
// ⚠️ showAuthScreen은 여기 없다 — 로그인 화면 관련(applyRememberedEmail)과 얽혀 있어서
// auth.js에만 있다. auth.js도 releaseWakeLock 등은 여기서 가져다 쓴다.

const libraryScreen = document.getElementById('library-screen');
const viewerScreen = document.getElementById('viewer-screen');
const statusEl = document.getElementById('sync-status');
const statusTextEl = document.getElementById('sync-status-text');
const statusPercentEl = document.getElementById('sync-status-percent');
const statusProgressFillEl = document.getElementById('sync-status-progress-fill');

// 화면 하단 중앙 상태 토스트: 텍스트를 바꾸면 잠깐 나타났다가 2.2초 뒤 조용히 사라진다.
// (UI 패널과는 완전히 분리되어 있어서 몰입 모드로 UI가 숨어 있어도 이건 보인다)
//
// progress: 0~1 사이 진행률(다운로드/페이지 나누기처럼 실제로 알 수 있을 때만) —
// 생략하거나 null/undefined면 지금까지처럼 평범한 텍스트 알약. 진행 중인 작업이
// 짧은 간격으로 계속 setStatus(..., 진행률)을 호출하는 동안은 매 호출이 숨김
// 타이머를 다시 미루므로 계속 떠 있고, 마지막으로 진행률 없이(또는 "완료" 텍스트로)
// 한 번 더 부르면 그때부터 2.2초 뒤 사라진다 — 별도의 "진행 중" 상태 플래그가 필요 없다.
let statusHideTimer = null;
export function setStatus(text, progress) {
  statusTextEl.textContent = text;

  const hasProgress = typeof progress === 'number' && !Number.isNaN(progress);
  statusEl.classList.toggle('has-progress', hasProgress);
  if (hasProgress) {
    const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
    statusProgressFillEl.style.width = pct + '%';
    statusPercentEl.textContent = pct + '%';
  }

  statusEl.classList.add('visible');
  clearTimeout(statusHideTimer);
  statusHideTimer = setTimeout(() => {
    statusEl.classList.remove('visible');
  }, 2200);
}

// 화면 전환: 로그인 ↔ 서재(파일 목록) ↔ 뷰어(책 읽기)
export function showLibraryScreen() {
  document.getElementById('auth-screen').classList.add('screen-hidden');
  viewerScreen.classList.add('screen-hidden');
  libraryScreen.classList.remove('screen-hidden');
  releaseWakeLock();
}
export function showViewerScreen() {
  document.getElementById('auth-screen').classList.add('screen-hidden');
  libraryScreen.classList.add('screen-hidden');
  viewerScreen.classList.remove('screen-hidden');
  resetWakeLockIdleTimer();
}

// 💡 화면 항상 켜짐(Wake Lock) — 스마트폰의 "화면 자동 꺼짐" 설정은 앱에서 못 건드리지만,
// 책을 읽는 동안은 Screen Wake Lock API로 화면이 꺼지지 않게 붙잡아둘 수 있다.
// 다만 "무한정 켜둠"은 읽다가 잠들면 배터리가 계속 소모되므로, 마지막 조작(페이지 넘김/터치)
// 후 WAKE_LOCK_IDLE_MS 동안 조작이 없으면 잠금을 풀어서 그 뒤로는 폰의 원래 화면 꺼짐
// 시간을 그대로 따르게 한다 — 넘길 때마다 타이머가 새로 시작되니 실제로는
// "마지막 조작 후 5분"이 화면 꺼짐 유예 시간이 되는 셈.
const WAKE_LOCK_IDLE_MS = 5 * 60 * 1000; // 5분
let wakeLockSentinel = null;
let wakeLockIdleTimer = null;

export async function acquireWakeLock() {
  if (!('wakeLock' in navigator) || wakeLockSentinel) return;
  try {
    wakeLockSentinel = await navigator.wakeLock.request('screen');
    wakeLockSentinel.addEventListener('release', () => {
      wakeLockSentinel = null;
    });
  } catch (err) {
    // 미지원 브라우저(구형 웹뷰 등)나 절전 모드에서 거부되는 경우 — 화면 항상 켜짐은
    // 그냥 못 쓰는 것뿐이니 조용히 넘어간다.
    wakeLockSentinel = null;
  }
}

export function releaseWakeLock() {
  clearTimeout(wakeLockIdleTimer);
  if (wakeLockSentinel) {
    wakeLockSentinel.release().catch(() => {});
    wakeLockSentinel = null;
  }
}

// 뷰어 화면이 보이는 동안 조작(터치/페이지 넘김)이 있을 때마다 호출 — 잠금을 (다시) 걸고
// 유휴 타이머를 리셋한다.
export function resetWakeLockIdleTimer() {
  if (viewerScreen.classList.contains('screen-hidden')) return;
  acquireWakeLock();
  clearTimeout(wakeLockIdleTimer);
  wakeLockIdleTimer = setTimeout(releaseWakeLock, WAKE_LOCK_IDLE_MS);
}

// 검색/책갈피/뷰어설정/서재 쪽 시트들까지 공통으로 쓰는 열기/닫기.
// ⚠️ 모든 .sheet-panel이 같은 z-index(300)를 쓰기 때문에, 시트 위에 또 다른 시트를
// 띄우는 경우(예: 설정 패널이 열려 있는 상태에서 storage-stats.js가
// item-action-panel을 여는 경우) 그냥 두면 HTML에 먼저 적힌 쪽이 항상 나중에 연
// 시트를 가려버린다(z-index가 같으면 DOM 순서가 그리기 순서를 결정하는데,
// item-action-panel이 settings-panel보다 앞에 있어서 이 문제가 실제로 있었다).
// 열 때마다 body 맨 끝으로 옮겨서, "가장 최근에 연 시트가 항상 맨 위"가 되도록 한다.
export function openSheet(id) {
  const el = document.getElementById(id);
  document.body.appendChild(el); // 이미 마지막 자식이어도 안전(같은 자리로 다시 옮기는 것뿐)
  el.classList.remove('screen-hidden');
}
export function closeSheet(id) {
  document.getElementById(id).classList.add('screen-hidden');
}
document.querySelectorAll('[data-close-panel]').forEach((el) => {
  el.addEventListener('click', (e) => {
    const panel = e.target.closest('.sheet-panel');
    if (panel) closeSheet(panel.id);
  });
});
