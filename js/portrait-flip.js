// js/portrait-flip.js — 세로(모바일, 한 페이지) 모드 전용 페이지 넘기기 시각 효과.
//
// ⚠️ 이 파일의 역사(중요, 다시 손댈 때 꼭 읽을 것):
// 2026-08-18~24 사이, 세로 모드의 "이전 페이지" 커얼 애니메이션을 StPageFlip
// (js/vendor/page-flip.browser.js) 패치로 고치려는 시도가 9라운드 이어졌다 — 라이브러리가
// 세로 모드를 "2페이지 스프레드 중 왼쪽 페이지를 화면 밖으로 숨겨서 1페이지처럼 보이게"
// 만드는 구조라, 그 좌표계 안에서 backward 방향 애니메이션이 실기기에서 계속 글자 겹침
// 글리치를 냈다. 이후 StPageFlip을 완전히 버리고 순수 translate3d 밀기 방식으로,
// 그 다음엔 원본 커얼 수학을 진짜 1페이지 컨테이너에 직접 이식하는 방식으로 두 차례 더
// 다시 구현했지만 — 이 코드가 이론적으로 검증됐다고 확인한 뒤에도, 실기기에서는
// **똑같은 종류의 문제가 계속 재발**했다(사용자 확인, 2026-08-24). 세 번의 서로 다른
// 구현이 전부 이 환경의 자동화 브라우저(document.hidden=true라 실제 페인트를 직접 볼 수
// 없음, CLAUDE.md 진행 상황 메모 참고)에서는 "검증됨"으로 나왔는데 실기기에서는 계속
// 깨진다는 패턴 자체가, 이 클래스의 애니메이션(페이지 콘텐츠에 매 프레임 clip-path/rotate
// 등 복잡한 변형을 거는 방식)을 이 환경에서 신뢰성 있게 구현/검증하는 것 자체가 무리라는
// 뜻으로 받아들여 — 사용자 결정으로 **세로 모드의 페이지 넘김 애니메이션을 통째로 포기**
// 하고, 아주 단순한 깜빡임(flash) 피드백 하나로 완전히 대체했다.
//
// 지금 이 파일은 그래서 아주 작다: `flashPageTurn()` 하나뿐이고, 페이지 콘텐츠 자체는
// (jumpToPrevPage/goToNextPage에서) 애니메이션 없이 즉시 바뀐다 — 이 함수는 그 순간
// "뭔가 바뀌었다"는 걸 알려주는 짧은 명암 펄스만 담당한다. clip-path/rotate/translate3d로
// 페이지 콘텐츠 자체를 변형하는 코드는 이제 전혀 없다 — 그게 3번의 재구현 내내 문제의
// 근원이었으므로, 아예 그 종류의 코드 자체를 다시 안 쓴다.
//
// 가로(PC, 2페이지 스프레드) 모드는 이 파일과 전혀 무관하다 — 계속 StPageFlip의
// flipNext()/flipPrev()를 그대로 쓴다(원래도 문제 없었고, 지금도 안 건드린다).

// stage는 #book-stage(부모가 이미 position:relative) — 안 쓴다, 대신 #page-turn-flash가
// #book-stage "밖"(#main-content 바로 아래)에 고정으로 떠 있다(#brightness-overlay와
// 같은 이유 — buildFlipBook이 #book-stage.innerHTML을 통째로 갈아끼우므로 그 안에 두면
// 페이지를 새로 열 때마다 사라진다). 그래서 이 함수는 인자를 받지 않는다.
export function flashPageTurn() {
  const el = document.getElementById('page-turn-flash');
  if (!el) return;
  // 연타해도 매번 다시 보이도록: 애니메이션 클래스를 뗐다가(강제 리플로우로 확실히
  // 반영시킨 뒤) 다시 붙여서 재생을 처음부터 다시 시작시킨다.
  el.classList.remove('flash');
  void el.offsetWidth; // 강제 리플로우
  el.classList.add('flash');
}
