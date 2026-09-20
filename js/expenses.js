import { sb } from "./supabaseClient.js";
import { renderNav, requireAuth } from "./nav.js";

renderNav("budget");
const user = await requireAuth();
if (!user) throw new Error("redirecting to login");

const CATEGORIES = ["Food", "Transportation", "Bills", "Shopping", "Entertainment", "Health", "Education", "Other"];
const CATEGORY_ICONS = { Food: "🍔", Transportation: "🚗", Bills: "🧾", Shopping: "🛍️", Entertainment: "🎮", Health: "❤️", Education: "📚", Other: "📦" };

let allExpenses = [];
let activeCategory = "All";

function fmtMoney(n) {
  return "₱" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function moneySlug(cat) {
  return "money-" + (cat || "Other").toLowerCase();
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}
function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const editModal = new bootstrap.Modal(document.getElementById("editModal"));

renderCategoryFilters();
await loadExpenses();
document.getElementById("saveEditBtn").addEventListener("click", saveEdit);

async function loadExpenses() {
  const { data, error } = await sb
    .from("expenses")
    .select("*")
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    document.getElementById("expenseList").innerHTML = `<div class="alert alert-danger">${error.message}</div>`;
    return;
  }
  allExpenses = data || [];
  renderList();
}

function renderCategoryFilters() {
  const host = document.getElementById("categoryFilters");
  const pill = (label, isActive) =>
    `<button class="filter-pill ${isActive ? "is-active" : ""}" data-cat="${label}" type="button">${label === "All" ? "" : CATEGORY_ICONS[label] + " "}${label}</button>`;

  host.innerHTML = pill("All", activeCategory === "All") + CATEGORIES.map((c) => pill(c, activeCategory === c)).join("");

  host.querySelectorAll(".filter-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeCategory = btn.dataset.cat;
      renderCategoryFilters();
      renderList();
    });
  });
}

function renderList() {
  const host = document.getElementById("expenseList");
  const visible = activeCategory === "All" ? allExpenses : allExpenses.filter((e) => e.category === activeCategory);

  const total = visible.reduce((sum, e) => sum + Number(e.amount), 0);
  document.getElementById("filteredTotal").textContent = fmtMoney(total);

  if (!visible.length) {
    host.innerHTML = `<p class="text-secondary-emphasis small">No expenses ${activeCategory === "All" ? "recorded yet" : `in ${activeCategory}`}.</p>`;
    return;
  }

  host.innerHTML = visible
    .map((e) => {
      const d = new Date(e.expense_date + "T00:00:00");
      return `
        <div class="d-flex align-items-center justify-content-between gap-3 border border-secondary-subtle rounded-3 px-3 py-2">
          <div class="d-flex align-items-center gap-2 flex-grow-1" style="min-width: 0;">
            <span class="money-badge ${moneySlug(e.category)}">${CATEGORY_ICONS[e.category] || "📦"} ${escapeHtml(e.category)}</span>
            <div style="min-width: 0;">
              <div class="small text-truncate">${escapeHtml(e.description || e.category)}</div>
              <div class="font-mono text-faint small">${d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
            </div>
          </div>
          <div class="d-flex align-items-center gap-2 flex-shrink-0">
            <span class="font-mono text-coral">${fmtMoney(e.amount)}</span>
            <button class="btn btn-outline-secondary btn-sm edit-exp-btn" data-id="${e.id}">Edit</button>
            <button class="btn btn-outline-danger btn-sm delete-exp-btn" data-id="${e.id}">✕</button>
          </div>
        </div>`;
    })
    .join("");

  host.querySelectorAll(".edit-exp-btn").forEach((btn) =>
    btn.addEventListener("click", () => openEdit(allExpenses.find((e) => e.id === btn.dataset.id)))
  );
  host.querySelectorAll(".delete-exp-btn").forEach((btn) =>
    btn.addEventListener("click", () => deleteExpense(btn.dataset.id))
  );
}

function openEdit(expense) {
  document.getElementById("editError").innerHTML = "";
  document.getElementById("editId").value = expense.id;
  document.getElementById("editAmount").value = expense.amount;
  const dateInput = document.getElementById("editDate");
  dateInput.max = toISODate(new Date());
  dateInput.value = expense.expense_date;
  document.getElementById("editCategory").value = expense.category;
  document.getElementById("editDescription").value = expense.description || "";
  editModal.show();
}

async function saveEdit() {
  const errorHost = document.getElementById("editError");
  errorHost.innerHTML = "";
  const id = document.getElementById("editId").value;
  const amount = Number(document.getElementById("editAmount").value);
  const date = document.getElementById("editDate").value;
  const category = document.getElementById("editCategory").value;
  const description = document.getElementById("editDescription").value.trim() || null;

  if (!amount || amount <= 0) {
    errorHost.innerHTML = `<div class="alert alert-danger py-2 small">Enter an amount greater than 0.</div>`;
    return;
  }

  const btn = document.getElementById("saveEditBtn");
  btn.disabled = true;
  const { error } = await sb.rpc("update_expense", {
    p_expense_id: id,
    p_amount: amount,
    p_category: category,
    p_description: description,
    p_expense_date: date,
  });
  btn.disabled = false;

  if (error) {
    errorHost.innerHTML = `<div class="alert alert-danger py-2 small">${error.message}</div>`;
    return;
  }
  editModal.hide();
  await loadExpenses();
}

async function deleteExpense(id) {
  if (!confirm("Delete this expense? The amount will be added back to your budget.")) return;
  const { error } = await sb.rpc("delete_expense", { p_expense_id: id });
  if (error) {
    alert(`Couldn't delete: ${error.message}`);
    return;
  }
  await loadExpenses();
}
