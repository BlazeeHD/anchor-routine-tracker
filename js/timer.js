import { sb } from "./supabaseClient.js";
import { renderNav, requireAuth } from "./nav.js";

renderNav("timer");
const user = await requireAuth();
if (!user) throw new Error("redirecting to login");

// ---------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------
const LABELS = [
  { key: "Lunch", emoji: "🍽️" },
  { key: "Break", emoji: "☕" },
  { key: "Meeting", emoji: "👥" },
  { key: "Errand", emoji: "🚗" },
  { key: "Custom", emoji: "✏️" },
];
const TEN_MIN_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------
let selectedLabel = "Lunch";
let activeBreak = null;      // current row from `breaks` table, or null
let tickInterval = null;
let notifiedTenMin = false;
let notifiedDone = false;

// ---------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------
const startCard = document.getElementById("startBreakCard");
const activeWrap = document.getElementById("activeBreakWrap");
const labelChips = document.getElementById("labelChips");
const customWrap = document.getElementById("customLabelWrap");
const customLabelInput = document.getElementById("customLabel");
const startTimeInput = document.getElementById("startTimeInput");
const durationInput = document.getElementById("durationInput");
const returnPreview = document.getElementById("returnPreview");
const startError = document.getElementById("startError");

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function fmtClock(date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function fmtDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
function fmtCountdown(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function combineTodayTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}
function labelEmoji(label) {
  const found = LABELS.find((l) => l.key === label);
  return found ? found.emoji : "⏱️";
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.start();
    o.stop(ctx.currentTime + 0.4);
  } catch (e) { /* audio not available — ignore */ }
}
function notify(title, body) {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch (e) { /* ignore */ }
  beep();
}

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------
renderLabelChips();
startTimeInput.value = nowHHMM();
updateReturnPreview();
wireStartForm();
await loadActiveBreak();
await loadHistory();

// ---------------------------------------------------------------------
// Start form
// ---------------------------------------------------------------------
function renderLabelChips() {
  labelChips.innerHTML = LABELS.map(
    (l) => `<button type="button" class="label-chip ${l.key === selectedLabel ? "is-active" : ""}" data-label="${l.key}">${l.emoji} ${l.key}</button>`
  ).join("");

  labelChips.querySelectorAll(".label-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedLabel = btn.dataset.label;
      renderLabelChips();
      customWrap.classList.toggle("d-none", selectedLabel !== "Custom");
      if (selectedLabel === "Custom") customLabelInput.focus();
    });
  });
}

function updateReturnPreview() {
  const duration = Number(durationInput.value);
  if (!startTimeInput.value || !duration || duration <= 0) {
    returnPreview.textContent = "—";
    return;
  }
  const start = combineTodayTime(startTimeInput.value);
  const end = new Date(start.getTime() + duration * 60000);
  returnPreview.textContent = fmtClock(end);
}

function wireStartForm() {
  startTimeInput.addEventListener("input", updateReturnPreview);
  durationInput.addEventListener("input", () => {
    syncDurationPillActive();
    updateReturnPreview();
  });

  document.querySelectorAll(".duration-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      durationInput.value = btn.dataset.min;
      syncDurationPillActive();
      updateReturnPreview();
    });
  });

  document.getElementById("startBreakBtn").addEventListener("click", startBreak);
  syncDurationPillActive();
}

function syncDurationPillActive() {
  document.querySelectorAll(".duration-pill").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.min === String(durationInput.value));
  });
}

async function startBreak() {
  startError.innerHTML = "";
  const label = selectedLabel === "Custom" ? customLabelInput.value.trim() || "Custom" : selectedLabel;
  const duration = Number(durationInput.value);

  if (!startTimeInput.value) {
    startError.innerHTML = `<div class="alert alert-danger py-2 small">Pick a start time.</div>`;
    return;
  }
  if (!duration || duration <= 0) {
    startError.innerHTML = `<div class="alert alert-danger py-2 small">Duration must be at least 1 minute.</div>`;
    return;
  }

  const startAt = combineTodayTime(startTimeInput.value);
  const endAt = new Date(startAt.getTime() + duration * 60000);

  // Ask for notification permission right on this click — a user gesture,
  // which is the right moment for browsers to show the permission prompt.
  if ("Notification" in window && Notification.permission === "default") {
    try { await Notification.requestPermission(); } catch (e) { /* ignore */ }
  }

  const btn = document.getElementById("startBreakBtn");
  btn.disabled = true;

  const { data, error } = await sb
    .from("breaks")
    .insert({
      user_id: user.id,
      label,
      start_at: startAt.toISOString(),
      duration_minutes: duration,
      end_at: endAt.toISOString(),
      status: "active",
    })
    .select()
    .single();

  btn.disabled = false;

  if (error) {
    startError.innerHTML = `<div class="alert alert-danger py-2 small">${error.message}</div>`;
    return;
  }

  activeBreak = data;
  notifiedTenMin = false;
  notifiedDone = false;
  showActiveBreak();
  loadHistory();
}

// ---------------------------------------------------------------------
// Active break card
// ---------------------------------------------------------------------
async function loadActiveBreak() {
  const { data } = await sb
    .from("breaks")
    .select("*")
    .eq("status", "active")
    .order("start_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data) {
    activeBreak = data;
    notifiedTenMin = false;
    notifiedDone = false;
    showActiveBreak();
  } else {
    showStartForm();
  }
}

function showActiveBreak() {
  startCard.classList.add("d-none");
  activeWrap.classList.remove("d-none");
  renderActiveBreakCard();
  if (tickInterval) clearInterval(tickInterval);
  tick();
  tickInterval = setInterval(tick, 1000);
}

