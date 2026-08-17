// offline-cache.js — 책 원문을 IndexedDB에 캐싱해서, 오프라인이어도 최근 연 책은
// 즉시 열리게 해준다. 진행상황/책갈피(localStorage)나 서재 폴더 구조(localStorage)는
// 이 파일이 아니라 reader.js/library.js가 각자 맡는다 — 여긴 "책 원문" 하나만.
//
// ⚠️ 개발자 모드(dev-test-book.txt)는 이 캐시를 안 거친다 — 이미 정적 파일이라
// sw.js의 앱 셸 캐싱만으로 오프라인에서도 항상 열리므로, 여기 끼워넣을 이유가 없다.
//
// LRU 정책: 권 수가 아니라 총 용량(OFFLINE_CACHE_BYTES_LIMIT) 기준으로 관리한다 —
// 원래 "최근 10권"으로 개수를 세는 방식이었는데, 텍스트 소설 파일은 애초에 용량이
// 작아서(대부분 몇백 KB~몇 MB) 개수로 막는 게 실제 목적(기기 저장공간 보호)에
// 비해 너무 빡빡했다. 짧은 책이면 자연히 훨씬 많이 들어가고, 큰 파일이 섞여도
// 안전장치는 그대로 유지된다. 한도를 넘기면 가장 오래전에 연 책부터 원문을 지운다
// — 진행상황/책갈피는 용량이 작으니 지우지 않는다(reader.js의 로컬 캐시 쪽에
// 그대로 남아서, 나중에 온라인으로 다시 열어도 이어보기가 그대로 된다).
export const OFFLINE_CACHE_BYTES_LIMIT = 500 * 1024 * 1024; // 500MB

// 문자열 하나의 대략적인 저장 용량 추정치 — JS 문자열은 UTF-16이라 글자당 2바이트로
// 어림잡는다. 딱 맞을 필요 없이 "대략 몇 MB인지" 판단용이라 이 정도 근사면 충분하다.
function estimateBytes(text) {
  return text ? text.length * 2 : 0;
}

