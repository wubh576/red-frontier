const test = require("node:test");
const assert = require("node:assert/strict");
const {
  Game,
  TYPES,
  DIFFICULTIES,
  COLS,
  ROWS,
  TILE,
  cell,
  center,
} = require("../engine");
function advance(game, seconds) {
  for (let i = 0; i < Math.ceil(seconds * 30); i++) game.tick(1 / 30);
}
function quiet(game) {
  game.enemyProduction = game.nextWave = 1e9;
  return game;
}

// BFS over the actual movement grid catches inaccessible mines and spawn cells.
function reachable(game, start) {
  const grid = game.blocked(),
    seen = new Set([start]),
    open = [start];
  for (let i = 0; i < open.length; i++) {
    const x = open[i] % COLS,
      y = Math.floor(open[i] / COLS);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx,
        ny = y + dy,
        n = ny * COLS + nx;
      if (
        nx >= 0 &&
        ny >= 0 &&
        nx < COLS &&
        ny < ROWS &&
        !grid[n] &&
        !seen.has(n)
      ) {
        seen.add(n);
        open.push(n);
      }
    }
  }
  return seen;
}
test("seed reproduces maps and AI decisions, while other seeds change the map", () => {
  const a = new Game({ seed: 71 }),
    b = new Game({ seed: 71 }),
    c = new Game({ seed: 72 });
  assert.deepEqual(a.terrain, b.terrain);
  assert.deepEqual(a.ore, b.ore);
  assert.deepEqual(a.roads, b.roads);
  assert.notDeepEqual(a.terrain, c.terrain);
  assert.notDeepEqual(a.ore, c.ore);
  advance(a, 200);
  advance(b, 200);
  for (const key of ["money", "entities", "ore", "nextWave", "enemyProduction"])
    assert.deepEqual(a[key], b[key]);
});
test("300 seeded maps have reachable mines, base exits, and unblocked initial units", () => {
  for (let seed = 0; seed < 300; seed++) {
    const g = new Game({ seed }),
      miner = g.owned("harvester")[0];
    const seen = reachable(g, cell(miner.x, miner.y));
    for (const ore of g.ore)
      assert.ok(
        seen.has(cell(ore.x, ore.y)),
        `seed ${seed}: ore at ${ore.x},${ore.y}`,
      );
    for (const e of g.entities) {
      if (!TYPES[e.type].building)
        assert.ok(seen.has(cell(e.x, e.y)), `seed ${seed}: ${e.type} spawn`);
      else {
        const b = g.bounds(e);
        for (
          let y = Math.floor(b.y / TILE);
          y < Math.ceil((b.y + b.h) / TILE);
          y++
        )
          for (
            let x = Math.floor(b.x / TILE);
            x < Math.ceil((b.x + b.w) / TILE);
            x++
          )
            assert.equal(
              g.terrain[y * COLS + x],
              0,
              `seed ${seed}: building on rock`,
            );
        assert.ok(
          seen.has(g.nearestFree(e.x, b.y + b.h + TILE)),
          `seed ${seed}: base exit`,
        );
      }
    }
    assert.equal(
      g.ore[0].amount,
      g.ore[1].amount,
      "both bases get equal initial mineral reserves",
    );
  }
});
test("difficulty changes pressure and funds without changing map or unit stats", () => {
  const games = ["easy", "normal", "hard"].map(
    (difficulty) => new Game({ seed: 123, difficulty }),
  );
  assert.deepEqual(games[0].terrain, games[2].terrain);
  assert.deepEqual(games[0].ore, games[2].ore);
  assert.deepEqual(
    games.map((g) => g.money[0]),
    [3200, 2400, 2000],
  );
  assert.deepEqual(
    games.map((g) => g.nextWave),
    [120, 85, 60],
  );
  assert.ok(games[0].owned("tank", 1).every((e) => e.hp === TYPES.tank.hp));
  for (const g of games) advance(g, 61);
  assert.deepEqual(
    games.map((g) => g.wave),
    [0, 0, 1],
  );
  assert.ok(games[2].owned(null, 1).length > games[0].owned(null, 1).length);
});
test("subsequent waves vary within each difficulty interval and production spends money", () => {
  for (const difficulty of Object.keys(DIFFICULTIES)) {
    const g = new Game({ seed: 987, difficulty }),
      rules = g.rules,
      first = g.nextWave;
    advance(g, first + 0.1);
    const interval = g.nextWave - first;
    assert.ok(
      interval >= rules.waveInterval - rules.jitter &&
        interval <= rules.waveInterval + rules.jitter,
    );
    assert.notEqual(interval, rules.waveInterval);
    assert.ok(g.money[1] >= 0);
  }
});
test("barracks unlock infantry, with a queue independent from vehicles", () => {
  const g = quiet(new Game({ seed: 7 }));
  assert.match(g.enqueue("rifle"), /兵营/);
  assert.match(g.enqueue("rocket"), /兵营/);
  g.add("barracks", 0, 192, 1344);
  assert.equal(g.enqueue("rifle"), null);
  assert.equal(g.enqueue("rocket"), null);
  assert.match(g.enqueue("tank"), /战车工厂/);
  g.add("factory", 0, 792, 1176);
  assert.equal(g.enqueue("tank"), null);
  advance(g, 3.1);
  assert.equal(g.owned("rifle").length, 1);
  assert.ok(g.queue.unit[0].progress > 0);
  advance(g, 5.1);
  assert.equal(g.owned("rocket").length, 1);
  assert.equal(g.owned("tank").length, 3);
  assert.equal(g.queue.infantry.length, 0);
  assert.equal(g.queue.unit.length, 0);
  for (const e of [...g.owned("rifle"), ...g.owned("rocket")])
    assert.equal(g.blocked()[cell(e.x, e.y)], 0);
});
test("infantry queue pauses on barracks loss, resumes on rebuild, and refunds correctly", () => {
  const g = quiet(new Game({ seed: 7 })),
    b = g.add("barracks", 0, 192, 1344);
  g.enqueue("rocket");
  advance(g, 1);
  g.entities = g.entities.filter((e) => e.id !== b.id);
  g.invalidateNav();
  const progress = g.queue.infantry[0].progress;
  advance(g, 10);
  assert.equal(g.queue.infantry[0].progress, progress);
  g.add("barracks", 0, 192, 1344);
  advance(g, 4.1);
  assert.equal(g.owned("rocket").length, 1);
  const money = g.money[0];
  g.enqueue("rifle");
  g.cancel("infantry");
  assert.equal(g.money[0], money);
});
test("combined infantry and vehicle queue reservations obey the army limit", () => {
  const g = quiet(new Game({ seed: 7 }));
  g.money[0] = 100000;
  g.add("barracks", 0, 192, 1344);
  g.add("factory", 0, 792, 1176);
  while (g.owned().filter((e) => !TYPES[e.type].building).length < 58)
    g.add("rifle", 0, 100, 1400);
  assert.equal(g.enqueue("rifle"), null);
  assert.equal(g.enqueue("tank"), null);
  assert.match(g.enqueue("rocket"), /上限/);
});
test("rifles counter infantry and rockets counter vehicles through real projectile hits", () => {
  const g = quiet(new Game({ seed: 7 }));
  assert.ok(g.damageFor("rifle", "rifle") > g.damageFor("rifle", "tank"));
  assert.ok(g.damageFor("rocket", "tank") > g.damageFor("rocket", "rifle"));
  const soldier = g.add("rocket", 0, 1200, 1300),
    target = g.add("tank", 1, 1350, 1300);
  target.cooldown = 999;
  target.order = { kind: "hold" };
  g.updateVision();
  g.command([soldier.id], "attack", target, target.id);
  advance(g, 1);
  assert.equal(target.hp, TYPES.tank.hp - 45);
  g.command([soldier.id], "move", { x: 1104, y: 1440 });
  advance(g, 8);
  assert.ok(Math.hypot(soldier.x - 1104, soldier.y - 1440) < 60);
});
test("computer can train infantry after its vehicle factory is lost", () => {
  const g = new Game({ seed: 7 });
  g.nextWave = 1e9;
  g.entities = g.entities.filter((e) => e.team !== 1 || e.type !== "factory");
  g.invalidateNav();
  advance(g, 50);
  assert.ok(g.owned("rifle", 1).length + g.owned("rocket", 1).length > 0);
});
test("invalid match settings fail clearly, including seed zero support", () => {
  assert.equal(new Game({ seed: 0 }).seed, 0);
  assert.throws(() => new Game({ seed: -1 }), /种子/);
  assert.throws(() => new Game({ seed: 1.5 }), /种子/);
  assert.throws(() => new Game({ difficulty: "unknown" }), /难度/);
});
