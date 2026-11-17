/* settings.js — 玩家设置：按键绑定（多选）/ 音乐 / 语言，存 localStorage */
(function () {
  const DEFAULTS = {
    keys: {
      left: ['ArrowLeft', 'KeyA'],
      right: ['ArrowRight', 'KeyD'],
      down: ['ArrowDown', 'KeyS', 'Space'],
      /* 跳跃：上键 / W。
         【用户需求 2026-10-10 键位重排】空格从「跳跃」挪到「下降」：
         下降 = ↓ / S / 空格；下一关（confirm）= 空格 / 回车 / 小回车。
         游戏中（playing）只读 jump / down，菜单态才读 confirm，各管各的状态。 */
      jump: ['ArrowUp', 'KeyW'],
      confirm: ['Space', 'Enter', 'NumpadEnter'],
      pause: ['Escape'],
      cheat: ['Digit0', 'Digit5', 'Numpad5'],
      // 双人模式：蓝魔（玩家 2）= WASD。红魔（玩家 1）仍用上面那套方向键 + A/D/W/S。
      p2left: ['KeyA'],
      p2right: ['KeyD'],
      p2down: ['KeyS'],
      p2jump: ['KeyW'],
      /* 枪战模式：开火 Q / J（平射、无自动瞄准，打高处的敌人靠跳）；
         技能（木箱补给）E / U。
         【用户需求 2026-10-10】上一把 / 下一把枪、通用道具键都删了 ——
         切枪走 F1~F10 槽位直选，道具（手雷 / 医药包）也走 F9 / F10 槽。 */
      fire: ['KeyQ', 'KeyJ'],
      usepick: ['KeyE', 'KeyU'],
      /* 枪械槽位直选键：F1~F10 对应武器表里的 F1~F10 槽。
         「F1—F8 按了切换不了」的根因是这两件事凑在一起：
           1) F1~F12 原来被整段列为「保留键」，装不进任何动作；
           2) 武器只是**名字**叫 F1~F8，实际只有 E / Q 循环切枪。
         现在每个槽位都是独立动作，默认就是它自己的 F 键，
         并且和开火 / 道具一样可以在「操作设置」里改（也可以改绑数字键）。
         【用户需求：F8 追踪无人机 / F9 手雷 / F10 医药包】
         F10 原来是保留键（浏览器菜单栏），现在拿出来给医药包用 ——
         保留键缩到 F11~F12（那两个键浏览器不允许页面拦截，绑上去必定失效）。 */
      gun1: ['F1'], gun2: ['F2'], gun3: ['F3'], gun4: ['F4'],
      gun5: ['F5'], gun6: ['F6'], gun7: ['F7'], gun8: ['F8'],
      gun9: ['F9'], gun10: ['F10'],
      // 双人对枪：蓝方（玩家 2）开火 0 / 小0、道具 . / *（小键盘乘号）
      p2fire: ['Digit0', 'Numpad0'],
      p2item: ['Period', 'NumpadMultiply'],
    },
    cheatNeed: 5,
    music: { track: 'neon', volume: 0.45, on: true },
    sfx: { volume: 0.8, on: true },
    lang: 'zh',
    /* 枪战模式配置 */
    gun: {
      p1: 'pistol',      // 双人对枪：红方枪械
      p2: 'pistol',      // 双人对枪：蓝方枪械
      rounds: 10,        // 双人对枪：回合数（用户需求：默认 10，可在操作设置中调节）
      botItems: true,    // 人机是否会用道具（手雷 / 无人机）
    },
  };

  /* 保留键：F11~F12 完全留空给浏览器（F11 全屏 / F12 开发者工具，
     这两个浏览器不允许页面拦截，绑上去必定失效）。
     F1~F10 现在**可以**绑定 —— F1~F8 是枪械槽位键，F9 手雷、F10 医药包。
     浏览器对这 10 个键的默认行为（F1 帮助 / F3 查找 / F5 刷新 / F6 地址栏 /
     F7 光标浏览 / F10 菜单栏）在 util.js 里用 preventDefault 挡掉了，不会被抢走。 */
  const RESERVED = ['F11', 'F12'];
  const isReserved = (code) => RESERVED.indexOf(code) >= 0;

  /* 每个动作允许绑定的候选键（UI 上以按钮形式多选） */
  const CANDIDATES = {
    left: ['ArrowLeft', 'KeyA', 'Numpad4'],
    right: ['ArrowRight', 'KeyD', 'Numpad6'],
    down: ['ArrowDown', 'KeyS', 'Numpad2', 'Space'],
    jump: ['ArrowUp', 'KeyW', 'Numpad8', 'KeyZ'],
    confirm: ['Space', 'Enter', 'NumpadEnter'],
    pause: ['Escape', 'KeyP'],
    cheat: ['Digit5', 'Numpad5', 'Digit0', 'Backquote', 'KeyC'],
    p2left: ['KeyA', 'KeyJ'],
    p2right: ['KeyD', 'KeyF'],
    p2down: ['KeyS', 'KeyK'],
    p2jump: ['KeyW', 'KeyI'],
    fire: ['KeyF', 'KeyJ', 'KeyQ', 'KeyH', 'Semicolon'],
    usepick: ['KeyE', 'KeyU'],
    /* 槽位直选的候选键：自己的 F 键 + 同数字的主键盘 / 小键盘。
       有些浏览器 / 输入法会吃掉 F 键，这时改绑数字键就是退路；
       实在都不行的还能用 E / [ 循环切枪。 */
    gun1: ['F1', 'Digit1', 'Numpad1'],
    gun2: ['F2', 'Digit2', 'Numpad2'],
    gun3: ['F3', 'Digit3', 'Numpad3'],
    gun4: ['F4', 'Digit4', 'Numpad4'],
    gun5: ['F5', 'Digit5', 'Numpad5'],
    gun6: ['F6', 'Digit6', 'Numpad6'],
    gun7: ['F7', 'Digit7', 'Numpad7'],
    gun8: ['F8', 'Digit8', 'Numpad8'],
    gun9: ['F9', 'Digit9', 'Numpad9'],
    gun10: ['F10', 'Digit0', 'Numpad0'],
    p2fire: ['Digit0', 'Numpad0', 'Slash'],
    p2item: ['Period', 'NumpadMultiply', 'KeyO'],
  };

  const ORDER = ['left', 'right', 'down', 'jump', 'confirm', 'pause', 'cheat'];
  const ORDER2 = ['p2left', 'p2right', 'p2down', 'p2jump'];
  /* 枪战模式键位（红方 + 蓝方）。
     槽位直选 gun1~gun10 是「按 F1 就出手枪」那条路；上一把 / 下一把枪已删。 */
  const ORDER_GUN = [
    'fire', 'usepick',
    'gun1', 'gun2', 'gun3', 'gun4', 'gun5', 'gun6', 'gun7', 'gun8', 'gun9', 'gun10',
  ];
  const ORDER_GUN2 = ['p2fire', 'p2item'];
  const ALL_ORDER = ORDER.concat(ORDER2, ORDER_GUN, ORDER_GUN2);

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const unique = (a) => a.filter((v, i) => a.indexOf(v) === i && !isReserved(v));

  const Settings = {
    KEY: 'level_devil_settings_v1',
    DEFAULTS, CANDIDATES, ORDER, ORDER2, ORDER_GUN, ORDER_GUN2, RESERVED,
    data: null,

    load() {
      let d = null;
      try { d = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch (e) { d = null; }
      const base = clone(DEFAULTS);
      if (d && typeof d === 'object') {
        if (d.keys) {
          /* 历史迁移：老版本把「回车 / 小回车」混在 jump 里 → 摘到 confirm。 */
          const legacy = (d.keys.jump || []).filter((c) => c === 'Enter' || c === 'NumpadEnter');
          const jumpKeys = (d.keys.jump || []).filter((c) => legacy.indexOf(c) < 0);
          for (const k in base.keys) {
            if (Array.isArray(d.keys[k]) && d.keys[k].length) base.keys[k] = unique(d.keys[k].slice(0, 6));
          }
          if (jumpKeys.length) base.keys.jump = unique(jumpKeys);
          const merged = unique(base.keys.confirm.concat(legacy));
          if (merged.length) base.keys.confirm = merged;
          /* 迁移（【用户需求 2026-10-10：键位布局重排】）：
             下面这些动作被用户明确定死了，老存档一律强制成新默认 ——
             否则「新档生效、老档不生效」，玩家会看到「改了但按下去还是旧行为」：
               · 空格从「跳跃」挪到「下降」（跳跃只剩 ↑ / W）
               · 开火 Q/J、技能 E/U、作弊 0/5/小5、蓝方开火 0/小0、道具 ./*
             删掉的四个动作（重开 / 关卡选择 / 静音 / 道具 / 上一把下一把枪）
             不在 base.keys 里了，老档里的旧键自然作废、不会再被读到。 */
          const FORCE = {
            left: ['ArrowLeft', 'KeyA'],
            right: ['ArrowRight', 'KeyD'],
            down: ['ArrowDown', 'KeyS', 'Space'],
            jump: ['ArrowUp', 'KeyW'],
            confirm: ['Space', 'Enter', 'NumpadEnter'],
            cheat: ['Digit0', 'Digit5', 'Numpad5'],
            fire: ['KeyQ', 'KeyJ'],
            usepick: ['KeyE', 'KeyU'],
            p2left: ['KeyA'], p2right: ['KeyD'], p2down: ['KeyS'], p2jump: ['KeyW'],
            p2fire: ['Digit0', 'Numpad0'],
            p2item: ['Period', 'NumpadMultiply'],
          };
          for (const a in FORCE) base.keys[a] = clone(FORCE[a]);
          /* 槽位键兜底：老存档可能缺 gun10（F10 当年是保留键） */
          if (base.keys.gun10 && base.keys.gun10.indexOf('F10') < 0) {
            base.keys.gun10 = unique(base.keys.gun10.concat(['F10']));
          }
        }
        if (typeof d.cheatNeed === 'number') base.cheatNeed = LD.clamp(Math.round(d.cheatNeed), 2, 9);
        if (d.music) Object.assign(base.music, d.music);
        if (d.sfx) Object.assign(base.sfx, d.sfx);
        if (d.lang) base.lang = (LD.I18N && LD.I18N.langs && LD.I18N.langs[d.lang]) ? d.lang : 'zh';
        // 枪战模式配置（老存档没有这个字段）
        if (d.gun && typeof d.gun === 'object') {
          const g = d.gun;
          const okW = (id) => (LD.Guns && LD.Guns.byId[id]) ? id : 'pistol';
          if (g.p1) base.gun.p1 = okW(g.p1);
          if (g.p2) base.gun.p2 = okW(g.p2);
          if (typeof g.rounds === 'number') base.gun.rounds = LD.clamp(Math.round(g.rounds), 1, 30);
          if (typeof g.botItems === 'boolean') base.gun.botItems = g.botItems;
        }
      }
      for (const k in base.keys) base.keys[k] = unique(base.keys[k]);
      if (!base.keys.confirm.length) base.keys.confirm = clone(DEFAULTS.keys.confirm);
      this.data = base;
      return base;
    },

    flush() {
      try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch (e) { /* 隐私模式忽略 */ }
    },

    reset() {
      this.data = clone(DEFAULTS);
      this.flush();
      return this.data;
    },

    /* 设置里没定义的动作（restart / select / pause / mute 这些老快捷键）
       回退到 Input.FALLBACK —— 之前这里直接返回 []，导致 R 重开 / L 选关 / Esc 暂停
       这些快捷键在设置加载完成后悄悄失效；虚拟摇杆也靠这个兜底取键。 */
    keys(action) {
      const list = this.data.keys[action];
      if (list && list.length) return list;
      const fb = LD.Input && LD.Input.FALLBACK ? LD.Input.FALLBACK[action] : null;
      return (fb && fb.length) ? fb.slice() : [];
    },
    hasKey(action, code) { return this.keys(action).indexOf(code) >= 0; },

    // 多选：已绑定则解绑，未绑定则绑定；至少保留一个键
    toggleKey(action, code) {
      if (isReserved(code)) return { ok: false, reason: 'reserved' };
      const list = this.keys(action).slice();
      const i = list.indexOf(code);
      if (i >= 0) {
        if (list.length <= 1) return { ok: false, reason: 'needOne' };
        list.splice(i, 1);
      } else {
        if (list.length >= 6) return { ok: false, reason: 'tooMany' };
        list.push(code);
      }
      this.data.keys[action] = list;
      this.flush();
      return { ok: true };
    },

    // 某个 code 是否被除了 action 之外的动作占用
    conflict(action, code) {
      for (const a of ALL_ORDER) {
        if (a !== action && this.hasKey(a, code)) return a;
      }
      return null;
    },

    /* 双人模式用：所有已经分给蓝魔（玩家 2）的键。
       红魔的输入会把这些键排除掉，避免按一下 D 两个人一起动。 */
    coopKeyUnion() {
      const out = [];
      for (const a of ORDER2) {
        for (const c of this.keys(a)) if (out.indexOf(c) < 0) out.push(c);
      }
      return out;
    },

    /* 双人对枪用：所有已经分给蓝方（玩家 2）的键（移动 + 开火 + 道具） */
    gunKeyUnion() {
      const out = this.coopKeyUnion().slice();
      for (const a of ORDER_GUN2) {
        for (const c of this.keys(a)) if (out.indexOf(c) < 0) out.push(c);
      }
      return out;
    },

    label(action) {
      return this.keys(action).map((c) => LD.I18N.keyLabel(c)).join(' / ');
    },

    /* 双人模式专用：只显示「实际生效」的键。
       默认绑定里 A / D / W 同时挂在移动 / 跳跃上，但双人模式下这几个键要让给蓝魔
       （红魔的输入会把它们排除掉）。菜单如果直接显示 label()，
       就会写成「← / A / → / D / ↑ / W 红魔（玩家 1）」，看上去红魔也能用 WASD，是误导。 */
    labelExcept(action, exclude) {
      const ex = exclude || [];
      const list = this.keys(action).filter((c) => ex.indexOf(c) < 0);
      return list.length ? list.map((c) => LD.I18N.keyLabel(c)).join(' / ') : '—';
    },
  };

  LD.Settings = Settings;
})();
