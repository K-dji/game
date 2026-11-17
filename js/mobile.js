/* mobile.js — 手机版：虚拟摇杆 + Poki 式全屏游玩
   摇杆造型参考《猫和老鼠》手游：左半屏任意位置按下即生成底盘（动态摇杆），
   拖到哪儿走哪儿；右侧一组圆形技能键（跳 / 拳·开火 / 下 / 暂停 / 重开 / 确认）。
   不改动游戏逻辑：所有虚拟按键都翻译成 LD.Input 的按键状态（down / edge），
   所以单人 / 双人 / 枪战 / 联机散打全都自动吃这套输入。

   全屏：优先用 Fullscreen API；iOS Safari 等不支持元素全屏的环境退化为
   「伪全屏」——body 加 class，画布铺满可视区，滚动隐藏，效果一致。 */
(function () {
  const $ = (id) => document.getElementById(id);
  const isTouch = () => (('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0);
  const KEY_FALL = {
    left: 'ArrowLeft', right: 'ArrowRight', down: 'ArrowDown', jump: 'ArrowUp',
    fire: 'KeyQ', confirm: 'Space', pause: 'Escape', restart: 'KeyR', select: 'KeyL',
  };
  function codeOf(action) {
    let list = [];
    try { if (LD.Settings && LD.Settings.keys) list = LD.Settings.keys(action) || []; } catch (e) {}
    return list[0] || KEY_FALL[action] || '';
  }
  function press(action, on) {
    const c = codeOf(action);
    if (!c || !LD.Input) return;
    const was = !!LD.Input.down[c];
    LD.Input.down[c] = !!on;
    /* 只在「由松到按」的沿上写 edge，否则 pointermove 反复调用会把 jumpPressed
       刷成连发，小人会一路自动连跳（bunny-hop）。 */
    if (on) { if (!was) LD.Input.edge[c] = true; }
    else LD.Input.edge[c] = false;
  }

  const CSS = `
  /* ---------- 虚拟摇杆（猫和老鼠风格） ---------- */
  #vjoy{position:absolute;inset:0;z-index:7;pointer-events:none;display:none;
    user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
  /* 只在真正对局中显示，避免挡住菜单 / 大厅的按钮 */
  body.joy-on #vjoy.active{display:block}
  body.joy-on #vjoy:not(.active){opacity:.28}
  #vjoy.active{opacity:1}
  #vjoy-zone{position:absolute;left:0;top:0;width:50%;height:100%;pointer-events:auto;touch-action:none}
  #vjoy-base{position:absolute;width:126px;height:126px;border-radius:50%;display:none;
    background:radial-gradient(circle at 50% 40%,rgba(255,255,255,.16),rgba(20,24,48,.42) 65%,rgba(10,12,26,.6));
    border:2px solid rgba(255,255,255,.35);box-shadow:0 0 0 7px rgba(255,255,255,.06),inset 0 0 22px rgba(0,0,0,.35);
    transform:translate(-50%,-50%);backdrop-filter:blur(2px)}
  #vjoy-base.on{display:block}
  #vjoy-base::before,#vjoy-base::after{content:"";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
    border:1px dashed rgba(255,255,255,.14);border-radius:50%}
  #vjoy-base::before{width:82px;height:82px}#vjoy-base::after{width:34px;height:34px}
  #vjoy-knob{position:absolute;left:50%;top:50%;width:58px;height:58px;border-radius:50%;
    transform:translate(-50%,-50%);
    background:radial-gradient(circle at 35% 30%,#fff3c4,#ffd23f 45%,#f08a2c 100%);
    border:3px solid rgba(255,255,255,.85);box-shadow:0 6px 16px rgba(0,0,0,.45),0 0 18px rgba(255,210,63,.5)}
  #vjoy-knob::after{content:"🐾";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    font-size:22px;opacity:.72}
  #vjoy-btns{position:absolute;right:0;bottom:0;width:50%;height:100%;pointer-events:none}
  .vbtn{position:absolute;pointer-events:auto;touch-action:none;border-radius:50%;
    display:flex;align-items:center;justify-content:center;flex-direction:column;
    color:#fff;font-weight:800;letter-spacing:1px;user-select:none;-webkit-user-select:none;
    border:2px solid rgba(255,255,255,.4);background:radial-gradient(circle at 35% 28%,rgba(255,255,255,.28),rgba(30,36,70,.72) 62%,rgba(12,15,32,.86));
    box-shadow:0 6px 18px rgba(0,0,0,.4),inset 0 0 16px rgba(255,255,255,.08);
    transition:transform .08s,filter .08s;backdrop-filter:blur(3px)}
  .vbtn small{display:block;font-size:9px;font-weight:600;opacity:.7;letter-spacing:0}
  .vbtn.down{transform:scale(.88);filter:brightness(1.5)}
  #vbtn-jump{right:26px;bottom:130px;width:88px;height:88px;font-size:24px;
    border-color:rgba(53,224,161,.75);box-shadow:0 0 22px rgba(53,224,161,.28),inset 0 0 18px rgba(53,224,161,.15)}
  #vbtn-fire{right:122px;bottom:56px;width:76px;height:76px;font-size:22px;
    border-color:rgba(255,93,122,.8);box-shadow:0 0 22px rgba(255,93,122,.3),inset 0 0 18px rgba(255,93,122,.15)}
  #vbtn-down{right:26px;bottom:42px;width:60px;height:60px;font-size:19px}
  #vbtn-confirm{right:206px;bottom:112px;width:60px;height:60px;font-size:16px}
  #vbtn-reload{right:206px;bottom:36px;width:60px;height:60px;font-size:15px;
    border-color:rgba(255,210,63,.75)}
  /* 技能键（顶栏技能槽=按 E 用掉木箱补给）：只在吸到技能时亮出 */
  #vbtn-skill{right:204px;bottom:130px;width:60px;height:60px;font-size:15px;
    border-color:rgba(126,231,255,.8);box-shadow:0 0 18px rgba(126,231,255,.3),inset 0 0 16px rgba(126,231,255,.12)}
  /* 枪战模式下开火键上移，给底部武器栏让位（拳/开火 与 物品栏不再重叠） */
  #vjoy.ctx-gun #vbtn-fire{right:118px;bottom:150px}
  /* 场景化显隐：确认 / ↓ / 换弹 / 技能默认不出现，只在对应场景亮出 */
  #vbtn-confirm,#vbtn-down,#vbtn-reload,#vbtn-skill{display:none}
  #vjoy.ctx-dialog #vbtn-confirm{display:flex}
  #vjoy.ctx-gun #vbtn-down{display:flex}
  #vjoy.ctx-gun #vbtn-reload{display:flex}
  #vjoy.ctx-skill #vbtn-skill{display:flex}
  /* 移动端武器栏：枪战时出现在底部（画布 hotbar 上方），点按切枪 */
  #mhot{position:absolute;left:50%;transform:translateX(-50%);bottom:74px;z-index:8;
    display:none;gap:6px;padding:5px 8px;border-radius:12px;pointer-events:auto;cursor:pointer;
    max-width:44%;flex-wrap:wrap;justify-content:center;
    background:rgba(12,10,26,.72);border:1px solid rgba(160,150,220,.35);backdrop-filter:blur(3px)}
  body.joy-on #mhot.on{display:flex}
  .mhot-cell{min-width:46px;padding:4px 6px;border-radius:8px;text-align:center;
    color:#e8ecff;font-size:10px;line-height:1.25;border:1px solid rgba(255,255,255,.22);
    background:rgba(40,44,80,.5);user-select:none;-webkit-user-select:none;touch-action:none}
  .mhot-cell b{display:block;font-size:11px;color:#ffd23f}
  .mhot-cell.on{border-color:#ffd23f;box-shadow:0 0 8px rgba(255,210,63,.5)}
  .mhot-cell.off{opacity:.35}
  .vmini{position:absolute;top:10px;width:44px;height:44px;font-size:16px;opacity:.7}
  #vbtn-pause{right:12px}#vbtn-restart{right:64px}
  #vjoy{opacity:.28}
  #vjoy.active{opacity:1}
  /* ---------- 全屏游玩（Poki 风格） ---------- */
  body.is-fs,body.pseudo-fs{padding:0!important;overflow:hidden!important;background:#000!important}
  body.is-fs #app,body.pseudo-fs #app{max-width:none!important;width:100%!important;height:100vh!important;
    height:100dvh!important;gap:0!important;padding:0!important;margin:0!important}
  body.is-fs .topbar,body.pseudo-fs .topbar{position:absolute;top:8px;right:8px;left:auto;z-index:20000;
    background:transparent;border:0;box-shadow:none;padding:0;opacity:.22;transition:opacity .2s}
  body.is-fs .topbar:hover,body.pseudo-fs .topbar:hover{opacity:1}
  /* 顶栏只保留右侧按钮组（音效 / 全屏 / 摇杆都要能用），标题与 HUD 收起 */
  body.is-fs .topbar>*:not(.actions),body.pseudo-fs .topbar>*:not(.actions){display:none}
  body.is-fs .topbar .actions{background:rgba(10,12,24,.7);border:1px solid rgba(42,48,84,.6);
    border-radius:12px;padding:4px 6px}
  body.is-fs footer,body.pseudo-fs footer{display:none!important}
  body.is-fs #stage,body.pseudo-fs #stage{flex:1;min-height:0;border:0;border-radius:0;box-shadow:none;
    background:#000;display:flex;align-items:center;justify-content:center}
  body.is-fs canvas,body.pseudo-fs canvas{width:min(100vw,calc(100dvh * 960 / 560))!important;
    height:auto!important;max-height:100dvh;margin:0 auto}
  body.is-fs .overlay,body.pseudo-fs .overlay{background:rgba(6,8,16,.94)}
  #rotate-tip{display:none;position:fixed;inset:0;z-index:99999;background:#0b0d16;color:#e8ecff;
    align-items:center;justify-content:center;flex-direction:column;gap:14px;text-align:center;padding:24px;font-size:15px}
  #rotate-tip .ricon{font-size:54px}
  @media (orientation:portrait) and (max-width:900px){
    body.joy-on.playing #rotate-tip{display:flex}
  }
  @media (max-width:700px){
    body{padding:6px}
    .overlay h2{font-size:22px}
    .overlay p{font-size:12px}
    .menu-btns button{padding:10px 14px;font-size:14px}
  }`;

  const Mobile = {
    g: null,
    enabled: false,
    fs: false,
    _stickId: null,
    _axisX: 0,
    _axisY: 0,
    _btnCodes: { 'vbtn-jump': 'jump', 'vbtn-fire': 'fire', 'vbtn-down': 'down',
                 'vbtn-confirm': 'confirm', 'vbtn-pause': 'pause', 'vbtn-restart': 'restart',
                 'vbtn-skill': 'usepick' },

    install(g) {
      this.g = g;
      const style = document.createElement('style');
      style.textContent = CSS;
      document.head.appendChild(style);

      const stage = $('stage');
      if (!stage) return;

      const wrap = document.createElement('div');
      wrap.id = 'vjoy';
      wrap.innerHTML =
        '<div id="vjoy-zone"></div>' +
        '<div id="vjoy-base"><div id="vjoy-knob"></div></div>' +
        '<div id="vjoy-btns">' +
          '<div class="vmini vbtn" id="vbtn-pause">⏸</div>' +
          '<div class="vmini vbtn" id="vbtn-restart">↻</div>' +
          '<div class="vbtn" id="vbtn-jump">跳<small>JUMP</small></div>' +
          '<div class="vbtn" id="vbtn-fire">拳<small>HIT</small></div>' +
          '<div class="vbtn" id="vbtn-down">↓</div>' +
          '<div class="vbtn" id="vbtn-reload">换弹<small>RELOAD</small></div>' +
          '<div class="vbtn" id="vbtn-skill">技<small>SKILL</small></div>' +
          '<div class="vbtn" id="vbtn-confirm">确认<small>OK</small></div>' +
        '</div>' +
        '<div id="mhot"></div>';
      stage.appendChild(wrap);

      const tip = document.createElement('div');
      tip.id = 'rotate-tip';
      tip.innerHTML = '<div class="ricon">📱↻</div><div data-i18n="mob.rotate">横屏游玩体验更好，请旋转手机</div>' +
                      '<button class="sm" id="btn-rotate-close" data-i18n="mob.rotateBtn">仍然继续</button>';
      document.body.appendChild(tip);
      const rc = $('btn-rotate-close');
      if (rc) rc.onclick = () => { tip.style.display = 'none'; };

      this._wireStick();
      this._wireButtons();

      // 触屏设备默认打开摇杆；桌面可用顶栏开关手动试
      let saved = null;
      try { saved = localStorage.getItem('yrzx_joy_v1'); } catch (e) {}
      this.setEnabled(saved == null ? isTouch() : saved === '1');

      const fsBtn = $('btn-fullscreen');
      if (fsBtn) fsBtn.onclick = () => this.toggleFs();
      const joyBtn = $('btn-joystick');
      if (joyBtn) joyBtn.onclick = () => this.setEnabled(!this.enabled);

      const onFsChange = () => {
        const el = document.fullscreenElement || document.webkitFullscreenElement || null;
        this.fs = !!el || document.body.classList.contains('pseudo-fs');
        document.body.classList.toggle('is-fs', !!el);
        const b = $('btn-fullscreen');
        if (b) b.textContent = this.fs ? '⛶' : '⛶';
        if (LD.I18N && LD.I18N.apply) LD.I18N.apply();
      };
      document.addEventListener('fullscreenchange', onFsChange);
      document.addEventListener('webkitfullscreenchange', onFsChange);
      window.addEventListener('orientationchange', () => setTimeout(() => window.scrollTo(0, 0), 120));

      // 只在真正开局时把摇杆点亮（菜单里半透明，不挡按钮）
      // 按键按场景显隐：确认（弹窗）/ ↓·换弹（枪战）/ 武器栏（枪战）
      const tick = () => {
        const playing = g && (g.state === 'playing' || g.state === 'dying');
        wrap.classList.toggle('active', !!playing);
        document.body.classList.toggle('playing', !!playing);
        /* 枪战上下文判定：手持枪械 / 关卡带枪 / 房间枪战模式都算 ——
           之前只认 player.gun，进图拿枪前会误显示「拳」 */
        const p0 = this._activePlayer();
        const gunCtx = !!(p0 && p0.gun) || !!(g && g.world && g.world.gun) ||
          !!(g && (g.roomMode === 'gffa' || g.roomMode === 'gteam' ||
                   g.roomMode === 'duel' || g.gunMode));
        /* 技能键：吸到顶栏技能槽（heldPickup）时才亮出 */
        const skillCtx = !!(p0 && p0.heldPickup);
        const dialog = !!(g && (g.state === 'coopWin' || g.state === 'coopFail' ||
                                g.state === 'duelOver' || g.state === 'gunOver' ||
                                g.state === 'endlessOver' || g.state === 'paused'));
        wrap.classList.toggle('ctx-gun', gunCtx);
        wrap.classList.toggle('ctx-skill', skillCtx);
        wrap.classList.toggle('ctx-dialog', dialog);
        const fb = $('vbtn-fire');
        if (fb) fb.innerHTML = gunCtx ? '开火<small>FIRE</small>' : '拳<small>HIT</small>';
        this._syncHotbar(gunCtx && playing);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },

    setEnabled(on) {
      this.enabled = !!on;
      document.body.classList.toggle('joy-on', this.enabled);
      const b = $('btn-joystick');
      if (b) b.style.opacity = this.enabled ? '1' : '.4';
      try { localStorage.setItem('yrzx_joy_v1', this.enabled ? '1' : '0'); } catch (e) {}
      if (!this.enabled) this._releaseAll();
    },

    /* ---- 动态摇杆：左半屏按下才出现底盘 ---- */
    _wireStick() {
      const zone = $('vjoy-zone'), base = $('vjoy-base'), knob = $('vjoy-knob');
      if (!zone || !base || !knob) return;
      const R = 46;
      const start = (e) => {
        if (!this.enabled || this._stickId != null) return;
        e.preventDefault();
        this._stickId = e.pointerId;
        try { zone.setPointerCapture(e.pointerId); } catch (err) {}
        const r = zone.getBoundingClientRect();
        base.style.left = (e.clientX - r.left) + 'px';
        base.style.top = (e.clientY - r.top) + 'px';
        base.classList.add('on');
        this._move(e);
      };
      const move = (e) => {
        if (e.pointerId !== this._stickId) return;
        e.preventDefault();
        this._move(e);
      };
      const end = (e) => {
        if (e.pointerId !== this._stickId) return;
        this._stickId = null;
        base.classList.remove('on');
        knob.style.transform = 'translate(-50%,-50%)';
        this._axisX = 0; this._axisY = 0;
        press('left', false); press('right', false); press('down', false);
      };
      zone.addEventListener('pointerdown', start);
      zone.addEventListener('pointermove', move);
      zone.addEventListener('pointerup', end);
      zone.addEventListener('pointercancel', end);
      zone.addEventListener('lostpointercapture', end);

      this._move = (e) => {
        const r = base.getBoundingClientRect();
        let dx = e.clientX - (r.left + r.width / 2);
        let dy = e.clientY - (r.top + r.height / 2);
        const len = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, R / len);
        dx *= k; dy *= k;
        knob.style.transform = 'translate(calc(-50% + ' + dx.toFixed(1) + 'px),calc(-50% + ' + dy.toFixed(1) + 'px))';
        const nx = dx / R, ny = dy / R;
        const DEAD = 0.28;
        const L = nx < -DEAD, Rt = nx > DEAD;
        const D = ny > 0.55, U = ny < -0.55;
        if (L !== (this._axisX < 0)) press('left', L);
        if (Rt !== (this._axisX > 0)) press('right', Rt);
        if (D !== (this._axisY > 0)) press('down', D);
        if (U !== (this._axisY < 0)) press('jump', U);   // 往上推 = 跳，猫和老鼠同款手感
        this._axisX = L ? -1 : (Rt ? 1 : 0);
        this._axisY = D ? 1 : (U ? -1 : 0);
      };
    },

    _wireButtons() {
      for (const id in this._btnCodes) {
        const el = $(id);
        if (!el) continue;
        const act = this._btnCodes[id];
        const down = (e) => {
          if (!this.enabled) return;
          e.preventDefault();
          try { el.setPointerCapture(e.pointerId); } catch (err) {}
          el.classList.add('down');
          press(act, true);
        };
        const up = (e) => {
          e.preventDefault();
          el.classList.remove('down');
          press(act, false);
        };
        el.addEventListener('pointerdown', down);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
        el.addEventListener('lostpointercapture', up);
      }
      /* 换弹键：直调枪械状态（输入系统里没有 reload 动作，换弹本来是自动的） */
      const rl = $('vbtn-reload');
      if (rl) {
        rl.addEventListener('pointerdown', (e) => {
          if (!this.enabled) return;
          e.preventDefault();
          rl.classList.add('down');
          this._doReload();
        });
        const rlUp = (e) => { e.preventDefault(); rl.classList.remove('down'); };
        rl.addEventListener('pointerup', rlUp);
        rl.addEventListener('pointercancel', rlUp);
        rl.addEventListener('lostpointercapture', rlUp);
      }
      /* 武器栏点按：点哪个武器切哪个（已拥有才生效） */
      const hot = $('mhot');
      if (hot) {
        hot.addEventListener('pointerdown', (e) => {
          const cell = e.target.closest('.mhot-cell');
          if (!cell || cell.classList.contains('off')) return;
          e.preventDefault();
          this._tapSlot(parseInt(cell.dataset.idx, 10) || 0);
        });
      }
    },

    /* 当前使用的玩家（联机=自己；单机=红方） */
    _activePlayer() {
      const g = this.g;
      if (!g) return null;
      return (g.roomOn && g.player) ? g.player : (g.pR || null);
    },

    _doReload() {
      const g = this.g, p = this._activePlayer();
      if (!g || !p || !p.gun) return;
      if (p.gun.isReloading || p.gun.isReloading()) return;
      p.gun.startReload(false);
    },

    _tapSlot(idx) {
      const g = this.g;
      if (!g) return;
      if (g.roomOn && LD.RoomPlay) LD.RoomPlay.slotTap(g, idx);
      else if (g._selectSlot && g.pR) g._selectSlot(g.pR, idx, null);
    },

    /* 武器栏内容：联机枪械全解锁；单机按解锁进度 */
    _syncHotbar(on) {
      const hot = $('mhot');
      const g = this.g;
      if (!hot || !g) return;
      if (!on) { hot.classList.remove('on'); return; }
      const p = this._activePlayer();
      if (!p || !p.gun) { hot.classList.remove('on'); return; }
      const guns = LD.Guns.WEAPONS.filter((w) => w.kind === 'gun');
      let unlocked;
      if (g.roomOn) unlocked = guns;                       // 联机：枪械自定义=全可用
      else {
        const stage = g.gunUnlockStage ? g.gunUnlockStage() : (g.gunStage || 0);
        unlocked = guns.filter((w) => LD.Guns.unlockedAt(w.id, stage));
      }
      if (!unlocked.length) { hot.classList.remove('on'); return; }
      const sig = unlocked.map((w) => w.id).join(',') + '|' + p.gun.weaponId;
      if (sig !== this._hotSig) {
        this._hotSig = sig;
        hot.innerHTML = '';
        unlocked.forEach((w) => {
          const idx = LD.Guns.SLOTS.indexOf(w.slot);
          const cell = document.createElement('div');
          cell.className = 'mhot-cell' + (w.id === p.gun.weaponId ? ' on' : '');
          cell.dataset.idx = String(idx);
          cell.innerHTML = '<b>' + w.slot + '</b>' + (LD.I18N.isLatin() ? w.nameEn : w.name);
          hot.appendChild(cell);
        });
      } else {
        hot.querySelectorAll('.mhot-cell').forEach((c) => {
          const idx = parseInt(c.dataset.idx, 10);
          const slot = LD.Guns.SLOTS[idx];
          c.classList.toggle('on', !!slot && p.gun.weapon().slot === slot);
        });
      }
      hot.classList.add('on');
    },

    _releaseAll() {
      for (const id in this._btnCodes) press(this._btnCodes[id], false);
      press('left', false); press('right', false); press('down', false); press('jump', false);
    },

    /* ---- 全屏 ---- */
    requestFs() {
      const el = document.documentElement;
      const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
      if (fn) {
        try {
          const r = fn.call(el);
          if (r && r.catch) r.catch(() => this._pseudoFs());
        } catch (e) { this._pseudoFs(); }
      } else this._pseudoFs();
      document.body.classList.add('is-fs');
      this.fs = true;
      // 安卓横屏后把地址栏收起来
      try { window.scrollTo(0, 1); } catch (e) {}
    },
    _pseudoFs() {
      document.body.classList.add('pseudo-fs');
      this.fs = true;
    },
    exitFs() {
      const fn = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      if (fn && (document.fullscreenElement || document.webkitFullscreenElement)) {
        try { fn.call(document); } catch (e) {}
      }
      document.body.classList.remove('is-fs', 'pseudo-fs');
      this.fs = false;
    },
    toggleFs() { if (this.fs) this.exitFs(); else this.requestFs(); },

    /* 供联机 / 房间面板用：当前是否触屏 */
    isTouch,
  };

  LD.Mobile = Mobile;
})();
