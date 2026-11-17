/* player.js — 玩家：物理 / 碰撞 / 跳跃手感 / 作弊（无敌 + 飞行） / 双人模式
   kind: 'red'  红魔（火）—— 怕水池，可以踩火池
         'blue' 蓝魔（冰）—— 怕火池，可以踩水池
         酸池对两个人都有害。
   双人模式下两个小人可以互相踩头（y 轴软碰撞，x 轴可以互相穿过）。
*/
(function () {
  const T = LD.TILE;
  const SPEED = 4.4, ACCEL = 0.92, FRICTION = 0.74, AIR_ACCEL = 0.52;
  const GRAVITY = 0.9, MAX_FALL = 17, JUMP = 15.4;
  const COYOTE = 7, BUFFER = 8;
  /* 传送带：每秒往一个方向带的加速度 / 最高速度。
     最高速刻意比跑步（SPEED = 4.4）快一截 —— 传送带的意义就是「比你跑得快」，
     站在上面必须主动起跳才能脱离。 */
  const BELT_ACCEL = 1.15, BELT_MAX = 5.8;
  /* 无限跳：空中再跳也生效，但给一点衰减 + 最小间隔，
     免得「按住不放 / 疯狂点按」变成一路窜上天。 */
  const AIR_JUMP_SCALE = 0.92, JUMP_GAP = 4;
  // 作弊飞行：水平速度 / 上升速度（按住跳跃键）/ 缓降速度（松开）/ 快速下降（按下蹲键）
  /* 移速要比普通跑动（SPEED = 4.4）明显快一截，否则开着作弊还觉得爬；
     8.0 约等于跑步的 1.8 倍，小于一格瓦片宽度，不会穿过墙。 */
  const CHEAT_SPEED = 8.0, CHEAT_RISE = 7.2, CHEAT_GLIDE = 1.6, CHEAT_DIVE = 9.0;

  LD.Player = class Player {
    constructor(world, kind, spawn) {
      this.w = 22; this.h = 28;
      this.kind = kind === 'blue' ? 'blue' : 'red';
      this.soft = true;            // 标记为「软实体」：别人可以踩，不能挡路
      this.invincible = false;
      this.fly = false;
      this.dead = false;
      this.alpha = 1;
      this.home = spawn || null;   // 双人模式：每个人有各自的出生点
      this.reset(world);
    }

    reset(world) {
      const s = this.home || world.spawn;
      this.x = s.x;
      // 出生点存的是「脚踩在哪条线上」（footY），这样比单人小一圈的双人小人
      // 也会正好站在格子顶面上，而不是先悬空几像素再掉下来。
      this.y = s.footY != null ? s.footY - this.h : s.y;
      this.vx = 0; this.vy = 0;
      this.grounded = false; this.coyote = 0; this.buffer = 0;
      this.airJumpT = 0; this.jumpCount = 0;       // 无限跳：空中连跳间隔 / 本段跳跃次数
      this.face = 1; this.walk = 0; this.standMover = null;
      this.dead = false; this.alpha = 1; this.squash = 0; this.hurtFx = 0;
      this.deathT = 0;
    }

    get cx() { return this.x + this.w / 2; }
    get cy() { return this.y + this.h / 2; }
    get box() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }

    /* 元素免疫：地刺 / 机关对两个人都有害，酸池两人都溶，
       火池只溶蓝魔，水池只溶红魔。 */
    killsBy(elem) {
      if (this.invincible) return false;
      if (!elem) return true;
      if (elem === 'acid') return true;
      if (elem === 'fire') return this.kind === 'blue';
      if (elem === 'water') return this.kind === 'red';
      return true;
    }

    /* 脚下是否还踩在这个实体上（用来判断「还站在平台上」而不是「曾经站过」） */
    _rides(m) {
      if (!m) return false;
      if (this._onRect(m)) return true;
      return false;
    }

    _onRect(m) {
      const footY = this.y + this.h;
      return this.x + this.w > m.x + 1 && this.x < m.x + m.w - 1 &&
             footY > m.y - 3 && footY < m.y + m.h * 0.7 + 4;
    }

    update(dt, world, input) {
      const f = dt * 60;
      if (this.hurtFx > 0) this.hurtFx = Math.max(0, this.hurtFx - dt * 2);
      if (this.squash > 0) this.squash = Math.max(0, this.squash - dt * 4);
      if (this.dead) return;

      /* 被移动平台/落锤带着走。
         这里必须每帧确认「平台此刻还在脚底下」再带着走 —— 早先只靠一个
         standMover 标记，跳离平台后标记不会被清掉，人已经在空中了还被那块
         早已走远的平台持续位移，会被拖进墙里、拖出世界底部（小人就"消失"了）。 */
      if (this.standMover) {
        if (this._rides(this.standMover)) {
          const m = this.standMover;
          if (Number.isFinite(m.dx)) this.x += m.dx;
          if (Number.isFinite(m.dy)) this.y += m.dy;
        } else {
          this.standMover = null;
        }
      }

      if (this.fly) { this._fly(f, world, input); return; }

      const dir = (input.right() ? 1 : 0) - (input.left() ? 1 : 0);
      /* 移速倍率：联机房主设置里的「全员移速加成」（默认 1），普通玩法不动 */
      const spMax = SPEED * (this.speedMul || 1);
      const accel = this.grounded ? ACCEL : AIR_ACCEL;
      if (dir !== 0) {
        this.vx += dir * accel * f;
        this.vx = LD.clamp(this.vx, -spMax, spMax);
        this.face = dir;
      } else if (this.grounded) {
        this.vx *= Math.pow(FRICTION, f);
        if (Math.abs(this.vx) < 0.06) this.vx = 0;
      }

      if (input.jumpPressed()) this.buffer = BUFFER;
      this.buffer -= f;
      this.coyote = this.grounded ? COYOTE : this.coyote - f;

      /* ---- 跳跃（只能在落地时跳一次） ----
         需求：取消「空中无限连跳」，改成标准平台跳跃——只有脚踩地面
         （coyote 土狼时间 > 0）时按跳跃键才起跳，空中无法再跳。
         细节：
           · 判定用 buffer（新按下才刷新），不是 jumpHeld ——
             否则一直按住跳跃键就会每帧顶一次速度、直接飞出屏幕。
           · 保留 coyote（土狼时间）手感：刚走下平台边缘的一瞬间还能跳。
           · 抬起键仍然截断上升（松开=短跳），逐跳可控高度。 */
      if (this.buffer > 0 && this.coyote > 0) {
        this.vy = -JUMP;
        this.buffer = 0; this.coyote = 0;
        this.grounded = false; this.squash = -0.35;
        this.standMover = null;
        this.jumpCount = (this.jumpCount || 0) + 1;
        LD.Sfx.jump();
        LD.FX.burst(this.cx, this.y + this.h, 6, this.kind === 'blue' ? '#7ad4ff' : '#8fa6ff', 2.4);
      }
      if (this.airJumpT > 0) this.airJumpT -= f;
      if (!input.jumpHeld() && this.vy < -4.6) this.vy = -4.6;   // 松开=短跳

      // ---- 重力 / 地面贴合 ----
      // 用「脚下探测」判定站立状态，而不是依赖碰撞回弹的副作用：后者会让
      // 静止站立的角色每隔一帧在 grounded true/false 之间抖动，于是反复
      // 触发落地音效和粒子（"站着不动却一直有声音和白色碎屑"）。
      const wasGrounded = this.grounded;
      const fallSpeed = this.vy;          // 本帧下坠速度，用于判定是否值得播落地反馈

      if (this._onGround(world)) {
        this.grounded = true;
        if (this.vy > 0) this.vy = 0;     // 贴地：清掉下坠速度
      } else {
        this.grounded = false;
        this.vy = Math.min(this.vy + GRAVITY * f, MAX_FALL);
      }

      this._moveAxis(world, 'x', this.vx * f, f);
      this._moveAxis(world, 'y', this.vy * f, f);

      // 移动之后再探一次：走下平台边缘 / 被推着落地
      if (this._onGround(world)) {
        this.grounded = true;
        if (this.vy > 0) this.vy = 0;
      } else {
        this.grounded = false;
      }

      if (this.grounded) {
        this.walk += Math.abs(this.vx) * 0.09;
        // 只有真正从空中摔下来才播落地反馈（轻踩地面不出声、不冒灰）
        if (!wasGrounded && fallSpeed > 7) {
          this.squash = 0.3;
          LD.Sfx.land();
          LD.FX.burst(this.cx, this.y + this.h, 4, '#5a659e', 1.4);
        }
      } else {
        // 离地就不再"站在"任何东西上（踩头 / 踩平台都一样）
        this.standMover = null;
      }

      /* ---- 传送带：站在 A（→）/ Z（←）地面上会被自动带走 ----
         读「脚底那一格」的字符，朝字符方向加速；摩擦只削你输入产生的速度，
         削不掉传送带持续施加的力，所以最终会稳定在比跑步更快的带速上。
         跳跃 naturally 脱离（离地即失效）。 */
      if (this.grounded && !this.fly) {
        const feetRow = Math.floor((this.y + this.h + 2) / T);
        const bc0 = Math.floor((this.x + 3) / T), bc1 = Math.floor((this.x + this.w - 4) / T);
        let belt = 0;
        for (let c = bc0; c <= bc1; c++) {
          const ch = world.charAt(c, feetRow);
          if (ch === 'A') belt = 1;
          else if (ch === 'Z') belt = -1;
        }
        if (belt) {
          this.vx = LD.clamp(this.vx + belt * BELT_ACCEL * f, -BELT_MAX, BELT_MAX);
          if (belt > 0 ? this.vx > 0.5 : this.vx < -0.5) this.face = belt;
        }
      }

      this._clampToWorld(world);
    }

    // 脚下探测：脚底往下 1.5px 内是否有实体（比碰撞回弹稳定得多）
    _onGround(world) {
      const footY = this.y + this.h;
      const x0 = this.x + 3, x1 = this.x + this.w - 4;
      if (x1 <= x0) return false;
      const row = Math.floor((footY + 1.5) / T);
      for (let c = Math.floor(x0 / T); c <= Math.floor(x1 / T); c++) {
        if (world.isSolid(c, row)) return true;
      }
      const feet = { x: x0, y: footY - 1, w: x1 - x0, h: 3 };
      for (const m of world.solidRects()) {
        if (m === this) continue;
        if (LD.rectHit(feet, m)) return true;
      }
      return false;
    }

    /* 世界边界兜底：无论谁把小人推到哪里，都不允许离开关卡范围。
       以前只有作弊飞行做了 clamp，普通模式没有任何兜底 —— 被移动平台带着走
       或者卡在关卡边缘时，小人能被挤出世界，于是"看不见了"。 */
    _clampToWorld(world) {
      const maxX = Math.max(0, world.pxW - this.w);
      if (!Number.isFinite(this.x)) this.x = 0;
      if (!Number.isFinite(this.y)) this.y = 0;
      this.x = LD.clamp(this.x, 0, maxX);
      // 顶部同样夹住（掉进坑里往下跌是正常的，所以底部不夹）
      if (this.y < 0) { this.y = 0; if (this.vy < 0) this.vy = 0; }
    }

    /* 作弊飞行：
       - 无敌，可以穿过「有伤害的物品」（地刺 / 酸液 / 锯轮 / 守卫 / 飞行怪 / 落锤）
       - 但地面、台阶、墙、移动平台照常挡住你 —— 不能穿墙乱飞
       - 按住跳跃键上升，松开缓缓下降，按下蹲键快速下降
       注意：这里复用普通模式的 _moveAxis，所以地形碰撞规则完全一致。 */
    _fly(f, world, input) {
      const dx = (input.right() ? 1 : 0) - (input.left() ? 1 : 0);
      this.vx = dx * CHEAT_SPEED * (this.speedMul || 1);
      if (dx) this.face = dx;

      if (input.jumpHeld()) this.vy = -CHEAT_RISE;         // 按住跳跃键：起飞
      else if (input.downKey()) this.vy = CHEAT_DIVE;      // 下蹲键：加速下坠
      else this.vy = CHEAT_GLIDE;                          // 松开：缓缓降落

      this.grounded = false;
      this.standMover = null;

      this._moveAxis(world, 'x', this.vx * f, f);
      this._moveAxis(world, 'y', this.vy * f, f);

      if (this._onGround(world)) { this.grounded = true; this.vy = 0; }

      // 兜底：始终留在关卡范围里，避免一路向下飞出世界 / 飞出画面顶部
      this.x = LD.clamp(this.x, 0, Math.max(0, world.pxW - this.w));
      this.y = LD.clamp(this.y, 0, world.pxH - this.h);

      if (Math.random() < 0.5) {
        LD.FX.spark(this.cx + (Math.random() - 0.5) * 22, this.y + this.h - 4,
          this.kind === 'blue' ? '#7ad4ff' : '#ffd75e');
      }
    }

    _moveAxis(world, axis, delta, f) {
      if (axis === 'x') this.x += delta; else { this.y += delta; if (axis === 'y') this.grounded = false; }
      const rects = world.solidRects();
      for (let iter = 0; iter < 3; iter++) {
        let hit = this._pushTiles(world, axis);
        if (this._pushRects(rects, axis)) hit = true;
        if (!hit) break;
      }
    }

    _pushTiles(world, axis) {
      const c0 = Math.floor(this.x / T), c1 = Math.floor((this.x + this.w - 1) / T);
      const r0 = Math.floor(this.y / T), r1 = Math.floor((this.y + this.h - 1) / T);
          let hit = false;
          for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
              if (!world.isSolid(c, r)) continue;
              // 假方块碰到就碎、直接放行（正好撞上时不能先挡一下再碎，否则它就成了
              // 头顶一块看不见的天花板，底下的坑永远跳不过去）
              if (world.breakFake(c, r)) continue;
              hit = true;
              const tx = c * T, ty = r * T;
              if (axis === 'x') {
                // 方向以速度为准；只有在速度已经是 0（被人卡住）时才按「挤进去更浅」的一侧弹出来。
                // 注意不能一律用「离哪边近就往哪边推」：人从坑里掉下去时身体可能已经嵌进墙里
                // 超过一半，那样会被推到墙的另一侧——看起来就像穿墙/瞬移。
                if (this.vx > 0) this.x = tx - this.w;
                else if (this.vx < 0) this.x = tx + T;
                else {
                  const leftPen = this.x + this.w - tx;      // 从右侧挤进去的深度
                  const rightPen = tx + T - this.x;          // 从左侧挤进去的深度
                  this.x = leftPen <= rightPen ? tx - this.w : tx + T;
                }
                this.vx = 0;
              } else {
                if (this.vy > 0) { this.y = ty - this.h; this.grounded = true; this.vy = 0; }
                else if (this.vy < 0) { this.y = ty + T; this.vy = 0; }
                else if (this.y + this.h / 2 < ty + T / 2) { this.y = ty - this.h; this.grounded = true; }
                else { this.y = ty + T; }
              }
            }
          }
          return hit;
    }

    _pushRects(rects, axis) {
      let hit = false;
      for (const m of rects) {
        if (m === this) continue;                       // 自己不是自己的障碍
        if (m.soft) {
          if (axis === 'x') continue;                   // 两个人水平方向互相穿过
          if (this.vy <= 0) continue;                   // 也不会顶到别人的头
        }
        // 移动平台是「单向」的：可以踩上去，但不会横向挡住你。
        // 否则平台一旦和地形/另一块平台靠得太近，站在上面的人就会被推下去。
        if (m.oneWay && axis === 'x') continue;
        if (!LD.rectHit(this.box, m)) continue;
        hit = true;
        if (axis === 'x') {
          if (this.vx > 0) this.x = m.x - this.w; else if (this.vx < 0) this.x = m.x + m.w;
          else this.x = this.x + this.w / 2 < m.x + m.w / 2 ? m.x - this.w : m.x + m.w;
          this.vx = 0;
        } else {
          if (this.vy > 0) {
            this.y = m.y - this.h; this.grounded = true; this.vy = 0;
            this.standMover = m;
          } else if (this.vy < 0) { this.y = m.y + m.h; this.vy = 0; }
        }
      }
      if (axis === 'y' && !hit) {
        // 站立在薄平台上的稳定性：只有脚下 2px 内有平台才算站住
        const feet = { x: this.x + 2, y: this.y + this.h, w: this.w - 4, h: 3 };
        for (const m of rects) {
          if (m === this) continue;
          if (LD.rectHit(feet, m)) { this.grounded = true; this.standMover = m; break; }
        }
      }
      return hit;
    }

    kill() {
      if (this.dead) return false;
      this.dead = true;
      this.vy = -8; this.vx = 0;
      this.deathT = 0;
      return true;
    }
  };

  // 暴露给自检脚本（tools/smoke.js）：验证作弊移速确实快于普通跑速
  LD.CHEAT_SPEED = CHEAT_SPEED;
  LD.WALK_SPEED = SPEED;
})();
