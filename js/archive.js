import { sb } from "./supabaseClient.js";
import { renderNav, requireAuth } from "./nav.js";

renderNav("archive");
const user = await requireAuth();
if (!user) throw new Error("redirecting to login");

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------
let cursor = startOfMonth(new Date());   // month currently shown
let selectedDate = new Date();           // day shown in the detail panel
let monthNotes = {};                     // iso date -> { feedback, mood }

// ---------------------------------------------------------------------
// Date helpers (local time, matches dashboard.js conventions)
// ---------------------------------------------------------------------
function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }

const MOOD_EMOJI = { great: "🙂", okay: "😐", rough: "🙁" };

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------
await renderMonth();
showDetail(selectedDate);
wireEvents();

// ---------------------------------------------------------------------
// Load + render the calendar for the current `cursor` month
// ---------------------------------------------------------------------
async function loadMonthNotes(monthDate) {
  const first = startOfMonth(monthDate);
  const last = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);

  const { data, error } = await sb
    .from("daily_feedback")
    .select("feedback_date, feedback, mood")
    .gte("feedback_date", toISODate(first))
    .lte("feedback_date", toISODate(last));

  const map = {};
  if (!error && data) {
    for (const row of data) map[row.feedback_date] = { feedback: row.feedback, mood: row.mood };
  }
  return map;
}

async function renderMonth() {
  document.getElementById("archMonthLabel").textContent = cursor.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  monthNotes = await loadMonthNotes(cursor);

  const grid = document.getElementById("archiveGrid");
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let html = dows.map((d) => `<div class="dow-label">${d}</div>`).join("");

  const firstDay = startOfMonth(cursor);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const today = new Date();

  for (let i = 0; i < startOffset; i++) html += `<div class="archive-day is-empty-cell"></div>`;

  for (let day = 1; day <= daysInMonth; day++) {
    const cellDate = new Date(cursor.getFullYear(), cursor.getMonth(), day);
    const iso = toISODate(cellDate);
    const note = monthNotes[iso];
    const classes = ["archive-day"];
    if (sameDay(cellDate, today)) classes.push("is-today");
    if (sameDay(cellDate, selectedDate)) classes.push("is-selected");

    let dot = "";
    if (note) {
      const dotClass = note.mood && MOOD_EMOJI[note.mood] ? note.mood : "note";
      dot = `<span class="dot ${dotClass}"></span>`;
    }
    html += `<button class="${classes.join(" ")}" data-date="${iso}" type="button">${day}${dot}</button>`;
  }

  grid.innerHTML = html;
  grid.querySelectorAll(".archive-day[data-date]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [y, m, d] = btn.dataset.date.split("-").map(Number);
      const clicked = new Date(y, m - 1, d);
      selectedDate = clicked;
      renderMonth();
      showDetail(clicked);
    });
  });
}

// ---------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------
function showDetail(date) {
  const today = new Date();
  document.getElementById("archDetailDate").textContent = sameDay(date, today)
    ? "Today"
    : date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const iso = toISODate(date);
  const note = monthNotes[iso];
  const body = document.getElementById("archDetailBody");

  if (!note || (!note.feedback && !note.mood)) {
    body.innerHTML = `<p class="archive-detail-empty">No reflection saved for this day.</p>`;
    return;
  }

  const moodHtml = note.mood && MOOD_EMOJI[note.mood]
    ? `<div class="archive-detail-mood">${MOOD_EMOJI[note.mood]}</div>`
    : "";
  const textHtml = note.feedback
    ? `<div class="archive-detail-text">${escapeHtml(note.feedback)}</div>`
    : `<p class="archive-detail-empty">Mood logged, no written note.</p>`;

  body.innerHTML = moodHtml + textHtml;
}

// ---------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------
function wireEvents() {
  document.getElementById("archPrevMonth").addEventListener("click", () => {
    cursor = addMonths(cursor, -1);
    renderMonth();
  });
  document.getElementById("archNextMonth").addEventListener("click", () => {
    cursor = addMonths(cursor, 1);
    renderMonth();
  });
  document.getElementById("archTodayBtn").addEventListener("click", () => {
    cursor = startOfMonth(new Date());
    selectedDate = new Date();
    renderMonth();
    showDetail(selectedDate);
  });
}
