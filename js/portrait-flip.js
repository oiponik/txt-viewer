// js/portrait-flip.js — 커스텀 페이지 넘김 애니메이션. 세로(1페이지) 모드와 가로
// (2페이지 스프레드) 모드 둘 다 이 파일이 담당한다.
//
// 방식: CSS 3D `perspective` + `rotateY` 카드 뒤집기 — clip-path나 매 프레임 JS 스타일
// 갱신은 전혀 안 쓴다. `leafCard.style.animation`을 한 번만 설정하고 나머지는 CSS
// `@keyframes`(styles.css의 portrait-flip-leaf-next/prev)가 브라우저 자체 보간으로
// 처리한다. 실제 `.page` DOM(createPageElements와 같은 구조)을 그대로 재사용하므로
// 폰트/렌더링이 항상 정확하고, 캔버스·이미지 스냅샷 특유의 위험(웹폰트 깨짐 등)이 없다.
//
// ⚠️ 이 방식에 이르기까지: StPageFlip 라이브러리의 clip-path+rotate 커얼을 라이브러리
// 자체 패치/순수 translate3d 이동/커얼 수학 자체 이식 등 세 가지 다른 구현으로
// 시도했으나, 이 자동화 테스트 환경에서는 매번 "검증됨"으로 나왔는데도 실기기에서는
// 계속 같은 종류의 렌더링 글리치가 재발했다 — 그래서 clip-path 기법 자체를 버리고
// 지금의 rotateY 카드 뒤집기로 완전히 새로 만들었다. 이후에도 여러 라운드의 실기기
// 피드백으로 다듬어졌다. 전체 조사 과정·각 라운드의 실측 방법은 CLAUDE.md 진행상황
// 메모에 날짜별로 남아있다 — 여기엔 "왜 지금 이 코드가 이렇게 생겼는지"만 남긴다.
//
// 핵심 설계:
//   - **뒤집기 카드(leafCard)는 앞/뒷면 두 장을 겹쳐서 만든다.** 카드 자신이 0→180deg
//     회전하는 동안, 로컬 rotateY(0)인 front(넘어가는 페이지)와 미리 rotateY(180deg)를
//     걸어둔 back(도착 페이지)이 90도 지점에서 정확히 교대한다 — backface-visibility:
//     hidden 요소 하나를 통째로 0→180 돌리면 90도부터는 그 요소 자체가 안 보이므로,
//     뒷면이 따로 있어야 180도까지 계속 뭔가 보인다. back도 실제 도착 페이지 내용을
//     담아야 한다(빈 패널이면 애니메이션이 끝난 뒤 내용이 "뿅" 나타나는 것처럼 보인다).
//   - **가로(스프레드) 모드에서 back의 콘텐츠는 반대쪽 패널의 목표(`landingText`/
//     `landingFooter`)를 담아야 한다** — leafCard 뒷면은 180도 회전으로 화면상 반대쪽
//     자리로 넘어가 앉기 때문(경첩 달린 문이 180도 열리면 반대편에 있는 것과 같은 3D
//     회전 수학). `base`(제자리 고정)는 항상 자기 쪽 목표(`revealingText`)를 보여준다.
//   - **그림자는 회전하는 카드가 아니라 별도의 평평한 레이어(`shadowLayer`)** — leafCard
//     자체에 box-shadow를 걸면 카드가 90도 근처에서 scaleX로 짜부라들 때 그림자도 같이
//     눌려 부자연스럽다.
//   - **perspective-origin은 패널 자기중심이 아니라 힌지(스파인) 쪽 가장자리**로 맞춘다
//     — 기본값(패널 중심)을 쓰면 소실점이 책의 실제 중심(스파인)에서 멀리 떨어져,
//     회전이 "화면 중앙이 아니라 옆쪽 어딘가를 축으로 도는" 것처럼 보인다.
//   - **키프레임의 각 스톱(0%/50%)이 자기 타이밍 함수(ease-in/ease-out)를 직접 갖는다**
//     — 전역으로 하나의 `ease-in-out`을 걸면 CSS 스펙상 각 구간(0→50%, 50→100%)에
//     독립적으로 재적용돼서 50%(=90도) 지점에서 감속→재가속이 겹쳐 "잠깐 멈췄다
//     넘어가는" 스터터가 생긴다.
//   - `safetyTimer`가 `animationend`보다 먼저(또는 대신) 완료를 처리할 수 있다 — 이
//     프로젝트의 자동화 브라우저 테스트 환경(document.hidden)에서는 `animationend`가
//     아예 안 뜨는 것으로 확인됐다. 실기기에서도 대비 차원으로 짧은 여유
//     (`duration+80ms`)를 둔다.
//   - 가로 모드는 좌/우 중 **방향에 맞는 한쪽 패널만** 애니메이션한다(다음=오른쪽,
//     이전=왼쪽, 실제 책처럼) — `playSpreadPageTurn` 자체는 여러 패널을 동시에 다룰 수
//     있는 능력을 유지한다. 애니메이션이 없는 반대쪽 패널은
//     `coverPanelWithLeavingContent()`로 예전 내용을 담은 정적 덮개를 얹어뒀다가
//     애니메이션이 끝나면 같이 치운다 — 그 밑에서 이미 조용히 바뀌어 있는 진짜 DOM이
//     이음매 없이 드러난다.

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
  // ⚠️ `.page`의 CSS 기본값은 `display:none`이다(page-window.js가 실제 책 페이지 중
  // 보여줄 것만 명시적으로 켜는 구조라서) — 이 함수가 만드는 base/front/back/덮개는 그
  // 관리 대상이 아닌 애니메이션 전용 임시 요소라, 여기서 직접 켜지 않으면 그 기본값을
  // 그대로 물려받아 안 보이게 된다.
  el.style.display = 'block';

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

