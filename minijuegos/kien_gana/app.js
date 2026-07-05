const SUPABASE_URL = "https://rpcunbkstadgngqrjafp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_7v_FIgTjWjJgtT1YHIAYSw_bRBmQjZO";
const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
const SUPABASE_FALLBACK_CDN = "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_BOOT_TIMEOUT_MS = 8000;
const SUPABASE_REST_TIMEOUT_MS = 9000;
const LOGIN_RETURN_KEY = "hr_return_after_login";
const DRAFTS_KEY = "hr_kien_gana_prediction_drafts";

function bootTimeout(label, ms = SUPABASE_BOOT_TIMEOUT_MS) {
  return new Promise((_resolve, reject) => {
    window.setTimeout(() => reject(new Error(`${label} tardo demasiado`)), ms);
  });
}

function restTimeout(label, controller, ms = SUPABASE_REST_TIMEOUT_MS) {
  return window.setTimeout(() => {
    controller.abort();
    console.info(`[Kien Gana] ${label} tardo demasiado`);
  }, ms);
}

async function fetchSupabaseRest(path) {
  const controller = new AbortController();
  const timer = restTimeout(path, controller);

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`REST ${response.status}: ${await response.text()}`);
    }

    return response.json();
  } finally {
    window.clearTimeout(timer);
  }
}
async function importSupabaseFrom(url) {
  const { createClient } = await Promise.race([
    import(url),
    bootTimeout(`Supabase CDN ${url}`),
  ]);
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

async function getSupabaseClient() {
  if (window.__hiddenRoomSupabaseClient) {
    return window.__hiddenRoomSupabaseClient;
  }

  if (window.HiddenRoomSupabase?.getClient) {
    try {
      window.__hiddenRoomSupabaseClient = await Promise.race([
        window.HiddenRoomSupabase.getClient(),
        bootTimeout("Supabase global"),
      ]);
      return window.__hiddenRoomSupabaseClient;
    } catch (error) {
      console.info("[Kien Gana] Supabase global no respondio, usando fallback:", error?.message || error);
    }
  }

  const cdns = [SUPABASE_FALLBACK_CDN, SUPABASE_CDN];
  let lastError = null;
  for (const url of cdns) {
    try {
      window.__hiddenRoomSupabaseClient = await importSupabaseFrom(url);
      return window.__hiddenRoomSupabaseClient;
    } catch (error) {
      lastError = error;
      console.info("[Kien Gana] No se pudo cargar Supabase desde", url, error?.message || error);
    }
  }

  throw lastError || new Error("No se pudo cargar Supabase");
}

let sb = null;

const state = {
  user: null,
  profile: null,
  canAdmin: false,
  matches: [],
  predictions: new Map(),
  adminPredictions: [],
  selectedWinner: new Map(),
  drafts: new Map(),
  isLoadingGame: false,
};

const $ = (id) => document.getElementById(id);

function setSessionLoading(isLoading) {
  const label = $("sessionLabel");
  if (label && isLoading) label.textContent = "Verificando sesion...";
  $("authView")?.classList.add("hidden");
  $("logoutBtn")?.classList.add("hidden");

  if (isLoading) {
    state.isLoadingGame = true;
    $("gameView")?.classList.remove("hidden");
    renderMatches();
    return;
  }

  $("gameView")?.classList.add("hidden");
}

function resetAuthenticatedState() {
  state.profile = null;
  state.canAdmin = false;
  state.predictions = new Map();
  state.adminPredictions = [];
  $("adminTab")?.classList.add("hidden");
  $("rankingTabButton")?.classList.add("hidden");
  if ($("profileName")) $("profileName").textContent = "Invitado";
  $("adminMatchesTable")?.replaceChildren();
  $("adminPredictionsTable")?.replaceChildren();
}

function toast(message) {
  const node = $("toast");
  node.textContent = message;
  node.classList.remove("hidden");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => node.classList.add("hidden"), 2600);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Fecha por confirmar";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function parseRoles(rawRoles) {
  return String(rawRoles || "client")
    .split(",")
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);
}

function isAdminProfile(profile) {
  return parseRoles(profile?.roles).includes("admin");
}

function canManageMatches() {
  return state.canAdmin || isAdminProfile(state.profile);
}

function winnerFromScore(home, away) {
  if (home > away) return "home";
  if (away > home) return "away";
  return "draw";
}

function winnerMatchesScore(predictedWinner, homeScore, awayScore) {
  return winnerFromScore(homeScore, awayScore) === predictedWinner;
}

