/* 2학년 3반 — 홈 / 급식 / 시간표 / 일정 / 공지 (도구 탭은 tools.js)
   한 기능이 실패해도 나머지는 계속 동작하도록 데이터별로 따로 불러온다. */
import { $, esc, load, save, toast } from "./util.js";
import { setupTools, suggestClassSize } from "./tools.js";
import { setupSeats } from "./seats.js";

const KST = "Asia/Seoul";
const MEAL_NAMES = { 1: "아침", 2: "점심", 3: "저녁" };
// 이 시각(분)이 지나면 그 끼니는 끝난 것으로 보고 다음 끼니를 보여 준다
const MEAL_ENDS = { 1: 8 * 60 + 30, 2: 13 * 60 + 30, 3: 19 * 60 + 30 };
const SCHOOL_DAY_ENDS = 17 * 60; // 이후에는 홈에 다음 수업일 시간표를 보여 준다
const ALLERGENS = ["", "난류", "우유", "메밀", "땅콩", "대두", "밀", "고등어", "게", "새우", "돼지고기", "복숭아", "토마토", "아황산류", "호두", "닭고기", "쇠고기", "오징어", "조개류", "잣"];
const WEEKDAYS = [["A", "월"], ["B", "화"], ["C", "수"], ["D", "목"], ["E", "금"]];
const MY_GRADE = 2;

// meal-dg와 같은 주소(origin)라서 같은 키를 쓰면 친구들이 저장해 둔 값이 그대로 이어진다
const KEYS = {
  electives: "daegeonElectives",
  student: "daegeonStudentNumber",
  ddays: "daegeonDdays",
  memos: "daegeonPersonalMemos",
  allergens: "class23Allergens",
  todos: "class23Todos",
  favorites: "class23Favorites",
  seenNotices: "class23SeenNotices",
  theme: "class23Theme"
};

