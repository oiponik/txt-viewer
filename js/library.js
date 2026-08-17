// library.js — "내 서재" 화면: 폴더/파일 목록, 폴더 생성/이름변경/이동/삭제, 파일
// 이름변경/이동/삭제, 업로드(.txt만), 드래그(폴더 이동 + 순서변경 손잡이), 이어보기.
// ⚠️ reader.js와 서로 가져다 쓰는 순환 참조가 있다 — reader.js 상단 주석 참고.

import {
  doc, getDoc, setDoc, deleteDoc,
  collection, query, orderBy, limit, getDocs,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ref, uploadBytes, listAll, getBytes, getMetadata, deleteObject } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

import { db, storage } from "./firebase-init.js";
import { currentUser, isDevUser, isAdminUser, lastOpenedFileKey, fileDocId, DEV_BOOK_FILENAME } from "./session.js";
import { setStatus, showViewerScreen, openSheet, closeSheet } from "./ui-shared.js";
import { currentFileName, setCurrentFileName, loadFileFromStorage, loadDevTestFile, clearOfflineProgressAndBookmarks } from "./reader.js";
import { isBookCached, renameCachedBook, removeCachedBook, refreshStaleFlags } from "./offline-cache.js";

const fileListElement = document.getElementById("file-list");

// reader.js의 loadFileFromStorage/loadDevTestFile이 책을 열자마자(다운로드 완료를 기다리지
// 않고) 즉시 시각적 피드백을 주기 위해 부르는 함수 — 목록에서 지금 여는 파일 행에만
// .active를 붙인다. reader.js가 이 DOM(file-list)을 직접 몰라도 되게 여기서 대신 해준다.
export function markActiveFileRow(fileName) {
  Array.from(fileListElement.children).forEach((li) => {
    li.classList.toggle("active", li.dataset.fileName === fileName);
  });
}

function createItemMenuButton(onOpen) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'item-menu-btn';
  btn.title = '더보기';
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="12" cy="5" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="12" cy="19" r="1.6"></circle></svg>';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onOpen();
  });
  return btn;
}

// 순서변경 전용 손잡이(⠿) — 여길 잡고 끌면 "같은 폴더 안에서 순서만 바꾸기"이고,
// 행 몸통을 잡고 끄는 기존 동작("폴더로 옮기기")과는 완전히 분리된 별도의 드래그다.
// pointerdown이 li까지 버블링되면 몸통-드래그(onLibraryItemPointerDown)까지 같이
// 발동해버리므로, 여기서 반드시 stopPropagation으로 끊어야 한다.
function createReorderHandle() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'reorder-handle';
  btn.title = '순서 변경';
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="9" cy="6" r="1.6"></circle><circle cx="15" cy="6" r="1.6"></circle><circle cx="9" cy="12" r="1.6"></circle><circle cx="15" cy="12" r="1.6"></circle><circle cx="9" cy="18" r="1.6"></circle><circle cx="15" cy="18" r="1.6"></circle></svg>';
  btn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    onReorderHandlePointerDown(e);
  });
  // 드래그 없이 그냥 클릭됐을 때도(예: 짧은 탭) li의 onclick(열기/이동)으로
  // 안 새어나가게 막는다 — 손잡이는 순서변경 전용이지 열기 버튼이 아니다.
  btn.addEventListener('click', (e) => e.stopPropagation());
  return btn;
}

// 서재 파일 목록 항목 하나를 만든다 — 도구모음 아이콘들과 같은 stroke 기반
// feather 스타일 책 아이콘을 파일명 앞에 붙인다. li.dataset.fileName으로
// 어떤 파일인지 식별한다(활성 표시/드래그 모두 이 값을 쓴다).
function createFileListItem(fileName, onClick) {
  const li = document.createElement('li');
  li.dataset.fileName = fileName;
  li.dataset.draggable = 'file';

  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', '20');
  icon.setAttribute('height', '20');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('class', 'file-item-icon');
  icon.innerHTML = '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'file-item-name';
  nameSpan.textContent = fileName;

  li.appendChild(icon);
  li.appendChild(nameSpan);

  // 오프라인에서도 열 수 있는 책인지 표시 — 캐싱된 책은 작은 "저장됨" 뱃지를,
  // 캐싱 안 된 책은 흐리게 표시한다 — 단, 온라인일 때는 어차피 캐싱 여부와 무관하게
  // 아무 책이나 열 수 있어서 흐림 표시가 의미가 없으니 오프라인일 때만 흐리게 한다.
  // "저장됨" 배지는 반대로 온/오프라인 상관없이 항상 보여준다(정보 자체는 유용하니까).
  // "이어보기" 카드(createRecentFileListItem)는 완전히 별개 UI라 이 처리를 하지 않는다.
  if (isBookCached(fileName)) {
    const badge = document.createElement('span');
    badge.className = 'offline-cached-badge';
    badge.textContent = '저장됨';
    badge.title = '오프라인에서도 열 수 있어요';
    li.appendChild(badge);
  } else if (!navigator.onLine) {
    li.classList.add('file-offline-unavailable');
  }

  // 이름변경/이동/삭제/순서변경은 전부 관리자만 — 버튼 자체를 안 보여준다(isAdminUser 주석 참고)
  if (isAdminUser()) {
    li.appendChild(createReorderHandle());
    li.appendChild(createItemMenuButton(() => openFileActionSheet(fileName)));
  }
  // suppressClick: 방금 드래그였다면(성공했든 아무 데도 못 놓고 그냥 들었다 놨든) 이어서
  // 뜨는 클릭까지 "열기"로 처리되지 않게 막는다 — suppressNextClick 참고.
  li.onclick = () => {
    if (li.dataset.suppressClick) {
      delete li.dataset.suppressClick;
      return;
    }
    if (!navigator.onLine && !isBookCached(fileName)) {
      setStatus('오프라인 상태에서는 열 수 없어요');
      return;
    }
    onClick();
  };
  return li;
}

// 폴더 목록 항목 — 클릭하면 그 폴더 안으로 들어간다(currentFolderId 변경 후 재렌더).
function createFolderListItem(folder) {
  const li = document.createElement('li');
  li.className = 'folder-item';
  li.dataset.folderId = folder.id;
  li.dataset.draggable = 'folder';

  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', '20');
  icon.setAttribute('height', '20');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('class', 'file-item-icon');
  icon.innerHTML = '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"></path>';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'file-item-name';
  nameSpan.textContent = folder.name;

  li.appendChild(icon);
  li.appendChild(nameSpan);
  // 이름변경/이동/삭제/순서변경은 전부 관리자만 — 버튼 자체를 안 보여준다(isAdminUser 주석 참고).
  // 폴더 안으로 들어가서 훑어보는 건(li.onclick) 관리자가 아니어도 그대로 가능하다.
  if (isAdminUser()) {
    li.appendChild(createReorderHandle());
    li.appendChild(createItemMenuButton(() => openFolderActionSheet(folder.id)));
  }
  li.onclick = () => {
    if (li.dataset.suppressClick) {
      delete li.dataset.suppressClick;
      return;
    }
    currentFolderId = folder.id;
    renderLibraryView();
  };
  return li;
}

