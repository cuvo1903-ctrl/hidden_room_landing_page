import {
  escapeHTML,
  formatDate,
  postURL,
  revealMediaAdminLink,
  sanitizeContent,
  setMeta,
  supabase,
} from "./config.js";

const slug = new URLSearchParams(window.location.search).get("slug")?.trim();
const article = document.getElementById("post-article");
const status = document.getElementById("post-status");

function relatedCard(post) {
  return `
    <article class="media-card hr-media-card hr-hover-lift">
      <a class="media-card__image" href="${postURL(post.slug)}">
        ${post.cover_image
          ? `<img src="${escapeHTML(post.cover_image)}" alt="" loading="lazy">`
          : `<div class="media-card__placeholder" aria-hidden="true">HR</div>`}
      </a>
      <div class="media-card__body hr-card-body hr-stack">
        <div class="media-card__meta hr-cluster"><span>${escapeHTML(post.category)}</span><time>${formatDate(post.published_at)}</time></div>
        <h3><a href="${postURL(post.slug)}">${escapeHTML(post.title)}</a></h3>
        <p>${escapeHTML(post.excerpt || "")}</p>
      </div>
    </article>
  `;
}

function updateSEO(post) {
  const canonical = `https://hiddenroom.mx${postURL(post.slug)}`;
  const image = post.cover_image || "https://hiddenroom.mx/assets/img/social_preview.webp";
  document.title = `${post.title} — Hidden Room Media`;
  setMeta('meta[name="description"]', post.excerpt || post.title);
  setMeta('meta[property="og:title"]', post.title);
  setMeta('meta[property="og:description"]', post.excerpt || post.title);
  setMeta('meta[property="og:image"]', image);
  setMeta('meta[property="og:url"]', canonical);
  setMeta('link[rel="canonical"]', canonical, "href");
  document.getElementById("article-jsonld").textContent = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt || "",
    image: image ? [image] : [],
    datePublished: post.published_at,
    dateModified: post.updated_at,
    author: { "@type": "Person", name: post.author_name || "Hidden Room Media" },
    publisher: {
      "@type": "Organization",
      name: "Hidden Room",
      logo: { "@type": "ImageObject", url: "https://hiddenroom.mx/assets/img/white_logo.webp" },
    },
    mainEntityOfPage: canonical,
  });
}

function setupShare(post) {
  const url = `https://hiddenroom.mx${postURL(post.slug)}`;
  const text = `${post.title} — Hidden Room Media`;
  document.getElementById("share-x").href = `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  document.getElementById("share-facebook").href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
  document.getElementById("share-whatsapp").href = `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
  document.getElementById("share-copy").addEventListener("click", async (event) => {
    await navigator.clipboard.writeText(url);
    event.currentTarget.textContent = "Copiado";
  });
}

async function loadRelated(post) {
  const { data } = await supabase
    .from("media_posts")
    .select("slug,title,excerpt,cover_image,category,published_at")
    .eq("status", "published")
    .eq("category", post.category)
    .neq("id", post.id)
    .lte("published_at", new Date().toISOString())
    .order("published_at", { ascending: false })
    .limit(3);

  if (!data?.length) return;
  document.getElementById("related-grid").innerHTML = data.map(relatedCard).join("");
  document.getElementById("related-section").hidden = false;
}

async function init() {
  if (!slug) {
    status.textContent = "Artículo no encontrado.";
    return;
  }

  const { data: post, error } = await supabase
    .from("media_posts")
    .select("*")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();

  if (error || !post) {
    console.error("[Media] post:", error);
    status.innerHTML = `No encontramos este artículo. <a href="/media/">Volver al archivo</a>.`;
    return;
  }

  updateSEO(post);
  document.getElementById("post-category").textContent = post.category;
  document.getElementById("post-category").href = `/media/?category=${encodeURIComponent(post.category)}`;
  document.getElementById("post-title").textContent = post.title;
  document.getElementById("post-excerpt").textContent = post.excerpt || "";
  document.getElementById("post-author").textContent = post.author_name || "Hidden Room Media";
  document.getElementById("post-date").textContent = formatDate(post.published_at);
  document.getElementById("post-date").dateTime = post.published_at || "";
  document.getElementById("post-views").textContent = `${post.views || 0} lecturas`;
  document.getElementById("post-content").innerHTML = sanitizeContent(post.content);
  document.getElementById("post-tags").innerHTML = (post.tags || [])
    .map((tag) => `<span class="hr-chip">#${escapeHTML(tag)}</span>`)
    .join("");

  if (post.cover_image) {
    document.getElementById("post-cover").src = post.cover_image;
    document.getElementById("post-cover").alt = post.title;
    document.getElementById("post-cover-wrap").hidden = false;
  }

  setupShare(post);
  status.hidden = true;
  article.hidden = false;
  supabase.rpc("increment_media_post_views", { post_slug: post.slug });
  loadRelated(post);
}

init();
revealMediaAdminLink();