/* ---------- 날짜 ---------- */
function kstParts() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: KST, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}
function todayISO() { const p = kstParts(); return `${p.year}-${p.month}-${p.day}`; }
function nowMinutes() { const p = kstParts(); return Number(p.hour) * 60 + Number(p.minute); }
function parseISO(value) { const [y, m, d] = value.split("-").map(Number); return new Date(y, m - 1, d, 12); }
function toISO(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function shift(value, days) { const date = parseISO(value); date.setDate(date.getDate() + days); return toISO(date); }
function fmt(value, options) { return new Intl.DateTimeFormat("ko-KR", options).format(parseISO(value)); }
function shortDate(value) { const date = parseISO(value); return `${date.getMonth() + 1}/${date.getDate()} ${fmt(value, { weekday: "short" })}`; }
function daysUntil(value) { return Math.round((parseISO(value) - parseISO(todayISO())) / 864e5); }
function mondayOf(value) { return shift(value, -((parseISO(value).getDay() + 6) % 7)); }
function weekendClass(value) { const day = parseISO(value).getDay(); return day === 0 ? "sun" : day === 6 ? "sat" : ""; }
function relativeDay(value) {
  const left = daysUntil(value);
  if (left === 0) return "오늘";
  if (left === 1) return "내일";
  if (left === 2) return "모레";
  return shortDate(value);
}
function ddayLabel(value) { const left = daysUntil(value); return left === 0 ? "D-DAY" : `D-${left}`; }

/* ---------- 상태 ---------- */
const state = {
  meals: new Map(),      // "2026-11-17|2" → 급식
  events: [],            // { date, title, holiday }
  holidays: new Set(),   // 수업 없는 날
  supervisors: {},
  timetable: null,
  notices: null,         // null = 아직 못 불러옴
  mealDate: todayISO(),
  calendarDate: todayISO(),
  calendarMonth: todayISO().slice(0, 7)
};

async function fetchJSON(path) {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
  return response.json();
}

/* ---------- 화면 전환 ---------- */
const PAGES = ["home", "meals", "timetable", "calendar", "notices", "tools"];
const currentPage = () => PAGES.includes(location.hash.slice(1)) ? location.hash.slice(1) : "home";
function showPage() {
  const page = currentPage();
  document.querySelectorAll(".page").forEach(section => { section.hidden = section.dataset.page !== page; });
  document.querySelectorAll(".tab").forEach(tab => {
    const active = tab.dataset.page === page;
    tab.classList.toggle("active", active);
    if (active) tab.setAttribute("aria-current", "page"); else tab.removeAttribute("aria-current");
  });
  window.scrollTo(0, 0);
  renderNotices();
  if (page === "notices") markNoticesSeen(); // ‘새 글’ 표시는 이번 한 번만 보여 준다
}

/* ---------- 급식 ---------- */
const getMeal = (date, type) => state.meals.get(`${date}|${type}`);
const myAllergens = () => load(KEYS.allergens, []);

const myFavorites = () => load(KEYS.favorites, []);
const matchesAny = (name, keywords) => keywords.some(keyword => name.replace(/\s/g, "").includes(keyword));

// 지금 시각 이후에 먹을 끼니들 (날짜·끼니 순)
function upcomingMeals() {
  const today = todayISO();
  const minutes = nowMinutes();
  return [...state.meals.values()].filter(meal => meal.date > today || (meal.date === today && minutes < MEAL_ENDS[meal.type]));
}
function nextMeal() {
  const meal = upcomingMeals()[0];
  return meal && daysUntil(meal.date) < 7 ? meal : null;
}
// 이름에 검색어가 들어간 메뉴가 나오는 끼니들
function findMeals(keywords) {
  const words = keywords.map(word => word.replace(/\s/g, "")).filter(Boolean);
  if (!words.length) return [];
  return upcomingMeals()
    .map(meal => ({ meal, dishes: meal.dishes.filter(dish => matchesAny(dish.name, words)).map(dish => dish.name) }))
    .filter(result => result.dishes.length);
}
function dishListHTML(meal) {
  const mine = myAllergens();
  const favorites = myFavorites();
  return `<ul class="dish-list">${meal.dishes.map(dish => {
    const hits = dish.allergens.filter(code => mine.includes(code)).map(code => ALLERGENS[code]);
    const star = matchesAny(dish.name, favorites) ? '<b class="star" title="기다리는 메뉴">★</b>' : "";
    return `<li class="${hits.length ? "hit" : ""}"><span>${star}${esc(dish.name)}</span>${hits.length ? `<small>${esc(hits.join(" · "))}</small>` : ""}</li>`;
  }).join("")}</ul>`;
}
function mealMetaHTML(meal) {
  const n = meal.nutrition || {};
  const parts = [];
  if (meal.kcal) parts.push(`${Math.round(meal.kcal)} kcal`);
  if (n.carbs) parts.push(`탄 ${Math.round(n.carbs)}g`);
  if (n.protein) parts.push(`단 ${Math.round(n.protein)}g`);
  if (n.fat) parts.push(`지 ${Math.round(n.fat)}g`);
  return parts.length ? `<p class="meal-meta">${parts.join(" · ")}</p>` : "";
}
function renderHomeMeal() {
  const card = $("homeMeal");
  if (!state.meals.size) return;
  const meal = nextMeal();
  if (!meal) {
    card.innerHTML = `<div class="card-head"><h2>급식</h2><a class="card-link" href="#meals">전체 보기</a></div><p class="placeholder">앞으로 일주일간 등록된 급식이 없어요.</p>`;
    return;
  }
  const waiting = findMeals(myFavorites()).filter(result => result.meal !== meal).slice(0, 2)
    .map(result => `<a class="fav-line" href="#meals" data-meal-date="${result.meal.date}"><b class="star">★</b>${esc(relativeDay(result.meal.date))} ${MEAL_NAMES[result.meal.type]}에 <strong>${esc(result.dishes.join(", "))}</strong></a>`).join("");
  card.innerHTML = `<div class="card-head"><h2>${esc(relativeDay(meal.date))} ${MEAL_NAMES[meal.type]}<span class="tag accent">다음 급식</span></h2><a class="card-link" href="#meals" data-meal-date="${meal.date}">전체 보기</a></div>${dishListHTML(meal)}${mealMetaHTML(meal)}${waiting}`;
}
function renderMeals() {
  const date = state.mealDate;
  const today = todayISO();
  $("mealDateTitle").innerHTML = `${esc(fmt(date, { month: "long", day: "numeric", weekday: "short" }))}${date === today ? ' <span class="tag accent">오늘</span>' : ""}`;
  $("mealDatePicker").value = date;

  const monday = mondayOf(date);
  const days = Array.from({ length: 7 }, (_, i) => shift(monday, i));
  $("weekStrip").innerHTML = days.map(day => {
    const hasMeal = [1, 2, 3].some(type => getMeal(day, type));
    const classes = ["week-day", weekendClass(day), day === today ? "today" : "", day === date ? "selected" : "", hasMeal ? "" : "empty"].filter(Boolean).join(" ");
    return `<button type="button" class="${classes}" data-date="${day}" aria-label="${esc(fmt(day, { month: "long", day: "numeric", weekday: "long" }))}" ${day === date ? 'aria-current="date"' : ""}>${esc(fmt(day, { weekday: "short" }))}<b>${parseISO(day).getDate()}</b></button>`;
  }).join("");

  const cards = $("mealCards");
  if (!state.meals.size) return;
  const upcoming = nextMeal();
  cards.innerHTML = [1, 2, 3].some(type => getMeal(date, type))
    ? [1, 2, 3].map(type => {
        const meal = getMeal(date, type);
        if (!meal) return `<article class="card meal-card none"><div class="card-head"><h2>${MEAL_NAMES[type]}</h2></div><p class="muted">없음</p></article>`;
        const isNext = upcoming === meal && date === today;
        return `<article class="card meal-card ${isNext ? "now" : ""}"><div class="card-head"><h2>${MEAL_NAMES[type]}${isNext ? '<span class="tag accent">다음 급식</span>' : ""}</h2></div>${dishListHTML(meal)}${mealMetaHTML(meal)}</article>`;
      }).join("")
    : '<p class="placeholder">이 날은 등록된 급식이 없습니다.</p>';

  // 한 주 한눈에
  const mine = myAllergens();
  $("weekLabel").textContent = `${shortDate(days[0])} – ${shortDate(days[6])}`;
  const column = day => [day === today ? "col-today" : "", weekendClass(day)].filter(Boolean).join(" ");
  $("weekHead").innerHTML = `<tr><th></th>${days.map(day => `<th class="pick ${column(day)}" data-date="${day}"><strong>${esc(fmt(day, { weekday: "short" }))}</strong>${parseISO(day).getMonth() + 1}/${parseISO(day).getDate()}</th>`).join("")}</tr>`;
  $("weekBody").innerHTML = [1, 2, 3].map(type => `<tr><th>${MEAL_NAMES[type]}</th>${days.map(day => {
    const meal = getMeal(day, type);
    const text = meal ? meal.dishes.map(dish => dish.allergens.some(code => mine.includes(code)) ? `<span class="hit">${esc(dish.name)}</span>` : esc(dish.name)).join("\n") : "—";
    return `<td class="${day === today ? "col-today" : ""}">${text}</td>`;
  }).join("")}</tr>`).join("");
}
function renderAllergens() {
  const mine = myAllergens();
  $("allergySummary").textContent = mine.length ? `${mine.length}개 선택` : "";
  $("allergyChips").innerHTML = ALLERGENS.map((name, code) => code ? `<button type="button" class="button ${mine.includes(code) ? "primary" : ""}" data-code="${code}" aria-pressed="${mine.includes(code)}">${name}</button>` : "").join("");
}
function renderFind() {
  const favorites = myFavorites();
  const query = $("findInput").value.trim();
  $("favSummary").textContent = favorites.length ? `${favorites.length}개 저장` : "";
  $("favChips").innerHTML = favorites.map(word => `<span class="chip"><button type="button" class="chip-text" data-word="${esc(word)}">★ ${esc(word)}</button><button type="button" data-remove="${esc(word)}" aria-label="${esc(word)} 삭제">×</button></span>`).join("");
  const results = findMeals(query ? [query] : favorites).slice(0, 12);
  const none = query ? "앞으로 나올 급식 중에는 없어요." : favorites.length ? "저장한 메뉴가 당분간 안 나와요." : "";
  $("findResults").innerHTML = results.length
    ? results.map(({ meal, dishes }) => `<li><time datetime="${meal.date}">${esc(shortDate(meal.date))}</time><button type="button" class="link-button" data-date="${meal.date}">${MEAL_NAMES[meal.type]} · ${esc(dishes.join(", "))}</button><span class="when">${daysUntil(meal.date) <= 1 ? relativeDay(meal.date) : ddayLabel(meal.date)}</span></li>`).join("")
    : none ? `<li class="muted">${none}</li>` : "";
}
async function shareMeals() {
  const date = state.mealDate;
  const lines = [1, 2, 3].map(type => getMeal(date, type)).filter(Boolean).map(meal => `${MEAL_NAMES[meal.type]}: ${meal.dishes.map(dish => dish.name).join(", ")}`);
  if (!lines.length) return toast("이 날은 공유할 급식이 없어요.");
  const text = `[2-3] ${fmt(date, { month: "long", day: "numeric", weekday: "short" })} 급식\n${lines.join("\n")}`;
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); toast("급식을 복사했어요. 붙여넣기 하면 돼요."); }
  } catch (error) {
    if (error.name !== "AbortError") toast("공유하지 못했어요.");
  }
}
function setupMeals() {
  const go = date => { if (date) { state.mealDate = date; renderMeals(); } };
  const favoritesChanged = () => { renderFind(); renderMeals(); renderHomeMeal(); };
  $("mealShare").addEventListener("click", shareMeals);
  $("homeMeal").addEventListener("click", event => go(event.target.closest("[data-meal-date]")?.dataset.mealDate));

  // 옆으로 밀거나 ← → 키로 날짜 넘기기
  let touch = null;
  $("mealCards").addEventListener("touchstart", event => { touch = event.changedTouches[0]; }, { passive: true });
  $("mealCards").addEventListener("touchend", event => {
    if (!touch) return;
    const dx = event.changedTouches[0].clientX - touch.clientX;
    const dy = event.changedTouches[0].clientY - touch.clientY;
    touch = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) go(shift(state.mealDate, dx < 0 ? 1 : -1));
  }, { passive: true });
  document.addEventListener("keydown", event => {
    if (currentPage() !== "meals" || event.target.closest("input, textarea, select") || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowLeft") go(shift(state.mealDate, -1));
    if (event.key === "ArrowRight") go(shift(state.mealDate, 1));
  });

  // 메뉴 찾기 · 기다리는 메뉴
  $("findInput").addEventListener("input", renderFind);
  $("findForm").addEventListener("submit", event => {
    event.preventDefault();
    const word = $("findInput").value.trim();
    const favorites = myFavorites();
    if (!word) return;
    if (!favorites.includes(word)) save(KEYS.favorites, [...favorites, word].slice(-12));
    $("findInput").value = "";
    favoritesChanged();
    toast(`‘${word}’ 나오는 날을 홈에서 알려 줄게요.`);
  });
  $("favChips").addEventListener("click", event => {
    const remove = event.target.closest("[data-remove]")?.dataset.remove;
    const word = event.target.closest("[data-word]")?.dataset.word;
    if (remove) { save(KEYS.favorites, myFavorites().filter(item => item !== remove)); favoritesChanged(); }
    if (word) { $("findInput").value = word; renderFind(); }
  });
  $("findResults").addEventListener("click", event => {
    const date = event.target.closest("[data-date]")?.dataset.date;
    if (date) { go(date); $("mealDateTitle").scrollIntoView({ behavior: "smooth", block: "start" }); }
  });
  $("mealPrevWeek").addEventListener("click", () => go(shift(state.mealDate, -7)));
  $("mealNextWeek").addEventListener("click", () => go(shift(state.mealDate, 7)));
  $("mealToday").addEventListener("click", () => go(todayISO()));
  $("mealDatePicker").addEventListener("change", event => go(event.target.value));
  $("weekStrip").addEventListener("click", event => go(event.target.closest("[data-date]")?.dataset.date));
  $("weekHead").addEventListener("click", event => {
    const date = event.target.closest("[data-date]")?.dataset.date;
    if (date) { go(date); $("mealDateTitle").scrollIntoView({ behavior: "smooth", block: "start" }); }
  });
  $("allergyChips").addEventListener("click", event => {
    const code = Number(event.target.closest("[data-code]")?.dataset.code);
    if (!code) return;
    const mine = myAllergens();
    save(KEYS.allergens, mine.includes(code) ? mine.filter(item => item !== code) : [...mine, code].sort((a, b) => a - b));
    renderAllergens(); renderMeals(); renderHomeMeal();
  });
  renderAllergens();
}
async function loadMeals() {
  try {
    const json = await fetchJSON("./data/meals.json");
    state.meals = new Map(json.meals.map(meal => [`${meal.date}|${meal.type}`, meal]));
    const updated = new Date(json.updatedAt);
    const stale = Date.now() - updated.getTime() > 3 * 864e5; // 매일 갱신되므로 사흘 넘게 그대로면 뭔가 멈춘 것
    $("updatedAt").textContent = Number.isNaN(updated.getTime()) ? "알 수 없음" : updated.toLocaleString("ko-KR", { timeZone: KST, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) + (stale ? " (자동 갱신이 멈춘 것 같아요. 급식이 최신이 아닐 수 있어요)" : "");
    $("updatedAt").classList.toggle("stale", stale);
  } catch (error) {
    console.error("[2-3] 급식 로딩 실패:", error);
    const message = '<p class="placeholder">급식을 불러오지 못했습니다. 잠시 후 다시 열어 주세요.</p>';
    $("homeMeal").innerHTML = message;
    $("mealCards").innerHTML = message;
    $("updatedAt").textContent = "연결 오류";
  }
  renderHomeMeal();
  renderMeals();
  renderFind();
}

/* ---------- 시간표 ---------- */
const getPicks = () => load(KEYS.electives, {});
const groupLabel = group => /^[A-Z]$/.test(group) ? `선택 ${group}` : group;
const optionLabel = name => name.replace(/^(정보과학)(\d)$/, "$1 $2분반");
const hasPicks = () => Object.keys(getPicks()).length > 0;

// 그 요일·교시에 내가 듣는 수업. 선택 과목을 아직 안 골랐으면 open
function lessonAt(dayLetter, period) {
  const slot = state.timetable?.slots[dayLetter + period];
  if (!slot) return null;
  if (!slot.group) return { subject: slot.subject, teacher: slot.teacher };
  const picked = slot.options[getPicks()[slot.group]];
  return picked ? { subject: picked.subject, teacher: picked.teacher, elective: true } : { open: groupLabel(slot.group) };
}
function periodCount() {
  return Math.max(...Object.keys(state.timetable.slots).map(symbol => Number(symbol.slice(1))));
}
function isSchoolDay(date) {
  const day = parseISO(date).getDay();
  return day >= 1 && day <= 5 && !state.holidays.has(date);
}
// 홈에 보여 줄 수업일: 오늘 수업이 남았으면 오늘, 아니면 다음 수업일
function upcomingSchoolDay() {
  let date = todayISO();
  if (!isSchoolDay(date) || nowMinutes() >= SCHOOL_DAY_ENDS) date = shift(date, 1);
  for (let i = 0; i < 21; i++, date = shift(date, 1)) if (isSchoolDay(date)) return date;
  return null;
}
function studentFormHTML() {
  return `<form class="inline-form student-form"><input class="student-number" inputmode="numeric" maxlength="4" placeholder="내 번호 (예: 8)" aria-label="번호 또는 학번"><button class="button primary" type="submit">불러오기</button></form><p class="status-text student-status" aria-live="polite"></p>`;
}
function renderHomeTimetable() {
  const card = $("homeTimetable");
  if (!state.timetable) return;
  const date = upcomingSchoolDay();
  const link = '<a class="card-link" href="#timetable">전체 보기</a>';
  if (!date) {
    card.innerHTML = `<div class="card-head"><h2>시간표</h2>${link}</div><p class="placeholder">당분간 수업이 없어요. 푹 쉬어요!</p>`;
    return;
  }
  const [letter] = WEEKDAYS[parseISO(date).getDay() - 1];
  const rows = [];
  for (let period = 1; period <= periodCount(); period++) {
    const lesson = lessonAt(letter, period);
    if (!lesson) continue;
    rows.push(lesson.open
      ? `<li><span class="no">${period}</span><span class="open">${esc(lesson.open)}</span></li>`
      : `<li><span class="no">${period}</span><strong>${esc(lesson.subject)}</strong><span class="teacher">${esc(lesson.teacher)}</span></li>`);
  }
  const title = daysUntil(date) <= 2 ? `${relativeDay(date)} 시간표` : `${shortDate(date)} 시간표`;
  const hint = hasPicks() ? "" : `<div class="hint">번호를 넣으면 ‘선택 A’ 같은 칸이 내 과목으로 바뀌어요.${studentFormHTML()}</div>`;
  card.innerHTML = `<div class="card-head"><h2>${esc(title)}</h2>${link}</div><ol class="period-list">${rows.join("")}</ol>${hint}`;
}
function renderTimetable() {
  const table = state.timetable;
  if (!table) {
    $("timetableBody").innerHTML = '<tr><td class="placeholder">시간표를 불러오지 못했습니다.</td></tr>';
    return;
  }
  $("timetableTitle").textContent = `${table.grade}학년 ${table.class}반 시간표`;
  const todayIndex = parseISO(todayISO()).getDay() - 1;
  const today = index => index === todayIndex ? "col-today" : "";
  $("timetableHead").innerHTML = `<tr><th></th>${WEEKDAYS.map(([, name], index) => `<th class="${today(index)}"><strong>${name}</strong></th>`).join("")}</tr>`;
  $("timetableBody").innerHTML = Array.from({ length: periodCount() }, (_, i) => i + 1).map(period => `<tr><th>${period}</th>${WEEKDAYS.map(([letter], index) => {
    const lesson = lessonAt(letter, period);
    if (!lesson) return `<td class="${today(index)}"></td>`;
    if (lesson.open) return `<td class="open ${today(index)}">${esc(lesson.open)}</td>`;
    return `<td class="${lesson.elective ? "elective" : ""} ${today(index)}"><strong>${esc(lesson.subject)}</strong><span>${esc(lesson.teacher)}</span></td>`;
  }).join("")}</tr>`).join("");

  const picks = getPicks();
  const number = load(KEYS.student, "");
  document.querySelectorAll(".student-number").forEach(input => { if (document.activeElement !== input && !input.value) input.value = String(number).replace(/\D/g, ""); });
  $("electiveForm").innerHTML = Object.keys(table.groups).sort().map(group => `<label class="field-label">${esc(groupLabel(group))}<select data-group="${esc(group)}"><option value="">선택 안 함</option>${table.groups[group].map(name => `<option value="${esc(name)}" ${picks[group] === name ? "selected" : ""}>${esc(optionLabel(name))}</option>`).join("")}</select></label>`).join("");
}
// 번호(8) 또는 학번(2308)으로 저장된 선택 과목을 불러온다
function applyStudentNumber(form) {
  const table = state.timetable;
  const status = form.parentElement.querySelector(".student-status");
  const say = message => { if (status) status.textContent = message; };
  if (!table) return say("시간표를 아직 불러오지 못했어요.");
  const digits = form.querySelector(".student-number").value.replace(/\D/g, "");
  if (!digits) return say("번호를 입력해 주세요.");
  const number = digits.length <= 2 ? `${table.grade}${table.class}${digits.padStart(2, "0")}` : digits;
  const picks = table.students?.[number];
  if (!picks) return say("명단에 없는 번호예요. 시간표 탭에서 직접 골라 주세요.");
  save(KEYS.electives, picks);
  localStorage.setItem(KEYS.student, number); // meal-dg와 같은 형식(따옴표 없는 문자열)
  renderTimetable();
  renderHomeTimetable();
  document.querySelectorAll(".student-status").forEach(element => { element.textContent = `${number} 시간표를 이 기기에 저장했어요.`; });
}
function setupTimetable() {
  document.addEventListener("submit", event => {
    const form = event.target.closest(".student-form");
    if (!form) return;
    event.preventDefault();
    applyStudentNumber(form);
  });
  $("electiveForm").addEventListener("change", event => {
    const select = event.target.closest("select[data-group]");
    if (!select) return;
    const picks = getPicks();
    if (select.value) picks[select.dataset.group] = select.value; else delete picks[select.dataset.group];
    save(KEYS.electives, picks);
    renderTimetable();
    renderHomeTimetable();
  });
}
async function loadTimetable() {
  try {
    state.timetable = await fetchJSON("./data/timetable.json");
    suggestClassSize(Object.keys(state.timetable.students || {}).length);
  } catch (error) {
    console.error("[2-3] 시간표 로딩 실패:", error);
    $("homeTimetable").innerHTML = '<p class="placeholder">시간표를 불러오지 못했습니다.</p>';
  }
  renderTimetable();
  renderHomeTimetable();
}

/* ---------- 일정 (나이스 학사일정 + 학교 구글 캘린더) ---------- */
// 같은 일정이 두 곳에 조금 다른 이름으로 올라와도 한 번만 보이게 비교용 이름을 만든다
const plainTitle = title => title.replace(/\([^)]*\)/g, "").replace(/\s+/g, "");
function calendarEventsFor(json, known) {
  return (json.events || []).flatMap(event => {
    const grades = event.title.match(/^([\d,\s]+)학년\s*[:：]/)?.[1];
    if (grades && !grades.includes(String(MY_GRADE))) return [];
    if (/교직원|연수|시험장/.test(event.title)) return [];
    const title = event.title.replace(/^(전학년|[\d,\s]+학년)\s*[:：]\s*/, "").trim();
    const days = [];
    for (let day = event.start; day <= event.end; day = shift(day, 1)) days.push(day);
    const plain = plainTitle(title);
    const duplicated = day => (known.get(day) || []).some(other => other.includes(plain) || plain.includes(other));
    return days.filter(day => !duplicated(day)).map(day => ({ date: day, title, holiday: false }));
  });
}
async function loadEvents() {
  const [schedule, calendar] = await Promise.allSettled([fetchJSON("./data/schedule.json"), fetchJSON("./data/events.json")]);
  const events = schedule.status === "fulfilled" ? schedule.value.schedules.map(item => ({ date: item.date, title: item.title, holiday: Boolean(item.holiday) })) : [];
  if (calendar.status === "fulfilled") {
    const known = new Map(); // 날짜 → 나이스에 이미 있는 일정 이름들
    events.forEach(item => known.set(item.date, [...(known.get(item.date) || []), plainTitle(item.title)]));
    events.push(...calendarEventsFor(calendar.value, known));
  }
  if (schedule.status === "rejected") console.error("[2-3] 학사일정 로딩 실패:", schedule.reason);
  if (calendar.status === "rejected") console.warn("[2-3] 학교 캘린더 로딩 실패:", calendar.reason);
  state.events = events.sort((a, b) => a.date.localeCompare(b.date));
  state.holidays = new Set(events.filter(item => item.holiday).map(item => item.date));
  renderHero(); renderDdays(); renderUpcoming(); renderCalendar(); renderHomeTimetable();
}
async function loadSupervisors() {
  try {
    const json = await fetchJSON("./data/supervisors.json");
    state.supervisors = json.supervisors || {};
  } catch (error) {
    console.warn("[2-3] 자습 감독 로딩 실패:", error);
  }
  renderHero(); renderDay();
}
const supervisorOf = date => (state.supervisors[date] || "").split(",").map(name => name.trim()).filter(Boolean).join(", ");

