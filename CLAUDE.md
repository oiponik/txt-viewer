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

1. Book text is split into pages by **DOM height measurement + galloping search** (`splitTextIntoPagesDOM`) — measures real rendered height in a hidden `.page` element rather than estimating, using a galloping/binary-search hybrid so it stays fast on large documents, yielding to the main thread periodically.
2. Only a **window** of pages around the current position (`PAGE_WINDOW_RADIUS = 15`) is ever mounted into PageFlip (`computeWindowRange`/`maybeShiftPageWindow`) — the rest of the book stays as plain strings in memory. This is necessary because PageFlip pairs *local* page indices into left/right spreads; the window's start index must stay even or spreads drift by one page (see the long comment above `computeWindowRange`).
3. Pagination results are cached twice: in-memory (`paginationCache`, keyed by file + dimensions + font) and in `localStorage` (`persistedPaginationKey`), storing only `pageStartIndices` — not the page text — since the source text can re-slice itself from those offsets.
4. Bookmarks/progress are stored by **character index**, not page number — page numbers shift whenever font/size/paragraph-width/screen size changes, character offsets don't.
5. `buildGeneration`/`fileLoadGeneration` counters guard against races when the user resizes or switches books faster than a previous async pagination/download finishes.

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

## 진행 상황 메모 (2026-08-17 기준 — 다른 컴퓨터에서 이어서 작업할 때 참고)

- ✅ **완료·커밋됨**: 로그인 직후 마지막으로 읽던 책을 자동으로 여는 로직 — 페이지 나누기가 지금 화면 크기 기준으로 캐시에 없어서 실제로 새로 돌아야 하는 상황이면, 로딩 중인 뷰어에 계속 머무는 대신 즉시 내 서재로 돌아간다 (`reader.js`의 `bailToLibraryIfPaginationNeeded`/`setBailToLibraryIfPaginationNeeded`, `auth.js`의 두 자동 로그인 경로에서 세팅). 커밋 `e393457`. 캐시 히트(빠른 경우)는 그대로 뷰어에 머무는 것까지 브라우저로 검증 완료.
- ❌ **논의 후 취소됨**: 폰 전용 세로모드 고정(가로모드 감지 시 전체화면 오버레이로 가리기, 태블릿은 제외). 설계·구현·브라우저 검증까지 마쳤으나 사용자가 최종적으로 "없던 걸로 하자"며 취소 — 관련 코드(`index.html`/`styles.css`/`js/ui-shared.js`/`sw.js`)는 전부 `git checkout`으로 원상복구했고 커밋되지 않았다. **다시 요청받기 전엔 재작업하지 않는다.**
- 🔜 **다음 작업 (설계는 합의됐지만 아직 코드 작성 전)**: 설정 패널(`index.html`의 `#settings-panel`)에 "스토리지 현황" 섹션 추가.
  - **카테고리 5개**:
    1. **오프라인 저장된 책** (IndexedDB `bookify-offline`, `offline-cache.js`) — 용량이 제일 큼(최대 500MB). 책별 개별 삭제 + 전체 삭제.
    2. **읽기 진행상황 · 책갈피 캐시** (`offlineProgress:*`/`offlineBookmarks:*`/`devProgress:*`/`devBookmarks:*`) — **책별 개별 삭제 + 전체 초기화 둘 다 필요** (사용자가 명시적으로 요구 — 처음엔 카테고리 1만 개별삭제로 제안했다가 "다른부분도 책마다의 삭제가 가능해야해"라는 피드백으로 수정됨).
    3. **페이지 나누기 캐시** (`txtViewerPagination:{fileName}::{width}::{height}::{fontKey}`) — 마찬가지로 책별 개별 삭제(그 책의 모든 크기/폰트 조합 한번에) + 전체 초기화.
    4. **서재 구조 · 환경설정** (`offlineLibrarySnapshot:*`, `devLibraryState`, `txtViewerReaderPrefs`, `txtViewerLastOpenedFile_*`, `txtViewerLastEmail`) — 책 단위 개념이 없어서 전체 초기화만.
    5. **앱 실행 파일** (Service Worker Cache Storage, `caches.keys()`) — 읽기 전용, 삭제 버튼 없음(지우면 오프라인 중 앱이 멈출 위험).
  - 용량은 설정 패널이 열릴 때만 계산(상시 계산 아님). IndexedDB/localStorage 문자열 크기는 기존 `offline-cache.js`의 `estimateBytes` 방식(UTF-16 근사, 글자당 2바이트)을 그대로 재사용.
  - 필요한 새 export: `offline-cache.js`에 `getAllCachedBooksInfo()`(책별 {fileName, bytes} 목록)와 `clearAllCachedBooks()`(전체 삭제) — `removeCachedBook(fileName)`은 이미 있어서 개별 삭제에 재사용 가능.
  - "현황"이 "상태"보다 이 맥락에 더 맞는 단어로 이미 정함.
