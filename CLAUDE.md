# CLAUDE.md

이 파일은 이 저장소에서 작업하는 Claude Code(claude.ai/code)에게 가이드를 제공한다.

## 이 앱이 뭔지

Bookify — 로그인한 사용자가 `.txt` 파일을 업로드해서 페이지 넘기는 책(`page-flip` 라이브러리) 형태로 읽을 수 있는 한국어 싱글페이지 웹앱. Firebase 기반 폴더/서재 관리, 사용자별 읽기 진행상황·책갈피, 오프라인 지원까지 갖췄다. 빌드 과정 없음 — 순수 ES 모듈을 정적 파일로 그대로 서빙한다.

## 명령어

`package.json`도 빌드/린트/테스트 도구도 없다 — 순수 HTML/CSS/JS를 그대로 서빙하는 구조.

- **로컬 개발 서버**: `preview_start` 도구로 `.claude/launch.json`의 `"static-server"` 설정(`.claude/serve.ps1`, 작은 파워셸 정적 파일 서버, 8934 포트 — git에는 커밋 안 됨, `.gitignore` 참고)을 사용한다. 이 도구 없이 직접 실행하려면: `powershell -NoProfile -ExecutionPolicy Bypass -File .claude/serve.ps1`
- **개발자 모드 로그인** (아래 "개발자 모드 테스트" 참고): `localhost`/`127.0.0.1`에서 로그인 화면 이메일란에 `dev`를 입력하면(비밀번호는 아무거나/공란) Firebase Auth를 완전히 우회해서 프로덕션 데이터를 건드리지 않고 테스트할 수 있다.
- 배포는 그냥 정적 파일 호스팅이다(이 저장소 어디에도 서버 코드는 없음).

## 아키텍처

### 모듈 구조 (`js/`)

번들러 없이 ES 모듈 import/export로 연결된 8개 도메인 모듈, `index.html`이 `<script type="module" src="js/main.js">` 하나만으로 불러온다:

- `session.js` — `currentUser` 상태(이 모듈만 직접 재할당하고, 다른 곳은 전부 `setCurrentUser()`를 호출), 개발자모드/관리자 권한 체크(`isDevUser`, `isAdminUser`). 의존성 그래프의 최하단 — 이 프로젝트의 다른 어떤 것도 import하지 않는다.
- `firebase-init.js` — Firebase `app`/`db`/`storage`/`auth`를 초기화하는 유일한 곳. 다른 모든 모듈은 여기서 `db`/`storage`/`auth`를 import해서 쓰지, 다시 초기화하지 않는다.
- `ui-shared.js` — 화면 전환(`showLibraryScreen`/`showViewerScreen` — `showAuthScreen`은 인증 전용 상태에 의존하기 때문에 `auth.js`에 있다), Wake Lock, 하단 상태 토스트(`setStatus(text, progress?)` — `progress`(0~1)를 넘기면 진행률 바+퍼센트가 있는 카드로, 안 넘기면 기존처럼 텍스트 pill로), 범용 시트 열기/닫기(`openSheet`/`closeSheet` + `[data-close-panel]` 배선).
- `offline-cache.js` — 책 텍스트의 IndexedDB 캐시(아래 "오프라인 지원" 참고).
- `reader.js` — 뷰어 화면: 페이지분할/PageFlip, 검색, 책갈피, 리더 설정, 진행상황 동기화, 몰입모드, 밝기 스와이프. 가장 큰 모듈.
- `library.js` — "내 서재" 화면: 폴더, 파일 목록, 드래그앤드롭, 업로드, 최근 파일.
- `auth.js` — 로그인/회원가입, 개발자 로그인, `onAuthStateChanged` 게이트, 로그아웃. 다른 모든 도메인 모듈을 import하므로 사실상 앱의 진짜 진입 시퀀스 역할을 한다.
- `storage-stats.js` — 설정 메뉴의 "기기 저장공간 현황" 하위 화면: 오프라인 저장된 책 / 진행상황·책갈피 캐시 / 페이지 나누기 캐시 / 서재 구조·환경설정 / 앱 실행 파일 5개 카테고리의 용량을 보여주고 책 단위(또는 전체) 삭제를 지원한다. `session.js`/`offline-cache.js`/`ui-shared.js`를 import하고, `library.js`의 `openItemActionSheet`를 재사용한다 — 다만 캐시 키 형식(접두사)은 `reader.js`/`library.js`의 진짜 키 생성 함수와 별개로 자체적으로 알고 있으므로, **그쪽 키 형식이 바뀌면 여기도 같이 고쳐야 한다.**
- `main.js` — 실제 모듈 진입점. 위 모듈들을 그 부수효과(각 모듈이 로드 시점에 자기 이벤트 리스너를 배선함)를 위해 import하고, 서비스워커를 등록한다.