export async function populateDevFileList() {
  allStorageFileNames = [DEV_BOOK_FILENAME];
  await loadRecentFileNames();
  renderLibraryView();
}
export let allStorageFileNames = []; // Storage books/ 아래 실제 파일 전체 목록(평평)
let libraryFolders = [];      // {id, name, parentId(string|null)}[]
let fileFolderMap = {};       // { [fileName]: folderId } — 없으면 루트
let currentFolderId = null;   // 지금 서재 화면에서 보고 있는 폴더 (null=루트)
let recentFileNames = [];     // 최근 연 순서(최신이 앞) — 폴더 위치와 무관하게 루트 화면에 따로 보여줌
// 이어보기 카드에 진행률(%)을 보여주기 위한 값 — { [fileName]: { charIndex, totalChars } }.
// loadRecentFileNames가 이미 불러오는 reading_progress 문서에서 같이 뽑아온다(별도 요청 없음).
let recentFileProgress = {};
// 손잡이(⠿)로 직접 끌어 정한 순서 — { [부모 폴더 id 또는 'root']: [itemKey, ...] }.
// itemKey는 폴더면 "folder:id", 파일이면 "file:fileName". 이 배열에 없는 항목은
// (아직 손대지 않은 새 파일/폴더) 정렬된 항목들 뒤에 이름순으로 자연히 붙는다.
let itemOrder = {};

// 개발자 로그인 시 서재 탐색 상태를 루트로 되돌린다(auth.js의 loginAsDevUser 전용).
export function resetLibraryNavigation() {
  currentFolderId = null;
}

// 폴더/파일을 바꾸는 모든 쓰기 동작(생성/이름변경/이동/삭제/업로드/순서변경)의 진입점마다
// 이걸 먼저 불러서 막는다 — 오프라인 중엔 실패할 요청을 굳이 보내는 대신, 애초에 시도하지
// 않고 조용히 안내만 한다. 막아야 했으면 true를 돌려준다.
function blockedWhileOffline() {
  if (navigator.onLine) return false;
  setStatus('오프라인 상태에서는 작업이 불가능합니다');
  return true;
}

// 드래그 직후(성공했든, 아무 데도 못 옮기고 그냥 놓았든) 뒤이어 뜨는 click을 한 번
// 무시한다 — 안 그러면 "옮기려고 들었다가 아무 폴더에도 안 놓고 놓았을 뿐"인데도
// 파일이 열리거나 폴더로 들어가 버린다. li.onclick 쪽에서 플래그를 보고 스스로
// 지우는 걸 기본으로 하고(타이밍에 안전), 혹시 그 click 자체가 안 오는 경우(드래그가
// pointercancel로 끝나는 등)를 대비해 넉넉한 시간 뒤에도 한 번 더 지워서 영영
// 막혀있는 일이 없게 한다.
function suppressNextClick(li) {
  li.dataset.suppressClick = '1';
  clearTimeout(li._suppressClickTimer);
  li._suppressClickTimer = setTimeout(() => { delete li.dataset.suppressClick; }, 300);
}

function newFolderId() {
  return (crypto.randomUUID ? crypto.randomUUID() : 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2));
}
function orderParentKey(folderId) { return folderId || 'root'; }
function folderItemKey(id) { return 'folder:' + id; }
function fileItemKey(name) { return 'file:' + name; }

// ⚠️ books/ 파일 목록이 전체 회원 공통이라, 폴더 구조도 회원마다 따로가 아니라
// 전체가 같은 걸 본다 — 그래서 users/{uid}/... 밑이 아니라 공용 문서(library/shared)
// 하나에 저장한다. Firestore 보안 규칙에 아래 내용을 추가해야 실제로 안전해진다
// (이 저장소엔 규칙 파일이 없어서 Firebase 콘솔에서 직접 추가해야 함):
//   match /library/shared {
//     allow read: if request.auth != null;
//     allow write: if request.auth != null && request.auth.token.email == 'kinopioo@naver.com';
//   }
export async function loadLibraryState() {
  if (isDevUser()) {
    try {
      const raw = localStorage.getItem('devLibraryState');
      const data = raw ? JSON.parse(raw) : null;
      libraryFolders = (data && Array.isArray(data.folders)) ? data.folders : [];
      fileFolderMap = (data && data.fileFolder && typeof data.fileFolder === 'object') ? data.fileFolder : {};
      itemOrder = (data && data.itemOrder && typeof data.itemOrder === 'object') ? data.itemOrder : {};
    } catch (err) {
      libraryFolders = [];
      fileFolderMap = {};
      itemOrder = {};
    }
    return;
  }
  try {
    const snap = await getDoc(doc(db, "library", "shared"));
    const data = snap.exists() ? snap.data() : null;
    libraryFolders = (data && Array.isArray(data.folders)) ? data.folders : [];
    fileFolderMap = (data && data.fileFolder && typeof data.fileFolder === 'object') ? data.fileFolder : {};
    itemOrder = (data && data.itemOrder && typeof data.itemOrder === 'object') ? data.itemOrder : {};
  } catch (err) {
    // 조용히 넘어가면 "폴더가 새로고침할 때마다 사라진다"처럼 보여서(실제로는 애초에
    // 못 불러온 것) 눈에 보이는 신호를 하나 남긴다 — 대개 Firestore 보안 규칙에서
    // library/shared 경로를 안 열어줘서 나는 permission-denied다.
    console.error('서재 폴더 정보 불러오기 실패:', err);
    setStatus('폴더 정보를 불러오지 못했어요');
    libraryFolders = [];
    fileFolderMap = {};
    itemOrder = {};
  }
}

// 반환값(true/false)으로 실제 저장 성공 여부를 알려준다 — 호출부가 이걸 안 보고
// 무조건 "OO했어요" 토스트를 띄우면, 실패 토스트가 그 성공 토스트에 곧바로
// 덮어써져서 사용자 눈엔 실패한 적이 없던 것처럼 보이는 문제가 있었다
// (관리자가 폴더를 만들어도 새로고침하면 사라지는 버그의 실제 원인).
async function saveLibraryState() {
  if (isDevUser()) {
    try {
      localStorage.setItem('devLibraryState', JSON.stringify({ folders: libraryFolders, fileFolder: fileFolderMap, itemOrder }));
      return true;
    } catch (err) { return false; } /* 용량 초과 등은 조용히 무시 — 폴더 정보 없이도 파일 목록 자체는 동작 */
  }
  try {
    await setDoc(doc(db, "library", "shared"), {
      folders: libraryFolders,
      fileFolder: fileFolderMap,
      itemOrder,
      updatedAt: new Date()
    });
    return true;
  } catch (err) {
    console.error('서재 폴더 정보 저장 실패:', err);
    setStatus('폴더 정보 저장 실패');
    return false;
  }
}

function getFolderById(id) {
  return libraryFolders.find((f) => f.id === id) || null;
}
function getChildFolders(parentId) {
  return libraryFolders.filter((f) => (f.parentId || null) === (parentId || null));
}
// id 자신 + 모든 하위 폴더 id들 — 폴더를 자기 자신/자손 안으로 옮기거나 삭제할 때
// 순환이 생기지 않게 막는 데 쓴다 (moveFolderTo/폴더 이동 시트에서 후보 제외).
function getFolderAndDescendantIds(id) {
  const ids = [id];
  let frontier = [id];
  while (frontier.length > 0) {
    const next = libraryFolders.filter((f) => frontier.includes(f.parentId)).map((f) => f.id);
    ids.push(...next);
    frontier = next;
  }
  return ids;
}
// 루트 → ... → id 순서의 폴더 배열 (breadcrumb에 그대로 씀)
function folderBreadcrumbPath(id) {
  const path = [];
  let cur = id ? getFolderById(id) : null;
  while (cur) {
    path.unshift(cur);
    cur = cur.parentId ? getFolderById(cur.parentId) : null;
  }
  return path;
}

