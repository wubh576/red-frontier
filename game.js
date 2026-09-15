/* Canvas artwork, input and UI. Assets are generated locally at startup. */
(() => {
  "use strict";
  const {
    Game,
    TYPES,
    DIFFICULTIES,
    TILE,
    COLS,
    ROWS,
    WIDTH,
    HEIGHT,
    clamp,
    dist,
    cell,
  } = RTS;
  const $ = (id) => document.getElementById(id);
  const canvas = $("battle"),
    ctx = canvas.getContext("2d"),
    radar = $("radar"),
    rctx = radar.getContext("2d");
  let game = new Game(),
    started = false,
    paused = true,
    modalMode = "intro",
    activeTab = "buildings";
  let selected = new Set(),
    placing = false,
    attackMode = false,
    drag = null,
    pointer = { x: 0, y: 0, inside: false };
  let camera = { x: 0, y: 760, zoom: 0.9 },
    viewW = 900,
    viewH = 700,
    lastTime = 0,
    accumulator = 0,
    uiTimer = 0,
    endShown = false;
  let soundOn = false,
    audioCtx = null,
    toastTimer = 0,
    marker = null,
    keys = new Set(),
    queueSignature = "";
  let randomSeed = 7;
  const random = () => {
    randomSeed = (randomSeed * 1664525 + 1013904223) >>> 0;
    return randomSeed / 4294967296;
  };
  const terrain = document.createElement("canvas");
  terrain.width = WIDTH;
  terrain.height = HEIGHT;
  const tc = terrain.getContext("2d");
  const teamColors = [
    { base: "#749c8d", light: "#bed9b8", dark: "#395a50", stripe: "#b5dfbb" },
    { base: "#a56652", light: "#ddb18a", dark: "#683e35", stripe: "#f09970" },
  ];
  function polygon(c, points, fill, stroke) {
    c.beginPath();
    points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (stroke) {
      c.strokeStyle = stroke;
      c.stroke();
    }
  }
  function circle(c, x, y, r, fill, stroke) {
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (stroke) {
      c.strokeStyle = stroke;
      c.stroke();
    }
  }
  function line(c, x1, y1, x2, y2, color, width = 1) {
    c.strokeStyle = color;
    c.lineWidth = width;
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.stroke();
  }
  function makeTerrain() {
    randomSeed = game.seed;
    tc.fillStyle = "#5a6246";
    tc.fillRect(0, 0, WIDTH, HEIGHT);
    const colors = ["#60674a", "#586044", "#63694c", "#565e43", "#5e6547"];
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        tc.fillStyle = colors[Math.floor(random() * colors.length)];
        tc.fillRect(x * TILE, y * TILE, TILE, TILE);
        tc.strokeStyle = "#9eaa7510";
        tc.lineWidth = 1;
        tc.strokeRect(x * TILE, y * TILE, TILE, TILE);
      }
    // Weathered service roads connect both ends of the basin.
    for (const road of game.roads) {
      for (const [width, color] of [
        [105, "#727456"],
        [80, "#7a7a5a"],
        [65, "#78775a"],
      ]) {
        tc.lineWidth = width;
        tc.strokeStyle = color;
        tc.lineJoin = "round";
        tc.beginPath();
        road.forEach(([x, y], i) => (i ? tc.lineTo(x, y) : tc.moveTo(x, y)));
        tc.stroke();
      }
      tc.setLineDash([3, 15]);
      tc.strokeStyle = "#c8c19833";
      tc.lineWidth = 2;
      tc.stroke();
      tc.setLineDash([]);
    }
    for (let i = 0; i < 24000; i++) {
      const x = random() * WIDTH,
        y = random() * HEIGHT;
      tc.fillStyle = random() > 0.5 ? "#1b29130c" : "#d2cea916";
      tc.fillRect(x, y, random() * 3 + 1, 1 + random() * 2);
    }
    for (let i = 0; i < 900; i++) {
      const x = random() * WIDTH,
        y = random() * HEIGHT;
      if (game.terrain[cell(x, y)]) continue;
      tc.fillStyle = "#364b3280";
      tc.fillRect(x, y, 3, 2);
      tc.fillStyle = "#a1a77375";
      tc.fillRect(x - 1, y - 3, 2, 4);
      if (random() > 0.7) {
        tc.fillStyle = "#3c4d32";
        tc.fillRect(x + 4, y - 2, 2, 3);
      }
    }
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++)
        if (game.terrain[y * COLS + x]) {
          const px = x * TILE,
            py = y * TILE;
          tc.fillStyle = "#39422f88";
          tc.fillRect(px + 8, py + 16, TILE, TILE);
          polygon(
            tc,
            [
              [px + 3, py + 10],
              [px + 16, py + 1],
              [px + 39, py + 4],
              [px + 47, py + 19],
              [px + 41, py + 44],
              [px + 5, py + 42],
            ],
            "#77765c",
            "#4d513b",
          );
          polygon(
            tc,
            [
              [px + 3, py + 10],
              [px + 16, py + 1],
              [px + 39, py + 4],
              [px + 30, py + 15],
              [px + 11, py + 20],
            ],
            "#929075",
          );
          polygon(
            tc,
            [
              [px + 11, py + 20],
              [px + 30, py + 15],
              [px + 41, py + 44],
              [px + 5, py + 42],
            ],
            "#62634b",
          );
          line(tc, px + 11, py + 20, px + 18, py + 36, "#474e38", 2);
        }
    tc.font = "11px monospace";
    tc.fillStyle = "#a5aa7966";
    tc.fillText("07 / GREYSTONE BASIN", 920, 1430);
    for (const [x, y] of [
      [870, 390],
      [1420, 1310],
      [2190, 1010],
    ]) {
      tc.save();
      tc.translate(x, y);
      tc.rotate(0.3);
      tc.fillStyle = "#464d37";
      tc.fillRect(-25, -10, 50, 23);
      tc.fillStyle = "#77755a";
      tc.fillRect(-23, -14, 43, 20);
      tc.fillStyle = "#393f30";
      tc.fillRect(-12, -11, 5, 8);
      tc.fillRect(9, -11, 5, 8);
      tc.restore();
    }
  }
  makeTerrain();
  function resize() {
    const rect = canvas.getBoundingClientRect(),
      dpr = Math.min(devicePixelRatio || 1, 2);
    viewW = rect.width;
    viewH = rect.height;
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    constrainCamera();
  }
  function constrainCamera() {
    camera.x = clamp(camera.x, 0, Math.max(0, WIDTH - viewW / camera.zoom));
    camera.y = clamp(camera.y, 0, Math.max(0, HEIGHT - viewH / camera.zoom));
  }
  function home() {
    const hq = game.owned("hq")[0] || { x: 350, y: 1100 };
    camera.x = hq.x + 130 - viewW / camera.zoom / 2;
    camera.y = hq.y - 80 - viewH / camera.zoom / 2;
    constrainCamera();
  }
  function world(p) {
    return { x: camera.x + p.x / camera.zoom, y: camera.y + p.y / camera.zoom };
  }
  function local(event) {
    const b = canvas.getBoundingClientRect();
    return { x: event.clientX - b.left, y: event.clientY - b.top };
  }
  function zoom(factor, anchor = { x: viewW / 2, y: viewH / 2 }) {
    const before = world(anchor);
    camera.zoom = clamp(camera.zoom * factor, 0.52, 1.6);
    camera.x = before.x - anchor.x / camera.zoom;
    camera.y = before.y - anchor.y / camera.zoom;
    constrainCamera();
  }
  function toast(text) {
    $("toast").textContent = text;
    $("toast").classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("visible"), 3200);
  }
  function beep(kind = "order") {
    if (!soundOn) return;
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const o = audioCtx.createOscillator(),
        g = audioCtx.createGain(),
        t = audioCtx.currentTime;
      o.type = "triangle";
      o.frequency.setValueAtTime(
        kind === "warning" ? 190 : kind === "build" ? 600 : 410,
        t,
      );
      o.frequency.exponentialRampToValueAtTime(
        kind === "warning" ? 100 : 280,
        t + 0.13,
      );
      g.gain.setValueAtTime(0.045, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start(t);
      o.stop(t + 0.17);
    } catch {
      soundOn = false;
      $("sound").textContent = "音效 不可用";
    }
  }
  function baseSlab(e, w, h) {
    ctx.fillStyle = "#20271b70";
    ctx.fillRect(-w / 2 + 8, -h / 2 + 12, w, h);
    ctx.fillStyle = "#717967";
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = "#3e4938";
    ctx.lineWidth = 2;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = "#a0a48c66";
    ctx.lineWidth = 1;
    for (let x = -w / 2; x < w / 2; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, -h / 2);
      ctx.lineTo(x, h / 2);
      ctx.stroke();
    }
    for (let y = -h / 2; y < h / 2; y += 24) {
      ctx.beginPath();
      ctx.moveTo(-w / 2, y);
      ctx.lineTo(w / 2, y);
      ctx.stroke();
    }
  }
  function roof(x, y, w, h, color, light) {
    ctx.fillStyle = "#283226";
    ctx.fillRect(x + 5, y + 8, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = light;
    ctx.fillRect(x, y, w, 4);
    ctx.fillRect(x, y, 3, h);
    ctx.strokeStyle = "#273d32";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }
  function drawBuilding(e, ghost = false) {
    const d = TYPES[e.type],
      t = teamColors[e.team],
      w = d.w * TILE - 8,
      h = d.h * TILE - 8;
    ctx.save();
    ctx.translate(e.x, e.y);
    baseSlab(e, w, h);
    if (e.type === "hq") {
      roof(-53, -41, 106, 78, t.base, t.light);
      roof(-30, -55, 60, 45, "#939a7f", "#bbc1a1");
      ctx.fillStyle = t.dark;
      ctx.fillRect(-20, -39, 40, 20);
      ctx.fillStyle = t.stripe;
      ctx.fillRect(-15, -36, 11, 13);
      ctx.fillRect(3, -36, 11, 13);
      ctx.fillStyle = "#333f31";
      ctx.fillRect(-17, 21, 34, 28);
      ctx.fillStyle = t.stripe;
      ctx.fillRect(-49, 3, 7, 26);
      ctx.fillRect(42, 3, 7, 26);
      line(ctx, -39, -29, -39, -75, "#d0d3ad", 2);
      circle(ctx, -39, -76, 3, "#df7354");
      line(ctx, 37, -30, 37, -62, "#333f2c", 3);
      ctx.save();
      ctx.translate(37, -64);
      ctx.rotate(-0.5 + Math.sin(game.time * 0.7) * 0.12);
      ctx.fillStyle = "#bbc3a3";
      ctx.beginPath();
      ctx.ellipse(0, 0, 19, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      line(ctx, 0, 0, 0, -10, "#dde2bd", 2);
      ctx.restore();
      ctx.fillStyle = "#d9dfb5";
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.fillText("HQ", 0, 11);
    } else if (e.type === "power") {
      roof(-34, -28, 68, 55, t.base, t.light);
      for (const x of [-17, 17]) {
        ctx.fillStyle = "#39473a";
        ctx.fillRect(x - 12, -34, 24, 38);
        ctx.fillStyle = "#b1b396";
        ctx.fillRect(x - 12, -41, 24, 22);
        circle(ctx, x, -40, 12, "#acb298", "#394638");
        circle(ctx, x, -40, 7, "#3b493b");
        circle(ctx, x, -40, 4, "#7e8b6a");
      }
      ctx.fillStyle = t.stripe;
      ctx.fillRect(-22, 10, 44, 5);
      ctx.fillStyle = "#d6d28e";
      ctx.font = "bold 23px monospace";
      ctx.textAlign = "center";
      ctx.fillText("ϟ", 0, 33);
      if (!ghost)
        for (let i = 0; i < 3; i++) {
          const phase = (game.time * 0.5 + i / 3) % 1;
          circle(
            ctx,
            -17 + phase * 8,
            -53 - phase * 27,
            4 + phase * 7,
            `rgba(197,205,174,${(1 - phase) * 0.15})`,
          );
        }
    } else if (e.type === "refinery") {
      roof(-55, -23, 65, 53, t.base, t.light);
      for (const x of [26, 49]) {
        ctx.fillStyle = "#777e69";
        ctx.fillRect(x - 10, -21, 20, 43);
        circle(ctx, x, -20, 11, "#afb093", "#444d3b");
        circle(ctx, x, 21, 11, "#727d61", "#444d3b");
        line(ctx, x - 8, -15, x - 8, 20, "#b6b598", 2);
      }
      ctx.fillStyle = "#333d2d";
      ctx.fillRect(-46, 12, 51, 18);
      for (let x = -43; x < 3; x += 10)
        line(ctx, x, 14, x + 7, 28, "#c0ab67", 3);
      ctx.fillStyle = t.dark;
      ctx.fillRect(-41, -11, 35, 18);
      ctx.fillStyle = t.stripe;
      ctx.fillRect(-36, -7, 25, 4);
      line(ctx, -21, -26, -21, -49, "#b3b69a", 4);
      line(ctx, -21, -49, 18, -49, "#b3b69a", 4);
      line(ctx, 18, -49, 18, -25, "#b3b69a", 3);
    } else if (e.type === "barracks") {
      roof(-34, -31, 68, 61, t.base, t.light);
      polygon(
        ctx,
        [
          [-37, -16],
          [0, -42],
          [37, -16],
          [0, -7],
        ],
        t.light,
        t.dark,
      );
      ctx.fillStyle = t.dark;
      ctx.fillRect(-10, 7, 20, 26);
      ctx.fillStyle = "#d7d3a3";
      ctx.fillRect(-29, -3, 11, 9);
      ctx.fillRect(18, -3, 11, 9);
      line(ctx, 32, 24, 32, -55, "#c3c9a3", 2);
      polygon(
        ctx,
        [
          [32, -55],
          [52, -49],
          [32, -40],
        ],
        t.stripe,
      );
      ctx.fillStyle = t.light;
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      ctx.fillText("INF", 0, -14);
    } else if (e.type === "factory") {
      roof(-55, -49, 110, 89, t.base, t.light);
      roof(-46, -49, 92, 37, "#8a9379", "#b0b598");
      for (let x = -36; x < 40; x += 18) {
        ctx.fillStyle = "#3c4b3d";
        ctx.fillRect(x, -42, 10, 20);
        ctx.fillStyle = "#b6bca0";
        ctx.fillRect(x, -42, 10, 3);
      }
      ctx.fillStyle = "#26352c";
      ctx.fillRect(-37, 0, 74, 48);
      ctx.fillStyle = "#496253";
      ctx.fillRect(-32, 2, 64, 28);
      for (let y = 6; y < 29; y += 6) line(ctx, -31, y, 31, y, "#738875", 2);
      ctx.fillStyle = "#b9ac68";
      ctx.fillRect(-47, 0, 7, 43);
      ctx.fillRect(40, 0, 7, 43);
      for (let y = 0; y < 43; y += 12) {
        ctx.fillStyle = "#37452f";
        ctx.fillRect(-47, y, 7, 5);
        ctx.fillRect(40, y, 7, 5);
      }
      ctx.fillStyle = t.stripe;
      ctx.fillRect(-57, -22, 5, 20);
      ctx.fillRect(52, -22, 5, 20);
    } else if (e.type === "turret") {
      circle(ctx, 0, 0, 16, "#394d3d", "#b1b99c");
      ctx.save();
      ctx.rotate(e.turretAngle);
      roof(-12, -12, 24, 24, t.base, t.light);
      ctx.fillStyle = "#303f33";
      ctx.fillRect(7, -4, 30, 8);
      ctx.fillStyle = "#a5b293";
      ctx.fillRect(12, -3, 24, 3);
      ctx.restore();
    }
    if (e.hp < d.hp * 0.4 && !ghost) {
      const drift = (game.time * 0.65) % 1;
      circle(
        ctx,
        14 + drift * 15,
        -25 - drift * 40,
        7 + drift * 10,
        `rgba(26,30,23,${0.45 - drift * 0.35})`,
      );
    }
    ctx.restore();
  }
  function drawInfantry(e) {
    const t = teamColors[e.team],
      rocket = e.type === "rocket";
    const stride = e.path.length ? Math.sin(e.traveled * 0.24) * 3 : 0;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.fillStyle = "#17261c77";
    ctx.beginPath();
    ctx.ellipse(3, 7, 10, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(e.turretAngle);
    line(ctx, -5, -4, -10 - stride, -5, "#293e30", 4);
    line(ctx, -5, 4, -10 + stride, 5, "#293e30", 4);
    ctx.fillStyle = t.base;
    ctx.fillRect(-7, -6, 12, 12);
    ctx.fillStyle = t.stripe;
    ctx.fillRect(-5, -6, 7, 3);
    circle(ctx, 2, 0, 5, t.light, t.dark);
    circle(ctx, 3, -1, 3, t.base);
    line(
      ctx,
      4,
      4,
      rocket ? 18 : 15,
      4,
      rocket ? "#b3ab76" : "#233b30",
      rocket ? 5 : 3,
    );
    if (rocket) {
      ctx.fillStyle = "#dcd3a1";
      ctx.fillRect(15, 1, 4, 6);
    }
    ctx.restore();
  }
  function drawUnit(e) {
    if (TYPES[e.type].infantry) {
      drawInfantry(e);
      return;
    }
    const t = teamColors[e.team],
      miner = e.type === "harvester",
      scout = e.type === "scout",
      w = miner ? 43 : scout ? 29 : 37,
      h = miner ? 32 : scout ? 21 : 29;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.angle);
    ctx.fillStyle = "#1b261b66";
    ctx.fillRect(-w / 2 + 5, -h / 2 + 6, w, h);
    ctx.fillStyle = "#253329";
    ctx.fillRect(-w / 2 - 2, -h / 2 - 3, w + 4, 9);
    ctx.fillRect(-w / 2 - 2, h / 2 - 6, w + 4, 9);
    for (let x = -w / 2; x < w / 2; x += 7) {
      ctx.fillStyle = "#606a51";
      ctx.fillRect(x, -h / 2 - 1, 3, 5);
      ctx.fillRect(x, h / 2 - 4, 3, 5);
    }
    ctx.fillStyle = t.base;
    ctx.fillRect(-w / 2, -h / 2 + 4, w, h - 8);
    ctx.fillStyle = t.light;
    ctx.fillRect(-w / 2, -h / 2 + 4, w, 3);
    ctx.fillStyle = t.dark;
    ctx.fillRect(-w / 2 + 4, -h / 2 + 9, 7, h - 17);
    ctx.fillStyle = t.stripe;
    ctx.fillRect(w / 2 - 7, -h / 2 + 5, 3, h - 10);
    if (miner) {
      ctx.fillStyle = "#525d43";
      ctx.fillRect(-15, -10, 22, 20);
      ctx.fillStyle = "#c4a65c";
      ctx.fillRect(-13, -8, (18 * e.cargo) / 300, 16);
      ctx.fillStyle = "#bec39b";
      ctx.fillRect(8, -9, 10, 18);
      ctx.fillStyle = "#30473a";
      ctx.fillRect(12, -6, 5, 12);
      ctx.fillStyle = "#4c553b";
      ctx.fillRect(20, -12, 6, 24);
      if (
        e.cargo < 300 &&
        game.ore.some((o) => o.amount > 0 && dist(e, o) < 70) &&
        !e.order
      ) {
        ctx.fillStyle = "#e4c56d";
        ctx.fillRect(25, Math.sin(game.time * 30) * 7, 4, 3);
      }
    }
    ctx.restore();
    if (!miner) {
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.turretAngle);
      ctx.fillStyle = "#334638";
      ctx.fillRect(-8, -8, 20, 18);
      ctx.fillStyle = t.light;
      ctx.fillRect(-8, -8, 17, 3);
      ctx.fillStyle = t.base;
      ctx.fillRect(-8, -5, 17, 11);
      ctx.fillStyle = "#253b30";
      ctx.fillRect(5, -3, scout ? 20 : 29, 6);
      ctx.fillStyle = "#b2b99c";
      ctx.fillRect(9, -3, scout ? 15 : 24, 2);
      circle(ctx, -2, 0, 4, t.dark);
      ctx.restore();
    }
  }
  function drawHealth(e) {
    const d = TYPES[e.type],
      width = d.building ? 64 : 34,
      y = e.y - (d.building ? (d.h * TILE) / 2 + 12 : 30);
    ctx.fillStyle = "#17251dd9";
    ctx.fillRect(e.x - width / 2 - 1, y - 1, width + 2, 5);
    ctx.fillStyle =
      e.hp / d.hp < 0.3 ? "#e77c58" : e.team ? "#d99578" : "#b5d393";
    ctx.fillRect(e.x - width / 2, y, (width * e.hp) / d.hp, 3);
  }
  function drawSelection(e) {
    const d = TYPES[e.type];
    ctx.strokeStyle = "#d4e7a3";
    ctx.lineWidth = 1.5;
    if (d.building) {
      const b = game.bounds(e);
      ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
    } else {
      ctx.beginPath();
      ctx.ellipse(
        e.x,
        e.y + 5,
        d.radius + 9,
        d.radius * 0.7 + 6,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
  }
  function drawOre() {
    for (const o of game.ore) {
      if (o.amount <= 0) continue;
      const count = Math.min(28, Math.ceil(o.amount / 600));
      for (let i = 0; i < count; i++) {
        const a = i * 2.399,
          r = 11 * Math.sqrt(i),
          x = o.x + Math.cos(a) * r,
          y = o.y + Math.sin(a) * r;
        polygon(
          ctx,
          [
            [x, y - 6],
            [x + 7, y - 1],
            [x + 4, y + 6],
            [x - 5, y + 4],
            [x - 6, y],
          ],
          i % 3 === 0 ? "#d9ba68" : "#ab9755",
          "#706c3f",
        );
        line(ctx, x, y - 6, x, y + 2, "#edce85", 1);
      }
      if (game.visible[cell(o.x, o.y)]) {
        ctx.font = "9px monospace";
        ctx.fillStyle = "#ded09a";
        ctx.textAlign = "center";
        ctx.fillText(`矿藏 ${Math.ceil(o.amount / 100) / 10}k`, o.x, o.y + 77);
      }
    }
  }
  function draw() {
    ctx.clearRect(0, 0, viewW, viewH);
    ctx.save();
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
    ctx.drawImage(terrain, 0, 0);
    drawOre();
    for (const e of game.entities
      .filter((e) => game.isVisible(e))
      .sort((a, b) => a.y - b.y)) {
      if (selected.has(e.id)) drawSelection(e);
      TYPES[e.type].building ? drawBuilding(e) : drawUnit(e);
      if (selected.has(e.id) || e.hp < TYPES[e.type].hp) drawHealth(e);
    }
    for (const p of game.projectiles)
      if (game.visible[cell(p.x, p.y)]) circle(ctx, p.x, p.y, 2.5, "#fff0a4");
    for (const f of game.effects)
      if (game.visible[cell(f.x, f.y)]) {
        if (f.type === "income") {
          ctx.fillStyle = `rgba(222,236,163,${Math.min(1, f.life)})`;
          ctx.font = "bold 15px monospace";
          ctx.textAlign = "center";
          ctx.fillText(
            `+$${Math.round(f.amount)}`,
            f.x,
            f.y - 30 - (1.5 - f.life) * 22,
          );
        } else if (f.type === "muzzle") circle(ctx, f.x, f.y, 6, "#ffdf8ecc");
        else {
          const max = f.type === "explosion" ? 0.8 : 0.3,
            progress = 1 - f.life / max;
          circle(
            ctx,
            f.x,
            f.y,
            (f.type === "explosion" ? 43 : 18) * progress + 3,
            `rgba(241,171,76,${(1 - progress) * 0.75})`,
          );
          circle(ctx, f.x - 3, f.y - 3, 10 * (1 - progress), "#fff0b3");
        }
      }
    const startX = Math.max(0, Math.floor(camera.x / TILE)),
      endX = Math.min(COLS, Math.ceil((camera.x + viewW / camera.zoom) / TILE));
    const startY = Math.max(0, Math.floor(camera.y / TILE)),
      endY = Math.min(ROWS, Math.ceil((camera.y + viewH / camera.zoom) / TILE));
    for (let y = startY; y < endY; y++)
      for (let x = startX; x < endX; x++) {
        const i = y * COLS + x;
        if (game.visible[i]) continue;
        ctx.fillStyle = game.explored[i] ? "#10221cc0" : "#14231aef";
        ctx.fillRect(x * TILE, y * TILE, TILE + 0.5, TILE + 0.5);
      }
    if (placing && game.queue.building[0]?.progress >= 1 && pointer.inside) {
      const item = game.queue.building[0],
        p = game.snap(item.type, world(pointer).x, world(pointer).y),
        valid = game.canPlace(item.type, p.x, p.y),
        d = TYPES[item.type];
      for (const e of game.owned().filter((e) => TYPES[e.type].building)) {
        ctx.strokeStyle = "#d4e7a321";
        ctx.lineWidth = 1;
        circle(ctx, e.x, e.y, 340, null, "#d4e7a330");
      }
      ctx.globalAlpha = 0.65;
      drawBuilding(
        { ...p, type: item.type, team: 0, hp: d.hp, turretAngle: 0 },
        true,
      );
      ctx.globalAlpha = 1;
      ctx.fillStyle = valid ? "#b7df852f" : "#e56c5c55";
      ctx.fillRect(
        p.x - (d.w * TILE) / 2,
        p.y - (d.h * TILE) / 2,
        d.w * TILE,
        d.h * TILE,
      );
      ctx.strokeStyle = valid ? "#d1f28b" : "#ff8c79";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        p.x - (d.w * TILE) / 2,
        p.y - (d.h * TILE) / 2,
        d.w * TILE,
        d.h * TILE,
      );
    }
    if (marker) {
      const age = (performance.now() - marker.time) / 1000;
      if (age > 1) marker = null;
      else {
        ctx.globalAlpha = 1 - age;
        ctx.lineWidth = 2;
        circle(
          ctx,
          marker.x,
          marker.y,
          12 + age * 20,
          null,
          marker.attack ? "#eea07a" : "#d7ebb0",
        );
        line(
          ctx,
          marker.x - 5,
          marker.y,
          marker.x + 5,
          marker.y,
          marker.attack ? "#eea07a" : "#d7ebb0",
          1,
        );
        line(ctx, marker.x, marker.y - 5, marker.x, marker.y + 5, "#d7ebb0", 1);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
    if (drag?.kind === "select" && dist(drag.start, drag.current) > 5) {
      ctx.fillStyle = "#d2e5a31a";
      ctx.strokeStyle = "#d6e8a9";
      ctx.lineWidth = 1;
      ctx.fillRect(
        drag.start.x,
        drag.start.y,
        drag.current.x - drag.start.x,
        drag.current.y - drag.start.y,
      );
      ctx.strokeRect(
        drag.start.x,
        drag.start.y,
        drag.current.x - drag.start.x,
        drag.current.y - drag.start.y,
      );
    }
    if (paused && started && $("modal").hidden) {
      ctx.fillStyle = "#0f1c16aa";
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.textAlign = "center";
      ctx.fillStyle = "#dee7c0";
      ctx.font = "24px sans-serif";
      ctx.fillText("战斗已暂停", viewW / 2, viewH / 2);
      ctx.font = "12px sans-serif";
      ctx.fillText("按空格继续", viewW / 2, viewH / 2 + 30);
    }
  }
  function drawRadar() {
    const w = radar.width,
      h = radar.height,
      sx = w / WIDTH,
      sy = h / HEIGHT;
    rctx.fillStyle = "#14201a";
    rctx.fillRect(0, 0, w, h);
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const i = y * COLS + x;
        if (!game.explored[i]) continue;
        rctx.fillStyle = game.terrain[i]
          ? "#72765a"
          : game.visible[i]
            ? "#536246"
            : "#2f3f2d";
        rctx.fillRect(
          x * TILE * sx,
          y * TILE * sy,
          TILE * sx + 0.5,
          TILE * sy + 0.5,
        );
      }
    for (const o of game.ore)
      if (o.amount > 0 && game.explored[cell(o.x, o.y)]) {
        rctx.fillStyle = "#cfb869";
        rctx.fillRect(o.x * sx - 3, o.y * sy - 2, 6, 4);
      }
    for (const e of game.entities)
      if (game.isVisible(e)) {
        const d = TYPES[e.type];
        rctx.fillStyle = e.team ? "#ee9577" : "#c6e4ae";
        const bw = d.building ? d.w * TILE * sx : 3,
          bh = d.building ? d.h * TILE * sy : 3;
        rctx.fillRect(e.x * sx - bw / 2, e.y * sy - bh / 2, bw, bh);
      }
    rctx.strokeStyle = "#e0e8bb";
    rctx.lineWidth = 1;
    rctx.strokeRect(
      camera.x * sx,
      camera.y * sy,
      (viewW / camera.zoom) * sx,
      (viewH / camera.zoom) * sy,
    );
    // Mission intelligence marks the objective even before it is scouted.
    rctx.strokeStyle = "#ce8b6c";
    rctx.setLineDash([2, 2]);
    rctx.strokeRect(1992 * sx - 7, 264 * sy - 7, 14, 14);
    rctx.setLineDash([]);
  }
  function renderCards() {
    const list =
      activeTab === "buildings"
        ? ["power", "barracks", "refinery", "factory", "turret"]
        : ["rifle", "rocket", "tank", "scout", "harvester"];
    $("build-list").innerHTML = list
      .map((type) => {
        const d = TYPES[type];
        return `<button class="build-card" data-type="${type}" title="${d.name}：$${d.cost}，${d.time} 秒"><span class="card-top"><span class="glyph">${d.glyph}</span><span class="cost">$ ${d.cost}</span></span><b>${d.name}</b><small>${d.desc}</small></button>`;
      })
      .join("");
    $("build-list")
      .querySelectorAll("button")
      .forEach((button) =>
        button.addEventListener("click", () => {
          if (!started || paused || game.outcome) return;
          const type = button.dataset.type,
            item = game.queue.building[0];
          if (item?.type === type && item.progress >= 1) {
            placing = true;
            attackMode = false;
            toast("在基地附近选择空地部署；右键取消部署模式");
          } else {
            const error = game.enqueue(type);
            if (error) toast(error);
            else {
              beep("build");
              toast(`${TYPES[type].name}已加入队列`);
            }
          }
          updateUI();
        }),
      );
  }
  function renderQueue() {
    const list = [
      ...game.queue.building.map((q, i) => ({ ...q, i, kind: "building" })),
      ...game.queue.unit.map((q, i) => ({ ...q, i, kind: "unit" })),
      ...game.queue.infantry.map((q, i) => ({ ...q, i, kind: "infantry" })),
    ];
    const signature = list
      .map((q) => `${q.kind}:${q.i}:${q.type}:${q.progress >= 1}`)
      .join("|");
    if (signature !== queueSignature) {
      queueSignature = signature;
      $("queue").innerHTML = list
        .map(
          (q) =>
            `<div class="queue-row"><span>${TYPES[q.type].name}</span><div class="queue-progress"><i></i></div>${q.kind === "building" && q.progress >= 1 ? '<button class="deploy">部署 ↗</button>' : '<span class="progress-label"></span>'}<button data-kind="${q.kind}" data-index="${q.i}" title="取消并全额退款" aria-label="取消${TYPES[q.type].name}并退款">×</button></div>`,
        )
        .join("");
      $("queue")
        .querySelector(".deploy")
        ?.addEventListener("click", () => {
          if (paused) return;
          placing = true;
          attackMode = false;
          updateUI();
        });
      $("queue")
        .querySelectorAll("[data-kind]")
        .forEach((b) =>
          b.addEventListener("click", () => {
            if (paused) return;
            game.cancel(b.dataset.kind, Number(b.dataset.index));
            if (b.dataset.kind === "building") placing = false;
            updateUI();
          }),
        );
    }
    $("queue")
      .querySelectorAll(".queue-row")
      .forEach((row, i) => {
        row.querySelector(".queue-progress i").style.width =
          `${Math.round(list[i].progress * 100)}%`;
        const label = row.querySelector(".progress-label");
        if (label) label.textContent = `${Math.round(list[i].progress * 100)}%`;
        row.title =
          list[i].kind !== "building" &&
          !game.owned(game.producer(list[i].type)).length
            ? `${TYPES[game.producer(list[i].type)].name}已被摧毁，重建后继续生产`
            : "点击 × 取消并全额退款";
      });
  }

  function updateUI() {
    $("match-mode").textContent = `${game.rules.name} · 离线`;
    $("map-seed-label").textContent = `地图种子 #${game.seed}`;
    $("fps").textContent = `${game.rules.name.toUpperCase()} · #${game.seed}`;
    $("credits").textContent = Math.floor(game.money[0]).toLocaleString(
      "en-US",
    );
    const power = game.power();
    $("power").textContent = `${power.output} / ${power.used}`;
    $("power").classList.toggle("warning", power.output < power.used);
    $("power").parentElement.title =
      "供电 / 用电；电力不足时生产减速，炮塔停火";
    $("unit-count").textContent = String(
      game.owned().filter((e) => !TYPES[e.type].building).length,
    ).padStart(2, "0");
    $("clock").textContent =
      `${String(Math.floor(game.time / 60)).padStart(2, "0")}:${String(Math.floor(game.time % 60)).padStart(2, "0")}`;
    $("pause").textContent = paused ? "▶" : "Ⅱ";
    $("pause").setAttribute("aria-label", paused ? "继续战斗" : "暂停战斗");
    $("placement-hint").hidden = !placing;
    canvas.style.cursor =
      placing || attackMode
        ? "crosshair"
        : drag?.kind === "pan"
          ? "grabbing"
          : "default";
    $("battle-status").textContent = placing
      ? "部署建筑"
      : attackMode
        ? "选择攻击推进位置"
        : paused
          ? "战斗已暂停"
          : "指挥链路正常";
    $("objective-detail").textContent =
      game.wave === 0
        ? `首波敌军预计 ${Math.ceil(game.nextWave - game.time)} 秒后出动`
        : `敌军已发动 ${game.wave} 波进攻 · 击毁 ${game.kills} 个目标`;
    for (const b of $("build-list").querySelectorAll("button")) {
      const d = TYPES[b.dataset.type],
        ready =
          game.queue.building[0]?.type === b.dataset.type &&
          game.queue.building[0].progress >= 1;
      const locked =
        !started ||
        paused ||
        (game.money[0] < d.cost && !ready) ||
        (!d.building && !game.owned(game.producer(b.dataset.type)).length);
      b.classList.toggle("locked", locked);
      b.classList.toggle("ready", ready);
      b.querySelector(".cost").textContent = ready ? "就绪 ↗" : `$ ${d.cost}`;
      b.setAttribute("aria-disabled", String(locked));
    }
    selected = new Set([...selected].filter((id) => game.get(id)));
    const units = [...selected].map((id) => game.get(id));
    $("selection-count").textContent = units.length
      ? `${units.length} 个已选择`
      : "未选择";
    if (units.length) {
      const e = units[0],
        d = TYPES[e.type],
        hp = units.reduce((s, u) => s + u.hp, 0),
        maxHP = units.reduce((s, u) => s + TYPES[u.type].hp, 0);
      $("selection-info").innerHTML =
        `<div class="selected-card"><span class="glyph">${d.glyph}</span><div><b>${units.length === 1 ? d.name : `${units.length} 支作战单位`}</b><p>${units.length === 1 && e.type === "harvester" ? `矿石 ${Math.floor(e.cargo)} / 300 · 右键矿区采集` : `${Math.ceil(hp)} / ${maxHP} 装甲`}</p><div class="hp-track"><i style="width:${Math.max(0, (hp / maxHP) * 100)}%"></i></div></div></div>`;
    } else
      $("selection-info").innerHTML =
        '<div class="empty-selection">⌖<p>选择单位以查看状态</p><small>拖动鼠标可框选多支部队</small></div>';
    $("stop").disabled = !units.some((e) => !TYPES[e.type].building) || paused;
    $("select-army").disabled = !started || paused;
    renderQueue();
    drawRadar();
  }
  function hitTest(p, team) {
    return [...game.entities].reverse().find(
      (e) =>
        (team === undefined || e.team === team) &&
        game.isVisible(e) &&
        (TYPES[e.type].building
          ? (() => {
              const b = game.bounds(e);
              return (
                p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h
              );
            })()
          : dist(p, e) < TYPES[e.type].radius + 9),
    );
  }
  function issue(p, forceAttack = false) {
    const enemy = hitTest(p, 1),
      ore = game.ore.find((o) => o.amount > 0 && dist(p, o) < 80);
    let n = 0;
    const combat = [...selected].filter(
        (id) => game.get(id)?.type !== "harvester",
      ),
      miners = [...selected].filter((id) => game.get(id)?.type === "harvester");
    if (miners.length) n += game.command(miners, ore ? "harvest" : "move", p);
    n += game.command(
      combat,
      enemy ? "attack" : forceAttack ? "attackmove" : "move",
      p,
      enemy?.id,
    );
    if (n) {
      marker = {
        ...p,
        time: performance.now(),
        attack: !!enemy || forceAttack,
      };
      beep();
      toast(
        enemy
          ? `攻击${TYPES[enemy.type].name}`
          : forceAttack
            ? "向目标推进，自由攻击沿途敌人"
            : ore && miners.length
              ? "采矿车开始自动采集"
              : `${n} 支部队前往目标位置`,
      );
    } else toast("请先选择我方部队");
    attackMode = false;
    updateUI();
  }
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (event) => {
    if (!started || paused || game.outcome) return;
    event.preventDefault();
    canvas.focus();
    const p = local(event);
    pointer = { ...p, inside: true };
    canvas.setPointerCapture(event.pointerId);
    if (event.button === 2) {
      if (placing || attackMode) {
        placing = attackMode = false;
        updateUI();
      } else issue(world(p));
      return;
    }
    if (event.button === 1) {
      drag = { kind: "pan", start: p, current: p, camera: { ...camera } };
      return;
    }
    if (event.button !== 0) return;
    if (placing) {
      const pos = world(p);
      if (game.place(pos.x, pos.y)) {
        placing = false;
        beep("build");
      } else toast("无法部署：请避开建筑、矿区和部队，并靠近己方基地");
      updateUI();
      return;
    }
    if (attackMode) {
      issue(world(p), true);
      return;
    }
    drag = { kind: "select", start: p, current: p, shift: event.shiftKey };
  });
  canvas.addEventListener("pointermove", (event) => {
    pointer = { ...local(event), inside: true };
    if (drag) {
      drag.current = pointer;
      if (drag.kind === "pan") {
        camera.x = drag.camera.x - (pointer.x - drag.start.x) / camera.zoom;
        camera.y = drag.camera.y - (pointer.y - drag.start.y) / camera.zoom;
        constrainCamera();
      }
    }
  });
  canvas.addEventListener("pointerleave", () => {
    pointer.inside = false;
  });
  canvas.addEventListener("pointerup", (event) => {
    if (canvas.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId);
    if (!drag) return;
    if (drag.kind === "select") {
      if (!drag.shift) selected.clear();
      if (dist(drag.start, drag.current) > 6) {
        const a = world(drag.start),
          b = world(drag.current);
        game
          .owned()
          .filter(
            (e) =>
              !TYPES[e.type].building &&
              e.x >= Math.min(a.x, b.x) &&
              e.x <= Math.max(a.x, b.x) &&
              e.y >= Math.min(a.y, b.y) &&
              e.y <= Math.max(a.y, b.y),
          )
          .forEach((e) => selected.add(e.id));
      } else {
        const e = hitTest(world(drag.current), 0);
        if (e) {
          if (drag.shift && selected.has(e.id)) selected.delete(e.id);
          else selected.add(e.id);
        }
      }
      if (selected.size) beep();
    }
    drag = null;
    updateUI();
  });
  canvas.addEventListener("pointercancel", () => {
    drag = null;
  });
  canvas.addEventListener("dblclick", (event) => {
    if (paused) return;
    const unit = hitTest(world(local(event)), 0);
    if (!unit || TYPES[unit.type].building) return;
    selected = new Set(
      game
        .owned(unit.type)
        .filter(
          (e) =>
            e.x >= camera.x &&
            e.x < camera.x + viewW / camera.zoom &&
            e.y >= camera.y &&
            e.y < camera.y + viewH / camera.zoom,
        )
        .map((e) => e.id),
    );
    updateUI();
  });
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1, local(event));
    },
    { passive: false },
  );
  radar.addEventListener("pointerdown", (event) => {
    if (!started) return;
    const b = radar.getBoundingClientRect();
    camera.x =
      ((event.clientX - b.left) / b.width) * WIDTH - viewW / camera.zoom / 2;
    camera.y =
      ((event.clientY - b.top) / b.height) * HEIGHT - viewH / camera.zoom / 2;
    constrainCamera();
    drawRadar();
  });
  function selectArmy() {
    if (paused) return;
    selected = new Set(
      game
        .owned()
        .filter((e) => !TYPES[e.type].building && e.type !== "harvester")
        .map((e) => e.id),
    );
    toast(`已选择 ${selected.size} 支战斗部队`);
    updateUI();
  }
  function togglePause() {
    if (!started || game.outcome || !$("modal").hidden) return;
    paused = !paused;
    keys.clear();
    drag = null;
    accumulator = 0;
    updateUI();
  }
  document.addEventListener("keydown", (event) => {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)
    )
      return;
    const key = event.key.toLowerCase();
    if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key))
      event.preventDefault();
    if (key === "escape") {
      placing = attackMode = false;
      drag = null;
      if (["help", "restart"].includes(modalMode) && !$("modal").hidden)
        resume();
      updateUI();
      return;
    }
    if (!$("modal").hidden) return;
    if (key === " " && !event.repeat) {
      togglePause();
      return;
    }
    if (!started || paused || game.outcome) return;
    keys.add(key);
    if (event.repeat) return;
    if (key === "a") {
      attackMode = true;
      placing = false;
      toast("左键点击目标位置，部队将攻击沿途敌人");
    }
    if (key === "s") {
      game.stop([...selected]);
      toast("所选部队停止行动");
    }
    if (key === "q") selectArmy();
    if (key === "h") home();
    updateUI();
  });
  document.addEventListener("keyup", (event) =>
    keys.delete(event.key.toLowerCase()),
  );
  window.addEventListener("blur", () => {
    keys.clear();
    drag = null;
    if (started && !paused && !game.outcome) {
      paused = true;
      updateUI();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && started && !paused) {
      paused = true;
      keys.clear();
      updateUI();
    }
  });
  $("pause").addEventListener("click", togglePause);
  $("home").addEventListener("click", home);
  $("zoom-in").addEventListener("click", () => zoom(1.15));
  $("zoom-out").addEventListener("click", () => zoom(1 / 1.15));
  $("select-army").addEventListener("click", selectArmy);
  $("stop").addEventListener("click", () => {
    game.stop([...selected]);
    toast("所选部队停止行动");
  });
  $("sound").addEventListener("click", () => {
    soundOn = !soundOn;
    $("sound").textContent = `音效 ${soundOn ? "开" : "关"}`;
    if (soundOn) beep();
  });
  document.querySelectorAll("[data-tab]").forEach((button) =>
    button.addEventListener("click", () => {
      activeTab = button.dataset.tab;
      document
        .querySelectorAll("[data-tab]")
        .forEach((b) => b.classList.toggle("active", b === button));
      renderCards();
      updateUI();
    }),
  );
  function showModal(mode, title, description, button) {
    modalMode = mode;
    paused = true;
    keys.clear();
    drag = null;
    $("modal-title").textContent = title;
    $("modal-description").innerHTML = description;
    $("start").innerHTML = `${button} <span>→</span>`;
    $("briefing").hidden = mode !== "intro";
    $("match-setup").hidden = !["intro", "restart", "end"].includes(mode);
    $("setup-error").hidden = true;
    $("modal").hidden = false;
    $("modal").querySelector(".secondary")?.remove();
    if (mode === "restart") {
      const b = document.createElement("button");
      b.className = "secondary";
      b.textContent = "返回战斗";
      b.addEventListener("click", resume);
      $("start").after(b);
    }
    $("start").focus();
    updateUI();
  }
  function resume() {
    $("modal").hidden = true;
    modalMode = null;
    paused = false;
    accumulator = 0;
    canvas.focus();
    updateUI();
  }
  function newGame() {
    const value = $("seed-input").value.trim();
    if (value && (!/^\d+$/.test(value) || Number(value) > 4294967295)) {
      $("setup-error").textContent =
        "请输入 0 到 4294967295 之间的整数，或留空随机。";
      $("setup-error").hidden = false;
      $("seed-input").focus();
      return;
    }
    game = new Game({
      seed: value ? Number(value) : undefined,
      difficulty: $("difficulty").value,
    });
    makeTerrain();
    activeTab = "buildings";
    document
      .querySelectorAll("[data-tab]")
      .forEach((b) =>
        b.classList.toggle("active", b.dataset.tab === activeTab),
      );
    renderCards();
    selected.clear();
    placing = attackMode = false;
    endShown = false;
    marker = null;
    started = true;
    camera.zoom = 0.9;
    home();
    resume();
    toast("基地已就绪：建兵营训练步兵，或建战车工厂。");
  }
  $("start").addEventListener("click", () => {
    if (modalMode === "help") {
      if (started) resume();
      else showIntro();
    } else newGame();
  });
  function showIntro() {
    showModal(
      "intro",
      "荒原行动",
      "建立你的基地，集结钢铁洪流。<br>穿越灰岩盆地，摧毁东北方的敌军指挥部。",
      "开始行动",
    );
  }
  $("help").addEventListener("click", () =>
    showModal(
      "help",
      "指挥手册",
      "<b>选择</b>：左键单选 / 拖动框选 / Shift 增选。<br><b>指挥</b>：右键移动、攻击敌人或让矿车采矿。<br><b>攻击推进</b>：按 A，再左键点击目标位置。<br><b>快捷键</b>：Q 全选战斗部队 · S 停止 · H 回基地。<br><b>视角</b>：方向键 / 中键拖动 / 小地图定位，滚轮缩放。<br><b>建设</b>：点击建筑，完成后点击「部署」，再选择空地。<br><b>电力</b>：供电低于用电时，生产减速、炮塔停火。<br><b>步兵</b>：兵营训练步枪兵和反坦克兵，与战车独立排队。<br><b>新一局</b>：可选难度，种子留空随机；没有存档。",
      started ? "返回战斗" : "返回任务介绍",
    ),
  );
  $("restart").addEventListener("click", () =>
    showModal(
      "restart",
      "重新部署？",
      "当前战局将被重置。<br>选择难度；种子留空生成新地图，填写本局种子可重玩。",
      "开始新一局",
    ),
  );
  function frame(now) {
    const dt = Math.min((now - (lastTime || now)) / 1000, 0.1);
    lastTime = now;
    if (!paused && started) {
      const speed = (620 * dt) / camera.zoom;
      if (keys.has("arrowleft")) camera.x -= speed;
      if (keys.has("arrowright")) camera.x += speed;
      if (keys.has("arrowup")) camera.y -= speed;
      if (keys.has("arrowdown")) camera.y += speed;
      constrainCamera();
      accumulator += dt;
      while (accumulator >= 1 / 30) {
        game.tick(1 / 30);
        accumulator -= 1 / 30;
      }
      while (game.events.length) {
        const event = game.events.shift();
        toast(event.text);
        beep(event.kind);
      }
      if (game.outcome && !endShown) {
        endShown = true;
        const won = game.outcome === "victory";
        showModal(
          "end",
          won ? "任务完成" : "基地失守",
          `${won ? "敌方指挥部已摧毁，灰岩盆地由你掌控。" : "我方指挥部已被摧毁，调整策略再战一次。"}<br>作战时间 ${Math.floor(game.time / 60)} 分 ${Math.floor(game.time % 60)} 秒 · 击毁 ${game.kills} 个目标`,
          "再来一局",
        );
      }
    }
    uiTimer += dt;
    if (uiTimer > 0.15) {
      updateUI();
      uiTimer = 0;
    }
    draw();
    requestAnimationFrame(frame);
  }
  $("difficulty").addEventListener("change", () => {
    $("difficulty-note").textContent =
      DIFFICULTIES[$("difficulty").value].description;
  });
  new ResizeObserver(resize).observe(canvas);
  window.addEventListener("resize", resize);
  renderCards();
  resize();
  home();
  updateUI();
  requestAnimationFrame(frame);
})();
