// storage-stats.js — 설정 메뉴 > "기기 저장공간 현황" 하위 화면: 로컬에 쌓이는 캐시
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
import { setStatus } from "./ui-shared.js";

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

// 숫자와 단위를 따로 돌려준다 — 목록 행에서는 이 둘을 서로 다른 스타일(굵기/크기)의
// <span>으로 나눠 그려서 "126B"처럼 붙어 있어도 숫자/단위가 한눈에 갈리게 한다
// (버튼 라벨·확인창·aria-label처럼 플레인 텍스트만 되는 자리는 formatBytes()가
// 둘을 공백 하나로 이어 붙여 돌려준다).
function formatBytesParts(bytes) {
  if (!bytes) return { value: '0', unit: 'B' };
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return { value: i === 0 ? String(n) : n.toFixed(1), unit: units[i] };
}
function formatBytes(bytes) {
  const { value, unit } = formatBytesParts(bytes);
  return `${value} ${unit}`;
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
const summaryEl = document.getElementById('storage-usage-summary');
const barEl = document.getElementById('storage-usage-bar');

// 카테고리 → 막대/점 색(styles.css의 --storage-cat-N)의 고정 순서. dataviz 스킬의
// categorical 규칙대로 "항목의 정체성"에 묶인 순서라, 용량 크기 등으로 재배열하지
// 않는다 — 항상 이 순서(오프라인 책/진행상황·책갈피/페이지 나누기/서재구조·설정/
// 앱 실행 파일)로 고정.
const STORAGE_CATEGORY_COLOR_VARS = {
  offlineBooks: '--storage-cat-1',
  progressBookmarks: '--storage-cat-2',
  pagination: '--storage-cat-3',
  libraryPrefs: '--storage-cat-4',
  appShell: '--storage-cat-5',
};

// sizeSpec: 보통 { bytes, suffix? } — 값/단위를 서로 다른 스타일의 <span>으로 나눠
// 그린다. appShell을 못 읽어왔을 때("용량 확인 불가")처럼 바이트 수가 아예 없는
// 예외적인 경우에만 완성된 문자열을 그대로 넘겨도 된다.
function buildStatRow(labelText, sizeSpec, button, colorVar) {
  const row = document.createElement('div');
  row.className = 'storage-stats-item';
  const info = document.createElement('div');
  info.className = 'storage-stats-item-info';
  const label = document.createElement('span');
  label.className = 'storage-stats-item-label';
  const dot = document.createElement('span');
  dot.className = 'storage-stats-item-dot';
  dot.style.backgroundColor = `var(${colorVar})`;
  const labelTextEl = document.createElement('span');
  labelTextEl.textContent = labelText;
  label.append(dot, labelTextEl);
  info.append(label, buildSizeLine(sizeSpec));
  row.appendChild(info);
  if (button) row.appendChild(button);
  return row;
}

function buildSizeLine(sizeSpec) {
  const size = document.createElement('span');
  size.className = 'storage-stats-item-size';
  if (typeof sizeSpec === 'string') {
    size.textContent = sizeSpec;
    return size;
  }
  const { value, unit } = formatBytesParts(sizeSpec.bytes);
  const valueEl = document.createElement('span');
  valueEl.className = 'storage-stats-item-size-value';
  valueEl.textContent = value;
  const unitEl = document.createElement('span');
  unitEl.className = 'storage-stats-item-size-unit';
  unitEl.textContent = ' ' + unit;
  size.append(valueEl, unitEl);
  if (sizeSpec.suffix) size.append(document.createTextNode(sizeSpec.suffix));
  return size;
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
  barEl.innerHTML = '';
  summaryEl.textContent = '불러오는 중…';
  const [categories, appShell] = await Promise.all([getStorageOverview(), getAppShellCacheInfo()]);
  const appShellBytes = appShell ? appShell.bytes : 0;
  const totalBytes = categories.reduce((sum, cat) => sum + cat.bytes, 0) + appShellBytes;

  // 비율 막대 — 카테고리별 조각 너비를 전체 대비 비율로 채운다. 전부 0바이트면
  // 조각을 하나도 안 그려서 트랙(빈 상태) 색만 남는다.
  barEl.innerHTML = '';
  if (totalBytes > 0) {
    categories.forEach((cat) => {
      if (cat.bytes <= 0) return;
      barEl.appendChild(buildUsageSegment(cat.label, cat.bytes, totalBytes, STORAGE_CATEGORY_COLOR_VARS[cat.id]));
    });
    if (appShellBytes > 0) {
      barEl.appendChild(buildUsageSegment('앱 실행 파일', appShellBytes, totalBytes, STORAGE_CATEGORY_COLOR_VARS.appShell));
    }
  }
  summaryEl.textContent = totalBytes > 0 ? `총 ${formatBytes(totalBytes)} 사용 중` : '사용 중인 저장공간 없음';
  // 막대 자체는 장식이 아니라 데이터라 role="img"에 접근성 이름을 붙인다 — 아래
  // 목록에 정확한 수치가 어차피 다 있으니 스크린리더 사용자에게는 요약만으로 충분하다.
  const allLabels = [...categories.map((c) => c.label), '앱 실행 파일'];
  const allBytes = [...categories.map((c) => c.bytes), appShellBytes];
  barEl.setAttribute(
    'aria-label',
    totalBytes > 0
      ? allLabels.map((label, i) => `${label} ${formatBytes(allBytes[i])}`).join(', ')
      : '사용 중인 저장공간 없음'
  );

  listEl.innerHTML = '';
  categories.forEach((cat) => {
    const suffix = cat.books && cat.books.length ? ` · 책 ${cat.books.length}권` : '';
    const hasData = cat.bytes > 0;
    const btn = cat.books
      ? makeActionBtn('관리', false, () => openCategoryManageSheet(cat))
      : makeActionBtn('전체 초기화', true, () => clearWholeCategory(cat));
    btn.disabled = !hasData;
    listEl.appendChild(buildStatRow(cat.label, { bytes: cat.bytes, suffix }, btn, STORAGE_CATEGORY_COLOR_VARS[cat.id]));
  });

  const appShellSizeSpec = appShell ? { bytes: appShell.bytes, suffix: ' · 읽기 전용' } : '용량 확인 불가';
  listEl.appendChild(buildStatRow('앱 실행 파일', appShellSizeSpec, null, STORAGE_CATEGORY_COLOR_VARS.appShell));
}

// flex-grow를 바이트 수 그대로 비율로 써서 너비를 나눈다(flex-basis:0) — 퍼센트를
// 직접 계산해서 넣으면 조각 사이 2px gap만큼 합이 100%를 넘어 마지막 조각이
// 잘리지만, flex-grow는 gap을 뺀 나머지 공간을 알아서 비율대로 나눠주므로 이
// 문제가 없다.
// 마우스 오버(및 키보드 포커스)하면 이름·용량·비율을 보여주는 툴팁이 뜬다 —
// dataviz 스킬: 막대류는 조각 자체가 히트타겟, 값이 툴팁의 주인공(굵게)이고
// 이름은 보조.
function buildUsageSegment(label, bytes, totalBytes, colorVar) {
  const seg = document.createElement('div');
  seg.className = 'storage-usage-bar-segment';
  seg.style.flex = `${bytes} 0 0`;
  seg.style.backgroundColor = `var(${colorVar})`;
  seg.tabIndex = 0;
  const percent = ((bytes / totalBytes) * 100).toFixed(1);
  seg.addEventListener('mouseenter', () => showUsageTooltip(seg, label, bytes, percent));
  seg.addEventListener('mouseleave', hideUsageTooltip);
  seg.addEventListener('focus', () => showUsageTooltip(seg, label, bytes, percent));
  seg.addEventListener('blur', hideUsageTooltip);
  return seg;
}

const usageTooltipEl = document.getElementById('storage-usage-tooltip');
function showUsageTooltip(segmentEl, label, bytes, percent) {
  usageTooltipEl.innerHTML = '';
  const nameEl = document.createElement('span');
  nameEl.className = 'storage-usage-tooltip-name';
  nameEl.textContent = label; // 라벨은 카테고리 이름 문자열 — textContent로만 넣는다
  const valueEl = document.createElement('span');
  valueEl.className = 'storage-usage-tooltip-value';
  valueEl.textContent = `${formatBytes(bytes)} (${percent}%)`;
  usageTooltipEl.append(nameEl, valueEl);

  const rect = segmentEl.getBoundingClientRect();
  usageTooltipEl.style.left = (rect.left + rect.width / 2) + 'px';
  usageTooltipEl.style.top = rect.top + 'px';
  usageTooltipEl.classList.add('visible');
  // 가장자리 조각은 툴팁이 화면 밖으로 삐져나갈 수 있어, 그려진 뒤 실제 폭으로
  // 한 번 더 clamp한다.
  requestAnimationFrame(() => {
    const tRect = usageTooltipEl.getBoundingClientRect();
    if (tRect.left < 4) usageTooltipEl.style.left = (rect.left + rect.width / 2 + (4 - tRect.left)) + 'px';
    if (tRect.right > window.innerWidth - 4) {
      usageTooltipEl.style.left = (rect.left + rect.width / 2 - (tRect.right - (window.innerWidth - 4))) + 'px';
    }
  });
}
function hideUsageTooltip() {
  usageTooltipEl.classList.remove('visible');
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

// ── 설정 시트 안에서의 화면 전환(메뉴 ↔ 하위 화면들) ──────────────────
// 새 시트를 또 띄우는 대신, #settings-panel 하나 안에서 화면을 토글한다 —
// "기기 저장공간 현황"을 누르면 메뉴 대신 이 화면이 나타나고 왼쪽에 뒤로가기 아이콘이
// 생긴다(사용자 피드백: 새 창보다 같은 창 안에서 뒤로가기가 낫다). 이 모듈이 설정
// 시트에 처음 추가된 하위 화면이라 이 전환 로직 자체도 여기서 관리한다 — 다른 모듈
// (예: js/shortcuts-help.js)이 하위 화면을 추가할 땐 그 화면에 `settings-subview`
// 클래스만 붙이면 되고, 여기로 다시 돌아오는 건 아래 export된 showSettingsMenuView()를
// 그대로 재사용하면 된다(뒤로가기 버튼도 이미 여기서 한 번만 연결해둔다).
const settingsBackBtn = document.getElementById('settings-back-btn');
const settingsPanelTitle = document.getElementById('settings-panel-title');
const settingsMenuView = document.getElementById('settings-menu-view');
const storageStatsView = document.getElementById('storage-stats-view');

export function showSettingsMenuView() {
  settingsMenuView.classList.remove('screen-hidden');
  document.querySelectorAll('#settings-panel .settings-subview').forEach((view) => {
    view.classList.add('screen-hidden');
  });
  settingsBackBtn.classList.add('screen-hidden');
  settingsPanelTitle.textContent = '설정';
}

function showStorageStatsView() {
  settingsMenuView.classList.add('screen-hidden');
  storageStatsView.classList.remove('screen-hidden');
  settingsBackBtn.classList.remove('screen-hidden');
  settingsPanelTitle.textContent = '기기 저장공간 현황';
  renderStorageOverview(); // 화면에 들어올 때마다 다시 계산한다(상시 계산 아님)
}

document.getElementById('open-storage-stats-btn').addEventListener('click', showStorageStatsView);
settingsBackBtn.addEventListener('click', showSettingsMenuView);

// 설정 시트를 닫았다가 다시 열면(✕/배경 클릭으로 어느 화면에 있었든) 항상 메뉴
// 화면부터 시작한다 — auth.js가 이미 open-settings-btn에 openSheet('settings-panel')
// 리스너를 걸어뒀지만, 이 모듈은 그 파일을 몰라도 되게(다른 모듈들처럼) 같은
// 버튼에 리스너를 하나 더 얹는다.
document.getElementById('open-settings-btn').addEventListener('click', showSettingsMenuView);
