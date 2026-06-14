/* ================================================================
   dem00nz RUNNER — game engine (OPTIMIZED)
   ================================================================

   ARCHITECTURE OVERVIEW
   ─────────────────────
   CONFIG          — all tunable constants in one place
   ASSETS          — centralized asset refs (swap images here later)
   GameState       — single source of truth for runtime state
   Canvas / Resize — responsive scaling
   Background      — parallax layers (STREET_BACKGROUND)
   Player          — jump logic, draw (PLAYER_SPRITE)
   ObstaclePool    — pooled obstacle objects (DOG_OBSTACLE, POLICE_OBSTACLE, etc.)
   CollectiblePool — pooled collectible / coupon objects (COUPON_ITEM)
   Collision       — AABB helpers
   Difficulty      — speed / spawn curve
   Score           — tracking + best score (localStorage)
   Renderer        — master draw loop
   Input           — keyboard + touch
   GameLoop        — requestAnimationFrame driver

================================================================ */

/* ----------------------------------------------------------------
   CONFIG — tweak everything from here
---------------------------------------------------------------- */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const supabase = createClient(
  "https://rpcunbkstadgngqrjafp.supabase.co",
  "sb_publishable_7v_FIgTjWjJgtT1YHIAYSw_bRBmQjZO"
);

const GAME_ID = 'flappy-nero';
const SCORE_TYPE = 'record';
const LOCAL_BEST_KEY = 'dem00nz_best';
const LOGIN_RETURN_KEY = 'hr_return_after_login';
const LOCAL_BEST_SYNCED_KEY = `${LOCAL_BEST_KEY}_synced`;

const CONFIG = {
  // Physics
  GRAVITY:          0.55,
  JUMP_FORCE:      -13.5,
  DOUBLE_JUMP_FORCE:-11,

  // Ground
  GROUND_HEIGHT:    64,     // px from bottom of canvas

  // Obstacles
  OBS_SPAWN_INTERVAL_MIN: 900,   // ms
  OBS_SPAWN_INTERVAL_MAX: 2200,  // ms
  OBS_WIDTH_MIN:     18,
  OBS_WIDTH_MAX:     46,
  OBS_HEIGHT_MIN:    26,
  OBS_HEIGHT_MAX:    68,

  // Collectibles
  COLLECT_SPAWN_CHANCE:  0.18,  // probability per obstacle spawn tick
  COUPON_SPAWN_CHANCE:   0.06,  // probability among collectibles
  COLLECT_HEIGHT_RANGE:  80,    // how high above ground collectibles appear

  // Speed
  BASE_SPEED:        5.0,
  SPEED_INCREMENT:   0.003,     // per frame (aggressive ramp)
  MAX_SPEED:         18,

  // Background parallax layers (speeds are fractions of game speed)
  BG_LAYER_SPEEDS:  [0.08, 0.18, 0.35, 0.65],

  // Lives
  MAX_LIVES:         3,

  // Invincibility frames after hit (ms)
  HIT_INVINCIBLE_MS: 1500,

  // Coupon toast duration (ms)
  COUPON_TOAST_MS:   3000,
};

/* ----------------------------------------------------------------
   ASSETS — centralized image/sprite references
   Replace null with: new Image() + src assignment, then
   in each draw() call check if img is loaded and drawImage().
---------------------------------------------------------------- */
const ASSETS = {
  // PLAYER_SPRITE — replace null with loaded HTMLImageElement
  PLAYER_SPRITE: (() => { const img = new Image(); img.src = '../../assets/img/kairen.webp'; return img; })(),

  // Obstacle sprites
  DOG_OBSTACLE:     (() => { const img = new Image(); img.src = '../../assets/sprites/tsuru.webp';    return img; })(),
  POLICE_OBSTACLE:  (() => { const img = new Image(); img.src = '../../assets/sprites/patrulla.webp'; return img; })(),
  POTHOLE_OBSTACLE: (() => { const img = new Image(); img.src = '../../assets/sprites/grava.webp';    return img; })(),
  MARKET_OBSTACLE:  (() => { const img = new Image(); img.src = '../../assets/sprites/bote.webp';     return img; })(),
  CONE_OBSTACLE:    (() => { const img = new Image(); img.src = '../../assets/sprites/poste.webp';    return img; })(),

  // Collectibles
  COUPON_ITEM:        null,
  COIN_ITEM: (() => { const img = new Image(); img.src = '../../assets/sprites/mafia.webp'; return img; })(),

  // Background layers (far → near)
  STREET_BG_FAR:  (() => { const img = new Image(); img.src = '../../assets/img/background.webp'; return img; })(),
  STREET_BG_MID:  null,
  STREET_BG_NEAR: null,
  STREET_BG_DECO: null,
};

/* ----------------------------------------------------------------
   SOUNDS — centralized audio references
   All sounds are preloaded. SoundSystem.play() handles iOS unlock.
---------------------------------------------------------------- */
const SOUNDS = {
  awb:       '../../assets/sounds/awb.mp3',       // coupon collected
  game_over: '../../assets/sounds/game_over.mp3', // player loses
  intro:     '../../assets/sounds/intro.mp3',     // page open
  jump:      '../../assets/sounds/touch_game.mp3',// jump
  xeso:      '../../assets/sounds/xeso.mp3',      // hit patrulla
  hit:       '../../assets/sounds/hit.mp3',       // hit any other obstacle
  point:     '../../assets/sounds/point.mp3',     // regular collectible picked up
};

