import { sb } from "./supabaseClient.js";

/**
 * Renders a Bootstrap navbar into #site-header.
 * `active` is one of "dashboard" | "routines" | "archive".
 */
export function renderNav(active) {
  const host = document.getElementById("site-header");
  if (!host) return;

  const link = (href, label, key) =>
    `<li class="nav-item"><a class="nav-link ${active === key ? "active fw-semibold text-teal" : ""}" href="${href}">${label}</a></li>`;

  host.innerHTML = `
    <nav class="navbar navbar-expand-lg sticky-top border-bottom border-secondary-subtle" style="background: rgba(16,19,26,.85); backdrop-filter: blur(10px);">
      <div class="container-fluid" style="max-width: 880px;">
        <a class="navbar-brand fw-semibold d-flex align-items-center gap-2" href="./app.html">
          <span class="brand-dot"></span> Anchor
        </a>
        <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navLinks" aria-label="Toggle menu">
          <span class="navbar-toggler-icon"></span>
        </button>
        <div class="collapse navbar-collapse" id="navLinks">
          <ul class="navbar-nav ms-auto align-items-lg-center gap-lg-3">
            ${link("./app.html", "Dashboard", "dashboard")}
            ${link("./routines.html", "My Routine", "routines")}
            ${link("./timer.html", "Timer", "timer")}
            ${link("./archive.html", "Archive", "archive")}
            <li class="nav-item">
              <a class="nav-link" href="https://budgetapp.infinityfree.me/" target="_blank" rel="noopener noreferrer">Budget App ↗</a>
            </li>
            <li class="nav-item mt-2 mt-lg-0">
              <button class="btn btn-outline-secondary btn-sm" id="logoutBtn" type="button">Log out</button>
            </li>
          </ul>
        </div>
      </div>
    </nav>
  `;

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await sb.auth.signOut();
    window.location.href = "./login.html";
  });
}

/**
 * Guards a page that requires a signed-in user.
 * Resolves with the session's user object, or redirects to login.html.
 */
export async function requireAuth() {
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    window.location.href = "./login.html";
    return null;
  }
  return data.session.user;
}
