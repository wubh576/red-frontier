/* Red Frontier simulation. No DOM, dependencies, or network access. */
(function (root) {
  'use strict';
  const TILE = 48, COLS = 48, ROWS = 32, WIDTH = TILE * COLS, HEIGHT = TILE * ROWS;
  const TYPES = {
    hq: { name: '指挥部', building: true, w: 3, h: 3, hp: 2600, sight: 360, output: 60, glyph: '⌂' },
    power: { name: '发电厂', building: true, w: 2, h: 2, hp: 850, cost: 500, time: 9, sight: 240, output: 150, glyph: 'ϟ', desc: '供电 +150 · 9 秒' },
    refinery: { name: '矿石精炼厂', building: true, w: 3, h: 2, hp: 1200, cost: 1000, time: 14, sight: 280, draw: 30, glyph: '▥', desc: '附赠矿车 · 耗电 30' },
    factory: { name: '战车工厂', building: true, w: 3, h: 3, hp: 1600, cost: 900, time: 12, sight: 300, draw: 70, glyph: '⚒', desc: '解锁战车 · 耗电 70' },
    turret: { name: '防御炮塔', building: true, w: 1, h: 1, hp: 700, cost: 450, time: 8, sight: 330, draw: 30, range: 280, damage: 32, reload: 1.1, glyph: '⊕', desc: '守卫基地 · 耗电 30' },
    tank: { name: '主战坦克', hp: 360, cost: 450, time: 8, speed: 73, sight: 330, range: 220, damage: 35, reload: 1.35, radius: 18, glyph: '▰', desc: '装甲主力 · 8 秒' },
    scout: { name: '侦察战车', hp: 160, cost: 250, time: 5, speed: 125, sight: 430, range: 165, damage: 13, reload: .65, radius: 13, glyph: '⌁', desc: '高速侦察 · 5 秒' },
    harvester: { name: '采矿车', hp: 550, cost: 650, time: 10, speed: 66, sight: 270, radius: 21, glyph: '▤', desc: '自动采矿 · 10 秒' }
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const cell = (x, y) => clamp(Math.floor(y / TILE), 0, ROWS - 1) * COLS + clamp(Math.floor(x / TILE), 0, COLS - 1);
  const center = i => ({ x: (i % COLS + .5) * TILE, y: (Math.floor(i / COLS) + .5) * TILE });
  class Game {
    constructor() {
      this.time = 0; this.money = [2400, 2200]; this.entities = []; this.projectiles = []; this.effects = [];
      this.nextId = 1; this.queue = { building: [], unit: [] }; this.events = []; this.outcome = null;
      this.kills = 0; this.enemyProduction = 22; this.nextWave = 85; this.wave = 0;
      this.terrain = new Array(COLS * ROWS).fill(0); this.explored = new Array(COLS * ROWS).fill(0); this.visible = new Array(COLS * ROWS).fill(0);
      this.visionTimer = 0; this.navVersion = 0; this.navCache = null;
      // Low rocky ridges leave several wide routes across the basin.
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
        const ridges = [[17, 12, 3.5, 5], [29, 23, 4, 2.5], [34, 11, 3, 2], [8, 5, 4, 2]];
        if (ridges.some(([cx, cy, rx, ry]) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1)) this.terrain[y * COLS + x] = 1;
      }
      this.ore = [{ x: 600, y: 1248, amount: 18000 }, { x: 1800, y: 480, amount: 18000 }, { x: 1104, y: 864, amount: 24000 }, { x: 336, y: 480, amount: 12000 }];
      this.add('hq', 0, 312, 1176); this.add('power', 0, 192, 1008); this.add('refinery', 0, 504, 1080);
      this.add('harvester', 0, 576, 1176); this.add('tank', 0, 432, 912); this.add('tank', 0, 528, 912);
      this.add('hq', 1, 1992, 264); this.add('power', 1, 2160, 192); this.add('refinery', 1, 1800, 312);
      this.add('factory', 1, 2040, 504); this.add('turret', 1, 1872, 648);
      this.add('harvester', 1, 1752, 432); this.add('tank', 1, 1800, 696); this.add('tank', 1, 2088, 696);
      this.updateVision();
    }
    add(type, team, x, y) {
      const def = TYPES[type];
      const e = { id: this.nextId++, type, team, x, y, hp: def.hp, angle: team ? 2.4 : -.6, turretAngle: team ? 2.4 : -.6,
        order: null, path: [], cooldown: 0, routeTimer: 0, cargo: 0, harvestTimer: 0, traveled: 0 };
      this.entities.push(e); if (def.building) this.invalidateNav(); return e;
    }
    get(id) { return this.entities.find(e => e.id === id && e.hp > 0); }
    owned(type, team = 0) { return this.entities.filter(e => e.team === team && e.hp > 0 && (!type || e.type === type)); }
    invalidateNav() { this.navVersion++; this.navCache = null; }
    power(team = 0) {
      return this.owned(null, team).reduce((p, e) => { p.output += TYPES[e.type].output || 0; p.used += TYPES[e.type].draw || 0; return p; }, { output: 0, used: 0 });
    }
    powered(team = 0) { const p = this.power(team); return p.output >= p.used; }
    event(text, kind = 'info') { this.events.push({ text, kind }); if (this.events.length > 12) this.events.shift(); }
    bounds(e) { const d = TYPES[e.type]; return { x: e.x - d.w * TILE / 2, y: e.y - d.h * TILE / 2, w: d.w * TILE, h: d.h * TILE }; }
    blocked() {
      if (this.navCache) return this.navCache;
      const grid = this.terrain.slice();
      for (const e of this.entities) if (e.hp > 0 && TYPES[e.type].building) {
        const b = this.bounds(e);
        for (let y = Math.floor(b.y / TILE); y < Math.ceil((b.y + b.h) / TILE); y++) for (let x = Math.floor(b.x / TILE); x < Math.ceil((b.x + b.w) / TILE); x++) if (x >= 0 && x < COLS && y >= 0 && y < ROWS) grid[y * COLS + x] = 1;
      }
      return this.navCache = grid;
    }
    snap(type, x, y) {
      const d = TYPES[type]; return { x: (Math.floor(x / TILE - d.w / 2) + d.w / 2) * TILE, y: (Math.floor(y / TILE - d.h / 2) + d.h / 2) * TILE };
    }
    canPlace(type, x, y) {
      const d = TYPES[type]; if (!d || !d.building || type === 'hq') return false;
      const b = { x: x - d.w * TILE / 2, y: y - d.h * TILE / 2, w: d.w * TILE, h: d.h * TILE };
      if (b.x < TILE || b.y < TILE || b.x + b.w > WIDTH - TILE || b.y + b.h > HEIGHT - TILE) return false;
      if (!this.owned().some(e => TYPES[e.type].building && dist(e, { x, y }) < 340)) return false;
      const grid = this.blocked();
      for (let cy = Math.floor(b.y / TILE); cy < Math.ceil((b.y + b.h) / TILE); cy++) for (let cx = Math.floor(b.x / TILE); cx < Math.ceil((b.x + b.w) / TILE); cx++) if (grid[cy * COLS + cx] || !this.visible[cy * COLS + cx]) return false;
      if (this.ore.some(o => o.amount > 0 && o.x > b.x - 50 && o.x < b.x + b.w + 50 && o.y > b.y - 50 && o.y < b.y + b.h + 50)) return false;
      return !this.entities.some(e => !TYPES[e.type].building && e.x > b.x - 24 && e.x < b.x + b.w + 24 && e.y > b.y - 24 && e.y < b.y + b.h + 24);
    }
    enqueue(type) {
      if (this.outcome) return '战斗已结束';
      const d = TYPES[type]; if (!d || !d.cost) return '无法生产';
      const queue = d.building ? this.queue.building : this.queue.unit;
      if (d.building && queue.length) return '已有建筑正在建造或等待部署';
      if (!d.building && !this.owned('factory').length) return '请先建造战车工厂';
      if (!d.building && queue.length >= 8) return '生产队列已满（最多 8 辆）';
      if (!d.building && this.owned().filter(e => !TYPES[e.type].building).length + queue.length >= 60) return '部队已达上限（60 辆）';
      if (this.money[0] < d.cost) return '资金不足，等待矿车运回矿石';
      this.money[0] -= d.cost; queue.push({ type, progress: 0 }); return null;
    }
    cancel(kind, index = 0) {
      const q = this.queue[kind]; if (!q || !q[index]) return;
      this.money[0] += TYPES[q[index].type].cost; q.splice(index, 1);
    }
    place(x, y) {
      const item = this.queue.building[0]; if (!item || item.progress < 1) return false;
      const p = this.snap(item.type, x, y); if (!this.canPlace(item.type, p.x, p.y)) return false;
      const e = this.add(item.type, 0, p.x, p.y); this.queue.building.shift();
      if (e.type === 'refinery') this.spawnAt('harvester', 0, e);
      this.updateVision(); this.event(`${TYPES[e.type].name}已部署`, 'build'); return e;
    }
    nearestFree(x, y) {
      const grid = this.blocked(); const start = cell(x, y); if (!grid[start]) return start;
      const sx = start % COLS, sy = Math.floor(start / COLS);
      for (let r = 1; r < Math.max(COLS, ROWS); r++) {
        let best = -1, score = Infinity;
        for (let cy = Math.max(0, sy - r); cy <= Math.min(ROWS - 1, sy + r); cy++) for (let cx = Math.max(0, sx - r); cx <= Math.min(COLS - 1, sx + r); cx++) {
          if (Math.max(Math.abs(cx - sx), Math.abs(cy - sy)) !== r || grid[cy * COLS + cx]) continue;
          const ds = (cx * TILE + TILE / 2 - x) ** 2 + (cy * TILE + TILE / 2 - y) ** 2;
          if (ds < score) { best = cy * COLS + cx; score = ds; }
        }
        if (best >= 0) return best;
      }
      return start;
    }
    spawnAt(type, team, building) {
      const b = this.bounds(building); const p = center(this.nearestFree(building.x, b.y + b.h + TILE));
      return this.add(type, team, p.x, p.y);
    }
    pathfind(from, to) {
      const grid = this.blocked(), start = cell(from.x, from.y), goal = this.nearestFree(to.x, to.y);
      if (start === goal) return [center(goal)];
      const open = [start], g = new Float64Array(COLS * ROWS).fill(Infinity), f = new Float64Array(COLS * ROWS).fill(Infinity);
      const parent = new Int32Array(COLS * ROWS).fill(-1), closed = new Uint8Array(COLS * ROWS);
      const h = i => Math.hypot(i % COLS - goal % COLS, Math.floor(i / COLS) - Math.floor(goal / COLS));
      g[start] = 0; f[start] = h(start);
      while (open.length) {
        let bi = 0; for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
        const current = open.splice(bi, 1)[0]; if (current === goal) {
          const path = []; let n = goal; while (n !== start) { path.push(center(n)); n = parent[n]; } return path.reverse();
        }
        closed[current] = 1; const x = current % COLS, y = Math.floor(current / COLS);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue; const nx = x + dx, ny = y + dy, n = ny * COLS + nx;
          if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || closed[n] || grid[n]) continue;
          if (dx && dy && (grid[y * COLS + nx] || grid[ny * COLS + x])) continue;
          const cost = g[current] + (dx && dy ? 1.414 : 1);
          if (cost < g[n]) { parent[n] = current; g[n] = cost; f[n] = cost + h(n); if (!open.includes(n)) open.push(n); }
        }
      }
      return [];
    }
    command(ids, kind, point, targetId) {
      const units = ids.map(id => this.get(id)).filter(e => e && e.team === 0 && !TYPES[e.type].building);
      const width = Math.ceil(Math.sqrt(units.length));
      units.forEach((e, i) => {
        const offset = kind === 'move' || kind === 'attackmove';
        e.order = { kind, x: clamp(point.x + (offset ? (i % width - (width - 1) / 2) * 42 : 0), 24, WIDTH - 24),
          y: clamp(point.y + (offset ? (Math.floor(i / width) - (Math.ceil(units.length / width) - 1) / 2) * 42 : 0), 24, HEIGHT - 24), target: targetId || null };
        e.path = []; e.routeTimer = 0;
      }); return units.length;
    }
    stop(ids) { ids.forEach(id => { const e = this.get(id); if (e && e.team === 0) { e.order = { kind: 'hold', x: e.x, y: e.y }; e.path = []; } }); }
    targetDistance(a, b) {
      if (!TYPES[b.type].building) return dist(a, b);
      const box = this.bounds(b); return Math.hypot(a.x - clamp(a.x, box.x, box.x + box.w), a.y - clamp(a.y, box.y, box.y + box.h));
    }
    move(e, goal, dt, stopRange = 5) {
      if (dist(e, goal) < stopRange) { e.path = []; return true; }
      e.routeTimer -= dt;
      if (e.routeTimer <= 0 || e.pathVersion !== this.navVersion) {
        e.path = this.pathfind(e, goal); e.routeTimer = 1.4; e.pathVersion = this.navVersion;
      }
      if (!e.path.length) return dist(e, center(this.nearestFree(goal.x, goal.y))) < 10;
      const p = e.path[0], dx = p.x - e.x, dy = p.y - e.y, distance = Math.hypot(dx, dy), step = TYPES[e.type].speed * dt;
      if (distance > .1) { e.angle = Math.atan2(dy, dx); e.x += dx / distance * Math.min(step, distance); e.y += dy / distance * Math.min(step, distance); e.traveled += step; }
      if (distance <= step + 1) e.path.shift(); return false;
    }
    harvest(e, dt) {
      const refineries = this.owned('refinery', e.team); if (!refineries.length) return;
      const refinery = refineries.sort((a, b) => dist(e, a) - dist(e, b))[0];
      if (e.cargo >= 300 || (!this.ore.some(o => o.amount > 0) && e.cargo > 0)) {
        const b = this.bounds(refinery), drop = center(this.nearestFree(refinery.x, b.y + b.h + 24));
        if (dist(e, drop) < 45) { this.money[e.team] += e.cargo; if (!e.team) this.effects.push({ type: 'income', x: e.x, y: e.y, amount: e.cargo, life: 1.5 }); e.cargo = 0; e.path = []; e.routeTimer = 0; }
        else this.move(e, drop, dt, 30);
      } else {
        const preferred = e.order?.kind === 'harvest' ? e.order : e;
        const deposits = this.ore.filter(o => o.amount > 0).sort((a, b) => dist(preferred, a) - dist(preferred, b)); if (!deposits.length) return;
        const ore = deposits[0];
        if (dist(e, ore) < 68) { const amount = Math.min(65 * dt, ore.amount, 300 - e.cargo); e.cargo += amount; ore.amount -= amount; e.path = []; e.harvestTimer += dt; }
        else this.move(e, ore, dt, 55);
      }
    }
    updateVision() {
      this.visible.fill(0);
      for (const e of this.owned()) {
        const r = TYPES[e.type].sight, cx = Math.floor(e.x / TILE), cy = Math.floor(e.y / TILE), n = Math.ceil(r / TILE);
        for (let y = Math.max(0, cy - n); y <= Math.min(ROWS - 1, cy + n); y++) for (let x = Math.max(0, cx - n); x <= Math.min(COLS - 1, cx + n); x++) {
          const i = y * COLS + x; if (dist(e, center(i)) <= r) this.explored[i] = this.visible[i] = 1;
        }
      }
    }
    isVisible(e) { return e.team === 0 || !!this.visible[cell(e.x, e.y)]; }
    tick(dt) {
      if (this.outcome || !(dt > 0)) return; dt = Math.min(dt, .1); this.time += dt;
      this.effects.forEach(e => e.life -= dt); this.effects = this.effects.filter(e => e.life > 0);
      for (const kind of ['building', 'unit']) {
        const q = this.queue[kind], item = q[0]; if (!item) continue;
        if (kind === 'unit' && !this.owned('factory').length) continue;
        const wasReady = item.progress >= 1; item.progress = Math.min(1, item.progress + dt / TYPES[item.type].time * (this.powered() ? 1 : .35));
        if (item.progress >= 1 && !wasReady && kind === 'building') this.event('建筑就绪，请选择位置部署', 'build');
        if (item.progress >= 1 && kind === 'unit') { this.spawnAt(item.type, 0, this.owned('factory')[0]); this.event(`${TYPES[item.type].name}已就绪`, 'unit'); q.shift(); }
      }
      this.enemyProduction -= dt;
      if (this.enemyProduction <= 0) {
        this.enemyProduction = this.powered(1) ? 12 : 30;
        const factory = this.owned('factory', 1)[0], army = this.owned(null, 1).filter(e => !TYPES[e.type].building);
        if (factory && army.length < 22) {
          const type = !this.owned('harvester', 1).length && this.owned('refinery', 1).length ? 'harvester' : this.wave % 3 === 2 ? 'scout' : 'tank';
          if (this.money[1] >= TYPES[type].cost) { this.money[1] -= TYPES[type].cost; this.spawnAt(type, 1, factory); }
        }
      }
      if (this.time >= this.nextWave) {
        this.nextWave += 55; this.wave++;
        const hq = this.owned('hq')[0]; if (hq) this.owned(null, 1).filter(e => !TYPES[e.type].building && e.type !== 'harvester').slice(0, 3 + this.wave).forEach(e => { e.order = { kind: 'attackmove', x: hq.x, y: hq.y }; e.routeTimer = 0; });
        this.event(`侦测到敌军第 ${this.wave} 波进攻`, 'warning');
      }
      this.visionTimer -= dt; if (this.visionTimer <= 0) { this.updateVision(); this.visionTimer = .25; }
      for (const e of this.entities) {
        if (e.hp <= 0) continue;
        const d = TYPES[e.type]; e.cooldown -= dt;
        if (e.type === 'harvester') {
          if (e.order && e.order.kind !== 'harvest') { if (e.order.kind !== 'hold' && this.move(e, e.order, dt)) e.order = null; }
          else this.harvest(e, dt);
          continue;
        }
        if (!d.damage) continue;
        let target = e.order && e.order.kind === 'attack' ? this.get(e.order.target) : null;
        if (target && e.team === 0 && !this.isVisible(target)) { e.order = { kind: 'attackmove', x: e.order.x, y: e.order.y }; target = null; }
        if (e.order && e.order.kind === 'attack' && !target) e.order = null;
        const mayAcquire = !e.order || e.order.kind !== 'move';
        if (!target && mayAcquire) {
          const searchRange = e.order?.kind === 'attackmove' ? d.sight : d.range;
          const enemies = this.entities.filter(v => v.hp > 0 && v.team !== e.team && (e.team !== 0 || this.isVisible(v)) && this.targetDistance(e, v) < searchRange);
          target = enemies.sort((a, b) => this.targetDistance(e, a) - this.targetDistance(e, b))[0];
        }
        if (target && this.targetDistance(e, target) <= d.range) {
          e.turretAngle = Math.atan2(target.y - e.y, target.x - e.x);
          if (e.cooldown <= 0 && (!d.building || this.powered(e.team))) {
            e.cooldown = d.reload; this.projectiles.push({ x: e.x, y: e.y, target: target.id, damage: d.damage, team: e.team, life: 3 });
            this.effects.push({ type: 'muzzle', x: e.x + Math.cos(e.turretAngle) * 26, y: e.y + Math.sin(e.turretAngle) * 26, life: .12 });
          }
        } else if (!d.building) {
          if (target && e.order?.kind !== 'hold') this.move(e, target, dt, d.range * .85);
          else if (e.order && e.order.kind !== 'hold') { if (this.move(e, e.order, dt)) e.order = null; }
          else e.turretAngle = e.angle;
        }
      }
      // Soft separation keeps formations legible without blocking narrow routes.
      const grid = this.blocked(), units = this.entities.filter(e => e.hp > 0 && !TYPES[e.type].building);
      for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
        const a = units[i], b = units[j], distance = dist(a, b), min = (TYPES[a.type].radius + TYPES[b.type].radius) * .85;
        if (distance < min) {
          const angle = distance < .01 ? (a.id * 2.399) : Math.atan2(a.y - b.y, a.x - b.x), force = Math.min((min - distance) * .5, dt * 35);
          for (const [e, sign] of [[a, 1], [b, -1]]) { const x = clamp(e.x + Math.cos(angle) * force * sign, 24, WIDTH - 24), y = clamp(e.y + Math.sin(angle) * force * sign, 24, HEIGHT - 24); if (!grid[cell(x, y)]) { e.x = x; e.y = y; } }
        }
      }
      for (const p of this.projectiles) {
        p.life -= dt; const target = this.get(p.target); if (!target) { p.life = 0; continue; }
        const distance = dist(p, target), speed = 550 * dt;
        if (distance <= speed + 8) {
          target.hp -= p.damage; p.life = 0; this.effects.push({ type: 'hit', x: target.x, y: target.y, life: .3 });
          if (target.hp <= 0) {
            this.effects.push({ type: 'explosion', x: target.x, y: target.y, life: .8 });
            if (TYPES[target.type].building) this.invalidateNav();
            if (target.team === 1) this.kills++; else this.event(`${TYPES[target.type].name}已被摧毁`, 'warning');
          }
        } else { p.x += (target.x - p.x) / distance * speed; p.y += (target.y - p.y) / distance * speed; }
      }
      this.projectiles = this.projectiles.filter(p => p.life > 0); this.entities = this.entities.filter(e => e.hp > 0);
      if (!this.owned('hq', 1).length) this.outcome = 'victory'; else if (!this.owned('hq').length) this.outcome = 'defeat';
    }

  }
  const api = { Game, TYPES, TILE, COLS, ROWS, WIDTH, HEIGHT, clamp, dist, cell, center };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RTS = api;
})(globalThis);
