import { sb } from "./supabaseClient.js";

// If already signed in, skip straight to the dashboard.
const { data: existing } = await sb.auth.getSession();
if (existing.session) {
  window.location.href = "./app.html";
}

const tabSignIn = document.getElementById("tabSignIn");
const tabSignUp = document.getElementById("tabSignUp");
const signInForm = document.getElementById("signInForm");
const signUpForm = document.getElementById("signUpForm");
const formMessage = document.getElementById("formMessage");

function showTab(tab) {
  const isSignIn = tab === "signin";
  tabSignIn.classList.toggle("is-active", isSignIn);
  tabSignUp.classList.toggle("is-active", !isSignIn);
  tabSignIn.setAttribute("aria-selected", String(isSignIn));
  tabSignUp.setAttribute("aria-selected", String(!isSignIn));
  signInForm.style.display = isSignIn ? "block" : "none";
  signUpForm.style.display = isSignIn ? "none" : "block";
  formMessage.innerHTML = "";
}

tabSignIn.addEventListener("click", () => showTab("signin"));
tabSignUp.addEventListener("click", () => showTab("signup"));

function setMessage(text, kind) {
  formMessage.innerHTML = text
    ? `<div class="form-${kind}">${text}</div>`
    : "";
}

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
    showTab("signin");
  }
});
