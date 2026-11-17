/* guns.js — 枪战模式：武器表 / 子弹 / 木箱掉落增益 / 道具（手雷·医药包·无人机）

   用户需求原文（逐条落到 WEAPONS 表里）：
     F1 手枪     ：原本就有，7 发一个弹匣，0.2s 每发，换弹 3s，2 点伤害
     F2 冲锋枪   ：第 10 关有，50 发一个弹匣，0s 每发，换弹 6s，1 点伤害
     F3 狙击枪   ：第 20 关有，5 发一个弹匣，2s 每发，换弹 7s，10 点伤害
     F4 火箭筒   ：第 40 关有，1 发一个弹匣，换弹 3s，50 点伤害
     F5 四联火箭筒：第 80 关有，4 发一个弹匣（连续发），0.1s 每发，换弹 6s，80 点伤害
     F6 侦查无人机：第 100 关有，100 点血量，冷却 60s
        —— 放飞后镜头切到「无人机视角」（静如无人机视角），它自己在空中悬停并自动开火
     F7 自爆无人机：第 120 关有，120 点伤害，冷却 120s
        —— 放飞后由玩家手动遥控：方向键控飞行，开火键引爆
     F8 追踪无人机：第 130 关有，100 点伤害，冷却 90s
        —— 放飞后自动锁定最近的敌人、一路追上去并引爆（用户要求「F8改为追踪无人机，
           追踪敌人并引爆（130关解锁）100点伤害」）
     F9 手雷     ：原本就有，90 点伤害，冷却 30s（用户要求「F9手雷」）
     F10 医药包  ：5s 回血，回 20 滴血，冷却 60s（用户要求「F10医药包」）
   （手雷 / 自爆无人机 的伤害后来按反馈上调过：手雷 50→90、自爆 80→120，
     同时把爆炸衰减下限从 0.35 提到 0.5 —— 原值下「手雷扔脸上也只掉十几点」，
     用户的原话是「手雷伤害太低」。）

   共同规则（同样来自需求原文）：
     · 小人枪械没有自动瞄准，统一平射  → 子弹沿水平方向飞，不受重力影响
     · 主要看玩家跳跃攻打           → 血量/受击/跳跃是核心循环
     · 木箱可打破，有机会得到双倍甚至三倍射速及弹药
     · 无敌模式（作弊）射速飞快，无需换弹

   数据约定：
     slot     F1~F10 里的编号（用户把「枪」和「道具」都编了号；F1~F5 是枪，
              F6 侦查 / F7 自爆 / F8 追踪 / F9 手雷 / F10 医药包 —— 一槽一物）
     unlockAt 在「枪战关卡 / 枪战无尽」里解锁到第几关才可用（0 = 一开始就有）
     mag      弹匣容量（Infinity 表示不消耗弹药，见 noAmmo）
     cd       道具类冷却（秒）
     dmg      单发伤害
   */
