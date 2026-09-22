import { sb } from "./supabaseClient.js";
import { renderNav, requireAuth } from "./nav.js";
import { generateInsights } from "./budgetInsights.js";

renderNav("budget");
const user = await requireAuth();
if (!user) throw new Error("redirecting to login");

const CATEGORY_COLORS = { Food: "#f2b84b", Transportation: "#5b8def", Bills: "#e8604c", Shopping: "#c792ea", Entertainment: "#7ee081", Health: "#ff8fab", Education: "#2fbfa3", Other: "#4a5568" };

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

const [{ data: expenses, error: expError }, { data: budget }] = await Promise.all([
  sb.from("expenses").select("amount, category, description, expense_date, created_at").order("expense_date", { ascending: false }),
  sb.from("budgets").select("*").eq("user_id", user.id).maybeSingle(),
]);

const list = document.getElementById("insightsList");

if (expError) {
  list.innerHTML = `<li><div class="alert alert-danger">${expError.message}</div></li>`;
} else {
  const insights = generateInsights(expenses || [], budget);
  list.innerHTML = insights
    .map(
      (i) => `<li class="advice-item rounded-3 p-3 small d-flex gap-2 align-items-start"><div><span class="advice-tag d-block mb-1">${escapeHtml(i.tag)}</span>${escapeHtml(i.text)}</div></li>`
    )
    .join("");

  renderMonthlyChart(expenses || []);
  renderCategoryChart(expenses || []);
}

// ---------------------------------------------------------------------
// Spending by month — last 6 months
// ---------------------------------------------------------------------
function renderMonthlyChart(expenses) {
  const canvas = document.getElementById("monthlyChart");
  const noDataEl = document.getElementById("noMonthlyData");

  if (!expenses.length) {
    canvas.classList.add("d-none");
    noDataEl.classList.remove("d-none");
    return;
  }

  // Build the last 6 month buckets (oldest to newest), keyed "YYYY-MM"
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleDateString(undefined, { month: "short" }) });
  }

  const totals = Object.fromEntries(months.map((m) => [m.key, 0]));
  for (const e of expenses) {
    const key = e.expense_date.slice(0, 7);
    if (key in totals) totals[key] += Number(e.amount);
  }

  new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: months.map((m) => m.label),
      datasets: [{
        data: months.map((m) => totals[m.key]),
        backgroundColor: "#2fbfa3",
        borderRadius: 4,
        maxBarThickness: 40,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#8b93a3" }, grid: { display: false } },
        y: { ticks: { color: "#8b93a3" }, grid: { color: "#2a303c" }, beginAtZero: true },
      },
    },
  });
}

// ---------------------------------------------------------------------
// Spending by category — all time
// ---------------------------------------------------------------------
function renderCategoryChart(expenses) {
  const canvas = document.getElementById("categoryAnalyticsChart");
  const noDataEl = document.getElementById("noCategoryAnalyticsData");

  const totals = {};
  for (const e of expenses) totals[e.category] = (totals[e.category] || 0) + Number(e.amount);
  const labels = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);

  if (!labels.length) {
    canvas.classList.add("d-none");
    noDataEl.classList.remove("d-none");
    return;
  }

  new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data: labels.map((l) => totals[l]),
        backgroundColor: labels.map((l) => CATEGORY_COLORS[l] || "#4a5568"),
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#8b93a3" }, grid: { color: "#2a303c" }, beginAtZero: true },
        y: { ticks: { color: "#8b93a3" }, grid: { display: false } },
      },
    },
  });
}