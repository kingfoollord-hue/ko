import "./style.css";
import { renderAdmin } from "./admin.js";
import { renderGame } from "./game.js";

const API_URL = (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/$/, "");
const app = document.querySelector("#app");
let registering = false;

function decodeJwt(token) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(atob(part).split("").map((char) =>
      `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`).join("")));
  } catch {
    return null;
  }
}

function showAuth(message = "", isSuccess = false) {
  app.innerHTML = `
    <main class="auth-shell">
      <section class="brand-panel">
        <div class="brand-mark">M</div>
        <p class="eyebrow">A CLASSIC BROWSER MMORPG</p>
        <h1>Enter the<br /><span>old realm.</span></h1>
        <p class="brand-copy">Explore a pixel-art world, fight monsters, gather treasures, and meet other adventurers.</p>
        <div class="world-art" aria-hidden="true"><div class="moon"></div><div class="mountain mountain-back"></div><div class="mountain mountain-front"></div><div class="ground-glow"></div></div>
      </section>
      <section class="auth-panel"><div class="auth-card">
        <p class="eyebrow">WELCOME TO MYTHOS CLASSIC</p><h2 id="auth-title">${registering ? "Create account" : "Sign in"}</h2>
        <p class="muted">${registering ? "Create your identity in the realm." : "No downloads. Just sign in and play."}</p>
        <div class="auth-tabs"><button type="button" class="tab ${!registering ? "active" : ""}" id="login-tab">Sign in</button><button type="button" class="tab ${registering ? "active" : ""}" id="register-tab">Create account</button></div>
        <form id="auth-form">
          ${registering ? `<label>Username<input id="username" autocomplete="username" minlength="3" maxlength="24" required pattern="[a-zA-Z0-9_]+"/></label><label>Email<input id="email" type="email" autocomplete="email" maxlength="254" required/></label>` : `<label>Username or email<input id="identity" autocomplete="username" maxlength="254" required/></label>`}
          <label>Password<input id="password" type="password" autocomplete="${registering ? "new-password" : "current-password"}" minlength="12" maxlength="128" required/></label>
          ${registering ? `<label>Owner enrollment secret (only for the configured owner email)<input id="owner-secret" type="password" autocomplete="off"/></label>` : ""}
          <button class="primary-button" id="submit-button" type="submit">${registering ? "Create account" : "Enter the realm"}</button>
          <p class="form-message ${isSuccess ? "success" : ""}" id="form-message" role="status">${escapeHtml(message)}</p>
        </form><p class="fine-print">Use a unique password of at least 12 characters.</p>
      </div></section>
    </main>`;
  document.querySelector("#login-tab").addEventListener("click", () => { registering = false; showAuth(); });
  document.querySelector("#register-tab").addEventListener("click", () => { registering = true; showAuth(); });
  document.querySelector("#auth-form").addEventListener("submit", submitAuth);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

async function submitAuth(event) {
  event.preventDefault();
  const formMessage = document.querySelector("#form-message");
  const button = document.querySelector("#submit-button");
  formMessage.textContent = "";
  button.disabled = true;
  button.textContent = "Please wait…";
  const body = registering ? {
    username: document.querySelector("#username").value.trim(),
    email: document.querySelector("#email").value.trim(),
    password: document.querySelector("#password").value,
    ownerBootstrapSecret: document.querySelector("#owner-secret").value
  } : {
    identity: document.querySelector("#identity").value.trim(),
    password: document.querySelector("#password").value
  };
  try {
    const response = await fetch(`${API_URL}/api/auth/${registering ? "register" : "login"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Authentication failed.");
    const claims = decodeJwt(result.token);
    if (!claims || !claims.sub || !["owner", "player"].includes(claims.role)) throw new Error("Server returned an invalid session.");
    localStorage.setItem("mmorpgToken", result.token);
    localStorage.setItem("mmorpgUser", JSON.stringify(result.user));
    await routeByRole(result.token, claims);
  } catch (error) {
    formMessage.textContent = error.message || "Could not connect to the server.";
    button.disabled = false;
    button.textContent = registering ? "Create account" : "Enter the realm";
  }
}

async function routeByRole(token, claims) {
  if (claims.exp && claims.exp * 1000 <= Date.now()) {
    localStorage.removeItem("mmorpgToken");
    localStorage.removeItem("mmorpgUser");
    registering = false;
    showAuth("Your session expired. Please sign in again.");
    return;
  }
  try {
    const response = await fetch(`${API_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error("Session expired or revoked.");
    const { user } = await response.json();
    if (user.role !== claims.role) throw new Error("Role changed. Please sign in again.");
    if (user.role === "owner") await renderAdmin(app, { token, user, apiUrl: API_URL, onLogout: logout });
    else await renderGame(app, { token, user, apiUrl: API_URL, onLogout: logout });
  } catch (error) {
    localStorage.removeItem("mmorpgToken");
    localStorage.removeItem("mmorpgUser");
    registering = false;
    showAuth(error.message || "Please sign in again.");
  }
}

function logout() {
  localStorage.removeItem("mmorpgToken");
  localStorage.removeItem("mmorpgUser");
  registering = false;
  showAuth();
}

const existingToken = localStorage.getItem("mmorpgToken");
const existingClaims = existingToken && decodeJwt(existingToken);
if (existingToken && existingClaims && existingClaims.exp * 1000 > Date.now()) {
  routeByRole(existingToken, existingClaims);
} else {
  localStorage.removeItem("mmorpgToken");
  localStorage.removeItem("mmorpgUser");
  showAuth();
}