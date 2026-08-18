# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Bookify — a Korean-language single-page web app that lets a signed-in user upload `.txt` files and read them as a page-flipping book (the `page-flip` library), with Firebase-backed folder/library management, per-user reading progress/bookmarks, and offline support. No build step: plain ES modules served as static files.

## Commands

There is no `package.json` and no build/lint/test tooling — this is plain HTML/CSS/JS served as-is.

- **Local dev server**: use the `"static-server"` launch config (`.claude/launch.json`, not committed to git — see `.gitignore`) via the `preview_start` tool, which runs `.claude/serve.ps1` (a small PowerShell static file server) on port 8934. To run it outside that tool: `powershell -NoProfile -ExecutionPolicy Bypass -File .claude/serve.ps1`.
- **Dev-mode login** (see also "Dev-mode testing" below): on `localhost`/`127.0.0.1`, enter `dev` as the email on the login screen (any/no password) to bypass Firebase Auth entirely and test without touching production data.
- Deployment is a plain static-file host (no server-side code anywhere in this repo).

## Architecture

### Module graph (`js/`)

Seven domain modules wired together as ES module imports/exports (no bundler), loaded by `index.html` via a single `<script type="module" src="js/main.js">`:

- `session.js` — `currentUser` state (only this module reassigns it directly; everywhere else calls `setCurrentUser()`), dev-mode/admin permission checks (`isDevUser`, `isAdminUser`). Base of the dependency graph; imports nothing else from this project.
- `firebase-init.js` — the one place Firebase `app`/`db`/`storage`/`auth` get initialized. Everything else imports `db`/`storage`/`auth` from here rather than re-initializing.
- `ui-shared.js` — screen transitions (`showLibraryScreen`/`showViewerScreen` — *not* `showAuthScreen`, which lives in `auth.js` because it depends on auth-only state), Wake Lock, the bottom status toast (`setStatus`), and generic sheet open/close (`openSheet`/`closeSheet` + `[data-close-panel]` wiring).
- `offline-cache.js` — IndexedDB cache of book text (see "Offline support" below).
- `reader.js` — the viewer screen: pagination/PageFlip, search, bookmarks, reader settings, progress sync, immersive mode, brightness swipe.
- `library.js` — the "내 서재" (library) screen: folders, file list, drag-and-drop, upload, recent files.
- `auth.js` — login/signup, dev login, the `onAuthStateChanged` gate, logout. Imports from every other domain module, so it's effectively the app's real entry sequence.
- `main.js` — the actual module entry point; imports the above for their side effects (each module wires its own event listeners at load time) and registers the service worker.

**`library.js` and `reader.js` import from each other** — a deliberate circular dependency. `library.js` needs `reader.js`'s `loadFileFromStorage`/`loadDevTestFile` to open a book from a list row; `reader.js` needs `library.js`'s `markActiveFileRow` to highlight the open file in the list. This is safe under the ES module spec here because every cross-call happens inside an event handler or async function, never at module top-level.