const SoundSystem = (() => {
  // Pre-allocate a small pool of Audio nodes per key to allow
  // overlapping playback without cloning on every call (reduces GC).
  const POOL_SIZE = 3;
  const _pools   = {};   // key → Audio[]
  const _cursors = {};   // key → current pool index (round-robin)
  let _unlocked  = false;

  function _buildPool(key, src) {
    _pools[key]   = Array.from({ length: POOL_SIZE }, () => {
      const a = new Audio(src);
      a.preload = 'auto';
      return a;
    });
    _cursors[key] = 0;
  }

  return {
    // iOS Safari requires a user gesture before playing audio.
    // Unlock on first touch/click by building the Audio pools.
    unlock() {
      if (_unlocked) return;
      _unlocked = true;
      for (const [key, src] of Object.entries(SOUNDS)) {
        _buildPool(key, src);
      }
    },

    play(key, volume = 1) {
      if (!_pools[key]) {
        // Not unlocked yet; build a single-node pool lazily
        const src = SOUNDS[key];
        if (!src) return;
        _buildPool(key, src);
      }
      try {
        const pool  = _pools[key];
        const idx   = _cursors[key];
        const audio = pool[idx];
        _cursors[key] = (idx + 1) % POOL_SIZE;

        audio.volume      = volume;
        audio.currentTime = 0;
        audio.play().catch(() => {}); // silently ignore autoplay block
      } catch(e) {}
    },

    stop(key) {
      const pool = _pools[key];
      if (!pool) return;
      for (const a of pool) { a.pause(); a.currentTime = 0; }
    },
  };
})();

/* ----------------------------------------------------------------
   UTILS
---------------------------------------------------------------- */
const rand    = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const clamp   = (v, min, max) => Math.min(max, Math.max(min, v));

// Cached TWO_PI to avoid repeated allocation inside arc() calls
const TWO_PI = Math.PI * 2;

/* ----------------------------------------------------------------
   CANVAS SETUP & RESPONSIVE RESIZE
   - imageSmoothingEnabled is forced off to keep pixel art crisp
     and to reduce the GPU cost of bilinear filtering on mobile.
---------------------------------------------------------------- */
const canvas  = document.getElementById('gameCanvas');
const ctx     = canvas.getContext('2d');

// Disable smoothing once at init; re-apply after resize (Safari resets it)
function _applyContextSettings() {
  ctx.imageSmoothingEnabled = false;
}
_applyContextSettings();

let W = 0, H = 0, GROUND_Y = 0;

// Cached sky gradient — declared here so resizeCanvas() can nullify it
// before the Background object is defined below.
let _skyGradientCache = null;

// Debounce resize to avoid thrashing layout on rapid window changes
let _resizeTimer = null;
function resizeCanvas() {
  const wrapper = document.getElementById('wrapper');
  W = wrapper.clientWidth;
  H = wrapper.clientHeight;
  canvas.width  = W;
  canvas.height = H;
  GROUND_Y = H - CONFIG.GROUND_HEIGHT;
  _applyContextSettings();
  // Rebuild cached sky gradient for new dimensions
  _skyGradientCache = null;
}

window.addEventListener('resize', () => {
  if (_resizeTimer) clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    resizeCanvas();
    if (!GS.running) Renderer.drawBackground();
  }, 100);
});
resizeCanvas();

/* ----------------------------------------------------------------
   GAME STATE — single mutable object
---------------------------------------------------------------- */
const GS = {
  running:       false,
  over:          false,
  score:         0,
  best:          parseInt(localStorage.getItem(LOCAL_BEST_KEY) || '0'),
  remoteBest:    0,
  scoreRowId:    null,
  profile:       null,
  authUser:      null,
  saveStatus:    '',
  couponsEarned: 0,
  lives:         CONFIG.MAX_LIVES,
  speed:         CONFIG.BASE_SPEED,
  frame:         0,
  lastTime:      0,
  hitTime:       0,
  invincible:    false,
};

/* ----------------------------------------------------------------
   SCORE
---------------------------------------------------------------- */
const Score = {
  add(n)    { GS.score += n; HUD.update(); },
  saveBest() {
    if (GS.score > GS.best) {
      GS.best = GS.score;
      localStorage.setItem(LOCAL_BEST_KEY, GS.best);
    }
  },
};

async function loadScoreAccount() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  GS.authUser = user;

  let { data: profile, error } = await supabase
    .from('users')
    .select('id, user_id')
    .eq('id', user.id)
    .maybeSingle();

  if (!error && !profile?.user_id) {
    const { data: ensuredUserId, error: ensureError } = await supabase.rpc('ensure_my_user_id');
    if (!ensureError && ensuredUserId) {
      const refreshed = await supabase
        .from('users')
        .select('id, user_id')
        .eq('id', user.id)
        .maybeSingle();

      profile = refreshed.data ?? { id: user.id, user_id: ensuredUserId };
      error = refreshed.error;
    } else if (ensureError) {
      console.info('[HR game] user_id ensure unavailable:', ensureError.message);
    }
  }

  if (error || !profile?.user_id) {
    console.info('[HR game] profile unavailable:', error?.message);
    return null;
  }

  GS.profile = profile;
  return profile;
}

async function loadRemoteBest() {
  if (!GS.profile?.user_id) return null;

  const { data, error } = await supabase
    .from('scores')
    .select('id, amount')
    .eq('user_id', GS.profile.user_id)
    .eq('game_id', GAME_ID)
    .eq('type', SCORE_TYPE)
    .order('amount', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.info('[HR game] remote score unavailable:', error.message);
    return null;
  }

  GS.scoreRowId = data?.id ?? null;
  GS.remoteBest = Number(data?.amount ?? 0);
  return GS.remoteBest;
}

async function syncBestWithAccount() {
  const profile = await loadScoreAccount();
  if (!profile) return false;

  const remoteBest = await loadRemoteBest();
  if (remoteBest === null) return false;

  return syncBestSources(remoteBest);
}

async function syncBestSources(remoteBest = GS.remoteBest) {
  const localBest = Number(localStorage.getItem(LOCAL_BEST_KEY) || GS.best || 0);
  const mergedBest = Math.max(localBest, remoteBest);

  GS.best = mergedBest;
  localStorage.setItem(LOCAL_BEST_KEY, String(mergedBest));
  HUD.update();

  if (localBest > remoteBest) {
    return saveBestToSupabase(localBest);
  }

  GS.remoteBest = Number(remoteBest || 0);
  return true;
}

