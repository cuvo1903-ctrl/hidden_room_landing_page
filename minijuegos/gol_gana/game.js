
function getGolGanaJoystickVector() {
  if (window.__golGanaJoystick && window.__golGanaJoystick.active) {
    return { x: window.__golGanaJoystick.x || 0, y: window.__golGanaJoystick.y || 0 };
  }
  return null;
}

(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // Safari/iPhone no siempre calcula 100vh correctamente por la barra inferior.
  // Esta variable mantiene el alto real de la ventana para que el juego no se corte.
  function setViewportHeight() {
    document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
  }
  setViewportHeight();
  window.addEventListener('resize', setViewportHeight);
  window.addEventListener('orientationchange', () => setTimeout(setViewportHeight, 250));
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  const $ = (id) => document.getElementById(id);
  const ui = {
    menu: $('menu'), gamePanel: $('gamePanel'), gameOver: $('gameOver'), howTo: $('howTo'), message: $('message'),
    scoreboard: $('scoreboardUI'), time: $('timeUI'), score: $('scoreUI'), chicks: $('chicksUI'),
    finalGoals: $('finalGoals'), finalScore: $('finalScore'), finalWings: $('finalWings'), record: $('recordUI')
  };

  let W = 960, H = 540;

  // GOL GANA se juega en horizontal. En móvil vertical mostramos aviso para girar,
  // pero el canvas y la lógica siempre conservan proporción 16:9 para no deformar la cancha.
  function isPortraitGame() {
    return false;
  }

  function configureCanvas() {
    W = 960;
    H = 540;
    canvas.width = W;
    canvas.height = H;
  }

  function goalTop() { return H / 2 - 58; }
  function goalBottom() { return H / 2 + 58; }
  function fieldTop() { return 70; }
  function fieldBottom() { return H - 50; }
  function fieldLeft() { return 70; }
  function fieldRight() { return W - fieldLeft(); }

  configureCanvas();
  window.addEventListener('resize', () => { configureCanvas(); if (state.running) resetMatch(); });
  window.addEventListener('orientationchange', () => setTimeout(() => { configureCanvas(); if (state.running) resetMatch(); }, 260));
  const keys = new Set();
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  const state = {
    running: false,
    last: 0,
    timeLeft: 60,
    score: 0,
    goals: 0,
    rivalGoals: 0,
    chicks: 0,
    difficulty: 1,
    rivalSpeedBonus: 1,
    stealCooldown: 0,
    sprintEnergy: 100,
    comboTimer: 0,
    messageTimer: 0,
    messageText: '',
    warning20Shown: false,
    warning10Shown: false,
    claraTimer: 0,
    claraCooldown: 8,
    ajoloteTimer: 0,
    multiplierTimer: 0,
    speedTimer: 0,
    invincibleTimer: 0,
    touchMove: { x: 0, y: 0 },
    touchSprint: false,
    touchShoot: false,
    shootPressed: false,
    shootCharge: 0,
    maxShootCharge: 0.82,
    tackleCooldown: 0
  };

  const player = { x: 210, y: 270, r: 17, vx: 0, vy: 0, color: '#21d46b', hasBall: true, facing: { x: 1, y: 0 } };
  const ball = { x: 232, y: 270, r: 9, vx: 0, vy: 0, owner: 'player', ownerIndex: -1, passTargetIndex: -1, passGrace: 0 };
  const rivals = [];
  const pickups = [];
  const clara = { active: false, x: -80, y: 0, r: 24, vx: 0, vy: 0 };
  const goalie = { x: W - 62, y: H / 2, r: 18, speed: 82, color: '#b78cff', passCooldown: 0, targetY: H / 2, reaction: 0 };

  function resetMatch() {
    configureCanvas();
    player.x = W * 0.22; player.y = H / 2; player.vx = player.vy = 0; player.hasBall = true; player.facing = { x: 1, y: 0 };
    ball.x = player.x + 24; ball.y = player.y; ball.vx = ball.vy = 0; ball.owner = 'player'; ball.ownerIndex = -1; ball.passTargetIndex = -1; ball.passGrace = 0;
    rivals.length = 0;
    rivals.push({ x: W * 0.63, y: H * 0.40, r: 17, color: '#ff4141', speed: 74, facing: {x:-1,y:0}, shootCooldown: 0, passCooldown: 0, receiveCooldown: 0, lane: -1 });
    rivals.push({ x: W * 0.70, y: H * 0.60, r: 17, color: '#ff7a18', speed: 78, facing: {x:-1,y:0}, shootCooldown: 0, passCooldown: 0, receiveCooldown: 0, lane: 1 });
    rivals.push({ x: W * 0.78, y: H * 0.50, r: 17, color: '#22a7ff', speed: 68, facing: {x:-1,y:0}, shootCooldown: 0, passCooldown: 0, receiveCooldown: 0, lane: 0 });
    goalie.x = W - (62); goalie.y = H / 2; goalie.targetY = H / 2; goalie.reaction = 0; goalie.passCooldown = 0;
  }

  function newGame() {
    state.running = true;
    state.last = performance.now();
    state.timeLeft = 90;
    state.score = 0; state.goals = 0; state.rivalGoals = 0; state.chicks = 0; state.difficulty = 1.0; state.rivalSpeedBonus = 1.0; state.stealCooldown = 0; state.sprintEnergy = 100; state.comboTimer = 0;
    state.claraCooldown = 7; state.claraTimer = 0; state.ajoloteTimer = 0; state.warning20Shown = false; state.warning10Shown = false;
    state.multiplierTimer = 0; state.speedTimer = 0; state.invincibleTimer = 0; state.tackleCooldown = 0;
    pickups.length = 0;
    for (let i = 0; i < 4; i++) spawnPickup();
    resetMatch();
    show(ui.menu, false); show(ui.gameOver, false); show(ui.gamePanel, true);
    requestAnimationFrame(loop);
  }

  function show(el, yes) { el.classList.toggle('hidden', !yes); }
  function flash(text, seconds = 1.0) { state.messageText = text; state.messageTimer = seconds; ui.message.textContent = text; show(ui.message, true); }

  function spawnPickup() {
    const types = ['chick', 'chick', 'chick', 'chick', 'gold', 'salsa', 'hiddenCoin'];
    pickups.push({ type: types[Math.floor(Math.random() * types.length)], x: rand(fieldLeft() + 60, fieldRight() - 60), y: rand(fieldTop() + 55, fieldBottom() - 55), r: 12 });
  }

  function inputVector() {
    let x = 0, y = 0;
    if (keys.has('arrowleft') || keys.has('a')) x -= 1;
    if (keys.has('arrowright') || keys.has('d')) x += 1;
    if (keys.has('arrowup') || keys.has('w')) y -= 1;
    if (keys.has('arrowdown') || keys.has('s')) y += 1;
    const joystickVector = getGolGanaJoystickVector();
    x += joystickVector?.x ?? state.touchMove.x;
    y += joystickVector?.y ?? state.touchMove.y;
    const m = Math.hypot(x, y);
    return m > 0 ? { x: x / m, y: y / m } : { x: 0, y: 0 };
  }

  function shoot(powerRatio = 0.45) {
    if (!player.hasBall) return;
    powerRatio = clamp(powerRatio, 0.25, 1);
    const crooked = state.ajoloteTimer > 0 ? rand(-0.55, 0.55) : rand(-0.05, 0.05);
    const fx = player.facing.x * Math.cos(crooked) - player.facing.y * Math.sin(crooked);
    const fy = player.facing.x * Math.sin(crooked) + player.facing.y * Math.cos(crooked);
    const shotSpeed = 360 + 330 * powerRatio;
    ball.owner = null; ball.ownerIndex = -1; ball.passTargetIndex = -1; player.hasBall = false;
    ball.x = player.x + fx * 24; ball.y = player.y + fy * 24;
    ball.vx = fx * shotSpeed; ball.vy = fy * shotSpeed;
  }

  function currentDifficultyFromGoals() {
    // Curva de saturación: los primeros goles sí suben fuerte la dificultad,
    // pero cada gol adicional aporta menos.
    // Calibración: al gol 4 se siente cercano a la versión anterior que gustaba,
    // sin volverse una pared imposible después del 5.º.
    const g = Math.max(0, state.goals);
    return 1 + 0.95 * (1 - Math.exp(-g / 3.2));
  }

  function currentRivalSpeedBonusFromGoals() {
    // Refuerzo independiente de velocidad rival, también con rendimientos decrecientes.
    const g = Math.max(0, state.goals);
    return 1 + 0.55 * (1 - Math.exp(-g / 3.0));
  }

  function update(dt) {
    state.timeLeft -= dt;
    if (!state.warning20Shown && state.timeLeft <= 20 && state.timeLeft > 10) {
      state.warning20Shown = true;
      flash('¡QUEDAN 20 SEGUNDOS!', 1.05);
    }
    if (!state.warning10Shown && state.timeLeft <= 10 && state.timeLeft > 0) {
      state.warning10Shown = true;
      flash('¡ÚLTIMOS 10 SEGUNDOS!', 1.15);
    }
    if (state.timeLeft <= 0) return endGame();

    for (const k of ['messageTimer','claraCooldown','claraTimer','ajoloteTimer','multiplierTimer','speedTimer','invincibleTimer','stealCooldown','comboTimer','tackleCooldown']) state[k] = Math.max(0, state[k] - dt);
    ball.passGrace = Math.max(0, ball.passGrace - dt);
    if (state.messageTimer <= 0) show(ui.message, false);

    const v = inputVector();
    const wantsSprint = keys.has('shift') || state.touchSprint;
    const moving = Math.hypot(v.x, v.y) > 0.1;
    const sprint = wantsSprint && moving && state.sprintEnergy > 4;
    if (sprint) state.sprintEnergy = Math.max(0, state.sprintEnergy - 30 * dt);
    else state.sprintEnergy = Math.min(100, state.sprintEnergy + 18 * dt);
    // Sin balón corres un poco más: sirve para presionar, robar e interceptar pases.
    let speed = 180 * (player.hasBall ? 1 : 1.14) * (sprint ? 1.32 : 1) * (state.speedTimer > 0 ? 1.25 : 1) * (state.ajoloteTimer > 0 ? 0.58 : 1);
    player.vx = v.x * speed; player.vy = v.y * speed;
    if (Math.hypot(v.x, v.y) > 0.1) player.facing = { x: v.x, y: v.y };
    player.x = clamp(player.x + player.vx * dt, fieldLeft() + 18, fieldRight() - 18);
    player.y = clamp(player.y + player.vy * dt, fieldTop() + 18, fieldBottom() - 18);

    const shootInput = keys.has(' ') || state.touchShoot;
    if (player.hasBall && shootInput) {
      state.shootCharge = Math.min(state.maxShootCharge, state.shootCharge + dt);
    }
    if (!shootInput && state.shootPressed && player.hasBall) {
      const ratio = Math.max(0.28, state.shootCharge / state.maxShootCharge);
      shoot(ratio);
      state.shootCharge = 0;
    }
    if (!shootInput && !player.hasBall) state.shootCharge = 0;
    state.shootPressed = shootInput;

    updateBall(dt);
    updateRivals(dt);
    updateGoalie(dt);
    updatePickups();
    updateClara(dt);
    updateUI();
  }

  function updateBall(dt) {
    if (player.hasBall) {
      ball.x = player.x + player.facing.x * 24;
      ball.y = player.y + player.facing.y * 24;
      ball.vx = ball.vy = 0;
      ball.owner = 'player';
      ball.ownerIndex = -1;
      return;
    }

    if (ball.owner === 'rival' && rivals[ball.ownerIndex]) {
      const r = rivals[ball.ownerIndex];
      ball.passTargetIndex = -1;
      ball.x = r.x + r.facing.x * 23;
      ball.y = r.y + r.facing.y * 23;
      ball.vx = ball.vy = 0;
      return;
    }

    ball.x += ball.vx * dt; ball.y += ball.vy * dt;
    ball.vx *= Math.pow(0.985, dt * 60); ball.vy *= Math.pow(0.985, dt * 60);
    if (ball.y < fieldTop() || ball.y > fieldBottom()) ball.vy *= -0.75;
    if (ball.x < fieldLeft() - 2 || ball.x > fieldRight() + 2) ball.vx *= -0.75;
    ball.x = clamp(ball.x, fieldLeft() - 2, fieldRight() + 2); ball.y = clamp(ball.y, fieldTop(), fieldBottom());

    const leftGoal = ball.x < fieldLeft() + 10 && ball.y > goalTop() && ball.y < goalBottom();
    const rightGoal = ball.x > fieldRight() - 10 && ball.y > goalTop() && ball.y < goalBottom();
    if (rightGoal) goal();
    if (leftGoal) rivalGoal();

    if (ball.passGrace <= 0 && dist(player, ball) < player.r + ball.r + 4 && Math.hypot(ball.vx, ball.vy) < 230) {
      player.hasBall = true; ball.owner = 'player'; ball.ownerIndex = -1; flash('¡GOL!', .45);
    }
  }

  function goal() {
    state.goals++;
    state.difficulty = currentDifficultyFromGoals();
    state.rivalSpeedBonus = currentRivalSpeedBonusFromGoals();
    state.claraCooldown = Math.min(state.claraCooldown, rand(4.5, 8));
    const mult = state.multiplierTimer > 0 ? 2 : 1;
    state.score += 250 * mult;
    // No se aumenta el tiempo por gol: el partido debe tener duración fija.
    flash('¡GOOOL GANA!', 1.05);
    resetMatch();
  }

  function rivalGoal() {
    state.rivalGoals++;
    // El rival NO sube la dificultad; solo castiga puntos/tiempo.
    state.score = Math.max(0, state.score - 120);
    state.timeLeft = Math.max(8, state.timeLeft - 3);
    flash('¡GOL RIVAL!', .95);
    resetMatch();
  }

  function updateRivals(dt) {
    for (let i = 0; i < rivals.length; i++) {
      const r = rivals[i];
      r.shootCooldown = Math.max(0, (r.shootCooldown || 0) - dt);
      r.passCooldown = Math.max(0, (r.passCooldown || 0) - dt);
      r.receiveCooldown = Math.max(0, (r.receiveCooldown || 0) - dt);

      let target;
      let speedFactor = 1;
      const hasBall = ball.owner === 'rival' && ball.ownerIndex === i;

      if (hasBall) {
        // Si tiene balón, ataca con intención: avanza hacia la portería izquierda,
        // pero no se mete al centro siempre; busca ángulo para tirar o soltar pase filtrado.
        const laneY = H / 2 + (r.lane || 0) * (58);
        target = {
          x: fieldLeft() + 34,
          y: clamp((laneY * 0.45) + (H / 2 * 0.55), goalTop() + 18, goalBottom() - 18)
        };
        speedFactor = 0.78;
      } else if (player.hasBall) {
        target = player;
        speedFactor = 1.12;
      } else if (ball.owner === 'rival') {
        // Si un compañero tiene el balón, los demás NO persiguen la pelota:
        // se desmarcan hacia carriles útiles para recibir y rematar.
        const holder = rivals[ball.ownerIndex];
        const laneY = H / 2 + (r.lane || 0) * (72);
        const aheadX = holder ? holder.x - (80 + i * 14) : ball.x - 80;
        target = {
          x: clamp(aheadX, fieldLeft() + 80, fieldRight() - 95),
          y: clamp(laneY, fieldTop() + 55, fieldBottom() - 55)
        };
        speedFactor = 0.74;
      } else {
        // Si es un pase dirigido, solo el receptor va fuerte por el balón; los demás dan apoyo.
        if (ball.passTargetIndex === i) {
          target = ball;
          speedFactor = 1.05;
        } else if (ball.passTargetIndex >= 0) {
          target = { x: clamp(ball.x + 45 + i * 16, fieldLeft() + 70, fieldRight() - 70), y: clamp(ball.y + (i - 1) * (isPortraitGame() ? 90 : 60), fieldTop() + 45, fieldBottom() - 45) };
          speedFactor = 0.62;
        } else {
          target = ball;
          speedFactor = 0.9;
        }
      }

      let dx = target.x - r.x, dy = target.y - r.y;
      const m = Math.hypot(dx, dy) || 1;
      dx /= m; dy /= m;
      r.facing = { x: dx, y: dy };
      r.x += dx * r.speed * state.difficulty * state.rivalSpeedBonus * speedFactor * dt;
      r.y += dy * r.speed * state.difficulty * state.rivalSpeedBonus * speedFactor * dt;
      r.x = clamp(r.x, fieldLeft() + 28, fieldRight() - 28); r.y = clamp(r.y, fieldTop() + 25, fieldBottom() - 25);

      // Separación simple para evitar que se vuelvan locos/amontonados.
      for (let j = 0; j < rivals.length; j++) {
        if (i === j) continue;
        const o = rivals[j];
        const d = Math.hypot(r.x - o.x, r.y - o.y) || 1;
        const minD = r.r + o.r + 10;
        if (d < minD) {
          r.x += ((r.x - o.x) / d) * (minD - d) * 0.35;
          r.y += ((r.y - o.y) / d) * (minD - d) * 0.35;
        }
      }

      if (player.hasBall && dist(r, player) < r.r + player.r + 4 && state.invincibleTimer <= 0 && state.stealCooldown <= 0) {
        player.hasBall = false;
        ball.owner = 'rival';
        ball.ownerIndex = i;
        r.facing = { x: -1, y: (H / 2 - r.y) / 220 };
        state.stealCooldown = 0.85;
        state.comboTimer = 0;
        flash('¡TE LA ROBARON!', .55);
      }

      if (!player.hasBall && ball.owner === null && dist(r, ball) < r.r + ball.r + 6 && Math.hypot(ball.vx, ball.vy) < 300) {
        ball.owner = 'rival';
        ball.ownerIndex = i;
        ball.passTargetIndex = -1;
        r.receiveCooldown = 0.28;
      }

      if (hasBall) {
        const closeToGoal = r.x < fieldLeft() + (175) && r.y > goalTop() - 62 && r.y < goalBottom() + 62;
        const veryClose = r.x < fieldLeft() + 95 && r.y > goalTop() - 35 && r.y < goalBottom() + 35;
        const pressured = dist(r, player) < 92;
        const teammateAhead = findBestTeammate(i);
        const hasGoodPass = teammateAhead >= 0 && teammateAhead !== i;

        // Intención ofensiva:
        // 1) Si está muy cerca o con buen ángulo, tira.
        // 2) Si está presionado o hay compañero mejor posicionado, pasa hacia ventaja.
        // 3) Si no, sigue avanzando.
        const passChance = closeToGoal ? 0.035 : 0.055;
        const mate = hasGoodPass ? rivals[teammateAhead] : null;
        const mateInBetterShotLane = mate && mate.x < r.x - 28 && mate.x < fieldLeft() + (250) && mate.y > goalTop() - 78 && mate.y < goalBottom() + 78;
        const shouldPass = r.passCooldown <= 0 && hasGoodPass && (
          pressured || mateInBetterShotLane || Math.random() < passChance * Math.min(2.25, state.difficulty)
        );

        if (shouldPass && (!veryClose || pressured || mateInBetterShotLane)) {
          rivalPass(i);
        } else if ((veryClose || (closeToGoal && !pressured)) && r.shootCooldown <= 0) {
          rivalShoot(r);
        }
      }
    }

    // El jugador puede robarle al rival si lo alcanza.
    // Antes estaba demasiado estricto; ahora hay robo por contacto, tackle con espacio/botón
    // e incluso intercepción cuando el rival intenta pasar cerca del jugador.
    if (ball.owner === 'rival' && rivals[ball.ownerIndex]) {
      const r = rivals[ball.ownerIndex];
      const d = dist(player, r);
      const tacklePressed = (keys.has(' ') || state.touchShoot) && state.tackleCooldown <= 0;
      const sprinting = keys.has('shift') || state.touchSprint;
      const stealRange = player.r + r.r + (tacklePressed ? 20 : sprinting ? 13 : 9);

      if (r.receiveCooldown <= 0 && d < stealRange && state.stealCooldown <= 0) {
        player.hasBall = true;
        ball.owner = 'player';
        ball.ownerIndex = -1;
        ball.passTargetIndex = -1;
        state.stealCooldown = 0.62;
        state.tackleCooldown = 0.45;
        // pequeño empujón para que no se vuelva a robar instantáneamente
        const awayX = player.x - r.x;
        const awayY = player.y - r.y;
        const m = Math.hypot(awayX, awayY) || 1;
        player.x = clamp(player.x + (awayX / m) * 10, fieldLeft() + 18, fieldRight() - 18);
        player.y = clamp(player.y + (awayY / m) * 10, fieldTop() + 18, fieldBottom() - 18);
        flash(tacklePressed ? '¡BARRIDA LIMPIA!' : '¡SE LA QUITASTE!', .45);
      }
    }

    // Interceptar pases rivales: si el balón pasa cerca y no va muy rápido, el jugador lo controla.
    if (!player.hasBall && ball.owner === null && ball.passTargetIndex >= 0 && ball.passGrace <= 0.18) {
      const speed = Math.hypot(ball.vx, ball.vy);
      if (dist(player, ball) < player.r + ball.r + 14 && speed < 520) {
        player.hasBall = true;
        ball.owner = 'player';
        ball.ownerIndex = -1;
        ball.passTargetIndex = -1;
        ball.vx = ball.vy = 0;
        flash('¡INTERCEPTASTE!', .45);
      }
    }
  }

  function findBestTeammate(holderIndex) {
    let bestIndex = -1;
    let bestScore = -Infinity;
    const holder = holderIndex >= 0 ? rivals[holderIndex] : goalie;

    for (let i = 0; i < rivals.length; i++) {
      if (i === holderIndex) continue;
      const mate = rivals[i];
      const distance = Math.hypot(mate.x - holder.x, mate.y - holder.y);

      // Los rivales atacan hacia la izquierda.
      // Premia al compañero que esté más cerca de la portería rival, abierto y no marcado.
      const advanceBonus = (holder.x - mate.x) * 2.4;
      const openLaneBonus = Math.abs(mate.y - H / 2) > 35 ? 55 : 15;
      const shotLaneBonus = (mate.x < fieldLeft() + 210 && mate.y > goalTop() - 70 && mate.y < goalBottom() + 70) ? 85 : 0;
      const tooClosePenalty = distance < 85 ? 220 : 0;
      const tooFarPenalty = distance > 300 ? 90 : 0;
      const playerPressurePenalty = Math.max(0, 120 - dist(mate, player)) * 1.5;

      // Evita pases hacia atrás salvo que el portero esté distribuyendo.
      const backwardsPenalty = holderIndex >= 0 && mate.x > holder.x + 20 ? 130 : 0;

      const score = advanceBonus + openLaneBonus + shotLaneBonus - tooClosePenalty - tooFarPenalty - playerPressurePenalty - backwardsPenalty + rand(-18, 18);
      if (score > bestScore) { bestScore = score; bestIndex = i; }
    }
    return bestIndex;
  }

  function passBallToPoint(from, targetIndex, targetPoint, speed = 390) {
    const target = rivals[targetIndex];
    if (!target) return false;
    const dx = targetPoint.x - from.x;
    const dy = targetPoint.y - from.y;
    const m = Math.hypot(dx, dy) || 1;
    ball.owner = null;
    ball.ownerIndex = -1;
    ball.passTargetIndex = targetIndex;
    ball.passGrace = 0.22;
    ball.x = from.x + (dx / m) * 24;
    ball.y = from.y + (dy / m) * 24;
    ball.vx = (dx / m) * speed;
    ball.vy = (dy / m) * speed;
    return true;
  }

  function passBallTo(from, targetIndex, speed = 390) {
    const target = rivals[targetIndex];
    if (!target) return false;

    // Pase con intención: no apunta al cuerpo actual del compañero, sino a un espacio
    // más adelantado hacia la portería para que el receptor ataque al recibir.
    const leadX = clamp(target.x - (46 + 10 * Math.min(4, state.difficulty)), fieldLeft() + 38, fieldRight() - 60);
    const goalBias = (H / 2 - target.y) * 0.08;
    const leadY = clamp(target.y + (target.lane || 0) * 10 + goalBias, fieldTop() + 35, fieldBottom() - 35);
    return passBallToPoint(from, targetIndex, { x: leadX, y: leadY }, speed);
  }

  function rivalPass(holderIndex) {
    const holder = rivals[holderIndex];
    if (!holder || ball.owner !== 'rival' || ball.ownerIndex !== holderIndex) return;
    const targetIndex = findBestTeammate(holderIndex);
    if (targetIndex < 0) return;
    holder.passCooldown = 1.1;
    holder.receiveCooldown = 0.18;
    passBallTo(holder, targetIndex, 380 + 25 * state.difficulty);
    flash('¡PASE RIVAL!', .35);
  }

  function goalieDistribute() {
    const targetIndex = findBestTeammate(-1);
    if (targetIndex < 0) return;
    player.hasBall = false;
    goalie.y = clamp(goalie.y, goalTop() - 15, goalBottom() + 15);
    passBallTo({ x: goalie.x - 18, y: goalie.y }, targetIndex, 420 + 25 * state.difficulty);
    if (rivals[targetIndex]) rivals[targetIndex].receiveCooldown = 0.22;
    flash('¡ATAJADA Y PASE!', .55);
  }

  function rivalShoot(r) {
    const targetY = rand(goalTop() + 18, goalBottom() - 18);
    const dx = fieldLeft() - 18 - r.x;
    const dy = targetY - r.y;
    const m = Math.hypot(dx, dy) || 1;
    ball.owner = null;
    ball.ownerIndex = -1;
    ball.passTargetIndex = -1;
    ball.x = r.x - 24;
    ball.y = r.y;
    ball.vx = (dx / m) * (430 + 45 * state.difficulty);
    ball.vy = (dy / m) * (430 + 45 * state.difficulty);
    r.shootCooldown = 1.4;
    flash('¡TIRA EL RIVAL!', .4);
  }

  function updateGoalie(dt) {
    goalie.passCooldown = Math.max(0, goalie.passCooldown - dt);

    // Portero balanceado:
    // - No persigue el balón por toda la cancha.
    // - Solo cubre su portería.
    // - Reacciona mejor cuando el balón viene hacia él, pero con error humano.
    const keeperMinY = goalTop() + 10;
    const keeperMaxY = goalBottom() - 10;
    const centerY = H / 2;
    const ballComingToGoal = ball.owner === null && ball.vx > 140 && ball.x > W * 0.54;
    const ballInDangerZone = ball.x > W * 0.68 || ballComingToGoal;

    goalie.reaction = Math.max(0, (goalie.reaction || 0) - dt);
    if (goalie.reaction <= 0) {
      // En peligro sigue el balón; fuera de peligro vuelve al centro.
      const errorRange = ballComingToGoal ? 18 : 32;
      const humanError = rand(-errorRange, errorRange);
      const targetBlend = ballInDangerZone ? 0.78 : 0.28;
      goalie.targetY = clamp(centerY * (1 - targetBlend) + ball.y * targetBlend + humanError, keeperMinY, keeperMaxY);
      goalie.reaction = ballComingToGoal ? rand(0.10, 0.18) : rand(0.22, 0.38);
    }

    const baseSpeed = 92 + state.difficulty * 10;
    const dangerBoost = ballInDangerZone ? 1.45 : 0.85;
    const maxStep = baseSpeed * dangerBoost * dt;
    goalie.y += clamp(goalie.targetY - goalie.y, -maxStep, maxStep);
    goalie.y = clamp(goalie.y, keeperMinY, keeperMaxY);

    // Atajada: el radio efectivo sube un poco si el tiro va directo, pero no es pared imposible.
    const shotSpeed = Math.hypot(ball.vx, ball.vy);
    const saveRadius = goalie.r + ball.r + (shotSpeed > 260 ? 3 : 7);
    if (goalie.passCooldown <= 0 && ball.owner === null && dist(goalie, ball) < saveRadius) {
      goalie.passCooldown = 0.75;
      goalieDistribute();
    }
  }

  function updatePickups() {
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      if (dist(player, p) < player.r + p.r) {
        pickups.splice(i, 1);
        if (p.type === 'chick') { state.chicks++; state.comboTimer = 3; state.score += state.multiplierTimer > 0 ? 70 : 35; flash('+1 ALITA', .35); }
        if (p.type === 'gold') { state.chicks += 3; state.speedTimer = 4; state.score += 90; flash('ALITA DORADA', .55); }
        if (p.type === 'salsa') { state.multiplierTimer = 4.5; flash('SALSA x2', .55); }
        if (p.type === 'hiddenCoin') { state.invincibleTimer = 3.5; state.score += 100; flash('HIDDEN COIN', .65); }
        spawnPickup();
      }
    }
  }

  function updateClara(dt) {
    if (!clara.active && state.claraCooldown <= 0) {
      clara.active = true; state.claraTimer = 5.6; state.claraCooldown = rand(8, 12);
      const fromLeft = Math.random() > .5;
      clara.x = fromLeft ? -40 : W + 40; clara.y = rand(fieldTop() + 25, fieldBottom() - 25);
      clara.vx = (fromLeft ? 185 : -185) * Math.min(1.6, state.difficulty); clara.vy = rand(-50, 50);
      flash('¡LLEGÓ CLARA!', .9);
    }
    if (!clara.active) return;
    clara.x += clara.vx * dt; clara.y += clara.vy * dt;
    if (state.claraTimer <= 0 || clara.x < -70 || clara.x > W + 70) clara.active = false;
    if (dist(player, clara) < player.r + clara.r && state.invincibleTimer <= 0) {
      state.ajoloteTimer = 6; clara.active = false; player.hasBall = false; ball.owner = null; ball.ownerIndex = -1;
      ball.vx = -player.facing.x * 180; ball.vy = -player.facing.y * 180;
      flash('HAS SIDO AJOLOTIZADO', 1.1);
    }
  }

  function updateUI() {
    state.score += 3 / 60;
    // La dificultad solo sube cuando el jugador mete gol, no por tiempo ni por gol rival.
    ui.scoreboard.textContent = `${state.goals} - ${state.rivalGoals}`;
    ui.time.textContent = Math.ceil(state.timeLeft);
    ui.time.classList.toggle('danger-time', state.timeLeft <= 10);
    ui.score.textContent = Math.floor(state.score);
    ui.chicks.textContent = state.chicks;
    ui.gamePanel.classList.toggle('ajolote-mode', state.ajoloteTimer > 0);
  }

  function endGame() {
    state.running = false;
    show(ui.gamePanel, false); show(ui.gameOver, true);
    let final = Math.floor(state.score);
    const won = state.goals > state.rivalGoals;
    const tied = state.goals === state.rivalGoals;
    if (!won) {
      final = tied ? Math.floor(final * 0.75) : Math.floor(final * 0.5);
    }
    const record = Math.max(final, Number(localStorage.getItem('gol_gana_record') || 0));
    localStorage.setItem('gol_gana_record', record);
    ui.finalGoals.textContent = `GOL GANA ${state.goals} - ${state.rivalGoals} RIVALES`;
    ui.finalScore.textContent = final;
    if (ui.finalWings) ui.finalWings.textContent = state.chicks;
    ui.record.textContent = record;
    ui.gamePanel.classList.remove('ajolote-mode');
  }

  function draw() {
    ctx.clearRect(0,0,W,H);
    drawField(); drawPickups(); drawGoals(); drawRivals(); drawGoalie(); drawPlayer(); drawBall(); drawPossessionArrow(); drawClara(); drawEffects();
  }

  function drawField() {
    ctx.fillStyle = state.ajoloteTimer > 0 ? '#24123a' : '#272a28'; ctx.fillRect(0,0,W,H);
    ctx.fillStyle = state.ajoloteTimer > 0 ? '#301849' : '#202320'; ctx.fillRect(fieldLeft(), fieldTop(), fieldRight()-fieldLeft(), fieldBottom()-fieldTop());
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 3; ctx.strokeRect(fieldLeft(), fieldTop(), fieldRight()-fieldLeft(), fieldBottom()-fieldTop());
    ctx.beginPath(); ctx.moveTo(W/2,fieldTop()); ctx.lineTo(W/2,fieldBottom()); ctx.stroke();
    ctx.beginPath(); ctx.arc(W/2,H/2,58,0,Math.PI*2); ctx.stroke();
    ctx.strokeRect(fieldLeft(), H/2 - 112, 95, 224); ctx.strokeRect(fieldRight() - (95), H/2 - 112, 95, 224);
    ctx.fillStyle = 'rgba(255,210,46,.12)'; ctx.fillRect(fieldLeft(),fieldTop(),fieldRight()-fieldLeft(),20);
    ctx.fillStyle = '#ffd22e'; ctx.font = isPortraitGame() ? '900 16px system-ui' : '900 22px system-ui'; ctx.textAlign='center'; ctx.fillText('HIDDEN ROOM x TLALPAN WINGS HOUSE', W/2, fieldTop()+36);
    ctx.font = '900 16px system-ui'; ctx.fillStyle = 'rgba(255,255,255,.13)';
    ctx.fillText('GOL GANA', W/2, fieldBottom()-28);
    ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
    for (let i=0;i<18;i++) { ctx.beginPath(); ctx.moveTo(rand(fieldLeft()+20,fieldRight()-20), rand(fieldTop()+35,fieldBottom()-35)); ctx.lineTo(rand(fieldLeft()+20,fieldRight()-20), rand(fieldTop()+35,fieldBottom()-35)); ctx.stroke(); }
  }

  function drawGoals() {
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#ff4141'; ctx.strokeRect(fieldLeft()-30, goalTop(), 30, goalBottom()-goalTop());
    ctx.strokeStyle = '#21d46b'; ctx.strokeRect(fieldRight(), goalTop(), 30, goalBottom()-goalTop());
    ctx.fillStyle = '#21d46b'; ctx.font = '900 18px system-ui'; ctx.textAlign='center'; ctx.fillText('GOL', fieldRight()+15, goalTop()-16);
  }

  function drawCircleThing(o, label, color, kind = 'field') {
    const fx = (o.facing && Math.abs(o.facing.x) + Math.abs(o.facing.y) > 0.01) ? o.facing.x : 1;
    const fy = (o.facing && Math.abs(o.facing.x) + Math.abs(o.facing.y) > 0.01) ? o.facing.y : 0;
    const mag = Math.hypot(fx, fy) || 1;
    const dirX = fx / mag;
    const dirY = fy / mag;
    const sideX = -dirY;
    const sideY = dirX;
    const isAjolote = kind === 'ajolote';
    const isClara = kind === 'clara';
    const isGoalie = kind === 'goalie';
    const runSpeed = Math.hypot(o.vx || 0, o.vy || 0);
    const baseMove = (runSpeed > 8 || ball.owner === 'rival' || kind === 'goalie' || kind === 'clara') ? 1 : 0.35;
    const t = performance.now() / 1000;
    const stride = Math.sin(t * (8.5 + baseMove * 4) + (o.x + o.y) * 0.025) * baseMove;
    const lean = clamp((runSpeed || (kind === 'field' ? 80 : 45)) / 260, 0, 0.55);
    const scale = isClara ? 1.22 : isGoalie ? 1.08 : 1;

    const cx = o.x + dirX * lean * 8;
    const cy = o.y + dirY * lean * 8;
    const headX = cx + dirX * 2;
    const headY = cy - 17 * scale + dirY * 2;
    const torsoTop = { x: cx, y: cy - 5 * scale };
    const hip = { x: cx - dirX * 2, y: cy + 14 * scale };

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Sombra dinámica.
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.beginPath();
    ctx.ellipse(o.x, o.y + 24 * scale, 14 * scale, 6 * scale, 0, 0, Math.PI * 2);
    ctx.fill();

    // Piernas animadas.
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 5 * scale;
    const legSpread = 7 * scale;
    const step = stride * 9 * scale;
    const leftKnee = { x: hip.x + sideX * legSpread + dirX * step, y: hip.y + sideY * legSpread + dirY * step + 8 * scale };
    const rightKnee = { x: hip.x - sideX * legSpread - dirX * step, y: hip.y - sideY * legSpread - dirY * step + 8 * scale };
    const leftFoot = { x: leftKnee.x + dirX * step * .45 + sideX * 3, y: leftKnee.y + 10 * scale };
    const rightFoot = { x: rightKnee.x - dirX * step * .45 - sideX * 3, y: rightKnee.y + 10 * scale };
    ctx.beginPath();
    ctx.moveTo(hip.x, hip.y); ctx.lineTo(leftKnee.x, leftKnee.y); ctx.lineTo(leftFoot.x, leftFoot.y);
    ctx.moveTo(hip.x, hip.y); ctx.lineTo(rightKnee.x, rightKnee.y); ctx.lineTo(rightFoot.x, rightFoot.y);
    ctx.stroke();

    // Brazos animados en oposición a piernas. Clara levanta más los brazos.
    const shoulder = { x: cx, y: cy + 1 * scale };
    const armSwing = stride * 10 * scale;
    const armUp = isClara ? -13 * scale : 0;
    ctx.beginPath();
    ctx.moveTo(shoulder.x, shoulder.y);
    ctx.lineTo(shoulder.x + sideX * 10 * scale - dirX * armSwing, shoulder.y + sideY * 10 * scale - dirY * armSwing + 8 * scale + armUp);
    ctx.moveTo(shoulder.x, shoulder.y);
    ctx.lineTo(shoulder.x - sideX * 10 * scale + dirX * armSwing, shoulder.y - sideY * 10 * scale + dirY * armSwing + 8 * scale + armUp);
    ctx.stroke();

    // Cuerpo / jersey.
    ctx.fillStyle = color;
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 3 * scale;
    ctx.beginPath();
    ctx.rect(cx - 8 * scale, cy - 6 * scale, 16 * scale, 23 * scale);
    ctx.fill();
    ctx.stroke();

    // Franja del jersey para que no parezcan bolitas con palitos.
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    ctx.fillRect(cx - 6 * scale, cy + 1 * scale, 12 * scale, 3 * scale);

    // Cabeza.
    ctx.fillStyle = isAjolote ? '#d9a8ff' : '#f2c9a0';
    ctx.beginPath();
    ctx.arc(headX, headY, 8.5 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2.5 * scale;
    ctx.stroke();

    // Clara: cabello corto para que se lea como personaje femenino sin usar sprites.
    if (isClara) {
      ctx.fillStyle = '#2b1028';
      ctx.beginPath();
      ctx.arc(headX, headY - 1 * scale, 9.6 * scale, Math.PI * 0.92, Math.PI * 2.08);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(headX - sideX * 6 * scale, headY + 1 * scale, 4.2 * scale, 0, Math.PI * 2);
      ctx.arc(headX + sideX * 6 * scale, headY + 1 * scale, 4.2 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1.8 * scale;
      ctx.beginPath();
      ctx.arc(headX, headY - 1 * scale, 9.6 * scale, Math.PI * 0.95, Math.PI * 2.05);
      ctx.stroke();
    }

    // Carita/dirección.
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(headX + dirX * 3 * scale + sideX * 2 * scale, headY + dirY * 3 * scale + sideY * 2 * scale, 1.5 * scale, 0, Math.PI * 2);
    ctx.arc(headX + dirX * 3 * scale - sideX * 2 * scale, headY + dirY * 3 * scale - sideY * 2 * scale, 1.5 * scale, 0, Math.PI * 2);
    ctx.fill();

    // Ajolote: branquias moradas para que se entienda la maldición.
    if (isAjolote) {
      ctx.strokeStyle = '#ff7cff';
      ctx.lineWidth = 3 * scale;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(headX + sideX * side * 8 * scale, headY);
        ctx.lineTo(headX + sideX * side * 16 * scale - dirX * 2, headY + sideY * side * 16 * scale - dirY * 2);
        ctx.moveTo(headX + sideX * side * 7 * scale, headY - 4 * scale);
        ctx.lineTo(headX + sideX * side * 15 * scale - dirX * 2, headY - 9 * scale + sideY * side * 12 * scale);
        ctx.moveTo(headX + sideX * side * 7 * scale, headY + 4 * scale);
        ctx.lineTo(headX + sideX * side * 15 * scale - dirX * 2, headY + 9 * scale + sideY * side * 12 * scale);
        ctx.stroke();
      }
    }

    // Número/rol encima, discreto.
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,.65)';
    ctx.lineWidth = 4;
    ctx.font = `900 ${isClara ? 11 : 9}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText(label, o.x, o.y - 36 * scale);
    ctx.fillText(label, o.x, o.y - 36 * scale);

    ctx.restore();
  }

  function drawPlayer() { drawCircleThing(player, state.ajoloteTimer > 0 ? 'AX' : 'HR', state.ajoloteTimer > 0 ? '#b95cff' : player.color, state.ajoloteTimer > 0 ? 'ajolote' : 'player'); }
  function drawRivals() { rivals.forEach((r,i)=>drawCircleThing(r, String(i+1), r.color)); }
  function drawGoalie() { drawCircleThing(goalie, 'GK', goalie.color, 'goalie'); }
  function drawBall() { ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(ball.x,ball.y,ball.r,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='#111'; ctx.lineWidth=3; ctx.stroke(); }
  function drawPossessionArrow() {
    if (ball.owner === 'rival' && rivals[ball.ownerIndex]) {
      const r = rivals[ball.ownerIndex];
      ctx.fillStyle = '#ffd22e';
      ctx.beginPath();
      ctx.moveTo(r.x, r.y - r.r - 18);
      ctx.lineTo(r.x - 9, r.y - r.r - 5);
      ctx.lineTo(r.x + 9, r.y - r.r - 5);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawPickups() {
    for (const p of pickups) {
      if (p.type === 'hiddenCoin') {
        ctx.fillStyle = '#ff9f1c';
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r+1,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle='#ffd22e'; ctx.lineWidth=3; ctx.stroke();
        ctx.fillStyle='rgba(0,0,0,.18)'; ctx.beginPath(); ctx.arc(p.x,p.y,p.r-4,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='#111'; ctx.font='900 9px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('HR', p.x, p.y+1);
      } else {
        ctx.fillStyle = p.type === 'chick' ? '#ffd22e' : p.type === 'gold' ? '#fff05a' : p.type === 'salsa' ? '#ff4141' : '#b78cff';
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();
        ctx.fillStyle='#111'; ctx.font='900 13px system-ui'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(p.type === 'salsa' ? 'S' : '🍗', p.x, p.y+1);
      }
    }
  }
  function drawClara() {
    if (!clara.active) return;
    drawCircleThing(clara, 'CB', '#ff4bb8', 'clara');
    ctx.strokeStyle='rgba(255,75,184,.35)'; ctx.lineWidth=8; ctx.beginPath(); ctx.arc(clara.x,clara.y,clara.r+10,0,Math.PI*2); ctx.stroke();
  }
  function drawEffects() {
    if (state.ajoloteTimer > 0) {
      ctx.fillStyle='rgba(112,34,180,.30)'; ctx.fillRect(0,0,W,H);
      ctx.strokeStyle='rgba(218,156,255,.55)'; ctx.lineWidth=8; ctx.strokeRect(fieldLeft()+4, fieldTop()+4, fieldRight()-fieldLeft()-8, fieldBottom()-fieldTop()-8);
    }
    if (state.invincibleTimer > 0) { ctx.strokeStyle='rgba(255,159,28,.9)'; ctx.lineWidth=4; ctx.beginPath(); ctx.arc(player.x,player.y,player.r+12,0,Math.PI*2); ctx.stroke(); ctx.fillStyle='rgba(255,159,28,.18)'; ctx.beginPath(); ctx.arc(player.x,player.y,player.r+17,0,Math.PI*2); ctx.fill(); }
    ctx.fillStyle='rgba(0,0,0,.35)'; ctx.fillRect(fieldLeft(), fieldBottom()+16, 120, 10);
    ctx.fillStyle= state.sprintEnergy > 25 ? '#21d46b' : '#ff4141'; ctx.fillRect(fieldLeft(), fieldBottom()+16, 120*(state.sprintEnergy/100),10);
    ctx.strokeStyle='rgba(255,255,255,.35)'; ctx.lineWidth=1; ctx.strokeRect(fieldLeft(), fieldBottom()+16,120,10);

    if (player.hasBall && state.shootCharge > 0) {
      const w = 100 * clamp(state.shootCharge / state.maxShootCharge, 0, 1);
      ctx.fillStyle='rgba(0,0,0,.45)'; ctx.fillRect(player.x - 50, player.y - player.r - 28, 100, 8);
      ctx.fillStyle='#ffd22e'; ctx.fillRect(player.x - 50, player.y - player.r - 28, w, 8);
      ctx.strokeStyle='rgba(255,255,255,.45)'; ctx.strokeRect(player.x - 50, player.y - player.r - 28, 100, 8);
    }
  }

  function loop(now) {
    if (!state.running) return;
    const dt = Math.min(0.033, (now - state.last) / 1000 || 0);
    state.last = now;
    update(dt); draw();
    requestAnimationFrame(loop);
  }

  window.addEventListener('keydown', (e) => { keys.add(e.key.toLowerCase()); if ([' ','arrowup','arrowdown','arrowleft','arrowright'].includes(e.key.toLowerCase())) e.preventDefault(); });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

  $('playBtn').addEventListener('click', newGame);
  $('retryBtn').addEventListener('click', newGame);
  $('howBtn').addEventListener('click', () => ui.howTo.classList.toggle('hidden'));

  // Controles tactiles: movimiento por joystick dinamico, botones fijos para tiro/sprint.
  $('shootTouch').addEventListener('touchstart', e => { state.touchShoot = true; e.preventDefault(); }, {passive:false});
  $('shootTouch').addEventListener('touchend', e => { state.touchShoot = false; e.preventDefault(); }, {passive:false});
  $('shootTouch').addEventListener('touchcancel', e => { state.touchShoot = false; e.preventDefault(); }, {passive:false});
  $('sprintTouch').addEventListener('touchstart', e => { state.touchSprint = true; e.preventDefault(); }, {passive:false});
  $('sprintTouch').addEventListener('touchend', e => { state.touchSprint = false; e.preventDefault(); }, {passive:false});
  $('sprintTouch').addEventListener('touchcancel', e => { state.touchSprint = false; e.preventDefault(); }, {passive:false});
})();


// dynamicJoystickEnabled
window.dynamicJoystickEnabled=true;



/* === Dynamic Joystick Safari Patch === */
(function () {
  const isTouchDevice = ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);
  if (!isTouchDevice) return;

  const MAX_RADIUS = 48;
  const DEAD_ZONE = 6;

  let activeTouchId = null;
  let startX = 0;
  let startY = 0;
  let joyX = 0;
  let joyY = 0;

  const root = document.createElement("div");
  root.className = "dynamic-joystick";
  root.innerHTML = '<div class="dynamic-joystick-knob"></div>';
  document.body.appendChild(root);
  const knob = root.querySelector(".dynamic-joystick-knob");

  function gamePanelIsRotated() {
    const panel = document.getElementById("gamePanel");
    if (!panel) return false;
    const transform = window.getComputedStyle(panel).transform;
    return transform && transform !== "none";
  }

  function screenVectorToGameVector(x, y) {
    if (!gamePanelIsRotated()) return { x, y };

    // In portrait, CSS rotates the game panel 90deg. Convert finger movement
    // back into the canvas axis so visual right/up match player movement.
    return { x: y, y: -x };
  }

  function setMovementVector(x, y) {
    const gameVector = screenVectorToGameVector(x, y);
    joyX = Math.abs(gameVector.x) < 0.08 ? 0 : gameVector.x;
    joyY = Math.abs(gameVector.y) < 0.08 ? 0 : gameVector.y;

    // Common control object names used by small canvas games.
    window.__golGanaJoystick = { x: joyX, y: joyY, active: activeTouchId !== null };

    if (window.input) {
      window.input.x = joyX;
      window.input.y = joyY;
      window.input.joystickX = joyX;
      window.input.joystickY = joyY;
      window.input.left = joyX < -0.2;
      window.input.right = joyX > 0.2;
      window.input.up = joyY < -0.2;
      window.input.down = joyY > 0.2;
    }

    if (window.controls) {
      window.controls.x = joyX;
      window.controls.y = joyY;
      window.controls.joystickX = joyX;
      window.controls.joystickY = joyY;
      window.controls.left = joyX < -0.2;
      window.controls.right = joyX > 0.2;
      window.controls.up = joyY < -0.2;
      window.controls.down = joyY > 0.2;
    }

    // Keyboard fallback used by many prototypes.
    if (window.keys) {
      window.keys.ArrowLeft = joyX < -0.2;
      window.keys.ArrowRight = joyX > 0.2;
      window.keys.ArrowUp = joyY < -0.2;
      window.keys.ArrowDown = joyY > 0.2;
      window.keys.a = joyX < -0.2;
      window.keys.d = joyX > 0.2;
      window.keys.w = joyY < -0.2;
      window.keys.s = joyY > 0.2;
    }
  }

  function shouldStartJoystick(touch) {
    // Left side starts movement. Right side remains for shoot/sprint buttons.
    return touch.clientX < window.innerWidth * 0.58;
  }

  function showJoystick(x, y) {
    root.style.left = x + "px";
    root.style.top = y + "px";
    knob.style.transform = "translate(0px, 0px)";
    root.classList.add("active");
  }

  function hideJoystick() {
    root.classList.remove("active");
    knob.style.transform = "translate(0px, 0px)";
    activeTouchId = null;
    setMovementVector(0, 0);
  }

  function updateJoystick(x, y) {
    let dx = x - startX;
    let dy = y - startY;
    const dist = Math.hypot(dx, dy);

    if (dist > MAX_RADIUS) {
      dx = (dx / dist) * MAX_RADIUS;
      dy = (dy / dist) * MAX_RADIUS;
    }

    knob.style.transform = `translate(${dx}px, ${dy}px)`;

    if (Math.hypot(dx, dy) < DEAD_ZONE) {
      setMovementVector(0, 0);
    } else {
      setMovementVector(dx / MAX_RADIUS, dy / MAX_RADIUS);
    }
  }

  function onTouchStart(e) {
    if (window.PointerEvent) return;
    if (activeTouchId !== null) return;

    for (const touch of e.changedTouches) {
      if (!shouldStartJoystick(touch)) continue;

      activeTouchId = touch.identifier;
      startX = touch.clientX;
      startY = touch.clientY;
      showJoystick(startX, startY);
      setMovementVector(0, 0);
      e.preventDefault();
      break;
    }
  }

  function onTouchMove(e) {
    if (window.PointerEvent) return;
    if (activeTouchId === null) return;

    for (const touch of e.changedTouches) {
      if (touch.identifier !== activeTouchId) continue;
      updateJoystick(touch.clientX, touch.clientY);
      e.preventDefault();
      break;
    }
  }

  function onTouchEnd(e) {
    if (window.PointerEvent) return;
    if (activeTouchId === null) return;

    for (const touch of e.changedTouches) {
      if (touch.identifier !== activeTouchId) continue;
      hideJoystick();
      e.preventDefault();
      break;
    }
  }

  document.addEventListener("touchstart", onTouchStart, { passive: false });
  document.addEventListener("touchmove", onTouchMove, { passive: false });
  document.addEventListener("touchend", onTouchEnd, { passive: false });
  document.addEventListener("touchcancel", onTouchEnd, { passive: false });

  // Also support pointer events where available.
  document.addEventListener("pointerdown", function (e) {
    if (activeTouchId !== null || e.pointerType !== "touch") return;
    if (e.clientX >= window.innerWidth * 0.58) return;
    activeTouchId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    showJoystick(startX, startY);
    setMovementVector(0, 0);
    e.preventDefault();
  }, { passive: false });

  document.addEventListener("pointermove", function (e) {
    if (activeTouchId !== e.pointerId || e.pointerType !== "touch") return;
    updateJoystick(e.clientX, e.clientY);
    e.preventDefault();
  }, { passive: false });

  document.addEventListener("pointerup", function (e) {
    if (activeTouchId !== e.pointerId || e.pointerType !== "touch") return;
    hideJoystick();
    e.preventDefault();
  }, { passive: false });

  document.addEventListener("pointercancel", function (e) {
    if (activeTouchId !== e.pointerId || e.pointerType !== "touch") return;
    hideJoystick();
    e.preventDefault();
  }, { passive: false });
})();
