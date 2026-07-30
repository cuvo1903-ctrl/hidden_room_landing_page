import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabase = createClient(
  "https://rpcunbkstadgngqrjafp.supabase.co",
  "sb_publishable_7v_FIgTjWjJgtT1YHIAYSw_bRBmQjZO"
);

const form = document.getElementById("recovery-form");
const statusEl = document.getElementById("recovery-status");
const submitButton = form?.querySelector(".login-submit");

function enhancePasswordToggles(root = document) {
  root.querySelectorAll('input[type="password"]:not([data-password-toggle-ready]), input[type="text"][data-password-visible="true"]:not([data-password-toggle-ready])').forEach((input) => {
    input.dataset.passwordToggleReady = "true";
    const wrapper = document.createElement("div");
    wrapper.className = "password-field";
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "password-toggle";
    button.dataset.action = "toggle-password";
    button.setAttribute("aria-label", "Ver contraseña");
    button.innerHTML = '<span class="password-eye" aria-hidden="true"></span>';
    wrapper.appendChild(button);
  });
}

document.addEventListener("click", (e) => {
  const popupClose = e.target.closest('[data-action="close-recovery-popup"]');
  if (popupClose) {
    closeRecoveryPopup();
    return;
  }

  const button = e.target.closest('[data-action="toggle-password"]');
  if (!button) return;

  const input = button.closest(".password-field")?.querySelector("input");
  if (!input) return;

  const visible = input.type === "text";
  input.type = visible ? "password" : "text";
  input.dataset.passwordVisible = visible ? "false" : "true";
  button.innerHTML = '<span class="password-eye" aria-hidden="true"></span>';
  button.setAttribute("aria-label", visible ? "Ver contraseña" : "Ocultar contraseña");
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeRecoveryPopup();
});

function setStatus(message) {
  if (statusEl) statusEl.textContent = message;
}

function ensureRecoveryPopup() {
  let popup = document.getElementById("recovery-popup");
  if (popup) return popup;

  popup = document.createElement("div");
  popup.id = "recovery-popup";
  popup.className = "recovery-popup";
  popup.hidden = true;
  popup.innerHTML = `
    <div class="recovery-popup__backdrop" data-action="close-recovery-popup"></div>
    <section class="recovery-popup__dialog" role="alertdialog" aria-modal="true" aria-labelledby="recovery-popup-title" aria-describedby="recovery-popup-message" tabindex="-1">
      <p class="recovery-popup__eyebrow">Error</p>
      <h2 id="recovery-popup-title">No se pudo continuar</h2>
      <p id="recovery-popup-message"></p>
      <button class="login-submit hr-btn hr-btn-primary" type="button" data-action="close-recovery-popup">Entendido</button>
    </section>
  `;
  document.body.appendChild(popup);
  return popup;
}

function showRecoveryPopup(message) {
  const popup = ensureRecoveryPopup();
  const messageEl = popup.querySelector("#recovery-popup-message");
  if (messageEl) messageEl.textContent = message || "Revisa los datos e intenta de nuevo.";
  popup.hidden = false;
  document.body.classList.add("recovery-popup-open");
  window.setTimeout(() => popup.querySelector(".recovery-popup__dialog")?.focus(), 0);
}

function closeRecoveryPopup() {
  const popup = document.getElementById("recovery-popup");
  if (!popup) return;
  popup.hidden = true;
  document.body.classList.remove("recovery-popup-open");
}

function showRecoveryError(message) {
  const safeMessage = message || "No se pudo actualizar la contrasena.";
  setStatus(safeMessage);
  showRecoveryPopup(safeMessage);
}

function getHashParams() {
  return new URLSearchParams(window.location.hash.replace(/^#/, ""));
}

async function ensureRecoverySession() {
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session) return sessionData.session;

  const params = getHashParams();
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");

  if (!accessToken || !refreshToken) return null;

  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (error) {
    console.error("[HR] recovery setSession:", error);
    return null;
  }

  window.history.replaceState({}, document.title, window.location.pathname);
  return data.session;
}

const session = await ensureRecoverySession();
if (!session) {
  setStatus("El enlace de recuperación no es válido o ya expiró. Solicita un nuevo email.");
  if (submitButton) submitButton.disabled = true;
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const password = document.getElementById("password")?.value ?? "";
  const confirm = document.getElementById("password_confirm")?.value ?? "";

  if (password.length < 8) {
    showRecoveryError("La contrasena debe tener al menos 8 caracteres.");
    return;
  }

  if (password !== confirm) {
    showRecoveryError("Las contrasenas no coinciden.");
    return;
  }

  if (submitButton) submitButton.disabled = true;
  setStatus("Guardando nueva contraseña...");

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    console.error("[HR] recovery updateUser:", error);
    showRecoveryError(error.message || "No se pudo actualizar la contrasena.");
    if (submitButton) submitButton.disabled = false;
    return;
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (user?.id) {
    const { error: clearError } = await supabase
      .from("users")
      .update({ temp_password: null })
      .eq("id", user.id);

    if (clearError) {
      console.info("[HR] recovery clear temp_password skipped:", clearError.message);
    }
  }

  setStatus("Contraseña actualizada. Entrando al dashboard...");
  setTimeout(() => {
    window.location.href = "./dashboard.html";
  }, 900);
});

enhancePasswordToggles();
