// storage-stats.js — 설정 메뉴 > "스토리지 현황" 하위 화면: 로컬에 쌓이는 캐시
// 5종류의 용량을 보여주고, 책 단위(또는 전체) 삭제를 지원한다.
//
// 여기서 다루는 5개 카테고리와 그 실체:
//   1. 오프라인 저장된 책 — offline-cache.js의 IndexedDB(책 원문)
//   2. 읽기 진행상황 · 책갈피 캐시 — localStorage의 devProgress:/devBookmarks:
//      (개발자 세션) 또는 offlineProgress:{uid}:/offlineBookmarks:{uid}: (실사용자)
//   3. 페이지 나누기 캐시 — localStorage의 txtViewerPagination:{fileName}::...
//   4. 서재 구조 · 환경설정 — devLibraryState/offlineLibrarySnapshot:{uid}/
//      txtViewerReaderPrefs/txtViewerLastOpenedFile_*/txtViewerLastEmail
//   5. 앱 실행 파일 — Service Worker Cache Storage(sw.js). 읽기 전용(삭제 버튼 없음) —
//      지우면 오프라인 중 앱 자체가 멈출 위험이 있어서 일부러 뺐다.
//
// ⚠️ 카테고리 2/3/4의 키 형식은 reader.js/library.js에 있는 진짜 키 생성 함수
// (progressCacheKey/bookmarksCacheKey/persistedPaginationKey/offlineLibrarySnapshotKey 등)와
// 정확히 같아야 한다. 그쪽 형식이 바뀌면 여기 접두사/정규식도 같이 고쳐야 한다 —
// reader.js/library.js를 굳이 또 import해서 순환을 늘리는 대신, 여기서 형식을
// 다시 알고 있는 쪽을 택했다(둘 다 이미 서로를 import하는 순환 구조라 더 얽히게
// 하고 싶지 않았다).
//
// 용량은 이 하위 화면이 열릴 때만 계산한다(상시 계산 아님) — Cache Storage 항목별
// blob 크기까지 재는 카테고리 5는 특히 비용이 크다.

import { currentUser, isDevUser } from "./session.js";
import { getAllCachedBooksInfo, clearAllCachedBooks, removeCachedBook } from "./offline-cache.js";
import { openItemActionSheet } from "./library.js";
import { setStatus, openSheet } from "./ui-shared.js";

// localStorage 문자열 하나의 대략적인 저장 용량 추정치 — offline-cache.js의
// estimateBytes와 같은 근사(UTF-16, 글자당 2바이트)를 키+값 양쪽에 적용한다.
function estimateEntryBytes(key, value) {
  return (key.length + (value ? value.length : 0)) * 2;
}

function scanKeysByPrefix(prefix) {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) out.push(key);
  }
  return out;
}

function formatBytes(bytes) {
  if (!bytes) return '0B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return (i === 0 ? n : n.toFixed(1)) + units[i];
}

// ── 카테고리 2: 읽기 진행상황 · 책갈피 캐시 ─────────────────────────────
// reader.js의 progressCacheKey/bookmarksCacheKey(및 dev 버전인 'devProgress:'/
// 'devBookmarks:')와 정확히 같은 접두사.
function progressBookmarkPrefixes() {
  if (isDevUser()) return { progress: 'devProgress:', bookmarks: 'devBookmarks:' };
  const uid = currentUser ? currentUser.uid : 'anon';
  return { progress: 'offlineProgress:' + uid + ':', bookmarks: 'offlineBookmarks:' + uid + ':' };
}

function getProgressBookmarkBooks() {
  const { progress, bookmarks } = progressBookmarkPrefixes();
  const books = new Map(); // fileName -> bytes
  scanKeysByPrefix(progress).forEach((key) => {
    const fileName = key.slice(progress.length);
    books.set(fileName, (books.get(fileName) || 0) + estimateEntryBytes(key, localStorage.getItem(key)));
  });
  scanKeysByPrefix(bookmarks).forEach((key) => {
    const fileName = key.slice(bookmarks.length);
    books.set(fileName, (books.get(fileName) || 0) + estimateEntryBytes(key, localStorage.getItem(key)));
  });
  return Array.from(books.entries()).map(([fileName, bytes]) => ({ fileName, bytes }));
}

function deleteProgressBookmarkBook(fileName) {
  const { progress, bookmarks } = progressBookmarkPrefixes();
  localStorage.removeItem(progress + fileName);
  localStorage.removeItem(bookmarks + fileName);
}

function clearAllProgressBookmarks() {
  const { progress, bookmarks } = progressBookmarkPrefixes();
  scanKeysByPrefix(progress).forEach((key) => localStorage.removeItem(key));
  scanKeysByPrefix(bookmarks).forEach((key) => localStorage.removeItem(key));
}