**`library.js`와 `reader.js`는 서로를 import한다** — 의도된 순환 의존성이다. `library.js`는 목록 행에서 책을 열기 위해 `reader.js`의 `loadFileFromStorage`/`loadDevTestFile`가 필요하고, `reader.js`는 열린 파일을 목록에서 강조 표시하기 위해 `library.js`의 `markActiveFileRow`가 필요하다. 모든 상호 호출이 이벤트 핸들러나 비동기 함수 안에서만 일어나고 모듈 최상위에서는 절대 일어나지 않기 때문에 ES 모듈 스펙상 안전하다.

모듈 간 공유 가변 상태는 반복되는 한 가지 패턴을 따른다: 소유 모듈이 `let someState`(다른 곳에서 import로 읽을 수 있음)와 `setSomeState()` 함수(다른 모듈이 값을 쓸 수 있는 *유일한* 방법 — ES 모듈은 import한 바인딩을 재할당할 수 없으므로)를 함께 export한다. `session.js`의 `currentUser`/`setCurrentUser`나 `reader.js`의 `currentFileName`/`setCurrentFileName`이 그 예.

### Firebase 데이터 모델

- **Auth**: 이메일/비밀번호, `browserLocalPersistence`(오프라인을 포함해 새로고침해도 로그인이 유지됨).
- **Storage**: 업로드된 `.txt` 파일은 전부 `books/` 아래 평평하게 저장된다 — *모든* 계정에 걸쳐 공유되고, 아직 계정별로 분리되지 않았다(아래 관리자 권한 제한 참고).
- **Firestore**:
  - `library/shared` — 앱 전체 서재 폴더 구조(`folders`, 파일명→폴더ID 맵인 `fileFolder`, 드래그 순서변경용 `itemOrder`) 하나를 담은 문서. `books/`와 같은 이유로 공유된다.
  - `users/{uid}/reading_progress/{fileId}`와 `users/{uid}/bookmarks/{fileId}` — 사용자별·파일별. `fileId`는 `fileDocId(fileName)`(`btoa(encodeURIComponent(fileName))`)이라서, 파일명을 바꾸면 이 문서들도 같이 마이그레이션해야 한다(`library.js`의 `migrateFileDocs`).
  - `users/{uid}/settings/readerPrefs` — `{mobile: {...}, pc: {...}}`, 파일이 아니라 기기 종류(뷰포트 < 900px = 모바일)로 구분해서 저장.
  - 보안 규칙은 이 저장소에 없다(Firebase 콘솔에서 관리) — `library.js`와 `session.js`에 콘솔에 있어야 할 정확한 규칙 텍스트가 주석으로 남아있다.

**관리자 권한 제한**: `books/`와 `library/shared`가 모든 계정에 공유되기 때문에, `kinopioo@naver.com`(`session.js`의 `isAdminUser`)만 폴더/파일을 생성·이름변경·이동·삭제할 수 있다 — 계정별 파일 범위 분리가 되기 전까지의 임시 조치. 이건 UI만 가리는 것이라, 맞는 Firestore/Storage 규칙 없이는 진짜 보안이 아니다.

### 개발자 모드 테스트

`localhost`/`127.0.0.1`에서만, 이메일 `dev`로 로그인하면(`auth.js`의 `loginAsDevUser`) Firebase Auth를 완전히 건너뛰고 고정된 로컬 사용자(`DEV_USER_UID`)를 쓴다. 서재에는 정적 파일 `dev-test-book.txt` 딱 하나만 보이고, 진행상황/책갈피/리더설정/서재상태가 전부 Firestore/Storage 대신 `localStorage`로 간다. 브라우저 기반 검증은 전부 이 경로를 우선으로 쓸 것 — 프로덕션 Firebase 데이터를 절대 건드리지 않는다. 다만 오프라인 책 텍스트 캐시(아래 참고)나 진짜 Firebase Auth 지속성은 검증하지 *못한다* — 설계상 둘 다 우회하기 때문.