(function () {
  const WEAPONS = [
    {
      id: 'pistol', slot: 'F1', name: '手枪', nameEn: 'Pistol',
      unlockAt: 0, kind: 'gun',
      mag: 7, fireDelay: 0.2, reload: 3, dmg: 2,
      speed: 13, size: 4, color: '#ffe066', tracer: '#fff3b0', spread: 0,
      tip: '7 发弹匣 · 0.2s/发 · 换弹 3s · 2 点伤害',
      tipEn: '7-round mag · 0.2s per shot · 3s reload · 2 dmg',
    },
    {
      id: 'smg', slot: 'F2', name: '冲锋枪', nameEn: 'SMG',
      unlockAt: 10, kind: 'gun',
      mag: 50, fireDelay: 0.0, reload: 6, dmg: 1,
      speed: 15, size: 3, color: '#7ad4ff', tracer: '#cdefff', spread: 0.9,
      tip: '50 发弹匣 · 全自动 · 换弹 6s · 1 点伤害',
      tipEn: '50-round mag · full auto · 6s reload · 1 dmg',
    },
    {
      id: 'sniper', slot: 'F3', name: '狙击枪', nameEn: 'Sniper',
      unlockAt: 20, kind: 'gun',
      mag: 5, fireDelay: 2.0, reload: 7, dmg: 10,
      speed: 26, size: 3, color: '#ff9f43', tracer: '#ffd9a0', spread: 0,
      tip: '5 发弹匣 · 2s/发 · 换弹 7s · 10 点伤害',
      tipEn: '5-round mag · 2s per shot · 7s reload · 10 dmg',
    },
    {
      id: 'rpg', slot: 'F4', name: '火箭筒', nameEn: 'Rocket',
      unlockAt: 40, kind: 'gun',
      mag: 1, fireDelay: 0.6, reload: 3, dmg: 50,
      speed: 9, size: 7, color: '#ff6b6b', tracer: '#ffb3b3', splash: 34, explode: true,
      tip: '1 发弹匣 · 换弹 3s · 50 点伤害 · 小范围爆炸',
      tipEn: '1-round mag · 3s reload · 50 dmg · small blast',
    },
    {
      id: 'quad', slot: 'F5', name: '四联火箭筒', nameEn: 'Quad Rocket',
      unlockAt: 80, kind: 'gun',
      mag: 4, fireDelay: 0.1, reload: 6, dmg: 80,
      speed: 11, size: 7, color: '#ff3d71', tracer: '#ff9ec0', splash: 40, explode: true,
      tip: '4 发弹匣（连续发）· 0.1s/发 · 换弹 6s · 80 点伤害',
      tipEn: '4-round mag (burst) · 0.1s per shot · 6s reload · 80 dmg',
    },
    {
      id: 'drone', slot: 'F6', name: '侦查无人机', nameEn: 'Recon Drone',
      unlockAt: 100, kind: 'item', cd: 60, hp: 100, duration: 12,
      tip: '100 点血量 · 冷却 60s · 方向键遥控飞行，开火键射击，小人无敌',
      tipEn: '100 HP · 60s cooldown · steer to fly, fire to shoot, you are invulnerable',
    },
    {
      id: 'bomb', slot: 'F7', name: '自爆无人机', nameEn: 'Kamikaze Drone',
      unlockAt: 120, kind: 'item', cd: 120, dmg: 120, duration: 9,
      tip: '120 点伤害 · 冷却 120s · 方向键遥控飞行，开火键引爆，小人无敌',
      tipEn: '120 dmg · 120s cooldown · arrow keys to steer, fire to detonate, you are invulnerable',
    },
    {
      /* 【用户需求：F8 追踪无人机，130 关解锁，100 点伤害】
         和 F7 自爆机最大的区别是「不用你开」：放飞后自己锁定最近的敌人、
         一路追上去，贴上就引爆。所以它没有 duration 到点就散一说 ——
         给足 16s 让它把敌人追到手；追不到也会自己撞墙炸掉。 */
      id: 'tracker', slot: 'F8', name: '追踪无人机', nameEn: 'Tracker Drone',
      unlockAt: 130, kind: 'item', cd: 90, dmg: 100, duration: 16, hp: 60,
      tip: '130 关解锁 · 100 点伤害 · 冷却 90s · 自动追踪敌人并引爆',
      tipEn: 'Level 130 · 100 dmg · 90s cooldown · auto-tracks a target and detonates',
    },
    {
      /* 【用户需求：F9 手雷】手雷从 F8 挪到 F9（F8 让给追踪无人机）。 */
      id: 'grenade', slot: 'F9', name: '手雷', nameEn: 'Grenade',
      unlockAt: 0, kind: 'item', cd: 30, dmg: 90,
      tip: '90 点伤害 · 冷却 30s · 抛物线扔出去 · 小范围爆炸',
      tipEn: '90 dmg · 30s cooldown · thrown in an arc · small blast',
    },
    {
      /* 【用户需求：F10 医药包】医药包从 F9 挪到 F10。
         原来它和手雷挤在同一个槽（按哪个键都只出手雷，医药包基本按不出来），
         上一轮先独立到 F9；这一轮 F9 给了手雷，医药包再往后挪一格到 F10 ——
         一槽一物，按哪个键出哪个道具。F10 因此从「浏览器保留键」里拿了出来
         （F11 / F12 仍然保留，那两个键浏览器不允许页面拦截）。 */
      id: 'medkit', slot: 'F10', name: '医药包', nameEn: 'Medkit',
      unlockAt: 0, kind: 'item', cd: 60, heal: 20, healTime: 5,
      tip: '5s 回血 · 回 20 滴血 · 冷却 60s',
      tipEn: 'heals 20 HP over 5s · 60s cooldown',
    },
  ];

  const byId = {};
  const bySlot = {};
  for (const w of WEAPONS) {
    byId[w.id] = w;
    (bySlot[w.slot] || (bySlot[w.slot] = [])).push(w);
  }

  /* 枪战模式里「枪」是主武器（会换弹），「道具」（手雷 / 医药包 / 三种无人机）走冷却。
     槽位顺序决定数字键 / 切枪顺序：F1 F2 F3 F4 F5 F6 F7 F8 F9 F10（10 格物品栏）。
     F9 手雷 / F10 医药包各自独立 —— 原来两者共用一个槽，按哪个键都出不来医药包。 */
  const SLOTS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10'];

  /* ---------------- 玩家血量 ----------------
     基础 100，每打败一名人机上限 +20，封顶 500。
     MAX_HP 现在只是「出生时的基础值」——运行时的实际上限长在
     p.maxHp 上（game.js 的击杀奖励负责涨），训练场热键 / 医药包
     的回血封顶都读 p.maxHp，不直接读这里的常量。 */
  const MAX_HP = 100;
  const HP_CAP = 500;          // 血量上限（击杀奖励涨到 500 就不再涨）
  const HP_PER_KILL = 20;      // 每打败一名敌人，上限 +20（同时回 20）

  /* ---------------- 木箱掉落增益 ----------------
     木箱（瓦片 K）可被子弹打破，有机会掉出增益：
       double 双倍射速 + 双倍弹药
       triple 三倍射速 + 三倍弹药
       ammo   只补满弹药
       heal   少量回血
     rate 是「射速倍率」，倍率越高 fireDelay 越小。 */
  const BOOSTS = {
    double: { rate: 2, ammo: 2, dur: 14, label: '双倍射速', labelEn: 'Double fire rate', color: '#ffd23f' },
    triple: { rate: 3, ammo: 3, dur: 11, label: '三倍射速', labelEn: 'Triple fire rate', color: '#ff6b9d' },
    ammo: { rate: 1, ammo: 2, dur: 0, label: '弹药补给', labelEn: 'Ammo refill', color: '#7ad4ff' },
    heal: { rate: 1, ammo: 1, dur: 0, heal: 25, label: '医疗补给', labelEn: 'Health pack', color: '#35e0a1' },
  };
  /* 掉落概率：双倍最常见，三倍稀有（需求原话「有机会得到双倍甚至三倍」）
     参数 rnd 可以传一个随机源（确定性生成器）也可以不传；
     不传时直接用 Math.random。注意不能写成 `(rnd || Math.random)()` ——
     那样 Math.random() 会先被调用一次，再拿它的返回值当函数调用。 */
  function rollBoost(rnd) {
    const r = rnd ? rnd() : Math.random();
    if (r < 0.40) return 'double';
    if (r < 0.56) return 'triple';
    if (r < 0.88) return 'ammo';
    return 'heal';
  }

  /* ---------------- 子弹 ----------------
     统一平射：只有水平速度，不受重力（用户明确要求「没有自动瞄准，统一平射」）。
     owner 用来避免自己打到自己；team 用来判定命中谁。 */
  let BID = 1;
  class Bullet {
    constructor(o) {
      this.id = BID++;
      this.x = o.x; this.y = o.y;
      this.vx = o.vx; this.vy = o.vy || 0;
      this.dmg = o.dmg;
      this.r = o.r || 3;
      this.color = o.color || '#ffe066';
      this.team = o.team || 'red';        // 'red' | 'blue' | 'ai'
      this.owner = o.owner || null;
      this.explode = !!o.explode;
      this.splash = o.splash || 0;
      this.gravity = o.gravity == null ? 0 : o.gravity;   // 平射默认 0
      this.life = o.life || 3.2;
      this.dead = false;
      this.trail = [];
    }
  }

  /* 子弹是否越界 / 撞墙：所有枪战地图的实心瓦片都挡子弹（木箱也能挡，打中木箱就碎箱） */
  function bulletHitsWall(world, b) {
    if (world.tileSolidAt(b.x, b.y)) return true;
    if (world.boxHit && world.boxHit(b.x, b.y)) return true;
    return false;
  }

  /* 子弹飞一帧。返回 { hitWall, hitBox } 供上层决定是否破箱。 */
  function stepBullet(world, b, dt) {
    if (b.dead) return null;
    const f = dt * 60;
    b.x += b.vx * f;
    b.y += b.vy * f;
    if (b.gravity) b.vy += b.gravity * f;
    b.life -= dt;
    if (b.life <= 0) { b.dead = true; return null; }
    if (b.x < -40 || b.x > world.pxW + 40 || b.y < -60 || b.y > world.pxH + 60) {
      b.dead = true; return null;
    }
    /* 木箱要排在实心墙前面判断：isSolid('K') 也是 true，
       如果先查 tileSolidAt，子弹永远走不到「碎箱 + 掉增益」这一支。 */
    if (world.boxHit && world.boxHit(b.x, b.y)) {
      b.dead = true;
      const box = world.boxAt(b.x, b.y);
      return { hitWall: false, hitBox: true, box, x: b.x, y: b.y };
    }
    if (world.tileSolidAt(b.x, b.y)) {
      b.dead = true;
      return { hitWall: true, x: b.x, y: b.y };
    }
    return null;
  }

  /* ---------------- 枪械状态（弹匣 / 换弹 / 增益） ----------------
     挂在「持枪者」身上（玩家 / 人机 / 蓝方玩家都用同一套）：
       ammo       当前弹匣里还剩几发
       reloadT    换弹剩余时间（>0 表示正在换弹，不能开火）
       cooldownT  各道具的冷却剩余（按武器 id 记）
       boostT     增益剩余时间 / boostRate 射速倍率 / boostAmmo 弹药倍率
     noAmmo = true（无敌模式）时：不消耗弹药、不换弹、射速飞快。 */
  const NO_AMMO_DELAY = 0.035;      // 无敌模式：每帧几乎连发

  class GunState {
    constructor(owner) {
      this.owner = owner;
      this.weaponId = 'pistol';
      this.magOf = {};            // 每把枪的弹匣独立记（切枪不会丢弹量）
      this.reloadT = 0;
      this.fireT = 0;
      this.cooldown = {};
      this.boostT = 0;
      this.boostRate = 1;
      this.boostAmmo = 1;
      this.boostKind = null;
      this.noAmmo = false;        // 无敌/作弊模式：不耗弹、不换弹、速射、道具免冷却
      this.recoil = 0;
      this.lastShot = 0;
      this.forgiving = false;     // 人机用：忽略换弹（低难度人机给点慈悲）
    }

    weapon() { return byId[this.weaponId] || WEAPONS[0]; }
    setWeapon(id) {
      if (!byId[id]) return false;
      if (this.weaponId === id) return false;
      this.weaponId = id;
      this.reloadT = 0;
      this.fireT = 0.12;          // 切枪小硬直
      return true;
    }

    /* 当前弹匣余量（懒初始化：第一次用的时候整匣是满的） */
    ammo() {
      const w = this.weapon();
      if (w.kind !== 'gun') return Infinity;
      const n = this.magOf[w.id];
      if (n == null) return w.mag;
      return n;
    }
    /* 任意一把枪的弹匣余量。
       物品栏（render.js hotbar）要「每格显示各自那把枪的弹量」，不能都拿当前武器糊弄
       —— 之前那版就是调 ammo()，于是 4 个格子全显示同一个数字（当前枪的 50），纯误导。
       懒初始化口径和 ammo() 保持一致：没打过就是满匣。 */
    ammoOf(id) {
      const w = byId[id];
      if (!w || w.kind !== 'gun') return Infinity;
      const n = this.magOf[id];
      return n == null ? w.mag : n;
    }
    /* 弹匣容量。注意这里刻意「不吃增益」：
       增益是「打碎木箱一次性补满 + 射速翻倍」，如果容量也跟着翻倍，
       那么每隔 14s 增益一刷新、再 refill 一次，弹匣就会滚雪球无限膨胀
       （实测手枪从 7 涨到 21）。 */
    magSize() {
      const w = this.weapon();
      if (w.kind !== 'gun') return Infinity;
      return Math.max(1, Math.round(w.mag));
    }
    /* 增益生效期间「这一次装填」能给到的弹量（双倍 / 三倍弹药） */
    magSizeBoosted() {
      const w = this.weapon();
      if (w.kind !== 'gun') return Infinity;
      return Math.max(1, Math.round(w.mag * (this.boostT > 0 ? this.boostAmmo : 1)));
    }
    isReloading() { return this.reloadT > 0; }

    /* 实际开火间隔：基础值 ÷ 射速倍率。无敌模式直接给「飞快」。 */
    fireDelay(noAmmo) {
      if (noAmmo) return NO_AMMO_DELAY;
      const w = this.weapon();
      const rate = this.boostT > 0 ? this.boostRate : 1;
      return Math.max(0.016, w.fireDelay / rate);
    }

    /* scale：换弹耗时的倍率。人机用它模拟「手速」——
       弱者拖长（1.5 倍）、强者更快（0.25 倍）。
       **必须从这里传进去，不能在外部写 this.reloadT**：
       update() 只在「进入时 reloadT > 0 且这一帧减到 0」那条路径里回填弹匣，
       外部直接把 reloadT 置 0 会让回填那一帧被跳过，
       结果是「弹匣永远为 0、人机打完第一个弹匣就再也不开枪」。 */
    startReload(noAmmo, scale) {
      const w = this.weapon();
      if (noAmmo || w.kind !== 'gun') return false;
      /* 上限用「本次装填能给到的量」：增益期间双倍 / 三倍弹药，
         否则打空一枪后 ammo(0) < cap(7) 却会被判成「不必换弹」。 */
      const cap = this.magSizeBoosted();
      if (this.ammo() >= cap) return false;
      if (this.reloadT > 0) return false;
      const k = (typeof scale === 'number' && scale > 0) ? scale : 1;
      this.reloadT = w.reload * k;
      // 音效放在状态机里而不是调用方：换弹有多个触发点（打空自动 / 按住开火 / 切枪后），
      // 只有这里能保证「开始」和「完成」严格配对，不会漏掉或多响。
      const s = (typeof LD !== 'undefined') && LD.Sfx;
      if (s && s.reload) s.reload();
      return true;
    }

    applyBoost(kind) {
      const b = BOOSTS[kind];
      if (!b) return;
      this.boostKind = kind;
      this.boostRate = b.rate;
      this.boostAmmo = b.ammo;
      this.boostT = b.dur;
      // 双倍 / 三倍同时也把弹药直接补满（需求：得到双倍甚至三倍射速及弹药）
      const w = this.weapon();
      if (w.kind === 'gun' && b.ammo > 1) {
        this.magOf[w.id] = this.magSizeBoosted();
        this.reloadT = 0;
      }
    }

    refill() {
      const w = this.weapon();
      if (w.kind === 'gun') this.magOf[w.id] = this.magSizeBoosted();
      this.reloadT = 0;
    }

    update(dt) {
      if (this.fireT > 0) this.fireT = Math.max(0, this.fireT - dt);
      if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt * 6);
      if (this.boostT > 0) {
        this.boostT = Math.max(0, this.boostT - dt);
        if (this.boostT === 0) { this.boostRate = 1; this.boostAmmo = 1; this.boostKind = null; }
      }
      for (const k in this.cooldown) {
        if (this.cooldown[k] > 0) this.cooldown[k] = Math.max(0, this.cooldown[k] - dt);
      }
      if (this.reloadT > 0) {
        this.reloadT -= dt;
        /* 用 <= 0 而不是「Math.max 之后再 === 0」：
           只要有人（哪怕是未来的某段代码）从外部把 reloadT 写成 0，
           旧写法就会整帧跳过这里 —— 而跳过 = 弹匣永不回填 = 人机彻底哑火。 */
        if (this.reloadT <= 0) {
          this.reloadT = 0;
          this.magOf[this.weapon().id] = this.magSizeBoosted();
          const s = (typeof LD !== 'undefined') && LD.Sfx;   // 装填完成：上膛一声
          if (s && s.reloadDone) s.reloadDone();
        }
      }
    }

    /* 试着开火。返回子弹（没打出来返回 null）。
       noAmmo = 作弊/无敌模式：不扣弹、不换弹。 */
    tryFire(noAmmo) {
      const w = this.weapon();
      if (w.kind !== 'gun') return null;
      if (this.reloadT > 0 || this.fireT > 0) return null;
      if (!noAmmo) {
        let n = this.ammo();
        if (n <= 0) {
          const s = (typeof LD !== 'undefined') && LD.Sfx;
          if (s && s.empty) s.empty();        // 空仓「咔」一声，再开始换弹
          this.startReload(false);
          return null;
        }
        this.magOf[w.id] = n - 1;
      }
      this.fireT = this.fireDelay(noAmmo);
      this.recoil = 1;
      this.lastShot = 0;
      return w;
    }

    readyGun(noAmmo, scale) {
      const w = this.weapon();
      if (w.kind !== 'gun') return false;
      if (this.reloadT > 0 || this.fireT > 0) return false;
      if (!noAmmo && this.ammo() <= 0) { this.startReload(false, scale); return false; }
      return true;
    }

    /* 道具是否冷却好。noAmmo（无敌/作弊模式）时道具也免冷却 ——
       用户要求「无敌模式下无人机及其他无冷却时间」：枪械已经免换弹 + 速射，
       道具（手雷 / 医药包 / 三种无人机）同样应该能无限连用。 */
    itemReady(id) { return this.noAmmo ? true : (this.cooldown[id] || 0) <= 0; }
    useItem(id) {
      const w = byId[id];
      if (!w || w.kind !== 'item') return false;
      if (!this.itemReady(id)) return false;
      if (!this.noAmmo) this.cooldown[id] = w.cd;   // 无敌模式不进入冷却
      return true;
    }
    cooldownLeft(id) { return this.cooldown[id] || 0; }
  }

  /* ---------------- 解锁判定 ----------------
     「枪械解锁加入密码（K12345678）」：密码解锁会把 progress 直接推到满级，
     所以这里只负责「按进度解锁」这一半，密码那一半在 game.js 的 tryUnlock('gun')。 */
  const TOTAL_GUN_LEVELS = 150;
  const GUN_UNLOCK_AT = WEAPONS.map((w) => w.unlockAt);
  const GUN_UNLOCK_MAX = Math.max.apply(null, GUN_UNLOCK_AT);   // 120

  function unlockedAt(weaponId, stage) {
    const w = byId[weaponId];
    if (!w) return false;
    return (Math.floor(stage) || 1) >= w.unlockAt || w.unlockAt === 0;
  }
  function unlockedList(stage) {
    return WEAPONS.filter((w) => unlockedAt(w.id, stage)).map((w) => w.id);
  }
  /* 某个关卡进度下「新解锁」的武器（用于关卡开场提示） */
  function newlyUnlocked(stage) {
    const n = Math.floor(stage) || 1;
    return WEAPONS.filter((w) => w.unlockAt === n);
  }

  LD.Guns = {
    WEAPONS, SLOTS, byId, bySlot, BOOSTS, rollBoost,
    MAX_HP, HP_CAP, HP_PER_KILL, Bullet, GunState,
    stepBullet, bulletHitsWall,
    unlockedAt, unlockedList, newlyUnlocked,
    TOTAL_GUN_LEVELS, GUN_UNLOCK_MAX, NO_AMMO_DELAY,
    /* 数字键 1~9 → F1~F9 槽位里「当前可用」的那把（F10 只能用 F 键，见 util.slotHit） */
    slotWeapons(slot, stage) {
      return (bySlot[slot] || []).filter((w) => unlockedAt(w.id, stage));
    },
  };
})();