const DB_NAME = 'bookify-offline';
const DB_VERSION = 1;
const STORE_NAME = 'books';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'fileName' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode) {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// 매번 IndexedDB를 비동기로 열지 않고도 "이 파일이 캐싱돼 있는지"를 렌더링 중에
// 바로바로 물어볼 수 있어야 해서(내 서재 목록 렌더링은 동기 함수다), 캐시된 파일명
// 집합을 메모리에도 같이 들고 있는다. 앱이 뜰 때 한 번 IndexedDB에서 읽어와 채운다.
const cachedFileNames = new Set();
// 온라인일 때 내 서재가 열리면서 발견한 "서버 내용이 바뀐 것 같은" 파일들 —
// 지속 저장할 필요 없이 이번 세션 동안만 기억해두면 된다(다음에 서재가 열릴 때
// 다시 새로 확인하니까).
const staleFileNames = new Set();

let dbPromise = null;
function getDb() {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

// 앱이 뜨자마자 한 번 실행 — 메모리 인덱스를 채워둔다. 다른 모듈은 이 완료를
// 굳이 기다릴 필요 없이 isBookCached()를 바로 호출해도 된다(초기엔 빈 상태로
// 응답하다가, 채워지면 곧바로 정확해진다 — 로그인/서재 진입까지 걸리는 시간에
// 비하면 이 초기화는 훨씬 빨리 끝난다).
async function primeIndex() {
  try {
    const db = await getDb();
    const names = await reqToPromise(tx(db, 'readonly').getAllKeys());
    names.forEach((n) => cachedFileNames.add(n));
  } catch (err) {
    console.error('오프라인 책 캐시 인덱스 로드 실패:', err);
  }
}
primeIndex();

export function isBookCached(fileName) {
  return cachedFileNames.has(fileName);
}

export function isBookStale(fileName) {
  return staleFileNames.has(fileName);
}

export async function getCachedBookText(fileName) {
  try {
    const db = await getDb();
    const record = await reqToPromise(tx(db, 'readonly').get(fileName));
    if (!record) return null;
    // LRU 갱신 — 읽었다는 것도 "최근에 썼다"는 뜻이니 시각을 새로 찍어둔다.
    record.lastAccessAt = Date.now();
    tx(db, 'readwrite').put(record);
    return { text: record.text, storageMeta: record.storageMeta || null };
  } catch (err) {
    console.error('오프라인 책 캐시 읽기 실패:', err);
    return null;
  }
}

// storageMeta: Storage getMetadata() 결과에서 뽑은 { updated, size } — 서버 파일이
// 바뀌었는지 나중에(내 서재가 열릴 때) 가볍게 비교하기 위함.
export async function cacheBookText(fileName, text, storageMeta) {
  try {
    const db = await getDb();
    const now = Date.now();
    await reqToPromise(
      tx(db, 'readwrite').put({ fileName, text, storageMeta: storageMeta || null, cachedAt: now, lastAccessAt: now })
    );
    cachedFileNames.add(fileName);
    staleFileNames.delete(fileName); // 방금 새로 받았으니 더 이상 낡지 않았다
    await evictOverBudget(db);
  } catch (err) {
    // 캐싱 실패해도(용량 초과 등) 방금 다운로드한 책을 읽는 데는 지장 없으니 조용히 넘어간다
    console.error('오프라인 책 캐시 저장 실패:', err);
  }
}

async function evictOverBudget(db) {
  const all = await reqToPromise(tx(db, 'readonly').getAll());
  let totalBytes = all.reduce((sum, r) => sum + estimateBytes(r.text), 0);
  if (totalBytes <= OFFLINE_CACHE_BYTES_LIMIT) return;
  all.sort((a, b) => a.lastAccessAt - b.lastAccessAt); // 오래전에 연 것부터
  const store = tx(db, 'readwrite');
  for (const record of all) {
    if (totalBytes <= OFFLINE_CACHE_BYTES_LIMIT) break;
    store.delete(record.fileName);
    cachedFileNames.delete(record.fileName);
    staleFileNames.delete(record.fileName);
    totalBytes -= estimateBytes(record.text);
  }
}

// 설정 패널의 "기기 저장공간 현황" 섹션이 책별 용량을 나열할 때 쓴다 — cachedFileNames는
// 이름만 갖고 있어서 용량까지 보려면 IndexedDB를 다시 읽어야 한다.
export async function getAllCachedBooksInfo() {
  try {
    const db = await getDb();
    const all = await reqToPromise(tx(db, 'readonly').getAll());
    return all.map((record) => ({ fileName: record.fileName, bytes: estimateBytes(record.text) }));
  } catch (err) {
    console.error('오프라인 책 캐시 목록 조회 실패:', err);
    return [];
  }
}

// "기기 저장공간 현황"의 전체 삭제 버튼용 — evictOverBudget처럼 하나씩 지우는 대신
// objectStore를 통째로 비운다.
export async function clearAllCachedBooks() {
  try {
    const db = await getDb();
    await reqToPromise(tx(db, 'readwrite').clear());
  } catch (err) {
    console.error('오프라인 책 캐시 전체 삭제 실패:', err);
  } finally {
    cachedFileNames.clear();
    staleFileNames.clear();
  }
}

// 이름변경 성공 시(library.js의 renameFile) 캐시가 옛 이름으로 고아처럼 남지 않도록
// 같이 옮겨준다. 원문을 다시 받을 필요 없이 레코드의 키만 바꾸면 된다.
export async function renameCachedBook(oldName, newName) {
  if (!isBookCached(oldName)) return;
  try {
    const db = await getDb();
    const record = await reqToPromise(tx(db, 'readonly').get(oldName));
    if (!record) return;
    record.fileName = newName;
    const store = tx(db, 'readwrite');
    store.delete(oldName);
    store.put(record);
    cachedFileNames.delete(oldName);
    cachedFileNames.add(newName);
    if (staleFileNames.has(oldName)) {
      staleFileNames.delete(oldName);
      staleFileNames.add(newName);
    }
  } catch (err) {
    console.error('오프라인 책 캐시 이름변경 실패:', err);
  }
}

// 삭제 성공 시(library.js의 deleteFileConfirm) 묵은 캐시가 남아있지 않도록 정리한다.
export async function removeCachedBook(fileName) {
  if (!isBookCached(fileName)) return;
  try {
    const db = await getDb();
    await reqToPromise(tx(db, 'readwrite').delete(fileName));
  } catch (err) {
    console.error('오프라인 책 캐시 삭제 실패:', err);
  } finally {
    cachedFileNames.delete(fileName);
    staleFileNames.delete(fileName);
  }
}

// 내 서재가 열릴 때(책을 열 때마다가 아니라) 호출 — 캐싱된 책들의 서버 메타데이터를
// 가볍게(다운로드 없이) 확인해서, 내용이 바뀐 것 같으면 다음에 그 책을 열 때 새로
// 받아오도록 표시만 해둔다. 지금 읽는 중인 세션에는 아무 영향 없다.
export async function refreshStaleFlags(fetchMetadata) {
  const names = Array.from(cachedFileNames);
  if (names.length === 0) return;
  const db = await getDb();
  await Promise.all(
    names.map(async (fileName) => {
      try {
        const record = await reqToPromise(tx(db, 'readonly').get(fileName));
        if (!record) return;
        const serverMeta = await fetchMetadata(fileName);
        if (!serverMeta) return;
        const cached = record.storageMeta;
        const changed =
          !cached ||
          cached.updated !== serverMeta.updated ||
          cached.size !== serverMeta.size;
        if (changed) staleFileNames.add(fileName);
      } catch (err) {
        // 메타데이터 확인 하나가 실패해도(그 파일이 삭제됐거나 네트워크 흔들림 등)
        // 나머지 책 확인에는 영향 없게 조용히 넘어간다 — 다음 서재 진입 때 다시 시도된다.
      }
    })
  );
}
