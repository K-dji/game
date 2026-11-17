/* gunroom.js — 枪战模式地图生成器

   三种子模式共用这套地形语言：
     枪战关卡（150 关，越来越难，人机越来越厉害）
     枪战无尽（同样是越来越难，但没有终点，一路往右）
     双人对枪（回合制，一张对称的竞技场）

   用户需求原文里与地形 / 道具相关的部分：
     · 游戏中加入回血装置及障碍木箱及高台
     · 木箱可打破，有机会得到双倍甚至三倍射速及弹药

   瓦片字符（在 world.js 原有字符之外新增，只出现在枪战模式）：
     K  障碍木箱（可被子弹打破 → 有机会掉增益）
     +  回血装置（站上去持续回血）
     其余沿用：# 实心  = 薄平台  ^ 地刺  P 出生点  p 第二出生点

   地图结构（重要，决定「怎么打」）：
     枪战地图是「一屏宽、往上叠高台」的竞技场，而不是横向卷轴 ——
     因为需求明确「小人枪械没有自动瞄准、统一平射，主要看玩家跳跃攻打」：
     平射意味着高度差就是掩体，只有往上叠出台阶、两个人来回跳，对枪才成立。
     所以每一关固定 COLS = 24 列（960px = 画布宽），camX 恒为 0，谁都看得见谁。

   难度曲线（关卡号 n，1~150）：
     n=1~  人机少而菜、地形开阔、木箱多
     n=40 人机开始成群、开始利用高台
     n=80 人机会有火箭筒级别的火力（配合武器解锁）
     n=150 人机满配、高台纵横、掩体极少
*/
(function () {
  const COLS = 24;                    // 24 × 40 = 960 = 画布宽 → 一屏
  const ROWS = LD.ROWS;               // 14 行
  const FLOOR = ROWS - 2;             // 12：地面顶行
  const S = '#';
  const SPAWN_L = 'P', SPAWN_R = 'p';
  const CRATE = 'K', HEALTH = '+';
  const MAX_TRIES = 60;
  const NAMES = [
    ['集装箱码头', 'Container Dock'],
    ['天台', 'Rooftop'],
    ['废墟商场', 'Ruined Mall'],
    ['地下车库', 'Underground Lot'],
    ['仓库走廊', 'Warehouse Hall'],
    ['天桥', 'Skybridge'],
    ['双子塔', 'Twin Towers'],
    ['货梯间', 'Freight Lift'],
    ['台阶广场', 'Stepped Plaza'],
    ['废弃工厂', 'Abandoned Plant'],
  ];
  const TINTS = [
    ['#0b1016', '#1a2130'],
    ['#100c14', '#241a2e'],
    ['#0a1214', '#12262a'],
    ['#14100a', '#2c2412'],
    ['#0d0f1a', '#1c2038'],
  ];

  const range = (a, b) => { const o = []; for (let i = a; i <= b; i++) o.push(i); return o; };
  function shuffled(arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  const solid = (ch) => ch === S || ch === '=' || ch === 'X' || ch === 'T' || ch === CRATE;
  /* 木箱虽然可以被打碎，但「可达性」必须在「木箱还在」的最坏情况下成立，
     否则生成器会误以为路是通的，实际上一开局就被木箱堵死。 */
  /* 【重要】回血装置 `+` 不算障碍 —— world.js 的 isSolid() 对它返回 false，
     人在它上面走、子弹从它上面过，它只是「踩上去回血」的地面贴片。
     这里曾经把 HEALTH 也算进 blocked()，导致生成器比真实游戏更保守：
     一个回血站放在地面走廊上，就会被判成「玩家走不到对面」而整关作废/重掷。
     生成器的通行模型必须和运行时一致，否则会凭空造出一堆假故障。 */
  const blocked = (ch) => solid(ch);
  /* 出生点字符 P / p 在 World 解析后就是空地，可达性判定里也要当成空地。
     回血装置 `+` 同理 —— 它不挡路（见 blocked() 的注释），人可以直接走上去。 */
  const isFloorChar = (ch) => ch === '.' || ch === SPAWN_L || ch === SPAWN_R || ch === HEALTH;

  /* ---------- 站立点可达性（与 room.js 同一套保守几何模型） ----------
     只用来保证「出生点之间互相能走过去 / 跳上去」，不保证战斗平衡。
     抛射物时代「可达」不等于「好打」，但至少要能碰到对面。 */
  function canStand(G, c, r) {
    if (c < 0 || c >= COLS || r < 1 || r >= ROWS) return false;
    if (!solid(G[r][c])) return false;
    return isFloorChar(G[r - 1][c]);
  }
  const passable = (ch) => !blocked(ch) && ch !== '^';
  function clearUp(G, c, r, r2) {
    for (let k = r2; k <= r - 1; k++) if (!passable(G[k][c])) return false;
    return true;
  }
  function clearSide(G, r, c, c2) {
    const a = Math.min(c, c2), b = Math.max(c, c2);
    for (let x = a; x <= b; x++) if (!passable(G[r][x])) return false;
    return true;
  }
  function jumpOK(G, c, r, c2, r2) {
    const up = r - r2;
    if (up < 1 || up > 2) return false;
    const dx = Math.abs(c2 - c);
    if (dx < 1 || dx > (up === 1 ? 3 : 2)) return false;
    if (!clearUp(G, c, r, r2)) return false;
    if (!clearSide(G, r2 - 1, c, c2)) return false;
    for (let x = Math.min(c, c2); x <= Math.max(c, c2); x++) {
      if (x === c2) continue;
      if (!passable(G[r2][x])) return false;
    }
    return true;
  }
  /* 「原地起跳翻过一个 1 格高的障碍」—— 这是真实玩法里最常见的动作：
     站在地面上，前面一个木箱 / 矮台，直接跳过去落在同一高度的另一侧。
     原来的模型只认「跳到更高/更矮的台阶」（up 1~2），完全没建模这一种，
     于是生成器会把「一条平地上摆了一个木箱」判成「路被堵死」，
     明明玩家一跳就过去了，却整关作废重掷（第 2 / 18 / 24 关的假故障）。 */
  function flatVaultOK(G, r, c, c2) {
    const lo = Math.min(c, c2), hi = Math.max(c, c2);
    /* r 是「脚踩的实心行」，身体占 r-1。
       中间每一格：身体那一格（r-1）必须没有障碍，或者障碍只有一格高（r-2 是空的）。*/
    let sawBlocker = false;
    for (let x = lo + 1; x <= hi - 1; x++) {
      if (!solid(G[r][x])) return false;             // 中间有坑 → 不是「翻矮障碍」
      if (solid(G[r - 1][x])) {
        if (r - 2 < 1 || solid(G[r - 2][x])) return false;   // 两格高 → 翻不过去
        sawBlocker = true;
      }
    }
    return sawBlocker;
  }
  function neighbors(G, c, r) {
    const out = [];
    for (const dc of [-1, 1]) {
      const c2 = c + dc;
      if (c2 < 0 || c2 >= COLS) continue;
      if (!passable(G[r - 1][c2])) continue;
      if (solid(G[r][c2])) { if (canStand(G, c2, r)) out.push([c2, r]); }
      else {
        for (let r2 = r + 1; r2 < ROWS; r2++) {
          if (!solid(G[r2][c2])) continue;
          if (canStand(G, c2, r2)) out.push([c2, r2]);
          break;
        }
      }
    }
    /* 同高度「翻矮障碍」：向左 / 向右各试 2~3 格，中间隔着的是一格高的东西就能过 */
    for (const dc of [-1, 1]) {
      for (let k = 2; k <= 3; k++) {
        const c2 = c + dc * k;
        if (c2 < 1 || c2 >= COLS - 1) continue;
        if (!canStand(G, c2, r)) continue;
        if (!flatVaultOK(G, r, c, c2)) continue;
        out.push([c2, r]);
      }
    }
    for (let up = 1; up <= 2; up++) {
      const r2 = r - up;
      if (r2 < 1) continue;
      for (let dc = -3; dc <= 3; dc++) {
        if (!dc) continue;
        const c2 = c + dc;
        if (!canStand(G, c2, r2)) continue;
        if (!jumpOK(G, c, r, c2, r2)) continue;
        out.push([c2, r2]);
      }
    }
    return out;
  }
  function canReach(G, from, goal) {
    const K = (c, r) => r * COLS + c;
    if (!canStand(G, from[0], from[1])) return false;
    const gk = K(goal[0], goal[1]);
    const seen = new Set([K(from[0], from[1])]);
    const q = [from];
    for (let h = 0; h < q.length; h++) {
      const [c, r] = q[h];
      if (K(c, r) === gk) return true;
      for (const nb of neighbors(G, c, r)) {
        const k = K(nb[0], nb[1]);
        if (seen.has(k)) continue;
        seen.add(k); q.push(nb);
      }
    }
    return false;
  }

  /* ---------- 难度曲线 ---------- */
  /* t ∈ [0,1]。关卡号越大 t 越接近 1。 */
  function diffOf(n) { return LD.clamp((n - 1) / (LD.Guns.TOTAL_GUN_LEVELS - 1), 0, 1); }

  /* ---------- 地形骨架 ---------- */
  /* 出生区保护带：左右各 5 列、地面往上 2 行必须留空。
     没有这条约束，最底层高台会正好压在出生点头顶（只隔 1 行），
     玩家一出生就顶天花板、跳不起来，也没有任何站立空间放出生点。 */
  const SPAWN_PAD = 5;

  function buildTerrain(G, n, t, rnd) {
    // 1) 地面两层厚
    for (let c = 0; c < COLS; c++) { G[FLOOR][c] = S; G[FLOOR + 1][c] = S; }

    /* 2) 高台：往上叠 2~5 层蛇形台阶。
       用户要「高台」，而平射对枪的战术深度全在高台上 ——
       高台越靠上，越能压住地面的人；但每层之间必须留出「露出来的下层格子」当起跳位，
       否则高台就变成纯粹的墙。 */
    const halls = [];
    let cur = { row: FLOOR, x0: 0, x1: COLS - 1 };
    const want = 2 + Math.min(3, Math.floor(t * 3.6) + Math.floor(rnd() * 2));   // 2~5
    let drift = rnd() < 0.5 ? -1 : 1;
    // 第一层高台必须躲开出生区（否则出生点头顶只有 1 格）
    const padL = SPAWN_PAD, padR = COLS - 1 - SPAWN_PAD;
    for (let i = 0; i < want; i++) {
      const row = cur.row - 2;
      if (row < 2) break;
      const w = 6 + Math.floor(rnd() * 5);
      // 只有最底层要躲出生区；再往上就已经高于出生区了，可以自由铺开
      const avoid = i === 0;
      const cand = [];
      /* 偏移量枚举范围。
         【曾经的 bug —— 高台从来没生成出来过，halls 一直是空数组】
         第一层的「上一层」是横跨全宽的地面（cur.x0 = 0、cur.x1 = COLS-1），
         而出生保护带又要求它整段落在 (padL, padR) = (5, 18) 之内：
         于是 x0 必须 ≥ 6 —— 可 x0 = cur.x0 + s = s，而 s 只枚举到 ±5，
         候选**一个都凑不出来**，`if (!cand.length) break` 直接跳出，
         halls 永远是空的：地图上只剩 placeProps 放的 1~2 格矮掩体，
         压根没有能站人的高台（用户看到的「敌人不会自己跳上高台」就是从这儿来的）。
         所以第一层按「整张图的哪一段」枚举；第二层起才沿用「相对上一层 ±5 的蛇形漂移」。 */
      const sFrom = i === 0 ? 1 : -5;
      const sTo = i === 0 ? COLS - 2 : 5;
      for (let s = sFrom; s <= sTo; s++) {
        const x0 = cur.x0 + s, x1 = x0 + w - 1;
        if (x0 < 1 || x1 >= COLS - 1) continue;
        if (!(x0 > cur.x0 || x1 < cur.x1)) continue;
        if (Math.abs(s) > 2 && Math.min(x1, cur.x1) - Math.max(x0, cur.x0) < 1) continue;
        // 第一层不许压在出生区上方
        if (avoid && x0 <= padL) continue;
        if (avoid && x1 >= padR) continue;
        let ok = true;
        for (let c = x0; c <= x1 && ok; c++) {
          for (let r = row - 1; r < cur.row; r++) if (G[r][c] !== '.') { ok = false; break; }
        }
        if (!ok) continue;
        cand.push({ x0, x1, s });
      }
      if (!cand.length) break;
      let pool = cand.filter((p) => p.s !== 0 && p.s * drift > 0);
      if (!pool.length) { drift = -drift; pool = cand.filter((p) => p.s !== 0 && p.s * drift > 0); }
      const pick = pool.length ? pool[Math.floor(rnd() * pool.length)] : cand[Math.floor(rnd() * cand.length)];
      for (let c = pick.x0; c <= pick.x1; c++) G[row][c] = S;
      halls.push({ row, x0: pick.x0, x1: pick.x1 });
      cur = { row, x0: pick.x0, x1: pick.x1 };
    }

    // ---- 3) 地面上的掩体矮台：平射对决里，「平地上也得有东西挡子弹」，
    //      否则两个人隔着一整屏对射，全靠运气。矮台必须远离出生点那几列，
    //      否则会直接把红方堵在角落里出不来。
    const coverCols = new Set();
    for (let c = 1; c <= 5; c++) coverCols.add(c);
    for (let c = COLS - 6; c < COLS; c++) coverCols.add(c);
    const blocks = 1 + Math.round((1 - t) * 3 + rnd() * 2);      // 越简单掩体越多
    const groundFree = [];
    for (let c = 7; c < COLS - 7; c++) {
      if (coverCols.has(c)) continue;
      if (G[FLOOR - 1][c] !== '.' || G[FLOOR - 2][c] !== '.') continue;
      groundFree.push(c);
    }
    const pickedCover = [];
    for (const c of shuffled(groundFree, rnd)) {
      if (pickedCover.length >= blocks) break;
      if (pickedCover.some((x) => Math.abs(x - c) < 3)) continue;
      pickedCover.push(c);
    }
    for (const c of pickedCover) {
      const h = 1 + Math.floor(rnd() * 2);                       // 高 1~2 格
      for (let k = 0; k < h; k++) G[FLOOR - 1 - k][c] = S;
    }
    return halls;
  }

  /* ---------- 出生点 ----------
     左右各一个，站在地面上、头顶至少空 2 格（要能起跳）。
     先按「近端 1~5 列」挑，挑不到就往中间放宽 ——
     生成器宁可把出生点挤到中间一点，也不能因为挑不到位置就把整关作废。 */
  function placeSpawns(G, rnd) {
    const pick = (from, to) => range(from, to).filter((c) => G[FLOOR - 1][c] === '.' && G[FLOOR - 2][c] === '.');
    let freeL = pick(1, 5);
    let freeR = pick(COLS - 6, COLS - 2);
    if (!freeL.length) freeL = pick(1, 9);
    if (!freeR.length) freeR = pick(COLS - 10, COLS - 2);
    if (!freeL.length || !freeR.length) return null;
    const a = shuffled(freeL, rnd)[0], b = shuffled(freeR, rnd)[0];
    if (a === b || Math.abs(a - b) < 6) return null;      // 两个人别贴在一起
    G[FLOOR - 1][a] = SPAWN_L;
    G[FLOOR - 1][b] = SPAWN_R;
    return { red: [a, FLOOR], blue: [b, FLOOR] };
  }

  /* ---------- 木箱 / 回血装置 ----------
     关键：摆放的位置必须是「有人站得上去的地方」，否则它们只是装饰。
     站立位置 = 某格实心瓦片（平台 / 地面）正上方那一格（r-1）。
     木箱本身是实心（挡子弹、能被打碎），所以放完必须重新验一次可达性 ——
     不然一个木箱就能把唯一的通道堵死。 */
  function placeProps(G, n, t, rnd, spawns, bots) {
    /* 【必须避开人机身体】调用顺序是「先布人机、后放木箱」，
       而木箱正好放在 `at = r - 1`（站立格）——那正是人机身体所在的格子。
       不排掉的话木箱会直接扣在人机身上：人机胸口那一格变成实心，
       `lineClear` / `canShootAt` 沿胸口水平采样，第一个采样点就打在自己身上，
       于是它整局**一枪不开**（第 1 / 5 / 10 关踩过这个坑：
       内部状态是 seen=6 秒、有目标、有弹药、反应=0，但 los 永远是 false）。
       顺带把左右各一格也排掉：人机不会打碎木箱，被两格木箱夹住就真出不来了。 */
    const botBody = new Set();
    for (const b of (bots || [])) {
      for (const dc of [-1, 0, 1]) botBody.add((b.r - 1) * COLS + (b.c + dc));
    }
    // 所有「站立位置」：站在实心格上表面
    const stand = [];
    for (let r = 2; r < ROWS; r++) {
      for (let c = 1; c < COLS - 1; c++) {
        if (!solid(G[r][c])) continue;
        if (G[r - 1][c] !== '.') continue;
        if (r - 1 < 1) continue;
        stand.push({ c, r, at: r - 1 });            // 身体站 r-1，脚踩 r
      }
    }
    if (!stand.length) return { crates: 0, heals: 0 };

    const before = () => canReach(G, spawns.red, spawns.blue);

    /* 【回血装置已按需求删除】回血不再由固定装置提供，
       改为「打碎木箱 30% 概率爆医疗补给」（见 game.js 的 _crateDrop）。
       这里只负责放木箱。 */

    /* ---- 木箱：放在站立位上，但要「留出路」----
       每放一个就重跑一次可达性，过不了就撤回 —— 木箱是实心，放在窄台上真的会堵路。
       需求要求「游戏中加入障碍木箱」，所以至少保底 3 个：
       第一轮按可达性正常放；如果被撤回得只剩不到 3 个，就改用
       「只放在高台/远离唯一通路的地方」再补 —— 补时仍然逐格验证可达性。 */
    const crateCount = Math.max(4, Math.round(8 - t * 4 + rnd() * 2));
    const crateOrder = shuffled(stand, rnd);
    let placed = 0;
    const isSpawnCol = (s) => s.r === FLOOR && (s.c === spawns.red[0] || s.c === spawns.blue[0]);
    const tryCrate = (s) => {
      if (placed >= crateCount) return false;
      if (G[s.at][s.c] !== '.') return false;
      if (isSpawnCol(s)) return false;
      if (botBody.has(s.at * COLS + s.c)) return false;      // 别扣在人机身上（见函数头部注释）
      G[s.at][s.c] = CRATE;
      if (!before()) { G[s.at][s.c] = '.'; return false; }
      placed++;
      return true;
    };
    for (const s of crateOrder) {
      if (placed >= crateCount) break;
      tryCrate(s);
    }
    /* 保底补足：优先挑「高台上的」和「两头外侧的」，这些位置最不容易卡住唯一通路 */
    if (placed < 3) {
      const rescue = stand.slice().sort((a, b) => {
        const sa = (a.r < FLOOR ? 2 : 0) + Math.abs(a.c - COLS / 2) * 0.05;
        const sb2 = (b.r < FLOOR ? 2 : 0) + Math.abs(b.c - COLS / 2) * 0.05;
        return sb2 - sa;
      });
      for (const s of rescue) { if (placed >= 3) break; tryCrate(s); }
    }
    return { crates: placed, heals: 0 };
  }

  /* ---------- 人机布点 ----------
     数量与「等级」都随关卡上涨；等级用来喂 AI 的难度参数。
     人机位置：站在各个平台上 / 地面远端，且离玩家出生点有一定距离。 */
  function placeBots(G, n, t, rnd, spawns, opts) {
    opts = opts || {};
    const slots = [];
    for (let r = 2; r < ROWS; r++) {
      for (let c = 1; c < COLS - 1; c++) {
        if (!solid(G[r][c])) continue;
        if (G[r - 1][c] !== '.') continue;
        if (r - 1 < 1) continue;
        if (r === FLOOR && (c === spawns.red[0] || c === spawns.blue[0])) continue;
        const dcL = Math.abs(c - spawns.red[0]);
        if (dcL < 6) continue;                        // 别贴着玩家出生点
        slots.push({ c, r });
      }
    }
    if (!slots.length) return [];
    /* 数量严格跟关卡走（不做随机抖动）：
       需求原文是「枪战关卡越来越难，人机越来越厉害」—— 难度必须读得出来。
       任何随机抖动都会让「第 91 关比第 71 关轻松」这种事发生，那不是难度曲线。
       t 是关卡的单调递增函数，所以这里直接取阶梯值：1 → 9。
       opts.count 用来覆盖：枪战无尽是「一屏竞技场」，需要的人机密度比
       同关卡号的关卡更高（用户反馈「枪战无尽敌人太少」），由调用方直接给数。 */
    const count = opts.count != null ? LD.clamp(opts.count, 1, 12) : LD.clamp(1 + Math.floor(t * 8.4), 1, 9);
    const levelFloor = opts.levelFloor || 0;
    const out = [];
    const used = [];
    /* 候选顺序：把「地面层」的格子提到最前。
       为什么必须钉一个地面人机：玩家出生在地面，而枪是**统一平射**的 ——
       打不到比自己高 2 格以上的人。以前没有高台（buildTerrain 的 halls 一直是空的），
       这条自然成立；现在高台真的生成出来了，人机很可能全被摆到台子上，
       开局就变成「对面站着人却永远打不着」。
       （smoke 里「前 30 关都有同层人机」那条断言盯的就是这件事。） */
    const order = shuffled(slots, rnd);
    const groundIdx = order.findIndex((s) => s.r === FLOOR);
    if (groundIdx > 0) order.unshift(order.splice(groundIdx, 1)[0]);
    /* 分两轮：先按「彼此至少隔 3 列」挑，挑不满就放宽到隔 1 列。
       这样阶段数严格可控（难度曲线不会被地形宽度卡住而出现倒退），
       同时尽量让人机散开，不至于一开局就挤成一堆。 */
    for (const minGap of [3, 1]) {
      for (const s of order) {
        if (out.length >= count) break;
        if (used.some((u) => u.c === s.c && u.r === s.r)) continue;
        if (used.some((u) => Math.abs(u.c - s.c) < minGap && Math.abs(u.r - s.r) < 2)) continue;
        used.push(s);
        /* 人机的火力等级 = 关卡进度。高台上的更凶（占住高地的人会一直输出）。 */
        const high = s.r < FLOOR - 1;
        out.push({
          c: s.c, r: s.r,
          level: Math.max(levelFloor, diffOf(n) * 100) + (high ? 12 : 0) + rnd() * 8,
          elite: t > 0.55 && rnd() < t * 0.5,
          weapon: pickBotWeapon(n, rnd),
        });
      }
      if (out.length >= count) break;
    }
    return out;
  }

  /* 人机用什么枪：按「关卡解锁表」来（第 10 关人机才可能拿冲锋枪…）。
     只挑已解锁的，且不让早期关出现火箭筒。 */
  function pickBotWeapon(n, rnd) {
    const G = LD.Guns;
    const pool = ['pistol'];
    if (n >= 10) pool.push('smg');
    if (n >= 20 && rnd() < 0.55) pool.push('sniper');
    if (n >= 40 && rnd() < 0.35) pool.push('rpg');
    if (n >= 80 && rnd() < 0.2) pool.push('quad');
    if (n >= 60) pool.push('smg');                   // 后期冲锋枪权重更高（压迫感）
    return pool[Math.floor(rnd() * pool.length)];
  }

  /* ---------- 单关构建 ---------- */
  function build(n, t, rnd) {
    const G = [];
    for (let r = 0; r < ROWS; r++) G.push(new Array(COLS).fill('.'));
    const halls = buildTerrain(G, n, t, rnd);
    const spawns = placeSpawns(G, rnd);
    if (!spawns) return null;
    if (!canReach(G, spawns.red, spawns.blue)) return null;   // 一开始就互不相通 → 换种子
    /* ---- 通视整理：让红方出生点看得见至少一个同层人机 ----
       平射时代「看不见」= 一枪不开（这就是「人机老不打人」的另一半根因：
       出生点与人机之间正好横着一根柱子）。这里做一次**最小手术**：
         · 只在「红方胸口那一行」上动手，绝不碰别的高度
         · 逐个障碍判断：先削木箱（木箱本来就是用来打的），再削「单层矮柱」
         · 承重柱（上面那格也实心 / 是高台底座）一律不碰 —— 削了会把整层高台掏空
         · 沿着一行从红方向右扫，遇到障碍就削，削到「能看到某个人机」就立刻停手
       把「削到能通视为止」作为唯一目标，而不是无脑清一整行 ——
       否则地形会被剃成一片平地，用户要的「木箱、高台、掩体」全没了。 */
    const band = (col, b) => {
      const a = Math.min(col, b.c) + 1, z = Math.max(col, b.c) - 1;
      for (let c = a; c <= z; c++) if (solid(G[b.r - 1][c])) return false;
      return true;
    };
    const isLoadBearing = (c, r) => {
      /* 承重柱 = 这一格实心，且**上面那一格也实心**（高台叠罗汉的底座）。
         单层矮柱（上面是空的）才是可以削的掩体。 */
      if (G[r][c] !== S) return false;
      return r - 1 >= 1 && solid(G[r - 1][c]);
    };
    /* 人机先布点（通视手术需要知道人机站在哪），木箱后放。
       顺序很关键：木箱是后放的，可能又挡上新开出来的这条视缝，
       所以后面还有一道专门削木箱的补救 + 最终硬验收。 */
    const bots = placeBots(G, n, t, rnd, spawns);
    if (!bots.length) return null;
    const lowBots = bots.filter((b) => Math.abs(b.r - FLOOR) <= 2);
    if (lowBots.length && !lowBots.some((b) => band(spawns.red[0], b))) {
      /* 以「离红方最近的那个人机」为目标，从红方一侧逐列往外削 */
      const tgt = lowBots.slice().sort((x, y) => Math.abs(x.c - spawns.red[0]) - Math.abs(y.c - spawns.red[0]))[0];
      const row = tgt.r - 1;
      const dir = tgt.c > spawns.red[0] ? 1 : -1;
      for (let c = spawns.red[0] + dir; c !== tgt.c; c += dir) {
        if (c < 1 || c >= COLS - 1) break;
        if (G[row][c] === CRATE) { G[row][c] = '.'; continue; }     // 木箱：本来就能打碎
        if (G[row][c] === S && !isLoadBearing(c, row)) G[row][c] = '.';   // 单层矮掩体
        if (band(spawns.red[0], tgt)) break;                        // 通了就收手
      }
    }
    const props = placeProps(G, n, t, rnd, spawns, bots);
    // 木箱 / 回血装置放完再验一次「玩家还走得到对面」，避免把自己堵死
    if (!canReach(G, spawns.red, spawns.blue)) return null;
    /* 木箱是后放的，可能正好补回刚削开的视缝 —— 再削一次（只削木箱，不碰地形）。
       【必须事务式削除】木箱在可达性模型里是「可以站上去的实心块」，
       它同时是玩家 / 人机爬高台的踏脚。第一版这里无脑削，
       结果第 63 关正好把 (9,9) 那颗木箱削掉 —— 那是红方登上第二层高台的**唯一一级台阶**，
       削完两侧就再也走不通了（内部 canReach 在削之前是 true、削之后变 false，
       生成器自己没复验，于是「能生成但走不到对面」的关就漏出去了）。
       现在每削一格立刻复验一次可达性，破了就还原这一格并收手。 */
    if (lowBots.length && !lowBots.some((b) => band(spawns.red[0], b))) {
      const tgt2 = lowBots.slice().sort((x, y) => Math.abs(x.c - spawns.red[0]) - Math.abs(y.c - spawns.red[0]))[0];
      const row2 = tgt2.r - 1;
      const dir2 = tgt2.c > spawns.red[0] ? 1 : -1;
      for (let c = spawns.red[0] + dir2; c !== tgt2.c; c += dir2) {
        if (c < 1 || c >= COLS - 1) break;
        if (G[row2][c] === CRATE) {
          G[row2][c] = '.';
          if (!canReach(G, spawns.red, spawns.blue)) G[row2][c] = CRATE;   // 削断了路 → 还原并收手
        }
        if (band(spawns.red[0], tgt2)) break;
      }
    }
    // 兜底复验：任何情况下都不能把「最后交出去的这张图」变成走不通
    if (!canReach(G, spawns.red, spawns.blue)) return null;
    /* ---- 最后一道闸：至少要有一个「和红方大致同层」的人机能通视 ----
       上面已经做过最小手术，正常情况这里必然通过。留这个闸只是防御性兜底：
       万一手术也救不了（人机被摆进承重柱的阴影里），就换种子 ——
       宁可重掷，也不给玩家一局「对面站着人却永远打不着」的关。 */
    const sameBand = bots.filter((b) => Math.abs(b.r - FLOOR) <= 2);
    if (sameBand.length && !sameBand.some((b) => band(spawns.red[0], b))) return null;

    const nameI = Math.floor(rnd() * NAMES.length);
    return {
      id: n,
      name: NAMES[nameI][0], nameEn: NAMES[nameI][1],
      hint: cfgHint(n),
      hintEn: cfgHintEn(n),
      cols: COLS, rows: ROWS,
      grid: G.map((r) => r.join('')),
      gun: n,                                   // 标记：这是枪战关卡第 n 关
      arena: true,
      halls: halls.map((h) => ({ row: h.row, x0: h.x0, x1: h.x1 })),
      spawnCell: spawns.red,
      spawn2Cell: spawns.blue,
      botPlan: bots,
      crateCount: props.crates,
      healCount: props.heals,
      waveSize: bots.length,
      tint: TINTS[n % TINTS.length],
    };
  }

  function cfgHint(n) {
    const parts = [`枪战第 ${n} 关 · 人机 ${1 + Math.floor(diffOf(n) * 9.4)} 个左右。`];
    const nw = LD.Guns.newlyUnlocked(n);
    if (nw.length) parts.push(`新武器解锁：${nw.map((w) => w.slot + ' ' + w.name).join('、')}。`);
    parts.push('打碎木箱有机会拿到双倍 / 三倍射速与弹药。');
    return parts.join('');
  }
  function cfgHintEn(n) {
    const parts = [`Gun level ${n}.`];
    const nw = LD.Guns.newlyUnlocked(n);
    if (nw.length) parts.push(`New weapon: ${nw.map((w) => w.slot + ' ' + w.nameEn).join(', ')}.`);
    parts.push('Break crates for double or triple fire rate and ammo.');
    return parts.join(' ');
  }

  /* 兜底：万一 60 次都失败，给一个手写的最小竞技场（一定有平台、木箱、回血） */
  function fallback(n) {
    const G = [];
    for (let r = 0; r < ROWS; r++) G.push(new Array(COLS).fill('.'));
    for (let c = 0; c < COLS; c++) { G[FLOOR][c] = S; G[FLOOR + 1][c] = S; }
    for (let c = 3; c <= 11; c++) G[FLOOR - 2][c] = S;
    for (let c = 12; c <= 20; c++) G[FLOOR - 4][c] = S;
    for (let c = 6; c <= 14; c++) G[FLOOR - 6][c] = S;
    G[FLOOR - 1][4] = S; G[FLOOR - 1][19] = S;
    G[FLOOR - 3][8] = CRATE; G[FLOOR - 5][15] = CRATE; G[FLOOR - 7][10] = CRATE;
    G[FLOOR - 1][2] = SPAWN_L; G[FLOOR - 1][21] = SPAWN_R;
    return {
      id: n, name: NAMES[0][0], nameEn: NAMES[0][1],
      hint: cfgHint(n), hintEn: cfgHintEn(n),
      cols: COLS, rows: ROWS, grid: G.map((r) => r.join('')),
      gun: n, arena: true, halls: [],
      spawnCell: [2, FLOOR], spawn2Cell: [21, FLOOR],
      botPlan: [
        { c: 18, r: FLOOR - 4, level: diffOf(n) * 100, elite: false, weapon: pickBotWeapon(n, Math.random) },
        { c: 8, r: FLOOR - 6, level: diffOf(n) * 100, elite: false, weapon: pickBotWeapon(n, Math.random) },
      ],
      crateCount: 3, healCount: 2, waveSize: 2,
      tint: TINTS[0],
    };
  }

  /* ---------- 双人对枪：一张左右对称的竞技场 ----------
     两个人各站在自己那一侧，中间用对称的高台 + 掩体隔开。
     对称是刻意的：回合制对战里「谁那侧地形好」比枪法更能决定胜负。 */
  function buildDuel(t, rnd) {
    const G = [];
    for (let r = 0; r < ROWS; r++) G.push(new Array(COLS).fill('.'));
    for (let c = 0; c < COLS; c++) { G[FLOOR][c] = S; G[FLOOR + 1][c] = S; }
    // 对称高台三对：左右镜像铺开，谁那侧都不吃亏
    const specs = [
      { row: FLOOR - 2, w: 5, off: 1 },
      { row: FLOOR - 4, w: 6, off: 3 },
      { row: FLOOR - 6, w: 4, off: 6 },
    ];
    for (const sp of specs) {
      const x0 = sp.off, x1 = sp.off + sp.w - 1;
      /* 镜像区间必须正好是 [x0..x1] 关于中心线的对称：
           右端 = COLS-1-x1 .. COLS-1-x0
         之前写成 COLS-1-off-w+1 .. COLS-2-off，整体左移了一格，
         结果左右两侧地形并不对称（对战里「谁那侧地形好」比枪法更能决定胜负）。 */
      const y0 = COLS - 1 - x1, y1 = COLS - 1 - x0;
      for (let c = x0; c <= x1; c++) G[sp.row][c] = S;
      for (let c = y0; c <= y1; c++) G[sp.row][c] = S;
    }
    // 地面掩体：中间对称各一块（回血装置已删——补给只能打箱子爆）
    G[FLOOR - 1][5] = CRATE; G[FLOOR - 1][COLS - 6] = CRATE;
    G[FLOOR - 3][3] = CRATE; G[FLOOR - 3][COLS - 4] = CRATE;
    G[FLOOR - 5][9] = CRATE; G[FLOOR - 5][COLS - 10] = CRATE;
    G[FLOOR - 1][2] = SPAWN_L; G[FLOOR - 1][COLS - 3] = SPAWN_R;
    return {
      id: 0, name: '对枪竞技场', nameEn: 'Duel Arena',
      hint: '左右对称的竞技场：抢占中间的高台，谁站得高谁先看见谁。',
      hintEn: 'A mirrored arena — take the middle ledges. Height wins duels.',
      cols: COLS, rows: ROWS, grid: G.map((r) => r.join('')),
      duel: true, arena: true, halls: [],
      spawnCell: [2, FLOOR], spawn2Cell: [COLS - 3, FLOOR],
      botPlan: [], crateCount: 4, healCount: 2, waveSize: 0,
      tint: ['#0a0e18', '#1a1226'],
    };
  }

  /* ---------- 枪战无尽：一直往右接一段 ----------
     与普通无尽不同：枪战无尽每一段都是「一屏竞技场」，所以段与段能无缝拼起来，
     段内自带木箱 / 回血站 / 人机布点。段号越大，人机越多越狠。 */
  const GS_CHUNK = COLS;
  function genGunEndlessChunk(p) {
    const idx = Math.max(0, Math.floor(p) || 0);
    const rnd = LD.mulberry32((((idx + 13) * 2654435761) >>> 0) + 40503);
    const n = 1 + idx * 6;                     // 段号折算成「难度关卡号」
    const t = LD.clamp(idx / 40, 0, 1);
    const G = [];
    for (let r = 0; r < ROWS; r++) G.push(new Array(COLS).fill('.'));
    buildTerrain(G, n, t, rnd);
    // 段两端各留 3 格完整地面，接缝处永远不会冒出坑
    for (let c = 0; c < 3; c++) {
      for (let r = 0; r < FLOOR; r++) G[r][c] = '.';
      G[FLOOR][c] = S; G[FLOOR + 1][c] = S;
    }
    for (let c = COLS - 3; c < COLS; c++) {
      for (let r = 0; r < FLOOR; r++) G[r][c] = '.';
      G[FLOOR][c] = S; G[FLOOR + 1][c] = S;
    }
    const spawns = { red: [1, FLOOR], blue: [COLS - 2, FLOOR] };
    /* 【敌人密度调参】用户反馈「枪战无尽敌人太少」。
       实测改之前平均每段只有 1.4 个人机（段 0~4 各 1 个，段 5 起才 2 个）。
       两个原因：
         1) placeBots 的数量走的是关卡曲线（1~9），而无尽用 n = 1 + idx*6
            折算关卡号，前十段折算出来的难度还很低；
         2) 人机要站在「实心格正上方」，而木箱先放，占掉了一批站立位。
       现在：**人机先布点、木箱后放**（人机优先挑位置），并直接给密度 ——
       段 0 就 3 个，每 2 段 +1，上限 10。 */
    const botCount = LD.clamp(3 + Math.floor(idx / 2), 3, 10);
    const bots = placeBots(G, n, t, rnd, spawns, { count: botCount, levelFloor: Math.min(60, 8 + idx * 3) });
    const props = placeProps(G, n, t, rnd, spawns, bots);
    /* 接缝清理：把两端 SAFE 列里的木箱 / 回血装置 / 人机布点全部抹掉。
       段与段是拼起来的，接缝处只要有一个木箱，两段之间就多出一堵实心墙，
       跑图时会莫名其妙被挡住。人机也是同理（会卡在接缝上）。 */
    const SAFE = 3;
    const cleared = [];
    for (let r = 0; r < ROWS; r++) {
      for (const c of [0, 1, 2, COLS - 3, COLS - 2, COLS - 1]) {
        if (G[r][c] === CRATE || G[r][c] === HEALTH) { G[r][c] = '.'; cleared.push(r * COLS + c); }
      }
    }
    const keepBots = bots.filter((b) => b.c >= SAFE && b.c <= COLS - 1 - SAFE);
    return {
      cols: COLS, grid: G.map((r) => r.join('')),
      surf: null, noDoor: true, arena: true, gunEndless: idx,
      botPlan: keepBots, crateCount: props.crates - cleared.length, healCount: props.heals,
      waveSize: keepBots.length,
      tint: ['#080a12', '#20132e'],
      chunk: idx,
    };
  }

  /* ---------- 对外入口 ---------- */
  LD.genGunLevel = function (i) {
    const n = LD.clamp(Math.floor(i) || 1, 1, LD.Guns.TOTAL_GUN_LEVELS);
    const t = diffOf(n);
    for (let k = 0; k < MAX_TRIES; k++) {
      const rnd = LD.mulberry32((n * 2246822519 + k * 3266489917 + 51539607551) >>> 0);
      const r = build(n, t, rnd);
      if (r) { r.attempts = k + 1; return r; }
    }
    const f = fallback(n);
    f.attempts = -1;
    return f;
  };

  LD.genGunDuel = function () {
    for (let k = 0; k < MAX_TRIES; k++) {
      const rnd = LD.mulberry32((7777777 + k * 48271) >>> 0);
      const r = buildDuel(1, rnd);
      if (r) { r.attempts = k + 1; return r; }
    }
    return buildDuel(1, LD.mulberry32(7777777));
  };

  /* ---------- 枪战训练场 ----------
     需求：一个能「手动加敌人 / 减敌人 / 回血 / 血量翻倍 / 冻结 / 停火」的沙盒。
     地形要满足三件事：
       ① 够宽（40 列 = 1600px，比一屏宽），放得下十几个敌人还不会一开局就贴脸；
       ② 有高台和台阶 —— 需求里写死了「枪械统一平射，主要看玩家跳跃攻打」，
          练习场必须能练跳跃射击，所以是阶梯地形而不是一块平地；
       ③ 有木箱和回血装置，顺便能练打箱子和用回血站。
     刻意**不带 botPlan**：敌人全部由训练热键（数字 0）手动添加。 */
  LD.genGunTraining = function () {
    const W = 40;                                  // 40 × 40 = 1600px，比一屏宽
    const G = [];
    for (let r = 0; r < ROWS; r++) G.push(new Array(W).fill('.'));
    for (let c = 0; c < W; c++) { G[FLOOR][c] = S; G[FLOOR + 1][c] = S; }
    /* 左右各一组阶梯（互相镜像），可以对着两侧练「跳上去打高处的人」。
       每级只占 3 列宽、上下间隔 2 行 —— 间隔 1 行会形成低矮夹层，
       AI 的寻路和玩家的跳跃都容易被卡住。 */
    const ladder = (x0, dir) => {
      for (let i = 0; i < 4; i++) {
        /* 每级 2 行（80px）—— 第一级也必须只有 2 行：
           原来写的是 FLOOR-3（3 行＝120px），而跳跃上限约 131px，
           等于是「贴着脸顶」才能上去的一级，玩家要试很多次、人机基本放弃。
           统一成 2 行之后，左右两组阶梯都是标准的可跳台阶。 */
        const row = FLOOR - 2 - i * 2;             // 10 / 8 / 6 / 4
        const c0 = x0 + dir * i * 3;
        if (row < 2) break;
        for (let k = 0; k < 3; k++) {
          const c = c0 + k;
          if (c >= 0 && c < W) G[row][c] = S;
        }
      }
    };
    ladder(3, 1);                                  // 左侧：往右逐级升高
    ladder(W - 6, -1);                             // 右侧：往左逐级升高
    const mid = Math.floor(W / 2);
    for (let k = 0; k < 5; k++) G[FLOOR - 4][mid - 2 + k] = S;   // 中央孤岛高台
    // 掩体与补给（回血装置已删——训练场的回血走数字键 3）
    G[FLOOR - 1][8] = CRATE; G[FLOOR - 1][W - 9] = CRATE;
    G[FLOOR - 5][mid] = CRATE;
    G[FLOOR - 1][2] = SPAWN_L;
    return {
      id: 0, name: '枪战训练场', nameEn: 'Gun Training Ground',
      hint: '沙盒：数字键 0~9 随时加人、减人、回血、冻结、停火。',
      hintEn: 'Sandbox — digits 0~9 spawn, remove, heal, freeze and silence the bots.',
      cols: W, rows: ROWS, grid: G.map((r) => r.join('')),
      /* gun 这个字段是渲染层的总开关（world.js：`this.gun = level.gun !== undefined || …`）——
         少了它，人机、子弹、血条全都不会被画出来（只有玩家在那儿跑）。
         训练场不是「第几关」，值给 0 就行，判断只认「有没有定义」。 */
      gun: 0, training: true, arena: true, halls: [],
      spawnCell: [2, FLOOR], spawn2Cell: [W - 3, FLOOR],
      botPlan: [], crateCount: 3, healCount: 1, waveSize: 0,
      tint: ['#0a0e18', '#1a1226'],
    };
  };

  LD.genGunEndlessChunk = genGunEndlessChunk;
  LD.GS_CHUNK = GS_CHUNK;
  LD.GUN_ARENA_COLS = COLS;
  LD.gunRoomReach = { canReach, canStand, neighbors, solid, FLOOR, COLS, ROWS };
})();
