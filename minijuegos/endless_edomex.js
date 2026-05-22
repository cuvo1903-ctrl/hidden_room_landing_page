/* ================================================================
   dem00nz RUNNER — game engine
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
  PLAYER_SPRITE: (() => { const img = new Image(); img.src = '../assets/img/kairen.webp'; return img; })(),   // e.g. 32×48 px sprite sheet

  // Obstacle sprites
  DOG_OBSTACLE:     (() => { const img = new Image(); img.src = '../assets/sprites/tsuru.webp';    return img; })(),
  POLICE_OBSTACLE:  (() => { const img = new Image(); img.src = '../assets/sprites/patrulla.webp'; return img; })(),
  POTHOLE_OBSTACLE: (() => { const img = new Image(); img.src = '../assets/sprites/grava.webp';    return img; })(),
  MARKET_OBSTACLE:  (() => { const img = new Image(); img.src = '../assets/sprites/bote.webp';     return img; })(),
  CONE_OBSTACLE:    (() => { const img = new Image(); img.src = '../assets/sprites/poste.webp';    return img; })(),

  // Collectibles
  COUPON_ITEM:        null,   // rare redeemable coupon glyph
  COIN_ITEM: (() => { const img = new Image(); img.src = '../assets/sprites/mafia.webp'; return img; })(),

  // Background layers (far → near)
  STREET_BG_FAR:  (() => { const img = new Image(); img.src = '../assets/img/background.webp'; return img; })(),
  STREET_BG_MID:  null,
  STREET_BG_NEAR: null,
  STREET_BG_DECO: null,
};

/* ----------------------------------------------------------------
   SOUNDS — centralized audio references
   All sounds are preloaded. SoundSystem.play() handles iOS unlock.
---------------------------------------------------------------- */
const SOUNDS = {
  awb:       '../assets/sounds/awb.mp3',       // coupon collected
  game_over: '../assets/sounds/game_over.mp3', // player loses
  intro:     '../assets/sounds/intro.mp3',     // page open
  jump:      '../assets/sounds/touch_game.mp3',// jump
  xeso:      '../assets/sounds/xeso.mp3',      // hit patrulla
  hit:       '../assets/sounds/hit.mp3',       // hit any other obstacle
  point:     '../assets/sounds/point.mp3',     // regular collectible picked up
};

const SoundSystem = {
  _cache: {},
  _unlocked: false,

  // iOS Safari requires a user gesture before playing audio.
  // We unlock on first touch/click by playing a silent buffer.
  unlock() {
    if (this._unlocked) return;
    this._unlocked = true;
    // pre-load all sounds now that we have a gesture
    for (const [key, src] of Object.entries(SOUNDS)) {
      const audio = new Audio(src);
      audio.preload = 'auto';
      this._cache[key] = audio;
    }
  },

  play(key, volume = 1) {
    const src = SOUNDS[key];
    if (!src) return;
    try {
      // Clone the audio so overlapping sounds work
      let audio = this._cache[key];
      if (!audio) {
        audio = new Audio(src);
        this._cache[key] = audio;
      }
      const clone = audio.cloneNode();
      clone.volume = volume;
      clone.play().catch(() => {}); // silently ignore autoplay block
    } catch(e) {}
  },

  stop(key) {
    const audio = this._cache[key];
    if (audio) { audio.pause(); audio.currentTime = 0; }
  },
};

/* ----------------------------------------------------------------
   UTILS
---------------------------------------------------------------- */
const rand    = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const clamp   = (v, min, max) => Math.min(max, Math.max(min, v));

/* ----------------------------------------------------------------
   CANVAS SETUP & RESPONSIVE RESIZE
---------------------------------------------------------------- */
const canvas  = document.getElementById('gameCanvas');
const ctx     = canvas.getContext('2d');

let W = 0, H = 0, GROUND_Y = 0;

function resizeCanvas() {
  const wrapper = document.getElementById('wrapper');
  W = wrapper.clientWidth;
  H = wrapper.clientHeight;
  canvas.width  = W;
  canvas.height = H;
  GROUND_Y = H - CONFIG.GROUND_HEIGHT;
}
window.addEventListener('resize', () => { resizeCanvas(); if (GS.running) Renderer.drawBackground(); });
resizeCanvas();