// 가로 스프레드에서 애니메이션이 안 걸리는 반대쪽 패널(예: "다음"에서 왼쪽) 위에
// "예전 내용"을 담은 정적(회전·페이드 없음) 페이지 하나를 얹어둔다 — 실제 진짜 페이지
// 전환(swapRealPageForFlip, js/reader.js)은 애니메이션 시작 *전에* 스프레드 전체를
// 조용히 끝내놓으므로, 이 덮개가 없으면 반대쪽 패널이 클릭 즉시 새 내용으로 튀어
// 보인다. 애니메이션이 전부 끝나는 순간(호출자가 onDone 안에서) 같이 치운다 — 그러면
// 이미 새 내용으로 바뀌어 있던 진짜 DOM이 자연스럽게 드러난다.
export function coverPanelWithLeavingContent({ stage, offsetTop, offsetLeft, width, height, text, footer }) {
  const cover = buildPageElement(text, footer, width, height);
  cover.style.top = offsetTop + 'px';
  cover.style.left = offsetLeft + 'px';
  cover.style.zIndex = '20'; // 반대쪽 패널의 perspectiveStage(z-index 20)와 같은 층
  cover.style.pointerEvents = 'none'; // 애니메이션 중 이 자리로의 조작은 무시(다른 오버레이 조각들과 동일한 관례)
  stage.appendChild(cover);
  return cover;
}

// 넘어가는 면의 "아래쪽이 먼저 곡선으로 들린다" 세그먼트 peel 설정.
//   enabled=false   → 예전처럼 무변형 `.page` 한 장(순수 rotateY 카드 뒤집기).
//   strips          → 넘어가는 면을 가로로 몇 등분할지. 많을수록 곡선이 매끄럽지만
//                     동시 3D 레이어가 늘어 실기기 합성 비용↑.
//   stripDurationMs → 각 스트립의 곡선 델타 1회분 길이(leafCard 750ms와 별개, 더 짧게).
//                     짧을수록 시차(stagger) 예산이 늘어 곡선을 넘김 중반까지 끌고 갈 수 있다.
//   stepMs          → 이웃 스트립 사이 시차(아래 스트립이 먼저 시작).
//                     ⚠️ (strips-1)*stepMs + stripDurationMs ≤ leafCard duration(750) 유지 —
//                     안 그러면 맨 위 스트립이 leafCard가 rotateY(0)로 스냅되기 전에 델타를
//                     0으로 못 되돌려 플래시가 생긴다.
//   overlapPx       → 이웃 스트립을 몇 px 겹칠지(서브픽셀 반올림 hairline 틈 방지).
// 곡선 세기(peak 각도·translateZ 들림)는 styles.css의 @keyframes portrait-flip-strip-* 에서.
const STRIP_PEEL = { enabled: true, strips: 9, stripDurationMs: 540, stepMs: 24, overlapPx: 3 };

