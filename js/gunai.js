/* gunai.js — 枪战模式的人机（Bot）

   需求原文（决定这一整个模块的形态）：
     · 人机要可以自己判断小人位置
     · 小人枪械没有自动瞄准，统一平射，主要看玩家跳跃攻打

   所以 AI 的核心不是「瞄准」，而是「判断」与「走位」：
     1) 感知：知道敌人在自己的左边还是右边、高了还是低了、离多远、中间有没有掩体
     2) 决策：走位（追/退/占高台）、跳跃（跨过掩体、跳上台阶、躲子弹）
     3) 开火：枪口是水平的 —— 只有当「敌人在同一水平线上」时才真的打得中，
        否则子弹会从对方头顶飞过去 / 打在台阶上。这就是玩家能靠跳跃躲子弹的原因。

   Bot 身上的字段（由 gunroom.js 的 botPlan 给初值）：
     c, r      出生的格子（站在这格的地面上）
     level     0~120 的强度（关卡进度 × 100，高台上的 +12，再加一点随机）
     elite     是否精英（血量更高、反应更快）
     weapon    用什么枪

   强度（level）怎么影响行为 —— 这是「人机越来越厉害」的唯一旋钮：
     反应时间  react   0.85s → 0.14s     （越强越快发现你 / 越快扣扳机）
     瞄准容差  aimTol  0.75 格 → 0.06 格  （越强越接近完美平射）
     走位      mote    基本站着 → 会绕、会占高台、会躲
     血量      hp      40 → 100
     换弹       弱的人机换弹慢、强的人机几乎无缝
*/
(function () {
  const T = LD.TILE;

  /* 强度参数曲线。lvl 已经归一到 0~1。 */
  function tune(lvl) {
    const k = LD.clamp(lvl, 0, 1);
    return {
      react: LD.lerp(0.65, 0.14, k),          // 发现目标后多久才开第一枪——下限降低，反应更快
      retarget: LD.lerp(1.0, 0.2, k),         // 重新判断战场的间隔——缩短，反应更快更「会应变」
      aimTol: LD.lerp(0.78, 0.06, k),         // 垂直容差（格）：越大越打不准
      hp: Math.round(LD.lerp(40, 100, k)),
      spd: LD.lerp(1.9, 3.6, k),              // 水平移速（像素/帧）——下限提高，弱敌人也不再是固定靶
      jumpP: LD.lerp(0.22, 0.72, k),          // 主动起跳的概率（跳台阶 / 躲子弹）
      dodge: LD.lerp(0.1, 0.7, k),           // 看到子弹飞来时横向闪避的概率
      strafe: LD.lerp(0.22, 0.85, k),         // 交火时左右晃动而不是站桩——下限提高，弱敌人也会走动
      seekHigh: LD.lerp(0.1, 0.65, k),        // 主动去抢高台的概率
      reloadSk: LD.lerp(1.5, 0.25, k),        // 换弹的「手速」倍率（越大越慢）
      lead: LD.lerp(0, 9, k),                 // 预判提前量（像素）—— 强人机会打你跑动的前方
      burst: Math.round(LD.lerp(1, 5, k)),    // 连发几发后停一下
    };
  }

  /* 一个 Bot 的运行时状态 */
  class Bot {
    constructor(plan, world, index) {
      this.plan = plan;
      this.index = index;
      this.kind = 'ai';
      this.team = 'ai';
      this.w = 22; this.h = 28;
      this.x = plan.c * T + (T - this.w) / 2;
      this.y = plan.r * T - this.h;             // 站在 r 行的地面上
      this.vx = 0; this.vy = 0;
      this.face = -1;                           // 朝左（面向玩家一侧）
      this.grounded = true;
      this.walk = 0;
      this._airDir = 0;                         // 滞空横向承诺（起跳瞬间锁定）
      this.airJumps = 0; this.airJumpT = 0;     // 空中跳次数 / 最小间隔（无限跳）
      this.alpha = 1;
      this.squash = 0;
      this.hurtFx = 0;
      this.dead = false;
      this.deathT = 0;
      /* 训练场专用开关（关卡 / 无尽 / 对枪里永远是 false，行为完全不变）：
           frozen   站着不动（决策停摆，物理与开火照常）
           noAttack 一枪不开 */
      this.frozen = false;
      this.noAttack = false;

      this.norm = LD.clamp(plan.level / 100, 0, 1);
      this.t = tune(this.norm);
      this.hp = this.t.hp;
      this.maxHp = this.hp;
      this.elite = !!plan.elite;
      if (this.elite) { this.hp = Math.round(this.hp * 1.35); this.maxHp = this.hp; }

      this.gun = new LD.Guns.GunState(this);
      this.gun.weaponId = plan.weapon && LD.Guns.byId[plan.weapon] ? plan.weapon : 'pistol';
      this.gun.forgiving = this.norm < 0.4;      // 弱人机不吃换弹惩罚

      // 感知
      this.target = null;                        // 当前锁定的敌人
      this.seen = 0;                             // 连续看见目标的时间
      this.reactT = 0;                           // 还要等多久才肯开第一枪
      this.thinkT = 0;
      this.aimDir = this.face;
      this.aimTolNow = 0;                        // 本次判定的垂直偏差点
      this.strafeDir = Math.random() < 0.5 ? -1 : 1;
      this.strafeT = 0;
      this.jumpCd = 0;
      this.losT = 0;                             // 「找视线」方向锁的剩余时间
      this.losDir = 0;                           // 当前执念方向（±1）
      this._stuckT = 0;                          // 顶着整面高墙卡住多久（超时换边）
      this._detourT = 0;                         // 「绕道」状态的剩余时间（>0 = 正在绕墙走）
      this._detourDir = 0;                       // 绕道方向（±1，朝这个方向持续走，绕过障碍）
      /* 起跳承诺：起跳那一刻的横向意图，整个滞空期间保持不变，落地才清。
         没有它的话，人机一跳起来「离目标太近 → 后撤」就会立刻反向加速，
         横向速度被抵消 —— 结果是原地垂直蹦一下再掉回原处，
         看起来像在台边弹跳，永远上不去（台边 / 台底两种情况都栽在这里）。 */
      this._airDir = 0;
      this.airJumps = 0; this.airJumpT = 0;      // 空中跳次数 / 最小间隔（无限跳）
      this._climb = null;
      this.burstLeft = this.t.burst;
      this.burstPause = 0;
      this.home = { x: this.x, y: this.y };
      this.lastHurt = 0;
      this.flash = 0;
      /* 台阶分区导航（见 _navStep）与卡住检测（见 _stuckCheck） */
      this._navNode = null;          // 当前正要去的隐藏节点
      this._navMove = 0;             // 导航给出的横向意图
      this._navJump = false;         // 导航要求起跳（jump 节点到位时）
      this._navGoal = null;          // 锁定的导航目标（节点 / beeline），换区前不重选
      this._navGoalZone = -1;        // 规划目标时自己所在的区
      this._navWallT = 0;            // beeline 撞墙（非箱子）累计时长，超时换边
      this._flow = null;             // 距离场（到玩家的最短步数 Map<key,步数>）
      this._flowAt = null;           // 距离场对应的目标位置快照 {x,y}
      this._stillT = 0;              // 连续静止多久（秒）
      this._lastX = this.x; this._lastY = this.y;
      this._stuckAct = null;         // 本轮卡住的对策：'jump' | 'break'
      this._stuckActT = 0;           // 对策的持续时间
      this._jumpFailed = false;      // 「跳过箱子」失败过 → 下次强制打碎
    }

    get cx() { return this.x + this.w / 2; }
    get cy() { return this.y + this.h / 2; }
    get box() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }

    /* 中枪 */
    hurt(dmg) {
      if (this.dead) return false;
      this.hp -= dmg;
      this.hurtFx = 1;
      this.flash = 1;
      this.lastHurt = 0.6;
      if (this.hp <= 0) { this.kill(); return true; }
      return false;
    }
    kill() {
      if (this.dead) return false;
      this.dead = true;
      this.deathT = 0.5;
      this.vy = -6;
      return true;
    }

    /* ---------- 感知：判断敌人在哪 ----------
       返回 {tx, ty, dx, dy, dist, los} 或 null。
       los（line of sight）= 水平方向上有没有一堵实心墙把两个人隔开。
       注意：AI 只看「活着、且自己队伍之外」的目标。 */
    sense(world, foes) {
      let best = null;
      for (const f of foes) {
        if (!f || f.dead) continue;
        const dx = (f.cx - this.cx);
        const dy = (f.cy - this.cy);
        const dist = Math.abs(dx);
        const los = this.lineClear(world, f);
        // 看得见的优先；同样的，近的优先
        const score = dist - (los ? 400 : 0) + (f.__player && f.__player ? -80 : 0);
        if (!best || score < best.score) best = { foe: f, dx, dy, dist, los, score };
      }
      if (!best) return null;
      const b = best;
      return {
        foe: b.foe, tx: b.foe.cx, ty: b.foe.cy,
        dx: b.dx, dy: b.dy, dist: b.dist, los: b.los,
        towards: b.dx >= 0 ? 1 : -1,
      };
    }

    /* 视线：从自己胸口到目标胸口做一条二维连线（Bresenham 采样），
       中间任何一格实心（墙 / 高台 / 木箱）都算「看不见」。
       这是「小人没看到敌人、敌人就不能打」的关键：
       原来只沿自己胸口高度的水平线采样，玩家站在高台上方（或正下方）时，
       这条水平线常常是通的，敌人就能隔层打到完全没露头的玩家。
       现在改成立体的视线 —— 高台边缘、地板都会实实在在地挡视线。 */
    lineClear(world, foe) {
      const ax = this.cx, ay = this.cy;              // 自己胸口
      const bx = foe.cx, by = foe.cy;                // 目标胸口
      const dx = bx - ax, dy = by - ay;
      const dist = Math.hypot(dx, dy);
      if (dist < 6) return true;                     // 贴脸必通
      const steps = Math.ceil(dist / 6);             // 每 6px 采一次（更密，更容易发现阻挡）
      let prevC = -1, prevR = -1;
      for (let i = 1; i < steps; i++) {
        const px = ax + (dx * i) / steps;
        const py = ay + (dy * i) / steps;
        const c = Math.floor(px / T), r = Math.floor(py / T);
        if (c === prevC && r === prevR) continue;    // 同一格只判一次
        prevC = c; prevR = r;
        if (world.isSolid(c, r)) return false;
      }
      return true;
    }

    /* ---------- 开火判定：统一平射 ----------
       「没有自动瞄准」= 枪口固定水平。子弹从 gunY()（胸口高度）水平飞出去，
       只要目标的身体盒子和这条水平线相交，就算「打得中」。
       所以容差不是拍脑袋给的格数，而是**由双方身高推出来的物理量**：
         目标身体中心到胸口的高度 + 子弹半径，就是允许的垂直偏差上限。
       ------------------------------------------------------------------
       【曾经的 bug，也是「人机老不打人」的根因】
       旧代码：`if (Math.abs(s.dy) / T > this.t.aimTol + 0.35) return false;`
       其中 aimTol 只有 0.06 ~ 0.78 格，而 dy 是「两个小人中心的高度差」——
       实测：玩家和人机稍微站高一点点，dy 就到 0.5~2 格，直接被判成打不中。
       结果 **前 30 关人机一枪都不开**（20 秒 0 发），40 关才偶尔开两枪，
       整局下来玩家根本感受不到有人机在打你。
       现在改成：容差 =（目标半身高 + 子弹半径）/ 一格，再乘一个「越强越稳」的系数。
       站同一地面时 dy≈0 必中；站在不同台阶上也有大把机会打中（这才是正常交火）。 */
    canShootAt(world, s) {
      if (!s || !s.los) return false;
      if (this.gun.weapon().kind !== 'gun') return false;
      /* 目标身体盒的中心到「水平弹道」的距离：这就是真正要吃的垂直偏差。
         （弱人机不额外罚，强人机也不会因为站得略高就不打 —— 见上面的教训） */
      const bodyHalf = (s.foe && s.foe.h ? s.foe.h : 28) * 0.5;
      const slack = bodyHalf + 6;                   // 子弹半径 + 一点判定的宽容
      /* aimTol 越大 = 越保守（要求对得更齐）；映射到 0.55~1.0 的宽容系数，
         保证任何强度的机器人在「身体大致齐平」时都会开火。 */
      const k = LD.clamp(0.55 + this.t.aimTol * 0.6, 0.55, 1.0);
      const tolPx = slack * k;
      if (Math.abs(s.dy) > tolPx) return false;
      // 枪口到目标之间必须真的通（子弹要从枪口位置水平飞出去）
      const gy = this.gunY();
      const x0 = Math.min(this.cx, s.tx) + 3;
      const x1 = Math.max(this.cx, s.tx) - 3;
      for (let x = x0; x <= x1; x += 10) {
        if (world.tileSolidAt(x, gy)) return false;
      }
      /* 目标身体带（gy ± tolPx）里也要有一条通路。
         只差一点点的时候，人机会主动「蹲/站」调整 —— 这里简化为允许开火，
         子弹自然会在目标身上判定，不必强求完美对齐。 */
      return true;
    }

    /* 枪口高度：和小人渲染时的持枪位置对齐 */
    gunY() { return this.y + this.h * 0.42; }

    /* ---------- 每帧 ---------- */
    update(dt, world, ctx) {
      const f = dt * 60;
      if (this.hurtFx > 0) this.hurtFx = Math.max(0, this.hurtFx - dt * 2.4);
      if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3);
      if (this.lastHurt > 0) this.lastHurt = Math.max(0, this.lastHurt - dt);
      if (this.dead) {
        this.deathT -= dt;
        // 死了也往下掉一点，看起来像倒下
        this.vy = Math.min(this.vy + 0.9 * f, 17);
        this._move(world, 'y', this.vy * f);
        return;
      }
      this.gun.update(dt);
      if (this.jumpCd > 0) this.jumpCd -= dt;
      if (this.burstPause > 0) this.burstPause -= dt;

      /* 【这里原来有一句致命的代码，已删除】
           if (this.gun.reloadT < w.reload * 0.02) this.gun.reloadT = 0;
         它的本意是「用额外拖长/缩短模拟换弹手速」，但实际效果是：
         GunState.update() 只在「进入时 reloadT > 0 且这一帧减到 0」时才把弹匣回填，
         而外部把 reloadT 直接写成 0 会让那一帧的 `if (reloadT > 0)` 不成立 ——
         回填被永久跳过，弹匣锁死在 0，人机**打完第一个弹匣就再也不开枪**。
         （实测：弱/中/强三档人机全部如此，7 发手枪弹匣打空后 10 秒仍是 0 发。）
         手速现在改成由 startReload(noAmmo, reloadSk) 的倍率参数表达，见下面 _shoot。 */

      this.thinkT -= dt;
      if (this.thinkT <= 0) {
        this.thinkT = this.t.retarget;
        this.target = this.sense(world, ctx.foes);
        if (this.target) {
          this.aimDir = this.target.towards;
          if (this.seen <= 0) this.reactT = this.t.react;
        } else {
          this.seen = 0;
        }
      }
      /* 目标锁定每 retarget 秒刷新一次（省性能、也让 AI 看起来有「注意力」）。
         但**视线 los 必须每帧实时重算**：
         这里踩过一个很隐蔽的坑 —— this.target 是快照，如果某一帧被柱子挡住，
         就把 los:false 缓存下来最多 1.6 秒。而 canShootAt 只认这个缓存的 los，
         于是「明明已经走到能打了，还是不开枪」。这也正是第 10 关那种
         「反应=0、有弹、能打，却一枪不开」的真相。 */
      if (this.target) {
        const fresh = this.sense(world, ctx.foes);
        if (fresh) {
          this.target.los = fresh.los;
          this.target.dist = fresh.dist;
          this.target.dy = fresh.dy;
          /* 方向（玩家在左还是右）也实时跟上 —— 玩家一个箭步绕到身后时，
             人机不能还傻盯着旧方向，这才是「随机应变」。 */
          this.target.towards = fresh.towards;
          this.target.dx = fresh.dx;
        }
        else this.target.los = false;
      }
      /* 「找视线」卡住计时（放在 los 刷新之后，读到的才是本帧的真实视线）：
         只要这一帧有目标却没视线就累计；看见或没目标立刻清零。走位段用它判断「该换边了」。 */
      this._stuckT = (this.target && !this.target.los) ? this._stuckT + dt : 0;
      if (this.target && this.target.los) this.losT = 0;
      const s = this.target || this.sense(world, ctx.foes);
      if (s) {
        this.seen += dt;
        this.face = s.towards;
      } else {
        this.seen = 0;
        this.reactT = 0;
      }
      if (this.reactT > 0) this.reactT = Math.max(0, this.reactT - dt);

      // ---- 走位 ----
      let move = 0;
      let jumpForLos = false;
      this._climb = null;              // 本帧「要上哪个台子」（走位段算，跳跃段用）
      /* 训练场的「敌人静止」开关（见 game.js 的 _trainingKey）。
         冻结的是**决策**，不是整个 update：物理、换弹、开火照跑，
         所以它是一排「站着不动的靶子」，而不是被定格的雕像。
         如果连重力都停掉，把敌人冻在半空会像卡了 bug。 */
      if (this.frozen) {
        this.vx = 0;
      } else if (s) {
        const dist = s.dist;
        const ideal = LD.lerp(150, 250, this.norm);       // 想保持的交火距离
        /* 【台阶分区导航】目标不在这块台面上（看不见 / 一高一低）→
           别再贴墙打摆子：先沿「隐藏节点」走到台子两端，掉下去或跳上去，
           一区一区接力过去（节点与分区见 world.gunNav）。
           导航期间，下面的晃动 / 防坠台 / 下台追击 / 抢高台全部让路 ——
           否则刚要下台就被「别把自己晃下去」拉回来，永远下不来。 */
        const navActive = this._navStep(world, s, dt, ctx);
        if (navActive) {
          move = this._navMove;
          if (this._navJump) jumpForLos = true;
          this._detourT = 0;               // 导航时旧的绕道状态必须清掉，别跟导航抢方向盘
        } else if (!s.los) {
          /* 看不见目标（中间有墙 / 柱子 / 高台 / 木箱）→ 既要会翻越，也要会绕道。
             旧逻辑只按水平方向逼近，遇到跨层的高台或整面墙就只会贴墙打摆子，
             永远绕不过去 —— 这正是「敌人在高台上、我在高台下，他下不来」的病根。
             现在的策略：
               ① 正常情况下朝目标方向靠近 + 贴墙翻越（矮墙 / 木箱 / 低台）
               ② 被整面高墙挡住、长时间过不去 → 进入「绕道」：朝一个方向
                  持续走一大段，绕到墙的尽头 / 平台的缺口，再回头逼近
               ③ 目标在高处 → 优先找台子爬上去；目标在低处 → 主动走下台 / 找缺口 */
          /* 绕道状态：朝 _detourDir 持续走，途中不看目标、不换边，直到走出障碍 */
          if (this._detourT > 0) {
            this._detourT -= dt;
            move = this._detourDir;
            /* 绕行途中撞到墙（前面又是死胡同）→ 反向绕，别一条道走到黑 */
            const rx = this.cx + this._detourDir * (this.w / 2 + 6);
            const wallLo = world.tileSolidAt(rx, this.y + this.h - 6);
            const wallHi = world.tileSolidAt(rx, this.y + this.h - 20);
            if (wallLo && wallHi) {
              /* 前面是整面墙：优先翻过去（能跳上去的矮墙 / 台子），翻不过就反向绕 */
              const L = scanLedge(world, this, this._detourDir);
              if (L.up > 0 && L.dist < 34 && this._headClear(world)) {
                jumpForLos = true;
              } else {
                this._detourDir = -this._detourDir;
                this._detourT = LD.lerp(1.8, 0.9, this.norm);
              }
            } else if (wallLo && !wallHi) {
              /* 下方被挡、上方空：说明是能跳上去的低台 / 木箱，跳过去绕 */
              jumpForLos = Math.random() < 0.55 + this.t.jumpP * 0.45;
            }
            /* 绕行中重新看到目标 → 立即结束绕行，切回正常追击 */
            if (s.los) this._detourT = 0;
          } else {
            this.losT -= dt;
            if (this.losT <= 0) {
              this.losT = LD.lerp(1.4, 0.6, this.norm);
              this.losDir = Math.random() < 0.75 ? s.towards : -s.towards;
            }
            move = this.losDir || s.towards;
            const reachX = this.cx + move * (this.w / 2 + 6);
            const blockedMid2 = world.tileSolidAt(reachX, this.y + this.h - 6);
            const blockedHi = world.tileSolidAt(reachX, this.y + this.h - 20);
            if (blockedMid2) {
              jumpForLos = Math.random() < 0.35 + this.t.jumpP * 0.55;
              /* 跳不上去的整面高墙（上方也实心）→ 先原地换边，再换不掉就绕道 */
              if (blockedHi) {
                if (this._stuckT > LD.lerp(0.5, 0.2, this.norm)) {
                  /* 绕道：朝「离开目标的方向」走（绕到墙的另一端再回来）。
                     如果目标在上方，绕行时优先找能上的台子；在下方则找缺口下。
                     时长拉长、阈值降低 —— 让绕道更早触发、绕得更远更彻底。 */
                  this._detourDir = -s.towards;
                  if (Math.random() < 0.5) this._detourDir = -this._detourDir;
                  this._detourT = LD.lerp(2.4, 1.2, this.norm);
                  this._stuckT = 0;
                }
              } else {
                this.losDir = -move;
              }
            }
            /* 快到贴脸（中间那一格一定实心）时还是没视线 → 主动退开换个台阶再打 */
            if (dist < this.w + 14) move = -s.towards;
          }
        } else if (dist > ideal * 1.25) {
          move = s.towards;                                // 太远 → 逼近
        } else if (dist < ideal * 0.55) {
          move = -s.towards;                               // 太近 → 后撤
        } else move = 0;                                   // 距离合适 → 原地对射
        /* 以下这些「战斗走位」在导航期间全部停用：导航是赶路，打架是打架。 */
        if (!navActive) {
        /* 血量见底（<35%）就拉开距离打游击：不再恋战站桩，
           往反方向退一段再回头 —— 这是「会随机应变」的另一个体现。 */
        const hpRatio = this.maxHp > 0 ? this.hp / this.maxHp : 1;
        if (hpRatio < 0.35 && this.t.dodge > 0.25) {
          move = -s.towards;
          if (Math.random() < this.t.dodge * 0.4) jumpForLos = true;
        }
        /* 交火时左右晃动：站桩的人机太好打了，稍微动一动才像在「打」。
           门槛从 0.3 降到 0 —— 弱人机也会晃，只是晃得没那么勤。 */
        if (true) {
          this.strafeT -= dt;
          if (this.strafeT <= 0) {
            this.strafeT = 0.4 + Math.random() * 0.8;
            this.strafeDir = Math.random() < 0.5 ? -1 : 1;
          }
          if (Math.random() < this.t.strafe * 0.25) move += this.strafeDir * 0.7;
        }
        /* 「随机应变」的核心：刚挨了一枪就立刻换位，别傻站着继续对射。
           lastHurt 在 hurt() 里被置 0.6s，这里检测到「这一帧刚被打」就：
           ① 立刻反转左右晃动方向（打断原来的规律节奏）
           ② 有概率横向拉开一段 + 起跳躲避（强度越高越会躲）
           这样人机就不会被玩家「原地连点」活活打死。 */
        if (this.lastHurt > 0.55) {
          this.strafeDir = -this.strafeDir;
          const dodge = Math.random() < 0.4 + this.t.dodge * 0.5;
          if (dodge) {
            move = this.strafeDir;
            if (this.t.jumpP > 0.3 && Math.random() < this.t.jumpP) jumpForLos = true;
          }
        }
        /* 站在台子上时别把自己晃下去：脚下一行、身前那一格是空的就别往那边走
           （除非目标明显在下方 —— 那才该主动下去追击，见下面的「下台追击」）。
           没有这条，人机刚跳上高台就会被上面的「左右晃动」直接晃下台，看着像白跳。 */
        if (this.grounded && move !== 0) {
          const feetRow = Math.floor((this.y + this.h + 1) / T);
          const onPlat = world.rows ? feetRow < world.rows - 2 : false;
          /* 目标明显在下方（dy > 0.8 格）时**不**阻止移动：放敌人下台追击。 */
          const targetBelow = s.dy > T * 0.8;
          if (onPlat && !targetBelow && s.dy > -T * 0.5) {
            const ax = this.cx + (move > 0 ? 1 : -1) * (this.w / 2 + 10);
            if (!world.isSolid(Math.floor(ax / T), feetRow)) move = 0;
          }
        }
        /* 下台追击：目标在自己下方一截（0.8 格以上，比原来 1.2 更敏感）且距离还
           够不着平射，就朝目标那一侧主动走，走到台边自然掉下去追——不再在高台上干站着。
           强度越高越果断。 */
        if (this.grounded && s.dy > T * 0.8 && s.dist > this.w + 20) {
          move = s.towards;
          /* 脚下就是台边、前方是空的：给一点「跳下去」的果断（跨过小落差更快追上）。
             概率上调，让「下台」更利落。 */
          const edgeX = this.cx + s.towards * (this.w / 2 + 12);
          const edgeCol = Math.floor(edgeX / T);
          const feetRow = Math.floor((this.y + this.h + 1) / T);
          if (!world.isSolid(edgeCol, feetRow) && Math.random() < 0.4 + this.t.jumpP * 0.5) {
            jumpForLos = true;
          }
        }
        /* 抢高台 / 爬上台阶。放在「距离合适 → 原地对射」之后，会**覆盖**站桩判断：
           够不着就不该站桩。
           两条触发：
             ① 目标比自己高出一截（0.6 格以上）→ 必须上去。子弹统一平射，
                站在台子底下抬头也打不着，只会单方面挨打；
             ② 高强度人机随机想抢制高点（原来的 seekHigh 战术，只是这次真的会跳）。 */
        const wantClimb = s.dy < -T * 0.5 || Math.random() < this.t.seekHigh * 0.06;
        if (wantClimb) {
          if (this.grounded && !this._headClear(world)) {
            /* 头顶就是台面（人站在高台底下）→ 往上跳只会撞脑袋，先横着退出去。
               不退的话人机会一直贴在台子下面「抬头挨打」。 */
            move = -s.towards;
          } else {
            const L = scanLedge(world, this, s.towards);
            if (L.up > 0) {
              /* 空中也要保持「朝台子那一侧」的横向意图。
                 这里踩过一个坑：起跳之后 `wantClimb` 不再算数（跳跃要求 grounded），
                 走位就退回「离目标太近 → 后撤」——于是刚起跳的横向速度被立刻抵消，
                 人机垂直蹦起来、又原样落回地面，看起来像在台边弹跳而不上去。 */
              move = s.towards;
              if (this.grounded) this._climb = { up: L.up, dist: L.dist, dir: s.towards };
            } else if (!this.grounded) {
              move = s.towards;         // 已经跳了、台子扫不到了 → 别半路刹车
            }
          }
        }
        } /* end if (!navActive) */
      } else {
        // 没目标：慢慢往地图中线挪，别一直杵在出生点
        const mid = world.pxW / 2;
        move = this.cx < mid - 40 ? 1 : (this.cx > mid + 40 ? -1 : 0);
      }
      /* 绕道兜底：正在绕墙走的时候，无视上面所有「朝目标逼近 / 后撤 / 下台追击 /
         抢高台」的覆盖，坚持朝绕行方向走 —— 否则那些分支一跑，绕道就被抵消，
         敌人又贴回墙上打摆子。绕行中重新看到目标（los 恢复）会在上面把 _detourT
         清零，这里自然退出绕道。 */
      if (this._detourT > 0 && this.grounded) move = this._detourDir;
      /* 滞空承诺：起跳那一刻定下的横向意图，在空中一路保持到落地。
         这一步必须放在**所有**走位判断之后 —— 上面那些「太近就后撤 /
         无视线就换边」的分支飞在空中的时候照样会跑，一跑就把起跳的横向速度抵消掉，
         人机就成了「原地蹦一下又落回原处」（台边 / 台底两边都上不去的原因）。 */
      if (!this.grounded && this._airDir) move = this._airDir;
      /* 【卡住检测】脚在地上、位置 1 秒几乎没动 → 大概率被箱子（或别的障碍）顶死。
         需求原话：「检测敌人静止，则判定敌人被箱子阻挡，此时跳过去或击打」。
         对策二选一（每轮卡住只定一次，不来回摇摆）：跳过去，或开枪把箱子打碎。 */
      if (!this.frozen && this.grounded) {
        const stuck = this._stuckCheck(dt, world, ctx, s);
        if (stuck === 'jump') {
          move = this.face || (s ? s.towards : 1);
          jumpForLos = true;
          this.jumpCd = 0;                 // 卡住时起跳冷却不许拦路
        }
      }
      move = LD.clamp(move, -1, 1);

      const spd = this.t.spd * (this.dead ? 0 : 1);
      const accel = this.grounded ? 0.85 : 0.45;
      if (move !== 0) {
        this.vx += move * accel * f;
        this.vx = LD.clamp(this.vx, -spd, spd);
        if (move !== 0) this.face = move > 0 ? 1 : -1;
      } else if (this.grounded) {
        this.vx *= Math.pow(0.72, f);
        if (Math.abs(this.vx) < 0.06) this.vx = 0;
      }

      // ---- 跳跃：跨掩体 / 上台阶 / 躲子弹（需求：主要看玩家跳跃攻打）----
      let wantJump = false;
      if (!this.frozen && this.grounded) {
        if (this.jumpCd <= 0) {
          /* 脚前有台面、且台沿就在跟前 → 跳上去（台阶 / 高台 / 木箱顶通用）。
             这里取代了原来的 `blockedMid && !blockedLow`：那条要求「障碍顶面落在
             脚底往上 6~18px」，40px 的格子对齐之后根本取不到，
             等于这条判定从来没生效过（详见 scanLedge 的注释）。 */
          const L = scanLedge(world, this, this.face);
          if (L.up > 0 && L.dist < 30 && this._headClear(world)) wantJump = true;
          // 无视线时贴墙 → 主动起跳翻越（上面走位段给的信号）
          if (jumpForLos) wantJump = true;
          // 目标在自己头顶上方 → 原地试跳（躲它的子弹 / 说不定能踩上什么）
          if (s && s.dy < -T * 0.8 && Math.random() < this.t.jumpP * 0.18) wantJump = true;
          // 有子弹朝自己飞来 → 跳起来躲（弱人机不太会）
          if (this.threatened(world, ctx.bullets) && Math.random() < this.t.dodge) wantJump = true;
        }
        /* 上台阶 / 上高台：**无视起跳冷却**。
           冷却本来是为了防「原地连跳」，可贴到台沿那一刻是稍纵即逝的窗口
           —— 跳到 2 行高只要 6 帧，等完 0.35~0.85 秒就只能从台子底下钻过去了。
           还要 vx 没在「往反方向跑」：刚从台子底下退出来的那几帧 vx 还是朝外的，
           这时候起跳等于原地蹦一下再掉回来。 */
        if (this._climb && this._climb.dist < 30 && this._headClear(world) &&
            this.vx * this._climb.dir > -0.6) wantJump = true;
        if (wantJump) {
          this._airDir = move || 0;      // 锁住起跳那一刻的横向意图（见 update 里的滞空承诺）
          this.vy = -15.4;
          this.grounded = false;
          this.airJumps = (this.airJumps || 0);
          this.jumpCd = 0.35 + Math.random() * 0.5;
          if (LD.Sfx && LD.Sfx.jump) LD.Sfx.jump();
        }
      }
      /* ---- 空中再跳（无限跳：玩家改成人机也要跟得上）----
         玩家现在「空中落地都能无限跳」，人机要是还只能落地起跳，
         上高台时就会被玩家一路跳着脸打。
         条件收得很紧，避免人机在空中乱蹦：
           · 正处在上升或刚开始下落（vy < 1.5），且已经跳了一小会儿（airJumpT<=0）
           · 目标在上方，或前方还有台阶没上去（_climb 还在）
           · 最多补 2 次空中跳（airJumps），不然会一路窜上天 */
      if (!this.frozen && !this.grounded && this.airJumpT <= 0 &&
          this.vy < 1.5 && (this.airJumps || 0) < 2) {
        const needUp = s && s.dy < -T * 0.4;
        const needLedge = this._climb && this._climb.dist < 34;
        if (needUp || needLedge) {
          this.vy = -14.2;                       // 空中跳略弱于起跳
          this.airJumps = (this.airJumps || 0) + 1;
          this.airJumpT = 6;                     // 最小间隔（帧）
          this.grounded = false;
          if (LD.Sfx && LD.Sfx.jump) LD.Sfx.jump();
        }
      }
      if (this.airJumpT > 0) this.airJumpT -= f;

      // ---- 重力 / 地形 ----
      const wasG = this.grounded;
      if (this._onGround(world)) { this.grounded = true; if (this.vy > 0) this.vy = 0; }
      else { this.grounded = false; this.vy = Math.min(this.vy + 0.9 * f, 17); }
      this._move(world, 'x', this.vx * f);
      this._move(world, 'y', this.vy * f);
      if (this._onGround(world)) { this.grounded = true; if (this.vy > 0) this.vy = 0; }
      else this.grounded = false;
      if (this.grounded) {
        this._airDir = 0;                             // 落地 → 滞空承诺解除
        this.airJumps = 0; this.airJumpT = 0;         // 落地 → 空中跳次数清零
      }
      if (this.grounded) {
        this.walk += Math.abs(this.vx) * 0.09;
        if (!wasG && Math.abs(this.vy) > 0.1) this.squash = 0.3;
      }
      this.x = LD.clamp(this.x, 0, Math.max(0, world.pxW - this.w));
      if (this.y > world.pxH + 300) this.dead = true;

      // ---- 开火 ----
      /* 训练场的「敌人不开火」开关：连 _shoot 都不进，
         人机就完全安静（不会打你、也不会自己换弹添乱）。 */
      if (!this.noAttack) this._shoot(dt, world, s, ctx);
    }

    /* 有没有子弹正在逼近自己（用于跳跃闪避） */
    threatened(world, bullets) {
      if (!bullets || !bullets.length) return false;
      for (const b of bullets) {
        if (b.dead || b.team === this.team) continue;
        const dx = this.cx - b.x;
        if (dx * this.vx >= 0 && Math.sign(dx) === Math.sign(b.vx)) continue;  // 正在远离
        if (Math.abs(dx) > 220) continue;
        if (Math.abs(b.y - this.cy) < 26) return true;
      }
      return false;
    }

    /* ---------- 距离场导航（电脑鼠 flood-fill） ----------
       需求原话：「有时我在中间敌人未找到最短路径，建议先找到角色所在阶梯
       再精确位置」。旧版是「区级 BFS」，只能把人机送到「区」，到不了「格」；
       现在是**距离场**：world.flowTo 从玩家脚底格 flood-fill，给每个可站立格
       算「到玩家的最短步数」，人机每帧沿距离递减的邻居走 ——
       先精确落到玩家所在阶梯、再一步步精确逼近到玩家脚下那格。
       同区（已在同一层）或有视线能对射时，交给交火逻辑（它会水平逼近）。 */
    _navStep(world, s, dt, ctx) {
      if (this.frozen || !world.flowTo || !s) { this._navGoal = null; return false; }
      const tFeet = (s.foe && s.foe.y != null && s.foe.h != null) ? s.foe.y + s.foe.h : s.ty + 14;
      const myZone = world.zoneAt(this.cx, this.y + this.h);
      const targetZone = world.zoneAt(s.tx, tFeet);
      /* 同区 → 交火逻辑（会水平逼近玩家）；或不同区但视线通畅能直接对射 → 也交火 */
      if ((myZone >= 0 && myZone === targetZone) || (s.los && Math.abs(s.dy) <= T * 0.8)) {
        this._navGoal = null;
        return false;
      }

      /* 距离场缓存：玩家移动超过 40px 才重算（省性能） */
      if (!this._flow || !this._flowAt ||
          Math.abs(this._flowAt.x - s.tx) > 40 || Math.abs(this._flowAt.y - tFeet) > 40) {
        this._flow = world.flowTo(s.tx, tFeet, 90);
        this._flowAt = { x: s.tx, y: tFeet };
      }

      const myC = Math.floor(this.cx / T);
      const myR = Math.floor((this.y + this.h - 4) / T);
      const myD = this._flow.get(LD.cellKey(myC, myR));
      if (myD === undefined) {
        /* 半探出：身体已探出台沿（读到非站立格）但脚还没离地 —— 继续冲出去 */
        if (this.grounded && this._airDir) {
          this._navMove = this._airDir;
          this._navJump = false;
          return true;
        }
        this._navGoal = null;
        return false;                       // 真不可达 → 交给卡住检测（打箱子等）
      }
      if (myD <= 0) { this._navGoal = null; return false; }   // 已在玩家格 → 交火

      /* 沿距离递减走：找邻居里步数最小且 < 当前步数的 */
      let best = null;
      for (const nb of world.flowNeighbors(myC, myR)) {
        const d = this._flow.get(LD.cellKey(nb.c, nb.r));
        if (d === undefined || d >= myD) continue;
        if (!best || d < best.d) best = nb;
      }
      if (!best) { this._navGoal = null; return false; }

      /* 执行邻居动作 */
      if (best.kind === 'walk') {
        this._navMove = best.dir;
        this._navJump = false;
      } else if (best.kind === 'jump') {
        const ncx = best.c * T + T / 2;
        const dx = ncx - this.cx;
        const jdir = best.dir || (dx >= 0 ? 1 : -1);
        if (Math.abs(dx) < 30 && this.grounded) {
          this._navMove = jdir;
          this._navJump = true;
        } else {
          this._navMove = Math.sign(dx) || jdir;
          this._navJump = false;
        }
      } else {                              // drop
        this._navJump = false;
        /* 【遇到箱子打碎】前进方向顶着一个箱子就开火打碎（一枪即碎） */
        if (ctx && this._crateAhead(world, best.dir)) {
          this._navMove = best.dir;
          this._breakShot(world, ctx, best.dir);
          return true;
        }
        this._navMove = best.dir;
        this._airDir = best.dir;            // 走出台沿后靠滞空承诺保向
      }
      return true;
    }

    /* ---------- 卡住检测 ----------
       位置 1 秒几乎没变 + 脚在地上 + 有目标 → 判定被挡。
       挡路的是木箱时才出手（墙有原本的绕道逻辑管）：
         · 55% 跳过去（快，跳不上去的箱子顶面也能当台阶）
         · 45% 直接开枪打碎 —— 子弹打中箱子就会碎（见 world.breakBox），
           碎了路就通了。
       人机只在「被挡」时才打箱子，绝不会闲着没事拆箱子 ——
       场上的箱子就这样给玩家留着（「预留一点箱子给玩家」）。 */
    _stuckCheck(dt, world, ctx, s) {
      if (!s) { this._stillT = 0; this._stuckAct = null; return null; }
      const moved = Math.abs(this.x - this._lastX) + Math.abs(this.y - this._lastY);
      this._lastX = this.x; this._lastY = this.y;
      if (moved > 1.2 || Math.abs(this.vx) > 0.5) {
        this._stillT = 0; this._stuckAct = null; this._jumpFailed = false;
        return null;
      }
      this._stillT += dt;
      const dir = this.face || s.towards;
      const box = this._crateAhead(world, dir);
      /* 执行期：break 持续朝箱子开枪；jump 持续起跳 */
      if (this._stuckActT > 0) {
        this._stuckActT -= dt;
        if (this._stuckAct === 'break') {
          if (box) this._breakShot(world, ctx, dir);
        }
        if (this._stuckActT <= 0) {
          /* 执行期结束：跳完了箱子还在眼前（没越过去）→ 记失败，下次强制打碎 */
          if (this._stuckAct === 'jump' && box) this._jumpFailed = true;
          this._stuckAct = null;
        }
        return this._stuckAct === 'jump' ? 'jump' : null;
      }
      if (this._stillT < 1.0) return null;
      if (!box) { this._stillT = 0; return null; }   // 不是箱子 → 交给绕道
      /* 遇到箱子：直接打碎（用户要求「敌人遇到箱子打碎」）。
         箱子一枪就碎，比跳来跳去可靠得多 —— 跳上箱子顶再 drop 回来
         在窄平台上会来回磨蹭，看着就像卡住。 */
      this._stuckAct = 'break';
      this._stuckActT = 1.2;
      this._stillT = 0;
      return null;
    }

    /* 身前是不是顶着木箱（胸口 / 脚两个高度都探一下） */
    _crateAhead(world, dir) {
      const px = this.cx + dir * (this.w / 2 + 10);
      return world.boxAt(px, this.y + this.h - 14) || world.boxAt(px, this.y + 8);
    }

    /* 朝箱子开一枪（绕过 canShootAt —— 那是「打敌人」的判定，箱子不用瞄准） */
    _breakShot(world, ctx, dir) {
      const g = this.gun, w = g.weapon();
      if (w.kind !== 'gun' || !ctx || !ctx.spawnBullet) return;
      if (g.reloadT > 0) return;
      /* 【关键】fireT 是「对敌开火」的节奏，_shoot 里想打玩家却没视野时会每帧
         把它顶到 0.05 —— 若不清理，这里 `tryFire` 就被 0.05 卡死、一枪打不出，
         人机在箱子前永远拆不掉。打箱子不受对敌节奏限制，清掉直接开火。 */
      g.fireT = 0;
      const shot = g.tryFire(false);
      if (!shot) return;
      this.face = dir;
      ctx.spawnBullet({
        x: this.cx + dir * 14,
        y: this.gunY(),
        vx: dir * shot.speed,
        vy: 0,
        dmg: shot.dmg,
        r: shot.size,
        color: shot.color,
        team: 'ai',
        owner: this,
        explode: shot.explode,
        splash: shot.splash,
      });
      if (LD.Sfx && LD.Sfx.shot) LD.Sfx.shot(shot.id, 0.42);
    }

    _shoot(dt, world, s, ctx) {
      const g = this.gun, w = g.weapon();
      if (w.kind !== 'gun') {
        // 道具型人机（侦查 / 自爆 / 手雷）交给上层统一处理
        if (ctx.botUseItem) ctx.botUseItem(this, s, dt);
        return;
      }
      if (this.reactT > 0 || this.burstPause > 0) return;
      if (!this.canShootAt(world, s)) { this.gun.fireT = Math.max(this.gun.fireT, 0.05); return; }
      /* 换弹耗时的「手速」倍率从 startReload 传进去：弱人机 reloadSk=1.5（拖长），
         强人机 0.25（更快）。千万不要在外部改 gun.reloadT —— 见 update() 里的注释。 */
      if (!g.readyGun(false, this.t.reloadSk)) return;
      const shot = g.tryFire(false);
      if (!shot) return;
      /* 预判提前量：强人机会往玩家跑动的方向偏一点（lead 像素）。
         弱人机 lead = 0，纯打「现在的位置」—— 所以站在原地对射，早期人机常打空。 */
      let vy = 0;
      if (s && s.foe && this.t.lead > 0) {
        const vf = s.foe.vx || 0;
        vy = vf * (this.t.lead / 9);
      }
      const dir = this.aimDir || this.face;
      if (ctx.spawnBullet) {
        ctx.spawnBullet({
          x: this.cx + dir * 14,
          y: this.gunY(),
          vx: dir * shot.speed,
          vy: vy * 0.35,
          dmg: shot.dmg,
          r: shot.size,
          color: shot.color,
          team: 'ai',
          owner: this,
          explode: shot.explode,
          splash: shot.splash,
        });
      }
      /* 人机开火也发声，但压到 0.42 倍音量：
         无尽模式后段场上可能有十个人机同时输出，原音量会盖掉玩家自己的枪声，
         那样「听声辨位」就废了。 */
      if (typeof LD !== 'undefined' && LD.Sfx && LD.Sfx.shot) LD.Sfx.shot(shot.id, 0.42);
      this.burstLeft--;
      if (this.burstLeft <= 0) {
        this.burstLeft = this.t.burst;
        this.burstPause = LD.lerp(0.5, 0.08, this.norm);
      }
    }

    /* ---------- 碰撞（与玩家同一套 AABB 推挤） ---------- */
    _onGround(world) {
      const footY = this.y + this.h;
      const x0 = this.x + 3, x1 = this.x + this.w - 4;
      if (x1 <= x0) return false;
      const row = Math.floor((footY + 1.5) / T);
      for (let c = Math.floor(x0 / T); c <= Math.floor(x1 / T); c++) {
        if (world.isSolid(c, row)) return true;
      }
      return false;
    }
    /* 头顶能不能向上跳。
       从头顶往上扫 3 行（≈跳跃上限 3.3 格），只要自己身体宽度内有实心块，
       起跳就是撞脑袋（_pushTiles 里 vy<0 会把 vy 清零、原地下落）——
       所以「站在高台底下」不该起跳，应该先横着退出来再说。
       这也是「人机贴着台子底部原地弹跳」的病根。 */
    _headClear(world) {
      const c0 = Math.floor((this.x + 2) / T);
      const c1 = Math.floor((this.x + this.w - 3) / T);
      const r0 = Math.floor(this.y / T);
      for (let r = r0 - 1; r >= r0 - 3 && r >= 0; r--) {
        for (let c = c0; c <= c1; c++) if (world.isSolid(c, r)) return false;
      }
      return true;
    }
    _move(world, axis, delta) {
      if (!Number.isFinite(delta)) return;
      if (axis === 'x') this.x += delta; else { this.y += delta; this.grounded = false; }
      for (let iter = 0; iter < 3; iter++) {
        if (!this._pushTiles(world, axis)) break;
      }
    }
    _pushTiles(world, axis) {
      const c0 = Math.floor(this.x / T), c1 = Math.floor((this.x + this.w - 1) / T);
      const r0 = Math.floor(this.y / T), r1 = Math.floor((this.y + this.h - 1) / T);
      let hit = false;
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          if (!world.isSolid(c, r)) continue;
          if (world.breakFake(c, r)) continue;
          hit = true;
          const tx = c * T, ty = r * T;
          if (axis === 'x') {
            if (this.vx > 0) this.x = tx - this.w;
            else if (this.vx < 0) this.x = tx + T;
            else this.x = this.x + this.w / 2 < tx + T / 2 ? tx - this.w : tx + T;
            this.vx = 0;
          } else {
            if (this.vy > 0) { this.y = ty - this.h; this.grounded = true; this.vy = 0; }
            else if (this.vy < 0) { this.y = ty + T; this.vy = 0; }
            else if (this.y + this.h / 2 < ty + T / 2) { this.y = ty - this.h; this.grounded = true; }
            else this.y = ty + T;
          }
        }
      }
      return hit;
    }
  }

  /* 扫描「前方有没有能跳上去的落脚点」（台阶 / 高台 / 木箱顶）。
     返回 { up, dist }：
       up   = 台面比脚底高几行（0 = 眼前 2 列内没有可上的台子）
       dist = 身体前沿到台子侧沿的水平距离（px，0 附近＝就贴在台沿上）
     ----------------------------------------------------------------------
     【曾经的 bug，也是「敌人不会自己跳上高台」的根因 —— 两处几何判定同时失效】
     ① 旧版本叫 bestLedgeAhead，从 botRow（＝脚底所在的那一行）开始往上扫。
        而脚底那一行就是**脚下踩着的地面**：isSolid(c, r) 立刻成立，
        isSolid(c, r-1) 只要头顶是空的（绝大多数情况）也成立 → 直接 return 0。
        于是「抢高台」那段 `if (up) move = s.towards` **从来没有生效过**。
     ② 真正负责起跳的判定是 `blockedMid && !blockedLow`，要求「障碍的顶面落在
        脚底往上 6~18px 之间」。40px 的格子对齐之后，台面要么在 40px 处（整块实心）、
        要么根本不在这一列，这个区间几乎取不到 → 起跳判定也从来不成立。
     两条加起来：人机既不上台阶、也不跳高台，只会在台子底下走来走去。
     （高台底下还走得进去：台面在脚底往上 2 行时，中间那一行是空的，
       22×28 的人机完全塞得下 —— 所以它压根不会觉得前面「有墙」。）
     现在：从脚底**上面一行**开始扫，并要求台面上方留出站人的空间。 */
  function scanLedge(world, bot, dir) {
    if (!world || !world.isSolid || !dir) return { up: 0, dist: 0 };
    const botRow = Math.floor((bot.y + bot.h) / T);
    const startC = Math.floor((bot.cx + dir * (bot.w / 2)) / T);
    for (let step = 0; step <= 3; step++) {          // 眼前 3 列（比原来多扫一列，能发现更远处的上坡口）
      const c = startC + dir * step;
      if (c < 0 || (world.cols && c >= world.cols)) continue;
      for (let up = 1; up <= 3; up++) {              // 最多高 3 格（跳跃上限约 3.3 格）
        const r = botRow - up;
        if (r < 1) break;
        if (!world.isSolid(c, r)) continue;          // 这一行不是台面
        if (world.isSolid(c, r - 1)) continue;       // 台面上方得站得下人
        const edge = dir > 0 ? c * T : (c + 1) * T;  // 台子朝自己这一侧的边沿
        return { up, dist: Math.abs(edge - bot.cx) - bot.w / 2 };
      }
    }
    return { up: 0, dist: 0 };
  }
  /* 兼容旧名字：外部只关心「高几行」，自身不带 world 的调用点用它 */
  function bestLedgeAhead(bot, dir) {
    return scanLedge(bot.__world, bot, dir).up;
  }

  LD.GunAI = { Bot, tune, bestLedgeAhead, scanLedge };
})();
