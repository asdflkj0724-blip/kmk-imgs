// ゴリラのバナナあつめ
// 画像素材を使わず、Canvas だけでゴリラ・バナナ・ジャングルを描画します。
(function () {
  'use strict';

  // ===== 設定 =====
  const W = 800;
  const H = 560;
  const GAME_TIME = 60; // 制限時間（秒）
  const BANANA_COUNT = 10; // フィールド上のバナナの数（常にこの数を保つ）
  const GORILLA_SPEED = 260; // ピクセル/秒
  const GORILLA_RADIUS = 38; // 当たり判定の半径
  const BANANA_RADIUS = 32; // 当たり判定の半径
  const MARGIN = 40; // フィールドの端からの余白
  const BEST_KEY = 'gorillaBanana.best';
  const SOUND_KEY = 'gorillaBanana.sound';

  // ===== DOM =====
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const timeEl = document.getElementById('time');
  const bestEl = document.getElementById('best');
  const timeBox = timeEl.parentElement;
  const soundBtn = document.getElementById('soundBtn');
  const startScreen = document.getElementById('startScreen');
  const endScreen = document.getElementById('endScreen');
  const startBtn = document.getElementById('startBtn');
  const retryBtn = document.getElementById('retryBtn');
  const finalScoreEl = document.getElementById('finalScore');
  const newRecordEl = document.getElementById('newRecord');
  const messageEl = document.getElementById('message');

  // ===== 保存（localStorage が使えない環境でも動くように） =====
  function load(key, fallback) {
    try {
      const v = window.localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }
  function save(key, value) {
    try {
      window.localStorage.setItem(key, String(value));
    } catch (e) {
      // 保存できなくてもゲームは続ける
    }
  }

  let best = parseInt(load(BEST_KEY, '0'), 10) || 0;
  let soundOn = load(SOUND_KEY, 'on') !== 'off';

  // ===== 効果音（Web Audio API で合成） =====
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function tone(freq, start, duration, type, volume, slideTo) {
    const ac = audioCtx;
    if (!ac) return;
    const t0 = ac.currentTime + start;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume || 0.25, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  const sfx = {
    eat() {
      if (!soundOn || !ensureAudio()) return;
      // 「もぐっ」＋「ピロリン♪」
      tone(220, 0, 0.08, 'square', 0.12, 120);
      tone(784, 0.06, 0.1, 'triangle', 0.25);
      tone(1047, 0.13, 0.1, 'triangle', 0.25);
      tone(1319, 0.2, 0.18, 'triangle', 0.25);
    },
    start() {
      if (!soundOn || !ensureAudio()) return;
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.1, 0.15, 'square', 0.12));
    },
    tick(n) {
      if (!soundOn || !ensureAudio()) return;
      tone(n <= 3 ? 1200 : 880, 0, 0.12, 'sine', 0.3);
    },
    end() {
      if (!soundOn || !ensureAudio()) return;
      [784, 659, 523, 659, 784, 1047].forEach((f, i) =>
        tone(f, i * 0.13, i === 5 ? 0.5 : 0.15, 'triangle', 0.25)
      );
    },
    record() {
      if (!soundOn || !ensureAudio()) return;
      [1047, 1319, 1568, 2093].forEach((f, i) => tone(f, 0.9 + i * 0.09, 0.2, 'square', 0.1));
    },
  };

  function updateSoundBtn() {
    soundBtn.textContent = soundOn ? '🔊 おと オン' : '🔇 おと オフ';
    soundBtn.classList.toggle('off', !soundOn);
    soundBtn.setAttribute('aria-pressed', String(soundOn));
  }
  soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    save(SOUND_KEY, soundOn ? 'on' : 'off');
    updateSoundBtn();
    if (soundOn) {
      ensureAudio();
      tone(880, 0, 0.1, 'triangle', 0.2);
    }
    soundBtn.blur(); // スペースキーで再度押されないように
  });

  // ===== ジャングルの背景（一度だけ描いて使い回す） =====
  const bg = document.createElement('canvas');
  bg.width = W;
  bg.height = H;
  (function drawBackground() {
    const g = bg.getContext('2d');
    // 決まった模様になるよう簡単な疑似乱数を使う
    let seed = 7;
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    // 草原
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#7ed957');
    grad.addColorStop(1, '#4fbf3a');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    // 明るい芝生のまだら模様
    for (let i = 0; i < 40; i++) {
      g.fillStyle = i % 2 ? 'rgba(255,255,255,0.08)' : 'rgba(0,80,0,0.07)';
      g.beginPath();
      g.ellipse(rnd() * W, rnd() * H, 40 + rnd() * 70, 20 + rnd() * 30, 0, 0, Math.PI * 2);
      g.fill();
    }

    // 草むら
    for (let i = 0; i < 90; i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      g.strokeStyle = rnd() < 0.5 ? '#3a9a2a' : '#2f8a22';
      g.lineWidth = 3;
      g.lineCap = 'round';
      for (let k = -1; k <= 1; k++) {
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + k * 4, y - 8, x + k * 8, y - 14);
        g.stroke();
      }
    }

    // 花
    const flowerColors = ['#ff6fa8', '#ffd93b', '#ff8a3d', '#b07cff', '#ffffff', '#4fc3ff'];
    for (let i = 0; i < 30; i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      const c = flowerColors[Math.floor(rnd() * flowerColors.length)];
      g.fillStyle = c;
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2;
        g.beginPath();
        g.arc(x + Math.cos(a) * 6, y + Math.sin(a) * 6, 5, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#ffe14d';
      if (c === '#ffd93b') g.fillStyle = '#ff7a00';
      g.beginPath();
      g.arc(x, y, 4, 0, Math.PI * 2);
      g.fill();
    }

    // まわりの大きな葉っぱ（ジャングルのふち）
    function leaf(x, y, len, angle, color) {
      g.save();
      g.translate(x, y);
      g.rotate(angle);
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(len * 0.5, -len * 0.35, len, 0);
      g.quadraticCurveTo(len * 0.5, len * 0.35, 0, 0);
      g.fill();
      g.strokeStyle = 'rgba(0,60,0,0.35)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(len * 0.95, 0);
      g.stroke();
      g.restore();
    }
    const leafColors = ['#1f8f3a', '#27a844', '#156e2c', '#33b850'];
    const edgeLeaves = [];
    for (let x = 0; x <= W; x += 50) {
      edgeLeaves.push([x, -10, Math.PI / 2]);
      edgeLeaves.push([x, H + 10, -Math.PI / 2]);
    }
    for (let y = 0; y <= H; y += 50) {
      edgeLeaves.push([-10, y, 0]);
      edgeLeaves.push([W + 10, y, Math.PI]);
    }
    edgeLeaves.forEach(([x, y, a]) => {
      const c = leafColors[Math.floor(rnd() * leafColors.length)];
      leaf(x, y, 45 + rnd() * 25, a + (rnd() - 0.5) * 1.2, c);
    });

    // 四すみのヤシの木の葉
    function palm(x, y) {
      for (let i = 0; i < 7; i++) {
        leaf(x, y, 110, (i / 7) * Math.PI * 2 + 0.3, leafColors[i % leafColors.length]);
      }
      g.fillStyle = '#8b5a2b';
      g.beginPath();
      g.arc(x, y, 14, 0, Math.PI * 2);
      g.fill();
    }
    palm(10, 10);
    palm(W - 10, 10);
    palm(10, H - 10);
    palm(W - 10, H - 10);
  })();

  // ===== ゲームの状態 =====
  const keys = { up: false, down: false, left: false, right: false };
  let state = 'title'; // 'title' | 'playing' | 'timeup'
  let score = 0;
  let timeLeft = GAME_TIME;
  let lastCountdown = null;
  let endTimer = 0;
  let bananas = [];
  let target = null; // マウスでクリックしたバナナ（ゴリラがそこまで歩いていく）
  let effects = []; // 食べたバナナのアニメーション
  let particles = [];
  let floatTexts = [];

  const gorilla = {
    x: W / 2,
    y: H / 2,
    facing: 1, // 1: 右向き, -1: 左向き
    walk: 0, // 歩きアニメーション用
    moving: false,
    chomp: 0, // もぐもぐアニメーション（秒）
  };

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  // ゴリラや他のバナナと重ならない場所にバナナを置く
  function spawnBanana() {
    let x = 0;
    let y = 0;
    for (let tries = 0; tries < 60; tries++) {
      x = rand(MARGIN + BANANA_RADIUS, W - MARGIN - BANANA_RADIUS);
      y = rand(MARGIN + BANANA_RADIUS, H - MARGIN - BANANA_RADIUS);
      const farFromGorilla = Math.hypot(x - gorilla.x, y - gorilla.y) > GORILLA_RADIUS + BANANA_RADIUS + 50;
      const farFromOthers = bananas.every((b) => Math.hypot(x - b.x, y - b.y) > BANANA_RADIUS * 2.6);
      if (farFromGorilla && farFromOthers) break;
    }
    bananas.push({
      x,
      y,
      angle: rand(-0.6, 0.6),
      phase: rand(0, Math.PI * 2),
      appear: 0, // 0 → 1 でぽんっと出てくる
    });
  }

  function resetGame() {
    score = 0;
    timeLeft = GAME_TIME;
    lastCountdown = null;
    endTimer = 0;
    gorilla.x = W / 2;
    gorilla.y = H / 2;
    gorilla.facing = 1;
    gorilla.chomp = 0;
    gorilla.walk = 0;
    bananas = [];
    target = null;
    effects = [];
    particles = [];
    floatTexts = [];
    for (let i = 0; i < BANANA_COUNT; i++) spawnBanana();
    updateHud();
  }

  function updateHud() {
    scoreEl.textContent = score;
    timeEl.textContent = Math.ceil(timeLeft);
    bestEl.textContent = best;
    timeBox.classList.toggle('hurry', state === 'playing' && timeLeft <= 10);
  }

  function startGame() {
    ensureAudio();
    resetGame();
    state = 'playing';
    startScreen.classList.add('hidden');
    endScreen.classList.add('hidden');
    keys.up = keys.down = keys.left = keys.right = false;
    sfx.start();
    grabFocus();
  }

  function finishGame() {
    state = 'timeup';
    timeLeft = 0;
    endTimer = 0;
    keys.up = keys.down = keys.left = keys.right = false;
    updateHud();
    sfx.end();

    const isRecord = score > best;
    if (isRecord) {
      best = score;
      save(BEST_KEY, best);
      sfx.record();
    }
    bestEl.textContent = best;
    finalScoreEl.textContent = score;
    newRecordEl.classList.toggle('hidden', !isRecord);
    messageEl.textContent = messageFor(score);
  }

  function messageFor(n) {
    if (n >= 50) return 'すごすぎる！ バナナの おうさまだ！👑';
    if (n >= 35) return 'すごい！ ゴリラも おなか いっぱい！';
    if (n >= 20) return 'よくできました！ その ちょうし！';
    if (n >= 10) return 'がんばったね！ つぎは もっと とれるかな？';
    return 'つぎは もっと たべよう！ ファイト！';
  }

  // ===== 入力 =====
  const keyMap = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    w: 'up',
    s: 'down',
    a: 'left',
    d: 'right',
    W: 'up',
    S: 'down',
    A: 'left',
    D: 'right',
    // 古いブラウザ用の名前
    Up: 'up',
    Down: 'down',
    Left: 'left',
    Right: 'right',
  };
  const codeMap = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    KeyW: 'up',
    KeyS: 'down',
    KeyA: 'left',
    KeyD: 'right',
  };
  function dirOf(e) {
    return keyMap[e.key] || codeMap[e.code] || null;
  }

  // ゲーム画面にキー入力が届いているか（別の場所をクリックすると届かなくなる）
  let hasFocus = document.hasFocus ? document.hasFocus() : true;
  function grabFocus() {
    try {
      window.focus();
    } catch (err) {
      // フォーカスできない環境では何もしない
    }
    canvas.focus({ preventScroll: true });
  }

  window.addEventListener('keydown', (e) => {
    hasFocus = true;
    const dir = dirOf(e);
    if (dir) {
      e.preventDefault(); // 矢印キーでページがスクロールしないように
      // スタート画面では矢印キーを押すだけでゲームが始まる
      if (state === 'title') startGame();
      if (state === 'playing') {
        keys[dir] = true;
        target = null; // 矢印キーを使ったらクリックの行き先は取り消す
      }
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      if (state === 'title' || (state === 'timeup' && !endScreen.classList.contains('hidden'))) {
        e.preventDefault();
        startGame();
      } else if (state === 'playing') {
        e.preventDefault();
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    const dir = dirOf(e);
    if (dir) keys[dir] = false;
  });

  // ウィンドウからフォーカスが外れたら止める（キーが押しっぱなしにならないように）
  window.addEventListener('blur', () => {
    hasFocus = false;
    keys.up = keys.down = keys.left = keys.right = false;
  });
  window.addEventListener('focus', () => {
    hasFocus = true;
  });
  // ゲーム画面をクリックしたら、キー入力がゲームに届くようにする
  document.getElementById('stage').addEventListener('pointerdown', (e) => {
    if (e.target === canvas) {
      e.preventDefault();
      grabFocus();
      if (state === 'playing') pickBanana(e);
    }
    hasFocus = true;
  });

  // クリックした場所のいちばん近くにあるバナナを行き先にする
  function pickBanana(e) {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    let best = null;
    let bestDist = BANANA_RADIUS + 30; // 少しはずれてもバナナを選べるように
    bananas.forEach((b) => {
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    });
    if (best) {
      target = best;
      best.picked = 0; // 選んだときの「ぽよん」アニメーション用
      if (soundOn && ensureAudio()) tone(660, 0, 0.08, 'triangle', 0.18);
    }
  }

  startBtn.addEventListener('click', startGame);
  retryBtn.addEventListener('click', startGame);

  // ===== 更新 =====
  function update(dt) {
    // バナナの出現アニメーション
    bananas.forEach((b) => {
      b.appear = Math.min(1, b.appear + dt * 4);
      b.phase += dt * 3;
    });

    if (state === 'playing' && !hasFocus) {
      // キーが届かない間は時間を止めて「クリックしてね」を出す
    } else if (state === 'playing') {
      timeLeft -= dt;

      // 残り10秒からカウントダウン音
      const sec = Math.ceil(timeLeft);
      if (sec <= 10 && sec >= 1 && sec !== lastCountdown) {
        lastCountdown = sec;
        sfx.tick(sec);
      }

      if (timeLeft <= 0) {
        finishGame();
      } else {
        moveGorilla(dt);
        eatBananas();
      }
      updateHud();
    } else if (state === 'timeup') {
      endTimer += dt;
      if (endTimer > 1.2 && endScreen.classList.contains('hidden')) {
        endScreen.classList.remove('hidden');
        retryBtn.focus();
      }
    }

    gorilla.chomp = Math.max(0, gorilla.chomp - dt);

    // 食べたバナナがゴリラの口に吸い込まれる
    effects = effects.filter((ef) => {
      ef.t += dt;
      return ef.t < ef.dur;
    });

    particles = particles.filter((p) => {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 300 * dt;
      p.rot += p.vr * dt;
      return p.life > 0;
    });

    floatTexts = floatTexts.filter((f) => {
      f.t += dt;
      f.y -= 60 * dt;
      return f.t < 1;
    });
  }

  function moveGorilla(dt) {
    let dx = 0;
    let dy = 0;
    if (keys.left) dx -= 1;
    if (keys.right) dx += 1;
    if (keys.up) dy -= 1;
    if (keys.down) dy += 1;

    // 矢印キーを押していないときは、クリックしたバナナに向かって歩く
    if (dx === 0 && dy === 0 && target) {
      if (!bananas.includes(target)) {
        target = null;
      } else {
        const tx = target.x - gorilla.x;
        const ty = target.y - gorilla.y;
        const dist = Math.hypot(tx, ty);
        const step = GORILLA_SPEED * dt;
        if (dist <= step) {
          gorilla.x = target.x;
          gorilla.y = target.y;
          gorilla.walk += dt * 12;
          gorilla.moving = false;
          return clampGorilla();
        }
        dx = tx / dist;
        dy = ty / dist;
        if (Math.abs(tx) > 4) gorilla.facing = tx > 0 ? 1 : -1;
      }
    }

    gorilla.moving = dx !== 0 || dy !== 0;
    if (gorilla.moving) {
      const len = Math.hypot(dx, dy);
      gorilla.x += (dx / len) * GORILLA_SPEED * dt;
      gorilla.y += (dy / len) * GORILLA_SPEED * dt;
      if (dx !== 0 && !target) gorilla.facing = dx > 0 ? 1 : -1;
      gorilla.walk += dt * 12;
    }
    clampGorilla();
  }

  function clampGorilla() {
    // フィールドの外に出ないように
    gorilla.x = Math.max(MARGIN, Math.min(W - MARGIN, gorilla.x));
    gorilla.y = Math.max(MARGIN + 10, Math.min(H - MARGIN, gorilla.y));
  }

  function eatBananas() {
    for (let i = bananas.length - 1; i >= 0; i--) {
      const b = bananas[i];
      if (Math.hypot(b.x - gorilla.x, b.y - gorilla.y) < GORILLA_RADIUS + BANANA_RADIUS - 6) {
        bananas.splice(i, 1);
        if (b === target) target = null;
        score += 1;
        gorilla.chomp = 0.35;
        effects.push({ x: b.x, y: b.y, angle: b.angle, t: 0, dur: 0.25 });
        floatTexts.push({ x: b.x, y: b.y - 20, t: 0 });
        for (let k = 0; k < 10; k++) {
          const a = rand(0, Math.PI * 2);
          const sp = rand(80, 220);
          particles.push({
            x: b.x,
            y: b.y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp - 120,
            life: rand(0.4, 0.8),
            rot: rand(0, Math.PI),
            vr: rand(-8, 8),
            color: ['#ffe14d', '#ff9f1c', '#ff6fa8', '#ffffff', '#7be0ff'][k % 5],
            star: k % 2 === 0,
          });
        }
        sfx.eat();
        spawnBanana(); // 1本食べたら1本ふえる → いつもたくさんある
      }
    }
  }

  // ===== 描画 =====
  function drawBanana(x, y, angle, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(scale * 1.35, scale * 1.35); // 大きめのバナナ

    // 影
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(0, 22, 28, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // バナナ本体（三日月形）
    ctx.beginPath();
    ctx.moveTo(-30, -12);
    ctx.quadraticCurveTo(0, 34, 30, -12);
    ctx.quadraticCurveTo(0, 10, -30, -12);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, -10, 0, 22);
    grad.addColorStop(0, '#fff27a');
    grad.addColorStop(0.6, '#ffd60a');
    grad.addColorStop(1, '#f2b705');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#b8860b';
    ctx.stroke();

    // つや
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-16, 4);
    ctx.quadraticCurveTo(0, 16, 14, 5);
    ctx.stroke();

    // 先っぽ（茶色）
    ctx.fillStyle = '#6b4a1e';
    ctx.beginPath();
    ctx.arc(-30, -12, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(28, -11);
    ctx.lineTo(34, -20);
    ctx.lineTo(38, -17);
    ctx.lineTo(32, -9);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawGorilla() {
    const g = gorilla;
    const bob = g.moving ? Math.sin(g.walk) * 3 : Math.sin(performance.now() / 400) * 1.5;
    const swing = g.moving ? Math.sin(g.walk) * 0.5 : 0;

    ctx.save();
    ctx.translate(g.x, g.y);

    // 影
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(0, 40, 38, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(0, bob);
    ctx.scale(g.facing, 1);

    const fur = '#4a3b35';
    const furDark = '#3a2d28';
    const skin = '#c9a28a';
    const skinLight = '#e3c4ad';

    // 足
    ctx.fillStyle = furDark;
    ctx.beginPath();
    ctx.ellipse(-16, 34 + (g.moving ? Math.sin(g.walk) * 3 : 0), 11, 8, 0, 0, Math.PI * 2);
    ctx.ellipse(16, 34 - (g.moving ? Math.sin(g.walk) * 3 : 0), 11, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // うで（後ろ）
    function arm(side, rot) {
      ctx.save();
      ctx.translate(side * 30, 2);
      ctx.rotate(side * 0.4 + rot);
      ctx.fillStyle = fur;
      ctx.beginPath();
      ctx.ellipse(0, 14, 10, 20, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.arc(0, 32, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    const happy = g.chomp > 0;
    arm(-1, happy ? 1.8 : swing);
    arm(1, happy ? -1.8 : -swing);

    // からだ
    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.ellipse(0, 14, 30, 28, 0, 0, Math.PI * 2);
    ctx.fill();
    // おなか
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.ellipse(0, 18, 18, 18, 0, 0, Math.PI * 2);
    ctx.fill();

    // あたま
    const hy = -24;
    // 耳
    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.arc(-26, hy, 9, 0, Math.PI * 2);
    ctx.arc(26, hy, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(-26, hy, 5, 0, Math.PI * 2);
    ctx.arc(26, hy, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.ellipse(0, hy - 2, 26, 25, 0, 0, Math.PI * 2);
    ctx.fill();
    // あたまのてっぺん（ちょっととがった毛）
    ctx.beginPath();
    ctx.moveTo(-8, hy - 24);
    ctx.quadraticCurveTo(0, hy - 36, 6, hy - 25);
    ctx.fill();

    // 顔（ハート型っぽく）
    ctx.fillStyle = skinLight;
    ctx.beginPath();
    ctx.ellipse(-8, hy - 4, 10, 10, 0, 0, Math.PI * 2);
    ctx.ellipse(8, hy - 4, 10, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, hy + 8, 18, 13, 0, 0, Math.PI * 2);
    ctx.fill();

    // 目
    if (happy) {
      // にっこり目
      ctx.strokeStyle = '#2a1a10';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(-8, hy - 3, 4.5, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(8, hy - 3, 4.5, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#2a1a10';
      ctx.beginPath();
      ctx.arc(-8, hy - 4, 5, 0, Math.PI * 2);
      ctx.arc(8, hy - 4, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(-6.5, hy - 6, 2, 0, Math.PI * 2);
      ctx.arc(9.5, hy - 6, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // ほっぺ
    ctx.fillStyle = 'rgba(255,120,140,0.55)';
    ctx.beginPath();
    ctx.ellipse(-16, hy + 6, 5, 3, 0, 0, Math.PI * 2);
    ctx.ellipse(16, hy + 6, 5, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // 鼻
    ctx.fillStyle = '#5a3f33';
    ctx.beginPath();
    ctx.ellipse(-3, hy + 4, 2, 1.6, 0, 0, Math.PI * 2);
    ctx.ellipse(3, hy + 4, 2, 1.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // 口
    if (happy) {
      // もぐもぐ（口を開け閉め）
      const open = Math.abs(Math.sin(g.chomp * 30)) * 6 + 2;
      ctx.fillStyle = '#8a2a2a';
      ctx.beginPath();
      ctx.ellipse(0, hy + 13, 7, open, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff8fa0';
      ctx.beginPath();
      ctx.ellipse(0, hy + 13 + open * 0.4, 4, open * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = '#5a3f33';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, hy + 9, 7, Math.PI * 0.2, Math.PI * 0.8);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawStar(x, y, r, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 === 0 ? r : r * 0.45;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function outlinedText(text, x, y, size, fill, stroke) {
    ctx.font = `bold ${size}px "Hiragino Maru Gothic ProN", "Yu Gothic", "Meiryo", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, size / 8);
    ctx.strokeStyle = stroke;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  }

  function draw() {
    ctx.drawImage(bg, 0, 0);

    // クリックしたバナナの目印（くるくる回る点線の輪）
    if (target && state === 'playing') {
      target.picked = Math.min(1, (target.picked || 0) + 1 / 15);
      const t = performance.now() / 1000;
      const r = (BANANA_RADIUS + 14) * (0.6 + 0.4 * easeOutBack(target.picked)) + Math.sin(t * 6) * 3;
      ctx.save();
      ctx.translate(target.x, target.y);
      ctx.rotate(t * 2);
      ctx.setLineDash([10, 8]);
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ff6fa8';
      ctx.stroke();
      ctx.restore();
    }

    // バナナ（ふわふわ揺れる）
    bananas.forEach((b) => {
      const s = easeOutBack(b.appear);
      drawBanana(b.x, b.y + Math.sin(b.phase) * 3, b.angle + Math.sin(b.phase * 0.7) * 0.08, s);
    });

    // 食べられたバナナ：ゴリラの口に吸い込まれて小さくなる
    effects.forEach((ef) => {
      const p = ef.t / ef.dur;
      const mx = gorilla.x;
      const my = gorilla.y - 12;
      drawBanana(ef.x + (mx - ef.x) * p, ef.y + (my - ef.y) * p, ef.angle + p * 3, 1 - p);
    });

    // ゴリラは y 座標が大きいバナナより後ろに描かれないよう最後に描く
    drawGorilla();

    // キラキラ
    particles.forEach((p) => {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = p.color;
      if (p.star) {
        drawStar(p.x, p.y, 8, p.rot);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ctx.globalAlpha = 1;

    // +1
    floatTexts.forEach((f) => {
      ctx.globalAlpha = 1 - f.t;
      const size = 34 + Math.sin(Math.min(1, f.t * 4) * Math.PI) * 10;
      outlinedText('+1', f.x, f.y, size, '#ffe600', '#c0392b');
    });
    ctx.globalAlpha = 1;

    // 残り10秒のカウントダウン
    if (state === 'playing' && timeLeft <= 10) {
      const sec = Math.ceil(timeLeft);
      const frac = sec - timeLeft; // 0 → 1（1秒ごと）
      const size = 170 - frac * 40;
      ctx.globalAlpha = 1 - frac * 0.3;
      outlinedText(String(sec), W / 2, H / 2, size, sec <= 3 ? '#ff4040' : '#ffe600', '#5a3a1a');
      ctx.globalAlpha = 1;
    }

    if (state === 'playing' && !hasFocus) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, W, H);
      outlinedText('ちょっと おやすみ', W / 2, H / 2 - 40, 56, '#ffffff', '#5a3a1a');
      outlinedText('ゲームの がめんを クリックしてね', W / 2, H / 2 + 40, 36, '#ffe600', '#5a3a1a');
    }

    if (state === 'timeup') {
      const s = Math.min(1, endTimer * 3);
      ctx.fillStyle = `rgba(0,0,0,${0.25 * s})`;
      ctx.fillRect(0, 0, W, H);
      if (endScreen.classList.contains('hidden')) {
        outlinedText('タイムアップ！', W / 2, H / 2, 40 + 50 * easeOutBack(s), '#ffe600', '#c0392b');
      }
    }
  }

  function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  // ===== メインループ =====
  let prev = performance.now();
  function loop(now) {
    // タブを離れていた時などに大きく進みすぎないよう上限をつける
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  // 初期化
  updateSoundBtn();
  resetGame();
  state = 'title';
  updateHud();
  startBtn.focus({ preventScroll: true });
  requestAnimationFrame(loop);

  // テスト・デバッグ用（ゲームには影響しません）
  window.__gorillaGame = {
    get state() { return state; },
    get score() { return score; },
    get timeLeft() { return timeLeft; },
    get bananaCount() { return bananas.length; },
    get gorilla() { return { x: gorilla.x, y: gorilla.y }; },
    get bananas() { return bananas.map((b) => ({ x: b.x, y: b.y })); },
    get hasTarget() { return !!target; },
    setTimeLeft(t) { timeLeft = t; },
  };
})();