// 이어보기 — reading_progress에 이미 파일마다 updatedAt이 찍혀 있어서, 따로 목록을
// 유지하지 않고 가장 최근 문서 하나를 조회해서 얻는다. 소설 리더 앱은 "여러 권 중
// 고르기"보다 "읽던 책 하나로 바로 이어지기"가 성격에 맞아 1권만 보여준다.
// (개발자 세션은 Firestore를 안 쓰니, devProgress: 키가 있으면 그 파일 하나만.)
const RECENT_FILES_LIMIT = 1;
async function loadRecentFileNames() {
  recentFileProgress = {};
  if (isDevUser()) {
    const raw = localStorage.getItem('devProgress:' + DEV_BOOK_FILENAME);
    if (raw === null) {
      recentFileNames = [];
      return;
    }
    recentFileNames = [DEV_BOOK_FILENAME];
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.charIndex === 'number') {
        recentFileProgress[DEV_BOOK_FILENAME] = { charIndex: parsed.charIndex, totalChars: parsed.totalChars || 0 };
      }
    } catch (err) {
      // 예전 형식(순수 숫자)이면 totalChars를 모르니 진행률 표시는 생략한다
    }
    return;
  }
  try {
    const q = query(
      collection(db, "users", currentUser.uid, "reading_progress"),
      orderBy("updatedAt", "desc"),
      limit(RECENT_FILES_LIMIT)
    );
    const snap = await getDocs(q);
    recentFileNames = snap.docs.map((d) => d.data().fileName).filter(Boolean);
    // 이미 불러온 문서에서 진행률 표시용 값도 같이 뽑아둔다 — 별도 요청 없이 공짜다.
    snap.docs.forEach((d) => {
      const data = d.data();
      if (data.fileName && typeof data.charIndex === 'number' && data.totalChars) {
        recentFileProgress[data.fileName] = { charIndex: data.charIndex, totalChars: data.totalChars };
      }
    });
  } catch (err) {
    console.error('이어보기 불러오기 실패:', err);
    recentFileNames = [];
  }
}

// 💡 오프라인 폴백 — 서재 화면(파일 목록/폴더 구조/이어보기)을 통째로 로컬에 스냅샷
// 해뒀다가, 온라인 요청이 실패하면(주로 오프라인) 그대로 복원해서 보여준다. 그래야
// "온라인이든 오프라인이든 내 서재는 항상 같은 목록을 보여준다"는 원칙이 지켜진다 —
// 캐싱된 책인지 아닌지(흐림 표시)는 이 목록 자체와 무관하게 renderLibraryView가
// offline-cache.js를 따로 확인해서 표시한다.
function offlineLibrarySnapshotKey() {
  return 'offlineLibrarySnapshot:' + (currentUser ? currentUser.uid : 'anon');
}
function saveOfflineLibrarySnapshot() {
  try {
    localStorage.setItem(offlineLibrarySnapshotKey(), JSON.stringify({
      allStorageFileNames, folders: libraryFolders, fileFolder: fileFolderMap, itemOrder, recentFileNames, recentFileProgress
    }));
  } catch (err) {
    // 캐싱 실패해도(용량 초과 등) 방금 온라인으로 받아온 목록 자체는 정상 표시되니 조용히 넘어간다
  }
}
// 성공하면 true를 돌려주며 모듈 상태(allStorageFileNames 등)를 스냅샷 값으로 채운다.
function loadOfflineLibrarySnapshot() {
  try {
    const raw = localStorage.getItem(offlineLibrarySnapshotKey());
    if (!raw) return false;
    const data = JSON.parse(raw);
    allStorageFileNames = Array.isArray(data.allStorageFileNames) ? data.allStorageFileNames : [];
    libraryFolders = Array.isArray(data.folders) ? data.folders : [];
    fileFolderMap = (data.fileFolder && typeof data.fileFolder === 'object') ? data.fileFolder : {};
    itemOrder = (data.itemOrder && typeof data.itemOrder === 'object') ? data.itemOrder : {};
    recentFileNames = Array.isArray(data.recentFileNames) ? data.recentFileNames : [];
    recentFileProgress = (data.recentFileProgress && typeof data.recentFileProgress === 'object') ? data.recentFileProgress : {};
    return true;
  } catch (err) {
    return false;
  }
}

// 캐싱된 책들의 서버 내용이 바뀌었는지 가볍게(다운로드 없이 메타데이터만) 확인한다.
// 결과는 지금 당장 반영되지 않는다 — reader.js의 loadFileFromStorage가 다음에 그
// 책을 열 때 isBookStale()로 확인해서, 낡았으면 캐시 대신 새로 받아온다. 즉 "책을
// 열 때마다"가 아니라 "내 서재가 열릴 때" 한 번, 그것도 화면 렌더링을 막지 않고
// 백그라운드로 조용히 돈다.
function checkOfflineCacheFreshness() {
  refreshStaleFlags(async (fileName) => {
    try {
      const meta = await getMetadata(ref(storage, 'books/' + fileName));
      return { updated: meta.updated, size: meta.size };
    } catch (err) {
      return null; // 그 파일이 삭제됐거나 권한 문제 등 — 이번엔 건너뛰고 다음 기회에 다시 확인
    }
  }).catch((err) => console.error('오프라인 캐시 신선도 확인 실패:', err));
}

// 1. Storage 파일 목록 불러오기 (+ 폴더 메타데이터 + 이어보기)
export async function fetchFileList() {
  renderLibraryMessage('서재 불러오는 중...');

  if (!navigator.onLine) {
    // 이미 오프라인인 걸 아는 상태면 굳이 네트워크 요청을 시도해서 실패를 기다릴 필요 없이
    // 곧바로 로컬 스냅샷으로 보여준다. (신선도 확인도 당연히 건너뛴다 — 서버에 물어볼 수 없다)
    if (loadOfflineLibrarySnapshot()) {
      renderLibraryView();
    } else {
      renderLibraryMessage('오프라인 상태이고, 저장된 서재 정보가 아직 없어요', true);
    }
    return;
  }

  const listRef = ref(storage, 'books/');
  try {
    const [res] = await Promise.all([listAll(listRef), loadLibraryState(), loadRecentFileNames()]);
    allStorageFileNames = res.items.map((itemRef) => itemRef.name);
    // Storage에 더 이상 없는(개명 등으로 사라진) 이름이 최근 목록에 남아있지 않게 거른다
    recentFileNames = recentFileNames.filter((name) => allStorageFileNames.includes(name));
    saveOfflineLibrarySnapshot();
    renderLibraryView();
    checkOfflineCacheFreshness();
  } catch (err) {
    console.error(err);
    // navigator.onLine은 "온라인"으로 보고했는데 실제 요청은 실패하는 경우(와이파이는
    // 잡히지만 인터넷은 안 되는 등)에도 마찬가지로 로컬 스냅샷으로 대체한다.
    if (loadOfflineLibrarySnapshot()) {
      setStatus('최신 목록을 불러오지 못해 저장된 정보로 보여드려요');
      renderLibraryView();
    } else {
      renderLibraryMessage('목록 로드 실패', true);
    }
  }
}

