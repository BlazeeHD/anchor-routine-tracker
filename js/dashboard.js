import { sb } from "./supabaseClient.js";
import { renderNav, requireAuth } from "./nav.js";
import { generateAdvice } from "./advice.js";

renderNav("dashboard");
const user = await requireAuth();
if (!user) throw new Error("redirecting to login");

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------
let routines = [];               // active routine templates, sorted by time
let logsForDay = {};             // routine_id -> log row for selectedDate
let selectedDate = new Date();   // local date being viewed
let calCursor = startOfMonth(selectedDate); // month currently shown in the calendar dropdown
let activeCategory = "All";      // category filter pill currently selected

// ---------------------------------------------------------------------
// Date helpers (all local time, never UTC, so Postgres `date` matches
// the day the user actually sees on screen)
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
function addDays(d, n) { const copy = new Date(d); copy.setDate(copy.getDate() + n); return copy; }
function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }

// ---------------------------------------------------------------------
// DOM refs + Bootstrap component instances
// ---------------------------------------------------------------------
const timelineWrap = document.getElementById("timelineWrap");
const dateLabelDow = document.getElementById("dateLabelDow");
const dateLabelDate = document.getElementById("dateLabelDate");
const dateLabelBtn = document.getElementById("dateLabelBtn");

const feedbackModalEl = document.getElementById("feedbackModal");
const feedbackModal = new bootstrap.Modal(feedbackModalEl);

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------
await loadRoutines();
renderCategoryFilters();
await loadDay(selectedDate);
wireEvents();

// ---------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------
async function loadRoutines() {
  const { data, error } = await sb
    .from("routines")
    .select("*")
    .eq("active", true)
    .order("time", { ascending: true });
  if (error) {
    timelineWrap.innerHTML = `<div class="alert alert-danger">Couldn't load your routine: ${error.message}</div>`;
    return;
  }
  routines = data || [];
}

async function loadDay(date) {
  selectedDate = date;
  renderDateLabel();

  const dateStr = toISODate(date);
  const { data, error } = await sb
    .from("routine_logs")
    .select("*")
    .eq("log_date", dateStr);

  logsForDay = {};
  if (!error && data) {
    for (const row of data) logsForDay[row.routine_id] = row;
  }

  renderTimeline();
  renderStats();
  await loadFeedback(dateStr);
  await loadAdvice();
}

function renderDateLabel() {
  const today = new Date();
  dateLabelDow.textContent = sameDay(selectedDate, today)
    ? "Today"
    : selectedDate.toLocaleDateString(undefined, { weekday: "short" });
  dateLabelDate.textContent = selectedDate.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: selectedDate.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
  document.getElementById("pageTitle").textContent = sameDay(selectedDate, today) ? "Today's plan" : "Day plan";
}

// ---------------------------------------------------------------------
// Timeline rendering
// ---------------------------------------------------------------------
function fmtTime(t) {
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}
function categorySlug(cat) {
  return "cat-" + (cat || "Personal").toLowerCase();
}

function getFilteredRoutines() {
  return activeCategory === "All" ? routines : routines.filter((r) => (r.category || "Personal") === activeCategory);
}

function renderCategoryFilters() {
  const host = document.getElementById("categoryFilters");
  const categories = [...new Set(routines.map((r) => r.category || "Personal"))];

  if (categories.length <= 1) {
    host.innerHTML = "";
    return; // nothing to filter if everything's one category (or no routines yet)
  }

  const pill = (label, isActive) => `
    <button class="filter-pill ${isActive ? "is-active" : ""}" data-cat="${label}" type="button">
      ${label === "All" ? "" : `<span class="dot" style="background: var(--cat-${categorySlug(label).replace("cat-", "")})"></span>`}${label}
    </button>`;

  host.innerHTML = pill("All", activeCategory === "All") + categories.map((c) => pill(c, activeCategory === c)).join("");

  host.querySelectorAll(".filter-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeCategory = btn.dataset.cat;
      renderCategoryFilters();
      renderTimeline();
      renderStats();
    });
  });
}