async function saveBestToSupabase(amount = GS.best) {
  if (!GS.profile?.user_id) return false;
  if (Number(amount) <= Number(GS.remoteBest || 0)) return true;

  const payload = {
    game_id: GAME_ID,
    user_id: GS.profile.user_id,
    type: SCORE_TYPE,
    amount: Number(amount),
  };

  const { data, error } = GS.scoreRowId
    ? await supabase
        .from('scores')
        .update({ amount: payload.amount })
        .eq('id', GS.scoreRowId)
        .select('id, amount')
        .single()
    : await supabase
        .from('scores')
        .insert(payload)
        .select('id, amount')
        .single();

  if (error) {
    console.info('[HR game] save score failed:', error.message);
    return false;
  }

  GS.scoreRowId = data?.id ?? GS.scoreRowId;
  GS.remoteBest = Number(data?.amount ?? amount);
  localStorage.setItem(LOCAL_BEST_SYNCED_KEY, String(GS.remoteBest));
  return true;
}

function goToLoginForScore() {
  sessionStorage.setItem(LOGIN_RETURN_KEY, '../minijuegos/flappy_ñero/');
  window.location.href = '../../portal/';
}

/* ----------------------------------------------------------------
   HUD — DOM updates batched via a dirty flag so we don't touch
   the DOM every single frame (only when score/lives change).
---------------------------------------------------------------- */
const HUD = {
  scoreEl:  document.getElementById('scoreVal'),
  bestEl:   document.getElementById('bestVal'),
  livesEl:  document.getElementById('livesVal'),

  // Pre-build the lives glyphs string to avoid repeated string ops
  _livesStrings: (() => {
    const arr = [];
    for (let i = 0; i <= CONFIG.MAX_LIVES; i++) {
      arr[i] = '█'.repeat(i) + '░'.repeat(CONFIG.MAX_LIVES - i);
    }
    return arr;
  })(),

  update() {
    this.scoreEl.textContent = GS.score;
    this.bestEl.textContent  = GS.best;
    this.livesEl.textContent = this._livesStrings[GS.lives] || '';
  },
};

/* ----------------------------------------------------------------
   BACKGROUND — parallax city layers drawn on canvas
   STREET_BACKGROUND placeholder: procedural dark geometry
   Replace with sprite sheets via ASSETS.STREET_BG_*

   Optimization notes:
   - Sky gradient is cached and rebuilt only on resize.
   - Window flicker uses a single random sample per draw (not per seg).
   - Ground stripe and dash-line are drawn with integer coords to hit
     the pixel grid and avoid sub-pixel anti-aliasing overhead.
---------------------------------------------------------------- */

const Background = {
  layers: [[], [], [], []],
  colors: ['#0d0d0d', '#101010', '#131313', '#161616'],

  init() {
    this.layers = [[], [], [], []];
    for (let l = 0; l < 4; l++) {
      let x = 0;
      while (x < W * 2) {
        const w = randInt(40, 180 - l * 20);
        const h = randInt(30 + l * 20, 120 + l * 40);
        this.layers[l].push({ x, w, h, hasWindow: Math.random() > 0.4 });
        x += w + randInt(4, 24 - l * 4);
      }
    }
  },

  update(dt) {
    if (!GS.running) return;
    const speeds = CONFIG.BG_LAYER_SPEEDS;
    // Pre-compute the dt-scaled multiplier once
    const dtScale = dt * 60 / 1000;

    for (let l = 0; l < 4; l++) {
      const layer = this.layers[l];
      const spd   = GS.speed * speeds[l] * dtScale;

      for (let i = 0; i < layer.length; i++) layer[i].x -= spd;

      // Recycle the first segment when it scrolls fully off-screen
      if (layer[0].x + layer[0].w < 0) {
        const s    = layer.shift();
        const last = layer[layer.length - 1];
        s.x        = last.x + last.w + randInt(4, 24 - l * 4);
        s.w        = randInt(40, 180 - l * 20);
        s.h        = randInt(30 + l * 20, 120 + l * 40);
        s.hasWindow = Math.random() > 0.4;
        layer.push(s);
      }
    }
  },

  draw() {
    // ── STREET_BACKGROUND ──
    if (ASSETS.STREET_BG_FAR && ASSETS.STREET_BG_FAR.complete) {
      ctx.drawImage(ASSETS.STREET_BG_FAR, 0, 0, W, GROUND_Y);
    } else {
      // Sky gradient — use cached version to avoid per-frame object creation
      if (!_skyGradientCache) {
        _skyGradientCache = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
        _skyGradientCache.addColorStop(0,   '#05050a');
        _skyGradientCache.addColorStop(0.7, '#070710');
        _skyGradientCache.addColorStop(1,   '#0a0a0a');
      }
      ctx.fillStyle = _skyGradientCache;
      ctx.fillRect(0, 0, W, GROUND_Y);
    }

    // Parallax building layers (far → near)
    // Sample one flicker roll per draw call, shared across all windows
    // to avoid Math.random() inside the per-segment inner loop.
    const flickerRoll = Math.random();

    for (let l = 0; l < 4; l++) {
      ctx.fillStyle = this.colors[l];
      const layer   = this.layers[l];

      for (let i = 0; i < layer.length; i++) {
        const seg = layer[i];
        const top = GROUND_Y - seg.h;
        ctx.fillRect(seg.x | 0, top | 0, seg.w, seg.h);

        // Small window glints — only if the building is wide enough
        if (seg.hasWindow && seg.w > 28) {
          ctx.fillStyle = flickerRoll > 0.997
            ? 'rgba(200,255,0,0.25)'    // rare flicker (one building per frame at most)
            : 'rgba(255,255,200,0.04)';
          const wx = seg.x + seg.w * 0.3;
          const wy = top + seg.h * 0.25;
          ctx.fillRect(wx | 0, wy | 0, seg.w * 0.3, seg.h * 0.1);
          // Restore color for next segment in this layer
          ctx.fillStyle = this.colors[l];
        }
      }
    }

    // Ground — asphalt + CDMX yellow curb line
    ctx.fillStyle = '#7a7a7a';
    ctx.fillRect(0, GROUND_Y | 0, W, CONFIG.GROUND_HEIGHT);

    ctx.fillStyle = 'rgba(255,204,0,0.92)';
    ctx.fillRect(0, GROUND_Y | 0, W, 16);

    // Ground top edge
    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(0, (GROUND_Y + 3) | 0);
    ctx.lineTo(W, (GROUND_Y + 3) | 0);
    ctx.stroke();

    // Dashed lane marks (moving) — offset is integer-floored to stay on pixel grid
    const dashOffset = -(GS.frame * GS.speed * 0.5) % 80;
    ctx.setLineDash([40, 40]);
    ctx.lineDashOffset = dashOffset | 0;
    ctx.strokeStyle    = '#383838';
    ctx.lineWidth      = 1;
    ctx.beginPath();
    ctx.moveTo(0, (GROUND_Y + 20) | 0);
    ctx.lineTo(W, (GROUND_Y + 20) | 0);
    ctx.stroke();
    ctx.setLineDash([]);
  },
};

