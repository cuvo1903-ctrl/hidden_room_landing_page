/* ═══════════════════════════════════════════════════════════════
   GOL GANA — game.js
   Hidden Room × Tlalpan Wings House
   Fútbol callejero arcade — CDMX
   ---------------------------------------------------------------
   Secciones:
   01. CONFIGURACIÓN
   02. ESTADO GLOBAL
   03. CANVAS & CONTEXTO
   04. CLASES: Jugador, Balón, Defensa, Powerup, Clara, Partícula
   05. SISTEMA DE COLISIONES
   06. SISTEMA CLARA / AJOLOTE
   07. SISTEMA POWERUPS
   08. DIBUJO DE CANCHA (fondo urbano)
   09. UI / HUD (actualizaciones DOM)
   10. CONTROLES: Teclado + Joystick táctil
   11. SPAWNING (powerups, defensas, Clara)
   12. LÓGICA DE PARTIDA (goles, tiempo)
   13. PARTÍCULAS / EFECTOS VISUALES
   14. GAME LOOP (update + render)
   15. NAVEGACIÓN DE PANTALLAS
   16. INICIALIZACIÓN
═══════════════════════════════════════════════════════════════ */

/* ╔══════════════════════════════════════════════╗
   ║  01. CONFIGURACIÓN                          ║
   ╚══════════════════════════════════════════════╝ */
const CONFIG = {
  // Tiempo de partida en segundos
  MATCH_DURATION: 90,

  // Dimensiones de referencia (la cancha se escala al viewport)
  FIELD_W: 800,
  FIELD_H: 520,

  // Portería
  GOAL_W: 14,
  GOAL_H: 110,

  // Jugador
  PLAYER_SPEED: 190,
  PLAYER_SPRINT_MULT: 1.65,
  PLAYER_RADIUS: 14,
  PLAYER_SHOOT_POWER: 520,

  // Balón
  BALL_RADIUS: 9,
  BALL_FRICTION: 0.87,
  BALL_CARRY_DIST: 22,

  // Defensas
  DEFENDER_SPEED_BASE: 120,
  DEFENDER_RADIUS: 14,
  DEFENDER_STEAL_DIST: 18,
  DEFENDER_COUNT: 3,

  // Powerups
  POWERUP_RADIUS: 14,
  POWERUP_SPAWN_INTERVAL: 8000,  // ms
  POWERUP_LIFETIME: 12000,        // ms

  // Clara
  CLARA_INTERVAL_MIN: 20000,     // ms
  CLARA_INTERVAL_MAX: 35000,
  CLARA_DURATION: 6000,
  CLARA_SPEED: 200,
  CLARA_RADIUS: 16,

  // Ajolote (penalización)
  AJOLOTE_DURATION: 5000,
  AJOLOTE_SPEED_MULT: 0.5,

  // Puntos
  GOAL_POINTS: 100,
  POLLITO_POINTS: 25,
  SALSA_MULT: 2,
  TALACHA_REWARD_MULT: 2,

  // Dificultad creciente: incremento de velocidad de defensas por gol
  DIFFICULTY_SPEED_INC: 8,
};

/* ╔══════════════════════════════════════════════╗
   ║  02. ESTADO GLOBAL                          ║
   ╚══════════════════════════════════════════════╝ */
const STATE = {
  screen: 'menu',       // 'menu'|'playing'|'gameover'
  score: 0,
  goals: 0,
  record: 0,
  timeLeft: CONFIG.MATCH_DURATION,
  multiplier: 1,        // multiplicador activo
  talachaActive: false, // Talacha powerup
  salsaActive: false,   // Salsa nuclear
  salsaTimer: 0,
  ajoloteActive: false, // modo ajolote
  ajoloteTimer: 0,
  claraActive: false,
  claraTimer: 0,
  claraNextIn: 0,
  gameRunning: false,
  lastTimestamp: 0,
  goalFlash: 0,        // ms restantes del flash de gol
  particles: [],
  floatingTexts: [],
  difficultyLevel: 0,
};

/* ╔══════════════════════════════════════════════╗
   ║  03. CANVAS & CONTEXTO                      ║
   ╚══════════════════════════════════════════════╝ */
const canvas  = document.getElementById('gameCanvas');
const ctx     = canvas.getContext('2d');

// Factor de escala para adaptar la cancha al viewport
let scaleX = 1, scaleY = 1;
let offsetX = 0, offsetY = 0;  // márgenes si hay letterboxing

function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  // Escala uniforme manteniendo proporción de la cancha
  scaleX = canvas.width  / CONFIG.FIELD_W;
  scaleY = canvas.height / CONFIG.FIELD_H;
  // Usamos escala no-uniforme para cubrir toda la pantalla (stretch)
  // Si quieres preservar proporción, usa min(scaleX, scaleY)
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Convierte coordenadas de cancha a pantalla
function toScreen(x, y) {
  return { x: x * scaleX, y: y * scaleY };
}

// Convierte pantalla a cancha (para touch)
function toField(sx, sy) {
  return { x: sx / scaleX, y: sy / scaleY };
}

/* ╔══════════════════════════════════════════════╗
   ║  04. CLASES                                 ║
   ╚══════════════════════════════════════════════╝ */

/* ── Jugador ────────────────────────────────────── */
class Player {
  constructor() {
    this.x = CONFIG.FIELD_W * 0.35;
    this.y = CONFIG.FIELD_H * 0.5;
    this.vx = 0;
    this.vy = 0;
    this.radius = CONFIG.PLAYER_RADIUS;
    this.hasBall = true;
    this.facing = 1;        // 1=derecha, -1=izquierda
    this.animFrame = 0;
    this.animTimer = 0;
    this.kickAnim = 0;      // 0-1, animación de disparo
    this.color = '#FFD600'; // amarillo barrio
    this.shirtColor = '#1565C0'; // azul México
  }

  update(dt, input) {
    const baseSpeed = STATE.ajoloteActive
      ? CONFIG.PLAYER_SPEED * CONFIG.AJOLOTE_SPEED_MULT
      : CONFIG.PLAYER_SPEED;
    const speed = input.sprint
      ? baseSpeed * CONFIG.PLAYER_SPRINT_MULT
      : baseSpeed;

    let dx = 0, dy = 0;

    // Joystick o teclado
    if (input.jx !== 0 || input.jy !== 0) {
      dx = input.jx; dy = input.jy;
    } else {
      if (input.left)  dx -= 1;
      if (input.right) dx += 1;
      if (input.up)    dy -= 1;
      if (input.down)  dy += 1;
    }

    // Normalizar diagonal
    const len = Math.hypot(dx, dy);
    if (len > 0) { dx /= len; dy /= len; }

    // En modo ajolote: disparo/movimiento chueco
    if (STATE.ajoloteActive) {
      dx += (Math.random() - 0.5) * 0.4;
      dy += (Math.random() - 0.5) * 0.4;
    }

    this.vx = dx * speed;
    this.vy = dy * speed;

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (dx !== 0) this.facing = dx > 0 ? 1 : -1;

    // Mantener dentro de la cancha
    this.x = Math.max(this.radius, Math.min(CONFIG.FIELD_W - this.radius, this.x));
    this.y = Math.max(this.radius, Math.min(CONFIG.FIELD_H - this.radius, this.y));

    // Animación de pasos
    if (len > 0) {
      this.animTimer += dt;
      if (this.animTimer > 0.12) { this.animTimer = 0; this.animFrame = (this.animFrame + 1) % 4; }
    }

    // Animación de disparo
    if (this.kickAnim > 0) this.kickAnim = Math.max(0, this.kickAnim - dt * 5);
  }

