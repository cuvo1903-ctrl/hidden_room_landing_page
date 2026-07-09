import Graph from "https://esm.sh/graphology@0.26.0";
import louvain from "https://esm.sh/graphology-communities-louvain@2.0.2";

/* global cytoscape */
(async () => {
  "use strict";


  const els = {
    fileInput: document.querySelector("#fileInput"),
    dropzone: document.querySelector("#dropzone"),
    datasetName: document.querySelector("#datasetName"),
    ignored: document.querySelector("#ignoredHandles"),
    topN: document.querySelector("#topN"),
    minWeight: document.querySelector("#minWeight"),
    minComments: document.querySelector("#minComments"),
    ambassadorsOnly: document.querySelector("#ambassadorsOnly"),
    communityLabels: document.querySelector("#communityLabels"),
    tooltip: document.querySelector("#tooltip"),
    emptyState: document.querySelector("#emptyState"),
    toast: document.querySelector("#toast"),
    userSearch: document.querySelector("#userSearch"),
    userSearchResults: document.querySelector("#userSearchResults"),
    clearUserFocus: document.querySelector("#clearUserFocus")
  };

  let rawMarkdown = "";
  let model = null;
  let cy = null;
  let toastTimer = null;
  let pendingAuthorFocus = "";

  const normalise = value => {
    const clean = String(value || "").trim().toLowerCase();
    return clean ? `@${clean.replace(/^@/, "")}` : "";
  };

  function rolesIncludeAdmin(rawRoles) {
    return String(rawRoles || "").split(",").map(role => role.trim().toLowerCase()).includes("admin");
  }

  async function requireAdminAccess() {
    try {
      const supabase = await window.HiddenRoomSupabase.getClient();
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        localStorage.setItem("hr_return_after_login", "/mysauth_orbit/");
        window.location.replace("/portal/");
        return false;
      }
      const { data: profile, error: profileError } = await supabase
        .from("users")
        .select("roles")
        .eq("id", user.id)
        .maybeSingle();
      if (profileError || !rolesIncludeAdmin(profile?.roles)) {
        window.location.replace("/portal/dashboard.html");
        return false;
      }
      document.body.classList.remove("orbit-auth-pending");
      return true;
    } catch (error) {
      console.error("[ORBIT] No fue posible verificar el acceso admin:", error);
      window.location.replace("/portal/");
      return false;
    }
  }

  function getIgnoredHandles() {
    return new Set(els.ignored.value.split(/[\s,;]+/).map(normalise).filter(Boolean));
  }

  function parseMarkdown(markdown, ignored = new Set()) {
    const comments = [];
    const blockPattern = /^###\s+(@[\w.\-_]+)\s*$([\s\S]*?)(?=^---\s*$|^###\s+@|(?![\s\S]))/gmi;
    let match;
    while ((match = blockPattern.exec(markdown)) !== null) {
      const author = normalise(match[1]);
      const quoteLines = match[2].split(/\r?\n/).filter(line => /^\s*>/.test(line));
      const text = quoteLines.map(line => line.replace(/^\s*>\s?/, "")).join(" ");
      const mentions = (text.match(/@[\w.\-_]+/g) || [])
        .map(normalise)
        .filter(handle => handle !== author && !ignored.has(handle));
      if (mentions.length) comments.push({ author, text, mentions });
    }
    return comments;
  }

  function rankWithTies(items, key, outputKey) {
    const sorted = [...items].sort((a, b) => b[key] - a[key] || a.handle.localeCompare(b.handle));
    let previous = null;
    let rank = 0;
    sorted.forEach((item, index) => {
      if (item[key] !== previous) rank = index + 1;
      item[outputKey] = rank;
      previous = item[key];
    });
  }

  function buildModel(comments) {
    const artistsMap = new Map();
    const authorsMap = new Map();
    const edgesMap = new Map();

    comments.forEach(comment => {
      if (!authorsMap.has(comment.author)) {
        authorsMap.set(comment.author, {
          handle: comment.author, comment_count: 0, total_mentions_made: 0, artistSet: new Set()
        });
      }
      const author = authorsMap.get(comment.author);
      author.comment_count += 1;
      author.total_mentions_made += comment.mentions.length;

      comment.mentions.forEach(handle => {
        author.artistSet.add(handle);
        if (!artistsMap.has(handle)) {
          artistsMap.set(handle, { handle, total_mentions: 0, authorSet: new Set() });
        }
        const artist = artistsMap.get(handle);
        artist.total_mentions += 1;
        artist.authorSet.add(comment.author);

        const edgeKey = `${comment.author}->${handle}`;
        if (!edgesMap.has(edgeKey)) {
          edgesMap.set(edgeKey, { author: comment.author, artist: handle, weight: 0 });
        }
        edgesMap.get(edgeKey).weight += 1;
      });
    });

    const artists = [...artistsMap.values()].map(item => ({
      handle: item.handle,
      total_mentions: item.total_mentions,
      unique_authors: item.authorSet.size
    }));
    rankWithTies(artists, "total_mentions", "rank_total_mentions");
    rankWithTies(artists, "unique_authors", "rank_unique_authors");
    artists.forEach(item => {
      item.combined_score = Number((100 / ((item.rank_total_mentions + item.rank_unique_authors) / 2)).toFixed(2));
    });
    artists.sort((a, b) => b.combined_score - a.combined_score || b.total_mentions - a.total_mentions);
    artists.forEach((item, index) => { item.combined_rank = index + 1; });

    const authors = [...authorsMap.values()].map(item => ({
      handle: item.handle,
      comment_count: item.comment_count,
      artists_supported: item.artistSet.size,
      total_mentions_made: item.total_mentions_made,
      ambassador_score: item.artistSet.size * 10 + item.total_mentions_made
    })).sort((a, b) => b.ambassador_score - a.ambassador_score || a.handle.localeCompare(b.handle));

    const edges = [...edgesMap.values()].sort((a, b) => b.weight - a.weight || a.author.localeCompare(b.author));
    return { comments, artists, authors, edges };
  }

  function graphElements() {
    const topArtists = new Set(model.artists.slice(0, Number(els.topN.value)).map(item => item.handle));
    const minWeight = Number(els.minWeight.value);
    const minComments = Number(els.minComments.value);
    const authorByHandle = new Map(model.authors.map(item => [item.handle, item]));
    const artistByHandle = new Map(model.artists.map(item => [item.handle, item]));
    const visibleEdges = model.edges.filter(edge => {
      const author = authorByHandle.get(edge.author);
      return topArtists.has(edge.artist) && edge.weight >= minWeight &&
        author.comment_count >= minComments &&
        (!els.ambassadorsOnly.checked || author.artists_supported >= 3);
    });
    const visibleAuthors = new Set(visibleEdges.map(edge => edge.author));
    const connectedArtists = new Set(visibleEdges.map(edge => edge.artist));
    const elements = [];
    const graph = new Graph({ type: "undirected" });

    connectedArtists.forEach(handle => graph.addNode(`artist:${handle}`));
    visibleAuthors.forEach(handle => graph.addNode(`author:${handle}`));
    visibleEdges.forEach((edge, index) => {
      graph.addEdgeWithKey(`edge:${index}`, `author:${edge.author}`, `artist:${edge.artist}`, { weight: edge.weight });
    });

    const partition = graph.order
      ? louvain(graph, { getEdgeWeight: "weight", resolution: 1.15, randomWalk: false })
      : {};
    const communities = [...new Set(Object.values(partition))].sort((a, b) => a - b);
    const communityIndex = new Map(communities.map((community, index) => [community, index + 1]));
    const artistCommunity = new Map([...connectedArtists].map(handle => [handle, partition[`artist:${handle}`]]));
    const authorScenes = new Map();

    visibleAuthors.forEach(handle => {
      const scenes = new Set(visibleEdges
        .filter(edge => edge.author === handle)
        .map(edge => artistCommunity.get(edge.artist))
        .filter(scene => scene !== undefined));
      authorScenes.set(handle, scenes);
    });

    communities.forEach(community => {
      elements.push({
        group: "nodes",
        data: { id: `scene:${community}`, type: "scene", label: `ESCENA ${String(communityIndex.get(community)).padStart(2, "0")}` },
        classes: "scene"
      });
    });

    connectedArtists.forEach(handle => {
      const artist = artistByHandle.get(handle);
      const community = partition[`artist:${handle}`];
      elements.push({
        group: "nodes",
        data: {
          id: `artist:${handle}`, type: "artist", label: handle, parent: `scene:${community}`,
          community: communityIndex.get(community), total_mentions: artist.total_mentions,
          unique_authors: artist.unique_authors, rank: artist.combined_rank, combined_score: artist.combined_score,
          size: Math.min(96, 30 + Math.sqrt(artist.unique_authors) * 12),
          color: artist.combined_rank <= 3 ? "#ff3832" : artist.combined_rank <= 10 ? "#ed6a32" : "#8d211f"
        },
        classes: "artist"
      });
    });

    visibleAuthors.forEach(handle => {
      const author = authorByHandle.get(handle);
      const ambassador = author.artists_supported >= 3;
      const bridge = authorScenes.get(handle).size >= 2;
      const community = partition[`author:${handle}`];
      elements.push({
        group: "nodes",
        data: {
          id: `author:${handle}`, type: "author", label: handle, parent: `scene:${community}`,
          community: communityIndex.get(community), comment_count: author.comment_count,
          artists_supported: author.artists_supported, total_mentions_made: author.total_mentions_made,
          ambassador_score: author.ambassador_score, is_bridge: bridge, connected_scenes: authorScenes.get(handle).size,
          size: Math.min(36, 12 + Math.sqrt(author.ambassador_score) * 2),
          color: bridge ? "#42e879" : ambassador ? "#38bdf8" : "#326ee8"
        },
        classes: ["author", ambassador ? "ambassador" : "", bridge ? "bridge" : ""].filter(Boolean).join(" ")
      });
    });

    visibleEdges.forEach((edge, index) => {
      elements.push({
        group: "edges",
        data: {
          id: `edge:${index}`, source: `author:${edge.author}`, target: `artist:${edge.artist}`,
          author: edge.author, artist: edge.artist, weight: edge.weight,
          width: Math.min(14, .8 + Math.sqrt(edge.weight) * 3),
          opacity: Math.min(.92, .18 + Math.log2(edge.weight + 1) * .2)
        },
        classes: authorScenes.get(edge.author).size >= 2 ? "bridge-edge" : ""
      });
    });
    return elements;
  }

  const layoutOptions = () => ({
    name: typeof cytoscape("layout", "cose-bilkent") === "function" ? "cose-bilkent" : "cose",
    animate: "end",
    animationDuration: 650,
    fit: true,
    padding: 36,
    randomize: true,
    idealEdgeLength: 82,
    nodeRepulsion: 5200,
    edgeElasticity: .32,
    nestingFactor: .55,
    gravity: .24,
    gravityCompound: 1.25,
    gravityRangeCompound: 1.25,
    tilingPaddingVertical: 20,
    tilingPaddingHorizontal: 20,
    numIter: 2400
  });

  function initGraph() {
    if (cy) cy.destroy();
    cy = cytoscape({
      container: document.querySelector("#cy"),
      elements: graphElements(),
      minZoom: .18,
      maxZoom: 3,

      boxSelectionEnabled: false,
      style: [
        {
          selector: "node",
          style: {
            width: "data(size)", height: "data(size)", "background-color": "data(color)",
            "border-width": 1, "border-color": "rgba(255,255,255,.45)",
            label: "data(label)", color: "#f2efe8", "font-family": "DM Mono, monospace",
            "font-size": 8, "text-outline-color": "#07080c", "text-outline-width": 2
          }
        },
        {
          selector: "node.scene",
          style: {
            "background-color": "#151820", "background-opacity": .22, "border-width": 1,
            "border-color": "#495064", "border-opacity": .5, "border-style": "dashed",
            padding: 24, shape: "roundrectangle", label: "data(label)",
            color: "#717786", "font-size": 8, "text-valign": "top", "text-margin-y": -12
          }
        },
        {
          selector: "node.artist",
          style: { "font-size": 10, "font-weight": 500, "text-valign": "bottom", "text-margin-y": 8, "border-width": 2 }
        },
        {
          selector: "node.author",
          style: { label: els.communityLabels.checked ? "data(label)" : "", "text-valign": "bottom", "text-margin-y": 5 }
        },
        {
          selector: "node.ambassador",
          style: { "border-width": 4, "border-color": "#b8ebff", "border-opacity": .95, "background-blacken": -.12 }
        },
        {
          selector: "node.bridge",
          style: {
            "border-width": 4, "border-color": "#c5ffd7", "border-opacity": 1,
            "underlay-color": "#42e879", "underlay-opacity": .22, "underlay-padding": 10
          }
        },
        {
          selector: "edge",
          style: {
            width: "data(width)", opacity: "data(opacity)", "line-color": "#73839f",
            "curve-style": "bezier", "target-arrow-shape": "none"
          }
        },
        { selector: "edge.bridge-edge", style: { "line-color": "#42e879" } },
        { selector: ".search-dim", style: { opacity: .07, "text-opacity": 0 } },
        { selector: "edge.search-focus", style: { opacity: .95, "line-color": "#f2efe8" } },
        { selector: "node.search-focus", style: { "underlay-color": "#f2efe8", "underlay-opacity": .14, "underlay-padding": 8 } },
        { selector: "node.search-origin", style: { "border-width": 5, "border-color": "#42e879", "underlay-color": "#42e879", "underlay-opacity": .35, "underlay-padding": 14 } },
        { selector: "node:selected", style: { "overlay-color": "#ff3832", "overlay-opacity": .18, "overlay-padding": 8 } }
      ],
      layout: layoutOptions()
    });
    bindGraphEvents();
    if (pendingAuthorFocus) {
      const handle = pendingAuthorFocus;
      pendingAuthorFocus = "";
      let focused = false;
      const focusAfterLayout = () => {
        if (focused) return;
        focused = true;
        applyAuthorFocus(handle);
      };
      cy.one("layoutstop", focusAfterLayout);
      window.setTimeout(focusAfterLayout, 1400);
    }
    const hasElements = cy.nodes(".artist, .author").length > 0;
    els.emptyState.hidden = hasElements;
    document.querySelector("#graphStatus").textContent = hasElements
      ? `${cy.nodes(".scene").length} escenas / ${cy.nodes(".artist").length} artistas / ${cy.edges().length} conexiones`
      : "Sin datos visibles";
  }

  function bindGraphEvents() {
    cy.on("mouseover", "node, edge", event => {
      const data = event.target.data();
      if (data.type === "artist") {
        showTooltip(`<strong>${escapeHtml(data.label)}</strong><dl><dt>Menciones totales</dt><dd>${data.total_mentions}</dd><dt>Usuarios únicos</dt><dd>${data.unique_authors}</dd><dt>Ranking combinado</dt><dd>#${data.rank}</dd><dt>Score</dt><dd>${data.combined_score}</dd></dl>`, event.originalEvent);
      } else if (data.type === "scene") {
        showTooltip(`<strong>${escapeHtml(data.label)}</strong><dl><dt>Comunidad Louvain</dt><dd>${data.label.replace("ESCENA ", "#")}</dd></dl>`, event.originalEvent);
      } else if (data.type === "author") {
        showTooltip(`<strong>${escapeHtml(data.label)}</strong><dl><dt>Comentarios</dt><dd>${data.comment_count}</dd><dt>Artistas apoyados</dt><dd>${data.artists_supported}</dd><dt>Menciones hechas</dt><dd>${data.total_mentions_made}</dd><dt>Ambassador score</dt><dd>${data.ambassador_score}</dd><dt>Escenas conectadas</dt><dd>${data.connected_scenes}</dd><dt>Puente</dt><dd>${data.is_bridge ? "Sí" : "No"}</dd></dl>`, event.originalEvent);
      } else {
        showTooltip(`<strong>Conexión</strong><dl><dt>Autor</dt><dd>${escapeHtml(data.author)}</dd><dt>Artista</dt><dd>${escapeHtml(data.artist)}</dd><dt>Menciones</dt><dd>${data.weight}</dd></dl>`, event.originalEvent);
      }
    });
    cy.on("mousemove", "node, edge", event => positionTooltip(event.originalEvent));
    cy.on("mouseout", "node, edge", hideTooltip);
  }

  function showTooltip(html, event) {
    els.tooltip.innerHTML = html;
    els.tooltip.hidden = false;
    positionTooltip(event);
  }
  function positionTooltip(event) {
    if (!event) return;
    const x = Math.min(window.innerWidth - 260, event.clientX + 14);
    const y = Math.min(window.innerHeight - 150, event.clientY + 14);
    els.tooltip.style.left = `${Math.max(8, x)}px`;
    els.tooltip.style.top = `${Math.max(8, y)}px`;
  }
  function hideTooltip() { els.tooltip.hidden = true; }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[char]);
  }

  function matchingAuthors(query) {
    if (!model) return [];
    const normalizedQuery = normalise(query);
    if (!normalizedQuery || normalizedQuery === "@") return [];
    return model.authors
      .filter(author => author.handle.includes(normalizedQuery))
      .slice(0, 8);
  }

  function renderUserSearchResults(query = els.userSearch.value) {
    const matches = matchingAuthors(query);
    els.userSearchResults.replaceChildren();
    if (!matches.length) {
      els.userSearchResults.hidden = true;
      return;
    }
    const fragment = document.createDocumentFragment();
    matches.forEach(author => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.userHandle = author.handle;
      const handle = document.createElement("strong");
      handle.textContent = author.handle;
      const detail = document.createElement("span");
      detail.textContent = `${author.artists_supported} artistas · ${author.total_mentions_made} menciones`;
      button.append(handle, detail);
      fragment.append(button);
    });
    els.userSearchResults.append(fragment);
    els.userSearchResults.hidden = false;
  }

  function applyAuthorFocus(handle) {
    if (!cy) return;
    const authorNode = cy.$id(`author:${handle}`);
    if (!authorNode.length) {
      notify(`${handle} no tiene conexiones visibles.`);
      return;
    }
    cy.elements().removeClass("search-dim search-focus search-origin");
    const neighborhood = authorNode.closedNeighborhood();
    cy.nodes(".artist, .author").difference(neighborhood.nodes()).addClass("search-dim");
    cy.edges().difference(neighborhood.edges()).addClass("search-dim");
    neighborhood.addClass("search-focus");
    authorNode.addClass("search-origin");
    cy.fit(neighborhood, 95);
    els.clearUserFocus.hidden = false;
    document.querySelector("#graphStatus").textContent = `${handle} · ${neighborhood.nodes(".artist").length} artistas conectados`;
  }

  function focusAuthor(handle) {
    if (!model?.authors.some(author => author.handle === handle)) {
      notify("Usuario no encontrado en el dataset.");
      return;
    }
    els.topN.max = Math.max(1, model.artists.length);
    els.topN.value = Math.max(1, model.artists.length);
    els.minWeight.value = 1;
    els.minComments.value = 1;
    els.ambassadorsOnly.checked = false;
    renderTopNValue();
    document.querySelector("#minWeightValue").textContent = "1";
    document.querySelector("#minCommentsValue").textContent = "1";
    els.userSearch.value = handle;
    els.userSearchResults.hidden = true;
    pendingAuthorFocus = handle;
    initGraph();
  }

  function clearAuthorFocus() {
    pendingAuthorFocus = "";
    if (cy) {
      cy.elements().removeClass("search-dim search-focus search-origin");
      cy.fit(cy.elements(), 36);
      document.querySelector("#graphStatus").textContent = `${cy.nodes(".scene").length} escenas / ${cy.nodes(".artist").length} artistas / ${cy.edges().length} conexiones`;
    }
    els.userSearch.value = "";
    els.userSearchResults.hidden = true;
    els.clearUserFocus.hidden = true;
  }

  function renderTables() {
    document.querySelector("#artistsTable").innerHTML = model.artists.slice(0, 20).map((item, index) =>
      `<tr><td><span class="rank">${String(index + 1).padStart(2, "0")}</span>${escapeHtml(item.handle)}</td><td>${item.total_mentions}</td><td>${item.unique_authors}</td><td>${item.combined_score}</td></tr>`
    ).join("") || `<tr><td colspan="4">Sin datos</td></tr>`;
    document.querySelector("#ambassadorsTable").innerHTML = model.authors.slice(0, 20).map((item, index) =>
      `<tr><td><span class="rank">${String(index + 1).padStart(2, "0")}</span>${escapeHtml(item.handle)}</td><td>${item.comment_count}</td><td>${item.artists_supported}</td><td>${item.ambassador_score}</td></tr>`
    ).join("") || `<tr><td colspan="4">Sin datos</td></tr>`;
    document.querySelector("#connectionsTable").innerHTML = model.edges.slice(0, 20).map((item, index) =>
      `<tr><td><span class="rank">${String(index + 1).padStart(2, "0")}</span>${escapeHtml(item.author)}</td><td>${escapeHtml(item.artist)}</td><td>${item.weight}</td></tr>`
    ).join("") || `<tr><td colspan="3">Sin datos</td></tr>`;
  }

  function renderStats() {
    document.querySelector("#statComments").textContent = model.comments.length;
    document.querySelector("#statArtists").textContent = model.artists.length;
    document.querySelector("#statAuthors").textContent = model.authors.length;
    document.querySelector("#statEdges").textContent = model.edges.length;
    els.topN.max = Math.max(1, model.artists.length);
    els.topN.value = Math.min(Number(els.topN.value), Math.max(1, model.artists.length));
    renderTopNValue();
  }

  function renderTopNValue() {
    const showingAll = model && model.artists.length > 0 && Number(els.topN.value) >= model.artists.length;
    document.querySelector("#topNValue").textContent = showingAll ? "Todos" : els.topN.value;
  }

  function processDataset({ relayout = true, resetTopN = false } = {}) {
    model = buildModel(parseMarkdown(rawMarkdown, getIgnoredHandles()));
    if (resetTopN) {
      const allArtists = Math.max(1, model.artists.length);
      els.topN.max = allArtists;
      els.topN.value = allArtists;
    }
    renderStats();
    renderTables();
    if (relayout) initGraph();
  }

  function updateGraph() {
    renderTopNValue();
    document.querySelector("#minWeightValue").textContent = els.minWeight.value;
    document.querySelector("#minCommentsValue").textContent = els.minComments.value;
    initGraph();
  }

  function notify(message) {
    window.clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("visible");
    toastTimer = window.setTimeout(() => els.toast.classList.remove("visible"), 2600);
  }

  function readMarkdownFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error(`No fue posible leer ${file.name}.`));
      reader.readAsText(file);
    });
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    const validFiles = files.filter(file =>
      file.name.toLowerCase().endsWith(".md") || file.type === "text/markdown" || file.type === "text/plain"
    );

    if (!validFiles.length) {
      notify("Selecciona uno o varios archivos Markdown (.md).");
      return;
    }

    try {
      const markdownFiles = await Promise.all(validFiles.map(readMarkdownFile));
      rawMarkdown = markdownFiles.join("\n\n---\n\n");
      els.datasetName.textContent = validFiles.length === 1 ? validFiles[0].name : `${validFiles.length} archivos .md`;
      processDataset({ resetTopN: true });
      const ignoredCount = files.length - validFiles.length;
      const ignoredText = ignoredCount ? ` · ${ignoredCount} archivo${ignoredCount === 1 ? "" : "s"} ignorado${ignoredCount === 1 ? "" : "s"}` : "";
      notify(`${model.comments.length} comentarios de ${validFiles.length} archivo${validFiles.length === 1 ? "" : "s"}${ignoredText}.`);
    } catch (error) {
      console.error(error);
      notify("No fue posible leer uno de los archivos.");
    } finally {
      els.fileInput.value = "";
    }
  }

  async function exportPng() {
    if (!cy || cy.nodes().length === 0) {
      notify("No hay un grafo visible para exportar.");
      return;
    }
    const graphDataUrl = cy.png({ output: "base64uri", full: true, scale: 3, bg: "#07080c", maxWidth: 7000, maxHeight: 7000 });
    const image = new Image();
    image.onload = () => {
      const padding = 80;
      const titleHeight = 120;
      const canvas = document.createElement("canvas");
      canvas.width = image.width + padding * 2;
      canvas.height = image.height + padding + titleHeight;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#07080c";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#f02c27";
      ctx.fillRect(padding, 52, 28, 4);
      ctx.fillStyle = "#f2efe8";
      ctx.font = "600 26px Arial, sans-serif";
      ctx.fillText("Mysauth ORBIT / Hidden Room Scene Graph", padding + 42, 64);
      ctx.fillStyle = "#858995";
      ctx.font = "16px monospace";
      ctx.fillText(`${model.comments.length} comentarios · ${cy.nodes(".artist").length} artistas · ${cy.nodes(".author").length} autores`, padding, 98);
      ctx.drawImage(image, padding, titleHeight);
      const link = document.createElement("a");
      link.download = "orbit-hidden-room-graph.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
      notify("PNG exportado en alta resolución.");
    };
    image.onerror = () => notify("No fue posible generar la imagen.");
    image.src = graphDataUrl;
  }

  if (!await requireAdminAccess()) return;

  els.userSearch.addEventListener("input", () => renderUserSearchResults());
  els.userSearch.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const exact = model?.authors.find(author => author.handle === normalise(els.userSearch.value));
    const selected = exact || matchingAuthors(els.userSearch.value)[0];
    if (selected) focusAuthor(selected.handle);
  });
  els.userSearchResults.addEventListener("click", event => {
    const button = event.target.closest("[data-user-handle]");
    if (button) focusAuthor(button.dataset.userHandle);
  });
  els.clearUserFocus.addEventListener("click", clearAuthorFocus);

  els.fileInput.addEventListener("change", event => handleFiles(event.target.files));
  ["dragenter", "dragover"].forEach(name => els.dropzone.addEventListener(name, event => {
    event.preventDefault();
    els.dropzone.classList.add("dragging");
  }));
  ["dragleave", "drop"].forEach(name => els.dropzone.addEventListener(name, event => {
    event.preventDefault();
    els.dropzone.classList.remove("dragging");
  }));
  els.dropzone.addEventListener("drop", event => handleFiles(event.dataTransfer.files));
  [els.topN, els.minWeight, els.minComments].forEach(input => input.addEventListener("input", updateGraph));
  [els.ambassadorsOnly, els.communityLabels].forEach(input => input.addEventListener("change", updateGraph));
  els.ignored.addEventListener("change", () => processDataset());
  document.querySelector("#recalculate").addEventListener("click", () => {
    if (cy && cy.nodes().length) cy.layout(layoutOptions()).run();
  });
  document.querySelector("#exportPng").addEventListener("click", exportPng);

  processDataset();
})();