function scoreFromRaw(raw) {
  if (String(raw).trim() === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function scoreDraftFromRaw(homeRaw, awayRaw) {
  const homeBlank = String(homeRaw).trim() === "";
  const awayBlank = String(awayRaw).trim() === "";

  if (homeBlank && awayBlank) {
    return { error: "missing" };
  }

  const homeScore = homeBlank ? 0 : scoreFromRaw(homeRaw);
  const awayScore = awayBlank ? 0 : scoreFromRaw(awayRaw);

  if (homeScore === null || awayScore === null) {
    return { error: "invalid" };
  }

  return { homeScore, awayScore };
}

function loadStoredDrafts() {
  try {
    const raw = sessionStorage.getItem(DRAFTS_KEY);
    const entries = raw ? JSON.parse(raw) : [];
    state.drafts = new Map(Array.isArray(entries) ? entries : []);
    state.selectedWinner = new Map(
      Array.from(state.drafts.entries())
        .filter(([, draft]) => draft?.predictedWinner)
        .map(([matchId, draft]) => [matchId, draft.predictedWinner]),
    );
  } catch (_error) {
    state.drafts = new Map();
  }
}

function persistDrafts() {
  sessionStorage.setItem(DRAFTS_KEY, JSON.stringify(Array.from(state.drafts.entries())));
}

function setDraft(matchId, patch) {
  const current = state.drafts.get(matchId) || {};
  const next = { ...current, ...patch };
  state.drafts.set(matchId, next);
  if (next.predictedWinner) state.selectedWinner.set(matchId, next.predictedWinner);
  persistDrafts();
  return next;
}

function removeDraft(matchId) {
  state.drafts.delete(matchId);
  state.selectedWinner.delete(matchId);
  persistDrafts();
}

function removeDraftsForSavedPredictions() {
  let changed = false;
  state.predictions.forEach((_prediction, matchId) => {
    if (state.drafts.has(matchId)) {
      state.drafts.delete(matchId);
      state.selectedWinner.delete(matchId);
      changed = true;
    }
  });
  if (changed) persistDrafts();
}

function makeText(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

function renderTeamLabel(node, name) {
  node.replaceChildren();
  node.append(document.createTextNode(String(name || "").trim()));
}

function predictionSummaryLine(match, draft) {
  return `${match.home_team} vs ${match.away_team}: ${labelWinner(match, draft.predictedWinner)} ${draft.homeScore}-${draft.awayScore}`;
}

function confirmPredictionDrafts(drafts) {
  if (!drafts.length) return false;

  const summary = drafts
    .map(({ match, draft }) => `- ${predictionSummaryLine(match, draft)}`)
    .join("\n");

  return window.confirm(
    "¿Confirmar predicción? No podrás editar tus predicciones más adelante.\n\n"
    + "Resumen de tus predicciones:\n"
    + summary,
  );
}

function requestLoginToSave(drafts) {
  drafts.forEach(({ match, draft }) => setDraft(match.id, draft));
  $("authView")?.classList.remove("hidden");
  $("authView")?.scrollIntoView({ behavior: "smooth", block: "center" });
  toast("Inicia sesion para guardar. Tus cambios no se perdieron.");
}


async function ensureSupabaseClient() {
  if (sb) return sb;
  sb = await getSupabaseClient();
  return sb;
}

async function boot() {
  loadStoredDrafts();
  bindUI();
  setSessionLoading(true);
  await loadGame({ publicOnly: true });
  hydrateSession().catch((error) => {
    console.info("[Kien Gana] No se pudo hidratar la sesion:", error?.message || error);
  });
}

async function hydrateSession() {
  try {
    await ensureSupabaseClient();
    attachAuthStateListener();
    state.user = await resolveCurrentUser();
  } catch (error) {
    console.info("[Kien Gana] No se pudo verificar la sesion:", error?.message || error);
    state.user = null;
  }
  await renderSession();
}

async function resolveCurrentUser() {
  const { data: sessionData } = await sb.auth.getSession();
  if (sessionData?.session?.user) return sessionData.session.user;

  const { data } = await sb.auth.getUser();
  return data?.user ?? null;
}

function bindUI() {
  $("loginBtn").addEventListener("click", login);
  $("signupBtn").addEventListener("click", () => {
    sessionStorage.setItem(LOGIN_RETURN_KEY, "../minijuegos/kien_gana/");
  });
  $("logoutBtn").addEventListener("click", logout);
  $("refreshBtn").addEventListener("click", loadGame);
  $("saveAllPredictionsBtn")?.addEventListener("click", saveAllPredictions);
  $("createMatchBtn").addEventListener("click", createMatch);
  $("finalizeMatchBtn").addEventListener("click", finalizeMatch);
  $("adminMatchesRefreshBtn")?.addEventListener("click", loadGame);
  $("adminPredictionsRefreshBtn")?.addEventListener("click", loadGame);
  $("saveAllMatchesBtn")?.addEventListener("click", saveAllAdminMatches);
  $("adminMatchesTable")?.addEventListener("click", handleAdminMatchesTableClick);

  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });
}

function attachAuthStateListener() {
  if (!sb || attachAuthStateListener.ready) return;
  attachAuthStateListener.ready = true;

  sb.auth.onAuthStateChange(async (_event, session) => {
    if (!session?.user) {
      state.user = null;
      await renderSession();
      return;
    }

    state.user = session.user;
    await renderSession();
  });
}

async function renderSession() {
  if (!state.user) {
    resetAuthenticatedState();
    $("authView").classList.add("hidden");
    $("gameView").classList.remove("hidden");
    $("logoutBtn").classList.add("hidden");
    $("sessionLabel").textContent = "Invitado: juega ahora, inicia sesion al guardar";
    if (["ranking", "admin"].includes(document.querySelector(".tab.active")?.dataset.tab)) {
      switchTab("predict");
    }
    await loadGame();
    return;
  }

  $("authView").classList.add("hidden");
  $("gameView").classList.remove("hidden");
  $("logoutBtn").classList.remove("hidden");
  $("sessionLabel").textContent = state.user.email || "Sesion activa";
  await loadProfile();
  await loadGame();
}

async function login() {
  const client = await ensureSupabaseClient();
  if (!client) {
    toast("No se pudo conectar con Supabase. Actualiza e intenta de nuevo.");
    return;
  }

  const email = $("emailInput").value.trim();
  const password = $("passwordInput").value;

  if (!email || !password) {
    toast("Escribe tu email y contrasena.");
    return;
  }

  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    toast(error.message);
    return;
  }

  $("authView").classList.add("hidden");
  toast(state.drafts.size ? "Sesion iniciada. Revisa y guarda tus predicciones." : "Sesion iniciada");
}