  draw() {
    const { x, y } = toScreen(this.x, this.y);
    const r = this.radius * scaleX;

    ctx.save();
    ctx.translate(x, y);

    // Sombra
    ctx.beginPath();
    ctx.ellipse(0, r * 0.6, r * 0.85, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();

    // Modo ajolote: color rosado con branquias
    const bodyColor = STATE.ajoloteActive ? '#FF8A80' : this.shirtColor;
    const skinColor = STATE.ajoloteActive ? '#FFCDD2' : '#FDBCB4';

    // Cuerpo (camiseta)
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = bodyColor;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Número en camiseta o símbolo ajolote
    ctx.fillStyle = '#FFF';
    ctx.font = `bold ${r * 0.7}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(STATE.ajoloteActive ? '🦎' : '10', 0, 0);

    // Cabeza
    const headX = this.facing * r * 0.55;
    const headY = -r * 0.6;
    ctx.beginPath();
    ctx.arc(headX, headY, r * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = skinColor;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Branquias en modo ajolote
    if (STATE.ajoloteActive) {
      ctx.strokeStyle = '#FF5252';
      ctx.lineWidth = 2;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(headX, headY - r * 0.35);
        ctx.lineTo(headX + i * r * 0.3, headY - r * 0.65);
        ctx.stroke();
      }
    }

    // Piernas (animación)
    const legSwing = Math.sin(this.animFrame * Math.PI / 2) * r * 0.35;
    const kickOffset = this.kickAnim * this.facing * r * 0.7;
    ctx.strokeStyle = STATE.ajoloteActive ? '#EF9A9A' : '#0D47A1';
    ctx.lineWidth = r * 0.38;
    ctx.lineCap = 'round';
    // Pierna izquierda
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, r * 0.5);
    ctx.lineTo(-r * 0.2 + legSwing, r);
    ctx.stroke();
    // Pierna derecha (con kick)
    ctx.beginPath();
    ctx.moveTo(r * 0.2, r * 0.5);
    ctx.lineTo(r * 0.2 - legSwing + kickOffset, r);
    ctx.stroke();

    ctx.restore();
  }

  shoot() {
    this.kickAnim = 1;
  }
}

/* ── Balón ──────────────────────────────────────── */
class Ball {
  constructor() {
    this.x = CONFIG.FIELD_W * 0.5;
    this.y = CONFIG.FIELD_H * 0.5;
    this.vx = 0;
    this.vy = 0;
    this.radius = CONFIG.BALL_RADIUS;
    this.spin = 0;
    this.spinDecay = 0.97;
    this.free = false; // true cuando no lo lleva el jugador
  }

  reset() {
    this.x = CONFIG.FIELD_W * 0.5;
    this.y = CONFIG.FIELD_H * 0.5;
    this.vx = 0; this.vy = 0;
    this.free = false;
    this.spin = 0;
  }

  update(dt) {
    if (!this.free) return;

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Fricción
    this.vx *= CONFIG.BALL_FRICTION;
    this.vy *= CONFIG.BALL_FRICTION;

    // Rebote en paredes laterales (no en goles)
    const goalY1 = CONFIG.FIELD_H * 0.5 - CONFIG.GOAL_H / 2;
    const goalY2 = CONFIG.FIELD_H * 0.5 + CONFIG.GOAL_H / 2;
    const inGoalY = (this.y >= goalY1 && this.y <= goalY2);

    if (this.x - this.radius < 0) {
      if (!inGoalY) {
        this.x = this.radius;
        this.vx *= -0.6;
        this.spin = this.vx * 0.5;
      }
    }
    if (this.x + this.radius > CONFIG.FIELD_W) {
      if (!inGoalY) {
        this.x = CONFIG.FIELD_W - this.radius;
        this.vx *= -0.6;
        this.spin = this.vx * 0.5;
      }
    }
    if (this.y - this.radius < 0) {
      this.y = this.radius;
      this.vy *= -0.6;
    }
    if (this.y + this.radius > CONFIG.FIELD_H) {
      this.y = CONFIG.FIELD_H - this.radius;
      this.vy *= -0.6;
    }

    // Si la velocidad es muy baja, se detiene
    if (Math.hypot(this.vx, this.vy) < 8) {
      this.vx *= 0.9;
      this.vy *= 0.9;
      if (Math.hypot(this.vx, this.vy) < 2) {
        this.vx = 0; this.vy = 0;
      }
    }

    this.spin *= this.spinDecay;
  }

  draw() {
    const { x, y } = toScreen(this.x, this.y);
    const r = this.radius * ((scaleX + scaleY) / 2);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this.spin);

    // Sombra
    ctx.beginPath();
    ctx.ellipse(0, r * 0.7, r * 0.8, r * 0.28, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fill();

    // Balón base
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = '#F5F5F5';
    ctx.fill();

    // Parches negros del balón
    ctx.fillStyle = '#111';
    const patches = [
      [0, -r * 0.5, r * 0.28],
      [-r * 0.42, r * 0.22, r * 0.22],
      [r * 0.42, r * 0.22, r * 0.22],
    ];
    patches.forEach(([px, py, pr]) => {
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();
    });

    // Brillo
    ctx.beginPath();
    ctx.arc(-r * 0.28, -r * 0.3, r * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fill();

    ctx.restore();
  }
}

/* ── Defensa (IA) ───────────────────────────────── */
class Defender {
  constructor(x, y, colorShirt) {
    this.x = x;
    this.y = y;
    this.baseX = x; // posición de origen para reset
    this.baseY = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = CONFIG.DEFENDER_RADIUS;
    this.colorShirt = colorShirt || '#B71C1C';
    this.speed = CONFIG.DEFENDER_SPEED_BASE;
    this.stateAI = 'patrol'; // patrol | chase | block | idle
    this.patrolAngle = Math.random() * Math.PI * 2;
    this.stunTimer = 0;    // stunned after losing ball
    this.animFrame = 0;
    this.animTimer = 0;
    this.facing = -1;
  }

  reset() {
    this.x = this.baseX;
    this.y = this.baseY;
    this.vx = 0; this.vy = 0;
    this.stateAI = 'patrol';
  }

  update(dt, player, ball) {
    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
      this.vx *= 0.9; this.vy *= 0.9;
      return;
    }

    const speed = this.speed + STATE.difficultyLevel * CONFIG.DIFFICULTY_SPEED_INC;

    let targetX, targetY;

    if (!ball.free) {
      // Jugador lleva el balón: perseguir
      this.stateAI = 'chase';
      targetX = player.x;
      targetY = player.y;
    } else {
      // Balón libre: ir al balón
      this.stateAI = 'block';
      targetX = ball.x;
      targetY = ball.y;
    }

    // Patrulla si está muy lejos y sin balón libre
    const distToPlayer = Math.hypot(player.x - this.x, player.y - this.y);
    if (ball.free && Math.hypot(ball.x - this.x, ball.y - this.y) > 300) {
      this.stateAI = 'patrol';
      targetX = CONFIG.FIELD_W * 0.6 + Math.cos(this.patrolAngle) * 80;
      targetY = CONFIG.FIELD_H * 0.5 + Math.sin(this.patrolAngle) * 80;
      this.patrolAngle += dt * 0.5;
    }

    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const dist = Math.hypot(dx, dy);

    if (dist > 5) {
      this.vx = (dx / dist) * speed;
      this.vy = (dy / dist) * speed;
      if (dx !== 0) this.facing = dx > 0 ? 1 : -1;
    } else {
      this.vx = 0; this.vy = 0;
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Bounds
    this.x = Math.max(this.radius, Math.min(CONFIG.FIELD_W - this.radius, this.x));
    this.y = Math.max(this.radius, Math.min(CONFIG.FIELD_H - this.radius, this.y));

    // Animación
    if (Math.hypot(this.vx, this.vy) > 5) {
      this.animTimer += dt;
      if (this.animTimer > 0.13) { this.animTimer = 0; this.animFrame = (this.animFrame + 1) % 4; }
    }
  }

  draw() {
    const { x, y } = toScreen(this.x, this.y);
    const r = this.radius * scaleX;

    ctx.save();
    ctx.translate(x, y);

    // Sombra
    ctx.beginPath();
    ctx.ellipse(0, r * 0.6, r * 0.85, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();

    // Cuerpo
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = this.stateAI === 'chase' ? '#D50000' : this.colorShirt;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Numero
    ctx.fillStyle = '#FFF';
    ctx.font = `bold ${r * 0.65}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('👊', 0, 0);

    // Cabeza
    const headX = this.facing * r * 0.5;
    const headY = -r * 0.58;
    ctx.beginPath();
    ctx.arc(headX, headY, r * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = '#D7A57A';
    ctx.fill();

    // Piernas
    const legSwing = Math.sin(this.animFrame * Math.PI / 2) * r * 0.35;
    ctx.strokeStyle = '#7B1FA2';
    ctx.lineWidth = r * 0.35;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-r*0.2, r*0.5); ctx.lineTo(-r*0.2+legSwing, r); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(r*0.2, r*0.5);  ctx.lineTo(r*0.2-legSwing, r);  ctx.stroke();

    // Indicador de "stun"
    if (this.stunTimer > 0) {
      ctx.font = `${r * 0.7}px Arial`;
      ctx.textAlign = 'center';
      ctx.fillText('💫', 0, -r * 1.3);
    }

    ctx.restore();
  }
}

/* ── Powerup ─────────────────────────────────────── */
class Powerup {
  constructor(type, x, y) {
    this.type = type;       // 'pollito'|'salsa'|'talacha'
    this.x = x;
    this.y = y;
    this.radius = CONFIG.POWERUP_RADIUS;
    this.lifetime = CONFIG.POWERUP_LIFETIME;
    this.age = 0;
    this.bob = 0;           // fase de animación flotante
    this.collected = false;
  }

