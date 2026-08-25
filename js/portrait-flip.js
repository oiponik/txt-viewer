// js/portrait-flip.js — 세로(모바일, 한 페이지) 모드 전용 페이지 넘기기 애니메이션.
//
// ⚠️ 이 파일의 역사(중요, 다시 손댈 때 꼭 읽을 것):
// StPageFlip의 세로 모드 커얼(clip-path 다각형 + rotate를 매 프레임 JS로 갱신하는 방식)을
// 세 가지 서로 다른 구현으로 시도했다 — ① 라이브러리 자체를 9라운드에 걸쳐 패치, ②
// 순수 translate3d 밀기(문제는 없었지만 사용자가 원한 "진짜 애니메이션"이 아니었음),
// ③ 라이브러리 소스의 커얼 수학을 진짜 1페이지 컨테이너에 직접 이식. 셋 다 이 환경에서는
// 검증됐다고 나왔지만(수식·좌표·DOM 값이 논리적으로 맞음을 확인) — 실기기에서는 매번
// 같은 종류의 글리치(회전된 텍스트 조각/겹침)가 재발했다(사용자 확인, 2026-08-24 여러 차례,
// 다른 컴퓨터의 이전 세션들 포함). 원인이 명확히 하나로 좁혀지지 않은 채(포팅 버그일
// 수도, 이 조합 자체의 브라우저 렌더링 한계일 수도 있음) 반복됐기 때문에, 사용자 결정으로
// **"clip-path + 매 프레임 JS 스타일 갱신" 기법 자체를 완전히 버리고** 처음부터 다른
// 메커니즘으로 다시 만들었다 — 이전 세 구현의 코드는 전혀 재사용하지 않는다.
//
// 새 방식: CSS 3D `perspective` + `rotateY` 카드 뒤집기.
//   - clip-path를 아예 안 쓴다 — 지금까지 문제의 공통분모였던 요소 자체가 없다.
//   - 매 프레임 JS가 스타일을 직접 쓰지 않는다 — `leaf.style.animation`을 한 번만
//     설정하고 나머지는 CSS `@keyframes`가 브라우저 자체 보간으로 처리한다(JS 구동 rAF
//     루프가 아예 없음). 이건 아주 오래되고 널리 쓰이는 검증된 기법(카드 뒤집기 UI 등)
//     이라 실기기 신뢰성이 지금까지 시도보다 훨씬 높다.
//   - 2026-08-24 튜닝: 사용자가 참고차 보여준 다른 flipbook(WebGL 기반, 기법 자체는
//     안 가져옴)의 애니메이션이 더 자연스러워 보인다고 해서, 단순 rotateY 회전에
//     가속·감속 커브(cubic-bezier)와 중간 지점의 scaleX 압축(휘어지는 느낌)+
//     translateZ(입체감)+동적 그림자를 얹었다(styles.css의 `@keyframes
//     portrait-flip-leaf-next/prev`) — 여전히 clip-path 없음, 여전히 선언적 애니메이션.
//   - 2026-08-25 수정(1차): 키프레임의 100% 지점을 rotateY 92deg(=backface-visibility로
//     화면에서 사라지는 바로 그 지점)로 당겼다 — 예전엔 100%가 180deg(한 바퀴 다 돎)라
//     duration의 뒤쪽 상당 구간이 이미 안 보이는 채로 낭비됐고, 그 탓에 유저 눈엔
//     페이지가 이미 넘어간 것처럼 보인 뒤에도 `animationend`(→페이지 인디케이터 갱신)가
//     한참 늦게 발동해서 "애니메이션이 끝나고 나서 페이지 번호가 움직이는" 것처럼
//     보였다(사용자 신고).
//   - 2026-08-25 수정(2차): 1차 수정만으로는 부족했다 — 사용자가 실기기에서 같은 증상을
//     재신고("한 박자 쉬고 페이지 번호가 움직인다")했다. Web Animations API로 실제
//     rotateY(t)를 프레임 단위로 실측해보니, 그때 쓰던 급격한 감속 곡선
//     (`cubic-bezier(0.16, 1, 0.3, 1)`)이 목표각(92deg)을 duration의 ~55% 지점에서 이미
//     다 돌아버려서 나머지 ~45%는 여전히 낭비되고 있었다 — 100%를 "사라지는 지점"에
//     맞춰도 곡선 자체가 급하면 소용없다는 뜻. 감속 곡선을 완만한 `ease-out`으로 바꾸고
//     목표각을 91deg로 살짝 낮춰서, 같은 방식으로 재측정한 결과 duration의 ~92%
//     지점에야 90도를 넘는 것으로 확인됐다(자세한 수치는 styles.css의 키프레임 위
//     주석·js/portrait-flip.js의 `leaf.style.animation` 근처 주석 참고).
//   - 실제 DOM(.page 요소, createPageElements가 쓰는 것과 같은 구조)을 그대로 쓴다 —
//     캔버스나 이미지 스냅샷이 아니라서 폰트/렌더링이 항상 정확하고, 스냅샷 관련 위험
//     (예: 커스텀 웹폰트가 SVG foreignObject 안에서 깨지는 WebKit 특유의 버그)이 없다.
//   - ⚠️ 시각적으로 종이가 대각선으로 말리는 느낌(PC의 진짜 커얼)과는 다르다 — 세로축
//     중심으로 평평하게 회전하는 카드 뒤집기 느낌이다. 슬라이드보다는 훨씬 "진짜
//     애니메이션"에 가깝지만, PC와 완전히 동일한 모양은 아니라는 트레이드오프를 사용자도
//     인지하고 진행하기로 함.
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
// 없다. 진행 중이던 리스너/타이머만 조용히 정리하고 onDone은 아예 부르지 않는다 —
// 어차피 buildFlipBook이 새 pageFlip을 만들면서 현재 페이지를 다시 정확히 그려준다.
export function cancelPortraitFlip() {
  if (!activeAnimation) return;
  clearTimeout(activeAnimation.safetyTimer);
  activeAnimation.leaf.removeEventListener('animationend', activeAnimation.onAnimationEnd);
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

  const perspectiveStage = document.createElement('div');
  perspectiveStage.className = 'portrait-flip-stage';
  perspectiveStage.style.position = 'absolute';
  perspectiveStage.style.inset = '0';
  perspectiveStage.style.zIndex = '20';
  perspectiveStage.style.pointerEvents = 'none';
  perspectiveStage.style.perspective = '1600px';

  // 아래층 — 새로 드러날 페이지. 처음부터 제자리에 고정, 애니메이션 내내 움직이지 않는다.
  const base = buildPageElement(revealingText, revealingFooter, width, height);
  base.style.zIndex = '1';

  // 위층 — 지금 보이던(넘어가는) 페이지. 이게 세로축을 중심으로 90도를 넘어 회전하면
  // backface-visibility:hidden 덕분에 뒷면(안 보이는 쪽)을 보게 되는 순간 시각적으로
  // "사라져서" 밑에 있던 base가 드러나는 것처럼 보인다.
  const leaf = buildPageElement(leavingText, leavingFooter, width, height);
  leaf.style.zIndex = '2';
  leaf.style.backfaceVisibility = 'hidden';
  leaf.style.webkitBackfaceVisibility = 'hidden';
  leaf.style.transformStyle = 'preserve-3d';
  leaf.style.willChange = 'transform';
  // next(다음 페이지): 왼쪽 가장자리를 축으로 왼쪽으로 접히듯 회전.
  // prev(이전 페이지): 오른쪽 가장자리를 축으로 오른쪽으로 접히듯 회전.
  // 부호(sign) 하나만 다르고 나머지 로직은 완전히 동일해서, 두 방향이 항상 대칭이다.
  const sign = direction === 'next' ? -1 : 1;
  leaf.style.transformOrigin = sign < 0 ? 'left center' : 'right center';
  // 회전(rotateY) + 압축(scaleX, 접히는 쪽으로 살짝 눌려 종이가 휘어지는 느낌) + 들어올림
  // (translateZ, 입체감) + 동적 그림자를 전부 styles.css의 @keyframes 하나로 묶어뒀다.
  // 그래도 여전히 clip-path 없음, JS 매 프레임 갱신 없음 — 브라우저가 알아서 보간하는
  // 선언적 애니메이션인 건 그대로다.
  // 2026-08-25: 키프레임의 100%가 이제 rotateY 91deg(=화면에서 사라지는 지점 바로 너머)에서
  // 끝나서 duration 전체가 "보이는 구간"이다 — 예전처럼 "안 보이는 뒷부분에 감속을 낭비하지
  // 않기 위해 0% 키프레임에만 timing-function을 거는" 트릭이 더 필요 없다. 감속 곡선을
  // 그냥 여기 animation shorthand에 통째로 건다(styles.css 키프레임 위 주석 참고).
  // ⚠️ 여기서 `ease-out`을 쓰는 이유(같은 날 두 번째 수정) — 처음엔 더 급격한
  // `cubic-bezier(0.16, 1, 0.3, 1)`(easeOutExpo)을 그대로 썼는데, 실측(Web Animations API로
  // currentTime을 프레임 단위로 찍어 실제 rotateY(t)를 측정)해보니 이 곡선이 목표각의
  // 대부분을 duration 초반 ~55%에 이미 다 돌아버리고 나머지 45%는 이미 안 보이는 상태로
  // 낭비됐다 — 키프레임 100%를 "사라지는 지점"에 맞춰놔도 급격한 감속 곡선 자체가 그
  // 지점 도달 시점을 앞당겨버리면 소용없다는 뜻. 훨씬 완만한 표준 `ease-out`으로
  // 바꾸니 같은 측정 방법으로 duration의 ~92% 지점에야 90도를 넘는 것으로 확인됐다.
  leaf.style.animation = `portrait-flip-leaf-${direction} ${duration}ms ease-out`;

  perspectiveStage.appendChild(base);
  perspectiveStage.appendChild(leaf);
  stage.appendChild(perspectiveStage);

  // ⚠️ 임시 디버그 로깅 (2026-08-25) — 임시 카드(base)의 footer가 실제로 어느 화면
  // 좌표에 그려지는지 직접 측정. js/reader.js의 [FOOTERDEBUG] 로깅과 짝을 이룬다 —
  // 그쪽은 실제 PageFlip 페이지(#my-book)만 쟀지 이 임시 카드는 한 번도 잰 적이
  // 없었다. reader.js의 finishManualPageTurn 위 주석 참고. 원인 확인되면 제거할 것.
  try {
    const baseFooter = base.querySelector('.page-footer');
    const stageRect = stage.getBoundingClientRect();
    const baseFooterRect = baseFooter ? baseFooter.getBoundingClientRect() : null;
    console.log('[FOOTERDEBUG] overlay base footer @ start', JSON.stringify({
      t: Math.round(performance.now()),
      stageTop: Math.round(stageRect.top), stageBottom: Math.round(stageRect.bottom),
      baseFooterY: baseFooterRect ? Math.round(baseFooterRect.top) : null,
      baseFooterText: baseFooter ? baseFooter.textContent : null,
    }));
  } catch (err) { /* 진단용, 실패해도 애니메이션엔 영향 없음 */ }

  let finished = false;

  function finish() {
    if (finished) return;
    finished = true;
    // ⚠️ 임시 디버그 로깅 (2026-08-25) — perspectiveStage.remove() 직전, 즉 유저가 마지막으로
    // 본 임시 카드의 footer 위치를 기록한다. 위 '@ start' 로그와 짝.
    try {
      const baseFooter = base.querySelector('.page-footer');
      const stageRect = stage.getBoundingClientRect();
      const baseFooterRect = baseFooter ? baseFooter.getBoundingClientRect() : null;
      console.log('[FOOTERDEBUG] overlay base footer @ removal', JSON.stringify({
        t: Math.round(performance.now()),
        stageTop: Math.round(stageRect.top), stageBottom: Math.round(stageRect.bottom),
        baseFooterY: baseFooterRect ? Math.round(baseFooterRect.top) : null,
        baseFooterText: baseFooter ? baseFooter.textContent : null,
      }));
    } catch (err) { /* 진단용, 실패해도 정리엔 영향 없음 */ }
    if (activeAnimation) {
      clearTimeout(activeAnimation.safetyTimer);
      leaf.removeEventListener('animationend', onAnimationEnd);
    }
    perspectiveStage.remove();
    activeAnimation = null;
    onDone();
  }

  function onAnimationEnd(e) {
    if (e.target !== leaf || e.animationName !== `portrait-flip-leaf-${direction}`) return;
    finish();
  }
  leaf.addEventListener('animationend', onAnimationEnd);

  activeAnimation = {
    leaf,
    onAnimationEnd,
    // ⚠️ 2026-08-25 3차 수정 — 이 타이머는 원래 "탭이 백그라운드로 가는 등 드문 경우에만
    // 발동하는 안전장치"로 설계돼서 `duration + 500`(500ms 여유)이었다. 그런데 사용자가
    // 키프레임/이징을 다 고친 뒤에도(2차 수정, 90도 교차 시점을 duration의 94%까지 밀어냄)
    // "여전히 한 박자 쉬고 페이지 번호가 바뀐다"고 재신고했다 — 이 프로젝트의 자동화
    // 브라우저 환경은 `document.hidden`이라 `animationend`가 원천적으로 절대 안 뜨고 항상
    // 이 타이머가 완료를 처리하는데(위 파일 히스토리에서 반복 확인됨), 만약 실기기(특히
    // iOS Safari — backface-visibility로 사라지는 3D 회전 요소는 `animationend`가 안 뜨는
    // 걸로 알려진 사례들이 있다)에서도 같은 이유로 `animationend`가 안정적으로 안 뜬다면,
    // *매번* 이 타이머가 완료를 처리하게 되고, 그러면 시각적으로는 duration(1000ms)
    // 근처에 이미 다 끝난 페이지 전환이 여기 있던 여유분 500ms만큼 *추가로* 더 늦게야
    // 코드에 반영된다 — 정확히 "한 박자 쉬고" 증상과 들어맞는 크기다. `animationend`가
    // 뜨는지 여부와 무관하게 완료 시점을 우리가 정한 `duration`에 최대한 가깝게 못박기
    // 위해, 여유분을 500ms→80ms(이벤트 디스패치/스케줄링 지터를 흡수할 정도만)로
    // 줄였다 — `animationend`가 안 뜨는 기기에서도 이제 최대 80ms 안에는 확실히 끝난다.
    safetyTimer: setTimeout(finish, duration + 80),
  };
  return true;
}
