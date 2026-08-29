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
let calCursor = startOfMonth(selectedDate); // month currently shown in popover

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
// DOM refs
// ---------------------------------------------------------------------
const timelineWrap = document.getElementById("timelineWrap");
const dateLabelDow = document.getElementById("dateLabelDow");
const dateLabelDate = document.getElementById("dateLabelDate");
const calendarPop = document.getElementById("calendarPop");
const dateLabelBtn = document.getElementById("dateLabelBtn");

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------
await loadRoutines();
await loadDay(selectedDate);
renderCalendarPopover();
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
    timelineWrap.innerHTML = `<div class="form-error">Couldn't load your routine: ${error.message}</div>`;
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

function renderTimeline() {
  if (routines.length === 0) {
    timelineWrap.innerHTML = `
      <div class="timeline-empty">
        <p>You haven't set up a routine yet.</p>
        <a class="btn btn-primary" href="./routines.html">+ Build your routine</a>
      </div>`;
    return;
  }

  const items = routines
    .map((r) => {
      const log = logsForDay[r.id];
      const status = log ? log.status : "pending";
      const reason = log ? log.reason || "" : "";
      return `
        <div class="tl-item is-${status}" data-routine-id="${r.id}">
          <div class="tl-node"></div>
          <div class="tl-card">
            <div class="tl-card-top">
              <div>
                <span class="tl-time">${fmtTime(r.time)}</span>
                <div class="tl-title">${escapeHtml(r.title)}</div>
                ${r.description ? `<div class="tl-desc">${escapeHtml(r.description)}</div>` : ""}
              </div>
              <div class="tl-duration">${r.duration_minutes}m</div>
            </div>
            <div class="tl-actions">
              <button class="tl-status-btn done-btn ${status === "done" ? "is-active" : ""}" data-action="done">Did it</button>
              <button class="tl-status-btn missed-btn ${status === "missed" ? "is-active" : ""}" data-action="missed">Missed it</button>
              <button class="tl-note-toggle" data-action="toggle-note">${reason ? "Edit note" : "Add note"}</button>
            </div>
            <div class="tl-note-box ${reason ? "is-open" : ""}" data-note-box>
              <textarea placeholder="Optional — why (or why not)?">${escapeHtml(reason)}</textarea>
              <button class="btn btn-ghost btn-sm" data-action="save-note">Save note</button>
              <span class="tl-note-saved" data-note-saved style="display:none;">Saved</span>
            </div>
          </div>
        </div>`;
    })
    .join("");

  timelineWrap.innerHTML = `<div class="timeline">${items}</div>`;

  timelineWrap.querySelectorAll(".tl-item").forEach((el) => {
    const routineId = el.dataset.routineId;
    el.querySelector('[data-action="done"]').addEventListener("click", () => setStatus(routineId, "done"));
    el.querySelector('[data-action="missed"]').addEventListener("click", () => setStatus(routineId, "missed"));
    el.querySelector('[data-action="toggle-note"]').addEventListener("click", () => {
      el.querySelector("[data-note-box]").classList.toggle("is-open");
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
  refreshCalendarDot();
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
  savedTag.style.display = "inline";
  setTimeout(() => (savedTag.style.display = "none"), 1500);
}

// ---------------------------------------------------------------------
// Stats bar
// ---------------------------------------------------------------------
function renderStats() {
  const total = routines.length;
  let done = 0, missed = 0, doneMinutes = 0, missedMinutes = 0, totalMinutes = 0;

  for (const r of routines) {
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
// Feedback
// ---------------------------------------------------------------------
async function loadFeedback(dateStr) {
  const feedbackText = document.getElementById("feedbackText");
  const moodSelect = document.getElementById("moodSelect");
  const msg = document.getElementById("feedbackMsg");
  msg.innerHTML = "";

  const { data } = await sb
    .from("daily_feedback")
    .select("*")
    .eq("feedback_date", dateStr)
    .maybeSingle();

  feedbackText.value = data?.feedback || "";
  moodSelect.value = data?.mood || "";
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
  msg.innerHTML = error
    ? `<div class="form-error">${error.message}</div>`
    : `<div class="form-success">Reflection saved.</div>`;
  setTimeout(() => (msg.innerHTML = ""), 2500);
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
      (a) => `<li class="advice-item"><div><span class="advice-tag">${a.tag}</span>${escapeHtml(a.text)}</div></li>`
    )
    .join("");
}

// ---------------------------------------------------------------------
// Calendar popover
// ---------------------------------------------------------------------
async function renderCalendarPopover() {
  document.getElementById("calMonthLabel").textContent = calCursor.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const grid = document.getElementById("calendarGrid");
  const dows = ["S", "M", "T", "W", "T", "F", "S"];
  let html = dows.map((d) => `<div class="dow-label">${d}</div>`).join("");

  const firstDay = startOfMonth(calCursor);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 0).getDate();
  const monthDots = await fetchMonthCompletion(calCursor);
  const today = new Date();

  for (let i = 0; i < startOffset; i++) html += `<div></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const cellDate = new Date(calCursor.getFullYear(), calCursor.getMonth(), day);
    const iso = toISODate(cellDate);
    const classes = ["calendar-day"];
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
  grid.querySelectorAll(".calendar-day").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [y, m, d] = btn.dataset.date.split("-").map(Number);
      loadDay(new Date(y, m - 1, d));
      closeCalendar();
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

function refreshCalendarDot() {
  if (calCursor.getFullYear() === selectedDate.getFullYear() && calCursor.getMonth() === selectedDate.getMonth()) {
    renderCalendarPopover();
  }
}

function openCalendar() {
  calCursor = startOfMonth(selectedDate);
  renderCalendarPopover();
  calendarPop.classList.add("is-open");
  dateLabelBtn.setAttribute("aria-expanded", "true");
}
function closeCalendar() {
  calendarPop.classList.remove("is-open");
  dateLabelBtn.setAttribute("aria-expanded", "false");
}

// ---------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------
function wireEvents() {
  document.getElementById("prevDay").addEventListener("click", () => loadDay(addDays(selectedDate, -1)));
  document.getElementById("nextDay").addEventListener("click", () => loadDay(addDays(selectedDate, 1)));

  dateLabelBtn.addEventListener("click", () => {
    calendarPop.classList.contains("is-open") ? closeCalendar() : openCalendar();
  });
  document.addEventListener("click", (e) => {
    if (!calendarPop.contains(e.target) && !dateLabelBtn.contains(e.target)) closeCalendar();
  });

  document.getElementById("calPrevMonth").addEventListener("click", () => {
    calCursor = addMonths(calCursor, -1);
    renderCalendarPopover();
  });
  document.getElementById("calNextMonth").addEventListener("click", () => {
    calCursor = addMonths(calCursor, 1);
    renderCalendarPopover();
  });
}
