/* music.js — WebAudio 步进音序器 + 内置曲目（全部为程序合成的原创循环）
   曲风覆盖：热门电音 / FUNK / 8-BIT / 暗黑电子 / Lo-Fi。
   每首曲子 = 一个 16 分音符步进的 pattern，循环播放。
   pattern 记法：[步号, MIDI 音高, 时值(步), 力度]
*/
(function () {
  const mid = (m) => 440 * Math.pow(2, (m - 69) / 12);
  // 常用时值（步）
  const LONG = 16, HALF = 8, Q = 4, E = 2, S = 1;
  // 鼓机每行只认自己的字母
  const LETTER = { kick: 'K', snare: 'S', clap: 'C', hat: 'H' };

  const TRACKS = [
    {
      id: 'neon', name: '霓虹夜行', nameEn: 'Neon Drive',
      genre: '热门 · 合成器浪潮', genreEn: 'SYNTHWAVE', bpm: 100, len: 64,
      drums: {
        kick: 'K.......K.......',
        snare: '........S.......',
        hat: '..H...H...H...H.',
      },
      bass: [
        [0, 33, E, 1], [2, 33, E, .7], [4, 33, E, 1], [6, 45, S, .8],
        [8, 33, E, 1], [10, 33, E, .7], [12, 33, E, 1], [14, 45, S, .8],
        [16, 29, E, 1], [18, 29, E, .7], [20, 29, E, 1], [22, 41, S, .8],
        [24, 29, E, 1], [26, 29, E, .7], [28, 29, E, 1], [30, 41, S, .8],
        [32, 36, E, 1], [34, 36, E, .7], [36, 36, E, 1], [38, 48, S, .8],
        [40, 36, E, 1], [42, 36, E, .7], [44, 36, E, 1], [46, 48, S, .8],
        [48, 31, E, 1], [50, 31, E, .7], [52, 31, E, 1], [54, 43, S, .8],
        [56, 31, E, 1], [58, 31, E, .7], [60, 31, E, 1], [62, 43, S, .8],
      ],
      pad: [
        [0, [57, 60, 64], LONG, .5], [16, [53, 57, 60], LONG, .5],
        [32, [55, 60, 64], LONG, .5], [48, [55, 59, 62], LONG, .5],
      ],
      lead: [
        [0, 69, Q, .8], [4, 72, Q, .7], [8, 76, Q, .8], [12, 72, Q, .7],
        [16, 65, Q, .8], [20, 69, Q, .7], [24, 72, Q, .8], [28, 69, Q, .7],
        [32, 67, Q, .8], [36, 72, Q, .7], [40, 76, Q, .8], [44, 72, Q, .7],
        [48, 67, Q, .8], [52, 71, Q, .7], [56, 74, Q, .8], [60, 71, Q, .7],
      ],
    },

    {
      id: 'funk', name: 'FUNK 引擎', nameEn: 'Funk Engine',
      genre: 'FUNK · 放克律动', genreEn: 'FUNK', bpm: 108, len: 32,
      drums: {
        kick: 'K..K..K...K..K..',
        snare: '....S.......S...',
        hat: '..H.H.HH..H.H.HH',
        clap: '............C...',
      },
      // 切分贝斯：16 分音符里塞满「一、四、七」的错位重音
      bass: [
        [0, 40, S, 1], [3, 40, S, .85], [6, 52, S, .9], [7, 52, S, .6],
        [10, 43, S, .9], [12, 40, S, 1], [14, 47, S, .8],
        [16, 45, S, 1], [19, 45, S, .85], [22, 45, S, .9], [24, 43, S, .9],
        [26, 40, S, 1], [29, 47, S, .85], [30, 50, S, .7],
      ],
      // 短促的 clav 和弦 stab（放克的灵魂）
      stab: [
        [2, [64, 67, 71], 1, .55], [7, [64, 67, 71], 1, .5],
        [11, [62, 65, 69], 1, .5], [14, [64, 67, 71], 1, .45],
        [18, [64, 68, 71], 1, .55], [22, [64, 68, 71], 1, .5],
        [26, [62, 65, 69], 1, .5], [30, [64, 67, 71], 1, .5],
      ],
      lead: [
        [4, 76, E, .55], [8, 74, E, .5], [12, 71, E, .55], [13, 74, S, .45],
        [20, 76, E, .55], [24, 79, E, .5], [28, 76, E, .55], [29, 71, S, .5],
      ],
    },

    {
      id: 'chip', name: '8BIT 冲锋', nameEn: '8-Bit Charge',
      genre: '8-BIT · 芯片音乐', genreEn: 'CHIPTUNE', bpm: 138, len: 32,
      drums: {
        kick: 'K..K.K..K..K.K..',
        snare: '....S.......S..S',
        hat: 'H.H.H.H.H.H.H.H.',
      },
      bass: [
        [0, 45, E, .9], [2, 45, E, .7], [4, 45, E, .9], [6, 45, E, .7],
        [8, 41, E, .9], [10, 41, E, .7], [12, 41, E, .9], [14, 41, E, .7],
        [16, 48, E, .9], [18, 48, E, .7], [20, 48, E, .9], [22, 48, E, .7],
        [24, 43, E, .9], [26, 43, E, .7], [28, 43, E, .9], [30, 44, E, .8],
      ],
      lead: [
        [0, 81, S, .6], [2, 84, S, .55], [4, 88, E, .6], [6, 84, S, .5],
        [8, 77, S, .6], [10, 81, S, .55], [12, 84, E, .6], [14, 81, S, .5],
        [16, 84, S, .6], [18, 88, S, .55], [20, 91, E, .6], [22, 88, S, .5],
        [24, 79, S, .6], [26, 83, S, .55], [28, 86, E, .6], [31, 88, S, .6],
      ],
      pad: [
        [0, [57, 61, 64], HALF, .3], [16, [60, 64, 67], HALF, .3],
      ],
    },

    {
      id: 'deep', name: '深坑回响', nameEn: 'Abyss Echo',
      genre: '热门 · 暗黑电子', genreEn: 'DARK TECHNO', bpm: 126, len: 32,
      drums: {
        kick: 'K...K...K...K...',
        hat: '..H...H...H...H.',
        clap: '....C.......C...',
        snare: '............S...',
      },
      bass: [
        [2, 38, E, 1], [6, 38, E, .85], [10, 38, E, 1], [14, 50, E, .8],
        [18, 41, E, 1], [22, 41, E, .85], [26, 41, E, 1], [30, 53, E, .8],
      ],
      pad: [
        [0, [50, 53, 57], LONG, .55], [16, [46, 50, 53], LONG, .55],
      ],
      lead: [
        [0, 74, Q, .5], [6, 77, Q, .45], [12, 81, Q, .5],
        [20, 77, Q, .5], [26, 74, Q, .45],
      ],
    },

    {
      id: 'lofi', name: '深夜休息室', nameEn: 'Late Night Lounge',
      genre: '热门 · Lo-Fi 缓拍', genreEn: 'LO-FI', bpm: 82, len: 32, swing: 0.16,
      drums: {
        kick: 'K.......K..K....',
        snare: '....S.......S...',
        hat: 'H.H.H.H.H.H.H.H.',
      },
      bass: [
        [0, 38, Q, .8], [6, 45, E, .6], [10, 41, Q, .75],
        [16, 34, Q, .8], [22, 41, E, .6], [26, 46, Q, .7],
      ],
      pad: [
        [0, [62, 65, 69, 72], 15, .42], [16, [58, 62, 65, 68], 15, .42],
      ],
      lead: [
        [2, 74, E, .45], [8, 77, E, .4], [13, 81, E, .45],
        [18, 72, E, .45], [24, 74, E, .4], [29, 69, E, .4],
      ],
    },

    {
      id: 'hype', name: '热榜炸裂', nameEn: 'Chart Banger',
      genre: '热门 · 主舞台电音', genreEn: 'FESTIVAL EDM', bpm: 128, len: 64,
      drums: {
        kick: 'K...K...K...K...',
        clap: '....C.......C...',
        hat: '..H...H...H...H.',
      },
      bass: [
        [0, 31, E, 1], [2, 43, S, .8], [4, 31, E, 1], [6, 43, S, .8],
        [8, 31, E, 1], [10, 43, S, .8], [12, 31, E, 1], [14, 43, S, .8],
        [16, 27, E, 1], [18, 39, S, .8], [20, 27, E, 1], [22, 39, S, .8],
        [24, 27, E, 1], [26, 39, S, .8], [28, 27, E, 1], [30, 39, S, .8],
        [32, 34, E, 1], [34, 46, S, .8], [36, 34, E, 1], [38, 46, S, .8],
        [40, 34, E, 1], [42, 46, S, .8], [44, 34, E, 1], [46, 46, S, .8],
        [48, 29, E, 1], [50, 41, S, .8], [52, 29, E, 1], [54, 41, S, .8],
        [56, 29, E, 1], [58, 41, S, .8], [60, 29, E, 1], [62, 41, S, .8],
      ],
      stab: [
        [2, [55, 58, 62], 1, .5], [6, [55, 58, 62], 1, .45],
        [10, [55, 58, 62], 1, .5], [14, [58, 62, 65], 1, .45],
        [18, [51, 55, 58], 1, .5], [22, [51, 55, 58], 1, .45],
        [26, [51, 55, 58], 1, .5], [30, [55, 58, 62], 1, .45],
        [34, [46, 50, 53], 1, .5], [38, [46, 50, 53], 1, .45],
        [42, [46, 50, 53], 1, .5], [46, [50, 53, 57], 1, .45],
        [50, [53, 57, 60], 1, .5], [54, [53, 57, 60], 1, .45],
        [58, [53, 57, 60], 1, .5], [62, [55, 58, 62], 1, .45],
      ],
      pad: [[0, [55, 62, 67], LONG, .38], [32, [46, 58, 65], LONG, .38]],
      lead: [
        [0, 79, E, .6], [4, 82, E, .55], [8, 86, Q, .6], [12, 82, E, .5],
        [16, 75, E, .6], [20, 79, E, .55], [24, 82, Q, .6], [28, 79, E, .5],
        [32, 74, E, .6], [36, 77, E, .55], [40, 82, Q, .6], [44, 77, E, .5],
        [48, 77, E, .6], [52, 81, E, .55], [56, 84, Q, .6], [60, 86, E, .6],
      ],
    },

    {
      id: 'lost', name: '失控', nameEn: 'Lost Control',
      genre: '热门 · 伤感流行', genreEn: 'SAD POP', bpm: 86, len: 64, swing: 0.12,
      drums: {
        kick: 'K.......K.......',
        snare: '........S.......',
        hat: '..H...H...H...H.',
      },
      // 小调情歌贝斯：一级 / 六级 / 四级 / 五级 的经典走向
      bass: [
        [0, 36, Q, 1], [4, 36, E, .7], [6, 36, E, .7],
        [8, 33, Q, 1], [12, 33, E, .7], [14, 45, E, .7],
        [16, 41, Q, 1], [20, 41, E, .7], [22, 41, E, .7],
        [24, 43, Q, 1], [28, 43, E, .8], [30, 43, E, .8],
        [32, 36, Q, 1], [36, 36, E, .7], [38, 36, E, .7],
        [40, 33, Q, 1], [44, 33, E, .7], [46, 45, E, .7],
        [48, 41, Q, 1], [52, 41, E, .7], [54, 41, E, .7],
        [56, 43, Q, 1], [60, 43, E, .9], [62, 47, E, .8],
      ],
      pad: [
        [0, [60, 63, 67], LONG, .5], [16, [56, 60, 63], LONG, .5],
        [32, [55, 60, 64], LONG, .5], [48, [55, 60, 64], LONG, .5],
      ],
      // 副歌旋律：神似「爱上你算我失控」的攀升 + 下坠，做成原创循环
      lead: [
        [0, 72, E, .55], [2, 75, E, .5], [4, 79, Q, .6], [8, 77, E, .5],
        [10, 75, E, .5], [12, 72, Q, .55], [16, 68, E, .5], [18, 72, E, .5],
        [20, 75, Q, .55], [24, 72, E, .5], [26, 70, E, .5], [28, 67, Q, .5],
        [32, 72, E, .55], [34, 75, E, .5], [36, 79, Q, .6], [40, 82, E, .55],
        [42, 79, E, .5], [44, 75, Q, .55], [48, 72, E, .5], [50, 75, E, .5],
        [52, 77, Q, .55], [56, 79, E, .55], [58, 77, E, .5], [60, 75, Q, .55],
      ],
    },

    {
      id: 'funkstreet', name: '放克街头', nameEn: 'Funk Street',
      genre: 'FUNK · 街头律动', genreEn: 'FUNK', bpm: 112, len: 32, swing: 0.2,
      drums: {
        kick: 'K..K..K...K..K.K.',
        snare: '....S.......S...',
        hat: '..H.H.HH..H.H.HH',
        clap: '............C...',
      },
      // slap 贝斯：更密集的十六分切分，甩出街头放克味
      bass: [
        [0, 38, S, 1], [2, 38, S, .7], [3, 50, S, .9], [6, 38, S, .85],
        [7, 38, S, .6], [8, 41, S, 1], [11, 41, S, .8], [12, 38, S, .9],
        [14, 45, S, .8],
        [16, 43, S, 1], [18, 43, S, .7], [19, 55, S, .9], [22, 43, S, .85],
        [23, 43, S, .6], [24, 41, S, 1], [27, 41, S, .8], [28, 38, S, .9],
        [30, 45, S, .85],
      ],
      stab: [
        [2, [65, 68, 72], 1, .6], [7, [65, 68, 72], 1, .5],
        [11, [63, 67, 70], 1, .5], [14, [65, 68, 72], 1, .5],
        [18, [65, 69, 72], 1, .6], [22, [65, 69, 72], 1, .5],
        [26, [63, 67, 70], 1, .5], [30, [65, 68, 72], 1, .55],
      ],
      lead: [
        [4, 77, E, .6], [8, 75, E, .55], [12, 72, E, .6], [14, 75, S, .5],
        [20, 77, E, .6], [24, 80, E, .55], [28, 77, E, .6], [30, 72, S, .55],
      ],
    },
  ];

  const Music = {
    ctx: null,
    out: null,          // 音乐音量节点
    noise: null,
    track: null,
    trackId: null,
    playing: false,
    volume: 0.45,
    muted: false,
    _step: 0,
    _next: 0,
    _timer: null,
    _idx: null,
    TRACKS,

    init() {
      LD.Sfx.init();                       // 复用同一个 AudioContext
      this.ctx = LD.Sfx.ctx;
      if (!this.ctx) return false;
      if (!this.out) {
        this.out = this.ctx.createGain();
        this.out.gain.value = this.muted ? 0 : this.volume;
        this.out.connect(this.ctx.destination);
      }
      if (!this.noise) {
        const n = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.6, this.ctx.sampleRate);
        const d = n.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        this.noise = n;
      }
      return true;
    },

    /* ---------- 乐器 ---------- */
    _gain(t, a, d, peak) {
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
      g.connect(this.out);
      return g;
    },
    _pitch(t, f, dur, type, detune) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      if (detune) o.detune.setValueAtTime(detune, t);
      o.start(t); o.stop(t + dur + 0.06);
      return o;
    },
    kick(t, v) {
      const o = this.ctx.createOscillator(), g = this._gain(t, 0.004, 0.22, 0.9 * v);
      o.type = 'sine';
      o.frequency.setValueAtTime(155, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.15);
      o.connect(g); o.start(t); o.stop(t + 0.3);
    },
    snare(t, v) {
      const s = this.ctx.createBufferSource(); s.buffer = this.noise;
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
      const g = this._gain(t, 0.002, 0.16, 0.34 * v);
      s.connect(bp); bp.connect(g); s.start(t); s.stop(t + 0.22);
      const o = this._pitch(t, 190, 0.09, 'triangle');
      const g2 = this._gain(t, 0.002, 0.09, 0.2 * v);
      o.connect(g2);
    },
    clap(t, v) {
      for (let i = 0; i < 3; i++) {
        const tt = t + i * 0.012;
        const s = this.ctx.createBufferSource(); s.buffer = this.noise;
        const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 1.2;
        const g = this._gain(tt, 0.002, i === 2 ? 0.13 : 0.03, (i === 2 ? 0.3 : 0.18) * v);
        s.connect(bp); bp.connect(g); s.start(tt); s.stop(tt + 0.2);
      }
    },
    hat(t, v, open) {
      const s = this.ctx.createBufferSource(); s.buffer = this.noise;
      const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 8200;
      const g = this._gain(t, 0.001, open ? 0.16 : 0.035, (open ? 0.16 : 0.11) * v);
      s.connect(hp); hp.connect(g); s.start(t); s.stop(t + 0.22);
    },
    // 贝斯：锯齿 + 低通包络，另加一层正弦做低频垫底
    bass(t, f, dur, v) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 6;
      lp.frequency.setValueAtTime(Math.min(2600, f * 9), t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(180, f * 2.4), t + dur * 0.7);
      const g = this._gain(t, 0.008, dur, 0.3 * v);
      lp.connect(g);
      const o = this._pitch(t, f, dur, 'sawtooth');
      o.connect(lp);
      const sub = this._pitch(t, f / 2, dur, 'sine');
      const gs = this._gain(t, 0.008, dur, 0.16 * v);
      sub.connect(gs);
    },
    lead(t, f, dur, v, type) {
      const g = this._gain(t, 0.012, dur, 0.155 * v);
      const o1 = this._pitch(t, f, dur, type || 'square');
      const o2 = this._pitch(t, f, dur, type || 'square', 7);
      o1.connect(g); o2.connect(g);
    },
    pad(t, freqs, dur, v) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1700;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.1 * v, t + Math.min(0.6, dur * 0.25));
      g.gain.setValueAtTime(0.1 * v, t + dur * 0.65);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.35);
      g.connect(this.out); lp.connect(g);
      freqs.forEach((m, i) => {
        const o = this._pitch(t, mid(m), dur + 0.3, i === 0 ? 'sawtooth' : 'triangle', i * 6 - 6);
        o.connect(lp);
      });
    },
    // clav / 短促和弦 stab（放克味道的来源）
    stab(t, freqs, dur, v) {
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 1.4;
      const g = this._gain(t, 0.003, dur, 0.14 * v);
      bp.connect(g);
      freqs.forEach((m) => {
        const o = this._pitch(t, mid(m), dur, 'sawtooth');
        o.connect(bp);
      });
    },

    /* ---------- 调度 ---------- */
    _buildIndex(tr) {
      const idx = { bass: {}, lead: {}, pad: {}, stab: {} };
      ['bass', 'lead', 'pad', 'stab'].forEach((part) => {
        (tr[part] || []).forEach((ev) => {
          const s = ev[0] % tr.len;
          (idx[part][s] || (idx[part][s] = [])).push(ev);
        });
      });
      return idx;
    },

    _playStep(s, t, tr, spb) {
      const sw = (tr.swing && s % 2) ? tr.swing * spb : 0;
      const tt = t + sw;
      const dr = tr.drums || {};
      Object.keys(LETTER).forEach((k) => {
        const pat = dr[k];
        if (!pat) return;
        const ch = pat[s % pat.length];
        const want = LETTER[k];
        if (ch !== want && ch !== want.toLowerCase()) return;   // 只认自己那一行的字母
        const hard = ch === want;
        const v = hard ? 1 : 0.6;
        if (k === 'kick') this.kick(tt, v);
        else if (k === 'snare') this.snare(tt, v);
        else if (k === 'clap') this.clap(tt, v);
        else this.hat(tt, v, hard && s % 8 === 6);
      });
      const idx = this._idx;
      (idx.bass[s] || []).forEach((e) => this.bass(tt, mid(e[1]), e[2] * spb, e[3]));
      (idx.lead[s] || []).forEach((e) => this.lead(tt, mid(e[1]), e[2] * spb, e[3]));
      (idx.pad[s] || []).forEach((e) => this.pad(tt, e[1], e[2] * spb, e[3]));
      (idx.stab[s] || []).forEach((e) => this.stab(tt, e[1], e[2] * spb, e[3]));
    },

    _schedule() {
      const ctx = this.ctx, tr = this.track;
      if (!tr) return;
      const spb = 60 / tr.bpm / 4;                 // 一个 16 分音符的秒数
      while (this._next < ctx.currentTime + 0.2) {
        this._playStep(this._step, this._next, tr, spb);
        this._next += spb;
        this._step = (this._step + 1) % tr.len;
      }
    },

    play(id) {
      if (!this.init()) return;
      if (id) this.trackId = id;
      const tr = TRACKS.filter((x) => x.id === this.trackId)[0] || TRACKS[0];
      this.track = tr; this.trackId = tr.id;
      this._idx = this._buildIndex(tr);
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.playing = true;
      this._step = 0;
      this._next = this.ctx.currentTime + 0.08;
      if (this._timer) clearInterval(this._timer);
      this._timer = setInterval(() => this._schedule(), 25);
    },

    stop() {
      this.playing = false;
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
    },

    setVolume(v) {
      this.volume = LD.clamp(v, 0, 1);
      if (this.out) this.out.gain.value = this.muted ? 0 : this.volume;
    },

    setMuted(m) {
      this.muted = !!m;
      if (this.out) this.out.gain.value = this.muted ? 0 : this.volume;
    },

    // 按当前设置同步播放状态（设置面板 / 顶栏按钮都走这里）
    sync(settings) {
      const s = settings || LD.Settings.data;
      this.setVolume(s.music.volume);
      this.setMuted(!s.music.on);
      if (s.music.on && s.music.track && s.music.track !== 'none') {
        if (!this.playing || this.trackId !== s.music.track) this.play(s.music.track);
        else if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      } else {
        this.stop();
      }
    },

    info(id) { return TRACKS.filter((t) => t.id === id)[0] || null; },
  };

  LD.Music = Music;
})();