### 읽기 파이프라인 (`reader.js`)

가장 큰 모듈이고, 페이지 렌더링이 가장 복잡한 부분이다:

1. 책 텍스트는 **DOM 높이 측정 + 갤로핑 탐색**으로 페이지 단위로 나뉜다 — 추정하지 않고 숨겨진 `.page` 요소에서 실제 렌더링된 높이를 측정하며, 대용량 문서에서도 빠르도록 갤로핑/이분탐색 하이브리드를 쓴다. `findForwardPageEnd`/`findBackwardPageStart`가 서로 대칭인 양방향 함수이고, `createMeasurementDom`이 공유되는 숨겨진 DOM 측정 장치를 만든다.
2. **캐시가 없을 때(cold-cache)의 분할은 "0부터 끝까지"가 아니라 양방향·점진적이다.** 캐시 미스 시, `buildInitialWindowSplit`이 먼저 이어보기 위치(`currentLastCharIndex`, 새 책이면 0)를 기준으로 창(≤ `PAGE_WINDOW_RADIUS*2+1`페이지) 분량만 그 원점에서 뒤로*와* 앞으로 나눠서, 첫 페이지가 책 크기와 무관하게 창 크기만큼의 시간 안에 뜨게 한다. `continuePaginationInBackground`가 그 뒤로 화면을 막지 않고 양쪽 방향으로 계속 바깥으로 나누면서, 살아있는 `pageStartIndices`/`allTextPages` 배열에 `prepend`/`append`한다(앞에 붙이는 건 이미 추적 중인 모든 인덱스 — `windowStartIndex`/`windowEndIndex`/`currentDisplayedGlobalPage` — 를 1씩 밀어서 보정해야 한다). `pendingBackwardDone`/`pendingForwardDone`(`isPaginationPending()` 참고)이 각 방향이 책의 진짜 시작/끝에 도달했는지 추적한다. 대기 중일 때는: 페이지 슬라이더가 비활성화되고 "계산 중..."을 보여주며(대략치 표시 안 함), 검색도 비활성화되고(`updateSearchAvailability`), 아직 안 알려진 영역으로 넘기려 하면 에러 대신 "아직 준비 중" 상태를 보여준다(`goToNextPage`/`jumpToPrevPage`의 경계 가드). *완전히* 끝난 분할(양방향 다 끝남)만 캐시에 저장된다 — 부분 결과를 캐싱하면 다음에 열 때 더 작은 책처럼 보이므로 절대 캐싱하지 않는다.
   - ⚠️ 양방향 분할은 같은 책을 순수하게 처음부터 끝까지 정방향으로 분할했을 가상의 결과와 **바이트 단위로 동일하지 않다** — 워드랩이 페이지가 정확히 어디서 시작하는지에 민감해서, 이어보기 원점 근처의 경계가 왼쪽에서 오른쪽으로 쭉 훑었을 때 골랐을 위치와 최대 몇십 자 정도 어긋날 수 있다. 둘 다 똑같이 *유효한* 분할이다(검증됨: 빈틈 없고 단조증가하며 모든 페이지가 `maxHeight`에 맞음) — 이건 의도된 것이지 버그가 아니고, 이 정도 외에는 사용자에게 보이지 않는다.