async function logout() {
  await sb.auth.signOut();
  localStorage.removeItem("session");
  toast("Sesion cerrada");
}

async function loadProfile() {
  const ensureResult = await sb.rpc("ensure_my_user_id");
  if (ensureResult.error) {
    console.info("[Kien Gana] ensure_my_user_id:", ensureResult.error.message);
  }

  const profileQuery = "id,user_id,display_name,username,email,roles";
  const profileById = sb
    .from("users")
    .select(profileQuery)
    .eq("id", state.user.id)
    .maybeSingle();
  const profileByUserId = sb
    .from("users")
    .select(profileQuery)
    .eq("user_id", state.user.id)
    .maybeSingle();
  const profileByEmail = state.user.email
    ? sb
      .from("users")
      .select(profileQuery)
      .ilike("email", state.user.email)
      .maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const [idResult, userIdResult, emailResult, predictorAdminResult, adminResult] = await Promise.all([
    profileById,
    profileByUserId,
    profileByEmail,
    sb.rpc("predictor_can_manage_matches"),
    sb.rpc("is_admin"),
  ]);
  const profileResult = idResult.data ? idResult : userIdResult.data ? userIdResult : emailResult;
  const { data, error } = profileResult;

  if (error) {
    toast(`No se pudo cargar tu perfil: ${error.message}`);
  }

  if (predictorAdminResult.error) {
    console.info("[Kien Gana] predictor_can_manage_matches:", predictorAdminResult.error.message);
  }

  if (adminResult.error) {
    console.info("[Kien Gana] is_admin:", adminResult.error.message);
  }

  state.profile = data ?? {
    id: state.user.id,
    display_name: state.user.email,
    username: state.user.email,
    email: state.user.email,
    roles: "client",
  };

  state.canAdmin = Boolean(predictorAdminResult.data) || Boolean(adminResult.data) || isAdminProfile(state.profile);
  $("adminTab").classList.toggle("hidden", !state.canAdmin);
  $("rankingTabButton").classList.toggle("hidden", !state.canAdmin);
  if (!state.canAdmin && ["ranking", "admin"].includes(document.querySelector(".tab.active")?.dataset.tab)) {
    switchTab("predict");
  }
  $("profileName").textContent =
    state.profile.display_name || state.profile.username || state.profile.email || "Jugador";
}

async function loadGame(options = {}) {
  state.isLoadingGame = true;
  renderMatches();

  try {
    if (options.publicOnly) {
      await loadMatches({ preferRest: true });
    } else {
      await ensureSupabaseClient();
      const loaders = [loadMatches()];
      if (state.user) loaders.push(loadPredictions());
      if (state.canAdmin) loaders.push(loadLeaderboard(), loadAdminPredictions());
      await Promise.all(loaders);
    }
  } catch (error) {
    console.info("[Kien Gana] loadGame:", error?.message || error);
    toast("No se pudieron cargar las predicciones. Intenta de nuevo.");
  } finally {
    state.isLoadingGame = false;
  }

  renderMatches();
  renderAdminSelect();
  renderAdminMatchesTable();
  renderAdminPredictionsTable();
  renderProfileStats();
}

async function loadMatches(options = {}) {
  if (options.preferRest || !sb) {
    const data = await fetchSupabaseRest("predictor_matches?select=*&order=kickoff_at.asc");
    state.matches = data ?? [];
    return;
  }

  const { data, error } = await sb
    .from("predictor_matches")
    .select("*")
    .order("kickoff_at", { ascending: true });

  if (error) {
    toast(error.message);
    return;
  }

  state.matches = data ?? [];
}