  update(dt) {
    this.age += dt * 1000;
    this.bob += dt * 3;
    if (this.age > this.lifetime) this.collected = true;
  }

  draw() {
    if (this.collected) return;
    const fade = this.age > this.lifetime * 0.7
      ? 1 - (this.age - this.lifetime * 0.7) / (this.lifetime * 0.3)
      : 1;
    const bobY = Math.sin(this.bob) * 5;
    const { x, y } = toScreen(this.x, this.y + bobY);
    const r = this.radius * ((scaleX + scaleY) / 2);

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(x, y);

    // Glow según tipo
    const glowColor = this.type === 'pollito'  ? '#FFD600'
                    : this.type === 'salsa'     ? '#FF6D00'
                    : '#00C853';
    const radGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.8);
    radGrad.addColorStop(0, glowColor + '55');
    radGrad.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.8, 0, Math.PI * 2);
    ctx.fillStyle = radGrad;
    ctx.fill();

    // Círculo base
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = glowColor;
    ctx.fill();
    ctx.strokeStyle = '#FFF';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Emoji / símbolo
    ctx.font = `${r * 1.1}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const icon = this.type === 'pollito'  ? '🐔'
               : this.type === 'salsa'    ? '🌶️'
               : '🔧';
    ctx.fillText(icon, 0, 0);

    ctx.restore();
  }
}

/* ── Clara ──────────────────────────────────────── */
class Clara {
  constructor() {
    this.active = false;
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.radius = CONFIG.CLARA_RADIUS;
    this.timer = 0;
    this.wave = 0;
  }

  spawn() {
    // Aparece desde un borde aleatorio
    const side = Math.floor(Math.random() * 4);
    if (side === 0) { this.x = -20; this.y = Math.random() * CONFIG.FIELD_H; }
    else if (side === 1) { this.x = CONFIG.FIELD_W + 20; this.y = Math.random() * CONFIG.FIELD_H; }
    else if (side === 2) { this.x = Math.random() * CONFIG.FIELD_W; this.y = -20; }
    else { this.x = Math.random() * CONFIG.FIELD_W; this.y = CONFIG.FIELD_H + 20; }

    this.active = true;
    this.timer = CONFIG.CLARA_DURATION;
    showFloatingText('¡LLEGÓ CLARA!', CONFIG.FIELD_W / 2, 80, '#FF1744', 40, 3000);
  }

  update(dt, player) {
    if (!this.active) return;

    this.timer -= dt * 1000;
    this.wave += dt * 4;

    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 5) {
      this.x += (dx / dist) * CONFIG.CLARA_SPEED * dt;
      this.y += (dy / dist) * CONFIG.CLARA_SPEED * dt;
    }

    if (this.timer <= 0) {
      this.active = false;
    }
  }

  draw() {
    if (!this.active) return;
    const wob = Math.sin(this.wave) * 3;
    const { x, y } = toScreen(this.x, this.y + wob);
    const r = this.radius * ((scaleX + scaleY) / 2);

    ctx.save();
    ctx.translate(x, y);

    // Aura amenazante
    const alpha = 0.3 + Math.abs(Math.sin(this.wave)) * 0.3;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(213,0,0,${alpha})`;
    ctx.fill();

    // Cuerpo Clara
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = '#C62828';
    ctx.fill();
    ctx.strokeStyle = '#FF1744';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Cabeza
    ctx.beginPath();
    ctx.arc(0, -r * 0.55, r * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = '#FFCCBC';
    ctx.fill();

    // Símbolo
    ctx.font = `${r * 0.7}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('😈', 0, -r * 0.55);

    // Label
    ctx.font = `bold ${r * 0.55}px Arial Black`;
    ctx.fillStyle = '#FF1744';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 4;
    ctx.fillText('CLARA', 0, r * 1.6);

    // Timer bar
    const pct = Math.max(0, this.timer / CONFIG.CLARA_DURATION);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(-r, r * 1.1, r * 2, 4);
    ctx.fillStyle = '#FF1744';
    ctx.fillRect(-r, r * 1.1, r * 2 * pct, 4);

    ctx.restore();
  }
}

/* ── Partícula ──────────────────────────────────── */
class Particle {
  constructor(x, y, vx, vy, color, size, life) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.color = color;
    this.size = size;
    this.life = life;
    this.maxLife = life;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += 200 * dt; // gravedad ligera
    this.vx *= 0.95;
    this.life -= dt;
  }

  draw() {
    const alpha = Math.max(0, this.life / this.maxLife);
    const { x, y } = toScreen(this.x, this.y);
    const s = this.size * alpha * ((scaleX + scaleY) / 2);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/* ── Texto flotante ─────────────────────────────── */
class FloatingText {
  constructor(text, x, y, color, size, duration) {
    this.text = text;
    this.x = x; this.y = y;
    this.color = color;
    this.size = size;
    this.duration = duration;
    this.life = duration;
    this.vy = -50;
  }

  update(dt) {
    this.life -= dt * 1000;
    this.y += this.vy * dt;
    this.vy *= 0.96;
  }

  draw() {
    const alpha = Math.min(1, this.life / (this.duration * 0.4));
    const { x, y } = toScreen(this.x, this.y);
    const sz = this.size * ((scaleX + scaleY) / 2);

    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.font = `900 ${sz}px 'Arial Black', Impact, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = sz * 0.12;
    ctx.strokeText(this.text, x, y);
    ctx.fillStyle = this.color;
    ctx.fillText(this.text, x, y);
    ctx.restore();
  }
}