// ── 카테고리 3: 페이지 나누기 캐시 ─────────────────────────────────────
// reader.js의 persistedPaginationKey()와 정확히 같은 형식:
// 'txtViewerPagination:' + fileName + '::' + width + '::' + height + '::' + fontKey.
// fontKey 자체가 'system:2:1'처럼 ':'를 포함하므로(readerPrefs.fontId + ':' +
// fontSizeStep + ':' + paragraphWidthStep, reader.js 참고) 마지막 그룹은 남은
// 문자열 전부를 가져간다 — '::' 구분자 3개(폭/높이 앞) 위치만 폭·높이가 숫자라는
// 사실로 고정하면, 나머지(파일명 vs 폰트키)는 앞/뒤로 자연히 갈린다.
const PAGINATION_PREFIX = 'txtViewerPagination:';
const PAGINATION_SUFFIX_RE = /^(.*)::(-?\d+(?:\.\d+)?)::(-?\d+(?:\.\d+)?)::(.+)$/;

function paginationFileNameFromKey(key) {
  const rest = key.slice(PAGINATION_PREFIX.length);
  const match = rest.match(PAGINATION_SUFFIX_RE);
  return match ? match[1] : rest;
}

function getPaginationBooks() {
  const books = new Map();
  scanKeysByPrefix(PAGINATION_PREFIX).forEach((key) => {
    const fileName = paginationFileNameFromKey(key);
    books.set(fileName, (books.get(fileName) || 0) + estimateEntryBytes(key, localStorage.getItem(key)));
  });
  return Array.from(books.entries()).map(([fileName, bytes]) => ({ fileName, bytes }));
}

function deletePaginationBook(fileName) {
  scanKeysByPrefix(PAGINATION_PREFIX).forEach((key) => {
    if (paginationFileNameFromKey(key) === fileName) localStorage.removeItem(key);
  });
}

function clearAllPagination() {
  scanKeysByPrefix(PAGINATION_PREFIX).forEach((key) => localStorage.removeItem(key));
}

// ── 카테고리 4: 서재 구조 · 환경설정 ───────────────────────────────────
// 책 단위 개념이 없는 키들이라 전체 초기화만 지원한다. session.js의
// lastOpenedFileKey()/library.js의 offlineLibrarySnapshotKey()/reader.js의
// READER_PREFS_LOCAL_KEY/auth.js의 LAST_EMAIL_KEY와 정확히 같은 문자열이어야 한다.
function libraryPrefsKeys() {
  const keys = ['txtViewerLastEmail', 'txtViewerLastOpenedFile_' + (currentUser ? currentUser.uid : 'anon')];
  if (isDevUser()) {
    keys.push('devLibraryState', 'txtViewerReaderPrefs');
  } else {
    keys.push('offlineLibrarySnapshot:' + (currentUser ? currentUser.uid : 'anon'));
  }
  return keys;
}

function getLibraryPrefsBytes() {
  return libraryPrefsKeys().reduce((sum, key) => {
    const value = localStorage.getItem(key);
    return value === null ? sum : sum + estimateEntryBytes(key, value);
  }, 0);
}

function clearLibraryPrefs() {
  libraryPrefsKeys().forEach((key) => localStorage.removeItem(key));
}

// ── 카테고리 5: 앱 실행 파일(Service Worker Cache Storage) — 읽기 전용 ──
// sw.js가 쓰는 캐시(CACHE_VERSION)를 페이지 쪽에서도 window.caches로 그대로
// 들여다볼 수 있다. 항목 수만이 아니라 실제 blob 용량까지 재서 보여준다.
async function getAppShellCacheInfo() {
  if (!('caches' in window)) return null;
  try {
    const names = await caches.keys();
    let bytes = 0;
    let fileCount = 0;
    for (const name of names) {
      const cache = await caches.open(name);
      const requests = await cache.keys();
      fileCount += requests.length;
      for (const req of requests) {
        const res = await cache.match(req);
        if (res) bytes += (await res.clone().blob()).size;
      }
    }
    return { bytes, fileCount };
  } catch (err) {
    console.error('앱 캐시 용량 조회 실패:', err);
    return null;
  }
}

