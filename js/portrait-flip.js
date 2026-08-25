// js/portrait-flip.js — 페이지 넘기기 애니메이션(원래는 세로/한 페이지 모드 전용이었지만,
// 2026-08-25에 가로/2페이지 스프레드 모드까지 확장했다 — 아래 "가로 모드 확장" 절 참고).
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
//   - 2026-08-25 수정(1차~2차): 키프레임/이징을 여러 번 조정해 "안 보이는 구간에 감속이
//     낭비되는" 문제와 "완료 판정이 시각적 완료보다 늦는" 문제를 좁혔다 — 자세한 수치는
//     styles.css의 키프레임 위 주석 참고.
//   - 2026-08-25 (footer 위치 점프 사가, 6~10차): 이 파일과는 별개로, 진짜 PageFlip
//     페이지의 footer가 애니메이션 카드와 다른 위치에 그려지는 버그를 여러 라운드에
//     걸쳐 쫓았다 — 최종 원인과 수정은 js/reader.js의 getActiveRealPageRect()/
//     swapRealPageForFlip() 위 주석과 styles.css의 .page-content/.page-footer 위
//     주석에 자세히 남아있다(요약: 실제 페이지 렌더링 시 라이브러리가 `display:block`을
//     인라인으로 강제해서 우리 CSS의 flex가 깨졌던 게 원인 — .page-content/.page-footer를
//     flex 대신 position:absolute로 바꿔서 라이브러리가 무슨 display 값을 강제하든
//     구조적으로 안 깨지게 고쳤다).
//   - 실제 DOM(.page 요소, createPageElements가 쓰는 것과 같은 구조)을 그대로 쓴다 —
//     캔버스나 이미지 스냅샷이 아니라서 폰트/렌더링이 항상 정확하고, 스냅샷 관련 위험
//     (예: 커스텀 웹폰트가 SVG foreignObject 안에서 깨지는 WebKit 특유의 버그)이 없다.
//   - ⚠️ 시각적으로 종이가 대각선으로 말리는 느낌(PC의 진짜 커얼)과는 다르다 — 세로축
//     중심으로 평평하게 회전하는 카드 뒤집기 느낌이다. 슬라이드보다는 훨씬 "진짜
//     애니메이션"에 가깝지만, PC와 완전히 동일한 모양은 아니라는 트레이드오프를 사용자도
//     인지하고 진행하기로 함.
//
// ⚠️ 가로(2페이지 스프레드) 모드 확장 (2026-08-25): 원래 이 파일은 세로 모드 전용이고
// 가로 모드는 원래부터 문제없던 StPageFlip의 flipNext()/flipPrev()를 그대로 썼다.
// 사용자가 "통일성 있게" 양쪽 모드가 똑같은 방식으로 넘어가길 원해서, 가로 모드도
// 이 파일의 rotateY 카드 뒤집기로 옮겼다. 이를 위해 기존 단일 패널 로직을
// buildPanelAnimation()으로 뽑아내고, playPortraitPageTurn()(세로, 항상 패널 1개)과
// playSpreadPageTurn()(가로, 패널 1~2개를 받을 수 있음)이 둘 다 이 헬퍼를 공유한다.
// 1차 시도로는 좌/우 두 패널을 동시에 대칭으로 돌렸는데, 실기기에서 확인한 사용자
// 피드백 — "양쪽 페이지가 같이 넘어가는데 이게 무슨 책 넘기는 효과야, 한쪽만
// 넘어가야지." — 실제 책처럼 방향에 맞는 한쪽만(다음=오른쪽, 이전=왼쪽) 도는 게 맞다는
// 뜻이라, 호출부(js/reader.js)에서 항상 패널을 1개만(방향에 맞는 쪽) 넘기도록
// 고쳤다 — 이 파일 자체는 여러 패널을 동시에 다룰 수 있는 능력을 그대로 유지한다
// (혹시 나중에 다시 여러 패널이 필요해지면 playSpreadPageTurn을 그대로 재사용 가능).
// ⚠️ 가로 모드는 지금까지 이 사가 내내 한 번도 버그가 없었던 코드라 — 이 확장은 순수하게
// 사용자가 요청한 "통일성"을 위한 것이지, 가로 모드에 어떤 문제가 있어서가 아니다.
// 실기기 검증 전까지는 회귀 위험을 안고 있는 새 코드로 취급할 것.

