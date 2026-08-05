import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabase = createClient(
  "https://rpcunbkstadgngqrjafp.supabase.co",
  "sb_publishable_7v_FIgTjWjJgtT1YHIAYSw_bRBmQjZO"
);

const sessionStatus = document.getElementById("session-status");
const logoutButton = document.getElementById("logout-button");
const tester = document.getElementById("tester");
const form = document.getElementById("kairen-form");
const messageInput = document.getElementById("message");
const submitButton = document.getElementById("submit-button");
const clearButton = document.getElementById("clear-button");
const chatOutput = document.getElementById("chat-output");
const providerSelect = document.getElementById("ai-provider");
const modelSelect = document.getElementById("ai-model");
const activeModel = document.getElementById("active-model");
const messages = [];

const PROVIDER_STORAGE_KEY = "kairen_ai_provider";
const MODEL_STORAGE_KEY = "kairen_ai_model";
const DEFAULT_PROVIDER = "gemini";
const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const KAIREN_PERMISSION = "Kairen AI";

const MODEL_GROUPS = [
  {
    label: "Chat",
    models: [
      ["gemini-3.1-flash-lite", "3.1 Flash Lite"],
      ["gemini-2.5-flash-lite", "2.5 Flash Lite"],
      ["gemini-2.5-flash", "2.5 Flash"],
      ["gemini-3-flash", "3 Flash"],
      ["gemini-3.5-flash", "3.5 Flash"],
      ["gemma-4-26b", "Gemma 4 26B"],
      ["gemma-4-31b", "Gemma 4 31B"],
    ],
  },
  {
    label: "Audio",
    models: [
      ["gemini-2.5-flash-tts", "2.5 Flash TTS"],
      ["gemini-3.1-flash-tts", "3.1 Flash TTS"],
      ["gemini-2.5-flash-native-audio-dialog", "2.5 Flash Native Audio Dialog"],
      ["gemini-3-flash-live", "3 Flash Live"],
      ["gemini-3.5-live-translate", "3.5 Live Translate"],
    ],
  },
  {
    label: "Embeddings",
    models: [
      ["gemini-embedding-1", "Embedding 1"],
      ["gemini-embedding-2", "Embedding 2"],
    ],
  },
  {
    label: "Robotics",
    models: [
      ["gemini-robotics-er-1.5-preview", "Robotics ER 1.5 Preview"],
      ["gemini-robotics-er-1.6-preview", "Robotics ER 1.6 Preview"],
    ],
  },
];

init();

async function init() {
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    sessionStorage.setItem("hr_return_after_login", "../kairen/");
    window.location.replace("../portal/");
    return;
  }

  logoutButton.hidden = false;
  document.querySelectorAll("[data-hr-account]").forEach((accountLink) => {
    accountLink.textContent = user.email || "Usuario";
    accountLink.href = "../portal/dashboard.html";
  });

  const [
    { data: profile, error: profileError },
    { data: permission, error: permissionError },
  ] = await Promise.all([
    supabase
      .from("users")
      .select("roles")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("user_permissions")
      .select("id")
      .eq("user_id", user.id)
      .eq("permission_key", KAIREN_PERMISSION)
      .maybeSingle(),
  ]);

  if (profileError || permissionError) {
    sessionStatus.textContent = `No se pudo validar el acceso: ${(profileError || permissionError).message}`;
    return;
  }

  const isAdmin = String(profile?.roles ?? "")
    .split(",")
    .map((role) => role.trim().toLowerCase())
    .includes("admin");

  if (!isAdmin && !permission) {
    sessionStatus.textContent = `Acceso denegado para ${user.email ?? user.id}. Se requiere el permiso ${KAIREN_PERMISSION}.`;
    return;
  }

  sessionStatus.textContent = `Sesión autorizada: ${user.email ?? user.id}`;
  initializeModelSelector();
  await loadProviderAvailability();
  tester.hidden = false;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const text = messageInput.value.trim();
  if (!text) return;

  messages.push({ role: "user", text });
  renderMessages();
  messageInput.value = "";
  submitButton.disabled = true;
  messageInput.disabled = true;

  const { data, error } = await supabase.functions.invoke("kairen-gemini", {
    body: {
      provider: providerSelect.value,
      model: modelSelect.value,
      message: text,
      history: messages.slice(0, -1).filter((message) => (
        message.role === "user" || message.role === "model"
      )),
    },
  });

  if (error || !data?.reply) {
    messages.push({
      role: "error",
      text: await functionErrorMessage(error, data),
    });
  } else {
    messages.push({ role: "model", text: data.reply });
  }

  renderMessages();
  submitButton.disabled = false;
  messageInput.disabled = false;
  messageInput.focus();
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;

  event.preventDefault();
  if (messageInput.disabled || submitButton.disabled || !messageInput.value.trim()) return;
  form.requestSubmit(submitButton);
});

