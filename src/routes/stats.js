'use strict';

const express = require('express');
const db = require('../db');
const { MARKETS, STOCK_MARKETS, expandMarketFilter } = require('../market');
const { resolveUser } = require('../auth');
const router = express.Router();

// 构造「用户集合」过滤子句（web + AI 账户共享同一视图）
function userIn(ids) {
  const ph = ids.map(() => '?').join(',');
  return { clause: `user_id IN (${ph})`, ids };
}

// 今日预测结果（大盘三类）
const INDEX_MARKETS = ['A_INDEX', 'HK_INDEX', 'US_INDEX'];
router.get('/today', resolveUser, (req, res) => {
  const date = (req.query.date || new Date().toISOString().slice(0, 10));
  const scope = userIn(req.viewUserIds);
  const out = {};
  INDEX_MARKETS.forEach((m) => {
    const rows = db.prepare(
      `SELECT * FROM predictions WHERE ${scope.clause} AND market=? AND target_date=? ORDER BY id DESC`
    ).all(...scope.ids, m, date);
    out[m] = rows;
  });
  res.json({ code: 0, data: { date, order: INDEX_MARKETS, markets: out } });
});

// 统计
router.get('/', resolveUser, (req, res) => {
  const { market, date } = req.query;
  const scope = userIn(req.viewUserIds);
  const base = [scope.clause, "status='VERIFIED'"];
  const params = [...scope.ids];
  if (market) { base.push('market=?'); params.push(market); }
  if (date) { base.push('target_date=?'); params.push(date); }
  const cond = base.join(' AND ');

  const total = db.prepare(`SELECT COUNT(*) c, SUM(is_hit) h FROM predictions WHERE ${cond}`).get(...params);

  // 该范围总提交数（含待校验），用于首页「今日」展示
  const scopeBase = [scope.clause];
  const scopeParams = [...scope.ids];
  if (market) { scopeBase.push('market=?'); scopeParams.push(market); }
  if (date) { scopeBase.push('target_date=?'); scopeParams.push(date); }
  const sc = db.prepare(`SELECT COUNT(*) c, SUM(CASE WHEN status='VERIFIED' THEN 1 ELSE 0 END) v,
    SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END) p FROM predictions WHERE ${scopeBase.join(' AND ')}`).get(...scopeParams);
  const accuracy = total.c ? total.h / total.c : 0;

  // 本周 / 本月成功率
  const now = new Date();
  const day = now.getDay() || 7; // 周一=1 ... 周日=7
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1);
  const weekStart = monday.toISOString().slice(0, 10);
  const monthStart = now.toISOString().slice(0, 7) + '-01';

  const weekRow = db.prepare(`SELECT COUNT(*) c, SUM(is_hit) h FROM predictions WHERE ${cond} AND target_date >= ?`).get(...params, weekStart);
  const monthRow = db.prepare(`SELECT COUNT(*) c, SUM(is_hit) h FROM predictions WHERE ${cond} AND target_date >= ?`).get(...params, monthStart);
  const weekAcc = weekRow.c ? weekRow.h / weekRow.c : 0;
  const monthAcc = monthRow.c ? monthRow.h / monthRow.c : 0;

  // 按市场拆分
  const byMarket = {};
  for (const k of Object.keys(MARKETS)) {
    const r = db.prepare(`SELECT COUNT(*) c, SUM(is_hit) h FROM predictions WHERE ${cond} AND market=?`)
      .get(...params, k);
    byMarket[k] = { label: MARKETS[k], total: r.c, hits: r.h, accuracy: r.c ? r.h / r.c : 0 };
  }

  // 近 30 个交易日趋势（按 target_date 聚合）
  const trend = db.prepare(`SELECT target_date, COUNT(*) c, SUM(is_hit) h
    FROM predictions WHERE ${cond} GROUP BY target_date ORDER BY target_date DESC LIMIT 30`)
    .all(...params).reverse().map((r) => ({ date: r.target_date, total: r.c, hits: r.h, accuracy: r.c ? r.h / r.c : 0 }));

  // 连胜/连败（按时间升序最近记录）
  const recent = db.prepare(`SELECT is_hit FROM predictions WHERE ${cond} ORDER BY target_date DESC, id DESC LIMIT 50`).all(...params);
  let streak = 0, streakType = null;
  for (const r of recent) {
    const v = r.is_hit ? 'W' : 'L';
    if (streakType === null) { streakType = v; streak = 1; }
    else if (v === streakType) streak++;
    else break;
  }

  res.json({
    code: 0,
    data: {
      total: total.c, hits: total.h || 0, accuracy,
      weekAccuracy: weekAcc, weekTotal: weekRow.c, weekHits: weekRow.h || 0,
      monthAccuracy: monthAcc, monthTotal: monthRow.c, monthHits: monthRow.h || 0,
      scopeTotal: sc.c, scopeVerified: sc.v || 0, scopePending: sc.p || 0,
      byMarket, trend, streak: { type: streakType, count: streak },
    },
  });
});

