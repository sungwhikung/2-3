/* 도구 탭: 자리 바꾸기
   교실 모양(자리/빈칸, 짝 단위)을 정해 두고, 고정 자리·앞줄 희망·떨어져 앉기·
   지난번 자리와 짝 피하기 조건을 지키는 배치를 무작위로 뽑는다. */
import { $, esc, load, save, toast } from "./util.js";
import { classNumbers, nameOf, shuffled } from "./tools.js";

const KEY = "class23Seats";
const ATTEMPTS = 800; // 조건에 맞는 배치를 찾을 때까지 다시 섞어 보는 횟수
const clamp = (value, min, max) => Math.min(max, Math.max(min, Math.round(Number(value)) || min));
const cellKey = (r, c) => `${r}-${c}`;
const pairKey = (a, b) => a < b ? `${a}-${b}` : `${b}-${a}`;

// 저장되는 값. current = 지금 화면의 배치, previous = "이 자리로 확정"한 지난 배치
let seat = {
  rows: 3, cols: 6, group: 2,
  off: [],            // 자리가 아닌 칸 ("줄-칸")
  fixed: {},          // "줄-칸" → 꼭 거기 앉는 번호
  front: "", apart: "",
  avoidSame: true, avoidMate: true, tapReveal: false, flipped: false,
  current: null, currentDate: "",
  previous: null, previousMates: []
};
let covered = new Set(); // 아직 공개 안 한 자리
let selected = null;     // 서로 바꾸려고 먼저 누른 자리

const persist = () => save(KEY, seat);

/* ---------- 교실 모양 ---------- */
// 실제 자리인 칸들. 앞줄 왼쪽부터 순서대로
function cells() {
  const list = [];
  for (let r = 0; r < seat.rows; r++) for (let c = 0; c < seat.cols; c++) if (!seat.off.includes(cellKey(r, c))) list.push({ r, c, key: cellKey(r, c) });
  return list;
}
const sameBlock = (a, b) => seat.group === 1 || Math.floor(a.c / seat.group) === Math.floor(b.c / seat.group);
// 짝: 같은 줄에서 통로 없이 바로 옆
const isMate = (a, b) => a.r === b.r && Math.abs(a.c - b.c) === 1 && sameBlock(a, b);
// 가까운 자리: 짝이거나 바로 앞뒤
const isNear = (a, b) => isMate(a, b) || (a.c === b.c && Math.abs(a.r - b.r) === 1);

// 붙여 앉는 묶음 사이에 통로 칸을 끼운 가로 배치
function tracks() {
  const list = [];
  for (let c = 0; c < seat.cols; c++) {
    list.push("minmax(0, 1fr)");
    if (seat.group > 1 && (c + 1) % seat.group === 0 && c < seat.cols - 1) list.push("var(--aisle)");
  }
  return list;
}
function place(cell, flipped) {
  const track = cell.c + (seat.group > 1 ? Math.floor(cell.c / seat.group) : 0);
  const row = flipped ? seat.rows - cell.r : cell.r + 1;
  const column = flipped ? tracks().length - track : track + 1;
  return `grid-row:${row};grid-column:${column}`;
}

// 지금 인원·모양에서 실제로 쓸 수 있는 고정 자리만 ("줄-칸" → 번호)
function validFixed(numbers) {
  const seats = new Set(cells().map(cell => cell.key));
  const used = new Set();
  const map = new Map();
  for (const [key, number] of Object.entries(seat.fixed)) {
    if (!seats.has(key) || !numbers.includes(number) || used.has(number)) continue;
    map.set(key, number);
    used.add(number);
  }
  return map;
}

// 모양이 바뀌면 범위를 벗어난 값은 버리고, 뽑아 둔 배치도 더는 맞지 않으므로 지운다
function shapeChanged() {
  const inside = key => { const [r, c] = key.split("-").map(Number); return r < seat.rows && c < seat.cols; };
  seat.off = seat.off.filter(inside);
  seat.fixed = Object.fromEntries(Object.entries(seat.fixed).filter(([key]) => inside(key) && !seat.off.includes(key)));
  if (seat.current) {
    seat.current = null;
    $("seatNote").textContent = "교실 모양이 바뀌었어요. 자리를 다시 뽑아 주세요.";
  }
  covered = new Set();
  selected = null;
  persist();
  renderEditor();
  renderResult(false);
}
// 인원수만큼만 자리가 남도록 줄 수를 맞추고 맨 뒷줄 끝자리를 비운다
function fitToClass() {
  const count = classNumbers().length;
  seat.rows = clamp(Math.ceil(count / seat.cols), 1, 10);
  seat.off = [];
  for (let extra = seat.rows * seat.cols - count, c = seat.cols - 1; extra > 0 && c >= 0; extra--, c--) seat.off.push(cellKey(seat.rows - 1, c));
  $("seatRows").value = seat.rows;
  shapeChanged();
}