function showStartForm() {
  activeWrap.classList.add("d-none");
  activeWrap.innerHTML = "";
  startCard.classList.remove("d-none");
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = null;
  startTimeInput.value = nowHHMM();
  updateReturnPreview();
}

function renderActiveBreakCard() {
  const start = new Date(activeBreak.start_at);
  const end = new Date(activeBreak.end_at);

  activeWrap.innerHTML = `
    <div class="card mb-4 border-teal">
      <div class="card-body text-center py-4">
        <span class="eyebrow">On break</span>
        <h2 class="h3 mb-1">${labelEmoji(activeBreak.label)} ${escapeHtml(activeBreak.label)}</h2>
        <p class="text-secondary-emphasis small mb-3">Started at <span class="font-mono">${fmtClock(start)}</span></p>
        <div class="countdown-display mb-1" id="countdownText">—</div>
        <p class="text-secondary-emphasis small mb-3">Back at <strong class="font-mono text-teal">${fmtClock(end)}</strong></p>
        <div class="progress mb-3" style="height: 8px;">
          <div class="progress-bar" id="breakProgress" style="width: 0%; background: var(--teal);"></div>
        </div>
        <div id="breakAlertBanner"></div>
        <div class="d-flex justify-content-center gap-2 mt-3">
          <button class="btn btn-outline-secondary btn-sm" id="extendBtn">+15 min</button>
          <button class="btn btn-primary btn-sm" id="endBreakBtn">I'm back</button>
        </div>
      </div>
    </div>`;

  document.getElementById("endBreakBtn").addEventListener("click", endBreak);
  document.getElementById("extendBtn").addEventListener("click", extendBreak);
}

function tick() {
  if (!activeBreak) return;
  const now = new Date();
  const start = new Date(activeBreak.start_at);
  const end = new Date(activeBreak.end_at);
  const remainingMs = end - now;
  const totalMs = end - start;

  const countdownEl = document.getElementById("countdownText");
  const progressEl = document.getElementById("breakProgress");
  const bannerEl = document.getElementById("breakAlertBanner");
  if (!countdownEl) return; // card not in DOM (e.g. mid re-render)

  if (remainingMs > 0) {
    countdownEl.textContent = fmtCountdown(remainingMs);
    countdownEl.classList.remove("is-overdue");
    const elapsedPct = totalMs > 0 ? Math.min(100, ((now - start) / totalMs) * 100) : 100;
    progressEl.style.width = `${Math.max(0, elapsedPct)}%`;

    if (remainingMs <= TEN_MIN_MS && !notifiedTenMin) {
      notifiedTenMin = true;
      notify(`${activeBreak.label} — 10 minutes left`, `Back at ${fmtClock(end)}`);
      bannerEl.innerHTML = `<div class="alert alert-warning py-2 small mb-0">10 minutes left — back at ${fmtClock(end)}.</div>`;
    }
  } else {
    countdownEl.textContent = `Overdue ${fmtCountdown(-remainingMs)}`;
    countdownEl.classList.add("is-overdue");
    progressEl.style.width = "100%";
    progressEl.style.background = "var(--coral)";

    if (!notifiedDone) {
      notifiedDone = true;
      notify(`${activeBreak.label} is over`, `You were due back at ${fmtClock(end)}.`);
      bannerEl.innerHTML = `<div class="alert alert-danger py-2 small mb-0">Time's up — you were due back at ${fmtClock(end)}.</div>`;
    }
  }
}

async function endBreak() {
  const { error } = await sb.from("breaks").update({ status: "ended" }).eq("id", activeBreak.id);
  if (error) {
    alert(`Couldn't end break: ${error.message}`);
    return;
  }
  activeBreak = null;
  showStartForm();
  loadHistory();
}

async function extendBreak() {
  const newEnd = new Date(new Date(activeBreak.end_at).getTime() + 15 * 60000);
  const { data, error } = await sb
    .from("breaks")
    .update({ end_at: newEnd.toISOString() })
    .eq("id", activeBreak.id)
    .select()
    .single();

  if (error) {
    alert(`Couldn't extend: ${error.message}`);
    return;
  }
  activeBreak = data;
  notifiedTenMin = newEnd - new Date() <= TEN_MIN_MS;
  notifiedDone = false;
  renderActiveBreakCard();
  tick();
}

// ---------------------------------------------------------------------
// Today's history
// ---------------------------------------------------------------------
async function loadHistory() {
  const host = document.getElementById("breakHistory");
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  const { data, error } = await sb
    .from("breaks")
    .select("*")
    .gte("start_at", todayStart.toISOString())
    .lt("start_at", todayEnd.toISOString())
    .order("start_at", { ascending: true });

  if (error) {
    host.innerHTML = `<div class="alert alert-danger py-2 small">${error.message}</div>`;
    return;
  }
  if (!data.length) {
    host.innerHTML = `<p class="text-secondary-emphasis small mb-0">No breaks logged yet today.</p>`;
    return;
  }

  host.innerHTML = data
    .map((b) => {
      const start = new Date(b.start_at);
      const end = new Date(b.end_at);
      const statusBadge = b.status === "active"
        ? `<span class="cat-badge cat-personal">In progress</span>`
        : `<span class="cat-badge cat-other">Ended</span>`;
      return `
        <div class="d-flex align-items-center justify-content-between gap-3 border border-secondary-subtle rounded-3 px-3 py-2">
          <div>
            <div class="fw-semibold">${labelEmoji(b.label)} ${escapeHtml(b.label)}</div>
            <div class="font-mono text-faint small">${fmtClock(start)} – ${fmtClock(end)} · ${fmtDuration(b.duration_minutes * 60000)}</div>
          </div>
          ${statusBadge}
        </div>`;
    })
    .join("");
}