// 个股列表（某用户提交过的个股 symbol）
router.get('/symbols', resolveUser, (req, res) => {
  const scope = userIn(req.viewUserIds);
  const rows = db.prepare(`SELECT symbol, MAX(symbol_name) AS symbol_name, COUNT(*) AS c
    FROM predictions WHERE ${scope.clause} AND market IN (${STOCK_MARKETS.map(() => '?').join(',')})
    GROUP BY symbol ORDER BY c DESC, symbol`).all(...scope.ids, ...STOCK_MARKETS);
  res.json({ code: 0, data: rows });
});

// 预测日历：某月每天的聚合统计（含待校验/异常），支持按市场/分类筛选
router.get('/calendar', resolveUser, (req, res) => {
  const scope = userIn(req.viewUserIds);
  const month = (req.query.month || new Date().toISOString().slice(0, 7)); // YYYY-MM
  const like = month + '%';
  const markets = expandMarketFilter(req.query.market);
  let sql = `SELECT target_date,
      COUNT(*) total,
      SUM(CASE WHEN status='VERIFIED' THEN 1 ELSE 0 END) verified,
      SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END) pending,
      SUM(CASE WHEN status='ERROR' THEN 1 ELSE 0 END) err,
      SUM(is_hit) hits,
      SUM(CASE WHEN direction='UP' THEN 1 ELSE 0 END) up,
      SUM(CASE WHEN direction='DOWN' THEN 1 ELSE 0 END) down
    FROM predictions WHERE ${scope.clause} AND target_date LIKE ?`;
  const params = [...scope.ids, like];
  if (markets) { sql += ` AND market IN (${markets.map(() => '?').join(',')})`; params.push(...markets); }
  const symbol = req.query.symbol;
  if (symbol) { sql += ' AND symbol=?'; params.push(symbol); }
  sql += ' GROUP BY target_date';
  const rows = db.prepare(sql).all(...params);
  const days = {};
  rows.forEach((r) => {
    days[r.target_date] = {
      total: r.total, verified: r.verified, pending: r.pending, err: r.err,
      hits: r.hits || 0, accuracy: r.verified ? (r.hits || 0) / r.verified : null,
      up: r.up || 0, down: r.down || 0,
    };
  });
  res.json({ code: 0, data: { month, today: new Date().toISOString().slice(0, 10), days } });
});

// 全局排行榜（所有 USER）
router.get('/leaderboard', (req, res) => {
  const rows = db.prepare(`SELECT a.name, COUNT(p.id) c, SUM(p.is_hit) h
    FROM predictions p JOIN accounts a ON a.id=p.user_id
    WHERE p.status='VERIFIED' GROUP BY p.user_id ORDER BY (CAST(SUM(p.is_hit) AS REAL)/COUNT(p.id)) DESC, c DESC LIMIT 20`)
    .all();
  const board = rows.map((r, i) => ({ rank: i + 1, name: r.name, total: r.c, hits: r.h, accuracy: r.c ? r.h / r.c : 0 }));
  res.json({ code: 0, data: board });
});

module.exports = router;