async function loadPredictions() {
  const { data, error } = await sb
    .from("predictor_predictions")
    .select("*")
    .eq("user_id", state.user.id);

  if (error) {
    toast(error.message);
    return;
  }

  state.predictions = new Map((data ?? []).map((prediction) => [prediction.match_id, prediction]));
  removeDraftsForSavedPredictions();
}

async function loadAdminPredictions() {
  if (!canManageMatches()) {
    state.adminPredictions = [];
    return;
  }

  const { data, error } = await sb
    .from("predictor_predictions")
    .select("*, predictor_matches(home_team,away_team,stage,kickoff_at,status)")
    .order("created_at", { ascending: false });

  if (error) {
    console.info("[Kien Gana] admin predictions:", error.message);
    state.adminPredictions = [];
    return;
  }

  state.adminPredictions = data ?? [];
}

function renderMatches() {
  const list = $("matchesList");
  const template = $("matchTemplate");
  list.replaceChildren();

  if (state.isLoadingGame) {
    const loading = document.createElement("div");
    loading.className = "hr-card match-card match-loading";
    loading.setAttribute("role", "status");
    loading.setAttribute("aria-live", "polite");
    const spinner = document.createElement("span");
    spinner.className = "match-loading-spinner";
    spinner.setAttribute("aria-hidden", "true");
    loading.append(
      spinner,
      makeText("h2", "", state.user ? "Cargando tus predicciones" : "Cargando partidos"),
      makeText("p", "sub", "Estamos preparando la quiniela. Esto puede tardar unos segundos."),
    );
    list.append(loading);
    return;
  }

  if (!state.matches.length) {
    const empty = document.createElement("div");
    empty.className = "hr-card match-card";
    empty.append(
      makeText("h2", "", "No hay partidos todavia"),
      makeText("p", "sub", "Un admin puede crear partidos desde esta misma pantalla."),
    );
    list.append(empty);
    return;
  }

  state.matches.forEach((match) => {
    const node = template.content.firstElementChild.cloneNode(true);
    const prediction = state.predictions.get(match.id);
    const draft = state.drafts.get(match.id);
    const matchLocked = new Date(match.kickoff_at) <= new Date() || match.status !== "open";
    const userLocked = Boolean(prediction);
    const locked = matchLocked || userLocked;
    const final = match.status === "final";
    node.dataset.matchId = match.id;

    node.querySelector(".stage").textContent = match.stage || "Mundial";
    node.querySelector(".lock").textContent = final ? "Finalizado" : userLocked && !matchLocked ? "Prediccion enviada" : locked ? "Bloqueado" : "Abierto";
    node.querySelector(".lock").classList.toggle("locked", locked && !final);
    node.querySelector(".lock").classList.toggle("final", final);
    renderTeamLabel(node.querySelector(".homeTeam"), match.home_team);
    renderTeamLabel(node.querySelector(".awayTeam"), match.away_team);
    node.querySelector(".kickoff").textContent = formatDate(match.kickoff_at);

    const winnerRow = node.querySelector(".winner-row");
    const currentWinner = prediction?.predicted_winner || draft?.predictedWinner || state.selectedWinner.get(match.id) || "";
    if (currentWinner) state.selectedWinner.set(match.id, currentWinner);

    [
      ["home", match.home_team],
      ["draw", "Empate"],
      ["away", match.away_team],
    ].forEach(([value, label]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `pick ${currentWinner === value ? "active" : ""}`;
      button.dataset.winner = value;
      button.textContent = label;
      button.disabled = locked;
      button.addEventListener("click", () => {
        setDraft(match.id, { predictedWinner: value });
        winnerRow.querySelectorAll(".pick").forEach((pick) => pick.classList.remove("active"));
        button.classList.add("active");
      });
      winnerRow.appendChild(button);
    });

    const homeScore = node.querySelector(".pred-home-score");
    const awayScore = node.querySelector(".pred-away-score");
    node.querySelector(".prediction-form")?.classList.toggle("hidden", locked);
    homeScore.dataset.scoreField = "home";
    awayScore.dataset.scoreField = "away";
    homeScore.value = prediction?.home_score ?? draft?.homeScore ?? "";
    awayScore.value = prediction?.away_score ?? draft?.awayScore ?? "";
    homeScore.disabled = locked;
    awayScore.disabled = locked;
    homeScore.addEventListener("input", () => {
      setDraft(match.id, { homeScore: homeScore.value });
    });
    awayScore.addEventListener("input", () => {
      setDraft(match.id, { awayScore: awayScore.value });
    });

    const saveButton = node.querySelector(".save-pred");
    saveButton.disabled = locked;
    saveButton.textContent = prediction ? "Prediccion enviada" : "Confirmar prediccion";
    saveButton.addEventListener("click", () => savePrediction(match, homeScore.value, awayScore.value, {
      card: node,
      button: saveButton,
      resultBox: node.querySelector(".prediction-result"),
    }));

    const resultBox = node.querySelector(".prediction-result");
    renderPredictionResult(resultBox, match, prediction, matchLocked || final);

    list.appendChild(node);
  });
}

