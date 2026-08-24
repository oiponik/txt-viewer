// js/portrait-flip.js — 세로(모바일, 한 페이지) 모드 전용 페이지 넘기기 애니메이션.
//
// ⚠️ 이 파일의 역사(중요, 다시 손댈 때 꼭 읽을 것):
// 예전 버전은 StPageFlip(js/vendor/page-flip.browser.js)의 세로 모드를 썼는데, 그건
// "2페이지 스프레드 중 왼쪽 페이지를 화면 밖으로 숨겨서 1페이지처럼 보이게" 만드는
// 방식이었다. 그 "숨겨진 절반" 좌표계 안에서 backward(이전 페이지) 커얼 애니메이션은
// 2026-08-18~24 사이 총 9라운드에 걸쳐 라이브러리 자체를 패치했는데도(git 이력 참고)
// 실기기 화면 녹화로 재현하면 이전 페이지 글자와 새 페이지 글자가 겹쳐 보이는 버그가
// 계속 남아있었고, 결국 "브라우저 렌더링/합성 단계 결함으로 추정"이라는 결론과 함께
// StPageFlip을 아예 버리고 순수 translate3d 밀기 방식으로 완전히 갈아탔었다(이전 버전).
//
// 그런데 실제로 원본 StPageFlip 소스(FlipCalculation.ts 등)를 다시 뜯어보니, 커얼의
// 기하학 계산 자체는 원래도 완전히 "페이지 한 장짜리" 로컬 좌표계(0..pageWidth,
// 0..pageHeight) 안에서만 동작했다 — 버그의 진짜 원인은 그 로컬 좌표를 "2배 너비
// boundsRect(rect.width = pageWidth*2, 항상 이 값)" 안의 올바른(숨겨지지 않은) 절반에
// 매핑하는 상위 레이어(Render.convertToGlobal, HTMLRender의 그림자 함수들)가 BACK
// 방향일 때 "boundsRect의 왼쪽 절반"(landscape에선 진짜 왼쪽 페이지라 맞지만, portrait
// 에선 화면 밖으로 치워둔 안 쓰는 칸)을 목적지로 미러링했기 때문이었다. FORWARD 방향은
// 우연히 항상 "오른쪽(보이는) 절반"만 썼어서 문제가 없었던 것뿐.
//
// 그래서 이번엔 그 "2배 너비 boundsRect + 숨긴 절반" 개념 자체를 아예 없앤, 진짜
// 페이지 한 장 너비(pageWidth = 이 뷰의 실제 폭)짜리 독립 컨테이너를 새로 만들고, 그
// 안에서 원본 라이브러리의 커얼 수학(FlipCalculation의 각도/클립영역 계산,
// HTMLPage.drawSoft의 clip-path+rotate 조합)을 최대한 충실하게 그대로 이식했다 —
// "항상 FORWARD 공식만 쓰는" 예전의 임시방편적 패치가 아니라, BACK 방향의 원본
// 미러링 공식도 그대로 살렸다(landscape에서 이미 검증된 그대로). 유일한 구조적 차이는
// "숨겨진 두 번째 슬롯이 아예 없다"는 것뿐이라, 좌표가 엉뚱한(화면 밖) 곳을 가리킬
// 방법 자체가 없어졌다.
//
// - 그림자는 원본의 정교한 다각형 그림자 계산 대신, flippingPage와 정확히 같은
//   clip-path/transform을 재사용하는 단순 그라데이션 오버레이로 근사했다 — 텍스트가
//   겹쳐 보이던 버그는 항상 "페이지 내용물"의 클립/좌표 문제였지 그림자 문제가 아니었기
//   때문에, 가장 위험한(버그가 있었던) 부분에는 원본 수학을 충실히 이식하고, 위험이
//   적은 장식 요소는 단순화해서 전체 구현 리스크를 낮췄다.
// - 코너는 항상 TOP 하나만 쓴다 — StPageFlip 자체도 pageFlip.flipNext()/flipPrev()를
//   코너 인자 없이 부르면 기본값이 FlipCorner.TOP이라, 이 앱(reader.js)이 실제로 쓰던
//   것과 동일하다. BOTTOM 코너 전용 분기는 아예 이식하지 않았다(안 쓰이므로).
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