function renderEditor() {
  const mode = document.querySelector('input[name="seatMode"]:checked').value;
  const numbers = classNumbers();
  const fixed = validFixed(numbers);
  const taken = new Set(fixed.values());
  const parts = [];
  for (let r = 0; r < seat.rows; r++) {
    for (let c = 0; c < seat.cols; c++) {
      const key = cellKey(r, c);
      const on = !seat.off.includes(key);
      const mine = fixed.get(key);
      const where = `${r + 1}번째 줄 ${c + 1}번째`;
      const style = place({ r, c }, false);
      if (mode === "fixed" && on) {
        const options = numbers.filter(number => number === mine || !taken.has(number))
          .map(number => `<option value="${number}" ${number === mine ? "selected" : ""}>${number}${nameOf(number) ? ` ${esc(nameOf(number))}` : ""}</option>`).join("");
        // 숫자는 글자로 보여 주고, 고르는 상자는 그 위에 투명하게 겹친다 (브라우저마다 상자 글자 정렬이 달라서)
        parts.push(`<label class="seat edit ${mine ? "pinned" : "unset"}" style="${style}">${mine ?? "–"}<select data-cell="${key}" aria-label="${where} 자리에 고정할 번호"><option value="">고정 안 함</option>${options}</select></label>`);
      } else {
        parts.push(`<button type="button" class="seat edit ${on ? "" : "off"} ${mine ? "pinned" : ""}" data-cell="${key}" style="${style}" aria-pressed="${on}" aria-label="${where} ${on ? "자리" : "빈칸"}" ${mode === "fixed" ? "disabled" : ""}>${on ? (mine ?? "") : "×"}</button>`);
      }
    }
  }
  $("seatEditor").style.gridTemplateColumns = tracks().join(" ");
  $("seatEditor").innerHTML = parts.join("");
  $("seatModeHint").textContent = mode === "fixed"
    ? "꼭 그 자리에 앉아야 하는 번호를 골라 두면, 뽑을 때 그 자리는 그대로 둡니다."
    : "자리를 누르면 빈칸(×)이 되고, 다시 누르면 자리가 됩니다. 통로나 없는 자리를 빼 주세요.";

  const seats = cells().length;
  const gap = seats - numbers.length;
  $("seatCount").textContent = `자리 ${seats} · 학생 ${numbers.length}`;
  $("seatStatus").textContent = gap < 0 ? `자리가 ${-gap}개 모자라요. 줄을 늘리거나 빈칸을 자리로 바꿔 주세요.`
    : gap > 0 ? `자리가 ${gap}개 남아요. 뽑으면 뒤쪽 자리부터 비워 둡니다.`
    : "자리와 학생 수가 딱 맞아요.";
  $("seatStatus").classList.toggle("stale", gap < 0);
}