/* ----------------------------------------------------------------
   PLAYER
   PLAYER_SPRITE: swap null → loaded Image in ASSETS and
   call ctx.drawImage(ASSETS.PLAYER_SPRITE, px, py, pw, ph)
---------------------------------------------------------------- */
const Player = {
  x: 0, y: 0,
  w: 48, h: 68,
  vy: 0,
  onGround: false,
  canDoubleJump: true,
  jumpCount: 0,
  animFrame: 0,
  animTimer: 0,

  // Reusable hitbox object — avoids allocation every collision check
  _hitboxObj: { x: 0, y: 0, w: 0, h: 0 },

  init() {
    this.x   = W * 0.15;
    this.y   = GROUND_Y - this.h;
    this.vy  = 0;
    this.onGround      = true;
    this.canDoubleJump = true;
    this.jumpCount     = 0;
    this.animFrame     = 0;
    this.animTimer     = 0;
  },

  jump() {
    if (this.onGround) {
      this.vy            = CONFIG.JUMP_FORCE;
      this.onGround      = false;
      this.jumpCount     = 1;
      this.canDoubleJump = true;
      SoundSystem.play('jump');
    } else if (this.canDoubleJump && this.jumpCount < 2) {
      this.vy            = CONFIG.DOUBLE_JUMP_FORCE;
      this.canDoubleJump = false;
      this.jumpCount     = 2;
      SoundSystem.play('jump', 0.7);
    }
  },

  update(dt) {
    const dtf      = dt * 60 / 1000;
    this.vy       += CONFIG.GRAVITY * dtf;
    this.y        += this.vy * dtf;

    const groundLine = GROUND_Y - this.h;
    if (this.y >= groundLine) {
      this.y             = groundLine;
      this.vy            = 0;
      this.onGround      = true;
      this.jumpCount     = 0;
      this.canDoubleJump = true;
    } else {
      this.onGround = false;
    }

    // Animate legs only while on ground
    this.animTimer += dt;
    if (this.onGround && this.animTimer > 100) {
      this.animFrame = (this.animFrame + 1) % 4;
      this.animTimer = 0;
    }
  },

  // Returns reused hitbox object — callers must not hold onto reference
  hitbox() {
    const hb  = this._hitboxObj;
    hb.x = this.x + 4;
    hb.y = this.y + 4;
    hb.w = this.w - 8;
    hb.h = this.h - 4;
    return hb;
  },

  draw() {
    const px = this.x | 0;
    const py = this.y | 0;
    const pw = this.w;
    const ph = this.h;

    // ── PLAYER_SPRITE ──
    // Blink during invincibility — use bit-shift for fast modulo-2
    const blink = GS.invincible && ((Date.now() >> 6) & 1) === 0;
    if (blink) return;

    if (ASSETS.PLAYER_SPRITE && ASSETS.PLAYER_SPRITE.complete) {
      const ratio = ASSETS.PLAYER_SPRITE.naturalWidth / ASSETS.PLAYER_SPRITE.naturalHeight;
      const drawH = ph;
      const drawW = drawH * ratio;
      ctx.drawImage(ASSETS.PLAYER_SPRITE, px, py, drawW, drawH);
    } else {
      // Placeholder fallback while image loads
      ctx.save();
      ctx.fillStyle = '#c8ff00';
      ctx.beginPath();
      ctx.arc(px + pw / 2, py + 8, 7, 0, TWO_PI);
      ctx.fill();
      ctx.fillRect(px + pw / 2 - 4, py + 15, 8, 18);
      ctx.restore();
    }
  },
};

