/* net.js — 联机传输层（零服务器）
   两种传输，跑在同一套消息协议上：
     rtc  WebRTC 点对点 + 手动信令（邀请码 / 应答码复制粘贴）。
          不需要任何服务器：SDP 里带上完整 ICE candidate，
          对面粘贴进去就能直连。STUN 只用来看清自己的公网地址。
     bc   BroadcastChannel：同一浏览器的两个窗口之间通信，
          「本机双窗联机」用 —— 零配置，适合先试玩 / 演示。

   消息协议（JSON，字段 t 为类型）：
     hello            打招呼（BC 传输下用来判定「对面来了」）
     stage {n}        房主 → 房客：进第 n 关
     state {…}         本地玩家状态（20/s），房主的还带联机用时 t
     ready {ok}        「我站到自己门里了」
     win {…}           房主 → 房客：通关结算
     timeup           房主 → 房客：时间到
     restart          重开本关（任一方发起，房主转成 stage 广播）
     next             房客 → 房主：请求下一关
     bye               主动离开
     ping {ts} / pong {ts}   测延迟
*/
(function () {
  /* ---------- 编解码：对象 ⇄ base64 字符串（unicode 安全） ---------- */
  function b64(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function unb64(code) {
    const bin = atob(String(code || '').trim());
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  /* ---------- BroadcastChannel 传输 ---------- */
  class BCT {
    constructor(chan, id) {
      this.chan = chan;
      this.id = id;
      this.bc = new BroadcastChannel(chan);
      this.bc.onmessage = (e) => {
        const m = e.data;
        if (!m || m.__from === this.id) return;          // 别回收自己的回声
        if (this.onMsg) this.onMsg(m);
      };
    }
    send(m) {
      m.__from = this.id;
      try { this.bc.postMessage(m); } catch (e) { /* 通道关了就静默丢弃 */ }
    }
    close() { try { this.bc.close(); } catch (e) {} }
  }

  /* ---------- WebRTC 传输 ---------- */
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
  class RTCT {
    constructor(isHost) {
      this.pc = new RTCPeerConnection(ICE);
      this.isHost = isHost;
      if (isHost) {
        this.dc = this.pc.createDataChannel('kb', { ordered: true });
        this._wireDc();
      } else {
        this.pc.ondatachannel = (e) => { this.dc = e.channel; this._wireDc(); };
      }
      this.pc.onconnectionstatechange = () => {
        if (this.pc.connectionState === 'failed' && this.onDrop) this.onDrop();
      };
    }
    _wireDc() {
      this.dc.onopen = () => this.onOpen && this.onOpen();
      this.dc.onclose = () => this.onClose && this.onClose();
      this.dc.onmessage = (e) => {
        try { const m = unb64(e.data); if (this.onMsg) this.onMsg(m); } catch (err) { /* 坏包直接丢 */ }
      };
    }
    send(m) {
      if (!this.dc || this.dc.readyState !== 'open') return;
      try { this.dc.send(b64(m)); } catch (e) {}
    }
    close() {
      try { if (this.dc) this.dc.close(); } catch (e) {}
      try { this.pc.close(); } catch (e) {}
    }
    /* 等 ICE 收集完（带 5 秒兜底）—— 这样生成的邀请码 / 应答码自带全部候选地址，
       对面一次粘贴就能连，不需要「 Trickle ICE 」那样的二次交换。 */
    _ice() {
      return new Promise((res) => {
        if (this.pc.iceGatheringState === 'complete') return res();
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          this.pc.removeEventListener('icegatheringstatechange', chk);
          res();
        };
        const chk = () => { if (this.pc.iceGatheringState === 'complete') finish(); };
        /* 多配几个 STUN 后收集变慢，放宽到 5 秒；收到候选也顺带续一下 */
        const timer = setTimeout(finish, 5000);
        this.pc.addEventListener('icegatheringstatechange', chk);
        this.pc.addEventListener('icecandidate', (e) => {
          if (!e.candidate) finish();   // candidate 为 null = 收集完成
        });
      });
    }
    /* 房主：生成邀请码 */
    async invite() {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      await this._ice();
      return b64({ t: 'offer', sdp: this.pc.localDescription.sdp });
    }
    /* 房主：应用房客的应答码 */
    async connect(answerCode) {
      const d = unb64(answerCode);
      if (!d || d.t !== 'answer' || !d.sdp) throw new Error('bad answer code');
      await this.pc.setRemoteDescription({ type: 'answer', sdp: d.sdp });
    }
    /* 房客：粘贴邀请码 */
    async join(inviteCode) {
      const d = unb64(inviteCode);
      if (!d || d.t !== 'offer' || !d.sdp) throw new Error('bad invite code');
      await this.pc.setRemoteDescription({ type: 'offer', sdp: d.sdp });
    }
    /* 房客：生成应答码 */
    async answer() {
      const ans = await this.pc.createAnswer();
      await this.pc.setLocalDescription(ans);
      await this._ice();
      return b64({ t: 'answer', sdp: this.pc.localDescription.sdp });
    }
  }

  /* ---------- 会话（对上层暴露的统一接口） ---------- */
  class Session {
    // opts: { bc: 频道名（BC 模式必填）, onMsg, onOpen, onClose }
    constructor(role, opts) {
      this.role = role;                       // 'host' | 'guest'
      this.opts = opts || {};
      this.id = Math.random().toString(36).slice(2, 9);
      this.opened = false;
      this.closed = false;
      this._once = [];                        // 一次性消息监听（ping 用）
      if (this.opts.bc) {
        this.kind = 'bc';
        this.t = new BCT(this.opts.bc, this.id);
      } else {
        if (typeof RTCPeerConnection === 'undefined') throw new Error('webrtc unsupported');
        this.kind = 'rtc';
        this.t = new RTCT(role === 'host');
        this.t.onOpen = () => this._open();     // dc 真正 open 的那一刻
        this.t.onDrop = () => this._drop();
      }
      this.t.onMsg = (m) => this._route(m);
    }

    /* 连接建立（rtc: dc open；bc: 收到对面第一条消息）。只触发一次。 */
    _open() {
      if (this.opened || this.closed) return;
      this.opened = true;
      if (this.opts.onOpen) this.opts.onOpen();
    }

    _route(m) {
      if (this.closed) return;
      // 一次性监听（ping/pong）
      for (let i = this._once.length - 1; i >= 0; i--) {
        if (this._once[i](m) === true) this._once.splice(i, 1);
      }
      if (this.opts.onMsg) this.opts.onMsg(m);
      this._open();
    }
    _drop() {
      if (this.closed) return;
      this.closed = true;
      if (this.opts.onClose) this.opts.onClose();
    }

    /* ---- 信令（只有 rtc 模式用得到） ---- */
    invite() { return this.t.invite(); }                 // 房主
    join(code) { return this.t.join(code); }             // 房客
    answer() { return this.t.answer(); }                 // 房客
    connect(code) { return this.t.connect(code); }       // 房主

    /* ---- 数据面 ---- */
    send(m) { if (!this.closed) this.t.send(m); }
    once(pred) { this._once.push(pred); }
    ping() {
      return new Promise((res) => {
        const ts = performance.now();
        this.once((m) => {
          if (m && m.t === 'pong') { res(Math.round(performance.now() - ts)); return true; }
          return false;
        });
        this.send({ t: 'ping', ts });
      });
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      this.t.close();
    }
  }

  LD.Net = {
    host: (o) => new Session('host', o),
    guest: (o) => new Session('guest', o),
    b64, unb64,
  };
})();