3. 현재 위치 근처의 **창** 분량 페이지(`PAGE_WINDOW_RADIUS = 15`)만 PageFlip에 실제로 마운트된다(`computeWindowRange`/`maybeShiftPageWindow`) — 책의 나머지는 그냥 메모리에 문자열로만 남아있다. PageFlip이 *로컬* 페이지 인덱스를 좌/우 스프레드로 짝짓기 때문에 이게 필요하다 — 창의 시작 인덱스가 짝수를 유지해야 스프레드가 한 페이지씩 밀리지 않는다(`computeWindowRange` 위의 긴 주석 참고).
4. 분할 결과는 두 번 캐싱된다: 메모리(`paginationCache`, 파일+크기+폰트로 키를 만듦)와 `localStorage`(`persistedPaginationKey`) — 페이지 텍스트가 아니라 `pageStartIndices`만 저장하는데, 원본 텍스트가 그 오프셋들로부터 다시 잘라낼 수 있기 때문이다. 크기는 (텍스트 측정용 `maxHeight`와 캐시 키에) 쓰이기 전에 **버킷화**된다(20px/40px 격자로 내림, `WIDTH_JITTER_THRESHOLD`/`HEIGHT_JITTER_THRESHOLD`의 절반) — 안 그러면 열 때마다 미묘하게 다른 뷰포트 차이(주소창 접힘, PWA 상태표시줄 상태 등)가 캐시를 미스시켜서, 같은 기기의 같은 파일이라도 매번 전체 재분할을 강제한다.
   - ⚠️ **PageFlip에 실제로 넘기는 렌더링 크기(`renderWidth`/`renderHeight`)는 이 버킷값이 아니라 `#book-stage`의 정확한 실측 크기다** — 버킷값(`bookWidth`/`bookHeight`)은 텍스트 측정·캐시 키 용도로만 쓴다. 버킷값은 항상 실측 이하로 "내림"한 값이라 렌더링 크기가 측정 기준보다 작아질 일은 없다(텍스트가 잘릴 위험 없음). 원래는 렌더링 크기도 버킷값을 그대로 썼는데, `#book-stage`가 내용을 가운데 정렬해서 그 버킷값과 실제 무대 크기 사이 간극(최대 39px)이 책 주위에 여백으로 남았다 — 평소엔 안 보이다가 페이지 넘기기 애니메이션의 그림자 효과 때문에 드러났다. 커밋 `7b62bb2`.
5. 책갈피/진행상황은 페이지 번호가 아니라 **글자 인덱스**로 저장된다 — 페이지 번호는 폰트/크기/문단너비/화면크기가 바뀔 때마다 흔들리지만, 글자 오프셋은 그렇지 않다.
6. `buildGeneration`/`fileLoadGeneration` 카운터가, 사용자가 이전 비동기 분할/다운로드가 끝나기도 전에 리사이즈하거나 책을 전환할 때 생기는 경쟁 상태를 막는다 — 백그라운드 점진적 완료 루프도 매 yield 지점마다 `buildGeneration`을 확인해서, 리사이즈/책전환이 라이브 배열을 망가뜨리는 대신 깔끔하게 오래된 진행 중이던 분할을 포기하게 한다.

### 오프라인 지원 (`offline-cache.js` + `sw.js`)

- `sw.js`가 정적 앱 셸(HTML/CSS/JS/아이콘/매니페스트/폰트/PageFlip + Firebase SDK CDN 스크립트)을 미리 캐싱해서 네트워크가 없어도 앱이 뜬다. **정적 파일 목록이 바뀔 때마다 `CACHE_VERSION`을 올릴 것** — 안 그러면 클라이언트가 계속 예전 파일을 서빙받는다.
- **⚠️ 같은 출처의 파일이 import하거나 참조하는 외부 CDN URL은 전부 `sw.js`의 사전 캐싱 목록에 있어야 한다 — 이미 두 번의 실제 진단하기 어려운 프로덕션 버그를 냈다:**
  - `firebase-init.js`/`reader.js`/`library.js`/`auth.js`가 `www.gstatic.com/firebasejs/...`에서 Firebase SDK 모듈을 ES 모듈로 바로 import한다. 그 도메인이 사전 캐싱 목록에 통째로 빠져있어서, 실기기에서(온라인 상태로 설치 후 완전 오프라인으로 재실행) 그 import가 에러 하나 없이 영원히 멈췄다 — `firebase-init.js`가 모듈 그래프 맨 앞쪽에 있어서, 폴백으로 실행되어야 할 코드를 포함해 그 아래 *어떤* 것도 실행될 기회를 못 얻었다. 증상은 "파일 하나가 실패함"이 아니라 "앱 전체가 멈춤"처럼 보였다. 2026-08-16에 확인하고 고침.
  - `index.html`이 예전엔 구글 폰트의 CDN CSS를 직접 `<link>`로 불러왔다. 구글 폰트는 각 서체를 수백 개의 작은 유니코드 범위별 조각 파일로 쪼개서 실제로 렌더링된 것만 서빙(그리고 캐싱을 허용)한다 — 그래서 온라인 중에 폰트를 한 번도 수동으로 바꿔본 적 없는 사용자는 폰트 파일이 *하나도* 캐싱 안 돼 있었고, 오프라인에서 폰트를 바꾸면 조용히 아무 효과 없이(에러도 없이 시스템 폰트로 대체) 실패했다. 자체 호스팅으로 고침: 진짜 웹폰트 파일을 구식 `MSIE 6.0` User-Agent로 `curl`해서 받아오고(구글 폰트가 이 방식일 때는 최신 브라우저용 100개+ 조각 대신 서체당 통짜 파일 하나를 서빙함), `fonttools`로 TTF→WOFF2 변환(`pip install fonttools brotli`; `TTFont(...).flavor = 'woff2'; .save(...)`)해서 한글 전체 커버리지를 가진 파일 하나씩을 `fonts/` 아래 뒀고, `styles.css`의 자체 `@font-face` 규칙에서 참조하고, 다른 정적 자산처럼 `PRECACHE_URLS`에 추가했다. 이제 구글 폰트 의존성이 전혀 없다.
  - **주의해서 볼 패턴**: 앱 자기 출처가 아닌 다른 도메인을 가리키는 `<script src>`, `<link>`, ES 모듈 `import`는 전부 "같은 출처만 생각하는" 사각지대다 — 코드베이스 어디든 새로 하나 추가될 때마다 `sw.js`의 `PRECACHE_URLS`/`PRECACHE_NO_CORS_URLS`/`PRECACHE_CORS_URLS`와 런타임 `fetch` 핸들러의 출처 허용목록을 확인할 것.
