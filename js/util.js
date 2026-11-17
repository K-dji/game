/* util.js — 常量 / 工具 / 输入 / 音效 / 存档 */
const LD = window.LD || (window.LD = {});

LD.TILE = 40;
LD.ROWS = 14;
LD.VIEW_W = 960;
LD.VIEW_H = LD.ROWS * LD.TILE; // 560

LD.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
LD.lerp = (a, b, t) => a + (b - a) * t;
LD.rectHit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
LD.overlap = (a, b, pad) => {
  const p = pad || 0;
  return a.x + p < b.x + b.w - p && a.x + a.w - p > b.x + p &&
         a.y + p < b.y + b.h - p && a.y + a.h - p > b.y + p;
};

/* 确定性随机数：同一关卡每次生成完全一致 */
LD.mulberry32 = function (seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/* 解锁 / 作弊口令：明文已移除，统一走 js/secret.js 的加盐 SHA-256 校验。
   不要再往这里写任何明文常量，试玩工具也请用 LD.Secret.check()。 */

/* 浏览器的默认快捷键抢键清单 —— 这些键在游戏里有用，必须先 preventDefault，
   否则玩家一按就「打开了帮助页 / 跳转到查找框 / 整页刷新 / 光标焦点跑到地址栏」。
     F1 帮助 · F3 页内查找 · F5 刷新 · F6 地址栏 · F7 光标浏览
     F10 菜单栏（IE / 部分浏览器的历史行为）
   方向键 / 空格也一起挡掉：它们会让页面滚动。
   F11 / F12 拦不住（浏览器硬保留），所以那两键干脆不给人绑。 */
const BROWSER_STEAL = [
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10',
];

/* ---------------- 输入（按键绑定可在「操作设置」里改，支持一个动作绑多个键） ---------------- */
LD.Input = {
  down: {},
  edge: {},
  _cheatTimes: [],
  cheatPulse: 0,          // 连击进度，用于 UI 反馈
  onCheatToggle: null,
  onCheatPulse: null,
  onAnyKey: null,         // 设置面板录制按键时用
  // 兜底默认值：设置模块未加载时也能玩
  FALLBACK: {
    left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
    down: ['ArrowDown', 'KeyS'], jump: ['ArrowUp', 'KeyW', 'Space'],
    confirm: ['Space', 'Enter', 'NumpadEnter'],
    restart: ['KeyR'], pause: ['Escape'], select: ['KeyL'], mute: ['KeyM'],
    cheat: ['Digit5', 'Numpad5'],
    fire: ['KeyF', 'KeyJ', 'KeyQ'], nextgun: ['KeyE'], prevgun: ['BracketLeft'], useitem: ['KeyG', 'KeyK'],
    gun1: ['F1'], gun2: ['F2'], gun3: ['F3'], gun4: ['F4'],
    gun5: ['F5'], gun6: ['F6'], gun7: ['F7'], gun8: ['F8'], gun9: ['F9'], gun10: ['F10'],
    p2left: ['KeyA'], p2right: ['KeyD'], p2down: ['KeyS'], p2jump: ['KeyW'],
  },

  init() {
    if (this._inited) return;
    this._inited = true;
    const onKeyDown = (e) => {
      // 焦点在输入框里时（解锁密码框）不当作游戏按键，避免抢走空格/方向键
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (BROWSER_STEAL.indexOf(e.code) >= 0) e.preventDefault();
      if (e.__ldSeen) return;                     // 同一个事件只处理一次（window / document 双绑时靠它去重）
      e.__ldSeen = true;
      if (this.onAnyKey) this.onAnyKey(e);
      if (e.repeat) return;                       // 长按不算连击
      this.down[e.code] = true;
      this.edge[e.code] = true;
      /* cheatSuspended：某些模式会把数字键挪作他用（枪战训练场里 0~9 全是训练热键，
         而作弊键默认就是数字 5）。那种模式下暂停作弊连击的统计，
         否则按一下「血量翻倍」会同时记一次连击，连按 5 次弹出一个无敌模式。
         注意只是不计数，键本身照常进 down / edge。 */
      if (!this.cheatSuspended && this.isCheatKey(e)) this.handleCheatKey();
    };
    const onKeyUp = (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      this.down[e.code] = false;
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('keydown', onKeyDown);   // 兜底：焦点落在内部元素上时也能收到
    window.addEventListener('keyup', onKeyUp);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => { this.down = {}; });
  },

  /* ---------- 按键表 ---------- */
  keyList(action) {
    const S = LD.Settings;
    if (S && S.data) return S.keys(action);
    return this.FALLBACK[action] || [];
  },

  cheatNeed() {
    const S = LD.Settings;
    return S && S.data ? S.data.cheatNeed : 5;
  },

  cheatKeyLabel() {
    const k = this.keyList('cheat')[0];
    return k ? LD.I18N.keyLabel(k) : '5';
  },

  // 判断这次按键是否命中作弊键（兼容主键盘 / 小键盘 / 非标准 e.code）
  isCheatKey(e) {
    const list = this.keyList('cheat');
    if (list.indexOf(e.code) >= 0) return true;
    const ch = e.key;
    const map = {
      '5': ['Digit5', 'Numpad5'], '0': ['Digit0'],
      '`': ['Backquote'], 'c': ['KeyC'], 'C': ['KeyC'],
    };
    if (ch && map[ch] && map[ch].some((c) => list.indexOf(c) >= 0)) return true;
    if (e.keyCode === 53 && (list.indexOf('Digit5') >= 0 || list.indexOf('Numpad5') >= 0)) return true;
    if (e.keyCode === 48 && list.indexOf('Digit0') >= 0) return true;
    return false;
  },

  handleCheatKey() {
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const need = this.cheatNeed();
    const t = this._cheatTimes;
    if (t.length && now - t[t.length - 1] > this.CHEAT_WINDOW) t.length = 0;
    t.push(now);
    if (t.length >= need) {
      t.length = 0;
      this.cheatPulse = 0;
      if (this.onCheatPulse) this.onCheatPulse(0);
      if (this.onCheatToggle) this.onCheatToggle();
      return;
    }
    this.cheatPulse = t.length;
    if (this.onCheatPulse) this.onCheatPulse(this.cheatPulse);
  },

  /* ---------- 查询 ---------- */
  isDown(...codes) { return codes.some((c) => !!this.down[c]); },
  pressed(...codes) { return codes.some((c) => !!this.edge[c]); },
  endFrame() { this.edge = {}; },

  any(action) {
    const list = this.keyList(action);
    for (let i = 0; i < list.length; i++) if (this.down[list[i]]) return true;
    return false;
  },
  actionPressed(action) {
    const list = this.keyList(action);
    for (let i = 0; i < list.length; i++) if (this.edge[list[i]]) return true;
    return false;
  },
  /* 双人模式：红魔要「让出」所有已经分给蓝魔的键，否则默认键位里 WASD 同时绑在
     单人动作上，按一下 D 两个人一起动。这两个方法就是那个过滤。 */
  anyExcept(action, exclude) {
    const list = this.keyList(action);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (exclude.indexOf(c) >= 0) continue;
      if (this.down[c]) return true;
    }
    return false;
  },
  actionPressedExcept(action, exclude) {
    const list = this.keyList(action);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (exclude.indexOf(c) >= 0) continue;
      if (this.edge[c]) return true;
    }
    return false;
  },

  /* 枪械槽位直选：这次按下的是哪个槽？返回 { idx, code }，没按返回 null。
       idx 0 = F1 手枪 … 7 = F8 追踪无人机 … 8 = F9 手雷 … 9 = F10 医药包。
       code 是实际命中的键，方便调用方避开「同一个键同时绑着作弊」这类撞车
       （撞车时让作弊优先，不静默双触发）。
       上界是 SLOTS 的长度（10）—— 早先写死 9，F10 这个槽会变成「按了没反应」。 */
  slotHit(exclude) {
    const ex = exclude || [];
    const n = (LD.Guns && LD.Guns.SLOTS && LD.Guns.SLOTS.length) || 10;
    for (let i = 0; i < n; i++) {
      const codes = this.keyList('gun' + (i + 1));
      for (let k = 0; k < codes.length; k++) {
        const c = codes[k];
        if (ex.indexOf(c) >= 0) continue;
        if (this.edge[c]) return { idx: i, code: c };
      }
    }
    return null;
  },

  left() { return this.any('left'); },
  right() { return this.any('right'); },
  up() { return this.any('jump'); },
  downKey() { return this.any('down'); },
  jumpPressed() { return this.actionPressed('jump'); },
  jumpHeld() { return this.any('jump'); },
  /* 确认 / 下一关：使用独立的 confirm 动作（空格 + 回车），
     与 jump 完全解耦 —— 否则玩家一改跳跃键，「空格进下一关」就静默失效。 */
  confirmPressed() { return this.actionPressed('confirm'); },
  confirmHeld() { return this.any('confirm'); },
};

