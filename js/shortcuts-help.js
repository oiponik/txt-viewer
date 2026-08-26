// js/shortcuts-help.js — 설정 메뉴의 "도움말" 하위 화면: 키보드 단축키 안내.
// 화면 전환(메뉴 ↔ 하위 화면, 뒤로가기)은 js/storage-stats.js가 이미 만들어둔
// 패턴을 그대로 재사용한다 — 이 모듈은 "도움말" 화면 자체를 켜는 것만 담당한다.
// 안내 내용 자체는 index.html의 #shortcuts-help-view에 정적으로 적혀있다 — 단축키를
// 추가/변경하면 js/reader.js의 keydown 리스너와 그 마크업을 같이 고칠 것.
import { showSettingsMenuView } from './storage-stats.js';

const settingsMenuView = document.getElementById('settings-menu-view');
const settingsBackBtn = document.getElementById('settings-back-btn');
const settingsPanelTitle = document.getElementById('settings-panel-title');
const shortcutsHelpView = document.getElementById('shortcuts-help-view');

function showShortcutsHelpView() {
  settingsMenuView.classList.add('screen-hidden');
  shortcutsHelpView.classList.remove('screen-hidden');
  settingsBackBtn.classList.remove('screen-hidden');
  settingsPanelTitle.textContent = '도움말';
}

document.getElementById('open-shortcuts-help-btn').addEventListener('click', showShortcutsHelpView);

// 설정 시트를 닫았다가 다시 열면 항상 메뉴 화면부터 시작해야 하는데, 그건 이미
// storage-stats.js가 open-settings-btn에 걸어둔 showSettingsMenuView() 리스너가
// #settings-panel .settings-subview를 전부 숨기는 방식으로 처리해준다 — 여기서
// 따로 리스너를 또 달 필요 없다.