function renderLibraryMessage(text, isError) {
  fileListElement.innerHTML = '';
  const li = document.createElement('li');
  li.className = 'file-list-message';
  if (isError) li.classList.add('error');
  li.textContent = text;
  fileListElement.appendChild(li);
}

// 📁 지금 보고 있는 폴더(currentFolderId) 기준으로 하위 폴더 + 파일을 그리고,
// 상단 경로(breadcrumb)도 같이 갱신한다. 폴더 CRUD/이동/이름변경/업로드 등
// 목록에 영향을 주는 동작 뒤에는 항상 이 함수를 다시 부른다.
function renderLibraryView() {
  // 새 폴더 만들기도 관리자만 — 매 렌더마다 다시 맞춰도 비용이 거의 없어서
  // 로그인 시점 한 번이 아니라 여기서 같이 처리한다.
  document.getElementById('new-folder-btn').style.display = isAdminUser() ? '' : 'none';
  renderLibraryBreadcrumb();
  renderRecentFilesSection();
  fileListElement.innerHTML = '';

  const childFolders = getChildFolders(currentFolderId);
  const childFileNames = allStorageFileNames
    .filter((name) => (fileFolderMap[name] || null) === (currentFolderId || null));

  if (childFolders.length === 0 && childFileNames.length === 0) {
    renderLibraryMessage(currentFolderId ? '이 폴더는 비어 있습니다.' : '업로드된 파일이 없습니다.');
    return;
  }

  orderedLibraryItems(currentFolderId, childFolders, childFileNames).forEach((item) => {
    if (item.type === 'folder') {
      fileListElement.appendChild(createFolderListItem(item.folder));
      return;
    }
    const li = createFileListItem(item.name, () => {
      // #book-stage가 실제 크기를 가지려면 뷰어 화면이 먼저 보여야 한다
      // (숨겨진 상태에서 페이지 크기를 재면 0으로 계산되어 버림)
      showViewerScreen();
      if (isDevUser()) loadDevTestFile(); else loadFileFromStorage(item.name);
    });
    if (item.name === currentFileName) li.classList.add('active');
    fileListElement.appendChild(li);
  });

  setupLibraryDragAndDrop();
}

// 폴더+파일을 하나의 순서로 합친다 — 손잡이(⠿)로 직접 정한 순서(itemOrder)가
// 있으면 그걸 먼저 따르고, 아직 손대지 않은 새 항목들은 "폴더 먼저, 이름순"으로
// 그 뒤에 자연스럽게 붙는다(예전 기본 정렬과 동일).
function orderedLibraryItems(parentId, folders, fileNames) {
  const order = itemOrder[orderParentKey(parentId)] || [];
  const folderByKey = new Map(folders.map((f) => [folderItemKey(f.id), f]));
  const fileKeySet = new Set(fileNames.map(fileItemKey));
  const seen = new Set();
  const items = [];

  order.forEach((key) => {
    if (folderByKey.has(key)) {
      items.push({ type: 'folder', folder: folderByKey.get(key) });
      seen.add(key);
    } else if (fileKeySet.has(key)) {
      items.push({ type: 'file', name: key.slice('file:'.length) });
      seen.add(key);
    }
  });

  folders
    .filter((f) => !seen.has(folderItemKey(f.id)))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    .forEach((f) => items.push({ type: 'folder', folder: f }));
  fileNames
    .filter((n) => !seen.has(fileItemKey(n)))
    .sort((a, b) => a.localeCompare(b, 'ko'))
    .forEach((n) => items.push({ type: 'file', name: n }));

  return items;
}

// 이어보기 — 폴더 안까지 들어가도 계속 보인다. "지금 읽던 책 하나로 바로
// 이어지기"가 목적이라, 서재 어디를 보고 있든(루트든 폴더 안이든) 상관없이
// 항상 접근 가능해야 자연스럽다 — 예전엔 루트에서만 보이게 했었지만, "최근 파일
// 여러 개 중 고르는 목록"이 아니라 "이어보기 전용 UI"로 성격이 바뀌면서 이 제약이
// 안 맞게 됐다.
function renderRecentFilesSection() {
  const section = document.getElementById('recent-files-section');
  const listEl = document.getElementById('recent-file-list');
  listEl.innerHTML = '';

  if (recentFileNames.length === 0) {
    section.style.display = 'none';
    reserveSpaceForRecentCard(0);
    return;
  }
  section.style.display = '';
  recentFileNames.forEach((name) => listEl.appendChild(createRecentFileListItem(name)));
  // "이어보기"가 화면 아래에 딱 붙어 고정돼 있어서, "내 서재" 카드가 그 밑에
  // 깔려 가려지지 않도록 실제 렌더된 높이만큼 위쪽에 여백을 남겨준다(카드 자체는
  // 화면 하단 여백이 없으니, 두 카드 사이 숨쉴 틈만 더하면 된다).
  const height = section.getBoundingClientRect().height;
  reserveSpaceForRecentCard(height + 14);
}

function reserveSpaceForRecentCard(px) {
  document.documentElement.style.setProperty('--recent-card-reserve', px + 'px');
}

function createRecentFileListItem(fileName) {
  const li = document.createElement('li');
  if (fileName === currentFileName) li.classList.add('active');

  // 1권만 남은 카드라 아이콘도 목록용(20px)보다 눈에 띄게 키운다.
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', '30');
  icon.setAttribute('height', '30');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '1.8');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('class', 'file-item-icon');
  icon.innerHTML = '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>';

  // 제목과(있으면) 진행률 바를 세로로 쌓는다 — 아이콘/폴더 배지는 그대로 li의
  // 가로 flex 줄에 남고, 이 안쪽만 따로 쌓이는 구조.
  const info = document.createElement('div');
  info.className = 'recent-progress-info';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'file-item-name';
  nameSpan.textContent = fileName;
  info.appendChild(nameSpan);

  // 진행률(%) — reading_progress에서 이미 불러와둔 charIndex/totalChars가 있을 때만 보여준다.
  // 예전 형식으로 저장된 진행상황(totalChars 없음)이면 조용히 생략한다.
  const progress = recentFileProgress[fileName];
  if (progress && progress.totalChars > 0) {
    const percent = Math.min(100, Math.max(0, Math.round((progress.charIndex / progress.totalChars) * 100)));
    const row = document.createElement('div');
    row.className = 'recent-progress-row';
    const track = document.createElement('div');
    track.className = 'recent-progress-track';
    const fill = document.createElement('div');
    fill.className = 'recent-progress-fill';
    fill.style.width = percent + '%';
    track.appendChild(fill);
    const pct = document.createElement('span');
    pct.className = 'recent-progress-pct';
    pct.textContent = percent + '%';
    row.appendChild(track);
    row.appendChild(pct);
    info.appendChild(row);
  }

  li.appendChild(icon);
  li.appendChild(info);

  // 이 파일이 실제로 어느 폴더 안에 있는지 작은 배지로 — 폴더를 안 뒤져도 위치를 알 수 있게
  const folder = fileFolderMap[fileName] ? getFolderById(fileFolderMap[fileName]) : null;
  if (folder) {
    const hint = document.createElement('span');
    hint.className = 'recent-file-folder-hint';
    hint.textContent = folder.name;
    li.appendChild(hint);
  }

  li.onclick = () => {
    showViewerScreen();
    if (isDevUser()) loadDevTestFile(); else loadFileFromStorage(fileName);
  };
  return li;
}