/* ----------------------------------------------------------------
   OBSTACLE POOL
   Obstacle types with conceptual CDMX-urban labels.
   Replace drawFn bodies with ctx.drawImage(ASSETS.X_OBSTACLE, ...)

   Optimization note: each type caches its naturalWidth/naturalHeight
   aspect ratio the first time draw() is called to avoid repeated
   property lookups inside the hot draw path.
---------------------------------------------------------------- */
const OBSTACLE_TYPES = [
  {
    id:     'DOG_OBSTACLE',
    label:  'perro',
    wMin: 24, wMax: 38,
    hMin: 70, hMax: 70,
    color:  '#2a2a2a',
    _ratio: null,
    draw(ctx, x, y, w, h) {
      // ── DOG_OBSTACLE (tsuru.webp) ──
      const img = ASSETS.DOG_OBSTACLE;
      if (img && img.complete) {
        if (!this._ratio) this._ratio = img.naturalWidth / img.naturalHeight;
        ctx.drawImage(img, x, y, h * this._ratio, h);
      } else {
        ctx.fillStyle = this.color;
        ctx.fillRect(x, y + h * 0.35, w, h * 0.45);
        ctx.fillRect(x + w * 0.6, y + h * 0.15, w * 0.4, h * 0.35);
      }
    },
  },
  {
    id:     'POLICE_OBSTACLE',
    label:  'tira',
    wMin: 20, wMax: 30,
    hMin: 75, hMax: 75,
    color:  '#1a1a2e',
    accent: '#ff2b4e',
    _ratio: null,
    draw(ctx, x, y, w, h) {
      // ── POLICE_OBSTACLE (patrulla.webp) ──
      const img = ASSETS.POLICE_OBSTACLE;
      if (img && img.complete) {
        if (!this._ratio) this._ratio = img.naturalWidth / img.naturalHeight;
        ctx.drawImage(img, x, y, h * this._ratio, h);
      } else {
        ctx.fillStyle = this.color;
        ctx.fillRect(x + w * 0.2, y + h * 0.3, w * 0.6, h * 0.5);
        ctx.beginPath();
        ctx.arc(x + w / 2, y + h * 0.18, w * 0.22, 0, TWO_PI);
        ctx.fill();
      }
    },
  },
  {
    id:     'POTHOLE_OBSTACLE',
    label:  'bache',
    wMin: 30, wMax: 55,
    hMin: 80, hMax: 80,
    color:  '#181818',
    _ratio: null,
    draw(ctx, x, y, w, h) {
      // ── POTHOLE_OBSTACLE (grava.webp) ──
      const img = ASSETS.POTHOLE_OBSTACLE;
      if (img && img.complete) {
        if (!this._ratio) this._ratio = img.naturalWidth / img.naturalHeight;
        ctx.drawImage(img, x, y, h * this._ratio, h);
      } else {
        ctx.fillStyle = '#0a0a0a';
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, TWO_PI);
        ctx.fill();
      }
    },
  },
  {
    id:     'MARKET_OBSTACLE',
    label:  'puesto',
    wMin: 36, wMax: 56,
    hMin: 52, hMax: 52,
    color:  '#1c1c1c',
    _ratio: null,
    draw(ctx, x, y, w, h) {
      // ── MARKET_OBSTACLE (bote.webp) ──
      const img = ASSETS.MARKET_OBSTACLE;
      if (img && img.complete) {
        if (!this._ratio) this._ratio = img.naturalWidth / img.naturalHeight;
        ctx.drawImage(img, x, y, h * this._ratio, h);
      } else {
        ctx.fillStyle = this.color;
        ctx.fillRect(x + w * 0.1, y + h * 0.4, w * 0.8, h * 0.5);
      }
    },
  },
  {
    id:     'CONE_OBSTACLE',
    label:  'cono',
    wMin: 16, wMax: 26,
    hMin: 90, hMax: 90,
    color:  '#1e1e1e',
    _ratio: null,
    draw(ctx, x, y, w, h) {
      // ── CONE_OBSTACLE (poste.webp) ──
      const img = ASSETS.CONE_OBSTACLE;
      if (img && img.complete) {
        if (!this._ratio) this._ratio = img.naturalWidth / img.naturalHeight;
        ctx.drawImage(img, x, y, h * this._ratio, h);
      } else {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.moveTo(x + w / 2, y);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x, y + h);
        ctx.closePath();
        ctx.fill();
      }
    },
  },
];

/* ----------------------------------------------------------------
   OBSTACLE POOL
   Uses a fixed-size array and a manual active count instead of
   repeated Array.filter() to reduce GC pressure each frame.
---------------------------------------------------------------- */
const ObstaclePool = (() => {
  // Pre-allocate pool objects; we swap them in/out by marking active flag
  const MAX_OBSTACLES = 16;
  const _pool = Array.from({ length: MAX_OBSTACLES }, () => ({
    type: null, x: 0, y: 0, w: 0, h: 0, scored: false, active: false,
  }));

  let spawnTimer = 0;
  let nextSpawn  = 1200;

  function _getFree() {
    for (let i = 0; i < MAX_OBSTACLES; i++) {
      if (!_pool[i].active) return _pool[i];
    }
    return null; // pool exhausted (shouldn't happen at normal speeds)
  }

  function _spawn() {
    const o = _getFree();
    if (!o) return;
    const type  = OBSTACLE_TYPES[randInt(0, OBSTACLE_TYPES.length - 1)];
    const h     = randInt(type.hMin, type.hMax);
    const w     = randInt(type.wMin, type.wMax);
    o.type      = type;
    o.x         = W + 20;
    o.y         = GROUND_Y - h;
    o.w         = w;
    o.h         = h;
    o.scored    = false;
    o.active    = true;
    nextSpawn   = rand(CONFIG.OBS_SPAWN_INTERVAL_MIN, CONFIG.OBS_SPAWN_INTERVAL_MAX);
  }

  function init() {
    for (let i = 0; i < MAX_OBSTACLES; i++) _pool[i].active = false;
    spawnTimer = 0;
    nextSpawn  = 1400;
  }

  function update(dt) {
    spawnTimer += dt;
    if (spawnTimer >= nextSpawn) { _spawn(); spawnTimer = 0; }

    const move = GS.speed * dt * 60 / 1000;
    for (let i = 0; i < MAX_OBSTACLES; i++) {
      const o = _pool[i];
      if (!o.active) continue;
      o.x -= move;
      if (!o.scored && o.x + o.w < Player.x) {
        Score.add(1);
        o.scored = true;
      }
      // Deactivate when fully off-screen
      if (o.x + o.w < -10) o.active = false;
    }
  }

  function draw() {
    for (let i = 0; i < MAX_OBSTACLES; i++) {
      const o = _pool[i];
      if (!o.active) continue;
      o.type.draw(ctx, o.x | 0, o.y | 0, o.w, o.h);
    }
  }

  // Returns only the active subset — used by Collision
  function getAll() {
    const active = [];
    for (let i = 0; i < MAX_OBSTACLES; i++) {
      if (_pool[i].active) active.push(_pool[i]);
    }
    return active;
  }

  return { init, update, draw, getAll, pool: _pool };
})();