let activeAnimation = null; // 겹쳐 눌림 방지 — 진행 중인 패널 핸들 배열(1개=세로, 1~2개=가로). null이면 idle.

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
  for (const handle of activeAnimation) {
    clearTimeout(handle.safetyTimer);
    handle.leaf.removeEventListener('animationend', handle.onAnimationEnd);
  }
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

// 패널 하나(세로 모드에서는 페이지 전체, 가로 모드에서는 좌/우 절반 중 하나)의 leaf/base
// 카드를 만들고 애니메이션을 건다. `activeAnimation` 등록/해제는 호출자(playPortraitPageTurn/
// playSpreadPageTurn)가 맡는다 — 이 함수는 패널 하나의 DOM/애니메이션 생명주기만 다룬다.
// onPanelDone: 이 패널의 애니메이션이 끝나면(정상 종료든 safetyTimer든) 호출된다.
// 반환값: { leaf, onAnimationEnd, safetyTimer } — cancelPortraitFlip이 정리할 수 있도록.
function buildPanelAnimation({
  stage, width, height, direction, offsetTop, offsetLeft,
  leavingWidth, leavingHeight,
  leavingText, leavingFooter, revealingText, revealingFooter,
  duration, onPanelDone, debugLabel,
}) {
  const perspectiveStage = document.createElement('div');
  perspectiveStage.className = 'portrait-flip-stage';
  perspectiveStage.style.position = 'absolute';
  perspectiveStage.style.top = offsetTop + 'px';
  perspectiveStage.style.left = offsetLeft + 'px';
  perspectiveStage.style.width = width + 'px';
  perspectiveStage.style.height = height + 'px';
  perspectiveStage.style.zIndex = '20';
  perspectiveStage.style.pointerEvents = 'none';
  perspectiveStage.style.perspective = '1600px';

  // 아래층 — 새로 드러날 페이지. 처음부터 제자리에 고정, 애니메이션 내내 움직이지 않는다.
  const base = buildPageElement(revealingText, revealingFooter, width, height);
  base.style.zIndex = '1';

  // 위층 — 지금 보이던(넘어가는) 페이지. 이게 세로축을 중심으로 90도를 넘어 회전하면
  // backface-visibility:hidden 덕분에 뒷면(안 보이는 쪽)을 보게 되는 순간 시각적으로
  // "사라져서" 밑에 있던 base가 드러나는 것처럼 보인다. base와 다른 크기(leavingWidth/
  // leavingHeight)를 쓸 수 있다 — 서로 다른 실제 페이지 인스턴스가 다른 높이로 렌더링될
  // 수 있다는 게 footer 위치 점프 사가에서 실측으로 확인됐기 때문(js/reader.js의
  // getActiveRealPageRect 위 주석 참고).
  const leaf = buildPageElement(leavingText, leavingFooter, leavingWidth, leavingHeight);
  leaf.style.zIndex = '2';
  leaf.style.backfaceVisibility = 'hidden';
  leaf.style.webkitBackfaceVisibility = 'hidden';
  leaf.style.transformStyle = 'preserve-3d';
  leaf.style.willChange = 'transform';
  // next(다음 페이지): 왼쪽 가장자리를 축으로 왼쪽으로 접히듯 회전.
  // prev(이전 페이지): 오른쪽 가장자리를 축으로 오른쪽으로 접히듯 회전.
  // 부호(sign) 하나만 다르고 나머지 로직은 완전히 동일해서, 두 방향이 항상 대칭이다 —
  // 가로 모드에서도 좌/우 패널 둘 다 이 부호를 그대로 따른다(패널별로 다른 축을 쓰지
  // 않는다 — "통일성" 요청에 맞춰 세로 모드와 완전히 같은 규칙을 그대로 재사용).
  const sign = direction === 'next' ? -1 : 1;
  leaf.style.transformOrigin = sign < 0 ? 'left center' : 'right center';
  // 회전(rotateY) + 압축(scaleX, 접히는 쪽으로 살짝 눌려 종이가 휘어지는 느낌) + 들어올림
  // (translateZ, 입체감) + 동적 그림자를 전부 styles.css의 @keyframes 하나로 묶어뒀다.
  // 그래도 여전히 clip-path 없음, JS 매 프레임 갱신 없음 — 브라우저가 알아서 보간하는
  // 선언적 애니메이션인 건 그대로다. 키프레임의 100%가 rotateY 91deg(=화면에서 사라지는
  // 지점 바로 너머)에서 끝나서 duration 전체가 "보이는 구간"이다 — 자세한 튜닝 경위는
  // styles.css의 키프레임 위 주석 참고.
  leaf.style.animation = `portrait-flip-leaf-${direction} ${duration}ms ease-out`;

  perspectiveStage.appendChild(base);
  perspectiveStage.appendChild(leaf);
  stage.appendChild(perspectiveStage);

  // ⚠️ 임시 디버그 로깅 (2026-08-25) — 임시 카드(base/leaf)의 footer가 실제로 어느 화면
  // 좌표에 그려지는지 직접 측정. js/reader.js의 [FOOTERDEBUG] 로깅과 짝을 이룬다.
  // debugLabel로 세로 모드("portrait")/가로 모드 좌우 패널("spread-left"/"spread-right")을
  // 구분한다. 원인 확인되면 이 로깅 전부 제거할 것.
  try {
    const baseFooter = base.querySelector('.page-footer');
    const leafFooter = leaf.querySelector('.page-footer');
    const stageRect = stage.getBoundingClientRect();
    const baseFooterRect = baseFooter ? baseFooter.getBoundingClientRect() : null;
    const leafFooterRect = leafFooter ? leafFooter.getBoundingClientRect() : null;
    console.log('[FOOTERDEBUG] overlay base+leaf footer @ start', debugLabel || '', JSON.stringify({
      t: Math.round(performance.now()),
      stageTop: Math.round(stageRect.top), stageBottom: Math.round(stageRect.bottom),
      baseFooterY: baseFooterRect ? Math.round(baseFooterRect.top) : null,
      baseFooterText: baseFooter ? baseFooter.textContent : null,
      leafFooterY: leafFooterRect ? Math.round(leafFooterRect.top) : null,
      leafFooterText: leafFooter ? leafFooter.textContent : null,
    }));
  } catch (err) { /* 진단용, 실패해도 애니메이션엔 영향 없음 */ }

  let finished = false;
  const handle = { leaf, onAnimationEnd: null, safetyTimer: null };

  function finish() {
    if (finished) return;
    finished = true;
    try {
      const baseFooter = base.querySelector('.page-footer');
      const stageRect = stage.getBoundingClientRect();
      const baseFooterRect = baseFooter ? baseFooter.getBoundingClientRect() : null;
      console.log('[FOOTERDEBUG] overlay base footer @ removal', debugLabel || '', JSON.stringify({
        t: Math.round(performance.now()),
        stageTop: Math.round(stageRect.top), stageBottom: Math.round(stageRect.bottom),
        baseFooterY: baseFooterRect ? Math.round(baseFooterRect.top) : null,
        baseFooterText: baseFooter ? baseFooter.textContent : null,
      }));
    } catch (err) { /* 진단용, 실패해도 정리엔 영향 없음 */ }
    clearTimeout(handle.safetyTimer);
    leaf.removeEventListener('animationend', handle.onAnimationEnd);
    perspectiveStage.remove();
    onPanelDone();
  }

  function onAnimationEnd(e) {
    if (e.target !== leaf || e.animationName !== `portrait-flip-leaf-${direction}`) return;
    finish();
  }
  handle.onAnimationEnd = onAnimationEnd;
  leaf.addEventListener('animationend', onAnimationEnd);

  // ⚠️ 이 타이머는 원래 "탭이 백그라운드로 가는 등 드문 경우에만 발동하는 안전장치"로
  // 설계돼서 `duration + 500`이었는데, 이 프로젝트의 자동화 브라우저 환경(document.hidden)
  // 에서는 `animationend`가 원천적으로 절대 안 뜨고 항상 이 타이머가 완료를 처리한다는 걸
  // 알게 된 뒤 80ms로 줄였다 — 자세한 경위는 이 파일의 이전 히스토리(git log)와
  // CLAUDE.md 참고. `animationend`가 뜨든 안 뜨든 완료가 duration 근처에서 최대한
  // 못박히도록, 여유분은 이벤트 디스패치/스케줄링 지터를 흡수할 정도(80ms)로만 둔다.
  handle.safetyTimer = setTimeout(finish, duration + 80);
  return handle;
}

