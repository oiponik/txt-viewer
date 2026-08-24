// js/portrait-flip.js — 세로(모바일, 한 페이지) 모드 전용 페이지 넘기기 애니메이션.
//
// ⚠️ 왜 이 파일이 존재하는가: StPageFlip(js/vendor/page-flip.browser.js)은 세로 모드를
// "2페이지 스프레드 중 왼쪽 페이지를 화면 밖으로 숨겨서 1페이지처럼 보이게" 만드는
// 방식으로 구현돼 있다. 이 "숨겨진 절반" 좌표계 안에서 backward(이전 페이지) 방향의
// 커얼(curl) 애니메이션은 2026-08-18~24 사이 총 9라운드에 걸쳐 라이브러리 자체를
// 패치했는데도(js/vendor/page-flip.browser.js 상단 주석의 변경 이력 (a)~(i) 참고)
// 실기기 화면 녹화로 재현하면 이전 페이지 글자와 새 페이지 글자가 겹쳐 보이는 버그가
// 계속 남아있었다. 마지막엔 계산되는 모든 값(클립 영역·실측 화면 위치·브라우저가
// 실제로 파싱한 clip-path·매 프레임 화면에 떠 있는 요소 전체 목록)까지 전부 정확하다고
// 다각도로 검증됐는데도 실제 페인트만 깨지는 것까지 확인했다 — JS/DOM 검사로는
// 원리상 절대 잡아낼 수 없는 종류의 결함(브라우저 렌더링/합성 단계 결함으로 추정)
// 이라는 결론을 내렸다.
//
// 그래서 세로 모드만 이 파일로 완전히 분리해서, StPageFlip을 아예 쓰지 않는 훨씬
// 단순한 애니메이션으로 새로 구현한다:
//   - clip-path나 rotate를 전혀 쓰지 않고, 순수 translate3d(이동)만 쓰는 "밀어내기"
//     방식이다. 지금까지 문제를 일으켰던 "매 프레임 바뀌는 clip-path + rotate" 조합
//     자체를 안 쓰니, 같은 종류의 렌더링 결함을 구조적으로 피해간다.
//   - 앞/뒤 방향이 부호(sign) 하나만 다른 완전히 같은 코드다. 그래서 "다음 페이지랑
//     느낌이 다르다"는 게 애초에 불가능하다 — 같은 함수를 거울처럼 뒤집어 쓸 뿐이다.
//
// 가로(PC, 2페이지 스프레드) 모드는 이 파일과 전혀 무관하다 — 계속 StPageFlip의
// flipNext()/flipPrev()를 그대로 쓴다(원래도 문제 없었고, 지금도 안 건드린다).

let activeAnimation = null; // 겹쳐 눌림 방지 — 애니메이션 도중 새 호출은 조용히 무시한다

export function isPortraitFlipAnimating() {
  return activeAnimation !== null;
}

// buildFlipBook이 리사이즈 등으로 #book-stage를 통째로 갈아끼우기 직전에 부른다 —
// 그 시점에 마침 애니메이션이 돌고 있었다면, DOM이 밑에서 통째로 사라지므로 onDone()을
// 호출해봤자(finishManualPageTurn이 방금 파괴된 pageFlip 인스턴스를 건드리게 됨) 의미가
// 없다. 진행 중이던 rAF/타이머만 조용히 멈추고 onDone은 아예 부르지 않는다 — 어차피
// buildFlipBook이 새 pageFlip을 만들면서 현재 페이지를 다시 정확히 그려준다.
export function cancelPortraitFlip() {
  if (!activeAnimation) return;
  if (activeAnimation.raf) cancelAnimationFrame(activeAnimation.raf);
  if (activeAnimation.safetyTimer) clearTimeout(activeAnimation.safetyTimer);
  activeAnimation = null;
}

// createPageElements()(reader.js)가 진짜 페이지에 쓰는 것과 정확히 같은 DOM
// 구조(.page > .page-content + .page-footer)를 그대로 재현한다 — styles.css의
// .page 스타일(배경색/글꼴/패딩 등)을 별도 손질 없이 그대로 물려받기 위함이다.
function buildPageElement(text, footer, width, height) {
  const el = document.createElement('div');
  el.className = 'page';
  el.style.position = 'absolute';
  el.style.top = '0';
  el.style.left = '0';
  el.style.width = width + 'px';
  el.style.height = height + 'px';

  const content = document.createElement('div');
  content.className = 'page-content';
  content.textContent = text;

  const footerEl = document.createElement('div');
  footerEl.className = 'page-footer';
  footerEl.textContent = footer;

  el.appendChild(content);
  el.appendChild(footerEl);
  return el;
}