/* ╔══════════════════════════════════════════════╗
   ║  05. SISTEMA DE COLISIONES                  ║
   ╚══════════════════════════════════════════════╝ */
function circleCollide(ax, ay, ar, bx, by, br) {
  return Math.hypot(ax - bx, ay - by) < ar + br;
}

function separateCircles(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 0.01;
  const overlap = (a.radius + b.radius) - dist;
  if (overlap > 0) {
    const nx = dx / dist, ny = dy / dist;
    a.x -= nx * overlap * 0.5;
    a.y -= ny * overlap * 0.5;
    b.x += nx * overlap * 0.5;
    b.y += ny * overlap * 0.5;
  }
}

/* ╔══════════════════════════════════════════════╗
   ║  06. SISTEMA CLARA / AJOLOTE                ║
   ╚══════════════════════════════════════════════╝ */
function activateAjolote() {
  STATE.ajoloteActive = true;
  STATE.ajoloteTimer = CONFIG.AJOLOTE_DURATION;
  showFloatingText('¡HAS SIDO AJOLOTIZADO!', CONFIG.FIELD_W / 2, 140, '#FF80AB', 28, 3500);
  spawnParticles(player.x, player.y, 20, '#FF80AB');
}

function updateAjolote(dt) {
  if (!STATE.ajoloteActive) return;
  STATE.ajoloteTimer -= dt * 1000;
  if (STATE.ajoloteTimer <= 0) {
    STATE.ajoloteActive = false;
    showFloatingText('¡DE VUELTA!', CONFIG.FIELD_W / 2, 160, '#00C853', 24, 2000);
  }
}

/* ╔══════════════════════════════════════════════╗
   ║  07. SISTEMA POWERUPS                       ║
   ╚══════════════════════════════════════════════╝ */
const POWERUP_TYPES = ['pollito', 'pollito', 'pollito', 'salsa', 'talacha'];
let powerups = [];
let powerupTimer = 0;

function spawnPowerup() {
  const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
  const margin = 60;
  const x = margin + Math.random() * (CONFIG.FIELD_W - margin * 2);
  const y = margin + Math.random() * (CONFIG.FIELD_H - margin * 2);
  powerups.push(new Powerup(type, x, y));
}

function collectPowerup(p) {
  p.collected = true;
  const rewardMult = STATE.talachaActive ? CONFIG.TALACHA_REWARD_MULT : 1;

  if (p.type === 'pollito') {
    const pts = CONFIG.POLLITO_POINTS * STATE.multiplier * rewardMult;
    addScore(pts);
    STATE.multiplier = Math.min(8, STATE.multiplier + 0.5);
    spawnParticles(p.x, p.y, 12, '#FFD600');
    showFloatingText(`+${pts} 🐔`, p.x, p.y - 20, '#FFD600', 22, 1500);
    updateHudMult();
  } else if (p.type === 'salsa') {
    STATE.salsaActive = true;
    STATE.salsaTimer = 8000;
    STATE.multiplier = Math.min(8, STATE.multiplier * CONFIG.SALSA_MULT);
    spawnParticles(p.x, p.y, 16, '#FF6D00');
    showFloatingText('🌶️ SALSA NUCLEAR ×2', p.x, p.y - 20, '#FF6D00', 24, 2500);
    updateHudMult();
  } else if (p.type === 'talacha') {
    STATE.talachaActive = true;
    showFloatingText('🔧 TALACHA 2×', p.x, p.y - 20, '#00C853', 24, 2500);
    spawnParticles(p.x, p.y, 14, '#00C853');
  }
}

function updateSalsa(dt) {
  if (!STATE.salsaActive) return;
  STATE.salsaTimer -= dt * 1000;
  if (STATE.salsaTimer <= 0) {
    STATE.salsaActive = false;
    // Rebajar multiplicador
    STATE.multiplier = Math.max(1, STATE.multiplier / CONFIG.SALSA_MULT);
    updateHudMult();
  }
}

/* ╔══════════════════════════════════════════════╗
   ║  08. DIBUJO DE CANCHA URBANA                ║
   ╚══════════════════════════════════════════════╝ */
// Generamos la cancha con Canvas 2D puro

function drawField() {
  const W = canvas.width, H = canvas.height;
  const FW = CONFIG.FIELD_W, FH = CONFIG.FIELD_H;

  // ── Fondo general (cielo nocturno de CDMX) ──
  const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
  skyGrad.addColorStop(0, '#1A1A2E');
  skyGrad.addColorStop(0.6, '#16213E');
  skyGrad.addColorStop(1, '#0F3460');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H);

  // ── Metro de CDMX al fondo (silueta) ──
  drawMetroBackground();

  // ── Piso de cemento (la cancha) ──
  drawConcretePitch();

  // ── Graffiti en bardas ──
  drawGraffiti();

  // ── Mesas de alitas alrededor ──
  drawWingsTables();

  // ── Porterías improvisadas ──
  drawGoals();

  // ── Líneas de la cancha ──
  drawFieldLines();
}

function drawMetroBackground() {
  const W = canvas.width, H = canvas.height;

  // Silueta de edificios / metro
  ctx.fillStyle = '#0D1117';
  const buildings = [
    [0, 0.55, 0.08, 0.3],
    [0.06, 0.5, 0.09, 0.28],
    [0.13, 0.52, 0.07, 0.25],
    [0.22, 0.48, 0.12, 0.32],
    [0.36, 0.52, 0.07, 0.26],
    [0.45, 0.46, 0.10, 0.34],
    [0.57, 0.50, 0.08, 0.28],
    [0.67, 0.53, 0.11, 0.25],
    [0.80, 0.49, 0.09, 0.31],
    [0.91, 0.52, 0.09, 0.28],
  ];
  buildings.forEach(([bx, by, bw, bh]) => {
    ctx.fillRect(bx * W, by * H, bw * W, bh * H);
    // Ventanas
    ctx.fillStyle = 'rgba(255,214,0,0.3)';
    for (let wy = by * H + 6; wy < (by + bh) * H - 6; wy += 10) {
      for (let wx = bx * W + 4; wx < (bx + bw) * W - 4; wx += 8) {
        if (Math.random() > 0.5) ctx.fillRect(wx, wy, 4, 5);
      }
    }
    ctx.fillStyle = '#0D1117';
  });

  // Tren del metro (silueta)
  ctx.fillStyle = '#B71C1C';
  ctx.fillRect(W * 0.1, H * 0.48, W * 0.35, H * 0.06);
  ctx.fillStyle = '#D32F2F';
  ctx.fillRect(W * 0.1, H * 0.48, W * 0.35, H * 0.025);
  // Ventanas del metro
  ctx.fillStyle = 'rgba(255,235,59,0.6)';
  for (let i = 0; i < 8; i++) {
    ctx.fillRect(W * (0.12 + i * 0.04), H * 0.484, W * 0.025, H * 0.02);
  }
  // Logo metro M
  ctx.fillStyle = '#FFD600';
  ctx.font = `bold ${H * 0.025}px Arial Black`;
  ctx.textAlign = 'center';
  ctx.fillText('Ⓜ', W * 0.28, H * 0.51);
}

