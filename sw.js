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
const CACHE_VERSION = 'bookify-shell-v1';

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
];

// PageFlip 라이브러리도 같이 미리 받아둔다 — CDN(교차 출처)이지만 없으면
// 뷰어 자체가 안 뜬다.
const PRECACHE_CROSS_ORIGIN_URLS = [
  'https://cdn.jsdelivr.net/npm/page-flip/dist/js/page-flip.browser.js',
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
      // 같은 출처는 no-cors 걱정 없이 그대로, CDN은 opaque 응답이라도 캐싱은 된다
      // (내용 검사는 못 하지만 오프라인에서 그대로 돌려줄 수는 있다).
      await Promise.all(
        PRECACHE_CROSS_ORIGIN_URLS.map((url) =>
          cache.add(new Request(url, { mode: 'no-cors' })).catch(() => {
            // CDN이 그 순간 안 잡히면 그냥 넘어간다 — 다음 fetch 때 runtime 캐싱으로 보충됨
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

// 폰트(Gowun Dodum/Noto Sans KR/Noto Serif KR) 요청 — 버전 해시가 붙어있어
// 미리 정확한 URL을 알 수 없으니, 쓰일 때마다 캐싱해두는 방식(runtime cache)으로 처리.
function isFontHost(url) {
  return url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // 쓰기 요청(Firestore/Storage 등)은 손대지 않는다

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isPageFlipCdn = url.href.startsWith('https://cdn.jsdelivr.net/npm/page-flip/');

  // Firebase(Firestore/Storage/Auth)나 그 외 API 요청은 그대로 네트워크로 흘려보낸다 —
  // 여긴 우리가 캐싱을 대신 결정할 자리가 아니라, book/library 쪽 자체 오프라인
  // 캐시(js/offline-cache.js, localStorage)가 각자 알아서 처리한다.
  if (!isSameOrigin && !isPageFlipCdn && !isFontHost(url)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req, { ignoreSearch: isSameOrigin && req.mode === 'navigate' });
      if (cached) {
        // 오프라인에서도 즉시 뜨도록 캐시를 먼저 주고, 온라인이면 백그라운드로
        // 최신본을 받아 다음 방문을 위해 캐시를 갱신한다(stale-while-revalidate).
        event.waitUntil(
          fetch(req).then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
          }).catch(() => {})
        );
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
