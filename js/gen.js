/* gen.js — 程序化关卡生成器
   15 个「原型」，每个原型有自己的地形形态、机关配比、招牌陷阱和背景色调，
   同一原型在第二轮出现时又会收紧平台长度 / 加宽坑，避免关卡互相雷同。
*/
(function () {
  const R = LD.ROWS;

  /* 表面危险物（地刺 / 火池 / 水池 / 地面塌陷）之间的最小间隔（格）。
     为什么是 3：玩家一次满跳水平距离约 150px ≈ 3.75 格。两个危险物挨得太近时，
     玩家只能落进中间那条窄缝里，落地判定是按像素算的 —— 实测间隔 1 格时落地窗口只剩
     34px，属于「理论上能过、实际上过不去」。留 3 格空地后双机器人 30 关全部可过。 */
  const HAZ_CLEAR = 3;
  /* 表面危险物两侧各需要几格「同高度平地」。
     2 的含义：地刺/池子前后各有 2 格与它齐平的落脚地，玩家可以从容起跳、从容落地。
     早先只要求「够平」，结果地刺会并排落在只有 1 格落脚点的窄台上，
     玩家必须用一个像素级精确的中跳；双人仿真里 L1 的 11-12 号刺就是这么把两个机器人
     各卡死 9 次的。 */
  const LAND_SIDE = 2;
  // 新危险物占据 [c, cEnd] 时，旁边 clear 格内不允许有别的表面危险物
  function hazClear(hazCols, c, cEnd, clear) {
    const n = clear == null ? HAZ_CLEAR : clear;
    for (let k = c - n; k <= cEnd + n; k++) if (hazCols.has(k)) return false;
    return true;
  }
  // surf 在危险物占据的 [c, c+span-1] 及其左右各 side 格上是否同一高度
  function flatSide(surf, c, span, side) {
    const s = surf[c];
    if (s == null) return false;
    for (let k = 1; k <= side; k++) {
      if (surf[c - k] !== s) return false;
      if (surf[c + span - 1 + k] !== s) return false;
    }
    return true;
  }

  /* 原型表
     h          地面高度范围 [最矮, 最高]（行号，越大越靠下）
     pit        坑的出现权重      gapMax 坑最大宽度 1-3
     plat       平台长度 [min,max] step 阶梯权重  tower 高低台权重  pillar 窄柱权重
     mob        机关密度倍率（会乘以难度）
     events     该原型启用的招牌陷阱
     tint       背景渐变（让不同关卡一眼看出不是同一关）
  */
  const ARCHS = [
    { // 0 缺口：宽坑为主，机关稀少
      name: '缺口', hint: '缺口比看起来大，助跑再跳。',
      h: [10, 12], pit: 0.44, gapMax: 2, plat: [4, 7], step: 0.16, tower: 0.10, pillar: 0.03,
      mob: { spike: 0.30, mover: 0.55, crumble: 0.15, guard: 0.10, crusher: 0, flyer: 0, saw: 0, fake: 0.10, laser: 0.15, geyser: 0.10, pendulum: 0.10, mine: 0.10, belt: 0.10 },
      events: ['frontSpikes'], tint: ['#0a0c18', '#1a1030'],
    },
    { // 1 地刺阵：地形平坦，刺密
      name: '地刺阵', hint: '地刺后面还有地刺。',
      h: [11, 12], pit: 0.14, gapMax: 1, plat: [5, 8], step: 0.14, tower: 0.08, pillar: 0,
      mob: { spike: 1.90, mover: 0.15, crumble: 0.10, guard: 0.35, crusher: 0.10, flyer: 0, saw: 0.10, fake: 0.10, laser: 0.55, geyser: 0.20, pendulum: 0.20, mine: 0.10, belt: 0.30 },
      events: ['frontSpikes', 'vanish'], tint: ['#0d0a12', '#2a0f1c'],
    },
    { // 2 移动的地板：短平台 + 大量移动平台
      name: '移动的地板', hint: '别站在会动的东西上等它带你回去。',
      h: [11, 12], pit: 0.42, gapMax: 3, plat: [3, 5], step: 0.12, tower: 0.08, pillar: 0.03,
      mob: { spike: 0.20, mover: 1.80, crumble: 0.20, guard: 0.10, crusher: 0.10, flyer: 0.10, saw: 0, fake: 0.10, laser: 0.20, geyser: 0.10, pendulum: 0.20, mine: 0.10, belt: 0.25 },
      events: ['frontSpikes', 'moverStall'], tint: ['#08111a', '#0f2438'],
    },
    { // 3 崩塌之桥：坑上架着易碎砖 / 陷阱门
      name: '崩塌之桥', hint: '桥是假的，速度是真的。',
      h: [10, 12], pit: 0.38, gapMax: 2, plat: [4, 6], step: 0.14, tower: 0.08, pillar: 0.02,
      mob: { spike: 0.20, mover: 0.35, crumble: 1.90, guard: 0.15, crusher: 0.20, flyer: 0.10, saw: 0.10, fake: 0.20, laser: 0.20, geyser: 0.15, pendulum: 0.10, mine: 0.10, belt: 0.15 },
      events: ['frontSpikes', 'bridgeBreak'], tint: ['#120e08', '#2b1c0c'], trapChance: 0.25,
    },
    { // 4 守卫走廊：长平地 + 巡逻守卫
      name: '守卫走廊', hint: '守卫不止一个，找节奏跳过去。',
      h: [11, 12], pit: 0.10, gapMax: 1, plat: [7, 11], step: 0.14, tower: 0.08, pillar: 0,
      mob: { spike: 0.30, mover: 0.15, crumble: 0.10, guard: 2.00, crusher: 0.20, flyer: 0.30, saw: 0.20, fake: 0, laser: 0.60, geyser: 0.20, pendulum: 0.30, mine: 0.20, belt: 0.30 },
      events: ['vanish', 'tempBlock', 'guardRush'], tint: ['#0a0d16', '#151a3a'],
    },
    { // 5 落锤
      name: '落锤', hint: '头顶上的东西会掉下来。',
      h: [10, 12], pit: 0.20, gapMax: 1, plat: [5, 8], step: 0.16, tower: 0.10, pillar: 0,
      mob: { spike: 0.40, mover: 0.20, crumble: 0.10, guard: 0.20, crusher: 1.90, flyer: 0.20, saw: 0, fake: 0.10, laser: 0.30, geyser: 0.30, pendulum: 0.40, mine: 0.10, belt: 0.10 },
      events: ['frontSpikes', 'tempBlock'], tint: ['#100a12', '#2a1230'],
    },
    { // 6 飞行怪：空中敌人
      name: '飞行怪', hint: '它贴着天花板飞，你贴着地面跑。',
      h: [9, 12], pit: 0.30, gapMax: 2, plat: [5, 8], step: 0.14, tower: 0.10, pillar: 0.03,
      mob: { spike: 0.30, mover: 0.30, crumble: 0.10, guard: 0.30, crusher: 0.30, flyer: 1.90, saw: 0.20, fake: 0.20, laser: 0.20, geyser: 0.20, pendulum: 0.10, mine: 0.35, belt: 0.10 },
      events: ['frontSpikes', 'tempBlock'], tint: ['#08120f', '#0e2b24'],
    },
    { // 7 深渊：坑多且宽
      name: '深渊', hint: '掉下去就重来。',
      h: [9, 12], pit: 0.50, gapMax: 3, plat: [3, 5], step: 0.12, tower: 0.10, pillar: 0.16,
      mob: { spike: 0.25, mover: 0.85, crumble: 0.10, guard: 0.10, crusher: 0.10, flyer: 0.20, saw: 0.10, fake: 0.10, laser: 0.10, geyser: 0.30, pendulum: 0.10, mine: 0.15, belt: 0.10 },
      events: ['frontSpikes'], tint: ['#07070f', '#12122a'],
    },
    { // 8 陷阱门：地板会消失
      name: '陷阱门', hint: '看起来能踩的地板，不一定愿意让你踩。',
      h: [10, 12], pit: 0.34, gapMax: 2, plat: [4, 7], step: 0.14, tower: 0.08, pillar: 0.03,
      mob: { spike: 0.30, mover: 0.40, crumble: 1.20, guard: 0.20, crusher: 0.20, flyer: 0.10, saw: 0.10, fake: 0.30, laser: 0.30, geyser: 0.20, pendulum: 0.20, mine: 0.15, belt: 0.20 },
      events: ['vanish', 'frontSpikes'], tint: ['#0c0a10', '#241a2e'], trapChance: 0.85,
    },
    { // 9 锯轮地狱
      name: '锯轮地狱', hint: '锯轮在等你。',
      h: [11, 12], pit: 0.28, gapMax: 2, plat: [5, 8], step: 0.16, tower: 0.10, pillar: 0.02,
      mob: { spike: 0.40, mover: 0.30, crumble: 0.10, guard: 0.30, crusher: 0.30, flyer: 0.30, saw: 1.90, fake: 0.10, laser: 0.40, geyser: 0.20, pendulum: 0.30, mine: 0.15, belt: 0.10 },
      events: ['frontSpikes', 'vanish'], tint: ['#120a0a', '#2e1414'],
    },
    { // 10 骗你的墙
      name: '骗你的墙', hint: '墙会消失，也会出现。',
      h: [10, 12], pit: 0.24, gapMax: 2, plat: [5, 8], step: 0.16, tower: 0.10, pillar: 0.02,
      mob: { spike: 0.40, mover: 0.30, crumble: 0.20, guard: 0.50, crusher: 0.40, flyer: 0.20, saw: 0.20, fake: 0.20, laser: 0.40, geyser: 0.20, pendulum: 0.20, mine: 0.20, belt: 0.20 },
      events: ['tempBlock', 'frontSpikes', 'doorWall'], tint: ['#0a0e12', '#16222e'],
    },
    { // 11 假地板：飘在空中的假方块
      name: '假地板', hint: '看着能站，其实一碰就碎。',
      h: [10, 12], pit: 0.32, gapMax: 2, plat: [4, 7], step: 0.14, tower: 0.08, pillar: 0.03,
      mob: { spike: 0.30, mover: 0.30, crumble: 0.30, guard: 0.20, crusher: 0.20, flyer: 0.20, saw: 0.10, fake: 1.90, laser: 0.30, geyser: 0.15, pendulum: 0.20, mine: 0.15, belt: 0.15 },
      events: ['vanish', 'frontSpikes'], tint: ['#0f0a14', '#26183c'],
    },
    { // 12 连跳：窄柱与连续起跳
      name: '连跳', hint: '别停下来，一停就没了。',
      h: [9, 12], pit: 0.34, gapMax: 2, plat: [2, 4], step: 0.12, tower: 0.12, pillar: 0.30,
      mob: { spike: 0.50, mover: 0.30, crumble: 0.10, guard: 0.20, crusher: 0.10, flyer: 0.20, saw: 0.10, fake: 0.10, laser: 0.20, geyser: 0.15, pendulum: 0.15, mine: 0.10, belt: 0.20 },
      events: ['frontSpikes', 'vanish'], tint: ['#0a1008', '#1a2a12'],
    },
    { // 13 酸池：大段宽坑
      name: '酸池', hint: '酸液一碰就溶。',
      h: [9, 12], pit: 0.50, gapMax: 3, plat: [3, 6], step: 0.12, tower: 0.08, pillar: 0.12,
      mob: { spike: 0.20, mover: 0.95, crumble: 0.20, guard: 0.10, crusher: 0.10, flyer: 0.30, saw: 0.10, fake: 0.10, laser: 0.20, geyser: 0.40, pendulum: 0.10, mine: 0.20, belt: 0.10 },
      events: ['frontSpikes', 'tempBlock'], tint: ['#0a1206', '#1d2e0c'],
    },
    { // 14 最后一步：什么都有一点
      name: '最后一步', hint: '门就在那儿，真的。',
      h: [9, 12], pit: 0.34, gapMax: 3, plat: [3, 6], step: 0.14, tower: 0.10, pillar: 0.12,
      mob: { spike: 1.00, mover: 0.80, crumble: 0.80, guard: 0.80, crusher: 0.80, flyer: 0.80, saw: 0.80, fake: 0.60, laser: 0.50, geyser: 0.30, pendulum: 0.30, mine: 0.25, belt: 0.30 },
      events: ['frontSpikes', 'tempBlock', 'vanish', 'moverStall', 'bridgeBreak', 'guardRush',
               'doorMove', 'popSpikesDoor', 'doorWall'],
      tint: ['#0d0710', '#2c0d24'],
    },
  ];

  /* 原型名的英文翻译（[名称, 提示]） */
  const ARCH_EN = {
    '缺口': ['Gaps', 'The gap is wider than it looks. Build up speed before you jump.'],
    '地刺阵': ['Spike Field', 'Behind every spike there is another spike.'],
    '移动的地板': ['Moving Floor', 'Do not wait on moving things to carry you back.'],
    '崩塌之桥': ['Collapsing Bridge', 'The bridge is fake. The speed is real.'],
    '守卫走廊': ['Guard Corridor', 'There is more than one guard. Find the rhythm.'],
    '落锤': ['Crushers', 'What is above your head will come down.'],
    '飞行怪': ['Flyers', 'They hug the ceiling. You hug the floor.'],
    '深渊': ['The Abyss', 'Fall and you start over.'],
    '陷阱门': ['Trap Doors', 'Not every floor wants to be stepped on.'],
    '锯轮地狱': ['Saw Hell', 'The saws are waiting for you.'],
    '骗你的墙': ['Lying Walls', 'Walls vanish. Walls appear.'],
    '假地板': ['Fake Floor', 'Looks solid. Crumbles on touch.'],
    '连跳': ['Chain Jumps', 'Do not stop. Stopping is death.'],
    '酸池': ['Acid Pools', 'Acid melts anything it touches.'],
    '最后一步': ['The Last Step', 'The door is right there. Really.'],
  };

  /* ---------- 可通行性校验：保证每一关都能过去 ---------- */
  function reachable(surf) {
    const W = surf.length;
    const reach = new Array(W).fill(false);
    if (surf[0] == null) return false;
    reach[0] = true;
    for (let y = 1; y < W; y++) {
      if (surf[y] == null) continue;
      for (let x = Math.max(0, y - 4); x < y; x++) {
        if (!reach[x]) continue;
        let pits = 0;
        for (let k = x + 1; k < y; k++) if (surf[k] == null) pits++;
        if (pits > 3) continue;              // 最远跳 3 格空
        if (surf[y] < surf[x] - 2) continue; // 最多向上爬 2 格
        reach[y] = true;
        break;
      }
    }
    return reach[W - 1];
  }

  /* ---------- 地形：按原型权重拼接「结构块」 ---------- */
  function buildTerrain(rnd, W, prof, d) {
    const surf = new Array(W).fill(null);
    const pits = [];
    const minH = prof.minH, maxH = prof.maxH;
    const gMax = Math.min(3, Math.max(1, Math.round(1 + (prof.gapMax - 1) * (0.4 + 0.6 * d))));
    let h = maxH - (rnd() < 0.4 ? 1 : 0), x = 0, lastTower = false;

    const fill = (n, v) => { for (let k = 0; k < n && x < W; k++) surf[x++] = v; };
    const mkPit = (n) => { const s = x; fill(n, null); pits.push({ start: s, len: n, surfL: surf[s - 1], surfR: h }); };

    fill(3, h);   // 出生平台
    fill(2, h);   // 起步缓冲

    const pPit = prof.pit, pStep = pPit + prof.step, pTower = pStep + prof.tower;
    const pPillar = pTower + prof.pillar;
    while (x < W - 7) {
      const left = W - 7 - x;
      if (left < 2) break;
      const r = rnd();
      if (r < pPit) {                                 // 坑
        let gap = Math.min(1 + Math.floor(rnd() * gMax), 3, left);
        if (gap < 1) gap = 1;
        mkPit(gap);
        fill(2 + Math.floor(rnd() * Math.max(1, prof.plat[1] - 1)), h);
      } else if (r < pStep) {                         // 阶梯
        const n = 1 + Math.floor(rnd() * 2), up = rnd() < 0.5;
        for (let i = 0; i < n; i++) { h = LD.clamp(h + (up ? -1 : 1), minH, maxH); fill(2, h); }
      } else if (r < pTower && !lastTower) {          // 高低台（一次跨 2 格）
        lastTower = true;
        h = LD.clamp(h + (rnd() < 0.5 ? -2 : 2), minH, maxH);
        fill(4 + Math.floor(rnd() * 3), h);
        continue;
      } else if (r < pPillar) {                       // 窄柱
        const pw = 1 + Math.floor(rnd() * 2);
        mkPit(1);
        fill(pw, h);
        if (rnd() < 0.6) mkPit(1);
        fill(2, h);
      } else {                                        // 平地
        fill(prof.plat[0] + Math.floor(rnd() * (prof.plat[1] - prof.plat[0] + 1)), h);
      }
      lastTower = false;
    }
    fill(W - x, h);                                   // 门前收尾平地

    if (!reachable(surf)) {                           // 兜底一：把坑填平
      let prev = maxH;
      for (let k = 0; k < W; k++) { if (surf[k] == null) surf[k] = prev; else prev = surf[k]; }
    }
    if (!reachable(surf)) {                           // 兜底二：整关拉平
      for (let k = 0; k < W; k++) surf[k] = maxH;
    }
    return { surf, pits };
  }

  /* ---------- 招牌陷阱 ---------- */
  const EVENT = {
    // 前方忽然冒出地刺（触发点在刺的左侧 5~7 格，留出反应时间）
    frontSpikes(ctx) {
      const { rnd, W, safe, loose, surf, get, events, hazCols } = ctx;
      // 除了避让已有危险物，还要保证「左右各有 LAND_SIDE 格同高度落脚平地」。
      // 早先只查了自身和右边一格，结果会在一段已有地刺旁边 1 格再弹一根，
      // 变成 4 格宽的刺阵，玩家只能落进中间 34px 的缝里（实测 100% 死亡）。
      const okAt = (c, span) => flatSide(surf, c, span, LAND_SIDE) && hazClear(hazCols, c, c + span - 1, HAZ_CLEAR);
      let cands = safe.filter((c) => c >= 10 && c <= W - 8 && okAt(c, 2));
      if (!cands.length) cands = safe.filter((c) => c >= 10 && c <= W - 8 && okAt(c, 1));
      if (!cands.length) cands = loose.filter((c) => c >= 10 && c <= W - 8 && okAt(c, 1));
      if (!cands.length) return;
      const c = cands[Math.floor(rnd() * cands.length)];
      const ty = surf[c] - 1;
      if (get(c, ty) !== '.') return;
      const cells = [{ x: c, y: ty }];
      if (okAt(c, 2) && get(c + 1, ty) === '.') cells.push({ x: c + 1, y: ty });
      cells.forEach((cl) => hazCols.add(cl.x));
      events.push({ type: 'popSpikes', trigger: { tx: Math.max(6, c - 6), ty: 0, tw: 2, th: R }, cells });
    },
    // 前方忽然立起一堵墙，1.3 秒后自己消失
    tempBlock(ctx) {
      const { rnd, W, surf, get, events } = ctx;
      const lo = Math.floor(W * 0.4), hi = Math.floor(W * 0.78);
      for (let t = 0; t < 30; t++) {
        const c = lo + Math.floor(rnd() * Math.max(1, hi - lo));
        const ty = surf[c] == null ? null : surf[c] - 1;
        if (ty == null || get(c, ty) !== '.') continue;
        // 墙是 3 格高的，会正好立在玩家跳跃的落点上。所以它所在的那段台面
        // 左右必须各有 LAND_SIDE 格同高度平地，否则玩家会被迫落在墙顶上
        // （双人仿真里 L1 的墙立在 3 格宽高台正中，两个机器人都被弹上墙顶然后摔进火池）。
        if (!flatSide(surf, c, 1, LAND_SIDE)) continue;
        const cells = [{ x: c, y: ty }];
        if (ty - 1 > 0 && get(c, ty - 1) === '.') cells.push({ x: c, y: ty - 1 });
        if (ty - 2 > 0 && get(c, ty - 2) === '.') cells.push({ x: c, y: ty - 2 });
        events.push({ type: 'tempBlock', ttl: 1.35, trigger: { tx: Math.max(5, c - 6), ty: 0, tw: 2, th: R }, cells });
        return;
      }
    },
    // 你踩上去，地面才塌
    vanish(ctx) {
      const { rnd, W, surf, get, events, pits, hazCols } = ctx;
      const lo = Math.floor(W * 0.45), hi = Math.floor(W * 0.8);
      for (let t = 0; t < 40; t++) {
        const c = lo + Math.floor(rnd() * Math.max(1, hi - lo));
        if (surf[c] == null || surf[c] !== surf[c + 1] || surf[c] !== surf[c + 2]) continue;
        if (pits.some((p) => c >= p.start - 2 && c <= p.start + p.len + 2)) continue;
        // 3 格宽的无底洞：前后都要留够落地距离（洞旁边 1 格就是刺的话，跳过去也没地方落）
        if (!hazClear(hazCols, c, c + 2, HAZ_CLEAR)) continue;
        if (!flatSide(surf, c, 3, LAND_SIDE)) continue;
        const cells = [];
        for (let k = 0; k < 3; k++) for (let y = surf[c + k]; y < R; y++) cells.push({ x: c + k, y });
        for (let k = 0; k < 3; k++) hazCols.add(c + k);
        events.push({ type: 'vanish', trigger: { tx: Math.max(5, c - 6), ty: 0, tw: 2, th: R }, cells });
        return;
      }
    },
    // 你碰到门，门往后退
    doorMove(ctx) {
      const { rnd, W, surf, get, events, door } = ctx;
      const lo = Math.floor(W * 0.34), hi = Math.floor(W * 0.72);
      for (let t = 0; t < 40; t++) {
        const c = lo + Math.floor(rnd() * Math.max(1, hi - lo));
        if (surf[c] != null && get(c, surf[c] - 1) === '.') {
          events.push({ type: 'doorMove', trigger: { tx: Math.max(5, door.x - 6), ty: 0, tw: 3, th: R }, to: { x: c, y: surf[c] - 1 } });
          return;
        }
      }
    },
    // 门前忽然弹出刺（留出起跳距离）
    popSpikesDoor(ctx) {
      const { W, surf, get, events, hazCols } = ctx;
      const cells = [];
      [W - 8, W - 7].forEach((c) => { const t = surf[c] == null ? null : surf[c] - 1; if (t != null && get(c, t) === '.') cells.push({ x: c, y: t }); });
      if (cells.length !== 2) return;
      // 门前这段必须是一条干净的助跑带：W-15..W-6 之间不能有任何别的危险物，
      // 否则「跳过门前刺」和「躲开另一个池子」两件事会撞在一起，玩家没地方落脚。
      if (!hazClear(hazCols, W - 8, W - 7, HAZ_CLEAR)) return;
      for (let c = W - 15; c <= W - 6; c++) if (hazCols.has(c)) return;
      cells.forEach((cl) => hazCols.add(cl.x));
      events.push({ type: 'popSpikes', trigger: { tx: Math.max(5, W - 15), ty: 0, tw: 2, th: R }, cells });
    },
    // 移动平台突然停住——你以为它会带你过去
    moverStall(ctx) {
      const { rnd, W, moverPits, events } = ctx;
      const cands = moverPits.filter((p) => p.start > 9 && p.start < W - 13);
      if (!cands.length) return;
      const p = cands[Math.floor(rnd() * cands.length)];
      events.push({ type: 'moverStall', dur: 1.6, atX: (p.start + 1) * LD.TILE, trigger: { tx: Math.max(6, p.start - 6), ty: 0, tw: 2, th: R } });
    },
    // 你走到桥中间，整段桥一起塌
    bridgeBreak(ctx) {
      const { rnd, W, bridges, events } = ctx;
      const cands = bridges.filter((b) => b.start > 10 && b.start < W - 13);
      if (!cands.length) return;
      const b = cands[Math.floor(rnd() * cands.length)];
      events.push({ type: 'bridgeBreak', delay: 0.7, cells: b.cells, trigger: { tx: Math.max(6, b.start - 6), ty: 0, tw: 2, th: R } });
    },
    // 守卫突然加速冲过来
    guardRush(ctx) {
      const { rnd, W, guardCols, events } = ctx;
      const cands = guardCols.filter((c) => c > 12 && c < W - 12);
      if (!cands.length) return;
      const c = cands[Math.floor(rnd() * cands.length)];
      events.push({ type: 'guardRush', mul: 2.1, atX: c * LD.TILE, trigger: { tx: Math.max(6, c - 7), ty: 0, tw: 2, th: R } });
    },
    // 门前上方忽然落下一道墙
    doorWall(ctx) {
      const { W, surf, get, events } = ctx;
      const c = W - 10;
      const t = surf[c] == null ? null : surf[c] - 1;
      if (t != null && get(c, t) === '.' && flatSide(surf, c, 1, LAND_SIDE)) events.push({ type: 'tempBlock', ttl: 1.1, trigger: { tx: Math.max(5, W - 17), ty: 0, tw: 2, th: R }, cells: [{ x: c, y: t }, { x: c, y: t - 1 }] });
    },
  };

  /* ---------- 主生成 ----------
     o 可选覆盖项（无尽模式用）：
       seed    随机种子
       d       难度 0→1
       arch    强制原型下标
       round   第几轮（决定坑率与平台收缩）
       mobMul  危险物密度倍率（「伤害物品较多」）
       W       关卡列宽
       endless 无尽模式的层号（>0 表示这是无尽关卡）
       coop    双人模式：额外生成蓝魔出生点 / 蓝门 / 火池水池
  */
  function genLevel(id, o) {
    const opt = o || {};
    const coop = !!opt.coop;
    const rnd = LD.mulberry32(opt.seed != null ? opt.seed : id * 7919 + 104729);
    const d = opt.d != null ? opt.d : LD.clamp((id - 7) / 93, 0, 1);   // 难度 0 → 1
    const archId = opt.arch != null ? opt.arch : (((id - 7) % ARCHS.length) + ARCHS.length) % ARCHS.length;
    const a = ARCHS[archId];
    const round = opt.round != null ? opt.round : Math.floor((id - 7) / ARCHS.length);  // 第几轮回到该原型
    const shrink = Math.min(round, 4);                    // 每一轮平台更窄、坑更宽
    const mobMul = opt.mobMul == null ? 1 : Math.max(0, opt.mobMul);
    // 危险物倍率作用在原型自带的配比上，把原型特色保留下来再整体加压
    const mob = {};
    for (const k in a.mob) mob[k] = a.mob[k] * mobMul;

    const prof = {
      minH: a.h[0], maxH: a.h[1],
      pit: LD.clamp(a.pit * (1 + round * 0.05), 0, 0.6),
      gapMax: a.gapMax,
      plat: [Math.max(2, a.plat[0] - shrink), Math.max(3, a.plat[1] - shrink)],
      step: a.step, tower: a.tower + round * 0.01, pillar: a.pillar,
      trapChance: a.trapChance == null ? 0.35 + d * 0.3 : a.trapChance,
    };
    const W = opt.W != null ? Math.max(20, Math.round(opt.W)) : Math.round(26 + d * 12);   // 26 → 38 列
    const { surf, pits } = buildTerrain(rnd, W, prof, d);

    // ---- 铺地面 + 坑底酸液 ----
    const grid = [];
    for (let y = 0; y < R; y++) grid.push(new Array(W).fill('.'));
    const put = (gx, gy, ch) => { if (gx >= 0 && gx < W && gy >= 0 && gy < R) grid[gy][gx] = ch; };
    const get = (gx, gy) => (gx >= 0 && gx < W && gy >= 0 && gy < R ? grid[gy][gx] : '#');
    for (let c = 0; c < W; c++) {
      if (surf[c] == null) continue;
      for (let y = surf[c]; y < R; y++) grid[y][c] = '#';
    }
    // 只有真的是坑的格子才铺酸液（兜底填平后不会把酸液埋进实心里）
    pits.forEach((p) => { for (let k = 0; k < p.len; k++) if (surf[p.start + k] == null) put(p.start + k, R - 1, 'O'); });
    const tileAbove = (gx) => (surf[gx] == null ? null : surf[gx] - 1);

    // ---- 出生点 & 门 ----
    let spawn = { x: 1, y: prof.maxH };
    for (let c = 1; c < 6; c++) if (surf[c] != null) { spawn = { x: c, y: surf[c] - 1 }; break; }
    put(spawn.x, spawn.y, 'P');

    // ---- 双人模式：蓝魔的出生点（红魔右边 2 格以上的平地）----
    let spawn2 = null;
    if (coop) {
      spawn2 = { x: Math.min(W - 3, spawn.x + 3), y: spawn.y };
      for (let c = spawn.x + 2; c < Math.min(W - 2, spawn.x + 8); c++) {
        if (surf[c] == null) continue;
        spawn2 = { x: c, y: surf[c] - 1 };
        break;
      }
      put(spawn2.x, spawn2.y, 'p');
    }

    // ---- 门：单人一个红门；双人两个并排的门（各自进各自的门才算过关）----
    let doorCol = W - 2;
    if (coop) {
      doorCol = W - 4;
      for (let c = W - 4; c > W - 9; c--) {
        if (surf[c] != null && surf[c + 1] != null && surf[c + 1] === surf[c]) { doorCol = c; break; }
      }
    } else {
      for (let c = W - 2; c > W - 6; c--) if (surf[c] != null) { doorCol = c; break; }
    }
    const door = { x: doorCol, y: surf[doorCol] - 1 };
    const door2 = coop ? { x: doorCol + 1, y: surf[doorCol + 1] - 1 } : null;

    const flatAt = (c) => surf[c] != null && surf[c - 1] === surf[c] && surf[c + 1] === surf[c];
    const nearPit = (c, r) => pits.some((p) => c >= p.start - r && c <= p.start + p.len + r);
    const taken = new Set(), spikeCols = new Set();
    const pick = (minC, maxC, need) => {
      for (let t = 0; t < 80; t++) {
        const c = minC + Math.floor(rnd() * (maxC - minC));
        if (!flatAt(c) || taken.has(c) || nearPit(c, need == null ? 2 : need)) continue;
        if (spikeCols.has(c) || spikeCols.has(c - 1) || spikeCols.has(c + 1)) continue;
        taken.add(c);
        return c;
      }
      return -1;
    };

    /* ---- 表面危险物占位表 ----
       所有会在地面高度上「害死人」的东西都登记在这里：火池 / 水池（下面先放）、
       地刺（紧接着放）、以及运行时才弹出来的刺和地面塌陷。生成时统一查间距（HAZ_CLEAR 格）。
       生成顺序是「池子 → 地刺」：池子是双人模式的核心玩法，先占位，
       地刺再避让。反过来的话，池子常常只能见缝插针地塞进两根地刺之间，
       剩给玩家的落脚点只有 2 格（≈80px），必须用一个像素级精确的中跳才能过。 */
    const hazCols = new Set();

    // ---- 火池 / 水池（双人模式专属：红魔趟火池、蓝魔趟水池，酸池两人都溶）----
    // 四条规则，全都是被仿真逼出来的：
    //   ① 池子左右紧邻的那两格必须和池子同高（否则「刚爬上 2 格台阶，紧接着一池火」，
    //      玩家从台阶上跳下来的落点正好在池子里 —— 蓝魔在 L1 就这么连死 9 次）。
    //   ② 池子离坑沿至少留 2 格（跳过坑的落点窗口不能被池子吃掉 —— 双人 L12 的蓝魔
    //      被「池子贴着坑」卡在 30%）。
    //   ③ 池子与别的表面危险物留 HAZ_CLEAR 格，且门前留 2 格助跑。
    //   ④ 火 / 水交替出现，一关里两种元素都要有 —— 这是「冰火人」玩法的核心。
    //
    // 不再用「分档放宽」的写法：候选位置按「舒适度」打分排序后择优放（side 越大越优先、
    // 离坑越远越优先、能并排 2 格更优先），一套规则同时拿到「位置舒服」和「元素齐全」。
    if (coop) {
      const want = Math.min(5, Math.max(2, Math.round(1.4 + d * 2.6)));
      const pools = [];
      // 搜索区间：不压出生点（右留 4 格缓冲），也不压门（右留 8 格）。
      // 早先固定从第 9 列开始，白白浪费了出生点右边那一大段平地（L22 一个池子都放不出）。
      const minC = Math.max(6, spawn.x + 4, spawn2 ? spawn2.x + 4 : 0);
      const maxC = W - 8;
      const hasFire = () => pools.some((p) => p.ch === '~');
      const hasWater = () => pools.some((p) => p.ch === '_');
      // 从「步行面」反推还有哪些列是坑（兜底填平过的坑现在有地面，不算坑）
      const holes = [];
      for (let c = 0; c < W; c++) holes[c] = surf[c] == null;
      const pitGap = (c, span) => {           // 池子到最近坑沿之间还有几格空地
        let g = 99;
        for (let k = c - 1; k >= 0; k--) if (holes[k]) { g = Math.min(g, c - 1 - k); break; }
        for (let k = c + span; k < W; k++) if (holes[k]) { g = Math.min(g, k - (c + span)); break; }
        return g;
      };

      /* 削平一小段地形 —— 只在「自然地形怎么都放不下」时兜底。
         为什么需要它：原型「窄柱 / 高低台」类关卡的地形是一根根柱子，一段 5 格平地都找不到，
         整关一个池子都放不出来，而火池 / 水池正是双人模式的核心玩法，一关都不该缺。
         做法：找一段 7 格、且「每列都有地面、高差 ≤2、地面上方是空的」的窗口，
         整段抬到最高的那一层（只往上填砖，绝不往下挖坑）：
           - 不挖坑 → 不会把坑底酸液埋进实心、也不会凭空造出新的死局；
           - 高差 ≤2 → 抬升处最多形成 2 格台阶，玩家一次跳跃就能上去；
           - 窗口两侧各留 3 格平地，削完立刻就有合法的池位。
         `surf` 是这一关唯一的「步行面」事实来源，改完必须同步写回 ——
         后面的地刺 / 移动平台 / 招牌陷阱全部靠它定位。 */
      function carveWindow() {
        const side = 3, win = side * 2 + 1;          // 7 格
        let best = null;
        for (let c = minC; c + win - 1 <= maxC; c++) {
          let lo = 99, hi = -99, ok = true;
          for (let k = 0; k < win; k++) {
            const s = surf[c + k];
            if (s == null) { ok = false; break; }                    // 有坑，跳过
            if (hazCols.has(c + k)) { ok = false; break; }            // 已经放了池子
            if (get(c + k, s - 1) !== '.') { ok = false; break; }     // 地面上方有东西
            if (s < lo) lo = s; if (s > hi) hi = s;
          }
          if (!ok || hi - lo > 2) continue;
          const score = (hi - lo) * 100 + Math.abs(c - (minC + maxC) / 2);
          if (!best || score < best.score) best = { c, lo, score };
        }
        if (!best) return false;
        for (let k = 0; k < win; k++) {              // 抬到最高那一层（只填不挖）
          const gx = best.c + k;
          for (let y = best.lo; y < surf[gx]; y++) if (grid[y][gx] === '.') put(gx, y, '#');
          surf[gx] = best.lo;
        }
        if (LD.__poolLog) LD.__poolLog.push(`    carve → 抬起第 ${best.c}~${best.c + win - 1} 列到第 ${best.lo} 行`);
        return true;
      }

      // 收集所有合法池位并按舒适度排序，然后择优放。force = 指定的元素（兜底用）
      const placePools = (force) => {
        const cands = [];
        for (let c = minC; c <= maxC; c++) {
          if (surf[c] == null) continue;
          if (get(c, surf[c] - 1) !== '.') continue;
          if (c + 1 + 2 > doorCol) continue;                  // 门前留 2 格助跑
          if (!hazClear(hazCols, c, c, HAZ_CLEAR)) continue;
          let best = null;
          for (const span of [2, 1]) {
            if (span === 2 && (surf[c + 1] !== surf[c] || get(c + 1, surf[c] - 1) !== '.')) continue;
            const side = flatSide(surf, c, span, 3) ? 3 : flatSide(surf, c, span, 2) ? 2 : flatSide(surf, c, span, 1) ? 1 : 0;
            if (!side) continue;
            const gap = pitGap(c, span);
            if (gap < 2) continue;                            // 离坑太近：跳过坑必落池
            const score = side * 100 + Math.min(gap, 8) * 6 + (span === 2 ? 5 : 0) + rnd() * 4;
            if (!best || score > best.score) best = { c, span, score };
          }
          if (best) cands.push(best);
        }
        cands.sort((a, b) => b.score - a.score);
        for (const item of cands) {
          if (pools.length >= want && !force) break;    // 兜底补元素时可以超出 want
          const cEnd = item.c + item.span - 1;
          if (!hazClear(hazCols, item.c, cEnd, HAZ_CLEAR)) continue;
          const ty = surf[item.c] - 1;
          if (get(item.c, ty) !== '.') continue;
          const span = item.span === 2 && rnd() < 0.45 ? 1 : item.span;
          // 元素交替。起始元素按关号奇偶决定：有的关卡只放得下 1~2 个池子，
          // 这样至少能保证「整套 30 关里火池、水池都见过」，而不是清一色火池。
          const startFire = (opt.coopStage || id) % 2 === 1;
          const ch = force || (((pools.length % 2 === 0) === startFire) ? '~' : '_');
          for (let k = 0; k < span; k++) { put(item.c + k, ty, ch); hazCols.add(item.c + k); }
          pools.push({ c: item.c, span, ch });
        }
        if (LD.__poolLog) LD.__poolLog.push(`    place(force=${force || '-'}) 候选=[${cands.slice(0, 6).map((x) => x.c + '+' + x.span + '(s' + ((x.score / 100) | 0) + ')').join(' ')}] → 累计 ${pools.length} 个，火=${hasFire()} 水=${hasWater()}`);
      };

      placePools();
      // 兜底：缺哪个元素就为它单独找一个位置，实在没有就削平一段地形再造出位置来。
      for (let guard = 0; guard < 3 && (!hasFire() || !hasWater()); guard++) {
        const missing = !hasFire() ? '~' : '_';
        placePools(missing);
        if (hasFire() && hasWater()) break;
        if (!carveWindow()) break;
        placePools(missing);
      }
    }

    // ---- 地刺候选位：safe = 左右各 2 格齐平 + 离坑 ≥2；loose = 左右各 1 格齐平（坑多的关卡靠它兜底）----
    const safe = [], loose = [];
    for (let c = 8; c <= W - 9; c++) {
      if (surf[c] == null) continue;
      let flat2 = true;
      for (let k = -2; k <= 2 && flat2; k++) if (surf[c + k] !== surf[c]) flat2 = false;
      const flat1 = surf[c - 1] === surf[c] && surf[c + 1] === surf[c];
      if ((flat2 || flat1) && !nearPit(c, 1)) loose.push(c);
      if (flat2 && c <= W - 12 && !nearPit(c, 2)) safe.push(c);
    }
    const wantSpikes = Math.round((1 + d * 6) * mob.spike);
    const spikePool = safe.length ? safe : loose;
    let madeSpikes = 0, lastSpike = -99;
    for (let t = 0; t < 300 && madeSpikes < wantSpikes && spikePool.length; t++) {
      const c = spikePool[Math.floor(rnd() * spikePool.length)];
      if (c - lastSpike < 6 || spikeCols.has(c) || spikeCols.has(c + 1)) continue;
      // 避让池子（单人模式 hazCols 一直是空的，所以这一句对单人关卡是空操作）
      if (!hazClear(hazCols, c, c + 1, HAZ_CLEAR)) continue;
      // 并排 2 格放不下就退成 1 格；但两侧的落脚平地不能少于 LAND_SIDE 格。
      // 这一条对单人关卡同样生效 —— 窄台上的并排地刺本来就不该出现。
      const canWide = surf[c + 1] === surf[c] && rnd() < 0.3 + d * 0.25;
      let span = canWide ? 2 : 1;
      if (!flatSide(surf, c, span, LAND_SIDE)) span = 1;
      if (!flatSide(surf, c, span, LAND_SIDE)) continue;
      lastSpike = c; madeSpikes++;
      const ty = surf[c] - 1;
      put(c, ty, '^'); spikeCols.add(c); hazCols.add(c);
      if (span === 2) { put(c + 1, ty, '^'); spikeCols.add(c + 1); hazCols.add(c + 1); }
    }

    // ---- 移动平台（坑上方给一块，保证有退路；「移动的地板」类关卡 2 格坑上也放）----
    // 两块平台的摆动范围如果重叠，它们会互相把站在上面的人挤下去（实测：人会被"换乘"
    // 到另一块平台、然后从边缘滑落掉进坑里）。所以这里做一个占位检查。
    const moverPits = [];
    const moverSpots = [];
    const addMover = (c, row, kind) => {
      if (get(c, row) !== '.') return false;
      for (const s of moverSpots) {
        // 只挡「基本放在同一处」的情况，避免两块平台在画面上完全叠在一起；
        // 平台本身是单向的，所以即使摆动范围有交叠也不会把人挤下去。
        if (Math.abs(s.row - row) <= 1 && Math.abs(s.c - c) <= 4) return false;
      }
      put(c, row, kind);
      moverSpots.push({ c, row });
      return true;
    };
    const minPitForMover = mob.mover > 1 ? 2 : 3;
    pits.forEach((p) => {
      if (p.len >= minPitForMover) {
        const row = Math.max(2, Math.min(p.surfL, p.surfR == null ? p.surfL : p.surfR) - 1);
        const c = Math.min(p.start + 1, W - 3);
        if (addMover(c, row, rnd() < 0.65 ? 'H' : 'V')) moverPits.push(p);
      }
    });
    if (mob.mover > 1) {                                 // 「移动的地板」类原型：平地也放
      const n = Math.min(6, Math.round((1 + d * 4) * (mob.mover - 1)));
      let made = 0;
      for (let t = 0; t < n * 8 && made < n; t++) {
        const c = pick(10, W - 10, 1);
        if (c < 0) break;
        if (addMover(c, surf[c] - 3, 'H')) made++;
      }
    }

    // ---- 易碎砖 / 陷阱地板（架在坑上当桥）----
    const bridges = [];
    if (mob.crumble > 0.3) {
      pits.forEach((p) => {
        if (p.len > 3 || p.len < 2) return;
        const row = Math.min(p.surfL, p.surfR == null ? p.surfL : p.surfR);
        if (row > R - 2) return;
        const useTrap = rnd() < prof.trapChance;
        const cells = [];
        for (let k = 0; k < p.len; k++) { put(p.start + k, row, useTrap ? 'T' : 'X'); cells.push({ x: p.start + k, y: row }); }
        bridges.push({ cells, start: p.start });
      });
    }

    // ---- 假方块（飘在坑上方骗你踩）----
    const nFake = Math.min(10, Math.round((1 + d * 3) * mob.fake));
    for (let i = 0; i < nFake && pits.length; i++) {
      const p = pits[Math.floor(rnd() * pits.length)];
      const c = p.start + Math.floor(rnd() * p.len);
      const row = 7 + Math.floor(rnd() * 3);
      if (get(c, row) === '.') put(c, row, 'B');
    }

    // ---- 落锤 ----
    const nCrusher = Math.min(8, Math.round(Math.floor(d * 3 + 0.6) * mob.crusher));
    for (let i = 0; i < nCrusher; i++) {
      const c = pick(13, W - 10, 1);
      if (c < 0) continue;
      const top = surf[c] - 5;
      if (top < 2 || get(c, top) !== '.') continue;
      put(c, top, 'C');
    }

    // ---- 巡逻守卫 / 飞行怪 / 锯轮 ----
    const guardCols = [];
    const nGuard = Math.min(10, Math.round((1 + d * 3) * mob.guard));
    for (let i = 0; i < nGuard; i++) {
      const c = pick(13, W - 10, 2);
      if (c < 0) continue;
      const t = tileAbove(c);
      if (t != null && get(c, t) === '.') { put(c, t, 'G'); guardCols.push(c); }
    }
    const nFlyer = Math.min(9, Math.round(Math.floor(d * 3 + 0.5) * mob.flyer));
    for (let i = 0; i < nFlyer && W > 26; i++) {
      const c = 14 + Math.floor(rnd() * (W - 24));
      const row = 7 + Math.floor(rnd() * 3);
      if (get(c, row) === '.') put(c, row, 'F');
    }
    const nSaw = Math.min(8, Math.round((1 + d * 2) * mob.saw));
    for (let i = 0; i < nSaw; i++) {
      const c = pick(14, W - 11, 2);
      if (c < 0) continue;
      const t = tileAbove(c);
      if (t != null && get(c, t) === '.') put(c, t, 'W');
    }

    /* ---- 新障碍：激光 / 蒸汽 / 摆锤 / 浮游雷 / 传送带 ----
       摆放规则全部沿用老障碍的安全口径：
         · 激光 / 蒸汽：贴地放在「身体那一格」（和守卫同行），要求左右各有
           LAND_SIDE 格同高落脚地 —— 玩家必须能跳上去、也能跳过去。
         · 摆锤：锚点挂在身体上方两格（摆下来刚好到胸口），头顶必须干净。
         · 浮游雷：悬在 6~8 行的空档里，靠近了会慢慢漂过来。
         · 传送带：直接替换地面格（不改变地形轮廓 → 不影响可达性），
           只找 2~3 格长的平地段，且表面上方不能有刺。
       新障碍排在老障碍后面，pick() 的好位置常被抢光 —— 所以带一个
       「宽松兜底」：直接在平地段里找空格，不和别的机关挤同一批候选。 */
    const pickLoose = (minC, maxC) => {
      for (let t = 0; t < 60; t++) {
        const c = minC + Math.floor(rnd() * Math.max(1, maxC - minC));
        if (surf[c] == null || !flatAt(c) || taken.has(c)) continue;
        taken.add(c);
        return c;
      }
      return -1;
    };
    const nLaser = Math.min(8, Math.round((1 + d * 4) * mob.laser));
    for (let i = 0; i < nLaser; i++) {
      let c = pick(13, W - 10, 2);
      if (c < 0) c = pickLoose(13, W - 10);
      if (c < 0) continue;
      const t = tileAbove(c);
      if (t != null && get(c, t) === '.') put(c, t, 'L');
    }
    const nGeyser = Math.min(8, Math.round((1 + d * 4) * mob.geyser));
    for (let i = 0; i < nGeyser; i++) {
      let c = pick(13, W - 10, 2);
      if (c < 0) c = pickLoose(13, W - 10);
      if (c < 0) continue;
      const t = tileAbove(c);
      // 蒸汽要往上喷，头顶一格必须空着（喷 4 格会被天花板截断，见 world.geysers）
      if (t != null && get(c, t) === '.' && get(c, t - 1) === '.') put(c, t, 'S');
    }
    const nPend = Math.min(6, Math.round((1 + d * 3) * mob.pendulum));
    for (let i = 0; i < nPend; i++) {
      let c = pick(14, W - 11, 2);
      if (c < 0) c = pickLoose(14, W - 11);
      if (c < 0) continue;
      const t = tileAbove(c);
      if (t == null) continue;
      const pr = t - 2;                                   // 锚点：身体上方两行
      if (pr > 1 && get(c, pr) === '.') put(c, pr, 'N');
    }
    const nMine = Math.min(8, Math.round((1 + d * 3) * mob.mine));
    for (let i = 0; i < nMine && W > 26; i++) {
      const c = 13 + Math.floor(rnd() * Math.max(1, W - 24));
      const row = 6 + Math.floor(rnd() * 3);
      if (c < W && get(c, row) === '.') put(c, row, 'M');
    }
    const nBelt = Math.min(5, Math.round((0.5 + d * 2.5) * mob.belt));
    let beltMade = 0;
    for (let i = 0; i < nBelt * 8 && beltMade < nBelt; i++) {
      const c = 10 + Math.floor(rnd() * Math.max(1, W - 20));
      if (surf[c] == null) continue;
      const s = surf[c];
      let len = 0;
      while (c + len < W - 6 && surf[c + len] === s && len < 3) len++;
      if (len < 2) continue;                              // 至少 2 格才值得铺
      if (get(c, s - 1) !== '.' || get(c + 1, s - 1) !== '.') continue;   // 表面上方不能有刺 / 机关
      const ch = rnd() < 0.5 ? 'A' : 'Z';
      const span = 2 + (rnd() < 0.4 && len >= 3 ? 1 : 0);
      for (let k = 0; k < span; k++) put(c + k, s, ch);
      beltMade++;
    }

    // ---- 招牌陷阱 ----
    const ctx = { id, d, rnd, W, surf, pits, grid, get, put, tileAbove, spikeCols, hazCols, door, events: [], safe, loose, bridges, guardCols, moverPits };
    const keys = a.events.slice();
    // 难度越高，招牌陷阱越多（最多全部启用）
    const use = keys.filter((k, i) => i === 0 || d > 0.1 + i * 0.08);
    use.forEach((k) => EVENT[k] && EVENT[k](ctx));

    return {
      id, name: a.name, hint: a.hint, cols: W,
      nameEn: (ARCH_EN[a.name] || [])[0] || a.name,
      hintEn: (ARCH_EN[a.name] || [])[1] || a.hint,
      grid: grid.map((r) => r.join('')), events: ctx.events, spawn, door,
      spawn2, door2, coop: opt.coop ? (opt.coopStage || 1) : 0,
      tint: a.tint, arch: archId, endless: opt.endless || 0,
    };
  }

  /* ---------- 无尽模式：一张无限长、一直往右长出去的地图 ----------
     以前的无尽是「进一个门换一层」，每层把整张地图重建一次；现在改成一整张连续的图：
     玩家从 x = 0 出发一路向右，身后的地形不重置，前方按需追加新段。
     每段 24 列（正好一屏），段的最左和最右各留 3 格完整地面 ——
     所以接缝处永远不会冒出一个坑或者一道台阶。
     genEndlessChunk(p) 是纯函数：段号固定 → 地形固定（同一段每次生成完全一样）。
  */
  const ES_CHUNK = 24, ES_SAFE = 3;
  const ES_TINT = ['#07080f', '#1d0d2b'];
  /* （原来这里有一个 shuffledArr：障碍位是「随机顺序 + 对称距离判定」时用的。
       改成从左到右定序贪心之后它就没用了 —— 留着只会让人以为摆放顺序是随机的。） */
  function genEndlessChunk(p) {
    const ROWS = LD.ROWS, FLOOR = ROWS - 2, W = ES_CHUNK, SAFE = ES_SAFE;
    const idx = Math.max(0, Math.floor(p) || 0);
    const rnd = LD.mulberry32((((idx + 7) * 2654435761) >>> 0) + 1013904223);
    const d = LD.clamp(0.25 + idx * 0.04, 0, 1);          // 越跑越难（起步更密、爬升更快）
    const G = [];
    for (let r = 0; r < ROWS; r++) G.push(new Array(W).fill('.'));

    /* ---- 1) 地形：由「平台 + 台阶」拼成的地面 ----
       【为什么推倒重写成平台式】
       原来是一列一列抛硬币的随机游走（每列 16% 降 / 14% 升）。实测高度平均
       4~5 列就变一次，于是：
         · 24 列里几乎找不到「连续 6 列同高」的平地
         · 而危险物和矮墙的摆放都要求「左边 3 列平地 + 右边 2 列平地」
         · 最后平均每段（24 列）只能塞进 1.3 个障碍 —— 这正是「无尽模式障碍太少」
       现在改成先生成一整段平台（6~12 列同高），再决定要不要接一个 1 格台阶。
       平台够长，障碍才有地方放；台阶成了看得懂的「地形」，而不是锯齿。
       安全底线一条没动：台阶只升/降 1 格、最低只到 FLOOR-2（2 格 = 80px，
       满跳约 3.3 格，余量充足）；坑一律挖在平台内部，且坑前 3 列、坑后 1~2 列
       必须是同高平地 —— 起跳和落脚的余量都还在。 */
    const surf = new Array(W).fill(FLOOR);
    let h = FLOOR;
    let c = SAFE;
    let pits = 0;
    while (c < W - SAFE) {
      const room = W - SAFE - c;
      /* 平台长度：前期 5~8 列（平台短、台阶多，地形起伏看得见，是「简单」的样子），
         后期 9~15 列（平台长，才有地方密排火力）。
         这不是为了好看 —— 每段只有 24 列、能被障碍使用的只有中间 18 列，
         而每个平台的头尾各 2 列必须留给起跳/落脚，所以：
           可用候选 = 18 − 3 × 平台数 − 坑的避让区
         平台越短 → 平台越多 → 可用位越少。前期靠「多台阶」出难度，
         后期靠「长平台 + 密火力」出难度，两头的候选位数量才对得上。 */
      /* 平台长度：前期 9~13 列 / 后期 13~17 列。
         【为什么不能更短】障碍位现在要求「离台阶边 ≥3 列」（见下面 ledgeDist），
         一个平台的头 3 列和尾 2 列都不能用，所以可用窗口只有 L−5 列：
           L=7  → 2 列 →  最多 1 个障碍
           L=13 → 8 列 →  最多 2~3 个障碍（间距 4）
         也就是说**平台越长，单段能放的障碍越多**。之前早期是 5~8 列，
         实测有一半平台是空的，密度怎么调都上不去 —— 瓶颈在这里，不在间距。 */
      const runLen = Math.min(room, (d > 0.5 ? 13 : 9) + Math.floor(rnd() * 5));
      for (let k = 0; k < runLen; k++) surf[c + k] = h;

      /* 平台中间掏一个坑。放到「平台内部」之后，坑的密度才上得来 ——
         原来只有恰好站在 FLOOR 高的平台末尾才会挖坑，位置太苛刻，实测平均
         每段只有 0.3 个坑。
         坑是「每段只能有 24 列」这个死约束下唯一能随难度持续变多的障碍：
         它不跟地刺抢地面（坑上本来就没地面），所以挖得越多、整段越难，
         而地面障碍的密度不会因此被挤掉太多（只让开坑两端的避让区）。
         上限：前期 1 个、后期 2 个。一个坑要占掉「2~3 格坑 + 前后 6 列避让区」共 8~9 列，
         在 24 列的段里是三分之一 —— 前期放 2 个坑，障碍位就只剩 1 个（实测 cand 掉到 1），
         整体反而变空。所以坑的配额跟难度走：后期靠坑变难，前期先把障碍位留给地面障碍。 */
      const maxPits = d > 0.35 ? 2 : 1;
      if (h === FLOOR && runLen >= 7 && pits < maxPits && rnd() < 0.28 + d * 0.62) {
        const wide = (runLen >= 8 && rnd() < 0.25 + d * 0.45) ? 3 : 2;   // 2~3 格
        const after = 2;                                     // 坑后固定留 2 列地面
        const span = runLen - 3 - after - wide;              // 起始位置的可选范围
        if (span >= 0) {
          const at = c + 3 + (span > 0 ? Math.floor(rnd() * (span + 1)) : 0);
          for (let k = 0; k < wide; k++) surf[at + k] = null;
          pits++;
        }
      }
      c += runLen;
      const step = rnd();
      if (step < 0.30) h = Math.max(FLOOR - 2, h - 1);
      else if (step < 0.60) h = Math.min(FLOOR, h + 1);
    }
    for (let c = 0; c < W; c++) {
      const s = surf[c];
      if (s == null) continue;                            // 坑：整列留空，掉下去就死
      for (let r = s; r < ROWS; r++) G[r][c] = '#';
    }

    /* 危险物前面必须留够助跑距离：flatL = 左边连续同高的格数。
       尤其是「上台阶」后面 —— 小人跳完台阶才落地，只剩一两格平地就要再跳一次，
       那不是难度，是要求帧级精度。 */
    const flatL = new Array(W).fill(0), flatR = new Array(W).fill(0);
    for (let c = 1; c < W; c++)
      flatL[c] = (surf[c] != null && surf[c] === surf[c - 1]) ? flatL[c - 1] + 1 : 0;
    for (let c = W - 2; c >= 0; c--)
      flatR[c] = (surf[c] != null && surf[c] === surf[c + 1]) ? flatR[c + 1] + 1 : 0;
    /* 离「高度变化处」（台阶边、坑边）有多少格。
       【为什么单列这一项】flatL 只说明「左边连续同高」，但说不清那一段平地是
       「玩家跑过来的平地」还是「刚跳完台阶的落点」。实测简易机器人正是死在
       「跳上 1 格台阶 → 落点正好压在台阶后第 3 格的地刺上」：
       起跳时离地刺还有 3 格（40px/格 = 120px），而它的前瞻只有 56px —— 看不见，
       腾空中又不能改主意（跳跃只在落地帧触发）。对真人玩家也一样：
       跳上台阶的落点如果就是地刺，那只能靠背板。
       所以要求障碍离台阶/坑边至少 3 格：玩家跳完台阶、落地、站稳，再决定下一跳。 */
    const ledgeDist = new Array(W).fill(99);
    for (let c = 1; c < W; c++) {
      const prev = surf[c - 1];
      if (surf[c] == null || prev == null) ledgeDist[c] = 0;      // 坑边
      /* 上台阶：必须起跳 → 之后 3 列都是「落点」，不能放障碍
         下台阶：走下去自然掉落，约 1 列就落地 → 只需让 2 列 */
      else if (surf[c] < prev) ledgeDist[c] = 0;
      else if (surf[c] > prev) ledgeDist[c] = 1;
      else ledgeDist[c] = ledgeDist[c - 1] + 1;
    }
    /* 坑附近让开：坑前 2 格、坑后 3 格。
       坑后要留得更宽 —— 「跨过坑的落点」大约就在坑后 2~3 格，
       那里再放个地刺就是「跳过去正好踩上」，纯靠运气。
       坑前只让 2 格：起跳点本来就在坑边，前面 2 格内不放东西就够了。
       （按「坑的两端」算区间，而不是给每一列空列各标一遍 ——
         后者会让每个坑吃掉 7 列候选位，在 24 列的段里是一大块，
         障碍密度上不去有一半是它。） */
    const nearPit = new Array(W).fill(false);
    for (let c = 0; c < W; c++) {
      if (surf[c] != null) continue;
      let e = c;
      while (e + 1 < W && surf[e + 1] == null) e++;
      for (let k = c - 2; k <= e + 3; k++) if (k >= 0 && k < W) nearPit[k] = true;
      c = e;
    }
    /* ---- 2) 障碍：地刺 / 落锤 / 矮墙 / 易碎柱 —— 统一摆放 ----
       【为什么合成一轮】
       原来地刺、落锤、矮墙各跑一轮，每轮都要求「前后留平地」，
       于是三轮在抢同一批列：地刺先把平地占满，矮墙一个都放不下去
       （实测矮墙平均 0.1 个/段）。但这三类本就是**同一种资源**，
       所以这里合成一轮：先按统一间距选出「障碍位」，再按难度决定每个位放什么。
       密度从此只由 pitch 一个参数控制，看得见、调得动。
       （改之前基线：24 列平均只有 1.3 个障碍。） */
    const cand = [];
    /* 【为什么从 SAFE+1 开始、到 W-SAFE-2 结束】
       段与段是拼起来的：上一段的最后 3 列和这一段的头 3 列都是干净地面。
       如果障碍就压在第 3 列上，玩家刚从上一段全速跑进来就得立刻起跳 ——
       多让开 1 列（接缝两侧各 4 列干净）之后，进段后还有余量。
       右边同理：段尾那几列要留给「跨向下一个段」的落点。 */
    for (let c = SAFE + 1; c < W - SAFE - 1; c++) {
      if (surf[c] == null || nearPit[c]) continue;
      /* 左边 ≥2 列同高：够起跑加速、也够留出起跳时机。
         右边 ≥2 列同高：有地方落脚。
         （原来是左 3 右 2 —— 左 3 那条其实过度保守：起跳只需要「站在地上」，
           加速在 2~3 帧内就满了，真正的物理下限是「不能在半空中被迫再跳一次」。） */
      if (flatL[c] < 2 || flatR[c] < 2) continue;
      if (ledgeDist[c] < 2) continue;                          // 不在台阶/坑边的落点上放障碍
      if (G[surf[c] - 1][c] !== '.') continue;
      cand.push(c);
    }
    /* 障碍之间的最小列距（硬下限）。
       注意：真正决定密度的是下面「边定类型边定间距」那一步 ——
       曾经这里先按 pitch 预选出一批「障碍位」，再按类型做避让，
       结果预选出的 5~6 个位有一半会被避让规则砍掉（实测实放只剩 2.5 个），
       等于白挑。现在合成一步：走到一个候选列，就当场决定放什么、并算出
       下一个障碍最早能在哪一列 —— 不再浪费。 */
    const pitch = 2;
    const wantTotal = 7 + Math.round(d * 8);                   // 7~15 个/段（实际由候选位和避让距离决定）
    const crusherAt = new Set(), wallAt = new Set();
    const laserAt = new Set(), geyserAt = new Set(), pendAt = new Set(), mineAt = new Set(), beltAt = new Set();
    let leftC = Math.max(0, Math.round(d * 1.5 - 0.3));        // 落锤配额（压低：落锤占头顶，太多会让地面显得空）
    /* 矮墙配额涨幅刻意比落锤慢：矮墙是「实心」，多了会把段面切碎，
       而且它挤占的是地刺的位置 —— 后期真正该变多的是火力密度（落锤）+ 更宽的坑。 */
    let leftW = Math.round(d * 1.5);                           // 矮墙配额：0~2
    /* 新障碍配额：随难度线性增加。激光 / 蒸汽是周期致命的，间距要求和矮墙一致；
       浮游雷是追踪型，给得最克制；传送带每段最多 1 处（它是地形改造，多了腻）。 */
    let leftL = Math.round(d * 2);          // 激光 0~2
    let leftG = Math.round(d * 2);          // 蒸汽 0~2
    let leftN = Math.round(d * 1.2);        // 摆锤 0~1
    let leftM = Math.round(d * 1.5);        // 浮游雷 0~2
    let leftB = d > 0.35 ? 1 : 0;           // 传送带 0~1
    let placed = 0;
    /* 【为什么按「列号从小到大」定序摆放】
       之前是「随机顺序 + 对每个已放置的障碍做对称距离判定」：
       在随机顺序下，一个摆在中间的障碍会把它的左右两侧一起封掉 ——
       左边刚放下就被右边的判定挤掉，实测平均 9.3 个候选位只实放 2.5 个，
       三分之二白白浪费。改成从左到右定序贪心：每放下一个障碍，只需要记住
       「它要求后面至少让开多少列」，一个候选位被跳过就能立刻拿下一个补上，
       在同样的安全间距下拿到最密的排布。 */
    const sortedCand = cand.slice().sort((a, b) => a - b);
    let lastC = -99, need = 0;
    for (const c of sortedCand) {
      if (placed >= wantTotal) break;
      if (c - lastC < Math.max(pitch, need)) continue;         // 上一个是「谁」决定这一段要多宽
      const roomy = flatL[c] >= 3 && flatR[c] >= 3;
      /* 不同种类对「后面能多近再放一个」的要求不一样（都是实测出来的：
         间距给 3 时简易机器人每次都死在「跳过障碍后的落点正好压在下一个障碍上」）：
         · 落锤 C：躲它必须**不跳**，所以后面 5 列内不放别的东西 ——
           否则「为了躲前面的刺跳一下」正好把头顶送进落锤底下
         · 两格高墙：跳过去要用掉一整条弧线，后面 5 列
         · 一格矮墙 / 地刺：一次跳跃的弧线约 3.7 格，后面 4 列 */
      if (leftC > 0 && roomy && surf[c] - 5 > 1 && rnd() < 0.5) {
        G[surf[c] - 5][c] = 'C';                               // 挂在「满跳头顶再高一格」
        crusherAt.add(c); leftC--; lastC = c; need = 3; placed++;
        continue;
      }
      /* ---- 新障碍（与落锤 / 矮墙共用同一个「障碍位」）---- */
      if (leftL > 0 && roomy && rnd() < 0.4) {
        G[surf[c] - 1][c] = 'L';                               // 激光发射器（贴地，光束朝右）
        laserAt.add(c); leftL--; lastC = c; need = 4; placed++;
        continue;
      }
      if (leftG > 0 && roomy && surf[c] - 4 > 1 && G[surf[c] - 2][c] === '.' && rnd() < 0.4) {
        G[surf[c] - 1][c] = 'S';                               // 蒸汽喷发口（头顶要留够汽柱空间）
        geyserAt.add(c); leftG--; lastC = c; need = 4; placed++;
        continue;
      }
      if (leftN > 0 && surf[c] - 4 > 2 && G[surf[c] - 4][c] === '.' && rnd() < 0.45) {
        G[surf[c] - 4][c] = 'N';                               // 摆锤锚点（身体上方三格）
        pendAt.add(c); leftN--; lastC = c; need = 4; placed++;
        continue;
      }
      if (leftM > 0 && surf[c] - 4 > 1 && G[surf[c] - 4][c] === '.' && rnd() < 0.4) {
        G[surf[c] - 4][c] = 'M';                               // 浮游雷（悬在高处慢慢漂）
        mineAt.add(c); leftM--; lastC = c; need = 3; placed++;
        continue;
      }
      if (leftB > 0 && G[surf[c]][c] === '#' && G[surf[c]][c + 1] === '#' && G[surf[c] - 1][c] === '.' && rnd() < 0.4) {
        const bc = rnd() < 0.5 ? 'A' : 'Z';                    // 传送带：原地替换两格地面
        G[surf[c]][c] = bc; G[surf[c]][c + 1] = bc;
        beltAt.add(c); leftB--; lastC = c + 1; need = 2; placed++;
        continue;
      }
      if (leftW > 0 && rnd() < 0.5) {
        const tall = d > 0.45 && rnd() < 0.35;
        G[surf[c] - 1][c] = (tall || (d > 0.55 && rnd() < 0.35)) ? 'X' : '#';
        /* 两格高的柱子只在后半程出现，而且一定是易碎砖 ——
           纯实心的两格柱在「满跳刚好够」的高度上会把节奏卡死；
           易碎砖踩上去就塌，过不去也能砸出一条路。 */
        if (tall) G[surf[c] - 2][c] = 'X';
        wallAt.add(c); leftW--; lastC = c; need = tall ? 3 : 2; placed++;
        continue;
      }
      G[surf[c] - 1][c] = '^';                                 // 其余一律地刺：看得见、跳得过
      lastC = c; need = 2; placed++;
    }

    /* ---- 地面矮墙 / 易碎柱：给「一条道跑到黑」加真正的物理障碍 ----
       （已并入上面的统一摆放：矮墙和地刺共用「障碍位」，
         否则两者会互相把对方的平地名额吃掉 —— 实测分开跑时矮墙只有 0.1 个/段。） */

    return {
      cols: W, grid: G.map((r) => r.join('')), surf: surf.slice(),
      noDoor: true,            // 无尽模式没有门：一路往右跑，死亡才结算
      tint: ES_TINT,
      chunk: idx,
      /* 生成过程的可观测项：只给 tools/density.js 这类探针用，运行时没人读。
         没有它就只能靠「感觉这段障碍变多了」来判断调参有没有生效。 */
      stat: {
        d: Math.round(d * 100) / 100,
        cand: cand.length, placed,
        crushers: crusherAt.size, walls: wallAt.size,
        lasers: laserAt.size, geysers: geyserAt.size,
        pendulums: pendAt.size, mines: mineAt.size, belts: beltAt.size,
      },
    };
  }

  /* ---------- 双人模式：30 关专用关卡 ----------
     现在的双人关是「单屏房间」（room.js）而不是横向卷轴：
     固定 24×14 格 = 一屏、往上叠高台、火池 + 水池，两个人在同一屏里配合。
     这里只保留一个转发入口（LD.genRoom 在 room.js 里定义，脚本顺序在 gen.js 之后加载，
     所以运行时调用是可以的；gen.js 只负责别的地方引用 LD.genCoop 时不报错）。
  */
  const COOP_COUNT = 30;
  LD.COOP_COUNT = COOP_COUNT;
  function genCoop(i) {
    const n = Math.max(1, Math.min(COOP_COUNT, Math.floor(i) || 1));
    if (LD.genRoom) return LD.genRoom(n);
    return fallbackRoom(n);                                 // room.js 没加载时的兜底
  }

  function fallbackRoom(n) {
    const COLS = 24, ROWS = LD.ROWS, FLOOR = ROWS - 2;
    const G = [];
    for (let r = 0; r < ROWS; r++) G.push(new Array(COLS).fill('.'));
    for (let c = 0; c < COLS; c++) { G[FLOOR][c] = '#'; G[FLOOR + 1][c] = '#'; }
    for (let c = 2; c <= 13; c++) G[FLOOR - 2][c] = '#';
    for (let c = 10; c <= 21; c++) G[FLOOR - 4][c] = '#';
    G[FLOOR - 1][5] = '~'; G[FLOOR - 3][16] = '_';
    G[FLOOR - 1][2] = 'P'; G[FLOOR - 1][21] = 'p';
    G[FLOOR - 5][4] = 'D'; G[FLOOR - 5][20] = 'd';
    return {
      id: n, name: '冰火之间', nameEn: 'Between Fire and Water',
      hint: '火池只溶蓝魔，水池只溶红魔。', hintEn: 'Each pool melts only the other one.',
      cols: COLS, rows: ROWS, grid: G.map((r) => r.join('')),
      coop: n, room: true, timeLimit: Math.round(45 + n * 1.1), scoreBase: 100 + n * 12,
      tint: ['#120a14', '#2a0f1c'],
    };
  }

  LD.genLevel = genLevel;
  LD.genEndlessChunk = genEndlessChunk;
  LD.ES_CHUNK = ES_CHUNK;
  LD.genCoop = genCoop;
  LD.ARCHS = ARCHS;
})();
