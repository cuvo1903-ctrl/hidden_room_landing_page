import { supabase } from "./store.js";
import { fillProductForm, getEditingProductId, getProductFormPayload, productAdminMarkup, resetProductForm } from "./admin-components.js";

const shell = document.getElementById("admin-shell");
const denied = document.getElementById("admin-denied");
const deniedMessage = document.getElementById("admin-denied-message");
const form = document.getElementById("product-form");
const list = document.getElementById("admin-products");
const statusElement = document.getElementById("admin-status");
const errorElement = document.getElementById("admin-form-error");
const cancelButton = document.getElementById("cancel-edit");
let adminProducts = [];

initializeAdmin();

async function initializeAdmin() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    sessionStorage.setItem("hr_return_after_login", "../store/admin.html");
    window.location.replace("../portal/");
    return;
  }

  const { data: profile, error } = await supabase
    .from("users")
    .select("roles")
    .eq("id", session.user.id)
    .maybeSingle();

  const isAdmin = String(profile?.roles ?? "")
    .split(",")
    .map((role) => role.trim().toLowerCase())
    .includes("admin");

  if (error || !isAdmin) {
    deniedMessage.textContent = error ? "No se pudo validar el acceso: " + error.message : "Esta seccion requiere rol admin.";
    return;
  }

  denied.hidden = true;
  shell.hidden = false;
  await loadProducts();
}

async function loadProducts() {
  const { data, error } = await supabase
    .from("store_products")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    statusElement.textContent = "No se pudieron cargar productos: " + error.message;
    return;
  }

  adminProducts = data ?? [];
  statusElement.textContent = adminProducts.length + " producto" + (adminProducts.length === 1 ? "" : "s") + ".";
  list.innerHTML = adminProducts.map(productAdminMarkup).join("");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorElement.textContent = "";

  const id = getEditingProductId();
  const payload = getProductFormPayload();
  const query = id
    ? supabase.from("store_products").update(payload).eq("id", id)
    : supabase.from("store_products").insert(payload);
  const { error } = await query;

  if (error) {
    errorElement.textContent = error.message;
    return;
  }

  resetProductForm({ form, cancelButton, errorElement });
  await loadProducts();
});

list.addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit-product]");
  const toggleButton = event.target.closest("[data-toggle-product]");
  const featuredButton = event.target.closest("[data-feature-product]");
  const deleteButton = event.target.closest("[data-delete-product]");

  if (editButton) {
    editProduct(editButton.dataset.editProduct);
    return;
  }
  if (toggleButton) {
    await updateProduct(toggleButton.dataset.toggleProduct, {
      is_active: toggleButton.dataset.active !== "true",
    });
    return;
  }
  if (featuredButton) {
    await updateProduct(featuredButton.dataset.featureProduct, {
      featured: featuredButton.dataset.featured !== "true",
    });
    return;
  }
  if (deleteButton && window.confirm("Eliminar este producto? Dejara de existir para clientes, pero no se borra ningun archivo externo.")) {
    const { error } = await supabase.from("store_products").delete().eq("id", deleteButton.dataset.deleteProduct);
    if (error) statusElement.textContent = error.message;
    else await loadProducts();
  }
});

cancelButton.addEventListener("click", () => resetProductForm({ form, cancelButton, errorElement }));

async function updateProduct(id, patch) {
  const { error } = await supabase.from("store_products").update(patch).eq("id", id);
  if (error) statusElement.textContent = error.message;
  else await loadProducts();
}

function editProduct(id) {
  const product = adminProducts.find((candidate) => candidate.id === id);
  if (!product) return;
  fillProductForm(product, { cancelButton, form });
}
