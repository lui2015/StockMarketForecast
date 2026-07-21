'use strict';

const config = require('./config');

// 标的类型枚举
const MARKETS = {
  A_INDEX: 'A股大盘',
  HK_INDEX: '港股大盘',
  US_INDEX: '美股大盘',
  A_STOCK: 'A股个股',
  HK_STOCK: '港股个股',
};

// 预置大盘指数（symbol 与行情源编码对应）
const PRESET_INDICES = {
  A_INDEX: [
    { symbol: 'sh000001', name: '上证指数' },
    { symbol: 'sz399001', name: '深证成指' },
    { symbol: 'sz399006', name: '创业板指' },
  ],
  HK_INDEX: [
    { symbol: 'r_hkHSI', name: '恒生指数' },
    { symbol: 'r_hkHSTECH', name: '恒生科技指数' },
  ],
  US_INDEX: [
    { symbol: 'usdji', name: '道琼斯' },
    { symbol: 'usixic', name: '纳斯达克' },
    { symbol: 'usinx', name: '标普500' },
  ],
};

// 证券代码结构校验
function normalizeSymbol(market, raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (market === 'A_INDEX' || market === 'HK_INDEX' || market === 'US_INDEX') return s;
  if (market === 'A_STOCK') {
    // 允许 sh600519 / 600519（默认上交所）
    if (/^(sh|sz)\d{6}$/.test(s)) return s;
    if (/^\d{6}$/.test(s)) return 'sh' + s;
    return null;
  }
  if (market === 'HK_STOCK') {
    // 允许 hk00700 / 00700
    if (/^hk\d{5}$/.test(s)) return s;
    if (/^\d{4,5}$/.test(s)) return 'hk' + s.padStart(5, '0');
    return null;
  }
  return null;
}

// 东方财富 secid 映射
function toSecid(symbol) {
  if (symbol.startsWith('sh')) return '1.' + symbol.slice(2);
  if (symbol.startsWith('sz')) return '0.' + symbol.slice(2);
  if (symbol.startsWith('hk')) return '116.' + symbol.slice(2);
  if (symbol.startsWith('r_hk')) return '124.' + symbol.slice(3); // 港股指数
  if (symbol.startsWith('us')) return '100.' + symbol.slice(2); // 美股指数
  if (symbol === 'sh000001' || symbol === 'sz399001' || symbol === 'sz399006') {
    return symbol.startsWith('sh') ? '1.' + symbol.slice(2) : '0.' + symbol.slice(2);
  }
  return null;
}

// 确定性伪随机（mock 模式用），让测试可复现
function mockChangePct(symbol, dateStr) {
  let h = 0;
  const str = symbol + '|' + dateStr;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  const v = (h % 1000) / 1000; // 0..1
  // 映射到 -5% ~ +5%
  return (v * 0.10 - 0.05);
}

async function fetchLive(symbol) {
  const secid = toSecid(symbol);
  if (!secid) return null;
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${encodeURIComponent(secid)}&fields=f43,f57,f58,f60,f169&invt=2&_=${Date.now()}`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    const d = json && json.data;
    if (!d || d.f43 == null || d.f43 === '-') return null;
    const price = parseFloat(d.f43);
    const changePct = d.f169 != null && d.f169 !== '-' ? parseFloat(d.f169) / 100 : null;
    const prevClose = d.f60 != null && d.f60 !== '-' ? parseFloat(d.f60) : null;
    if (changePct == null && prevClose) {
      return { changePct: (price - prevClose) / prevClose, close: price, prevClose };
    }
    return { changePct, close: price, prevClose };
  } catch (e) {
    return null;
  }
}

// 获取某标的在指定交易日的实际涨跌幅；返回 { changePct, close, prevClose } 或 null
async function getQuote(symbol, dateStr) {
  if (config.quoteMode === 'mock') {
    return { changePct: mockChangePct(symbol, dateStr), close: 100, prevClose: 100, mock: true };
  }
  return fetchLive(symbol);
}

// 将前端筛选值展开为具体市场数组：ALL/空 → 不过滤；INDEX → 三大盘；STOCK → 个股；或逗号列表
const INDEX_MARKETS = ['A_INDEX', 'HK_INDEX', 'US_INDEX'];
const STOCK_MARKETS = ['A_STOCK', 'HK_STOCK'];
function expandMarketFilter(m) {
  if (!m || m === 'ALL') return null;
  if (m === 'INDEX') return INDEX_MARKETS;
  if (m === 'STOCK') return STOCK_MARKETS;
  const valid = m.split(',').map((x) => x.trim()).filter((x) => MARKETS[x]);
  return valid.length ? valid : null;
}

module.exports = {
  MARKETS,
  PRESET_INDICES,
  INDEX_MARKETS,
  STOCK_MARKETS,
  normalizeSymbol,
  getQuote,
  toSecid,
  expandMarketFilter,
};
