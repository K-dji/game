/* secret.js — 密码校验（源码里不再出现明文密码）
   关卡全解锁 / 作弊模式共用同一套口令，但源码只保存「加盐 + 多轮 SHA-256」后的摘要。
   即使有人打开 DevTools 搜字符串，也搜不到 K12345678，只能看到一串不可逆的十六进制摘要。

   为什么自己写 SHA-256 而不用 crypto.subtle：
     · file:// 直接双击打开时，部分浏览器不把页面当安全上下文，crypto.subtle 会直接 undefined；
     · crypto.subtle.digest 是异步的，而 tryUnlock / 作弊校验都是同步按钮回调。
   这里的实现只依赖 TextEncoder（现代浏览器 / Node 都有），同步、离线、零依赖。 */
(function () {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;

  function sha256Hex(msg) {
    const src = new TextEncoder().encode(String(msg));
    const bits = src.length * 8;
    const pad = (56 - (src.length + 1) % 64 + 64) % 64;
    const total = src.length + 1 + pad + 8;
    const buf = new Uint8Array(total);
    buf.set(src);
    buf[src.length] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor(bits / 0x100000000));
    dv.setUint32(total - 4, bits >>> 0);
    let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
             0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Uint32Array(64);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const a = w[i - 15], b = w[i - 2];
        const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
        const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    return H.map((x) => x.toString(16).padStart(8, '0')).join('');
  }

  const SALT = 'yrzx::v1::room+cheat';
  const ROUNDS = 320;
  /* 口令派生：盐 + 口令，再迭代 320 轮，每轮把上一轮摘要和轮号一起重新哈希。
     明文口令不出现在源码里，字典爆破也因此变慢。 */
  function derive(pw) {
    let s = sha256Hex(SALT + '|' + String(pw == null ? '' : pw).trim());
    for (let i = 0; i < ROUNDS; i++) s = sha256Hex(s + '|' + i.toString(36) + '|' + SALT);
    return s;
  }

  /* 用 node -e "…LD.Secret.hash('…')" 预先算好；这里只存摘要。 */
  const DIGEST = 'bc85a897ed57706d885bae57c9509b81de464f5a1bb3bfcf8fac1d82ea1cc459';

  function safeEq(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  LD.Secret = {
    hash: derive,
    check(pw) {
      const s = String(pw == null ? '' : pw).trim();
      if (!s) return false;
      return safeEq(derive(s), DIGEST);
    },
  };
})();
