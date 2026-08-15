// firebase-init.js — Firebase 앱/Firestore/Storage/Auth 초기화. 다른 모든 js/ 모듈이
// db/storage/auth를 여기서 가져다 쓴다(재초기화하지 않도록 반드시 이 파일 하나만 통해서).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import { getAuth, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// 🔑 본인 설정 파일 불러오기
import { firebaseConfig } from "../firebase-config.js";

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);
// 💡 "로그인 유지" — 브라우저를 껐다 켜거나 새로고침해도 다시 로그인하지 않도록,
// 세션이 아니라 브라우저 로컬에 인증 상태를 저장한다 (웹 SDK 기본값이지만 명시적으로 고정).
setPersistence(auth, browserLocalPersistence).catch((err) => console.error('setPersistence 실패', err));
