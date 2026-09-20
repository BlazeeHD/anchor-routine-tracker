import { sb } from "./supabaseClient.js";
import { renderNav, requireAuth } from "./nav.js";
import { generateInsights } from "./budgetInsights.js";

renderNav("budget");
const user = await requireAuth();
if (!user) throw new Error("redirecting to login");

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
}