function finalScoreLabel(match) {
  const hasScore = Number.isInteger(match.home_score) && Number.isInteger(match.away_score);
  return hasScore
    ? `${match.home_team} ${match.home_score}-${match.away_score} ${match.away_team}`
    : "Por confirmar";
}

function renderPredictionResult(resultBox, match, prediction, showFinal = false) {
  resultBox.replaceChildren();

  if (!prediction && !showFinal) {
    resultBox.classList.add("hidden");
    return;
  }

  resultBox.classList.remove("hidden");

  if (showFinal) {
    resultBox.append(
      makeText("strong", "", `Resultado final: ${finalScoreLabel(match)}`),
      document.createElement("br"),
    );
  }

  resultBox.append(
    makeText(
      "span",
      "",
      prediction
        ? `Tu prediccion: ${labelWinner(match, prediction.predicted_winner)} ${prediction.home_score}-${prediction.away_score}`
        : "Tu prediccion: No hiciste):",
    ),
  );

  if (showFinal && prediction) {
    resultBox.append(
      document.createElement("br"),
      makeText("span", "", `Puntos: ${prediction.points_awarded ?? 0} / Coins: ${prediction.coins_awarded ?? 0}`),
    );
  }
}

function labelWinner(match, value) {
  if (value === "home") return match.home_team;
  if (value === "away") return match.away_team;
  return "Empate";
}

async function savePrediction(match, homeScoreRaw, awayScoreRaw, options = {}) {
  const scoreDraft = scoreDraftFromRaw(homeScoreRaw, awayScoreRaw);
  const predictedWinner = state.selectedWinner.get(match.id);

  if (!predictedWinner) {
    toast("Elige un ganador.");
    return;
  }

  if (scoreDraft.error === "missing") {
    toast("Añade marcador antes de guardar.");
    return;
  }

  if (scoreDraft.error === "invalid") {
    toast("Marcador invalido");
    return;
  }

  const { homeScore, awayScore } = scoreDraft;
  const homeInput = options.card?.querySelector('[data-score-field="home"]');
  const awayInput = options.card?.querySelector('[data-score-field="away"]');
  if (homeInput) homeInput.value = homeScore;
  if (awayInput) awayInput.value = awayScore;

  if (!winnerMatchesScore(predictedWinner, homeScore, awayScore)) {
    toast("El ganador debe coincidir con el marcador.");
    return;
  }

  if (new Date(match.kickoff_at) <= new Date() || match.status !== "open") {
    toast("Este partido ya esta bloqueado");
    return;
  }

  if (state.predictions.has(match.id)) {
    toast("Ya registraste una prediccion para este partido.");
    return;
  }

  const draft = { predictedWinner, homeScore, awayScore };
  setDraft(match.id, draft);

  if (!state.user) {
    requestLoginToSave([{ match, draft }]);
    return;
  }

  if (!options.skipConfirm && !confirmPredictionDrafts([{ match, draft }])) {
    return;
  }

  const payload = {
    match_id: match.id,
    user_id: state.user.id,
    predicted_winner: predictedWinner,
    home_score: homeScore,
    away_score: awayScore,
  };

  const { data, error } = await sb
    .from("predictor_predictions")
    .insert(payload)
    .select("*")
    .maybeSingle();

  if (error) {
    toast(error.message);
    return;
  }

  const savedPrediction = {
    ...state.predictions.get(match.id),
    ...payload,
    ...(data ?? {}),
  };
  state.predictions.set(match.id, savedPrediction);
  removeDraft(match.id);
  if (options.button) {
    options.button.textContent = "Prediccion enviada";
    options.button.disabled = true;
  }
  if (options.card) {
    options.card.querySelector(".prediction-form")?.classList.add("hidden");
    const lock = options.card.querySelector(".lock");
    if (lock) {
      lock.textContent = "Prediccion enviada";
      lock.classList.add("locked");
    }
  }
  if (options.resultBox) renderPredictionResult(options.resultBox, match, savedPrediction, false);
  renderProfileStats();
  if (!options.silent) toast("Prediccion guardada");
  return savedPrediction;
}