// 패널 하나(세로 모드에서는 페이지 전체, 가로 모드에서는 좌/우 절반 중 하나)의 leaf/base
// 카드를 만들고 애니메이션을 건다. `activeAnimation` 등록/해제는 호출자(playPortraitPageTurn/
// playSpreadPageTurn)가 맡는다 — 이 함수는 패널 하나의 DOM/애니메이션 생명주기만 다룬다.
// onPanelDone: 이 패널의 애니메이션이 끝나면(정상 종료든 safetyTimer든) 호출된다.
// 반환값: { leaf, onAnimationEnd, safetyTimer } — cancelPortraitFlip이 정리할 수 있도록.
function buildPanelAnimation({
  stage, width, height, direction, offsetTop, offsetLeft,
  leavingWidth, leavingHeight,
  leavingText, leavingFooter, revealingText, revealingFooter,
  // landingText/landingFooter: leafCard 뒷면(180도 돌았을 때 보이는 면) 전용 콘텐츠.
  // base(제자리 고정, 항상 revealingText)와 달리 뒷면은 회전으로 반대쪽 패널 자리에
  // 가서 앉으므로 다른 콘텐츠가 필요할 수 있다 — 가로 스프레드 모드는 반대쪽 패널의
  // 목표 페이지를 넘겨준다(js/reader.js의 buildSpreadPanels 참고). 세로(단일 페이지)
  // 모드는 "반대쪽 패널" 자체가 없으므로 기본값(revealingText와 동일)을 그대로 쓴다.
  landingText = revealingText, landingFooter = revealingFooter,
  duration, onPanelDone,
}) {
  // next(다음 페이지): 왼쪽 가장자리(=책의 중앙, 스파인)를 축으로 회전.
  // prev(이전 페이지): 오른쪽 가장자리(=역시 스파인)를 축으로 회전.
  // perspective-origin 계산에도 필요해서 leafCard 생성부보다 앞으로 끌어왔다.
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
  // 2026-08-27: 1600→2400→3600px. 넘어가는(스파인 반대) 쪽 가장자리가 카메라 쪽으로
  // 부풀어 확대돼 보인다는 피드백이 2400에서도 남아서 더 늘렸다(값이 클수록 평면투영에
  // 가까워져 원근 확대가 줄어든다). translateZ 들림 피크도 30→14→4px로 같이 줄임.
  perspectiveStage.style.perspective = '3600px';
  // perspective-origin(소실점)을 지정 안 하면 기본값 50% 50% — 즉 패널 자기 자신의
  // 한가운데가 되는데, 이건 회전축(스파인 쪽 가장자리)에서 패널 폭의 절반만큼 떨어진,
  // 화면 전체 기준으로는 책의 진짜 가운데(스파인)와 거리가 먼 지점이다. 실제 책을 볼
  // 때 눈은 펼쳐진 책 전체의 가운데(스파인)를 향하지 낱장 페이지 하나의 한가운데를
  // 향하지 않는다 — 그래서 perspective-origin을 transform-origin과 같은 가장자리
  // (=스파인 쪽)로 맞춰서, 소실점이 항상 책의 진짜 중앙(회전축)에 오도록 한다.
  perspectiveStage.style.perspectiveOrigin = sign < 0 ? '0% 50%' : '100% 50%';

  // 아래층 — 새로 드러날 페이지. 처음부터 제자리에 고정, 애니메이션 내내 움직이지 않는다.
  const base = buildPageElement(revealingText, revealingFooter, width, height);
  base.style.zIndex = '1';

  // 중간층 — 페이지 넘김 그림자, 회전 안 하는 평평한 레이어(위 "핵심 설계" 참고 — 실제
  // 그림자는 회전하는 카드가 아니라 그 밑에 깔린 고정된 표면 위에 드리워지는 것이라야
  // 자연스럽다). opacity만 styles.css의 `portrait-flip-shadow-fade` 키프레임
  // (0→1→0, leaf와 같은 타이밍)으로 움직인다 — 그라디언트 방향(스파인 쪽이 짙고
  // 바깥쪽으로 옅어짐)만 방향별로 여기서 인라인으로 넣는다.
  const shadowLayer = document.createElement('div');
  shadowLayer.className = 'portrait-flip-shadow-layer';
  shadowLayer.style.position = 'absolute';
  shadowLayer.style.top = '0';
  shadowLayer.style.left = '0';
  shadowLayer.style.width = width + 'px';
  shadowLayer.style.height = height + 'px';
  shadowLayer.style.zIndex = '2';
  shadowLayer.style.pointerEvents = 'none';
  shadowLayer.style.background = sign < 0
    ? 'linear-gradient(to right, rgba(0,0,0,0.45), rgba(0,0,0,0) 140px)'
    : 'linear-gradient(to left, rgba(0,0,0,0.45), rgba(0,0,0,0) 140px)';
  shadowLayer.style.animation = `portrait-flip-shadow-fade ${duration}ms linear`;

  // 위층 — "뒤집히는 카드" 하나. 회전(rotateY 0→180)은 이 래퍼(leafCard) 혼자 담당하고,
  // 그 안에 앞면(front, 지금 보이던/넘어가는 페이지 내용)과 뒷면(back, 도착 페이지
  // 내용) 두 장을 자식으로 겹쳐 넣는다 — 흔히 쓰는 "플립 카드" 기법이다. front는 카드
  // 안에서 rotateY(0), back은 미리 rotateY(180deg) 돌려둔 채로 얹는다. 카드가 0→90도를
  // 도는 동안은 front의 유효 각도(카드+0)가 |값|<90이라 보이고 back의 유효 각도
  // (카드+180)는 90을 넘어 안 보인다 — 카드가 90도를 넘는 순간 정확히 반대로 뒤바뀌어서
  // 이음매 없는 전환이 된다. 카드가 180도에 다다르면 back의 유효 각도가 0이 되어
  // 정면으로 딱 보이면서 끝난다 — 실제 책장을 넘길 때 뒤집힌 종이의 뒷면이 평평하게
  // 자리잡는 모습과 같은 그림이다.
  const leafCard = document.createElement('div');
  leafCard.className = 'portrait-flip-leaf-card';
  leafCard.style.position = 'absolute';
  leafCard.style.top = '0';
  leafCard.style.left = '0';
  leafCard.style.width = leavingWidth + 'px';
  leafCard.style.height = leavingHeight + 'px';
  leafCard.style.zIndex = '3'; // shadowLayer(z-index 2)보다 위 — 카드가 안 덮은 구간에만 그림자가 비쳐 보인다.
  leafCard.style.transformStyle = 'preserve-3d';
  leafCard.style.willChange = 'transform';
  // sign 하나만 다르고 나머지 로직은 완전히 동일해서, 다음/이전 두 방향이 항상
  // 대칭이다 — 가로 모드에서도 좌/우 패널 둘 다 이 부호를 그대로 따른다(패널별로
  // 다른 축을 쓰지 않는다).
  leafCard.style.transformOrigin = sign < 0 ? 'left center' : 'right center';
  // 회전(rotateY 0→180, 중간(90도)에서 scaleX로 얇게 눌렸다 펴지는 압축 + translateZ로
  // 들어올렸다 내려놓는 입체감 + 그 타이밍에 짙어졌다 옅어지는 그림자)을 styles.css의
  // @keyframes 하나로 묶어뒀다 — 여전히 clip-path 없음, JS 매 프레임 갱신 없음.
  // 여기서는 `linear`만 명시한다 — 실제 감속/가속은 키프레임의 각 스톱이 직접 갖는
  // `animation-timing-function`이 담당한다(위 "핵심 설계" 참고, 전역 이징을 쓰면
  // 50% 지점에서 감속→재가속이 겹치는 문제가 있었다).
  leafCard.style.animation = `portrait-flip-leaf-${direction} ${duration}ms linear`;

  // 넘어가는 면 — 예전엔 무변형 `.page` 한 장(`front`)이었다. 지금은 세로로 N등분한
  // 스트립 여러 장으로 나눠서, 각 스트립이 전부 같은 직선 스파인(x=0)을 힌지로 순수
  // rotateY를 하되 **아래 스트립부터 먼저**(animation-delay 시차) 조금 더 앞서 돌게
  // 한다 — 넘김 초반에 페이지 아래쪽이 먼저 곡선으로 들리고 그 말림이 위로 쓸려
  // 올라간다. 스파인축은 모든 스트립이 x=0을 공유하므로 곧은 수직 직선 그대로다
  // (E안 실패 = leafCard 자체를 기울여 축까지 휘었음 / F·B·모서리안 실패 = front 한
  // 겹만 변형해 다른 레이어와 어긋나 잘림 — 둘 다 피한다: 스트립은 leafCard
  // (preserve-3d)의 직계 형제라 중첩 preserve-3d가 없고, 각 스트립은 rigid하게 회전만
  // 한다). 곡선 각도/등분수/시차는 styles.css의 @keyframes portrait-flip-strip-* 와
  // 위 STRIP_PEEL 에서 튜닝. STRIP_PEEL.enabled=false면 예전처럼 무변형 한 장.
  const leafFaces = [];
  if (STRIP_PEEL.enabled) {
    const n = STRIP_PEEL.strips;
    const rowH = leavingHeight / n;
    for (let k = 0; k < n; k++) {
      const strip = document.createElement('div');
      strip.className = 'portrait-flip-strip';
      strip.style.position = 'absolute';
      strip.style.left = '0';
      strip.style.top = (k * rowH) + 'px';
      strip.style.width = leavingWidth + 'px';
      // 아래 이웃과 몇 px 겹쳐 서브픽셀 반올림 hairline 틈을 막는다 — 겹치는 구간은
      // 두 스트립이 똑같은 픽셀을 그리므로(둘 다 같은 통짜 복사본의 창) 평상시엔 안 보인다.
      strip.style.height = (rowH + (k < n - 1 ? STRIP_PEEL.overlapPx : 0)) + 'px';
      strip.style.overflow = 'hidden';
      strip.style.backfaceVisibility = 'hidden';
      strip.style.webkitBackfaceVisibility = 'hidden';
      strip.style.transformOrigin = sign < 0 ? 'left center' : 'right center';
      // 아래 스트립(k = n-1)이 delay 0으로 제일 먼저, 위로 갈수록 늦게 시작.
      const delay = (n - 1 - k) * STRIP_PEEL.stepMs;
      strip.style.animation = `portrait-flip-strip-${direction} ${STRIP_PEEL.stripDurationMs}ms linear ${delay}ms both`;

      // 페이지 통짜 복사본을 위로 밀어 이 스트립 몫의 가로 밴드만 창처럼 보이게 한다
      // (clip-path 아님 — 순수 overflow:hidden). 복사본은 k와 무관하게 항상 leafCard
      // 좌표에 정렬된다(strip top = k*rowH, 복사본 top = -k*rowH 이므로 상쇄).
      const copy = buildPageElement(leavingText, leavingFooter, leavingWidth, leavingHeight);
      copy.style.top = (-k * rowH) + 'px';
      strip.appendChild(copy);
      leafFaces.push(strip);
    }
  } else {
    const front = buildPageElement(leavingText, leavingFooter, leavingWidth, leavingHeight);
    front.style.position = 'absolute';
    front.style.top = '0';
    front.style.left = '0';
    front.style.backfaceVisibility = 'hidden';
    front.style.webkitBackfaceVisibility = 'hidden';
    leafFaces.push(front);
  }

  // 뒷면 — 실제 도착 페이지 내용(landingText/landingFooter)을 담는다. 로컬
  // rotateY(180deg)를 이미 걸어뒀으므로, 카드 자신이 180도까지 다 돌면 180+180=360
  // (=0)이 되어 거울에 비친 것처럼 뒤집히지 않고 정상 방향 그대로 정면으로 보인다
  // (카드 뒤집기 기법에서 뒷면을 미리 180도 돌려두는 이유가 이 "두 번 뒤집으면
  // 원래대로" 상쇄 효과다).
  const back = buildPageElement(landingText, landingFooter, width, height);
  back.style.position = 'absolute';
  back.style.top = '0';
  back.style.left = '0';
  back.style.backfaceVisibility = 'hidden';
  back.style.webkitBackfaceVisibility = 'hidden';
  back.style.transform = 'rotateY(180deg)';

  for (const face of leafFaces) leafCard.appendChild(face);
  leafCard.appendChild(back);

  perspectiveStage.appendChild(base);
  perspectiveStage.appendChild(shadowLayer);
  perspectiveStage.appendChild(leafCard);
  stage.appendChild(perspectiveStage);

  let finished = false;
  const handle = { leaf: leafCard, onAnimationEnd: null, safetyTimer: null };

  function finish() {
    if (finished) return;
    finished = true;
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

  // 이 타이머는 원래 "탭이 백그라운드로 가는 등 드문 경우에만 발동하는 안전장치"였는데,
  // 이 프로젝트의 자동화 브라우저 테스트 환경(document.hidden)에서는 `animationend`가
  // 원천적으로 절대 안 뜨고 항상 이 타이머가 완료를 처리한다는 게 확인돼서 여유를
  // 80ms로 줄였다 — `animationend`가 뜨든 안 뜨든 완료가 duration 근처에서 최대한
  // 못박히도록, 이벤트 디스패치/스케줄링 지터를 흡수할 정도만 남긴 것이다.
  handle.safetyTimer = setTimeout(finish, duration + 80);
  return handle;
}

// 세로(한 페이지) 모드 전용 — direction: 'next' | 'prev'. stage는 오버레이를 붙일 기준
// 요소(#book-stage, position:relative 이미 걸려있음).
// offsetTop/offsetLeft/width/height: base(새로 드러날 페이지)와 오버레이 컨테이너 자체의
// 정확한 위치·크기 — 진짜 페이지가 지금 실제로 그려지는 자리를 그대로 잰 값이다
// (js/reader.js의 getActiveRealPageRect() 참고, 스왑 *이후* 측정 = TO 페이지 기준).
// leavingWidth/leavingHeight: leaf(넘어가는 옛 페이지) 전용 크기 — 생략하면 width/height와
// 같다고 가정하지만, **반드시 스왑 *이전*(FROM 페이지) 기준으로 별도로 재서 넘겨야 한다.**
// 반환값: 애니메이션을 실제로 시작했으면 true, 이미 진행 중이라 무시했으면 false.
export function playPortraitPageTurn({
  stage, width, height, direction, offsetTop = 0, offsetLeft = 0,
  leavingWidth, leavingHeight,
  leavingText, leavingFooter, revealingText, revealingFooter,
  // 2026-08-27: 1000→750ms. "더 자연스럽게" 튜닝 패스 — 1초는 반복해서 읽기엔 굼떴다.
  // reader.js는 duration을 명시적으로 안 넘기므로 이 기본값이 세로/가로 모두에 적용된다.
  duration = 750, onDone,
}) {
  if (activeAnimation) return false;
  if (leavingWidth == null) leavingWidth = width;
  if (leavingHeight == null) leavingHeight = height;

  const handle = buildPanelAnimation({
    stage, width, height, direction, offsetTop, offsetLeft,
    leavingWidth, leavingHeight,
    leavingText, leavingFooter, revealingText, revealingFooter,
    duration,
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
// 호출자(js/reader.js)가 실제로는 방향에 맞는 한쪽 패널만 넘긴다(실제 책처럼 다음=오른쪽,
// 이전=왼쪽만 넘어가야 하므로) — 이 함수 자체는 여러 패널을 동시에 다룰 수 있는 능력을
// 그대로 유지한다(나중에 다시 필요해지면 재사용 가능).
// direction: 'next' | 'prev' — 모든 패널에 공통 적용(좌/우 패널이 서로 다른 축을 쓰지 않는다).
// 반환값: 애니메이션을 실제로 시작했으면 true, 이미 진행 중이거나 패널이 하나도 없으면 false.
export function playSpreadPageTurn({ stage, direction, duration = 750, onDone, panels }) {
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
      landingText: panel.landingText, landingFooter: panel.landingFooter,
      duration,
      onPanelDone,
    }));
  }
  activeAnimation = handles;
  return true;
}
