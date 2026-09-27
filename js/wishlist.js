import { sb } from "./supabaseClient.js";
import { renderNav, requireAuth } from "./nav.js";

renderNav("budget");
const user = await requireAuth();
if (!user) throw new Error("redirecting to login");

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------
let items = [];
let currentBudget = null;
let activeTerm = "All";
let showAchieved = false;

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function fmtMoney(n) {
  return "₱" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

// ---------------------------------------------------------------------
// Bootstrap modal instances
// ---------------------------------------------------------------------
const itemModal = new bootstrap.Modal(document.getElementById("itemModal"));
const savingsModal = new bootstrap.Modal(document.getElementById("savingsModal"));

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------
renderTermFilters();
wireEvents();
await Promise.all([loadBudget(), loadItems()]);

async function loadBudget() {
  const { data } = await sb.from("budgets").select("current_budget").eq("user_id", user.id).maybeSingle();
  currentBudget = data ? Number(data.current_budget) : null;
}

async function loadItems() {
  const { data, error } = await sb
    .from("wishlist_items")
    .select("*")
    .order("status", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    document.getElementById("wishlistItems").innerHTML = `<div class="alert alert-danger">${error.message}</div>`;
    return;
  }
  items = data || [];
  renderList();
}

// ---------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------
function renderTermFilters() {
  const host = document.getElementById("termFilters");
  const pill = (label, value, isActive) =>
    `<button class="filter-pill ${isActive ? "is-active" : ""}" data-term="${value}" type="button">${label}</button>`;

  host.innerHTML =
    pill("All", "All", activeTerm === "All") +
    pill("Short-term", "short", activeTerm === "short") +
    pill("Long-term", "long", activeTerm === "long");

  host.querySelectorAll(".filter-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTerm = btn.dataset.term;
      renderTermFilters();
      renderList();
    });
  });
}

// ---------------------------------------------------------------------
// List rendering
// ---------------------------------------------------------------------
function renderList() {
  const host = document.getElementById("wishlistItems");
  const emptyState = document.getElementById("emptyState");

  if (!items.length) {
    host.innerHTML = "";
    emptyState.classList.remove("d-none");
    return;
  }

  const visible = items.filter((i) => {
    if (!showAchieved && i.status === "achieved") return false;
    if (activeTerm !== "All" && i.term !== activeTerm) return false;
    return true;
  });

  if (!visible.length) {
    emptyState.classList.add("d-none");
    host.innerHTML = `<p class="text-secondary-emphasis small">Nothing matches this filter.</p>`;
    return;
  }
  emptyState.classList.add("d-none");

  host.innerHTML = visible.map(renderCard).join("");

  host.querySelectorAll(".add-savings-btn").forEach((btn) =>
    btn.addEventListener("click", () => openSavingsModal(items.find((i) => i.id === btn.dataset.id)))
  );
  host.querySelectorAll(".edit-item-btn").forEach((btn) =>
    btn.addEventListener("click", () => openItemModal(items.find((i) => i.id === btn.dataset.id)))
  );
  host.querySelectorAll(".toggle-achieved-btn").forEach((btn) =>
    btn.addEventListener("click", () => toggleAchieved(btn.dataset.id))
  );
  host.querySelectorAll(".delete-item-btn").forEach((btn) =>
    btn.addEventListener("click", () => deleteItem(btn.dataset.id))
  );
}