LD.Input.CHEAT_WINDOW = 2200;   // 相邻两次连击按键的最大间隔

/* ---------------- 音效（WebAudio 合成） ---------------- */

/* 每把武器一套音色参数。
   原来所有枪共用同一个 Sfx.tick()（880Hz 方波 40ms），
   手枪、狙击枪、火箭筒打起来一模一样 —— 需求里「枪械音效要符合」缺的就是这张表。

   两个可调维度：
     dur / freq / vol   噪声爆破的长度、低通截止、峰值音量
                        （截止越高越「脆亮」，越低越「沉闷」）
     tone              叠在上面的频率扫描 [起始Hz, 结束Hz, 时长, 波形, 音量]
                        （往下扫＝沉重后坐，往上扫＝轻快）
     hiss               额外一段推进器嘶声（只有火箭筒需要）
   听感对照：
     手枪   短促偏亮、下扫快        冲锋枪 更短更轻，连发不糊
     狙击枪 长而闷、下扫到很低      火箭筒 先嘶后炸，发射与爆炸分得开
     四联   火箭筒的紧凑版          道具   走电子音，不用火药声 */
const GUN_VOICE = {
  pistol: { dur: 0.075, freq: 2800, vol: 0.085, tone: [1150, 340, 0.05, 'square', 0.030] },
  smg: { dur: 0.045, freq: 3400, vol: 0.050, tone: [1500, 760, 0.03, 'square', 0.018] },
  sniper: { dur: 0.210, freq: 1050, vol: 0.130, tone: [250, 62, 0.24, 'sawtooth', 0.050] },
  rpg: { dur: 0.200, freq: 720, vol: 0.120, tone: [150, 46, 0.28, 'sawtooth', 0.045], hiss: 0.17 },
  quad: { dur: 0.160, freq: 880, vol: 0.100, tone: [190, 58, 0.22, 'sawtooth', 0.040], hiss: 0.11 },
  grenade: { dur: 0.055, freq: 2600, vol: 0.045, tone: [720, 940, 0.06, 'triangle', 0.030] },
  drone: { dur: 0.045, freq: 5200, vol: 0.035, tone: [1750, 2450, 0.07, 'sine', 0.030] },
  bomb: { dur: 0.055, freq: 4200, vol: 0.045, tone: [880, 2250, 0.17, 'sawtooth', 0.035] },
  medkit: { dur: 0.035, freq: 3000, vol: 0.025, tone: [680, 1010, 0.16, 'sine', 0.035] },
};