function drawConcretePitch() {
  const W = canvas.width, H = canvas.height;

  // Piso de cemento con textura
  const groundGrad = ctx.createLinearGradient(0, H * 0.52, 0, H);
  groundGrad.addColorStop(0, '#3A3A3A');
  groundGrad.addColorStop(0.5, '#2E2E2E');
  groundGrad.addColorStop(1, '#262626');
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, H * 0.52, W, H * 0.48);

  // Grietas y textura de cemento
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  const cracks = [
    [[0.1, 0.6], [0.25, 0.75], [0.3, 0.9]],
    [[0.5, 0.55], [0.55, 0.65], [0.6, 0.8]],
    [[0.75, 0.7], [0.8, 0.85], [0.85, 0.95]],
  ];
  cracks.forEach(pts => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * W, pts[0][1] * H);
    pts.slice(1).forEach(p => ctx.lineTo(p[0] * W, p[1] * H));
    ctx.stroke();
  });

  // Manchas de aceite / humedad
  for (let i = 0; i < 8; i++) {
    const mx = (0.05 + i * 0.12) * W;
    const my = (0.6 + (i % 3) * 0.12) * H;
    ctx.beginPath();
    ctx.ellipse(mx, my, W * 0.03, H * 0.02, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fill();
  }
}

function drawGraffiti() {
  const W = canvas.width, H = canvas.height;

  // Barda izquierda
  ctx.fillStyle = '#2D2D2D';
  ctx.fillRect(0, H * 0.15, W * 0.06, H * 0.55);

  // Graffiti text CDMX
  ctx.save();
  ctx.translate(W * 0.03, H * 0.38);
  ctx.rotate(-Math.PI / 2);
  ctx.font = `bold ${H * 0.028}px 'Arial Black'`;
  ctx.fillStyle = '#E53935';
  ctx.textAlign = 'center';
  ctx.fillText('CDMX', 0, 0);
  ctx.restore();

  // Barda derecha
  ctx.fillStyle = '#2D2D2D';
  ctx.fillRect(W * 0.94, H * 0.15, W * 0.06, H * 0.55);

  ctx.save();
  ctx.translate(W * 0.97, H * 0.42);
  ctx.rotate(Math.PI / 2);
  ctx.font = `bold ${H * 0.025}px 'Arial Black'`;
  ctx.fillStyle = '#00C853';
  ctx.textAlign = 'center';
  ctx.fillText('GOL', 0, 0);
  ctx.fillText('GANA', 0, H * 0.03);
  ctx.restore();

  // Barda superior con graffiti
  ctx.fillStyle = '#252525';
  ctx.fillRect(W * 0.06, H * 0.05, W * 0.88, H * 0.1);

  // Texto spray en barda
  const tags = ['⚽', 'TW', 'HR', '#GOL', 'BARRIO'];
  tags.forEach((tag, i) => {
    const tx = W * (0.12 + i * 0.17);
    const ty = H * 0.11;
    const colors = ['#FFD600', '#F44336', '#00C853', '#2196F3', '#FF9800'];
    ctx.font = `bold ${H * 0.04}px 'Arial Black'`;
    ctx.fillStyle = colors[i];
    ctx.globalAlpha = 0.7 + Math.sin(i) * 0.2;
    ctx.textAlign = 'center';
    ctx.fillText(tag, tx, ty);
    ctx.globalAlpha = 1;
  });
}

function drawWingsTables() {
  const W = canvas.width, H = canvas.height;

  // Mesas de alitas — lado inferior
  const tablePositions = [0.1, 0.3, 0.55, 0.75, 0.9];
  tablePositions.forEach(tx => {
    const x = tx * W;
    const y = H * 0.88;

    // Mesa
    ctx.fillStyle = '#5D4037';
    ctx.fillRect(x - W * 0.04, y, W * 0.08, H * 0.06);
    ctx.fillStyle = '#795548';
    ctx.fillRect(x - W * 0.045, y - H * 0.01, W * 0.09, H * 0.015);

    // Patas
    ctx.fillStyle = '#4E342E';
    ctx.fillRect(x - W * 0.035, y + H * 0.06, W * 0.008, H * 0.04);
    ctx.fillRect(x + W * 0.027, y + H * 0.06, W * 0.008, H * 0.04);

    // Alitas encima de la mesa
    ctx.font = `${H * 0.025}px Arial`;
    ctx.textAlign = 'center';
    ctx.fillText('🍗', x - W * 0.015, y - H * 0.005);
    ctx.fillText('🍺', x + W * 0.015, y - H * 0.005);

    // Personas sentadas (siluetas simples)
    [-1, 1].forEach(side => {
      const px = x + side * W * 0.055;
      const py = y;
      ctx.beginPath();
      ctx.arc(px, py - H * 0.025, H * 0.02, 0, Math.PI * 2);
      ctx.fillStyle = '#555';
      ctx.fill();
      ctx.fillRect(px - W * 0.008, py - H * 0.005, W * 0.016, H * 0.03);
    });
  });

  // Letrero "Tlalpan Wings House"
  ctx.fillStyle = '#B71C1C';
  ctx.fillRect(W * 0.35, H * 0.06, W * 0.3, H * 0.045);
  ctx.fillStyle = '#FFD600';
  ctx.font = `bold ${H * 0.018}px 'Arial Black'`;
  ctx.textAlign = 'center';
  ctx.fillText('🍗 TLALPAN WINGS HOUSE 🍗', W * 0.5, H * 0.087);
}

function drawGoals() {
  const W = canvas.width, H = canvas.height;
  const gH = CONFIG.GOAL_H * scaleY;
  const gY = CONFIG.FIELD_H * 0.5 * scaleY - gH / 2;

  // Portería izquierda — botes de basura + piedras
  const lx = 0;
  // Bote 1 (arriba)
  drawTrashCan(lx + W * 0.006, gY - H * 0.01);
  // Bote 2 (abajo)
  drawTrashCan(lx + W * 0.006, gY + gH - H * 0.045);
  // Área de portería (tenue)
  ctx.fillStyle = 'rgba(0,200,83,0.06)';
  ctx.fillRect(0, gY, CONFIG.GOAL_W * scaleX, gH);
  ctx.strokeStyle = 'rgba(0,200,83,0.4)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, gY, CONFIG.GOAL_W * scaleX, gH);

  // Portería derecha — misma cosa
  const rx = W - CONFIG.GOAL_W * scaleX;
  drawTrashCan(rx + W * 0.008, gY - H * 0.01);
  drawTrashCan(rx + W * 0.008, gY + gH - H * 0.045);
  ctx.fillStyle = 'rgba(0,200,83,0.06)';
  ctx.fillRect(rx, gY, CONFIG.GOAL_W * scaleX, gH);
  ctx.strokeStyle = 'rgba(0,200,83,0.4)';
  ctx.lineWidth = 2;
  ctx.strokeRect(rx, gY, CONFIG.GOAL_W * scaleX, gH);
}

