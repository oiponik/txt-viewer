// main.js — 앱 진입점. index.html이 이 파일 하나만 module로 불러온다.
// 각 도메인 모듈은 로드되자마자 자기 화면의 이벤트 리스너를 스스로 등록하므로,
// 여기서 하는 일은 그 모듈들이 전부 실행되게(side effect) import하는 것뿐이다.
// (auth.js가 reader.js/library.js를 이미 가져다 쓰므로 사실 auth.js 하나만 import해도
// 전체 그래프가 로드되지만, 어떤 도메인들이 이 앱을 구성하는지 한눈에 보이도록 전부 명시한다)
import './session.js';
import './firebase-init.js';
import './ui-shared.js';
import './offline-cache.js';
import './reader.js';
import './library.js';
import './auth.js';
import './storage-stats.js';
import './shortcuts-help.js';

// 앱 셸(정적 파일) 오프라인 캐싱 — sw.js 참고. 서비스워커는 보안 컨텍스트(https 또는
// localhost)에서만 등록 가능하므로 없는 척 조용히 넘어간다(구형 브라우저 등).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.error('서비스워커 등록 실패 (오프라인 앱 셸 캐싱 없이 동작):', err);
    });
  });
}

// 뷰어 화면 상단(제목 옆)의 캐시 버전 배지 채우기 — 실사용 중에도
// "지금 이 기기가 실제로 어떤 sw.js 캐시를 받았는지"를 사용자가 스크린샷 한 장으로
// 바로 알려줄 수 있게 한다(배포는 했는데 옛날 버전이 계속 뜨는 캐싱 문제 진단용).
// sw.js의 CACHE_VERSION 상수를 여기 따로 복붙해두지 않는다 — Cache Storage API는
// 페이지 쪽에서도 캐시 이름을 그대로 읽을 수 있고(js/storage-stats.js가 이미 쓰는
// 방법과 동일), 이 앱은 캐시 네임스페이스를 하나만 쓰므로(sw.js 참고) caches.keys()의
// 첫 항목이 곧 CACHE_VERSION이다 — 값이 두 곳에 따로 있으면 하나만 고치고 잊어버릴
// 위험이 생기므로 항상 원본(sw.js)에서 읽어오게 한 것.
async function showAppVersionBadge() {
  const badge = document.getElementById('app-version-badge');
  if (!badge || !('caches' in window)) return;
  try {
    const names = await caches.keys();
    if (names.length === 0) return; // 첫 방문 등 아직 설치 전 — 표시할 값 없음, 조용히 넘어감
    badge.textContent = names[0].replace(/^bookify-shell-/, '');
  } catch (err) {
    // 배지는 순전히 진단용이라 실패해도 조용히 무시(읽기 자체엔 영향 없음)
  }
}
showAppVersionBadge();
