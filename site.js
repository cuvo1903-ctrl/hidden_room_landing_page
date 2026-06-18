const SITE_STATUS = "BETA Sitio en contrucción";
const SITE_VERSION = "V. 0.7.0";
const GA_MEASUREMENT_ID = "G-VNHC1Z3FXZ";
const ECOSYSTEM_LINKS = [
  ["events", "/#events", "Eventos"],
  ["studio", "/#studio", "Estudios"],
  ["demonz", "/#demonz", "dem00nz"],
  ["media", "/media/", "Media"],
  ["store", "/store/", "Tienda"],
  ["games", "/minijuegos/", "Minijuegos"],
  ["portal", "/portal/", "Portal"],
];

function initAnalytics() {
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag(){ window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', GA_MEASUREMENT_ID);
}

function cleanIndexURL() {
  const { pathname, search, hash } = window.location;
  if (!pathname.endsWith('/index.html')) return;

  const cleanPath = pathname.slice(0, -'index.html'.length);
  window.history.replaceState(null, '', `${cleanPath}${search}${hash}`);
}

function hydrateCanonicalMeta() {
  const cleanURL = new URL(window.location.href);
  if (cleanURL.pathname.endsWith('/index.html')) {
    cleanURL.pathname = cleanURL.pathname.slice(0, -'index.html'.length);
  }

  document.querySelectorAll('meta[property="og:url"]').forEach((meta) => {
    meta.setAttribute('content', cleanURL.href);
  });
}

cleanIndexURL();
hydrateCanonicalMeta();
initAnalytics();

function initGlobalChrome() {
  const body = document.body;
  if (!body?.hasAttribute("data-hr-chrome")) return;

  const context = body.dataset.hrContext || "";
  const accent = body.dataset.hrAccent || (context === "media" ? "media" : "brand");

  if (!body.querySelector(":scope > .hr-site-nav")) {
    const nav = document.createElement("nav");
    nav.className = "hr-site-nav";
    nav.dataset.accent = accent;
    nav.setAttribute("aria-label", "Navegación del ecosistema Hidden Room");
    nav.innerHTML = `
      <div class="hr-site-nav__inner">
        <a class="hr-site-nav__home" href="/">Hidden Room / La Casa del Under</a>
        <div class="hr-site-nav__links">
          ${ECOSYSTEM_LINKS.map(([key, href, label]) => `
            <a href="${href}"${key === context ? ' aria-current="page"' : ""}>${label}</a>
          `).join("")}
        </div>
      </div>
    `;
    body.prepend(nav);
  }

  if (body.dataset.hrFooter !== "false" && !body.querySelector(":scope > .hr-site-footer")) {
    const footer = document.createElement("footer");
    footer.className = "hr-site-footer";
    footer.innerHTML = `
      <a href="/" aria-label="Hidden Room">
        <img class="hr-site-footer__logo" src="/assets/img/white_logo.webp" alt="Hidden Room">
      </a>
      <div class="hr-site-footer__meta">
        <span>Una marca de Grupo Mysauth</span>
        <span class="site-status"></span>
        <a href="/changelog.html" class="site-version"></a>
      </div>
      <div class="hr-site-footer__tagline">La Casa del Under</div>
    `;
    body.append(footer);
  }
}

initGlobalChrome();

document.querySelectorAll(".site-status").forEach(el => {
  el.textContent = SITE_STATUS;
});

document.querySelectorAll(".site-version").forEach(el => {
  el.textContent = SITE_VERSION;
});


/* =========================================================
   GLOBAL CUSTOM CURSOR
========================================================= */

const cursor = document.getElementById("cursor");
const ring = document.getElementById("cursorRing");

if (cursor && ring) {

  let mx = 0;
  let my = 0;
  let rx = 0;
  let ry = 0;

  document.addEventListener("mousemove", (e) => {
    mx = e.clientX;
    my = e.clientY;

    cursor.style.transform =
      `translate(${mx - 5}px, ${my - 5}px)`;
  });

  function animRing() {

    rx += (mx - rx) * 0.12;
    ry += (my - ry) * 0.12;

    ring.style.transform =
      `translate(${rx - 18}px, ${ry - 18}px)`;

    requestAnimationFrame(animRing);
  }

  animRing();

  function isCursorTarget(target) {
    return target?.closest?.('a, button, input, [role="button"], .event-row');
  }

  document.addEventListener('mouseenter', (event) => {
    if (isCursorTarget(event.target)) {
      ring.style.borderColor = 'rgba(219,1,0,0.8)';
      ring.style.scale = "1.5";
    }
  }, true);

  document.addEventListener('mouseleave', (event) => {
    if (isCursorTarget(event.target)) {
      ring.style.borderColor = 'rgba(219,1,0,0.5)';
      ring.style.scale = "1";
    }
  }, true);

}


/* =========================================================
   SCROLL REVEAL
========================================================= */

const revealElements = document.querySelectorAll('.reveal');

if (revealElements.length > 0) {

  const observer = new IntersectionObserver(entries => {

    entries.forEach(entry => {

      if (entry.isIntersecting) {

        setTimeout(() => {
          entry.target.classList.add('visible');
        }, 80);

        observer.unobserve(entry.target);
      }

    });

  }, {
    threshold: 0.1,
    rootMargin: '0px 0px -60px 0px'
  });

  revealElements.forEach(el => observer.observe(el));
}


/* =========================================================
   EVENT ROW STAGGER
========================================================= */

document.querySelectorAll('.event-row').forEach((row, i) => {
  row.style.transitionDelay = `${i * 60}ms`;
});


/* =========================================================
   GALLERY SLIDER
========================================================= */

const track = document.getElementById('galleryTrack');

if (track) {

  let galleryIndex = 0;
  const total = track.children.length;

  window.slideGallery = function(dir) {

    galleryIndex =
      (galleryIndex + dir + total) % total;

    track.style.transform =
      `translateX(-${galleryIndex * 100}%)`;
  };

  document.querySelectorAll('[data-gallery-dir]').forEach((button) => {
    button.addEventListener('click', () => {
      window.slideGallery(Number(button.dataset.galleryDir || 0));
    });
  });

}