clearButton.addEventListener("click", () => {
  messages.length = 0;
  renderMessages();
  messageInput.focus();
});

providerSelect.addEventListener("change", () => {
  localStorage.setItem(PROVIDER_STORAGE_KEY, providerSelect.value);
  syncActiveModel();
});

modelSelect.addEventListener("change", () => {
  localStorage.setItem(MODEL_STORAGE_KEY, modelSelect.value);
  syncActiveModel();
});

logoutButton.addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.replace("../portal/");
});

function initializeModelSelector() {
  modelSelect.replaceChildren();

  for (const group of MODEL_GROUPS) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.label;

    for (const [value, label] of group.models) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      optgroup.append(option);
    }

    modelSelect.append(optgroup);
  }

  const savedProvider = localStorage.getItem(PROVIDER_STORAGE_KEY);
  const savedModel = localStorage.getItem(MODEL_STORAGE_KEY);
  const savedProviderOption = [...providerSelect.options]
    .find((option) => option.value === savedProvider && !option.disabled);
  const savedModelOption = [...modelSelect.options]
    .find((option) => option.value === savedModel);

  providerSelect.value = savedProviderOption
    ? savedProvider
    : DEFAULT_PROVIDER;
  modelSelect.value = savedModelOption
    ? savedModel
    : DEFAULT_MODEL;

  syncActiveModel();
}

async function loadProviderAvailability() {
  const { data } = await supabase.functions.invoke("kairen-gemini", {
    body: { action: "config" },
  });

  const availability = data?.providers ?? {};
  for (const option of providerSelect.options) {
    const available = Boolean(availability[option.value]);
    option.disabled = !available;
    option.textContent = available
      ? providerLabel(option.value)
      : `${providerLabel(option.value)} (no configurado)`;
  }

  if (providerSelect.selectedOptions[0]?.disabled) {
    providerSelect.value = availability.gemini ? "gemini" : "";
  }

  syncActiveModel();
}

function syncActiveModel() {
  const provider = providerLabel(providerSelect.value);
  const model = modelSelect.selectedOptions[0]?.textContent || modelSelect.value;
  activeModel.textContent = `[Kairen | ${provider} | ${model}]`;
}

function providerLabel(provider) {
  return {
    gemini: "Google AI",
    openrouter: "OpenRouter",
    ollama: "Ollama",
  }[provider] || provider;
}

function renderMessages() {
  chatOutput.replaceChildren();

  for (const message of messages) {
    const block = document.createElement("p");
    const label = message.role === "user"
      ? "Tú"
      : message.role === "model"
        ? "Kairen"
        : "Error";

    const strong = document.createElement("strong");
    strong.textContent = `${label}: `;
    block.append(strong, document.createTextNode(message.text));
    chatOutput.append(block);
  }
}

async function functionErrorMessage(error, data) {
  if (data?.error) return data.error;

  const response = error?.context;

  try {
    const responseBody = await response?.clone?.().json();
    if (responseBody?.error) return responseBody.error;
  } catch {
    // La respuesta puede no ser JSON.
  }

  try {
    const responseText = await response?.clone?.().text();
    if (responseText) return responseText;
  } catch {
    // El body puede haber sido consumido.
  }

  const details = [
    error?.message,
    response?.status ? `HTTP ${response.status}` : "",
    response?.statusText,
  ].filter(Boolean);

  return details.join(" - ") || "No se pudo obtener respuesta. Revisa la consola del navegador.";
}
