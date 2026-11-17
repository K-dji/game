/* roomplay.js — 多人联机房间（2~8 人）：房主选模式（合作闯关 / 散打）、临时昵称、自定义皮肤
   传输层在 js/netroom.js（BroadcastChannel 多窗 / WebRTC 星形多席位），
   皮肤数据在 js/skins.js。本文件只管「房间 → 对局」的全部流程：

     大厅 ov-lobby    名单 / 模式 / 关卡 / 加人 / 开始
     形象 ov-style    临时昵称 + 预设皮肤 + 自定义配色（只存内存，离开房间即失效）
     对局             mode='coop' 复用双人房间 / 门 / 倒计时；散打复用同一张图但关门
     结算 ov-room-over 散打排行 / 合作后回到大厅再来一局

   同步模型：
     · 每个客户端 20Hz 广播自己的小人状态（位置 / 朝向 / 死亡 / 到门），其他人插值跟随
     · 房主权威：通关判定 / 倒计时 / 散打的血量与计分都由房主结算后广播
     · 散打出拳：出拳者上报一拳，房主按所有人最新位置判定命中，再广播伤害与击倒
*/
(function () {
  const $ = (id) => document.getElementById(id);
  const T_ = (k, p) => LD.I18N.t(k, p);
  const clamp = LD.clamp;
  const MAXP = 8;
  const BRAWL = {
    hp: 100, dmg: 25, punchCd: 0.4, punchT: 0.18,
    range: 48, vOverlap: 30, ko: 5, respawn: 1.4, lastByWin: 6,
  };
  const TIMES = [60, 90, 120, 180];  // 兼容保留（散打时长暂定 90 秒）
  const GUNCFG = { protect: 3, respawn: 2.2 };        // 枪战：3 秒出生保护 / 2.2s 复活
  const ROUND_TOTAL = 5;                               // 闯关：5 关一回合
  const ROUND_PTS = [5, 3, 2, 1, 1, 1, 1, 1];          // 每关按名次积分

  /* ---------- 大厅地图：蛋仔派对式的小广场，开局后大家在里面走 ---------- */
  function lobbyLevel() {
    const COLS = 40, ROWS = LD.ROWS, FLOOR = ROWS - 2;
    const G = [];
    for (let r = 0; r < ROWS; r++) G.push(new Array(COLS).fill('.'));
    for (let c = 0; c < COLS; c++) { G[FLOOR][c] = '#'; G[FLOOR + 1][c] = '#'; }
    for (let c = 4; c <= 9; c++) G[FLOOR - 3][c] = '=';
    for (let c = 15; c <= 21; c++) G[FLOOR - 5][c] = '=';
    for (let c = 28; c <= 34; c++) G[FLOOR - 3][c] = '=';
    G[FLOOR - 1][12] = '#'; G[FLOOR - 2][12] = '#';
    G[FLOOR - 1][25] = '#'; G[FLOOR - 2][25] = '#';
    G[FLOOR - 1][2] = 'P';
    return {
      id: 'lobby', name: '联机大厅', nameEn: 'Online Lobby',
      cols: COLS, rows: ROWS, grid: G.map((r) => r.join('')),
      noDoor: true, lobby: true, tint: ['#151027', '#241a3e'],
    };
  }

  /* ---------- 超长闯关图：把 3 张合作房间横向拼起来（段间打通，终点门在最后一段） ---------- */
  function longLevel(stage) {
    const parts = 3;
    const segs = [];
    for (let k = 0; k < parts; k++) {
      const n = clamp(stage * 3 + k, 1, LD.COOP_COUNT);
      segs.push(LD.genCoop(n));
    }
    const ROWS = LD.ROWS, W = segs[0].cols;
    const rows = [];
    for (let r = 0; r < ROWS; r++) {
      let line = '';
      segs.forEach((lv, si) => {
        let s = lv.grid[r] || '';
        if (si < parts - 1) s = s.replace(/[Dd]/g, '.');            // 中间段不设门
        if (si > 0) s = s.replace(/[Pp]/g, '.');                    // 出生点只在最前
        line += s;
      });
      rows.push(line);
    }
    // 每个接缝纵向打通一条通道（地面两行保留）
    for (let k = 1; k < parts; k++) {
      const x = k * W;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= rows[0].length) continue;
        for (let r = 1; r < ROWS - 2; r++) {
          const row = rows[r].split('');
          if (row[xx] === '#') row[xx] = '.';
          rows[r] = row.join('');
        }
      }
    }
    return {
      id: 'long' + stage, name: (segs[0].name || '合作') + ' · 长途', nameEn: (segs[0].nameEn || 'Co-op') + ' Long',
      cols: W * parts, rows: ROWS, grid: rows,
      coop: stage, timeLimit: 90 + stage * 20, scoreBase: 100 + stage * 30,
      tint: segs[0].tint, long: true,
    };
  }

  const isHost = (g) => !!(g.room && g.room.isHost());
  const myId = (g) => (g.room ? g.room.myId() : 'me');
  const meEntry = (g) => (g.roomRoster || []).find((r) => r.id === myId(g)) || null;
  const mySlot = (g) => (g.room && g.room.slot != null ? g.room.slot : 0);
  const playerBySlot = (g, slot) => (g.players || []).find((p) => p.roomSlot === slot) || null;
  const entryBySlot = (g, slot) => (g.roomRoster || []).find((r) => r.slot === slot) || null;

  function status(g, text) { const el = $('room-status'); if (el) el.textContent = text || ''; }
  function flash(g, text, ms) { if (g.flash) g.flash(text, ms); }

  /* ---------- 默认形象：随机昵称 + 随机预设 ---------- */
  function makeProfile() {
    const p = LD.Skins.presets[Math.floor(Math.random() * LD.Skins.presets.length)];
    return { name: LD.Skins.randomName(), skin: { id: p.id, body: p.body, horn: p.horn } };
  }

  /* 网络上只传必要字段：临时昵称 + 三元组皮肤 */
  function packProfile(p) {
    return { name: (p && p.name) || LD.Skins.randomName(), skin: (p && p.skin) || null };
  }

  /* ---------- 房主设置（模仿我的世界正版玩家设置） ----------
     self      允许自己作弊（房主本人可开关个人作弊）
     others    允许他人作弊（所有房客都可开关个人作弊）
     invincible 全员无敌（开局直接生效，不用按键）
     fly       全员飞行（开局直接生效，按住跳跃键上升 / 下蹲键速降）
     speed     全员移速加成（1 / 1.3 / 1.6 倍）
     配置挂在 roomCfg.cheats 上，随 cfg 广播同步给所有房客。 */
  function defaultCheats() {
    return { self: false, others: false, invincible: false, fly: false, speed: 1 };
  }
  function normCheats(cfg) {
    const c = cfg && cfg.cheats;
    const d = defaultCheats();
    if (!c || typeof c !== 'object') return d;
    const sp = Number(c.speed);
    return {
      self: !!c.self, others: !!c.others, invincible: !!c.invincible, fly: !!c.fly,
      speed: (sp === 1.3 || sp === 1.6) ? sp : 1,
    };
  }

  /* ================= 对外入口 ================= */
  const RoomPlay = {
    openOnline(g) {
      /* 蛋仔派对式：点「联机」直接建房进大厅 —— 模式 / 加人 / 准备 / 开始
         全部在大厅里点（见 ov-lobby）。旧的控制面板只在出错时出现。 */
      this.createHost(g, 'peer');
    },

    /* 旧控制面板（创建 / 加入 / 本机双窗）：出错兜底用 */
    openOnlinePanel(g) {
      this.cleanup(g);
      g.state = 'onlineMenu';
      $('online-menu').style.display = '';
      const gp = $('net-guest-panel');
      if (gp) gp.classList.add('hidden');
      const st = $('net-status');
      if (st) st.textContent = '';
      const ci = $('net-code-in');
      if (ci) ci.value = '';
      g.open('ov-online');
    },

    /* ---------- 建房（房主）：创建后直接进大厅（场景里可以走动），房主在大厅选模式 ---------- */
    createHost(g, kind) {
      this.cleanup(g);
      if (!g.roomProfile) g.roomProfile = makeProfile();
      g.roomCfg = { mode: 'coop', stage: 1, goal: { type: 'kills', v: 15 }, cheats: defaultCheats() };
      g.roundPts = {};
      try {
        g.room = LD.NetRoom.create({
          role: 'host',
          kind: kind === 'bc' ? 'bc' : 'peer',
          chan: kind === 'bc' ? LD.NetRoom.channel() : LD.NetRoom.newCode(),
          profile: packProfile(g.roomProfile),
          maxPlayers: MAXP,
          onRoster: (r) => {
            g.roomRoster = r;
            if (g.roomInLobby) this.refreshLobby(g);
            // 大厅场景里有人进出 → 重建广场（新玩家的小人走进来）
            if (g.roomMode === 'lobby') this.startLobbyScene(g);
            // 有人进房就把本局模式广播给他（大厅里只读，配置来自房主主页）
            if (isHost(g)) this.cfgChanged(g);
          },
          onMsg: (m, from) => this.msg(g, m, from),
          onReady: () => this.openLobby(g),
          onPeerGone: (id) => this.peerGone(g, id),
          onHostGone: () => this.hostGone(g),
          onFail: (t) => this.roomFail(g, t),
          onCodeChange: () => { if (g.roomInLobby) this.refreshLobby(g); },
        });
        g.roomKind = kind === 'bc' ? 'bc' : 'peer';
        if (kind === 'bc') this.openLobby(g);
        else flash(g, T_('online.creating'), 1800);
      } catch (e) {
        console.warn('[room] create failed:', e);
        this.cleanup(g);
        flash(g, T_('online.connFail'), 2200);
        this.openOnlinePanel(g);
      }
    },

    /* ---------- 加人：把房间链接复制给好友（本机多窗直接开新窗口） ---------- */
    addSlot(g) {
      if (!g.room || !isHost(g)) return;
      if (g.roomKind === 'bc') {
        const chan = g.room.chan;
        const url = location.href.split('#')[0] + '#bc=' + chan;
        const w = window.open(url, 'kbroom-' + chan, 'width=1020,height=760');
        if (!w) {
          try { navigator.clipboard && navigator.clipboard.writeText(url); } catch (e) {}
          flash(g, T_('room.linkCopied'), 2400);
        }
        return;
      }
      this.copyRoomLink(g);
    },

    copyRoomLink(g) {
      if (!g.room) return;
      const base = location.href.split('#')[0];
      const url = base + (g.roomKind === 'bc' ? '#bc=' : '#room=') + g.room.chan;
      const done = () => flash(g, T_('room.linkCopied'), 1800);
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done).catch(done);
      else done();
    },

    /* ---------- 房客：输入 5 位房间号 ---------- */
    joinPanel(g) {
      this.cleanup(g);
      $('online-menu').style.display = 'none';
      const gp = $('net-guest-panel');
      if (gp) gp.classList.remove('hidden');
      const st = $('net-status');
      if (st) st.textContent = '';
      const ci = $('net-code-in');
      if (ci) setTimeout(() => ci.focus(), 50);
    },

    guestRoom(g, code) {
      if (!g.roomProfile) g.roomProfile = makeProfile();
      g.room = LD.NetRoom.create({
        role: 'guest', kind: 'peer',
        chan: String(code).trim().toUpperCase(),
        profile: packProfile(g.roomProfile),
        onRoster: (r) => { g.roomRoster = r; if (g.roomInLobby) this.refreshLobby(g); },
        onMsg: (m, from) => this.msg(g, m, from),
        onReady: () => this.openLobby(g),
        onHostGone: () => this.hostGone(g),
        onFail: (t) => this.roomFail(g, t),
      });
      g.roomKind = 'peer';
    },

    async joinGo(g) {
      const code = ($('net-code-in') || {}).value || '';
      const st = $('net-status');
      if (!String(code).trim()) { if (st) st.textContent = T_('room.notFound'); return; }
      try {
        if (st) st.textContent = T_('online.creating');
        this.guestRoom(g, code);
        this.openLobby(g);
        flash(g, T_('room.waitHost'), 2200);
      } catch (e) {
        console.warn('[room] join failed:', e);
        this.cleanup(g);
        if (st) st.textContent = T_('online.connFail');
      }
    },

    /* URL 带 #room=<房间号> → 打开链接直接进房 */
    roomAutoJoin(g, code) {
      this.cleanup(g);
      try {
        this.guestRoom(g, code);
        this.openLobby(g);
        flash(g, T_('room.waitHost'), 2200);
      } catch (e) {
        console.warn('[room] link join failed:', e);
        this.openOnlinePanel(g);
      }
    },

    /* 信令 / 房间错误提示 */
    roomFail(g, t) {
      this.cleanup(g);
      const key = t === 'notfound' ? 'room.notFound' : t === 'full' ? 'room.full' : 'online.connFail';
      flash(g, T_(key), 2600);
      this.openOnlinePanel(g);
    },

    /* ---------- 本机多窗：新窗口自动进房（URL 带 #bc=<频道>） ---------- */
    bcAutoJoin(g, chan) {
      this.cleanup(g);
      if (!g.roomProfile) g.roomProfile = makeProfile();
      try {
        g.room = LD.NetRoom.create({
          role: 'guest', kind: 'bc', chan,
          profile: packProfile(g.roomProfile),
          onRoster: (r) => { g.roomRoster = r; if (g.roomInLobby) this.refreshLobby(g); },
          onMsg: (m, from) => this.msg(g, m, from),
          onReady: () => this.openLobby(g),
          onHostGone: () => this.hostGone(g),
        });
        this.openLobby(g);
        flash(g, T_('room.waitHost'), 2200);
      } catch (e) {
        console.warn('[room] BroadcastChannel 不可用：', e);
      }
    },

    /* ---------- 大厅：蛋仔派对式 —— 背后是可走动的大厅场景，面板浮在上面 ---------- */
    openLobby(g) {
      g.roomInLobby = true;
      if (g.roomOn && g.roomMode !== 'lobby') this.exitMatch(g, true);
      this.startLobbyScene(g);
      g.open('ov-lobby');
      this.refreshLobby(g);
    },

    /* 大厅场景：所有人在同一张小广场图里走动（复用对局的状态同步） */
    startLobbyScene(g) {
      if (!g.roomRoster || !g.roomRoster.length) return;
      g.roomInLobby = true;
      g.roomOn = true;                 // 复用对局通路（渲染 / 同步 / 相机），徽标也亮着
      g.roomEnded = false;
      g.roomMode = 'lobby';
      g.mode = 'coop';
      g.level = lobbyLevel();
      g.roomStage = 0;
      g.coopTimeLimit = 0; g.coopLeft = 0; g.coopState = 'lobby';
      g.roomPeers = new Map();
      g.roomReady = new Map();
      g.roomStats = {};
      for (const r of g.roomRoster) g.roomStats[r.slot] = { hp: BRAWL.hp, score: 0, deaths: 0, respawnT: 0, lastBy: -1, lastByT: -99 };
      this.buildWorld(g);
      g.state = 'playing';             // 场景在 ov-lobby 浮层下面跑起来
      g.confirmLock = 0.3;
      g.last = performance.now();
      LD.Music.sync(g.settings);
      this.hud(g, true);
    },

    refreshLobby(g) {
      const roster = g.roomRoster || [];
      const list = $('room-roster');
      if (list) {
        list.innerHTML = '';
        for (const r of roster) {
          const row = document.createElement('div');
          row.className = 'room-player' + (r.host ? ' is-host' : '');
          const sw = document.createElement('i');
          const sk = LD.Skins.resolve(r.skin);
          sw.className = 'sw';
          sw.style.background = sk.body;
          sw.style.boxShadow = '0 0 8px ' + sk.body;
          const nm = document.createElement('b');
          nm.textContent = (r.host ? '👑 ' : '') + LD.Skins.cleanName(r.name, r.slot) + (r.id === myId(g) ? T_('room.you') : '');
          row.appendChild(sw);
          row.appendChild(nm);
          // 大厅准备标记
          if (g.roomMode === 'lobby' && g.lobbyReady && g.lobbyReady.get(r.id)) {
            const ok = document.createElement('span');
            ok.className = 'score';
            ok.style.color = '#35e0a1';
            ok.textContent = '✓ ' + T_('room.readyOk');
            row.appendChild(ok);
          }
          if (g.roomOn && g.roomMode === 'brawl') {
            const st = g.roomStats[r.slot];
            if (st) {
              const sc = document.createElement('span');
              sc.className = 'score';
              sc.textContent = `${T_('room.ko')} ${st.score} · ${T_('room.deaths')} ${st.deaths}`;
              row.appendChild(sc);
            }
          }
          list.appendChild(row);
        }
        if (!roster.length) list.innerHTML = `<div class="room-empty">${T_('room.empty')}</div>`;
      }
      const who = $('room-who');
      if (who) who.textContent = isHost(g) ? T_('room.hostYou') : T_('room.guestYou', { n: mySlot(g) + 1 });
      const cnt = $('room-count');
      if (cnt) cnt.textContent = `${roster.length}/${MAXP}`;

      const hostCard = $('room-host-card'), guestCard = $('room-guest-card');
      const host = isHost(g);
      /* 蛋仔派对式：设置面板所有玩家都看得到，房客的一律置灰（只读），
         不再是「房客只能看另一张等待卡」。 */
      if (guestCard) guestCard.classList.add('hidden');
      if (hostCard) {
        hostCard.classList.toggle('ro', !host);
        const hotip = $('room-hostonly-tip');
        if (hotip) hotip.classList.toggle('hidden', host);
      }
      // 房客不可操作的控件全部 disabled（灰按键）
      const dis = (id, d) => { const el = $(id); if (el) el.disabled = d; };
      ['btn-mode-coop', 'btn-mode-gffa', 'btn-mode-gteam', 'btn-mode-duo', 'btn-mode-endless',
        'btn-room-start', 'btn-room-add'].forEach((id) => dis(id, !host));

      /* 模式卡片选中态（所有人同步看到房主的选择） */
      const grid = $('room-mode-grid');
      if (grid) {
        for (const b of grid.querySelectorAll('.mode-card')) b.classList.remove('on');
        const cm = (g.roomCfg || {}).mode || 'coop';
        const cur = $('btn-mode-' + (cm === 'brawl' ? 'coop' : cm));
        if (cur) cur.classList.add('on');
      }
      // 闯关难度 / 枪战目标选择（房客只读显示，值随房主的 cfg 广播更新）
      const c = g.roomCfg || { mode: 'coop', stage: 1, goal: { type: 'kills', v: 15 } };
      const sf = $('room-stage-field'), gf = $('room-goal-field');
      if (sf) sf.style.display = (c.mode === 'coop' || c.mode === 'duo') ? '' : 'none';
      if (gf) gf.classList.toggle('hidden', !(c.mode === 'gffa' || c.mode === 'gteam'));
      const sel = $('room-stage');
      if (sel && (c.mode === 'coop' || c.mode === 'duo')) {
        sel.innerHTML = '';
        const n = c.mode === 'coop' ? ROUND_TOTAL : LD.COOP_COUNT;
        for (let i = 1; i <= n; i++) {
          const o = document.createElement('option');
          o.value = String(i);
          o.textContent = c.mode === 'coop'
            ? T_('room.stageN', { n: i, t: ROUND_TOTAL })
            : T_('coop.stage', { n: i });
          sel.appendChild(o);
        }
        sel.value = String(clamp(c.stage || 1, 1, n));
        if (host) sel.onchange = () => {
          g.roomCfg.stage = clamp(parseInt(sel.value, 10) || 1, 1, n);
          g.roomCfg._startLock = false;                 // 改了配置 → 全员重新准备
          g.lobbyReadyMe = false;
          this.cfgChanged(g); this.syncLobbyReady(g); this.refreshLobby(g);
        };
      }
      const gt = $('room-goal-type'), gv = $('room-goal-val');
      if (gt && gv && (c.mode === 'gffa' || c.mode === 'gteam')) {
        if (!c.goal) c.goal = { type: 'time', v: 120 };
        gt.value = c.goal.type;
        gv.innerHTML = '';
        if (c.goal.type === 'time') {
          for (const v of [60, 120, 180, 300]) {
            const o = document.createElement('option');
            o.value = String(v); o.textContent = T_('room.seconds', { n: v });
            gv.appendChild(o);
          }
        } else {
          for (const v of [5, 10, 15, 20, 30]) {
            const o = document.createElement('option');
            o.value = String(v); o.textContent = T_('room.koN', { n: v });
            gv.appendChild(o);
          }
        }
        gv.value = String(c.goal.v);
        if (host) {
          gt.onchange = () => {
            c.goal.type = gt.value;
            c.goal.v = gt.value === 'time' ? 120 : 15;
            c._startLock = false; g.lobbyReadyMe = false;
            this.cfgChanged(g); this.syncLobbyReady(g); this.refreshLobby(g);
          };
          gv.onchange = () => {
            c.goal.v = parseInt(gv.value, 10) || 120;
            c._startLock = false; g.lobbyReadyMe = false;
            this.cfgChanged(g); this.syncLobbyReady(g); this.refreshLobby(g);
          };
        }
      }
      /* ---- 房主设置（模仿我的世界）：房主可改，房客只读跟随广播 ---- */
      const rulesSec = $('room-rules');
      if (rulesSec) {
        const ch = c.cheats || (c.cheats = normCheats(c));
        const setV = (id, on) => {
          const el = $(id);
          if (!el) return;
          el.classList.toggle('on', !!on);
          const v = $(id + '-v');
          if (v) v.textContent = on ? (LD.I18N.isLatin() ? 'ON' : '开') : (LD.I18N.isLatin() ? 'OFF' : '关');
        };
        setV('rule-self', ch.self);
        setV('rule-others', ch.others);
        setV('rule-inv', ch.invincible);
        setV('rule-fly', ch.fly);
        const sp = $('rule-speed');
        if (sp) sp.value = String(ch.speed || 1);
        const apply = () => {
          c._startLock = false; g.lobbyReadyMe = false;
          this.cfgChanged(g); this.syncLobbyReady(g); this.refreshLobby(g);
        };
        if (host) {
          const tg = (key) => () => { ch[key] = !ch[key]; LD.Sfx.ui(); apply(); };
          const bSelf = $('rule-self'), bOth = $('rule-others'), bInv = $('rule-inv'), bFly = $('rule-fly');
          if (bSelf) bSelf.onclick = tg('self');
          if (bOth) bOth.onclick = tg('others');
          if (bInv) bInv.onclick = tg('invincible');
          if (bFly) bFly.onclick = tg('fly');
          if (sp) sp.onchange = () => { ch.speed = parseFloat(sp.value) || 1; LD.Sfx.ui(); apply(); };
        } else {
          // 房客只读：清掉 onclick，整块由 .ro 置灰（CSS pointer-events:none 兜底）
          ['rule-self', 'rule-others', 'rule-inv', 'rule-fly'].forEach((id) => { const el = $(id); if (el) el.onclick = null; });
          if (sp) sp.onchange = null;
        }
        rulesSec.classList.toggle('ro', !host);
      }

      const tip = $('room-mode-tip');
      if (tip) {
        const mm = (c.mode === 'brawl' ? 'coop' : c.mode);
        tip.setAttribute('data-i18n-html', 'room.mode' + mm.charAt(0).toUpperCase() + mm.slice(1) + 'Tip');
      }
      const start = $('btn-room-start');
      if (start) {
        if (!host) {
          start.textContent = T_('room.hostStarts');
        } else {
          // 全员准备才能开始（房主自己也要准备）。按钮不再置灰——
          // 点了没反应比「告诉你还差谁没准备」糟糕得多，点击时用横幅提示原因。
          const all = this.allLobbyReady(g);
          const duoOK = c.mode !== 'duo' || roster.length === 2;
          start.disabled = !duoOK;
          start.textContent = !duoOK ? T_('room.duoNeed2')
            : all ? T_('room.start')
              : T_('room.needReady', { n: this.readyCount(g), total: roster.length });
        }
      }
      const rb = $('btn-room-ready');
      if (rb) rb.textContent = g.lobbyReadyMe ? T_('room.readyCancel') : T_('room.readyGo');
      // 「加入其他房间」行：只给房主看（房客已在跟随房主）
      const jr = $('room-join-row');
      if (jr) jr.classList.toggle('hidden', !host);
      this.roomCodeTag(g);
      status(g, '');
    },

    /* 大厅里的房间号显示（房主 / 房客都能看到） */
    roomCodeTag(g) {
      const rc = $('room-code');
      if (rc && g.room) rc.textContent = g.room.chan || '—';
    },

    /* 闯关观战横幅：我已到终点，正在看另一位玩家通关 */
    specTip(g, on, other) {
      const el = $('spec-tip');
      if (!el) return;
      if (on && other) {
        const b = el.querySelector('b');
        if (b) b.textContent = other.name || '';
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    },

    /* 观战对象选择条：点谁就看谁（只列还没通关的） */
    syncSpecChips(g) {
      const box = $('spec-choose'), list = $('spec-list');
      if (!box || !list) return;
      const show = g.roomOn && (g.roomMode === 'coop' || g.roomMode === 'duo') &&
        g.roomReady.get(mySlot(g)) && g.coopState === 'run';
      box.classList.toggle('hidden', !show);
      if (!show) { list.innerHTML = ''; return; }
      list.innerHTML = '';
      for (const r of g.roomRoster || []) {
        if (r.slot === mySlot(g) || g.roomReady.get(r.slot)) continue;
        const b = document.createElement('button');
        b.textContent = LD.Skins.cleanName(r.name, r.slot);
        b.classList.toggle('on', g._spectateOf === r.slot);
        b.onclick = () => {
          g._spectateOf = r.slot;
          const tp = playerBySlot(g, r.slot);
          if (tp) this.specTip(g, true, tp);
          this.syncSpecChips(g);
          LD.Sfx.ui();
        };
        list.appendChild(b);
      }
    },

    cfgChanged(g) {
      if (!isHost(g) || !g.room) return;
      g.room.send({ t: 'cfg', cfg: g.roomCfg });
    },

    /* 对局里按作弊键有没有权限（房主设置 · 模仿我的世界）：
       房主看「允许自己作弊」，房客看「允许他人作弊」；至高账号 kaobei 始终可用。 */
    roomCheatAllowed(g) {
      if (LD.Cloud && LD.Cloud.isAdmin && LD.Cloud.isAdmin()) return true;
      const ch = normCheats(g.roomCfg);
      return isHost(g) ? !!ch.self : !!ch.others;
    },

    /* ---------- 大厅准备：房主选好模式后，全员点准备才能开始 ---------- */
    toggleReady(g) {
      if (!g.room) return;
      g.lobbyReadyMe = !g.lobbyReadyMe;
      g.room.send({ t: 'lready', on: g.lobbyReadyMe });
      if (!g.lobbyReady) g.lobbyReady = new Map();
      g.lobbyReady.set(myId(g), g.lobbyReadyMe);
      LD.Sfx.ui();
      this.refreshLobby(g);
    },
    syncLobbyReady(g) {
      if (!g.lobbyReady) g.lobbyReady = new Map();
      g.lobbyReady.clear();            // 配置一变，全员准备作废
      g.lobbyReadyMe = false;
    },
    readyCount(g) {
      let n = 0;
      for (const r of g.roomRoster || []) if (g.lobbyReady && g.lobbyReady.get(r.id)) n++;
      return n;
    },
    allLobbyReady(g) {
      const roster = g.roomRoster || [];
      if (!roster.length) return false;
      for (const r of roster) if (!g.lobbyReady || !g.lobbyReady.get(r.id)) return false;
      return true;
    },

    /* ---------- 形象面板 ---------- */
    openStyle(g) {
      const prof = g.roomProfile || (g.roomProfile = makeProfile());
      const nm = $('style-name');
      if (nm) nm.value = prof.name;
      const bd = $('style-body'), hn = $('style-horn');
      const sk = LD.Skins.resolve(prof.skin);
      if (bd) bd.value = sk.body;
      if (hn) hn.value = sk.horn;
      const grid = $('style-presets');
      if (grid) {
        grid.innerHTML = '';
        /* 普通账号 10 个预设；kaobei（至高账号）额外看到并可用 10 个专属皮肤 */
        const list = LD.Skins.visiblePresets ? LD.Skins.visiblePresets() : LD.Skins.presets;
        for (const p of list) {
          const b = document.createElement('button');
          b.className = 'skin-chip';
          b.title = LD.Skins.label({ id: p.id });
          b.innerHTML = `<i style="background:${p.body};box-shadow:inset 0 -5px 0 ${p.horn}"></i><span>${LD.Skins.label({ id: p.id })}</span>`;
          b.onclick = () => {
            if (bd) bd.value = p.body;
            if (hn) hn.value = p.horn;
            for (const c of grid.children) c.classList.remove('on');
            b.classList.add('on');
            this.preview(g, { id: p.id, body: p.body, horn: p.horn });
            LD.Sfx.ui();
          };
          grid.appendChild(b);
        }
      }
      const onPick = () => this.preview(g, { id: 'custom', body: bd ? bd.value : null, horn: hn ? hn.value : null });
      if (bd) bd.oninput = onPick;
      if (hn) hn.oninput = onPick;
      this.preview(g, prof.skin);
      g.open('ov-style');
    },

    /* 用渲染层的 player() 画一个真人大小的小样 */
    preview(g, skin) {
      const cv = $('style-preview');
      if (!cv) return;
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, cv.width, cv.height);
      const fake = {
        w: 24, h: 30, x: cv.width / 2 - 12, cx: cv.width / 2, y: cv.height - 34, vx: 0, vy: 0,
        face: 1, walk: performance.now() / 240, grounded: true, squash: 0,
        kind: 'red', alpha: 1, dead: false, fly: false, invincible: false,
        skin: LD.Skins.resolve(skin), tag: '', punchT: 0,
      };
      try { LD.Render.player(ctx, fake, g); } catch (e) { /* 渲染层改动后兜底 */ }
    },

    saveStyle(g) {
      const nm = $('style-name'), bd = $('style-body'), hn = $('style-horn');
      const slot = mySlot(g);
      const name = LD.Skins.cleanName(nm ? nm.value : '', slot);
      const skin = LD.Skins.pack({ id: 'custom', body: bd ? bd.value : null, horn: hn ? hn.value : null });
      g.roomProfile = { name, skin };
      if (g.room) g.room.setProfile(packProfile(g.roomProfile));
      // 已在对局中：直接把新形象套到自己的小人上
      const p = playerBySlot(g, slot);
      if (p) {
        p.name = name; p.tag = name;
        p.skin = LD.Skins.resolve(skin);
      }
      if (g.roomRoster) {
        const me = g.roomRoster.find((r) => r.id === myId(g));
        if (me) { me.name = name; me.skin = skin; }
      }
      this.openLobby(g);
    },

    /* ---------- 开局 ---------- */
    startMatch(g, cfg) {
      if (!g.roomRoster || g.roomRoster.length < 1) return;
      if (cfg.mode === 'lobby') return this.startLobbyScene(g);
      g.roomInLobby = false;
      g.roomOn = true;
      g.roomEnded = false;
      g.roomCfg = cfg;
      cfg.cheats = normCheats(cfg);          // 房主设置（模仿我的世界）
      const mode = cfg.mode;
      g.roomMode = (mode === 'gffa' || mode === 'gteam' || mode === 'brawl') ? mode
        : mode === 'duo' ? 'duo'
          : mode === 'endless' ? 'endless'
            : 'coop';
      g.roomStage = clamp(Math.floor(cfg.stage) || 1, 1, g.roomMode === 'coop' ? ROUND_TOTAL : LD.COOP_COUNT);
      g.mode = 'coop';
      g.online = false;                    // 走房间自己的流程，不进旧的双人联机分支
      let lv;
      if (g.roomMode === 'coop') {
        lv = longLevel(g.roomStage);                     // 闯关：超长地图
      } else if (g.roomMode === 'duo') {
        lv = LD.genCoop(g.roomStage);                    // 双人：经典合作图
      } else if (g.roomMode === 'endless') {
        /* 多人无尽：genEndlessChunk 是纯函数（段号固定 → 地形固定），
           每个客户端各自往后续段，长出来的一模一样，不需要同步地形。 */
        lv = LD.genEndlessChunk(0);
        lv.noDoor = true;
        lv.endless = true;
        const FLOOR = LD.ROWS - 2;
        lv.spawn = { x: 2 * LD.TILE + (LD.TILE - 18) / 2, y: FLOOR * LD.TILE - 24, footY: FLOOR * LD.TILE };
      } else {
        lv = LD.genGunDuel();                            // 枪战：对称竞技场
        lv.noDoor = true;
        lv.duel = true;                                  // world.gun 语义（关门 / 无攀爬判定差异）
      }
      g.level = lv;
      g.coopStage = g.roomStage;
      const goal = cfg.goal || { type: 'time', v: 120 };
      g.coopTimeLimit = g.roomMode === 'endless' ? 9999
        : (g.roomMode === 'gffa' || g.roomMode === 'gteam')
          ? (goal.type === 'time' ? goal.v : 9999)
          : (lv.timeLimit || Math.round(45 + g.roomStage * 1.1));
      g.coopLeft = g.coopTimeLimit;
      g.coopState = 'run';
      g._coopWarn = 0;
      g.roomPeers = new Map();
      g.roomReady = new Map();
      g.roomStats = {};
      const gunMode = g.roomMode === 'gffa' || g.roomMode === 'gteam';
      for (const r of g.roomRoster) {
        g.roomStats[r.slot] = {
          hp: gunMode ? LD.Guns.MAX_HP : BRAWL.hp, score: 0, deaths: 0,
          respawnT: 0, lastBy: -1, lastByT: -99, finish: 0,
        };
      }
      this.buildWorld(g);
      g.state = 'playing';
      g.closeAll();
      g.confirmLock = 0.5;
      g.last = performance.now();
      LD.Music.sync(g.settings);
      const goalTxt = (goal.type === 'time' ? T_('room.seconds', { n: goal.v }) : T_('room.koN', { n: goal.v }));
      flash(g,
        g.roomMode === 'coop' ? T_('room.coopStart', { n: g.roomStage }) + `（${T_('room.roundN', { n: (cfg.roundN || 1) })}）`
          : g.roomMode === 'duo' ? T_('room.coopStart', { n: g.roomStage })
            : g.roomMode === 'endless' ? T_('room.modeEndless') + ' —— ' + T_('gun.endlessDesc').replace(/<[^>]*>/g, '')
              : g.roomMode === 'gteam' ? T_('room.gteamStart', { g: goalTxt })
                : T_('room.gffaStart', { g: goalTxt }), 2600);
      this.hud(g, true);
    },

    buildWorld(g) {
      const lv = g.level;
      const gunMode = g.roomMode === 'gffa' || g.roomMode === 'gteam' || g.roomMode === 'brawl';
      g.world = new LD.World(lv);
      g.world.setCheat(g.cheat);
      g._spectateOf = null;
      this.specTip(g, false);
      this.syncSpecChips(g);
      g.coopDeaths = { red: 0, blue: 0 };
      g._coopReady = { rOk: false, bOk: false };
      g._waitTip = -9;
      g.rBullets = [];                     // 本客户端可见的子弹（自己的是权威，别人的是视效）
      const roster = g.roomRoster;
      const mine = myId(g);
      g.players = roster.map((r, i) => {
        const kind = i % 2 === 0 ? 'red' : 'blue';
        const base = (kind === 'blue' && g.world.spawn2) ? g.world.spawn2 : g.world.spawn;
        const p = new LD.Player(g.world, kind, base);
        p.w = 18; p.h = 24;
        // 多人挤同一个出生区：按席位错开一点点，别出生在同一格重叠成一团
        p.home = { x: base.x + ((i % 4) - 1.5) * 10 + (i >= 4 ? 4 : 0), footY: base.footY };
        p.reset(g.world);
        p.roomSlot = r.slot;
        p.roomId = r.id;
        p.name = LD.Skins.cleanName(r.name, r.slot);
        p.tag = p.name + (r.host ? ' 👑' : '');
        p.skin = LD.Skins.resolve(r.skin);
        p.remote = r.id !== mine;
        p.hp = gunMode ? LD.Guns.MAX_HP : BRAWL.hp;
        p.proT = 0;                        // 出生保护（枪战 3 秒无敌）
        p.punchT = 0; p.punchCd = 0; p.hurtFlash = 0;
        if (g.roomMode === 'gffa' || g.roomMode === 'gteam') {
          p.gun = new LD.Guns.GunState(p);          // 枪械自定义：对局里随时用武器栏换
          p.gun.setWeapon('pistol');
          if (r.id === mine && g.roomProfile && g.roomProfile.gun) p.gun.setWeapon(g.roomProfile.gun);
        }
        return p;
      });
      g.pR = g.players[0];
      g.pB = g.players[1] || g.players[0];
      g.player = g.players.find((p) => !p.remote) || g.players[0];
      g.world.soft = g.players;
      /* 房主设置（模仿我的世界）落地：
         · 全员无敌 / 全员飞行 —— 开局直接套到每个人身上；
         · 全员移速加成 —— 套 speedMul，普通移动和飞行都乘这个倍率；
         · 个人作弊（self / others）不在这里开，等玩家自己在对局里按作弊键。 */
      const ch = normCheats(g.roomCfg);
      for (const p of g.players) {
        p.invincible = g.cheat || ch.invincible;
        p.fly = g.cheat || ch.fly;
        p.speedMul = ch.speed || 1;
      }
      g.levelDeaths = 0;
      g.levelTime = 0;
      g.deathFlash = 0; g.deathT = 0; g.winT = 0;
      LD.FX.clear();
      g.camX = g._camTarget();
      g.updateHUD(true);
    },

    /* ---------- 对局内改形象 ---------- */
    openStyleMatch(g) {
      // 对局中改形象：先把对局挂起（state='paused'），保存 / 取消后再继续
      this._styleBack = 'match';
      if (g.state === 'playing' || g.state === 'dying') g.state = 'paused';
      this.openStyle(g);
    },

    /* ---------- 每帧 ---------- */
    step(g, dt) {
      if (!g.roomOn || !g.world) return;
      const w = g.world;
      g.levelTime += dt;
      g.coopLeft = Math.max(0, g.coopTimeLimit - g.levelTime);
      g.coopWarnTick();

      const me = g.player;
      if (!me) return;

      if (g.roomMode === 'lobby') this.stepLobby(g, dt, me, w);
      else if (g.roomMode === 'gffa' || g.roomMode === 'gteam') this.stepGun(g, dt, me, w);
      else if (g.roomMode === 'brawl') this.stepBrawl(g, dt, me, w);
      else if (g.roomMode === 'endless') this.stepEndless(g, dt, me, w);
      else this.stepCoop(g, dt, me, w);

      /* 状态广播 20Hz */
      this._sendT = (this._sendT || 0) - dt;
      if (this._sendT <= 0 && g.room) {
        this._sendT = 0.05;
        const gun = g.roomMode === 'gffa' || g.roomMode === 'gteam';
        g.room.send({
          t: 'state', slot: mySlot(g),
          x: Math.round(me.x * 10) / 10, y: Math.round(me.y * 10) / 10,
          vx: Math.round(me.vx * 10) / 10, vy: Math.round(me.vy * 10) / 10,
          face: me.face || 1, walk: Math.round((me.walk || 0) * 10) / 10,
          grounded: !!me.grounded, dead: !!me.dead,
          ready: !!g.roomReady.get(mySlot(g)),
          punch: (me.punchT || 0) > 0,
          gun: gun ? (me.gun ? me.gun.weaponId : 'pistol') : undefined,
          prot: gun ? (me.proT || 0) > 0 : undefined,
          /* 自己的作弊态也广播出去：别人的客户端据此画无敌 / 飞行状态 */
          inv: !!me.invincible, fly: !!me.fly,
          /* 多人无尽：广播自己的最远距离，别的客户端拿它更新排行榜 */
          dist: g.roomMode === 'endless' ? ((g.roomStats[mySlot(g)] || {}).score || 0) : undefined,
          tt: Math.round(g.levelTime * 100) / 100,
        });
      }
      this.applyPeers(g, dt);
      g.camX = LD.lerp(g.camX, g._camTarget(), 0.16);
      this._hudT = (this._hudT || 0) - dt;
      if (this._hudT <= 0) { this._hudT = 0.15; this.hud(g); }
    },

    /* ---- 大厅一帧：只走物理和同步，没有门 / 倒计时 / 胜负 ---- */
    stepLobby(g, dt, me, w) {
      if (me.dead) {
        me.deathT -= dt;
        if (me.deathT <= 0) me.reset(w);
      } else {
        me.update(dt, w, LD.Input);
        const hit = w.hazardHit(me);
        if (hit && !me.invincible) this.die(g, me, hit);
        else if (!me.invincible && w.fellOut(me)) this.die(g, me, { x: me.cx - 10, y: me.y, w: 20, h: 20 });
        else if (!g.cheat && me.y > w.pxH + 200) this.die(g, me, { x: me.cx, y: me.y, w: 20, h: 20 });
      }
      g.roomReady.set(mySlot(g), false);
    },

    /* ---- 多人无尽一帧：地形各自续段（纯函数），死了就出局，全员出局按距离排名 ---- */
    stepEndless(g, dt, me, w) {
      if (!g._roomEsChunk) g._roomEsChunk = 1;
      // 前方快没地了就续一段（genEndlessChunk 段号固定 → 每个客户端长出的地形一致）
      if (w.pxW - (me.x + me.w) < LD.VIEW_W * 1.8) w.extend(LD.genEndlessChunk(g._roomEsChunk++));

      if (me.dead) {
        // 无尽出局：不复活，等全局结算
      } else {
        me.update(dt, w, LD.Input);
        const hit = w.hazardHit(me);
        if (hit) this.die(g, me, hit);
        else if (!me.invincible && w.fellOut(me)) this.die(g, me, { x: me.cx - 10, y: me.y, w: 20, h: 20 });
        else if (!g.cheat && me.y > w.pxH + 200) this.die(g, me, { x: me.cx, y: me.y, w: 20, h: 20 });
        // 记分：自己的最远距离（格 = 米）
        const tiles = Math.max(0, Math.floor((me.x + me.w / 2) / LD.TILE));
        const st = g.roomStats[mySlot(g)];
        if (st && tiles > (st.score || 0)) st.score = tiles;
      }

      // 房主：全员出局 → 结算排名
      if (isHost(g) && g.coopState === 'run') {
        const roster = g.roomRoster || [];
        const allDead = roster.length > 0 && roster.every((r) => {
          const p = playerBySlot(g, r.slot);
          return !p || p.dead;
        });
        if (allDead) this.endEndless(g);
      }
    },

    endEndless(g) {
      if (g.coopState !== 'run') return;
      g.coopState = 'done';
      const rank = (g.roomRoster || [])
        .map((r) => ({
          slot: r.slot, name: LD.Skins.cleanName(r.name, r.slot),
          score: (g.roomStats[r.slot] || {}).score || 0, deaths: (g.roomStats[r.slot] || {}).deaths || 0,
        }))
        .sort((a, b) => b.score - a.score || a.deaths - b.deaths);
      if (g.room) g.room.send({ t: 'brawlEnd', rank, reason: 'endless' });
      this.showRoomOver(g, rank, 'endless', isHost(g));
    },

    /* ---- 枪战一帧（大乱斗 / 团队）：本地开火 + 房主权威命中结算 ---- */
    stepGun(g, dt, me, w) {
      const my = mySlot(g);
      const st = g.roomStats[my];
      const gunModeTeam = g.roomMode === 'gteam';
      // 出生保护计时
      for (const p of g.players) p.proT = Math.max(0, (p.proT || 0) - dt);
      me.hurtFlash = Math.max(0, (me.hurtFlash || 0) - dt * 3);

      const dead = !!(st && st.respawnT > 0);
      if (dead) {
        me.dead = true;
      } else if (me.dead) {
        me.reset(w);                        // 复活：满血 + 3 秒保护
        me.dead = false;
        me.proT = GUNCFG.protect;
        if (st) { st.hp = LD.Guns.MAX_HP; }
        me.hp = LD.Guns.MAX_HP;
        me.punchCd = 0.3;
        LD.FX.burst(me.cx, me.cy, 12, me.skin ? me.skin.body : '#ffd23f', 3.4);
      } else {
        // 输入包装（与 game.js 枪战一致的形状）
        const I = LD.Input;
        const ex = LD.Settings.gunKeyUnion ? LD.Settings.gunKeyUnion() : [];
        const slotEx = ex.concat(LD.Settings.keys ? LD.Settings.keys('cheat') : []);
        const inp = {
          left: () => I.anyExcept('left', ex),
          right: () => I.anyExcept('right', ex),
          up: () => I.anyExcept('jump', ex),
          downKey: () => I.anyExcept('down', ex),
          jumpPressed: () => I.actionPressedExcept('jump', ex),
          jumpHeld: () => I.anyExcept('jump', ex),
          fire: () => I.anyExcept('fire', ex),
          nextGun: () => I.actionPressedExcept('nextgun', ex),
          prevGun: () => I.actionPressedExcept('prevgun', ex),
          item: () => false,
          usePick: () => false,
          slotKey: () => I.slotHit ? I.slotHit(slotEx) : null,
        };
        me.update(dt, w, inp);
        const gun = me.gun;
        if (gun) {
          // 切枪（槽位直选 / 顺次切）
          const sh = inp.slotKey();
          if (sh) this.slotTap(g, sh.idx);
          else {
            if (inp.nextGun()) this.cycleGun(g, me, 1);
            if (inp.prevGun()) this.cycleGun(g, me, -1);
          }
          // 开火（按住连发；没弹自动换弹）
          if (inp.fire() && gun.weapon().kind === 'gun') {
            const shot = gun.tryFire(false);
            if (shot) this.roomShot(g, me, shot);
          } else if (gun.weapon().kind === 'gun' && gun.ammo() <= 0 && !gun.isReloading()) {
            gun.startReload(false);
          }
        }
        // 场地伤害
        const hit = w.hazardHit(me);
        if (hit && !me.invincible) { if (g.room) g.room.send({ t: 'fall', slot: my }); this.localFallFx(g, me); }
        else if (!me.invincible && w.fellOut(me)) { if (g.room) g.room.send({ t: 'fall', slot: my }); this.localFallFx(g, me); }
        else if (!g.cheat && me.y > w.pxH + 200) { if (g.room) g.room.send({ t: 'fall', slot: my }); this.localFallFx(g, me); }
      }

      // 子弹推进（自己的是权威命中，别人的是视效）
      this.stepRoomBullets(g, dt, w);

      if (isHost(g)) {
        // 胜负：击杀目标 / 时间到
        if (g.coopState === 'run') {
          const goal = (g.roomCfg && g.roomCfg.goal) || { type: 'time', v: 120 };
          let winner = -1;
          if (goal.type === 'kills') {
            for (const r of g.roomRoster || []) {
              if ((g.roomStats[r.slot] || {}).score >= goal.v) { winner = r.slot; break; }
            }
          }
          if (g.coopLeft <= 0 || winner >= 0) { this.endGun(g, winner >= 0 ? 'ko' : 'time'); return; }
        }
        // 复活倒计时 + 状态快照（复用散打的权威通道）
        let dirty = false;
        for (const r of g.roomRoster || []) {
          const s = g.roomStats[r.slot];
          if (s && s.respawnT > 0) { s.respawnT = Math.max(0, s.respawnT - dt); dirty = true; }
        }
        this._statT = (this._statT || 0) - dt;
        if (g.room && (this._statT <= 0 || dirty)) {
          this._statT = 0.12;
          g.room.send({ t: 'stats', s: this.statPack(g), left: Math.round(g.coopLeft * 10) / 10 });
        }
      }
      void gunModeTeam;
    },

    /* 我开一枪：本地立刻出子弹视效 + 通知房主做权威结算 */
    roomShot(g, p, shot) {
      const dir = p.face || 1;
      const b = new LD.Guns.Bullet({
        x: p.cx + dir * 15, y: p.y + p.h * 0.42,
        vx: dir * shot.speed, vy: 0,
        dmg: shot.dmg, r: shot.size, color: shot.color,
        team: 'red', owner: p, explode: shot.explode, splash: shot.splash,
      });
      b.roomOwner = p.roomSlot;
      g.rBullets.push(b);
      if (g.room) g.room.send({
        t: 'shot', slot: p.roomSlot, x: Math.round(b.x), y: Math.round(b.y),
        vx: dir * shot.speed, dmg: shot.dmg, r: shot.size, color: shot.color,
        explode: !!shot.explode, splash: shot.splash || 0, wid: shot.id,
      });
      if (LD.Sfx && LD.Sfx.shot) LD.Sfx.shot(shot.id);
    },

    /* 房客切枪 / 顺次切枪 */
    slotTap(g, idx) {
      const me = g.player;
      if (!me || !me.gun) return;
      const slot = LD.Guns.SLOTS[idx];
      if (!slot) return;
      const list = LD.Guns.bySlot[slot] || [];
      const gunW = list.filter((w) => w.kind === 'gun')[0];
      if (gunW && me.gun.setWeapon(gunW.id)) {
        LD.Sfx.switchGun && LD.Sfx.switchGun();
        flash(g, gunW.slot + ' ' + (LD.I18N.isLatin() ? gunW.nameEn : gunW.name), 900);
      }
    },
    cycleGun(g, me, d) {
      if (!me || !me.gun) return;
      const guns = LD.Guns.WEAPONS.filter((w) => w.kind === 'gun').map((w) => w.id);
      if (guns.length < 2) return;
      let i = guns.indexOf(me.gun.weaponId);
      if (i < 0) i = 0;
      me.gun.setWeapon(guns[(i + d + guns.length) % guns.length]);
      LD.Sfx.switchGun && LD.Sfx.switchGun();
    },

    /* 子弹推进：房主对所有子弹做命中判定（含远端来弹），房客只做视效 */
    stepRoomBullets(g, dt, w) {
      const host = isHost(g);
      for (let i = (g.rBullets || []).length - 1; i >= 0; i--) {
        const b = g.rBullets[i];
        const res = LD.Guns.stepBullet(w, b, dt);
        if (res && res.hitBox) w.breakBox(res.x, res.y);
        else if (res && res.hitWall) {
          if (b.explode && host) this.roomBlast(g, b, res.x, res.y);
          else LD.FX.burst(res.x, res.y, 4, b.color, 2);
        }
        if (b.dead) {
          if (b.explode && host) this.roomBlast(g, b, b.x, b.y);
          else if (host && !b.remote) this.roomBulletHit(g, b, b.x, b.y);
          g.rBullets.splice(i, 1);
          continue;
        }
        if (host && !b.remote && this.roomBulletHit(g, b, b.x, b.y)) g.rBullets.splice(i, 1);
      }
      if (g.rBullets && g.rBullets.length > 300) g.rBullets.splice(0, g.rBullets.length - 300);
    },

    /* 房主：一发子弹对所有人做点-盒判定（跳过射手 / 阵亡 / 保护中 / 队友） */
    roomBulletHit(g, b, x, y) {
      const by = b.roomOwner;
      for (const r of g.roomRoster || []) {
        if (r.slot === by) continue;
        if (g.roomMode === 'gteam' && by != null && (r.slot % 2) === (by % 2)) continue;  // 团队：不打队友
        const s = g.roomStats[r.slot];
        if (!s || s.respawnT > 0) continue;
        const p = playerBySlot(g, r.slot);
        if (!p || p.dead) continue;
        if ((p.proT || 0) > 0) continue;                   // 出生保护
        if (x < p.x - b.r || x > p.x + p.w + b.r || y < p.y - b.r || y > p.y + p.h + b.r) continue;
        this.applyShotDmg(g, by, r.slot, b.dmg);
        if (b.explode) this.roomBlast(g, b, x, y);
        LD.FX.burst(x, y, 6, b.color, 2.6);
        return true;
      }
      return false;
    },

    /* 房主：子弹伤害 → 复用散打的 hurt / ko 权威通道 */
    applyShotDmg(g, by, slot, dmg) {
      const s = g.roomStats[slot];
      if (!s) return;
      s.hp -= dmg;
      s.lastBy = by;
      s.lastByT = g.levelTime;
      if (g.room) g.room.send({ t: 'hurt', slot, by, hp: Math.max(0, Math.round(s.hp)), kx: 2.5, ky: -2 });
      this.applyHurt(g, slot, by, Math.max(0, Math.round(s.hp)), 2.5, -2);
      if (s.hp <= 0) this.koOne(g, slot, by);
    },

    roomBlast(g, b, x, y) {
      LD.FX.burst(x, y, 22, '#ffb347', 5);
      const R = b.splash || 40;
      for (const r of g.roomRoster || []) {
        if (r.slot === b.roomOwner) continue;
        if (g.roomMode === 'gteam' && b.roomOwner != null && (r.slot % 2) === (b.roomOwner % 2)) continue;
        const s = g.roomStats[r.slot];
        const p = playerBySlot(g, r.slot);
        if (!s || !p || s.respawnT > 0 || p.dead || (p.proT || 0) > 0) continue;
        const d = Math.hypot(p.cx - x, p.cy - y);
        if (d > R) continue;
        this.applyShotDmg(g, b.roomOwner, r.slot, Math.max(1, Math.round(b.dmg * (1 - d / R * 0.5))));
      }
      if (g.room) g.room.send({ t: 'blast', x: Math.round(x), y: Math.round(y), r: R });
    },

    /* ---- 合作闯关一帧 ---- */
    stepCoop(g, dt, me, w) {
      if (g.coopLeft <= 0) {
        if (isHost(g)) {
          if (g.coopState === 'run' && g.room) g.room.send({ t: 'timeup' });
          g.coopTimeUp();
        }
        return;
      }
      /* 我已到门 → 定格等待，镜头切到还没通关玩家的视角（观战条可切换对象） */
      if (me.dead) {
        me.deathT -= dt;
        if (me.deathT <= 0) me.reset(w);
      } else if (g._spectateOf != null) {
        me.vx = 0; me.vy = 0;          // 已通关：站在门口不动，把舞台让给队友
      } else {
        me.update(dt, w, LD.Input);
      }
      if (!me.dead) {
        const hit = w.hazardHit(me);
        if (hit) this.die(g, me, hit);
        else if (!me.invincible && w.fellOut(me)) this.die(g, me, { x: me.cx - 10, y: me.y, w: 20, h: 20 });
        else if (!g.cheat && me.y > w.pxH + 200) this.die(g, me, { x: me.cx, y: me.y, w: 20, h: 20 });
        // 到门判定（自己的颜色对应自己的门）
        const ok = w.doorHit(me, me.kind);
        const mst = g.roomStats[mySlot(g)];
        if (ok && mst && !mst.finish) mst.finish = g.levelTime;   // 记录个人通关用时（排名用）
        g.roomReady.set(mySlot(g), !!ok);
        g._coopReady = { rOk: me.kind === 'red' ? ok : !!g.roomReady.get(this.slotOfKind(g, 'red')),
                         bOk: me.kind === 'blue' ? ok : !!g.roomReady.get(this.slotOfKind(g, 'blue')) };
        const allReady = (g.roomRoster || []).length > 0 &&
          (g.roomRoster || []).every((r) => g.roomReady.get(r.slot));
        if (ok && !allReady) {
          // 已通关：默认观战第一个还没通关的人，也可以在观战条里点人切换
          let target = null;
          if (g._spectateOf != null) {
            const tp = playerBySlot(g, g._spectateOf);
            if (tp && !g.roomReady.get(g._spectateOf)) target = tp;
          }
          if (!target) {
            const pending = (g.roomRoster || []).filter((r) => !g.roomReady.get(r.slot));
            target = pending.length ? playerBySlot(g, pending[0].slot) : null;
            g._spectateOf = target ? target.roomSlot : null;
          }
          this.specTip(g, !!target, target);
          this.syncSpecChips(g);
        } else if (ok || allReady) {
          g._spectateOf = null;
          this.specTip(g, false);
          this.syncSpecChips(g);
        }
      } else {
        g.roomReady.set(mySlot(g), false);
      }
      // 队友已到门而我还没到：偶尔提示一下（我到门后由观战横幅接管）
      const otherReady = me.kind === 'red' ? g._coopReady.bOk : g._coopReady.rOk;
      if (!g._spectateOf && otherReady && g.levelTime - g._waitTip > 2.4) {
        g._waitTip = g.levelTime;
        flash(g, T_('toast.coopWait'), 1400);
      }
      // 房主：全员到门 → 通关
      if (isHost(g) && g.coopState === 'run') {
        const roster = g.roomRoster || [];
        let all = roster.length > 0;
        for (const r of roster) if (!g.roomReady.get(r.slot)) { all = false; break; }
        if (all) this.endCoop(g);
      }
    },
    slotOfKind(g, kind) {
      const r = (g.roomRoster || []).find((x) => {
        const i = g.roomRoster.indexOf(x);
        return (i % 2 === 0 ? 'red' : 'blue') === kind;
      });
      return r ? r.slot : -1;
    },

    die(g, p, hit) {
      if (!p.kill()) return;
      p.deathT = 0.85;
      g.coopDeaths[p.kind]++;
      g.save.totalDeaths++;
      const st = g.roomStats[p.roomSlot];
      if (st) st.deaths++;                     // 排名用：按席位记死亡
      if (isHost(g)) { g.save.coop.deaths = (g.save.coop.deaths || 0) + 1; LD.Save.flush(); }
      g.deathFlash = 1;
      g.world.shake = 1;
      LD.Sfx.die();
      LD.FX.burst(hit.x + hit.w / 2, hit.y + hit.h / 2, 16, '#ff4d6d', 4.5);
      LD.FX.burst(p.cx, p.cy, 10, p.skin ? p.skin.body : '#ffd23f', 3.4);
      g.updateHUD(true);
      if (g.room) g.room.send({ t: 'die', slot: p.roomSlot });
    },

    endCoop(g) {
      if (g.coopState !== 'run') return;
      const R = this.scoreOf(g);
      // 本关排名：按死亡少 → 通关用时短
      const rank = (g.roomRoster || [])
        .map((r) => {
          const st = g.roomStats[r.slot] || { deaths: 0, finish: 0 };
          return {
            slot: r.slot, name: LD.Skins.cleanName(r.name, r.slot),
            deaths: st.deaths || 0, time: st.finish || g.levelTime, pts: 0,
          };
        })
        .sort((a, b) => a.deaths - b.deaths || a.time - b.time);
      rank.forEach((r, i) => { r.pts = ROUND_PTS[i] || 1; });
      // 回合积分累计（跨 5 关）
      if (!g.roundPts) g.roundPts = {};
      for (const r of rank) g.roundPts[r.slot] = (g.roundPts[r.slot] || 0) + r.pts;
      const roundN = Math.min(ROUND_TOTAL, (g.roomCfg && g.roomCfg.roundN) || 1);
      if (g.roomCfg) g.roomCfg.roundN = roundN;
      if (g.room) {
        g.room.send({
          t: 'win', score: R.score, base: R.base, bonus: R.bonus, penalty: R.penalty,
          dR: g.coopDeaths.red, dB: g.coopDeaths.blue,
          time: Math.round(g.levelTime * 100) / 100,
          rank, roundPts: g.roundPts, roundN,
        });
      }
      // 只有房主写本地存档；房客的进度跟随房主的关卡选择
      const host = isHost(g);
      this.winUI(g, R, host, host, rank, g.roundPts, roundN);
    },

    /* ---- 枪战结算（大乱斗 / 团队）：按击杀排名；团队按两队总分 ---- */
    endGun(g, reason) {
      if (g.coopState !== 'run') return;
      g.coopState = 'done';
      const team = g.roomMode === 'gteam';
      let rank;
      if (team) {
        const t = [0, 0];   // 红(偶数席) / 蓝(奇数席)
        for (const r of g.roomRoster || []) t[r.slot % 2] += (g.roomStats[r.slot] || { score: 0 }).score;
        rank = (g.roomRoster || [])
          .map((r) => ({ slot: r.slot, name: LD.Skins.cleanName(r.name, r.slot), score: (g.roomStats[r.slot] || {}).score || 0, deaths: (g.roomStats[r.slot] || {}).deaths || 0, team: r.slot % 2 }))
          .sort((a, b) => b.score - a.score || a.deaths - b.deaths);
        rank.teamScore = t;
      } else {
        rank = (g.roomRoster || [])
          .map((r) => ({ slot: r.slot, name: LD.Skins.cleanName(r.name, r.slot), score: (g.roomStats[r.slot] || {}).score || 0, deaths: (g.roomStats[r.slot] || {}).deaths || 0 }))
          .sort((a, b) => b.score - a.score || a.deaths - b.deaths);
      }
      if (g.room) g.room.send({ t: 'brawlEnd', rank, reason, team });
      this.showRoomOver(g, rank, reason, isHost(g), team);
    },

    scoreOf(g) {
      const left = Math.max(0, (g.coopTimeLimit || 0) - g.levelTime);
      const base = g.level.scoreBase || (100 + g.roomStage * 12);
      const bonus = Math.round(left) * 6;
      const penalty = (g.coopDeaths.red + g.coopDeaths.blue) * 25;
      return { score: Math.max(0, base + bonus - penalty), base, bonus, penalty };
    },

    /* 通关结算（复用 ov-win） */
    winUI(g, R, save, canNext, rank, roundPts, roundN) {
      let isBest = false;
      if (save) {
        const c = g.save.coop;
        const prevBest = c.best[g.roomStage] || 0;
        isBest = R.score > prevBest;
        if (isBest) c.best[g.roomStage] = R.score;
        if (c.unlocked < g.roomStage + 1) c.unlocked = Math.min(LD.COOP_COUNT, g.roomStage + 1);
        c.cleared[g.roomStage] = true;
        c.score = (c.score || 0) + R.score;
        LD.Save.flush();
      }
      g.coopState = 'done';
      g.coopResult = R;
      LD.Sfx.win();
      if (g.world.door) LD.FX.cone(g.world.door.x + LD.TILE / 2, g.world.door.y + LD.TILE, '#35e0a1');
      if (g.world.door2) LD.FX.cone(g.world.door2.x + LD.TILE / 2, g.world.door2.y + LD.TILE, '#4fc3ff');
      g.state = 'won';
      g.winT = 0;
      g.confirmLock = 0.5;
      g.winKind = 'room';
      const roundDone = roundN != null && roundN >= ROUND_TOTAL;
      const last = roundDone || g.roomStage >= ROUND_TOTAL;
      if (last) LD.Sfx.final();
      $('win-title').textContent = T_('room.winTitle', { n: g.roomStage });
      $('win-tip').textContent = T_('room.winTip');
      const roster = g.roomRoster || [];
      const deathParts = roster.map((r) => {
        const i = roster.indexOf(r);
        const col = i % 2 === 0 ? 'c-red' : 'c-blue';
        return `<span class="${col}">${LD.Skins.cleanName(r.name, r.slot)} <b>${g.coopDeaths[i % 2 === 0 ? 'red' : 'blue']}</b></span>`;
      }).join('');
      // 本关排名 + 回合积分（闯关模式：5 关一回合，按名次积分）
      let rankParts = '';
      if (rank && rank.length) {
        rankParts = rank.map((r, i) => {
          const med = ['🥇', '🥈', '🥉'][i] || `${i + 1}`;
          const tp = roundPts ? (roundPts[r.slot] || 0) : r.pts || 0;
          return `<span>${med} ${r.name} <b>${tp}${T_('room.ptsUnit')}</b></span>`;
        }).join('');
      }
      $('win-stat').innerHTML =
        `<span>${T_('coop.score')} <b>${R.score}</b>${isBest ? ' ★' : ''}</span>` +
        `<span>${T_('coop.scoreLeft')} <b>+${R.bonus}</b></span>` +
        `<span>${T_('coop.scoreDeath')} <b>-${R.penalty}</b></span>` +
        `<span>${T_('win.time')} <b>${g.levelTime.toFixed(2)}s</b></span>` + deathParts +
        (rankParts ? `<span class="rank-line">${rankParts}</span>` : '') +
        (save ? `<span>${T_('coop.totalScore')} <b>${g.save.coop.score}</b></span>` : '');
      const nextBtn = $('btn-next');
      if (nextBtn) {
        if (!canNext) { nextBtn.textContent = T_('online.waitNext'); nextBtn.disabled = true; }
        else {
          nextBtn.textContent = roundDone
            ? T_('room.roundOver')
            : T_('coop.next') + `（${Math.min(ROUND_TOTAL, (roundN || 1) + 1)}/${ROUND_TOTAL}）→`;
          nextBtn.disabled = false;
        }
      }
      g.updateHUD(true);
      g.open('ov-win');
    },

    /* ---- 散打一帧 ---- */
    stepBrawl(g, dt, me, w) {
      const my = mySlot(g);
      const st = g.roomStats[my];
      const dead = !!(st && st.respawnT > 0);
      me.punchCd = Math.max(0, (me.punchCd || 0) - dt);
      me.punchT = Math.max(0, (me.punchT || 0) - dt);
      me.hurtFlash = Math.max(0, (me.hurtFlash || 0) - dt * 3);

      if (dead) {
        me.dead = true;
      } else if (me.dead) {
        me.reset(w);                 // 复活瞬间
        me.dead = false;
        me.punchCd = 0.4;
        LD.FX.burst(me.cx, me.cy, 10, me.skin ? me.skin.body : '#ffd23f', 3.2);
      } else {
        me.update(dt, w, LD.Input);
        // 出拳
        if (LD.Input.actionPressed('fire') && me.punchCd <= 0) {
          me.punchCd = BRAWL.punchCd;
          me.punchT = BRAWL.punchT;
          LD.Sfx.tick();
          if (g.room) g.room.send({ t: 'punch', slot: my, x: Math.round(me.cx), y: Math.round(me.cy), face: me.face || 1 });
          if (isHost(g)) this.resolvePunch(g, my, me.cx, me.cy, me.face || 1);
        }
        // 场地伤害也算出局：上报房主处理
        const hit = w.hazardHit(me);
        if (hit && !me.invincible) { if (g.room) g.room.send({ t: 'fall', slot: my }); this.localFallFx(g, me); }
        else if (!me.invincible && w.fellOut(me)) { if (g.room) g.room.send({ t: 'fall', slot: my }); this.localFallFx(g, me); }
        else if (!g.cheat && me.y > w.pxH + 200) { if (g.room) g.room.send({ t: 'fall', slot: my }); this.localFallFx(g, me); }
      }

      if (isHost(g)) {
        // 倒计时 / 目标 KO
        if (g.coopState === 'run') {
          const roster = g.roomRoster || [];
          let winner = -1;
          for (const r of roster) if ((g.roomStats[r.slot] || {}).score >= BRAWL.ko) winner = r.slot;
          if (g.coopLeft <= 0 || winner >= 0) { this.endBrawl(g, winner >= 0 ? 'ko' : 'time'); return; }
        }
        // 复活倒计时 + 状态快照 8Hz
        let dirty = false;
        for (const r of g.roomRoster || []) {
          const s = g.roomStats[r.slot];
          if (s && s.respawnT > 0) { s.respawnT = Math.max(0, s.respawnT - dt); dirty = true; }
        }
        this._statT = (this._statT || 0) - dt;
        if (g.room && (this._statT <= 0 || dirty)) {
          this._statT = 0.12;
          const s = [];
          for (const r of g.roomRoster || []) {
            const st2 = g.roomStats[r.slot];
            s.push([r.slot, Math.round(st2.hp), st2.score, st2.deaths, Math.round(st2.respawnT * 10) / 10]);
          }
          g.room.send({ t: 'stats', s, left: Math.round(g.coopLeft * 10) / 10 });
        }
      } else if (st) {
        // 房客本地只做显示层的复活倒计时推进（权威值随快照到达）
      }
    },

    localFallFx(g, me) {
      LD.FX.burst(me.cx, me.cy, 12, me.skin ? me.skin.body : '#ffd23f', 3.2);
      LD.Sfx.die();
    },

    /* 房主：判定一拳（出拳者本地位置 + 其他人的最新网络位置） */
    resolvePunch(g, bySlot, x, y, face) {
      if (g.roomState !== 'run' && g.coopState !== 'run') return;
      const byP = playerBySlot(g, bySlot);
      for (const r of g.roomRoster || []) {
        if (r.slot === bySlot) continue;
        const s = g.roomStats[r.slot];
        if (!s || s.respawnT > 0) continue;
        const p = playerBySlot(g, r.slot);
        if (!p) continue;
        const px = p.x + p.w / 2, py = p.y + p.h / 2;
        const dx = (px - x) * (face || 1);
        if (dx < -6 || dx > BRAWL.range) continue;
        if (Math.abs(py - y) > BRAWL.vOverlap) continue;
        s.hp -= BRAWL.dmg;
        s.lastBy = bySlot;
        s.lastByT = g.levelTime;
        const kx = (face || 1) * 6.5;
        if (g.room) g.room.send({ t: 'hurt', slot: r.slot, by: bySlot, hp: Math.max(0, Math.round(s.hp)), kx, ky: -4 });
        this.applyHurt(g, r.slot, bySlot, Math.max(0, s.hp), kx, -4);
        if (s.hp <= 0) this.koOne(g, r.slot, bySlot);
      }
    },

    koOne(g, slot, by) {
      const s = g.roomStats[slot];
      if (!s) return;
      s.hp = (g.roomMode === 'gffa' || g.roomMode === 'gteam') ? LD.Guns.MAX_HP : BRAWL.hp;
      s.deaths++;
      s.respawnT = (g.roomMode === 'gffa' || g.roomMode === 'gteam') ? GUNCFG.respawn : BRAWL.respawn;
      if (by >= 0 && g.roomStats[by]) g.roomStats[by].score++;
      if (g.room) g.room.send({ t: 'ko', slot, by, s: this.statPack(g) });
      this.applyKo(g, slot, by);
      const vp = playerBySlot(g, slot);
      if (vp && (g.roomMode === 'gffa' || g.roomMode === 'gteam')) vp.proT = GUNCFG.protect;   // 复活 3 秒无敌
    },

    statPack(g) {
      const s = [];
      for (const r of g.roomRoster || []) {
        const st = g.roomStats[r.slot];
        s.push([r.slot, Math.round(st.hp), st.score, st.deaths, Math.round(st.respawnT * 10) / 10]);
      }
      return s;
    },

    applyHurt(g, slot, by, hp, kx, ky) {
      const p = playerBySlot(g, slot);
      if (!p) return;
      p.hp = hp;
      p.hurtFlash = 1;
      if (kx) p.vx = (p.vx || 0) + kx;
      if (ky) p.vy = (p.vy || 0) + ky;
      LD.FX.burst(p.cx, p.cy, 8, '#ff4d6d', 3.4);
      const byP = playerBySlot(g, by);
      if (byP) LD.FX.spark(byP.cx + (byP.face || 1) * 16, byP.y + byP.h * 0.4, '#ffd75e');
      if (slot === mySlot(g)) { g.world.shake = Math.max(g.world.shake || 0, 0.5); LD.Sfx.hit && LD.Sfx.hit(); }
    },

    applyKo(g, slot, by) {
      const p = playerBySlot(g, slot);
      const byP = playerBySlot(g, by);
      if (p) {
        LD.FX.burst(p.cx, p.cy, 18, p.skin ? p.skin.body : '#ffd23f', 4.6);
        p.dead = true;
      }
      if (byP) LD.FX.cone(byP.cx, byP.y + byP.h, '#ffd23f');
      LD.Sfx.win();
      const st = g.roomStats[slot];
      const name = (entryBySlot(g, slot) || {}).name || '?';
      const byName = by >= 0 ? ((entryBySlot(g, by) || {}).name || '?') : null;
      flash(g, byName ? T_('room.koMsg', { a: byName, b: name }) : T_('room.fallMsg', { b: name }), 1400);
      this.hud(g, true);
    },

    endBrawl(g, reason) {
      if (g.coopState !== 'run') return;
      g.coopState = 'done';
      const rank = (g.roomRoster || [])
        .map((r) => ({ slot: r.slot, name: LD.Skins.cleanName(r.name, r.slot), score: g.roomStats[r.slot].score, deaths: g.roomStats[r.slot].deaths }))
        .sort((a, b) => b.score - a.score || a.deaths - b.deaths);
      if (g.room) g.room.send({ t: 'brawlEnd', rank, reason });
      this.showRoomOver(g, rank, reason, isHost(g));
    },

    showRoomOver(g, rank, reason, canAgain, team) {
      g.state = 'roomOver';
      g.winT = 0;
      g.confirmLock = 0.6;
      g.winKind = 'room';
      const win0 = rank && rank.length && rank[0].score > 0;
      $('room-over-title').textContent = reason === 'round'
        ? T_('room.roundTitle')
        : (reason === 'endless'
          ? T_('room.endlessOverTitle')
          : (reason === 'ko'
            ? T_('room.overKo', { n: rank[0].name })
            : (win0 ? T_('room.overTime') : T_('room.overDraw'))));
      $('room-over-tip').textContent = reason === 'round' ? T_('room.roundTip')
        : reason === 'endless' ? T_('gun.endlessTip').replace('{n}', (rank[0] || {}).score || 0)
          : T_('room.overTip');
      const box = $('room-rank');
      if (box) {
        box.innerHTML = '';
        if (team && rank.teamScore) {
          const tr = document.createElement('div');
          tr.className = 'rank-row first';
          tr.innerHTML =
            `<b class="no">🏆</b>` +
            `<b class="nm">${T_('room.teamRed')} ${rank.teamScore[0]} : ${rank.teamScore[1]} ${T_('room.teamBlue')}</b>`;
          box.appendChild(tr);
        }
        rank.forEach((r, i) => {
          const row = document.createElement('div');
          row.className = 'rank-row' + (i === 0 ? ' first' : '');
          const entry = entryBySlot(g, r.slot);
          const sk = entry ? LD.Skins.resolve(entry.skin) : null;
          const valLabel = reason === 'round' ? T_('room.ptsUnit') : T_('room.ko');
          row.innerHTML =
            `<b class="no">${i + 1}</b>` +
            (sk ? `<i class="sw" style="background:${sk.body};box-shadow:0 0 8px ${sk.body}"></i>` : '<i class="sw"></i>') +
            `<b class="nm">${r.name}</b>` +
            (reason === 'endless'
              ? `<span>${T_('gun.distShort', { n: r.score })}</span>`
              : `<span>${valLabel} <b>${r.score}</b></span>`) +
            `<span>${T_('room.deaths')} <b>${r.deaths}</b></span>`;
          box.appendChild(row);
        });
      }
      const again = $('btn-room-again');
      if (again) {
        again.disabled = !canAgain;
        again.textContent = canAgain ? T_('room.again') : T_('room.waitAgain');
      }
      LD.Sfx.win();
      g.open('ov-room-over');
      this.hud(g, true);
    },

    /* ---- 远端状态应用 ---- */
    applyPeers(g, dt) {
      for (const [slot, s] of (g.roomPeers || new Map())) {
        if (slot === mySlot(g)) continue;
        const p = playerBySlot(g, slot);
        if (!p) continue;
        if (s.punch && !(p.punchT > 0)) p.punchT = BRAWL.punchT;
        if (Math.abs(s.x - p.x) > 200 || Math.abs(s.y - p.y) > 200) {
          p.x = s.x; p.y = s.y;                    // 复活 / 大跳变：直接吸附
        } else {
          const k = Math.min(1, dt * 12);
          p.x += (s.x - p.x) * k;
          p.y += (s.y - p.y) * k;
        }
        p.vx = s.vx || 0; p.vy = s.vy || 0;
        p.face = s.face || p.face;
        p.walk = s.walk || 0;
        p.grounded = !!s.grounded;
        /* 远端玩家的个人作弊态（房主设置里允许后对方自己开的） */
        if (s.inv != null) p.invincible = !!s.inv;
        if (s.fly != null) p.fly = !!s.fly;
        // 枪战：远端当前武器 + 出生保护（近似显示）
        if (s.gun && p.gun && p.gun.weaponId !== s.gun) p.gun.setWeapon(s.gun);
        if (s.prot != null) p.proT = s.prot ? Math.max(p.proT || 0, 0.6) : 0;
        g.roomReady.set(slot, !!s.ready);
        const dead = !!s.dead;
        if (dead && !p._deadPrev) {
          // 远端刚死（合作模式才数死亡；散打的死亡走 ko 消息）
          if (g.roomMode === 'coop' || g.roomMode === 'duo') {
            g.coopDeaths[p.kind]++;
            const stD = g.roomStats[slot];
            if (stD) stD.deaths++;
            LD.FX.burst(p.cx, p.cy, 12, p.skin ? p.skin.body : '#ffd23f', 3.2);
            g.updateHUD(true);
          }
        }
        p._deadPrev = dead;
        if (g.roomMode === 'coop' || g.roomMode === 'duo' || g.roomMode === 'lobby') {
          p.dead = dead;
          if (!dead) { p.deathT = 0; p.alpha = 1; }
          else { p.deathT = 0.85; }
        } else {
          // 散打：死亡由房主的 stats 快照说了算
          const st = g.roomStats[slot];
          const sd = !!(st && st.respawnT > 0);
          p.dead = sd;
          if (st) p.hp = st.hp;
        }
      }
    },

    /* ---- 房间消息 ---- */
    msg(g, m, from) {
      if (!m || !m.t) return;
      switch (m.t) {
        case 'cfg':
          if (!isHost(g)) {
            g.roomCfg = m.cfg || g.roomCfg;
            if (g.roomCfg) g.roomCfg.cheats = normCheats(g.roomCfg);   // 房主设置（模仿我的世界）
            this.syncLobbyReady(g);          // 房主改了配置 → 准备作废
            if (g.roomInLobby) this.refreshLobby(g);
          }
          break;
        case 'lready': {
          const id = m.__from || from;
          if (!g.lobbyReady) g.lobbyReady = new Map();
          g.lobbyReady.set(id, !!m.on);
          if (g.roomInLobby) this.refreshLobby(g);
          break;
        }
        case 'start':
          if (!isHost(g)) this.startMatch(g, m.cfg);
          break;
        case 'state': {
          if (m.slot == null) break;
          g.roomPeers.set(m.slot, m);
          /* 多人无尽：远端玩家上报的最远距离 → 更新本地排行榜（每人自己记自己，广播汇合） */
          if (g.roomMode === 'endless' && m.dist != null) {
            const es = g.roomStats[m.slot];
            if (es && m.dist > (es.score || 0)) es.score = m.dist;
          }
          if (g.roomMode === 'coop' && !isHost(g) && m.tt != null) {
            g.levelTime = Math.max(g.levelTime, m.tt);
            g.coopLeft = Math.max(0, g.coopTimeLimit - g.levelTime);
          }
          break;
        }
        case 'die':
          // 远端死亡由 applyPeers 的 dead 上升沿统一处理（粒子 + 计数），这里不再重复计
          break;
        case 'win':
          if (!isHost(g)) {
            const R = { score: m.score || 0, base: m.base || 0, bonus: m.bonus || 0, penalty: m.penalty || 0 };
            g.coopDeaths.red = m.dR || 0;
            g.coopDeaths.blue = m.dB || 0;
            if (m.time != null) g.levelTime = m.time;
            if (m.roundPts) g.roundPts = m.roundPts;
            if (m.rank) for (const rr of m.rank) {
              const st = g.roomStats[rr.slot];
              if (st) { st.deaths = rr.deaths || 0; st.finish = rr.time || 0; }
            }
            this.winUI(g, R, false, false, m.rank, g.roundPts, m.roundN);
          }
          break;
        case 'shot': {
          // 房主：权威模拟这发子弹（做命中判定）；其他房客：只做视效
          if (!g.rBullets) g.rBullets = [];
          const b = new LD.Guns.Bullet({
            x: m.x, y: m.y, vx: m.vx, vy: 0, dmg: m.dmg, r: m.r, color: m.color,
            team: 'ai', owner: null, explode: m.explode, splash: m.splash,
          });
          b.remote = !isHost(g);
          b.roomOwner = m.slot;
          g.rBullets.push(b);
          if (LD.Sfx && LD.Sfx.shot) LD.Sfx.shot(m.wid || 'pistol');
          break;
        }
        case 'blast':
          LD.FX.burst(m.x, m.y, 22, '#ffb347', 5);
          break;
        case 'timeup':
          if (!isHost(g)) g.coopTimeUp();
          break;
        case 'restart':
          if (isHost(g) && g.roomOn) this.startMatch(g, g.roomCfg);
          break;
        case 'nextReq':
          if (isHost(g) && g.state === 'won') this.next(g);
          else if (isHost(g) && g.state === 'roomOver') {
            // 房客点了再来一局 → 房主替全员重开（广播 start，大家都进，不用再准备）
            g.room.send({ t: 'start', cfg: g.roomCfg });
            this.startMatch(g, g.roomCfg);
          }
          break;
        case 'punch': {
          const p = playerBySlot(g, m.slot);
          if (p) { p.punchT = BRAWL.punchT; p.face = m.face || p.face; }
          if (isHost(g)) this.resolvePunch(g, m.slot, m.x, m.y, m.face);
          break;
        }
        case 'hurt':
          if (!isHost(g)) this.applyHurt(g, m.slot, m.by, m.hp, m.kx, m.ky);
          else if (m.slot === mySlot(g)) this.applyHurt(g, m.slot, m.by, m.hp, m.kx, m.ky);
          break;
        case 'ko':
          if (m.s) this.applyStats(g, m.s);
          this.applyKo(g, m.slot, m.by);
          break;
        case 'stats':
          if (!isHost(g)) this.applyStats(g, m.s, m.left);
          break;
        case 'fall':
          if (isHost(g)) {
            const s = g.roomStats[m.slot];
            if (s && s.respawnT <= 0 && g.coopState === 'run') {
              const by = (g.levelTime - s.lastByT <= BRAWL.lastByWin) ? s.lastBy : -1;
              this.koOne(g, m.slot, by);
            }
          }
          break;
        case 'brawlEnd':
          if (!isHost(g)) this.showRoomOver(g, m.rank || [], m.reason, false, m.team);
          break;
        default:
          break;
      }
    },

    applyStats(g, pack, left) {
      if (!pack) return;
      for (const row of pack) {
        const [slot, hp, score, deaths, respawnT] = row;
        const st = g.roomStats[slot];
        if (st) { st.hp = hp; st.score = score; st.deaths = deaths; st.respawnT = respawnT; }
        const p = playerBySlot(g, slot);
        if (p) p.hp = hp;
      }
      if (left != null) g.coopLeft = Math.max(0, Math.min(g.coopLeft, left));
      this.hud(g, true);
    },

    /* ---- 事件：有人离开 / 房主没了 ---- */
    peerGone(g, id) {
      const r = (g.roomRoster || []).find((x) => x.id === id);
      if (!r) return;
      const name = LD.Skins.cleanName(r.name, r.slot);
      g.roomRoster = (g.roomRoster || []).filter((x) => x.id !== id);
      if (g.roomStats) delete g.roomStats[r.slot];
      const p = playerBySlot(g, r.slot);
      if (p) {
        g.players = g.players.filter((x) => x !== p);
        if (g.world) g.world.soft = g.players;
        if (g.pR === p) g.pR = g.players[0] || null;
        if (g.pB === p) g.pB = g.players[1] || g.players[0] || null;
      }
      flash(g, T_('room.left', { n: name }), 2200);
      if (g.roomInLobby) { this.refreshLobby(g); return; }
      if (g.roomOn && (g.roomRoster || []).length < 2) {
        // 人走光了：散打/合作都没法继续，回大厅等
        flash(g, T_('room.tooFew'), 2600);
        this.openLobby(g);
      }
    },

    hostGone(g) {
      const was = g.roomOn || g.roomInLobby;
      this.cleanup(g);
      if (was) flash(g, T_('online.peerLeft'), 2600);
      g.goHome();
    },

    /* ---------- 重开 / 下一关 / 再来一局 ---------- */
    restart(g) {
      if (!g.roomOn || g.roomMode === 'lobby') return;
      if (isHost(g)) this.startMatch(g, g.roomCfg);
      else {
        if (g.room) g.room.send({ t: 'restart' });
        flash(g, T_('online.waitHost'), 1200);
      }
    },

    next(g) {
      if (!g.roomOn) return;
      if (isHost(g)) {
        if (g.roomMode === 'coop') {
          // 闯关：5 关一回合 —— 打满 5 关出回合总排名，否则进下一关
          const roundN = (g.roomCfg && g.roomCfg.roundN) || 1;
          if (roundN >= ROUND_TOTAL) {
            this.roundSummary(g);
            return;
          }
          const cfg = Object.assign({}, g.roomCfg, {
            stage: clamp((g.roomCfg.stage || 1) + 1, 1, ROUND_TOTAL),
            roundN: roundN + 1,
          });
          if (g.room) g.room.send({ t: 'start', cfg });
          this.startMatch(g, cfg);
        } else if (g.roomMode === 'duo') {
          if (g.roomStage >= LD.COOP_COUNT) { this.openLobby(g); return; }
          const cfg = Object.assign({}, g.roomCfg, { stage: g.roomStage + 1 });
          if (g.room) g.room.send({ t: 'start', cfg });
          this.startMatch(g, cfg);
        } else {
          this.startMatch(g, g.roomCfg);
        }
      } else {
        if (g.room) g.room.send({ t: 'nextReq' });
        const b = $('btn-next');
        if (b) { b.textContent = T_('online.waitNext'); b.disabled = true; }
      }
    },

    /* 回合总排名：把 5 关的积分加起来排个名次 */
    roundSummary(g) {
      if (!g.roundPts) g.roundPts = {};
      const rank = (g.roomRoster || [])
        .map((r) => ({ slot: r.slot, name: LD.Skins.cleanName(r.name, r.slot), score: g.roundPts[r.slot] || 0, deaths: (g.roomStats[r.slot] || {}).deaths || 0 }))
        .sort((a, b) => b.score - a.score);
      if (g.room) g.room.send({ t: 'brawlEnd', rank, reason: 'round' });
      this.showRoomOver(g, rank, 'round', isHost(g));
    },

    again(g) {
      if (!g.room) return;
      if (isHost(g)) {
        /* 房主点再来一局：必须广播 start，否则其他玩家会停在结算页
           （之前只本地 startMatch，房客根本收不到任何消息）。 */
        g.room.send({ t: 'start', cfg: g.roomCfg });
        this.startMatch(g, g.roomCfg);
      } else { g.room.send({ t: 'nextReq' }); flash(g, T_('online.waitHost'), 1200); }
    },

    /* ---------- 离开 / 清理 ---------- */
    backToLobby(g) {
      this.openLobby(g);
    },

    leave(g) {
      this.cleanup(g);
      g.goHome();
    },

    /* 退出对局回大厅（人还在房间里） */
    exitMatch(g, keepRoster) {
      g.roomOn = false;
      g.roomEnded = false;      g.online = false;
      g._spectateOf = null;
      this.specTip(g, false);
      const tag = $('net-tag');
      if (tag) tag.classList.remove('on');
    },

    cleanup(g) {
      if (g.room) { try { g.room.close(); } catch (e) {} g.room = null; }
      g.roomOn = false;
      g.roomInLobby = false;
      g.roomEnded = false;
      g.online = false;
      g.roomRoster = [];
      g.roomPeers = new Map();
      g.roomReady = new Map();
      g.roomStats = {};
      g.roomSlots = [];
      const tag = $('net-tag');
      if (tag) tag.classList.remove('on');
      const rh = $('room-hud');
      if (rh) rh.classList.add('hidden');
    },

    /* ---------- 顶部房间 HUD ---------- */
    hud(g, force) {
      const el = $('room-hud');
      if (!el) return;
      if (!g.roomOn) { el.classList.add('hidden'); return; }
      el.classList.remove('hidden');
      const roster = g.roomRoster || [];
      const left = Math.max(0, g.coopLeft || 0);
      let html = '';
      if (g.roomMode === 'lobby') {
        el.innerHTML = '';               // 大厅场景：信息都浮在面板里，不占 HUD
        return;
      }
      if (g.roomMode === 'gffa' || g.roomMode === 'gteam' || g.roomMode === 'brawl') {
        const goal = (g.roomCfg && g.roomCfg.goal) || null;
        const goalTxt = (g.roomMode === 'gffa' || g.roomMode === 'gteam') && goal
          ? (goal.type === 'time' ? `${left >= 9998 ? '∞' : left.toFixed(0) + 's'}` : `${T_('room.goalKills')} ${goal.v}`)
          : `${left.toFixed(0)}s`;
        html += `<b class="rt">${g.roomMode === 'gteam' ? T_('room.modeGteam') : g.roomMode === 'gffa' ? T_('room.modeGffa') : T_('room.brawl')} · ${goalTxt}</b>`;
        const rows = roster.slice().sort((a, b) => (g.roomStats[b.slot].score - g.roomStats[a.slot].score));
        for (const r of rows) {
          const st = g.roomStats[r.slot] || { hp: 0, score: 0 };
          const sk = LD.Skins.resolve(r.skin);
          const mine = r.id === myId(g);
          const hpMax = (g.roomMode === 'gffa' || g.roomMode === 'gteam') ? LD.Guns.MAX_HP : BRAWL.hp;
          html +=
            `<span class="rp${mine ? ' me' : ''}">` +
            `<i style="background:${sk.body};box-shadow:0 0 6px ${sk.body}"></i>` +
            `${g.roomMode === 'gteam' ? (r.slot % 2 === 0 ? '🔴' : '🔵') : ''}${LD.Skins.cleanName(r.name, r.slot)} <b>${st.score}</b>` +
            `<em class="hpbar"><i style="width:${clamp(st.hp / hpMax * 100, 0, 100)}%;background:${st.hp > 40 ? '#35e0a1' : '#ff4d6d'}"></i></em>` +
            (st.respawnT > 0 ? `<u>${st.respawnT.toFixed(1)}s</u>` : '') +
            `</span>`;
        }
      } else if (g.roomMode === 'endless') {
        // 多人无尽：按每个人的最远距离实时排名
        html += `<b class="rt">${T_('room.modeEndless')} · ${T_('gun.distShort', { n: (g.roomStats[mySlot(g)] || {}).score || 0 })}</b>`;
        const rows = roster.slice().sort((a, b) => ((g.roomStats[b.slot] || {}).score || 0) - ((g.roomStats[a.slot] || {}).score || 0));
        for (const r of rows) {
          const st = g.roomStats[r.slot] || { score: 0, deaths: 0 };
          const sk = LD.Skins.resolve(r.skin);
          const mine = r.id === myId(g);
          html +=
            `<span class="rp${mine ? ' me' : ''}">` +
            `<i style="background:${sk.body};box-shadow:0 0 6px ${sk.body}"></i>` +
            `${LD.Skins.cleanName(r.name, r.slot)} <b>${T_('gun.distShort', { n: st.score || 0 })}</b>` +
            (st.deaths ? `<u>☠</u>` : '') +
            `</span>`;
        }
      } else {
        const roundN = (g.roomCfg && g.roomCfg.roundN) || 1;
        html += `<b class="rt">${T_('room.modeCoop')} ${g.roomStage}/${ROUND_TOTAL} · ${T_('room.roundN', { n: roundN })} · ${left.toFixed(0)}s</b>`;
        for (const r of roster) {
          const sk = LD.Skins.resolve(r.skin);
          const mine = r.id === myId(g);
          const ready = !!g.roomReady.get(r.slot);
          html +=
            `<span class="rp${mine ? ' me' : ''}${ready ? ' ok' : ''}">` +
            `<i style="background:${sk.body};box-shadow:0 0 6px ${sk.body}"></i>` +
            `${LD.Skins.cleanName(r.name, r.slot)}${ready ? ' ✓' : ''}</span>`;
        }
      }
      el.innerHTML = html;
    },

    /* ---------- 语言切换 / 按钮 ---------- */
    refreshText(g) {
      if (g.roomInLobby && g.state === 'lobby') this.refreshLobby(g);
      if (g.roomOn) this.hud(g, true);
    },

    bind(g) {
      const on = (id, fn) => {
        const el = $(id);
        if (el) el.onclick = fn;
      };
      on('btn-room-style', () => this.openStyle(g));
      on('btn-room-style-match', () => this.openStyleMatch(g));
      on('btn-room-leave', () => this.leave(g));
      on('btn-room-home', () => this.leave(g));
      on('btn-room-add', () => this.addSlot(g));
      on('btn-room-link', () => this.copyRoomLink(g));
      // 加入面板的「返回」→ 回旧控制面板（不再触发重新建房）
      on('btn-net-cancel', () => this.openOnlinePanel(g));
      // 大厅准备
      on('btn-room-ready', () => this.toggleReady(g));
      // 大厅里「加入其他房间」：房主切去别人的房间（输入 5 位房间号）
      on('btn-room-join', () => {
        const code = (($('room-join-code') || {}).value || '').trim().toUpperCase();
        if (!code) { flash(g, T_('room.notFound'), 1600); return; }
        this.cleanup(g);
        this.guestRoom(g, code);
        this.openLobby(g);
        flash(g, T_('room.waitHost'), 2200);
      });
      // 房主选模式（只有房主能选）
      const pickMode = (mode) => {
        if (!isHost(g) || !g.roomCfg) return;
        if (g.roomCfg.mode === mode) return;
        if (mode === 'duo' && (g.roomRoster || []).length > 2) { flash(g, T_('room.duoNeed2'), 2000); return; }
        g.roomCfg.mode = mode;
        if (mode === 'coop' || mode === 'duo') g.roomCfg.stage = 1;
        if (mode === 'gffa' || mode === 'gteam') g.roomCfg.goal = { type: 'time', v: 120 };
        this.syncLobbyReady(g);            // 换模式 → 全员重新准备
        this.cfgChanged(g);
        this.refreshLobby(g);
        LD.Sfx.ui();
      };
      on('btn-mode-coop', () => pickMode('coop'));
      on('btn-mode-gffa', () => pickMode('gffa'));
      on('btn-mode-gteam', () => pickMode('gteam'));
      on('btn-mode-duo', () => pickMode('duo'));
      on('btn-mode-endless', () => pickMode('endless'));
      on('btn-room-start', () => {
        if (!isHost(g) || !g.roomCfg) return;
        // 双人模式必须恰好 2 人；其余模式 1 人也能开（方便单人测试 / 单人大乱斗）
        if (g.roomCfg.mode === 'duo' && (g.roomRoster || []).length !== 2) { flash(g, T_('room.duoNeed2'), 1800); return; }
        if (!this.allLobbyReady(g)) { flash(g, T_('room.needReadyAll'), 1800); return; }
        g.roomCfg.roundN = 1;              // 从大厅开局：回合进度归零
        g.roundPts = {};
        if (g.room) g.room.send({ t: 'start', cfg: g.roomCfg });
        this.startMatch(g, g.roomCfg);
      });
      on('btn-style-save', () => {
        if (this._styleBack === 'match') { this._styleBack = null; this.saveStyle(g); if (g.roomOn) { g.state = 'playing'; g.closeAll(); g.last = performance.now(); } }
        else this.saveStyle(g);
      });
      on('btn-style-cancel', () => {
        if (this._styleBack === 'match') { this._styleBack = null; g.state = 'playing'; g.closeAll(); g.last = performance.now(); }
        else this.openLobby(g);
      });
      on('btn-room-again', () => this.again(g));
      on('btn-room-exit', () => this.openLobby(g));
    },
  };

  LD.RoomPlay = RoomPlay;
})();