function drawTrashCan(x, y) {
  const W = canvas.width, H = canvas.height;
  const cw = W * 0.025, ch = H * 0.055;

  // Bote
  ctx.fillStyle = '#444';
  ctx.fillRect(x, y, cw, ch);
  ctx.fillStyle = '#555';
  ctx.fillRect(x, y, cw, ch * 0.15); // tapa

  // Rayas
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + cw * 0.3, y + ch * 0.2); ctx.lineTo(x + cw * 0.3, y + ch); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + cw * 0.65, y + ch * 0.2); ctx.lineTo(x + cw * 0.65, y + ch); ctx.stroke();
}

function drawFieldLines() {
  const W = canvas.width, H = canvas.height;

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 8]);

  // Línea central
  ctx.beginPath();
  ctx.moveTo(W * 0.5, H * 0.54);
  ctx.lineTo(W * 0.5, H);
  ctx.stroke();

  // Círculo central
  ctx.beginPath();
  ctx.arc(W * 0.5, H * 0.72, H * 0.1, 0, Math.PI * 2);
  ctx.stroke();

  // Áreas de penalti
  ctx.strokeRect(W * 0.06, H * 0.6, W * 0.12, H * 0.28);
  ctx.strokeRect(W * 0.82, H * 0.6, W * 0.12, H * 0.28);

  ctx.setLineDash([]);
  ctx.restore();
}

/* ╔══════════════════════════════════════════════╗
   ║  09. UI / HUD                               ║
   ╚══════════════════════════════════════════════╝ */
function updateHUD() {
  document.getElementById('hud-goals').textContent = STATE.goals;
  document.getElementById('hud-score').textContent = STATE.score;
  document.getElementById('hud-time').textContent = Math.ceil(STATE.timeLeft);

  // Color rojo cuando quedan ≤10s
  const timeEl = document.getElementById('hud-time');
  timeEl.style.color = STATE.timeLeft <= 10 ? '#FF1744' : '#FFD600';
}

function updateHudMult() {
  const el = document.getElementById('hud-mult');
  if (STATE.multiplier > 1) {
    el.style.display = 'block';
    el.textContent = `×${STATE.multiplier.toFixed(1)}`;
    el.style.color = STATE.salsaActive ? '#FF6D00' : '#00C853';
    el.style.borderColor = STATE.salsaActive ? '#FF6D00' : '#00C853';
  } else {
    el.style.display = 'none';
  }
}

function addScore(pts) {
  const total = Math.round(pts * STATE.multiplier);
  STATE.score += total;
  updateHUD();
}

function showFloatingText(text, x, y, color, size, duration) {
  STATE.floatingTexts.push(new FloatingText(text, x, y, color, size, duration));
}

/* ╔══════════════════════════════════════════════╗
   ║  10. CONTROLES: Teclado + Joystick táctil   ║
   ╚══════════════════════════════════════════════╝ */
const INPUT = {
  left: false, right: false, up: false, down: false,
  shoot: false, sprint: false,
  jx: 0, jy: 0,           // joystick virtual
  shootPressed: false,
};

// Joystick state
const JOY = {
  active: false,
  startX: 0, startY: 0,
  maxRadius: 40,
};

document.addEventListener('keydown', e => {
  if (!STATE.gameRunning) return;
  switch (e.code) {
    case 'ArrowLeft':  case 'KeyA': INPUT.left  = true; break;
    case 'ArrowRight': case 'KeyD': INPUT.right = true; break;
    case 'ArrowUp':    case 'KeyW': INPUT.up    = true; break;
    case 'ArrowDown':  case 'KeyS': INPUT.down  = true; break;
    case 'Space':  e.preventDefault(); INPUT.shoot = true; INPUT.shootPressed = true; break;
    case 'ShiftLeft': case 'ShiftRight': INPUT.sprint = true; break;
  }
});

document.addEventListener('keyup', e => {
  switch (e.code) {
    case 'ArrowLeft':  case 'KeyA': INPUT.left  = false; break;
    case 'ArrowRight': case 'KeyD': INPUT.right = false; break;
    case 'ArrowUp':    case 'KeyW': INPUT.up    = false; break;
    case 'ArrowDown':  case 'KeyS': INPUT.down  = false; break;
    case 'Space':  INPUT.shoot = false; break;
    case 'ShiftLeft': case 'ShiftRight': INPUT.sprint = false; break;
  }
});

/* ── Joystick táctil ──────────────────────────── */
const joystickZone = document.getElementById('joystick-zone');
const joystickBase = document.getElementById('joystick-base');
const joystickStick = document.getElementById('joystick-stick');

function getJoystickCenter() {
  const rect = joystickBase.getBoundingClientRect();
  return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
}

joystickZone.addEventListener('touchstart', e => {
  e.preventDefault();
  JOY.active = true;
  const t = e.touches[0];
  JOY.startX = t.clientX; JOY.startY = t.clientY;
}, { passive: false });

joystickZone.addEventListener('touchmove', e => {
  e.preventDefault();
  if (!JOY.active) return;
  const t = e.touches[0];
  const { cx, cy } = getJoystickCenter();
  let dx = t.clientX - cx;
  let dy = t.clientY - cy;
  const dist = Math.hypot(dx, dy);
  const maxR = JOY.maxRadius;
  if (dist > maxR) { dx = dx / dist * maxR; dy = dy / dist * maxR; }

  // Mover el stick visualmente
  joystickStick.style.transform = `translate(${dx}px, ${dy}px)`;

  // Normalizar a -1..1
  INPUT.jx = dx / maxR;
  INPUT.jy = dy / maxR;
}, { passive: false });

joystickZone.addEventListener('touchend', () => {
  JOY.active = false;
  joystickStick.style.transform = 'translate(0,0)';
  INPUT.jx = 0; INPUT.jy = 0;
});

/* ── Botones móvil ──────────────────────────────── */
const btnShootM  = document.getElementById('btn-shoot-mobile');
const btnSprintM = document.getElementById('btn-sprint-mobile');

btnShootM.addEventListener('touchstart', e => { e.preventDefault(); INPUT.shoot = true; INPUT.shootPressed = true; }, { passive: false });
btnShootM.addEventListener('touchend',   e => { e.preventDefault(); INPUT.shoot = false; }, { passive: false });
btnSprintM.addEventListener('touchstart',e => { e.preventDefault(); INPUT.sprint = true; }, { passive: false });
btnSprintM.addEventListener('touchend',  e => { e.preventDefault(); INPUT.sprint = false; }, { passive: false });

/* ╔══════════════════════════════════════════════╗
   ║  11. SPAWNING                               ║
   ╚══════════════════════════════════════════════╝ */
let defenders = [];
let claraEntity = new Clara();

function setupDefenders() {
  defenders = [
    new Defender(CONFIG.FIELD_W * 0.55, CONFIG.FIELD_H * 0.3, '#B71C1C'),
    new Defender(CONFIG.FIELD_W * 0.65, CONFIG.FIELD_H * 0.5, '#7B1FA2'),
    new Defender(CONFIG.FIELD_W * 0.58, CONFIG.FIELD_H * 0.7, '#1A237E'),
  ];
}

function scheduleClaraEvent() {
  const interval = CONFIG.CLARA_INTERVAL_MIN +
    Math.random() * (CONFIG.CLARA_INTERVAL_MAX - CONFIG.CLARA_INTERVAL_MIN);
  STATE.claraNextIn = interval;
}

/* ╔══════════════════════════════════════════════╗
   ║  12. LÓGICA DE PARTIDA                      ║
   ╚══════════════════════════════════════════════╝ */
let player, ball;

