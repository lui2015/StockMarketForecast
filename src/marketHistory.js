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

// 美股大盘静态种子：真实历史日收盘（来源 FRED NASDAQCOM，2026-07-22 抓取）。
// 本部署环境无法实时拉取美股完整日线（东财被墙 / 腾讯美股仅 1 天 / Yahoo 限流），
// 故以真实历史数据兜底；一旦实时源可用，实时数据优先覆盖。
// 含 2026-06-30 作为 7 月首日的“昨收”基准，使 7-01 也能算涨跌幅。
const US_INDEX_SEED = {
  '2026-07': {
    '2026-06-30': 26213.72,
    '2026-07-01': 26040.03,
    '2026-07-02': 25832.67,
    '2026-07-06': 26121.16,
    '2026-07-07': 25818.69,
    '2026-07-08': 25870.65,
    '2026-07-09': 26206.89,
    '2026-07-10': 26281.61,
    '2026-07-13': 25873.18,
    '2026-07-14': 26107.01,
    '2026-07-15': 26269.23,
    '2026-07-16': 25881.95,
    '2026-07-17': 25520.24,
    '2026-07-20': 25508.07,
    '2026-07-21': 25837.21,
  },
};

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

// 逐日对比前一交易日收盘，得到每日方向与涨跌幅（百分比，保留2位）
function computeDaily(bars) {
  const map = {};
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close;
    const cur = bars[i].close;
    if (!prev) continue;
    const diff = cur - prev;
    const pct = +((diff / prev) * 100).toFixed(2);
    if (diff > 0) map[bars[i].date] = { dir: 'up', pct };
    else if (diff < 0) map[bars[i].date] = { dir: 'down', pct };
  }
  return map;
}

// 东财历史日K线（美股完整日线更可靠），返回 [{ date, close }]
async function fetchEastmoneyKline(secid, year, month) {
  const beg = `${year}${pad2(month)}01`;
  const end = `${year}${pad2(month)}31`;
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}`
    + `&fields1=f1,f2,f3&fields2=f51,f53&klt=101&fqt=0&beg=${beg}&end=${end}`
    + `&ut=fa5fd1943c7b386f172d6893dbfba10b`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://quote.eastmoney.com/' },
    });
    if (!res.ok) return [];
    const json = await res.json();
    if (!json || json.rc !== 0 || !json.data || !Array.isArray(json.data.klines)) return [];
    return json.data.klines
      .map((k) => { const f = k.split(','); return { date: f[0], close: parseFloat(f[2]) }; })
      .filter((b) => b.date && !Number.isNaN(b.close));
  } catch (e) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// 美股历史：实时源（东财优先，回退腾讯）+ 静态种子兜底（实时拿不全时补全）
async function fetchUSHistory(year, month) {
  const key = `${year}-${pad2(month)}`;
  // 1. 实时源
  let bars = [];
  for (const secid of ['107.IXIC', '105.IXIC', '109.IXIC']) {
    const b = await fetchEastmoneyKline(secid, year, month);
    if (b.length >= 2) { bars = b; break; }
  }
  if (bars.length < 2) bars = (await fetchKline('usIXIC', year, month)).filter((x) => x.date);
  // 2. 种子补充缺失交易日
  const seed = US_INDEX_SEED[key];
  if (seed) {
    const liveDates = new Set(bars.map((b) => b.date));
    for (const [d, close] of Object.entries(seed)) {
      if (!liveDates.has(d)) bars.push({ date: d, close });
    }
  }
  bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return bars;
}

async function getMonthHistory(year, month) {
  const key = `${year}-${pad2(month)}`;
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.data;
  const data = {};
  for (const [market, symbol] of Object.entries(MARKET_SYMBOL)) {
    const bars = market === 'US_INDEX'
      ? await fetchUSHistory(year, month)
      : await fetchKline(symbol, year, month);
    data[market] = computeDaily(bars);
  }
  _cache.set(key, { ts: Date.now(), data });
  return data;
}

module.exports = { getMonthHistory, MARKET_SYMBOL };