function renderLibraryBreadcrumb() {
  const el = document.getElementById('library-breadcrumb');
  el.innerHTML = '';

  // 루트("내 서재")에 있을 땐 이 줄 자체를 숨긴다 — 바로 위 패널 제목이 이미
  // "내 서재"라서, 여기서 또 같은 말을 하는 건 반복일 뿐 아무 정보도 안 준다.
  // 폴더 안으로 들어갔을 때만(=실제로 "경로"라고 부를 게 생겼을 때만) 보여준다.
  if (!currentFolderId) {
    el.style.display = 'none';
    return;
  }
  el.style.display = '';

  const currentFolder = getFolderById(currentFolderId);
  const upBtn = document.createElement('button');
  upBtn.type = 'button';
  upBtn.className = 'breadcrumb-up-btn';
  upBtn.title = '상위 폴더로';
  upBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
  upBtn.addEventListener('click', () => {
    currentFolderId = currentFolder ? (currentFolder.parentId || null) : null;
    renderLibraryView();
  });
  el.appendChild(upBtn);

  const rootBtn = document.createElement('button');
  rootBtn.type = 'button';
  rootBtn.className = 'breadcrumb-item';
  rootBtn.textContent = '내 서재';
  rootBtn.dataset.folderId = '';
  rootBtn.addEventListener('click', () => { currentFolderId = null; renderLibraryView(); });
  el.appendChild(rootBtn);

  folderBreadcrumbPath(currentFolderId).forEach((folder) => {
    const sep = document.createElement('span');
    sep.className = 'breadcrumb-sep';
    sep.textContent = '›';
    el.appendChild(sep);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'breadcrumb-item';
    btn.textContent = folder.name;
    btn.dataset.folderId = folder.id;
    if (folder.id === currentFolderId) btn.classList.add('breadcrumb-current');
    btn.addEventListener('click', () => { currentFolderId = folder.id; renderLibraryView(); });
    el.appendChild(btn);
  });
}

// 2. 파일 업로드 — 여러 개를 한 번에 선택할 수 있고(멀티 업로드), 지금 보고 있는
// 폴더 안으로 바로 들어간다. 업로드가 끝나도 그 책을 바로 열지 않고 목록 화면에
// 그대로 머문다 — 여러 권을 올렸을 때 "그중 뭘 열지"를 사용자가 직접 고르게 한다.
document.getElementById('file-input').addEventListener('change', async (e) => {
  const selectedFiles = Array.from(e.target.files || []);
  e.target.value = ''; // 같은 파일(들)을 다시 선택해도 change가 또 발생하도록 초기화
  if (selectedFiles.length === 0) return;

  // <input accept=".txt">는 OS 파일 선택창의 필터일 뿐이라("모든 파일"로 바꾸면
  // 뭐든 고를 수 있다) 실제로 올리기 전에 확장자를 한 번 더 검사해야 진짜로
  // .txt만 들어온다. 대소문자 구분 없이 .txt로 끝나는 것만 통과시킨다.
  const files = selectedFiles.filter((f) => /\.txt$/i.test(f.name));
  const rejectedCount = selectedFiles.length - files.length;
  if (files.length === 0) {
    setStatus('.txt 파일만 업로드할 수 있어요');
    return;
  }
  if (blockedWhileOffline()) return;

  // 개발자 세션은 실제 Storage 계정이 없어서 업로드가 될 수 없다 — 버튼 자체는
  // 실사용자 화면과 똑같이 보여주되(요청사항), 시도하면 실패할 real 네트워크
  // 요청을 굳이 보내는 대신 조용히 안내만 하고 끝낸다.
  if (isDevUser()) {
    setStatus("개발자 모드에서는 업로드를 지원하지 않아요");
    return;
  }

  setStatus(files.length > 1 ? `${files.length}개 파일 업로드 중...` : "Storage 업로드 중...");

  // 폴더 구조는 관리자만 바꿀 수 있어서, 관리자가 아니면 지금 어느 폴더를 보고
  // 있었든 업로드된 파일은 항상 루트("내 서재")에 놓인다 — 정리는 관리자 몫.
  const assignFolder = isAdminUser() && currentFolderId;
  const results = await Promise.allSettled(files.map(async (file) => {
    await uploadBytes(ref(storage, 'books/' + file.name), file);
    if (assignFolder) fileFolderMap[file.name] = currentFolderId;
  }));

  const failCount = results.filter((r) => r.status === 'rejected').length;
  let folderSaveOk = true;
  if (assignFolder && failCount < results.length) folderSaveOk = await saveLibraryState();

  if (failCount > 0) {
    setStatus(`${files.length - failCount}개 성공, ${failCount}개 실패`);
  } else if (!folderSaveOk) {
    setStatus('업로드는 됐지만 폴더 지정에 실패했어요');
  } else if (rejectedCount > 0) {
    setStatus(`${files.length}개 업로드 완료 (.txt 아닌 ${rejectedCount}개 제외)`);
  } else {
    setStatus(files.length > 1 ? `${files.length}개 파일 업로드 완료!` : "업로드 완료!");
  }
  await fetchFileList();
});

// ── 서재 시트 공통: 텍스트 입력(이름/새 폴더) ──────────────────────────
let textInputResolver = null;
function promptTextInput(title, defaultValue, onConfirm) {
  document.getElementById('text-input-title').textContent = title;
  const field = document.getElementById('text-input-field');
  field.value = defaultValue || '';
  textInputResolver = onConfirm;
  openSheet('text-input-panel');
  setTimeout(() => { field.focus(); field.select(); }, 0);
}
document.getElementById('text-input-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const value = document.getElementById('text-input-field').value.trim();
  const resolver = textInputResolver;
  textInputResolver = null;
  closeSheet('text-input-panel');
  if (value && resolver) resolver(value);
});

// ── 서재 시트 공통: 폴더 트리에서 하나 고르기(이동 대상) ────────────────
let folderPickerResolver = null;
// excludeIds에 담긴 폴더는 후보에서 뺀다 — 폴더를 자기 자신/자손 안으로 옮기면
// 순환 구조가 생기기 때문에(moveFolderPrompt에서 getFolderAndDescendantIds로 채운다).
function promptFolderPicker(title, excludeIds, onPick) {
  document.getElementById('folder-picker-title').textContent = title;
  const listEl = document.getElementById('folder-picker-list');
  listEl.innerHTML = '';
  folderPickerResolver = onPick;

  const pick = (folderId) => {
    closeSheet('folder-picker-panel');
    const resolver = folderPickerResolver;
    folderPickerResolver = null;
    if (resolver) resolver(folderId);
  };

  const rootLi = document.createElement('li');
  const rootBtn = document.createElement('button');
  rootBtn.type = 'button';
  rootBtn.className = 'folder-picker-item';
  rootBtn.textContent = '📁 내 서재';
  rootBtn.addEventListener('click', () => pick(null));
  rootLi.appendChild(rootBtn);
  listEl.appendChild(rootLi);

  (function addLevel(parentId, depth) {
    getChildFolders(parentId).forEach((folder) => {
      if (excludeIds.includes(folder.id)) return;
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'folder-picker-item';
      btn.style.paddingLeft = (16 + depth * 18) + 'px';
      btn.textContent = '📁 ' + folder.name;
      btn.addEventListener('click', () => pick(folder.id));
      li.appendChild(btn);
      listEl.appendChild(li);
      addLevel(folder.id, depth + 1);
    });
  })(null, 0);

  openSheet('folder-picker-panel');
}

