/* render.js — 粒子特效 + 全部绘制（含双人模式：蓝魔 / 火池 / 水池 / 两个门） */
(function () {
  const T = LD.TILE, VW = LD.VIEW_W, VH = LD.VIEW_H;

  function rr(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  /* 两个小人的配色：红魔（火） / 蓝魔（冰） */
  const SKIN = {
    red: {
      body: '#ffd23f', inv: '#ffd75e', horn: '#ff6b6b', leg: '#d9a900',
      eye: '#1a1030', spark: '#ffd75e', wing: 'rgba(255,255,255,.85)',
      glow: 'rgba(255,210,63,.9)',
    },
    blue: {
      body: '#4fc3ff', inv: '#a5e6ff', horn: '#2b8fd8', leg: '#1d6ea8',
      eye: '#062334', spark: '#8fe4ff', wing: 'rgba(238,251,255,.9)',
      glow: 'rgba(79,195,255,.9)',
    },
  };
  LD.SKIN = SKIN;
  /* 皮肤优先级：玩家自定义皮肤（联机房间）> 红魔 / 蓝魔默认配色 */
  const skin = (p) => (p && p.skin) ? p.skin : SKIN[p && p.kind === 'blue' ? 'blue' : 'red'];

  /* 枪战模式的人机配色：紫红，和玩家的黄（红方）/ 蓝（蓝方）都不撞色。
     被敌人包围时靠颜色就能一眼分清谁是自己人，这在「一屏混战」里非常关键。 */
  const ENEMY_SKIN = {
    body: '#ff5d7a', horn: '#a01f3c', leg: '#8f1730', eye: '#2a0a12',
  };

  /* ---------------- 粒子 ---------------- */
  LD.FX = {
    list: [],
    burst(x, y, n, color, spd) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        this.list.push({ x, y, vx: Math.cos(a) * spd * Math.random(), vy: Math.sin(a) * spd * Math.random() - 1, life: 0.45, max: 0.45, color, size: 2 + Math.random() * 3, g: 0.35 });
      }
    },
    spark(x, y, color) {
      this.list.push({ x, y, vx: (Math.random() - 0.5) * 1.6, vy: (Math.random() - 0.5) * 1.6 + 0.4, life: 0.55, max: 0.55, color, size: 2 + Math.random() * 3, g: 0.05 });
    },
    cone(x, y, color) {
      for (let i = 0; i < 14; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
        this.list.push({ x, y, vx: Math.cos(a) * 3.4 * Math.random(), vy: Math.sin(a) * 3.4 * Math.random(), life: 0.8, max: 0.8, color, size: 3 + Math.random() * 4, g: 0.18 });
      }
    },
    update(dt) {
      for (let i = this.list.length - 1; i >= 0; i--) {
        const p = this.list[i];
        p.life -= dt;
        if (p.life <= 0) { this.list.splice(i, 1); continue; }
        p.x += p.vx * dt * 60; p.y += p.vy * dt * 60; p.vy += p.g * dt * 60;
      }
    },
    draw(ctx) {
      for (const p of this.list) {
        ctx.globalAlpha = Math.max(0, p.life / p.max);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      ctx.globalAlpha = 1;
    },
    clear() { this.list.length = 0; },
  };

  /* ---------------- 武器图标（物品栏用） ----------------
     一格只有 34px，所以全部用「单色剪影」画：只画外形轮廓，
     玩家一眼认出「这是一根长管子（狙击 / 火箭筒）」就够，
     细节留给颜色和下面的名字。cx/cy 是格子中心，s 是缩放（基准格 46px）。 */
  const ICON = {
    /* 手枪：短握把 + 短枪管 */
    pistol(ctx, cx, cy, s) {
      const u = s / 46;
      ctx.fillRect(cx - 13 * u, cy - 3 * u, 20 * u, 6 * u);
      ctx.fillRect(cx - 8 * u, cy + 1 * u, 7 * u, 10 * u);
      ctx.fillRect(cx + 5 * u, cy - 1 * u, 9 * u, 4 * u);
    },
    /* 冲锋枪：方机匣 + 下垂弹匣 + 前握把 */
    smg(ctx, cx, cy, s) {
      const u = s / 46;
      ctx.fillRect(cx - 14 * u, cy - 5 * u, 26 * u, 8 * u);
      ctx.fillRect(cx - 6 * u, cy + 3 * u, 7 * u, 12 * u);
      ctx.fillRect(cx + 8 * u, cy + 3 * u, 5 * u, 8 * u);
      ctx.fillRect(cx + 12 * u, cy - 3 * u, 8 * u, 4 * u);
    },
    /* 狙击枪：长枪管 + 顶部瞄准镜 —— 形状和其他枪差异最大，最好认 */
    sniper(ctx, cx, cy, s) {
      const u = s / 46;
      ctx.fillRect(cx - 20 * u, cy - 2 * u, 40 * u, 5 * u);
      ctx.fillRect(cx - 4 * u, cy - 9 * u, 14 * u, 6 * u);
      ctx.fillRect(cx - 18 * u, cy + 3 * u, 6 * u, 9 * u);
      ctx.fillRect(cx - 2 * u, cy + 3 * u, 5 * u, 7 * u);
    },
    /* 火箭筒：粗管 + 前端喇叭口 */
    rpg(ctx, cx, cy, s) {
      const u = s / 46;
      ctx.fillRect(cx - 18 * u, cy - 5 * u, 32 * u, 10 * u);
      ctx.beginPath();
      ctx.moveTo(cx + 14 * u, cy - 9 * u); ctx.lineTo(cx + 22 * u, cy);
      ctx.lineTo(cx + 14 * u, cy + 9 * u); ctx.closePath(); ctx.fill();
      ctx.fillRect(cx - 2 * u, cy + 5 * u, 6 * u, 8 * u);
    },
    /* 四联：管子前端四个小口 */
    quad(ctx, cx, cy, s) {
      const u = s / 46;
      ctx.fillRect(cx - 20 * u, cy - 7 * u, 34 * u, 14 * u);
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(cx + 16 * u, cy - 5 * u + i * 3.4 * u, 1.9 * u, 0, 7);
        ctx.fill();
      }
    },
    drone(ctx, cx, cy, s) {
      const u = s / 46;
      ctx.beginPath(); ctx.arc(cx, cy, 6 * u, 0, 7); ctx.fill();
      ctx.fillRect(cx - 17 * u, cy - 1.5 * u, 34 * u, 3 * u);
      for (const dx of [-15, 15]) {
        ctx.beginPath(); ctx.ellipse(cx + dx * u, cy, 6 * u, 2 * u, 0, 0, 7); ctx.fill();
      }
    },
    bomb(ctx, cx, cy, s) {
      const u = s / 46;
      ctx.beginPath(); ctx.arc(cx, cy + 2 * u, 8 * u, 0, 7); ctx.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * 9.5 * u, cy + 2 * u + Math.sin(a) * 9.5 * u, 1.8 * u, 0, 7);
        ctx.fill();
      }
      ctx.fillRect(cx - 1.5 * u, cy - 11 * u, 3 * u, 5 * u);
    },
    /* 追踪无人机（F8）：弹体 + 外面一圈「锁定环」——
       和 F7 自爆机的区别就靠这圈环，一眼看出「这东西会自己找人」。 */
    tracker(ctx, cx, cy, s) {
      const u = s / 46;
      ctx.beginPath(); ctx.arc(cx, cy + 2 * u, 7 * u, 0, 7); ctx.fill();
      // 锁定环（虚线，挖空画）
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = 2 * u;
      ctx.setLineDash([3.4 * u, 2.6 * u]);
      ctx.beginPath(); ctx.arc(cx, cy + 2 * u, 11.5 * u, 0, 7); ctx.stroke();
      ctx.restore();
      // 四向小鳍
      for (const [ax, ay] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        ctx.fillRect(cx + ax * 9 * u - (ax ? 1.4 * u : 2.6 * u),
          cy + 2 * u + ay * 9 * u - (ay ? 1.4 * u : 2.6 * u),
          ax ? 2.8 * u : 5.2 * u, ay ? 2.8 * u : 5.2 * u);
      }
    },
    grenade(ctx, cx, cy, s) {
      const u = s / 46;
      ctx.beginPath(); ctx.arc(cx, cy + 2 * u, 8 * u, 0, 7); ctx.fill();
      ctx.fillRect(cx - 4 * u, cy - 11 * u, 8 * u, 4 * u);
      ctx.fillRect(cx + 4 * u, cy - 10 * u, 7 * u, 2.5 * u);
    },
    /* 医药包：白底红十字（在深色格子上用「挖空」画，避免和底色撞） */
    medkit(ctx, cx, cy, s) {
      const u = s / 46;
      rr(ctx, cx - 11 * u, cy - 9 * u, 22 * u, 18 * u, 3 * u);
      ctx.fill();
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillRect(cx - 2.6 * u, cy - 6.5 * u, 5.2 * u, 13 * u);
      ctx.fillRect(cx - 6.5 * u, cy - 2.6 * u, 13 * u, 5.2 * u);
      ctx.restore();
    },
  };

  /* ---------------- 绘制 ---------------- */
  LD.Render = {
    draw(ctx, g) {
      const w = g.world, p = g.player;
      const shake = w.shake > 0 ? w.shake * 6 : 0;
      const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
      this.bg(ctx, w, g.camX);
      ctx.save();
      ctx.translate(-Math.round(g.camX) + sx, sy);
      this.tiles(ctx, w, g);
      this.entities(ctx, w);
      this.door(ctx, w, g, w.door, '#35e0a1');
      if (w.door2) this.door(ctx, w, g, w.door2, '#4fc3ff');
      const actors = g.players && g.players.length ? g.players : (p ? [p] : []);
      // 枪战模式：人机画在玩家之下（玩家永远在最上层，不会被挡住）
      if (w.gun && g.bots) for (const b of g.bots) this.bot(ctx, b, g);
      /* 无人机刻意画在玩家**之下**（和木箱同一层）：
         【教训】早先 this.drones 从头到尾没有被遍历过 —— 放飞无人机之后
         画面上什么都看不见，玩家只会以为「按了 F6 没反应」。
         现在补上这一遍；置于玩家之下是因为无人机常在头顶悬停，
         画在上面会把小人的头糊住。 */
      if (w.gun && g.drones) for (const d of g.drones) this.droneEnt(ctx, d, g);
      /* 无人机的锁定线：从机头画一条虚线连到当前锁定的敌人 ——
         侦查机是「它在替你打谁」，追踪机是「它正朝谁冲过去」，
         两种都靠这条线一眼可见（原来只有一串没来由的子弹）。 */
      if (w.gun && g.drones) {
        for (const d of g.drones) {
          if ((!d.recon && !d.track) || d.dead || !d.locked) continue;
          const team = d.team === 'blue' ? '#7ad4ff' : (d.team === 'ai' ? '#ff5d7a' : '#35e0a1');
          ctx.save();
          ctx.strokeStyle = team;
          ctx.globalAlpha = 0.42;
          ctx.lineWidth = 1.2;
          ctx.setLineDash([4, 5]);
          ctx.beginPath();
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.locked.cx, d.locked.cy);
          ctx.stroke();
          ctx.restore();
        }
      }
      for (const a of actors) this.player(ctx, a, g);
      // 散打 / 联机枪战：所有人头顶血条（本地能一眼看出谁快被打没了）
      if (g.roomOn && (g.roomMode === 'brawl' || g.roomMode === 'gffa' || g.roomMode === 'gteam')) for (const a of actors) this._roomHp(ctx, a);
      // 联机枪战：画本房间可见的子弹（自己的是权威，别人的是视效）
      if (g.roomOn && g.rBullets && g.rBullets.length) {
        for (const b of g.rBullets) if (!b.dead) this.bullet(ctx, b);
      }
      // 子弹与爆炸
      if (w.gun) {
        if (g.drops && g.drops.length) for (const d of g.drops) this.dropPickup(ctx, d);
        if (g.bullets) for (const b of g.bullets) { if (!b.dead) this.bullet(ctx, b); }
        if (g.blasts) for (const bl of g.blasts) this.blast(ctx, bl.x, bl.y, bl.r, bl.t);
      }
      LD.FX.draw(ctx);
      // 血条画在最上层（玩家 / 人机 / 无人机都画，方便一眼看清战况）
      if (w.gun) {
        for (const a of actors) this._actorHp(ctx, a);
        if (g.bots) for (const b of g.bots) this._actorHp(ctx, b);
        if (g.drones) for (const d of g.drones) this._droneHp(ctx, d);
      }
      ctx.restore();
      this.indicators(ctx, g, w, actors);
      this.overlays(ctx, g, w);
    },

    /* 人机小人：造型与玩家一致（同一个「恶魔」），但配色是敌人色 */
    bot(ctx, b, g) {
      if (b.dead && b.deathT <= 0) return;
      const S = ENEMY_SKIN;
      ctx.save();
      ctx.translate(b.cx, b.y + b.h);
      if (b.dead) { ctx.globalAlpha = Math.max(0, b.deathT / 0.5); ctx.rotate(b.face * 1.1); }
      const sq = b.squash || 0;
      ctx.scale(1 + sq * 0.4, 1 - sq * 0.4);

      // 受击白闪
      if (b.flash > 0) {
        ctx.shadowColor = '#fff';
        ctx.shadowBlur = 16 * b.flash;
      }
      const bodyTop = -b.h;
      ctx.fillStyle = b.flash > 0 ? '#ffffff' : S.body;
      rr(ctx, -b.w / 2, bodyTop, b.w, b.h, 7); ctx.fill();
      ctx.shadowBlur = 0;

      // 角（比玩家更尖，一眼区分敌我）
      ctx.fillStyle = S.horn;
      ctx.beginPath();
      ctx.moveTo(-b.w / 2 + 1, bodyTop + 4); ctx.lineTo(-b.w / 2 + 5, bodyTop - 9); ctx.lineTo(-b.w / 2 + 10, bodyTop + 4);
      ctx.moveTo(b.w / 2 - 1, bodyTop + 4); ctx.lineTo(b.w / 2 - 5, bodyTop - 9); ctx.lineTo(b.w / 2 - 10, bodyTop + 4);
      ctx.fill();

      // 眼
      const ex = (b.face || 1) * 3;
      ctx.fillStyle = S.eye;
      if (b.dead) {
        ctx.lineWidth = 2; ctx.strokeStyle = S.eye;
        ctx.beginPath();
        ctx.moveTo(ex - 6, bodyTop + 9); ctx.lineTo(ex - 1, bodyTop + 14);
        ctx.moveTo(ex - 1, bodyTop + 9); ctx.lineTo(ex - 6, bodyTop + 14);
        ctx.moveTo(ex + 2, bodyTop + 9); ctx.lineTo(ex + 7, bodyTop + 14);
        ctx.moveTo(ex + 7, bodyTop + 9); ctx.lineTo(ex + 2, bodyTop + 14);
        ctx.stroke();
      } else {
        ctx.fillRect(ex - 6, bodyTop + 9, 4, 6);
        ctx.fillRect(ex + 2, bodyTop + 9, 4, 6);
      }
      // 腿
      const swing = b.grounded ? Math.sin((b.walk || 0) * 4) * 4 : 2;
      ctx.fillStyle = S.leg;
      ctx.fillRect(-8, -2, 5, 5 + swing);
      ctx.fillRect(3, -2, 5, 5 - swing);

      /* 手里的枪（和玩家共用同一套画法）。
         ⚠ 必须画在**角色的局部坐标系里**（也就是 ctx.restore() 之前）——
         _gunInHand 内部只做「相对身体」的 translate(x: ±w/2, y: bodyTop+h*0.42)，
         所以它默认原点就在小人的脚底。
         这里原来把调用放在了 ctx.restore() **之后**，原点已经回到了世界原点：
         于是所有人机的枪都被画到世界坐标 (≈±9, -16) —— 也就是画布左上角**外面**，
         屏幕上一个都看不到，看起来就是「敌人未持枪」。
         玩家那边一直是对的（它的调用点在 restore 之前），所以只有敌人在裸奔。 */
      const ghost = { kind: 'red', w: b.w, h: b.h, face: b.face, x: b.x, y: b.y, cx: b.cx, gun: b.gun };
      this._gunInHand(ctx, ghost, g, bodyTop);
      ctx.restore();
    },

    _actorHp(ctx, a) {
      if (!a || !a.maxHp || a.dead) return;
      const ratio = a.hp / a.maxHp;
      const col = a.kind === 'blue' ? '#4fc3ff' : (a.kind === 'ai' ? (a.elite ? '#ffd23f' : '#ff5d7a') : '#35e0a1');
      this.hpBar(ctx, a.cx - 11, a.y - 9, 22, ratio, col, a.elite);
    },

    /* ---------------- 无人机 ----------------
       两种外观：
         侦查（recon）  蓝色四旋翼 + 底部小相机，机身在头顶悬停
         自爆（kamikaze）红色圆弹体 + 一圈铆钉 + 引信，玩家遥控飞行
       机身配色跟着阵营走（红方浅蓝 / 蓝方橙黄 / 人机玫红），
       一眼就能分清「天上这个是我放的还是敌人放的」。
       队别色同时给机身描边做一圈光晕，便于在乱战里找到。 */
    /* 无人机实体。
       三种外观：
         侦查（recon）  蓝色四旋翼 + 底部小相机，机身在头顶悬停
         自爆（kamikaze）红色圆弹体 + 一圈铆钉 + 引信，玩家遥控飞行
         追踪（track）  橙红弹体 + 一圈脉动的锁定环 + 四向小鳍，自己找人炸
       机身配色跟着阵营走（红方浅蓝 / 蓝方橙黄 / 人机玫红），
       一眼就能分清「天上这个是我放的还是敌人放的」。
       队别色同时给机身描边做一圈光晕，便于在乱战里找到。 */
    droneEnt(ctx, d, g) {
      if (!d || d.dead) return;
      const team = d.team === 'blue' ? '#7ad4ff' : (d.team === 'ai' ? '#ff5d7a' : '#35e0a1');
      const isRecon = !!d.recon;
      const isTrack = !!d.track;
      const rot = (d.spin || 0);
      ctx.save();
      ctx.translate(d.x, d.y);
      /* 遥控中的无人机加一圈脉动光环（提示「这个正被你开着」），
         靠 d.controlled 标记，由 game.js 每帧写入。 */
      if (d.controlled) {
        const pulse = 0.5 + 0.5 * Math.sin((g.world.time || 0) * 8);
        ctx.strokeStyle = team;
        ctx.globalAlpha = 0.28 + pulse * 0.42;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, 20 + pulse * 4, 0, 7); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // 机身
      ctx.fillStyle = team;
      ctx.shadowColor = team; ctx.shadowBlur = 12;
      if (isRecon) {
        ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.fill();
        ctx.fillRect(-9, -1.5, 18, 3);                     // 横臂
        for (const dx of [-8, 8]) {                        // 两副桨
          ctx.save();
          ctx.translate(dx, 0);
          ctx.save();
          ctx.rotate(rot);
          ctx.globalAlpha = 0.55;
          ctx.beginPath(); ctx.ellipse(0, 0, 6.5, 2, 0, 0, 7); ctx.fill();
          ctx.restore();
          ctx.restore();
        }
        ctx.beginPath(); ctx.arc(0, 6, 1.8, 0, 7); ctx.fill();   // 底部镜头
      } else if (isTrack) {
        /* 追踪机：弹体 + 转动的锁定环 + 四向小鳍。
           锁定环用虚线画，转速比铆钉环慢一点，看起来像在「扫描」。 */
        ctx.beginPath(); ctx.arc(0, 0, 7.5, 0, 7); ctx.fill();
        ctx.save();
        ctx.rotate(-rot * 0.55);
        ctx.strokeStyle = team;
        ctx.lineWidth = 1.6;
        ctx.globalAlpha = 0.9;
        ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.arc(0, 0, 13, 0, 7); ctx.stroke();
        ctx.restore();
        for (const [ax, ay] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          ctx.fillRect(ax ? 8.5 : -2.6, ay ? 8.5 : -2.6, ax ? 3 : 5.2, ay ? 3 : 5.2);
        }
        if (d.armed) {                                     // 待引爆：引信闪烁
          ctx.fillStyle = '#ffe066';
          const b = 0.5 + 0.5 * Math.sin((g.world.time || 0) * 18);
          ctx.globalAlpha = b;
          ctx.beginPath(); ctx.arc(0, -11, 2.4, 0, 7); ctx.fill();
          ctx.globalAlpha = 1;
        }
      } else {
        ctx.beginPath(); ctx.arc(0, 0, 8, 0, 7); ctx.fill();     // 弹体
        for (let i = 0; i < 8; i++) {                          // 铆钉环
          const a = (i / 8) * Math.PI * 2 + rot * 0.4;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * 9.5, Math.sin(a) * 9.5, 1.8, 0, 7);
          ctx.fill();
        }
        ctx.fillRect(-1.5, -13, 3, 5);                          // 引信
        if (d.armed) {                                          // 待引爆：引信闪烁
          ctx.fillStyle = '#ffe066';
          const b = 0.5 + 0.5 * Math.sin((g.world.time || 0) * 18);
          ctx.globalAlpha = b;
          ctx.beginPath(); ctx.arc(0, -14, 2.6, 0, 7); ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
      ctx.shadowBlur = 0;
      ctx.restore();
    },

    _droneHp(ctx, d) {
      if (!d || !d.maxHp || d.dead) return;
      const col = d.team === 'blue' ? '#7ad4ff' : (d.team === 'ai' ? '#ff5d7a' : '#35e0a1');
      this.hpBar(ctx, d.x - 11, d.y - 20, 22, d.hp / d.maxHp, col, false);
    },

    bg(ctx, w, cam) {
      // 每一类关卡有自己的背景色，避免 100 关看起来是同一关
      const tint = (w.level && w.level.tint) || ['#0a0c18', '#1a1030'];
      const grd = ctx.createLinearGradient(0, 0, 0, VH);
      grd.addColorStop(0, tint[0]);
      grd.addColorStop(1, tint[1]);
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, VW, VH);

      // 远景视差光斑
      ctx.save();
      const px = -cam * 0.25;
      for (let i = 0; i < 7; i++) {
        const x = ((i * 260 + px) % (VW + 400)) - 200;
        const y = 120 + (i % 3) * 90;
        const r = 90 + (i % 4) * 30;
        const g2 = ctx.createRadialGradient(x, y, 0, x, y, r);
        g2.addColorStop(0, i % 2 ? 'rgba(120,80,255,0.14)' : 'rgba(255,80,120,0.10)');
        g2.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g2;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      // 远景网格
      ctx.strokeStyle = 'rgba(140,160,255,0.055)';
      ctx.lineWidth = 1;
      const off = -cam * 0.45;
      for (let x = (off % 80) - 80; x < VW + 80; x += 80) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, VH); ctx.stroke();
      }
      for (let y = 0; y < VH; y += 80) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(VW, y); ctx.stroke();
      }
      ctx.restore();
    },

    tiles(ctx, w, g) {
      const c0 = Math.max(0, Math.floor(g.camX / T) - 1);
      const c1 = Math.min(w.cols - 1, Math.ceil((g.camX + VW) / T) + 1);
      for (let r = 0; r < w.rows; r++) {
        for (let c = c0; c <= c1; c++) {
          const ch = w.grid[r][c];
          if (ch === '.') continue;
          const x = c * T, y = r * T;
          if (ch === '#' || ch === 'B') this.block(ctx, w, c, r, x, y, ch);
          else if (ch === '=') { ctx.fillStyle = '#3a4370'; rr(ctx, x, y + 10, T, 8, 3); ctx.fill(); }
          else if (ch === 'A' || ch === 'Z') this.belt(ctx, ch, x, y, w.time);
          else if (ch === 'K') this.crate(ctx, w, c, r, x, y);
          else if (ch === '+') this.healPad(ctx, x, y, w.time);
          else if (ch === '^' || ch === 'v' || ch === '<' || ch === '>') this.spike(ctx, ch, x, y, w.time);
          else if (ch === 'O') this.acid(ctx, x, y, w.time);
          else if (ch === '~') this.pool(ctx, 'fire', x, y, w.time);
          else if (ch === '_') this.pool(ctx, 'water', x, y, w.time);
          else if (ch === 'X') this.crumble(ctx, w, c, r, x, y);
          else if (ch === 'T') this.trapdoor(ctx, w, c, r, x, y);
        }
      }
    },

    block(ctx, w, c, r, x, y, ch) {
      if (ch === 'B' && w.fakes.has(LD.cellKey(c, r))) return;
      const top = !w.isSolid(c, r - 1);
      ctx.fillStyle = ch === 'B' ? '#232a4a' : '#212845';
      ctx.fillRect(x, y, T, T);
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
      if (top) {
        const g2 = ctx.createLinearGradient(0, y, 0, y + 10);
        g2.addColorStop(0, '#5a67a8');
        g2.addColorStop(1, 'rgba(90,103,168,0)');
        ctx.fillStyle = g2;
        ctx.fillRect(x, y, T, 10);
        ctx.fillStyle = '#7c8ad0';
        ctx.fillRect(x, y, T, 3);
      }
    },

    spike(ctx, dir, x, y, t) {
      const glow = 0.65 + Math.sin(t * 4) * 0.2;
      ctx.save();
      ctx.translate(x + T / 2, y + T / 2);
      if (dir === 'v') ctx.rotate(Math.PI);
      if (dir === '<') ctx.rotate(-Math.PI / 2);
      if (dir === '>') ctx.rotate(Math.PI / 2);
      ctx.shadowColor = 'rgba(255,77,109,' + glow + ')';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#ff4d6d';
      ctx.beginPath();
      ctx.moveTo(-13, 18); ctx.lineTo(13, 18); ctx.lineTo(0, -18);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.moveTo(-4, 16); ctx.lineTo(0, -14); ctx.lineTo(3, 16);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    },

    acid(ctx, x, y, t) {
      const wob = Math.sin(t * 3 + x * 0.05) * 3;
      ctx.fillStyle = '#6b2fb5';
      ctx.fillRect(x, y + 8 + wob, T, T - 8 - wob);
      ctx.fillStyle = '#a45cff';
      ctx.fillRect(x, y + 6 + wob, T, 6);
      ctx.save();
      ctx.shadowColor = 'rgba(164,92,255,0.8)';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#c79bff';
      ctx.fillRect(x, y + 6 + wob, T, 3);
      ctx.restore();
    },

    /* 火池（只溶蓝魔）/ 水池（只溶红魔）—— 双人模式的招牌地形 */
    pool(ctx, elem, x, y, t) {
      const wob = Math.sin(t * 3 + x * 0.05) * 3;
      const top = y + 8 + wob;
      const deep = elem === 'fire' ? '#7c2606' : '#0d3f6b';
      const surface = elem === 'fire' ? '#ff8c2a' : '#3ba7ff';
      const crest = elem === 'fire' ? '#ffe08a' : '#c7efff';
      const glowC = elem === 'fire' ? 'rgba(255,140,42,.9)' : 'rgba(59,167,255,.9)';
      ctx.fillStyle = deep;
      ctx.fillRect(x, top, T, y + T - top);
      ctx.save();
      ctx.shadowColor = glowC;
      ctx.shadowBlur = 16;
      ctx.fillStyle = surface;
      ctx.fillRect(x, top, T, 6);
      ctx.shadowBlur = 0;
      // 火舌 / 水花
      for (let i = 0; i < 3; i++) {
        const fx = x + 8 + i * 12;
        const ph = t * (elem === 'fire' ? 6 : 3.2) + i * 2 + x * 0.1;
        const hh = (elem === 'fire' ? 11 : 7) + Math.sin(ph) * 5;
        ctx.fillStyle = surface;
        ctx.beginPath();
        ctx.moveTo(fx - 4, top + 2);
        ctx.lineTo(fx, top - hh);
        ctx.lineTo(fx + 4, top + 2);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = crest;
      ctx.fillRect(x, top, T, 2);
    },

    crumble(ctx, w, c, r, x, y) {
      const st = w.crumble.get(LD.cellKey(c, r));
      if (st.gone) return;
      const shake = st.t >= 0 ? (Math.random() - 0.5) * 3 : 0;
      ctx.save();
      ctx.translate(shake, 0);
      ctx.fillStyle = st.t >= 0 ? '#6b5a3a' : '#4a4433';
      rr(ctx, x + 1, y + 1, T - 2, T - 2, 4); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 8, y + 4); ctx.lineTo(x + 16, y + 18); ctx.lineTo(x + 10, y + 34);
      ctx.moveTo(x + 26, y + 6); ctx.lineTo(x + 22, y + 22); ctx.lineTo(x + 32, y + 34);
      ctx.stroke();
      ctx.restore();
    },

    trapdoor(ctx, w, c, r, x, y) {
      const st = w.trapdoor.get(LD.cellKey(c, r));
      if (st.gone) return;
      ctx.save();
      if (st.t >= 0) ctx.translate(0, Math.sin(performance.now() / 30) * 1.5);
      ctx.fillStyle = '#7a5c2e';
      rr(ctx, x + 1, y + 2, T - 2, T - 6, 4); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      for (let i = 1; i < 3; i++) ctx.fillRect(x + 2, y + 2 + i * 10, T - 4, 2);
      ctx.fillStyle = '#b58a45';
      ctx.beginPath(); ctx.arc(x + 8, y + 20, 3, 0, 7); ctx.fill();
      ctx.restore();
    },

    /* ---------------- 枪战模式：木箱 / 回血装置 ---------------- */
    /* 障碍木箱：可被子弹打破，有机会掉双倍 / 三倍射速与弹药 */
    crate(ctx, w, c, r, x, y) {
      if (w.broken && w.broken.has(LD.cellKey(c, r))) return;
      ctx.save();
      // 箱体
      const grd = ctx.createLinearGradient(x, y, x, y + T);
      grd.addColorStop(0, '#c99a5b');
      grd.addColorStop(1, '#8a5f2b');
      ctx.fillStyle = grd;
      rr(ctx, x + 1, y + 1, T - 2, T - 2, 5); ctx.fill();
      // 板条
      ctx.strokeStyle = 'rgba(60,36,10,.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 2, y + T / 2); ctx.lineTo(x + T - 2, y + T / 2);
      ctx.moveTo(x + T / 2, y + 2); ctx.lineTo(x + T / 2, y + T - 2);
      ctx.stroke();
      // 外框 + 高光
      ctx.strokeStyle = 'rgba(255,225,170,.45)';
      ctx.lineWidth = 1.5;
      rr(ctx, x + 3, y + 3, T - 6, T - 6, 4); ctx.stroke();
      // 掉落的增益暗示：箱子正面画个小星
      ctx.fillStyle = 'rgba(255,210,63,.75)';
      ctx.beginPath(); ctx.arc(x + T / 2, y + T / 2, 3.4, 0, 7); ctx.fill();
      ctx.restore();
    },

    /* 回血装置：地面上一个发光的十字台 */
    healPad(ctx, x, y, t) {
      const pulse = 0.5 + Math.sin(t * 3) * 0.5;
      ctx.save();
      ctx.fillStyle = 'rgba(53,224,161,.20)';
      rr(ctx, x + 2, y + T - 12, T - 4, 10, 4); ctx.fill();
      ctx.shadowColor = 'rgba(53,224,161,.95)';
      ctx.shadowBlur = 10 + pulse * 12;
      ctx.fillStyle = '#35e0a1';
      rr(ctx, x + 12, y + T - 9, 16, 5, 2); ctx.fill();
      rr(ctx, x + 17, y + T - 14, 6, 15, 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.35 + pulse * 0.35;
      ctx.strokeStyle = '#7dffcf';
      ctx.lineWidth = 1.6;
      rr(ctx, x + 3, y + 3, T - 6, T - 6, 5); ctx.stroke();
      ctx.restore();
    },

    /* 技能图标（炫酷版）：每类技能专属图案 + 动态效果。
       动态 = ①绕图标旋转的 4 个光点光环 ②呼吸缩放 ③发光脉动。
       kind: double/triple/ammo/heal；cx/cy 中心；s 尺寸；t 时间（秒）。 */
    boostIcon(ctx, kind, cx, cy, s, t) {
      const info = LD.Guns.BOOSTS[kind] || LD.Guns.BOOSTS.ammo;
      const col = info.color;
      const u = s / 40;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1 + Math.sin(t * 3.2) * 0.05, 1 + Math.sin(t * 3.2) * 0.05);

      /* ① 旋转光环：4 个光点绕图标轨道运行，明暗随相位变化 */
      ctx.save();
      const R = s * 0.66;
      for (let i = 0; i < 4; i++) {
        const a = t * 2.4 + i * (Math.PI / 2);
        const r = (i % 2 === 0 ? 2.4 : 1.5) * u;
        ctx.globalAlpha = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(a));
        ctx.shadowColor = col;
        ctx.shadowBlur = 9 * u;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(Math.cos(a) * R, Math.sin(a) * R, r, 0, 7); ctx.fill();
      }
      ctx.restore();

      /* ② 图案主体（按技能类型） */
      ctx.fillStyle = col;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.4 * u;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = col;
      ctx.shadowBlur = 5 * u;
      if (kind === 'heal') {
        /* 医疗：圆角十字 + 中心亮核 */
        const w = 5.2 * u, h = 13 * u;
        rr(ctx, -w / 2, -h / 2, w, h, w / 2); ctx.fill();
        rr(ctx, -h / 2, -w / 2, h, w, w / 2); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(0, 0, 2.6 * u, 0, 7); ctx.fill();
      } else if (kind === 'ammo') {
        /* 弹药：三发圆头子弹 */
        ctx.shadowBlur = 4 * u;
        for (let i = -1; i <= 1; i++) {
          const bx = i * 6.4 * u, by = (i === 0 ? -2 : 1) * u;
          ctx.beginPath();
          ctx.moveTo(bx - 3 * u, by + 5.4 * u);
          ctx.lineTo(bx - 3 * u, by - 2 * u);
          ctx.arc(bx, by - 2 * u, 3 * u, Math.PI, 0);
          ctx.lineTo(bx + 3 * u, by + 5.4 * u);
          ctx.closePath(); ctx.fill();
        }
      } else {
        /* double / triple：向右的加速箭头（chevron）+ 速度线 */
        const n = kind === 'triple' ? 3 : 2;
        for (let i = 0; i < n; i++) {
          const ox = (i - (n - 1) / 2) * 7 * u;
          ctx.beginPath();
          ctx.moveTo(ox - 6 * u, -8 * u);
          ctx.lineTo(ox + 1.5 * u, 0);
          ctx.lineTo(ox - 6 * u, 8 * u);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(ox + 4 * u, -6 * u);
          ctx.lineTo(ox + 9.5 * u, 0);
          ctx.lineTo(ox + 4 * u, 6 * u);
          ctx.stroke();
        }
      }
      ctx.restore();
    },

    /* 木箱爆出的技能补给：悬浮在箱子原位（MC 悬浮方块式上下浮动），
       谁走近谁吸收进顶栏技能槽。颜色跟 BOOSTS 的主题色走；到期前 3 秒开始闪烁。 */
    dropPickup(ctx, d) {
      const info = LD.Guns.BOOSTS[d.kind] || LD.Guns.BOOSTS.ammo;
      const bob = Math.sin(d.t * 4) * 2.5;
      const blink = d.life < 3 ? (Math.sin(d.t * 14) > -0.2 ? 1 : 0.15) : 1;
      ctx.save();
      ctx.globalAlpha = blink;
      const x = d.x, y = d.y + bob, s = d.w;
      /* 底板 + 发光边框 */
      ctx.shadowColor = info.color;
      ctx.shadowBlur = 9 + Math.sin(d.t * 5) * 4;
      ctx.fillStyle = 'rgba(16,12,30,.86)';
      rr(ctx, x, y, s, s, 5); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = info.color;
      ctx.lineWidth = 1.5;
      rr(ctx, x + 1, y + 1, s - 2, s - 2, 4); ctx.stroke();
      /* 炫酷技能图标（含动态光环） */
      this.boostIcon(ctx, d.kind, x + s / 2, y + s / 2, s, d.t);
      ctx.restore();
    },

    /* 子弹：一条亮色拖尾 + 弹头（平射，所以拖尾是水平的） */
    bullet(ctx, b) {
      ctx.save();
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 10;
      ctx.fillStyle = b.color;
      const len = LD.clamp(Math.abs(b.vx) * 0.9, 6, 20) * (b.vx >= 0 ? 1 : -1);
      rr(ctx, b.x - b.r - (b.vx >= 0 ? len : 0), b.y - b.r * 0.5, b.r * 2 + Math.abs(len), b.r, b.r * 0.6);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(b.x, b.y, Math.max(1.2, b.r * 0.5), 0, 7); ctx.fill();
      ctx.restore();
    },

    /* 手雷 / 火箭筒的爆炸圈 */
    blast(ctx, x, y, r0, t) {
      const k = LD.clamp(1 - t / 0.32, 0, 1);
      ctx.save();
      ctx.globalAlpha = k * 0.8;
      const grd = ctx.createRadialGradient(x, y, 0, x, y, r0 * (1.2 - k * 0.3));
      grd.addColorStop(0, 'rgba(255,240,180,.95)');
      grd.addColorStop(0.5, 'rgba(255,140,60,.6)');
      grd.addColorStop(1, 'rgba(255,60,40,0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(x, y, r0 * (1.2 - k * 0.3), 0, 7); ctx.fill();
      ctx.restore();
    },

    /* 小人头顶的血条（枪战模式专用）。玩家 / 人机共用。 */
    hpBar(ctx, x, y, w, ratio, color, elite) {
      const h = 4;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      rr(ctx, x - 1, y - 1, w + 2, h + 2, 2); ctx.fill();
      ctx.fillStyle = color;
      rr(ctx, x, y, Math.max(1, w * LD.clamp(ratio, 0, 1)), h, 2); ctx.fill();
      if (elite) {
        ctx.strokeStyle = '#ffd23f';
        ctx.lineWidth = 1;
        rr(ctx, x - 2, y - 2, w + 4, h + 4, 3); ctx.stroke();
      }
      ctx.restore();
    },

    entities(ctx, w) {
      for (const gd of w.guards) {
        const bob = Math.sin(w.time * 8 + gd.phase) * 2;
        ctx.save();
        ctx.translate(gd.x + 15, gd.y + 15 + bob);
        ctx.shadowColor = 'rgba(255,107,107,.7)'; ctx.shadowBlur = 12;
        ctx.fillStyle = '#ff6b6b';
        rr(ctx, -14, -14, 28, 28, 7); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff';
        ctx.fillRect(-8, -5, 6, 7); ctx.fillRect(2, -5, 6, 7);
        ctx.fillStyle = '#2a0b12';
        ctx.fillRect(-6 + gd.dir * 2, -3, 3, 4); ctx.fillRect(4 + gd.dir * 2, -3, 3, 4);
        ctx.fillStyle = '#7a1f2c';
        ctx.fillRect(-12, -1, 4, 3); ctx.fillRect(8, -1, 4, 3);
        ctx.restore();
      }
      for (const f of w.flyers) {
        ctx.save();
        ctx.translate(f.x + 15, f.y + 15);
        const flap = Math.sin(w.time * 14 + f.phase) * 7;
        ctx.shadowColor = 'rgba(190,120,255,.7)'; ctx.shadowBlur = 12;
        ctx.fillStyle = '#b06bff';
        ctx.beginPath();
        ctx.moveTo(-16, -flap); ctx.lineTo(-4, 2); ctx.lineTo(-16, 10 + flap);
        ctx.moveTo(16, -flap); ctx.lineTo(4, 2); ctx.lineTo(16, 10 + flap);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#e6d0ff';
        rr(ctx, -9, -9, 18, 18, 6); ctx.fill();
        ctx.fillStyle = '#3a1060';
        ctx.fillRect(-6, -4, 4, 5); ctx.fillRect(2, -4, 4, 5);
        ctx.restore();
      }
      for (const s of w.saws) {
        ctx.save();
        ctx.translate(s.x + 16, s.y + 16);
        ctx.rotate(s.rot);
        ctx.shadowColor = 'rgba(200,215,255,.55)'; ctx.shadowBlur = 10;
        ctx.fillStyle = '#9aa5c8';
        for (let i = 0; i < 10; i++) {
          ctx.rotate(Math.PI / 5);
          ctx.beginPath();
          ctx.moveTo(-4, -18); ctx.lineTo(4, -18); ctx.lineTo(0, -25);
          ctx.closePath(); ctx.fill();
        }
        ctx.beginPath(); ctx.arc(0, 0, 14, 0, 7); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#2b3150';
        ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.fill();
        ctx.restore();
      }
      for (const c of w.crushers) {
        const shake = c.state === 'shake' ? (Math.random() - 0.5) * 4 : 0;
        ctx.save();
        ctx.translate(c.x + shake, c.y);
        ctx.fillStyle = '#3a4270';
        rr(ctx, 0, 0, T, T - 8, 5); ctx.fill();
        ctx.fillStyle = '#ff8c42';
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(4 + i * 9, T - 8); ctx.lineTo(11 + i * 9, T - 8); ctx.lineTo(7.5 + i * 9, T);
          ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle = '#20263f';
        ctx.fillRect(6, 4, T - 12, 6);
        ctx.restore();
      }
      for (const m of w.movers) {
        ctx.save();
        ctx.shadowColor = 'rgba(59,167,255,.75)'; ctx.shadowBlur = 12;
        ctx.fillStyle = '#3ba7ff';
        rr(ctx, m.x, m.y, m.w, m.h, 5); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        rr(ctx, m.x + 3, m.y + 2, m.w - 6, 3, 2); ctx.fill();
        ctx.restore();
      }
      /* ---- 新障碍：激光 / 蒸汽 / 摆锤 / 浮游雷 ---- */
      for (const lz of w.lasers) this.laser(ctx, lz, w.time);
      for (const gy of w.geysers) this.geyser(ctx, gy, w.time);
      for (const pd of w.pendulums) this.pendulum(ctx, pd);
      for (const mn of w.mines) this.mine(ctx, mn, w.time);
    },

    /* 传送带地面：深色金属板 + 朝流向滚动的箭头 */
    belt(ctx, ch, x, y, t) {
      const dir = ch === 'A' ? 1 : -1;
      ctx.save();
      ctx.fillStyle = '#1b2138';
      ctx.fillRect(x, y, T, T);
      // 顶部摩擦条
      ctx.fillStyle = 'rgba(255,210,63,.18)';
      ctx.fillRect(x, y, T, 6);
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(x, y + T - 4, T, 4);
      // 滚动的箭头（速度就是带速的视觉暗示）
      ctx.translate(x + T / 2, y + T / 2);
      ctx.scale(dir, 1);
      const off = (t * 90) % 18;
      ctx.fillStyle = '#ffd23f';
      ctx.globalAlpha = 0.9;
      for (let i = -1; i < 3; i++) {
        const cx = -16 + i * 18 + off;
        ctx.beginPath();
        ctx.moveTo(cx - 5, -7); ctx.lineTo(cx + 6, 0); ctx.lineTo(cx - 5, 7);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    },

    /* 激光发射器：墙上的炮管 + 会变色的蓄力灯；发射时画出通长的光束 */
    laser(ctx, lz, t) {
      const charging = lz.state === 'charge';
      const firing = lz.state === 'fire';
      // 炮管
      ctx.save();
      ctx.translate(lz.x, lz.y);
      ctx.fillStyle = '#2b3252';
      rr(ctx, 2, 8, T - 2, 24, 4); ctx.fill();
      ctx.fillStyle = '#3d4670';
      rr(ctx, 6, 12, T - 12, 8, 3); ctx.fill();
      // 蓄力灯：越接近发射闪得越急
      const blink = charging ? (Math.sin(t * 30) > 0 ? 1 : 0.2) : (firing ? 1 : 0.35);
      ctx.globalAlpha = blink;
      ctx.shadowColor = 'rgba(255,77,109,.9)';
      ctx.shadowBlur = firing ? 22 : (charging ? 14 : 6);
      ctx.fillStyle = firing ? '#fff' : '#ff4d6d';
      ctx.beginPath(); ctx.arc(T - 6, 20, 5, 0, 7); ctx.fill();
      ctx.restore();
      // 光束
      if (firing && lz.len > 0) {
        const bx = lz.x + T, by = lz.y + T / 2;
        ctx.save();
        ctx.shadowColor = 'rgba(255,77,109,.95)';
        ctx.shadowBlur = 16;
        ctx.fillStyle = 'rgba(255,77,109,.38)';
        ctx.fillRect(bx, by - 8, lz.len, 16);
        ctx.fillStyle = '#ff4d6d';
        ctx.fillRect(bx, by - 3, lz.len, 6);
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffe0e6';
        ctx.fillRect(bx, by - 1, lz.len, 2);
        // 出弹口的一团亮斑
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(bx, by, 4 + Math.sin(t * 40) * 1.5, 0, 7); ctx.fill();
        ctx.restore();
      }
    },

    /* 蒸汽喷发口：地面盖子 + 蓄力抖动 + 喷发时的白色汽柱 */
    geyser(ctx, gy, t) {
      const charging = gy.state === 'charge';
      const erupting = gy.state === 'erupt';
      ctx.save();
      ctx.translate(gy.x, gy.y);
      // 金属盖子
      ctx.fillStyle = '#39415f';
      rr(ctx, 4, T - 10, T - 8, 9, 3); ctx.fill();
      ctx.fillStyle = '#4a5478';
      for (let i = 0; i < 3; i++) ctx.fillRect(8 + i * 10, T - 8, 6, 3);
      if (charging) ctx.translate((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2);
      // 蓄力时盖缝里冒白汽
      if (charging || erupting) {
        ctx.fillStyle = 'rgba(255,255,255,.75)';
        const h = erupting ? 4 : 2 + Math.sin(t * 24) * 2;
        ctx.beginPath();
        ctx.ellipse(T / 2, T - 9, 10, h, 0, 0, 7);
        ctx.fill();
      }
      ctx.restore();
      // 喷发汽柱：几段错位生长的白色云团
      if (erupting && gy.h > 0) {
        ctx.save();
        for (let i = 0; i < 4; i++) {
          const seg = gy.h * (0.25 + i * 0.25);
          const wob = Math.sin(t * 9 + i * 1.7) * 6;
          ctx.globalAlpha = 0.5 - i * 0.09;
          ctx.fillStyle = '#e8f4ff';
          ctx.beginPath();
          ctx.ellipse(gy.x + T / 2 + wob, gy.y - seg + 10, 13 - i, 12, 0, 0, 7);
          ctx.fill();
        }
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#fff';
        ctx.fillRect(gy.x + 9, gy.y - gy.h, T - 18, gy.h);
        ctx.restore();
      }
    },

    /* 摆锤：锚座 + 链条 + 带刺铁球 */
    pendulum(ctx, pd) {
      ctx.save();
      // 链条
      ctx.strokeStyle = '#565f8a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(pd.x, pd.y);
      ctx.lineTo(pd.bx, pd.by);
      ctx.stroke();
      // 锚座
      ctx.fillStyle = '#2b3252';
      rr(ctx, pd.x - 9, pd.y - 6, 18, 12, 3); ctx.fill();
      // 铁球
      ctx.translate(pd.bx, pd.by);
      ctx.rotate(pd.ang * 1.2);
      ctx.shadowColor = 'rgba(255,107,107,.55)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#8d97bb';
      ctx.beginPath(); ctx.arc(0, 0, pd.ball, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ff6b6b';
      for (let i = 0; i < 6; i++) {
        ctx.rotate(Math.PI / 3);
        ctx.beginPath();
        ctx.moveTo(-3, -pd.ball); ctx.lineTo(3, -pd.ball); ctx.lineTo(0, -pd.ball - 5);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#2b3150';
      ctx.beginPath(); ctx.arc(0, 0, 4, 0, 7); ctx.fill();
      ctx.restore();
    },

    /* 浮游雷：带刺的圆球 + 闪烁的红灯；死了一次会消失几秒 */
    mine(ctx, mn, t) {
      if (mn.dead > 0) return;
      ctx.save();
      ctx.translate(mn.x, mn.y);
      const bob = Math.sin(t * 3 + mn.blink) * 2;
      ctx.translate(0, bob);
      ctx.shadowColor = 'rgba(255,157,63,.6)';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#3a2b1e';
      ctx.beginPath(); ctx.arc(0, 0, mn.r, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;
      // 刺
      ctx.fillStyle = '#ff9d3f';
      for (let i = 0; i < 8; i++) {
        ctx.rotate(Math.PI / 4);
        ctx.beginPath();
        ctx.moveTo(-3, -mn.r + 1); ctx.lineTo(3, -mn.r + 1); ctx.lineTo(0, -mn.r - 5);
        ctx.closePath(); ctx.fill();
      }
      // 闪烁的报警灯
      const on = Math.sin(t * 8 + mn.blink) > 0;
      ctx.fillStyle = on ? '#ff4d6d' : '#5a1f2c';
      ctx.beginPath(); ctx.arc(0, 0, 4, 0, 7); ctx.fill();
      ctx.restore();
    },

    door(ctx, w, g, d, color) {
      if (!d) return;
      const col = color || '#35e0a1';
      const t = w.time * 3;
      const pulse = 0.6 + Math.sin(t) * 0.25 + w.doorPulse * 0.6;
      const rgb = col === '#4fc3ff' ? '79,195,255' : '53,224,161';
      const light = col === '#4fc3ff' ? '#a5e6ff' : '#7dffcb';
      const dark = col === '#4fc3ff' ? '#0a1a2a' : '#0c1a16';
      ctx.save();
      ctx.translate(d.x + T / 2, d.y + T / 2);
      ctx.shadowColor = 'rgba(' + rgb + ',' + (0.5 + pulse * 0.5) + ')';
      ctx.shadowBlur = 26 + Math.sin(t * 2) * 8;
      ctx.fillStyle = col;
      rr(ctx, -T / 2 + 4, -T / 2, T - 8, T, 10); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      rr(ctx, -T / 2 + 8, -T / 2 + 4, T - 16, T - 8, 8); ctx.fill();
      ctx.fillStyle = dark;
      rr(ctx, -T / 2 + 11, -T / 2 + 7, T - 22, T - 14, 6); ctx.fill();
      // 光束
      ctx.globalAlpha = 0.25 + Math.sin(t * 2) * 0.1;
      ctx.fillStyle = light;
      ctx.beginPath();
      ctx.moveTo(-10, 0); ctx.lineTo(10, 0); ctx.lineTo(22, 60); ctx.lineTo(-22, 60);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
    },

    player(ctx, p, g) {
      const S = skin(p);
      ctx.save();
      ctx.translate(p.cx, p.y + p.h);
      const sq = p.squash;
      const sx = 1 + sq * 0.5, sy = 1 - sq * 0.5;
      /* 双人模式的小人比单人小一圈，而下面所有图形坐标都是按 22×28 写死的，
         所以整体等比缩放一次。宽高分开算，免得把比例拉歪。 */
      const kw = p.w / 22, kh = p.h / 28;
      ctx.scale(sx * kw, sy * kh);

      if (p.fly) {
        ctx.shadowColor = S.glow;
        ctx.shadowBlur = 24;
        // 翅膀
        const flap = Math.sin(performance.now() / 70) * 8;
        ctx.fillStyle = S.wing;
        ctx.beginPath();
        ctx.moveTo(-10, -22); ctx.lineTo(-30, -34 - flap); ctx.lineTo(-10, -8);
        ctx.moveTo(10, -22); ctx.lineTo(30, -34 - flap); ctx.lineTo(10, -8);
        ctx.fill();
      } else if (p.invincible) {
        ctx.shadowColor = S.glow;
        ctx.shadowBlur = 14;
      }

      const bodyTop = -p.h;
      ctx.fillStyle = p.invincible ? S.inv : S.body;
      rr(ctx, -p.w / 2, bodyTop, p.w, p.h, 7); ctx.fill();
      ctx.shadowBlur = 0;

      // 角
      ctx.fillStyle = S.horn;
      ctx.beginPath();
      ctx.moveTo(-p.w / 2 + 2, bodyTop + 3); ctx.lineTo(-p.w / 2 + 6, bodyTop - 7); ctx.lineTo(-p.w / 2 + 10, bodyTop + 3);
      ctx.moveTo(p.w / 2 - 2, bodyTop + 3); ctx.lineTo(p.w / 2 - 6, bodyTop - 7); ctx.lineTo(p.w / 2 - 10, bodyTop + 3);
      ctx.fill();

      // 眼睛
      const ex = p.face * 3;
      ctx.fillStyle = S.eye;
      if (p.dead) {
        ctx.lineWidth = 2; ctx.strokeStyle = S.eye;
        ctx.beginPath();
        ctx.moveTo(ex - 6, bodyTop + 9); ctx.lineTo(ex - 1, bodyTop + 14);
        ctx.moveTo(ex - 1, bodyTop + 9); ctx.lineTo(ex - 6, bodyTop + 14);
        ctx.moveTo(ex + 2, bodyTop + 9); ctx.lineTo(ex + 7, bodyTop + 14);
        ctx.moveTo(ex + 7, bodyTop + 9); ctx.lineTo(ex + 2, bodyTop + 14);
        ctx.stroke();
      } else {
        ctx.fillRect(ex - 6, bodyTop + 9, 4, 6);
        ctx.fillRect(ex + 2, bodyTop + 9, 4, 6);
        ctx.fillStyle = '#fff';
        ctx.fillRect(ex - 5, bodyTop + 9, 2, 2);
        ctx.fillRect(ex + 3, bodyTop + 9, 2, 2);
      }
      // 嘴
      ctx.fillStyle = S.eye;
      ctx.fillRect(ex - 3, bodyTop + 20, 7, 2);

      // 腿
      if (!p.fly) {
        const swing = p.grounded ? Math.sin(p.walk * 4) * 4 : 2;
        ctx.fillStyle = S.leg;
        ctx.fillRect(-8, -2, 5, 5 + swing);
        ctx.fillRect(3, -2, 5, 5 - swing);
      }

      /* 枪战模式：手里握着一把枪。
         需求原文「小人在此模式下持枪」「统一平射」—— 枪管固定水平，
         所以这里只按朝向水平翻转，不做任何俯仰角 —— 视觉上就能看出「打不到头顶上的人」。 */
      if (g && g.mode && g.mode.indexOf('gun') === 0) {
        this._gunInHand(ctx, p, g, bodyTop);
      } else if (g && g.roomOn && (g.roomMode === 'gffa' || g.roomMode === 'gteam') && p.gun) {
        this._gunInHand(ctx, p, g, bodyTop);
      }
      /* 联机枪战：出生保护（3 秒无敌）—— 一圈旋转的青色护盾 */
      if ((p.proT || 0) > 0) {
        const k = p.proT / 3;
        ctx.save();
        ctx.globalAlpha = 0.35 + 0.4 * Math.min(1, k);
        ctx.strokeStyle = '#6ef7ff';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.lineDashOffset = -performance.now() / 22;
        ctx.beginPath();
        ctx.arc(0, bodyTop + p.h * 0.45, p.w * 0.95, 0, 7);
        ctx.stroke();
        ctx.restore();
      }
      /* 散打出拳：一只白亮的小拳头朝面向方向挥出，收拳时缩小消失 */
      if (p.punchT > 0) {
        const k = Math.min(1, p.punchT / 0.18);
        const dir = p.face || 1;
        ctx.save();
        ctx.globalAlpha = Math.min(1, k * 1.5);
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#fff6d8';
        ctx.beginPath();
        ctx.arc(dir * (p.w / 2 + 9), bodyTop + p.h * 0.42, 4 + 6 * (1 - k), 0, 7);
        ctx.fill();
        ctx.restore();
      }

      /* 联机房间：所有小人头顶都挂临时昵称（房主带 👑）；本地那个用金色标出来 */
      if (p.tag) {
        const isMe = g && g.player === p;
        ctx.globalAlpha = 0.95;
        ctx.font = '700 10px "MiSans",sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(8,10,20,.75)';
        ctx.strokeText(p.tag, 0, bodyTop - 12);
        ctx.fillStyle = isMe ? '#ffe9a8' : (S.body || '#cfd6ff');
        ctx.fillText(p.tag, 0, bodyTop - 12);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    },

    /* 散打模式的血条：画在头顶名牌下方，红绿渐变一眼看出谁快没了 */
    _roomHp(ctx, p) {
      if (p.dead) return;
      const w = 34, x = p.cx - w / 2, y = p.y - 9;
      const pct = Math.max(0, Math.min(1, (p.hp == null ? 100 : p.hp) / 100));
      ctx.save();
      ctx.fillStyle = 'rgba(8,10,20,.72)';
      rr(ctx, x - 1, y - 1, w + 2, 6, 3); ctx.fill();
      ctx.fillStyle = pct > 0.4 ? '#35e0a1' : '#ff4d6d';
      rr(ctx, x, y, Math.max(1, w * pct), 4, 2); ctx.fill();
      ctx.restore();
    },

    _gunInHand(ctx, p, g, bodyTop) {
      const st = p.gun;
      const wid = st ? st.weaponId : 'pistol';
      const w = (LD.Guns && LD.Guns.byId[wid]) || { id: 'pistol', color: '#ffe066' };
      const dir = p.face || 1;
      const gy = bodyTop + p.h * 0.42;            // 与 AI 的 gunY() 对齐
      const recoil = st && st.recoil > 0 ? st.recoil * 3 : 0;
      ctx.save();
      ctx.translate(dir * (p.w / 2 - 2) - dir * recoil, gy);
      ctx.scale(dir, 1);                          // 朝右为正，朝左整体镜像
      // 手臂
      ctx.fillStyle = p.kind === 'blue' ? '#2b8fd8' : '#d9a900';
      ctx.fillRect(-3, -2, 9, 5);
      // 枪身
      const long = (wid === 'sniper' || wid === 'rpg' || wid === 'quad') ? 20 : (wid === 'smg' ? 14 : 11);
      const thick = (wid === 'rpg' || wid === 'quad') ? 7 : 5;
      ctx.fillStyle = '#2f3550';
      rr(ctx, 4, -thick / 2, long, thick, 2); ctx.fill();
      // 枪管高光 / 配色条
      ctx.fillStyle = w.color || '#ffe066';
      ctx.fillRect(6, -thick / 2 + 1, long - 4, 1.6);
      // 四联火箭筒：四个管口
      if (wid === 'quad') {
        ctx.fillStyle = '#ff3d71';
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
          ctx.fillRect(long + 2, -3 + i * 3, 2, 2);
          ctx.fillRect(long + 2, -3 + j * 3, 2, 2);
        }
      }
      // 换弹时枪口下压 + 转圈提示
      if (st && st.isReloading && st.isReloading()) {
        ctx.rotate(0.38);
        ctx.fillStyle = 'rgba(255,210,63,.95)';
        ctx.fillRect(long - 2, -thick / 2 - 4, 3, 3);
      }
      ctx.restore();

      /* 射速增益：枪口冒火苗，一眼能看出「我现在是双倍 / 三倍」 */
      if (st && st.boostT > 0 && st.boostRate > 1) {
        /* 火苗要贴着**枪口**画，所以只能用相对量：
           调用本函数时坐标系原点已经在角色脚底（两个调用点都在局部变换里），
           枪口在局部坐标的 x = dir*(w/2 - 2 - recoil + 4 + long)。
           早先这里写的是 p.cx + …（绝对世界坐标）—— 在「原点=脚底」的坐标系里
           等于把火苗甩到了角色的两倍远处，实测一直没见它出现过。 */
        const mx = dir * (p.w / 2 + long + 2 - recoil);
        ctx.save();
        ctx.globalAlpha = 0.55 + Math.random() * 0.4;
        ctx.fillStyle = st.boostKind === 'triple' ? '#ff6b9d' : '#ffd23f';
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(mx + dir * i * 3, gy + Math.sin(i * 2 + p.x * 0.05) * 2, 2.2, 0, 7);
          ctx.fill();
        }
        ctx.restore();
      }
    },

    /* 屏幕外指示：小人 / 门跑到画面外时在边缘画个箭头，不至于「人不见了」 */
    indicators(ctx, g, w, actors) {
      const t = w.time * 3;
      const arrow = (color, left) => {
        const ax = left ? 26 : VW - 26;
        const ay = VH / 2 + Math.sin(t * 2) * 6;
        ctx.save();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.92;
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        if (left) { ctx.moveTo(ax - 14, ay); ctx.lineTo(ax + 10, ay - 13); ctx.lineTo(ax + 10, ay + 13); }
        else { ctx.moveTo(ax + 14, ay); ctx.lineTo(ax - 10, ay - 13); ctx.lineTo(ax - 10, ay + 13); }
        ctx.closePath(); ctx.fill();
        ctx.restore();
      };
      if (actors.length > 1) {
        for (const p of actors) {
          const sl = p.cx - g.camX;
          if (sl < 0) arrow(skin(p).body, true);
          else if (sl > VW) arrow(skin(p).body, false);
        }
      }
      // 门在屏幕外时的指示箭头
      const d = w.door;
      if (!d) return;
      const doorScreenX = d.x - g.camX;
      if (doorScreenX <= VW - 20 && doorScreenX >= 0) return;
      const right = doorScreenX >= VW - 20;
      const ax = right ? VW - 30 : 30;
      const ay = 60 + Math.sin(t * 2) * 6;
      ctx.save();
      ctx.fillStyle = '#35e0a1';
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      if (right) { ctx.moveTo(ax + 14, ay); ctx.lineTo(ax - 8, ay - 12); ctx.lineTo(ax - 8, ay + 12); }
      else { ctx.moveTo(ax - 14, ay); ctx.lineTo(ax + 8, ay - 12); ctx.lineTo(ax + 8, ay + 12); }
      ctx.closePath(); ctx.fill();
      ctx.restore();
    },

    /* ---------------- 物品栏（MC 风格 hotbar） ----------------
       需求原文：「加入类似 MC 的物品栏，物品栏中是枪械（按顺序摆放），未解锁的物品不出现」。

       摆在画面底部居中，按武器表顺序排（F1~F10 共 10 格，解锁几格画几格）。
       每格给四样信息：
         左上角  槽位键（F1…F10，跟着玩家实际绑定走，改键后不会说谎）
         中间    武器剪影（单色，48px 的格子里只求「一眼分出是哪一类」）
         右下角  枪＝剩余弹药；道具＝冷却剩余秒数
         状态    选中＝白粗边 + 放大 + 光晕；冷却中＝暗罩 + 从上往下的冷却水位
       未解锁的槽**直接不画**（而不是画成灰的）—— 需求原话是「不出现」。
       格子尺寸按「屏宽够不够」自适应：10 格 × 48px 在 960 的屏上是 534px，
       放得下，所以保持 48px；再多就得缩格（见 CELL 的算法）。 */
    hotbar(ctx, g) {
      const p = g.pR;
      if (!p || !p.gun) return;
      /* 用「已解锁进度」而不是「当前关卡」来过滤：
         密码解锁了全部枪械之后再去打第 3 关，gunStage 只有 3，
         物品栏就会只画出 3 个格子 —— 玩家看到的正是
         「解锁后武器栏未出现所有枪械」。game.js 的 gunUnlockStage() 给的是两者较大值。 */
      const stage = g.roomOn ? 99 : (g.gunUnlockStage ? g.gunUnlockStage() : g.gunStage);
      const list = LD.Guns.WEAPONS.filter((w) => LD.Guns.unlockedAt(w.id, stage));
      if (!list.length) return;

      const S = LD.Settings;
      /* 槽位键的显示文本。双人对枪时红方要让出分给蓝方的键，
         所以这里也走一遍 gunKeyUnion 过滤 —— 显示的必须是真的按得响的键。 */
      const keyOf = (slot) => {
        const act = 'gun' + slot.slice(1);
        if (!S || !S.labelExcept) return slot;
        return S.labelExcept(act, S.gunKeyUnion());
      };

      const ANIM = 0.22;
      const n = list.length;
      /* 自适应格子：默认 48px + 6px 间距；格子多了（解锁到 F10）就整体缩一点，
         保证一条物品栏永远不会溢出 960 的画布。 */
      const CELL = Math.min(48, Math.floor((VW - 40 - (n - 1) * 6) / n));
      const GAP = 6;
      const totalW = n * CELL + (n - 1) * GAP;
      const x0 = Math.round((VW - totalW) / 2);
      const y0 = VH - CELL - 14;

      // 选中格的弹跳：让「换了枪」这件事在视觉上也有反馈（只吃 0.22s）
      const sel = p.gun.weaponId;
      const selIdx = list.findIndex((w) => w.id === sel);

      ctx.save();

      /* 底板：MC 的物品栏是「一条深色横条」，加它才能把格子和背景地形分开 */
      ctx.fillStyle = 'rgba(12,10,26,0.62)';
      rr(ctx, x0 - 8, y0 - 8, totalW + 16, CELL + 16, 12); ctx.fill();
      ctx.strokeStyle = 'rgba(160,150,220,0.30)';
      ctx.lineWidth = 1;
      rr(ctx, x0 - 8, y0 - 8, totalW + 16, CELL + 16, 12); ctx.stroke();

      for (let i = 0; i < n; i++) {
        const w = list[i];
        const isGun = w.kind === 'gun';
        const on = isGun && w.id === sel;
        const cooling = !isGun && !p.gun.itemReady(w.id);
        const pop = on ? 1.08 : 1;
        const cw = CELL * pop, ch = CELL * pop;
        const cx = x0 + i * (CELL + GAP) + CELL / 2;
        const cy = y0 + CELL / 2;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(pop, pop);

        // 格底
        ctx.fillStyle = on ? 'rgba(72,64,120,0.92)' : 'rgba(28,25,50,0.86)';
        rr(ctx, -CELL / 2, -CELL / 2, CELL, CELL, 7); ctx.fill();
        // 内高光（MC 的格子有上下明暗）
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = 1;
        rr(ctx, -CELL / 2 + 1.5, -CELL / 2 + 1.5, CELL - 3, CELL - 3, 6); ctx.stroke();

        // 武器剪影
        const ico = ICON[w.id] || ICON.pistol;
        ctx.fillStyle = isGun
          ? (on ? '#ffffff' : 'rgba(226,222,255,0.72)')
          : (cooling ? 'rgba(150,150,175,0.40)' : 'rgba(180,255,220,0.82)');
        ico(ctx, 0, 1, CELL);
        ctx.restore();

        // 冷却水位（道具专用）
        if (cooling) {
          const cd = p.gun.cooldownLeft(w.id);
          const ratio = LD.clamp(cd / (w.cd || 1), 0, 1);
          ctx.save();
          rr(ctx, cx - cw / 2, cy - ch / 2, cw, ch, 7); ctx.clip();
          ctx.fillStyle = 'rgba(6,6,16,0.55)';
          ctx.fillRect(cx - cw / 2, cy - ch / 2, cw, ch * ratio);
          ctx.restore();
        }

        // 边框（选中最亮）
        ctx.strokeStyle = on ? 'rgba(255,255,255,0.96)' : 'rgba(150,145,200,0.42)';
        ctx.lineWidth = on ? 2.4 : 1.4;
        if (on) { ctx.shadowColor = 'rgba(255,255,255,0.65)'; ctx.shadowBlur = 10; }
        rr(ctx, cx - cw / 2, cy - ch / 2, cw, ch, 7); ctx.stroke();
        ctx.shadowBlur = 0;

        // 左上：槽位键
        ctx.fillStyle = on ? 'rgba(255,255,255,0.95)' : 'rgba(198,194,235,0.62)';
        ctx.font = 'bold 10px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(keyOf(w.slot), cx - cw / 2 + 5, cy - ch / 2 + 4);

        // 右下：弹药 / 冷却秒数
        let badge = '', bcol = 'rgba(255,255,255,0.9)';
        if (isGun) {
          /* 每格显示「这把枪自己的」弹匣（ammoOf(id)）。
             早先这里用的是 ammo()＝当前武器 —— 于是 F1/F2/F3/F4 四个格子
             全显示同一个数字（当前那把 smg 的 50），看不出谁快打光了。
             换弹提示只给选中的那格：换弹是 GunState 上的单个状态，不是每把枪各有。 */
          if (on && p.gun.isReloading()) { badge = p.gun.reloadT.toFixed(1) + 's'; bcol = '#ffb347'; }
          else {
            const a = p.gun.ammoOf(w.id);
            badge = a === Infinity ? '∞' : String(a);
            if (a !== Infinity && a <= 0) bcol = '#ff6b6b';
          }
        } else if (cooling) {
          badge = Math.ceil(p.gun.cooldownLeft(w.id)) + 's';
          bcol = 'rgba(255,190,140,0.85)';
        }
        if (badge) {
          ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif';
          ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
          ctx.fillStyle = 'rgba(0,0,0,0.65)';
          ctx.fillText(badge, cx + cw / 2 - 4, cy + ch / 2 - 2 + 1);
          ctx.fillStyle = bcol;
          ctx.fillText(badge, cx + cw / 2 - 4, cy + ch / 2 - 2);
        }
      }

      // 选中武器的名字（画在物品栏正上方）
      if (selIdx >= 0) {
        const w = list[selIdx];
        const nm = (LD.I18N && LD.I18N.lang === 'en') ? w.nameEn : w.name;
        const txt = w.slot + ' ' + nm;
        ctx.font = 'bold 13px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        const tw = ctx.measureText(txt).width;
        ctx.fillStyle = 'rgba(12,10,26,0.7)';
        rr(ctx, VW / 2 - tw / 2 - 9, y0 - 32, tw + 18, 22, 8); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.94)';
        ctx.fillText(txt, VW / 2, y0 - 15);
      }

      ctx.restore();
    },

    overlays(ctx, g, w) {
      /* 双人模式：顶部一条倒计时进度条。
         两个人都在同一屏里，但「还剩多少时间」是这一关最要紧的信息，
         所以画在画布最上面，快没了变黄、最后 10 秒变红。 */
      if (g.mode === 'coop' && g.coopTimeLimit > 0 && (g.state === 'playing' || g.state === 'won' || g.state === 'coopFail')) {
        const left = Math.max(0, g.coopTimeLimit - g.levelTime);
        const ratio = left / g.coopTimeLimit;
        const bw = VW - 200, bh = 9, x0 = 100, y0 = 12;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.42)';
        rr(ctx, x0 - 3, y0 - 3, bw + 6, bh + 6, 8); ctx.fill();
        const col = left <= 10 ? '#ff4d6d' : (left <= 25 ? '#ffd23f' : '#35e0a1');
        ctx.fillStyle = col;
        ctx.shadowColor = col;
        ctx.shadowBlur = 12;
        rr(ctx, x0, y0, Math.max(3, bw * ratio), bh, 5); ctx.fill();
        ctx.restore();
      }
      // 作弊金光
      if (g.cheat) {
        const grd = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.35, VW / 2, VH / 2, VH * 0.95);
        grd.addColorStop(0, 'rgba(255,210,63,0)');
        grd.addColorStop(1, 'rgba(255,180,30,0.20)');
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, VW, VH);
      }
      // 死亡红闪
      if (g.deathFlash > 0) {
        ctx.fillStyle = 'rgba(255,60,90,' + (g.deathFlash * 0.42) + ')';
        ctx.fillRect(0, 0, VW, VH);
      }
      // 连击进度点（数量跟随设置里的「连按次数」）
      const pulse = LD.Input.cheatPulse;
      const need = LD.Input.cheatNeed();
      if (pulse > 0) {
        ctx.save();
        ctx.translate(VW - 24, 22);
        for (let i = 0; i < need; i++) {
          ctx.beginPath();
          ctx.arc(-i * 16, 0, 5.5, 0, 7);
          ctx.fillStyle = i < pulse ? '#ffd75e' : 'rgba(255,255,255,0.18)';
          ctx.fill();
        }
        ctx.restore();
      }
      /* ---------------- 无人机视角 Overlay ----------------
         「无人机模式是静如无人机视角」——既然镜头切到无人机上，
         画面就得让人一眼看出「我现在是在看无人机的镜头」，而不是
         小人视角出了 bug。三样东西：
           ① 全屏淡青色调 + 扫描线 + 圆形遮罩（镜头感）
           ② 四角取景框
           ③ 顶部一行状态：机种 / 剩余时间 / 开火键提示
         自爆机另外画一个中心准星 + 通往最近敌人的虚线锁定线。 */
      const dv = g.droneView;
      if (dv && !dv.dead && g.mode === 'gun') {
        const t = (w.time || 0);
        ctx.save();
        // ① 色调 + 扫描线
        ctx.fillStyle = dv.recon ? 'rgba(60,200,255,0.10)' : 'rgba(255,90,120,0.10)';
        ctx.fillRect(0, 0, VW, VH);
        ctx.globalAlpha = 0.10;
        ctx.fillStyle = '#000';
        for (let y = (Math.floor(t * 90) % 4); y < VH; y += 4) ctx.fillRect(0, y, VW, 1);
        ctx.globalAlpha = 1;
        // 圆形镜头遮罩（四周压暗，中间清楚）
        const lg = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.30, VW / 2, VH / 2, VH * 0.72);
        lg.addColorStop(0, 'rgba(0,0,0,0)');
        lg.addColorStop(1, dv.recon ? 'rgba(2,20,34,0.72)' : 'rgba(34,2,10,0.72)');
        ctx.fillStyle = lg;
        ctx.fillRect(0, 0, VW, VH);
        // ② 取景框四角
        const col = dv.recon ? '#7ad4ff' : '#ff6b8a';
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.85;
        const M = 34, L = 26;
        for (const [cx2, cy2, dxs, dys] of [[M, M, 1, 1], [VW - M, M, -1, 1], [M, VH - M, 1, -1], [VW - M, VH - M, -1, -1]]) {
          ctx.beginPath();
          ctx.moveTo(cx2 + dxs * L, cy2); ctx.lineTo(cx2, cy2); ctx.lineTo(cx2, cy2 + dys * L);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        // 中心准星（自爆机）
        if (!dv.recon) {
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.6;
          const pulse = 0.5 + 0.5 * Math.sin(t * 9);
          ctx.globalAlpha = 0.55 + pulse * 0.4;
          ctx.beginPath(); ctx.arc(VW / 2, VH / 2, 16 + pulse * 3, 0, 7); ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(VW / 2 - 26, VH / 2); ctx.lineTo(VW / 2 - 8, VH / 2);
          ctx.moveTo(VW / 2 + 8, VH / 2); ctx.lineTo(VW / 2 + 26, VH / 2);
          ctx.moveTo(VW / 2, VH / 2 - 26); ctx.lineTo(VW / 2, VH / 2 - 8);
          ctx.moveTo(VW / 2, VH / 2 + 8); ctx.lineTo(VW / 2, VH / 2 + 26);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        /* ③ 顶部状态条 */
        const lab = dv.recon
          ? (LD.I18N.lang === 'en' ? 'RECON DRONE · STEER + FIRE · INVULNERABLE' : '侦查无人机 · 遥控飞行 · 开火射击 · 小人无敌')
          : (LD.I18N.lang === 'en' ? 'KAMIKAZE DRONE · FIRE TO DETONATE · INVULNERABLE' : '自爆无人机 · 开火引爆 · 小人无敌');
        ctx.font = 'bold 12px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        const tw2 = ctx.measureText(lab).width;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        rr(ctx, 26, 16, tw2 + 74, 24, 7); ctx.fill();
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(38, 28, 5, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.94)';
        ctx.fillText(lab, 50, 29);
        ctx.fillStyle = 'rgba(255,255,255,0.72)';
        ctx.textAlign = 'right';
        ctx.fillText(Math.max(0, dv.t).toFixed(1) + 's', 26 + tw2 + 66, 29);
        ctx.textAlign = 'left';
        ctx.restore();
      }

      // 暗角
      const vg = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.45, VW / 2, VH / 2, VH * 1.05);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, VW, VH);

      /* 物品栏画在暗角**之后** —— 画在前面的话会被那层 0.45 的暗角压灰，
         底部正好是暗角最重的地方。对枪模式不画：那两把枪是设置里定死的，
         局内不能换，摆一条点不动的物品栏只会误导。
         联机枪战（大乱斗 / 团队）也画：武器全解锁，点武器栏即切枪。 */
      if (g.mode === 'gun' && g.gunMode !== 'duel') {
        this.hotbar(ctx, g);
        /* 吸进技能槽的木箱补给：物品栏上方一枚小徽章（手机沉浸模式顶栏
           被隐藏时，这里是玩家唯一能看见技能槽的地方） */
        if (g.pR && g.pR.heldPickup) this.heldChip(ctx, g);
      } else if (g.roomOn && (g.roomMode === 'gffa' || g.roomMode === 'gteam') && g.player && g.player.gun) {
        this.hotbar(ctx, g);
      }
    },

    /* 技能槽徽章：物品栏正上方，图标 + 「按 E 使用」提示 */
    heldChip(ctx, g) {
      const kind = g.pR.heldPickup;
      const info = LD.Guns.BOOSTS[kind];
      if (!info) return;
      const s = 30;
      const x = VW / 2 - s / 2, y = VH - 48 - s - 26;
      const t = g.world ? g.world.time : 0;
      const pulse = 0.5 + 0.5 * Math.sin(t * 5);
      ctx.save();
      ctx.shadowColor = info.color;
      ctx.shadowBlur = 7 + pulse * 7;
      ctx.fillStyle = 'rgba(16,12,30,.9)';
      rr(ctx, x, y, s, s, 6); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = info.color;
      ctx.lineWidth = 2;
      rr(ctx, x + 1, y + 1, s - 2, s - 2, 5); ctx.stroke();
      /* 炫酷技能图标（含动态光环） */
      this.boostIcon(ctx, kind, x + s / 2, y + s / 2, s, t);
      /* 键位提示小字 */
      ctx.font = 'bold 10px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.fillText(LD.Settings.label('usepick'), x + s / 2, y + s + 3);
      ctx.restore();
    },
  };
})();