function renderCard(item) {
  const cost = Number(item.estimated_cost);
  const saved = Number(item.amount_saved);
  const pct = cost > 0 ? Math.min(100, (saved / cost) * 100) : 0;
  const fullyFunded = saved >= cost;
  const isAchieved = item.status === "achieved";

  let affordHtml = "";
  if (!isAchieved && currentBudget !== null) {
    const affordPct = cost > 0 ? Math.min(100, (currentBudget / cost) * 100) : 0;
    affordHtml = `<div class="afford-pill mt-2">You could currently cover ${affordPct.toFixed(0)}% of this from your budget.</div>`;
  }

  return `
    <div class="card wishlist-card ${isAchieved ? "is-achieved" : ""}" data-id="${item.id}">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-start gap-3 flex-wrap">
          <div>
            <div class="d-flex align-items-center gap-2 flex-wrap mb-1">
              <span class="wishlist-title fw-semibold">${escapeHtml(item.title)}</span>
              <span class="term-badge term-${item.term}">${item.term === "short" ? "Short-term" : "Long-term"}</span>
              <span class="priority-badge priority-${item.priority.toLowerCase()}">${item.priority}</span>
            </div>
            ${item.notes ? `<div class="text-secondary-emphasis small">${escapeHtml(item.notes)}</div>` : ""}
          </div>
          <div class="font-mono text-end flex-shrink-0">
            <div>${fmtMoney(saved)} <span class="text-faint">/ ${fmtMoney(cost)}</span></div>
          </div>
        </div>

        <div class="progress mt-3" style="height: 8px;">
          <div class="progress-bar" style="width: ${pct}%; background: ${fullyFunded ? "var(--amber)" : "var(--teal)"};"></div>
        </div>
        ${fullyFunded && !isAchieved ? `<div class="small text-amber mt-2">Fully funded — ready to get it!</div>` : ""}
        ${affordHtml}

        <div class="d-flex flex-wrap gap-2 mt-3">
          ${!isAchieved ? `<button class="btn btn-sm btn-outline-success add-savings-btn" data-id="${item.id}">+ Add savings</button>` : ""}
          <button class="btn btn-sm btn-outline-secondary edit-item-btn" data-id="${item.id}">Edit</button>
          <button class="btn btn-sm ${isAchieved ? "btn-outline-secondary" : "btn-outline-primary"} toggle-achieved-btn" data-id="${item.id}">${isAchieved ? "Reopen" : "Mark achieved"}</button>
          <button class="btn btn-sm btn-outline-danger delete-item-btn" data-id="${item.id}">Delete</button>
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------
// Add / edit item
// ---------------------------------------------------------------------
function openItemModal(item) {
  document.getElementById("itemError").innerHTML = "";
  document.getElementById("itemModalTitle").textContent = item ? "Edit wishlist item" : "Add wishlist item";
  document.getElementById("itemId").value = item ? item.id : "";
  document.getElementById("itemTitle").value = item ? item.title : "";
  document.getElementById("itemCost").value = item ? item.estimated_cost : "";
  document.getElementById("itemSaved").value = item ? item.amount_saved : 0;
  document.getElementById("itemTerm").value = item ? item.term : "short";
  document.getElementById("itemPriority").value = item ? item.priority : "Medium";
  document.getElementById("itemNotes").value = item ? item.notes || "" : "";
  itemModal.show();
}

document.getElementById("addItemBtn").addEventListener("click", () => openItemModal(null));
document.getElementById("emptyAddBtn").addEventListener("click", () => openItemModal(null));

document.getElementById("saveItemBtn").addEventListener("click", async () => {
  const errorHost = document.getElementById("itemError");
  errorHost.innerHTML = "";

  const id = document.getElementById("itemId").value;
  const title = document.getElementById("itemTitle").value.trim();
  const cost = Number(document.getElementById("itemCost").value);
  const saved = Number(document.getElementById("itemSaved").value) || 0;

  if (!title) {
    errorHost.innerHTML = `<div class="alert alert-danger py-2 small">Give it a name.</div>`;
    return;
  }
  if (!cost || cost <= 0) {
    errorHost.innerHTML = `<div class="alert alert-danger py-2 small">Enter an estimated cost greater than 0.</div>`;
    return;
  }

  const payload = {
    user_id: user.id,
    title,
    estimated_cost: cost,
    amount_saved: saved,
    term: document.getElementById("itemTerm").value,
    priority: document.getElementById("itemPriority").value,
    notes: document.getElementById("itemNotes").value.trim() || null,
  };

  const btn = document.getElementById("saveItemBtn");
  btn.disabled = true;
  const query = id
    ? sb.from("wishlist_items").update(payload).eq("id", id)
    : sb.from("wishlist_items").insert(payload);
  const { error } = await query;
  btn.disabled = false;

  if (error) {
    errorHost.innerHTML = `<div class="alert alert-danger py-2 small">${error.message}</div>`;
    return;
  }
  itemModal.hide();
  await loadItems();
});

// ---------------------------------------------------------------------
// Add savings
// ---------------------------------------------------------------------
function openSavingsModal(item) {
  document.getElementById("savingsError").innerHTML = "";
  document.getElementById("savingsItemId").value = item.id;
  document.getElementById("savingsAmount").value = "";
  document.getElementById("savingsContext").textContent =
    `Saving toward "${item.title}" — ${fmtMoney(item.amount_saved)} of ${fmtMoney(item.estimated_cost)} so far.`;
  savingsModal.show();
}

document.getElementById("saveSavingsBtn").addEventListener("click", async () => {
  const errorHost = document.getElementById("savingsError");
  errorHost.innerHTML = "";

  const id = document.getElementById("savingsItemId").value;
  const addAmount = Number(document.getElementById("savingsAmount").value);
  if (!addAmount || addAmount <= 0) {
    errorHost.innerHTML = `<div class="alert alert-danger py-2 small">Enter an amount greater than 0.</div>`;
    return;
  }

  const item = items.find((i) => i.id === id);
  const newSaved = Number(item.amount_saved) + addAmount;

  const btn = document.getElementById("saveSavingsBtn");
  btn.disabled = true;
  const { error } = await sb.from("wishlist_items").update({ amount_saved: newSaved }).eq("id", id);
  btn.disabled = false;

  if (error) {
    errorHost.innerHTML = `<div class="alert alert-danger py-2 small">${error.message}</div>`;
    return;
  }
  savingsModal.hide();
  await loadItems();
});

// ---------------------------------------------------------------------
// Mark achieved / reopen / delete
// ---------------------------------------------------------------------
async function toggleAchieved(id) {
  const item = items.find((i) => i.id === id);
  const newStatus = item.status === "achieved" ? "active" : "achieved";
  const { error } = await sb
    .from("wishlist_items")
    .update({ status: newStatus, achieved_at: newStatus === "achieved" ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) {
    alert(`Couldn't update: ${error.message}`);
    return;
  }
  await loadItems();
}

async function deleteItem(id) {
  if (!confirm("Delete this wishlist item? This can't be undone.")) return;
  const { error } = await sb.from("wishlist_items").delete().eq("id", id);
  if (error) {
    alert(`Couldn't delete: ${error.message}`);
    return;
  }
  await loadItems();
}

// ---------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------
function wireEvents() {
  document.getElementById("showAchievedToggle").addEventListener("change", (e) => {
    showAchieved = e.target.checked;
    renderList();
  });
}
