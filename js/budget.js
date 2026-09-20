import { sb } from "./supabaseClient.js";
import { renderNav, requireAuth } from "./nav.js";

renderNav("budget");
const user = await requireAuth();
if (!user) throw new Error("redirecting to login");

// ---------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------
const CATEGORY_ICONS = { Food: "🍔", Transportation: "🚗", Bills: "🧾", Shopping: "🛍️", Entertainment: "🎮", Health: "❤️", Education: "📚", Other: "📦" };
const CATEGORY_COLORS = { Food: "#f2b84b", Transportation: "#5b8def", Bills: "#e8604c", Shopping: "#c792ea", Entertainment: "#7ee081", Health: "#ff8fab", Education: "#2fbfa3", Other: "#4a5568" };

// ---------------------------------------------------------------------
// State
// ---------------------------------------------------------------------
let budget = null;
let categoryChartInstance = null;

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
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

// ---------------------------------------------------------------------
// Bootstrap modal instances
// ---------------------------------------------------------------------
const setupModal = new bootstrap.Modal(document.getElementById("setupModal"));
const expenseModal = new bootstrap.Modal(document.getElementById("expenseModal"));
const topupModal = new bootstrap.Modal(document.getElementById("topupModal"));

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------
document.getElementById("expDate").value = toISODate(new Date());
document.getElementById("expDate").max = toISODate(new Date());
wireEvents();
await loadBudget();

// ---------------------------------------------------------------------
// Budget load + setup flow
// ---------------------------------------------------------------------
async function loadBudget() {
  const { data, error } = await sb.from("budgets").select("*").eq("user_id", user.id).maybeSingle();

  if (error) {
    console.error(error);
    return;
  }

  if (!data) {
    // First-time user — force the setup modal, no way to dismiss it.
    document.getElementById("setupModalTitle").textContent = "Set up your budget";
    document.getElementById("setupCancelBtn").classList.add("d-none");
    document.getElementById("setupInitial").value = "";
    document.getElementById("setupWarning").value = "";
    setupModal.show();
    return;
  }

  budget = data;
  renderBudgetCard();
  await loadDashboardData();
}

function renderBudgetCard() {
  const pct = budget.initial_budget > 0 ? (budget.current_budget / budget.initial_budget) * 100 : 0;
  const isLow = Number(budget.current_budget) <= Number(budget.warning_limit);

  const amountEl = document.getElementById("budgetAmount");
  amountEl.textContent = fmtMoney(budget.current_budget);
  amountEl.classList.toggle("is-low", isLow);

  document.getElementById("budgetPct").textContent = `${pct.toFixed(1)}% of initial ${fmtMoney(budget.initial_budget)}`;
  document.getElementById("budgetProgress").style.width = `${Math.min(100, Math.max(0, pct))}%`;
  document.getElementById("budgetProgress").style.background = isLow ? "var(--coral)" : "var(--teal)";

  const alertHost = document.getElementById("lowBudgetAlert");
  alertHost.innerHTML = isLow
    ? `<div class="alert alert-warning small mb-4">Your budget (${fmtMoney(budget.current_budget)}) is at or below your warning threshold of ${fmtMoney(budget.warning_limit)}. Consider topping up or slowing down spending.</div>`
    : "";
}

document.getElementById("editBudgetBtn").addEventListener("click", () => {
  document.getElementById("setupModalTitle").textContent = "Budget settings";
  document.getElementById("setupCancelBtn").classList.remove("d-none");
  document.getElementById("setupInitial").value = budget ? budget.initial_budget : "";
  document.getElementById("setupWarning").value = budget ? budget.warning_limit : "";
  document.getElementById("setupError").innerHTML = "";
  setupModal.show();
});

document.getElementById("setupSaveBtn").addEventListener("click", async () => {
  const errorHost = document.getElementById("setupError");
  errorHost.innerHTML = "";
  const initial = Number(document.getElementById("setupInitial").value);
  const warning = Number(document.getElementById("setupWarning").value);

  if (!initial || initial <= 0) {
    errorHost.innerHTML = `<div class="alert alert-danger py-2 small">Enter a starting budget greater than 0.</div>`;
    return;
  }
  if (warning === "" || warning < 0 || isNaN(warning)) {
    errorHost.innerHTML = `<div class="alert alert-danger py-2 small">Enter a warning threshold (0 or more).</div>`;
    return;
  }

  const btn = document.getElementById("setupSaveBtn");
  btn.disabled = true;
  const { data, error } = await sb.rpc("setup_budget", { p_initial: initial, p_warning: warning });
  btn.disabled = false;

  if (error) {
    errorHost.innerHTML = `<div class="alert alert-danger py-2 small">${error.message}</div>`;
    return;
  }

  budget = data;
  setupModal.hide();
  renderBudgetCard();
  await loadDashboardData();
});

// ---------------------------------------------------------------------
// Expense form
// ---------------------------------------------------------------------
document.getElementById("saveExpenseBtn").addEventListener("click", async () => {
  const errorHost = document.getElementById("expenseError");
  errorHost.innerHTML = "";
  const amount = Number(document.getElementById("expAmount").value);
  const date = document.getElementById("expDate").value;
  const category = document.getElementById("expCategory").value;
  const description = document.getElementById("expDescription").value.trim() || null;

  if (!amount || amount <= 0) {
    errorHost.innerHTML = `<div class="alert alert-danger py-2 small">Enter an amount greater than 0.</div>`;
    return;
  }
  if (!date) {
    errorHost.innerHTML = `<div class="alert alert-danger py-2 small">Pick a date.</div>`;
    return;
  }

  const btn = document.getElementById("saveExpenseBtn");
  btn.disabled = true;
  const { data, error } = await sb.rpc("add_expense", {
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

  document.getElementById("expAmount").value = "";
  document.getElementById("expDescription").value = "";
  expenseModal.hide();
  await refreshBudgetOnly();
  await loadDashboardData();
});

// ---------------------------------------------------------------------
// Top-up form
// ---------------------------------------------------------------------
document.querySelectorAll(".quick-add-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.getElementById("topupAmount").value = btn.dataset.amount;
  });
});

