'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

if (!fs.existsSync(config.dataDir)) {
  fs.mkdirSync(config.dataDir, { recursive: true });
}
if (!fs.existsSync(config.reasonsDir)) {
  fs.mkdirSync(config.reasonsDir, { recursive: true });
}
const dbPath = path.join(config.dataDir, config.dbFile);
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'USER',     -- USER | AI
  api_key TEXT,
  pass TEXT,
  rate_limit INTEGER DEFAULT 60,         -- 每分钟请求上限
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  market TEXT NOT NULL,                  -- A_INDEX | HK_INDEX | A_STOCK | HK_STOCK
  symbol TEXT NOT NULL,
  symbol_name TEXT,
  target_date TEXT NOT NULL,             -- 目标交易日 YYYY-MM-DD
  direction TEXT NOT NULL,               -- UP | DOWN
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',-- PENDING | VERIFIED | ERROR
  actual_change REAL,                    -- 实际涨跌幅（小数，如 0.0123 表示 1.23%）
  is_hit INTEGER,                        -- 0 | 1 | NULL
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, symbol, target_date)
);

CREATE TABLE IF NOT EXISTS quotes (
  symbol TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  close_price REAL,
  prev_close REAL,
  change_pct REAL,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (symbol, trade_date)
);

CREATE INDEX IF NOT EXISTS idx_predictions_status ON predictions(status);
CREATE INDEX IF NOT EXISTS idx_predictions_user ON predictions(user_id);

CREATE TABLE IF NOT EXISTS api_call_daily (
  day TEXT PRIMARY KEY,                  -- 调用日期 YYYY-MM-DD（服务器本地时区）
  count INTEGER NOT NULL DEFAULT 0       -- 当日通过 API Key 的调用次数
);
`);

// 迁移：预测逻辑由文字升级为可上传的 HTML 文件
const predCols = db.prepare('PRAGMA table_info(predictions)').all().map((c) => c.name);
if (!predCols.includes('reason_file')) {
  db.exec('ALTER TABLE predictions ADD COLUMN reason_file TEXT');
}
// 迁移：记录提交方式（手工 web / 接口 api）
if (!predCols.includes('submit_source')) {
  db.exec("ALTER TABLE predictions ADD COLUMN submit_source TEXT NOT NULL DEFAULT 'web'");
}

// 初始化种子账户：管理员 + 一个 AI 调用方
function seed() {
  const hasAdmin = db.prepare('SELECT 1 FROM accounts WHERE type=? AND name=?').get('USER', config.adminName);
  if (!hasAdmin) {
    db.prepare('INSERT INTO accounts (name, type, pass, rate_limit) VALUES (?,?,?,?)')
      .run(config.adminName, 'USER', config.adminPass, 200);
  }
  const hasWeb = db.prepare("SELECT 1 FROM accounts WHERE name=? AND type=?").get('web', 'USER');
  if (!hasWeb) {
    db.prepare('INSERT INTO accounts (name, type, pass, rate_limit) VALUES (?,?,?,?)')
      .run('web', 'USER', 'web', 100);
  }
  const hasAi = db.prepare('SELECT 1 FROM accounts WHERE api_key=?').get(config.seedAiApiKey);
  if (!hasAi) {
    db.prepare('INSERT INTO accounts (name, type, api_key, rate_limit) VALUES (?,?,?,?)')
      .run('ai-demo', 'AI', config.seedAiApiKey, 120);
  }
}
seed();

module.exports = db;
