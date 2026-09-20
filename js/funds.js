import { sb } from "./supabaseClient.js";
import { renderNav, requireAuth } from "./nav.js";

renderNav("budget");
const user = await requireAuth();
if (!user) throw new Error("redirecting to login");

function fmtMoney(n) {
  return "₱" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

await loadFunds();

async function loadFunds() {
  const host = document.getElementById("fundsList");
  const { data, error } = await sb
    .from("budget_topups")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    host.innerHTML = `<div class="alert alert-danger">${error.message}</div>`;
    return;
  }

  const total = data.reduce((sum, t) => sum + Number(t.amount), 0);
  document.getElementById("fundsTotal").textContent = fmtMoney(total);

  if (!data.length) {
    host.innerHTML = `<p class="text-secondary-emphasis small">No funds added yet.</p>`;
    return;
  }

  host.innerHTML = data
    .map((t) => {
      const d = new Date(t.created_at);
      return `
        <div class="d-flex align-items-center justify-content-between gap-3 border border-secondary-subtle rounded-3 px-3 py-2">
          <div>
            <div class="small">${escapeHtml(t.description || "Funds added")}</div>
            <div class="font-mono text-faint small">${d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} · ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
          </div>
          <div class="d-flex align-items-center gap-2">
            <span class="font-mono text-teal">+${fmtMoney(t.amount)}</span>
            <button class="btn btn-outline-danger btn-sm delete-topup-btn" data-id="${t.id}">✕</button>
          </div>
        </div>`;
    })
    .join("");

  host.querySelectorAll(".delete-topup-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteTopup(btn.dataset.id));
  });
}

async function deleteTopup(id) {
  if (!confirm("Delete this top-up? The amount will be subtracted back out of your current budget.")) return;
  const { error } = await sb.rpc("delete_topup", { p_topup_id: id });
  if (error) {
    alert(`Couldn't delete: ${error.message}`);
    return;
  }
  await loadFunds();
}
