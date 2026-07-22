'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const config = require('../config');
const { MARKETS, STOCK_MARKETS, normalizeSymbol, resolveSymbolName, fetchSecurityName, expandMarketFilter } = require('../market');
const { resolveUser } = require('../auth');
const { manualVerify } = require('../verify');
const router = express.Router();

function nextTradingDay(from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

// 上传的 HTML 文件存内存，再落盘到 reasonsDir
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.reasonMaxBytes },
  fileFilter: (req, file, cb) => {
    const ok = /\.html?$/i.test(file.originalname) || /html/i.test(file.mimetype || '');
    cb(null, !!ok);
  },
});

// 提交预测（支持 multipart 上传 HTML 文件，或 JSON 传 reason_html 文本）
router.post('/', (req, res, next) => {
  upload.single('reason_file')(req, res, (err) => {
    if (err) return res.status(400).json({ code: 400, msg: 'HTML 文件上传失败：' + err.message });
    next();
  });
}, resolveUser, async (req, res) => {
  const body = req.body || {};
  const market = body.market;
  const symbol = body.symbol;
  const target_date = body.target_date;
  const direction = body.direction;
  const caption = (body.reason || '').toString().slice(0, 500);
  const symbolNameInput = (body.symbol_name || '').toString().trim();
  // 提交方式：Bearer API Key 视为接口提交，否则为网页手工提交
  const submitSource = (req.headers['authorization'] && /^Bearer\s+/i.test(req.headers['authorization'])) ? 'api' : 'web';

  if (!MARKETS[market]) return res.status(400).json({ code: 400, msg: 'market 非法' });
  if (!['UP', 'DOWN'].includes(direction)) return res.status(400).json({ code: 400, msg: 'direction 必须为 UP 或 DOWN' });
  const sym = normalizeSymbol(market, symbol);
  if (!sym) return res.status(400).json({ code: 400, msg: '证券代码格式非法' });
  const tdate = target_date || nextTradingDay();
  if (tdate < todayStr()) return res.status(400).json({ code: 400, msg: '目标交易日不能早于今天' });

  if (tdate === todayStr()) {
    const now = new Date();
    if (now.getHours() > config.submitDeadlineHour ||
       (now.getHours() === config.submitDeadlineHour && now.getMinutes() >= config.submitDeadlineMinute)) {
      return res.status(400).json({ code: 400, msg: '已过今日提交截止时间' });
    }
  }

  // 个股优先使用用户提交的证券名称；预设大盘用映射；其余回退到代码
  // 用户未填真实名称（输入与代码相同）时忽略，统一解析中文名，避免存成英文代码
  const effectiveInput = (symbolNameInput && symbolNameInput.toLowerCase() !== sym) ? symbolNameInput : '';
  // 预置指数命中则用中文名（resolveSymbolName 未命中会回退成代码，故与代码比较判断是否真正命中）
  const preset = resolveSymbolName(sym, '');
  let symbolName = effectiveInput || (preset && preset.toLowerCase() !== sym ? preset : '');
  // 个股未命中预置映射且用户未填名称时，尝试从行情源拉取证券中文名（best-effort）
  if (!symbolName && STOCK_MARKETS.includes(market)) {
    try {
      const fetched = await fetchSecurityName(sym);
      if (fetched) symbolName = fetched;
    } catch (e) { /* 忽略，回退到代码 */ }
  }
  if (!symbolName) symbolName = sym;

  try {
    db.prepare(`INSERT INTO predictions (user_id, market, symbol, symbol_name, target_date, direction, reason, submit_source)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id, symbol, target_date) DO UPDATE SET
        direction=excluded.direction, reason=excluded.reason, status='PENDING',
        actual_change=NULL, is_hit=NULL, verified_at=NULL, updated_at=datetime('now'),
        submit_source=excluded.submit_source`)
      .run(req.user.id, market, sym, symbolName, tdate, direction, caption, submitSource);

    const row = db.prepare('SELECT * FROM predictions WHERE user_id=? AND symbol=? AND target_date=?')
      .get(req.user.id, sym, tdate);

    // 解析 HTML 逻辑内容（来源于上传文件或 JSON 字段 reason_html）
    let html = null;
    if (req.file && req.file.buffer && req.file.buffer.length) html = req.file.buffer;
    else if (typeof body.reason_html === 'string' && body.reason_html.length) html = Buffer.from(body.reason_html, 'utf8');

    if (html) {
      if (html.length > config.reasonMaxBytes) {
        return res.status(400).json({ code: 400, msg: 'HTML 文件超出大小限制' });
      }
      const safeName = row.id + '.html';
      fs.writeFileSync(path.join(config.reasonsDir, safeName), html);
      db.prepare('UPDATE predictions SET reason_file=?, reason=? WHERE id=?')
        .run(safeName, caption, row.id);
      row.reason_file = safeName;
      row.reason = caption;
    }

    res.json({ code: 0, data: row });
  } catch (e) {
    res.status(500).json({ code: 500, msg: '提交失败: ' + e.message });
  }
});

