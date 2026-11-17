/* skins.js — 联机房间：临时昵称 + 自定义皮肤
   皮肤只在「这一次联机会话」里有效，不写 localStorage、不进存档：
   每人一份 profile = { name, skin }，建房时生成，离开房间即失效。

   皮肤对象是一组配色（与 render.js 里的 SKIN 同结构）。
   网络上只传 { id, body, horn } 三个字段，其余颜色在 resolve() 里推导，
   这样即使对面是老版本 / 自定义色，也不会因为缺字段画出黑色小人。 */
(function () {
  /* ---- 颜色工具：把 #rrggbb 往白 / 黑方向混 ---- */
  function parse(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function hex(rgb) {
    return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }
  function mix(hex1, hex2, t) {
    const a = parse(hex1) || [255, 210, 63];
    const b = parse(hex2) || [0, 0, 0];
    return hex(a.map((v, i) => v + (b[i] - v) * t));
  }
  const light = (c, t) => mix(c, '#ffffff', t);
  const dark = (c, t) => mix(c, '#000000', t);

  function make(id, body, horn) {
    const B = parse(body) ? body : '#ffd23f';
    const H = parse(horn) ? horn : dark(B, 0.28);
    return {
      id: id || 'custom',
      body: B,
      horn: H,
      leg: dark(B, 0.42),
      eye: dark(B, 0.78),
      inv: light(B, 0.35),
      spark: light(B, 0.22),
      wing: 'rgba(255,255,255,.85)',
      glow: B,
    };
  }

  /* 预设：前两个沿用原版红魔 / 蓝魔，保证老玩家一眼认得 */
  const PRESETS = [
    { id: 'gold', name: '赤金', nameEn: 'Gold', body: '#ffd23f', horn: '#ff6b6b' },
    { id: 'ice', name: '寒冰', nameEn: 'Ice', body: '#4fc3ff', horn: '#2b8fd8' },
    { id: 'jade', name: '青玉', nameEn: 'Jade', body: '#35e0a1', horn: '#159c72' },
    { id: 'sakura', name: '樱粉', nameEn: 'Sakura', body: '#ff8fc7', horn: '#d94f96' },
    { id: 'violet', name: '夜紫', nameEn: 'Violet', body: '#a45cff', horn: '#6d2fd0' },
    { id: 'lava', name: '熔岩', nameEn: 'Lava', body: '#ff8b3d', horn: '#c53c1a' },
    { id: 'mint', name: '薄荷', nameEn: 'Mint', body: '#7dffe0', horn: '#22b79b' },
    { id: 'ghost', name: '幽白', nameEn: 'Ghost', body: '#e8ecff', horn: '#8b93bd' },
    { id: 'rose', name: '绯红', nameEn: 'Rose', body: '#ff4d6d', horn: '#a51238' },
    { id: 'ink', name: '曜黑', nameEn: 'Ink', body: '#7684c9', horn: '#2a3054' },
  ];

  /* 至高账号（kaobei）专属皮肤：普通账号在形象编辑里看不到、也选不了。
     网络上仍然只传 { id, body, horn }，房客端 resolve 不认识专属 id 也只会
     按传来的颜色画 —— 专属皮肤出现在谁头上，谁就是登录过 kaobei 的人。 */
  const PREMIUM = [
    { id: 'kb-crown', name: '鎏金王座', nameEn: 'Royal Gold', body: '#ffce54', horn: '#fff3b0' },
    { id: 'kb-nebula', name: '星云', nameEn: 'Nebula', body: '#6c5ce7', horn: '#dcd6ff' },
    { id: 'kb-aurora', name: '极光', nameEn: 'Aurora', body: '#4ef0c0', horn: '#8f7bff' },
    { id: 'kb-ember', name: '余烬', nameEn: 'Ember', body: '#ff5e3a', horn: '#ffd166' },
    { id: 'kb-mecha', name: '机甲', nameEn: 'Mecha', body: '#8fa6b8', horn: '#ff3355' },
    { id: 'kb-void', name: '虚空', nameEn: 'Void', body: '#232743', horn: '#a45cff' },
    { id: 'kb-panda', name: '熊猫', nameEn: 'Panda', body: '#f5f5f5', horn: '#1c1c1c' },
    { id: 'kb-slime', name: '史莱姆', nameEn: 'Slime', body: '#6bff5e', horn: '#1fa02e' },
    { id: 'kb-sunset', name: '暮霞', nameEn: 'Sunset', body: '#ff9a76', horn: '#c8457e' },
    { id: 'kb-frost', name: '霜龙', nameEn: 'Frost Dragon', body: '#a8e4ff', horn: '#3d7bd9' },
  ];

  const ALL = PRESETS.concat(PREMIUM);

  const Skins = {
    presets: PRESETS,
    premium: PREMIUM,
    make,
    /* 形象编辑器里实际该列出的皮肤：普通账号 10 个；kaobei（至高账号）额外解锁专属 10 个 */
    visiblePresets() {
      try { if (LD.Cloud && LD.Cloud.isAdmin && LD.Cloud.isAdmin()) return ALL; } catch (e) { /* 兜底走普通列表 */ }
      return PRESETS;
    },
    /* 网络 / UI 传来的可能是完整对象，也可能只有 { id, body, horn } */
    resolve(s) {
      if (!s) return make('gold', PRESETS[0].body, PRESETS[0].horn);
      const p = ALL.find((x) => x.id === s.id);
      const body = parse(s.body) ? s.body : (p ? p.body : PRESETS[0].body);
      const horn = parse(s.horn) ? s.horn : (p ? p.horn : dark(body, 0.28));
      return make(s.id || 'custom', body, horn);
    },
    /* 只保留要同步的字段（避免把临时对象整个塞进消息） */
    pack(s) {
      const r = this.resolve(s);
      return { id: r.id, body: r.body, horn: r.horn };
    },
    bySlot(slot) {
      const p = PRESETS[slot % PRESETS.length];
      return make(p.id, p.body, p.horn);
    },
    label(s) {
      const p = ALL.find((x) => x.id === (s && s.id));
      if (!p) return LD.I18N && LD.I18N.isLatin() ? 'Custom' : '自定义';
      return LD.I18N && LD.I18N.isLatin() ? p.nameEn : p.name;
    },
  };

  /* 临时昵称：只在内存里，长度 / 空白 / 尖括号做一次收口，
     头顶名牌用 canvas fillText 画，不进 innerHTML，这里仍统一过滤一遍更保险。 */
  Skins.cleanName = function (raw, slot) {
    let s = String(raw == null ? '' : raw).replace(/[<>\r\n\t]/g, '').trim();
    if (s.length > 10) s = s.slice(0, 10);
    if (!s) s = '玩家' + (Number(slot) + 1);
    return s;
  };
  Skins.randomName = function () {
    return '玩家' + Math.floor(10 + Math.random() * 90);
  };

  LD.Skins = Skins;
})();