function renderTimeline() {
  if (routines.length === 0) {
    timelineWrap.innerHTML = `
      <div class="text-center border border-secondary-subtle rounded-4 p-5">
        <p class="text-secondary-emphasis mb-3">You haven't set up a routine yet.</p>
        <a class="btn btn-primary" href="./routines.html">+ Build your routine</a>
      </div>`;
    return;
  }

  const visible = getFilteredRoutines();
  if (visible.length === 0) {
    timelineWrap.innerHTML = `
      <div class="text-center border border-secondary-subtle rounded-4 p-5">
        <p class="text-secondary-emphasis mb-0">No ${activeCategory} blocks for this day.</p>
      </div>`;
    return;
  }

  const items = visible
    .map((r) => {
      const log = logsForDay[r.id];
      const status = log ? log.status : "pending";
      const reason = log ? log.reason || "" : "";
      return `
        <div class="card tl-item is-${status}" data-routine-id="${r.id}">
          <div class="tl-node"></div>
          <div class="card-body">
            <div class="d-flex justify-content-between align-items-start gap-3">
              <div>
                <div class="d-flex align-items-center gap-2 mb-1">
                  <span class="font-mono small text-teal">${fmtTime(r.time)}</span>
                  <span class="cat-badge ${categorySlug(r.category)}">${escapeHtml(r.category || "Personal")}</span>
                </div>
                <div class="fw-semibold">${escapeHtml(r.title)}</div>
                ${r.description ? `<div class="text-secondary-emphasis small mt-1">${escapeHtml(r.description)}</div>` : ""}
              </div>
              <div class="font-mono text-faint small text-nowrap">${r.duration_minutes}m</div>
            </div>
            <div class="d-flex flex-wrap align-items-center gap-2 mt-3">
              <button class="btn btn-sm btn-outline-success status-btn ${status === "done" ? "is-active-done" : ""}" data-action="done">Did it</button>
              <button class="btn btn-sm btn-outline-danger status-btn ${status === "missed" ? "is-active-missed" : ""}" data-action="missed">Missed it</button>
              <button class="btn btn-sm btn-link text-secondary-emphasis text-decoration-underline p-0 ms-1" data-action="toggle-note">${reason ? "Edit note" : "Add note"}</button>
            </div>
            <div class="mt-3 ${reason ? "" : "d-none"}" data-note-box>
              <textarea class="form-control form-control-sm mb-2" rows="2" placeholder="Optional — why (or why not)?">${escapeHtml(reason)}</textarea>
              <button class="btn btn-outline-secondary btn-sm" data-action="save-note">Save note</button>
              <span class="small text-teal ms-2 d-none" data-note-saved>Saved</span>
            </div>
          </div>
        </div>`;
    })
    .join("");

  timelineWrap.innerHTML = `<div class="timeline d-flex flex-column gap-3">${items}</div>`;

  timelineWrap.querySelectorAll(".tl-item").forEach((el) => {
    const routineId = el.dataset.routineId;
    el.querySelector('[data-action="done"]').addEventListener("click", () => setStatus(routineId, "done"));
    el.querySelector('[data-action="missed"]').addEventListener("click", () => setStatus(routineId, "missed"));
    el.querySelector('[data-action="toggle-note"]').addEventListener("click", () => {
      el.querySelector("[data-note-box]").classList.toggle("d-none");
    });
    el.querySelector('[data-action="save-note"]').addEventListener("click", () => saveNote(routineId, el));
  });
}

async function setStatus(routineId, newStatus) {
  const current = logsForDay[routineId]?.status || "pending";
  const finalStatus = current === newStatus ? "pending" : newStatus;
  const dateStr = toISODate(selectedDate);

  const { data, error } = await sb
    .from("routine_logs")
    .upsert(
      { user_id: user.id, routine_id: routineId, log_date: dateStr, status: finalStatus },
      { onConflict: "routine_id,log_date" }
    )
    .select()
    .single();

  if (error) {
    alert(`Couldn't save: ${error.message}`);
    return;
  }
  logsForDay[routineId] = data;
  renderTimeline();
  renderStats();
  loadAdvice();
}