// 세로(한 페이지) 모드 전용 — direction: 'next' | 'prev'. stage는 오버레이를 붙일 기준
// 요소(#book-stage, position:relative 이미 걸려있음).
// offsetTop/offsetLeft/width/height: base(새로 드러날 페이지)와 오버레이 컨테이너 자체의
// 정확한 위치·크기 — 진짜 PageFlip 페이지가 지금 실제로 그려지는 자리를 그대로 잰 값이다
// (js/reader.js의 getActiveRealPageRect() 참고, 스왑 *이후* 측정 = TO 페이지 기준).
// leavingWidth/leavingHeight: leaf(넘어가는 옛 페이지) 전용 크기 — 생략하면 width/height와
// 같다고 가정하지만, **반드시 스왑 *이전*(FROM 페이지) 기준으로 별도로 재서 넘겨야 한다.**
// 반환값: 애니메이션을 실제로 시작했으면 true, 이미 진행 중이라 무시했으면 false.
export function playPortraitPageTurn({
  stage, width, height, direction, offsetTop = 0, offsetLeft = 0,
  leavingWidth, leavingHeight,
  leavingText, leavingFooter, revealingText, revealingFooter,
  duration = 1000, onDone,
}) {
  if (activeAnimation) return false;
  if (leavingWidth == null) leavingWidth = width;
  if (leavingHeight == null) leavingHeight = height;

  const handle = buildPanelAnimation({
    stage, width, height, direction, offsetTop, offsetLeft,
    leavingWidth, leavingHeight,
    leavingText, leavingFooter, revealingText, revealingFooter,
    duration, debugLabel: 'portrait',
    onPanelDone: () => {
      activeAnimation = null;
      onDone();
    },
  });
  activeAnimation = [handle];
  return true;
}

