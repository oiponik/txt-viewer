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
//   - 2026-08-25 후속(목표각 91deg→180deg, 1차 시도 — 무효): 가로 모드 통일 후 사용자가
//     "90도에서 없애지 말고 180도까지 돌아야 한다"고 요청 — backface-visibility 때문에
//     화면상 결과는 동일하다고 설명했지만 그래도 180deg로 가져가기로 결정. 단순히 목표각만
//     바꾸면 "사라지는 지점"이 앞당겨지면서 번호 갱신 지연 버그가 재발할 거라 판단해서,
//     leaf 하나에 키프레임 94% 지점을 91deg(기존 "사라지는 지점")로 못박고 94%→100%
//     (180deg)는 안 보이는 채로 마저 돌게 설계했었다 — **그런데 이건 애초에 헛수고였다.**
//     leaf 자신에게 backface-visibility:hidden을 걸어둔 채로 그 leaf 하나를 통째로
//     0→180도 돌리는 구조에서는, leaf가 90도를 넘는 그 순간 목표각이 91이든 180이든
//     상관없이 leaf 자체가 무조건 안 보이게 된다(그게 backface-visibility:hidden의
//     정의 그 자체) — 즉 "90도에서 사라지는 것처럼 보인다"는 결과는 목표각과 무관하게
//     항상 똑같았다. 사용자가 180deg 적용 후에도 "여전히 90도 돌다가 없어진다"고
//     재신고한 게 당연한 결과였던 것 — 이 사실을 뒤늦게 깨닫고 아래 2차 시도로 교체.
//   - 2026-08-25 후속(2차 시도 — 앞/뒷면 분리): 진짜로 180도까지 뭔가 보이게 하려면
//     leaf 자체에 "뒷면"이 있어야 한다는 결론 — 흔한 "플립 카드" 기법대로, 회전하는
//     래퍼(leafCard) 안에 앞면(front, 넘어가는 페이지 내용, 로컬 rotateY 0)과 뒷면
//     (back, 종이 뒷면 느낌의 빈 패널, 로컬 rotateY 180deg 미리 걸어둠) 두 장을 겹쳐
//     넣었다. 카드가 90도를 넘는 순간 front의 유효 각도(카드+0)는 안 보이는 쪽으로,
//     back의 유효 각도(카드+180)는 정확히 그 순간 보이는 쪽으로 넘어가서 이음매 없이
//     서로 교대한다 — 카드가 180도에 다다르면 back이 정면으로 딱 보이면서 끝난다(실제
//     책장이 뒤집혀 뒷면이 평평하게 자리잡는 모습). 이러면 duration 전체가 다시
//     "무언가 보이는 구간"이 되므로, 1차 시도의 94%/91deg 키프레임 못박기 트릭 자체가
//     필요 없어졌다(안 보이는 꼬리 구간이 없으니 번호 갱신 지연 문제도 원천적으로
//     안 생긴다) — 키프레임을 0%/50%/100% 대칭 구조로 단순화했다. 자세한 설계는
//     styles.css의 키프레임 위 주석과 아래 buildPanelAnimation()의 leafCard 주석 참고.
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
//
// ⚠️ 2026-08-26 — 사용자가 보내준 실기기 화면 녹화(가로/2페이지 스프레드 모드)를
// ffmpeg로 프레임 단위 분석해서 남아있던 두 가지 문제를 재조사했다:
//   1) "90도에서 잠깐 멈췄다 넘어가는 느낌" — 실측(30fps 프레임별 픽셀 diff)으로 확정:
//      실제 화면에 보이는 회전은 duration(1000ms)의 30~40%만에 다 끝나고 나머지
//      60~70%는 완전히 정지 상태(연속 프레임 diff=0)로 남아있었다. 원인은
//      `leafCard.style.animation`에 걸었던 단일 `ease-in-out`이 CSS 스펙상 키프레임
//      구간(0→50%, 50→100%)마다 독립적으로 재적용되어, 50%(=90도) 지점에서
//      감속→재가속이 겹쳐버렸기 때문 — 이건 2026-08-25 세션에서 이미 진단만 해두고
//      못 고쳤던 것(CLAUDE.md 참고)인데, 이번에 실측 근거까지 확보하고 마저 고쳤다.
//      styles.css의 키프레임에 `animation-timing-function`을 스톱별로(0%: ease-in,
//      50%: ease-out) 직접 지정해서, 50% 지점에서 속도가 끊기지 않고 이어지는 하나의
//      연속된 ease-in-out 곡선이 되도록 했다 — `leafCard.style.animation`은 이제
//      전역 타이밍 함수 없이(사실상 무의미해져서 `linear`만 명시) duration만 건다.
//      부수 효과로, "보이는 회전"이 duration 전체에 훨씬 고르게 퍼지면서 애니메이션이
//      시각적으로 다 끝난 뒤에도 한참 조작이 막혀있던 "먹통" 체감(같은 세션에서 별도로
//      확인한, 완료 판정이 시각적 완료보다 한참 늦게 나는 문제)도 상당 부분 완화된다.
//   2) "회전축이 화면 가운데가 아니라 틀어져 보인다" — rotateY/scaleX/translateZ는
//      전부 세로 위치(Y)에 의존하지 않는 변환이라, 회전축 자체가 대각선으로 굽는 건
//      수학적으로 불가능하다는 걸 좌표 계산으로 재확인했다(실측 영상에서도 "대각선
//      기울어짐"으로 확정할 근거는 못 찾음). 대신 진짜 원인으로 지목한 것: 이 패널의
//      `perspective`에 `perspective-origin`을 따로 안 정해주면 기본값 50% 50% —
//      즉 **이 패널 자기 자신의 한가운데**가 소실점이 되는데, 이건 회전축(스파인
//      쪽 가장자리)에서 패널 폭의 절반만큼 떨어진, 화면 전체 기준으로는 책의 진짜
//      가운데(스파인)와 거리가 먼 지점이다(예: 오른쪽 패널의 자기중심은 화면 전체의
//      대략 75% 지점). 실제 책을 볼 때 눈은 펼쳐진 책 전체의 가운데(스파인)를 향하지
//      낱장 페이지 하나의 한가운데를 향하지 않는다 — 소실점이 회전축과 멀리 떨어져
//      있으면 "화면 중앙이 아니라 패널 옆 어딘가를 중심으로 도는" 인상을 준다.
//      **수정**: `perspective-origin`을 패널 자기중심이 아니라 `transform-origin`과
//      정확히 같은 가장자리(=스파인 쪽)로 맞춰서, 소실점 자체가 항상 책의 진짜
//      중앙(=회전축)에 오도록 했다 — 자세한 계산은 아래 buildPanelAnimation() 안
//      perspective-origin 설정부 주석 참고.
//   ⚠️ 검증 한계는 여전히 같다 — 이 환경은 실기기 렌더링을 직접 볼 방법이 없어서,
//   1)은 프레임별 diff 실측으로 강하게 뒷받침되지만 2)는 "소실점 위치가 원인일
//   가능성이 가장 크다"는 추론에 기반한 수정이다. 사용자가 실기기에서 다시 확인 필요.

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
  // next(다음 페이지): 왼쪽 가장자리(=책의 중앙, 스파인)를 축으로 회전.
  // prev(이전 페이지): 오른쪽 가장자리(=역시 스파인)를 축으로 회전.
  // sign을 leafCard 생성부보다 앞으로 끌어와서 perspective-origin 계산에도 쓴다 —
  // 아래 perspective-origin 주석 참고.
  const sign = direction === 'next' ? -1 : 1;

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
  // ⚠️ 2026-08-26 — "회전축이 화면 가운데가 아니라 틀어져 보인다" 재조사 후 수정.
  // rotateY/scaleX/translateZ는 전부 Y좌표(세로 위치)에 의존하지 않는 변환이라, 축
  // 자체(transform-origin 위치, 위 sign에 따라 카드의 왼쪽 또는 오른쪽 가장자리)는
  // 수학적으로 항상 완벽한 수직선으로 투영된다 — 즉 "대각선으로 삐뚤어진 선"이 되는
  // 건 아니다(실측 영상을 프레임 단위로 다시 확인해도 재현 안 됨). 다만
  // `perspective-origin`(소실점)을 지정 안 하면 기본값 50% 50% — 즉 **이 패널 자기
  // 자신의 한가운데**가 되는데, 패널 폭의 절반이 책 전체 폭 기준으로는 스파인에서
  // 한참 떨어진 지점이다(예: 오른쪽 패널의 자기중심은 화면 전체의 대략 75% 지점).
  // 실제 책을 볼 때 눈(카메라)은 펼쳐진 책 전체의 가운데(=스파인)를 향하지, 낱장
  // 페이지 하나의 한가운데를 향하지 않는다 — 소실점이 스파인이 아니라 패널 자기
  // 중심에 있으면, 회전이 "화면 중앙이 아니라 패널 옆쪽 어딘가를 중심으로 도는"
  // 인상을 준다(사용자가 "가운데 축이 틀어져 보인다"고 표현한 것과 정확히 들어맞는
  // 원인). **수정**: perspective-origin을 패널 자기중심이 아니라 transform-origin과
  // 같은 가장자리(=스파인 쪽)로 맞춰서, 소실점 자체가 항상 책의 진짜 중앙(회전축)에
  // 오도록 했다 — 실제 눈이 책의 가운데를 보고 있는 상태를 흉내낸다.
  perspectiveStage.style.perspectiveOrigin = sign < 0 ? '0% 50%' : '100% 50%';

  // ⚠️ 2026-08-26 — 위 [AXISDEBUG] 임시 로깅(이젠 제거됨)으로 실기기에서 직접 재본 결과
  // transform-origin 좌표 자체(hingeAbsX)는 스파인 중앙과 완벽히 일치했다(deltaFromSpine:
  // 0) — "축의 정적 위치"는 처음부터 문제가 아니었다. 그런데도 사용자가 "회전 도중에만"
  // 안 맞아 보인다고 확인해줘서 진짜 원인(회전 중 축 자체가 옆으로 밀리는 현상)을 찾아
  // 고쳤다 — styles.css의 키프레임 위 "5차 시도" 주석 참고 (translateZ가 rotateY보다
  // 안쪽(먼저 적용)에 있으면, 회전축 자기 자신도 translateZ→rotateY 합성 과정에서
  // 화면상 `28×sin(θ)`만큼 옆으로 밀려 보인다 — 90도 근처에서 최대).

  // 아래층 — 새로 드러날 페이지. 처음부터 제자리에 고정, 애니메이션 내내 움직이지 않는다.
  const base = buildPageElement(revealingText, revealingFooter, width, height);
  base.style.zIndex = '1';

  // 위층 — "뒤집히는 카드" 하나. 회전(rotateY 0→180)은 이 래퍼(leafCard) 혼자 담당하고,
  // 그 안에 앞면(front, 지금 보이던/넘어가는 페이지 내용)과 뒷면(back, 종이 뒷면처럼
  // 보이는 빈 패널) 두 장을 자식으로 겹쳐 넣는다 — 흔히 쓰는 "플립 카드" 기법이다.
  // ⚠️ 2026-08-25 이전엔 leaf 자신에 backface-visibility:hidden을 걸고 그 하나를
  // 0→180deg로 통째로 돌렸는데, 그러면 leaf 자신이 90도를 넘는 순간 통째로 안 보이게
  // 돼서 — 목표각을 91이든 180이든 뭘로 잡아도 화면상 결과가 "90도에서 사라짐"으로
  // 완전히 동일했다(사용자가 180deg 요청 후에도 "여전히 90도 돌다가 없어진다"고 재신고,
  // 당연한 결과였다 — backface-visibility:hidden은 원래 "90도 넘으면 무조건 안 보이게"
  // 하는 속성이라 목표각과 무관했다). 진짜 180도까지 뭔가 보이게 하려면 뒷면 자체가
  // 있어야 해서 이렇게 앞/뒷면 두 장으로 다시 만들었다.
  // 동작 원리: front는 카드 안에서 rotateY(0)(=카드와 같은 방향), back은 미리
  // rotateY(180deg) 돌려둔 채로 얹는다. 카드가 0→90도를 도는 동안은 front의 유효
  // 각도(카드+0)가 |값|<90이라 보이고 back의 유효 각도(카드+180)는 90을 넘어 안 보인다
  // — 카드가 90도를 넘는 순간 정확히 반대(front 숨음/back 보임)로 뒤바뀌어서, 하나가
  // 사라지는 바로 그 프레임에 다른 하나가 나타나는 이음매 없는 전환이 된다. 카드가
  // 180도에 다다르면 back의 유효 각도가 0이 되어 정면으로 딱 보이면서 끝난다 — 실제
  // 책장을 넘길 때 뒤집힌 종이의 뒷면이 평평하게 자리잡는 모습과 같은 그림이다.
  const leafCard = document.createElement('div');
  leafCard.className = 'portrait-flip-leaf-card';
  leafCard.style.position = 'absolute';
  leafCard.style.top = '0';
  leafCard.style.left = '0';
  leafCard.style.width = leavingWidth + 'px';
  leafCard.style.height = leavingHeight + 'px';
  leafCard.style.zIndex = '2';
  leafCard.style.transformStyle = 'preserve-3d';
  leafCard.style.willChange = 'transform';
  // next(다음 페이지): 왼쪽 가장자리를 축으로 왼쪽으로 접히듯 회전.
  // prev(이전 페이지): 오른쪽 가장자리를 축으로 오른쪽으로 접히듯 회전.
  // sign(부호) 하나만 다르고 나머지 로직은 완전히 동일해서, 두 방향이 항상 대칭이다 —
  // 가로 모드에서도 좌/우 패널 둘 다 이 부호를 그대로 따른다(패널별로 다른 축을 쓰지
  // 않는다 — "통일성" 요청에 맞춰 세로 모드와 완전히 같은 규칙을 그대로 재사용).
  // sign 자체는 위 perspectiveStage 생성부로 옮겨졌다(perspective-origin 계산에도
  // 필요해서) — 여기선 그 값을 그대로 재사용만 한다.
  leafCard.style.transformOrigin = sign < 0 ? 'left center' : 'right center';
  // 회전(rotateY 0→180, 중간(90도)에서 scaleX로 얇게 눌렸다 펴지는 압축 + translateZ로
  // 들어올렸다 내려놓는 입체감 + 그 타이밍에 짙어졌다 옅어지는 그림자)을 styles.css의
  // @keyframes 하나로 묶어뒀다 — 여전히 clip-path 없음, JS 매 프레임 갱신 없음.
  // ⚠️ 2026-08-26 — 예전엔 여기서 전역 `ease-in-out`을 지정했는데, CSS 스펙상 그러면
  // 0→50%, 50→100% 두 구간에 각각 독립적으로 다시 적용되어 50%(90도) 지점에서
  // 감속→재가속이 겹쳐 "잠깐 멈췄다 넘어가는" 스터터가 생겼다(실기기 영상을 프레임
  // 단위로 분석해서 확인 — CLAUDE.md 참고). 이제 각 키프레임 스톱(0%/50%)이 자기
  // 타이밍 함수(ease-in/ease-out)를 직접 갖고 있으므로, 여기 전역 값은 사실상 안 쓰인다
  // — `linear`를 넣어 의미 없는 기본값임을 명시.
  leafCard.style.animation = `portrait-flip-leaf-${direction} ${duration}ms linear`;

  // 앞면 — 기존 leaf가 하던 역할 그대로(넘어가는 페이지 내용). 카드 안에서 회전을
  // 더 얹지 않으므로(로컬 rotateY 0) 카드 각도가 곧 이 면의 유효 각도다.
  const front = buildPageElement(leavingText, leavingFooter, leavingWidth, leavingHeight);
  front.style.position = 'absolute';
  front.style.top = '0';
  front.style.left = '0';
  front.style.backfaceVisibility = 'hidden';
  front.style.webkitBackfaceVisibility = 'hidden';

  // 뒷면 — ⚠️ 2026-08-25 후속: 처음엔 실제 내용 없는 빈 패널(순수 장식)로 만들었었는데,
  // 사용자가 실기기에서 "안 보이던 면의 글자는 페이지에 자연스럽게 붙어있지 않고
  // 애니메이션이 끝난 뒤 뿅 하고 나타난다"고 지적 — 원인은 뒷면이 빈 패널이라 50%~100%
  // 구간 동안 화면엔 아무 내용 없는 판만 보이다가, 애니메이션이 끝나 오버레이가 걷히는
  // 순간에야 진짜 새 페이지(base)가 갑자기 드러났기 때문이었다. 그래서 뒷면도 base와
  // 똑같은 진짜 내용(revealingText/revealingFooter)으로 채웠다 — 로컬 rotateY(180deg)를
  // 이미 걸어뒀으므로, 카드 자신이 180도까지 다 돌면 180+180=360(=0)이 되어 **거울에
  // 비친 것처럼 뒤집히지 않고 정상 방향 그대로** 정면으로 보인다(카드 뒤집기 기법에서
  // 뒷면을 미리 180도 돌려두는 이유가 바로 이 "두 번 뒤집으면 원래대로" 상쇄 효과다).
  // 카드가 90도를 넘어서부터 180도에 다다르기까지, 뒷면의 유효 각도는 -90도(거의
  // 옆에서 봄)에서 매끄럽게 0도(정면)로 좁혀지므로, 진짜 새 페이지 내용이 회전하며
  // "펼쳐지듯" 자연스럽게 드러난다 — 끝나고 나서 갑자기 나타나는 게 아니라, 회전
  // 자체가 이미 그 내용을 보여주며 진행된다. 최종 상태(180도, 완전히 정면)가 밑에
  // 깔린 base와 내용·위치·크기 모두 동일해서, 애니메이션이 끝나고 오버레이가 걷혀도
  // 아무 변화 없이 이어진다(=이음매 없음).
  const back = buildPageElement(revealingText, revealingFooter, width, height);
  back.style.position = 'absolute';
  back.style.top = '0';
  back.style.left = '0';
  back.style.backfaceVisibility = 'hidden';
  back.style.webkitBackfaceVisibility = 'hidden';
  back.style.transform = 'rotateY(180deg)';

  leafCard.appendChild(front);
  leafCard.appendChild(back);

  perspectiveStage.appendChild(base);
  perspectiveStage.appendChild(leafCard);
  stage.appendChild(perspectiveStage);

  // ⚠️ 임시 디버그 로깅 (2026-08-25) — 임시 카드(base/front)의 footer가 실제로 어느 화면
  // 좌표에 그려지는지 직접 측정. js/reader.js의 [FOOTERDEBUG] 로깅과 짝을 이룬다.
  // debugLabel로 세로 모드("portrait")/가로 모드 좌우 패널("spread-left"/"spread-right")을
  // 구분한다. 원인 확인되면 이 로깅 전부 제거할 것.
  try {
    const baseFooter = base.querySelector('.page-footer');
    const frontFooter = front.querySelector('.page-footer');
    const stageRect = stage.getBoundingClientRect();
    const baseFooterRect = baseFooter ? baseFooter.getBoundingClientRect() : null;
    const frontFooterRect = frontFooter ? frontFooter.getBoundingClientRect() : null;
    console.log('[FOOTERDEBUG] overlay base+leaf footer @ start', debugLabel || '', JSON.stringify({
      t: Math.round(performance.now()),
      stageTop: Math.round(stageRect.top), stageBottom: Math.round(stageRect.bottom),
      baseFooterY: baseFooterRect ? Math.round(baseFooterRect.top) : null,
      baseFooterText: baseFooter ? baseFooter.textContent : null,
      leafFooterY: frontFooterRect ? Math.round(frontFooterRect.top) : null,
      leafFooterText: frontFooter ? frontFooter.textContent : null,
    }));
  } catch (err) { /* 진단용, 실패해도 애니메이션엔 영향 없음 */ }

  let finished = false;
  const handle = { leaf: leafCard, onAnimationEnd: null, safetyTimer: null };

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
    leafCard.removeEventListener('animationend', handle.onAnimationEnd);
    perspectiveStage.remove();
    onPanelDone();
  }

  function onAnimationEnd(e) {
    if (e.target !== leafCard || e.animationName !== `portrait-flip-leaf-${direction}`) return;
    finish();
  }
  handle.onAnimationEnd = onAnimationEnd;
  leafCard.addEventListener('animationend', onAnimationEnd);

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