/* ----------------------------------------------------------------
   COLLECTIBLE POOL
   Two tiers: regular (score) and rare COUPON.
   Same pooling strategy as ObstaclePool — avoids filter() each frame.
   COUPON_ITEM / COIN_ITEM — replace draw blocks with drawImage.
---------------------------------------------------------------- */
const CollectiblePool = (() => {
  const MAX_ITEMS = 12;
  const _pool = Array.from({ length: MAX_ITEMS }, () => ({
    type: 'COIN', x: 0, y: 0, w: 0, h: 0,
    collected: false, pulse: 0, active: false,
  }));

  let spawnTimer = 0;
  let nextSpawn  = 2000;

  // Cache ratio for COIN_ITEM to avoid repeated property lookups
  let _coinRatio = null;

  function _getFree() {
    for (let i = 0; i < MAX_ITEMS; i++) {
      if (!_pool[i].active) return _pool[i];
    }
    return null;
  }

  function _spawn() {
    const it = _getFree();
    if (!it) return;
    const isCoupon = Math.random() < CONFIG.COUPON_SPAWN_CHANCE;
    const h   = 32;
    const w   = isCoupon ? 22 : 14;
    const yOff = rand(0, CONFIG.COLLECT_HEIGHT_RANGE);
    it.type      = isCoupon ? 'COUPON' : 'COIN';
    it.x         = W + 20;
    it.y         = GROUND_Y - h - 30 - yOff;
    it.w         = w;
    it.h         = h;
    it.collected = false;
    it.pulse     = 0;
    it.active    = true;
    nextSpawn    = rand(1800, 3200);
  }

  function init() {
    for (let i = 0; i < MAX_ITEMS; i++) _pool[i].active = false;
    spawnTimer = 0;
    nextSpawn  = 2000;
  }

  function update(dt) {
    spawnTimer += dt;
    if (Math.random() < CONFIG.COLLECT_SPAWN_CHANCE && spawnTimer >= nextSpawn) {
      _spawn(); spawnTimer = 0;
    }
    const move     = GS.speed * dt * 60 / 1000;
    const pulseInc = dt * 0.005;
    for (let i = 0; i < MAX_ITEMS; i++) {
      const it = _pool[i];
      if (!it.active) continue;
      it.x     -= move;
      it.pulse += pulseInc;
      if (it.collected || it.x + it.w < -10) it.active = false;
    }
  }

  function draw() {
    for (let i = 0; i < MAX_ITEMS; i++) {
      const it = _pool[i];
      if (!it.active || it.collected) continue;

      ctx.save();
      const px  = it.x | 0;
      const py  = (it.y + Math.sin(it.pulse) * 4) | 0;

      if (it.type === 'COUPON') {
        // ── COUPON_ITEM: swap below with ctx.drawImage(ASSETS.COUPON_ITEM, ...)
        const glow = Math.abs(Math.sin(it.pulse * 2));
        ctx.shadowColor  = `rgba(255,215,0,${(0.4 + glow * 0.4).toFixed(2)})`;
        ctx.shadowBlur   = 12 + glow * 8;
        ctx.strokeStyle  = `rgba(255,215,0,${(0.7 + glow * 0.3).toFixed(2)})`;
        ctx.lineWidth    = 1.5;
        ctx.strokeRect(px, py, it.w, it.h);
        ctx.fillStyle    = `rgba(255,215,0,${(0.08 + glow * 0.06).toFixed(2)})`;
        ctx.fillRect(px, py, it.w, it.h);
        // Star glyph
        ctx.fillStyle    = `rgba(255,215,0,${(0.8 + glow * 0.2).toFixed(2)})`;
        ctx.font         = `${(it.h * 0.65) | 0}px monospace`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('★', px + it.w / 2, py + it.h / 2);
      } else {
        // ── COIN_ITEM (mafia.webp) ──
        const img = ASSETS.COIN_ITEM;
        if (img && img.complete) {
          if (!_coinRatio) _coinRatio = img.naturalWidth / img.naturalHeight;
          ctx.drawImage(img, px, py, it.h * _coinRatio, it.h);
        } else {
          ctx.fillStyle    = 'rgba(200,255,0,0.7)';
          ctx.font         = `${(it.h * 0.6) | 0}px monospace`;
          ctx.textAlign    = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('◆', px + it.w / 2, py + it.h / 2 + 1);
        }
      }
      ctx.restore();
    }
  }

  // Returns active, uncollected items — used by Collision
  function getAll() {
    const active = [];
    for (let i = 0; i < MAX_ITEMS; i++) {
      if (_pool[i].active && !_pool[i].collected) active.push(_pool[i]);
    }
    return active;
  }

  return { init, update, draw, getAll, pool: _pool };
})();

/* ----------------------------------------------------------------
   COLLISION — AABB with hitbox shrink for fairness

   Optimization: Player.hitbox() now returns a cached object (no GC).
   Obstacle hitboxes are computed inline to avoid extra allocation.
---------------------------------------------------------------- */
const Collision = {
  // Inline AABB — inlined as a method to allow JIT optimization
  aabb(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw &&
           ax + aw > bx &&
           ay < by + bh &&
           ay + ah > by;
  },

  check() {
    const ph = Player.hitbox(); // returns reused object
    const px = ph.x, py = ph.y, pw = ph.w, phh = ph.h;

    // Obstacle collision
    if (!GS.invincible) {
      const obs = ObstaclePool.pool;
      for (let i = 0; i < obs.length; i++) {
        const o  = obs[i];
        if (!o.active) continue;
        const ox = o.x + 4, oy = o.y + 4, ow = o.w - 8, oh = o.h - 8;
        if (this.aabb(px, py, pw, phh, ox, oy, ow, oh)) {
          SoundSystem.play(o.type.id === 'POLICE_OBSTACLE' ? 'xeso' : 'hit');
          playerHit();
          return;
        }
      }
    }

    // Collectible collision
    const items = CollectiblePool.pool;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.active || it.collected) continue;
      if (this.aabb(px, py, pw, phh, it.x, it.y, it.w, it.h)) {
        it.collected = true;
        if (it.type === 'COUPON') {
          GS.couponsEarned++;
          Score.add(50);
          SoundSystem.play('awb');
          CouponSystem.onEarned();
        } else {
          Score.add(5);
          SoundSystem.play('point');
        }
      }
    }
  },
};

/* ----------------------------------------------------------------
   COUPON SYSTEM
   Future: POST earned coupon to backend here.
   Add user ID, session token, coupon code generation, etc.
---------------------------------------------------------------- */
const COUPON_MESSAGES = [
  '★ UN PUTÍSIMO CUPÓN PA HIDDEN\nmándanos captura para canjearlo',
  '★ SECRETO DESBLOQUEADO\nmandanos ss para canjearlo',
  '★ DROP EXTRAÑO\nparece un cupón we',
  '★ 2x1\n2x1 pa la jaiden válida (mándanos ss)',
];