document.getElementById("saveTopupBtn").addEventListener("click", async () => {
  const errorHost = document.getElementById("topupError");
  errorHost.innerHTML = "";
  const amount = Number(document.getElementById("topupAmount").value);
  const description = document.getElementById("topupDescription").value.trim() || null;

  if (!amount || amount <= 0) {
    errorHost.innerHTML = `<div class="alert alert-danger py-2 small">Enter an amount greater than 0.</div>`;
    return;
  }

  const btn = document.getElementById("saveTopupBtn");
  btn.disabled = true;
  const { error } = await sb.rpc("add_budget_topup", { p_amount: amount, p_description: description });
  btn.disabled = false;

  if (error) {
    errorHost.innerHTML = `<div class="alert alert-danger py-2 small">${error.message}</div>`;
    return;
  }

  document.getElementById("topupAmount").value = "";
  document.getElementById("topupDescription").value = "";
  topupModal.hide();
  await refreshBudgetOnly();
});

async function refreshBudgetOnly() {
  const { data } = await sb.from("budgets").select("*").eq("user_id", user.id).maybeSingle();
  if (data) {
    budget = data;
    renderBudgetCard();
  }
}

// ---------------------------------------------------------------------
// Stats, recent transactions, category chart
// ---------------------------------------------------------------------
async function loadDashboardData() {
  const { data, error } = await sb
    .from("expenses")
    .select("*")
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  renderStats(data);
  renderRecent(data.slice(0, 5));
  renderCategoryChart(data);
}

function renderStats(expenses) {
  const today = new Date();
  const todayISO = toISODate(today);
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay());
  const weekStartISO = toISODate(weekStart);
  const monthPrefix = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

  let todaySum = 0, weekSum = 0, monthSum = 0, totalSum = 0;
  for (const e of expenses) {
    const amt = Number(e.amount);
    totalSum += amt;
    if (e.expense_date === todayISO) todaySum += amt;
    if (e.expense_date >= weekStartISO) weekSum += amt;
    if (e.expense_date.startsWith(monthPrefix)) monthSum += amt;
  }

  document.getElementById("statToday").textContent = fmtMoney(todaySum);
  document.getElementById("statWeek").textContent = fmtMoney(weekSum);
  document.getElementById("statMonth").textContent = fmtMoney(monthSum);
  document.getElementById("statTotal").textContent = fmtMoney(totalSum);
}

function renderRecent(expenses) {
  const host = document.getElementById("recentTransactions");
  if (!expenses.length) {
    host.innerHTML = `<p class="text-secondary-emphasis small mb-0">No expenses recorded yet.</p>`;
    return;
  }

  host.innerHTML = expenses
    .map((e) => {
      const d = new Date(e.expense_date + "T00:00:00");
      return `
        <div class="d-flex align-items-center justify-content-between gap-3 border border-secondary-subtle rounded-3 px-3 py-2">
          <div class="d-flex align-items-center gap-2">
            <span class="money-badge ${moneySlug(e.category)}">${CATEGORY_ICONS[e.category] || "📦"} ${escapeHtml(e.category)}</span>
            <div>
              <div class="small">${escapeHtml(e.description || e.category)}</div>
              <div class="font-mono text-faint small">${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
            </div>
          </div>
          <div class="d-flex align-items-center gap-2">
            <span class="font-mono text-coral">${fmtMoney(e.amount)}</span>
            <button class="btn btn-outline-danger btn-sm delete-exp-btn" data-id="${e.id}" title="Delete">✕</button>
          </div>
        </div>`;
    })
    .join("");

  host.querySelectorAll(".delete-exp-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteExpense(btn.dataset.id));
  });
}

async function deleteExpense(id) {
  if (!confirm("Delete this expense? The amount will be added back to your budget.")) return;
  const { error } = await sb.rpc("delete_expense", { p_expense_id: id });
  if (error) {
    alert(`Couldn't delete: ${error.message}`);
    return;
  }
  await refreshBudgetOnly();
  await loadDashboardData();
}

function renderCategoryChart(expenses) {
  const totals = {};
  for (const e of expenses) totals[e.category] = (totals[e.category] || 0) + Number(e.amount);
  const labels = Object.keys(totals);
  const noDataEl = document.getElementById("noCategoryData");
  const canvas = document.getElementById("categoryChart");

  if (categoryChartInstance) {
    categoryChartInstance.destroy();
    categoryChartInstance = null;
  }

  if (!labels.length) {
    canvas.classList.add("d-none");
    noDataEl.classList.remove("d-none");
    return;
  }
  canvas.classList.remove("d-none");
  noDataEl.classList.add("d-none");

  categoryChartInstance = new Chart(canvas.getContext("2d"), {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: labels.map((l) => totals[l]),
        backgroundColor: labels.map((l) => CATEGORY_COLORS[l] || "#4a5568"),
        borderWidth: 2,
        borderColor: "#1b2028",
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#8b93a3", boxWidth: 10, padding: 10, font: { size: 11 } },
        },
      },
    },
  });
}

function wireEvents() {
  // (form listeners are attached directly above; this is here for
  // parity with the other pages' structure and future additions)
}