// 여러 날 이어지는 일정(방학 등)은 첫날만 센다
function eventStarts() {
  const keys = new Set(state.events.map(item => `${item.date}|${item.title}`));
  return state.events.filter(item => !keys.has(`${shift(item.date, -1)}|${item.title}`));
}

/* ---------- 홈: 인사 · D-day · 다가오는 일정 ---------- */
function renderHero() {
  const today = todayISO();
  $("homeDate").textContent = fmt(today, { month: "long", day: "numeric", weekday: "long" });
  const name = supervisorOf(today);
  $("homeSupervisor").hidden = !name;
  $("homeSupervisor").innerHTML = name ? `오늘 ${MY_GRADE}학년 자습 감독 <strong>${esc(name)}</strong> 선생님` : "";

  // 다음 방학까지 실제로 학교 가는 날 (주말·쉬는 날 제외)
  const vacation = eventStarts().find(item => item.date > today && /방학$/.test(item.title));
  let schoolDays = 0;
  if (vacation) for (let day = today; day < vacation.date; day = shift(day, 1)) if (isSchoolDay(day)) schoolDays++;
  $("homeVacation").hidden = !schoolDays;
  $("homeVacation").innerHTML = schoolDays ? `${esc(vacation.title)}까지 학교 가는 날 <strong>${schoolDays}일</strong>` : "";
}
const getMyDdays = () => { const list = load(KEYS.ddays, []); return Array.isArray(list) ? list : []; };
function autoDdays() {
  const today = todayISO();
  const future = eventStarts().filter(item => item.date >= today);
  const seen = new Set();
  const exams = future
    .filter(item => /고사|지필|시험|수능|평가/.test(item.title))
    .map(item => ({ title: /대학수학능력시험/.test(item.title) ? "수능" : item.title, date: item.date }))
    .filter(item => !seen.has(item.title) && seen.add(item.title))
    .slice(0, 2);
  const leave = future.find(item => /외박/.test(item.title));
  const vacation = future.find(item => /방학$/.test(item.title));
  return [...exams, ...(leave ? [{ title: "외박", date: leave.date }] : []), ...(vacation ? [{ title: vacation.title, date: vacation.date }] : [])];
}
function renderDdays() {
  const today = todayISO();
  const mine = getMyDdays().filter(item => item.date >= today).map(item => ({ ...item, mine: true }));
  const items = [...autoDdays(), ...mine].sort((a, b) => a.date.localeCompare(b.date));
  $("ddayList").innerHTML = items.map(item => `<span class="chip" title="${esc(fmt(item.date, { year: "numeric", month: "long", day: "numeric", weekday: "long" }))}">${esc(item.title)}<strong>${ddayLabel(item.date)}</strong>${item.mine ? `<button type="button" data-title="${esc(item.title)}" data-date="${item.date}" aria-label="${esc(item.title)} 삭제">×</button>` : ""}</span>`).join("");
}
function setupDdays() {
  $("ddayToggle").addEventListener("click", () => {
    $("ddayForm").hidden = !$("ddayForm").hidden;
    if (!$("ddayForm").hidden) $("ddayTitle").focus();
  });
  $("ddayForm").addEventListener("submit", event => {
    event.preventDefault();
    const title = $("ddayTitle").value.trim();
    const date = $("ddayDate").value;
    if (!title || !date) return;
    save(KEYS.ddays, [...getMyDdays(), { title, date }]);
    event.target.reset();
    $("ddayForm").hidden = true;
    renderDdays();
  });
  $("ddayList").addEventListener("click", event => {
    const button = event.target.closest("button[data-date]");
    if (!button) return;
    save(KEYS.ddays, getMyDdays().filter(item => !(item.title === button.dataset.title && item.date === button.dataset.date)));
    renderDdays();
  });
}
function renderUpcoming() {
  const today = todayISO();
  const until = shift(today, 21);
  const items = eventStarts().filter(item => item.date >= today && item.date <= until).slice(0, 7);
  const head = '<div class="card-head"><h2>다가오는 일정</h2><a class="card-link" href="#calendar">달력 보기</a></div>';
  $("homeUpcoming").innerHTML = items.length
    ? `${head}<ul class="upcoming">${items.map(item => `<li><time datetime="${item.date}">${esc(shortDate(item.date))}</time><span>${esc(item.title)}</span><span class="when">${daysUntil(item.date) <= 1 ? relativeDay(item.date) : ddayLabel(item.date)}</span></li>`).join("")}</ul>`
    : `${head}<p class="placeholder">3주 안에 잡힌 일정이 없어요.</p>`;
}

