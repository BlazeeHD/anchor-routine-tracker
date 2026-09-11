import { sb } from "./supabaseClient.js";

// If already signed in, skip straight to the dashboard.
const { data: existing } = await sb.auth.getSession();
if (existing.session) {
  window.location.href = "./app.html";
}

const formMessage = document.getElementById("formMessage");
const signInForm = document.getElementById("signInForm");
const signUpForm = document.getElementById("signUpForm");

function setMessage(text, kind) {
  formMessage.innerHTML = text
    ? `<div class="alert alert-${kind === "error" ? "danger" : "success"} py-2 small">${text}</div>`
    : "";
}

// Clear any message when switching tabs (tab switching itself is handled by Bootstrap)
document.getElementById("authTabs").addEventListener("shown.bs.tab", () => setMessage("", "error"));

signInForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById("siSubmit");
  submitBtn.disabled = true;
  setMessage("", "error");

  const email = document.getElementById("siEmail").value.trim();
  const password = document.getElementById("siPassword").value;

  const { error } = await sb.auth.signInWithPassword({ email, password });

  submitBtn.disabled = false;
  if (error) {
    setMessage(error.message, "error");
    return;
  }
  window.location.href = "./app.html";
});

signUpForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById("suSubmit");
  submitBtn.disabled = true;
  setMessage("", "error");

  const email = document.getElementById("suEmail").value.trim();
  const password = document.getElementById("suPassword").value;

  const { data, error } = await sb.auth.signUp({ email, password });

  submitBtn.disabled = false;
  if (error) {
    setMessage(error.message, "error");
    return;
  }

  if (data.session) {
    // Email confirmation is off in the Supabase project — go straight in.
    window.location.href = "./app.html";
  } else {
    setMessage("Account created. Check your email to confirm, then sign in.", "success");
    bootstrap.Tab.getOrCreateInstance(document.getElementById("tabSignIn")).show();
  }
});