function checkGoal() {
  const goalY1 = CONFIG.FIELD_H * 0.5 - CONFIG.GOAL_H / 2;
  const goalY2 = CONFIG.FIELD_H * 0.5 + CONFIG.GOAL_H / 2;
  const bx = ball.x, by = ball.y;

  const inGoalRow = by >= goalY1 && by <= goalY2;
  if (!inGoalRow) return false;

  // Portería izquierda (enemiga para el jugador)
  if (bx <= CONFIG.GOAL_W && ball.free) {
    onGoalScored();
    return true;
  }
  // Portería derecha (portería del jugador — no debería pasar pero por si acaso)
  if (bx >= CONFIG.FIELD_W - CONFIG.GOAL_W && ball.free) {
    // Autogol — no sumar puntos, solo resetear
    resetAfterGoal(false);
    return true;
  }
  return false;
}

function onGoalScored() {
  STATE.goals += 1;
  STATE.difficultyLevel += 1;
  const pts = CONFIG.GOAL_POINTS * STATE.multiplier * (STATE.talachaActive ? CONFIG.TALACHA_REWARD_MULT : 1);
  addScore(pts);

  STATE.goalFlash = 2000; // ms

  showFloatingText('⚽ GOL GANA ⚽', CONFIG.FIELD_W / 2, CONFIG.FIELD_H / 2 - 30, '#FFD600', 42, 3000);
  spawnGoalParticles();

  // Subir multiplicador con cada gol
  STATE.multiplier = Math.min(8, STATE.multiplier + 0.25);
  updateHudMult();

  setTimeout(() => resetAfterGoal(true), 1800);
}

function resetAfterGoal(isGoal) {
  ball.reset();
  player.x = CONFIG.FIELD_W * 0.35;
  player.y = CONFIG.FIELD_H * 0.5;
  player.hasBall = true;
  ball.free = false;
  setupDefenders();
  updateHUD();
}

function endMatch() {
  STATE.gameRunning = false;

  // Actualizar récord
  if (STATE.score > STATE.record) {
    STATE.record = STATE.score;
    localStorage.setItem('golGanaRecord', STATE.record);
  }

  // Mostrar pantalla game over
  document.getElementById('go-goals').textContent  = STATE.goals;
  document.getElementById('go-score').textContent  = STATE.score;
  document.getElementById('go-record').textContent = STATE.record;

  const badge = document.getElementById('go-new-record');
  badge.style.display = STATE.score >= STATE.record && STATE.score > 0 ? 'block' : 'none';

  showScreen('gameover');
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('mobile-controls').classList.add('hidden');
}

/* ╔══════════════════════════════════════════════╗
   ║  13. PARTÍCULAS / EFECTOS VISUALES          ║
   ╚══════════════════════════════════════════════╝ */
function spawnParticles(x, y, count, color) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 160;
    STATE.particles.push(new Particle(
      x, y,
      Math.cos(angle) * speed, Math.sin(angle) * speed,
      color,
      3 + Math.random() * 4,
      0.6 + Math.random() * 0.4
    ));
  }
}

function spawnGoalParticles() {
  const colors = ['#FFD600', '#FF6D00', '#00C853', '#E53935', '#2196F3'];
  for (let i = 0; i < 60; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 80 + Math.random() * 240;
    const color = colors[Math.floor(Math.random() * colors.length)];
    STATE.particles.push(new Particle(
      CONFIG.FIELD_W / 2, CONFIG.FIELD_H / 2,
      Math.cos(angle) * speed, Math.sin(angle) * speed,
      color, 4 + Math.random() * 6, 1 + Math.random() * 0.8
    ));
  }
}

function drawGoalFlash() {
  if (STATE.goalFlash <= 0) return;
  const alpha = (STATE.goalFlash / 2000) * 0.35;
  ctx.fillStyle = `rgba(255,214,0,${alpha})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawAjoloteOverlay() {
  if (!STATE.ajoloteActive) return;
  const alpha = 0.15 + Math.sin(Date.now() / 200) * 0.05;
  ctx.fillStyle = `rgba(255,128,171,${alpha})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Icono ajolote en esquina
  ctx.font = `${Math.min(canvas.width, canvas.height) * 0.06}px Arial`;
  ctx.textAlign = 'left';
  ctx.fillText('🦎', 10, 55);
}

/* ╔══════════════════════════════════════════════╗
   ║  14. GAME LOOP (update + render)            ║
   ╚══════════════════════════════════════════════╝ */
function update(dt) {
  if (!STATE.gameRunning) return;

  // ── Tiempo ──
  STATE.timeLeft -= dt;
  if (STATE.timeLeft <= 0) {
    STATE.timeLeft = 0;
    endMatch();
    return;
  }

  // ── Jugador ──
  player.update(dt, INPUT);

  // ── Balón: si lo lleva el jugador ──
  if (!ball.free) {
    const carryDist = CONFIG.BALL_CARRY_DIST;
    const facingX = player.facing;
    ball.x = player.x + facingX * carryDist;
    ball.y = player.y + (INPUT.up ? -6 : INPUT.down ? 6 : 0);
    ball.x = Math.max(CONFIG.BALL_RADIUS, Math.min(CONFIG.FIELD_W - CONFIG.BALL_RADIUS, ball.x));
    ball.y = Math.max(CONFIG.BALL_RADIUS, Math.min(CONFIG.FIELD_H - CONFIG.BALL_RADIUS, ball.y));
  }

  // ── Disparo ──
  if (INPUT.shootPressed) {
    INPUT.shootPressed = false;
    if (!ball.free && player.hasBall) {
      player.shoot();
      ball.free = true;
      player.hasBall = false;

      // Dirección del disparo
      let dx = player.facing;
      let dy = 0;
      if (INPUT.up)   dy -= 0.6;
      if (INPUT.down) dy += 0.6;

      // En modo ajolote: disparo chueco
      if (STATE.ajoloteActive) {
        dx += (Math.random() - 0.5) * 1.0;
        dy += (Math.random() - 0.5) * 1.0;
      }

      const len = Math.hypot(dx, dy) || 1;
      ball.vx = (dx / len) * CONFIG.PLAYER_SHOOT_POWER;
      ball.vy = (dy / len) * CONFIG.PLAYER_SHOOT_POWER * 0.3;
      ball.spin = ball.vx * 0.05;
    }
  }

  // ── Balón física ──
  ball.update(dt);

  // ── Recuperar balón si está cerca ──
  if (ball.free && !player.hasBall) {
    const dist = Math.hypot(ball.x - player.x, ball.y - player.y);
    if (dist < CONFIG.PLAYER_RADIUS + CONFIG.BALL_RADIUS + 4) {
      ball.free = false;
      player.hasBall = true;
      ball.vx = 0; ball.vy = 0;
    }
  }

  // ── Defensas ──
  defenders.forEach(def => {
    def.update(dt, player, ball);
    // Separar defensas entre sí
    defenders.forEach(other => {
      if (other !== def) separateCircles(def, other);
    });
    // Defensa roba balón
    if (!ball.free && player.hasBall) {
      const dist = Math.hypot(def.x - player.x, def.y - player.y);
      if (dist < CONFIG.DEFENDER_RADIUS + CONFIG.PLAYER_RADIUS + CONFIG.DEFENDER_STEAL_DIST) {
        // Probabilidad de robo según dificultad
        const stealChance = 0.015 + STATE.difficultyLevel * 0.003;
        if (Math.random() < stealChance) {
          ball.free = true;
          player.hasBall = false;
          ball.vx = (def.x - player.x) * 1.5;
          ball.vy = (def.y - player.y) * 1.5;
          def.stunTimer = 0.4;
          showFloatingText('¡ME LO QUITARON!', player.x, player.y - 30, '#FF5252', 20, 1500);
        }
      }
    }
    // Defensa patéa balón libre
    if (ball.free) {
      const dist = Math.hypot(def.x - ball.x, def.y - ball.y);
      if (dist < def.radius + ball.radius + 5) {
        ball.vx = (ball.x - def.x) * 3 + (Math.random() - 0.5) * 100;
        ball.vy = (ball.y - def.y) * 3;
      }
    }
  });

  // ── Gol ──
  checkGoal();

  // ── Powerups ──
  powerupTimer += dt * 1000;
  if (powerupTimer >= CONFIG.POWERUP_SPAWN_INTERVAL) {
    powerupTimer = 0;
    spawnPowerup();
  }

  powerups.forEach(p => {
    p.update(dt);
    if (!p.collected) {
      const dist = Math.hypot(p.x - player.x, p.y - player.y);
      if (dist < p.radius + player.radius) {
        collectPowerup(p);
      }
    }
  });
  powerups = powerups.filter(p => !p.collected);

  // ── Clara ──
  STATE.claraNextIn -= dt * 1000;
  if (STATE.claraNextIn <= 0 && !claraEntity.active) {
    claraEntity.spawn();
    scheduleClaraEvent();
  }
  claraEntity.update(dt, player);

  // Clara toca al jugador → ajolotiza
  if (claraEntity.active) {
    const dist = Math.hypot(claraEntity.x - player.x, claraEntity.y - player.y);
    if (dist < claraEntity.radius + player.radius) {
      if (!STATE.ajoloteActive) activateAjolote();
      claraEntity.active = false;
    }
  }

  // ── Ajolote timer ──
  updateAjolote(dt);
  // ── Salsa timer ──
  updateSalsa(dt);

  // ── Flash de gol ──
  if (STATE.goalFlash > 0) STATE.goalFlash -= dt * 1000;

  // ── Partículas ──
  STATE.particles.forEach(p => p.update(dt));
  STATE.particles = STATE.particles.filter(p => p.life > 0);

  // ── Textos flotantes ──
  STATE.floatingTexts.forEach(t => t.update(dt));
  STATE.floatingTexts = STATE.floatingTexts.filter(t => t.life > 0);

  // ── HUD DOM ──
  updateHUD();
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!STATE.gameRunning) return;

  // 1. Fondo / cancha
  drawField();

  // 2. Overlay ajolote
  drawAjoloteOverlay();

  // 3. Powerups
  powerups.forEach(p => p.draw());

  // 4. Clara
  claraEntity.draw();

  // 5. Defensas
  defenders.forEach(d => d.draw());

  // 6. Balón
  ball.draw();

  // 7. Jugador
  player.draw();

  // 8. Partículas
  STATE.particles.forEach(p => p.draw());

  // 9. Textos flotantes
  STATE.floatingTexts.forEach(t => t.draw());

  // 10. Flash de gol
  drawGoalFlash();

  // 11. Debug: mini-mapa de colisiones (desactivado)
  // drawDebugOverlay();
}