- `offline-cache.js`는 책 *텍스트* 전용의 별도 IndexedDB 캐시로, 파일명으로 키를 만들고 (책 개수가 아니라) 전체 용량 기준(`OFFLINE_CACHE_BYTES_LIMIT`, 500MB)으로 LRU 제한한다 — 텍스트 파일은 충분히 작아서 개수 제한은 불필요하게 빡빡했다. `reader.js`의 `loadFileFromStorage`는 (온라인이든 오프라인이든) 이 캐시를 먼저 읽는다, 단 백그라운드 신선도 체크(`refreshStaleFlags`, "내 서재"가 로드될 때마다 한 번씩 Storage `getMetadata()`와 비교)가 캐시된 사본이 오래됐다고 표시한 경우는 예외다 — 오래됨 표시는 *다음* 열 때만 적용되고, 읽는 도중에는 절대 적용 안 된다.
- 읽기 진행상황, 책갈피, 서재 폴더 구조는 각각 자기만의 `localStorage` write-through 캐시를 가진다(온라인일 땐 Firestore/Storage가 항상 정답이고, 로컬 사본은 순전히 오프라인 폴백용) — 이건 개발자 모드가 이미 쓰던 패턴을 일반화한 것이지, Firestore 자체의 오프라인 지속성을 켠 게 아니다.
- 모든 서재 쓰기 동작(폴더/파일 생성·이름변경·이동·삭제, 업로드, 드래그 순서변경)은 `navigator.onLine`을 체크해서 오프라인이면 토스트로 거부한다 — 나중을 위해 큐에 쌓아두지 않는다.
- 파일 이름변경이나 삭제는 오프라인 캐시의 해당 항목도 갱신하거나 지워서, 재사용된 파일명 아래 오래된 캐시 항목이 절대 남아있지 않게 한다.
- `sw.js`의 런타임 `fetch` 핸들러는 캐시 히트 시 `respondWith()`와 `event.waitUntil()` 기반 백그라운드 갱신(stale-while-revalidate)을 의도적으로 **같이 쓰지 않는다** — 그 조합이 iOS Safari/WebKit에서 불안정하다는 보고가 있어서, 정적 콘텐츠는 설치 시점(`CACHE_VERSION` 올릴 때)에만 갱신된다. `auth.js`에도 `onAuthStateChanged`가 끝내 안 불릴 경우 강제로 로그인 화면을 보여주는 4초 타임아웃이 있다 — 위 Firebase SDK 사례 같은 미래의 조용한 멈춤에 대비한 최후의 안전장치(index.html의 화면들이 기본적으로 전부 `screen-hidden`이라, 이런 멈춤은 안 그러면 에러 하나 없이 영원히 빈 화면처럼 보인다).
- iOS 참고: iOS에서 서비스워커가 제대로 동작하는 진짜 standalone PWA는 Safari의 "홈 화면에 추가"로만 만들어진다 — iOS의 크롬/파이어폭스 등은 WebKit 래퍼라 "홈 화면에 추가"가 북마크 바로가기에 더 가깝고 오프라인이 안정적으로 안 된다. 이건 애플 플랫폼 제약이지 이 코드베이스에서 고칠 수 있는 게 아니다.

