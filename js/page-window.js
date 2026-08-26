// js/page-window.js — StPageFlip 라이브러리(js/vendor/page-flip.browser.js)를 대체하는
// 아주 얇은 상태 관리자.
//
// ⚠️ 2026-08-26 — 왜 이 모듈이 생겼는지: 이 앱은 오래전에 라이브러리 자체의 페이지 넘김
// 애니메이션을 완전히 버리고(js/portrait-flip.js가 CSS 3D rotateY 카드 뒤집기로 처음부터
// 다시 만듦) 커스텀 애니메이션으로 갈아탔다 — 그런데도 "지금 창(window)에 로드된 .page
// 요소들 중 몇 개가 좌/우(또는 세로 모드면 1개)에 떠 있는지" 관리하는 용도로는 여전히
// 라이브러리 전체를 계속 짊어지고 있었다. 그 대가로: (1) 책이 열려있는 내내 라이브러리
// 자신의 requestAnimationFrame 렌더 루프가 초당 60번 도는 낭비, (2) 이 프로젝트 역사에서
// 몇 주씩 쫓았던 버그들(footer 위치 점프, --left/--right 잔여 클래스, .sft__wrapper CSS
// 오타로 인한 레이아웃 붕괴 등)이 전부 이 라이브러리 내부 렌더링 파이프라인을 우리가
// 완전히 통제 못 해서 생겼던 것 — 이 모듈은 그 좁은 역할("지금 몇 페이지가 보이는지"만)을
// 라이브러리 없이 직접, 훨씬 단순하게 구현한다. 렌더 루프도 이벤트 시스템도 없다 — 모든
// 게 호출한 그 순간 동기적으로 끝난다.
//
// `#my-book`의 자식으로 들어가는 `.page` 요소 자체(마크업/스타일)는 지금까지와 완전히
// 같다(js/reader.js의 createPageElements()가 만듦) — 이 모듈은 그 요소들 중 어떤 걸
// 보여줄지만 결정한다. `.page`의 CSS 기본값(styles.css)이 `display:none`이므로, 여기서
// 명시적으로 켜지 않는 한 항상 숨겨진 상태다.

function bookElement() {
  return document.getElementById('my-book');
}

// 지금 실제로 display:block으로 켜져 있는 요소들 — 다음 호출 때 창(window) 전체를
// 다시 훑지 않고 이것들만 끄면 되므로 들고 있는다(윈도우가 최대 ~31개뿐이라 안 이래도
// 비용은 미미하지만, 어차피 알고 있는 값을 다시 찾는 것도 낭비라 그냥 기억해둔다).
let visibleEls = [];

// #my-book의 자식을 통째로 교체 — 라이브러리의 updateFromHtml()/loadFromHTML()이 내부적으로
// 하던 것과 정확히 같은 한 줄짜리 로직이다. 창(window)이 바뀔 때마다(스크롤 근처 재구성,
// 슬라이더 점프 등) 호출한다.
export function mountWindow(elements) {
  const book = bookElement();
  book.innerHTML = '';
  for (const el of elements) book.appendChild(el);
  visibleEls = []; // 옛 요소들은 이미 DOM에서 떨어져나갔으므로 추적을 리셋
}

// 책을 완전히 닫을 때(다른 책 열기 직전, 서재로 돌아갈 때) — #my-book을 비운다.
export function clearWindow() {
  const book = bookElement();
  if (book) book.innerHTML = '';
  visibleEls = [];
}

function hideVisible() {
  for (const el of visibleEls) el.style.display = 'none';
  visibleEls = [];
}

function showAt(el, left, width, height) {
  el.style.left = left + 'px';
  el.style.width = width + 'px';
  el.style.height = height + 'px';
  el.style.display = 'block';
  visibleEls.push(el);
}

// 세로(한 페이지) 모드 — globalIndex 하나만 화면 전체 너비로 보여준다.
// windowStartIndex: 지금 #my-book에 로드된 창의 전역 시작 페이지(요소 배열의 인덱스
// 기준점) — js/reader.js가 이미 추적하고 있는 값을 그대로 넘겨받는다.
export function showPage(globalIndex, windowStartIndex, width, height) {
  hideVisible();
  const book = bookElement();
  book.style.width = width + 'px';
  book.style.height = height + 'px';
  const pages = book.querySelectorAll('.page');
  const el = pages[globalIndex - windowStartIndex];
  if (el) showAt(el, 0, width, height);
}

// 가로(2페이지 스프레드) 모드 — leftGlobalIndex와 그 다음 페이지를 좌/우에 나란히
// 보여준다. 마지막 스프레드가 홀수 페이지라 오른쪽이 없으면(창 끝을 넘어감) 왼쪽만
// 보여준다 — panelWidth는 페이지 한 장의 너비(스프레드 전체 너비의 절반)다.
export function showSpread(leftGlobalIndex, windowStartIndex, panelWidth, height) {
  hideVisible();
  const book = bookElement();
  book.style.width = (panelWidth * 2) + 'px';
  book.style.height = height + 'px';
  const pages = book.querySelectorAll('.page');
  const leftEl = pages[leftGlobalIndex - windowStartIndex];
  const rightEl = pages[leftGlobalIndex + 1 - windowStartIndex];
  if (leftEl) showAt(leftEl, 0, panelWidth, height);
  if (rightEl) showAt(rightEl, panelWidth, panelWidth, height);
}
