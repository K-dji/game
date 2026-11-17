/* game.js — 主循环 / 关卡流程 / 主页菜单 / 操作设置 / 音乐 / 多语言 / 存档 */
(function () {
  const T = LD.TILE, VW = LD.VIEW_W, VH = LD.VIEW_H, STEP = 1 / 60;

  /* ---------- 取 DOM 元素：缺元素时给一个「空壳」，而不是 null ----------
     为什么：这个项目的 HTML 是玩家会直接改的，而 game.js 里到处是
       `$('hud-hp').textContent = ...`、`$('btn-music').onclick = ...`
     这种「取到就写」的写法。只要 HTML 里少了任何一个 id，`null.xxx` 立刻抛
     TypeError —— 而构造函数会因此在半路中断，requestAnimationFrame 永远不会启动，
     整个页面白屏。实测：误删主页的「从第 1 关重新开始」按钮，
     游戏直接运行不了（bindUI 第二行就炸，后面几十个按钮全都没绑上）。

     现在改成返回一个「写什么都接受、调用什么都不做」的空壳，并且**只在控制台警告一次**：
       · 少一个装饰性元素 → 页面照常跑，控制台告诉你缺了哪个
       · 少了 canvas（#cv）→ getContext 返回 undefined，照样会炸，但警告里会点名 #cv
     缺元素清单同时存进 LD.__missingUI，方便自检脚本 / 出问题时一眼看出来。 */
  const __stub = {};
  function missingEl(id) {
    if (__stub[id]) return __stub[id];
    const noop = () => {};
    if (!LD.__missingUI) LD.__missingUI = [];
    if (LD.__missingUI.indexOf(id) < 0) {
      LD.__missingUI.push(id);
      console.warn('[UI] 页面上找不到元素 #' + id + ' —— 与该元素相关的功能会被跳过（其余照常）。');
    }
    const el = {
      __missing: true, id,
      style: {}, dataset: {}, children: [],
      classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
      textContent: '', innerHTML: '', value: '', title: '', disabled: false, checked: false,
      appendChild: noop, removeChild: noop, insertBefore: noop, remove: noop, click: noop,
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
      scrollIntoView: noop, focus: noop, blur: noop,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
      setAttribute: noop, getAttribute: () => null, removeAttribute: noop,
      onclick: null, onchange: null, oninput: null,
    };
    __stub[id] = el;
    return el;
  }
  const $ = (id) => document.getElementById(id) || missingEl(id);
  const T_ = (k, p) => LD.I18N.t(k, p);

  class Game {
    constructor() {
      this.cv = $('cv');
      this.ctx = this.cv.getContext('2d');
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.cv.width = VW * this.dpr;
      this.cv.height = VH * this.dpr;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      this.levels = LD.buildLevels();
      this.save = LD.Save.load();
      this.settings = LD.Settings.load();
      this.index = LD.clamp(this.save.unlocked - 1, 0, 99);
      this.state = 'menu';
      this.cheat = false;
      this.mode = 'level';                 // 'level' | 'endless' | 'coop'
      this.esStage = 1;                    // 无尽模式：已经生成了几段地形
      this.esChunk = 1;                    // 无尽模式：下一段的段号
      this.esDist = 0;                     // 无尽模式：本局最远前进距离（格 = 米）
      this.esMilestone = 0;                // 无尽模式：已拿到的里程碑个数
      this.esScore = 0;                    // 无尽模式：本局分数
      this._esLast = null;                 // 无尽模式：上一局结算数据（供语言切换后重绘）
      this.coopStage = 1;                  // 双人模式：当前关
      this.players = [];                   // 双人模式：两个小人（单人时只有 1 个）
      this.pR = null; this.pB = null;
      this.coopDeaths = { red: 0, blue: 0 };
      this._coopReady = { rOk: false, bOk: false };
      this._waitTip = -9;
      this.winKind = 'level';              // ov-win 复用：'level' | 'coop' | 'gun'
      this.camX = 0; this.deathFlash = 0; this.hidden = false;
      this.deathT = 0; this.winT = 0; this.acc = 0;       this.last = performance.now();
      this.levelDeaths = 0; this.levelTime = 0; this.hudT = 0;
      this.confirmLock = 0;               // 刚弹出结算/通关页时短暂屏蔽确认键

      /* ---------- 枪战模式 ----------
         gunMode: 'level' | 'endless' | 'duel'
         bullets / blasts 由 game 统一推进（世界只做地形查询） */
      this.gunMode = 'level';
      this.gunStage = 1;
      this.gunKills = 0;
      this.gunScore = 0;
      this.gunDist = 0;
      this.gunChunk = 1;
      this.gunWave = 0;
      this.bots = [];
      this.bullets = [];
      this.blasts = [];
      this.drones = [];
      /* 无人机视角：玩家放飞的侦查机 / 遥控中的自爆机。
         非空时相机跟着它走（见 _camTarget）。 */
      this.droneView = null;
      /* 这次爆炸是谁造成的（爆炸前一瞬间设好，结算完立刻清空）：
         只有开火者本人吃「自伤」，队友不受影响。 */
      this.blastOwner = null;
      this._gunRespawnT = 0;
      this._gunLast = null;               // 结算数据（供语言切换后重绘）
      // 双人对枪
      this.duelRounds = 10;
      this.duelP1 = 0; this.duelP2 = 0;
      this.duelRound = 1;
      this.duelState = 'fight';           // fight | settle | over
      this.duelSettleT = 0;
      this._duelLast = null;

      /* ---------- 联机模式 ----------
         online = 正在联机对局中（mode 复用 'coop'：同一套房间 / 门 / 倒计时）
         netRole = 'host'（红魔）| 'guest'（蓝魔）
         传输层在 js/net.js：WebRTC 手动信令（邀请码/应答码）或 BroadcastChannel（本机双窗）。 */
      this.net = null;
      this.netRole = null;
      this.online = false;
      this._netSendT = 0;                  // 状态广播计时（20/s）
      this._netPingT = 0;                  // 延迟探测计时
      this._netPing = 0;                   // 最近一次延迟（ms）
      this._netPeer = null;                // 远端玩家最新状态
      this._netPeerReady = false;          // 远端是否已站进门
      this._netPeerDeadPrev = false;       // 远端上一帧是否死亡（用来数死亡次数）
      this._myReady = false;               // 本地是否已站进门
      this._netLastRecv = 0;               // 最近收到远端消息的时间（掉线检测）
      this._bcAutoJoin = null;             // URL hash 带来的本机双窗自动加入

      /* ---------- 多人房间（js/netroom.js + js/roomplay.js） ----------
         room: NetRoom 实例；roomOn: 正在房间对局中；roomInLobby: 在大厅。
         roomMode: 'coop' 合作闯关 | 'brawl' 散打乱斗（房主在大厅里选）。
         roomPeers/roomReady/roomStats 是网络对局的状态池，详见 roomplay.js。 */
      this.room = null;
      this.roomOn = false;
      /* 客户端常量区分：Android App 内嵌 WebView 带 ?client=android，
         body 上加 app-client class —— 官网页脚（版权 / 下载区块）在 App 里整体隐藏 */
      try { if (/[?&]client=/.test(location.search)) document.body.classList.add('app-client'); } catch (e) {}
      this.roomInLobby = false;
      this.roomMode = 'coop';
      this.roomStage = 1;
      this.roomCfg = { mode: 'coop', stage: 1, time: 90 };
      this.roomRoster = [];
      this.roomSlots = [];
      this.roomPeers = new Map();
      this.roomReady = new Map();
      this.roomStats = {};
      this.roomProfile = null;

      LD.Input.init();
      LD.Input.onCheatToggle = () => this._cheatGate();   // 作弊走权限：至高账号 / 被授权用户免密，其他人无权限
      LD.Input.onCheatPulse = (n) => {
        // 房间对局里权限看房主设置（self / others），其余看云端账号权限
        const roomOk = this.roomOn && LD.RoomPlay && LD.RoomPlay.roomCheatAllowed &&
          LD.RoomPlay.roomCheatAllowed(this);
        if (this._cheatAllowed() || roomOk) this.showCheatPulse(n);
      };
      // 登录态 / 权限变化（登录、登出、被封禁、被授权）→ 刷新作弊 UI
      if (LD.Cloud) LD.Cloud.onAuth(() => this.syncCheatUI());

      // 先套用音效 / 音乐设置，再套用语言
      LD.Sfx.setVolume(this.settings.sfx.volume);
      LD.Sfx.setMuted(!this.settings.sfx.on);
      LD.Music.setVolume(this.settings.music.volume);
      LD.Music.setMuted(!this.settings.music.on);
      LD.I18N.onChange = () => this.refreshText();
      LD.I18N.set(this.settings.lang);

      this.bindUI();
      if (LD.RoomPlay) LD.RoomPlay.bind(this);
      if (LD.Mobile) LD.Mobile.install(this);
      this.loadLevel(this.index, true);
      this.buildSelect();
      this.refreshText();
      this.updateAudioButtons();
      this.syncCheatUI();     // 作弊按钮 / 按键说明 / 用户管理入口跟随账号权限

      // 首次交互解锁音频（浏览器自动播放策略）
      const unlock = () => {
        LD.Music.sync(this.settings);
        document.removeEventListener('pointerdown', unlock);
        document.removeEventListener('keydown', unlock);
      };
      document.addEventListener('pointerdown', unlock);
      document.addEventListener('keydown', unlock);

      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
    }

    /* ---------- 关卡加载 ---------- */
    // 相机目标：双人模式跟随两个人的中点
    _camTarget() {
      const w = this.world;
      let cx;
      /* 无人机视角优先于一切：只要还开着一架（侦查机放飞 / 自爆机遥控），
         镜头就跟着它走 —— 这就是「无人机模式是静如无人机视角」。
         无人机失效时 _stepDrones 会把 droneView 置空，镜头自然回到小人身上。
         用 .dead 兜底一次：万一某一帧 order 变了（无人机先被移除、镜头还没还），
         也不会把相机锁死在最后那一格。 */
      if (this.droneView && !this.droneView.dead) {
        return LD.clamp(this.droneView.x - VW * 0.42, 0, Math.max(0, w.pxW - VW));
      }
      /* 多人房间：人一多就取所有人的「包围盒中点」，尽量让大家都留在画面里；
         闯关已到终点时例外 —— 镜头全程跟着还没通关的那位（观战视角） */
      if (this.roomOn && this.players && this.players.length) {
        const sp = this._spectateOf != null
          ? this.players.find((p) => p.roomSlot === this._spectateOf)
          : null;
        if (sp) {
          cx = sp.cx;
        } else {
          let lo = Infinity, hi = -Infinity;
          for (const p of this.players) {
            if (p.cx < lo) lo = p.cx;
            if (p.cx > hi) hi = p.cx;
          }
          cx = (lo + hi) / 2;
        }
      } else if (this.mode === 'coop' && this.pR && this.pB) cx = (this.pR.cx + this.pB.cx) / 2;
      else if (this.mode === 'gun') {
        // 枪战是一屏竞技场；对枪时取两人中点（万一被击退到边缘也看得见）
        if (this.gunMode === 'duel' && this.pR && this.pB) cx = (this.pR.cx + this.pB.cx) / 2;
        else if (this.pR) cx = this.pR.cx;
        else return 0;
      }
      else if (this.player) cx = this.player.cx;
      else return 0;
      return LD.clamp(cx - VW * 0.42, 0, Math.max(0, w.pxW - VW));
    }

    // 用当前 this.level 重建世界与玩家（100 关 / 无尽层 / 双人关共用）
    _buildWorld() {
      // 枪战模式走自己的构建路径（玩家要带枪 / 血量 / 人机）
      if (this.mode === 'gun') { this._buildGunWorld(); return; }
      const lv = this.level;
      this.world = new LD.World(lv);
      this.world.setCheat(this.cheat);
      this.coopDeaths = { red: 0, blue: 0 };
      this._coopReady = { rOk: false, bOk: false };
      this._waitTip = -9;

      if (this.mode === 'coop' || lv.coop) {
        // 双人：红魔 + 蓝魔，各有各的出生点
        this.pR = new LD.Player(this.world, 'red', this.world.spawn);
        this.pB = new LD.Player(this.world, 'blue', this.world.spawn2 || this.world.spawn);
        /* 双人关是「一屏房间」，两个人必须同时看得见 —— 小人小一圈，
           视野里才装得下更多台子，跳起来也不容易顶到上面的平台。
           改完尺寸要重新 reset 一次，让脚正好落在格子顶面上。 */
        for (const p of [this.pR, this.pB]) { p.w = 18; p.h = 24; p.reset(this.world); }
        this.players = [this.pR, this.pB];
        this.player = this.pR;                 // 兼容单人口径（相机 / 试玩工具 / 存档）
      } else {
        this.pR = null; this.pB = null;
        this.player = new LD.Player(this.world);
        this.players = [this.player];
      }
      // 两个小人互为「软实体」：可以踩在对方头上借高度，水平方向可以互相穿过
      this.world.soft = this.players;
      for (const p of this.players) { p.invincible = this.cheat; p.fly = this.cheat; }

      this.levelDeaths = 0;
      this.levelTime = 0;
      this.deathFlash = 0; this.deathT = 0; this.winT = 0;
      LD.FX.clear();
      this.camX = this._camTarget();
      this.updateHUD(true);
    }

    loadLevel(i, silent) {
      this.mode = 'level';
      this.index = LD.clamp(i, 0, this.levels.length - 1);
      this.level = this.levels[this.index];
      this._buildWorld();
      if (!silent) this.showHint();
    }

    /* ---------- 双人模式 ---------- */
    /* 已解锁到第几关：双人关的「闸门」只有这一处判定，
       选择页的锁、开始按钮、loadCoop 全走它，避免三处各算一套。 */
    coopCap() {
      return LD.clamp(Math.floor(this.save.coop.unlocked) || 1, 1, LD.COOP_COUNT);
    }

    loadCoop(stage, showHint) {
      this.mode = 'coop';
      /* 关卡没解锁就不许进。重置进度之后 this.coopStage 还留着上一次选的那一关，
         不钳一下的话「开始这一关」会直接把没解锁的第 N 关放出来。 */
      this.coopStage = LD.clamp(Math.floor(stage) || 1, 1, this.coopCap());
      this.level = LD.genCoop(this.coopStage);
      /* 倒计时必须在 _buildWorld 之前赋好：_buildWorld 结尾会刷一次 HUD，
         那一刻 coopTimeLimit 还是上一关的值（第一关干脆是 undefined），
         剩余时间算出来是 NaN，分数跟着变成 NaN。 */
      this.coopTimeLimit = this.level.timeLimit || Math.round(45 + this.coopStage * 1.1);
      this.coopLeft = this.coopTimeLimit;
      this.coopState = 'run';        // run | done | timeout
      this._coopWarn = 0;
      this._buildWorld();
      if (showHint) this.showHint();
    }

    openCoop() {
      this.state = 'coopMenu';
      this.resetUnlockUI('coop');
      this.buildCoopSelect();
      this.refreshCoop();
      this.open('ov-coop');
    }

    startCoop(stage) {
      this.loadCoop(stage == null ? this.coopStage : stage, false);
      this.state = 'playing';
      this.closeAll();
      this.last = performance.now();
      LD.Music.sync(this.settings);
      this.flash(T_('toast.coopStart', { n: this.coopStage }));
    }

    refreshCoop() {
      const c = this.save.coop;
      let done = 0;
      for (const k in c.cleared) done++;
      $('coop-stat').innerHTML =
        `<span>${T_('coop.cleared')} <b>${done}/${LD.COOP_COUNT}</b></span>` +
        `<span>${T_('coop.totalScore')} <b>${c.score || 0}</b></span>` +
        `<span>${T_('coop.totalDeaths')} <b>${c.deaths || 0}</b></span>`;
      const k = $('coop-keys');
      if (k) {
        const L = (a) => LD.Settings.label(a) || '—';
        // 红魔：显示排除掉蓝魔键之后「真正生效」的那些键，否则会把 A / D / W 也算在红魔头上
        const ex = LD.Settings.coopKeyUnion();
        const R = (a) => LD.Settings.labelExcept(a, ex);
        k.innerHTML =
          `<div class="key"><b class="c-red">${R('left')} / ${R('right')} / ${R('jump')}</b> ${T_('coop.p1')}</div>` +
          `<div class="key"><b class="c-blue">${L('p2left')} / ${L('p2right')} / ${L('p2jump')}</b> ${T_('coop.p2')}</div>`;
      }
      $('btn-coop-play').textContent = T_('coop.play') + ' · ' + T_('coop.stage', { n: this.coopStage });
    }

    buildCoopSelect() {
      const grid = $('coop-grid');
      if (!grid) return;
      const c = this.save.coop;
      const cap = this.coopCap();
      // 光标落在没解锁的关上就把她收回最后一关已解锁处（重置进度后必然发生）
      if (!(this.coopStage >= 1 && this.coopStage <= cap)) this.coopStage = cap;
      grid.innerHTML = '';
      for (let i = 1; i <= LD.COOP_COUNT; i++) {
        const b = document.createElement('div');
        const unlocked = i <= cap;
        const cleared = !!c.cleared[i];
        b.className = 'lv' + (cleared ? ' both' : '') + (unlocked ? '' : ' lock') + (i === this.coopStage ? ' cur' : '');
        b.textContent = i;
        const best = c.best[i] || 0;
        b.title = unlocked
          ? (cleared ? T_('coop.cleared') + (best ? ` · ${T_('coop.bestScore')} ${best}` : '') : T_('coop.stage', { n: i }))
          : T_('coop.locked');
        if (unlocked) b.onclick = () => { this.coopStage = i; this.refreshCoop(); this.buildCoopSelect(); LD.Sfx.ui(); };
        grid.appendChild(b);
      }
      // 全解锁之后按钮就没用了，收起来（省得像按坏了）
      const ub = $('btn-coop-unlock-all');
      if (ub) ub.style.display = cap >= LD.COOP_COUNT ? 'none' : '';
    }

    // 两个人的键位：红魔用 left/right/jump/down（并让出所有分给蓝魔的键），蓝魔用 p2*
    _coopInput() {
      const I = LD.Input, ex = LD.Settings.coopKeyUnion();
      return {
        red: {
          left: () => I.anyExcept('left', ex),
          right: () => I.anyExcept('right', ex),
          up: () => I.anyExcept('jump', ex),
          downKey: () => I.anyExcept('down', ex),
          jumpPressed: () => I.actionPressedExcept('jump', ex),
          jumpHeld: () => I.anyExcept('jump', ex),
        },
        blue: {
          left: () => I.any('p2left'),
          right: () => I.any('p2right'),
          up: () => I.any('p2jump'),
          downKey: () => I.any('p2down'),
          jumpPressed: () => I.actionPressed('p2jump'),
          jumpHeld: () => I.any('p2jump'),
        },
      };
    }

    _coopDeath(p, hit) {
      if (!p.kill()) return;
      p.deathT = 0.85;
      this.coopDeaths[p.kind]++;
      this.save.coop.deaths = (this.save.coop.deaths || 0) + 1;
      this.save.totalDeaths++;
      LD.Save.flush();
      this.deathFlash = 1;
      this.world.shake = 1;
      LD.Sfx.die();
      LD.FX.burst(hit.x + hit.w / 2, hit.y + hit.h / 2, 16, '#ff4d6d', 4.5);
      LD.FX.burst(p.cx, p.cy, 10, p.kind === 'blue' ? '#8fe4ff' : '#ffd23f', 3.4);
      this.updateHUD(true);
    }

    /* 双人模式一帧：两个人各自独立物理，谁死谁回起点，两个人同时进门才通关 */
    _stepCoop(dt) {
      // 多人房间（合作 / 散打）走专门的一帧，见 roomplay.js
      if (this.roomOn) { LD.RoomPlay.step(this, dt); return; }
      // 旧的双人联机入口已改走房间流程，这里只是兜底
      if (this.online) { this._stepOnline(dt); return; }
      const w = this.world, ci = this._coopInput();
      this.levelTime += dt;
      this.coopLeft = Math.max(0, this.coopTimeLimit - this.levelTime);
      // 倒计时归零：两个人没能在时限内同时站进自己的门 → 这一关失败
      if (this.coopLeft <= 0) { this.coopTimeUp(); return; }
      this.coopWarnTick();
      for (const p of this.players) {
        if (p.dead) {
          p.deathT -= dt;
          if (p.deathT <= 0) p.reset(w);
          continue;
        }
        p.update(dt, w, ci[p.kind]);
      }
      this.camX = LD.lerp(this.camX, this._camTarget(), 0.16);

      for (const p of this.players) {
        if (p.dead) continue;
        const hit = w.hazardHit(p);
        if (hit) { this._coopDeath(p, hit); continue; }
        if (!p.invincible && w.fellOut(p)) { this._coopDeath(p, { x: p.cx - 10, y: p.y, w: 20, h: 20 }); continue; }
        if (!this.cheat && p.y > w.pxH + 200) { this._coopDeath(p, { x: p.cx, y: p.y, w: 20, h: 20 }); }
      }

      if (this.pR.dead || this.pB.dead) { this._coopReady = { rOk: false, bOk: false }; return; }
      const rOk = w.doorHit(this.pR, 'red');
      const bOk = w.doorHit(this.pB, 'blue');
      this._coopReady = { rOk, bOk };
      if (rOk && bOk) { this.coopClear(); return; }
      if (rOk || bOk) {
        if (this.levelTime - this._waitTip > 2.4) {
          this._waitTip = this.levelTime;
          this.flash(T_('toast.coopWait'), 1400);
        }
      }
    }

    /* 双人关结算分数：基础分 + 剩余时间奖励 − 死亡扣分（下限 0）。
       分数存在的意义就是「逼你别磨蹭」：同一关跑得越快、死得越少，分越高。 */
    coopScoreOf() {
      const left = Math.max(0, (this.coopTimeLimit || 0) - this.levelTime);
      const base = this.level.scoreBase || (100 + this.coopStage * 12);
      const bonus = Math.round(left) * 6;
      const penalty = (this.coopDeaths.red + this.coopDeaths.blue) * 25;
      return { score: Math.max(0, base + bonus - penalty), base, bonus, penalty };
    }

    coopClear() {
      const c = this.save.coop;
      c.cleared[this.coopStage] = true;
      if (c.unlocked < this.coopStage + 1) c.unlocked = Math.min(LD.COOP_COUNT, this.coopStage + 1);
      const R = this.coopScoreOf();
      c.score = (c.score || 0) + R.score;
      const prevBest = c.best[this.coopStage] || 0;
      const isBest = R.score > prevBest;
      if (isBest) c.best[this.coopStage] = R.score;
      LD.Save.flush();
      this._coopWinUI(R, true);
      this.buildCoopSelect();
      this.refreshCoop();
    }

    /* 双人 / 联机通关的结算界面（联机时房主调用一次并广播，房客收到广播后调用）。
       save = true 表示写本地存档（只有房主写；房客的进度跟随房主的关卡选择）。 */
    _coopWinUI(R, save) {
      let isBest = false;
      if (save) {
        const c = this.save.coop;
        const prevBest = c.best[this.coopStage] || 0;
        isBest = R.score > prevBest;
        if (isBest) c.best[this.coopStage] = R.score;
      }
      this.coopState = 'done';
      this.coopResult = R;
      LD.Sfx.win();
      LD.FX.cone(this.world.door.x + T / 2, this.world.door.y + T, '#35e0a1');
      if (this.world.door2) LD.FX.cone(this.world.door2.x + T / 2, this.world.door2.y + T, '#4fc3ff');
      this.state = 'won';
      this.winT = 0;
      this.confirmLock = 0.35;
      this.winKind = 'coop';
      const last = this.coopStage >= LD.COOP_COUNT;
      if (last) LD.Sfx.final();

      $('win-title').textContent = this.online
        ? T_('online.win', { n: this.coopStage })
        : (last ? T_('coop.winAll') : T_('coop.win', { n: this.coopStage }));
      $('win-tip').textContent = this.online
        ? T_('online.winTip')
        : (last ? T_('coop.winAllTip') : T_('coop.winTip'));
      $('win-stat').innerHTML =
        `<span>${T_('coop.score')} <b>${R.score}</b>${isBest ? ' ★' : ''}</span>` +
        `<span>${T_('coop.scoreLeft')} <b>+${R.bonus}</b></span>` +
        `<span>${T_('coop.scoreDeath')} <b>-${R.penalty}</b></span>` +
        `<span>${T_('win.time')} <b>${this.levelTime.toFixed(2)}s</b></span>` +
        `<span class="c-red">${T_('coop.p1short')} <b>${this.coopDeaths.red}</b></span>` +
        `<span class="c-blue">${T_('coop.p2short')} <b>${this.coopDeaths.blue}</b></span>` +
        (save ? `<span>${T_('coop.totalScore')} <b>${this.save.coop.score}</b></span>` : '');
      const nextBtn = $('btn-next');
      // 联机时「下一关」由房主说了算：房客的按钮变成等待提示
      if (this.online && this.netRole === 'guest') {
        nextBtn.textContent = T_('online.waitNext');
        nextBtn.disabled = true;
      } else {
        nextBtn.textContent = last ? T_('coop.home') : T_('coop.next') + ' →';
        nextBtn.disabled = false;
      }
      this.updateHUD(true);
      this.open('ov-win');
    }

    /* 倒计时归零：这一关判负（不结算分数，也不解锁下一关） */
    coopTimeUp() {
      if (this.coopState !== 'run') return;
      this.coopState = 'timeout';
      this.state = 'coopFail';
      this.confirmLock = 0.45;
      this.winKind = 'coop';
      this.world.shake = 1.2;
      this.deathFlash = 0.8;
      LD.Sfx.die();
      $('fail-title').textContent = T_('coop.timeup');
      $('fail-tip').textContent = T_('coop.timeupTip');
      $('fail-stat').innerHTML =
        `<span>${T_('coop.timeLeft')} <b>0.0s</b></span>` +
        `<span>${T_('win.time')} <b>${this.levelTime.toFixed(2)}s</b></span>` +
        `<span class="c-red">${T_('coop.p1short')} <b>${this.coopDeaths.red}</b></span>` +
        `<span class="c-blue">${T_('coop.p2short')} <b>${this.coopDeaths.blue}</b></span>`;
      this.updateHUD(true);          // 立刻把倒计时刷成 0.0s（不然 HUD 还停在最后一帧的读数）
      this.open('ov-fail');
    }

    /* 时间快到了：每秒提醒一次（倒计时最后 10 秒） */
    coopWarnTick() {
      const left = Math.ceil(this.coopLeft || 0);
      if (left > 10 || left <= 0) return;
      if (left === this._coopWarn) return;
      this._coopWarn = left;
      this.flash(T_('coop.timed', { t: left }), 900);
    }

    /* ================= 联机模式 =================
       复用双人模式的房间 / 门 / 倒计时 / 结算，差别只在「另一个小人由网络驱动」：
         · 房主 = 红魔，房客 = 蓝魔；两边关卡完全相同（LD.genRoom 按关号确定性生成）
         · 本地玩家每帧本地物理，状态以 20Hz 广播；远端玩家插值跟随
         · 门判定：本地自己算，远端的 ready 标志随状态包到达
         · 通关 / 超时以房主为准，广播给房客
         · 传输：WebRTC（邀请码 / 应答码手动信令）或 BroadcastChannel（本机双窗） */
    openOnline() {
      // 多人房间入口（2~8 人 / 房主选模式 / 散打 / 自定义皮肤），见 roomplay.js
      if (LD.RoomPlay) { LD.RoomPlay.openOnline(this); return; }
      this.state = 'onlineMenu';
      this.refreshOnlineUI();
      this.open('ov-online');
    }

    refreshOnlineUI() {
      $('online-menu').style.display = '';
      $('net-host-panel').classList.add('hidden');
      $('net-guest-panel').classList.add('hidden');
      $('net-status').textContent = '';
      $('net-invite').value = '';
      $('net-answer-in').value = '';
      $('net-invite-in').value = '';
      $('net-answer').value = '';
      $('net-host-role').textContent = T_('online.roleHost');
      $('net-guest-role').textContent = T_('online.roleGuest');
      // 房主的关卡下拉：1 ~ 已解锁的双人关数
      const sel = $('net-host-stage');
      if (sel) {
        sel.innerHTML = '';
        for (let i = 1; i <= this.coopCap(); i++) {
          const o = document.createElement('option');
          o.value = String(i);
          o.textContent = T_('coop.stage', { n: i });
          sel.appendChild(o);
        }
        sel.value = String(this.coopStage);
      }
    }

    /* ---- 房主：生成邀请码，等房客的应答码 ---- */
    async netHost() {
      this.netClose();
      $('online-menu').style.display = 'none';
      $('net-host-panel').classList.remove('hidden');
      $('net-status').textContent = T_('online.genInvite');
      try {
        this.net = LD.Net.host({
          onMsg: (m) => this._netMsg(m),
          onOpen: () => this._netOpen(),
          onClose: () => this.netPeerLeft(),
        });
        this.netRole = 'host';
        const code = await this.net.invite();
        $('net-invite').value = code;
        $('net-status').textContent = T_('online.waitPeer');
      } catch (e) {
        console.warn('[net] host failed:', e);
        this.netClose();
        $('net-status').textContent = T_('online.connFail');
      }
    }

    async netHostConnect() {
      if (!this.net) return;
      const code = $('net-answer-in').value;
      if (!code || !code.trim()) { $('net-status').textContent = T_('online.connFail'); return; }
      $('net-status').textContent = T_('online.waitPeer');
      try {
        await this.net.connect(code);
        // 连接成功后 dc 会 open → _netOpen → 自动开局
      } catch (e) {
        console.warn('[net] connect failed:', e);
        $('net-status').textContent = T_('online.connFail');
      }
    }

    /* ---- 房客：粘贴邀请码 → 生成应答码 ---- */
    netJoinPanel() {
      this.netClose();
      try {
        this.net = LD.Net.guest({
          onMsg: (m) => this._netMsg(m),
          onOpen: () => { $('net-status').textContent = T_('online.waitHost'); },
          onClose: () => this.netPeerLeft(),
        });
        this.netRole = 'guest';
        $('online-menu').style.display = 'none';
        $('net-guest-panel').classList.remove('hidden');
        $('net-status').textContent = '';
      } catch (e) {
        console.warn('[net] guest failed:', e);
        this.netClose();
        this.refreshOnlineUI();
      }
    }

    async netGuestJoin() {
      if (!this.net) return;
      const code = $('net-invite-in').value;
      if (!code || !code.trim()) { $('net-status').textContent = T_('online.connFail'); return; }
      $('net-status').textContent = T_('online.genAnswer');
      try {
        await this.net.join(code);
        const ans = await this.net.answer();
        $('net-answer').value = ans;
        $('net-status').textContent = T_('online.waitPeer');
      } catch (e) {
        console.warn('[net] join failed:', e);
        $('net-status').textContent = T_('online.connFail');
      }
    }

    /* ---- 本机双窗联机：房主开一个带 #bc=<频道> 的新窗口，新房客自动加入 ---- */
    netBC() {
      this.netClose();
      const chan = Math.random().toString(36).slice(2, 9);
      try {
        this.net = LD.Net.host({
          bc: 'kbnet-' + chan,
          onMsg: (m) => this._netMsg(m),
          onOpen: () => this._netOpen(),
          onClose: () => this.netPeerLeft(),
        });
        this.netRole = 'host';
        this.net.send({ t: 'hello' });
        const w = window.open(location.href.split('#')[0] + '#bc=' + chan,
          'kbnet-' + chan, 'width=1020,height=760');
        if (!w) {
          this.netClose();
          this.refreshOnlineUI();
          this.flash(T_('online.connFail'), 2000);
          return;
        }
        $('online-menu').style.display = 'none';
        $('net-host-panel').classList.remove('hidden');
        $('net-status').textContent = T_('online.waitPeer');
      } catch (e) {
        console.warn('[net] bc failed:', e);
        this.netClose();
        this.refreshOnlineUI();
        this.flash(T_('online.connFail'), 2000);
      }
    }

    /* 传输建立：房主立刻按选中的关卡开局并广播；房客等 stage 消息 */
    _netOpen() {
      // 后台心跳：切到后台时游戏循环会被浏览器暂停，状态包停发，
      // 对面就会误判「掉线」自动退出。setInterval 在后台仍会跑（限流到 ≥1 秒），
      // 用它每 1.5 秒发一个 ping 保活，双方就不会因为切后台被踢。
      if (this._netBeatT) clearInterval(this._netBeatT);
      this._netBeatT = setInterval(() => {
        if (!this.net) { clearInterval(this._netBeatT); this._netBeatT = null; return; }
        try { this.net.send({ t: 'ping', ts: Date.now() }); } catch (e) {}
      }, 1500);
      if (this.netRole !== 'host') return;
      const stage = parseInt(($('net-host-stage') || {}).value || '1', 10) || 1;
      this.startNetHost(stage);
    }

    /* 开局（房主 / 房客共用）：关卡、角色标记、状态机 */
    startNetHost(stage) {
      this.mode = 'coop';
      this.online = true;
      this.netRole = 'host';
      this.coopStage = LD.clamp(stage, 1, LD.COOP_COUNT);
      this.loadCoop(this.coopStage, false);
      this._markNetPlayers();
      this.state = 'playing';
      this.closeAll();
      this.last = performance.now();
      if (this.net) this.net.send({ t: 'stage', n: this.coopStage });
      this.flash(T_('online.connected', { n: this.coopStage }), 2200);
      this._netTag();
    }

    startNetGuest(stage) {
      this.mode = 'coop';
      this.online = true;
      this.netRole = 'guest';
      this.coopStage = LD.clamp(stage, 1, LD.COOP_COUNT);
      this.loadCoop(this.coopStage, false);
      this._markNetPlayers();
      this.state = 'playing';
      this.closeAll();
      this.last = performance.now();
      this.flash(T_('online.connected', { n: this.coopStage }), 2200);
      this._netTag();
    }

    /* 本地玩家 = 我的角色；另一个 = 网络驱动（头上挂牌子） */
    _markNetPlayers() {
      const mine = this.netRole === 'host' ? 'red' : 'blue';
      for (const p of this.players) {
        p.remote = p.kind !== mine;
        p.tag = p.remote ? (p.kind === 'blue' ? T_('coop.p2short') : T_('coop.p1short')) : '';
      }
    }

    /* 联机一帧 */
    _stepOnline(dt) {
      const w = this.world;
      this.levelTime += dt;
      this.coopLeft = Math.max(0, this.coopTimeLimit - this.levelTime);
      this.coopWarnTick();

      // 掉线检测：12 秒没收到任何消息（ping / pong / state）才当作对手离开。
      // 有后台心跳保活，正常切标签页 / 锁屏不会再误判踢人。
      if (this._netLastRecv && performance.now() - this._netLastRecv > 12000) {
        this.netPeerLeft();
        return;
      }

      // 房主的倒计时是权威：归零由房主宣判并广播
      if (this.coopLeft <= 0) {
        if (this.netRole === 'host') { this.netTimeUp(); }
        return;
      }

      /* ---- 广播本地状态（20Hz）---- */
      this._netSendT -= dt;
      if (this._netSendT <= 0 && this.net) {
        this._netSendT = 0.05;
        const me = this.netRole === 'host' ? this.pR : this.pB;
        this.net.send({
          t: 'state',
          x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10,
          vx: Math.round(me.vx * 10) / 10, vy: Math.round(me.vy * 10) / 10,
          face: me.face, walk: Math.round(me.walk * 10) / 10,
          grounded: !!me.grounded, dead: !!me.dead,
          ready: this._myReady, tt: Math.round(this.levelTime * 100) / 100,
        });
      }

      /* ---- 延迟探测（2.5s 一次）---- */
      this._netPingT -= dt;
      if (this._netPingT <= 0) {
        this._netPingT = 2.5;
        if (this.net) this.net.ping().then((ms) => { this._netPing = ms; this._netTag(); }).catch(() => {});
      }

      const ci = this._coopInput();
      const me = this.netRole === 'host' ? this.pR : this.pB;

      /* ---- 本地玩家：物理 + 死亡 ---- */
      if (me.dead) {
        me.deathT -= dt;
        if (me.deathT <= 0) me.reset(w);
      } else {
        me.update(dt, w, ci.red);            // 联机时本机只有一个人，统一用主键位
      }

      /* ---- 远端玩家：插值跟随网络状态 ---- */
      this._applyPeer(dt);

      this.camX = LD.lerp(this.camX, this._camTarget(), 0.16);

      if (!me.dead) {
        const hit = w.hazardHit(me);
        if (hit) { this._coopDeath(me, hit); }
        else if (!me.invincible && w.fellOut(me)) this._coopDeath(me, { x: me.cx - 10, y: me.y, w: 20, h: 20 });
        else if (!this.cheat && me.y > w.pxH + 200) this._coopDeath(me, { x: me.cx, y: me.y, w: 20, h: 20 });
      }

      /* ---- 门判定：本地自己算，远端的 ready 来自网络 ---- */
      const myOk = w.doorHit(me, me.kind);
      this._myReady = myOk;
      const rOk = this.netRole === 'host' ? myOk : this._netPeerReady;
      const bOk = this.netRole === 'host' ? this._netPeerReady : myOk;
      this._coopReady = { rOk, bOk };
      if (rOk && bOk && this.netRole === 'host') { this.netClear(); return; }
      if ((rOk || bOk) && this.levelTime - this._waitTip > 2.4) {
        this._waitTip = this.levelTime;
        this.flash(T_('toast.coopWait'), 1400);
      }
    }

    /* 把远端玩家的网络状态插值到本地小人上（瞬移超过 200px 直接吸附：那是复活了） */
    _applyPeer(dt) {
      const peer = this.netRole === 'host' ? this.pB : this.pR;
      const s = this._netPeer;
      if (!s) { if (!peer.dead) peer.reset(this.world); return; }
      if (Math.abs(s.x - peer.x) > 200 || Math.abs(s.y - peer.y) > 200) {
        peer.x = s.x; peer.y = s.y;                 // 复活 / 大跳变：直接吸附
      } else {
        const k = Math.min(1, dt * 12);
        peer.x += (s.x - peer.x) * k;
        peer.y += (s.y - peer.y) * k;
      }
      peer.vx = s.vx || 0; peer.vy = s.vy || 0;
      peer.face = s.face || peer.face;
      peer.walk = s.walk || 0;
      peer.grounded = !!s.grounded;
      const dead = !!s.dead;
      if (dead && !this._netPeerDeadPrev) {
        // 远端刚死：本地放个死亡粒子，并计入对面的死亡数
        this.coopDeaths[peer.kind]++;
        LD.FX.burst(peer.cx, peer.cy, 12, peer.kind === 'blue' ? '#8fe4ff' : '#ffd23f', 3.2);
        this.updateHUD(true);
      }
      this._netPeerDeadPrev = dead;
      peer.dead = dead;
      if (!dead) { peer.deathT = 0; peer.alpha = 1; }
    }

    /* ---- 消息分发 ---- */
    _netMsg(m) {
      if (!m || !m.t) return;
      this._netLastRecv = performance.now();
      switch (m.t) {
        case 'hello':
          break;
        case 'stage':
          // 房客收到房主的关卡广播才真正开局（重开 / 下一关也走这条）
          if (this.netRole === 'guest') this.startNetGuest(m.n);
          break;
        case 'state':
          this._netPeer = m;
          this._netPeerReady = !!m.ready;
          // 房客的时钟跟随房主（只进不退）
          if (this.netRole === 'guest' && m.tt != null) {
            this.levelTime = Math.max(this.levelTime, m.tt);
            this.coopLeft = Math.max(0, this.coopTimeLimit - this.levelTime);
          }
          break;
        case 'win': {
          const R = { score: m.score || 0, base: m.base || 0, bonus: m.bonus || 0, penalty: m.penalty || 0 };
          this.coopDeaths.red = m.dR || 0;
          this.coopDeaths.blue = m.dB || 0;
          if (m.time != null) this.levelTime = m.time;
          this._coopWinUI(R, false);
          break;
        }
        case 'timeup':
          this.coopTimeUp();
          break;
        case 'restart':
          // 房客按了重开 → 房主重载并广播 stage → 房客跟着重载
          if (this.netRole === 'host' && this.online) this.startNetHost(this.coopStage);
          break;
        case 'next':
          if (this.netRole === 'host' && this.state === 'won') this.netNext();
          break;
        case 'bye':
          this.netPeerLeft();
          break;
        case 'ping':
          if (this.net) this.net.send({ t: 'pong', ts: m.ts });
          break;
        default:
          break;
      }
    }

    /* ---- 结算 / 超时 / 下一关（房主权威）---- */
    netClear() {
      const R = this.coopScoreOf();
      if (this.net) {
        this.net.send({
          t: 'win', score: R.score, base: R.base, bonus: R.bonus, penalty: R.penalty,
          dR: this.coopDeaths.red, dB: this.coopDeaths.blue,
          time: Math.round(this.levelTime * 100) / 100,
        });
      }
      this._coopWinUI(R, true);
    }

    netTimeUp() {
      if (this.coopState !== 'run') return;
      if (this.net) this.net.send({ t: 'timeup' });
      this.coopTimeUp();
    }

    netNext() {
      if (this.coopStage >= LD.COOP_COUNT) { this.netLeave(); return; }
      this.startNetHost(this.coopStage + 1);
    }

    /* ---- 离开 / 掉线 ---- */
    netLeave() {
      if (this.net) { try { this.net.send({ t: 'bye' }); } catch (e) {} }
      this.netClose();
      this.online = false;
      this.netRole = null;
      this.goHome();
    }

    netPeerLeft() {
      const wasOnline = this.online;
      this.netClose();
      this.online = false;
      this.netRole = null;
      if (wasOnline) this.flash(T_('online.peerLeft'), 2600);
      this.goHome();
    }

    netClose() {
      if (this._netBeatT) { clearInterval(this._netBeatT); this._netBeatT = null; }
      if (this.net) { this.net.close(); this.net = null; }
      const tag = $('net-tag');
      if (tag) tag.classList.remove('on');
    }

    netCancel() {
      // 取消当前联机流程（还没开局）：礼貌通知对手后回联机菜单
      if (this.net) { try { this.net.send({ t: 'bye' }); } catch (e) {} }
      this.netClose();
      this.online = false;
      this.netRole = null;
      this.refreshOnlineUI();
    }

    netCopy(id) {
      const el = $(id);
      const text = el.value || el.textContent || '';
      if (!text) return;
      const done = () => { this.flash(T_('online.copyOk'), 1200); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => this._netCopyFallback(el, text));
      } else {
        this._netCopyFallback(el, text);
      }
    }
    _netCopyFallback(el, text) {
      try {
        el.removeAttribute('readonly');
        el.focus();
        el.select();
        const ok = document.execCommand('copy');
        el.setAttribute('readonly', 'readonly');
        if (ok) this.flash(T_('online.copyOk'), 1200);
        else this.flash(T_('online.copyFail'), 1800);
      } catch (e) {
        this.flash(T_('online.copyFail'), 1800);
      }
    }

    /* 右上角联机状态牌：角色 + 延迟 */
    _netTag() {
      const el = $('net-tag');
      if (!el) return;
      if (!this.online) { el.classList.remove('on'); return; }
      el.classList.add('on');
      el.textContent = (this.netRole === 'host' ? T_('online.roleHost') : T_('online.roleGuest'))
        + (this._netPing ? ' · ' + this._netPing + 'ms' : '');
    }

    /* ================= 枪战模式 =================
       三种子玩法共用同一套「一屏竞技场 + 持枪小人 + 子弹 + 人机」的循环：
         gunMode 'level'   150 关，人机全灭即通关
         gunMode 'endless' 一直往右接段，按推进距离记分，死一次结束
         gunMode 'duel'    回合制对枪，双方各占一侧
       与普通模式的区别集中在：血量 / 子弹 / 人机 / 木箱掉落 / 作弊=无敌速射。 */

    /* 已解锁到第几关：枪战关卡有独立进度 save.gun.unlocked。
       密码解锁（K12345678）会把它推到 150。
       【权限规则】全部枪械只有至高账号（kaobei）直接可用；
       普通玩家必须自己打枪战关卡解锁（通关第 n 关解锁第 n+1 关的枪）。 */
    gunCap() {
      if (LD.Cloud && LD.Cloud.isAdmin()) return LD.Guns.TOTAL_GUN_LEVELS;   // 至高账号：全枪械
      const g = this.save.gun;
      /* 老存档里 unlockedAll=true 多半是历史作弊（口令解锁）残留：
         非至高账号一律清掉，按真实通关进度重算（最高通关关 +1）。 */
      if (g.unlockedAll && !g._capReset) {
        let mx = 1;
        for (const k in g.cleared) if (g.cleared[k]) mx = Math.max(mx, (parseInt(k, 10) || 1) + 1);
        g.unlocked = LD.clamp(mx, 1, LD.Guns.TOTAL_GUN_LEVELS);
        g.unlockedAll = false;
        g._capReset = true;
        LD.Save.flush();
      }
      return LD.clamp(Math.floor(g.unlocked) || 1, 1, LD.Guns.TOTAL_GUN_LEVELS);
    }

    /* 判断「这把枪解锁了没有」时该拿哪个关卡号 —— 取「当前关卡」与「已解锁进度」的**较大者**。
       ------------------------------------------------------------------
       【曾经的 bug】所有解锁判定用的都是 `this.gunStage`（＝当前正在打的第几关）。
       于是用密码解锁全部枪械（save.gun.unlocked = 150）之后，只要重新去打第 3 关，
       gunStage 就只有 3 —— 物品栏只画得出 3 个格子、按 F4 也切不到已经解锁的火箭筒。
       玩家看到的就是「枪械解锁后无法使用且武器栏未出现所有枪械」。
       解锁本来就是**永久**的，判定口径必须跟着「解锁进度」而不是「当前关卡」。 */
    gunUnlockStage() {
      const cur = Math.floor(this.gunStage) || 1;
      return Math.max(cur, this.gunCap());
    }

    /* 玩家当前可用枪械列表（按已解锁关卡过滤） */
    gunAvailable() {
      const all = LD.Cloud && LD.Cloud.isAdmin();
      return LD.Guns.unlockedList(this.gunMode === 'duel'
        ? (all ? LD.Guns.TOTAL_GUN_LEVELS : this.gunUnlockStage())   // 对枪也遵守解锁规则（至高账号除外）
        : this.gunUnlockStage());
    }

    openGun() {
      this.state = 'gunMenu';
      this.resetUnlockUI('gun');
      this.buildGunSelect();
      this.refreshGun();
      this.open('ov-gun');
    }

    refreshGun() {
      const g = this.save.gun;
      let done = 0;
      for (const k in g.cleared) if (g.cleared[k]) done++;
      const st = $('gun-stat');
      if (st) {
        st.innerHTML =
          `<span>${T_('gun.cleared')} <b>${done}/${LD.Guns.TOTAL_GUN_LEVELS}</b></span>` +
          `<span>${T_('gun.bestStage')} <b>${g.bestStage || 0}</b></span>` +
          `<span>${T_('gun.totalScore')} <b>${g.score || 0}</b></span>` +
          `<span>${T_('gun.kills')} <b>${g.kills || 0}</b></span>`;
      }
      // 枪械清单：显示每把枪的槽位 / 名字 / 解锁关卡
      const ar = $('gun-arsenal');
      if (ar) {
        const cap = this.gunCap();
        ar.innerHTML = LD.Guns.SLOTS.map((slot) => {
          const list = LD.Guns.bySlot[slot] || [];
          return list.map((w) => {
            const on = cap >= w.unlockAt || w.unlockAt === 0;
            const cur = on ? '' : ` · ${T_('gun.slotLocked', { n: w.unlockAt })}`;
            return `<div class="key${on ? '' : ' off'}"><b>${w.slot}</b> ${LD.I18N.isLatin() ? w.nameEn : w.name}${cur}</div>`;
          }).join('');
        }).join('');
        if (cap >= LD.Guns.TOTAL_GUN_LEVELS) {
          ar.innerHTML += `<div class="key"><b>✓</b> ${T_('gun.unlockOk')}</div>`;
        }
      }
      // 键位说明
      const k = $('gun-keys');
      if (k) {
        const L = (a) => LD.Settings.label(a) || '—';
        const ex = LD.Settings.gunKeyUnion();
        const R = (a) => LD.Settings.labelExcept(a, ex);
        k.innerHTML =
          `<div class="key"><b>${R('left')} / ${R('right')} / ${R('jump')}</b> ${T_('gun.k.move')} · ${T_('gun.k.jump')}</div>` +
          `<div class="key"><b>${R('fire')}</b> ${T_('gun.k.fire')}</div>` +
          `<div class="key"><b>${R('usepick')}</b> ${T_('gun.k.pick')}</div>`;
      }
    }

    buildGunSelect() {
      const grid = $('gun-grid');
      if (!grid) return;
      const g = this.save.gun;
      const cap = this.gunCap();
      if (!(this.gunStage >= 1 && this.gunStage <= cap)) this.gunStage = cap;
      grid.innerHTML = '';
      for (let i = 1; i <= LD.Guns.TOTAL_GUN_LEVELS; i++) {
        const b = document.createElement('div');
        const unlocked = i <= cap;
        const cleared = !!g.cleared[i];
        b.className = 'lv' + (cleared ? ' done' : '') + (unlocked ? '' : ' lock') + (i === this.gunStage ? ' cur' : '');
        b.textContent = i;
        if (unlocked) b.onclick = () => { this.gunStage = i; this.buildGunSelect(); this.refreshGun(); LD.Sfx.ui(); };
        grid.appendChild(b);
      }
      const ub = $('btn-gun-unlock-all');
      if (ub) ub.style.display = cap >= LD.Guns.TOTAL_GUN_LEVELS ? 'none' : '';
    }

    /* ---------- 世界构建（枪战） ---------- */
    _buildGunWorld() {
      const lv = this.level;
      this.world = new LD.World(lv);
      this.world.setCheat(this.cheat);
      this.world.soft = [];
      LD.FX.clear();

      const sp = this.world.spawn;
      this.pR = new LD.Player(this.world, 'red', sp);
      this.pB = null;
      this.players = [this.pR];
      this.player = this.pR;
      this.pR.hp = LD.Guns.MAX_HP;
      this.pR.maxHp = LD.Guns.MAX_HP;
      this.pR.gun = new LD.Guns.GunState(this.pR);
      this.pR.gun.weaponId = this._startingWeapon();
      this.pR.gun.refill();
      this.pR.__world = this.world;

      // 人机
      this.bots = [];
      const plan = lv.botPlan || [];
      plan.forEach((p, i) => {
        const b = new LD.GunAI.Bot(p, this.world, i);
        b.__world = this.world;
        this.bots.push(b);
      });
      // 对枪：蓝方是第二个「玩家」（由玩家 2 控制）
      if (this.gunMode === 'duel') {
        const s2 = this.world.spawn2 || this.world.spawn;
        this.pB = new LD.Player(this.world, 'blue', s2);
        this.pB.hp = LD.Guns.MAX_HP;
        this.pB.maxHp = LD.Guns.MAX_HP;
        this.pB.gun = new LD.Guns.GunState(this.pB);
        this.pB.gun.weaponId = this.settings.gun.p2 || 'pistol';
        this.pB.gun.refill();
        this.pB.__world = this.world;
        this.bots = [];                       // 对枪没有 AI
        this.players = [this.pR, this.pB];
        this.pR.gun.weaponId = this.settings.gun.p1 || 'pistol';
        this.pR.gun.refill();
      }
      this.world.soft = this.players;

      for (const p of this.players) {
        p.invincible = this.cheat;
        p.fly = this.cheat;
        p.__player = true;
        p.heldPickup = null;              // 技能槽（顶栏）：吸进去的木箱补给
      }
      this.bullets = [];
      this.drops = [];                    // 木箱爆出的技能补给（悬浮在箱子原位）
      this.blasts = [];
      this.drones = [];
      this.droneView = null;              // 重开一局：镜头先交还小人
      this.blastOwner = null;
      this._gunRespawnT = 0;
      this.gunKills = 0;
      this.levelDeaths = 0;
      this.levelTime = 0;
      this.deathFlash = 0; this.deathT = 0; this.winT = 0;
      this.camX = 0;
      this.updateHUD(true);
    }

    /* 开局用哪把枪：优先用「已解锁里最强的一把」，让关卡进度直接体现在手感上 */
    _startingWeapon() {
      const avail = this.gunAvailable();
      const order = ['quad', 'rpg', 'sniper', 'smg', 'pistol'];
      for (const id of order) if (avail.indexOf(id) >= 0) return id;
      return 'pistol';
    }

    /* ---------- 进入三种玩法 ---------- */
    loadGunLevel(stage, silent) {
      this.mode = 'gun';
      this.gunMode = 'level';
      this.gunStage = LD.clamp(Math.floor(stage) || 1, 1, this.gunCap());
      this.level = LD.genGunLevel(this.gunStage);
      this._buildGunWorld();
      if (!silent) this.showHint();
    }

    startGunLevel(stage) {
      this.loadGunLevel(stage == null ? this.gunStage : stage, false);
      this.state = 'playing';
      this.closeAll();
      this.last = performance.now();
      LD.Music.sync(this.settings);
      const nw = LD.Guns.newlyUnlocked(this.gunStage);
      this.flash(nw.length
        ? T_('gun.newWeapon', { w: nw.map((w) => w.slot + ' ' + (LD.I18N.isLatin() ? w.nameEn : w.name)).join('、') })
        : T_('gun.stage', { n: this.gunStage }), 2600);
    }

    loadGunEndless(showHint) {
      this.mode = 'gun';
      this.gunMode = 'endless';
      this.gunChunk = 1;
      this.gunDist = 0;
      this.gunScore = 0;
      this.level = LD.genGunEndlessChunk(0);
      this._buildGunWorld();
      const FLOOR = LD.ROWS - 2, p = this.player;
      this.world.spawn = { x: 2 * T + (T - p.w) / 2, y: FLOOR * T - p.h, footY: FLOOR * T };
      p.reset(this.world);
      this.camX = 0;
      this.gunDist = Math.floor((p.x + p.w / 2) / T);
      if (showHint) this.showHint();
    }

    startGunEndless() {
      this.loadGunEndless(true);
      this.state = 'playing';
      this.closeAll();
      this.last = performance.now();
      LD.Music.sync(this.settings);
      this.flash(T_('gun.endlessTitle'));
    }

    /* 载入对枪竞技场。keepScore=true 表示「同一场对枪的下一回合」：
       场地重建，但比分和回合号必须留着 —— 之前每次换回合都清分，
       结果 10 回合打下来比分永远停在 0-0、也永远打不到 majority。 */
    loadGunDuel(keepScore) {
      this.mode = 'gun';
      this.gunMode = 'duel';
      this.level = LD.genGunDuel();
      this.duelRounds = LD.clamp(Math.round(this.settings.gun.rounds) || 10, 1, 30);
      if (!keepScore) {
        this.duelP1 = 0; this.duelP2 = 0;
        this.duelRound = 1;
      }
      this.duelState = 'fight';
      this.duelSettleT = 0;
      this._buildGunWorld();
    }

    startGunDuel() {
      this.loadGunDuel();
      this.state = 'playing';
      this.closeAll();
      this.last = performance.now();
      LD.Music.sync(this.settings);
      this.flash(T_('gun.roundStart', { n: this.duelRound }), 1800);
    }

    /* ---------- 枪战训练场 ----------
       需求：数字键 0~9 手动控制沙盒
         0 加一个敌人 · 1 减一个敌人 · 2 清空敌人 · 3 玩家回满血 · 4 敌人回满血
         5 玩家血量翻倍 · 6 敌人血量翻倍 · 7 敌人静止 · 8 敌人恢复移动 · 9 敌人攻击（开/关）

       两个刻意的设计决定：
       ① 训练场里**没有死亡惩罚**：血量归零就地复活（见 _gunDown）——
          否则练到一半被一群人群殴致死、还要重进一次，那不叫训练场。
       ② 训练场里**暂停作弊连击**（见 _stepGun 里给 Input.cheatSuspended 赋值）——
          作弊键默认就是数字 5，不暂停的话按一下「血量翻倍」会同时计入作弊连击，
          第 5 次直接弹出一个无敌模式，完全没法当沙盒用。 */
    loadGunTraining() {
      this.mode = 'gun';
      this.gunMode = 'training';
      this.level = LD.genGunTraining();
      this.trainFreeze = false;
      this.trainAttack = true;
      this.trainStage = 0;                       // 手动加敌人的次数，用来给强度分档
      this._buildGunWorld();
    }

    startGunTraining() {
      this.loadGunTraining();
      this.trainSpawn(3);                        // 一进去就有 3 个，不至于对着空气练
      this.state = 'playing';
      this.closeAll();
      this.last = performance.now();
      LD.Music.sync(this.settings);
      this.flash(T_('gun.trainingTitle'), 2200);
    }

    /* 加敌人：落点要求「离玩家 ≥160px」+「这一列有可站立的地面」，
       和 _spawnWave 同一套判定。新刷出来的人机立刻继承当前的冻结 / 停火开关 ——
       「按 7 全都别动」之后按 0 加人，新来的也应该站着不动，否则开关就形同虚设。 */
    trainSpawn(n) {
      const w = this.world;
      const FLOOR = LD.ROWS - 2;
      const alive = () => this.bots.filter((b) => !b.dead).length;
      let added = 0;
      for (let i = 0; i < 400 && added < n; i++) {
        if (alive() >= 24) break;                 // 上限：再多就不是训练，是幻灯片
        const c = 2 + Math.floor(Math.random() * (w.cols - 4));
        if (Math.abs(c * T - this.pR.cx) < 160) continue;
        let r = -1;
        for (let rr = 1; rr < FLOOR; rr++) {
          if (w.isSolid(c, rr + 1) && !w.isSolid(c, rr)) { r = rr + 1; break; }
        }
        if (r < 0) continue;
        const avail = this.gunAvailable().filter((id) => LD.Guns.byId[id] && LD.Guns.byId[id].kind === 'gun');
        const b = new LD.GunAI.Bot({
          c, r,
          level: LD.clamp((this.gunStage - 1) / (LD.Guns.TOTAL_GUN_LEVELS - 1), 0, 1) * 100,
          elite: this.trainStage > 6,
          weapon: avail[Math.floor(Math.random() * avail.length)] || 'pistol',
        }, w, this.bots.length);
        b.x = c * T + (T - b.w) / 2;
        b.y = r * T - b.h;
        b.__world = w;
        b.frozen = this.trainFreeze;
        b.noAttack = !this.trainAttack;
        this.bots.push(b);
        added++;
      }
      this.trainStage += added;
      return added;
    }

    /* 训练场热键。返回是否吃掉了按键（吃掉就不再走别处）。 */
    _trainingKey(n) {
      const S = (typeof LD !== 'undefined') && LD.Sfx;
      const p = this.pR;
      const alive = () => this.bots.filter((b) => !b.dead).length;
      switch (n) {
        case 0: {
          const got = this.trainSpawn(1);
          if (!got) { this.flash(T_('gun.trainFull'), 1200); return; }
          if (S && S.pickup) S.pickup();
          this.flash(T_('gun.trainAdd', { n: alive() }), 900);
          return;
        }
        case 1: {
          /* 减敌人：优先砍掉**还活着**的最后一个；没有活的就清掉尸体，
             否则「按 1 没反应」会被当成按键坏了。 */
          const list = this.bots;
          let done = false;
          for (let i = list.length - 1; i >= 0; i--) {
            if (!list[i].dead) { list.splice(i, 1); done = true; break; }
          }
          if (!done && list.length) { list.pop(); done = true; }
          if (S && S.ui) S.ui();
          this.flash(done ? T_('gun.trainDel', { n: alive() }) : T_('gun.trainNone'), 900);
          return;
        }
        case 2: {
          const had = alive();
          this.bots.length = 0;
          if (S && S.ui) S.ui();
          this.flash(T_('gun.trainClear', { n: had }), 1200);
          return;
        }
        case 3:
          p.hp = p.maxHp || LD.Guns.MAX_HP;
          p.healFx = 1;
          if (S && S.heal) S.heal();
          this.flash(T_('gun.trainHealP'), 1000);
          return;
        case 4: {
          let k = 0;
          for (const b of this.bots) { if (b.dead) continue; b.hp = b.maxHp; b.hurtFx = 1; k++; }
          if (S && S.heal) S.heal();
          this.flash(T_('gun.trainHealE', { n: k }), 1000);
          return;
        }
        case 5: {
          /* 上限 10 倍。没有上限的话连按十几次就是 100→102400，
             血条会被压成一条看不见的细线，手感也没法看了。 */
          const capP = LD.Guns.MAX_HP * 10;
          const cur = p.maxHp || LD.Guns.MAX_HP;
          if (cur >= capP) { this.flash(T_('gun.trainHpMax'), 1100); return; }
          p.maxHp = Math.min(capP, Math.round(cur * 2));
          p.hp = p.maxHp;
          if (S && S.pickup) S.pickup();
          this.flash(T_('gun.trainHpP', { n: p.maxHp }), 1300);
          return;
        }
        case 6: {
          const capE = LD.Guns.MAX_HP * 20;
          let k = 0;
          for (const b of this.bots) {
            if (b.dead) continue;
            b.maxHp = Math.min(capE, Math.max(1, Math.round(b.maxHp * 2)));
            b.hp = b.maxHp;
            k++;
          }
          if (S && S.pickup) S.pickup();
          this.flash(T_('gun.trainHpE', { n: k }), 1300);
          return;
        }
        case 7:
          this.trainFreeze = true;
          for (const b of this.bots) b.frozen = true;
          if (S && S.ui) S.ui();
          this.flash(T_('gun.trainFreezeOn'), 1100);
          return;
        case 8:
          this.trainFreeze = false;
          for (const b of this.bots) b.frozen = false;
          if (S && S.ui) S.ui();
          this.flash(T_('gun.trainFreezeOff'), 1100);
          return;
        case 9:
          this.trainAttack = !this.trainAttack;
          for (const b of this.bots) b.noAttack = !this.trainAttack;
          if (S && S.ui) S.ui();
          this.flash(this.trainAttack ? T_('gun.trainFireOn') : T_('gun.trainFireOff'), 1100);
          return;
        default: return;
      }
    }

    _stepTraining(dt) {
      const I = LD.Input;
      for (let n = 0; n <= 9; n++) {
        if (I.pressed('Digit' + n) || I.pressed('Numpad' + n)) this._trainingKey(n);
      }
    }

    /* ---------- 子弹 / 爆炸 ---------- */
    spawnBullet(o) {
      this.bullets.push(new LD.Guns.Bullet(o));
    }

    _gunBlast(x, y, r0, dmg, team) {
      this.blasts.push({ x, y, r: r0, t: 0.32 });
      LD.FX.burst(x, y, 18, '#ffb347', 5);
      /* 爆炸音按威力缩放：手雷 / 火箭筒（splash 34~40）和自爆无人机（52）不一样大，
         听感上要能分出「擦破皮」还是「整个人被掀飞」。 */
      if (LD.Sfx && LD.Sfx.boom) LD.Sfx.boom(LD.clamp((r0 || 40) / 44, 0.7, 1.35));
      /* 爆炸范围内的所有单位都吃伤害 —— 包括自己（火箭筒贴脸打是会自伤的）。
         旧实现在这里也有「同一个单位被算两次」的毛病：
         红方开火时先 `team !== 'red'` 跳过，接着又单独 hitAny(pR) 自伤；
         而蓝方的两个分支都会命中 pB，一炮打两遍伤害。现在统一按阵营过一次。 */
      const hitAny = (ent) => {
        if (!ent || ent.dead) return;
        const d2 = Math.hypot(ent.cx - x, ent.cy - y);
        if (d2 > r0) return;
        /* 爆炸衰减的下限（原来 0.35）。
           0.35 太低：手雷 50 伤害时，站在爆心旁边一点点的人只吃 17 点，
           观感上就是「手雷扔脸上了却没打死人，伤害太低」。
           现在改成「擦到边也有半伤」，范围武器才有范围武器的样子。 */
        const fall = LD.clamp(1 - d2 / r0, 0.5, 1);
        this._damage(ent, Math.round(dmg * fall), team);
      };
      /* 敌方（不同阵营）吃衰减伤害；同阵营里只有「开火者自己」吃自伤惩罚。 */
      const list = [];
      if (this.pR) list.push({ ent: this.pR, fac: 'red' });
      if (this.pB) list.push({ ent: this.pB, fac: 'blue' });
      for (const b of this.bots) list.push({ ent: b, fac: b.team || 'ai' });
      const seen = new Set();
      for (const it of list) {
        if (seen.has(it.ent)) continue;                 // 同一个单位只结算一次
        seen.add(it.ent);
        const self = it.ent === this.blastOwner;        // 只有开火者本人吃自伤
        if (it.fac === team && !self) continue;         // 队友不吃自己的爆炸
        hitAny(it.ent);
      }
      this.blastOwner = null;
    }

    /* 玩家此刻是不是「有无人机在自己这边」。
       用户要求：「使用无人机时小人无敌」—— 放飞侦查机 / 遥控自爆机的那段时间里，
       小人是打不到的，这样才敢把注意力放在无人机上。
       判定口径：场上存在任一架「属于玩家的」存活无人机（自己放的、阵营是玩家方），
       而不是只看 droneView —— 因为玩家可能先放飞侦查机、又放自爆机，
       只要还有一架在天上就继续保持无敌；两架都收回了才恢复。 */
    _playerHasDrone(p) {
      if (!p) return false;
      const fac = p === this.pB || p.kind === 'blue' ? 'blue' : 'red';
      for (const d of this.drones) {
        if (d.dead) continue;
        if (d.owner === p) return true;                  // 自己放的
        if (d.team === fac && d.owner && d.owner.__player) return true;
      }
      return false;
    }

    /* 统一的伤害入口：玩家 / 蓝方 / 人机都走这里 */
    _damage(ent, dmg, team) {
      if (!ent || ent.dead) return;
      if (ent.__player && this.cheat) return;                    // 作弊 = 无敌
      /* 使用无人机期间玩家无敌（用户要求）。放在扣血之前 return，
         连受击特效 / 死亡判定都不进，免得「砍到无敌的人还冒血花」。 */
      if (ent.__player && this.mode === 'gun' && this._playerHasDrone(ent)) return;
      if (ent.kind === 'ai') {
        if (ent.hurt(dmg)) {
          /* 训练场里打死人不计分、不累加击杀 —— 沙盒刷出来的敌人是无限量的，
             计进去会让「击杀数」这个存档统计失去意义。 */
          if (this.gunMode !== 'training') {
            this.gunKills++;
            this.save.gun.kills = (this.save.gun.kills || 0) + 1;
            LD.Save.flush();
            /* 击杀奖励：打败一名敌人，血量上限 +20、同时回 20，封顶 500。 */
            this._killReward(team);
          }
          LD.FX.burst(ent.cx, ent.cy, 14, '#ff5d7a', 4);
        } else {
          LD.FX.burst(ent.cx, ent.cy, 5, '#ffd23f', 2.2);
        }
        if (LD.Sfx && LD.Sfx.land) LD.Sfx.land();
        return;
      }
      // 玩家单位
      ent.hp -= dmg;
      ent.hurtFx = 1;
      this.deathFlash = Math.max(this.deathFlash, 0.35);
      LD.FX.burst(ent.cx, ent.cy, 6, '#ff4d6d', 2.6);
      if (ent.hp <= 0) {
        ent.hp = 0;
        this._gunDown(ent);
      }
    }

    /* 击杀奖励：谁开的枪就长谁的血量上限（红方 / 蓝方各自独立）。
       上限 +20、当前血也回 20；到 500 之后不再涨也不回 ——
       「打败一名敌人增加20」的成长到此为止，再往上就是无底洞了。 */
    _killReward(team) {
      const p = team === 'blue' ? this.pB : this.pR;
      if (!p || p.dead) return;
      const before = p.maxHp || LD.Guns.MAX_HP;
      if (before >= LD.Guns.HP_CAP) return;
      p.maxHp = Math.min(LD.Guns.HP_CAP, before + LD.Guns.HP_PER_KILL);
      p.hp = Math.min(p.maxHp, (p.hp || 0) + LD.Guns.HP_PER_KILL);
      p.healFx = 1;
    }

    _gunDown(ent) {
      if (this.gunMode === 'duel') {
        if (this.duelState !== 'fight') return;
        ent.dead = true; ent.deathT = 0.6;
        const winner = ent.kind === 'blue' ? 'p1' : 'p2';
        this._duelSettle(winner);
        return;
      }
      // 关卡 / 无尽：玩家被打倒
      if (ent !== this.pR) return;
      if (this.state !== 'playing') return;
      /* 训练场：没有死亡惩罚、也不计死亡数。血空了就地满血复位 ——
         否则「叫一群敌人围着练」这件事根本做不到：练到一半被打死还要重进一次。
         注意这段必须在 levelDeaths++ / Sfx.die() **之前**返回，
         不然训练场里死一次就会被记进「总死亡」并响一次死亡音效。 */
      if (this.gunMode === 'training') {
        ent.hp = ent.maxHp || LD.Guns.MAX_HP;
        ent.dead = false;
        ent.invulnT = 1.2;
        if (this.world.spawn) {
          ent.x = this.world.spawn.x;
          ent.y = this.world.spawn.y;
          ent.vx = 0; ent.vy = 0;
        }
        this.deathFlash = 0.5;
        this.world.shake = 0.5;
        LD.FX.burst(ent.cx, ent.cy, 16, '#7ad4ff', 3.6);
        this.flash(T_('gun.trainRevive'), 1200);
        return;
      }
      this.levelDeaths++;
      this.save.totalDeaths++;
      LD.Save.flush();
      this.deathFlash = 1;
      this.world.shake = 1;
      LD.Sfx.die();
      LD.FX.burst(ent.cx, ent.cy, 20, '#ff4d6d', 4.6);
      /* 枪战无尽是「死一次就结算」，不留给玩家重开这一关的机会 ——
         它压根没有「这一关」；直接进结算面板。 */
      if (this.gunMode === 'endless') { this.gunEndlessOver(); return; }
      this.state = 'dying';
      this.deathT = 0.9;
      this.updateHUD(true);
    }

    /* ---------- 一帧（枪战） ---------- */
    _stepGun(dt) {
      const w = this.world;
      this.levelTime += dt;

      /* 训练场里数字键 0~9 归训练热键，所以**暂停作弊连击**：
         作弊键默认就是数字 5，不暂停的话按一下「玩家血量翻倍」会同时计入连击，
         第 5 次直接弹出无敌模式 —— 那就没法当沙盒用了。
         这里每帧按当前模式重算，不做「进/出场时设一次」的状态残留。 */
      LD.Input.cheatSuspended = (this.gunMode === 'training');
      if (this.gunMode === 'training') this._stepTraining(dt);

      // 1) 输入 → 玩家
      const ci = this._gunInput();
      if (!this.pR.dead) this._updateGunner(this.pR, dt, ci.p1);
      if (this.pB && !this.pB.dead) this._updateGunner(this.pB, dt, ci.p2);
      // 作弊/无敌：射速飞快 + 无需换弹
      for (const p of this.players) {
        if (p.gun) { p.gun.noAmmo = this.cheat; p.gun.update(dt); }
      }
      /* 无敌模式下每帧把弹匣顶满。先把增益清掉再 refill ——
         否则增益的「双倍 / 三倍弹药」会让 refill 顶到 7×3=21，
         HUD 上就会显示 21/7 这种自相矛盾的数字。 */
      if (this.cheat) {
        for (const p of this.players) {
          if (!p.gun) continue;
          p.gun.boostT = 0; p.gun.boostRate = 1; p.gun.boostAmmo = 1; p.gun.boostKind = null;
          p.gun.refill();
          p.gun.fireT = 0;
          p.gun.reloadT = 0;
        }
      }

      // 2) 人机
      const foes = this._gunFoes();
      const aiCtx = {
        foes,
        bullets: this.bullets,
        spawnBullet: (o) => this.spawnBullet(o),
        botUseItem: this.settings.gun.botItems ? (b, s, d) => this._botUseItem(b, s, d) : null,
      };
      for (const b of this.bots) b.update(dt, w, aiCtx);

      // 3) 无人机的行为（传入玩家输入：遥控机要用方向键飞、开火键引爆）
      this._stepDrones(dt, ci.p1);

      // 4) 子弹
      this._stepBullets(dt);

      // 5) 爆炸计时
      for (let i = this.blasts.length - 1; i >= 0; i--) {
        this.blasts[i].t -= dt;
        if (this.blasts[i].t <= 0) this.blasts.splice(i, 1);
      }

      // 6) 回血装置 / 医药包回血 / 木箱补给掉落
      this._stepHeal(dt);
      this._stepDrops(dt);

      // 7) 人机增援（无尽 + 部分关卡）
      this._stepRespawn(dt);

      this.camX = LD.lerp(this.camX, this._camTarget(), 0.16);

      // 8) 胜负判定
      if (this.gunMode === 'duel') this._stepDuel(dt);
      else this._stepGunObjective();
    }

    /* 玩家（含蓝方）一帧：移动 + 开火 + 切枪 + 道具 */
    _updateGunner(p, dt, inp) {
      /* 遥控无人机（侦查机 / 自爆机）期间，方向键 / 开火键都归无人机用：
         小人在原地待机（给一个「空输入」），否则同一套方向键会同时
         让小人跑动 + 无人机飞，两边都控制不好。
         这里造一个全 false 的输入壳，物理照样跑（重力 / 落地都在），
         只是不接受玩家这一帧的方向与开火。 */
      if (this.droneView && !this.droneView.dead && p === this.pR) {
        const idle = {
          left: () => false, right: () => false,
          up: () => false, downKey: () => false,
          jumpPressed: () => false, jumpHeld: () => false,
        };
        p.update(dt, this.world, idle);
        return;                       // 遥控期间不能同时开自己的枪 / 用道具
      }
      // 用玩家物理（含跳跃手感），输入是包装过的
      p.update(dt, this.world, inp);
      const g = p.gun;
      if (!g) return;
      g.noAmmo = this.cheat;
      // 切枪：先是「直接点到某个槽」（F1~F8），再是顺次切
      const sh = inp.slotKey ? inp.slotKey() : null;
      if (sh) this._selectSlot(p, sh.idx, sh.code);
      else {
        if (inp.nextGun && inp.nextGun()) this._cycleGun(p, 1);
        if (inp.prevGun && inp.prevGun()) this._cycleGun(p, -1);
      }
      // 开火（按住即连发；单发枪由 fireDelay 控制节奏）
      if (inp.fire && inp.fire() && g.weapon().kind === 'gun') {
        const shot = g.tryFire(g.noAmmo);
        if (shot) this._playerShot(p, shot);
      } else if (g.weapon().kind === 'gun' && g.ammo() <= 0 && !g.isReloading() && !g.noAmmo) {
        g.startReload(false);
      }
      // 道具
      if (inp.item && inp.item()) this._useItem(p);
      // 技能槽：按 E 用掉吸进顶栏的木箱补给
      if (inp.usePick && inp.usePick()) this._useHeldPickup(p);
    }

    _playerShot(p, shot) {
      const dir = p.face || 1;
      this.spawnBullet({
        x: p.cx + dir * 15,
        y: p.y + p.h * 0.42,
        vx: dir * shot.speed,
        vy: 0,
        dmg: shot.dmg,
        r: shot.size,
        color: shot.color,
        team: p.kind === 'blue' ? 'blue' : 'red',
        owner: p,
        explode: shot.explode,
        splash: shot.splash,
      });
      // 按「打出来的是哪把枪」取音色：手枪脆、狙击沉、火箭筒先嘶后炸
      if (LD.Sfx && LD.Sfx.shot) LD.Sfx.shot(shot.id);
    }

    _cycleGun(p, d) {
      const avail = this.gunMode === 'duel' ? LD.Guns.WEAPONS.filter((w) => w.kind === 'gun').map((w) => w.id) : this.gunAvailable();
      const guns = avail.filter((id) => LD.Guns.byId[id] && LD.Guns.byId[id].kind === 'gun');
      if (guns.length < 2) return;
      let i = guns.indexOf(p.gun.weaponId);
      if (i < 0) i = 0;
      const next = guns[(i + d + guns.length) % guns.length];
      // 对枪里不允许临阵换到别人设定的枪 —— 双方枪械是设置里定好的
      if (this.gunMode === 'duel') return;
      /* 切枪**不补弹**。原来这里跟着一句 refill()，等于「按两下 E 就白嫖一个满弹匣」，
         需求里写死的换弹时间（手枪 3s / 冲锋枪 6s / 狙击枪 7s）全被绕过去了。
         弹量本来就按枪独立记在 magOf 里，切走再切回来不会丢，
         所以 refill 只该在「换弹完成」和「打碎木箱拿到补给」这两个正路上出现。 */
      p.gun.setWeapon(next);
      LD.Sfx.switchGun();
      this.flash(p.gun.weapon().slot + ' ' + (LD.I18N.isLatin() ? p.gun.weapon().nameEn : p.gun.weapon().name), 1200);
    }

    /* 使用道具。
       only 省略时＝按「手雷 → 医药包 → 侦查 → 自爆 → 追踪」依次找第一个冷却好的；
       传了 only（比如按 F8 / F9 / F10 选中的那个槽）就只在那几个里挑。
       这两个入口共用同一段逻辑，避免「按 F8 和按道具键效果不一样」。 */
    _useItem(p, only) {
      const g = p.gun;
      const order = only && only.length ? only : ['grenade', 'medkit', 'drone', 'bomb', 'tracker'];
      for (const id of order) {
        const wd = LD.Guns.byId[id];
        if (!wd) continue;
        if (p.__player && this.gunMode !== 'duel' && !LD.Guns.unlockedAt(id, this.gunUnlockStage())) continue;
        if (!g.itemReady(id)) continue;
        if (id === 'grenade') {
          g.useItem(id);
          const dir = p.face || 1;
          this.spawnBullet({
            x: p.cx + dir * 12, y: p.y + p.h * 0.3,
            vx: dir * 8.5, vy: -6.5, dmg: wd.dmg, r: 5,
            color: '#7dff9b', team: p.kind === 'blue' ? 'blue' : 'red',
            owner: p, gravity: 0.5, explode: true, splash: 62, life: 1.6, grenade: true,
          });
          if (LD.Sfx.thrown) LD.Sfx.thrown();
          this.flash(LD.Guns.byId.grenade.slot + ' ' + (LD.I18N.isLatin() ? 'Grenade' : '手雷'), 1000);
          return true;
        }
        if (id === 'medkit') {
          g.useItem(id);
          p.healT = wd.healTime;
          p.healDur = wd.healTime;
          p.healAmt = wd.heal;
          if (LD.Sfx.heal) LD.Sfx.heal();
          this.flash(T_('gun.healing'), 1400);
          return true;
        }
        if (id === 'drone') {
          g.useItem(id);
          this._spawnDrone(p, true, wd);
          return true;
        }
        if (id === 'bomb') {
          g.useItem(id);
          this._spawnDrone(p, false, wd);
          return true;
        }
        if (id === 'tracker') {
          g.useItem(id);
          this._spawnDrone(p, 'track', wd);
          return true;
        }
      }
      return false;
    }

    /* ---------- 直接选中某个枪械槽（F1~F10 / 玩家自定义键） ----------
       需求原文是「F1 手枪 / F2 冲锋枪 / …」——武器表既然按槽位命名，
       按键就该能**直接点到那个槽**，而不是只能按 E / [ 一路顺次切过去。

       槽里是「枪」→ 切过去（不补弹：切枪白送一个满弹匣的话，
       那 3 秒换弹时间就等于不存在，需求里写死的换弹值会被玩家绕过去）。
       槽里是「道具」→ 直接使用（F6 侦查 / F7 自爆 / F8 追踪 / F9 手雷 / F10 医药包）。
       没解锁 / 全在冷却 → 给一句提示，不静默吞按键（吞掉最容易被当成「按键坏了」）。 */
    _selectSlot(p, idx, code) {
      if (this.gunMode === 'duel') return false;      // 对枪双方枪械由设置决定，不允许临阵换
      const slot = LD.Guns.SLOTS[idx];
      if (!slot) return false;
      const list = LD.Guns.bySlot[slot] || [];
      const avail = list.filter((w) => LD.Guns.unlockedAt(w.id, this.gunUnlockStage()));
      if (!avail.length) {
        const need = list.length ? list[0].unlockAt : 0;
        this.flash(T_('gun.slotNeed', { n: need }), 1200);
        return false;
      }
      const nameOf = (w) => (LD.I18N.isLatin() ? w.nameEn : w.name);
      const gun = avail.filter((w) => w.kind === 'gun')[0];
      if (gun) {
        const changed = p.gun.setWeapon(gun.id);
        LD.Sfx.switchGun();
        this.flash(gun.slot + ' ' + nameOf(gun), changed ? 1200 : 700);
        return true;
      }
      // 道具槽：谁冷却好了就用谁（F9 手雷 / F10 医药包各自独立）
      if (this._useItem(p, avail.map((w) => w.id))) {
        const w = avail[0];
        this.flash(w.slot + ' ' + nameOf(w), 900);
        return true;
      }
      const cd = Math.ceil(Math.max.apply(null, avail.map((w) => p.gun.cooldownLeft(w.id))));
      this.flash(T_('gun.itemCd', { n: cd }), 900);
      return false;
    }

    _botUseItem(b, s, dt) {
      // 人机也会用手雷 / 无人机（强度越高越频繁）；仅在关卡/无尽里
      if (this.gunMode === 'duel') return;
      if (!s) return;
      /* 看不见目标就不丢道具（和开火一个原则：没看到敌人不能攻击） */
      if (!s.los) return;
      if (!b.gun.itemReady('grenade')) return;
      if (b.norm < 0.25) return;                  // 太弱的人机不会用道具
      if (Math.random() > b.norm * 0.012) return;
      b.gun.useItem('grenade');
      const dir = s.towards;
      this.spawnBullet({
        x: b.cx + dir * 12, y: b.y + b.h * 0.3,
        vx: dir * 8.5, vy: -6.5, dmg: LD.Guns.byId.grenade.dmg, r: 5,
        color: '#7dff9b', team: 'ai', owner: b,
        gravity: 0.5, explode: true, splash: 62, life: 1.6, grenade: true,
      });
    }

    /* 放飞一架无人机。
       ------------------------------------------------------------------
       recon = true   侦查无人机（F6）：升空后**镜头切到无人机视角**，
                      它自己在空中悬停 / 缓慢漂移并自动开火 ——
                      玩家看到的就是「无人机的眼睛」，这就是用户要的
                      「无人机模式是静如无人机视角」。
                      视角由 this.droneView 指向这架飞机，相机跟着它走；
                      持续时间到 / 被打爆就自动收回视角（见 _stepDrones）。
       recon = false  自爆无人机（F7）：放飞后**由玩家手动遥控**——
                      方向键控飞行、开火键引爆（用户要的「手动遥控引爆」）。
                      遥控期间镜头同样跟着它；引爆 / 时间到 / 撞墙即结束。
       recon = 'track' 追踪无人机（F8，用户需求）：放飞后**不用你开**，
                      自己锁定最近的敌人、一路追上去，贴上即引爆。
                      不接管视角（玩家还能跑），也不吃手动遥控那套。
       三种无人机都会写 d.controlled（渲染层据此画「正在被你开着」的光环）。 */
    _spawnDrone(owner, recon, wd) {
      const tracking = recon === 'track';
      const isRecon = recon === true;
      const d = {
        kind: 'drone',
        recon: isRecon,
        track: tracking,               // 追踪机标记（渲染 / 行为都按它分流）
        x: owner.cx, y: owner.y - 10,
        w: 18, h: 14,
        hp: wd.hp || 40,
        maxHp: wd.hp || 40,
        team: owner.kind === 'ai' ? 'ai' : (owner.kind === 'blue' ? 'blue' : 'red'),
        owner,
        t: wd.duration || 10,
        fireT: 0.6,
        vx: (owner.face || 1) * 3.2,
        vy: 0,
        spin: 0,                       // 螺旋桨 / 铆钉环的自转角
        armed: false,                  // 自爆机：引信已激活（待引爆时闪）
        controlled: false,             // 是否正被玩家遥控 / 提供视角
        locked: null,                  // 侦查机当前瞄准的目标（画锁定线用）
        dead: false,
      };
      /* 只有「玩家自己放的」才接管镜头与遥控 ——
         人机放的无人机照旧自动飞、自动炸，不去抢玩家的操作权。
         追踪机是「全自动」的，玩家放的那架也不接管镜头（见上面注释）。 */
      const mine = !!(owner && owner.__player);
      if (mine && !tracking) {
        d.controlled = true;
        if (!isRecon) d.armed = true;
        this.droneView = d;
      }
      this.drones.push(d);
      this.flash(
        isRecon ? T_('gun.droneUp')
          : (tracking ? T_('gun.droneTrackUp') : T_('gun.droneBombUp')),
        2200);
    }

    /* 自爆无人机的遥控飞行。
       玩家用方向键给「油门」，不是给速度 —— 松手就悬停（速度指数衰减），
       下蹲键下降、跳跃键上升。这样在窄巷里也好定位，不至于一按就飘过头。
       速度上限按「格」给，正好能在两格宽的口子里穿过去。 */
    _stepKamikaze(d, dt, inp) {
      const f = dt * 60;
      const SPD = 4.8;
      let dx = 0, dy = 0;
      if (inp) {
        if (inp.left()) dx -= 1;
        if (inp.right()) dx += 1;
        if (inp.up && inp.up()) dy -= 1;              // 跳跃键 = 上升
        if (inp.downKey && inp.downKey()) dy += 1;     // 下蹲键 = 下降
      }
      const len = Math.hypot(dx, dy) || 1;
      d.vx += (dx / len) * 0.9 * f;
      d.vy += (dy / len) * 0.9 * f;
      // 无输入时快速收敛到悬停（空中没有摩擦力，必须自己阻尼）
      if (!dx) d.vx *= Math.pow(0.82, f);
      if (!dy) d.vy *= Math.pow(0.82, f);
      d.vx = LD.clamp(d.vx, -SPD, SPD);
      d.vy = LD.clamp(d.vy, -SPD, SPD);
      d.x += d.vx * f;
      d.y += d.vy * f;
      /* 撞墙处理：自爆机直接引爆（撞不动地形，撞上去只会原地打转，
         不如直接炸开，把「撞墙」也变成一次有效输出）；
         侦查机没有炸药，撞墙就自己坠毁（只掉血/报废，不产生爆炸伤害）。 */
      if (d.__world && d.__world.tileSolidAt(d.x, d.y)) {
        if (d.recon) d.dead = true;
        else this._detonateDrone(d);
        return true;
      }
      return false;
    }

    /* 引爆炸药类无人机（自爆机 / 追踪机）。
       伤害与半径按「是哪一架」取：
         自爆机（F7）  120 伤害 / 半径 52
         追踪机（F8）  100 伤害 / 半径 46（用户需求的 100 点伤害）
       两者共用一个入口，省得「追踪机炸出来是自爆机的伤害」这种口径分叉。 */
    _detonateDrone(d) {
      if (!d || d.dead) return;
      d.dead = true;
      const isTrack = !!d.track;
      const wd = LD.Guns.byId[isTrack ? 'tracker' : 'bomb'];
      const dmg = (wd && wd.dmg) || (isTrack ? 100 : 120);
      const radius = isTrack ? 46 : 52;
      this.blastOwner = d.owner;         // 自伤算在自己头上（和手雷同一口径）
      this._gunBlast(d.x, d.y, radius, dmg, d.team);
      this.world.shake = Math.max(this.world.shake || 0, 0.5);
      // 爆炸音由 _gunBlast 统一播放（它按 splash 缩放音量），这里不再重复响一次
      if (d.controlled && d.owner && d.owner.__player) this.flash(T_('gun.droneBoom'), 1200);
      else if (isTrack && d.owner && d.owner.__player) this.flash(T_('gun.droneTrackBoom'), 1200);
    }

    _stepDrones(dt, input) {
      const w = this.world;
      // 让每架遥控机都能做地形碰撞（_stepKamikaze 里用）
      for (const d of this.drones) d.__world = w;
      for (let i = this.drones.length - 1; i >= 0; i--) {
        const d = this.drones[i];
        d.t -= dt;
        d.spin = (d.spin || 0) + dt * 14;
        if (d.dead || d.t <= 0) {
          /* 被玩家开着的这架没了 → 把镜头交还给小人。
             不还的话相机会永远停在无人机最后的位置，看起来就是「卡住了」。 */
          if (this.droneView === d) {
            this.droneView = null;
            if (d.owner && d.owner.__player) this.flash(T_('gun.droneEnd'), 1400);
          }
          this.drones.splice(i, 1);
          continue;
        }
        /* 找最近的敌对目标（侦查机的自动开火 + 人机放的自爆机都用它）
           人机阵营的敌人在「无人机视角」下也要能互相开火，所以口径和子弹一致。 */
        const foes = [];
        if (d.team !== 'red' && this.pR && !this.pR.dead) foes.push(this.pR);
        if (d.team !== 'blue' && this.pB && !this.pB.dead) foes.push(this.pB);
        if (d.team !== 'ai') for (const b of this.bots) if (!b.dead) foes.push(b);
        let best = null, bd = 1e9;
        for (const f of foes) {
          const dist = Math.abs(f.cx - d.x) + Math.abs(f.cy - d.y) * 1.6;
          if (dist < bd) { bd = dist; best = f; }
        }
        d.locked = best;

        /* ---------- 玩家遥控的无人机（侦查机 + 自爆机）：手动飞 ----------
           侦查机：开火键 = 点射（玩家手动开火，原来它自己悬停自动扫射）；
           自爆机：开火键 = 引爆。两者都由方向键 / 跳跃 / 下蹲键控飞行。 */
        if (d.controlled) {
          const boom = this._stepKamikaze(d, dt, input);
          if (!boom && input && input.fire && input.fire()) {
            if (d.recon) {
              /* 侦查机：玩家按开火键才射击，朝最近的敌人（没有敌人就朝飞行方向）点射 */
              d.fireT -= dt;
              if (d.fireT <= 0) {
                d.fireT = 0.22;
                const dir = best ? (best.cx >= d.x ? 1 : -1) : (d.vx >= 0 ? 1 : -1);
                this.spawnBullet({
                  x: d.x, y: d.y, vx: dir * 13, vy: 0, dmg: 3, r: 3,
                  color: '#7ad4ff', team: d.team, owner: d.owner,
                });
                if (LD.Sfx && LD.Sfx.shot) LD.Sfx.shot('smg');
              }
            } else {
              this._detonateDrone(d);
            }
          }
          if (d.dead) {
            if (this.droneView === d) this.droneView = null;
            this.drones.splice(i, 1);
            continue;
          }
          continue;                        // 遥控机不吃「自动追踪 / 自动自爆」那套
        }

        /* ---------- 追踪无人机（F8）：全自动追踪并引爆 ----------
           用户需求「F8改为追踪无人机，追踪敌人并引爆」。
           行为：锁定最近的敌人 → 全速追过去 → 贴到 20px 内就炸。
           和侦查机（悬停扫射）的区别是它是**一次性冲撞**的；
           和 F7 的区别是它不用玩家控（玩家还能自由跑动）。
           追不到（场上没人 / 被墙挡住）就白飞到时间到。 */
        if (d.track) {
          if (best) {
            const dx = best.cx - d.x, dy = best.cy - d.y;
            const len = Math.hypot(dx, dy) || 1;
            const spd = 5.2;
            /* 撞墙验证：追踪机会拐弯但不会穿墙。先算目标格，
               若前方是实心就只保留不撞墙的那一轴（贴墙滑行），
               免得「隔着一堵墙原地抖」。 */
            const nx = d.x + (dx / len) * spd * dt * 60;
            const ny = d.y + (dy / len) * spd * dt * 60;
            const blockedX = w.tileSolidAt(nx, d.y);
            const blockedY = w.tileSolidAt(d.x, ny);
            if (!blockedX) d.x = nx;
            if (!blockedY) d.y = ny;
            /* 贴身引爆：20px 已经基本压在目标身上了，
               再近就会「穿过去」，所以到这个距离就直接炸。 */
            if (len < 20) this._detonateDrone(d);
          } else {
            d.x += d.vx * dt * 60;                  // 没人可追：按最初那点惯性飘
          }
          if (d.dead) {
            if (this.droneView === d) this.droneView = null;
            this.drones.splice(i, 1);
            continue;
          }
          d.x = LD.clamp(d.x, 0, w.pxW);
          d.y = LD.clamp(d.y, 0, w.pxH);
          continue;                                 // 追踪机不吃下面「侦查 / 人机自爆」那套
        }

        /* ---------- 侦查机 + 人机的自爆机：自动行为 ---------- */
        if (best) {
          const dx = best.cx - d.x, dy = best.cy - d.y;
          const len = Math.hypot(dx, dy) || 1;
          const spd = d.recon ? 2.4 : 4.6;
          /* 侦查机「静如」悬停：自动位置只做很小的修正 ——
             它主要是「镜头」，飞得太快会让玩家晕，也对不准敌人。
             自爆机（人机放的）照旧全速追。 */
          const track = d.recon ? 0.22 : 1;
          d.x += (dx / len) * spd * track * dt * 60;
          d.y += (dy / len) * spd * track * dt * 60;
          if (d.recon) {
            d.fireT -= dt;
            /* 开火条件放宽一点（原来要求 |dy|<26，敌人稍微站高一点就不打了）：
               只要有视线、且横向在射程内就点射。 */
            if (d.fireT <= 0 && Math.abs(dy) < 40) {
              d.fireT = 0.42;
              const dir = dx >= 0 ? 1 : -1;
              this.spawnBullet({
                x: d.x, y: d.y, vx: dir * 13, vy: 0, dmg: 3, r: 3,
                color: '#7ad4ff', team: d.team, owner: d.owner,
              });
              if (LD.Sfx && LD.Sfx.shot) LD.Sfx.shot('smg');
            }
          } else if (bd < 22) {
            // 人机放的自爆机：自动撞上去
            d.dead = true;
            this._gunBlast(d.x, d.y, 52, LD.Guns.byId.bomb.dmg, d.team);
          }
        } else {
          d.x += d.vx * dt * 60;
        }
        d.x = LD.clamp(d.x, 0, w.pxW);
        d.y = LD.clamp(d.y, 0, w.pxH);
        if (w.tileSolidAt(d.x, d.y)) {
          if (d.recon) { d.dead = true; }        // 侦查机撞墙自毁
          else this._detonateDrone(d);           // 自爆机撞墙直接炸
          if (this.droneView === d) this.droneView = null;
        }
      }
    }

    _stepBullets(dt) {
      const w = this.world;
      for (let i = this.bullets.length - 1; i >= 0; i--) {
        const b = this.bullets[i];
        const res = LD.Guns.stepBullet(w, b, dt);
        if (res && res.hitBox) {
          // 打中木箱 → 碎箱 + 掉落增益
          const box = w.breakBox(res.x, res.y);
          if (box) {
            if (LD.Sfx && LD.Sfx.hit) LD.Sfx.hit();     // 木箱碎裂：一记闷响
            this._crateDrop(box.x + T / 2, box.y + T / 2, b.owner, b.team);
          }
        } else if (res && res.hitWall) {
          if (b.explode) { this.blastOwner = b.owner; this._gunBlast(res.x, res.y, b.splash || 40, b.dmg, b.team); }
          else LD.FX.burst(res.x, res.y, 4, b.color, 2);
        }
        if (b.dead) {
          // 命中判定：对「非本队」的单位做点-盒判定
          if (b.explode) { this.blastOwner = b.owner; this._gunBlast(b.x, b.y, b.splash || 40, b.dmg, b.team); }
          else this._hitCheck(b);
          this.bullets.splice(i, 1);
          continue;
        }
        // 飞到一半也可能直接撞上人（子弹速度慢的枪尤其要逐帧判定）
        if (this._hitCheck(b)) {
          if (b.explode) { this.blastOwner = b.owner; this._gunBlast(b.x, b.y, b.splash || 40, b.dmg, b.team); }
          this.bullets.splice(i, 1);
        }
      }
      if (this.bullets.length > 400) this.bullets.splice(0, this.bullets.length - 400);
    }

    /* 子弹命中判定：返回是否命中（命中即扣血）
       ---------------------------------------------------------------
       队别只有三个阵营：'red'（红方玩家）/ 'blue'（蓝方玩家）/ 'ai'（人机）。
       【教训】旧实现是 tryHit(ent, team)，第二个参数传的是「被击者自己的标识」，
       于是里面的同队判断 `ent.team === team || ent.kind === team` 永远成立 ——
       玩家打人机时 ent.team='ai' 正好等于传进来的 'ai' → 直接 return false，
       人机打玩家时 ent.kind='red' 正好等于传进来的 'red' → 也 return false。
       结果就是「怎么打都不掉血」。正确做法是：
       每个目标只负责算出「它属于哪个阵营」，再拿这个阵营和子弹的队比一次。 */
    _hitCheck(b) {
      const px = { x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2 };
      /* 这个单位属于哪个阵营？认不出来就返回 null（那就跳过）。 */
      const factionOf = (ent) => {
        if (!ent) return null;
        if (ent === this.pR) return 'red';
        if (ent === this.pB) return 'blue';
        if (ent.team) return ent.team;                 // Bot: 'ai'
        if (ent.kind === 'red' || ent.kind === 'blue') return ent.kind;
        if (ent.kind === 'ai') return 'ai';
        return null;
      };
      const tryHit = (ent) => {
        if (!ent || ent.dead) return false;
        if (ent === b.owner) return false;              // 不打自己
        const fac = factionOf(ent);
        if (!fac || fac === b.team) return false;       // 同阵营（含自己这边）不受伤
        if (!LD.rectHit(px, ent.box)) return false;
        this._damage(ent, b.dmg, b.team);
        /* 命中反馈音。只给「玩家自己打中」发声，而且要限流 ——
           冲锋枪一秒几十发、若每发都响会糊成一片持续的电流声，
           反而听不出打没打中。0.06s 一次＝听感上「哒哒哒」而不是「滋——」。 */
        if (b.owner === this.pR || b.owner === this.pB) {
          const now = this.world.time || 0;
          if (!this._hitSfxAt || now - this._hitSfxAt > 0.06) {
            this._hitSfxAt = now;
            if (LD.Sfx && LD.Sfx.hit) LD.Sfx.hit();
          }
        }
        return true;
      };
      /* 顺序：玩家 → 人机 → 无人机。命中一个就停（一发子弹只结算一次）。 */
      if (tryHit(this.pR)) return true;
      if (tryHit(this.pB)) return true;
      for (const bot of this.bots) if (tryHit(bot)) return true;
      for (const d of this.drones) {
        if (d.dead || d === b.owner) continue;
        const fac = d.team || d.kind;
        if (fac === b.team) continue;
        if (LD.rectHit(px, d)) {
          d.hp -= b.dmg;
          if (d.hp <= 0) { d.dead = true; LD.FX.burst(d.x, d.y, 10, '#7ad4ff', 3); }
          return true;
        }
      }
      return false;
    }

    /* 木箱被打碎 → 30% 概率爆出一个技能补给，悬浮在**原箱子的正中间**
       （MC 悬浮方块那样上下浮动），走近吸收进顶栏技能槽，按 E 使用。
       人机又只在「被箱子挡路」时才打箱子，所以场上的箱子天然给玩家留着。 */
    _crateDrop(x, y, owner, team) {
      if (Math.random() >= 0.30) {
        /* 没爆：只给一撮碎屑特效，让人知道箱子是「打碎了但什么都没出」，
           而不是游戏漏了掉落。 */
        LD.FX.burst(x, y, 5, '#8a5f2b', 2.2);
        return;
      }
      const kind = LD.Guns.rollBoost();
      const info = LD.Guns.BOOSTS[kind];
      LD.FX.cone(x, y, info.color);
      /* 就地悬浮：不抛物线、不落地，钉在箱子原位上下浮（渲染层管浮动） */
      this.drops.push({
        x: x - 10, y: y - 10, w: 20, h: 20,
        kind, t: 0, life: 25,
      });
    }

    /* 掉落物：悬浮在箱子原位 → 玩家走近**吸收**进技能槽（一次只吸一个，
       用完才能再吸）→ 按 E 使用；人机走到上面直接用掉（它们没有 E 键，
       「箱子里的技能敌人可使用」）。
       到期（25s）前 3 秒开始闪烁，然后消失。 */
    _stepDrops(dt) {
      const w = this.world;
      for (let i = this.drops.length - 1; i >= 0; i--) {
        const d = this.drops[i];
        d.t += dt; d.life -= dt;
        if (d.life <= 0) { this.drops.splice(i, 1); continue; }
        const box = { x: d.x, y: d.y, w: d.w, h: d.h };
        /* 玩家：靠近吸收 → 进顶栏技能槽。槽位被占着就不吸（留在原地）。 */
        let absorbed = false;
        for (const p of this.players) {
          if (p.dead || p.heldPickup) continue;
          if (LD.rectHit(box, { x: p.x, y: p.y, w: p.w, h: p.h })) {
            p.heldPickup = d.kind;
            absorbed = true;
            if (p === this.pR) {
              const info = LD.Guns.BOOSTS[d.kind];
              const name = LD.I18N.isLatin() ? info.labelEn : info.label;
              this.flash(T_('gun.pickGet', { s: name, k: LD.Settings.label('usepick') }), 1800);
              if (LD.Sfx && LD.Sfx.pickup) LD.Sfx.pickup();
            }
            break;
          }
        }
        if (absorbed) { this.drops.splice(i, 1); continue; }
        /* 人机：直接用掉（血量低于 3/4 才顺路吃，不刻意绕路去抢） */
        for (const b of this.bots) {
          if (!b.dead && b.hp < b.maxHp * 0.75 &&
              LD.rectHit(box, { x: b.x, y: b.y, w: b.w, h: b.h })) {
            this._applyDrop(b, d.kind);
            this.drops.splice(i, 1);
            break;
          }
        }
      }
    }

    /* 按 E：用掉技能槽里吸出来的补给 */
    _useHeldPickup(p) {
      if (!p || !p.heldPickup) return;
      const kind = p.heldPickup;
      p.heldPickup = null;
      this._applyDrop(p, kind);
    }

    _applyDrop(who, kind) {
      const info = LD.Guns.BOOSTS[kind];
      LD.FX.cone(who.cx, who.y + who.h / 2, info.color);
      if (who.gun && (kind === 'double' || kind === 'triple' || kind === 'ammo')) {
        who.gun.applyBoost(kind);
      } else if (kind === 'heal') {
        who.hp = Math.min(who.maxHp || LD.Guns.MAX_HP, (who.hp || 0) + info.heal);
        who.healFx = 1;
      }
      if (who === this.pR) {
        const key = kind === 'double' ? 'gun.boost2' : kind === 'triple' ? 'gun.boost3'
          : kind === 'ammo' ? 'gun.boostAmmo' : 'gun.boostHeal';
        this.flash(T_('gun.crateBreak', { b: T_(key) }), 1600);
        /* 这里原来是 LD.Sfx.win()（过关的胜利号角）——
           打碎一个木箱却响过关音效，很容易让人以为「不小心过关了」。
           补给就该是「叮」的一下，和过关分得开。 */
        if (LD.Sfx && LD.Sfx.pickup) LD.Sfx.pickup();
      }
    }

    _stepHeal(dt) {
      // 【回血装置已删除】补给现在只能靠打木箱（30% 概率爆医疗补给）。
      // 医药包：5s 内分次回 20 滴
      for (const p of this.players) {
        if (p.dead) continue;
        if (p.healT > 0) {
          const rate = (p.healAmt || 20) / (p.healDur || 5);
          p.healT -= dt;
          p.hp = Math.min(p.maxHp || 100, p.hp + rate * dt);
          if (p.healT <= 0) p.healT = 0;
        }
      }
    }

    /* 人机增援：无尽模式持续加压；关卡里如果打光了但还没通关过（极端情况）不再刷 */
    _stepRespawn(dt) {
      if (this.gunMode !== 'endless') return;

      /* 【为什么先清理掉队的人机】
         无尽是「一路往右跑」：被甩在身后的人机既打不到你、也追不上来，
         但它们**永远算在 alive 里** —— 结果跑得越远，场上越空。
         这是「枪战无尽敌人太少」的另一半根因（另一半是每段初始只放 1~2 个）。
         所以每帧把落到相机左后方一屏外的人机移出列表，让增援补上来。 */
      const back = this.camX - VW * 1.2;
      for (let i = this.bots.length - 1; i >= 0; i--) {
        const b = this.bots[i];
        if (b.x + b.w < back) this.bots.splice(i, 1);
      }

      this._gunRespawnT -= dt;
      const alive = this.bots.filter((b) => !b.dead).length;
      /* want 从 3 起、每 40 格 +1、上限 10；间隔 4s。
         改之前是 3 起、上限 9、间隔 6s，实测开局只有 1~3 个，偏空。 */
      const want = 4 + Math.min(6, Math.floor(this.gunDist / 40));
      if (alive >= want || this._gunRespawnT > 0) return;
      this._gunRespawnT = 4;
      this._spawnWave(want - alive);
    }

    _spawnWave(n) {
      const w = this.world;
      const FLOOR = LD.ROWS - 2;
      let spawned = 0;
      /* 一次要补的人机变多（最多 10 个）之后，80 次尝试会不够用：
         每次尝试都要满足「离玩家 220px 以上」+「这一列有可站立的地面」，
         失败率不低，撑不满就会少刷。 */
      const tries = 160;
      for (let i = 0; i < tries && spawned < n; i++) {
        const c = 4 + Math.floor(Math.random() * (w.cols - 8));
        const dist = Math.abs(c * T - this.pR.cx);
        if (dist < 220) continue;                       // 别在玩家脸前刷
        // 找这一列可以站立的地面行
        let r = -1;
        for (let rr = 1; rr < FLOOR; rr++) {
          if (w.isSolid(c, rr + 1) && !w.isSolid(c, rr)) { r = rr + 1; break; }
        }
        if (r < 0) continue;
        const plan = {
          c, r, level: LD.clamp((this.gunStage - 1) / (LD.Guns.TOTAL_GUN_LEVELS - 1), 0, 1) * 100,
          elite: Math.random() < 0.2,
          weapon: LD.Guns.unlockedList(this.gunStage)[
            Math.floor(Math.random() * LD.Guns.unlockedList(this.gunStage).length)],
        };
        const b = new LD.GunAI.Bot(plan, w, this.bots.length + spawned);
        b.c = c; b.r = r;
        b.x = c * T + (T - b.w) / 2;
        b.y = r * T - b.h;
        b.__world = w;
        this.bots.push(b);
        spawned++;
      }
      if (spawned) {
        this.gunWave++;
        this.flash(T_('gun.respawn', { n: this.gunWave }), 1500);
      }
    }

    /* 关卡 / 无尽快捷目标 */
    _stepGunObjective() {
      /* 训练场没有胜负：清空敌人也**不算通关**。
         不挡这一句的话，按「2 清空敌人」会立刻弹通关结算面板，
         解锁进度、加分、记通关全被写进存档 —— 沙盒把进度刷满就不好玩了。 */
      if (this.gunMode === 'training') return;
      if (this.gunMode === 'endless') {
        // 续地形 + 按距离记分
        const w = this.world, p = this.pR;
        if (w.pxW - (p.x + p.w) < VW * 1.2) {
          const chunk = LD.genGunEndlessChunk(this.gunChunk++);
          w.extend(chunk);
        }
        const tiles = Math.max(0, Math.floor((p.x + p.w / 2) / T));
        if (tiles > this.gunDist) {
          this.gunScore += (tiles - this.gunDist) * 8;
          this.gunDist = tiles;
        }
        return;
      }
      // 关卡：人机全部倒下 → 通关
      const alive = this.bots.filter((b) => !b.dead).length;
      if (!alive && this.state === 'playing') this.gunClear();
    }

    gunClear() {
      const n = this.gunStage;
      const g = this.save.gun;
      g.cleared[n] = true;
      if ((g.unlocked || 1) < n + 1) g.unlocked = Math.min(LD.Guns.TOTAL_GUN_LEVELS, n + 1);
      if (n > (g.bestStage || 0)) g.bestStage = n;
      const score = this.gunScoreOf();
      g.score = (g.score || 0) + score;
      LD.Save.flush();
      LD.Sfx.win();
      if (LD.Sfx.final && n >= LD.Guns.TOTAL_GUN_LEVELS) LD.Sfx.final();
      this.state = 'won';
      this.winT = 0;
      this.confirmLock = 0.35;
      this.winKind = 'gun';
      const last = n >= LD.Guns.TOTAL_GUN_LEVELS;
      $('win-title').textContent = last ? T_('gun.winAll') : T_('gun.win', { n });
      $('win-tip').textContent = last ? T_('gun.winAllTip') : T_('gun.winTip');
      $('win-stat').innerHTML =
        `<span>${T_('gun.kills')} <b>${this.gunKills}</b></span>` +
        `<span>${T_('hud.score')} <b>${score}</b></span>` +
        `<span>${T_('win.time')} <b>${this.levelTime.toFixed(2)}s</b></span>` +
        `<span>${T_('hud.deaths')} <b>${this.levelDeaths}</b></span>`;
      const nextBtn = $('btn-next');
      nextBtn.textContent = last ? T_('gun.home') : T_('win.next') + ' →';
      nextBtn.disabled = false;
      this.updateHUD(true);
      this.open('ov-win');
      this.buildGunSelect();
      this.refreshGun();
    }

    gunScoreOf() {
      const base = 200 + this.gunStage * 14;
      const bonus = this.gunKills * 25;
      const penalty = this.levelDeaths * 40;
      return Math.max(0, base + bonus - penalty);
    }

    gunEndlessOver() {
      const g = this.save.gun;
      const score = this.gunScore, dist = this.gunDist;
      const isNew = score > (g.endlessBest || 0);
      g.endlessLast = score;
      g.endlessDist = Math.max(g.endlessDist || 0, dist);
      if (isNew) g.endlessBest = score;
      LD.Save.flush();
      this._gunLast = { score, dist, isNew, kills: this.gunKills };
      // 复用无尽结算面板
      this._esLast = { score, stage: dist, dist, isNew };
      this.refreshEndless();
      this.updateHUD(true);
      this.state = 'endlessOver';
      this.confirmLock = 0.4;
      $('endless-over-title').textContent = T_('gun.endlessOver');
      $('endless-over-stat').innerHTML =
        `<span>${T_('hud.score')} <b>${score}</b></span>` +
        `<span>${T_('endless.reached')} <b>${dist} m</b></span>` +
        `<span>${T_('gun.kills')} <b>${this.gunKills}</b></span>` +
        `<span>${T_('endless.best')} <b>${g.endlessBest || 0}</b></span>`;
      $('endless-over-tip').textContent = T_('gun.endlessTip', { n: dist });
      this.open('ov-endless-over');
    }

    /* ---------- 双人对枪：回合制 ---------- */
    _stepDuel(dt) {
      if (this.duelState === 'settle') {
        this.duelSettleT -= dt;
        if (this.duelSettleT <= 0) this._duelNextRound();
        return;
      }
      if (this.duelState !== 'fight') return;
      // 两人中任意一方倒下 → 这一回合结束
      if (this.pR.dead && !this.pB.dead) { this._duelSettle('p2'); return; }
      if (this.pB.dead && !this.pR.dead) { this._duelSettle('p1'); return; }
      if (this.pR.dead && this.pB.dead) { this._duelSettle('draw'); return; }
    }

    _duelSettle(winner) {
      if (this.duelState !== 'fight') return;
      this.duelState = 'settle';
      this.duelSettleT = 1.5;
      if (winner === 'p1') { this.duelP1++; this.flash(T_('gun.roundP1'), 1500); LD.Sfx.win(); }
      else if (winner === 'p2') { this.duelP2++; this.flash(T_('gun.roundP2'), 1500); LD.Sfx.win(); }
      else this.flash(T_('gun.roundDraw'), 1500);
    }

    _duelNextRound() {
      const need = Math.floor(this.duelRounds / 2) + 1;
      const done = this.duelRound >= this.duelRounds
        || this.duelP1 >= need || this.duelP2 >= need;
      if (done) { this._duelOver(); return; }
      this.duelRound++;
      const keep = { p1: this.duelP1, p2: this.duelP2, round: this.duelRound };
      this.loadGunDuel(true);                 // 重建场地，保留比分
      this.duelP1 = keep.p1; this.duelP2 = keep.p2; this.duelRound = keep.round;
      this.state = 'playing';
      this.closeAll();
      this.last = performance.now();
      this.flash(T_('gun.roundStart', { n: this.duelRound }), 1600);
    }

    _duelOver() {
      // 幂等：语言切换时 refreshText 会再调一次刷新文案，但胜场只能记一次
      const first = this.duelState !== 'over';
      this.duelState = 'over';
      const need = Math.floor(this.duelRounds / 2) + 1;
      const win = this.duelP1 >= need ? 'p1' : (this.duelP2 >= need ? 'p2' : 'draw');
      const g = this.save.gun;
      if (first) {
        this._duelLast = { p1: this.duelP1, p2: this.duelP2, win };
        g.duelWins = g.duelWins || { p1: 0, p2: 0 };
        if (win === 'p1') g.duelWins.p1++;
        else if (win === 'p2') g.duelWins.p2++;
        LD.Save.flush();
      }
      $('duel-title').textContent = win === 'p1' ? T_('gun.duelWinP1') : win === 'p2' ? T_('gun.duelWinP2') : T_('gun.duelDraw');
      $('duel-stat').innerHTML =
        `<span class="c-red">${T_('gun.duelP1')} <b>${this.duelP1}</b></span>` +
        `<span class="c-blue">${T_('gun.duelP2')} <b>${this.duelP2}</b></span>` +
        `<span>${T_('gun.duelRounds')} <b>${this.duelRounds}</b></span>`;
      $('duel-tip').innerHTML = T_('gun.duelHint', {
        n: this.duelRounds,
        r1: LD.Settings.labelExcept('fire', LD.Settings.gunKeyUnion()),
        r2: LD.Settings.label('p2fire'),
      });
      this.state = 'duelOver';
      this.confirmLock = 0.4;
      this.open('ov-duel-over');
    }

    /* ---------- 枪战输入包装 ----------
       玩家的移动 / 跳跃沿用普通键位，另外挂上开火 / 切枪 / 道具。
       对枪模式里双方共用一个键盘，红方要让出所有分给蓝方的键。 */
    _gunInput() {
      const I = LD.Input;
      /* 只有「本地双人对枪」才需要把蓝方的键让出来；
         单人枪战（闯关 / 无尽 / 训练场）没有第二个人，若仍排除 P2 键，
         默认开火键 F / J 会撞上 p2right / p2left 被「静默吃掉」——按了发不出子弹。 */
      const duel = this.gunMode === 'duel';
      const ex = duel ? LD.Settings.gunKeyUnion() : [];
      /* 槽位键和作弊键撞车时让作弊优先。
         默认绑定里 gun5 = F5、cheat = 数字 5，本来不冲突；
         但玩家可以把 gun5 改绑到数字 5，那时按一下不该又切枪又触发连击计数。 */
      const slotEx = ex.concat(LD.Settings.keys('cheat'));
      const p1 = {
        left: () => I.anyExcept('left', ex),
        right: () => I.anyExcept('right', ex),
        up: () => I.anyExcept('jump', ex),
        downKey: () => I.anyExcept('down', ex),
        jumpPressed: () => I.actionPressedExcept('jump', ex),
        jumpHeld: () => I.anyExcept('jump', ex),
        fire: () => I.anyExcept('fire', ex),
        nextGun: () => I.actionPressedExcept('nextgun', ex),
        prevGun: () => I.actionPressedExcept('prevgun', ex),
        item: () => I.actionPressedExcept('useitem', ex),
        usePick: () => I.actionPressedExcept('usepick', ex),
        slotKey: () => I.slotHit(slotEx),
      };
      const p2 = {
        left: () => I.any('p2left'),
        right: () => I.any('p2right'),
        up: () => I.any('p2jump'),
        downKey: () => I.any('p2down'),
        jumpPressed: () => I.actionPressed('p2jump'),
        jumpHeld: () => I.any('p2jump'),
        fire: () => I.any('p2fire'),
        nextGun: () => false,
        prevGun: () => false,
        item: () => I.actionPressed('p2item'),
        usePick: () => false,         // 对枪蓝方暂不给技能槽（E 是红方的键）
        slotKey: () => null,          // 对枪双方枪械由「操作设置」定好，不给槽位键
      };
      return { p1, p2 };
    }

    /* 人机的敌人列表：关卡/无尽里敌人是「玩家」；对枪里没有 AI，
       但同一套代码也用于无人机，所以这里给出「AI 视角下的敌人」。 */
    _gunFoes() {
      const out = [];
      /* 玩家正遥控无人机时（小人在天上无敌），把「玩家」从人机目标里摘掉、
         换成玩家那架存活无人机 —— 否则人机会一直对着一个打不动的无敌小人
         空打，而真正能打掉的无人机反而没人理（用户要求「无人机敌人可打」）。 */
      let playerControlledDrone = null;
      for (const d of this.drones) {
        if (!d.dead && d.controlled && d.owner && d.owner.__player) playerControlledDrone = d;
      }
      if (!playerControlledDrone) {
        if (this.pR && !this.pR.dead) out.push(this.pR);
        if (this.pB && !this.pB.dead) out.push(this.pB);
      } else {
        /* 把无人机包装成可被 sense() 识别的伪目标（补 cx/cy/h 字段）。
           敌人看到无人机在天上，会跳起来够着打、也会平射打掉它。 */
        const d = playerControlledDrone;
        out.push({
          cx: d.x, cy: d.y, h: d.h || 14, dead: false,
          __player: false, __drone: d,
        });
      }
      return out;
    }

    /* 枪战的相机：永远聚焦玩家（一屏竞技场，camX 基本都是 0） */
    _updateGunHUD() {
      const p = this.pR;
      const g = p.gun;
      const hp = Math.max(0, Math.round(p.hp));
      /* 血量上限会随击杀成长（100 → 500），上限超过基础值后 HUD 显示「当前/上限」，
         玩家才能看见自己在成长；还没打过任何架时就只显示当前血量，别添乱。 */
      const cap = p.maxHp || LD.Guns.MAX_HP;
      $('hud-hp').textContent = cap > LD.Guns.MAX_HP ? `${hp}/${cap}` : hp;
      $('hud-hp').style.color = hp <= 30 ? '#ff5d7a' : (hp <= 60 ? '#ffd23f' : '');
      /* 顶栏技能槽：吸进来的木箱补给亮图标，空槽隐藏 */
      const bp = $('box-pick'), hpic = $('hud-pick');
      if (bp && hpic) {
        if (p.heldPickup) {
          const info = LD.Guns.BOOSTS[p.heldPickup];
          bp.style.display = '';
          hpic.textContent = (LD.I18N.isLatin() ? info.labelEn : info.label) + ' · ' + LD.Settings.label('usepick');
          hpic.style.color = info.color;
        } else {
          bp.style.display = 'none';
        }
      }
      const wd = g.weapon();
      const nm = LD.I18N.isLatin() ? wd.nameEn : wd.name;
      let extra = '';
      if (wd.kind === 'gun') {
        /* 换弹时显示剩余秒数。原来这里错用了 gun.healing（「回血中…」）——
           换弹和回血是两件事，HUD 上写着「回血中」但血没动，很容易被当成回血装置坏了。 */
        extra = this.cheat ? ' · ∞'
          : (g.isReloading() ? ' · ' + T_('gun.reloading', { n: g.reloadT.toFixed(1) })
            : ` · ${g.ammo()}/${g.magSize()}`);
      } else {
        const left = Math.ceil(g.cooldownLeft(wd.id));
        extra = left > 0 ? ` · ${left}s` : ' · ✓';
      }
      $('hud-gun').textContent = wd.slot + ' ' + nm + extra;
      $('hud-wave').textContent = this.bots.filter((b) => !b.dead).length;
      /* 对枪的回合框在 updateHUD 里刷（box-round 只在 duel 时可见，走不到这里） */
    }

    /* ---------- 无尽模式：一整张「一直往右长」的无限地图 ----------
       以前的无尽是「进门 → 重建整张地图 → 换一层」，看起来就是一关一关；
       现在只有一张地图：玩家从最左边出发一路往右跑，跑近了右缘就往右接一段新地形，
       身后的地形留在原地不重置 —— 死一次才结算这一局。 */
    loadEndless(showHint) {
      this.mode = 'endless';
      this.esStage = 1;          // 已经生成到第几段（≈ 跑过多远，用于显示 / 续段）
      this.esChunk = 1;          // 下一段的段号
      this.esDist = 0;           // 本局最远前进距离（单位：格 = 米）
      this.esMilestone = 0;      // 已经拿到的里程碑个数（每 20 米一个）
      this.esScore = 0;
      this.level = LD.genEndlessChunk(0);
      this._buildWorld();

      // 站在最左边那块平地上（第 0 段两端各留了 3 格完整地面）
      const FLOOR = LD.ROWS - 2, p = this.player;
      this.world.spawn = { x: 2 * T + (T - p.w) / 2, y: FLOOR * T - p.h, footY: FLOOR * T };
      p.reset(this.world);
      this.camX = 0;
      this.esDist = Math.floor((p.x + p.w / 2) / T);   // 起步不算分
      if (showHint) this.showHint();
    }

    /* 无尽「再来一局」：按当前是无尽跑酷还是枪战无尽，回到对应的无尽模式。 */
    _endlessAgain() {
      if (this.mode === 'gun' && this.gunMode === 'endless') this.startGunEndless();
      else this.startEndless();
    }

    startEndless() {
      this.loadEndless(true);
      this.state = 'playing';
      this.closeAll();
      this.last = performance.now();
      LD.Music.sync(this.settings);
      this.flash(T_('toast.endlessStart'));
    }

    /* 前方快没地了就往右边接一段：世界不重建，玩家 / 相机 / 已触发的机关全部不受影响 */
    _endlessExtend() {
      const w = this.world, p = this.player;
      if (w.pxW - (p.x + p.w) > VW * 1.2) return;      // 前方还够跑，先不接
      const chunk = LD.genEndlessChunk(this.esChunk++);
      w.extend(chunk);
      this.esStage = this.esChunk;
    }

    /* 无尽模式一帧：续地形 + 按「最远距离」记分 */
    _endlessStep() {
      this._endlessExtend();
      const p = this.player;
      const tiles = Math.max(0, Math.floor((p.x + p.w / 2) / T));
      if (tiles <= this.esDist) return;
      this.esScore += (tiles - this.esDist) * 5;       // 每往前 1 米 5 分
      this.esDist = tiles;

      const ms = Math.floor(this.esDist / 20);
      if (ms > this.esMilestone) {
        this.esMilestone = ms;
        const bonus = 100 + ms * 30;
        this.esScore += bonus;
        LD.Sfx.win();
        LD.FX.cone(p.cx, p.y, '#35e0a1');
        this.flash(T_('endless.milestone', { n: ms * 20, s: bonus }), 1300);
      }
    }

    // 死亡 / 中途离开：记录分数并弹出本局结算
    endlessOver() {
      const e = this.save.endless;
      const score = this.esScore, dist = this.esDist;
      const isNew = score > e.best;
      e.last = score;
      e.runs = (e.runs || 0) + 1;
      if (isNew) e.best = score;
      if (dist > e.bestStage) e.bestStage = dist;
      LD.Save.flush();
      this._esLast = { score, stage: dist, dist, isNew };
      this.refreshEndless();
      this.updateHUD(true);          // 让 HUD 立刻显示本局最终的距离 / 分数
      this.state = 'endlessOver';
      this.confirmLock = 0.4;
      this.open('ov-endless-over');
      this.buildSelect();
    }

    refreshEndless() {
      const e = this.save.endless;
      const m = (n) => `${n} m`;
      $('endless-stat').innerHTML =
        `<span>${T_('endless.last')} <b>${e.last}</b></span>` +
        `<span>${T_('endless.best')} <b>${e.best}</b></span>` +
        `<span>${T_('endless.bestStage')} <b>${m(e.bestStage)}</b></span>` +
        `<span>${T_('endless.runs')} <b>${e.runs || 0}</b></span>`;
      if (!this._esLast) return;
      const L = this._esLast;
      $('endless-over-title').textContent = L.isNew ? T_('endless.over') + ' · ' + T_('endless.newBest') : T_('endless.over');
      $('endless-over-stat').innerHTML =
        `<span>${T_('endless.score')} <b>${L.score}</b></span>` +
        `<span>${T_('endless.reached')} <b>${m(L.dist)}</b></span>` +
        `<span>${T_('win.time')} <b>${this.levelTime.toFixed(1)}s</b></span>` +
        `<span>${T_('endless.best')} <b>${e.best}</b></span>`;
      $('endless-over-tip').textContent = T_('endless.overTip', { n: L.dist });
    }

    showHint() {
      const el = $('hint');
      let text;
      if (this.mode === 'gun') {
        if (this.gunMode === 'training') text = T_('gun.trainingDesc');
        else if (this.gunMode === 'endless') text = T_('gun.endlessDesc');
        else if (this.gunMode === 'duel') {
          text = T_('gun.duelHint', {
            n: this.duelRounds,
            r1: LD.Settings.labelExcept('fire', LD.Settings.gunKeyUnion()),
            r2: LD.Settings.label('p2fire'),
          });
        } else text = LD.I18N.levelHint(this.level);
      } else if (this.mode === 'coop') {
        text = T_('toast.coopHint', {
          n: this.coopStage, name: LD.I18N.levelName(this.level), hint: LD.I18N.levelHint(this.level),
        });
      } else if (this.mode === 'endless') {
        text = T_('toast.endless');
      } else if (this.index === 0) {
        // 第 1 关的指引跟着玩家实际绑定的按键走（改键后不会指向旧键）
        text = T_('toast.tutorial', {
          name: LD.I18N.levelName(this.level),
          move: LD.Settings.label('left') + ' / ' + LD.Settings.label('right'),
          jump: LD.Settings.label('jump'),
        });
      } else {
        text = T_('toast.levelHint', {
          n: this.index + 1, name: LD.I18N.levelName(this.level), hint: LD.I18N.levelHint(this.level),
        });
      }
      if (!text) { el.classList.remove('show'); return; }
      el.textContent = text;
      el.classList.add('show');
      clearTimeout(this._hintT);
      this._hintT = setTimeout(() => el.classList.remove('show'), 4600);
    }

    flash(text, ms) {
      const el = $('hint');
      el.textContent = text;
      el.classList.add('show');
      clearTimeout(this._hintT);
      this._hintT = setTimeout(() => el.classList.remove('show'), ms || 2200);
    }

    restart() {
      // 房间对局：房主重开并广播，房客只能请求（等房主的 start 广播）
      if (this.roomOn) { LD.RoomPlay.restart(this); return; }
      // 联机：房主重载并广播，房客只发请求（等房主的 stage 广播再同步重载）
      if (this.online) {
        if (this.netRole === 'host') this.startNetHost(this.coopStage);
        else {
          if (this.net) this.net.send({ t: 'restart' });
          this.flash(T_('online.waitHost'), 1200);
        }
        return;
      }
      if (this.mode === 'coop') this.loadCoop(this.coopStage, true);
      else if (this.mode === 'endless') this.loadEndless(true);
      else if (this.mode === 'gun') {
        if (this.gunMode === 'endless') this.loadGunEndless(true);
        else if (this.gunMode === 'duel') this.loadGunDuel();
        else this.loadGunLevel(this.gunStage, true);
      }
      else this.loadLevel(this.index, true);
      this.state = 'playing';
      this.closeAll();
      this.showHint();
      this.last = performance.now();
    }

    /* ---------- 作弊模式 ---------- */
    showCheatPulse(n) {
      const box = $('cheat-dots');
      if (box) {
        const dots = box.children;
        for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('on', i < n);
        box.classList.toggle('show', n > 0);
      }
      const need = LD.Input.cheatNeed();
      if (n <= 0 || n >= need) return;
      LD.Sfx.tick();
      this.flash(T_('toast.cheatNeed', { n: need - n, key: LD.Input.cheatKeyLabel() }), 1500);
    }

    toggleCheat() {
      if (!this.world) { this.flash(T_('cheat.needGame'), 1800); return; }  // 主页里没有对局可作弊
      this.cheat = !this.cheat;
      // 双人模式下两个小人都无敌 + 都能飞；
      // 联机房间对局里只开自己的（别人的作弊由别人的客户端 + 房主设置管）
      const list = this.roomOn ? [this.player]
        : (this.players && this.players.length ? this.players : [this.player]);
      for (const p of list) {
        p.invincible = this.cheat;
        p.fly = this.cheat;
        if (this.cheat) p.vy = 0;
        /* 枪战模式的「无敌」还多两条：射速飞快 + 无需换弹。
           gun.noAmmo 让 tryFire / fireDelay 直接走 NO_AMMO_DELAY（0.035s）通道。 */
        if (p.gun && this.mode === 'gun') {
          p.gun.noAmmo = this.cheat;
          if (this.cheat) {
            // 关掉作弊时也顺手清增益，免得残留一个「21/7」的诡异弹匣
            p.gun.boostT = 0; p.gun.boostRate = 1; p.gun.boostAmmo = 1; p.gun.boostKind = null;
            p.gun.reloadT = 0;
            p.gun.refill();
          }
        }
      }
      this.world.setCheat(this.cheat);
      // 枪战里人机也一起变弱（否则「无敌」只是不死，人机还能把玩家打得满地跑）
      if (this.mode === 'gun' && this.bots) {
        for (const b of this.bots) if (b.gun) b.gun.noAmmo = false;
      }
      if (this.cheat && !this.roomOn) {
        // 联机房间对局不开个人进度/解锁（房间的胜负是大家一起玩的，不进本地存档）
        this.save.cheatUsed = true;
        this.save.unlocked = 100;              // 作弊同时也解锁全部关卡
        if (this.mode === 'gun') {
          // 枪战模式：作弊顺手把枪械 / 关卡也全解锁
          this.save.gun.unlocked = LD.Guns.TOTAL_GUN_LEVELS;
          this.save.gun.unlockedAll = true;
          this.gunStage = LD.clamp(this.gunStage, 1, LD.Guns.TOTAL_GUN_LEVELS);
        }
        LD.Save.flush();
        this.buildSelect();
        this.buildGunSelect();
        this.refreshMenu();
        for (const p of list) LD.FX.cone(p.cx, p.y + p.h, '#ffd75e');
      }
      if (this.cheat && this.roomOn) {
        // 房间对局里也来一发金色特效，确认「我这边作弊开了」
        for (const p of list) LD.FX.cone(p.cx, p.y + p.h, '#ffd75e');
      }
      $('cheat-badge').classList.toggle('on', this.cheat);
      const dots = $('cheat-dots');
      if (dots) { dots.classList.remove('show'); for (const d of dots.children) d.classList.remove('on'); }
      LD.Sfx.cheat();
      this.flash(this.cheat ? T_('toast.cheatOn') : T_('toast.cheatOff'), 2600);
    }

    /* ---------- 每帧逻辑 ---------- */
    step(dt) {
      if (LD.Input.actionPressed('mute')) this.toggleMute();
      if (this.confirmLock > 0) this.confirmLock = Math.max(0, this.confirmLock - dt);
      const confirmOk = this.confirmLock <= 0;

      if (this.state === 'playing') {
        if (LD.Input.actionPressed('pause')) {
          // 联机对局里 Esc = 退出联机（pause() 内部已分流）
          this.pause(); return;
        }
        if (LD.Input.actionPressed('restart')) { this.restart(); return; }
        // 房间对局里没有「关卡选择」：L 键改成打开形象编辑（临时昵称 / 皮肤）
        if (LD.Input.actionPressed('select')) {
          if (this.roomOn) { LD.RoomPlay.openStyleMatch(this); return; }
          this.openSelect(); return;
        }
      } else if (this.state === 'paused' || this.state === 'select' || this.state === 'settings') {
        // 空格 / 回车也能从暂停里继续
        if (this.state === 'paused' && confirmOk && LD.Input.confirmPressed()) { this.resume(); return; }
        if (LD.Input.actionPressed('pause')) {
          // 从暂停进的操作设置：Esc 退回暂停菜单，而不是直接回主页
          if (this.state === 'settings' && this._settingsFromPause) { this._backFromSettings(); return; }
          this.goHome(); return;
        }
      } else if (this.state === 'menu') {
        if (confirmOk && LD.Input.confirmPressed()) { this.startPrimary(); return; }
      } else if (this.state === 'endlessMenu' || this.state === 'endlessOver') {
        if (confirmOk && LD.Input.confirmPressed()) { this._endlessAgain(); return; }
        if (LD.Input.actionPressed('pause')) { this.goHome(); return; }
      } else if (this.state === 'coopMenu') {
        if (confirmOk && LD.Input.confirmPressed()) { this.startCoop(this.coopStage); return; }
        if (LD.Input.actionPressed('pause')) { this.goHome(); return; }
      } else if (this.state === 'onlineMenu') {
        // 联机菜单：Esc 回主页（确认键不绑定，避免误触）
        if (LD.Input.actionPressed('pause')) { this.goHome(); return; }
      } else if (this.state === 'gunMenu') {
        if (confirmOk && LD.Input.confirmPressed()) { this.startGunLevel(this.gunStage); return; }
        if (LD.Input.actionPressed('pause')) { this.goHome(); return; }
      } else if (this.state === 'duelOver') {
        if (confirmOk && LD.Input.confirmPressed()) { this.startGunDuel(); return; }
        if (LD.Input.actionPressed('pause')) { this.goHome(); return; }
      } else if (this.state === 'coopFail') {
        // 时间到：空格马上再来一次，Esc 回主页
        if (confirmOk && LD.Input.confirmPressed()) {
          if (this.roomOn) { LD.RoomPlay.restart(this); return; }
          this.startCoop(this.coopStage); return;
        }
        if (LD.Input.actionPressed('pause')) { this.goHome(); return; }
      } else if (this.state === 'won') {
        // 空格 / 回车进下一关；「按住不放」也算（避免跳跃键还按着时以为没反应）
        if (confirmOk && (LD.Input.confirmPressed() || (LD.Input.confirmHeld() && this.winT > 0.5))) { this.nextLevel(); return; }
      }

      const p = this.player, w = this.world;
      w.update(dt, this.state === 'playing' ? this.players : null);
      LD.FX.update(dt);
      if (this.deathFlash > 0) this.deathFlash = Math.max(0, this.deathFlash - dt * 2.2);

      if (this.state === 'playing' && this.mode === 'coop') {
        this._stepCoop(dt);
      } else if (this.state === 'playing' && this.mode === 'gun') {
        this._stepGun(dt);
      } else if (this.state === 'playing') {
        this.levelTime += dt;
        p.update(dt, w, LD.Input);
        if (this.mode === 'endless') this._endlessStep();   // 续地形 + 记分
        this.camX = LD.lerp(this.camX, this._camTarget(), 0.16);

        const hit = w.hazardHit(p);
        if (hit) this.die(hit);
        else if (!p.invincible && w.fellOut(p)) this.die({ x: p.cx - 10, y: p.y, w: 20, h: 20 });
        else if (!this.cheat && p.y > w.pxH + 200) this.die({ x: p.cx, y: p.y, w: 20, h: 20 });
        else if (this.mode !== 'endless' && w.doorHit(p)) this.win();
      } else if (this.state === 'dying') {
        this.deathT -= dt;
        if (this.deathT <= 0) {
          if (this.mode === 'gun') {
            if (this.gunMode === 'endless') this.gunEndlessOver();     // 枪战无尽：死一次结束
            else { this.loadGunLevel(this.gunStage, true); this.state = 'playing'; }
          } else if (this.mode === 'endless') this.endlessOver();
          else { this.loadLevel(this.index, true); this.state = 'playing'; }
        }
      }
      if (this.state === 'playing' || this.state === 'dying') {
        this.hudT += dt;
        if (this.hudT > 0.1) { this.hudT = 0; this.updateHUD(); }
      }
    }

    die(hit) {
      if (!this.player.kill()) return;
      this.levelDeaths++;
      this.save.totalDeaths++;
      LD.Save.flush();
      this.deathFlash = 1;
      this.world.shake = 1;
      LD.Sfx.die();
      LD.FX.burst(hit.x + hit.w / 2, hit.y + hit.h / 2, 18, '#ff4d6d', 4.5);
      LD.FX.burst(this.player.cx, this.player.cy, 12, '#ffd23f', 3.6);
      this.state = 'dying';
      this.deathT = this.mode === 'endless' ? 0.9 : 0.72;
      this.updateHUD(true);
    }

    win() {
      const key = this.index + 1;
      this.save.cleared[key] = true;
      const best = this.save.best[key];
      const t = this.levelTime;
      if (!best || t < best) this.save.best[key] = t;
      if (this.save.unlocked < key + 1) this.save.unlocked = Math.min(100, key + 1);
      LD.Save.flush();
      LD.Sfx.win();
      LD.FX.cone(this.world.door.x + T / 2, this.world.door.y + T, '#35e0a1');
      this.state = 'won';
      this.winT = 0;
      this.confirmLock = 0.35;
      this.winKind = 'level';
      if (key >= 100) LD.Sfx.final();

      $('win-title').textContent = key >= 100 ? T_('win.titleAll') : T_('win.title', { n: key });
      $('win-tip').textContent = key >= 100 ? T_('win.tipAll') : (key === 1 ? T_('win.tip1') : T_('win.tipOther'));
      $('win-stat').innerHTML =
        `<span>${T_('win.time')} <b>${t.toFixed(2)}s</b></span>` +
        `<span>${T_('win.deaths')} <b>${this.levelDeaths}</b></span>` +
        `<span>${T_('win.best')} <b>${this.save.best[key].toFixed(2)}s</b></span>` +
        `<span>${T_('win.total')} <b>${this.save.totalDeaths}</b></span>`;
      const nextBtn = $('btn-next');
      nextBtn.textContent = key >= 100 ? T_('win.nextToFirst') : T_('win.next') + ' →';
      nextBtn.disabled = false;
      this.open('ov-win');
      this.buildSelect();
    }

    nextLevel() {
      // 房间对局：下一关 / 再来一局由房主发起并广播
      if (this.roomOn) { LD.RoomPlay.next(this); return; }
      // 联机：下一关由房主说了算 —— 房客点「下一关」只是发请求
      if (this.online && this.netRole === 'guest') {
        if (this.net) this.net.send({ t: 'next' });
        const b = $('btn-next');
        if (b) { b.textContent = T_('online.waitNext'); b.disabled = true; }
        return;
      }
      if (this.online && this.netRole === 'host') { this.netNext(); return; }
      if (this.winKind === 'gun') {
        // 150 关全部打完 → 回主页；否则进下一关枪战关卡
        if (this.gunStage >= LD.Guns.TOTAL_GUN_LEVELS || this.gunStage >= this.gunCap()) {
          this.goHome();
          return;
        }
        this.startGunLevel(this.gunStage + 1);
        return;
      }
      if (this.winKind === 'coop') {
        if (this.coopStage >= LD.COOP_COUNT) { this.goHome(); return; }
        this.startCoop(this.coopStage + 1);
        return;
      }
      const next = this.index >= 99 ? 0 : this.index + 1;
      this.startAt(next);
    }

    /* ---------- 循环 ---------- */
    loop(ts) {
      const now = ts || performance.now();
      const dt = Math.min(0.06, (now - this.last) / 1000);
      this.last = now;
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 6) {
        this.step(STEP);
        this.acc -= STEP;
        steps++;
        LD.Input.endFrame();
      }
      if (this.state === 'won') this.winT += dt;
      this.render();
      requestAnimationFrame(this.loop);
    }

    render() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, VW, VH);
      LD.Render.draw(ctx, this);
    }

    /* ---------- HUD ---------- */
    updateHUD() {
      const endless = this.mode === 'endless';
      const coop = this.mode === 'coop';
      const gun = this.mode === 'gun';
      const duel = gun && this.gunMode === 'duel';
      const gunEndless = gun && this.gunMode === 'endless';
      const show = (id, on) => { const el = $(id); if (el) el.style.display = on ? '' : 'none'; };
      show('box-score', endless || coop || gun);
      show('box-best', endless || coop || gun);
      /* 【用户需求：顶栏删「本关死亡」「本关用时」】box-deaths 整个删了；
         box-time 只在双人模式活着 —— 那一栏在双人里是「倒计时」
         （最后 10 秒变红），不是「本关用时」，所以保留。 */
      show('box-time', coop);
      show('box-total', !endless && !coop && !gun);
      show('box-p1', coop);
      show('box-p2', coop);
      show('box-hp', gun && !duel);
      show('box-gun', gun && !duel);
      show('box-wave', gun && !duel);
      show('box-round', duel);
      // 训练场热键图例只在训练场里露出来
      const lg = $('train-legend');
      if (lg) lg.style.display = (gun && this.gunMode === 'training') ? 'flex' : 'none';
      $('hud-level').textContent = gun
        ? (gunEndless ? T_('gun.distShort', { n: this.gunDist })
          : duel ? T_('gun.duelRoundNow', { n: this.duelRound })
            : this.gunMode === 'training' ? T_('gun.trainingShort')
              : T_('gun.stageShort', { n: this.gunStage }))
        : endless ? T_('endless.distShort', { n: this.esDist })
          : coop ? (this.online ? T_('online.stage', { n: this.coopStage }) : T_('coop.stageShort', { n: this.coopStage }))
            : `${this.index + 1}/100`;
      // 双人模式：时间那一栏是「倒计时」，最后 10 秒变红
      const tlab = $('hud-time-label');
      if (tlab) tlab.textContent = T_(coop ? 'hud.countdown' : 'hud.time');
      const tel = $('hud-time');
      if (coop) {
        const left = Math.max(0, (this.coopTimeLimit || 0) - this.levelTime);
        tel.textContent = left.toFixed(1) + 's';
        tel.style.color = left <= 10 ? '#ff5d7a' : '';
      } else {
        tel.textContent = this.levelTime.toFixed(1) + 's';
        tel.style.color = '';
      }
      $('hud-total').textContent = this.save.totalDeaths;
      $('hud-score').textContent = gun
        ? (gunEndless ? this.gunScore : (duel ? this.duelP1 + this.duelP2 : this.gunScoreOf().score))
        : endless ? this.esScore : (coop ? this.coopScoreOf().score : 0);
      $('hud-best').textContent = gun
        ? (gunEndless ? Math.max(this.save.gun.endlessBest || 0, this.gunScore) : (duel ? this.duelRounds : this.save.gun.score || 0))
        : endless ? Math.max(this.save.endless.best, this.esScore)
          : (coop ? (this.save.coop.best[this.coopStage] || 0) : 0);
      if (coop) {
        $('hud-p1').textContent = this.coopDeaths.red + (this._coopReady.rOk ? ' ✓' : '');
        $('hud-p2').textContent = this.coopDeaths.blue + (this._coopReady.bOk ? ' ✓' : '');
        const b1 = $('box-p1'), b2 = $('box-p2');
        if (b1) b1.title = T_('coop.p1short') + ' · ' + (this._coopReady.rOk ? T_('coop.ready') : T_('coop.notReady'));
        if (b2) b2.title = T_('coop.p2short') + ' · ' + (this._coopReady.bOk ? T_('coop.ready') : T_('coop.notReady'));
      }
      /* 双人对枪的顶部读数（红分 / 蓝分 / 打满几回合）。
         以前这里给的是「P1+P2 回合总数」和「duelRounds」，
         配上标签「分数 / 最高分」完全是错的读数 —— 对枪要看的正是两个比分。 */
      if (gun && duel) {
        $('hud-score').textContent = this.duelP1;
        $('hud-best').textContent = this.duelP2;
        const wsl = $('hud-score-label'), wbl = $('hud-best-label');
        if (wsl) wsl.textContent = T_('gun.duelRed');
        if (wbl) wbl.textContent = T_('gun.duelBlue');
        $('hud-round').textContent = `${this.duelRound}/${this.duelRounds}  ${this.duelP1}-${this.duelP2}`;
      } else {
        /* 从对枪切回别的模式时把标签还原（否则「红方比分」会留在无尽模式上） */
        const wsl2 = $('hud-score-label'), wbl2 = $('hud-best-label');
        if (wsl2) wsl2.textContent = T_('hud.score');
        if (wbl2) wbl2.textContent = T_('hud.best');
      }
      if (gun && !duel) this._updateGunHUD();
    }

    /* ---------- 主页 3D 人物 ----------
       主页就是普通 2D 小人 + 不透明菜单（不再有 3D 人物）。 */

    /* ---------- 覆盖层 ---------- */
    closeAll() {
      ['ov-menu', 'ov-select', 'ov-settings', 'ov-pause', 'ov-win', 'ov-fail', 'ov-endless', 'ov-endless-over', 'ov-coop', 'ov-gun', 'ov-duel-over', 'ov-online', 'ov-lobby', 'ov-style', 'ov-room-over', 'ov-account', 'ov-admin']
        .forEach((id) => { const el = $(id); if (el) el.classList.add('hidden'); });
    }
    open(id) {
      this.closeAll();
      $(id).classList.remove('hidden');
    }
    pause() {
      // 房间对局里 Esc / 暂停键 = 回大厅等待（不再直接退出房间，避免误触自动退联机）
      if (this.roomOn) { LD.RoomPlay.backToLobby(this); return; }
      // 联机对局里没有「本地暂停」：Esc / 暂停键 = 退出联机（并通知对手）
      if (this.online) { this.netLeave(); return; }
      this.state = 'paused'; this.open('ov-pause');
    }
    resume() { this.closeAll(); this.state = 'playing'; this.last = performance.now(); }
    openSelect() {
      // 房间对局里没有关卡选择：改成打开形象编辑
      if (this.roomOn && LD.RoomPlay) { LD.RoomPlay.openStyleMatch(this); return; }
      this.state = 'select';
      this.resetUnlockUI('level');
      this.buildSelect();
      this.open('ov-select');
    }
    openEndless() { this.state = 'endlessMenu'; this.refreshEndless(); this.open('ov-endless'); }
    goHome() {
      // 从任何地方回主页都先礼貌退房（散打 / 合作对局也一样）
      if (LD.RoomPlay) LD.RoomPlay.cleanup(this);
      // 联机对局中回主页 = 退出联机（先跟对手打招呼，再断开）
      if (this.net) {
        try { this.net.send({ t: 'bye' }); } catch (e) {}
        this.netClose();
        this.online = false;
        this.netRole = null;
      }
      // 无尽模式中途离开也算结束本局（分数照样记录），先给结算
      if (this.mode === 'endless' && (this.state === 'playing' || this.state === 'dying')) {
        this.endlessOver();
        return;
      }
      if (this.mode === 'gun' && this.gunMode === 'endless' && (this.state === 'playing' || this.state === 'dying')) {
        this.gunEndlessOver();
        return;
      }
      if (this.mode !== 'level') {
        // 双人 / 无尽 / 枪战中途回主页：先切回普通关卡，免得主页还停在旧模式
        this.mode = 'level';
        this.bots = []; this.bullets = []; this.blasts = []; this.drones = []; this.droneView = null;
        this.index = LD.clamp(this.save.unlocked - 1, 0, 99);
        this.loadLevel(this.index, true);
      } else {
        // 就算已经在普通模式里，也把枪战的临时实体清掉（渲染层按 world.gun 判断，
        // 但残留的 bots/bullets 会被下一帧的枪战逻辑误用）
        this.bots = []; this.bullets = []; this.blasts = []; this.drones = []; this.droneView = null;
      }
      this.state = 'menu';
      this.closeAll();
      this.refreshMenu();
      this.open('ov-menu');
      this.last = performance.now();
    }
    openSettings() { this.state = 'settings'; this._settingsFromPause = false; this.buildSettings(); this.open('ov-settings'); }
    /* 从暂停菜单（Esc）进入操作设置：改完键要回到暂停，而不是退回主页。 */
    openSettingsFromPause() { this.state = 'settings'; this._settingsFromPause = true; this.buildSettings(); this.open('ov-settings'); }

    /* ---------- 账号面板（D1 云存档） ---------- */
    openAccount() {
      this.state = 'settings';
      this._accMsg('');
      this._accRefresh();
      this.open('ov-account');
    }
    _accMsg(s) { const el = $('acc-msg'); if (el) el.textContent = s; }
    _accRefresh() {
      const inn = $('acc-in'), out = $('acc-out'), who = $('acc-who'), perm = $('acc-perm');
      const name = LD.Cloud ? LD.Cloud.user() : null;
      if (inn) inn.classList.toggle('hidden', !name);
      if (out) out.classList.toggle('hidden', !!name);
      if (who) who.innerHTML = name ? T_('acc.welcome', { name }) : '';
      if (perm) {
        if (!name) perm.textContent = '';
        else if (LD.Cloud.isAdmin()) perm.textContent = T_('acc.permAdmin');
        else perm.textContent = T_('acc.permNo');
      }
      const nm = $('acc-name');
      if (nm && name && !nm.value) nm.value = name;
    }
    async _accSubmit(kind) {
      const nm = $('acc-name'), pw = $('acc-pw');
      const name = nm ? nm.value.trim() : '', pass = pw ? pw.value : '';
      this._accMsg(T_('acc.working'));
      try {
        const j = kind === 'register' ? await LD.Cloud.register(name, pass) : await LD.Cloud.login(name, pass);
        if (pw) pw.value = '';
        this._accRefresh();
        this._accMsg(T_(kind === 'register' ? 'acc.regOk' : 'acc.loginOk'));
        if (j && j.save && kind === 'login') this.flash(T_('acc.cloudApplied'));
        LD.Sfx.ui();
      } catch (e) { this._accMsg(e.message); }
    }
    async _accUpload() {
      this._accMsg(T_('acc.working'));
      try { await LD.Cloud.uploadSave(); this._accMsg(T_('acc.upOk')); }
      catch (e) { this._accMsg(e.message); }
    }
    async _accDownload() {
      this._accMsg(T_('acc.working'));
      try {
        const sv = await LD.Cloud.downloadSave();
        if (!sv) { this._accMsg(T_('acc.noCloud')); return; }
        // 存档已写入本地，重开页面读到新档最干净
        this._accMsg(T_('acc.downOk'));
        setTimeout(() => location.reload(), 700);
      } catch (e) { this._accMsg(e.message); }
    }
    async _accLogout() {
      await LD.Cloud.logout();
      this._accRefresh();
      this._accMsg(T_('acc.logoutOk'));
    }

    /* ---------- 至高账号 · 用户管理（Esc 暂停菜单进入，仅管理员可见） ---------- */
    openAdmin() {
      if (!(LD.Cloud && LD.Cloud.isAdmin())) return;
      this.open('ov-admin');
      this._adminBuild();
    }
    async _adminBuild() {
      const body = $('admin-body');
      if (!body) return;
      body.innerHTML = `<div class="set-tip">${T_('admin.loading')}</div>`;
      try {
        const users = await LD.Cloud.adminUsers();
        if (!users.length) { body.innerHTML = `<div class="set-tip">${T_('admin.empty')}</div>`; return; }
        body.innerHTML = '';
        for (const u of users) {
          const row = document.createElement('div');
          row.className = 'admin-row';
          const self = u.name === LD.Cloud.user();
          const tags = [
            u.role === 'admin' ? `<b class="adm-tag adm-sup">${T_('admin.supreme')}</b>` : '',
            u.banned ? `<b class="adm-tag adm-ban">${T_('admin.banned')}</b>` : '',
            u.cheatOk ? `<b class="adm-tag adm-ok">${T_('admin.cheatOk')}</b>` : '',
          ].join('');
          const acts = [];
          if (u.role !== 'admin') {
            acts.push(`<button class="sm" data-act="cheat" data-id="${u.id}">${u.cheatOk ? T_('admin.cheatOff') : T_('admin.cheatOn')}</button>`);
            acts.push(`<button class="sm" data-act="${u.banned ? 'unban' : 'ban'}" data-id="${u.id}">${u.banned ? T_('admin.unban') : T_('admin.ban')}</button>`);
            acts.push(`<button class="sm danger" data-act="delete" data-id="${u.id}">${T_('admin.del')}</button>`);
          }
          row.innerHTML =
            `<div class="adm-info"><b>${u.name}</b>${self ? ' <span class="set-tip">(我)</span>' : ''}<span class="adm-tags">${tags || ''}</span></div>` +
            `<div class="adm-acts">${acts.join('')}</div>`;
          body.appendChild(row);
        }
        body.querySelectorAll('button[data-act]').forEach((b) => {
          b.onclick = () => this._adminAct(parseInt(b.dataset.id, 10), b.dataset.act);
        });
      } catch (e) {
        body.innerHTML = `<div class="set-tip">${e.message}</div>`;
      }
    }
    async _adminAct(id, act) {
      if (act === 'delete' && !confirm(T_('admin.delConfirm'))) return;
      try {
        await LD.Cloud.adminAct(id, act);
        LD.Sfx.ui();
        await this._adminBuild();
      } catch (e) { this.flash(e.message, 2000); }
    }
    _backFromAdmin() {
      if (this.state === 'playing' || this.state === 'dying' || this.state === 'paused') { this.open('ov-pause'); this.state = 'paused'; }
      else { this.state = 'menu'; this.refreshMenu(); this.open('ov-menu'); }
    }

    _backFromSettings() { this.state = 'paused'; this.open('ov-pause'); }

    /* ---------- 主页 ---------- */
    refreshMenu() {
      const unlocked = LD.clamp(this.save.unlocked, 1, 100);
      const isNew = unlocked <= 1;
      const play = $('btn-play');
      play.textContent = isNew ? T_('menu.playNew') : T_('menu.playContinue', { n: unlocked });
      play.dataset.mode = isNew ? 'new' : 'continue';

      const chip = (keys, label) => `<div class="key"><b>${keys}</b> ${label}</div>`;
      const L = (a) => LD.Settings.label(a) || '—';
      /* 作弊键说明只给有权限的人看（至高账号 / 被授权用户） */
      const cheatChip = this._cheatAllowed() ? chip(L('cheat') + ' ×' + LD.Input.cheatNeed(), T_('menu.k.cheat')) : '';
      $('menu-keys').innerHTML =
        chip(L('left') + ' / ' + L('right'), T_('menu.k.move')) +
        chip(L('jump'), T_('menu.k.jump')) +
        chip(L('down'), T_('menu.k.down')) +
        chip(L('confirm'), T_('menu.k.next')) +
        chip(L('pause'), T_('menu.k.pause')) +
        cheatChip;

      $('cheat-badge').textContent =
        LD.I18N.isLatin()
          ? `CHEAT · invincible + flight + 1.8× speed (tap ${LD.Input.cheatNeed()}× "${LD.Input.cheatKeyLabel()}" to disable)`
          : `作弊模式 · 无敌 + 飞行 + 1.8 倍移速（再连按 ${LD.Input.cheatNeed()} 下「${LD.Input.cheatKeyLabel()}」关闭）`;
      // 页脚不再展示作弊玩法说明（应用户要求移除）
      // $('footer-tip').innerHTML = T_('footer.tip', { n: LD.Input.cheatNeed() });

      // 进度点数量跟随「连按次数」
      const dots = $('cheat-dots');
      const need = LD.Input.cheatNeed();
      if (dots && dots.children.length !== need) {
        dots.innerHTML = '';
        for (let i = 0; i < need; i++) dots.appendChild(document.createElement('i'));
      }
    }

    // 主页「开始游戏」：默认接着最新进度开始；没有进度则从第 1 关开始
    startPrimary() {
      const btn = $('btn-play');
      if (btn.dataset.mode === 'continue') {
        const at = LD.clamp(this.save.unlocked - 1, 0, 99);
        this.startAt(at, T_('toast.continueAt', { n: at + 1 }));
      } else {
        this.startAt(0, T_('toast.newGame'));
      }
    }

    startAt(i, toast) {
      this.loadLevel(i, false);
      this.state = 'playing';
      this.closeAll();
      this.last = performance.now();
      LD.Music.sync(this.settings);
      if (toast) this.flash(toast);
    }

    /* ---------- 设置面板 ---------- */
    buildSettings() {
      const body = $('set-body');
      const S = LD.Settings;
      /* 所有动作集合：单人 / 双人 / 枪战 / 对枪四组，键位占用关系要一起算 */
      const ALL_ACTIONS = S.ORDER.concat(S.ORDER2, S.ORDER_GUN, S.ORDER_GUN2);
      body.innerHTML = '';

      /* 1) 按键设置 */
      const sec1 = document.createElement('div');
      sec1.className = 'set-sec';
      const h1 = document.createElement('div');
      h1.className = 'sec-title';
      h1.textContent = T_('settings.keysTitle');
      sec1.appendChild(h1);
      const tip1 = document.createElement('div');
      tip1.className = 'set-tip';
      tip1.textContent = T_('settings.keysTip');
      sec1.appendChild(tip1);

      // 一行按键设置（单人 / 双人共用同一套渲染，占用关系覆盖两组动作）
      const mkKeyRow = (action) => {
        const row = document.createElement('div');
        row.className = 'set-row';
        const lab = document.createElement('div');
        lab.className = 'set-label';
        lab.textContent = T_('act.' + action);
        row.appendChild(lab);

        const chips = document.createElement('div');
        chips.className = 'chips';
        const used = {};
        ALL_ACTIONS.forEach((a) => { if (a !== action) S.keys(a).forEach((c) => { used[c] = a; }); });

        (S.CANDIDATES[action] || []).forEach((code) => {
          const b = document.createElement('div');
          const on = S.hasKey(action, code);
          b.className = 'chip' + (on ? ' on' : '') + (used[code] ? ' used' : '');
          b.textContent = LD.I18N.keyLabel(code);
          const other = used[code];
          b.title = on ? '' : (other ? `${T_('act.' + other)}` : '');
          b.onclick = () => {
            const r = S.toggleKey(action, code);
            if (!r.ok) {
              if (r.reason === 'needOne') this.flash(T_('settings.needOne', { name: T_('act.' + action) }));
              return;
            }
            LD.Sfx.ui();
            this.buildSettings();
            this.refreshMenu();
          };
          chips.appendChild(b);
        });
        row.appendChild(chips);
        return row;
      };

      S.ORDER.forEach((action) => sec1.appendChild(mkKeyRow(action)));

      // 连按次数
      const rowNeed = document.createElement('div');
      rowNeed.className = 'set-row';
      rowNeed.innerHTML = `<div class="set-label">${T_('settings.cheatNeed')}</div>`;
      const step = document.createElement('div');
      step.className = 'stepper';
      const minus = document.createElement('button');
      minus.className = 'sm'; minus.textContent = '−';
      const val = document.createElement('b'); val.textContent = S.data.cheatNeed;
      const plus = document.createElement('button');
      plus.className = 'sm'; plus.textContent = '+';
      const chg = (d) => {
        S.data.cheatNeed = LD.clamp(S.data.cheatNeed + d, 2, 9);
        S.flush(); LD.Sfx.ui(); this.buildSettings(); this.refreshMenu();
      };
      minus.onclick = () => chg(-1);
      plus.onclick = () => chg(1);
      step.appendChild(minus); step.appendChild(val); step.appendChild(plus);
      rowNeed.appendChild(step);
      const tipN = document.createElement('div');
      tipN.className = 'set-tip';
      tipN.textContent = T_('settings.cheatNeedTip');
      rowNeed.appendChild(tipN);
      sec1.appendChild(rowNeed);
      const reservedTip = document.createElement('div');
      reservedTip.className = 'set-tip';
      reservedTip.textContent = T_('settings.reservedTip');
      sec1.appendChild(reservedTip);
      body.appendChild(sec1);

      /* 1b) 双人模式键位（蓝魔） */
      const sec1b = document.createElement('div');
      sec1b.className = 'set-sec';
      const h1b = document.createElement('div');
      h1b.className = 'sec-title';
      h1b.textContent = T_('settings.coopTitle');
      sec1b.appendChild(h1b);
      const tip1b = document.createElement('div');
      tip1b.className = 'set-tip';
      tip1b.textContent = T_('settings.coopTip');
      sec1b.appendChild(tip1b);
      S.ORDER2.forEach((action) => sec1b.appendChild(mkKeyRow(action)));
      body.appendChild(sec1b);

      /* 1c) 枪战模式：键位 + 双人对枪配置
         用户需求：「操作设置中可以修改多种配置」「双人对枪可在操作设置中调节两人的枪械，
         10 个回合，也可在操作设置中调节回合」。 */
      const sec1c = document.createElement('div');
      sec1c.className = 'set-sec';
      const h1c = document.createElement('div');
      h1c.className = 'sec-title';
      h1c.textContent = T_('settings.gunTitle');
      sec1c.appendChild(h1c);
      const tip1c = document.createElement('div');
      tip1c.className = 'set-tip';
      tip1c.textContent = T_('settings.gunTip');
      sec1c.appendChild(tip1c);
      S.ORDER_GUN.forEach((action) => sec1c.appendChild(mkKeyRow(action)));

      /* 枪械选择器：逐次点击在「所有枪」里循环（枪械解锁在枪战面板里用密码开） */
      const gunList = LD.Guns.WEAPONS.filter((w) => w.kind === 'gun');
      const gunName = (id) => {
        const w = LD.Guns.byId[id] || LD.Guns.byId.pistol;
        return w.slot + ' ' + (LD.I18N.isLatin() ? w.nameEn : w.name);
      };
      const mkGunPick = (which) => {
        const row = document.createElement('div');
        row.className = 'set-row';
        const lab = document.createElement('div');
        lab.className = 'set-label';
        lab.textContent = T_(which === 'p1' ? 'settings.gunP1' : 'settings.gunP2');
        row.appendChild(lab);
        const wrap = document.createElement('div');
        wrap.className = 'lang-btns';
        const b = document.createElement('button');
        b.className = 'sm on';
        b.textContent = gunName(S.data.gun[which]);
        b.onclick = () => {
          const i = gunList.findIndex((w) => w.id === S.data.gun[which]);
          const nx = gunList[(i + 1 + gunList.length) % gunList.length];
          S.data.gun[which] = nx.id;
          S.flush();
          LD.Sfx.ui();
          this.buildSettings();
        };
        wrap.appendChild(b);
        const tip = document.createElement('div');
        tip.className = 'set-tip';
        tip.textContent = T_('settings.gunPickTip');
        wrap.appendChild(tip);
        row.appendChild(wrap);
        return row;
      };
      sec1c.appendChild(mkGunPick('p1'));
      sec1c.appendChild(mkGunPick('p2'));

      // 回合数
      const rowR = document.createElement('div');
      rowR.className = 'set-row';
      rowR.innerHTML = `<div class="set-label">${T_('settings.gunRounds')}</div>`;
      const stR = document.createElement('div');
      stR.className = 'stepper';
      const rMinus = document.createElement('button'); rMinus.className = 'sm'; rMinus.textContent = '−';
      const rVal = document.createElement('b'); rVal.textContent = S.data.gun.rounds;
      const rPlus = document.createElement('button'); rPlus.className = 'sm'; rPlus.textContent = '+';
      const chgR = (d) => {
        S.data.gun.rounds = LD.clamp(S.data.gun.rounds + d, 1, 30);
        S.flush(); LD.Sfx.ui(); this.buildSettings();
      };
      rMinus.onclick = () => chgR(-1);
      rPlus.onclick = () => chgR(1);
      stR.appendChild(rMinus); stR.appendChild(rVal); stR.appendChild(rPlus);
      rowR.appendChild(stR);
      sec1c.appendChild(rowR);

      // 人机是否会用道具
      const rowB = document.createElement('div');
      rowB.className = 'set-row';
      rowB.innerHTML = `<div class="set-label">${T_('settings.gunBotItems')}</div>`;
      const bw = document.createElement('div');
      bw.className = 'lang-btns';
      const bb = document.createElement('button');
      bb.className = 'sm' + (S.data.gun.botItems ? ' on' : '');
      bb.textContent = S.data.gun.botItems ? T_('settings.on') : T_('settings.off');
      bb.onclick = () => {
        S.data.gun.botItems = !S.data.gun.botItems;
        S.flush(); LD.Sfx.ui(); this.buildSettings();
      };
      bw.appendChild(bb);
      rowB.appendChild(bw);
      sec1c.appendChild(rowB);
      body.appendChild(sec1c);

      /* 1d) 蓝方（对枪 / 双人）开火键 */
      const sec1d = document.createElement('div');
      sec1d.className = 'set-sec';
      const h1d = document.createElement('div');
      h1d.className = 'sec-title';
      h1d.textContent = T_('settings.gunKeys2Title');
      sec1d.appendChild(h1d);
      const tip1d = document.createElement('div');
      tip1d.className = 'set-tip';
      tip1d.textContent = T_('settings.gunKeys2Tip');
      sec1d.appendChild(tip1d);
      S.ORDER_GUN2.forEach((action) => sec1d.appendChild(mkKeyRow(action)));
      body.appendChild(sec1d);

      /* 2) 音乐 / 音效 */
      const sec2 = document.createElement('div');
      sec2.className = 'set-sec';
      const h2 = document.createElement('div');
      h2.className = 'sec-title';
      h2.textContent = T_('settings.musicTitle');
      sec2.appendChild(h2);

      const tracks = LD.Music.TRACKS.concat([{ id: 'none', name: '关闭音乐', nameEn: 'No music', genre: '—', genreEn: '—' }]);
      tracks.forEach((tr) => {
        const d = document.createElement('div');
        const on = S.data.music.track === tr.id;
        d.className = 'track' + (on ? ' on' : '');
        d.innerHTML =
          `<div><div class="tname">${LD.I18N.isLatin() ? tr.nameEn : tr.name}</div>` +
          `<div class="tgen">${LD.I18N.isLatin() ? tr.genreEn : tr.genre}${tr.bpm ? ' · ' + tr.bpm + ' BPM' : ''}</div></div>` +
          `<div class="tmark">${on ? '▶ ' + T_('music.on') : ''}</div>`;
        d.onclick = () => {
          S.data.music.track = tr.id;
          S.flush();
          LD.Music.sync(S.data);
          this.updateAudioButtons();
          this.buildSettings();
        };
        sec2.appendChild(d);
      });

      const mkSlider = (labelKey, obj, key, after) => {
        const row = document.createElement('div');
        row.className = 'set-row';
        row.innerHTML = `<div class="set-label">${T_(labelKey)}</div>`;
        const wrap = document.createElement('div');
        wrap.className = 'slider';
        const inp = document.createElement('input');
        inp.type = 'range'; inp.min = '0'; inp.max = '100';
        inp.value = String(Math.round(obj[key] * 100));
        const num = document.createElement('b');
        num.textContent = inp.value + '%';
        inp.oninput = () => {
          obj[key] = Number(inp.value) / 100;
          num.textContent = inp.value + '%';
          LD.Settings.flush();
          if (after) after();
        };
        wrap.appendChild(inp); wrap.appendChild(num);
        row.appendChild(wrap);
        sec2.appendChild(row);
      };
      mkSlider('music.volume', S.data.music, 'volume', () => LD.Music.setVolume(S.data.music.volume));
      mkSlider('music.sfxVolume', S.data.sfx, 'volume', () => LD.Sfx.setVolume(S.data.sfx.volume));

      // 开关按钮
      const rowSw = document.createElement('div');
      rowSw.className = 'set-row';
      rowSw.innerHTML = `<div class="set-label">${T_('music.title')}</div>`;
      const sw = document.createElement('div');
      sw.className = 'lang-btns';
      const bm = document.createElement('button');
      bm.className = 'sm' + (S.data.music.on ? ' on' : '');
      bm.textContent = S.data.music.on ? T_('music.on') : T_('music.off');
      bm.onclick = () => { S.data.music.on = !S.data.music.on; S.flush(); LD.Music.sync(S.data); this.updateAudioButtons(); this.buildSettings(); };
      const bs = document.createElement('button');
      bs.className = 'sm' + (S.data.sfx.on ? ' on' : '');
      bs.textContent = S.data.sfx.on ? '🔊 SFX ON' : '🔇 SFX OFF';
      bs.onclick = () => { S.data.sfx.on = !S.data.sfx.on; S.flush(); LD.Sfx.setMuted(!S.data.sfx.on); this.updateAudioButtons(); this.buildSettings(); };
      sw.appendChild(bm); sw.appendChild(bs);
      rowSw.appendChild(sw);
      sec2.appendChild(rowSw);
      body.appendChild(sec2);

      /* 3) 语言 */
      const sec3 = document.createElement('div');
      sec3.className = 'set-sec';
      const h3 = document.createElement('div');
      h3.className = 'sec-title';
      h3.textContent = T_('settings.langTitle');
      sec3.appendChild(h3);
      const rowL = document.createElement('div');
      rowL.className = 'set-row';
      const lb = document.createElement('div');
      lb.className = 'lang-btns';
      [['zh', '简体中文'], ['zh-TW', '繁體中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어'], ['es', 'Español']].forEach(([code, name]) => {
        const b = document.createElement('button');
        b.className = 'sm' + (S.data.lang === code ? ' on' : '');
        b.textContent = name;
        b.onclick = () => this.setLang(code);
        lb.appendChild(b);
      });
      rowL.appendChild(lb);
      sec3.appendChild(rowL);
      body.appendChild(sec3);
    }

    setLang(code) {
      this.settings.lang = (LD.I18N.langs && LD.I18N.langs[code]) ? code : 'zh';
      LD.Settings.flush();
      LD.I18N.set(this.settings.lang);
      LD.Sfx.ui();
      if (this.state === 'settings') this.buildSettings();
    }

    /* ---------- 语言切换后刷新所有动态文本 ---------- */
    refreshText() {
      LD.I18N.apply();
      this.refreshMenu();
      this.updateHUD();
      this.buildSelect();
      this.updateAudioButtons();
      this.refreshEndless();
      this.refreshCoop();
      this.buildCoopSelect();
      this.refreshGun();
      this.buildGunSelect();
      if (this.state === 'settings') this.buildSettings();
      if (this.state === 'won') {
        if (this.winKind === 'gun') {
          const last = this.gunStage >= LD.Guns.TOTAL_GUN_LEVELS;
          $('win-title').textContent = last ? T_('gun.winAll') : T_('gun.win', { n: this.gunStage });
          $('win-tip').textContent = last ? T_('gun.winAllTip') : T_('gun.winTip');
          $('btn-next').textContent = last ? T_('gun.home') : T_('win.next') + ' →';
        } else {
          const key = this.index + 1;
          $('win-title').textContent = key >= 100 ? T_('win.titleAll') : T_('win.title', { n: key });
          $('win-tip').textContent = key >= 100 ? T_('win.tipAll') : (key === 1 ? T_('win.tip1') : T_('win.tipOther'));
        }
      }
      if (this.state === 'duelOver') this._duelOver();
      // 房间大厅 / 对局 HUD 里的动态文案也要跟着换语言
      if (LD.RoomPlay) LD.RoomPlay.refreshText(this);
    }

    /* ---------- 作弊权限 ----------
       旧版口令（K12345678 哈希校验）已废弃：作弊权限改由云端账号体系控制。
       · 关卡模式（单机闯关）：只有至高账号 kaobei（role='admin'）能开作弊；
       · 联机房间对局：权限由房主的「房主设置（模仿我的世界）」决定（见 _cheatGate）。 */
    _cheatAllowed() { return !!(LD.Cloud && LD.Cloud.isAdmin && LD.Cloud.isAdmin()); }
    _cheatGate() {
      /* 房间对局里：权限由房主的「房主设置（模仿我的世界）」决定 ——
         房主看「允许自己作弊」，房客看「允许他人作弊」；至高账号 kaobei 不受限。 */
      if (this.roomOn) {
        const rp = LD.RoomPlay;
        if (rp && rp.roomCheatAllowed && rp.roomCheatAllowed(this)) { this.toggleCheat(); return; }
        this.flash(T_('cheat.hostNoPerm'), 2200);
        LD.Sfx.die();
        return;
      }
      if (this._cheatAllowed()) { this.toggleCheat(); return; }
      this.flash(T_('cheat.noPerm'), 2200);
      LD.Sfx.die();
    }
    /* 顶栏 🔒 / 作弊键显隐 + 主页按键说明 + 暂停菜单「用户管理」跟随权限 */
    syncCheatUI() {
      const ok = this._cheatAllowed();
      const btn = $('btn-cheat');
      if (btn) {
        btn.classList.toggle('hidden', !ok);
        btn.title = ok ? '作弊模式（至高账号 kaobei 专属）' : '';
      }
      const adm = $('btn-admin');
      if (adm) adm.classList.toggle('hidden', !(LD.Cloud && LD.Cloud.isAdmin()));
      /* 主页「管理」按键：kaobei（至高账号）登录后直接出现在主页菜单里，可管理全部注册账号 */
      const admMain = $('btn-admin-main');
      if (admMain) admMain.classList.toggle('hidden', !(LD.Cloud && LD.Cloud.isAdmin()));
      /* 账号按钮顺便亮出当前登录名（kaobei 👑），一眼确认自己在管理身份里 */
      const acc = $('btn-account');
      if (acc && LD.Cloud) {
        const u = LD.Cloud.user();
        acc.textContent = u ? `👤 ${u}${LD.Cloud.isAdmin() ? ' 👑' : ''}` : T_('menu.account');
      }
      if (this.state === 'menu') this.refreshMenu();
    }

    updateAudioButtons() {
      const m = this.settings.music;
      const bm = $('btn-music');
      bm.textContent = m.on && m.track !== 'none' ? '🎵' : '🎵';
      bm.style.opacity = m.on && m.track !== 'none' ? '1' : '.35';
      $('btn-mute').textContent = this.settings.sfx.on ? '🔊' : '🔇';
      $('btn-lang').textContent = ({ zh: '中', en: 'EN', ja: '日', ko: '한', es: 'ES', 'zh-TW': '繁' })[LD.I18N.lang] || '中';
    }

    toggleMute() {
      const s = this.settings.sfx;
      s.on = !s.on;
      LD.Settings.flush();
      LD.Sfx.setMuted(!s.on);
      this.updateAudioButtons();
      if (this.state === 'settings') this.buildSettings();
    }

    toggleMusic() {
      const m = this.settings.music;
      if (m.on && m.track !== 'none') {
        m.on = false;
      } else {
        m.on = true;
        if (m.track === 'none') m.track = 'neon';
      }
      LD.Settings.flush();
      LD.Music.sync(this.settings);
      this.updateAudioButtons();
      if (this.state === 'settings') this.buildSettings();
    }

    /* ---------- 解锁所有关卡（密码 K12345678） ----------
       普通 100 关 / 双人 30 关 / 枪战 150 关 是三套独立进度，用同一套方法 + 同一套 DOM 结构，
       靠 scope（'level' | 'coop' | 'gun'）区分：
         'level' → id 前缀 unlock-*      存档字段 save
         'coop'  → id 前缀 coop-unlock-* 存档字段 save.coop
         'gun'   → id 前缀 gun-unlock-*  存档字段 save.gun（解锁的不只是关卡，还有枪械） */
    _unlockScope(scope) {
      return scope === 'coop' ? 'coop' : (scope === 'gun' ? 'gun' : 'level');
    }

    unlockEls(scope) {
      const sc = this._unlockScope(scope);
      const p = sc === 'coop' ? 'coop-unlock' : (sc === 'gun' ? 'gun-unlock' : 'unlock');
      return { form: $(p + '-form'), pw: $(p + '-pw'), msg: $(p + '-msg'), btn: $('btn-' + p + '-all') };
    }

    unlockInfo(scope) {
      const sc = this._unlockScope(scope);
      if (sc === 'coop') return { save: this.save.coop, max: LD.COOP_COUNT, key: 'coop' };
      if (sc === 'gun') return { save: this.save.gun, max: LD.Guns.TOTAL_GUN_LEVELS, key: 'gun' };
      return { save: this.save, max: 100, key: 'level' };
    }

    resetUnlockUI(scope) {
      const e = this.unlockEls(scope || 'level');
      if (e.form) e.form.classList.add('hidden');
      if (e.pw) e.pw.value = '';
      if (e.msg) e.msg.textContent = '';
    }

    tryUnlock(scope) {
      const sc = this._unlockScope(scope);
      const e = this.unlockEls(sc);
      const { save, max } = this.unlockInfo(sc);
      const msg = e.msg;
      const pw = (e.pw.value || '').trim();
      const done = T_('select.unlockDone');
      /* 枪械解锁码只有至高账号能用（普通玩家要自己打关解锁） */
      if (sc === 'gun' && !(LD.Cloud && LD.Cloud.isAdmin())) {
        if (msg) msg.textContent = T_('gun.unlockAdminOnly');
        LD.Sfx.die();
        return false;
      }
      if (save.unlocked >= max) { if (msg) msg.textContent = done; return false; }
      // 口令走加盐 SHA-256 校验（js/secret.js），源码里没有明文密码
      if (LD.Secret && LD.Secret.check(pw)) {
        save.unlocked = max;
        if (sc === 'gun') save.unlockedAll = true;
        LD.Save.flush();
        this.resetUnlockUI(sc);
        if (msg) msg.textContent = T_(sc === 'level' ? 'select.unlockOk' : sc + '.unlockOk');
        LD.Sfx.cheat();
        if (sc === 'coop') this.buildCoopSelect();
        else if (sc === 'gun') { this.buildGunSelect(); this.refreshGun(); }
        else { this.buildSelect(); this.refreshMenu(); }
        return true;
      }
      if (msg) msg.textContent = T_(sc === 'level' ? 'select.unlockBad' : sc + '.unlockBad');
      LD.Sfx.die();
      return false;
    }

    /* 点「解锁所有关卡」：展开 / 收起密码表单 */
    toggleUnlockForm(scope) {
      const sc = this._unlockScope(scope);
      const e = this.unlockEls(sc);
      const { save, max } = this.unlockInfo(sc);
      if (!e.form) return;
      if (save.unlocked >= max) { if (e.msg) e.msg.textContent = T_('select.unlockDone'); return; }
      if (e.form.classList.contains('hidden')) {
        e.form.classList.remove('hidden');
        if (e.msg) e.msg.textContent = T_(sc === 'level' ? 'select.unlockAsk' : sc + '.unlockAsk');
        e.pw.value = '';
        if (e.pw.focus) e.pw.focus();
      } else {
        this.resetUnlockUI(sc);
      }
    }

    /* ---------- 关卡选择 ---------- */
    buildSelect() {
      const grid = $('select-grid');
      if (!grid) return;
      const s = this.save;
      let done = 0;
      for (const k in s.cleared) done++;
      $('select-stat').innerHTML =
        `<span>${T_('select.cleared')} <b>${done}/100</b></span>` +
        `<span>${T_('select.totalDeaths')} <b>${s.totalDeaths}</b></span>` +
        `<span>${T_('select.cheatUsed')} <b>${s.cheatUsed ? T_('select.yes') : T_('select.no')}</b></span>`;
      grid.innerHTML = '';
      for (let i = 1; i <= 100; i++) {
        const b = document.createElement('div');
        const unlocked = i <= s.unlocked;
        const cur = this.mode === 'level' && i === this.index + 1;
        b.className = 'lv' + (s.cleared[i] ? ' done' : '') + (unlocked ? '' : ' lock') + (cur ? ' cur' : '');
        b.textContent = i;
        b.title = unlocked
          ? (s.best[i] ? T_('select.best', { t: s.best[i].toFixed(2) + 's' }) : T_('select.notCleared'))
          : T_('select.locked');
        if (unlocked) b.onclick = () => { this.startAt(i - 1); };
        grid.appendChild(b);
      }
      const cur = grid.children[this.index];
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'center' });
    }

    /* 绑定一个按钮的 onclick。缺元素时只跳过这一个（$ 会返回空壳并警告），
       绝不抛错 —— bindUI() 是在构造函数里同步跑的，一旦抛错，
       后面几十个按钮全部绑不上、构造函数也中断，页面直接白屏。 */
    _on(id, fn) {
      const el = $(id);
      if (!el || el.__missing) return null;
      el.onclick = fn;
      return el;
    }

    bindUI() {
      this._on('btn-play', () => this.startPrimary());
      this._on('btn-open-select', () => this.openSelect());
      this._on('btn-endless', () => this.openEndless());
      this._on('btn-coop', () => this.openCoop());
      this._on('btn-coop-play', () => this.startCoop(this.coopStage));
      this._on('btn-coop-home', () => this.goHome());

      /* ---------- 联机模式（多人房间：2~8 人 / 散打 / 皮肤，见 roomplay.js） ---------- */
      this._on('btn-online', () => this.openOnline());
      this._on('btn-net-host', () => LD.RoomPlay.createHost(this, 'peer'));
      this._on('btn-net-join', () => LD.RoomPlay.joinPanel(this));
      this._on('btn-net-bc', () => LD.RoomPlay.createHost(this, 'bc'));
      this._on('btn-net-join-go', () => LD.RoomPlay.joinGo(this));
      this._on('btn-net-home', () => this.goHome());
      /* ---------- 作弊（顶栏 🔒，权限化：无权限者按钮隐藏） ---------- */
      this._on('btn-cheat', () => this._cheatGate());
      this._on('btn-admin', () => this.openAdmin());
      this._on('btn-admin-main', () => this.openAdmin());
      this._on('btn-admin-refresh', () => this._adminBuild());
      this._on('btn-admin-back', () => this._backFromAdmin());

      /* ---------- 枪战模式 ---------- */
      this._on('btn-gun', () => this.openGun());
      this._on('btn-gun-campaign', () => this.startGunLevel(this.gunStage));
      this._on('btn-gun-endless', () => this.startGunEndless());
      this._on('btn-gun-duel', () => this.startGunDuel());
      this._on('btn-gun-training', () => this.startGunTraining());
      this._on('btn-gun-home', () => this.goHome());
      this._on('btn-duel-again', () => this.startGunDuel());
      this._on('btn-duel-home', () => this.goHome());
      this._on('btn-endless-play', () => this.startEndless());
      /* 「再来一局」按钮被普通无尽和枪战无尽共用（都打开 ov-endless-over）。
         必须按「当前是哪种无尽」路由：枪战无尽重开要回枪战无尽，而不是跳到普通跑酷无尽。
         之前这里写死 startEndless()，导致枪战无尽死掉后点「再来一局」会莫名变成跑酷无尽。 */
      this._on('btn-endless-again', () => this._endlessAgain());
      this._on('btn-endless-home', () => this.goHome());
      this._on('btn-endless-over-home', () => this.goHome());
      this._on('btn-settings', () => this.openSettings());
      this._on('btn-account', () => this.openAccount());
      this._on('btn-acc-home', () => this.goHome());
      this._on('btn-acc-login', () => this._accSubmit('login'));
      this._on('btn-acc-reg', () => this._accSubmit('register'));
      this._on('btn-acc-up', () => this._accUpload());
      this._on('btn-acc-down', () => this._accDownload());
      this._on('btn-acc-logout', () => this._accLogout());
      // 密码框回车 = 登录
      const accPw = $('acc-pw');
      if (accPw) accPw.onkeydown = (e) => { if (e.key === 'Enter') this._accSubmit('login'); };
      this._on('btn-select', () => this.openSelect());
      this._on('btn-restart', () => this.restart());
      this._on('btn-pause', () => (this.state === 'paused' ? this.resume() : this.pause()));
      this._on('btn-home', () => this.goHome());
      this._on('btn-music', () => this.toggleMusic());
      this._on('btn-mute', () => this.toggleMute());
      this._on('btn-lang', () => this.setLang(LD.I18N.lang === 'en' ? 'zh' : 'en'));
      this._on('btn-resume', () => this.resume());
      this._on('btn-pause-settings', () => this.openSettingsFromPause());
      this._on('btn-pause-restart', () => this.restart());
      this._on('btn-pause-select', () => this.openSelect());
      this._on('btn-pause-home', () => this.goHome());
      this._on('btn-select-close', () => { this.state = 'playing'; this.closeAll(); this.last = performance.now(); });
      this._on('btn-select-home', () => this.goHome());
      this._on('btn-settings-close', () => (this._settingsFromPause ? this._backFromSettings() : this.goHome()));
      this._on('btn-settings-reset', () => {
        LD.Settings.reset();
        this.settings = LD.Settings.data;
        LD.Sfx.setVolume(this.settings.sfx.volume);
        LD.Sfx.setMuted(!this.settings.sfx.on);
        LD.Music.sync(this.settings);
        LD.I18N.set(this.settings.lang);
        this.buildSettings();
        this.refreshMenu();
        this.updateAudioButtons();
        this.flash(T_('settings.resetOk'));
      });
      this._on('btn-win-restart', () => this.restart());
      this._on('btn-win-home', () => this.goHome());
      this._on('btn-next', () => this.nextLevel());
      this._on('btn-fail-retry', () => {
        if (this.roomOn) LD.RoomPlay.restart(this);
        else this.startCoop(this.coopStage);
      });
      this._on('btn-fail-home', () => this.goHome());

      /* ---------- 解锁所有关卡（密码 K12345678）：普通 100 关 + 双人 30 关 + 枪战 150 关 ---------- */
      for (const sc of ['level', 'coop', 'gun']) {
        const e = this.unlockEls(sc);
        if (e.btn) e.btn.onclick = () => this.toggleUnlockForm(sc);
        if (e.pw) {
          e.pw.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); this.tryUnlock(sc); }
            else if (ev.key === 'Escape') { ev.preventDefault(); this.resetUnlockUI(sc); }
          });
        }
      }
      this._on('btn-unlock-ok', () => this.tryUnlock('level'));
      this._on('btn-unlock-cancel', () => this.resetUnlockUI('level'));
      this._on('btn-coop-unlock-ok', () => this.tryUnlock('coop'));
      this._on('btn-coop-unlock-cancel', () => this.resetUnlockUI('coop'));
      this._on('btn-gun-unlock-ok', () => this.tryUnlock('gun'));
      this._on('btn-gun-unlock-cancel', () => this.resetUnlockUI('gun'));

      this._on('btn-reset', () => {
        if (confirm(T_('select.resetConfirm'))) this.resetProgress();
      });

      /* URL 里带 #bc=<频道> → 本机多窗联机的第二个窗口：自动以房客身份进房。
         房主点「加一位玩家」时会 window.open 带上这个 hash。 */
      const bcMatch = /bc=([\w-]+)/.exec(location.hash || '');
      if (bcMatch && LD.RoomPlay) LD.RoomPlay.bcAutoJoin(this, bcMatch[1]);
      // 带 #room=<房间号> 的链接：打开就直接进房（跨设备也走这个）
      const roomMatch = /room=([\w-]+)/.exec(location.hash || '');
      if (roomMatch && LD.RoomPlay) LD.RoomPlay.roomAutoJoin(this, roomMatch[1]);
    }

    /* 本机双窗：新房客自动加入（不等用户点任何按钮） */
    _bcJoinAuto(chan) {
      try {
        this.net = LD.Net.guest({
          bc: 'kbnet-' + chan,
          onMsg: (m) => this._netMsg(m),
          onOpen: () => { $('net-status').textContent = T_('online.waitHost'); },
          onClose: () => this.netPeerLeft(),
        });
        this.netRole = 'guest';
        this.net.send({ t: 'hello' });
        this.state = 'onlineMenu';
        this.open('ov-online');
        $('online-menu').style.display = 'none';
        $('net-guest-panel').classList.remove('hidden');
        $('net-status').textContent = T_('online.waitHost');
      } catch (e) {
        console.warn('[net] BroadcastChannel 不可用：', e);
      }
    }

    /* 重置进度：存档回到初始值，同时把「内存里的进度指针」一起收回。
       之前只重置了 save，this.index / this.coopStage 还停在上一次玩到的那一关，
       于是双人页会出现「进度已清零，但光标还在第 N 关而且能直接开打」。
       顺带把无尽模式的本局临时数据也清掉，免得刚重置完就弹出上一局的结算。 */
    resetProgress() {
      LD.Save.reset();
      this.save = LD.Save.data;
      this.mode = 'level';
      this.index = 0;
      this.coopStage = 1;
      this.coopDeaths = { red: 0, blue: 0 };
      this.coopResult = null;
      this.esScore = 0; this.esDist = 0; this.esMilestone = 0; this._esLast = null;
      /* 枪战模式的进度指针也一并收回，否则会出现和双人模式一样的问题：
         存档清零了，但 gunStage 还停在上次打到的那一关，`gunCap()` 又只看存档，
         于是枪战页的光标落在第 N 关、而且枪械还是全解锁的。 */
      this.gunStage = 1;
      this.gunMode = 'level';
      this.gunChunk = 1; this.gunDist = 0; this.gunScore = 0; this.gunKills = 0; this.gunWave = 0;
      this.bots = []; this.bullets = []; this.blasts = []; this.drones = []; this.droneView = null;
      this._gunRespawnT = 0; this._gunLast = null; this._esLast = null;
      this.duelP1 = 0; this.duelP2 = 0; this.duelRound = 1; this.duelState = 'fight'; this._duelLast = null;
      this.cheat = false;
      if ($('cheat-badge')) $('cheat-badge').classList.remove('on');
      this.levelDeaths = 0;
      this.loadLevel(0, true);
      this.resetUnlockUI('level');
      this.resetUnlockUI('coop');
      this.resetUnlockUI('gun');
      this.buildSelect();
      this.refreshMenu();
      this.refreshEndless();
      this.refreshCoop();
      this.buildCoopSelect();
      this.buildGunSelect();
      this.refreshGun();
      this.flash(T_('select.resetDone'));
      return this.save;
    }
  }

  window.addEventListener('load', () => { window.GAME = new Game(); });
})();
