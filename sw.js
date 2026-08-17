// sw.js — 앱 셸(정적 파일) 오프라인 캐싱용 서비스워커.
//
// 여기서 다루는 건 딱 "탭을 완전히 닫았다가 오프라인 상태에서 다시 열어도
// index.html/js/css 자체는 받아와진다"는 것뿐이다. 책 내용·진행상황·책갈피·서재
// 구조 캐싱은 이것과 무관하게 js/offline-cache.js + 각 모듈의 localStorage
// 캐싱이 따로 맡는다 — 이 파일은 그 코드들이 실행되기 "이전" 단계, 즉 앱이
// 아예 뜨는지 자체를 책임진다.
//
// ⚠️ 정적 파일 목록을 바꿨으면(js/ 새 파일 추가 등) 아래 CACHE_VERSION을 올려야
// 새 캐시가 만들어지고 옛 캐시가 정리된다 — 안 올리면 사용자는 계속 옛날 파일을
// 오프라인 캐시에서 받게 된다.
const CACHE_VERSION = 'bookify-shell-v11';

// 같은 출처(오리진) 정적 파일 — 설치 시점에 전부 미리 받아둔다.
const PRECACHE_URLS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './firebase-config.js',
  './dev-test-book.txt',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/main.js',
  './js/session.js',
  './js/firebase-init.js',
  './js/ui-shared.js',
  './js/offline-cache.js',
  './js/reader.js',
  './js/library.js',
  './js/auth.js',
  './js/storage-stats.js',
  './fonts/gowun-dodum.woff2',
  './fonts/noto-sans-kr-400.woff2',
  './fonts/noto-sans-kr-700.woff2',
  './fonts/noto-serif-kr-400.woff2',
  './fonts/noto-serif-kr-700.woff2',
];

// PageFlip 라이브러리와 Firebase SDK도 같이 미리 받아둔다 — 전부 CDN(교차 출처)이지만
// 없으면 앱이 아예 안 뜬다.
// ⚠️ 실제로 있었던 버그: Firebase SDK(firebase-app/firestore/storage/auth.js)를 여기
// 빠뜨렸었다 — firebase-init.js가 모듈 그래프 맨 앞쪽에서 이 파일들을 import하는데,
// 캐싱이 안 돼있으니 오프라인일 때 이 fetch가 끝없이 멈춰버리고(에러도 안 남) 그 뒤
// 모든 모듈이 영원히 로딩되지 않아 화면이 통째로 빈 채로 멈추는 원인이었다.
// 일반 <script src>로 불러오는 PageFlip은 CORS 헤더가 없어도 실행되니 no-cors로 충분하다.
const PRECACHE_NO_CORS_URLS = [
  'https://cdn.jsdelivr.net/npm/page-flip/dist/js/page-flip.browser.js',
];
// ⚠️ 반면 Firebase SDK는 js 파일들이 <script type="module">의 import로 불러오는
// 교차 출처 ES 모듈이라, no-cors로 캐싱한 "opaque" 응답을 돌려주면 브라우저의 모듈
// 로더가 CORS 승인 정보가 없다고 보고 거부할 수 있다 — 반드시 진짜 CORS 모드(기본값)로
// 받아서 캐싱해야 한다. gstatic.com은 정식으로 CORS를 지원하는 CDN이라 문제없다.
const PRECACHE_CORS_URLS = [
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js',
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // ⚠️ cache.addAll()은 "전부 성공 아니면 전부 실패"라서, 17개 파일 중 하나라도
      // (일시적 네트워크 문제 등으로) 실패하면 설치 전체가 실패해서 단 하나도
      // 캐싱되지 않는다 — 그러면 서비스워커가 영영 활성화되지 못해 오프라인 지원 자체가
      // 통째로 죽는다. 그래서 하나씩 개별 실패를 허용하며 캐싱한다: 안 되는 파일이
      // 있어도 나머지는 정상적으로 캐싱되고, 다음 설치 시도(새로고침 등) 때 다시
      // 채워질 기회가 있다.
      await Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => {
            console.error('[sw] 사전 캐싱 실패:', url, err);
          })
        )
      );
      await Promise.all(
        PRECACHE_NO_CORS_URLS.map((url) =>
          cache.add(new Request(url, { mode: 'no-cors' })).catch(() => {
            // CDN이 그 순간 안 잡히면 그냥 넘어간다 — 다음 fetch 때 runtime 캐싱으로 보충됨
          })
        )
      );
      await Promise.all(
        PRECACHE_CORS_URLS.map((url) =>
          cache.add(url).catch((err) => {
            console.error('[sw] Firebase SDK 사전 캐싱 실패:', url, err);
          })
        )
      );
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

