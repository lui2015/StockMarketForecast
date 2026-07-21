'use strict';

const db = require('./db');
const { getQuote } = require('./market');

// 校验单条预测：拉取实际涨跌幅，判定命中
async function verifyOne(row) {
  const q = await getQuote(row.symbol, row.target_date);
  if (!q || q.changePct == null) {
    db.prepare("UPDATE predictions SET status='ERROR', updated_at=datetime('now') WHERE id=?")
      .run(row.id);
    return { id: row.id, status: 'ERROR' };
  }
  const actual = q.changePct;
  // 平盘（|涨跌幅| < 1e-9）视为不命中
  let isHit = 0;
  if (actual > 1e-9 && row.direction === 'UP') isHit = 1;
  else if (actual < -1e-9 && row.direction === 'DOWN') isHit = 1;

  const upd = db.prepare(`UPDATE predictions
    SET status='VERIFIED', actual_change=?, is_hit=?, verified_at=datetime('now'), updated_at=datetime('now')
    WHERE id=?`);
  upd.run(actual, isHit, row.id);

  db.prepare(`INSERT OR REPLACE INTO quotes (symbol, trade_date, close_price, prev_close, change_pct, source)
    VALUES (?,?,?,?,?,?)`).run(
    row.symbol, row.target_date, q.close || null, q.prevClose || null, actual, q.mock ? 'mock' : 'eastmoney');
  return { id: row.id, status: 'VERIFIED', actual_change: actual, is_hit: isHit };
}

// 校验所有待处理且目标日 <= 今天的预测
async function runVerify(dateStr) {
  const today = dateStr || new Date().toISOString().slice(0, 10);
  const rows = db.prepare("SELECT * FROM predictions WHERE status='PENDING' AND target_date <= ?")
    .all(today);
  const results = [];
  for (const r of rows) {
    try {
      results.push(await verifyOne(r));
    } catch (e) {
      results.push({ id: r.id, status: 'ERROR', error: String(e) });
    }
  }
  return { checked: rows.length, results };
}

// 管理员手动补录校验结果
function manualVerify(id, actualChange) {
  const row = db.prepare('SELECT * FROM predictions WHERE id=?').get(id);
  if (!row) return null;
  const isHit = (actualChange > 1e-9 && row.direction === 'UP') ||
    (actualChange < -1e-9 && row.direction === 'DOWN') ? 1 : 0;
  db.prepare(`UPDATE predictions SET status='VERIFIED', actual_change=?, is_hit=?, verified_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
    .run(actualChange, isHit, id);
  db.prepare(`INSERT OR REPLACE INTO quotes (symbol, trade_date, change_pct, source) VALUES (?,?,?,?)`)
    .run(row.symbol, row.target_date, actualChange, 'manual');
  return { id, status: 'VERIFIED', actual_change: actualChange, is_hit: isHit };
}

module.exports = { runVerify, verifyOne, manualVerify };