/* ---------- 할 일 (수행평가·숙제·준비물) ---------- */
const getTodos = () => { const list = load(KEYS.todos, []); return Array.isArray(list) ? list : []; };
// 안 끝낸 것 먼저, 그 안에서는 마감이 가까운 순 (마감 없는 것은 뒤로)
const sortedTodos = () => getTodos().sort((a, b) => (a.done - b.done) || (a.date || "9").localeCompare(b.date || "9"));
function todoItemHTML(item, showDate) {
  const left = item.date ? daysUntil(item.date) : null;
  const when = item.done || left === null ? ""
    : left < 0 ? `<span class="when late">${-left}일 지남</span>`
    : `<span class="when">${left <= 1 ? relativeDay(item.date) : ddayLabel(item.date)}</span>`;
  return `<li class="todo ${item.done ? "done" : ""}"><label><input type="checkbox" data-todo="${esc(item.id)}" ${item.done ? "checked" : ""}><span>${esc(item.title)}${showDate && item.date ? `<small>${esc(shortDate(item.date))}</small>` : ""}</span></label>${when}<button type="button" class="todo-remove" data-todo-remove="${esc(item.id)}" aria-label="${esc(item.title)} 삭제">×</button></li>`;
}
function renderTodos() {
  const items = sortedTodos();
  const doneCount = items.filter(item => item.done).length;
  $("todoList").innerHTML = items.length
    ? items.map(item => todoItemHTML(item, true)).join("")
    : '<li class="muted">수행평가나 준비물을 적어 두면 마감까지 며칠 남았는지 알려 줘요.</li>';
  $("todoClear").hidden = !doneCount;
  $("todoClear").textContent = `끝낸 ${doneCount}개 지우기`;
  renderCalendar();
}
function addTodo(title, date) {
  if (!title) return;
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  save(KEYS.todos, [...getTodos(), { id, title, date: date || "", done: false }]);
  renderTodos();
}
function setupTodos() {
  $("todoForm").addEventListener("submit", event => {
    event.preventDefault();
    addTodo($("todoTitle").value.trim(), $("todoDate").value);
    event.target.reset();
  });
  $("dayTodoForm").addEventListener("submit", event => {
    event.preventDefault();
    addTodo($("dayTodoTitle").value.trim(), state.calendarDate);
    event.target.reset();
  });
  $("todoClear").addEventListener("click", () => { save(KEYS.todos, getTodos().filter(item => !item.done)); renderTodos(); });
  // 홈과 달력 두 곳에 같은 목록이 있어 문서 전체에서 받는다
  document.addEventListener("change", event => {
    const id = event.target.dataset?.todo;
    if (!id) return;
    save(KEYS.todos, getTodos().map(item => item.id === id ? { ...item, done: event.target.checked } : item));
    renderTodos();
  });
  document.addEventListener("click", event => {
    const id = event.target.closest("[data-todo-remove]")?.dataset.todoRemove;
    if (!id) return;
    save(KEYS.todos, getTodos().filter(item => item.id !== id));
    renderTodos();
  });
}

