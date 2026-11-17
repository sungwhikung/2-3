/* 여러 파일에서 같이 쓰는 작은 도구 */

export const $ = id => document.getElementById(id);

export const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

// 이 기기(localStorage)에 저장하고 읽기
export function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
export function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 공간을 못 쓰는 환경 */ }
}

// 화면 아래에 잠깐 떴다 사라지는 안내
let toastTimer;
export function toast(message) {
  const box = $("toast");
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, 2600);
}
