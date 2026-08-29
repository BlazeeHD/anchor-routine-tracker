import { sb } from "./supabaseClient.js";

/**
 * Renders the top navigation bar into #site-header.
 * `active` is one of "dashboard" | "routines" used for the highlighted link.
 */
export function renderNav(active) {
  const host = document.getElementById("site-header");
  if (!host) return;

  host.innerHTML = `
    <div class="nav-inner">
      <a class="nav-brand" href="./app.html">
        <span class="nav-brand-mark" aria-hidden="true"></span>
        Anchor
      </a>
      <button class="nav-toggle" id="navToggle" aria-label="Toggle menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
      <nav class="nav-links" id="navLinks">
        <a href="./app.html" class="${active === "dashboard" ? "is-active" : ""}">Dashboard</a>
        <a href="./routines.html" class="${active === "routines" ? "is-active" : ""}">My Routine</a>
        <a href="https://budgetapp.infinityfree.me/" target="_blank" rel="noopener noreferrer">Budget App ↗</a>
        <button class="nav-logout" id="logoutBtn" type="button">Log out</button>
      </nav>
    </div>
  `;

  const toggle = document.getElementById("navToggle");
  const links = document.getElementById("navLinks");
  toggle.addEventListener("click", () => {
    const open = links.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
  });

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