async function saveAllPredictions() {
  const cards = Array.from(document.querySelectorAll(".match-card[data-match-id]"));
  const editableCards = cards.filter((card) => {
    const match = state.matches.find((item) => item.id === card.dataset.matchId);
    const hasDraft = state.drafts.has(card.dataset.matchId);
    const hasInput =
      Boolean(card.querySelector(".pick.active"))
      || String(card.querySelector('[data-score-field="home"]')?.value || "").trim() !== ""
      || String(card.querySelector('[data-score-field="away"]')?.value || "").trim() !== "";
    return match
      && match.status === "open"
      && new Date(match.kickoff_at) > new Date()
      && !state.predictions.has(match.id)
      && (hasDraft || hasInput);
  });

  if (!editableCards.length) {
    toast("No hay cambios de prediccion para guardar.");
    return;
  }

  const drafts = [];
  for (const card of editableCards) {
    const match = state.matches.find((item) => item.id === card.dataset.matchId);
    const activePick = card.querySelector(".pick.active");
    const predictedWinner = activePick?.dataset.winner || state.selectedWinner.get(match.id);
    const homeInput = card.querySelector('[data-score-field="home"]');
    const awayInput = card.querySelector('[data-score-field="away"]');
    const scoreDraft = scoreDraftFromRaw(homeInput?.value, awayInput?.value);

    if (!predictedWinner) {
      toast(`Elige ganador para ${match.home_team} vs ${match.away_team}.`);
      return;
    }

    if (scoreDraft.error === "missing") {
      toast(`Añade marcador para ${match.home_team} vs ${match.away_team}.`);
      return;
    }

    if (scoreDraft.error === "invalid") {
      toast(`Marcador invalido en ${match.home_team} vs ${match.away_team}.`);
      return;
    }

    const { homeScore, awayScore } = scoreDraft;
    if (homeInput) homeInput.value = homeScore;
    if (awayInput) awayInput.value = awayScore;

    if (!winnerMatchesScore(predictedWinner, homeScore, awayScore)) {
      toast(`El ganador no coincide con el marcador en ${match.home_team} vs ${match.away_team}.`);
      return;
    }

    drafts.push({ match, card, draft: { predictedWinner, homeScore, awayScore } });
  }

  drafts.forEach(({ match, draft }) => setDraft(match.id, draft));

  if (!state.user) {
    requestLoginToSave(drafts);
    return;
  }

  if (!confirmPredictionDrafts(drafts)) return;

  let saved = 0;
  for (const { match, card, draft } of drafts) {
    state.selectedWinner.set(match.id, draft.predictedWinner);
    const result = await savePrediction(match, draft.homeScore, draft.awayScore, {
      card,
      button: card.querySelector(".save-pred"),
      resultBox: card.querySelector(".prediction-result"),
      silent: true,
      skipConfirm: true,
    });

    if (result) saved += 1;
  }

  toast(saved ? `${saved} prediccion${saved === 1 ? "" : "es"} guardada${saved === 1 ? "" : "s"}.` : "No se guardaron cambios.");
}

async function loadLeaderboard() {
  const { data, error } = await sb
    .from("predictor_leaderboard")
    .select("*")
    .limit(50);

  if (error) {
    toast(error.message);
    return;
  }

  const board = $("leaderboard");
  board.replaceChildren();

  if (!data?.length) {
    board.append(makeText("div", "rank-row", "Sin ranking todavia"));
    return;
  }

  data.forEach((row, index) => {
    const item = document.createElement("div");
    item.className = "rank-row";
    item.append(
      makeText("span", "rank", `#${index + 1}`),
      makeText("strong", "", row.username || "Jugador"),
      makeText("span", "", `${row.total_points || 0} pts`),
      makeText("span", "coins", `${row.total_coins || 0} coins`),
    );
    board.appendChild(item);
  });
}

function renderProfileStats() {
  const own = Array.from(state.predictions.values());
  const finals = own.filter((prediction) => prediction.scored_at);
  const points = own.reduce((sum, prediction) => sum + (prediction.points_awarded || 0), 0);
  const coins = own.reduce((sum, prediction) => sum + (prediction.coins_awarded || 0), 0);
  const hits = finals.length
    ? Math.round((finals.filter((prediction) => (prediction.points_awarded || 0) > 0).length / finals.length) * 100)
    : 0;

  $("statPoints").textContent = points;
  $("statCoins").textContent = coins;
  $("statHits").textContent = `${hits}%`;

  const badges = [];
  if (own.length >= 1) badges.push("Primer pick");
  if (finals.some((prediction) => prediction.exact_score_hit)) badges.push("Marcador exacto");
  if (points >= 25) badges.push("Oraculo");
  if (coins >= 50) badges.push("Cazacoins");

  const holder = $("badges");
  holder.replaceChildren();
  if (!badges.length) {
    holder.append(makeText("span", "sub", "Todavia sin insignias."));
    return;
  }

  badges.forEach((badge) => holder.append(makeText("span", "badge", badge)));
}

function switchTab(tab) {
  if ((tab === "ranking" || tab === "admin") && !canManageMatches()) {
    toast("Esta vista requiere rol admin.");
    tab = "predict";
  }

  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
  const panelId = tab === "admin" ? "adminTabPanel" : `${tab}Tab`;
  $(panelId)?.classList.add("active");
  if (tab === "ranking") loadLeaderboard();
}

