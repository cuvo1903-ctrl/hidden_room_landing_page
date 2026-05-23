import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabase = createClient(
  "https://rpcunbkstadgngqrjafp.supabase.co",
  "sb_publishable_7v_FIgTjWjJgtT1YHIAYSw_bRBmQjZO"
);

console.log("Supabase listo");
console.log(supabase);

const form = document.getElementById("login-form");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const username = document.getElementById("usuario").value;
  const password = document.getElementById("password").value;

  const { data, error } = await supabase
    .from("login")
    .select("*")
    .eq("username", username)
    .eq("pswd", password);

  if (error || !data || data.length === 0) {
    alert("Login incorrecto");
    return;
  }

  // Fix: write session in the format dashboard.js expects
  localStorage.setItem("hr_session", JSON.stringify({
    user: {
      id:           data[0].id          ?? "usr_001",
      display_name: data[0].username    ?? "Usuario",
      email:        data[0].email       ?? "",
      client_id:    data[0].client_id   ?? "",
      whatsapp:     data[0].whatsapp    ?? "",
      avatar_url:   data[0].avatar_url  ?? "",
    },
    roles: data[0].roles ?? ["client", "collaborator", "rrpp"],
  }));

  window.location.href = "./dashboard.html";
});