// 读取某条预测关联的 HTML 逻辑文件（需鉴权，仅本人可见）
router.get('/:id/reason', resolveUser, (req, res) => {
  const ids = req.viewUserIds;
  const ph = ids.map(() => '?').join(',');
  const row = db.prepare(`SELECT * FROM predictions WHERE id=? AND user_id IN (${ph})`).get(parseInt(req.params.id, 10), ...ids);
  if (!row || !row.reason_file) return res.status(404).json({ code: 404, msg: '无关联逻辑文件' });
  const fp = path.join(config.reasonsDir, row.reason_file);
  if (!fs.existsSync(fp)) return res.status(404).json({ code: 404, msg: '文件不存在' });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy',
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: *; font-src * data:; connect-src 'none'");
  res.send(fs.readFileSync(fp));
});

// 列表/筛选
router.get('/', resolveUser, (req, res) => {
  const { market, status, symbol, target_date, source, start_date, end_date, page = 1, size = 20 } = req.query;
  let ids = req.viewUserIds;
  if (req.query.user) ids = [parseInt(req.query.user, 10)];
  const ph = ids.map(() => '?').join(',');
  const where = [`user_id IN (${ph})`];
  const params = [...ids];
  const markets = expandMarketFilter(market);
  if (markets) { where.push(`market IN (${markets.map(() => '?').join(',')})`); params.push(...markets); }
  if (symbol) { where.push('symbol=?'); params.push(symbol); }
  if (status) { where.push('status=?'); params.push(status); }
  if (target_date) { where.push('target_date=?'); params.push(target_date); }
  if (source) { where.push('submit_source=?'); params.push(source); }
  if (start_date) { where.push('target_date>=?'); params.push(start_date); }
  if (end_date) { where.push('target_date<=?'); params.push(end_date); }
  const sql = `SELECT * FROM predictions WHERE ${where.join(' AND ')} ORDER BY target_date DESC, id DESC LIMIT ? OFFSET ?`;
  const list = db.prepare(sql).all(...params, parseInt(size, 10), (parseInt(page, 10) - 1) * parseInt(size, 10));
  const total = db.prepare(`SELECT COUNT(*) c FROM predictions WHERE ${where.join(' AND ')}`).get(...params).c;
  res.json({ code: 0, data: { list, total, page: parseInt(page, 10), size: parseInt(size, 10) } });
});

router.get('/:id', resolveUser, (req, res) => {
  const ids = req.viewUserIds;
  const ph = ids.map(() => '?').join(',');
  const row = db.prepare(`SELECT * FROM predictions WHERE id=? AND user_id IN (${ph})`).get(req.params.id, ...ids);
  if (!row) return res.status(404).json({ code: 404, msg: '未找到' });
  res.json({ code: 0, data: row });
});

// 手动修正预测结果（仅本人或管理员）
//  - result: 'HIT' | 'MISS'   -> 直接判定命中/未中（VERIFIED）
//  - result: 'PENDING'        -> 恢复为待校验
//  - actual_change(兼容)       -> 按涨跌幅规则自动判定
router.patch('/:id/result', resolveUser, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT * FROM predictions WHERE id=?').get(id);
  if (!row) return res.status(404).json({ code: 404, msg: '未找到预测' });
  const isAdmin = req.headers['x-admin-pass'] === config.adminPass;
  if (!req.viewUserIds.includes(row.user_id) && !isAdmin) {
    return res.status(403).json({ code: 403, msg: '无权修改该预测' });
  }
  const body = req.body || {};
  // 直接设置命中 / 未中
  if (body.result === 'HIT' || body.result === 'MISS') {
    const hit = body.result === 'HIT' ? 1 : 0;
    db.prepare(`UPDATE predictions SET status='VERIFIED', is_hit=?, verified_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
      .run(hit, id);
    return res.json({ code: 0, data: db.prepare('SELECT * FROM predictions WHERE id=?').get(id) });
  }
  // 恢复为待校验
  if (body.result === 'PENDING' || body.reset) {
    db.prepare(`UPDATE predictions SET status='PENDING', actual_change=NULL, is_hit=NULL, verified_at=NULL, updated_at=datetime('now') WHERE id=?`)
      .run(id);
    return res.json({ code: 0, data: db.prepare('SELECT * FROM predictions WHERE id=?').get(id) });
  }
  // 兼容：传实际涨跌幅则按规则自动判定
  if (body.actual_change !== undefined && body.actual_change !== null && body.actual_change !== '') {
    const actual = parseFloat(body.actual_change);
    if (isNaN(actual)) return res.status(400).json({ code: 400, msg: '实际涨跌幅无效' });
    const r = manualVerify(id, actual);
    if (!r) return res.status(404).json({ code: 404, msg: '未找到预测' });
    return res.json({ code: 0, data: r });
  }
  return res.status(400).json({ code: 400, msg: '缺少有效的修改参数' });
});

module.exports = router;
module.exports.nextTradingDay = nextTradingDay;
