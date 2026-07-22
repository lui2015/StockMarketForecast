'use strict';

const db = require('./db');

// 简单内存限流：记录每个 key 最近 60s 的请求时间戳
const hits = new Map();
function rateLimited(apiKey, limit) {
  const now = Date.now();
  const arr = (hits.get(apiKey) || []).filter((t) => now - t < 60000);
  arr.push(now);
  hits.set(apiKey, arr);
  return arr.length > limit;
}

// 记录一次 API Key 调用（按本地时区当天累加），失败不影响主流程
const bumpApiCallStmt = db.prepare(
  "INSERT INTO api_call_daily(day, count) VALUES (date('now','localtime'), 1) " +
  'ON CONFLICT(day) DO UPDATE SET count = count + 1'
);
function bumpApiCall() {
  try { bumpApiCallStmt.run(); } catch (e) { /* 计数失败忽略 */ }
}

// 网页「web」账户与所有 AI 调用账户属于同一所有者：
// 在网页端查看历史 / 首页统计时，应把 AI 接口提交的预测一并展示。
let _ownerScopeCache = null;
function ownerScopeIds() {
  if (_ownerScopeCache) return _ownerScopeCache;
  const ids = [];
  const web = db.prepare("SELECT id FROM accounts WHERE name=? AND type=?").get('web', 'USER');
  if (web) ids.push(web.id);
  const ai = db.prepare("SELECT id FROM accounts WHERE type='AI'").all();
  for (const a of ai) ids.push(a.id);
  _ownerScopeCache = ids;
  return ids;
}

// 计算「可见用户集合」：web / AI 账户共享同一视图；其他独立 USER 仅看自己
function scopeFor(user) {
  if (user.type === 'AI') return ownerScopeIds();
  if (user.name === 'web' && user.type === 'USER') return ownerScopeIds();
  return [user.id];
}

// 解析调用方：Bearer API Key（AI）/ X-User-Id（网页）/ 默认 web 账户
function resolveUser(req, res, next) {
  const auth = req.headers['authorization'] || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) {
    const key = m[1].trim();
    const acc = db.prepare('SELECT * FROM accounts WHERE api_key=?').get(key);
    if (!acc) return res.status(401).json({ code: 401, msg: '无效的 API Key' });
    if (rateLimited(key, acc.rate_limit || 60)) {
      return res.status(429).json({ code: 429, msg: '请求过于频繁，请稍后再试' });
    }
    bumpApiCall();
    req.user = acc;
    req.viewUserIds = scopeFor(acc);
    return next();
  }
  const uid = parseInt(req.headers['x-user-id'] || '', 10);
  if (uid) {
    const acc = db.prepare('SELECT * FROM accounts WHERE id=? AND type=?').get(uid, 'USER');
    if (acc) {
      req.user = acc;
      req.viewUserIds = scopeFor(acc);
      return next();
    }
  }
  // 默认使用 web 演示账户
  const web = db.prepare("SELECT * FROM accounts WHERE name=? AND type=?").get('web', 'USER');
  if (web) {
    req.user = web;
    req.viewUserIds = scopeFor(web);
    return next();
  }
  return res.status(401).json({ code: 401, msg: '未识别的用户' });
}

module.exports = { resolveUser, ownerScopeIds };
