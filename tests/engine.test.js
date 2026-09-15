const test = require("node:test");
const assert = require("node:assert/strict");
const { Game, TYPES, TILE, COLS, ROWS, cell } = require("../engine");
const advance = (game, seconds) => {
  for (let i = 0; i < Math.ceil(seconds * 30); i++) game.tick(1 / 30);
};
const quiet = (game) => {
  game.enemyProduction = 1e9;
  game.nextWave = 1e9;
  return game;
};
function placeReady(game, type) {
  for (let y = TILE; y < ROWS * TILE; y += TILE)
    for (let x = TILE; x < COLS * TILE; x += TILE) {
      const p = game.snap(type, x, y);
      if (game.canPlace(type, p.x, p.y)) return game.place(p.x, p.y);
    }
  assert.fail("No valid placement found");
}

test("new matches start with fresh resources and independent state", () => {
  const a = new Game();
  a.money[0] = 0;
  a.owned("hq")[0].hp = 1;
  a.ore[0].amount = 0;
  const b = new Game();
  assert.equal(b.money[0], 2400);
  assert.equal(b.owned("hq")[0].hp, TYPES.hq.hp);
  assert.equal(b.ore[0].amount, 18000);
  assert.equal(b.time, 0);
});
test("harvesters deliver finite ore and mining stops without a refinery", () => {
  const g = quiet(new Game()),
    amount = g.ore.reduce((s, o) => s + o.amount, 0);
  advance(g, 40);
  assert.ok(g.money[0] > 2400);
  assert.ok(g.ore.reduce((s, o) => s + o.amount, 0) < amount);
  g.entities = g.entities.filter((e) => e.team !== 0 || e.type !== "refinery");
  g.invalidateNav();
  const money = g.money[0];
  advance(g, 20);
  assert.equal(g.money[0], money);
});
test("construction spends once, blocks overlaps, completes and deploys", () => {
  const g = quiet(new Game());
  assert.equal(g.enqueue("factory"), null);
  assert.equal(g.money[0], 1500);
  assert.ok(g.enqueue("power"));
  assert.equal(g.money[0], 1500);
  assert.equal(g.place(700, 1100), false);
  assert.equal(
    g.canPlace("factory", g.owned("hq")[0].x, g.owned("hq")[0].y),
    false,
  );
  advance(g, 12.1);
  const e = placeReady(g, "factory");
  assert.equal(e.type, "factory");
  assert.equal(g.queue.building.length, 0);
  assert.equal(g.canPlace("factory", e.x, e.y), false);
  assert.equal(g.canPlace("factory", 2100, 1300), false);
});
test("production requires a factory, supports queuing and refunds cancellations", () => {
  const g = quiet(new Game());
  assert.ok(g.enqueue("tank"));
  assert.equal(g.money[0], 2400);
  g.add("factory", 0, 792, 1176);
  assert.equal(g.enqueue("tank"), null);
  assert.equal(g.enqueue("scout"), null);
  g.cancel("unit", 1);
  assert.equal(g.money[0], 1950);
  advance(g, 8.1);
  assert.equal(g.owned("tank").length, 3);
  assert.equal(g.queue.unit.length, 0);
  const spawned = g.owned("tank").at(-1);
  assert.equal(g.blocked()[cell(spawned.x, spawned.y)], 0);
});
test("losing the factory pauses the unit queue until a replacement exists", () => {
  const g = quiet(new Game());
  const factory = g.add("factory", 0, 792, 1176);
  g.enqueue("tank");
  advance(g, 2);
  g.entities = g.entities.filter((e) => e.id !== factory.id);
  g.invalidateNav();
  const progress = g.queue.unit[0].progress;
  advance(g, 20);
  assert.equal(g.queue.unit[0].progress, progress);
  g.add("factory", 0, 792, 1176);
  advance(g, 6.1);
  assert.equal(g.queue.unit.length, 0);
});
test("power shortages slow production and disable defensive turrets", () => {
  const g = quiet(new Game());
  g.entities = g.entities.filter((e) => e.type !== "power");
  g.invalidateNav();
  g.add("factory", 0, 792, 1176);
  assert.equal(g.powered(), false);
  g.enqueue("tank");
  advance(g, 8);
  assert.ok(Math.abs(g.queue.unit[0].progress - 0.35) < 0.01);
  const turret = g.add("turret", 0, 1300, 1300),
    target = g.add("tank", 1, 1400, 1300);
  target.order = { kind: "hold" };
  target.cooldown = 999;
  advance(g, 2);
  assert.equal(target.hp, TYPES.tank.hp);
  g.add("power", 0, 1000, 1300);
  advance(g, 2);
  assert.ok(target.hp < TYPES.tank.hp);
  assert.ok(turret.hp > 0);
});
test("pathfinding routes around mountains and buildings without corner cutting", () => {
  const g = quiet(new Game()),
    from = { x: 600, y: 648 },
    to = { x: 1200, y: 648 },
    path = g.pathfind(from, to);
  assert.ok(path.length > 0);
  const grid = g.blocked();
  let previous = cell(from.x, from.y);
  for (const p of path) {
    const next = cell(p.x, p.y);
    assert.equal(grid[next], 0);
    const px = previous % COLS,
      py = Math.floor(previous / COLS),
      nx = next % COLS,
      ny = Math.floor(next / COLS);
    if (px !== nx && py !== ny) {
      assert.equal(grid[py * COLS + nx], 0);
      assert.equal(grid[ny * COLS + px], 0);
    }
    previous = next;
  }
  const tank = g.owned("tank")[0];
  tank.x = from.x;
  tank.y = from.y;
  g.command([tank.id], "move", to);
  advance(g, 30);
  assert.ok(Math.hypot(tank.x - to.x, tank.y - to.y) < 50);
});
test("formation movement reaches the destination and stop cancels movement", () => {
  const g = quiet(new Game()),
    units = g.owned("tank"),
    ids = units.map((e) => e.id);
  g.command(ids, "move", { x: 800, y: 1050 });
  advance(g, 14);
  assert.ok(units.every((e) => Math.hypot(e.x - 800, e.y - 1050) < 90));
  g.command(ids, "move", { x: 1200, y: 1050 });
  advance(g, 1);
  g.stop(ids);
  const positions = units.map((e) => ({ x: e.x, y: e.y }));
  advance(g, 3);
  assert.ok(
    units.every(
      (e, i) => Math.hypot(e.x - positions[i].x, e.y - positions[i].y) < 2,
    ),
  );
});
test("projectiles deal damage and headquarters destruction ends the match", () => {
  const g = quiet(new Game()),
    hq = g.owned("hq", 1)[0];
  hq.hp = 25;
  const tank = g.add("tank", 0, hq.x - 240, hq.y);
  g.updateVision();
  g.command([tank.id], "attack", hq, hq.id);
  advance(g, 3);
  assert.equal(g.outcome, "victory");
  const time = g.time;
  advance(g, 10);
  assert.equal(g.time, time);
  const defeat = quiet(new Game());
  defeat.owned("hq")[0].hp = 0;
  advance(defeat, 0.1);
  assert.equal(defeat.outcome, "defeat");
});
test("attack move engages enemies and ordinary movement can retreat", () => {
  const g = quiet(new Game()),
    unit = g.owned("tank")[0];
  const enemy = g.add("tank", 1, unit.x + 200, unit.y);
  enemy.order = { kind: "hold" };
  enemy.cooldown = 999;
  g.updateVision();
  g.command([unit.id], "attackmove", { x: unit.x + 500, y: unit.y });
  advance(g, 3);
  assert.ok(enemy.hp < TYPES.tank.hp);
  const x = unit.x;
  g.command([unit.id], "move", { x: 150, y: 850 });
  advance(g, 3);
  assert.ok(unit.x < x - 30);
});
test("fog reveals explored terrain but hides enemies outside current sight", () => {
  const g = quiet(new Game()),
    enemy = g.owned("hq", 1)[0];
  assert.equal(g.isVisible(enemy), false);
  const scout = g.add("scout", 0, 1800, 300);
  g.updateVision();
  assert.equal(g.isVisible(enemy), true);
  scout.x = 500;
  scout.y = 1000;
  g.updateVision();
  assert.equal(g.isVisible(enemy), false);
  assert.equal(g.explored[cell(enemy.x, enemy.y)], 1);
});
test("AI has finite funds, produces units, dispatches waves and can win", () => {
  const g = new Game();
  advance(g, 86);
  assert.equal(g.wave, 1);
  assert.ok(g.owned("tank", 1).some((e) => e.order?.kind === "attackmove"));
  assert.ok(g.money[1] >= 0);
  advance(g, 900);
  assert.equal(g.outcome, "defeat");
});

test('a harvester follows a requested deposit and a new refinery includes a miner', () => {
  const g = quiet(new Game());
  const miner = g.owned('harvester')[0];
  const requested = g.ore[3];
  const originalAmount = requested.amount;
  g.command([miner.id], 'harvest', requested);
  advance(g, 30);
  assert.ok(requested.amount < originalAmount);
  assert.equal(g.ore[0].amount, 18000);
  assert.equal(g.enqueue('refinery'), null);
  advance(g, 14.1);
  const count = g.owned('harvester').length;
  assert.equal(placeReady(g, 'refinery').type, 'refinery');
  assert.equal(g.owned('harvester').length, count + 1);
});