// direction: 'next' | 'prev'. stage는 오버레이를 붙일 기준 요소(#book-stage, position:relative
// 이미 걸려있음) — 오버레이가 그 안을 정확히 꽉 채운다.
// 반환값: 애니메이션을 실제로 시작했으면 true, 이미 진행 중이라 무시했으면 false.
export function playPortraitPageTurn({
  stage, width, height, direction,
  leavingText, leavingFooter, revealingText, revealingFooter,
  duration = 1000, onDone,
}) {
  if (activeAnimation) return false;

  const overlay = document.createElement('div');
  overlay.className = 'portrait-flip-overlay';
  overlay.style.position = 'absolute';
  overlay.style.inset = '0';
  overlay.style.overflow = 'hidden';
  overlay.style.zIndex = '20';
  overlay.style.pointerEvents = 'none';

  // sign: 다음 페이지면 왼쪽으로(-), 이전 페이지면 오른쪽으로(+) 밀려나간다 —
  // 이 부호 하나만 다르고 나머지 로직은 완전히 동일해서, 두 방향이 항상 거울
  // 대칭으로 똑같이 느껴진다(속도·이징·그림자 전부 같은 코드에서 나온다).
  const sign = direction === 'next' ? -1 : 1;

  // 아래층 — 새로 드러날 페이지. 처음부터 제자리(0,0)에 고정해두고 애니메이션 내내
  // 움직이지 않는다. 위층이 밀려나가면서 그 밑에 있던 이 페이지가 드러나는 것처럼 보인다.
  const revealing = buildPageElement(revealingText, revealingFooter, width, height);
  revealing.style.zIndex = '1';

  // 위층 — 지금 보이던 페이지. 이게 sign 방향으로 통째로 미끄러져 나간다.
  const leaving = buildPageElement(leavingText, leavingFooter, width, height);
  leaving.style.zIndex = '2';
  // 밀려나가는 쪽 가장자리에 옅은 그림자를 둬서 종이가 살짝 들려서 미끄러지는
  // 느낌만 준다. 매 프레임 다시 계산하는 clip-path 기반 그림자가 아니라 각도조차
  // 안 바뀌는 고정 box-shadow라서, 지금까지 문제를 일으켰던 것과는 완전히 다른
  // (훨씬 단순한) 렌더링 경로를 탄다.
  leaving.style.boxShadow = sign < 0
    ? '-10px 0 24px rgba(0,0,0,0.28)'
    : '10px 0 24px rgba(0,0,0,0.28)';

  overlay.appendChild(revealing);
  overlay.appendChild(leaving);
  stage.appendChild(overlay);

  const startTime = performance.now();
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  let finished = false;

  // ⚠️ 탭이 백그라운드로 가면(다른 앱 전환, 화면 잠금 등) 브라우저가
  // requestAnimationFrame을 통째로 멈추거나 아주 드물게만 돌린다 — 그 상태에서
  // 애니메이션이 끝나기를 기다리기만 하면 사용자가 다시 돌아왔을 때 넘어가다 만
  // 페이지에 영원히 멈춰있는 것처럼 보인다. rAF와 별개로 흘러가는 setTimeout을
  // 안전장치로 같이 걸어서, 어느 쪽이든 먼저 끝나는 쪽이 마무리를 맡는다.
  function finish() {
    if (finished) return;
    finished = true;
    if (activeAnimation) clearTimeout(activeAnimation.safetyTimer);
    overlay.remove();
    activeAnimation = null;
    onDone();
  }

  function frame(now) {
    if (finished) return;
    const t = Math.min(1, (now - startTime) / duration);
    const eased = easeOutCubic(t);
    leaving.style.transform = `translate3d(${sign * eased * width}px, 0, 0)`;
    if (t < 1) {
      activeAnimation.raf = requestAnimationFrame(frame);
    } else {
      finish();
    }
  }

  activeAnimation = {
    raf: requestAnimationFrame(frame),
    safetyTimer: setTimeout(finish, duration + 500),
  };
  return true;
}
