/* world.js — 关卡运行时：瓦片 / 机关 / 陷阱事件 / 碰撞查询 / 双人模式元素池
   瓦片字符：
     #  实心砖        =  薄平台        X  易碎砖（踩了会塌）   T  陷阱地板
     ^  地面地刺      v  天花板地刺    <  左侧地刺              >  右侧地刺
     B  假方块（碰了就碎）             O  酸池（两个人都会溶）
     ~  火池（只溶蓝魔）               _  水池（只溶红魔）
     P  出生点        D  红门           d  蓝门
     H  横向移动平台  V  纵向移动平台   C  落锤
     G  巡逻守卫      F  飞行怪         W  锯轮

   枪战模式专用（只出现在 gun 关 / 枪战无尽 / 对枪竞技场）：
     K  障碍木箱（可被子弹打破，有机会掉双倍 / 三倍射速与弹药）
     +  回血装置（站上去持续回血）

   新障碍（联机更新）：
     A  传送带（向右推人，实心地面）   Z  传送带（向左推人）
     L  激光发射器（周期性：蓄力 → 发射，发射时向右的光束致命）
     S  蒸汽喷发口（周期性：蓄力 → 喷发，喷发时向上的汽柱致命）
     N  摆锤（从锚点来回摆动，锤球致命）
     M  浮游雷（会慢慢漂向附近的活人，碰到就炸）
*/
(function () {
  const T = LD.TILE, R = LD.ROWS;
  /* 格子键：与地图宽度无关。
     以前是 `r * this.cols + c`，而无尽模式会 extend() → cols 变大，
     旧键立刻全部失效（isSolid 里 get() 拿到 undefined 后 .gone 就崩）。
     换成 c * R + r 之后 cols 怎么变都不影响，解码也不再需要 cols。 */
  const ck = (LD.cellKey = (c, r) => c * R + r);

  LD.World = class World {
    constructor(level) {
      this.level = level;
      this.cols = level.cols;
      this.rows = R;
      this.coop = level.coop || 0;          // 双人模式：0 = 单人关，>0 = 双人模式第几关
      this.pxW = this.cols * T;
      this.pxH = R * T;
      this.grid = level.grid.map((r) => r.split(''));
      this.movers = [];
      this.crushers = [];
      this.guards = [];
      this.flyers = [];
      this.saws = [];
      this.lasers = [];      // 激光发射器（L）
      this.geysers = [];     // 蒸汽喷发口（S）
      this.pendulums = [];   // 摆锤（N）
      this.mines = [];       // 浮游雷（M）
      this.crumble = new Map();   // key -> {t,gone,wait}
      this.trapdoor = new Map();
      this.fakes = new Set();
      this.tempBlocks = [];
      this.pendingSolid = [];     // 被小人占住、排队等着长出来的实心块
      this.bridgeBreaks = [];     // 延迟倒塌的桥
      /* 枪战模式：木箱（可打碎）与回血装置。
         boxes 用 Map 存「还活着的木箱」，打碎后从 Set 里移出去，
         tileSolidAt 就会放行 —— 子弹和人都能穿过去。 */
      /* 枪战模式的判定。注意这里【不能】用 !!：无尽第一段的 gunEndless 是 0，
         !!0 === false —— 结果就是「枪战无尽的第一段」整个按普通关卡渲染:
         小人手里没枪、人机不画、子弹不画。必须用 !== undefined 判存在。 */
      this.gun = level.gun !== undefined || level.gunEndless !== undefined || !!level.duel;
      this.boxes = new Map();     // key -> {c, r, chipped}
      this.broken = new Set();    // 已经碎掉的木箱 key
      this.healStations = [];     // 回血装置的位置（格坐标）
      this.gunBullets = [];       // 子弹（枪战模式由 game.js 统一推进，这里只做查询）
      this.events = (level.events || []).map((e) => Object.assign({ fired: false }, e));
      this.spawn = { x: 1 * T + 9, y: 11 * T - 28 };
      this.spawn2 = null;                                   // 双人模式：蓝魔出生点
      this.door = { x: (this.cols - 2) * T, y: 10 * T, w: T, h: T };   // 红门
      this.door2 = null;                                    // 双人模式：蓝门
      this.soft = [];             // 软实体（两个小人本身）：可以踩头，不挡路
      this.time = 0;
      this.shake = 0;
      this.doorMoved = false;
      this.doorPulse = 0;
      this.cheatMode = false;      // 作弊模式下：落锤等「有伤害的物品」可穿过
      this._parse(level);
    }

    /* 解析一格。colOffset 是「这一格真实落在哪个绝对列」——
       无尽模式往右边接新地形时就靠它把段内坐标换算成世界坐标。 */
    _parseCell(level, r, c, colOffset) {
      const row = level.grid[r];
      const ch = row ? row[c] : '.';
      if (!ch || ch === '.') return;
      const cc = c + colOffset;
      const x = cc * T, y = r * T;
      if (ch === 'P') {
        this.spawn = { x: x + 9, y: y + T - 28, footY: y + T };
        this.grid[r][cc] = '.';
      } else if (ch === 'p') {                 // 双人模式的第二个出生点
        this.spawn2 = { x: x + 9, y: y + T - 28, footY: y + T };
        this.grid[r][cc] = '.';
      } else if (ch === 'D') {
        this.door = { x, y, w: T, h: T };
        this.grid[r][cc] = '.';
      } else if (ch === 'd') {
        this.door2 = { x, y, w: T, h: T };
        this.grid[r][cc] = '.';
      } else if (ch === 'H' || ch === 'V') {
        const horizontal = ch === 'H';
        const range = horizontal ? T * 2.5 : T * 1.6;
        const x0 = horizontal
          ? LD.clamp(x, range, Math.max(range, this.pxW - T - range))   // 摆动范围别伸出世界
          : x;
        const y0 = y + 24;
        const phase = cc * 0.7;
        this.movers.push({
          axis: horizontal ? 'h' : 'v', kind: 'mover',
          oneWay: true,                   // 只能踩上去，不会横向挡人（见 player._pushRects）
          x0, y0, w: T, h: 16, range, phase,
          /* 位置的初始值必须和 phase 一致，否则关卡第一帧平台会瞬移
             （实测最多瞬移 99px，正好在玩家眼皮底下）。 */
          x: horizontal ? x0 + Math.sin(phase) * range : x0,
          y: horizontal ? y0 : y0 + Math.sin(phase) * range,
          speed: horizontal ? 0.9 + (r % 3) * 0.12 : 1.05,
          dx: 0, dy: 0, stall: 0,
        });
        this.grid[r][cc] = '.';
      } else if (ch === 'C') {
        this.crushers.push({
          kind: 'crusher', x, y, home: y, w: T, h: T,
          state: 'idle', t: 0, vy: 0, ground: this._groundBelow(cc, r),
          dx: 0, dy: 0,
        });
        this.grid[r][cc] = '.';
      } else if (ch === 'G') {
        this.guards.push({ kind: 'guard', x: x + 5, y: y + 10, w: 30, h: 30, x0: x + 5, range: T * 3, dir: 1, speed: 1.5 + (cc % 3) * 0.2, phase: cc * 0.9 });
        this.grid[r][cc] = '.';
      } else if (ch === 'F') {
        this.flyers.push({ kind: 'flyer', x: x + 5, y: y + 4, w: 30, h: 30, x0: x + 5, range: T * 2.5, dir: -1, speed: 1.8 + (cc % 4) * 0.15, phase: cc * 0.6 });
        this.grid[r][cc] = '.';
      } else if (ch === 'W') {
        this.saws.push({ kind: 'saw', x: x + 4, y: y + 6, w: 32, h: 32, x0: x + 4, range: T * 3.2, dir: 1, speed: 2.1 + (cc % 3) * 0.2, phase: cc * 0.5, rot: 0 });
        this.grid[r][cc] = '.';
      } else if (ch === 'X') {
        this.crumble.set(ck(cc, r), { t: -1, gone: false, wait: 0 });
      } else if (ch === 'T') {
        this.trapdoor.set(ck(cc, r), { t: -1, gone: false, wait: 0 });
      } else if (ch === 'K') {
        /* 木箱：留在 grid 里（渲染 / 碰撞都要用），另外登记一份「还活着」的索引。
           打碎时只需要把它加进 broken，isSolid 就会放行。 */
        this.boxes.set(ck(cc, r), { c: cc, r: r, chipped: 0 });
      } else if (ch === '+') {
        this.healStations.push({ c: cc, r: r, x: x, y: y });
        this.grid[r][cc] = '+';            // 保留字符：渲染回血站要用
      } else if (ch === 'A' || ch === 'Z') {
        /* 传送带：就是「会推人的地面」，留在 grid 里（实心 + 渲染都要用）。
           推人逻辑在 player.update 里读脚下这一格完成，世界侧无需实体。 */
      } else if (ch === 'L') {
        // 激光发射器：朝右。tt 按列错开相位，免得一排激光同时开火。
        this.lasers.push({ x, y, w: T, h: T, tt: (cc * 0.41) % 3.0, state: 'idle', len: 0, was: '' });
        this.grid[r][cc] = '.';
      } else if (ch === 'S') {
        // 蒸汽喷发口：向上喷。同样按列错开相位。
        this.geysers.push({ x, y, w: T, h: T, tt: (cc * 0.53) % 3.2, state: 'idle', h: 0, was: '' });
        this.grid[r][cc] = '.';
      } else if (ch === 'N') {
        // 摆锤：锚点在格子中心，绳长 2.2 格，锤球半径 11px
        this.pendulums.push({ x: x + T / 2, y: y + T / 2, L: T * 2.2, ball: 11, t: cc * 0.61, ang: 0, bx: x + T / 2, by: y + T / 2 + T * 2.2 });
        this.grid[r][cc] = '.';
      } else if (ch === 'M') {
        // 浮游雷：悬停 + 慢速追踪，炸一次后消失 6 秒再回巢
        this.mines.push({ x: x + T / 2, y: y + T / 2, hx: x + T / 2, hy: y + T / 2, r: 12, t: cc * 0.43, vx: 0, vy: 0, dead: 0, blink: cc * 0.7 });
        this.grid[r][cc] = '.';
      }
    }

    _parse(level) {
      for (let r = 0; r < R; r++) {
        for (let c = 0; c < this.cols; c++) this._parseCell(level, r, c, 0);
      }
      if (level.spawn) this.spawn = { x: level.spawn.x * T + 9, y: level.spawn.y * T + T - 28, footY: (level.spawn.y + 1) * T };
      if (level.spawn2) this.spawn2 = { x: level.spawn2.x * T + 9, y: level.spawn2.y * T + T - 28, footY: (level.spawn2.y + 1) * T };
      if (level.door) this.door = { x: level.door.x * T, y: level.door.y * T, w: T, h: T };
      if (level.door2) this.door2 = { x: level.door2.x * T, y: level.door2.y * T, w: T, h: T };
      // 无尽模式 / 枪战模式这类「没有终点（靠跑路 / 杀人而非进门）」的图：
      // 不要门，也不要在屏幕边缘画「门在前方」的箭头。
      // 枪战模式（level.gun 有值）一律无门 —— 胜负靠杀人，门是多余的；
      // 否则 world 构造函数里那个默认门（cols-2, 10*T）会被保留并画出来。
      if (level.noDoor || this.gun) { this.door = null; this.door2 = null; }
    }

    /* 无尽模式：把一段新地形接到地图右边。
       段内字符按「段内列号」给，这里整体平移 fromCol 之后再做增量解析 ——
       世界不重建，玩家、相机、已触发的机关全都不受影响。 */
    extend(level) {
      const fromCol = this.cols;
      const add = level.cols;
      for (let r = 0; r < this.rows; r++) {
        const row = level.grid[r] || '';
        for (let c = 0; c < add; c++) this.grid[r][c + fromCol] = row[c] || '.';
      }
      this.cols += add;
      this.pxW = this.cols * T;
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < add; c++) this._parseCell(level, r, c, fromCol);
      }
      return fromCol;
    }

    _groundBelow(c, fromRow) {
      for (let r = fromRow + 1; r < R; r++) {
        const ch = this.grid[r][c];
        if (ch === '#' || ch === '=') return r * T;
      }
      return (R - 1) * T;
    }

    // 一个矩形放在 (x, y) 会不会和实心瓦片重叠
    _rectHitsSolid(x, y, w, h) {
      const c0 = Math.floor(x / T), c1 = Math.floor((x + w - 1) / T);
      const r0 = Math.floor(y / T), r1 = Math.floor((y + h - 1) / T);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (this.isSolid(c, r)) return true;
        }
      }
      return false;
    }

    /* ---------- 碰撞查询 ---------- */
    charAt(cx, cy) {
      if (cx < 0 || cx >= this.cols) return '#';
      if (cy < 0) return '.';
      if (cy >= R) return '.';
      return this.grid[cy][cx];
    }

    isSolid(cx, cy) {
      const ch = this.charAt(cx, cy);
      if (ch === '#' || ch === '=') return true;
      if (ch === 'A' || ch === 'Z') return true;      // 传送带是实心地面（只是会推人）
      if (ch === 'X') { const st = this.crumble.get(ck(cx, cy)); return !st || !st.gone; }
      if (ch === 'T') { const st = this.trapdoor.get(ck(cx, cy)); return !st || !st.gone; }
      if (ch === 'B') return !this.fakes.has(ck(cx, cy));
      /* 木箱是实心，但打碎之后就不挡了（子弹 / 人都能穿过去） */
      if (ch === 'K') return !this.broken.has(ck(cx, cy));
      return false;
    }

    /* ---------- 枪战模式：木箱查询 / 回血装置 ---------- */
    boxAt(px, py) {
      const c = Math.floor(px / T), r = Math.floor(py / T);
      const key = ck(c, r);
      if (!this.boxes.has(key)) return null;
      if (this.broken.has(key)) return null;
      return { c, r, x: c * T, y: r * T, w: T, h: T };
    }
    /* 子弹打中木箱 → 碎掉。返回被打破的木箱（没打中返回 null） */
    breakBox(px, py) {
      const b = this.boxAt(px, py);
      if (!b) return null;
      this.broken.add(ck(b.c, b.r));
      this._nav = null;             // 箱子碎后地形变了，分区 / 节点缓存作废重算
      LD.FX.burst(b.x + T / 2, b.y + T / 2, 12, '#c99a5b', 3.2);
      LD.FX.burst(b.x + T / 2, b.y + T / 2, 6, '#8a5f2b', 2.2);
      if (LD.Sfx && LD.Sfx.trap) LD.Sfx.trap();
      return b;
    }
    /* 某个矩形是否压在木箱上（子弹用：点到点判定） */
    boxHit(px, py) { return !!this.boxAt(px, py); }
    brokenCount() { return this.broken.size; }

    /* 站在回血装置上？返回那个装置（不在上面返回 null） */
    healAt(p) {
      if (!this.healStations.length) return null;
      for (const h of this.healStations) {
        // 装置占一格（r 行），小人脚踩在 r 行顶面、身体在 r-1 行
        const box = { x: h.x + 4, y: h.y + 6, w: T - 8, h: T - 6 };
        if (LD.rectHit({ x: p.x + 2, y: p.y + 2, w: p.w - 4, h: p.h - 4 }, box)) return h;
      }
      return null;
    }

    /* 这一格能不能站人（身体 r、头 r-1 空，脚踩 r+1 实心，箱子也算地面）。 */
    canStand(c, r) {
      if (c < 0 || c >= this.cols || r < 1 || r >= this.rows - 1) return false;
      return !this.isSolid(c, r) && !this.isSolid(c, r - 1) && this.isSolid(c, r + 1);
    }

    /* ---------- 台阶分区 / 端点隐藏节点（人机导航用） ----------
       需求原话：「敌人下不来，建议台阶分区，台阶两端做隐藏节点，
       当检测到敌人不在此区域时，利用节点指引前往此区」。

       分区：每块「横着走能互相到达的台面」算一个区 —— 同一行里
       连续可站立的格子归同区，跳一下才能上去 / 走出去会掉下去的算另一个区。
       隐藏节点：区的**两端**（以及任何能跳上去的位置），每个节点记着
       「从这里离开本区会到哪个区」——
         · drop 节点：走出边沿直着往下掉，落到的那个区
         · jump 节点：原地/斜向起跳能站上去的更高台子的区
       人机的用法（见 gunai.js 的 _navStep）：目标不在自己这个区时，
       先朝合适的节点走，到节点后掉下去 / 跳上去，落进新区再重复，
       直到和目标同区开打 —— 这就是「下得来、绕得过」的导航。

       懒计算：第一次被问到才算，结果缓存在 this._nav 上（地形静态）。 */
    gunNav() {
      if (this._nav) return this._nav;
      const standable = (c, r) => this.canStand(c, r);
      /* 1) 横向洪水填充分区 */
      const zoneOf = new Map();       // key -> 区号
      const zones = [];               // 区号 -> [格子 key]
      for (let r = 1; r < this.rows - 1; r++) {
        for (let c = 0; c < this.cols; c++) {
          if (!standable(c, r) || zoneOf.has(ck(c, r))) continue;
          const id = zones.length;
          const cells = [];
          const queue = [[c, r]];
          zoneOf.set(ck(c, r), id);
          while (queue.length) {
            const [qc, qr] = queue.shift();
            cells.push(ck(qc, qr));
            for (const dc of [-1, 1]) {
              const nc = qc + dc;
              if (standable(nc, qr) && !zoneOf.has(ck(nc, qr))) {
                zoneOf.set(ck(nc, qr), id);
                queue.push([nc, qr]);
              }
            }
          }
          zones.push(cells);
        }
      }
      /* 2) 每个区的隐藏节点：端点掉落 + 起跳可及 */
      const nodes = new Map();        // 区号 -> [{c, r, type, dir, to}]
      const addNode = (z, n) => {
        if (!nodes.has(z)) nodes.set(z, []);
        nodes.get(z).push(n);
      };
      for (let z = 0; z < zones.length; z++) {
        for (const key of zones[z]) {
          const c = Math.floor(key / R), r = key % R;
          for (const dc of [-1, 1]) {
            if (standable(c + dc, r)) continue;        // 那边还是本区，不是端点
            /* 行走走廊必须通：端点旁边那格的身体 / 头部高度不能有箱子挡着，
               否则节点是假的 —— 人机走到节点上却被箱子顶住，永远走不出去。 */
            if (this.isSolid(c + dc, r) || this.isSolid(c + dc, r - 1)) continue;
            for (let rr = r + 1; rr <= Math.min(this.rows - 2, r + 9); rr++) {
              if (this.isSolid(c + dc, rr)) break;     // 下落途中撞墙 → 这条出路不通
              if (standable(c + dc, rr)) {
                addNode(z, { c, r, type: 'drop', dir: dc, to: zoneOf.get(ck(c + dc, rr)) });
                break;
              }
            }
          }
          /* jump 节点：能跳上去的更高台子（含 1 格高的箱子顶 / 台阶）。
             「跳上箱子顶」是「绕道往上走」的一条路 —— 和「打碎箱子」并存：
             能绕就绕，绕不了（beeline 撞箱子）就交给打碎。跳跃上限约 3.3 格。 */
          for (let up = 1; up <= 3; up++) {
            const rr = r - up;
            if (rr < 1) break;
            for (const dc of [-1, 0, 1]) {
              if (!standable(c + dc, rr)) continue;
              if (zoneOf.get(ck(c + dc, rr)) === z) continue;
              addNode(z, { c, r, type: 'jump', dir: dc, to: zoneOf.get(ck(c + dc, rr)) });
            }
          }
        }
      }
      this._nav = { zoneOf, nodes };
      return this._nav;
    }

    /* ---------- 距离场（电脑鼠 flood-fill，精确定位用） ----------
       需求原话：「有时我在中间敌人未找到最短路径，建议先找到角色所在阶梯
       再精确位置」。区级 BFS 只能把人机送到「区」，到不了「格」；距离场则
       从玩家脚底那格出发，给**每一个可站立格**算「到玩家的最短步数」，
       人机每帧沿距离递减的邻居走 —— 天然先到玩家所在阶梯、再精确逼近到格。

       邻居（可站立格之间的边）：
         walk  左右横移（同区）
         jump  跳上 1~3 格的台子 / 箱子顶
         drop  走出台沿直落，落到下方最近的台子
       步数是「动作步数」（走一格 1 步、跳/落一次也 1 步），BFS 天然给最短。 */
    flowNeighbors(c, r) {
      const out = [];
      const st = (cc, rr) => this.canStand(cc, rr);
      /* walk 左右 */
      if (st(c - 1, r)) out.push({ c: c - 1, r, kind: 'walk', dir: -1 });
      if (st(c + 1, r)) out.push({ c: c + 1, r, kind: 'walk', dir: 1 });
      /* jump 跳上 1~3 格 */
      for (let up = 1; up <= 3; up++) {
        const rr = r - up;
        if (rr < 1) break;
        for (const dc of [-1, 0, 1]) {
          if (!st(c + dc, rr)) continue;
          /* 起跳路径必须头顶 clear：跳跃经过的列 (c+dc) 在 r-1..rr+1 之间
             不能有实心 —— 否则会撞到台面的底面（例如站在台子正下方想垂直
             跳上台顶，中间那层台面就是实心的，跳不上去只能从台沿外侧斜跳）。 */
          let clear = true;
          for (let k = r - 1; k > rr; k--) {
            if (this.isSolid(c + dc, k)) { clear = false; break; }
          }
          if (!clear) continue;
          out.push({ c: c + dc, r: rr, kind: 'jump', dir: dc });
        }
      }
      /* drop 走出台沿直落 */
      for (const dc of [-1, 1]) {
        if (st(c + dc, r)) continue;                       // 不是端点
        if (this.isSolid(c + dc, r) || this.isSolid(c + dc, r - 1)) continue;   // 走廊被堵
        for (let rr = r + 1; rr <= Math.min(this.rows - 2, r + 9); rr++) {
          if (this.isSolid(c + dc, rr)) break;             // 下落途中撞墙
          if (st(c + dc, rr)) { out.push({ c: c + dc, r: rr, kind: 'drop', dir: dc }); break; }
        }
      }
      return out;
    }

    /* 从 (tx, ty)（脚底坐标）出发算距离场，返回 Map<key, 步数>。
       目标格若不可站立（玩家半空/贴边），就近找一个可站立格起步。
       不可达的格不在 Map 里（人机据此判断「走不到」）。 */
    flowTo(tx, ty, maxDist) {
      const dist = new Map();
      const c = Math.floor(tx / T);
      const r = Math.floor((ty - 4) / T);                  // 身体行
      let start = null;
      if (this.canStand(c, r)) start = { c, r };
      else {
        for (let dr = -1; dr <= 3 && !start; dr++) {
          for (let dc = -2; dc <= 2 && !start; dc++) {
            if (this.canStand(c + dc, r + dr)) start = { c: c + dc, r: r + dr };
          }
        }
      }
      if (!start) return dist;
      dist.set(ck(start.c, start.r), 0);
      const queue = [start];
      const limit = maxDist || 80;
      while (queue.length) {
        const cur = queue.shift();
        const d = dist.get(ck(cur.c, cur.r));
        if (d >= limit) continue;
        for (const nb of this.flowNeighbors(cur.c, cur.r)) {
          const k = ck(nb.c, nb.r);
          if (!dist.has(k)) { dist.set(k, d + 1); queue.push(nb); }
        }
      }
      return dist;
    }

    /* 世界坐标 → 区号。px 是水平位置，feetY 是脚底 y。
       找不到（站在箱子边上 / 半空中这类边缘姿势）返回 -1。 */
    zoneAt(px, feetY) {
      const nav = this.gunNav();
      const c = Math.floor(px / T);
      const r = Math.floor((feetY - 4) / T);           // 脚底上面那格 = 身体所在行
      const z = nav.zoneOf.get(ck(c, r));
      return z === undefined ? -1 : z;
    }

    /* 假方块「碰到就碎」。
       必须在这里（碰撞求解时）碎，不能只靠 _touchTiles：
       _touchTiles 跑在 player.update 之前，看到的是「上一帧结束」的位置，
       而撞到假方块的位移在同一帧里就已经被 _pushTiles 回弹掉了 —— 于是这块假方块
       永远不会碎，变成玩家头顶一块看不见的天花板：起跳被挡回去，底下那个坑就过不去。
       （实测双人 L14：假方块正好压在 1 格坑上方，蓝魔连续 9 次起飞被挡、摔进坑里。）
       现在碰到就直接碎掉并放行，玩家穿过去 —— 这才是「假方块」该有的手感。 */
    breakFake(cx, cy) {
      const ch = this.charAt(cx, cy);
      if (ch !== 'B') return false;
      const key = ck(cx, cy);
      if (this.fakes.has(key)) return false;
      this.fakes.add(key);
      LD.FX.burst(cx * T + T / 2, cy * T + T / 2, 7, '#8b7bd8', 2.4);
      LD.Sfx.trap();
      return true;
    }

    tileSolidAt(px, py) {
      return this.isSolid(Math.floor(px / T), Math.floor(py / T));
    }

    // 覆盖在瓦片之上的可站立实体（移动平台 / 落锤）+ 另一个小人（软实体，可踩头）
    // 作弊模式：落锤算「有伤害的物品」，可以穿过去；移动平台属于台阶，照旧阻挡
    solidRects() {
      const out = this.movers.slice();
      if (!this.cheatMode) {
        for (const c of this.crushers) if (c.state !== 'rise' || c.y > c.home) out.push(c);
      }
      for (const p of this.soft) out.push(p);
      return out;
    }

    setCheat(on) { this.cheatMode = !!on; }

    /* ---------- 每帧更新 ---------- */
    update(dt, players) {
      const list = (Array.isArray(players) ? players : (players ? [players] : [])).filter(Boolean);
      this.time += dt;
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 3.2);
      if (this.doorPulse > 0) this.doorPulse = Math.max(0, this.doorPulse - dt * 2);

      // 移动平台（stall > 0 时「不动了」——这是「移动的地板」类关卡的招牌演出）
      for (const m of this.movers) {
        if (m.stall > 0) { m.stall -= dt; m.dx = 0; m.dy = 0; continue; }
        m.phase += dt * m.speed;
        const nx = m.axis === 'h' ? m.x0 + Math.sin(m.phase) * m.range : m.x0;
        const ny = m.axis === 'v' ? m.y0 + Math.sin(m.phase) * m.range : m.y0;
        // 别把平台开进地形里：站在上面的人会被墙推下去（甚至被挤出世界）。
        // 下一帧如果和实心瓦片重叠就停在原地，等正弦摆回来再继续。
        if (this._rectHitsSolid(nx, ny, m.w, m.h)) { m.dx = 0; m.dy = 0; continue; }
        m.dx = nx - m.x; m.dy = ny - m.y; m.x = nx; m.y = ny;
      }

      // 落锤（对任何一个小人都会砸）
      for (const c of this.crushers) {
        const prevX = c.x, prevY = c.y;
        const cxc = c.x + c.w / 2;
        const near = list.some((p) => Math.abs(p.x + p.w / 2 - cxc) < T * 1.6 && p.y > c.y);
        if (c.state === 'idle') {
          if (near) { c.state = 'shake'; c.t = 0.32; }
        } else if (c.state === 'shake') {
          c.t -= dt;
          if (c.t <= 0) { c.state = 'slam'; c.vy = 4; }
        } else if (c.state === 'slam') {
          c.vy = Math.min(26, c.vy + 3.2);
          c.y += c.vy;
          if (c.y + c.h >= c.ground) { c.y = c.ground - c.h; c.state = 'hold'; c.t = 0.42; this.shake = 1; LD.Sfx.trap(); }
        } else if (c.state === 'hold') {
          c.t -= dt;
          if (c.t <= 0) c.state = 'rise';
        } else if (c.state === 'rise') {
          c.y -= 2.6;
          if (c.y <= c.home) { c.y = c.home; c.state = 'idle'; }
        }
        c.dx = c.x - prevX; c.dy = c.y - prevY;
      }

      // 巡逻守卫 / 飞行怪 / 锯轮
      // 相位用累加而不是「时间 × 速度」，这样中途变速（rush）不会瞬移
      const patrol = (e) => {
        e.phase += dt * e.speed * (e.rush || 1);
        e.dir = Math.cos(e.phase) >= 0 ? 1 : -1;
        e.x = e.x0 + Math.sin(e.phase) * e.range;
      };
      for (const g of this.guards) patrol(g);
      for (const f of this.flyers) { patrol(f); f.y += Math.sin(this.time * 3 + f.phase) * 0.25; }
      for (const s of this.saws) { patrol(s); s.rot += dt * 9; }

      /* ---- 新障碍：激光 / 蒸汽 / 摆锤 / 浮游雷 ----
         四种都是「周期状态机」：关 → 蓄力（看得见的预警）→ 发作 → 冷却。
         发作窗口都不长（激光 1s / 蒸汽 0.9s），玩家有反应时间；
         浮游雷是唯一的常驻追踪型，靠慢速 + 可引爆兜底。 */
      for (const lz of this.lasers) {
        lz.tt += dt;
        const ph = lz.tt % 3.0;
        lz.state = ph < 0.7 ? 'idle' : ph < 1.35 ? 'charge' : ph < 2.35 ? 'fire' : 'cool';
        if (lz.state !== lz.was && lz.state === 'fire') LD.Sfx.trap();
        lz.was = lz.state;
        lz.len = 0;
        if (lz.state === 'fire') {
          // 向右射线：撞到实心就停，最长 8 格（免得横穿整个关卡）
          const row = Math.round(lz.y / T);
          const c0 = Math.round(lz.x / T) + 1;
          let len = 0;
          for (let c = c0; c < Math.min(this.cols, c0 + 8); c++) {
            if (this.isSolid(c, row)) break;
            len++;
          }
          lz.len = len * T;
        }
      }
      for (const gy of this.geysers) {
        gy.tt += dt;
        const ph = gy.tt % 3.2;
        gy.state = ph < 1.4 ? 'idle' : ph < 2.1 ? 'charge' : ph < 3.0 ? 'erupt' : 'cool';
        if (gy.state !== gy.was && gy.state === 'erupt') LD.Sfx.trap();
        gy.was = gy.state;
        gy.h = 0;
        if (gy.state === 'erupt') {
          // 汽柱向上顶到天花板为止，最多 4 格
          const col = Math.round(gy.x / T);
          const r0 = Math.round(gy.y / T);
          let h = 4;
          for (let r = r0 - 1; r >= Math.max(0, r0 - 4); r--) {
            if (this.isSolid(col, r)) break;
            h = r0 - r;
          }
          gy.h = h * T;
        }
      }
      for (const pd of this.pendulums) {
        pd.t += dt * 1.5;
        pd.ang = Math.sin(pd.t) * 0.85;
        pd.bx = pd.x + Math.sin(pd.ang) * pd.L;
        pd.by = pd.y + Math.cos(pd.ang) * pd.L;
      }
      for (const mn of this.mines) {
        if (mn.dead > 0) {
          mn.dead -= dt;
          if (mn.dead <= 0) { mn.x = mn.hx; mn.y = mn.hy; mn.vx = 0; mn.vy = 0; }
          continue;
        }
        mn.blink += dt;
        // 找最近的活人：5 格内慢速追踪，否则飘回巢点
        let best = null, bd = Infinity;
        for (const p of list) {
          if (!p || p.dead) continue;
          const d = Math.abs(p.cx - mn.x) + Math.abs(p.cy - mn.y);
          if (d < bd) { bd = d; best = p; }
        }
        if (best && bd < T * 5.5) {
          const a = Math.atan2(best.cy - mn.y, best.cx - mn.x);
          mn.vx += Math.cos(a) * 0.14;
          mn.vy += Math.sin(a) * 0.14;
        } else {
          mn.vx = mn.vx * 0.96 + (mn.hx - mn.x) * 0.003;
          mn.vy = mn.vy * 0.96 + (mn.hy - mn.y) * 0.003;
        }
        const sp = Math.hypot(mn.vx, mn.vy), MAX = 1.5;
        if (sp > MAX) { mn.vx = mn.vx / sp * MAX; mn.vy = mn.vy / sp * MAX; }
        const nx = mn.x + mn.vx, ny = mn.y + mn.vy;
        // 别飞进墙里：撞墙就原地反弹
        if (this.isSolid(Math.floor(nx / T), Math.floor(ny / T))) { mn.vx *= -0.5; mn.vy *= -0.5; }
        else { mn.x = nx; mn.y = ny; }
      }

      // 易碎砖 / 陷阱地板 / 假方块
      /* 「重新变实心」之前必须确认那一格没有小人。
         否则小人会被嵌进实心里，碰撞求解器为了把它推出来会一瞬间位移一整格 ——
         实测 L21：小人正掉进易碎砖下面的坑，砖的 2.6 秒冷却到点长回来，
         一下子把人横推到 40px 外、塞进旁边的岩层里（看上去就是「小人消失了」）。
         宁可让砖等一会儿再长，也不能长在人身上。 */
      const blockedBy = (key) => this._blockedByPlayer(Math.floor(key / R), key % R, list);
      this.crumble.forEach((st, key) => {
        if (st.gone) {
          st.wait -= dt;
          if (st.wait > 0) return;
          if (blockedBy(key)) { st.wait = 0.25; return; }
          st.gone = false; st.t = -1; return;
        }
        if (st.t >= 0) { st.t -= dt; if (st.t <= 0) { st.gone = true; st.wait = 2.6; } }
      });
      this.trapdoor.forEach((st, key) => {
        if (st.gone) {
          st.wait -= dt;
          if (st.wait > 0) return;
          if (blockedBy(key)) { st.wait = 0.25; return; }
          st.gone = false; st.t = -1; return;
        }
        if (st.t >= 0) { st.t -= dt; if (st.t <= 0) { st.gone = true; st.wait = 2.2; } }
      });
      // 排队等着「长出来」的实心块（被小人占住的那些）
      for (let i = this.pendingSolid.length - 1; i >= 0; i--) {
        const it = this.pendingSolid[i];
        it.age += dt;
        const left = it.cells.filter((c) => this.charAt(c.x, c.y) !== '.' || this._blockedByPlayer(c.x, c.y, list));
        if (left.length) { it.cells = left; if (it.age > 4) this.pendingSolid.splice(i, 1); continue; }
        it.cells.forEach((c) => { this.grid[c.y][c.x] = it.ch; });
        if (it.ttl > 0) this.tempBlocks.push({ cells: it.cells, ttl: it.ttl });
        this.pendingSolid.splice(i, 1);
      }
      for (const p of list) this._touchTiles(p);

      // 塌桥：倒计时结束后整段一起掉下去（3 秒后自己长回来，不会把关卡变成死局）
      for (let i = this.bridgeBreaks.length - 1; i >= 0; i--) {
        const b = this.bridgeBreaks[i];
        b.t -= dt;
        if (b.t > 0) continue;
        for (const k of b.keys) {
          const st = this.crumble.get(k) || this.trapdoor.get(k);
          if (st && !st.gone) { st.gone = true; st.t = -1; st.wait = 3.2; }
        }
        this.shake = Math.max(this.shake, 0.9);
        this.bridgeBreaks.splice(i, 1);
      }

      // 临时墙
      for (let i = this.tempBlocks.length - 1; i >= 0; i--) {
        const tb = this.tempBlocks[i];
        tb.ttl -= dt;
        if (tb.ttl <= 0) {
          tb.cells.forEach((c) => { this.grid[c.y][c.x] = '.'; });
          this.tempBlocks.splice(i, 1);
        }
      }

      // 陷阱事件（任何一个小人踩到都会触发）
      for (const e of this.events) {
        if (e.fired) continue;
        const trig = { x: e.trigger.tx * T, y: e.trigger.ty * T, w: e.trigger.tw * T, h: e.trigger.th * T };
        let inside = false;
        for (const p of list) {
          if (LD.rectHit({ x: p.x, y: p.y, w: p.w, h: p.h }, trig)) { inside = true; break; }
        }
        if (!inside) continue;
        e.fired = true;
        this._fire(e, list);
      }
    }

    _fire(e, list) {
      const who = list || [];
      if (e.type === 'popSpikes') {
        // 地刺不实心，弹出来不会推人，但踩上去就死 —— 这正是「尖刺在前面突然出现」的演出
        e.cells.forEach((c) => { this.grid[c.y][c.x] = '^'; });
        this.shake = Math.max(this.shake, 0.55);
        LD.Sfx.trap();
      } else if (e.type === 'appear') {
        this._solidify(e.cells, '#', 0, who);
        this.shake = Math.max(this.shake, 0.55);
        LD.Sfx.trap();
      } else if (e.type === 'vanish') {
        e.cells.forEach((c) => { this.grid[c.y][c.x] = '.'; });
        this.shake = Math.max(this.shake, 0.8);
        LD.Sfx.trap();
      } else if (e.type === 'tempBlock') {
        this._solidify(e.cells, '#', e.ttl || 1.3, who);
        LD.Sfx.trap();
      } else if (e.type === 'doorMove') {
        if (this.door) { this.door.x = e.to.x * T; this.door.y = e.to.y * T; }
        if (this.door2) this.door2.x = (e.to.x + 1) * T;
        this.doorMoved = true; this.doorPulse = 1;
        this.shake = Math.max(this.shake, 0.5);
        LD.Sfx.trap();
      } else if (e.type === 'moverStall') {
        // 离 trigger 最近的移动平台突然停住
        const near = this._nearest(this.movers, e.atX);
        if (near) { near.stall = e.dur == null ? 1.6 : e.dur; LD.Sfx.trap(); }
      } else if (e.type === 'guardRush') {
        const near = this._nearest(this.guards, e.atX);
        if (near) { near.rush = e.mul == null ? 2.1 : e.mul; LD.Sfx.trap(); }
      } else if (e.type === 'bridgeBreak') {
        const keys = e.cells.map((c) => ck(c.x, c.y));
        this.bridgeBreaks.push({ keys, t: e.delay == null ? 0.7 : e.delay });
        LD.Sfx.trap();
      }
    }

    _nearest(list, atX) {
      let best = null, bd = Infinity;
      for (const m of list) {
        const d = Math.abs(m.x + m.w / 2 - (atX || 0));
        if (d < bd) { bd = d; best = m; }
      }
      return best;
    }

    /* 这一格是不是被某个活着的小人占着（判定盒内缩 1px，免得擦边就算占住）。
       凡是「要把某个格子变实心」的操作都必须先问一句 —— 实心块长在人身上，
       人就会被推出去一整格，那是「小人消失」最隐蔽的一种成因。 */
    _blockedByPlayer(cx, cy, list) {
      if (cx < 0 || cy < 0 || cx >= this.cols || cy >= R) return false;
      const cell = { x: cx * T, y: cy * T, w: T, h: T };
      for (const p of list) {
        if (!p || p.dead) continue;
        if (LD.rectHit({ x: p.x + 1, y: p.y + 1, w: p.w - 2, h: p.h - 2 }, cell)) return true;
      }
      return false;
    }

    /* 让一组格子变实心：空着的立刻长出来，被小人占住的排队等它走开（最多等 4 秒）。 */
    _solidify(cells, ch, ttl, list) {
      const free = [], busy = [];
      for (const c of cells) {
        if (this.charAt(c.x, c.y) === '.' && !this._blockedByPlayer(c.x, c.y, list)) free.push(c);
        else busy.push(c);
      }
      free.forEach((c) => { this.grid[c.y][c.x] = ch; });
      if (ttl > 0 && free.length) this.tempBlocks.push({ cells: free, ttl });
      if (busy.length) this.pendingSolid.push({ cells: busy, ch, ttl: ttl || 0, age: 0 });
    }

    _touchTiles(player) {
      const feetRow = Math.floor((player.y + player.h + 2) / T);
      const c0 = Math.floor(player.x / T), c1 = Math.floor((player.x + player.w - 1) / T);
      for (let c = c0; c <= c1; c++) {
        const key = ck(c, feetRow);
        const ch = this.charAt(c, feetRow);
        if (ch === 'X') { const st = this.crumble.get(key); if (st && !st.gone && st.t < 0) st.t = 0.34; }
        else if (ch === 'T') { const st = this.trapdoor.get(key); if (st && !st.gone && st.t < 0) st.t = 0.56; }
        else if (ch === 'B') this.fakes.add(key);
      }
      // 侧面撞到假方块也会碎
      const r0 = Math.floor(player.y / T), r1 = Math.floor((player.y + player.h - 1) / T);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const ch = this.charAt(c, r);
          if (ch === 'B') this.fakes.add(ck(c, r));
        }
      }
    }

    /* ---------- 致死判定：返回命中的危险矩形 ----------
       元素池按角色判免疫：火池只溶蓝魔、水池只溶红魔、酸池两人都溶。
       地刺 / 守卫 / 锯轮 / 落锤对谁都有害。 */
    hazardHit(p) {
      if (p.invincible) return null;
      const box = { x: p.x + 3, y: p.y + 3, w: p.w - 6, h: p.h - 6 };
      const c0 = Math.floor(box.x / T) - 1, c1 = Math.floor((box.x + box.w) / T) + 1;
      const r0 = Math.floor(box.y / T) - 1, r1 = Math.floor((box.y + box.h) / T) + 1;
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const ch = this.charAt(c, r);
          if (ch === '.') continue;
          const x = c * T, y = r * T;
          let hit = null, elem = null;
          if (ch === '^') hit = { x: x + 5, y: y + 12, w: T - 10, h: T - 12 };
          else if (ch === 'v') hit = { x: x + 5, y, w: T - 10, h: T - 12 };
          else if (ch === '<') hit = { x, y: y + 5, w: T - 12, h: T - 10 };
          else if (ch === '>') hit = { x: x + 12, y: y + 5, w: T - 12, h: T - 10 };
          else if (ch === 'O') { hit = { x: x + 2, y: y + 6, w: T - 4, h: T - 6 }; elem = 'acid'; }
          else if (ch === '~') { hit = { x: x + 2, y: y + 8, w: T - 4, h: T - 8 }; elem = 'fire'; }
          else if (ch === '_') { hit = { x: x + 2, y: y + 8, w: T - 4, h: T - 8 }; elem = 'water'; }
          if (!hit) continue;
          if (!LD.rectHit(box, hit)) continue;
          if (elem && !p.killsBy(elem)) continue;
          return Object.assign({ elem }, hit);
        }
      }
      const ents = this.guards.concat(this.flyers, this.saws, this.crushers);
      for (const e of ents) { if (LD.rectHit(box, e)) return { x: e.x, y: e.y, w: e.w, h: e.h }; }
      /* ---- 新障碍的致死判定 ---- */
      // 激光：只在「发射」状态致命，且是看得见的光束（蓄力时会闪，给反应时间）
      for (const lz of this.lasers) {
        if (lz.state !== 'fire' || !lz.len) continue;
        const beam = { x: lz.x + T, y: lz.y + T / 2 - 7, w: lz.len, h: 14 };
        if (LD.rectHit(box, beam)) return { x: beam.x, y: beam.y, w: beam.w, h: beam.h };
      }
      // 蒸汽喷发：只在「喷发」状态致命
      for (const gy of this.geysers) {
        if (gy.state !== 'erupt' || !gy.h) continue;
        const col = { x: gy.x + 7, y: gy.y - gy.h, w: T - 14, h: gy.h + 12 };
        if (LD.rectHit(box, col)) return { x: col.x, y: col.y, w: col.w, h: col.h };
      }
      // 摆锤：锤球
      for (const pd of this.pendulums) {
        const ball = { x: pd.bx - pd.ball, y: pd.by - pd.ball, w: pd.ball * 2, h: pd.ball * 2 };
        if (LD.rectHit(box, ball)) return ball;
      }
      // 浮游雷：碰到就炸（雷本身消失 6 秒）
      for (const mn of this.mines) {
        if (mn.dead > 0) continue;
        const mb = { x: mn.x - mn.r, y: mn.y - mn.r, w: mn.r * 2, h: mn.r * 2 };
        if (LD.rectHit(box, mb)) {
          mn.dead = 6; mn.vx = 0; mn.vy = 0;
          LD.FX.burst(mn.x, mn.y, 22, '#ff9d3f', 5);
          LD.FX.burst(mn.x, mn.y, 10, '#ffd23f', 3.4);
          if (LD.Sfx && LD.Sfx.trap) LD.Sfx.trap();
          return mb;
        }
      }
      return null;
    }

    doorHit(p, which) {
      const d = which === 'blue' ? this.door2 : this.door;
      if (!d) return false;
      const box = { x: p.x + 4, y: p.y + 4, w: p.w - 8, h: p.h - 8 };
      return LD.rectHit(box, d);
    }

    fellOut(p) { return p.y > this.pxH + 60; }
  };
})();