Cross-module mutable state follows one recurring pattern: the owning module exports `let someState` (readable elsewhere via import) plus a `setSomeState()` function (the *only* way other modules may write it, since ES modules can't reassign an imported binding). See `session.js`'s `currentUser`/`setCurrentUser` or `reader.js`'s `currentFileName`/`setCurrentFileName`.

### Firebase data model

- **Auth**: email/password, `browserLocalPersistence` (stays logged in across reloads, including offline).
- **Storage**: every uploaded `.txt` file lives flat under `books/` — shared across *all* accounts, not yet per-user (see admin-gating below).
- **Firestore**:
  - `library/shared` — one document for the whole app's folder structure (`folders`, a `fileFolder` name→folderId map, drag-reorder `itemOrder`). Shared for the same reason as `books/`.
  - `users/{uid}/reading_progress/{fileId}` and `users/{uid}/bookmarks/{fileId}` — per-user, per-file. `fileId` is `fileDocId(fileName)` (`btoa(encodeURIComponent(fileName))`), so renaming a file means migrating these docs (`library.js`'s `migrateFileDocs`).
  - `users/{uid}/settings/readerPrefs` — `{mobile: {...}, pc: {...}}`, keyed by device category (viewport < 900px = mobile), not by file.
  - Security rules aren't in this repo (managed in the Firebase console) — `library.js` and `session.js` have comments with the exact rule text expected there.

**Admin gating**: because `books/` and `library/shared` are shared across every account, only `kinopioo@naver.com` (`session.js`'s `isAdminUser`) can create/rename/move/delete folders and files — a temporary measure until per-user file scoping exists. This only hides UI; it is not real security without matching Firestore/Storage rules.

### Dev-mode testing

On `localhost`/`127.0.0.1` only, logging in with email `dev` skips Firebase Auth entirely (`auth.js`'s `loginAsDevUser`) and uses a fixed local user (`DEV_USER_UID`). The library shows exactly one file, the static `dev-test-book.txt`, and progress/bookmarks/reader-prefs/library-state all go to `localStorage` instead of Firestore/Storage. Prefer this path for all browser-based verification — it never touches production Firebase data. It does *not* exercise the offline book-text cache (see below) or real Firebase Auth persistence, since it bypasses both by design.

### Reading pipeline (`reader.js`)

The largest module; page rendering is its most complex piece:

1. Book text is split into pages by **DOM height measurement + galloping search** — measures real rendered height in a hidden `.page` element rather than estimating, using a galloping/binary-search hybrid so it stays fast on large documents. `findForwardPageEnd`/`findBackwardPageStart` are the two directions (mirror images of each other); `createMeasurementDom` builds the shared hidden-DOM harness.
2. **Cold-cache splits are bidirectional and progressive, not "0 to end."** On a cache miss, `buildInitialWindowSplit` first splits only the visible window (≤ `PAGE_WINDOW_RADIUS*2+1` pages) around the resume position (`currentLastCharIndex`, the "이어보기" char offset — 0 for a new book) — backward from that origin *and* forward from it — so the first page renders in time bounded by window size, never by book size. `continuePaginationInBackground` then keeps splitting outward in both directions without blocking the UI, `prepend`ing/`append`ing into the live `pageStartIndices`/`allTextPages` arrays as it goes (a prepend shifts every already-tracked index — `windowStartIndex`/`windowEndIndex`/`currentDisplayedGlobalPage` — by one to compensate). `pendingBackwardDone`/`pendingForwardDone` (see `isPaginationPending()`) track whether each direction has reached the true start/end of the book yet. While pending: the page slider is disabled and shows "계산 중..." (no approximate number), search is disabled (`updateSearchAvailability`), and flipping into not-yet-known territory shows a "아직 준비 중" status instead of erroring (`goToNextPage`/`jumpToPrevPage`'s edge guards). Only a *fully complete* split (both directions done) gets persisted to cache — a partial result is never cached, since it would look like a smaller book on the next open.
   - ⚠️ Bidirectional splitting is **not byte-identical** to a hypothetical pure forward-from-0 split of the same book — word-wrap is sensitive to exactly where a page starts, so boundaries near the resume point can drift by up to a few dozen characters compared to what a left-to-right pass would have chosen. Both are equally *valid* pagination (verified: monotonic, gapless, every page fits `maxHeight`) — this is expected, not a bug, and isn't user-visible beyond that.
3. Only a **window** of pages around the current position (`PAGE_WINDOW_RADIUS = 15`) is ever mounted into PageFlip (`computeWindowRange`/`maybeShiftPageWindow`) — the rest of the book stays as plain strings in memory. This is necessary because PageFlip pairs *local* page indices into left/right spreads; the window's start index must stay even or spreads drift by one page (see the long comment above `computeWindowRange`).
4. Pagination results are cached twice: in-memory (`paginationCache`, keyed by file + dimensions + font) and in `localStorage` (`persistedPaginationKey`), storing only `pageStartIndices` — not the page text — since the source text can re-slice itself from those offsets. Dimensions are **bucketed** (floored to a 20px/40px grid, half of `WIDTH_JITTER_THRESHOLD`/`HEIGHT_JITTER_THRESHOLD`) before being used for *anything* (measurement, PageFlip's actual render size, and the cache key) — otherwise trivial viewport differences between opens (address-bar collapse, PWA status-bar state, etc.) miss the cache and force a full re-split every time, even for the same file on the same device.
5. Bookmarks/progress are stored by **character index**, not page number — page numbers shift whenever font/size/paragraph-width/screen size changes, character offsets don't.
6. `buildGeneration`/`fileLoadGeneration` counters guard against races when the user resizes or switches books faster than a previous async pagination/download finishes — the background progressive-completion loop checks `buildGeneration` at every yield point too, so a resize/book-switch cleanly abandons a stale in-flight split instead of corrupting the live arrays.

### Offline support (`offline-cache.js` + `sw.js`)

- `sw.js` precaches the static app shell (HTML/CSS/JS/icons/manifest/fonts/PageFlip + Firebase SDK CDN scripts) so the app still boots with no network. **Bump `CACHE_VERSION` whenever the static file list changes**, or clients keep serving stale files indefinitely.
- **⚠️ Every external CDN URL any same-origin file imports or references MUST be in `sw.js`'s precache list — this has caused two real, hard-to-diagnose production bugs already:**
  - `firebase-init.js`/`reader.js`/`library.js`/`auth.js` import Firebase SDK modules straight from `www.gstatic.com/firebasejs/...` as ES modules. That domain was missing from the precache list entirely, so on a real device (online-install, then fully offline relaunch) the import hung forever with zero thrown error — `firebase-init.js` sits near the front of the module graph, so *nothing* downstream of it, including code meant to run as a fallback, ever got a chance to execute. Symptom looked like "the whole app is frozen," not "one file failed." Confirmed and fixed 2026-08-16.
  - `index.html` used to `<link>` Google Fonts' CDN CSS directly. Google Fonts splits each family into 100s of tiny unicode-range-subset files and only serves (and lets you cache) the ones actually rendered — so a user who never manually switched fonts while online had *zero* font files cached, and switching fonts offline silently no-opped (fell back to a system font, no error). Fixed by self-hosting: the real webfont files were fetched via `curl` with a legacy `MSIE 6.0` user-agent (Google Fonts serves one full unsubsetted file per family that way instead of the normal 100+ modern-browser subsets), then converted TTF→WOFF2 with `fonttools` (`pip install fonttools brotli`; `TTFont(...).flavor = 'woff2'; .save(...)`) for full-Hangul-coverage single files under `fonts/`, referenced from `styles.css`'s own `@font-face` rules, and added to `PRECACHE_URLS` like any other static asset. No more Google Fonts dependency at all.
  - **The pattern to watch for**: any `<script src>`, `<link>`, or ES module `import` pointing at a domain other than the app's own origin is a same-origin-only-thinking blind spot — check `sw.js`'s `PRECACHE_URLS`/`PRECACHE_NO_CORS_URLS`/`PRECACHE_CORS_URLS` and the runtime `fetch` handler's origin allowlist whenever a new one is added anywhere in the codebase.
- `offline-cache.js` is a separate IndexedDB cache of book *text*, keyed by filename, LRU-capped by total size (`OFFLINE_CACHE_BYTES_LIMIT`, 500MB) rather than a book count — text files are small enough that a fixed count was needlessly restrictive. `reader.js`'s `loadFileFromStorage` reads from this cache first (online or offline) unless a background freshness check (`refreshStaleFlags`, run once whenever "내 서재" loads, comparing Storage `getMetadata()`) flagged the cached copy stale — a stale flag only takes effect on the *next* open, never mid-read.
- Reading progress, bookmarks, and the library folder structure each have their own `localStorage` write-through cache (Firestore/Storage stay authoritative when online; the local copy is purely the offline fallback) — this generalizes the pattern dev-mode already used, rather than enabling Firestore's own offline persistence.
- Every library write action (folder/file create/rename/move/delete, upload, drag reorder) checks `navigator.onLine` and refuses with a toast when offline, rather than queuing writes for later.
- Renaming or deleting a file also updates or clears its entry in the offline caches, so a stale cache entry never survives under a reused filename.
- `sw.js`'s runtime `fetch` handler intentionally does *not* combine `event.waitUntil()` background-revalidation with `respondWith()` on a cache hit — that combination has reports of instability on iOS Safari/WebKit, and static content only refreshes at install time (`CACHE_VERSION` bump) instead. `auth.js` also has a 4s timeout that force-shows the login screen if `onAuthStateChanged` never fires, as a last-resort safety net against any future silent-hang scenario like the Firebase SDK one above (index.html's screens are all `screen-hidden` by default, so any such hang otherwise looks like a permanently blank app with no error).
- iOS note: only Safari's "Add to Home Screen" produces a real standalone PWA with reliable service worker support there — Chrome/Firefox/etc. on iOS are WebKit wrappers whose "Add to Home Screen" is closer to a bookmark shortcut and won't reliably work offline. This is an Apple platform restriction, not something fixable from this codebase.

### PWA

`manifest.json` + `icons/` support "Add to Home Screen" on iOS/Android; `sw.js` is what makes the installed app work offline.

## 진행 상황 메모 (2026-08-18 기준 — 다른 컴퓨터에서 이어서 작업할 때 참고)

- ✅ **완료·커밋됨**: 로그인 직후 마지막으로 읽던 책을 자동으로 여는 로직 — 페이지 나누기가 지금 화면 크기 기준으로 캐시에 없어서 실제로 새로 돌아야 하는 상황이면, 로딩 중인 뷰어에 계속 머무는 대신 즉시 내 서재로 돌아간다 (`reader.js`의 `bailToLibraryIfPaginationNeeded`/`setBailToLibraryIfPaginationNeeded`, `auth.js`의 두 자동 로그인 경로에서 세팅). 커밋 `e393457`. 캐시 히트(빠른 경우)는 그대로 뷰어에 머무는 것까지 브라우저로 검증 완료.
- ❌ **논의 후 취소됨**: 폰 전용 세로모드 고정(가로모드 감지 시 전체화면 오버레이로 가리기, 태블릿은 제외). 설계·구현·브라우저 검증까지 마쳤으나 사용자가 최종적으로 "없던 걸로 하자"며 취소 — 관련 코드(`index.html`/`styles.css`/`js/ui-shared.js`/`sw.js`)는 전부 `git checkout`으로 원상복구했고 커밋되지 않았다. **다시 요청받기 전엔 재작업하지 않는다.**
- ✅ **완료·커밋됨**: 설정 패널(`index.html`의 `#settings-panel`)에 "스토리지 현황" 섹션 추가 — 새 모듈 `js/storage-stats.js`. 커밋 `e6acd93`.
  - **카테고리 5개**: 오프라인 저장된 책(IndexedDB, 책별 삭제+전체삭제) / 읽기 진행상황·책갈피 캐시(localStorage, 책별 삭제+전체초기화) / 페이지 나누기 캐시(localStorage, 책별 삭제+전체초기화) / 서재 구조·환경설정(전체초기화만) / 앱 실행 파일(Cache Storage, 읽기 전용) — 설계는 위 문단들과 동일하게 그대로 구현.
  - `offline-cache.js`에 `getAllCachedBooksInfo()`/`clearAllCachedBooks()` 추가. `library.js`의 `openItemActionSheet`를 `export`로 열어서 카테고리별 "관리" 시트(전체삭제 + 책별삭제 나열)에 그대로 재사용 — 새 시트 UI를 안 만들어도 됐다.
  - `reader.js`/`library.js`를 또 import해서 순환을 늘리는 대신, `storage-stats.js`가 캐시 키 형식(접두사)을 자체적으로 알고 있다 — **키 형식이 바뀌면 두 곳을 같이 고쳐야 한다.**
  - ⚠️ 브라우저 검증 중 실제로 잡은 버그: 페이지 나누기 캐시 키의 `fontKey`(`readerPrefs.fontId + ':' + fontSizeStep + ':' + paragraphWidthStep`, 예: `system:2:1`)가 그 자체로 `:`를 포함해서, 파일명을 뒤에서부터 떼어내는 정규식의 마지막 그룹을 `[^:]+`로 짰더니 폰트키에서 걸려 파일명이 잘못 파싱됐다. `(.+)$`(끝까지 전부)로 고쳐서 해결 — 폭/높이가 숫자라는 사실로 앞의 `::` 두 개 위치만 고정하면 나머지는 자연히 갈린다.
  - `main.js`에 `import './storage-stats.js'` 추가, `sw.js`의 `PRECACHE_URLS`에 새 파일 추가하고 `CACHE_VERSION`을 `v7`→`v8`로 올림.
  - 개발자(dev) 세션으로 브라우저에서 5개 카테고리 전부(관리 시트 열기, 책별 삭제, 카테고리 전체삭제/초기화) 실제 클릭까지 검증 완료. 카테고리 1(오프라인 저장된 책)은 dev 모드가 IndexedDB 캐시를 안 거치는 구조라 항상 0B로만 확인됨 — 실제 로그인 계정으로 한 번 더 확인할 가치가 있음(다음에 이어서 볼 사람 참고).
- ✅ **완료·커밋됨**: 큰 파일 페이지 나누기 성능 개선 3건 — 사용자가 "빈번하게 다시 나뉜다"고 신고한 문제.
  1. **캐시 키 버킷화**(`buildFlipBook`) — 폭/높이를 20px/40px 단위로 내림해서, 뷰포트가 열 때마다 미묘하게 달라지는 환경(PWA 상태표시줄 등)에서도 캐시가 계속 히트하게 함.
  2. **양방향(bidirectional) 점진적 페이지 나누기** — 캐시가 없을 때 책 전체(0부터 끝까지)를 다 나눠야 첫 페이지가 보이던 구조를, 이어보기 위치(원점)에서 앞/뒤로 창 분량만 먼저 나누고(`buildInitialWindowSplit`) 나머지는 화면을 안 막고 배경에서(`continuePaginationInBackground`) 채우는 방식으로 바꿈. `findBackwardPageStart`가 기존 `findForwardPageEnd`(리팩터링으로 분리)를 좌우로 뒤집은 대칭 알고리즘. 배경 완료 전엔 슬라이더 "계산 중..." 비활성화(대략치 표시 안 함), 아직 안 나뉜 쪽으로 넘기면 "준비 중" 안내, 검색 비활성화 — 전부 사용자가 직접 정한 사양.
  3. (3번 후보였던 갤로핑 시드 개선/이어보기 prewarm은 1·2만으로 충분해 보여 보류 — 필요해지면 나중에.)
  - ⚠️ 검증 중 발견: 이 저장소(`OneDrive\바탕 화면\txt-viewer`)를 `.claude/launch.json`의 static-server로 띄운 로컬 프리뷰에서, `http://localhost:8000`과 `http://127.0.0.1:8000` 둘 다 특정 정적 파일 URL(예: `js/reader.js`, `dev-test-book.txt`)을 **서버·서비스워커 재시작과도 무관하게** 계속 예전 내용으로 캐싱하는 프록시 계층이 있는 것으로 보임(서버 자체는 `curl`로 확인하면 항상 최신). `http://[::1]:8000`처럼 아직 안 써본 호스트명으로 새 탭을 열면 그 세션 한정으로는 새 캐시라 최신 내용이 나오지만, `session.js`의 `isLocalDevHost`가 `localhost`/`127.0.0.1`만 인식해서 `dev` 로그인 우회가 안 먹힘 — 이 프리뷰 환경에서 코드를 고친 직후 즉시 재검증해야 할 때는 이 캐싱을 염두에 둘 것(다음에 참고할 사람을 위해 남겨둠).
  - 알고리즘 정확성은 실제 앱 대신 페이지 안에서 직접 재구현해 원본(정방향 전용) 결과와 대조하는 방식으로 검증 — 두 방식 모두 완전하고(gap 없음) 단조증가하지만, 원점 근처 경계가 최대 26자 정도 다를 수 있음을 확인(워드랩 민감성 때문, 버그 아님 — CLAUDE.md의 "Reading pipeline" 절 참고).
  - `sw.js`의 `CACHE_VERSION`을 계속 올려가며 진행(최신 `v19`).
- 🔄 **진행중 (미해결, 2026-08-18 기준)**: iOS 홈화면 PWA 풀스크린 — 실기기(iOS 18) 왕복으로 여러 라운드 시도했으나 상/하 여백 문제가 아직 안 잡혔다. 최신 `CACHE_VERSION`은 `v30`. **다음은 맥 + Safari 원격 디버깅(Web Inspector)으로 이어서 진행하기로 함** — 아래 "다음 세션에서 할 일" 참고.
  - **확실히 해결된 부분**: `viewport-fit=cover`가 뷰포트 메타에 없었던 것(상태바 자리가 완전히 빈 여백으로 분리돼 보이던 최초 증상)은 추가로 고쳐짐.
  - **아직도 안 잡힌 부분**: `apple-mobile-web-app-status-bar-style: black-translucent`를 쓰면 콘텐츠 전체가 상태바 높이만큼 위로 밀리는 문제(상단은 상태바와 겹치고 하단엔 그만큼 빈 공간).
    - 1차 시도: 메타태그를 통째로 뺌 → 상단 밀림은 없어졌지만 상태바가 다시 예전처럼 분리된 불투명 바로 돌아가 버림(원래 불만으로 회귀) + 하단 여백은 그대로. **틀린 처방으로 확인, 되돌림.**
    - 2차 시도: 메타태그를 되살리고, 웹 검색으로 찾은 문서화된 WebKit 대응법대로 `body { min-height: calc(100% + env(safe-area-inset-top)); }` 추가 → 실기기에서 여전히 증상 동일("여전히 똑같아"), 오히려 하단 공백이 더 커진 것처럼 보임. **이것도 기대한 효과가 없었음.**
    - 두 시도 모두 데스크톱 프리뷰에서는 `env(safe-area-inset-*)`가 0이라 재현 자체가 안 되고, 실기기(사용자의 특정 iPhone·iOS 18)에서만 확인 가능 — 스크린샷 왕복(매번 Safari "방문 기록·웹사이트 데이터 지우기" → 앱 삭제 → 재설치까지 해야 새 배포가 반영됨)으로 여러 라운드를 썼지만 결론이 안 남. 데스크톱에서 만든 진단 HUD(픽셀 숫자를 화면에 직접 찍는 것)도 시도했으나 배포·캐시 갱신 자체가 느려서 한계가 있었음.
  - **몰입모드 텍스트-상태바 겹침 관련해서 이미 반영한 것**(이 부분은 별도 이슈라 계속 유효): `.page`의 상/하 padding을 `max(기존 clamp(), env(safe-area-inset-top/bottom))`으로 변경(`styles.css`). 이 값이 페이지 나누기 실측(maxHeight)에도 영향을 주므로 `reader.js`에 `PAGE_LAYOUT_VERSION` 상수를 새로 만들어 `fontKey`에 접어 넣음 — 캐시된 옛 분할 결과가 새 여백을 반영 안 한 채 재사용되며 마지막 줄이 잘리는 걸 막기 위함. **여백 관련 CSS를 또 건드리면 이 값도 같이 올릴 것.**
  - `index.html`에 `#debug-version-badge`(화면 상단에 `bookify-shell-vNN` 표시, sw.js `CACHE_VERSION`과 수동으로 맞춰야 함)를 배포/캐시 확인용으로 남겨뒀다 — 아직 지우지 말 것.
  - ⚠️ **iOS Safari 홈화면 PWA는 서비스워커 캐시가 지독하게 끈질기다** — 앱을 완전 종료 후 재실행은 물론, **홈 화면 아이콘을 삭제하고 재설치해도 예전 캐시가 안 지워지는 경우**를 실기기에서 직접 확인함. 확실히 지우려면 설정 → Safari → "방문 기록 및 웹 사이트 데이터 지우기"(전체 삭제, 다른 사이트 로그인도 다 풀림)까지 가야 한다.
  - **다음 세션에서 할 일 (맥에서 이어서)**: 사용자가 윈도우 PC 대신 맥으로 전환해서, 아이폰을 맥에 케이블로 연결하고 Safari의 원격 Web Inspector(설정 → Safari → 고급 → "웹 속성 관리자" 켜기 → 맥 Safari 개발자용 메뉴 → 기기 선택 → 홈 화면 앱 탭 선택)로 **배포/캐시 사이클 없이 실시간으로** 디버깅할 예정. 연결되면 아래 스크립트를 Web Inspector Console에 붙여넣고 실행한 결과를 확인할 것 — `window.innerHeight`/`visualViewport`/`document.documentElement`/`body`의 실제 렌더링 크기와 `env(safe-area-inset-top/bottom)` 실측값, `#book-stage` 위치를 한 번에 보여준다:
    ```js
    (function () {
      function readEnv(name) {
        var p = document.createElement('div');
        p.style.cssText = 'position:fixed;top:-9999px;padding-top:env(' + name + ',0px)';
        document.body.appendChild(p);
        var v = parseFloat(getComputedStyle(p).paddingTop) || 0;
        p.remove();
        return v;
      }
      var stage = document.getElementById('book-stage');
      console.table({
        innerHeight: window.innerHeight,
        visualViewportHeight: window.visualViewport && window.visualViewport.height,
        visualViewportOffsetTop: window.visualViewport && window.visualViewport.offsetTop,
        docClientHeight: document.documentElement.clientHeight,
        docRectTop: document.documentElement.getBoundingClientRect().top,
        bodyRectTop: document.body.getBoundingClientRect().top,
        bodyRectBottom: document.body.getBoundingClientRect().bottom,
        bodyComputedMinHeight: getComputedStyle(document.body).minHeight,
        safeAreaInsetTop: readEnv('safe-area-inset-top'),
        safeAreaInsetBottom: readEnv('safe-area-inset-bottom'),
        stageRectTop: stage && stage.getBoundingClientRect().top,
        stageRectBottom: stage && stage.getBoundingClientRect().bottom,
        immersive: document.body.classList.contains('immersive')
      });
    })();
    ```
    실행 결과(콘솔에 표로 뜸)를 스크린샷으로 받으면, 실제로 문서/뷰포트가 밀렸는지, `safe-area-inset-top`이 기대한 값(노치 있는 기기면 47~59px 정도)을 제대로 보고하는지 바로 알 수 있다 — 지금까지처럼 스크린샷 색깔만 보고 추측할 필요가 없어진다. Elements 패널에서 `body`/`#book-stage`의 CSS를 직접 수정해가며 실시간으로 맞는 값을 찾은 뒤에만 코드에 반영할 것 (배포 왕복을 줄이기 위함).
