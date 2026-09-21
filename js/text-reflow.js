// 고정폭(하드랩) txt의 줄바꿈 재조립.
// 옛날 소설 txt는 30~40자마다 줄바꿈이 박혀 있어서, 뷰어 폭/글자크기가 다르면 줄이
// 들쭉날쭉 끊겨 보인다. 그런 파일만 골라서(아래 감지 조건) "강제로 끊긴 줄"을 앞줄에
// 이어붙이고, 문단 경계(빈 줄, 공백으로 시작하는 줄)는 그대로 둔다.
// 강제 줄바꿈 위치가 단어 중간인지 띄어쓰기인지는 알 수 없어서(줄 끝 공백이 없으면
// 구분 불가) 공백 없이 붙인다 — 줄 끝에 공백이 있으면 그 공백은 그대로 살아있다.

const MIN_WIDTH = 20;
const MAX_WIDTH = 120;
const FULL_LINE_RATIO = 0.75; // 앞줄이 최대 폭의 이 비율 이상이어야 "꽉 차서 끊긴 줄"로 본다
const DETECT_MIN_LINES = 50;
const DETECT_NEAR_MAX_FRACTION = 0.3; // 최대 폭 근처 줄이 이 비율 이상이면 하드랩 파일

const SENTENCE_END_RE = /[.,!?…~"'”’)\]」』]$/;

export function reflowHardWrappedText(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  const lengths = [];
  for (const line of lines) {
    if (line.trim()) lengths.push(line.length);
  }
  if (lengths.length < DETECT_MIN_LINES) return text;

  lengths.sort((a, b) => a - b);
  const width = lengths[Math.floor(lengths.length * 0.95)];
  if (width < MIN_WIDTH || width > MAX_WIDTH) return text;

  let nearMax = 0;
  for (const len of lengths) if (len >= width - 4 && len <= width + 4) nearMax++;
  if (nearMax / lengths.length < DETECT_NEAR_MAX_FRACTION) return text;

  const fullLen = width * FULL_LINE_RATIO;
  const out = [];
  let prevJoinable = false; // out의 마지막 줄에 다음 줄을 이어붙여도 되는가
  for (const line of lines) {
    if (!line.trim()) {
      out.push(line);
      prevJoinable = false;
      continue;
    }
    if (prevJoinable && !/^\s/.test(line)) {
      // 앞줄이 문장부호로 끝났으면 거기서 끊긴 건 확실히 띄어쓰기 자리다
      const prev = out[out.length - 1];
      out[out.length - 1] = prev + (SENTENCE_END_RE.test(prev) ? ' ' : '') + line;
    } else {
      out.push(line);
    }
    // 이어붙인 뒤에도 "방금 붙인 원래 줄"의 길이로 다음 결합 여부를 판단해야 한다
    prevJoinable = line.length >= fullLen;
  }
  return out.join('\n');
}