/* ---------- 달력 ---------- */
const getMemos = () => load(KEYS.memos, {});
const noticesOn = date => (state.notices || []).filter(item => String(item.date || "").slice(0, 10) === date);
function renderCalendar() {
  const [year, month] = state.calendarMonth.split("-").map(Number);
  $("calendarMonth").textContent = `${year}년 ${month}월`;
  const first = `${state.calendarMonth}-01`;
  const start = shift(first, -parseISO(first).getDay());
  const lastDay = new Date(year, month, 0).getDate();
  const weeks = Math.ceil((parseISO(first).getDay() + lastDay) / 7);
  const memos = getMemos();
  const todos = getTodos().filter(item => item.date && !item.done);
  const today = todayISO();
  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const date = shift(start, i);
    const events = state.events.filter(item => item.date === date);
    const labels = [
      ...events.map(item => ({ kind: item.holiday ? "holiday" : "school", text: item.title })),
      ...noticesOn(date).map(item => ({ kind: "notice", text: item.title || "공지" })),
      ...todos.filter(item => item.date === date).map(item => ({ kind: "memo", text: item.title })),
      ...(memos[date] ? [{ kind: "memo", text: "메모" }] : [])
    ];
    const off = parseISO(date).getDay() === 0 || state.holidays.has(date);
    const classes = ["cal-day", date.slice(0, 7) === state.calendarMonth ? "" : "outside", off ? "off" : "", date === today ? "today" : "", date === state.calendarDate ? "selected" : ""].filter(Boolean).join(" ");
    const summary = [fmt(date, { month: "long", day: "numeric", weekday: "long" }), ...labels.map(label => label.text)].join(", ");
    cells.push(`<button type="button" class="${classes}" data-date="${date}" aria-label="${esc(summary)}"><span class="num">${parseISO(date).getDate()}</span>${labels.slice(0, 3).map(label => `<span class="cal-label ${label.kind}">${esc(label.text)}</span>`).join("")}${labels.length > 3 ? `<span class="cal-more">+${labels.length - 3}</span>` : ""}</button>`);
  }
  $("calendarGrid").innerHTML = cells.join("");
  renderDay();
}
function renderDay() {
  const date = state.calendarDate;
  $("dayTitle").textContent = fmt(date, { month: "long", day: "numeric", weekday: "long" });
  const items = [
    ...state.events.filter(item => item.date === date).map(item => `<div class="day-item"><span class="kind cal-label ${item.holiday ? "holiday" : "school"}">${item.holiday ? "쉬는 날" : "학교 일정"}</span><strong>${esc(item.title)}</strong></div>`),
    ...noticesOn(date).map(item => `<div class="day-item"><span class="kind cal-label notice">공지</span><strong>${esc(item.title || "제목 없음")}</strong><p>${esc(item.content || "")}</p></div>`)
  ];
  const supervisor = supervisorOf(date);
  if (supervisor) items.push(`<div class="day-item"><span class="kind cal-label memo">자습 감독</span><strong>${esc(supervisor)}</strong></div>`);
  const todos = sortedTodos().filter(item => item.date === date);
  if (todos.length) items.push(`<ul class="todo-list">${todos.map(item => todoItemHTML(item, false)).join("")}</ul>`);
  $("dayDetails").innerHTML = items.join("") || '<p class="muted">이 날은 등록된 일정이 없어요.</p>';
  if (document.activeElement !== $("memoText")) $("memoText").value = getMemos()[date] || "";
  $("memoStatus").textContent = "";
}
function setupCalendar() {
  const moveMonth = delta => {
    const [year, month] = state.calendarMonth.split("-").map(Number);
    state.calendarMonth = toISO(new Date(year, month - 1 + delta, 1, 12)).slice(0, 7);
    renderCalendar();
  };
  const select = date => {
    state.calendarDate = date;
    state.calendarMonth = date.slice(0, 7);
    renderCalendar();
  };
  $("calendarPrev").addEventListener("click", () => moveMonth(-1));
  $("calendarNext").addEventListener("click", () => moveMonth(1));
  $("calendarToday").addEventListener("click", () => select(todayISO()));
  $("calendarGrid").addEventListener("click", event => {
    const date = event.target.closest("[data-date]")?.dataset.date;
    if (date) select(date);
  });
  // 메모는 쓰는 대로 저장한다
  $("memoText").addEventListener("input", () => {
    const memos = getMemos();
    const value = $("memoText").value.trim();
    const had = Boolean(memos[state.calendarDate]);
    if (value) memos[state.calendarDate] = value; else delete memos[state.calendarDate];
    save(KEYS.memos, memos);
    $("memoStatus").textContent = value ? "이 기기에 저장했어요." : had ? "메모를 지웠어요." : "";
  });
  $("memoText").addEventListener("blur", renderCalendar);
}

