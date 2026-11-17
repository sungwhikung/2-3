/* 도구 탭: 번호 뽑기 · 조 나누기 · 자리 바꾸기 */
import { $, esc, load, save } from "./util.js";

const KEY = "class23Tools";
const clamp = (value, min, max) => Math.min(max, Math.max(min, Math.round(Number(value)) || min));

// 치우침 없는 0 ≤ n < max 난수
function randomBelow(max) {
  const limit = Math.floor(2 ** 32 / max) * max;
  const box = new Uint32Array(1);
  do crypto.getRandomValues(box); while (box[0] >= limit);
  return box[0] % max;
}
function shuffled(list) {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// 설정에서 뺀 번호를 제외한 우리 반 번호들
function classNumbers() {
  const size = clamp($("toolSize").value, 1, 60);
  const excluded = new Set(($("toolExclude").value.match(/\d+/g) || []).map(Number));
  return Array.from({ length: size }, (_, i) => i + 1).filter(number => !excluded.has(number));
}
const nameOf = number => ($("toolNames").value.split("\n")[number - 1] || "").trim();
function ball(number, index, small) {
  const name = nameOf(number);
  return `<span class="ball ${small ? "small" : ""} ${name ? "named" : ""}" style="animation-delay:${Math.min(index * 40, 800)}ms">${number}${name ? `<small>${esc(name)}</small>` : ""}</span>`;
}
const empty = '<p class="muted">뽑을 번호가 없어요. 인원과 빼는 번호를 확인해 주세요.</p>';

export function setupTools() {
  const settings = load(KEY, {});
  const fields = { size: "toolSize", exclude: "toolExclude", names: "toolNames", count: "drawCount", teams: "teamCount", columns: "seatColumns" };
  for (const [name, id] of Object.entries(fields)) if (settings[name]) $(id).value = settings[name];
  $("drawNoRepeat").checked = Boolean(settings.noRepeat);
  let drawn = Array.isArray(settings.drawn) ? settings.drawn : [];

  const persist = () => save(KEY, {
    ...Object.fromEntries(Object.entries(fields).map(([name, id]) => [name, $(id).value])),
    noRepeat: $("drawNoRepeat").checked,
    drawn
  });
  const renderDrawn = () => {
    const visible = $("drawNoRepeat").checked && drawn.length > 0;
    $("drawnInfo").hidden = !visible;
    if (visible) $("drawnInfo").innerHTML = `이미 뽑힌 번호: ${[...drawn].sort((a, b) => a - b).join(", ")} <button type="button" class="text-button" id="drawReset">기록 지우기</button>`;
  };
  $("page-tools").addEventListener("change", persist);
  $("drawNoRepeat").addEventListener("change", renderDrawn);
  renderDrawn();

  // 번호 뽑기
  $("drawForm").addEventListener("submit", event => {
    event.preventDefault();
    const noRepeat = $("drawNoRepeat").checked;
    const numbers = classNumbers();
    const candidates = noRepeat ? numbers.filter(number => !drawn.includes(number)) : numbers;
    if (!candidates.length) {
      $("drawResult").innerHTML = numbers.length ? '<p class="muted">모두 한 번씩 뽑혔어요. 기록을 지우고 다시 시작하세요.</p>' : empty;
      return;
    }
    const picked = shuffled(candidates).slice(0, clamp($("drawCount").value, 1, candidates.length));
    if (noRepeat) drawn = [...drawn, ...picked];
    $("drawResult").innerHTML = picked.map((number, index) => ball(number, index, false)).join("");
    persist();
    renderDrawn();
  });
  $("drawShuffle").addEventListener("click", () => {
    const numbers = shuffled(classNumbers());
    $("drawResult").innerHTML = numbers.length ? numbers.map((number, index) => ball(number, index, true)).join("") : empty;
  });
  $("drawnInfo").addEventListener("click", event => {
    if (event.target.id !== "drawReset") return;
    drawn = [];
    persist();
    renderDrawn();
  });

  // 조 나누기: 섞은 뒤 한 명씩 돌아가며 나눠 인원 차이가 1명을 넘지 않는다
  $("teamForm").addEventListener("submit", event => {
    event.preventDefault();
    const numbers = shuffled(classNumbers());
    if (!numbers.length) { $("teamResult").innerHTML = empty; return; }
    const count = clamp($("teamCount").value, 1, numbers.length);
    const teams = Array.from({ length: count }, () => []);
    numbers.forEach((number, index) => teams[index % count].push(number));
    $("teamResult").innerHTML = teams.map((team, index) => `<div class="team"><h3>${index + 1}조 <small>${team.length}명</small></h3><div class="tool-result">${team.sort((a, b) => a - b).map((number, i) => ball(number, index * 2 + i, true)).join("")}</div></div>`).join("");
  });

  // 자리 바꾸기
  $("seatForm").addEventListener("submit", event => {
    event.preventDefault();
    const numbers = shuffled(classNumbers());
    if (!numbers.length) { $("seatResult").innerHTML = empty; return; }
    const columns = clamp($("seatColumns").value, 1, 10);
    $("seatResult").innerHTML = `<div class="desk">교탁</div><div class="seats" style="grid-template-columns:repeat(${columns}, minmax(0, 1fr))">${numbers.map((number, index) => {
      const name = nameOf(number);
      return `<span class="seat" style="animation-delay:${Math.min(index * 30, 800)}ms"><b>${number}</b>${name ? `<small>${esc(name)}</small>` : ""}</span>`;
    }).join("")}</div>`;
  });
}

// 저장해 둔 인원이 없으면 명단 인원으로 맞춘다
export function suggestClassSize(size) {
  if (size && !load(KEY, {}).size) $("toolSize").value = size;
}
