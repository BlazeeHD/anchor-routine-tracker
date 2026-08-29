import { sb } from "./supabaseClient.js";
import { renderNav, requireAuth } from "./nav.js";

renderNav("routines");
const user = await requireAuth();
if (!user) throw new Error("redirecting to login");

const listHost = document.getElementById("routineList");
const emptyState = document.getElementById("emptyState");
const modalBackdrop = document.getElementById("modalBackdrop");
const modalTitle = document.getElementById("modalTitle");
const modalError = document.getElementById("modalError");
const form = document.getElementById("routineForm");

function fmtTime(t) {
  // t is "HH:MM:SS" from Postgres time type
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

async function loadRoutines() {
  const { data, error } = await sb
    .from("routines")
    .select("*")
    .eq("active", true)
    .order("time", { ascending: true });

  if (error) {
    listHost.innerHTML = `<div class="form-error">Couldn't load your routine: ${error.message}</div>`;
    return;
  }

  if (!data.length) {
    listHost.innerHTML = "";
    emptyState.style.display = "block";
    return;
  }
  emptyState.style.display = "none";

  listHost.innerHTML = data
    .map(
      (r) => `
      <div class="routine-row" data-id="${r.id}">
        <div class="rr-time">${fmtTime(r.time)}</div>
        <div class="rr-body">
          <div class="rr-title">${escapeHtml(r.title)}</div>
          ${r.description ? `<div class="rr-desc">${escapeHtml(r.description)}</div>` : ""}
          <div class="rr-meta">${r.duration_minutes} min</div>
        </div>
        <div class="rr-actions">
          <button class="btn btn-ghost btn-sm edit-btn" data-id="${r.id}">Edit</button>
          <button class="btn btn-danger btn-sm delete-btn" data-id="${r.id}">Delete</button>
        </div>
      </div>`
    )
    .join("");

  listHost.querySelectorAll(".edit-btn").forEach((btn) =>
    btn.addEventListener("click", () => openModal(data.find((r) => r.id === btn.dataset.id)))
  );
  listHost.querySelectorAll(".delete-btn").forEach((btn) =>
    btn.addEventListener("click", () => deleteRoutine(btn.dataset.id))
  );
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function openModal(routine) {
  modalError.innerHTML = "";
  form.reset();
  document.getElementById("routineId").value = routine ? routine.id : "";
  modalTitle.textContent = routine ? "Edit time block" : "Add time block";
  document.getElementById("rTime").value = routine ? routine.time.slice(0, 5) : "";
  document.getElementById("rDuration").value = routine ? routine.duration_minutes : 30;
  document.getElementById("rTitle").value = routine ? routine.title : "";
  document.getElementById("rDesc").value = routine ? routine.description || "" : "";
  modalBackdrop.classList.add("is-open");
  document.getElementById("rTime").focus();
}

function closeModal() {
  modalBackdrop.classList.remove("is-open");
}

document.getElementById("addRoutineBtn").addEventListener("click", () => openModal(null));
document.getElementById("emptyAddBtn").addEventListener("click", () => openModal(null));
document.getElementById("modalCancel").addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", (e) => {
  if (e.target === modalBackdrop) closeModal();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const saveBtn = document.getElementById("modalSave");
  saveBtn.disabled = true;
  modalError.innerHTML = "";

  const id = document.getElementById("routineId").value;
  const payload = {
    user_id: user.id,
    time: document.getElementById("rTime").value,
    duration_minutes: Number(document.getElementById("rDuration").value),
    title: document.getElementById("rTitle").value.trim(),
    description: document.getElementById("rDesc").value.trim() || null,
    active: true,
  };

  const query = id
    ? sb.from("routines").update(payload).eq("id", id)
    : sb.from("routines").insert(payload);

  const { error } = await query;
  saveBtn.disabled = false;

  if (error) {
    modalError.innerHTML = `<div class="form-error">${error.message}</div>`;
    return;
  }
  closeModal();
  loadRoutines();
});

async function deleteRoutine(id) {
  if (!confirm("Delete this time block? Past logs for it will also be removed.")) return;
  const { error } = await sb.from("routines").delete().eq("id", id);
  if (error) {
    alert(`Couldn't delete: ${error.message}`);
    return;
  }
  loadRoutines();
}

loadRoutines();
