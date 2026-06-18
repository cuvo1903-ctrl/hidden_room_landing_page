import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabase = createClient(
  "https://rpcunbkstadgngqrjafp.supabase.co",
  "sb_publishable_7v_FIgTjWjJgtT1YHIAYSw_bRBmQjZO"
);

const sessionUser = document.getElementById("session-user");
const pageMessage = document.getElementById("page-message");
const actions = document.getElementById("ticket-home-actions");

init();

async function init() {
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    window.location.replace("/portal/login.html");
    return;
  }

  sessionUser.textContent = user.email || user.id;

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("roles")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("[Tickets] No fue posible consultar el perfil:", profileError);
    showMessage("No fue posible verificar todos los accesos de tu cuenta.", "error");
  }

  actions.hidden = false;
}

function showMessage(message, type = "") {
  pageMessage.textContent = message;
  pageMessage.className = `ticket-alert${type ? ` ticket-alert--${type}` : ""}`;
  pageMessage.hidden = false;
}