async function saveNote(routineId, itemEl) {
  const dateStr = toISODate(selectedDate);
  const text = itemEl.querySelector("[data-note-box] textarea").value.trim();

  const { data, error } = await sb
    .from("routine_logs")
    .upsert(
      { user_id: user.id, routine_id: routineId, log_date: dateStr, reason: text },
      { onConflict: "routine_id,log_date" }
    )
    .select()
    .single();

  if (error) {
    alert(`Couldn't save note: ${error.message}`);
    return;
  }
  logsForDay[routineId] = data;
  const savedTag = itemEl.querySelector("[data-note-saved]");
  savedTag.classList.remove("d-none");
  setTimeout(() => savedTag.classList.add("d-none"), 1500);
}

// ---------------------------------------------------------------------
// Stats bar
// ---------------------------------------------------------------------
function renderStats() {
  const visible = getFilteredRoutines();
  const total = visible.length;
  let done = 0, missed = 0, doneMinutes = 0, missedMinutes = 0, totalMinutes = 0;

  for (const r of visible) {
    totalMinutes += r.duration_minutes;
    const status = logsForDay[r.id]?.status;
    if (status === "done") { done++; doneMinutes += r.duration_minutes; }
    else if (status === "missed") { missed++; missedMinutes += r.duration_minutes; }
  }
  const pending = total - done - missed;
  const pct = total ? Math.round((done / total) * 100) : 0;

  document.getElementById("statPct").textContent = `${pct}%`;
  document.getElementById("statDoneMin").textContent = `${doneMinutes}m`;
  document.getElementById("statMissedMin").textContent = `${missedMinutes}m`;
  document.getElementById("statPendingCount").textContent = String(pending);

  document.getElementById("segDone").style.width = totalMinutes ? `${(doneMinutes / totalMinutes) * 100}%` : "0%";
  document.getElementById("segMissed").style.width = totalMinutes ? `${(missedMinutes / totalMinutes) * 100}%` : "0%";
}

// ---------------------------------------------------------------------
// Feedback (modal)
// ---------------------------------------------------------------------
async function loadFeedback(dateStr) {
  const feedbackText = document.getElementById("feedbackText");
  const moodSelect = document.getElementById("moodSelect");
  const msg = document.getElementById("feedbackMsg");
  const preview = document.getElementById("feedbackPreview");
  msg.innerHTML = "";

  const { data } = await sb
    .from("daily_feedback")
    .select("*")
    .eq("feedback_date", dateStr)
    .maybeSingle();

  feedbackText.value = data?.feedback || "";
  moodSelect.value = data?.mood || "";

  const moodEmoji = { great: "🙂", okay: "😐", rough: "🙁" };
  if (data?.feedback) {
    const trimmed = data.feedback.length > 90 ? data.feedback.slice(0, 90) + "…" : data.feedback;
    preview.textContent = `${data.mood ? moodEmoji[data.mood] + " " : ""}${trimmed}`;
  } else if (data?.mood) {
    preview.textContent = `${moodEmoji[data.mood]} Mood logged, no written note.`;
  } else {
    preview.textContent = "Optional — a few words on how the day actually went.";
  }
}

document.getElementById("saveFeedback").addEventListener("click", async () => {
  const dateStr = toISODate(selectedDate);
  const feedback = document.getElementById("feedbackText").value.trim();
  const mood = document.getElementById("moodSelect").value || null;
  const msg = document.getElementById("feedbackMsg");
  const btn = document.getElementById("saveFeedback");
  btn.disabled = true;

  const { error } = await sb
    .from("daily_feedback")
    .upsert(
      { user_id: user.id, feedback_date: dateStr, feedback, mood },
      { onConflict: "user_id,feedback_date" }
    );

  btn.disabled = false;
  if (error) {
    msg.innerHTML = `<div class="alert alert-danger py-2 small">${error.message}</div>`;
    return;
  }
  msg.innerHTML = `<div class="alert alert-success py-2 small">Reflection saved.</div>`;
  await loadFeedback(dateStr);
  setTimeout(() => feedbackModal.hide(), 700);
});