let rafId = null;

function gameLoop(timestamp) {
  const dt = Math.min((timestamp - (STATE.lastTimestamp || timestamp)) / 1000, 0.05);
  STATE.lastTimestamp = timestamp;

  update(dt);
  render();

  rafId = requestAnimationFrame(gameLoop);
}

/* ╔══════════════════════════════════════════════╗
   ║  15. NAVEGACIÓN DE PANTALLAS                ║
   ╚══════════════════════════════════════════════╝ */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(`screen-${name}`);
  if (target) target.classList.add('active');
  STATE.screen = name;
}

function startGame() {
  // Reset estado
  STATE.score         = 0;
  STATE.goals         = 0;
  STATE.timeLeft      = CONFIG.MATCH_DURATION;
  STATE.multiplier    = 1;
  STATE.talachaActive = false;
  STATE.salsaActive   = false;
  STATE.salsaTimer    = 0;
  STATE.ajoloteActive = false;
  STATE.ajoloteTimer  = 0;
  STATE.claraActive   = false;
  STATE.goalFlash     = 0;
  STATE.particles     = [];
  STATE.floatingTexts = [];
  STATE.difficultyLevel = 0;
  powerups = [];
  powerupTimer = 0;

  // Crear entidades
  player       = new Player();
  ball         = new Ball();
  claraEntity  = new Clara();
  setupDefenders();
  scheduleClaraEvent();

  // Ocultar menú, mostrar HUD
  showScreen('__none__'); // quita todas
  document.getElementById('hud').classList.remove('hidden');

  // Mostrar controles táctiles solo en touch
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    document.getElementById('mobile-controls').classList.remove('hidden');
  }

  STATE.gameRunning = true;
  STATE.lastTimestamp = performance.now();

  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(gameLoop);
}

/* ╔══════════════════════════════════════════════╗
   ║  16. INICIALIZACIÓN                         ║
   ╚══════════════════════════════════════════════╝ */

// Cargar récord del localStorage
STATE.record = parseInt(localStorage.getItem('golGanaRecord') || '0', 10);
document.getElementById('menu-record').textContent = `RÉCORD: ${STATE.record}`;

// Botones de menú
document.getElementById('btn-play').addEventListener('click', startGame);
document.getElementById('btn-how').addEventListener('click', () => showScreen('howto'));
document.getElementById('btn-credits').addEventListener('click', () => showScreen('credits'));
document.getElementById('btn-howto-back').addEventListener('click', () => showScreen('menu'));
document.getElementById('btn-credits-back').addEventListener('click', () => showScreen('menu'));
document.getElementById('btn-retry').addEventListener('click', startGame);
document.getElementById('btn-menu').addEventListener('click', () => {
  STATE.gameRunning = false;
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('mobile-controls').classList.add('hidden');
  document.getElementById('menu-record').textContent = `RÉCORD: ${STATE.record}`;
  showScreen('menu');
});

// Iniciar bucle de render del menú (solo dibuja fondo animado)
function menuLoop(ts) {
  if (STATE.screen !== 'menu' && !STATE.gameRunning) {
    requestAnimationFrame(menuLoop);
    return;
  }
  if (STATE.gameRunning) return; // el game loop tiene el control

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Fondo animado en menú
  const t = ts / 1000;
  const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  grad.addColorStop(0, '#0A1A0A');
  grad.addColorStop(0.5 + 0.3 * Math.sin(t * 0.3), '#0A0A1A');
  grad.addColorStop(1, '#1A0A0A');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Grid de fondo animado
  ctx.strokeStyle = `rgba(0,200,83,${0.04 + 0.02 * Math.sin(t)})`;
  ctx.lineWidth = 1;
  const gSize = 40;
  const offsetBG = (t * 20) % gSize;
  for (let x = -gSize + offsetBG; x < canvas.width + gSize; x += gSize) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = -gSize + offsetBG; y < canvas.height + gSize; y += gSize) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }

  // Balón decorativo orbitando
  const bx = canvas.width * 0.5 + Math.cos(t * 0.7) * canvas.width * 0.3;
  const by = canvas.height * 0.5 + Math.sin(t * 0.7) * canvas.height * 0.2;
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = '#FFD600';
  ctx.beginPath();
  ctx.arc(bx, by, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  requestAnimationFrame(menuLoop);
}

requestAnimationFrame(menuLoop);

// Mostrar pantalla inicial
showScreen('menu');