LD.Sfx = {
  ctx: null,
  master: null,
  volume: 0.8,
  muted: false,
  init() {
    if (!this.ctx && typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; }
    }
    if (this.ctx && !this.master) {
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return !!this.ctx;
  },
  out() {
    this.init();
    return this.master || this.ctx.destination;
  },
  setVolume(v) {
    this.volume = LD.clamp(v, 0, 1);
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  },
  setMuted(m) {
    this.muted = !!m;
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  },
  tone(freq, dur, type, vol, delay) {
    if (this.muted) return;
    if (!this.init()) return;
    const t0 = this.ctx.currentTime + (delay || 0);
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol == null ? 0.05 : vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.master || this.ctx.destination);
    o.start(t0); o.stop(t0 + dur + 0.03);
  },
  seq(list) { list.forEach((n, i) => this.tone(n[0], n[1], n[2] || 'triangle', n[3] == null ? 0.06 : n[3], i * 0.075)); },

  /* 频率扫描：从 f0 滑到 f1。枪声的「后坐力感」全在这条下滑线上。 */
  sweep(f0, f1, dur, type, vol, delay) {
    if (this.muted) return;
    if (!this.init()) return;
    const t0 = this.ctx.currentTime + (delay || 0);
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(Math.max(1, f0), t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    g.gain.setValueAtTime(vol == null ? 0.04 : vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.master || this.ctx.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  },

  /* 白噪声爆破 —— 火药的「炸响」。
     只生成一段 1 秒的噪声 buffer 复用（随机取偏移），
     不这么做的话每开一枪都要 new 一个 buffer，
     冲锋枪 / 无敌模式一秒几十发时会有明显的 GC 卡顿。 */
  _noise() {
    if (this._nb && this._nb.sampleRate === this.ctx.sampleRate) return this._nb;
    const n = Math.floor(this.ctx.sampleRate);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this._nb = buf;
    return buf;
  },
  noise(dur, vol, freq, type, delay, q) {
    if (this.muted) return;
    if (!this.init()) return;
    const t0 = this.ctx.currentTime + (delay || 0);
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise();
    const f = this.ctx.createBiquadFilter();
    f.type = type || 'lowpass';
    f.frequency.value = freq || 1800;
    if (q != null) f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol == null ? 0.06 : vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.master || this.ctx.destination);
    src.start(t0, Math.random() * Math.max(0, 1 - dur), dur + 0.02);
  },

  /* ---------- 枪械音效 ----------
     k 是音量倍率：人机开火传一个小值，免得「十个人机一起打」把玩家耳朵打爆。 */
  shot(id, k) {
    const v = GUN_VOICE[id] || GUN_VOICE.pistol;
    const s = k == null ? 1 : k;
    if (v.tone) this.sweep(v.tone[0], v.tone[1], v.tone[2], v.tone[3], v.tone[4] * s);
    if (v.hiss) this.noise(v.hiss, 0.030 * s, 1100, 'bandpass', 0, 1.1);
    this.noise(v.dur, v.vol * s, v.freq);
  },
  /* 爆炸：低频轰鸣 + 一层拉开的高频碎裂 */
  boom(k) {
    const s = k == null ? 1 : k;
    this.noise(0.42, 0.150 * s, 380, 'lowpass');
    this.noise(0.13, 0.055 * s, 2600, 'highpass', 0.01);
    this.sweep(170, 32, 0.50, 'sawtooth', 0.095 * s);
  },
  /* 命中（打在人或木箱上）：闷闷的一记 */
  hit() { this.noise(0.05, 0.048, 1500, 'bandpass', 0, 0.9); this.sweep(430, 150, 0.08, 'square', 0.030); },
  /* 换弹：拍进弹匣 + 拉机柄两下；换好再补一声上膛 */
  reload() { this.tone(300, 0.045, 'square', 0.030); this.tone(175, 0.060, 'square', 0.028, 0.14); },
  reloadDone() { this.tone(520, 0.055, 'square', 0.032); this.tone(780, 0.075, 'triangle', 0.026, 0.06); },
  /* 空仓：干涩的「咔」 */
  empty() { this.tone(135, 0.035, 'square', 0.028); this.noise(0.03, 0.028, 3000, 'highpass'); },
  /* 切枪：轻快两连音 */
  switchGun() { this.tone(620, 0.04, 'triangle', 0.030); this.tone(880, 0.05, 'triangle', 0.024, 0.05); },
  thrown() { this.sweep(880, 300, 0.16, 'triangle', 0.032); },
  heal() { this.seq([[520, 0.10, 'sine', 0.032], [700, 0.10, 'sine', 0.032], [950, 0.20, 'sine', 0.038]]); },
  pickup() { this.seq([[880, 0.07, 'square', 0.028], [1320, 0.10, 'square', 0.028]]); },
  jump() { this.tone(430, 0.1, 'square', 0.035); },
  land() { this.tone(190, 0.05, 'sine', 0.025); },
  die() { this.tone(260, 0.09, 'sawtooth', 0.05); this.tone(120, 0.4, 'sawtooth', 0.05, 0.08); },
  win() { this.seq([[660, 0.14], [880, 0.14], [1320, 0.22, 'triangle', 0.07]]); },
  cheat() { this.seq([[440, 0.12, 'sawtooth', 0.05], [660, 0.12, 'sawtooth', 0.05], [880, 0.12, 'sawtooth', 0.05], [1320, 0.12, 'sawtooth', 0.05], [1760, 0.26, 'sawtooth', 0.06]]); },
  tick() { this.tone(880, 0.04, 'square', 0.02); },
  ui() { this.tone(720, 0.05, 'triangle', 0.03); },
  trap() { this.tone(140, 0.13, 'square', 0.04); },
  final() { this.seq([[523, .16], [659, .16], [784, .16], [1046, .16], [1318, .4, 'triangle', .08]]); },
};