// ---------------------------------------------------------------------
// Advice
// ---------------------------------------------------------------------
async function loadAdvice() {
  const adviceList = document.getElementById("adviceList");
  const total = routines.length;
  let done = 0, missed = 0, doneMinutes = 0, missedMinutes = 0;
  for (const r of routines) {
    const status = logsForDay[r.id]?.status;
    if (status === "done") { done++; doneMinutes += r.duration_minutes; }
    else if (status === "missed") { missed++; missedMinutes += r.duration_minutes; }
  }
  const today = { total, done, missed, pending: total - done - missed, doneMinutes, missedMinutes };

  const weekAgo = addDays(selectedDate, -6);
  const { data, error } = await sb
    .from("routine_logs")
    .select("log_date,status,routine_id,routines(title,time)")
    .gte("log_date", toISODate(weekAgo))
    .lte("log_date", toISODate(selectedDate));

  let recentLogs = [];
  if (!error && data) {
    recentLogs = data
      .filter((row) => row.routines)
      .map((row) => ({
        log_date: row.log_date,
        status: row.status,
        title: row.routines.title,
        time: row.routines.time,
      }));
  }

  const advice = generateAdvice(today, recentLogs, routines);
  adviceList.innerHTML = advice
    .map(
      (a) => `<li class="advice-item rounded-3 p-3 small d-flex gap-2 align-items-start"><div><span class="advice-tag d-block mb-1">${a.tag}</span>${escapeHtml(a.text)}</div></li>`
    )
    .join("");
}

// ---------------------------------------------------------------------
// Calendar dropdown
// ---------------------------------------------------------------------
async function renderCalendarPopover() {
  document.getElementById("calMonthLabel").textContent = calCursor.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const grid = document.getElementById("calendarGrid");
  const dows = ["S", "M", "T", "W", "T", "F", "S"];
  let html = dows.map((d) => `<div class="dow">${d}</div>`).join("");

  const firstDay = startOfMonth(calCursor);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 0).getDate();
  const monthDots = await fetchMonthCompletion(calCursor);
  const today = new Date();

  for (let i = 0; i < startOffset; i++) html += `<div></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const cellDate = new Date(calCursor.getFullYear(), calCursor.getMonth(), day);
    const iso = toISODate(cellDate);
    const classes = ["cal-day"];
    if (sameDay(cellDate, today)) classes.push("is-today");
    if (sameDay(cellDate, selectedDate)) classes.push("is-selected");
    const ratio = monthDots[iso];
    let dot = "";
    if (ratio !== undefined) {
      const dotClass = ratio >= 0.7 ? "good" : ratio < 0.4 ? "bad" : "mid";
      dot = `<span class="dot ${dotClass}"></span>`;
    }
    html += `<button class="${classes.join(" ")}" data-date="${iso}" type="button">${day}${dot}</button>`;
  }

  grid.innerHTML = html;
  grid.querySelectorAll(".cal-day[data-date]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [y, m, d] = btn.dataset.date.split("-").map(Number);
      loadDay(new Date(y, m - 1, d));
      bootstrap.Dropdown.getOrCreateInstance(dateLabelBtn).hide();
    });
  });
}

async function fetchMonthCompletion(monthDate) {
  const first = startOfMonth(monthDate);
  const last = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  const { data, error } = await sb
    .from("routine_logs")
    .select("log_date,status")
    .gte("log_date", toISODate(first))
    .lte("log_date", toISODate(last));

  const byDate = {};
  if (!error && data) {
    for (const row of data) {
      if (row.status === "pending") continue;
      if (!byDate[row.log_date]) byDate[row.log_date] = { done: 0, total: 0 };
      byDate[row.log_date].total++;
      if (row.status === "done") byDate[row.log_date].done++;
    }
  }
  const ratios = {};
  for (const [date, v] of Object.entries(byDate)) ratios[date] = v.done / v.total;
  return ratios;
}

// ---------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------
function wireEvents() {
  document.getElementById("prevDay").addEventListener("click", () => loadDay(addDays(selectedDate, -1)));
  document.getElementById("nextDay").addEventListener("click", () => loadDay(addDays(selectedDate, 1)));

  // Reset the calendar to the selected date's month each time it's opened
  document.getElementById("calendarDropdown").addEventListener("show.bs.dropdown", () => {
    calCursor = startOfMonth(selectedDate);
    renderCalendarPopover();
  });

  document.getElementById("calPrevMonth").addEventListener("click", (e) => {
    e.stopPropagation();
    calCursor = addMonths(calCursor, -1);
    renderCalendarPopover();
  });
  document.getElementById("calNextMonth").addEventListener("click", (e) => {
    e.stopPropagation();
    calCursor = addMonths(calCursor, 1);
    renderCalendarPopover();
  });
}