// ── 카테고리 취합 + 삭제 라우팅 ─────────────────────────────────────────
async function getStorageOverview() {
  const offlineBooks = await getAllCachedBooksInfo();
  const progressBooks = getProgressBookmarkBooks();
  const paginationBooks = getPaginationBooks();

  return [
    {
      id: 'offlineBooks',
      label: '오프라인 저장된 책',
      books: offlineBooks,
      bytes: offlineBooks.reduce((sum, b) => sum + b.bytes, 0),
    },
    {
      id: 'progressBookmarks',
      label: '읽기 진행상황 · 책갈피 캐시',
      books: progressBooks,
      bytes: progressBooks.reduce((sum, b) => sum + b.bytes, 0),
    },
    {
      id: 'pagination',
      label: '페이지 나누기 캐시',
      books: paginationBooks,
      bytes: paginationBooks.reduce((sum, b) => sum + b.bytes, 0),
    },
    {
      id: 'libraryPrefs',
      label: '서재 구조 · 환경설정',
      books: null, // 책 단위 개념 없음 — 전체 초기화만
      bytes: getLibraryPrefsBytes(),
    },
  ];
}

async function deleteBookFromCategory(categoryId, fileName) {
  if (categoryId === 'offlineBooks') await removeCachedBook(fileName);
  else if (categoryId === 'progressBookmarks') deleteProgressBookmarkBook(fileName);
  else if (categoryId === 'pagination') deletePaginationBook(fileName);
}

async function clearCategory(categoryId) {
  if (categoryId === 'offlineBooks') await clearAllCachedBooks();
  else if (categoryId === 'progressBookmarks') clearAllProgressBookmarks();
  else if (categoryId === 'pagination') clearAllPagination();
  else if (categoryId === 'libraryPrefs') clearLibraryPrefs();
}

// ── 렌더링 ──────────────────────────────────────────────────────────────
const listEl = document.getElementById('storage-stats-list');

function buildStatRow(labelText, sizeText, button) {
  const row = document.createElement('div');
  row.className = 'storage-stats-item';
  const info = document.createElement('div');
  info.className = 'storage-stats-item-info';
  const label = document.createElement('span');
  label.className = 'storage-stats-item-label';
  label.textContent = labelText;
  const size = document.createElement('span');
  size.className = 'storage-stats-item-size';
  size.textContent = sizeText;
  info.append(label, size);
  row.appendChild(info);
  if (button) row.appendChild(button);
  return row;
}

function makeActionBtn(text, danger, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'storage-stats-item-btn' + (danger ? ' danger' : '');
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}

async function renderStorageOverview() {
  if (!listEl) return;
  listEl.innerHTML = '<p class="sheet-hint">불러오는 중…</p>';
  const [categories, appShell] = await Promise.all([getStorageOverview(), getAppShellCacheInfo()]);

  listEl.innerHTML = '';
  categories.forEach((cat) => {
    const sizeText = cat.books
      ? formatBytes(cat.bytes) + (cat.books.length ? ` · 책 ${cat.books.length}권` : '')
      : formatBytes(cat.bytes);
    const hasData = cat.bytes > 0;
    const btn = cat.books
      ? makeActionBtn('관리', false, () => openCategoryManageSheet(cat))
      : makeActionBtn('전체 초기화', true, () => clearWholeCategory(cat));
    btn.disabled = !hasData;
    listEl.appendChild(buildStatRow(cat.label, sizeText, btn));
  });

  const appShellSize = appShell ? formatBytes(appShell.bytes) + ' · 읽기 전용' : '용량 확인 불가';
  listEl.appendChild(buildStatRow('앱 실행 파일', appShellSize, null));
}

function openCategoryManageSheet(cat) {
  const actions = [
    {
      label: `전체 삭제 (${formatBytes(cat.bytes)})`,
      danger: true,
      onClick: () => clearWholeCategory(cat),
    },
    ...cat.books.map((book) => ({
      label: `${book.fileName} · ${formatBytes(book.bytes)} 삭제`,
      danger: true,
      onClick: () => deleteOneBook(cat, book.fileName),
    })),
  ];
  openItemActionSheet(cat.label, actions);
}

async function deleteOneBook(cat, fileName) {
  const confirmed = confirm(`"${fileName}"의 ${cat.label} 캐시를 삭제할까요?`);
  if (!confirmed) return;
  await deleteBookFromCategory(cat.id, fileName);
  setStatus('삭제했어요');
  renderStorageOverview();
}

async function clearWholeCategory(cat) {
  const confirmed = confirm(`"${cat.label}"을(를) 전부 비울까요?\n이 동작은 되돌릴 수 없습니다.`);
  if (!confirmed) return;
  await clearCategory(cat.id);
  setStatus('비웠어요');
  renderStorageOverview();
}

// 설정 메뉴의 "스토리지 현황" 항목 — 하위 시트를 열면서 그때마다 다시 계산한다
// (상시 계산 아님).
document.getElementById('open-storage-stats-btn').addEventListener('click', () => {
  openSheet('storage-stats-panel');
  renderStorageOverview();
});