async function createMatch() {
  if (!canManageMatches()) {
    toast("Esta accion requiere rol admin.");
    return;
  }

  const payload = {
    home_team: $("adminHome").value.trim(),
    away_team: $("adminAway").value.trim(),
    kickoff_at: $("adminKickoff").value ? new Date($("adminKickoff").value).toISOString() : null,
    stage: $("adminStage").value.trim() || "Mundial",
  };

  if (!payload.home_team || !payload.away_team || !payload.kickoff_at) {
    toast("Faltan equipos o fecha");
    return;
  }

  const { error } = await sb.from("predictor_matches").insert(payload);
  if (error) {
    toast(error.message);
    return;
  }

  toast("Partido creado");
  await loadGame();
}

function toDatetimeLocalValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function adminMatchCell(match, field) {
  const value = match[field] ?? "";
  const inputClass = "db-table-input hr-input";

  if (field === "status") {
    const select = document.createElement("select");
    select.className = inputClass;
    select.dataset.matchField = field;
    ["open", "locked", "final"].forEach((status) => {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = status;
      option.selected = value === status;
      select.append(option);
    });
    return select;
  }

  const input = document.createElement("input");
  input.className = inputClass;
  input.dataset.matchField = field;
  input.value = field === "kickoff_at" ? toDatetimeLocalValue(value) : value;

  if (field === "kickoff_at") {
    input.type = "datetime-local";
  } else if (field === "home_score" || field === "away_score") {
    input.type = "number";
    input.min = "0";
    input.placeholder = "-";
  } else {
    input.type = "text";
  }

  return input;
}

function renderAdminMatchesTable() {
  const shell = $("adminMatchesTable");
  if (!shell) return;
  shell.replaceChildren();

  if (!canManageMatches()) return;

  const columns = [
    ["home_team", "Local"],
    ["away_team", "Visitante"],
    ["stage", "Fase"],
    ["kickoff_at", "Fecha"],
    ["status", "Estado"],
    ["home_score", "GL"],
    ["away_score", "GV"],
  ];


  if (!state.matches.length) {
    shell.append(makeText("p", "sub", "Sin partidos registrados."));
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "hr-table-wrap admin-matches-table-wrap";

  const table = document.createElement("table");
  table.className = "db-table hr-table hr-table-editable predictor-admin-table";
  table.setAttribute("aria-label", "Editor de partidos Kien Gana");

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  columns.forEach(([, label]) => headRow.append(makeText("th", "", label)));
  headRow.append(makeText("th", "", "Acciones"));
  thead.append(headRow);

  const tbody = document.createElement("tbody");
  state.matches.forEach((match) => {
    const row = document.createElement("tr");
    row.dataset.matchId = match.id;

    columns.forEach(([field]) => {
      const cell = document.createElement("td");
      cell.className = "db-table-cell--editable hr-cell-editable";
      cell.append(adminMatchCell(match, field));
      row.append(cell);
    });

    const actions = document.createElement("td");
    actions.className = "db-table-cell--actions predictor-admin-actions";

    const save = document.createElement("button");
    save.className = "hr-btn";
    save.type = "button";
    save.dataset.action = "admin-match-save";
    save.textContent = "Guardar";

    const remove = document.createElement("button");
    remove.className = "hr-btn hr-btn--ghost";
    remove.type = "button";
    remove.dataset.action = "admin-match-delete";
    remove.textContent = "Eliminar";

    actions.append(save, remove);
    row.append(actions);
    tbody.append(row);
  });

  table.append(thead, tbody);
  wrap.append(table);
  shell.append(wrap);
}

function adminMatchPayloadFromRow(row) {
  const payload = {};
  row.querySelectorAll("[data-match-field]").forEach((input) => {
    const field = input.dataset.matchField;
    const raw = input.value.trim();

    if (field === "kickoff_at") {
      payload[field] = raw ? new Date(raw).toISOString() : null;
      return;
    }

    if (field === "home_score" || field === "away_score") {
      payload[field] = raw === "" ? null : Number(raw);
      return;
    }

    payload[field] = raw || null;
  });

  return payload;
}

function validateAdminMatchPayload(payload) {
  if (!payload.home_team || !payload.away_team || !payload.kickoff_at) {
    toast("Local, visitante y fecha son obligatorios.");
    return false;
  }

  if (!["open", "locked", "final"].includes(payload.status)) {
    toast("Estado invalido.");
    return false;
  }

  const scores = [payload.home_score, payload.away_score];
  if (scores.some((score) => score !== null && (!Number.isInteger(score) || score < 0))) {
    toast("Marcadores invalidos.");
    return false;
  }

  return true;
}

async function handleAdminMatchesTableClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button || !$("adminMatchesTable")?.contains(button)) return;

  const row = button.closest("tr[data-match-id]");
  const matchId = row?.dataset.matchId;
  if (!row || !matchId || !canManageMatches()) {
    toast("Esta accion requiere rol admin.");
    return;
  }

  if (button.dataset.action === "admin-match-save") {
    const payload = adminMatchPayloadFromRow(row);
    if (!validateAdminMatchPayload(payload)) return;

    const { error } = await sb.from("predictor_matches").update(payload).eq("id", matchId);
    if (error) {
      toast(error.message);
      return;
    }

    toast("Partido actualizado");
    await loadGame();
  }

  if (button.dataset.action === "admin-match-delete") {
    const confirmed = window.confirm("Eliminar este partido tambien elimina sus predicciones. ¿Continuar?");
    if (!confirmed) return;

    const { error } = await sb.from("predictor_matches").delete().eq("id", matchId);
    if (error) {
      toast(error.message);
      return;
    }

    toast("Partido eliminado");
    await loadGame();
  }
}