const CouponSystem = {
  toastEl: document.getElementById('coupon-toast'),
  timer:   null,

  onEarned() {
    const msg = COUPON_MESSAGES[randInt(0, COUPON_MESSAGES.length - 1)];
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('visible');

    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.toastEl.classList.remove('visible');
    }, CONFIG.COUPON_TOAST_MS);

    // ── FUTURE BACKEND HOOK ──────────────────────────────────────
    // CouponAPI.award({ userId, sessionId, score: GS.score, ts: Date.now() });
    // ─────────────────────────────────────────────────────────────
  },

  reset() {
    this.toastEl.classList.remove('visible');
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  },
};

/* ----------------------------------------------------------------
   DIFFICULTY — speed ramp
---------------------------------------------------------------- */
const Difficulty = {
  _incPerMs: CONFIG.SPEED_INCREMENT * 60 / 1000, // pre-computed constant
  update(dt) {
    GS.speed = clamp(
      GS.speed + this._incPerMs * dt,
      CONFIG.BASE_SPEED,
      CONFIG.MAX_SPEED
    );
  },
};

/* ----------------------------------------------------------------
   PARTICLE SYSTEM — minimal dust / hit sparks

   Optimization: fixed-capacity pool avoids Array.filter() each frame.
   Particles are recycled by swapping with the last active particle
   (O(1) removal with no array shift).
---------------------------------------------------------------- */
const Particles = (() => {
  const MAX_P = 64;
  const _pool = Array.from({ length: MAX_P }, () => ({
    x: 0, y: 0, vx: 0, vy: 0, life: 0, decay: 0, r: 0, color: '#fff',
  }));
  let _count = 0; // number of active particles

  function emit(x, y, color, count = 5) {
    for (let i = 0; i < count && _count < MAX_P; i++) {
      const p  = _pool[_count++];
      p.x      = x;
      p.y      = y;
      p.vx     = rand(-3, 3);
      p.vy     = rand(-5, -1);
      p.life   = 1;
      p.decay  = rand(0.02, 0.06);
      p.r      = rand(1.5, 3.5);
      p.color  = color;
    }
  }

  function update(dt) {
    const dtf = dt * 60 / 1000;
    for (let i = _count - 1; i >= 0; i--) {
      const p = _pool[i];
      p.x    += p.vx * dtf;
      p.y    += p.vy * dtf;
      p.vy   += 0.2 * dtf;
      p.life -= p.decay * dtf;
      // Swap-remove dead particles (O(1), no array shift)
      if (p.life <= 0) {
        _pool[i]        = _pool[_count - 1];
        _pool[_count - 1] = p;
        _count--;
      }
    }
  }

  function draw() {
    for (let i = 0; i < _count; i++) {
      const p = _pool[i];
      ctx.globalAlpha = p.life;
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TWO_PI);
      ctx.fill();
    }
    // Reset alpha once after all particles (one state change vs. many)
    if (_count > 0) ctx.globalAlpha = 1;
  }

  function reset() { _count = 0; }

  return { emit, update, draw, reset };
})();

/* ----------------------------------------------------------------
   RENDERER
---------------------------------------------------------------- */
const Renderer = {
  drawBackground() {
    Background.draw();
  },

  draw() {
    ctx.clearRect(0, 0, W, H);
    Background.draw();
    ObstaclePool.draw();
    CollectiblePool.draw();
    Player.draw();
    Particles.draw();
    this._drawSpeedLines();
  },

  _drawSpeedLines() {
    // Subtle speed streaks when fast — only drawn above 30% of max speed range
    const t = (GS.speed - CONFIG.BASE_SPEED) / (CONFIG.MAX_SPEED - CONFIG.BASE_SPEED);
    if (t < 0.3) return;
    ctx.save();
    ctx.globalAlpha = t * 0.04;
    ctx.fillStyle   = '#c8ff00';
    for (let i = 0; i < 3; i++) {
      const y = rand(GROUND_Y - 40, GROUND_Y - 10);
      ctx.fillRect(0, y | 0, W * rand(0.3, 0.9), 1);
    }
    ctx.restore();
  },
};

/* ----------------------------------------------------------------
   SCREENS
---------------------------------------------------------------- */
const Screens = {
  start:    document.getElementById('startScreen'),
  gameOver: document.getElementById('gameOverScreen'),
  goScore:  document.getElementById('goScore'),
  goBest:   document.getElementById('goBest'),
  goCoupons:document.getElementById('goCoupons'),
  goSaveStatus: document.getElementById('goSaveStatus'),
  saveScoreBtn: document.getElementById('saveScoreBtn'),
  tapHint:  document.getElementById('tap-hint'),

  showStart() {
    this.start.classList.remove('hidden');
    this.gameOver.classList.add('hidden');
  },
  showGameOver() {
    this.goScore.textContent   = GS.score;
    this.goBest.textContent    = GS.best;
    this.goCoupons.textContent = GS.couponsEarned
      ? `★ CUPONES CONSEGUIDOS (mandanos ss a wpp): ${GS.couponsEarned}`
      : '';
    this.goSaveStatus.textContent = GS.saveStatus || (GS.profile
      ? 'record sincronizado con tu cuenta'
      : 'inicia sesion para guardar tu record');
    this.saveScoreBtn.classList.toggle('hidden', Boolean(GS.profile));
    this.gameOver.classList.remove('hidden');
    this.start.classList.add('hidden');
  },
  hideAll() {
    this.start.classList.add('hidden');
    this.gameOver.classList.add('hidden');
  },
};

/* ----------------------------------------------------------------
   GAME LIFECYCLE
---------------------------------------------------------------- */
function startGame() {
  if (GS.running) return;
  stopStaticLoop();

  GS.running       = true;
  GS.over          = false;
  GS.score         = 0;
  GS.lives         = CONFIG.MAX_LIVES;
  GS.speed         = CONFIG.BASE_SPEED;
  GS.frame         = 0;
  GS.invincible    = false;
  GS.saveStatus    = '';
  GS.couponsEarned = 0;

  Background.init();
  Player.init();
  ObstaclePool.init();
  CollectiblePool.init();
  Particles.reset();
  CouponSystem.reset();
  HUD.update();
  Screens.hideAll();

  GS.lastTime = performance.now();
  requestAnimationFrame(loop);
}

