/* netroom.js — 多人联机房间传输层（零服务器，支持 2~8 人）

   两种传输，跑同一套房间协议：
     bc   BroadcastChannel：同一台电脑开多个窗口，每个窗口就是一位玩家。
          房间号放在 URL 的 #bc=<频道> 里，新窗口自动入场 ——「加人」最省事的路。
     rtc  WebRTC 星形：房主是中心，每位好友一个独立的数据通道。
          每个「玩家席位」各生成一份邀请码，好友回一份应答码，房主逐席位连接；
          房主负责把某位房客的消息转发给其他房客，所以不需要两两互联。

   房间协议（消息里的 t 为类型；__from 是发送者 id，由本层统一盖戳）：
     join      {cid, profile}      房客 → 房主：我要进房（带临时昵称 / 皮肤）
     welcome   {to, id, slot, roster} 房主 → 房客：你的编号、席位、当前名单
     roster    {roster}           房主 → 全体：名单变化（进人 / 离开 / 改形象）
     profile   {profile}          房客 → 房主：改了昵称或皮肤
     bye-guest / bye-host         主动离开
     其余消息（start / state / hit / clear / timeup / next / restart / …）
     一律原样透传给上层 Game，房主在 rtc 模式下额外做一次转发。

   上层只用这几个接口：
     LD.NetRoom.create({role, kind, chan, profile, onMsg, onRoster, onReady,
                        onPeerGone, onHostGone, onSlotChange, maxPlayers})
     room.send(m) / room.setProfile(p) / room.addSlot() / room.connectSlot()
     room.join(code) → 应答码 / room.slotInfo() / room.close()
*/
(function () {
  const b64 = (o) => LD.Net.b64(o);
  const unb64 = (s) => LD.Net.unb64(s);
  const uid = () => Math.random().toString(36).slice(2, 10);
  /* 短房间号：去掉容易看错的 0/O/1/I/L */
  const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const genCode = (n) => {
    let s = '';
    for (let i = 0; i < n; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return s;
  };
  const ICE = {
    iceServers: [
      /* 国内可达的 STUN 放前面（Google 的在国内基本不通，跨网连接会「连接失败」） */
      { urls: 'stun:stun.miwifi.com:3478' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
    iceCandidatePoolSize: 4,
  };

  /* 等 ICE 收集完（5 秒兜底），让邀请码自带全部候选地址，一次粘贴就能连 */
  function iceWait(pc) {
    return new Promise((res) => {
      if (pc.iceGatheringState === 'complete') return res();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', chk);
        res();
      };
      const chk = () => { if (pc.iceGatheringState === 'complete') finish(); };
      /* 多配几个 STUN 后收集变慢，放宽到 5 秒；candidate 为 null 也算完成 */
      const timer = setTimeout(finish, 5000);
      pc.addEventListener('icegatheringstatechange', chk);
      pc.addEventListener('icecandidate', (e) => { if (!e.candidate) finish(); });
    });
  }

  /* 一条 WebRTC 点对点链路（房主每个席位一条，房客只有一条） */
  class RTCLink {
    constructor(isHost, h) {
      this.h = h || {};
      this.pc = new RTCPeerConnection(ICE);
      this.isHost = isHost;
      if (isHost) {
        this.dc = this.pc.createDataChannel('kbroom', { ordered: true });
        this._wire();
      } else {
        this.pc.ondatachannel = (e) => { this.dc = e.channel; this._wire(); };
      }
      this.pc.onconnectionstatechange = () => {
        if (this.pc.connectionState === 'failed' && this.h.onDrop) this.h.onDrop();
      };
    }
    _wire() {
      this.dc.onopen = () => { if (this.h.onOpen) this.h.onOpen(); };
      this.dc.onclose = () => { if (this.h.onClose) this.h.onClose(); };
      this.dc.onmessage = (e) => {
        try { const m = unb64(e.data); if (this.h.onMsg) this.h.onMsg(m); } catch (err) { /* 坏包丢弃 */ }
      };
    }
    send(m) {
      if (!this.dc || this.dc.readyState !== 'open') return;
      try { this.dc.send(b64(m)); } catch (e) {}
    }
    async invite() {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      await iceWait(this.pc);
      return b64({ t: 'offer', sdp: this.pc.localDescription.sdp });
    }
    async join(code) {
      const d = unb64(code);
      if (!d || d.t !== 'offer' || !d.sdp) throw new Error('bad invite code');
      await this.pc.setRemoteDescription({ type: 'offer', sdp: d.sdp });
    }
    async answer() {
      const ans = await this.pc.createAnswer();
      await this.pc.setLocalDescription(ans);
      await iceWait(this.pc);
      return b64({ t: 'answer', sdp: this.pc.localDescription.sdp });
    }
    async connect(code) {
      const d = unb64(code);
      if (!d || d.t !== 'answer' || !d.sdp) throw new Error('bad answer code');
      await this.pc.setRemoteDescription({ type: 'answer', sdp: d.sdp });
    }
    close() {
      try { if (this.dc) this.dc.close(); } catch (e) {}
      try { this.pc.close(); } catch (e) {}
    }
  }

  class Room {
    constructor(opts) {
      this.opts = opts || {};
      this.role = this.opts.role === 'host' ? 'host' : 'guest';
      this.kind = this.opts.kind === 'bc' ? 'bc' : 'rtc';
      this.chan = this.opts.chan || uid();
      this.cid = uid();
      this.id = this.cid;
      this.slot = this.role === 'host' ? 0 : -1;
      this.profile = this.opts.profile || { name: '玩家', skin: null };
      this.maxPlayers = Math.max(2, Math.min(8, this.opts.maxPlayers || 8));
      this.peers = new Map();
      this.roster = [];
      this.slots = [];
      this.closed = false;
      this.ready = false;
      /* onReady 不能在这里发：Room 对象还没返回，上层拿不到 this.room。
         房主在 _initHost() 末尾发，房客在收到 welcome 时发。 */
      if (this.role === 'host') this._initHost();
      else this._initGuest();
    }

    _emit(name, a, b) { const f = this.opts[name]; if (f) { try { f(a, b); } catch (e) { console.warn('[room] ' + name, e); } } }

    /* ---------------- 房主 ---------------- */
    _initHost() {
      this.peers.set(this.id, { id: this.id, slot: 0, host: true, profile: this.profile });
      if (this.kind === 'bc') {
        this.bc = new BroadcastChannel('kbroom-' + this.chan);
        this.bc.onmessage = (e) => {
          const m = e.data;
          if (!m || m.__from === this.id || this.closed) return;
          this._hostMsg(m.__from, m);
        };
      }
      this._syncRoster();
      this.ready = true;
      this._emit('onReady');
    }

    _rosterList() {
      return [...this.peers.values()]
        .sort((a, b) => a.slot - b.slot)
        .map((p) => ({ id: p.id, slot: p.slot, host: !!p.host, name: p.profile.name, skin: p.profile.skin }));
    }
    _syncRoster() {
      this.roster = this._rosterList();
      this._emit('onRoster', this.roster);
      this.send({ t: 'roster', roster: this.roster });
      this._emit('onSlotChange', this.slotInfo());
    }
    _nextSlot() {
      const used = new Set([...this.peers.values()].map((p) => p.slot));
      for (let i = 1; i < this.maxPlayers; i++) if (!used.has(i)) return i;
      return this.maxPlayers;   // 满了：硬塞最后一个，界面上有上限提示
    }
    _dropPeer(id) {
      if (!id || id === this.id) return;
      if (!this.peers.delete(id)) return;
      if (this.kind === 'rtc') {
        const s = this.slots.find((x) => x.id === id);
        if (s) { s.connected = false; s.id = null; s.state = 'closed'; try { s.link.close(); } catch (e) {} }
      }
      this._syncRoster();
      this._emit('onPeerGone', id);
    }

    /* 房主收到一条消息（BC 直接收全体；RTC 由某个席位转上来） */
    _hostMsg(from, m, srcSlot) {
      switch (m.t) {
        case 'join': {
          const id = m.cid || from;
          // 同一个人可能因为 dc open / hello-host 连喊两次，去重，别占两个席位
          if (this.peers.has(id)) return;
          if (this.peers.size >= this.maxPlayers) return;
          const p = { id, slot: this._nextSlot(), host: false, profile: m.profile || {} };
          p.profile = m.profile || p.profile;
          this.peers.set(id, p);
          if (srcSlot) { srcSlot.id = id; srcSlot.cid = id; }
          const welcome = { t: 'welcome', to: id, id, slot: p.slot, roster: this._rosterList() };
          if (srcSlot) srcSlot.link.send(welcome);
          else this.send(welcome);     // BC：带上 to，只有那位房客会认领
          this._syncRoster();
          return;
        }
        case 'profile': {
          const p = this.peers.get(from);
          if (p) { p.profile = m.profile || p.profile; this._syncRoster(); }
          return;
        }
        case 'bye-guest':
          this._dropPeer(from);
          return;
        case 'roster':
        case 'welcome':
        case 'bye-host':
          return;
        default:
          break;
      }
      this._emit('onMsg', m, from);
      /* RTC 星形：把这位房客的话转发给其他房客（BC 天生广播，不需要转发） */
      if (this.kind === 'rtc') {
        const relay = Object.assign({}, m, { __from: from });
        for (const s of this.slots) {
          if (s === srcSlot || !s.connected) continue;
          s.link.send(relay);
        }
      }
    }

    /* ---- WebRTC 房主：每加一位玩家就多一个席位 / 一份邀请码 ---- */
    async addSlot() {
      if (this.role !== 'host' || this.kind !== 'rtc') return null;
      if (this.slots.length >= this.maxPlayers - 1) return null;
      const idx = this.slots.length + 1;
      const slot = { idx, link: null, invite: '', state: 'gen', connected: false, id: null, cid: null };
      this.slots.push(slot);
      this._emit('onSlotChange', this.slotInfo());
      try {
        slot.link = new RTCLink(true, {
          onMsg: (m) => { if (!this.closed) this._hostMsg(m.__from || m.cid || slot.cid, m, slot); },
          onOpen: () => {
            slot.connected = true;
            slot.state = 'joining';
            slot.link.send({ t: 'hello-host' });
            this._emit('onSlotChange', this.slotInfo());
          },
          onClose: () => {
            if (this.closed) return;
            slot.connected = false;
            slot.state = 'closed';
            this._emit('onSlotChange', this.slotInfo());
            if (slot.id) this._dropPeer(slot.id);
          },
          onDrop: () => {
            if (this.closed) return;
            slot.connected = false;
            slot.state = 'drop';
            this._emit('onSlotChange', this.slotInfo());
            if (slot.id) this._dropPeer(slot.id);
          },
        });
        slot.invite = await slot.link.invite();
        slot.state = 'wait';
      } catch (e) {
        console.warn('[room] addSlot failed:', e);
        slot.state = 'fail';
      }
      this._emit('onSlotChange', this.slotInfo());
      return slot;
    }
    async connectSlot(idx, code) {
      const slot = this.slots.find((s) => s.idx === Number(idx));
      if (!slot || !slot.link || !String(code || '').trim()) throw new Error('bad slot');
      slot.state = 'connecting';
      this._emit('onSlotChange', this.slotInfo());
      try {
        await slot.link.connect(String(code).trim());
        // 连通后 dc 会 open → hello-host → 房客 join → welcome
      } catch (e) {
        slot.state = 'fail';
        this._emit('onSlotChange', this.slotInfo());
        throw e;
      }
    }
    slotInfo() {
      return this.slots.map((s) => ({
        idx: s.idx, invite: s.invite, state: s.state, connected: s.connected,
        id: s.id, name: (this.peers.get(s.id) || {}).profile
          ? this.peers.get(s.id).profile.name : '',
      }));
    }

    /* ---------------- 房客 ---------------- */
    _initGuest() {
      if (this.kind === 'bc') {
        this.bc = new BroadcastChannel('kbroom-' + this.chan);
        this.bc.onmessage = (e) => {
          const m = e.data;
          if (!m || m.__from === this.id || this.closed) return;
          this._guestMsg(m);
        };
        // 房主的频道已经开着，直接喊一声就能进房
        this.bc.postMessage({ t: 'join', cid: this.cid, profile: this.profile, __from: this.id });
      } else {
        this.link = new RTCLink(false, {
          onMsg: (m) => { if (!this.closed) this._guestMsg(m); },
          onOpen: () => {
            this.link.send({ t: 'join', cid: this.cid, profile: this.profile, __from: this.id });
          },
          onClose: () => { if (!this.closed) this._emit('onHostGone'); },
          onDrop: () => { if (!this.closed) this._emit('onHostGone'); },
        });
      }
    }
    _guestMsg(m) {
      switch (m.t) {
        case 'hello-host':
          if (this.kind === 'rtc' && this.link) {
            this.link.send({ t: 'join', cid: this.cid, profile: this.profile, __from: this.id });
          }
          return;
        case 'welcome': {
          if (m.to && m.to !== this.id) return;
          this.id = m.id || this.id;
          this.slot = m.slot;
          this.roster = m.roster || [];
          this._emit('onRoster', this.roster);
          if (!this.ready) { this.ready = true; this._emit('onReady'); }
          return;
        }
        case 'roster':
          this.roster = m.roster || [];
          this._emit('onRoster', this.roster);
          return;
        case 'bye-host':
          this._emit('onHostGone');
          return;
        case 'join':
        case 'profile':
        case 'bye-guest':
          return;
        default:
          break;
      }
      this._emit('onMsg', m, m.__from || m.from);
    }

    /* 房客：粘贴邀请码 → 返回应答码（只有 RTC 用得到） */
    async join(code) {
      if (this.kind !== 'rtc' || !this.link) return '';
      await this.link.join(code);
      return await this.link.answer();
    }

    /* ---------------- 公共 ---------------- */
    send(m) {
      if (this.closed) return;
      const out = Object.assign({}, m, { __from: this.id });
      if (this.kind === 'bc') {
        if (this.bc) { try { this.bc.postMessage(out); } catch (e) {} }
        return;
      }
      if (this.role === 'host') {
        for (const s of this.slots) if (s.link && s.connected) s.link.send(out);
      } else if (this.link) {
        this.link.send(out);
      }
    }
    setProfile(profile) {
      this.profile = profile || this.profile;
      if (this.role === 'host') {
        const p = this.peers.get(this.id);
        if (p) p.profile = this.profile;
        this._syncRoster();
      } else {
        this.send({ t: 'profile', profile: this.profile });
      }
    }
    myId() { return this.id; }
    isHost() { return this.role === 'host'; }
    close() {
      if (this.closed) return;
      const bye = this.role === 'host' ? 'bye-host' : 'bye-guest';
      try { this.send({ t: bye }); } catch (e) {}
      this.closed = true;
      this.ready = false;
      try { if (this.bc) this.bc.close(); } catch (e) {}
      try { if (this.link) this.link.close(); } catch (e) {}
      for (const s of this.slots) { try { if (s.link) s.link.close(); } catch (e) {} }
    }
  }

  /* ================= PeerJS 传输：免费信令 + 短房间号 =================
     房主拿一个 5 位房间号注册到 PeerJS 云端；好友只要输入房间号（或打开
     带房间号的链接）就直接进房 —— 不需要任何邀请码 / 应答码粘贴。
     消息协议与 Room 完全一致，上层无感。 */
  const PNS = 'yyzj-';      // PeerJS id 前缀，避免和别人的 id 撞车

  class PeerRoom {
    constructor(opts) {
      this.opts = opts || {};
      this.role = this.opts.role === 'host' ? 'host' : 'guest';
      this.kind = 'peer';
      this.chan = String(this.opts.chan || genCode(5)).toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, '') || genCode(5);
      this.cid = uid();
      this.id = this.cid;
      this.slot = this.role === 'host' ? 0 : -1;
      this.profile = this.opts.profile || { name: '玩家', skin: null };
      this.maxPlayers = Math.max(2, Math.min(8, this.opts.maxPlayers || 8));
      this.peers = new Map();     // cid -> {id, slot, host, profile}
      this.conns = new Map();     // cid -> DataConnection（房主用）
      this.roster = [];
      this.closed = false;
      this.ready = false;
      const cfg = {
        debug: 0,
        config: { iceServers: ICE.iceServers },
      };
      if (this.role === 'host') {
        this.peers.set(this.id, { id: this.id, slot: 0, host: true, profile: this.profile });
        this._syncRoster();
        this._openHost(0, cfg);
      } else {
        this._openGuest(cfg);
      }
    }

    _emit(name, a, b) { const f = this.opts[name]; if (f) { try { f(a, b); } catch (e) { console.warn('[peer-room] ' + name, e); } } }

    /* ---------------- 房主 ---------------- */
    _openHost(attempt, cfg) {
      this.peer = new Peer(PNS + this.chan.toLowerCase(), cfg);
      this.peer.on('open', () => { this.ready = true; this._emit('onReady'); });
      this.peer.on('connection', (conn) => this._wireHost(conn));
      this.peer.on('error', (err) => {
        const t = (err && err.type) || 'error';
        if (t === 'unavailable-id' && attempt < 2) {
          // 房间号撞了：换个号再来，并通知上层刷新显示
          try { this.peer.destroy(); } catch (e) {}
          this.chan = genCode(5);
          this._emit('onCodeChange', this.chan);
          this._openHost(attempt + 1, cfg);
          return;
        }
        this._emit('onFail', t);
      });
    }
    _wireHost(conn) {
      conn.on('data', (m) => {
        if (!m || this.closed) return;
        if (m.t === 'join') { this._hostJoin(conn, m); return; }
        const cid = this._cidOf(conn);
        if (!cid) return;
        this._hostMsg(cid, m, conn);
      });
      conn.on('close', () => {
        if (this.closed) return;
        const cid = this._cidOf(conn);
        if (cid) this._dropPeer(cid);
      });
      conn.on('error', () => { /* close 会跟着来，不用重复处理 */ });
    }
    _cidOf(conn) {
      for (const [cid, c] of this.conns) if (c === conn) return cid;
      return null;
    }
    _hostJoin(conn, m) {
      const id = m.cid || 'g' + uid();
      // 重连 / 重复 join：直接补发一份 welcome
      if (this.peers.has(id)) {
        try { conn.send({ t: 'welcome', to: id, id, slot: this.peers.get(id).slot, roster: this._rosterList() }); } catch (e) {}
        return;
      }
      if (this.peers.size >= this.maxPlayers) {
        try { conn.send({ t: 'room-full' }); setTimeout(() => { try { conn.close(); } catch (e) {} }, 300); } catch (e) {}
        return;
      }
      const p = { id, slot: this._nextSlot(), host: false, profile: m.profile || {} };
      this.peers.set(id, p);
      this.conns.set(id, conn);
      try { conn.send({ t: 'welcome', to: id, id, slot: p.slot, roster: this._rosterList() }); } catch (e) {}
      this._syncRoster();
    }
    _rosterList() {
      return [...this.peers.values()]
        .sort((a, b) => a.slot - b.slot)
        .map((p) => ({ id: p.id, slot: p.slot, host: !!p.host, name: p.profile.name, skin: p.profile.skin }));
    }
    _syncRoster() {
      this.roster = this._rosterList();
      this._emit('onRoster', this.roster);
      this.send({ t: 'roster', roster: this.roster });
    }
    _nextSlot() {
      const used = new Set([...this.peers.values()].map((p) => p.slot));
      for (let i = 1; i < this.maxPlayers; i++) if (!used.has(i)) return i;
      return this.maxPlayers;
    }
    _dropPeer(id) {
      if (!id || id === this.id || !this.peers.delete(id)) return;
      const c = this.conns.get(id);
      if (c) { try { c.close(); } catch (e) {} this.conns.delete(id); }
      this._syncRoster();
      this._emit('onPeerGone', id);
    }
    _hostMsg(from, m, conn) {
      switch (m.t) {
        case 'profile': {
          const p = this.peers.get(from);
          if (p) { p.profile = m.profile || p.profile; this._syncRoster(); }
          return;
        }
        case 'bye-guest':
          this._dropPeer(from);
          return;
        case 'welcome':
        case 'roster':
        case 'bye-host':
        case 'join':
          return;
        default:
          break;
      }
      this._emit('onMsg', m, from);
      // 星形转发：把这位房客的话转给其他房客
      const relay = Object.assign({}, m, { __from: from });
      for (const [cid, c] of this.conns) if (cid !== from && c.open) { try { c.send(relay); } catch (e) {} }
    }

    /* ---------------- 房客 ---------------- */
    _openGuest(cfg) {
      this.peer = new Peer(cfg);
      this.peer.on('open', () => {
        this.conn = this.peer.connect(PNS + this.chan.toLowerCase(), { reliable: true });
        this.conn.on('open', () => {
          this.conn.send({ t: 'join', cid: this.cid, profile: this.profile, __from: this.id });
        });
        this.conn.on('data', (m) => { if (!this.closed) this._guestMsg(m); });
        this.conn.on('close', () => { if (!this.closed) this._emit('onHostGone'); });
        this.conn.on('error', () => {});
      });
      this.peer.on('error', (err) => {
        const t = (err && err.type) || 'error';
        // peer-unavailable = 房间号不存在
        this._emit('onFail', t === 'peer-unavailable' ? 'notfound' : t);
      });
    }
    _guestMsg(m) {
      switch (m.t) {
        case 'welcome': {
          if (m.to && m.to !== this.id) return;
          this.id = m.id || this.id;
          this.slot = m.slot;
          this.roster = m.roster || [];
          this._emit('onRoster', this.roster);
          if (!this.ready) { this.ready = true; this._emit('onReady'); }
          return;
        }
        case 'roster':
          this.roster = m.roster || [];
          this._emit('onRoster', this.roster);
          return;
        case 'bye-host':
          this._emit('onHostGone');
          return;
        case 'room-full':
          this._emit('onFail', 'full');
          return;
        case 'join':
        case 'profile':
        case 'bye-guest':
          return;
        default:
          break;
      }
      this._emit('onMsg', m, m.__from || m.from);
    }

    /* ---------------- 公共接口（与 Room 一致） ---------------- */
    send(m) {
      if (this.closed) return;
      const out = Object.assign({}, m, { __from: this.id });
      if (this.role === 'host') {
        for (const c of this.conns.values()) if (c.open) { try { c.send(out); } catch (e) {} }
      } else if (this.conn) {
        try { this.conn.send(out); } catch (e) {}
      }
    }
    setProfile(profile) {
      this.profile = profile || this.profile;
      if (this.role === 'host') {
        const p = this.peers.get(this.id);
        if (p) p.profile = this.profile;
        this._syncRoster();
      } else {
        this.send({ t: 'profile', profile: this.profile });
      }
    }
    myId() { return this.id; }
    isHost() { return this.role === 'host'; }
    close() {
      if (this.closed) return;
      const bye = this.role === 'host' ? 'bye-host' : 'bye-guest';
      try { this.send({ t: bye }); } catch (e) {}
      this.closed = true;
      this.ready = false;
      try { if (this.peer) this.peer.destroy(); } catch (e) {}
    }
  }

  LD.NetRoom = {
    create: (o) => {
      const kind = o && o.kind;
      if (kind === 'peer') {
        if (typeof Peer === 'undefined') throw new Error('peerjs unavailable');
        return new PeerRoom(o);
      }
      if (kind === 'bc') { o.kind = 'bc'; return new Room(o); }
      o.kind = 'rtc';
      return new Room(o);
    },
    newCode: () => genCode(5),
    channel: () => uid(),
    maxPlayers: 8,
  };
})();