async function saveAllAdminMatches() {
  if (!canManageMatches()) {
    toast("Esta accion requiere rol admin.");
    return;
  }

  const rows = Array.from(document.querySelectorAll("#adminMatchesTable tr[data-match-id]"));
  if (!rows.length) {
    toast("No hay partidos para guardar.");
    return;
  }

  let saved = 0;
  for (const row of rows) {
    const payload = adminMatchPayloadFromRow(row);
    if (!validateAdminMatchPayload(payload)) return;

    const { error } = await sb.from("predictor_matches").update(payload).eq("id", row.dataset.matchId);
    if (error) {
      toast(error.message);
      return;
    }
    saved += 1;

    const matchIndex = state.matches.findIndex((match) => match.id === row.dataset.matchId);
    if (matchIndex >= 0) {
      state.matches[matchIndex] = { ...state.matches[matchIndex], ...payload };
    }
  }

  renderAdminSelect();
  renderMatches();
  toast(`${saved} partido${saved === 1 ? "" : "s"} guardado${saved === 1 ? "" : "s"}.`);
}

function predictionMatchLabel(prediction) {
  const match = Array.isArray(prediction.predictor_matches)
    ? prediction.predictor_matches[0]
    : prediction.predictor_matches;
  if (!match) return prediction.match_id;
  return `${match.home_team} vs ${match.away_team}`;
}

function renderAdminPredictionsTable() {
  const shell = $("adminPredictionsTable");
  if (!shell) return;
  shell.replaceChildren();

  if (!canManageMatches()) return;

  if (!state.adminPredictions.length) {
    shell.append(makeText("p", "sub", "Sin predicciones registradas."));
    return;
  }

  const columns = [
    ["match", "Partido"],
    ["score", "Marcador"],
    ["user_id", "Usuario"],
    ["predicted_winner", "Ganador"],
    ["points_awarded", "Pts"],
    ["coins_awarded", "Coins"],
    ["created_at", "Creada"],
  ];

  const wrap = document.createElement("div");
  wrap.className = "hr-table-wrap admin-matches-table-wrap";

  const table = document.createElement("table");
  table.className = "db-table hr-table predictor-admin-table predictor-readonly-table";
  table.setAttribute("aria-label", "Predicciones Kien Gana");

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  columns.forEach(([, label]) => headRow.append(makeText("th", "", label)));
  thead.append(headRow);

  const tbody = document.createElement("tbody");
  state.adminPredictions.forEach((prediction) => {
    const row = document.createElement("tr");
    const values = {
      match: predictionMatchLabel(prediction),
      user_id: prediction.user_id,
      predicted_winner: prediction.predicted_winner,
      score: `${prediction.home_score}-${prediction.away_score}`,
      points_awarded: prediction.points_awarded ?? 0,
      coins_awarded: prediction.coins_awarded ?? 0,
      created_at: formatDate(prediction.created_at),
    };

    columns.forEach(([field]) => {
      const cell = document.createElement("td");
      cell.textContent = values[field] ?? "";
      row.append(cell);
    });

    tbody.append(row);
  });

  table.append(thead, tbody);
  wrap.append(table);
  shell.append(wrap);
}

function renderAdminSelect() {
  const select = $("adminMatchSelect");
  select.replaceChildren();

  state.matches.forEach((match) => {
    const option = document.createElement("option");
    option.value = match.id;
    option.textContent = `${match.home_team} vs ${match.away_team} / ${match.status}`;
    select.appendChild(option);
  });
}

async function finalizeMatch() {
  if (!canManageMatches()) {
    toast("Esta accion requiere rol admin.");
    return;
  }

  const matchId = $("adminMatchSelect").value;
  const homeScore = Number($("adminHomeScore").value);
  const awayScore = Number($("adminAwayScore").value);

  if (!matchId || !Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0) {
    toast("Resultado invalido");
    return;
  }

  const { error } = await sb.rpc("finalize_predictor_match", {
    p_match_id: matchId,
    p_home_score: homeScore,
    p_away_score: awayScore,
  });

  if (error) {
    toast(error.message);
    return;
  }

  toast("Resultado guardado y predicciones puntuadas");
  await loadGame();
}

boot();