/* ----------------------------------------------------------------
   GAME STATE — single mutable object
---------------------------------------------------------------- */
const GS = {
  running:       false,
  over:          false,
  score:         0,
  best:          parseInt(localStorage.getItem('dem00nz_best') || '0'),
  couponsEarned: 0,
  lives:         CONFIG.MAX_LIVES,
  speed:         CONFIG.BASE_SPEED,
  frame:         0,
  lastTime:      0,
  hitTime:       0,           // timestamp of last hit (for invincibility)
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
      localStorage.setItem('dem00nz_best', GS.best);
    }
  },
};

/* ----------------------------------------------------------------
   HUD
---------------------------------------------------------------- */
const HUD = {
  scoreEl:  document.getElementById('scoreVal'),
  bestEl:   document.getElementById('bestVal'),
  livesEl:  document.getElementById('livesVal'),
  update() {
    this.scoreEl.textContent = GS.score;
    this.bestEl.textContent  = GS.best;
    // lives as glyphs
    const full  = '█'.repeat(GS.lives);
    const empty = '░'.repeat(CONFIG.MAX_LIVES - GS.lives);
    this.livesEl.textContent = full + empty;
  },
};

/* ----------------------------------------------------------------
   BACKGROUND — parallax city layers drawn on canvas
   STREET_BACKGROUND placeholder: procedural dark geometry
   Replace with sprite sheets via ASSETS.STREET_BG_*
---------------------------------------------------------------- */
const Background = {
  // Each layer: array of segment objects {x, w, h}
  layers: [[], [], [], []],
  colors: ['#0d0d0d', '#101010', '#131313', '#161616'],
  accents:['#1a1a1a', '#1c1c1c', '#202020', '#252525'],

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
    for (let l = 0; l < 4; l++) {
      const spd = GS.speed * speeds[l];
      for (const seg of this.layers[l]) seg.x -= spd * dt * 60 / 1000;
      // recycle off-screen segments
      const last = this.layers[l][this.layers[l].length - 1];
      if (this.layers[l][0].x + this.layers[l][0].w < 0) {
        const s = this.layers[l].shift();
        s.x = last.x + last.w + randInt(4, 24 - l * 4);
        s.w = randInt(40, 180 - l * 20);
        s.h = randInt(30 + l * 20, 120 + l * 40);
        s.hasWindow = Math.random() > 0.4;
        this.layers[l].push(s);
      }
    }
  },

  draw() {
    // ── STREET_BACKGROUND ──
    if (ASSETS.STREET_BG_FAR && ASSETS.STREET_BG_FAR.complete) {
      ctx.drawImage(ASSETS.STREET_BG_FAR, 0, 0, W, GROUND_Y);
      ctx.fillStyle = '#0f0f0f';
      ctx.fillRect(0, GROUND_Y, W, CONFIG.GROUND_HEIGHT);
      ctx.strokeStyle = '#1e1e1e';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, GROUND_Y);
      ctx.lineTo(W, GROUND_Y);
      ctx.stroke();
    }

   // Sky gradient (only if no background image)
    if (!ASSETS.STREET_BG_FAR || !ASSETS.STREET_BG_FAR.complete) {
      const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
      sky.addColorStop(0,   '#05050a');
      sky.addColorStop(0.7, '#070710');
      sky.addColorStop(1,   '#0a0a0a');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, GROUND_Y);
    }
    // Parallax building layers (far → near)
    for (let l = 0; l < 4; l++) {
      ctx.fillStyle = this.colors[l];
      for (const seg of this.layers[l]) {
        const top = GROUND_Y - seg.h;
        ctx.fillRect(seg.x, top, seg.w, seg.h);
        // small window glints
        if (seg.hasWindow && seg.w > 28) {
          ctx.fillStyle = Math.random() > 0.997
            ? 'rgba(200,255,0,0.25)'   // rare flicker
            : 'rgba(255,255,200,0.04)';
          const wx = seg.x + seg.w * 0.3;
          const wy = top + seg.h * 0.25;
          ctx.fillRect(wx, wy, seg.w * 0.3, seg.h * 0.1);
          ctx.fillStyle = this.colors[l];
        }
      }
    }

    // Ground
    ctx.fillStyle = '#0f0f0f';
    ctx.fillRect(0, GROUND_Y, W, CONFIG.GROUND_HEIGHT);

    // Ground line
    ctx.strokeStyle = '#1e1e1e';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    ctx.lineTo(W, GROUND_Y);
    ctx.stroke();

    // Dashed lane marks (moving)
    const dashOffset = -(GS.frame * GS.speed * 0.5) % 80;
    ctx.setLineDash([40, 40]);
    ctx.lineDashOffset = dashOffset;
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 20);
    ctx.lineTo(W, GROUND_Y + 20);
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

  init() {
    this.x   = W * 0.15;
    this.y   = GROUND_Y - this.h;
    this.vy  = 0;
    this.onGround   = true;
    this.canDoubleJump = true;
    this.jumpCount  = 0;
    this.animFrame  = 0;
    this.animTimer  = 0;
  },

  jump() {
    if (this.onGround) {
      this.vy = CONFIG.JUMP_FORCE;
      this.onGround = false;
      this.jumpCount = 1;
      this.canDoubleJump = true;
      SoundSystem.play('jump');
    } else if (this.canDoubleJump && this.jumpCount < 2) {
      this.vy = CONFIG.DOUBLE_JUMP_FORCE;
      this.canDoubleJump = false;
      this.jumpCount = 2;
      SoundSystem.play('jump', 0.7);
    }
  },

  update(dt) {
    const dtf = dt * 60 / 1000;
    this.vy  += CONFIG.GRAVITY * dtf;
    this.y   += this.vy * dtf;

    if (this.y >= GROUND_Y - this.h) {
      this.y = GROUND_Y - this.h;
      this.vy = 0;
      this.onGround = true;
      this.jumpCount = 0;
      this.canDoubleJump = true;
    } else {
      this.onGround = false;
    }

    // Animate legs
    this.animTimer += dt;
    if (this.onGround && this.animTimer > 100) {
      this.animFrame = (this.animFrame + 1) % 4;
      this.animTimer = 0;
    }
  },

  hitbox() {
    // Slightly inset hitbox for fairness
    return { x: this.x + 4, y: this.y + 4, w: this.w - 8, h: this.h - 4 };
  },

  draw() {
    const px = Math.round(this.x);
    const py = Math.round(this.y);
    const pw = this.w;
    const ph = this.h;

    // ── PLAYER_SPRITE: replace block below with drawImage ──
    // ── PLAYER_SPRITE ──
    const blink = GS.invincible && Math.floor(Date.now() / 80) % 2 === 0;
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
      ctx.arc(px + pw / 2, py + 8, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(px + pw/2 - 4, py + 15, 8, 18);
      ctx.restore();
    }
  },
};