### PWA

`manifest.json` + `icons/`가 iOS/안드로이드에서 "홈 화면에 추가"를 지원하고, `sw.js`가 설치된 앱이 오프라인에서 동작하게 한다.

## 진행 상황 메모 (2026-08-18 기준 — 다른 컴퓨터에서 이어서 작업할 때 참고)

> ⚠️ **이 섹션은 커밋할 때마다 같이 업데이트한다** — 크든 작든, 기능/버그수정/포기한 시도/조사 전부. 커밋 하나가 이 메모 없이 지나가면 다음 세션(다른 컴퓨터일 수도 있음)이 git log만 보고 맥락을 다시 추론해야 한다. 항목 형식: ✅/❌/🔄 상태 + 커밋 해시 + 무엇을/왜/어떻게 + 검증 중 발견한 함정. 되돌리거나 포기한 시도도 이유와 함께 남긴다(예: 아래 iOS PWA 풀스크린 항목).

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
  - `sw.js`의 `CACHE_VERSION`을 계속 올려가며 진행(이 작업 시점 기준 최신 `v19` — 이후 다른 작업들로 계속 올라갔으니 "최신"으로 읽지 말 것, 지금 실제 최신 버전은 `sw.js` 파일에서 직접 확인).
- ❌ **결론 내리고 포기함 (2026-08-18)**: iOS 홈화면 PWA 완전 풀스크린(상태바 뒤까지 콘텐츠 확장) — 맥 + Safari 원격 Web Inspector로 배포 왕복 없이 라이브 디버깅까지 동원해서 원인을 좁혔지만, **이 기기(다이나믹 아일랜드 모델, `screenHeight`/`screenWidth` = 852×393)에서는 홈화면 standalone 웹앱의 `window.innerHeight`가 무엇을 해도 항상 정확히 `793`(=852−59, 상태바 높이만큼 항상 모자람)으로 고정됐다.** 사용자 결정으로 **완전 포기, 코스메틱 처리로 전환** — `index.html`/`styles.css`/`sw.js`를 이 재시도 시작 전(`d0fe0e4`) 상태로 되돌렸다. `viewport-fit=cover`, `apple-mobile-web-app-capable`/`status-bar-style`, `#debug-version-badge` 전부 소스에서 다시 사라진 상태다. **이 항목은 다시 열지 말 것 — 아래 결정적 증거 때문에 재도전할 가치가 낮다.**
  - **결정적으로 확인된 것**: 매번 완전 삭제 → Safari 데이터 지우기 → 재설치까지 거쳐 캐시 문제를 배제한 뒤, 아래 조합을 각각 **단독으로** 실기기에 올려 `window.screen.height + ' vs ' + window.innerHeight`와 `env(safe-area-inset-top)` 실측값을 라이브 콘솔로 직접 측정했다 — **전부 `852 vs 793`, `safe-area-inset-top`은 항상 `0`으로 완전히 동일했다**:
    1. 아무것도 안 넣은 순정 상태
    2. `viewport-fit=cover`만
    3. `manifest.json`의 `"display": "fullscreen"`만 (W3C 스펙상 `standalone`은 상태바 공간을 예약하고 `fullscreen`은 안 하는데도 차이 없음)
    4. `apple-mobile-web-app-status-bar-style: black-translucent` + `capable`만 (body min-height 보정 없이, 이전 라운드처럼 다른 변경과 섞지 않고 단독으로)
    - 즉 `793`은 버그가 아니라 **이 기기/iOS 버전에서 홈화면 standalone 웹앱이 절대 넘지 못하는 렌더링 상한선**으로 보인다. 이전 라운드(1차·2차 시도, 위쪽 오래된 기록)에서 봤던 상단 겹침/하단 여백 증상은 이 793 자체가 원인이 아니라, 그 위에 얹었던 `body { min-height: calc(100% + env(safe-area-inset-top)) }` 보정 코드가 (실제로는 `safe-area-inset-top`이 항상 0이라 사실상 no-op이어야 함에도) 다른 요인과 겹쳐 부작용을 낸 것으로 추정 — 정확한 상호작용까지는 안 밝혀졌고, 이제 그 보정 코드 자체가 소스에 없다.
  - **채택한 대안(코스메틱)**: 완전 투명 확장은 포기하고, 분리된 불투명 상태바가 앱과 최대한 자연스럽게 이어지도록 색만 맞춘다.
    - `manifest.json`의 `background_color`(`#B7AC97`)가 이미 앱의 `--bg-color`와 정확히 일치해서, 서재/뷰어 화면에서는 이미 상태바 영역이 자연스럽게 이어져 보인다 (재설치 검증 스크린샷으로 확인됨) — 추가 조치 불필요.
    - 유일하게 안 맞는 곳은 로그인 화면(`#auth-screen`, 의도적으로 어두운 `#605549` 배경) — 상태바 경계가 그 화면에서만 두드러진다. **사소한 이슈로 남겨둠, 다시 요청받기 전엔 손대지 않는다.**
  - ⚠️ **iOS Safari 홈화면 PWA는 서비스워커 캐시가 지독하게 끈질기다** — 앱을 완전 종료 후 재실행은 물론, **홈 화면 아이콘을 삭제하고 재설치해도 예전 캐시가 안 지워지는 경우**를 실기기에서 직접 확인함. 확실히 지우려면 설정 → Safari → "방문 기록 및 웹 사이트 데이터 지우기"(전체 삭제, 다른 사이트 로그인도 다 풀림)까지 가야 한다. (다만 이번 라운드에서 `manifest.json`의 `display` 변경만은 이 방법으로도 매번 확실히 반영됐다 — `apple-mobile-web-app-*` 메타태그류는 재실행만으로도 반영될 가능성이 있었지만 확인 안 해봄.)
  - **맥 + Safari 원격 Web Inspector 디버깅 방법 자체는 유효하고 앞으로도 유용함** — 설정 → Safari → 고급 → "웹 속성 관리자" 켜기 → 맥 Safari 개발자용 메뉴 → 기기 선택 → 홈 화면 앱 탭 선택. Elements 패널의 요소 선택 도구로 실기기 화면을 직접 탭하면 `$0`에 정확한 DOM 요소가 잡혀서, PageFlip처럼 라이브러리가 동적으로 만드는 요소(예: `.page`가 32개 중 대부분 `display:none`, 진짜 보이는 것 하나만 `stf__item` 클래스 붙음)를 추측 없이 바로 찾을 수 있었다.