// ── 기하학 헬퍼 (StPageFlip의 src/Helper.ts를 그대로 이식) ──────────────────────

function rotatePoint(transformedPoint, startPoint, angle) {
  return {
    x: transformedPoint.x * Math.cos(angle) + transformedPoint.y * Math.sin(angle) + startPoint.x,
    y: transformedPoint.y * Math.cos(angle) - transformedPoint.x * Math.sin(angle) + startPoint.y,
  };
}

function distanceBetween(p1, p2) {
  if (p1 === null || p2 === null) return Infinity;
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

function angleBetweenLines(line1, line2) {
  const A1 = line1[0].y - line1[1].y;
  const A2 = line2[0].y - line2[1].y;
  const B1 = line1[1].x - line1[0].x;
  const B2 = line2[1].x - line2[0].x;
  const cos = (A1 * A2 + B1 * B2) / (Math.sqrt(A1 * A1 + B1 * B1) * Math.sqrt(A2 * A2 + B2 * B2));
  return Math.acos(Math.min(1, Math.max(-1, cos)));
}

function pointInRect(rect, pos) {
  if (pos === null) return null;
  if (
    pos.x >= rect.left && pos.x <= rect.width + rect.left &&
    pos.y >= rect.top && pos.y <= rect.top + rect.height
  ) {
    return pos;
  }
  return null;
}

// limitedPoint가 startPoint 중심, radius 반지름인 원 밖에 있으면 원과의 교점으로 당겨온다.
function limitPointToCircle(startPoint, radius, limitedPoint) {
  if (distanceBetween(startPoint, limitedPoint) <= radius) return limitedPoint;

  const a = startPoint.x, b = startPoint.y, n = limitedPoint.x, m = limitedPoint.y;
  let x = Math.sqrt((radius * radius * Math.pow(a - n, 2)) / (Math.pow(a - n, 2) + Math.pow(b - m, 2))) + a;
  if (limitedPoint.x < 0) x *= -1;
  let y = ((x - a) * (b - m)) / (a - n) + b;
  if (a - n + b === 0) y = radius;
  return { x, y };
}

// 두 직선의 교점, rectBorder 안에 있을 때만 반환(없으면 null).
function intersectInRect(rectBorder, one, two) {
  const A1 = one[0].y - one[1].y, A2 = two[0].y - two[1].y;
  const B1 = one[1].x - one[0].x, B2 = two[1].x - two[0].x;
  const C1 = one[0].x * one[1].y - one[1].x * one[0].y;
  const C2 = two[0].x * two[1].y - two[1].x * two[0].y;
  const denomX = A1 * B2 - A2 * B1;
  const x = -((C1 * B2 - C2 * B1) / denomX);
  const y = -((A1 * C2 - A2 * C1) / denomX);
  if (!isFinite(x) || !isFinite(y)) return null;
  return pointInRect(rectBorder, { x, y });
}

// ── 페이지 로컬 좌표계(0..pageWidth, 0..pageHeight)의 커얼 계산 — FlipCalculation.ts 이식,
//    코너는 항상 TOP. direction: 'next'(FORWARD) | 'prev'(BACK). ─────────────────────

function calculateAngle(pos, pageWidth) {
  const left = pageWidth - pos.x + 1;
  const top = pos.y; // corner === TOP
  let angle = 2 * Math.acos(Math.min(1, Math.max(-1, left / Math.sqrt(top * top + left * left))));
  if (top < 0) angle = -angle;
  return angle;
}

function getPageRect(localPos, angle, pageWidth, pageHeight) {
  const base = [
    { x: 0, y: 0 },
    { x: pageWidth, y: 0 },
    { x: 0, y: pageHeight },
    { x: pageWidth, y: pageHeight },
  ];
  return {
    topLeft: rotatePoint(base[0], localPos, angle),
    topRight: rotatePoint(base[1], localPos, angle),
    bottomLeft: rotatePoint(base[2], localPos, angle),
    bottomRight: rotatePoint(base[3], localPos, angle),
  };
}

// 주어진 로컬 위치(코너 드래그 지점)에서 각도/사각형/교점을 전부 계산한다.
// 실패(기하학적으로 너무 작은 지점 등)하면 null.
function calcFlipGeometry(pos, pageWidth, pageHeight) {
  let angle = calculateAngle(pos, pageWidth);
  let rect = getPageRect(pos, angle, pageWidth, pageHeight);

  function recompute(p) {
    angle = calculateAngle(p, pageWidth);
    rect = getPageRect(p, angle, pageWidth, pageHeight);
  }

  // checkPositionAtCenterLine(pos, {0,0}, {0,pageHeight}) — corner TOP 분기
  let result = pos;
  const tmp = limitPointToCircle({ x: 0, y: 0 }, pageWidth, result);
  if (tmp !== result) { result = tmp; recompute(result); }

  const rad = Math.hypot(pageWidth, pageHeight);
  const checkPointOne = rect.bottomRight;
  const checkPointTwo = rect.topLeft;
  if (checkPointOne.x <= 0) {
    const bottomPoint = limitPointToCircle({ x: 0, y: pageHeight }, rad, checkPointTwo);
    if (bottomPoint !== result) { result = bottomPoint; recompute(result); }
  }

  if (Math.abs(result.x - pageWidth) < 1 && Math.abs(result.y) < 1) return null;

  const position = result;
  const boundRect = { left: -1, top: -1, width: pageWidth + 2, height: pageHeight + 2 };

  const topIntersect = intersectInRect(boundRect, [position, rect.topRight], [{ x: 0, y: 0 }, { x: pageWidth, y: 0 }]);
  const sideIntersect = intersectInRect(boundRect, [position, rect.bottomLeft], [{ x: pageWidth, y: 0 }, { x: pageWidth, y: pageHeight }]);
  const bottomIntersect = intersectInRect(boundRect, [rect.bottomLeft, rect.bottomRight], [{ x: 0, y: pageHeight }, { x: pageWidth, y: pageHeight }]);

  return { angle, rect, position, topIntersect, sideIntersect, bottomIntersect };
}

function getFlippingClipArea(geo) {
  const { rect, topIntersect, sideIntersect, bottomIntersect } = geo;
  const result = [rect.topLeft, topIntersect];
  let clipBottom = false;
  if (sideIntersect === null) {
    clipBottom = true;
  } else {
    result.push(sideIntersect);
    if (bottomIntersect === null) clipBottom = false;
  }
  result.push(bottomIntersect);
  if (clipBottom) result.push(rect.bottomLeft);
  return result;
}

function getBottomClipArea(geo, pageWidth, pageHeight) {
  const { topIntersect, sideIntersect, bottomIntersect } = geo;
  const result = [topIntersect, { x: pageWidth, y: 0 }];
  if (sideIntersect !== null) {
    if (distanceBetween(sideIntersect, topIntersect) >= 10) result.push(sideIntersect);
  } else {
    result.push({ x: pageWidth, y: pageHeight });
  }
  result.push(bottomIntersect);
  result.push(topIntersect);
  return result;
}

function getShadowAngle(geo, direction, pageWidth) {
  const { topIntersect, sideIntersect, bottomIntersect } = geo;
  const second = (topIntersect !== sideIntersect && sideIntersect !== null) ? sideIntersect : bottomIntersect;
  const angle = angleBetweenLines([topIntersect, second], [{ x: 0, y: 0 }, { x: pageWidth, y: 0 }]);
  return direction === 'next' ? angle : Math.PI - angle;
}

// HTMLPage.drawSoft() 이식 — area(점 배열, null 섞여 있을 수 있음)를 position 기준
// 상대좌표로 옮기고 angle만큼 미리 돌린 뒤 clip-path 다각형 문자열을 만든다. direction이
// 'prev'(BACK)이면 x를 미러링한다 — landscape에서 이미 검증된 원본 그대로.
function clipPathAndTransform(area, position, angleRad, direction) {
  const pts = [];
  for (const p of area) {
    if (p === null) continue;
    let g = direction === 'prev'
      ? { x: -p.x + position.x, y: p.y - position.y }
      : { x: p.x - position.x, y: p.y - position.y };
    g = rotatePoint(g, { x: 0, y: 0 }, angleRad);
    pts.push(`${g.x}px ${g.y}px`);
  }
  return {
    clipPath: `polygon(${pts.join(', ')})`,
    transform: `translate3d(${position.x}px, ${position.y}px, 0) rotate(${angleRad}rad)`,
  };
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
  el.style.transformOrigin = '0 0';

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

function buildShadowElement(zIndex) {
  const el = document.createElement('div');
  el.style.position = 'absolute';
  el.style.top = '0';
  el.style.left = '0';
  el.style.transformOrigin = '0 0';
  el.style.zIndex = String(zIndex);
  el.style.pointerEvents = 'none';
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

  const pageWidth = width;
  const pageHeight = height;

  const overlay = document.createElement('div');
  overlay.className = 'portrait-flip-overlay';
  overlay.style.position = 'absolute';
  overlay.style.inset = '0';
  overlay.style.overflow = 'hidden';
  overlay.style.zIndex = '20';
  overlay.style.pointerEvents = 'none';

  // 맨 아래: 고정된 배경 레이어(정적, 클립 없음) — 원본 라이브러리의 drawRightPage()와
  // 같은 역할. flipArea/botArea 두 다각형은 애니메이션 초반에는 페이지의 극히 일부만
  // 덮고(fold가 아직 코너 근처라서), 나머지 대부분은 이 배경이 그대로 보여준다. 그
  // "아직 안 넘어간 대부분의 영역"은 시각적으로 여전히 leaving 페이지여야 하므로(막
  // 넘기기 시작한 시점엔 거의 전부 원래 페이지 그대로 보여야 정상), revealing이 아니라
  // leaving 페이지를 깐다 — bottomLayer(아래)가 자기 클립이 넓어지는 만큼 그 위에서
  // revealing 내용으로 뚫고 들어오면서 "드러나는" 부분만 교체한다.
  const background = buildPageElement(leavingText, leavingFooter, pageWidth, pageHeight);
  background.style.zIndex = '0';

  // 아래층 — 새로 드러날 페이지. 이미 펼쳐진 부분만큼만 클립되어 매 프레임 넓어진다.
  const bottomLayer = buildPageElement(revealingText, revealingFooter, pageWidth, pageHeight);
  bottomLayer.style.zIndex = '1';

  // 안쪽(inner) 그림자 — 방금 드러난 페이지 위, 접히는 선 근처를 살짝 어둡게. flippingPage와
  // 정확히 같은 클립/변형을 재사용해서 모양이 항상 일치하도록 보장한다.
  const innerShadow = buildShadowElement(2);

  // 위층 — 지금 보이던(넘어가는) 페이지. 매 프레임 클립+회전되며 종이가 말리는 것처럼 보인다.
  const flippingLayer = buildPageElement(leavingText, leavingFooter, pageWidth, pageHeight);
  flippingLayer.style.zIndex = '3';

  // 바깥쪽(outer) 그림자 — 말리는 페이지 자신의 뒷면 쪽을 살짝 어둡게, flippingPage 위에.
  const outerShadow = buildShadowElement(4);

  overlay.appendChild(background);
  overlay.appendChild(bottomLayer);
  overlay.appendChild(innerShadow);
  overlay.appendChild(flippingLayer);
  overlay.appendChild(outerShadow);
  stage.appendChild(overlay);

  // Flip.flip()의 드래그 경로: 코너는 항상 TOP, 오른쪽 위 모서리 근처에서 왼쪽으로 완전히
  // 빠져나갈 때까지. FORWARD/BACK 둘 다 이 물리적 드래그 경로 자체는 동일하다 — 어느
  // 페이지가 "말리는 쪽"이 되는지만 direction으로 갈릴 뿐이다.
  const topMargin = pageHeight / 10;
  const start = { x: pageWidth - topMargin, y: topMargin };
  const dest = { x: -pageWidth, y: 0 };
  const dragLength = Math.max(Math.abs(start.x - dest.x), Math.abs(start.y - dest.y));
  const effectiveDuration = dragLength >= 1000 ? duration : (dragLength / 1000) * duration;

  const startTime = performance.now();
  let finished = false;

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
    const t = Math.min(1, (now - startTime) / effectiveDuration);
    const localPos = { x: start.x + (dest.x - start.x) * t, y: start.y + (dest.y - start.y) * t };

    const geo = calcFlipGeometry(localPos, pageWidth, pageHeight);
    if (geo) {
      const flippingAngle = direction === 'next' ? -geo.angle : geo.angle;
      const flippingPos = direction === 'next' ? geo.rect.topLeft : geo.rect.topRight;
      const bottomPos = direction === 'prev' ? { x: pageWidth, y: 0 } : { x: 0, y: 0 };

      const flippingArea = getFlippingClipArea(geo);
      const bottomArea = getBottomClipArea(geo, pageWidth, pageHeight);

      const flippingStyle = clipPathAndTransform(flippingArea, flippingPos, flippingAngle, direction);
      flippingLayer.style.clipPath = flippingStyle.clipPath;
      flippingLayer.style.webkitClipPath = flippingStyle.clipPath;
      flippingLayer.style.transform = flippingStyle.transform;

      const bottomStyle = clipPathAndTransform(bottomArea, bottomPos, 0, direction);
      bottomLayer.style.clipPath = bottomStyle.clipPath;
      bottomLayer.style.webkitClipPath = bottomStyle.clipPath;
      bottomLayer.style.transform = bottomStyle.transform;

      innerShadow.style.clipPath = flippingStyle.clipPath;
      innerShadow.style.webkitClipPath = flippingStyle.clipPath;
      innerShadow.style.transform = flippingStyle.transform;
      innerShadow.style.width = pageWidth + 'px';
      innerShadow.style.height = pageHeight + 'px';

      outerShadow.style.clipPath = flippingStyle.clipPath;
      outerShadow.style.webkitClipPath = flippingStyle.clipPath;
      outerShadow.style.transform = flippingStyle.transform;
      outerShadow.style.width = pageWidth + 'px';
      outerShadow.style.height = pageHeight + 'px';

      // 그림자 세기: 접히기 시작(진행도 0)엔 거의 없다가 중간에 가장 짙고, 끝(진행도 1)엔
      // 다시 옅어진다 — 원본의 "progress > 100이면 200-progress" 대칭과 같은 모양.
      const shadowT = t > 0.5 ? 1 - t : t; // 0→0.5→0(끝)
      const opacity = Math.min(0.35, shadowT * 0.7);
      const angleDeg = (getShadowAngle(geo, direction, pageWidth) * 180) / Math.PI;
      innerShadow.style.background =
        `linear-gradient(${angleDeg}deg, rgba(0,0,0,${opacity}), rgba(0,0,0,0) 60%)`;
      outerShadow.style.background =
        `linear-gradient(${angleDeg}deg, rgba(0,0,0,0) 40%, rgba(0,0,0,${opacity * 0.6}))`;
    }
    // geo가 null인 프레임(경계 특이점)은 조용히 건너뛴다 — 직전 프레임 모습 그대로 유지.

    if (t < 1) {
      activeAnimation.raf = requestAnimationFrame(frame);
    } else {
      finish();
    }
  }

  activeAnimation = {
    raf: requestAnimationFrame(frame),
    // ⚠️ 탭이 백그라운드로 가면(다른 앱 전환, 화면 잠금 등) 브라우저가
    // requestAnimationFrame을 통째로 멈추거나 아주 드물게만 돌린다 — 그 상태에서
    // 애니메이션이 끝나기를 기다리기만 하면 사용자가 다시 돌아왔을 때 넘어가다 만
    // 페이지에 영원히 멈춰있는 것처럼 보인다. rAF와 별개로 흘러가는 setTimeout을
    // 안전장치로 같이 걸어서, 어느 쪽이든 먼저 끝나는 쪽이 마무리를 맡는다.
    safetyTimer: setTimeout(finish, effectiveDuration + 500),
  };
  return true;
}
