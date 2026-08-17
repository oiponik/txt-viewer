// auth.js — 로그인/회원가입 화면과 로그인 상태 게이트(onAuthStateChanged), 개발자 전용
// 더미 로그인(loginAsDevUser), 로그아웃. 앱의 진입점 역할 — 로그인 성공/복원 시 다른
// 도메인(library.js/reader.js)의 초기 로드 함수들을 순서에 맞게 호출해준다.

import {
  onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

import { auth } from "./firebase-init.js";
import { setCurrentUser, isDevUser, isLocalDevHost, DEV_USER_UID, DEV_BOOK_FILENAME, lastOpenedFileKey } from "./session.js";
import { setStatus, showLibraryScreen, showViewerScreen, openSheet, closeSheet, releaseWakeLock } from "./ui-shared.js";
import { loadReaderPrefs, loadDevTestFile, loadFileFromStorage, resetReaderSession, setBailToLibraryIfPaginationNeeded } from "./reader.js";
import { loadLibraryState, resetLibraryNavigation, populateDevFileList, fetchFileList, allStorageFileNames } from "./library.js";

const authScreen = document.getElementById('auth-screen');
const libraryScreen = document.getElementById('library-screen');
const viewerScreen = document.getElementById('viewer-screen');

const authForm = document.getElementById('auth-form');
const authEmailInput = document.getElementById('auth-email');
const authPasswordInput = document.getElementById('auth-password');
const authErrorEl = document.getElementById('auth-error');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const authToggleBtn = document.getElementById('auth-toggle-btn');
const authTitleEl = document.getElementById('auth-title');

// 💡 "한 번 로그인했던 계정은 클릭 한 번으로 다시" — 이메일(비밀번호는 절대 아님)만
// localStorage에 기억해뒀다가 로그인 화면을 다시 볼 때 자동으로 채워주고 비밀번호
// 칸에 바로 포커스를 준다. 비밀번호를 브라우저에 그대로 저장해서 자동 입력하는 건
// 기기를 같이 쓰는 사람이나 XSS에 그대로 노출되는 보안 사고라 절대 하지 않는다 —
// 대신 <input autocomplete="current-password">를 정확히 붙여둬서, 브라우저 자체의
// 비밀번호 관리자가 이 폼을 기억하고 자동 채움/자동완성 드롭다운을 띄워주게 한다.
// 그러면 이메일 자동 채움 + 비밀번호는 브라우저가 제안하는 값 클릭 한 번으로
// 사실상 "클릭 한 번 로그인"에 가까워진다.
const LAST_EMAIL_KEY = 'txtViewerLastEmail';

function applyRememberedEmail() {
  const remembered = localStorage.getItem(LAST_EMAIL_KEY);
  const hintEl = document.getElementById('remembered-email-hint');
  if (remembered && !isSignupMode) {
    authEmailInput.value = remembered;
    document.getElementById('remembered-email-text').textContent = remembered;
    hintEl.style.display = 'block';
    authPasswordInput.focus();
  } else {
    hintEl.style.display = 'none';
  }
}

// 화면 전환: 로그인 화면으로. (서재/뷰어로의 전환은 ui-shared.js의
// showLibraryScreen/showViewerScreen — 여긴 로그인 화면만 다뤄서 여기 남아있다)
function showAuthScreen() {
  libraryScreen.classList.add('screen-hidden');
  viewerScreen.classList.add('screen-hidden');
  authScreen.classList.remove('screen-hidden');
  applyRememberedEmail();
  releaseWakeLock();
}

async function loginAsDevUser() {
  setCurrentUser({ uid: DEV_USER_UID, email: 'dev@local.test' });
  authForm.reset();
  authErrorEl.classList.remove('visible');
  // 업로드 버튼은 실사용자 화면과 동일하게 그대로 보여준다 — 실제 Storage가 없어서
  // 눌러도 업로드는 안 되지만(file-input change 핸들러의 isDevUser() 가드 참고),
  // 개발/디자인 확인 목적으로는 버튼이 실제 화면처럼 보이는 게 더 중요하다.

  // 뷰어 설정(테마/글꼴/글자크기/밝기)을 책을 열기 전에 먼저 불러온다 — 그래야
  // buildFlipBook이 처음부터 올바른 글꼴/크기 기준으로 페이지를 나눈다.
  await Promise.all([loadReaderPrefs(), loadLibraryState()]);

  const lastFile = localStorage.getItem(lastOpenedFileKey());
  resetLibraryNavigation();
  await populateDevFileList();
  if (lastFile === DEV_BOOK_FILENAME) {
    showViewerScreen();
    // 페이지 나누기가 실제로 새로 돌아야 하는 상황이면(캐시가 지금 화면 크기 기준으로
    // 없으면) loadDevTestFile 내부에서 곧바로 내 서재로 되돌아간다 — 아래 참고.
    setBailToLibraryIfPaginationNeeded(true);
    await loadDevTestFile();
    setBailToLibraryIfPaginationNeeded(false);
  } else {
    showLibraryScreen();
  }
}

// 🔐 로그인 상태 게이트: 앱의 모든 화면은 로그인 후에만 보인다.
// onAuthStateChanged는 새로고침 직후에도(로컬에 저장된 세션이 있으면) 바로 로그인된
// 상태로 한 번 불려서, "로그인 유지"가 저절로 이루어진다.
// ⚠️ 개발자 계정(dev)은 Firebase 세션이 아예 없으므로 이 콜백을 거치지 않는다 —
// loginAsDevUser()가 화면 전환까지 직접 처리한다.
let authStateResolved = false;
onAuthStateChanged(auth, async (user) => {
  authStateResolved = true;
  if (user) {
    setCurrentUser(user);
    if (user.email) localStorage.setItem(LAST_EMAIL_KEY, user.email);
    // 파일 목록과 뷰어 설정(테마/글꼴/글자크기/밝기)을 동시에 불러온다 — 서로
    // 독립적인 요청이라 순서대로 기다릴 필요 없이 병렬로 처리해서 로그인을 늦추지 않는다.
    await Promise.all([fetchFileList(), loadReaderPrefs()]);

    const lastFile = localStorage.getItem(lastOpenedFileKey());
    if (lastFile && allStorageFileNames.includes(lastFile)) {
      showViewerScreen();
      // 페이지 나누기가 실제로 새로 돌아야 하는 상황이면(캐시가 지금 화면 크기
      // 기준으로 없으면) loadFileFromStorage 내부에서 곧바로 내 서재로 되돌아간다 —
      // 로딩 화면을 계속 붙잡고 있는 대신, 화면 크기가 그대로라 빠르게 열릴 때만
      // 뷰어에 머문다.
      setBailToLibraryIfPaginationNeeded(true);
      await loadFileFromStorage(lastFile);
      setBailToLibraryIfPaginationNeeded(false);
    } else {
      showLibraryScreen();
    }
  } else if (!isDevUser()) {
    // 로그아웃 상태 — 읽던 책 정보를 비우고 로그인 화면만 보여준다
    // (개발자 세션 중엔 currentUser가 dev 로컬 계정이라 이 분기를 타지 않는다)
    setCurrentUser(null);
    resetReaderSession();
    authForm.reset();
    authErrorEl.classList.remove('visible');
    showAuthScreen();
  }
});

// 🛟 안전장치 — 화면 3개(auth/library/viewer)는 전부 기본이 screen-hidden이라, 어떤
// 이유로든(예: 오프라인 상태에서 특정 환경의 IndexedDB 이슈 등으로 Firebase Auth 초기화가
// 멈추는 경우) onAuthStateChanged가 끝내 한 번도 안 불리면 앱이 영원히 빈 화면으로
// 보인다. 일정 시간 안에 응답이 없으면 일단 로그인 화면이라도 띄워서 "앱이 멈춘 게
// 아니다"라는 걸 보여준다 — 오프라인 상태에서 로그인 자체는 안 될 수 있지만, 최소한
// 빈 화면보다는 사용자가 상황을 알 수 있다.
setTimeout(() => {
  if (authStateResolved) return;
  console.error('로그인 상태 확인이 지연되고 있어요 — 로그인 화면을 대신 띄웁니다.');
  showAuthScreen();
  setStatus('연결 상태를 확인하지 못했어요. 온라인 상태에서 다시 시도해주세요.');
}, 4000);

// 로그인/회원가입 폼 — 같은 폼을 모드 전환으로 재사용한다
let isSignupMode = false;

function setAuthError(message) {
  authErrorEl.textContent = message || '';
  authErrorEl.classList.toggle('visible', !!message);
}

function authErrorMessage(err) {
  switch (err.code) {
    case 'auth/email-already-in-use': return '이미 가입된 이메일입니다.';
    case 'auth/invalid-email': return '올바른 이메일 형식이 아닙니다.';
    case 'auth/weak-password': return '비밀번호는 6자 이상이어야 합니다.';
    case 'auth/user-not-found': return '가입되지 않은 이메일입니다.';
    case 'auth/wrong-password': return '비밀번호가 일치하지 않습니다.';
    case 'auth/invalid-credential': return '이메일 또는 비밀번호가 일치하지 않습니다.';
    case 'auth/too-many-requests': return '너무 많이 시도했습니다. 잠시 후 다시 시도해주세요.';
    default: return '오류가 발생했습니다. (' + err.code + ')';
  }
}

authToggleBtn.addEventListener('click', () => {
  isSignupMode = !isSignupMode;
  authTitleEl.textContent = isSignupMode ? '회원가입' : '로그인';
  authSubmitBtn.textContent = isSignupMode ? '가입하기' : '로그인';
  authToggleBtn.textContent = isSignupMode ? '이미 계정이 있으신가요? 로그인' : '계정이 없으신가요? 회원가입';
  authPasswordInput.autocomplete = isSignupMode ? 'new-password' : 'current-password';
  setAuthError('');
  // 회원가입 모드에선 "OO님, 다시 오셨네요"가 어색하니 숨기고, 로그인 모드로
  // 돌아오면 다시 채워준다 (이메일 값은 그대로 둬서 입력한 걸 잃지 않는다)
  applyRememberedEmail();
});

document.getElementById('use-different-account-btn').addEventListener('click', () => {
  localStorage.removeItem(LAST_EMAIL_KEY);
  authEmailInput.value = '';
  document.getElementById('remembered-email-hint').style.display = 'none';
  authEmailInput.focus();
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = authEmailInput.value.trim();
  const password = authPasswordInput.value;
  setAuthError('');

  // 🧪 개발자 전용 로그인 — localhost에서만, 이메일란에 "dev"를 입력하면 비밀번호
  // 없이 Firebase를 거치지 않고 로컬 더미 계정으로 바로 들어간다.
  if (isLocalDevHost && email.toLowerCase() === 'dev') {
    loginAsDevUser();
    return;
  }

  authSubmitBtn.disabled = true;
  try {
    if (isSignupMode) {
      await createUserWithEmailAndPassword(auth, email, password);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
    // 성공하면 onAuthStateChanged가 알아서 화면을 넘겨준다
  } catch (err) {
    console.error(err);
    setAuthError(authErrorMessage(err));
  } finally {
    authSubmitBtn.disabled = false;
  }
});

document.getElementById('logout-btn').addEventListener('click', () => {
  closeSheet('settings-panel');
  if (isDevUser()) {
    // 개발자 세션은 Firebase 로그인 자체가 없었으므로 signOut 대신 직접 정리한다
    setCurrentUser(null);
    resetReaderSession();
    showAuthScreen();
    return;
  }
  signOut(auth);
});

document.getElementById('open-settings-btn').addEventListener('click', () => {
  openSheet('settings-panel');
});
