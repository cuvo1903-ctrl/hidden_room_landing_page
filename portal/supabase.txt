import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabase = createClient(
  "https://rpcunbkstadgngqrjafp.supabase.co",
  "sb_publishable_7v_FIgTjWjJgtT1YHIAYSw_bRBmQjZO"
);

  console.log("Supabase listo");
  console.log(supabase);
// 🔥 ESTO ES LO QUE TE FALTA
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

  localStorage.setItem("user", JSON.stringify(data[0]));
  window.location.href = "./dashboard.html";

  console.log("Supabase listo");
  console.log(supabase);

});