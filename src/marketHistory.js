'use strict';

// 腾讯历史日K线接口（公开，无需鉴权），用于获取大盘指数每日收盘，
// 计算“当日实际涨跌”，给首页预测日历的日期方块上色（涨=淡红 / 跌=淡绿）。
const TENCENT_KLINE = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get';

// 市场 -> 腾讯行情代码
const MARKET_SYMBOL = {
  A_INDEX: 'sh000001', // 上证指数
  HK_INDEX: 'hkHSI',   // 恒生指数
  US_INDEX: 'usIXIC',  // 纳斯达克指数
};

const TTL_MS = 30 * 60 * 1000; // 30 分钟缓存，避免重复打外部接口
const _cache = new Map();

function pad2(n) { return String(n).padStart(2, '0'); }

// 取某指数指定年月的日K线，返回 [{ date:'YYYY-MM-DD', close:Number }]
async function fetchKline(symbol, year, month) {
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  // 起点取上月25日，确保本月首日也有“昨收”可比较
  const start = `${prevYear}-${pad2(prevMonth)}-25`;
  const end = `${year}-${pad2(month)}-31`;
  const url = `${TENCENT_KLINE}?param=${symbol},day,${start},${end},120,qfq`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return [];
    const json = await res.json();
    const node = json && json.data && json.data[symbol];
    if (!node) return [];
    const rows = node.day || node.qfqday || [];
    let bars = rows
      .map((r) => ({ date: String(r[0]), close: parseFloat(r[2]) }))
      .filter((b) => b.date && !Number.isNaN(b.close));
    // 历史K线为空时（如美股往往只返回实时行情），用 qt 实时行情推算当日涨跌：
    // qt[3]=当前点位, qt[4]=昨收, qt[23]=日期时间
    if (bars.length === 0) {
      const qt = node.qt && node.qt[symbol];
      if (Array.isArray(qt) && qt[3] && qt[4]) {
        const close = parseFloat(qt[3]);
        const prevClose = parseFloat(qt[4]);
        // 日期字段在不同市场偏移不同，扫描匹配日期格式的字段更稳妥
        const dtRaw = qt.find((x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(x));
        const dt = dtRaw ? dtRaw.split(' ')[0] : '';
        if (!Number.isNaN(close) && !Number.isNaN(prevClose) && /^\d{4}-\d{2}-\d{2}$/.test(dt)) {
          bars = [{ date: '', close: prevClose }, { date: dt, close }];
        }
      }
    }
    return bars;
  } catch (e) {
    console.error('[marketHistory] fetchKline error', symbol, e.message);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// 逐日对比前一交易日收盘，得到每日方向：'up' | 'down'
function computeDirection(bars) {
  const map = {};
  for (let i = 1; i < bars.length; i++) {
    const diff = bars[i].close - bars[i - 1].close;
    if (diff > 0) map[bars[i].date] = 'up';
    else if (diff < 0) map[bars[i].date] = 'down';
  }
  return map;
}

async function getMonthHistory(year, month) {
  const key = `${year}-${pad2(month)}`;
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.data;
  const data = {};
  for (const [market, symbol] of Object.entries(MARKET_SYMBOL)) {
    const bars = await fetchKline(symbol, year, month);
    data[market] = computeDirection(bars);
  }
  _cache.set(key, { ts: Date.now(), data });
  return data;
}

module.exports = { getMonthHistory, MARKET_SYMBOL };