/* ----------------------------------------------------------------
   OBSTACLE POOL
   Obstacle types with conceptual CDMX-urban labels
   Replace drawFn bodies with ctx.drawImage(ASSETS.X_OBSTACLE, ...)
---------------------------------------------------------------- */
const OBSTACLE_TYPES = [
  {
    id:     'DOG_OBSTACLE',
    label:  'perro',
    wMin: 24, wMax: 38,
    hMin: 70, hMax: 70,
    color:  '#2a2a2a',
    accent: '#444444',
    // ground-level
    elevated: false,
    draw(ctx, x, y, w, h) {
      // ── DOG_OBSTACLE (tsuru.webp) ──
      if (ASSETS.DOG_OBSTACLE && ASSETS.DOG_OBSTACLE.complete) {
        const ratio = ASSETS.DOG_OBSTACLE.naturalWidth / ASSETS.DOG_OBSTACLE.naturalHeight;
        const dw = h * ratio;
        ctx.drawImage(ASSETS.DOG_OBSTACLE, x, y, dw, h);
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
    elevated: false,
    draw(ctx, x, y, w, h) {
      // ── POLICE_OBSTACLE (patrulla.webp) ──
      if (ASSETS.POLICE_OBSTACLE && ASSETS.POLICE_OBSTACLE.complete) {
        const ratio = ASSETS.POLICE_OBSTACLE.naturalWidth / ASSETS.POLICE_OBSTACLE.naturalHeight;
        const dw = h * ratio;
        ctx.drawImage(ASSETS.POLICE_OBSTACLE, x, y, dw, h);
      } else {
        ctx.fillStyle = this.color;
        ctx.fillRect(x + w*0.2, y + h*0.3, w*0.6, h*0.5);
        ctx.beginPath();
        ctx.arc(x + w/2, y + h*0.18, w*0.22, 0, Math.PI*2);
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
    accent: '#222222',
    elevated: false,
    draw(ctx, x, y, w, h) {
      // ── POTHOLE_OBSTACLE (grava.webp) ──
      if (ASSETS.POTHOLE_OBSTACLE && ASSETS.POTHOLE_OBSTACLE.complete) {
        const ratio = ASSETS.POTHOLE_OBSTACLE.naturalWidth / ASSETS.POTHOLE_OBSTACLE.naturalHeight;
        const dw = h * ratio;
        ctx.drawImage(ASSETS.POTHOLE_OBSTACLE, x, y, dw, h);
      } else {
        ctx.fillStyle = '#0a0a0a';
        ctx.beginPath();
        ctx.ellipse(x + w/2, y + h/2, w/2, h/2, 0, 0, Math.PI*2);
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
    accent: '#2e2e2e',
    elevated: false,
    draw(ctx, x, y, w, h) {
      // ── MARKET_OBSTACLE (bote.webp) ──
      if (ASSETS.MARKET_OBSTACLE && ASSETS.MARKET_OBSTACLE.complete) {
        const ratio = ASSETS.MARKET_OBSTACLE.naturalWidth / ASSETS.MARKET_OBSTACLE.naturalHeight;
        const dw = h * ratio;
        ctx.drawImage(ASSETS.MARKET_OBSTACLE, x, y, dw, h);
      } else {
        ctx.fillStyle = this.color;
        ctx.fillRect(x + w*0.1, y + h*0.4, w*0.8, h*0.5);
      }
    },
  },
  {
    id:     'CONE_OBSTACLE',
    label:  'cono',
    wMin: 16, wMax: 26,
    hMin: 90, hMax: 90,
    color:  '#1e1e1e',
    accent: '#333333',
    elevated: false,
    draw(ctx, x, y, w, h) {
      // ── CONE_OBSTACLE (poste.webp) ──
      if (ASSETS.CONE_OBSTACLE && ASSETS.CONE_OBSTACLE.complete) {
        const ratio = ASSETS.CONE_OBSTACLE.naturalWidth / ASSETS.CONE_OBSTACLE.naturalHeight;
        const dw = h * ratio;
        ctx.drawImage(ASSETS.CONE_OBSTACLE, x, y, dw, h);
      } else {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.moveTo(x + w/2, y);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x, y + h);
        ctx.closePath();
        ctx.fill();
      }
    },
  },
];

const ObstaclePool = (() => {
  let obstacles = [];
  let spawnTimer = 0;
  let nextSpawn  = 1200;

  function _spawn() {
    const type = OBSTACLE_TYPES[randInt(0, OBSTACLE_TYPES.length - 1)];
    const w = randInt(type.wMin, type.wMax);
    const h = randInt(type.hMin, type.hMax);
    obstacles.push({
      type,
      x: W + 20,
      y: GROUND_Y - h,
      w, h,
      scored: false,
    });
    nextSpawn = rand(CONFIG.OBS_SPAWN_INTERVAL_MIN, CONFIG.OBS_SPAWN_INTERVAL_MAX);
  }

  function init()  { obstacles = []; spawnTimer = 0; nextSpawn = 1400; }

  function update(dt) {
    spawnTimer += dt;
    if (spawnTimer >= nextSpawn) { _spawn(); spawnTimer = 0; }

    for (const o of obstacles) {
      o.x -= GS.speed * dt * 60 / 1000;
      if (!o.scored && o.x + o.w < Player.x) {
        Score.add(1);
        o.scored = true;
      }
    }
    // cull
    obstacles = obstacles.filter(o => o.x + o.w > -10);
  }

  function draw() {
    for (const o of obstacles) {
      ctx.save();
      o.type.draw(ctx, Math.round(o.x), Math.round(o.y), o.w, o.h);
      // debug label (remove in prod)
      // ctx.fillStyle='#333'; ctx.font='8px monospace';
      // ctx.fillText(o.type.label, o.x, o.y - 4);
      ctx.restore();
    }
  }

  function getAll() { return obstacles; }

  return { init, update, draw, getAll };
})();

/* ----------------------------------------------------------------
   COLLECTIBLE POOL
   Two tiers: regular (score) and rare COUPON
   COUPON_ITEM / COIN_ITEM — replace draw blocks with drawImage
---------------------------------------------------------------- */
const CollectiblePool = (() => {
  let items = [];
  let spawnTimer = 0;
  let nextSpawn  = 2000;

  function _spawn() {
    const isCoupon = Math.random() < CONFIG.COUPON_SPAWN_CHANCE;
    const h = 32;
    const w = isCoupon ? 22 : 14;
    const yOff = rand(0, CONFIG.COLLECT_HEIGHT_RANGE);
    items.push({
      type: isCoupon ? 'COUPON' : 'COIN',
      x:  W + 20,
      y:  GROUND_Y - h - 30 - yOff,
      w, h,
      collected: false,
      pulse: 0,
    });
    nextSpawn = rand(1800, 3200);
  }

  function init()  { items = []; spawnTimer = 0; nextSpawn = 2000; }

  function update(dt) {
    spawnTimer += dt;
    if (Math.random() < CONFIG.COLLECT_SPAWN_CHANCE && spawnTimer >= nextSpawn) {
      _spawn(); spawnTimer = 0;
    }
    for (const it of items) {
      it.x -= GS.speed * dt * 60 / 1000;
      it.pulse += dt * 0.005;
    }
    items = items.filter(it => !it.collected && it.x + it.w > -10);
  }

  function draw() {
    for (const it of items) {
      if (it.collected) continue;
      ctx.save();
      const px = Math.round(it.x);
      const py = Math.round(it.y + Math.sin(it.pulse) * 4);

      if (it.type === 'COUPON') {
        // ── COUPON_ITEM: swap below with ctx.drawImage(ASSETS.COUPON_ITEM, px, py, it.w, it.h)
        const glow = Math.abs(Math.sin(it.pulse * 2));
        ctx.shadowColor  = `rgba(255,215,0,${0.4 + glow * 0.4})`;
        ctx.shadowBlur   = 12 + glow * 8;
        ctx.strokeStyle  = `rgba(255,215,0,${0.7 + glow * 0.3})`;
        ctx.lineWidth    = 1.5;
        ctx.strokeRect(px, py, it.w, it.h);
        ctx.fillStyle    = `rgba(255,215,0,${0.08 + glow * 0.06})`;
        ctx.fillRect(px, py, it.w, it.h);
        // star glyph
        ctx.fillStyle = `rgba(255,215,0,${0.8 + glow * 0.2})`;
        ctx.font = `${Math.round(it.h * 0.65)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('★', px + it.w/2, py + it.h/2);
      } else {
        // ── COIN_ITEM (mafia.webp) ──
        if (ASSETS.COIN_ITEM && ASSETS.COIN_ITEM.complete) {
          const ratio = ASSETS.COIN_ITEM.naturalWidth / ASSETS.COIN_ITEM.naturalHeight;
          const dh = it.h;
          const dw = dh * ratio;
          ctx.drawImage(ASSETS.COIN_ITEM, px, py, dw, dh);
        } else {
          ctx.fillStyle = 'rgba(200,255,0,0.7)';
          ctx.font = `${Math.round(it.h * 0.6)}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('◆', px + it.w/2, py + it.h/2 + 1);
        }
      }
      ctx.restore();
    }
  }

  function getAll() { return items; }

  return { init, update, draw, getAll };
})();

/* ----------------------------------------------------------------
   COLLISION — AABB with hitbox shrink for fairness
---------------------------------------------------------------- */
const Collision = {
  aabb(a, b) {
    return a.x < b.x + b.w &&
           a.x + a.w > b.x &&
           a.y < b.y + b.h &&
           a.y + a.h > b.y;
  },

  check() {
    const ph = Player.hitbox();

    // Obstacles
    if (!GS.invincible) {
      for (const o of ObstaclePool.getAll()) {
        const oh = { x: o.x + 4, y: o.y + 4, w: o.w - 8, h: o.h - 8 };
        if (this.aabb(ph, oh)) {
          // patrulla gets special sound
          if (o.type.id === 'POLICE_OBSTACLE') {
            SoundSystem.play('xeso');
          } else {
            SoundSystem.play('hit');
          }
          playerHit();
          return;
        }
      }
    }

    // Collectibles
    for (const it of CollectiblePool.getAll()) {
      if (!it.collected && this.aabb(ph, { x: it.x, y: it.y, w: it.w, h: it.h })) {
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
  update(dt) {
    GS.speed = clamp(
      GS.speed + CONFIG.SPEED_INCREMENT * dt * 60 / 1000,
      CONFIG.BASE_SPEED,
      CONFIG.MAX_SPEED
    );
  },
};

/* ----------------------------------------------------------------
   PARTICLE SYSTEM — minimal dust / hit sparks
---------------------------------------------------------------- */
const Particles = {
  list: [],

  emit(x, y, color, count = 5) {
    for (let i = 0; i < count; i++) {
      this.list.push({
        x, y,
        vx: rand(-3, 3),
        vy: rand(-5, -1),
        life: 1,
        decay: rand(0.02, 0.06),
        r: rand(1.5, 3.5),
        color,
      });
    }
  },

  update(dt) {
    const dtf = dt * 60 / 1000;
    for (const p of this.list) {
      p.x += p.vx * dtf;
      p.y += p.vy * dtf;
      p.vy += 0.2 * dtf;
      p.life -= p.decay * dtf;
    }
    this.list = this.list.filter(p => p.life > 0);
  },

  draw() {
    for (const p of this.list) {
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  },

  reset() { this.list = []; },
};

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
    this.drawSpeedLine();
  },

  drawSpeedLine() {
    // subtle speed streak when fast
    const t = (GS.speed - CONFIG.BASE_SPEED) / (CONFIG.MAX_SPEED - CONFIG.BASE_SPEED);
    if (t < 0.3) return;
    ctx.save();
    ctx.globalAlpha = t * 0.04;
    ctx.fillStyle   = '#c8ff00';
    for (let i = 0; i < 3; i++) {
      const y = rand(GROUND_Y - 40, GROUND_Y - 10);
      ctx.fillRect(0, y, W * rand(0.3, 0.9), 1);
    }
    ctx.restore();
  },
};

/* ----------------------------------------------------------------
   SCREENS
---------------------------------------------------------------- */
const Screens = {
  start:   document.getElementById('startScreen'),
  gameOver:document.getElementById('gameOverScreen'),
  goScore: document.getElementById('goScore'),
  goBest:  document.getElementById('goBest'),
  goCoupons:document.getElementById('goCoupons'),
  tapHint: document.getElementById('tap-hint'),

  showStart() {
    this.start.classList.remove('hidden');
    this.gameOver.classList.add('hidden');
  },
  showGameOver() {
    this.goScore.textContent = GS.score;
    this.goBest.textContent  = GS.best;
    this.goCoupons.textContent = GS.couponsEarned
      ? `★ CUPONES CONSEGUIDOS (mandanos ss a wpp): ${GS.couponsEarned}`
      : '';
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
  GS.running       = true;
  GS.over          = false;
  GS.score         = 0;
  GS.lives         = CONFIG.MAX_LIVES;
  GS.speed         = CONFIG.BASE_SPEED;
  GS.frame         = 0;
  GS.invincible    = false;
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

  // Emit hit particles
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
  SoundSystem.play('game_over');
  setTimeout(() => Screens.showGameOver(), 500);
}

/* ----------------------------------------------------------------
   GAME LOOP
---------------------------------------------------------------- */
function loop(timestamp) {
  if (!GS.running) return;

  const dt = Math.min(timestamp - GS.lastTime, 50); // cap at 50ms
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

/* ----------------------------------------------------------------
   INPUT — keyboard + touch
---------------------------------------------------------------- */
const Input = {
  init() {
    // Keyboard
    window.addEventListener('keydown', (e) => {
      if (['Space','ArrowUp','KeyW'].includes(e.code)) {
        e.preventDefault();
        this.action();
      }
    });

    // Touch — first tap anywhere plays intro (iOS gesture unlock)
    let introPlayed = false;
    function playIntroOnce() {
      if (!introPlayed) {
        introPlayed = true;
        SoundSystem.unlock();
        SoundSystem.play('intro');
      }
    }

    canvas.style.touchAction = 'none';
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      playIntroOnce();
      this.action();
    }, { passive: false });

    // Also catch taps on the start screen overlay (outside canvas)
    document.getElementById('wrapper').addEventListener('touchstart', (e) => {
      playIntroOnce();
    }, { passive: true });

    // Buttons
    const startBtn   = document.getElementById('startBtn');
    const restartBtn = document.getElementById('restartBtn');
    function btnTouch(e) { e.preventDefault(); playIntroOnce(); startGame(); }
    startBtn.addEventListener('touchend',   btnTouch, { passive: false });
    restartBtn.addEventListener('touchend', btnTouch, { passive: false });
    startBtn.addEventListener('click',   () => { SoundSystem.unlock(); startGame(); });
    restartBtn.addEventListener('click', () => { SoundSystem.unlock(); startGame(); });
  },

  action() {
    if (!GS.running && !GS.over) { startGame(); return; }
    if (GS.running) { Player.jump(); }
  },
};

/* ----------------------------------------------------------------
   BOOT
---------------------------------------------------------------- */
Input.init();
Background.init();
Renderer.drawBackground();
Screens.showStart();

// Desktop: try autoplay immediately. iOS: will silently fail,
// intro will play instead on first screen touch (see Input.init).
SoundSystem.play('intro');

// Draw a static frame on start screen
(function staticFrame() {
  Background.draw();
  requestAnimationFrame(staticFrame);
})();

