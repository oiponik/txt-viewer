// session.js — 로그인한 사용자(currentUser) 상태와, 그 상태에 기반한 판정 함수들
// (isDevUser/isAdminUser)을 모아둔 곳. 다른 모든 모듈(auth/library/reader)이 이걸
// 가져다 쓴다. currentUser는 이 파일만 직접 재할당한다 — 다른 모듈은 반드시
// setCurrentUser()를 통해서만 바꿔야 한다(ES 모듈은 import한 바인딩을 직접
// 재할당할 수 없어서, import된 let은 읽기 전용처럼 동작한다).

export let currentUser = null; // 로그인한 사용자 (Firebase Auth User 객체)
export function setCurrentUser(user) {
  currentUser = user;
}

// localStorage에 기억해뒀다가, 페이지가 새로 열릴 때 그 책이 아직 목록에
// 있으면 서재를 거치지 않고 곧바로 그 책을 열어서(=Firestore의 최신 위치로) 이어준다.
// ⚠️ 사용자별로 따로 저장해야 한다 — 같은 기기(브라우저)를 여러 명이 나눠 쓸 때
// 다른 사람이 마지막으로 보던 책이 자동으로 열리면 안 되므로 키에 uid를 포함한다.
export function lastOpenedFileKey() {
  return 'txtViewerLastOpenedFile_' + (currentUser ? currentUser.uid : 'anon');
}

// 파일명 → Firestore 문서 ID. 진행상황/책갈피가 이 값으로 저장되므로, 파일 이름을
// 바꿀 때(renameFile) 이 함수로 새/옛 문서 ID를 둘 다 구해서 옮겨야 한다.
export function fileDocId(fileName) {
  return btoa(encodeURIComponent(fileName));
}

// 🧪 개발자 전용 테스트 계정 — localhost에서만, 로그인 화면에 아이디 "dev"를
// 입력하면(비밀번호 불필요) Firebase를 거치지 않고 로컬 더미 계정으로 로그인해서
// 서재 → 뷰어까지 실제 사용 흐름 그대로 테스트할 수 있게 한다. 책 목록엔
// 로컬 정적 파일 dev-test-book.txt(같은 서버가 서빙) 하나만 뜨고, 진행 상황도
// Firestore 대신 localStorage에 저장돼서 실제 사용자 데이터/백엔드를 전혀 건드리지
// 않는다. 배포된 실제 서비스(Vercel 도메인)에서는 isLocalDevHost가 false라
// 이 경로 자체가 존재하지 않는다 — 실사용자 로그인 게이트에는 영향 없음.
export const isLocalDevHost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
export const DEV_USER_UID = 'dev-local';
export const DEV_BOOK_FILENAME = 'dev-test-book.txt';

export function isDevUser() {
  return !!currentUser && currentUser.uid === DEV_USER_UID;
}

// 🔐 임시 관리자 게이트 — 지금은 books/ 아래 파일 목록을 모든 회원이 공통으로 보는
// 서재라서, 서재 구조를 바꾸는 동작(새 폴더/이동/삭제/이름변경)을 아무나 할 수
// 있으면 안 된다. 나중에 회원별로 자기가 올린 파일만 보이게 바뀌면 이 게이트는
// 필요 없어진다 — 그 전까지의 임시 조치.
// ⚠️ 이건 화면에 버튼을 숨기는 것뿐이다. 진짜 보안은 여기가 아니라 Firebase
// Storage/Firestore 보안 규칙에서 이 이메일인지 확인해야 한다 — 그 규칙은 이
// 저장소에 없어서(Firebase 콘솔에서 직접 관리) 내가 대신 걸어줄 수 없다.
// 아래 두 함수 바로 위 주석에 필요한 규칙을 적어뒀다.
const ADMIN_EMAIL = 'kinopioo@naver.com';
export function isAdminUser() {
  // 개발자 테스트 세션은 실제 Storage/Firestore를 안 건드리니 항상 관리자로 취급해서
  // 화면 확인이 가능하게 한다 — 실사용자 권한 체계와는 무관.
  return isDevUser() || (!!currentUser && currentUser.email === ADMIN_EMAIL);
}