/* ---------- 공지 (Firebase — meal-dg와 같은 프로젝트를 써서 기존 공지가 그대로 보인다) ---------- */
const FIREBASE_VERSION = "11.10.0";
const ADMIN_UID = "mxrtFi3CiGca2DCafbRlalT1eHB3";
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyD9dG8K4sTonjhEM9xrF1j8GtXJt1cGIkI",
  authDomain: "meal-dg.firebaseapp.com",
  projectId: "meal-dg",
  storageBucket: "meal-dg.firebasestorage.app",
  messagingSenderId: "236989701948",
  appId: "1:236989701948:web:91efb2a5946bfd77e00839"
};
const firebase = { auth: null, db: null, authApi: null, dbApi: null, user: null };
const isAdmin = () => firebase.user?.uid === ADMIN_UID;
const authStatus = message => { $("authStatus").textContent = message || ""; };

// 아직 안 본 공지 id. 처음 온 사람에게는 예전 공지를 전부 새 글로 띄우지 않는다
function unseenNoticeIds() {
  const seen = load(KEYS.seenNotices, null);
  return new Set(seen ? (state.notices || []).filter(item => !seen.includes(item.id)).map(item => item.id) : []);
}
function markNoticesSeen() {
  if (state.notices) save(KEYS.seenNotices, state.notices.map(item => item.id));
  document.querySelector('.tab[data-page="notices"]').classList.remove("has-new");
}
function renderNotices() {
  const list = state.notices;
  if (list === null) return;
  const unseen = unseenNoticeIds();
  const fresh = item => unseen.has(item.id) ? '<span class="tag accent">새 글</span>' : "";
  document.querySelector('.tab[data-page="notices"]').classList.toggle("has-new", unseen.size > 0);
  const head = '<div class="card-head"><h2>공지</h2><a class="card-link" href="#notices">전체 보기</a></div>';
  $("homeNotices").innerHTML = list.length
    ? `${head}${list.slice(0, 3).map(item => `<a class="home-notice" href="#notices"><strong>${esc(item.title || "제목 없음")}${fresh(item)}</strong><span>${esc(item.date || "")}</span></a>`).join("")}`
    : `${head}<p class="placeholder">등록된 공지가 없어요.</p>`;
  $("noticeList").innerHTML = list.length
    ? list.map(item => `<article class="card notice-card"><div class="card-head"><h2>${esc(item.title || "제목 없음")}${fresh(item)}</h2><time>${esc(item.date || "")}</time></div><p>${esc(item.content || "")}</p>${isAdmin() ? `<div class="notice-actions"><button type="button" class="text-button" data-edit="${esc(item.id)}">수정</button><button type="button" class="text-button" data-delete="${esc(item.id)}">삭제</button></div>` : ""}</article>`).join("")
    : '<p class="placeholder">등록된 공지가 없습니다.</p>';
}
function noticesFailed(message) {
  $("noticeList").innerHTML = `<p class="placeholder">${message}</p>`;
  $("homeNotices").innerHTML = `<div class="card-head"><h2>공지</h2></div><p class="placeholder">${message}</p>`;
}
async function loadNotices() {
  if (!firebase.db) return;
  try {
    const { collection, getDocs, query, orderBy } = firebase.dbApi;
    const result = await getDocs(query(collection(firebase.db, "publicMemos"), orderBy("date", "desc")));
    state.notices = result.docs.map(item => ({ id: item.id, ...item.data() }));
    if (load(KEYS.seenNotices, null) === null) save(KEYS.seenNotices, state.notices.map(item => item.id));
    renderNotices();
    if (currentPage() === "notices") markNoticesSeen();
    renderCalendar();
  } catch (error) {
    console.error("[2-3] 공지 로딩 실패:", error);
    if (state.notices === null) noticesFailed("공지를 불러오지 못했습니다.");
  }
}
function updateAuthUI() {
  const user = firebase.user;
  $("loginForm").hidden = Boolean(user);
  $("loggedIn").hidden = !user;
  $("noticeForm").hidden = !isAdmin();
  $("loggedInEmail").textContent = user?.email || "—";
  $("adminRole").textContent = isAdmin() ? "관리자 권한 확인됨" : "이 계정은 공지를 쓸 수 없습니다.";
  if (isAdmin() && !$("noticeDate").value) $("noticeDate").value = todayISO();
}
function resetNoticeForm() {
  $("noticeForm").reset();
  $("noticeId").value = "";
  $("noticeDate").value = todayISO();
  $("noticeFormTitle").textContent = "공지 작성";
}
function setupNotices() {
  $("reloadNotices").addEventListener("click", loadNotices);
  $("loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    if (!firebase.auth) return authStatus("공지 서버에 연결하지 못했습니다.");
    try {
      await firebase.authApi.signInWithEmailAndPassword(firebase.auth, $("adminEmail").value.trim(), $("adminPassword").value);
      $("adminPassword").value = "";
      authStatus("");
    } catch (error) {
      console.error(error);
      authStatus("로그인에 실패했습니다. 이메일과 비밀번호를 확인해 주세요.");
    }
  });
  $("adminLogout").addEventListener("click", () => firebase.authApi.signOut(firebase.auth).catch(console.error));
  $("noticeCancel").addEventListener("click", () => { resetNoticeForm(); $("noticeFormStatus").textContent = ""; });
  $("noticeForm").addEventListener("submit", async event => {
    event.preventDefault();
    if (!isAdmin()) return;
    const { collection, addDoc, doc, updateDoc, serverTimestamp } = firebase.dbApi;
    const id = $("noticeId").value;
    const fields = { date: $("noticeDate").value, title: $("noticeTitle").value.trim(), content: $("noticeContent").value.trim(), updatedAt: serverTimestamp(), updatedBy: firebase.user.uid };
    if (!fields.date || !fields.title || !fields.content) return;
    try {
      if (id) await updateDoc(doc(firebase.db, "publicMemos", id), fields);
      else await addDoc(collection(firebase.db, "publicMemos"), { ...fields, createdAt: serverTimestamp(), createdBy: firebase.user.uid });
      resetNoticeForm();
      $("noticeFormStatus").textContent = "저장했습니다.";
      await loadNotices();
    } catch (error) {
      console.error(error);
      $("noticeFormStatus").textContent = "저장에 실패했습니다. Firestore 보안 규칙을 확인해 주세요.";
    }
  });
  $("noticeList").addEventListener("click", async event => {
    if (!isAdmin()) return;
    const editId = event.target.closest("[data-edit]")?.dataset.edit;
    const deleteId = event.target.closest("[data-delete]")?.dataset.delete;
    if (editId) {
      const item = state.notices.find(entry => entry.id === editId);
      if (!item) return;
      $("noticeId").value = item.id;
      $("noticeDate").value = item.date || todayISO();
      $("noticeTitle").value = item.title || "";
      $("noticeContent").value = item.content || "";
      $("noticeFormTitle").textContent = "공지 수정";
      $("noticeForm").scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (deleteId && confirm("이 공지를 삭제할까요?")) {
      try {
        await firebase.dbApi.deleteDoc(firebase.dbApi.doc(firebase.db, "publicMemos", deleteId));
        await loadNotices();
      } catch (error) {
        console.error(error);
        authStatus("삭제에 실패했습니다. Firestore 보안 규칙을 확인해 주세요.");
      }
    }
  });
}
async function initFirebase() {
  try {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
    const [appApi, authApi, dbApi] = await Promise.all([import(`${base}/firebase-app.js`), import(`${base}/firebase-auth.js`), import(`${base}/firebase-firestore.js`)]);
    const app = appApi.initializeApp(FIREBASE_CONFIG);
    Object.assign(firebase, { auth: authApi.getAuth(app), db: dbApi.getFirestore(app), authApi, dbApi });
    authApi.onAuthStateChanged(firebase.auth, user => {
      firebase.user = user;
      updateAuthUI();
      renderNotices();
    });
    await loadNotices();
  } catch (error) {
    console.error("[2-3] Firebase 연결 실패:", error);
    noticesFailed("공지 서버에 연결하지 못했습니다.");
  }
}

