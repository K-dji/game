/* cloud.js — 「谁才是赢家」云端账号（注册 / 登录 / 云存档 / 权限）
   后端：Cloudflare Worker + D1（worker/api-worker.js），地址见 API_BASE。
   设计：
     · 令牌存 localStorage（30 天有效），启动时静默续登；
     · 登录 / 注册成功后：云端有存档且进度比本地新 → 自动采用云端；
       否则保留本地，稍后自动上传；
     · LD.Save.flush() 被包一层：登录状态下存档一变就防抖 8 秒自动上传；
     · 权限：role==='admin'（至高账号）随时可作弊；普通用户须管理员 cheat_on。
       LD.Cloud.canCheat() 是前端作弊总开关；
     · LD.Cloud.onAuth 挂钩：登录态 / 权限变化时通知 game.js 刷新 UI。 */
(function () {
  /* ★★★ 部署 API 后把 Worker 地址填在这里，例如：
     const API_BASE = 'https://kaobei-api.xxxxx.workers.dev';
     留空 '' 表示走同源 /api（Pages Functions 方式）。 */
  const API_BASE = 'https://kaobei-games-2d.pages.dev';

  const TOK = 'yyzj_token', NAME = 'yyzj_name';
  const state = { user: null, role: null, cheatOk: false, ready: false, merged: false, timer: null, busy: false };

  async function api(path, body, method) {
    const opt = { method: method || (body ? 'POST' : 'GET'), headers: {} };
    const tok = localStorage.getItem(TOK);
    if (tok) opt.headers['authorization'] = 'Bearer ' + tok;
    if (body) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const base = API_BASE ? API_BASE.replace(/\/+$/, '') : '';
    let r;
    try { r = await fetch(base + '/api' + path, opt); }
    catch (e) { throw new Error('网络不通，稍后再试'); }
    let j = null;
    try { j = await r.json(); } catch (e) { j = null; }
    if (!j) {
      // 404 / 405 = 请求打到了一个没有 API 的静态站点上
      if (r.status === 404 || r.status === 405) {
        throw new Error(API_BASE
          ? 'API 地址不对（' + r.status + '）：检查 API_BASE 是否填了完整的 Worker 地址'
          : 'API 后端还没部署（' + r.status + '）：需要先在 Cloudflare 建 Worker 并把地址填进 js/cloud.js 的 API_BASE，再重新上传网站');
      }
      throw new Error('服务器没有回应（' + r.status + '）');
    }
    if (!j.ok) {
      // 令牌失效 / 被封禁：清掉本地登录态
      if ((r.status === 401 || r.status === 403) && state.user) clearLocal();
      throw new Error(j.error || '操作失败');
    }
    return j;
  }

  function clearLocal() {
    state.user = null; state.role = null; state.cheatOk = false; state.merged = false;
    localStorage.removeItem(TOK); localStorage.removeItem(NAME);
  }

  /* 采用云端存档覆盖本地（保留 DEFAULTS 里可能新增的字段） */
  function applyCloudSave(save) {
    if (!save || typeof save !== 'object') return;
    const base = JSON.parse(JSON.stringify(LD.Save.DEFAULTS));
    LD.Save.data = Object.assign(base, save);
    if (LD.Save.data.endless && base.endless) LD.Save.data.endless = Object.assign(base.endless, save.endless || {});
    if (LD.Save.data.coop && base.coop) LD.Save.data.coop = Object.assign(base.coop, save.coop || {});
    if (LD.Save.data.gun && base.gun) LD.Save.data.gun = Object.assign(base.gun, save.gun || {});
    state.merged = true;
    LD.Save.flush();          // 会走自动上传钩子 → 把合并结果写回云端
  }

  /* 本地进度是否明显落后云端（只比解锁进度，粗但够用） */
  function localBehind(cloud) {
    if (!cloud) return false;
    const loc = LD.Save.data;
    const cu = Math.max(cloud.unlocked || 0, (cloud.coop && cloud.coop.unlocked) || 0, (cloud.gun && cloud.gun.unlocked) || 0);
    const lu = Math.max(loc.unlocked || 0, (loc.coop && loc.coop.unlocked) || 0, (loc.gun && loc.gun.unlocked) || 0);
    return cu > lu;
  }

  function schedulePush() {
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => { pushSave().catch(() => {}); }, 8000);
  }
  async function pushSave() {
    if (!state.user || state.busy) return;
    state.busy = true;
    try { await api('/save', { save: LD.Save.data }); } finally { state.busy = false; }
  }

  async function register(name, pw) {
    const j = await api('/register', { name, pw });
    afterAuth(j);
    return j;
  }
  async function login(name, pw) {
    const j = await api('/login', { name, pw });
    afterAuth(j);
    return j;
  }
  function afterAuth(j) {
    localStorage.setItem(TOK, j.token);
    localStorage.setItem(NAME, j.name);
    state.user = j.name;
    state.role = j.role || 'user';
    state.cheatOk = !!j.cheatOk;
    state.merged = false;
    notifyAuth();
    if (j.save && localBehind(j.save)) applyCloudSave(j.save);   // 换设备：云端进度新 → 直接用云端的
    else if (j.save) { state.merged = true; schedulePush(); }     // 本地不落后 → 稍后把本地推上去
    else schedulePush();                                          // 云端还没存档 → 推本地
  }
  async function logout() {
    try { await api('/logout', {}); } catch (e) { /* 令牌失效也无所谓 */ }
    clearLocal();
    notifyAuth();
  }
  async function downloadSave() {
    const j = await api('/me');
    if (!j.save) throw new Error('云端还没有存档');
    applyCloudSave(j.save);
    return j.save;
  }
  async function uploadSave() {
    state.merged = true;
    await pushSave();
  }
  async function boot() {
    if (!localStorage.getItem(TOK)) { state.ready = true; return; }
    try {
      const j = await api('/me');
      state.user = j.name;
      state.role = j.role || 'user';
      state.cheatOk = !!j.cheatOk;
      notifyAuth();
      if (j.save && localBehind(j.save)) applyCloudSave(j.save);
      else state.merged = true;
    } catch (e) { /* 离线 / 令牌过期：安静降级为本地存档 */ }
    state.ready = true;
  }

  /* 权限变化通知：game.js 在这里挂刷新作弊 UI 的回调 */
  let authCb = null;
  function notifyAuth() { if (authCb) { try { authCb(); } catch (e) {} } }

  /* ---------- 管理接口（仅至高账号令牌有效） ---------- */
  async function adminUsers() {
    const j = await api('/admin/users');
    return j.users || [];
  }
  async function adminAct(id, act) {
    await api('/admin/user', { id, act });
  }

  /* 自动上传钩子：包一层 LD.Save.flush —— 本地存档一落盘就计划上传 */
  if (LD.Save && LD.Save.flush) {
    const _flush = LD.Save.flush.bind(LD.Save);
    LD.Save.flush = function () { _flush(); if (state.user && state.merged) schedulePush(); };
  }

  LD.Cloud = {
    register, login, logout, uploadSave, downloadSave, pushSave, boot,
    user: () => state.user,
    role: () => state.role,
    isAdmin: () => state.role === 'admin',
    /* 前端作弊总开关：至高账号随时可用；普通用户须管理员授过权 */
    canCheat: () => state.role === 'admin' || state.cheatOk,
    onAuth: (fn) => { authCb = fn; },
    adminUsers, adminAct,
    hasCloudSave: async () => {
      try { const j = await api('/me'); return !!j.save; } catch (e) { return false; }
    },
  };
  LD.Cloud.boot();
})();