// ── 서재 시트 공통: 파일/폴더 "⋮" 액션 목록 ────────────────────────────
// storage-stats.js도 "로컬스토리지 현황" 카테고리별 관리 시트(전체 삭제 + 책별 삭제
// 목록)를 여는 데 이 함수를 그대로 재사용한다 — 시트 구조가 완전히 같아서
// (제목 + danger 버튼 나열) 새로 만들 이유가 없다.
export function openItemActionSheet(title, actions) {
  document.getElementById('item-action-title').textContent = title;
  const listEl = document.getElementById('item-action-list');
  listEl.innerHTML = '';
  actions.forEach((action) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'item-action-btn' + (action.danger ? ' danger' : '');
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      closeSheet('item-action-panel');
      action.onClick();
    });
    listEl.appendChild(btn);
  });
  openSheet('item-action-panel');
}

function openFileActionSheet(fileName) {
  openItemActionSheet(fileName, [
    { label: '이름 변경', onClick: () => renameFilePrompt(fileName) },
    { label: '이동', onClick: () => moveFilePrompt(fileName) },
    { label: '삭제', danger: true, onClick: () => deleteFileConfirm(fileName) },
  ]);
}

function openFolderActionSheet(folderId) {
  const folder = getFolderById(folderId);
  if (!folder) return;
  openItemActionSheet(folder.name, [
    { label: '이름 변경', onClick: () => renameFolderPrompt(folderId) },
    { label: '이동', onClick: () => moveFolderPrompt(folderId) },
    { label: '삭제', danger: true, onClick: () => deleteFolderConfirm(folderId) },
  ]);
}

// ── 폴더: 새로 만들기 / 이름수정 / 이동(경로변경) / 삭제 ─────────────────
document.getElementById('new-folder-btn').addEventListener('click', () => {
  promptTextInput('새 폴더 이름', '', async (name) => {
    if (blockedWhileOffline()) return;
    libraryFolders.push({ id: newFolderId(), name, parentId: currentFolderId });
    const ok = await saveLibraryState();
    renderLibraryView();
    if (ok) setStatus('폴더를 만들었어요');
  });
});

function renameFolderPrompt(folderId) {
  const folder = getFolderById(folderId);
  if (!folder) return;
  promptTextInput('폴더 이름 변경', folder.name, async (name) => {
    if (blockedWhileOffline()) return;
    folder.name = name;
    await saveLibraryState();
    renderLibraryView();
  });
}

function moveFolderPrompt(folderId) {
  const excludeIds = getFolderAndDescendantIds(folderId);
  promptFolderPicker('이 폴더를 옮길 위치', excludeIds, (targetFolderId) => moveFolderTo(folderId, targetFolderId));
}

async function moveFolderTo(folderId, targetFolderId) {
  if (blockedWhileOffline()) return;
  if (targetFolderId === folderId) return;
  if (getFolderAndDescendantIds(folderId).includes(targetFolderId)) return; // 순환 방지
  const folder = getFolderById(folderId);
  if (!folder) return;
  if ((folder.parentId || null) === (targetFolderId || null)) return; // 이미 그 자리
  folder.parentId = targetFolderId;
  removeFromItemOrder(folderItemKey(folderId));
  const ok = await saveLibraryState();
  renderLibraryView();
  if (ok) setStatus('폴더를 이동했어요');
}

// 폴더를 지우면 그 안의 파일/하위 폴더는 사라지지 않고 상위 폴더로 올라간다 —
// 책 파일을 실수로 잃는 게 폴더 정리보다 훨씬 치명적이라 "폴더만 없애기"를 기본으로 한다.
async function deleteFolderConfirm(folderId) {
  if (blockedWhileOffline()) return;
  const folder = getFolderById(folderId);
  if (!folder) return;
  const confirmed = confirm(`"${folder.name}" 폴더를 삭제할까요?\n안에 있던 파일/폴더는 상위 폴더로 옮겨집니다.`);
  if (!confirmed) return;

  const parentId = folder.parentId || null;
  libraryFolders.filter((f) => f.parentId === folderId).forEach((f) => { f.parentId = parentId; });
  Object.keys(fileFolderMap).forEach((name) => {
    if (fileFolderMap[name] === folderId) {
      if (parentId) fileFolderMap[name] = parentId; else delete fileFolderMap[name];
    }
  });
  libraryFolders = libraryFolders.filter((f) => f.id !== folderId);
  removeFromItemOrder(folderItemKey(folderId));
  delete itemOrder[folderId]; // 이 폴더 "안"에서의 순서 기록도 같이 정리(안의 항목들은 상위로 옮겨지며 순서가 새로 매겨짐)

  if (currentFolderId === folderId) currentFolderId = parentId;
  const ok = await saveLibraryState();
  renderLibraryView();
  if (ok) setStatus('폴더를 삭제했어요');
}

// ── 파일: 이름변경 / 이동(저장 경로 변경) ────────────────────────────
function moveFilePrompt(fileName) {
  promptFolderPicker('이 파일을 옮길 위치', [], async (targetFolderId) => {
    if (blockedWhileOffline()) return;
    if (targetFolderId) fileFolderMap[fileName] = targetFolderId; else delete fileFolderMap[fileName];
    removeFromItemOrder(fileItemKey(fileName));
    const ok = await saveLibraryState();
    renderLibraryView();
    if (ok) setStatus('파일을 이동했어요');
  });
}

function renameFilePrompt(fileName) {
  if (isDevUser()) {
    setStatus('개발자 모드에서는 이름 변경을 지원하지 않아요');
    return;
  }
  promptTextInput('이름 변경', fileName, (newName) => renameFile(fileName, newName));
}

// Storage에는 rename API가 없어서 "다운로드 → 새 이름으로 업로드 → 옛 파일 삭제"로
// 흉내낸다. 진행상황/책갈피는 파일명 기반 문서 ID(fileDocId)로 저장돼 있으므로,
// migrateFileDocs로 그 문서들도 새 ID로 옮겨야 이어보기/책갈피가 끊기지 않는다.
async function renameFile(oldName, newName) {
  if (blockedWhileOffline()) return;
  newName = newName.trim();
  if (!newName || newName === oldName) return;
  if (allStorageFileNames.includes(newName)) {
    setStatus('이미 같은 이름의 파일이 있어요');
    return;
  }

  setStatus('이름 변경 중...');
  try {
    const oldRef = ref(storage, 'books/' + oldName);
    const newRef = ref(storage, 'books/' + newName);
    const bytes = await getBytes(oldRef);
    await uploadBytes(newRef, bytes);
    await deleteObject(oldRef);
    // 오프라인 책 캐시가 옛 이름으로 고아처럼 남지 않도록 같이 옮겨준다.
    renameCachedBook(oldName, newName);

    // 실패해도(권한 문제 등) 이름 변경 자체는 이미 끝났으니 조용히 넘어간다 —
    // 최악의 경우 이어보기 위치/책갈피만 리셋되는 정도라 파일을 잃는 것보단 낫다.
    await migrateFileDocs(oldName, newName).catch((err) => console.error('문서 이전 실패:', err));

    if (fileFolderMap[oldName]) {
      fileFolderMap[newName] = fileFolderMap[oldName];
      delete fileFolderMap[oldName];
    }
    // 순서를 직접 정해뒀던 자리가 있다면(어느 폴더 소속이었든) 새 이름으로 키만 갈아끼운다
    Object.keys(itemOrder).forEach((parent) => {
      itemOrder[parent] = itemOrder[parent].map((k) => (k === fileItemKey(oldName) ? fileItemKey(newName) : k));
    });
    const folderStateSaved = await saveLibraryState();

    if (currentFileName === oldName) {
      setCurrentFileName(newName);
      document.getElementById('current-title').textContent = newName;
      localStorage.setItem(lastOpenedFileKey(), newName);
    }

    setStatus(folderStateSaved ? '이름을 변경했어요' : '이름은 변경했지만 폴더 정보 저장에 실패했어요');
    await fetchFileList();
  } catch (err) {
    console.error(err);
    setStatus('이름 변경 실패');
  }
}

