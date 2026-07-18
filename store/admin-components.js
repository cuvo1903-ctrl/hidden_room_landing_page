import { escapeHtml } from "./store.js";

const formFieldIds = {
  id: "product-id",
  name: "product-name",
  slug: "product-slug",
  description: "product-description",
  producer: "product-producer",
  category: "product-category",
  price: "product-price",
  imageUrl: "product-image-url",
  fileUrl: "product-file-url",
  stock: "product-stock",
  isDigital: "product-is-digital",
  featured: "product-featured",
  isActive: "product-is-active",
  title: "product-form-title",
};

export function getProductFormPayload() {
  const stockValue = valueOf("stock");
  return {
    name: valueOf("name").trim(),
    slug: valueOf("slug").trim().toLowerCase(),
    description: valueOf("description").trim() || null,
    producer: valueOf("producer").trim() || null,
    category: valueOf("category"),
    price: Number(valueOf("price")),
    currency: "MXN",
    image_url: valueOf("imageUrl").trim() || null,
    file_url: valueOf("fileUrl").trim() || null,
    stock: stockValue === "" ? null : Number(stockValue),
    is_digital: checked("isDigital"),
    featured: checked("featured"),
    is_active: checked("isActive"),
  };
}

export function getEditingProductId() {
  return valueOf("id");
}

export function fillProductForm(product, { cancelButton, form } = {}) {
  setValue("id", product.id);
  setValue("name", product.name);
  setValue("slug", product.slug);
  setValue("description", product.description ?? "");
  setValue("producer", product.producer ?? "");
  setValue("category", product.category);
  setValue("price", product.price);
  setValue("imageUrl", product.image_url ?? "");
  setValue("fileUrl", product.file_url ?? "");
  setValue("stock", product.stock ?? "");
  setChecked("isDigital", Boolean(product.is_digital));
  setChecked("featured", Boolean(product.featured));
  setChecked("isActive", Boolean(product.is_active));
  setText("title", "Editar producto");
  if (cancelButton) cancelButton.hidden = false;
  form?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function resetProductForm({ form, cancelButton, errorElement } = {}) {
  form?.reset();
  setValue("id", "");
  setChecked("isActive", true);
  setText("title", "Nuevo producto");
  if (cancelButton) cancelButton.hidden = true;
  if (errorElement) errorElement.textContent = "";
}

export function productAdminMarkup(product) {
  const status = product.is_active ? "Activo" : "Inactivo";
  const format = product.is_digital ? "Digital" : "Fisico";
  const flags = [status, product.featured ? "Featured" : "", format].filter(Boolean).join(" / ");
  const producer = product.producer ? " / " + escapeHtml(product.producer) : "";
  return [
    "<article class=\"admin-product-row\">",
    "<div>",
    "<span class=\"product-category\">" + escapeHtml(product.category) + " / " + escapeHtml(flags) + "</span>",
    "<h2>" + escapeHtml(product.name) + "</h2>",
    "<p>" + escapeHtml(product.slug) + producer + " / " + formatPrice(product.price, product.currency) + " / stock " + escapeHtml(product.stock ?? "ilimitado") + "</p>",
    "</div>",
    "<div class=\"admin-actions\">",
    "<button class=\"secondary-button\" type=\"button\" data-edit-product=\"" + escapeHtml(product.id) + "\">Editar</button>",
    "<button class=\"secondary-button\" type=\"button\" data-toggle-product=\"" + escapeHtml(product.id) + "\" data-active=\"" + product.is_active + "\">" + (product.is_active ? "Desactivar" : "Activar") + "</button>",
    "<button class=\"secondary-button\" type=\"button\" data-feature-product=\"" + escapeHtml(product.id) + "\" data-featured=\"" + product.featured + "\">" + (product.featured ? "Quitar featured" : "Featured") + "</button>",
    "<button class=\"remove-button\" type=\"button\" data-delete-product=\"" + escapeHtml(product.id) + "\">Eliminar</button>",
    "</div>",
    "</article>",
  ].join("");
}

function formatPrice(value, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: currency || "MXN" }).format(Number(value));
}

function field(key) {
  return document.getElementById(formFieldIds[key]);
}

function valueOf(key) {
  return field(key)?.value ?? "";
}

function checked(key) {
  return Boolean(field(key)?.checked);
}

function setValue(key, value) {
  const input = field(key);
  if (input) input.value = value ?? "";
}

function setChecked(key, value) {
  const input = field(key);
  if (input) input.checked = Boolean(value);
}

function setText(key, value) {
  const element = field(key);
  if (element) element.textContent = value;
}
