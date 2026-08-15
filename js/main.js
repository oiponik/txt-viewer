// main.js — 앱 진입점. index.html이 이 파일 하나만 module로 불러온다.
// 각 도메인 모듈은 로드되자마자 자기 화면의 이벤트 리스너를 스스로 등록하므로,
// 여기서 하는 일은 그 모듈들이 전부 실행되게(side effect) import하는 것뿐이다.
// (auth.js가 reader.js/library.js를 이미 가져다 쓰므로 사실 auth.js 하나만 import해도
// 전체 그래프가 로드되지만, 어떤 도메인들이 이 앱을 구성하는지 한눈에 보이도록 전부 명시한다)
import './session.js';
import './firebase-init.js';
import './ui-shared.js';
import './reader.js';
import './library.js';
import './auth.js';