async function migrateFileDocs(oldName, newName) {
  const oldId = fileDocId(oldName);
  const newId = fileDocId(newName);
  for (const collectionName of ['reading_progress', 'bookmarks']) {
    const oldDocRef = doc(db, "users", currentUser.uid, collectionName, oldId);
    const snap = await getDoc(oldDocRef);
    if (snap.exists()) {
      await setDoc(doc(db, "users", currentUser.uid, collectionName, newId), { ...snap.data(), fileName: newName });
      await deleteDoc(oldDocRef);
    }
  }
}

// 파일 삭제 — books/에서 실제로 지운다(되돌릴 수 없음, 그래서 확인창 하나 거친다).
// ⚠️ 지금 이 파일을 읽고 있던 "다른" 회원들의 이어보기/책갈피 기록은 각자 계정
// 밑(users/{uid}/...)에 있어서 관리자 세션에서는 건드릴 수 없다 — 그 파일을 가리키는
// 채로 orphan으로 남지만(재사용 안 되는 한 무해), 관리자 자신의 기록만 같이 정리한다.
async function deleteFileConfirm(fileName) {
  if (isDevUser()) {
    setStatus('개발자 모드에서는 삭제를 지원하지 않아요');
    return;
  }
  if (blockedWhileOffline()) return;
  const confirmed = confirm(`"${fileName}" 파일을 완전히 삭제할까요?\n이 동작은 되돌릴 수 없습니다.`);
  if (!confirmed) return;

  setStatus('삭제 중...');
  try {
    await deleteObject(ref(storage, 'books/' + fileName));
    // 지운 파일의 오프라인 캐시(원문·진행상황·책갈피 로컬 캐시)도 같이 정리한다.
    removeCachedBook(fileName);
    clearOfflineProgressAndBookmarks(fileName);

    if (fileFolderMap[fileName]) delete fileFolderMap[fileName];
    removeFromItemOrder(fileItemKey(fileName));
    const folderStateSaved = await saveLibraryState();

    const fid = fileDocId(fileName);
    await deleteDoc(doc(db, "users", currentUser.uid, "reading_progress", fid)).catch(() => {});
    await deleteDoc(doc(db, "users", currentUser.uid, "bookmarks", fid)).catch(() => {});

    if (currentFileName === fileName) setCurrentFileName("");

    setStatus(folderStateSaved ? '삭제했어요' : '파일은 지웠지만 폴더 정보 저장에 실패했어요');
    await fetchFileList();
  } catch (err) {
    console.error(err);
    setStatus('삭제 실패');
  }
}

// ── 드래그 앤 드롭: 파일/폴더를 폴더 위로(또는 상단 경로로) 끌어다 놓으면 이동 ──
// 데스크톱(마우스)은 클릭+이동을 바로 드래그로 취급하지만, 모바일(터치)에서는
// 목록을 손가락으로 스크롤하는 동작과 구분해야 해서 살짝 눌러 붙잡고 있어야
// (long-press) 드래그가 시작된다 — 짧게 스치는 스와이프는 그냥 스크롤로 남는다.
const DRAG_MOVE_THRESHOLD = 8;
const TOUCH_HOLD_MS = 350;
const TOUCH_HOLD_CANCEL_DISTANCE = 10;

function setupLibraryDragAndDrop() {
  if (!isAdminUser()) return; // 드래그 결과는 결국 "이동"이라 관리자만
  fileListElement.querySelectorAll('li[data-draggable]').forEach((li) => {
    li.addEventListener('pointerdown', onLibraryItemPointerDown);
  });
}

function onLibraryItemPointerDown(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const li = e.currentTarget;
  const kind = li.dataset.draggable; // 'file' | 'folder'
  const id = kind === 'file' ? li.dataset.fileName : li.dataset.folderId;
  const isTouch = e.pointerType !== 'mouse';

  const startX = e.clientX, startY = e.clientY;
  let dragging = false;
  let ghost = null;
  let currentDropTarget = null;
  let holdTimer = null;

  function armDrag() {
    if (dragging) return;
    dragging = true;
    li.classList.add('dragging-source');
    ghost = li.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.style.width = li.getBoundingClientRect().width + 'px';
    document.body.appendChild(ghost);
    positionGhost(startX, startY);
  }

  function positionGhost(x, y) {
    if (ghost) { ghost.style.left = x + 'px'; ghost.style.top = y + 'px'; }
  }

  function updateDropTarget(x, y) {
    if (currentDropTarget) currentDropTarget.classList.remove('drop-target-hover');
    currentDropTarget = null;
    if (ghost) ghost.style.pointerEvents = 'none';
    const below = document.elementFromPoint(x, y);
    if (ghost) ghost.style.pointerEvents = '';
    const folderLi = below && below.closest('li.folder-item[data-draggable]');
    const breadcrumbBtn = below && below.closest('.breadcrumb-item');

    if (folderLi && folderLi !== li) {
      if (kind === 'folder' && getFolderAndDescendantIds(id).includes(folderLi.dataset.folderId)) {
        return; // 자기 자신/자손 위로는 옮길 수 없음 — 표시하지 않는다
      }
      currentDropTarget = folderLi;
      folderLi.classList.add('drop-target-hover');
    } else if (breadcrumbBtn) {
      currentDropTarget = breadcrumbBtn;
      breadcrumbBtn.classList.add('drop-target-hover');
    }
  }

  function onMove(ev) {
    if (!dragging) {
      const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
      if (isTouch) {
        if (dist > TOUCH_HOLD_CANCEL_DISTANCE) cleanup(); // 스크롤 의도로 판단 — 드래그 취소
      } else if (dist > DRAG_MOVE_THRESHOLD) {
        armDrag();
      }
      return;
    }
    ev.preventDefault(); // 드래그 중엔 페이지 스크롤(터치)이 같이 일어나지 않게 막는다
    positionGhost(ev.clientX, ev.clientY);
    updateDropTarget(ev.clientX, ev.clientY);
  }

  function finish() {
    clearTimeout(holdTimer);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', finish);
    document.removeEventListener('pointercancel', cleanup);

    if (!dragging) return;
    li.classList.remove('dragging-source');
    if (ghost) ghost.remove();
    if (currentDropTarget) currentDropTarget.classList.remove('drop-target-hover');

    if (currentDropTarget) {
      const targetFolderId = currentDropTarget.dataset.folderId || null;
      performLibraryMove(kind, id, targetFolderId);
    }

    // 방금 드래그였다면(아무 데도 못 놓고 그냥 들었다 놨어도), 뒤이어 뜨는
    // click(=열기/이동) 이벤트를 한 번 무시한다.
    suppressNextClick(li);
  }

  function cleanup() {
    clearTimeout(holdTimer);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', finish);
    document.removeEventListener('pointercancel', cleanup);
    if (dragging) {
      li.classList.remove('dragging-source');
      if (ghost) ghost.remove();
      if (currentDropTarget) currentDropTarget.classList.remove('drop-target-hover');
      // pointercancel로 드래그가 중간에 끊겨도(제스처를 OS/브라우저가 가로채는 등)
      // finish()와 똑같이 뒤이어 올 수 있는 click을 무시해야 한다 — 여기 빠져있던
      // 게 "드래그했다가 아무 데도 안 놓았는데 파일이 열리는" 버그의 한 경로였다.
      suppressNextClick(li);
    }
    dragging = true; // onMove가 더 이상 armDrag를 시도하지 않도록
  }

  if (isTouch) {
    holdTimer = setTimeout(armDrag, TOUCH_HOLD_MS);
  }

  document.addEventListener('pointermove', onMove, { passive: false });
  document.addEventListener('pointerup', finish);
  document.addEventListener('pointercancel', cleanup);
}

