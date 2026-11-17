/* room.js — 双人模式「单屏房间」关卡生成器（模仿《冰火人》Fireboy & Watergirl）
   对应需求：
     1) 两个人都要看得到 → 房间固定 24 × 14 格 = 960 × 560，正好等于画布，
        所以摄像机 camX 恒为 0，谁都不可能被挤出屏幕；
     2) 地图不左右延伸、往上加高台 → 地面之上按 2 行间距（80px）叠 3~5 层蛇形高台，
        每层从下层的一个端点长出来，层与层之间天然留出起跳位；
     3) 岩浆和水 → 平台上铺火池（~，只溶蓝魔）和水池（_，只溶红魔），后期补酸池（O）；
     4) 可解性 → 每放一个机关都重新跑一遍「站立点 BFS」验证红魔能到红门、蓝魔能到蓝门，
        过不了就把这个机关撤掉 / 整关换种子重来。宁可多试几次，也不放出一关过不去的关卡。

   图例（沿用 world.js）：# 实心  ~ 火池  _ 水池  O 酸池  ^ 地刺  G 守卫
                        D 红门  d 蓝门  P 红魔出生点  p 蓝魔出生点
*/
(function () {
  const COLS = 24;                 // 24 列 × 40px = 960 = 画布宽
  const ROWS = LD.ROWS;            // 14 行 × 40px = 560 = 画布高
  const FLOOR = ROWS - 2;          // 12：地面顶行（小人脚踩在这一行的上表面）
  const STEP = 2;                  // 高台层间距（行）。2 行 = 80px，满跳 131px，留足余量
  const S = '#';
  const FIRE = '~', WATER = '_', ACID = 'O';
  const SPIKE = '^', GUARD = 'G';
  const MAX_TRIES = 120;

  const rangeArr = (a, b) => { const o = []; for (let i = a; i <= b; i++) o.push(i); return o; };
  function shuffled(arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* 与 Player.killsBy 一一对应：某个字符对某个角色是否有害 */
  function harmful(ch, kind) {
    if (ch === SPIKE || ch === ACID || ch === GUARD) return true;
    if (ch === FIRE) return kind === 'blue';      // 火池只溶蓝魔
    if (ch === WATER) return kind === 'red';      // 水池只溶红魔
    /* 新障碍：激光 / 蒸汽 / 摆锤 / 浮游雷对两个人都有害（生成时按尖刺同款避让） */
    if (ch === 'L' || ch === 'S' || ch === 'N' || ch === 'M') return true;
    return false;
  }
  const solid = (ch) => ch === S || ch === 'X' || ch === 'T';
  const passable = (ch, kind) => !solid(ch) && !harmful(ch, kind);

  /* ---------- 站立点可达性模型 ----------
     节点 = 「小人站在 (c, r) 的上表面」。
     边 = 走一步 / 掉下去 / 向上跳。
     跳跃用保守几何模型：真实满跳约 3.3 格高、3.7 格远，这里只承诺
     「向上 ≤2 行、水平 ≤2 格（向上 1 行时 ≤3 格）」，宁可判不可达（触发重新生成），
     也不放出一关「理论上能过但实际跳不上去」的关卡。 */
  function canStand(G, c, r, kind) {
    if (c < 0 || c >= COLS || r < 1 || r >= ROWS) return false;
    if (!solid(G[r][c])) return false;
    const above = G[r - 1][c];
    if (solid(above)) return false;                // 头顶就是实心，站不进去
    return !harmful(above, kind);
  }

  function clearUp(G, c, r, r2, kind) {
    for (let k = r2; k <= r - 1; k++) if (!passable(G[k][c], kind)) return false;
    return true;
  }
  function clearSide(G, r, c, c2, kind) {
    const a = Math.min(c, c2), b = Math.max(c, c2);
    for (let x = a; x <= b; x++) if (!passable(G[r][x], kind)) return false;
    return true;
  }

  function jumpOK(G, c, r, c2, r2, kind) {
    const up = r - r2;
    if (up < 1 || up > 2) return false;
    const dx = Math.abs(c2 - c);
    if (dx < 1 || dx > (up === 1 ? 3 : 2)) return false;
    if (!clearUp(G, c, r, r2, kind)) return false;             // 起跳点上方要能升起来
    if (!clearSide(G, r2 - 1, c, c2, kind)) return false;      // 身体横移的那一行
    for (let x = Math.min(c, c2); x <= Math.max(c, c2); x++) {
      if (x === c2) continue;                                  // 目标格是实心平台，就是落点
      if (!passable(G[r2][x], kind)) return false;             // 脚横移的那一行
    }
    return true;
  }

  function neighbors(G, c, r, kind) {
    const out = [];
    for (const dc of [-1, 1]) {
      const c2 = c + dc;
      if (c2 < 0 || c2 >= COLS) continue;
      if (!passable(G[r - 1][c2], kind)) continue;
      if (solid(G[r][c2])) {
        if (canStand(G, c2, r, kind)) out.push([c2, r]);
      } else {
        for (let r2 = r + 1; r2 < ROWS; r2++) {
          if (!solid(G[r2][c2])) continue;
          if (canStand(G, c2, r2, kind)) out.push([c2, r2]);
          break;
        }
      }
    }
    for (let up = 1; up <= 2; up++) {
      const r2 = r - up;
      if (r2 < 1) continue;
      for (let dc = -3; dc <= 3; dc++) {
        if (!dc) continue;
        const c2 = c + dc;
        if (!canStand(G, c2, r2, kind)) continue;
        if (!jumpOK(G, c, r, c2, r2, kind)) continue;
        out.push([c2, r2]);
      }
    }
    return out;
  }

  function canReach(G, from, goalCell, kind) {
    const K = (c, r) => r * COLS + c;
    if (!canStand(G, from[0], from[1], kind)) return false;
    const goal = K(goalCell[0], goalCell[1]);
    const seen = new Set([K(from[0], from[1])]);
    const q = [from];
    for (let head = 0; head < q.length; head++) {
      const [c, r] = q[head];
      if (K(c, r) === goal) return true;
      for (const nb of neighbors(G, c, r, kind)) {
        const k = K(nb[0], nb[1]);
        if (seen.has(k)) continue;
        seen.add(k);
        q.push(nb);
      }
    }
    return false;
  }
  /* 从起点能站到的所有格子（用于挑选机关位置，避免放在孤岛 / 死角上） */
  function reachSet(G, from, kind) {
    const K = (c, r) => r * COLS + c;
    const seen = new Set();
    if (!canStand(G, from[0], from[1], kind)) return seen;
    seen.add(K(from[0], from[1]));
    const q = [from];
    for (let head = 0; head < q.length; head++) {
      const [c, r] = q[head];
      for (const nb of neighbors(G, c, r, kind)) {
        const k = K(nb[0], nb[1]);
        if (seen.has(k)) continue;
        seen.add(k);
        q.push(nb);
      }
    }
    return seen;
  }

  /* ---------- 房间生成（失败返回 null，由调用方换种子重试） ---------- */
  const NAMES = [
    ['冰火之间', 'Between Fire and Water'],
    ['交错的台阶', 'Staggered Steps'],
    ['往上的路', 'The Way Up'],
    ['双生楼梯', 'Twin Staircase'],
    ['熔岩与水洼', 'Lava and Puddles'],
    ['错层', 'Offset Floors'],
    ['攀登', 'The Climb'],
    ['两座塔', 'Two Towers'],
    ['分岔的高台', 'Forks and Ledges'],
    ['上去再说', 'Just Go Up'],
  ];

  function build(n, t, rnd) {
    const G = [];
    for (let r = 0; r < ROWS; r++) G.push(new Array(COLS).fill('.'));

    // ---- 1) 地面：两层厚，踩得稳、掉不出去 ----
    for (let c = 0; c < COLS; c++) { G[FLOOR][c] = S; G[FLOOR + 1][c] = S; }

    // ---- 2) 高台：每层在下层上方错开几格，一层层往上叠成之字形台阶 ----
    /* 每层最多横移 3 格 —— 这是跳跃能力决定的硬约束：
       向上 2 行（80px）时，水平能移动的窗口只有约 2 格，所以「台阶」必须错得开又不能错太远。
       错开方向会一直沿用（drift），撞到房间边界再反向，于是楼梯会真的在左右之间摆动。 */
    const halls = [];
    let cur = { row: FLOOR, x0: 0, x1: COLS - 1 };
    const want = 3 + Math.floor(rnd() * 3);              // 3~5 层高台
    let drift = rnd() < 0.5 ? -1 : 1;
    for (let i = 0; i < want; i++) {
      const row = cur.row - STEP;
      if (row < 2) break;
      const w = 6 + Math.floor(rnd() * 5);              // 每层宽 6~10 格
      const cand = [];
      for (let s = -5; s <= 5; s++) {
        const x0 = cur.x0 + s, x1 = x0 + w - 1;
        if (x0 < 0 || x1 >= COLS) continue;
        if (!(x0 > cur.x0 || x1 < cur.x1)) continue;    // 必须留出「露出来的下层格子」当起跳位
        if (Math.abs(s) > 2 && Math.min(x1, cur.x1) - Math.max(x0, cur.x0) < 1) continue;  // 与下层至少重叠 1 格
        let ok = true;
        for (let c = x0; c <= x1 && ok; c++) {
          for (let r = row - 1; r < cur.row; r++) if (G[r][c] !== '.') { ok = false; break; }
        }
        if (!ok) continue;
        cand.push({ x0, x1, s });
      }
      if (!cand.length) break;
      // 沿当前漂移方向随机跨 1~3 格（不是固定 1 格），否则楼梯永远只会小小地挪一点点
      let pool = cand.filter((p) => p.s !== 0 && p.s * drift > 0);
      if (!pool.length) { drift = -drift; pool = cand.filter((p) => p.s !== 0 && p.s * drift > 0); }
      const pick = pool.length ? pool[Math.floor(rnd() * pool.length)]
        : cand[Math.floor(rnd() * cand.length)];
      for (let c = pick.x0; c <= pick.x1; c++) G[row][c] = S;
      halls.push({ row, x0: pick.x0, x1: pick.x1 });
      cur = { row, x0: pick.x0, x1: pick.x1 };
    }
    if (halls.length < 3) return null;                    // 层数太少（需求：往上多叠几层）

    // ---- 3) 门 + 出生点 ----
    const tiers = [{ row: FLOOR, cells: rangeArr(0, COLS - 1), key: 'base' }];
    halls.forEach((h, i) => tiers.push({ row: h.row, cells: rangeArr(h.x0, h.x1), key: 'h' + i }));

    // 门放在最高的两处高台上（越高越要爬）；两扇门必须水平错开，否则「红门在左」就无从谈起
    const stacks = tiers.slice().sort((a, b) => a.row - b.row);
    const spots = [];
    for (const ti of stacks) {
      const free = shuffled(ti.cells, rnd).filter((c) => G[ti.row - 1][c] === '.' && !spots.some((s) => s.c === c));
      if (!free.length) continue;
      spots.push({ c: free[0], r: ti.row });
      if (spots.length >= 2) break;
    }
    if (spots.length < 2) return null;
    spots.sort((a, b) => a.c - b.c);
    const redDoor = spots[0], blueDoor = spots[1];
    G[redDoor.r - 1][redDoor.c] = 'D';
    G[blueDoor.r - 1][blueDoor.c] = 'd';

    // 出生点：红魔在左、蓝魔在右，都站在地面上（一屏内互相看得见）
    const leftC = shuffled(rangeArr(1, 5).filter((c) => G[FLOOR - 1][c] === '.'), rnd);
    const rightC = shuffled(rangeArr(COLS - 6, COLS - 2).filter((c) => G[FLOOR - 1][c] === '.'), rnd);
    if (!leftC.length || !rightC.length) return null;
    const sp1 = leftC[0], sp2 = rightC[0];
    G[FLOOR - 1][sp1] = 'P';
    G[FLOOR - 1][sp2] = 'p';

    const okNow = () => canReach(G, [sp1, FLOOR], [redDoor.c, redDoor.r], 'red')
      && canReach(G, [sp2, FLOOR], [blueDoor.c, blueDoor.r], 'blue');
    if (!okNow()) return null;                            // 光地形就上不去 → 换种子

    /* 放下一个机关，然后立刻重跑可达性；过不了就原样撤回。
       这一步是整个生成器里最重要的保险：不管前面怎么随机，
       只要这一句还在，就绝不会生出一关「机关把路堵死了」的关卡。 */
    const tryPlace = (c, r, ch) => {
      const old = G[r][c];
      G[r][c] = ch;
      if (okNow()) return true;
      G[r][c] = old;
      return false;
    };

    // ---- 4) 池子 + 地刺 + 守卫：都放「小人真的能站上去」的格子上 ----
    const standable = new Map();       // key -> {c, r, tier}
    for (const kind of ['red', 'blue']) {
      const set = reachSet(G, kind === 'red' ? [sp1, FLOOR] : [sp2, FLOOR], kind);
      for (const k of set) {
        const r = Math.floor(k / COLS), c = k % COLS;
        const above = r - 1;
        if (above < 1 || G[above][c] !== '.') continue;   // 只考虑「身体那一格是空的」
        const tier = tiers.find((x) => x.row === r);
        if (!tier) continue;
        standable.set(r * COLS + c, { c, r, top: above, tier: tier.key });
      }
    }
    const slots = [...standable.values()];

    const usedTier = new Set();
    function placePool(ch, maxSpan) {
      for (const p of shuffled(slots, rnd)) {
        if (usedTier.has(p.tier)) continue;
        if (G[p.top][p.c] !== '.') continue;
        if (tryPlace(p.c, p.top, ch)) { usedTier.add(p.tier); return 1; }
        // 两格宽：要求右边那一格在同一层平台上
        if (maxSpan >= 2) {
          const nb = standable.get(p.r * COLS + p.c + 1);
          if (nb && nb.tier === p.tier && G[nb.top][nb.c] === '.' && p.c + 1 < COLS && nb.r === p.r) {
            const old = G[p.top][p.c];
            G[p.top][p.c] = ch;
            if (tryPlace(nb.c, nb.top, ch)) { usedTier.add(p.tier); return 2; }
            G[p.top][p.c] = old;
          }
        }
      }
      return 0;
    }
    function placeHazard(ch, minGap) {
      const cand = shuffled(slots.filter((p) => G[p.top][p.c] === '.' && !usedTier.has('sp' + p.tier)), rnd);
      let placed = 0;
      for (const p of cand) {
        if (placed >= minGap) break;
        if (G[p.top][p.c] !== '.') continue;
        if (tryPlace(p.c, p.top, ch)) { usedTier.add('sp' + p.tier); placed++; }
      }
      return placed;
    }
    /* 放在站立点上方 rowOff 行的空中障碍（浮游雷 / 摆锤锚点）。
       和 placeHazard 一样走 tryPlace：放完立刻重跑可达性，把路堵死了就撤回。 */
    function placeAir(ch, rowOff, minGap, key) {
      const tag = key || ('air' + ch);
      const cand = shuffled(slots.filter((p) => G[p.top][p.c] === '.' && !usedTier.has(tag + p.tier)), rnd);
      let placed = 0;
      for (const p of cand) {
        if (placed >= minGap) break;
        const row = p.top + rowOff;
        if (row < 1 || row >= ROWS) continue;
        if (G[row][p.c] !== '.') continue;
        if (tryPlace(p.c, row, ch)) { usedTier.add(tag + p.tier); placed++; }
      }
      return placed;
    }

    if (!placePool(FIRE, 2)) return null;                 // 火池是硬要求
    if (!placePool(WATER, 2)) return null;                // 水池是硬要求
    if (n >= 9 && rnd() < 0.6) placePool(ACID, 2);
    if (n >= 16 && rnd() < 0.55) placePool(rnd() < 0.5 ? FIRE : WATER, 2);
    if (n >= 22 && rnd() < 0.5) placePool(rnd() < 0.5 ? FIRE : WATER, 2);
    if (n >= 5) placeHazard(SPIKE, Math.min(3, 1 + Math.floor(t * 2.4)));
    if (n >= 14 && rnd() < 0.8) placeHazard(GUARD, 1);
    /* ---- 新障碍：蒸汽 / 激光贴地，浮游雷 / 摆锤悬在头顶上方 ---- */
    if (n >= 7 && rnd() < 0.75) placeHazard('S', 1);
    if (n >= 10 && rnd() < 0.7) placeHazard('L', 1);
    if (n >= 12 && rnd() < 0.6) placeAir('M', -2, 1);
    if (n >= 18 && rnd() < 0.6) placeAir('N', -3, 1);

    if (!okNow()) return null;                            // 最后一道保险

    // ---- 5) 元数据 ----
    const nameI = Math.floor(rnd() * NAMES.length);
    const tall = halls.length >= 4;
    return {
      id: n,
      name: NAMES[nameI][0],
      nameEn: NAMES[nameI][1],
      hint: `火池（红）只溶蓝魔，水池（蓝）只溶红魔 —— 两个人走的路不一样。${tall ? '高台一直在往上加。' : '先找到能往上踩的那一级。'}`,
      hintEn: 'The red pool melts Watergirl, the blue pool melts Fireboy — the two of you take different routes. '
        + (tall ? 'The ledges keep climbing.' : 'Find the step that gets you up.'),
      cols: COLS,
      rows: ROWS,
      grid: G.map((r) => r.join('')),
      coop: n,
      room: true,
      halls: halls.map((h) => ({ row: h.row, x0: h.x0, x1: h.x1 })),
      // 站立点（脚踩在哪一格的上表面）：门在平台上方一行，所以门的站立点是 r+1
      redDoorCell: [redDoor.c, redDoor.r],
      blueDoorCell: [blueDoor.c, blueDoor.r],
      spawnCell: [sp1, FLOOR],
      spawn2Cell: [sp2, FLOOR],
      timeLimit: Math.round(45 + n * 1.1),
      scoreBase: 100 + n * 12,
      tint: [['#120a14', '#2a0f1c'], ['#0a0d18', '#141a38'], ['#0d1010', '#1b2a1e'],
        ['#140d0a', '#2c1a10'], ['#0b1018', '#122a34']][n % 5],
    };
  }

  /* 通关兜底：万一 120 次都失败（理论上不会），给一个手写的最小可解房间 */
  function fallback(n) {
    const G = [];
    for (let r = 0; r < ROWS; r++) G.push(new Array(COLS).fill('.'));
    for (let c = 0; c < COLS; c++) { G[FLOOR][c] = S; G[FLOOR + 1][c] = S; }
    for (let c = 3; c <= 13; c++) G[FLOOR - 2][c] = S;
    for (let c = 10; c <= 20; c++) G[FLOOR - 4][c] = S;
    for (let c = 2; c <= 12; c++) G[FLOOR - 6][c] = S;
    G[FLOOR - 1][6] = FIRE;
    G[FLOOR - 3][16] = WATER;
    G[FLOOR - 1][2] = 'P';
    G[FLOOR - 1][21] = 'p';
    G[FLOOR - 7][11] = 'D';        // 站在 row 6 那层平台上
    G[FLOOR - 5][14] = 'd';        // 站在 row 8 那层平台上
    return {
      id: n, name: NAMES[0][0], nameEn: NAMES[0][1],
      hint: '火池只溶蓝魔，水池只溶红魔。', hintEn: 'Each pool melts only the other one.',
      cols: COLS, rows: ROWS, grid: G.map((r) => r.join('')),
      coop: n, room: true, halls: [],
      redDoorCell: [11, FLOOR - 6], blueDoorCell: [14, FLOOR - 4],
      spawnCell: [2, FLOOR], spawn2Cell: [21, FLOOR],
      timeLimit: Math.round(45 + n * 1.1), scoreBase: 100 + n * 12,
      tint: ['#120a14', '#2a0f1c'],
    };
  }

  LD.genRoom = function (i) {
    const n = Math.max(1, Math.min(LD.COOP_COUNT, Math.floor(i) || 1));
    const t = (n - 1) / (LD.COOP_COUNT - 1);
    for (let k = 0; k < MAX_TRIES; k++) {
      const rnd = LD.mulberry32((n * 1000003 + k * 7919 + 20250825) >>> 0);
      const r = build(n, t, rnd);
      if (r) { r.attempts = k + 1; return r; }
    }
    const f = fallback(n);
    f.attempts = -1;
    return f;
  };
  LD.roomReach = { canReach, canStand, neighbors, reachSet, harmful, solid, FLOOR, COLS, ROWS };
  LD.ROOM_COLS = COLS;
  LD.ROOM_ROWS = ROWS;
})();