function playerHit() {
  GS.lives--;
  GS.invincible = true;
  GS.hitTime    = Date.now();

  Particles.emit(
    Player.x + Player.w / 2,
    Player.y + Player.h / 2,
    '#ff2b4e', 8
  );

  HUD.update();

  if (GS.lives <= 0) {
    gameOver();
  } else {
    setTimeout(() => { GS.invincible = false; }, CONFIG.HIT_INVINCIBLE_MS);
  }
}

function gameOver() {
  GS.running = false;
  GS.over    = true;
  Score.saveBest();
  saveGameOverScore();
  SoundSystem.play('game_over');
  setTimeout(() => Screens.showGameOver(), 500);
}

async function saveGameOverScore() {
  if (!GS.profile) {
    await loadScoreAccount();
    if (GS.profile) await loadRemoteBest();
  }

  if (!GS.profile) {
    GS.saveStatus = 'inicia sesion para guardar tu record';
    return;
  }

  const localBest = Number(localStorage.getItem(LOCAL_BEST_KEY) || GS.best || 0);
  const remoteBest = Number(GS.remoteBest || 0);

  if (remoteBest > localBest) {
    GS.best = remoteBest;
    localStorage.setItem(LOCAL_BEST_KEY, String(remoteBest));
    HUD.update();
    if (Screens.goBest) Screens.goBest.textContent = GS.best;
    GS.saveStatus = 'record sincronizado con tu cuenta';
    return;
  }

  if (localBest <= remoteBest) {
    GS.best = remoteBest;
    localStorage.setItem(LOCAL_BEST_KEY, String(remoteBest));
    HUD.update();
    if (Screens.goBest) Screens.goBest.textContent = GS.best;
    GS.saveStatus = 'record sincronizado con tu cuenta';
    return;
  }

  GS.saveStatus = 'guardando record...';
  if (Screens.goSaveStatus) Screens.goSaveStatus.textContent = GS.saveStatus;

  GS.best = localBest;
  HUD.update();
  if (Screens.goBest) Screens.goBest.textContent = GS.best;

  const saved = await saveBestToSupabase(localBest);
  GS.saveStatus = saved
    ? 'nuevo record guardado'
    : 'no se pudo guardar el record';

  if (Screens.goSaveStatus && !Screens.gameOver.classList.contains('hidden')) {
    Screens.goSaveStatus.textContent = GS.saveStatus;
  }
}

/* ----------------------------------------------------------------
   GAME LOOP
   - dt is capped at 50 ms to prevent physics tunnelling after
     tab-backgrounding / resumed frames.
   - The static start screen is throttled so it does not burn a full
     animation loop before the player starts.
---------------------------------------------------------------- */
let _loopId = null; // tracks the timeout ID for the static start-screen loop

function loop(timestamp) {
  if (!GS.running) return;

  const dt = Math.min(timestamp - GS.lastTime, 50);
  GS.lastTime = timestamp;
  GS.frame++;

  Difficulty.update(dt);
  Background.update(dt);
  Player.update(dt);
  ObstaclePool.update(dt);
  CollectiblePool.update(dt);
  Particles.update(dt);
  Collision.check();
  Renderer.draw();

  requestAnimationFrame(loop);
}

function staticLoop() {
  if (GS.running) return; // hand off once the game starts
  Background.draw();
  _loopId = window.setTimeout(staticLoop, 250);
}

function stopStaticLoop() {
  if (_loopId === null) return;
  window.clearTimeout(_loopId);
  _loopId = null;
}

/* ----------------------------------------------------------------
   INPUT — keyboard + touch
   Touch improvements for mobile:
   - touchstart uses passive:false only on the canvas (needed for
     preventDefault to suppress scroll/zoom).
   - Wrapper listener is passive:true (no need to block default).
   - Button handlers use touchend to fire once (not doubled by click).
---------------------------------------------------------------- */
const Input = {
  init() {
    // Keyboard
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        this.action();
      }
    });

    // iOS Safari audio unlock — run once on any user gesture
    let introPlayed = false;
    const playIntroOnce = () => {
      if (introPlayed) return;
      introPlayed = true;
      SoundSystem.unlock();
      SoundSystem.play('intro');
    };

    // Canvas touch — prevent default to stop scroll/zoom on mobile
    canvas.style.touchAction = 'none';
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      playIntroOnce();
      this.action();
    }, { passive: false });

    // Wrapper touch — passive, just for audio unlock
    document.getElementById('wrapper').addEventListener('touchstart', playIntroOnce, { passive: true });

    // Buttons — touchend fires once on mobile; click covers desktop
    const startBtn   = document.getElementById('startBtn');
    const restartBtn = document.getElementById('restartBtn');
    const saveScoreBtn = document.getElementById('saveScoreBtn');

    const btnTouch = (e) => { e.preventDefault(); playIntroOnce(); startGame(); };
    startBtn.addEventListener('touchend',   btnTouch, { passive: false });
    restartBtn.addEventListener('touchend', btnTouch, { passive: false });
    startBtn.addEventListener('click',   () => { SoundSystem.unlock(); startGame(); });
    restartBtn.addEventListener('click', () => { SoundSystem.unlock(); startGame(); });
    saveScoreBtn?.addEventListener('click', goToLoginForScore);
  },

  action() {
    if (!GS.running && !GS.over) { startGame(); return; }
    if (GS.running) { Player.jump(); }
  },
};

/* ----------------------------------------------------------------
   BOOT
   - Input, Background and static draw loop initialised once.
   - The menu render is throttled; the game loop takes over when the
     player starts.
---------------------------------------------------------------- */
Input.init();
Background.init();
syncBestWithAccount().catch((error) => {
  console.info('[HR game] score sync skipped:', error);
});

// Desktop: attempt autoplay immediately.
// iOS: will silently fail; intro plays on first user gesture (Input.init).
SoundSystem.play('intro');

Screens.showStart();
staticLoop(); // begins the idle background animation