// ⚠️ 폰트(Gowun Dodum/Noto Sans KR/Noto Serif KR)는 예전에 구글 폰트 CDN에서 "쓰일 때마다
// 캐싱"하는 방식이었는데, 실제로 그 글꼴로 렌더링된 적 없으면 캐싱도 안 돼서 오프라인에서
// 글꼴 변경이 조용히 실패하는 문제가 있었다 — fonts/*.woff2로 자체 호스팅해서
// PRECACHE_URLS(같은 출처)에 넣는 것으로 해결했다. 더 이상 여기서 다룰 필요 없다.

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // 쓰기 요청(Firestore/Storage 등)은 손대지 않는다

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isPageFlipCdn = url.href.startsWith('https://cdn.jsdelivr.net/npm/page-flip/');
  // Firebase SDK 본체(js/firebase-init.js 등이 import하는 실제 코드 파일들) — PRECACHE_CORS_URLS
  // 참고. www.gstatic.com이고, 실제 데이터 API(firestore.googleapis.com 등)와는 다른 도메인이다.
  const isFirebaseSdkCdn = url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/');

  // Firestore/Storage/Auth의 실제 데이터 API 요청(firestore.googleapis.com 등)은 그대로
  // 네트워크로 흘려보낸다 — 여긴 우리가 캐싱을 대신 결정할 자리가 아니라, book/library
  // 쪽 자체 오프라인 캐시(js/offline-cache.js, localStorage)가 각자 알아서 처리한다.
  if (!isSameOrigin && !isPageFlipCdn && !isFirebaseSdkCdn) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req, { ignoreSearch: isSameOrigin && req.mode === 'navigate' });
      // ⚠️ 예전엔 캐시를 즉시 돌려주면서 동시에 event.waitUntil()로 백그라운드 갱신
      // (stale-while-revalidate)까지 같이 했는데, respondWith() 안에서 waitUntil()을
      // 또 거는 조합이 iOS Safari(WebKit)에서 불안정하게 동작한다는 보고가 있어 —
      // "온라인에서 한 번 설치 후 완전 종료했다가 오프라인으로 재실행하면 빈 화면에서
      // 멈춘다"는 증상과 정확히 맞아떨어진다. 그래서 캐시가 있으면 그냥 그대로 즉시
      // 돌려주기만 한다(정적 파일 갱신은 install 단계 — CACHE_VERSION을 올릴 때 —
      // 에서만 일어난다). 덜 "똑똑"하지만 훨씬 덜 위험하다.
      if (cached) {
        return cached;
      }
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) {
          cache.put(req, res.clone());
        }
        return res;
      } catch (err) {
        // 캐시에도 없고 네트워크도 없으면(오프라인 + 처음 방문하는 자원) 진짜 실패 —
        // 내비게이션 요청이면 최소한 index.html이라도 돌려줘서 흰 화면 대신 앱이 뜨게 한다.
        if (req.mode === 'navigate') {
          const fallback = await cache.match('./index.html');
          if (fallback) return fallback;
        }
        throw err;
      }
    })()
  );
});