// 가로(2페이지 스프레드) 모드용 — 좌/우 패널을 동시에 각자 독립적으로 rotateY 카드
// 뒤집기로 회전시킨다. panels: [{side, width, height, offsetTop, offsetLeft, leavingWidth,
// leavingHeight, leavingText, leavingFooter, revealingText, revealingFooter}, ...] —
// 보통 2개(좌/우 다 있는 일반적인 스프레드)지만, 호출자가 한쪽만 넘기면(예: 왜 그런
// 상황이 생기는지는 reader.js 쪽에서 판단) 그 패널만 애니메이션한다.
// direction: 'next' | 'prev' — 모든 패널에 공통 적용(좌/우 패널이 서로 다른 축을 쓰지
// 않는다 — 위 buildPanelAnimation의 sign 관련 주석 참고, "통일성" 요청의 핵심).
// 반환값: 애니메이션을 실제로 시작했으면 true, 이미 진행 중이거나 패널이 하나도 없으면 false.
export function playSpreadPageTurn({ stage, direction, duration = 1000, onDone, panels }) {
  if (activeAnimation) return false;
  if (!panels || panels.length === 0) return false;

  const handles = [];
  let remaining = panels.length;
  function onPanelDone() {
    remaining -= 1;
    if (remaining === 0) {
      activeAnimation = null;
      onDone();
    }
  }

  for (const panel of panels) {
    const leavingWidth = panel.leavingWidth == null ? panel.width : panel.leavingWidth;
    const leavingHeight = panel.leavingHeight == null ? panel.height : panel.leavingHeight;
    handles.push(buildPanelAnimation({
      stage,
      width: panel.width, height: panel.height,
      offsetTop: panel.offsetTop, offsetLeft: panel.offsetLeft,
      leavingWidth, leavingHeight,
      direction,
      leavingText: panel.leavingText, leavingFooter: panel.leavingFooter,
      revealingText: panel.revealingText, revealingFooter: panel.revealingFooter,
      duration, debugLabel: 'spread-' + (panel.side || '?'),
      onPanelDone,
    }));
  }
  activeAnimation = handles;
  return true;
}