/* ---------- 뽑기 ---------- */
// 배치에서 짝이 된 번호 쌍들
function matePairs(result) {
  const pairs = [];
  for (const cell of cells()) {
    const right = { r: cell.r, c: cell.c + 1 };
    const key = cellKey(right.r, right.c);
    if (result.has(cell.key) && result.has(key) && isMate(cell, right)) pairs.push(pairKey(result.get(cell.key), result.get(key)));
  }
  return pairs;
}
function arrange() {
  const numbers = classNumbers();
  const all = cells();
  if (!numbers.length) { $("seatNote").textContent = "뽑을 번호가 없어요. 위쪽 ‘우리 반’의 인원을 확인해 주세요."; return; }
  if (all.length < numbers.length) {
    $("seatSetup").open = true;
    $("seatNote").textContent = `자리가 ${numbers.length - all.length}개 모자라서 뽑을 수 없어요. 교실 모양에서 자리를 늘려 주세요.`;
    return;
  }
  const fixed = validFixed(numbers);
  const pinned = new Set(fixed.values());
  const free = numbers.filter(number => !pinned.has(number));
  const freeCells = all.filter(cell => !fixed.has(cell.key)).slice(0, free.length); // 남는 자리는 뒤쪽부터 비운다
  const rows = [...new Set(freeCells.map(cell => cell.r))];
  const front = new Set((seat.front.match(/\d+/g) || []).map(Number));
  const apart = [...seat.apart.matchAll(/(\d+)\s*[-~,/]\s*(\d+)/g)].map(match => [Number(match[1]), Number(match[2])]);
  const byKey = new Map(all.map(cell => [cell.key, cell]));
  const previousMates = new Set(seat.previousMates);

  const attempt = () => {
    const wishers = shuffled(free.filter(number => front.has(number)));
    const others = shuffled(free.filter(number => !front.has(number)));
    // 앞줄부터 줄 단위로, 같은 줄 안에서는 무작위
    const frontFirst = rows.flatMap(r => shuffled(freeCells.filter(cell => cell.r === r)));
    const result = new Map(fixed);
    wishers.forEach((number, index) => result.set(frontFirst[index].key, number));
    shuffled(frontFirst.slice(wishers.length)).forEach((cell, index) => result.set(cell.key, others[index]));
    return result;
  };
  // 어긴 조건 수. 떨어져 앉기는 가장 무겁게 본다
  const score = result => {
    let bad = 0;
    if (seat.avoidSame && seat.previous) for (const [key, number] of result) if (!fixed.has(key) && seat.previous[key] === number) bad++;
    if (seat.avoidMate) bad += matePairs(result).filter(pair => previousMates.has(pair)).length;
    const where = new Map([...result].map(([key, number]) => [number, byKey.get(key)]));
    for (const [a, b] of apart) if (where.has(a) && where.has(b) && isNear(where.get(a), where.get(b))) bad += 10;
    return bad;
  };
  const unavoidable = score(new Map(fixed)); // 고정 자리끼리 어기는 것은 섞어도 못 고친다
  let best = null;
  for (let i = 0; i < ATTEMPTS && (!best || best.bad > unavoidable); i++) {
    const result = attempt();
    const bad = score(result);
    if (!best || bad < best.bad) best = { result, bad };
  }

  seat.current = Object.fromEntries(best.result);
  seat.currentDate = new Date().toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
  covered = new Set(seat.tapReveal ? [...best.result.keys()].filter(key => !fixed.has(key)) : []);
  selected = null;
  persist();
  renderResult(true);
  if (best.bad > unavoidable) $("seatNote").textContent = "조건을 전부 지키는 배치가 없어서 가장 가까운 배치를 골랐어요. 조건을 줄이거나 직접 바꿔 주세요.";
}

/* ---------- 결과 ---------- */
const sameSeats = (a, b) => Boolean(a && b) && JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

function renderResult(animate) {
  const current = seat.current;
  for (const id of ["seatFlip", "seatCopy", "seatFull"]) $(id).hidden = !current;
  if (!$("seatResult").requestFullscreen) $("seatFull").hidden = true;
  $("seatRevealAll").hidden = !current || !covered.size;
  $("seatConfirm").hidden = !current || covered.size > 0 || sameSeats(current, seat.previous);
  $("seatFlip").textContent = seat.flipped ? "학생 자리에서 보기" : "교탁에서 보기";
  if (!current) { $("seatResult").innerHTML = ""; return; }

  const fixed = validFixed(classNumbers());
  const grid = cells().map((cell, index) => {
    const number = current[cell.key];
    const base = `type="button" data-cell="${cell.key}" style="${place(cell, seat.flipped)};animation-delay:${Math.min(index * 45, 900)}ms"`;
    const pop = animate ? "pop" : "";
    if (number === undefined) return `<button class="seat vacant ${selected === cell.key ? "selected" : ""}" ${base} aria-label="빈자리">빈자리</button>`;
    if (covered.has(cell.key)) return `<button class="seat covered ${pop}" ${base} aria-label="아직 공개 안 한 자리">?</button>`;
    const name = nameOf(number);
    return `<button class="seat ${pop} ${fixed.get(cell.key) === number ? "pinned" : ""} ${selected === cell.key ? "selected" : ""}" ${base} aria-pressed="${selected === cell.key}"><b>${number}</b>${name ? `<small>${esc(name)}</small>` : ""}</button>`;
  }).join("");
  const desk = '<div class="desk">교탁</div>';
  const columns = (seat.flipped ? tracks().reverse() : tracks()).join(" ");
  $("seatResult").innerHTML = `${seat.flipped ? "" : desk}<div class="seats" style="grid-template-columns:${columns}">${grid}</div>${seat.flipped ? desk : ""}`;
  $("seatNote").textContent = covered.size
    ? `물음표를 누르면 한 자리씩 공개돼요. (${covered.size}자리 남음)`
    : `${seat.currentDate}에 뽑은 자리예요. 두 자리를 차례로 누르면 서로 바뀝니다.${sameSeats(current, seat.previous) ? " (확정됨)" : ""}`;
}
// 단톡방에 붙여 넣을 수 있는 글자 배치도 (학생 자리에서 본 모습)
function asText() {
  const lines = ["[2-3 자리 배치]", "(교탁)"];
  for (let r = 0; r < seat.rows; r++) {
    const row = [];
    for (let c = 0; c < seat.cols; c++) {
      const key = cellKey(r, c);
      const number = seat.current[key];
      const label = seat.off.includes(key) ? "  " : number === undefined ? "__" : `${String(number).padStart(2, " ")}${nameOf(number) ? `(${nameOf(number)})` : ""}`;
      row.push(label + (seat.group > 1 && (c + 1) % seat.group === 0 && c < seat.cols - 1 ? "  |" : ""));
    }
    lines.push(row.join("  ").trimEnd());
  }
  return lines.join("\n");
}