/* ---------- 테마 · 앱 설치 ---------- */
function setupTheme() {
  $("themeToggle").addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem(KEYS.theme, root.dataset.theme); } catch { /* 무시 */ }
  });
}
function setupInstall() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(error => console.warn("[2-3] 서비스 워커 등록 실패:", error));
  let prompt = null;
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    prompt = event;
    $("installButton").hidden = false;
  });
  $("installButton").addEventListener("click", async () => {
    if (!prompt) return;
    prompt.prompt();
    await prompt.userChoice;
    prompt = null;
    $("installButton").hidden = true;
  });
}

/* ---------- 시작 ---------- */
function start() {
  window.addEventListener("hashchange", showPage);
  showPage();
  setupTheme();
  setupMeals();
  setupTimetable();
  setupDdays();
  setupCalendar();
  setupNotices();
  setupTodos();
  setupTools();
  setupSeats();
  setupInstall();

  renderHero();
  renderDdays();
  renderMeals();
  renderTodos(); // 달력도 함께 그린다

  loadMeals();
  loadTimetable();
  loadEvents();
  loadSupervisors();
  initFirebase();

  // 켜 둔 채로 날짜·끼니가 바뀌어도 홈이 맞게 보이도록
  let lastDay = todayISO();
  const refresh = () => {
    if (document.hidden) return;
    if (todayISO() !== lastDay) return location.reload();
    renderHomeMeal(); renderHomeTimetable();
  };
  document.addEventListener("visibilitychange", refresh);
  setInterval(refresh, 5 * 60 * 1000);
}

start();