/* ---------------- 存档 ---------------- */
LD.Save = {
  KEY: 'level_devil_save_v1',
  data: null,
  // endless：无尽模式的分数存档（best 最高分 / last 上次分数 / bestStage 最远层数 / runs 局数）
  DEFAULTS: {
    unlocked: 1, cleared: {}, best: {}, totalDeaths: 0, cheatUsed: false,
    endless: { best: 0, last: 0, bestStage: 0, runs: 0 },
    coop: { unlocked: 1, cleared: {}, deaths: 0, best: {}, score: 0 },
    /* 枪战模式存档：
       unlocked   —— 已解锁到第几关（同时决定有哪些枪械可用，F1~F9 按关卡解锁）
       cleared    —— 通关记录
       bestStage  —— 最远打到的关卡
       score/kills—— 累计分数 / 累计击杀
       endless*   —— 枪战无尽快捷分
       duelWins   —— 双人对枪累计胜场（红 / 蓝） */
    gun: {
      unlocked: 1, cleared: {}, bestStage: 0, score: 0, kills: 0,
      endlessBest: 0, endlessLast: 0, endlessDist: 0,
      duelWins: { p1: 0, p2: 0 },
      unlockedAll: false,
    },
  },
  load() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch (e) { d = null; }
    const base = JSON.parse(JSON.stringify(this.DEFAULTS));
    this.data = Object.assign(base, d || {});
    // 老存档没有 endless / coop / gun 字段
    this.data.endless = Object.assign(JSON.parse(JSON.stringify(this.DEFAULTS.endless)), (d && d.endless) || {});
    this.data.coop = Object.assign(JSON.parse(JSON.stringify(this.DEFAULTS.coop)), (d && d.coop) || {});
    this.data.gun = Object.assign(JSON.parse(JSON.stringify(this.DEFAULTS.gun)), (d && d.gun) || {});
    this.data.gun.duelWins = Object.assign({ p1: 0, p2: 0 }, this.data.gun.duelWins || {});
    return this.data;
  },
  flush() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch (e) { /* 忽略隐私模式 */ }
  },
  reset() {
    this.data = JSON.parse(JSON.stringify(this.DEFAULTS));
    this.flush();
  },
};