export function setupSeats() {
  const saved = load(KEY, null);
  if (saved) seat = { ...seat, ...saved };
  const firstTime = !saved;

  $("seatCols").value = seat.cols;
  $("seatRows").value = seat.rows;
  $("seatGroup").value = seat.group;
  $("seatFront").value = seat.front;
  $("seatApart").value = seat.apart;
  $("seatAvoidSame").checked = seat.avoidSame;
  $("seatAvoidMate").checked = seat.avoidMate;
  $("seatTapReveal").checked = seat.tapReveal;
  $("seatSetup").open = !seat.current;

  // 교실 모양
  $("seatCols").addEventListener("change", () => { seat.cols = clamp($("seatCols").value, 1, 10); $("seatCols").value = seat.cols; shapeChanged(); });
  $("seatRows").addEventListener("change", () => { seat.rows = clamp($("seatRows").value, 1, 10); $("seatRows").value = seat.rows; shapeChanged(); });
  $("seatGroup").addEventListener("change", () => { seat.group = clamp($("seatGroup").value, 1, 4); persist(); renderEditor(); renderResult(false); });
  $("seatFit").addEventListener("click", fitToClass);
  document.querySelectorAll('input[name="seatMode"]').forEach(radio => radio.addEventListener("change", renderEditor));
  $("seatEditor").addEventListener("click", event => {
    const key = event.target.closest("button[data-cell]")?.dataset.cell;
    if (!key) return;
    seat.off = seat.off.includes(key) ? seat.off.filter(item => item !== key) : [...seat.off, key];
    shapeChanged();
  });
  $("seatEditor").addEventListener("change", event => {
    const key = event.target.closest("select[data-cell]")?.dataset.cell;
    if (!key) return;
    if (event.target.value) seat.fixed[key] = Number(event.target.value); else delete seat.fixed[key];
    persist();
    renderEditor();
  });

  // 조건
  const conditions = { seatFront: "front", seatApart: "apart" };
  for (const [id, name] of Object.entries(conditions)) $(id).addEventListener("input", () => { seat[name] = $(id).value; persist(); });
  const checks = { seatAvoidSame: "avoidSame", seatAvoidMate: "avoidMate", seatTapReveal: "tapReveal" };
  for (const [id, name] of Object.entries(checks)) $(id).addEventListener("change", () => { seat[name] = $(id).checked; persist(); });

  // 인원·빼는 번호·이름이 바뀌면 자리 수 안내와 이름 표시를 다시 맞춘다
  for (const id of ["toolSize", "toolExclude", "toolNames"]) $(id).addEventListener("input", () => { renderEditor(); renderResult(false); });

  // 결과
  $("seatShuffle").addEventListener("click", arrange);
  $("seatRevealAll").addEventListener("click", () => { covered = new Set(); renderResult(false); });
  $("seatConfirm").addEventListener("click", () => {
    seat.previous = { ...seat.current };
    seat.previousMates = matePairs(new Map(Object.entries(seat.current)));
    persist();
    renderResult(false);
    toast("확정했어요. 다음에 뽑을 때 이 자리와 짝을 피합니다.");
  });
  $("seatFlip").addEventListener("click", () => { seat.flipped = !seat.flipped; persist(); renderResult(false); });
  $("seatCopy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(asText()); toast("자리 배치를 복사했어요."); }
    catch { toast("복사하지 못했어요."); }
  });
  $("seatFull").addEventListener("click", () => $("seatResult").requestFullscreen?.().catch(() => toast("이 기기에서는 크게 보기를 쓸 수 없어요.")));
  $("seatResult").addEventListener("click", event => {
    const key = event.target.closest("[data-cell]")?.dataset.cell;
    if (!key) return;
    if (covered.has(key)) { covered.delete(key); renderResult(false); return; }
    if (covered.size) return; // 공개가 끝난 뒤에만 자리를 바꾼다
    if (selected === null) {
      if (seat.current[key] === undefined) return; // 빈자리끼리는 바꿀 것이 없다
      selected = key;
    } else if (selected !== key) {
      const moving = seat.current[selected];
      if (seat.current[key] === undefined) delete seat.current[selected]; else seat.current[selected] = seat.current[key];
      seat.current[key] = moving;
      selected = null;
      persist();
    } else {
      selected = null;
    }
    renderResult(false);
  });

  if (firstTime) fitToClass(); else renderEditor();
  renderResult(false);
}