async function performLibraryMove(kind, id, targetFolderId) {
  if (blockedWhileOffline()) return;
  if (kind === 'file') {
    if ((fileFolderMap[id] || null) === (targetFolderId || null)) return;
    if (targetFolderId) fileFolderMap[id] = targetFolderId; else delete fileFolderMap[id];
    removeFromItemOrder(fileItemKey(id));
  } else {
    if (targetFolderId === id) return;
    if (getFolderAndDescendantIds(id).includes(targetFolderId)) return;
    const folder = getFolderById(id);
    if (!folder || (folder.parentId || null) === (targetFolderId || null)) return;
    folder.parentId = targetFolderId;
    removeFromItemOrder(folderItemKey(id));
  }
  const ok = await saveLibraryState();
  renderLibraryView();
  if (ok) setStatus('이동했어요');
}

// itemKey를 (있다면) 어느 부모의 순서 배열에서든 지운다 — 파일/폴더를 다른 폴더로
// 옮기거나 삭제했을 때, 예전 자리의 순서 기록이 남아있지 않게 정리하는 용도.
function removeFromItemOrder(itemKey) {
  Object.keys(itemOrder).forEach((parent) => {
    const idx = itemOrder[parent].indexOf(itemKey);
    if (idx !== -1) itemOrder[parent].splice(idx, 1);
  });
}

// ── 순서변경(⠿ 손잡이) 드래그 — 폴더로 옮기는 드래그와는 별개로, 같은 폴더
// 안에서 위/아래 어디에 놓았는지만 본다. 폴더 드롭존 판정이 전혀 없어서
// "폴더로 넣기"랑 겹칠 일이 없다.
function libraryItemKeyFromLi(li) {
  return li.dataset.draggable === 'folder' ? folderItemKey(li.dataset.folderId) : fileItemKey(li.dataset.fileName);
}

function onReorderHandlePointerDown(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const li = e.currentTarget.closest('li[data-draggable]');
  if (!li) return;

  const startX = e.clientX, startY = e.clientY;
  let dragging = false;
  let ghost = null;

  function armDrag() {
    dragging = true;
    li.classList.add('dragging-source');
    fileListElement.classList.add('reordering'); // hover 배경 끄고 삽입선만 보이게
    ghost = li.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.style.width = li.getBoundingClientRect().width + 'px';
    document.body.appendChild(ghost);
    positionGhost(startX, startY);
  }
  function positionGhost(x, y) {
    if (ghost) { ghost.style.left = x + 'px'; ghost.style.top = y + 'px'; }
  }
  function clearInsertMarkers() {
    fileListElement.querySelectorAll('.reorder-insert-before, .reorder-insert-after')
      .forEach((el) => el.classList.remove('reorder-insert-before', 'reorder-insert-after'));
  }
  function siblingsExcludingSelf() {
    return Array.from(fileListElement.querySelectorAll('li[data-draggable]')).filter((el) => el !== li);
  }
  // 포인터 y좌표 기준으로 "이 형제 바로 위에 놓일 것"을 찾는다. 못 찾으면(맨 아래로
  // 내려간 경우) null — 그때는 마지막 형제 아래에 삽입선을 대신 그려서 보여준다.
  function findInsertBefore(y) {
    for (const sib of siblingsExcludingSelf()) {
      const rect = sib.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) return sib;
    }
    return null;
  }
  function updateInsertMarker(y) {
    clearInsertMarkers();
    const before = findInsertBefore(y);
    if (before) {
      before.classList.add('reorder-insert-before');
    } else {
      const sibs = siblingsExcludingSelf();
      if (sibs.length > 0) sibs[sibs.length - 1].classList.add('reorder-insert-after');
    }
  }

  function onMove(ev) {
    if (!dragging) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > DRAG_MOVE_THRESHOLD) armDrag();
      return;
    }
    ev.preventDefault();
    positionGhost(ev.clientX, ev.clientY);
    updateInsertMarker(ev.clientY);
  }

  function finish(ev) {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', finish);
    document.removeEventListener('pointercancel', cleanup);
    if (!dragging) return;

    const insertBefore = findInsertBefore(ev.clientY);
    clearInsertMarkers();
    li.classList.remove('dragging-source');
    fileListElement.classList.remove('reordering');
    if (ghost) ghost.remove();

    applyReorder(li, insertBefore);

    suppressNextClick(li);
  }

  function cleanup() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', finish);
    document.removeEventListener('pointercancel', cleanup);
    if (dragging) {
      li.classList.remove('dragging-source');
      fileListElement.classList.remove('reordering');
      if (ghost) ghost.remove();
      clearInsertMarkers();
      suppressNextClick(li); // finish()와 마찬가지로 pointercancel로 끝나도 뒤이은 click을 무시
    }
  }

  document.addEventListener('pointermove', onMove, { passive: false });
  document.addEventListener('pointerup', finish);
  document.addEventListener('pointercancel', cleanup);
}

// 지금 화면에 그려진 순서(=현재 정렬 결과) 그대로를 새 순서의 기준으로 삼아,
// 끌던 항목만 새 위치에 끼워 넣은 뒤 저장한다 — 화면에 안 보이는 항목까지
// 신경 쓸 필요 없이 "보이는 그대로"가 곧 저장되는 순서가 되는 셈.
async function applyReorder(draggedLi, insertBeforeLi) {
  if (blockedWhileOffline()) return;
  const siblings = Array.from(fileListElement.querySelectorAll('li[data-draggable]')).filter((el) => el !== draggedLi);
  const keys = siblings.map(libraryItemKeyFromLi);
  const draggedKey = libraryItemKeyFromLi(draggedLi);

  let insertIndex = keys.length;
  if (insertBeforeLi) {
    const idx = siblings.indexOf(insertBeforeLi);
    if (idx !== -1) insertIndex = idx;
  }
  keys.splice(insertIndex, 0, draggedKey);

  itemOrder[orderParentKey(currentFolderId)] = keys;
  await saveLibraryState();
  renderLibraryView();
}