- ✅ **완료·커밋됨 (2026-08-18)**: PageFlip이 페이지를 그릴 때 버킷값이 아니라 무대(`#book-stage`)의 정확한 실측 크기로 렌더링하도록 수정. `#book-stage`가 내용을 가운데 정렬해서, 캐시 키/텍스트 측정용으로 쓰는 버킷값(20px/40px 단위로 내림, "Reading pipeline" 절 4번 참고)과 실제 무대 크기 사이 최대 39px 간극이 책 주위에 여백으로 남았었다 — 평소엔 그 여백 색이 `#book-stage` 배경과 같아서 안 보이다가, 페이지 넘기기 애니메이션의 그림자 효과 때문에 드러남. `bookWidth`/`bookHeight`(버킷값, 캐시 키·측정용으로 계속 사용)와 별도로 `renderWidth`/`renderHeight`(무대 실측값)를 추가해서 `new St.PageFlip(...)`에는 후자를 넘기도록 분리. 최초 커밋 `7b62bb2` — iOS 풀스크린 작업을 되돌리며(`js/reader.js`를 `1668ad8`로 되돌림) 이 무관한 수정까지 같이 쓸려나갔던 걸 `2b0490d`로 재적용. **iOS 풀스크린 문제와는 무관한, 독립적으로 유효한 버그 수정이었다.**
- ✅ **완료·커밋됨 (2026-08-18, `f2a7e49`)**: 로딩/페이지 나누기 상태 토스트(`ui-shared.js`의 `setStatus`)에 진행률 바 + 퍼센트 표시 추가.
  - `setStatus(text, progress)` — `progress`(0~1)를 새로 받는 선택 인자로 추가. 값이 있으면 토스트가 진행률 바 + 퍼센트가 있는 작은 카드 형태로 커지고, 없으면(기존 호출부 대부분 — 에러 메시지, "책갈피 저장됨" 등) 예전 그대로 텍스트 pill로 동작해서 다른 곳은 손댈 필요 없었다.
  - 연결한 곳 2군데: (1) 배경 페이지 나누기(`reader.js`의 `continuePaginationInBackground`) — 진행률은 페이지 수가 아니라 **커버된 글자 수**(`forwardCursor - backwardCursor` / `rawTextData.length`) 기준이라, 폰트·화면 크기와 무관하게 항상 정확히 100%에 도달한다. (2) 파일 다운로드(`loadFileFromStorage`) — Firebase Storage의 `getBytes()`는 진행률 콜백이 없어서, `getDownloadURL()`로 받은 URL을 직접 `fetch`해 응답 본문을 스트림으로 읽으면서 `Content-Length` 대비 받은 바이트 수로 진행률을 추적하는 `downloadWithProgress()`를 새로 만듦 — 스트리밍 fetch가 어떤 이유로든(CORS 등) 실패하면 진행률 없이 기존 `getBytes()` 경로로 조용히 폴백.
  - `CACHE_VERSION` `v25`→`v26`.
- ✅ **완료·커밋됨 (2026-08-20)**: 기기 간 읽기 진행상황 동기화 버그 수정 — 사용자 신고: PC로 읽다가 그대로 두고 폰으로 이어읽은 뒤 PC로 돌아와 새로고침해도 폰에서 더 읽은 진행상황이 사라짐.
  - **원인**: `reader.js`의 `flushProgressSave()`(탭이 `visibilitychange`로 hidden 되거나 `pagehide`될 때 호출)가 이 세션에서 실제로 뭔가 새로 읽었는지 전혀 안 따지고 그 순간 메모리에 있는 `currentLastCharIndex`를 무조건 새 타임스탬프로 다시 저장했다. PC 탭을 그냥 열어만 두고 자리를 비우면(페이지 안 넘김) `currentLastCharIndex`는 옛날 값 그대로인데, 그 사이 폰이 서버에 더 앞선 위치를 저장해놔도, PC로 돌아와 새로고침하는 순간(구 페이지가 사라지기 직전 `pagehide` 발동) PC의 옛 위치가 "방금 갱신된 최신 기록"인 것처럼 서버를 덮어써서 폰의 진행상황이 지워졌다 — 그 직후 새로고침된 새 페이지가 서버를 다시 읽어도 이미 뭉개진 값을 받아온다.
  - **수정**: `progressDirty` 플래그 추가([reader.js:112](js/reader.js:112)) — 사용자가 실제로 페이지를 넘긴 세 지점(`jumpToPrevPage`/`jumpToGlobalPage`/PageFlip `'flip'` 이벤트 핸들러)에서만 `true`로 세팅하고, 디바운스 저장이 실제로 끝나면 `false`로 리셋한다. `flushProgressSave()`는 이제 `progressDirty`가 `true`일 때만 저장을 시도한다 — 아무것도 안 읽은 채 배경으로 가거나 새로고침되는 탭은 서버에 손을 대지 않는다. 새 파일을 열 때(`loadFileFromStorage`/`loadDevTestFile`)는 `lastKnownProgressUpdatedAt`과 함께 `progressDirty`도 `false`로 초기화한다.
  - **보너스**: 탭이 한 번도 배경으로 안 가고(=`visibilitychange`가 안 뜨고) 화면에 계속 떠 있는 채로 다른 기기가 더 읽는 경우도 따라잡도록, 보이는 동안 1분마다 `syncProgressFromServer()`를 추가로 돌리는 `setInterval`을 붙였다([reader.js:2093](js/reader.js:2093) 근처).
  - **검증**: 개발자(dev) 세션(로컬스토리지 기반)에서, ① 아무것도 안 읽은 채 hidden→visible을 흉내내면 저장을 안 건드림, ② 그 상태에서 다른 기기가 저장한 것처럼 로컬스토리지 값을 더 앞선 위치로 바꿔놓고 hidden→visible을 흉내내면 그 값이 그대로 보존됨(수정 전이었다면 PC의 옛 값으로 덮어썼을 상황), ③ 실제로 페이지를 넘긴 직후 곧바로 hidden이 되면 여전히 즉시 플러시되어 새 위치가 정상 저장됨 — 세 가지 다 브라우저에서 직접 확인. 콘솔 에러 없음. 실제 두 기기(진짜 로그인 계정) 간 크로스디바이스 시나리오까지는 이 환경에서 확인 못 함(dev 세션은 Firestore를 안 씀) — 다음에 실기기로 한 번 더 확인할 가치 있음.
  - `CACHE_VERSION` `v26`→`v27`.
