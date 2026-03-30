import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  AreaChart,
  Area,
  ResponsiveContainer,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Target,
  X,
  Send,
  Bot,
  Shield,
  Crosshair,
  Calculator,
  Minus,
} from 'lucide-react';
import { PaginationControls, APIStatusBanner } from './PaginationComponents';
import { sendMessageToAI, getFallbackResponse } from '../services/aiChatService';

// ─────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────
const TWELVE_DATA_API_KEY = process.env.REACT_APP_TWELVE_DATA_API_KEY;
const UPDATE_INTERVAL = 300000; // 5 minutes
const BATCH_SIZE = 4;
const CACHE_KEY = 'forex_dashboard_data_v9';

// Purge stale cache versions on load so users aren't stuck on old data
['forex_dashboard_data_v7', 'forex_dashboard_data_v8'].forEach(k => {
  try { localStorage.removeItem(k); } catch (_) { }
});

// ─────────────────────────────────────────────
// CURRENCY PAIRS
//
// contractSize:
//   Forex majors / crosses → 100,000 units
//   Gold (XAUUSD)          → 100 troy oz
//   pip value per std lot  = pipValue × contractSize
//   XAUUSD: 0.01 × 100 = $1.00/pip
// ─────────────────────────────────────────────
const CURRENCY_PAIRS = [
  { symbol: 'XAUUSD', base: 'XAU', quote: 'USD', name: 'Gold/USD', type: 'commodity', pipValue: 0.01, pipDigits: 2, contractSize: 100, priority: 1 },
  { symbol: 'EURUSD', base: 'EUR', quote: 'USD', name: 'EUR/USD', type: 'major', pipValue: 0.0001, pipDigits: 5, contractSize: 100000, priority: 1 },
  { symbol: 'GBPUSD', base: 'GBP', quote: 'USD', name: 'GBP/USD', type: 'major', pipValue: 0.0001, pipDigits: 5, contractSize: 100000, priority: 1 },
  { symbol: 'USDJPY', base: 'USD', quote: 'JPY', name: 'USD/JPY', type: 'major', pipValue: 0.01, pipDigits: 3, contractSize: 100000, priority: 1 },
  { symbol: 'USDCAD', base: 'USD', quote: 'CAD', name: 'USD/CAD', type: 'major', pipValue: 0.0001, pipDigits: 5, contractSize: 100000, priority: 2 },
  { symbol: 'USDCHF', base: 'USD', quote: 'CHF', name: 'USD/CHF', type: 'major', pipValue: 0.0001, pipDigits: 5, contractSize: 100000, priority: 2 },
  { symbol: 'AUDUSD', base: 'AUD', quote: 'USD', name: 'AUD/USD', type: 'major', pipValue: 0.0001, pipDigits: 5, contractSize: 100000, priority: 2 },
  { symbol: 'AUDJPY', base: 'AUD', quote: 'JPY', name: 'AUD/JPY', type: 'cross', pipValue: 0.01, pipDigits: 3, contractSize: 100000, priority: 3 },
];

// MAX_SCORE: EMA12/26:3 + EMA50:2 + RSI:5 + MACD:3 + BB:3 = 16
const MAX_SCORE = 16;

// ─────────────────────────────────────────────
// SHARED SPREAD CONSTANT
// FIX #9 – Both FeaturedRecommendation and TradeSettings previously used
//           different multipliers (×3 vs ×2), causing the same pair to display
//           different SL/TP prices in the two panels. One constant fixes this.
// ─────────────────────────────────────────────
const SPREAD_MULTIPLIER = 3;

// ─────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────

// FIX #11 – fallback precision changed from 4 to 2.
//           Gold at ~$2400 would have shown "2400.0000"; now shows "2400.00".
const formatPrice = (price, symbol) => {
  if (price === null || price === undefined || isNaN(price)) return '---';
  const pair = CURRENCY_PAIRS.find(p => p.symbol === symbol);
  return Number(price).toFixed(pair ? pair.pipDigits : 2);
};

// ─────────────────────────────────────────────
// getPipValueUSD
//
// Uses contractSize so Gold = $1.00/pip (not $1,000/pip).
// Receives allData as an explicit parameter — no implicit closure capture.
//
// Formula (per 1 standard lot):
//   pipInQuote = pipValue × contractSize
//   quote === 'USD'  → return pipInQuote
//   base  === 'USD'  → return pipInQuote / rate
//   cross pair       → return pipInQuote / usdQuoteRate
// ─────────────────────────────────────────────
const getPipValueUSD = (symbol, currentRate, allData) => {
  const pair = CURRENCY_PAIRS.find(p => p.symbol === symbol);
  if (!pair || !currentRate || currentRate <= 0) return 10;

  const pipInQuote = pair.pipValue * pair.contractSize;

  if (pair.quote === 'USD') return pipInQuote;
  if (pair.base === 'USD') return pipInQuote / currentRate;

  // Cross pairs
  if (pair.quote === 'JPY') {
    const ref = allData?.find(d => d.pair.symbol === 'USDJPY');
    return pipInQuote / (ref?.currentRate || currentRate);
  }
  if (pair.quote === 'CAD') {
    const ref = allData?.find(d => d.pair.symbol === 'USDCAD');
    return pipInQuote / (ref?.currentRate || currentRate);
  }
  if (pair.quote === 'CHF') {
    const ref = allData?.find(d => d.pair.symbol === 'USDCHF');
    return pipInQuote / (ref?.currentRate || currentRate);
  }
  return pipInQuote / currentRate;
};

// ─────────────────────────────────────────────
// RATE LIMITER
// ─────────────────────────────────────────────
class RateLimiter {
  constructor(maxCallsPerMinute = 8) {
    this.maxCalls = maxCallsPerMinute;
    this.calls = [];
  }
  async waitIfNeeded() {
    const now = Date.now();
    this.calls = this.calls.filter(t => now - t < 60000);
    if (this.calls.length >= this.maxCalls) {
      const waitTime = 60000 - (now - this.calls[0]) + 300;
      if (waitTime > 0) {
        await new Promise(r => setTimeout(r, waitTime));
        return this.waitIfNeeded();
      }
    }
    this.calls.push(now);
  }
}
const rateLimiter = new RateLimiter(8);

// ─────────────────────────────────────────────
// DATA FETCHING
// ─────────────────────────────────────────────

// FIX #5 – XAU is fetched from Binance BEFORE waitIfNeeded() so it does not
//           consume a TwelveData rate-limiter slot. Previously, all pairs
//           (including XAU → Binance) burned a slot, leaving only 7/8 slots
//           for TwelveData forex pairs.
const fetchTwelveDataPrice = async (pair) => {
  try {
    if (pair.base === 'XAU') {
      try {
        const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=PAXGUSDT');
        const d = await res.json();
        if (d?.price) return parseFloat(d.price);
      } catch (_) { }
      return null;
    }
    await rateLimiter.waitIfNeeded();
    const sym = `${pair.base}/${pair.quote}`;
    const res = await fetch(`https://api.twelvedata.com/price?symbol=${sym}&apikey=${TWELVE_DATA_API_KEY}`);
    const d = await res.json();
    if (d?.price) return parseFloat(d.price);
    if (d?.status === 'error') { console.warn(`TwelveData: ${sym}:`, d.message); return null; }
    return null;
  } catch (err) {
    console.error(`fetchTwelveDataPrice ${pair.symbol}:`, err);
    return null;
  }
};

const fetchFallbackData = async (pair) => {
  try {
    if (pair.base === 'XAU') {
      try {
        const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=PAXGUSDT');
        const d = await res.json();
        if (d?.price) return parseFloat(d.price);
      } catch (_) { }
      return null;
    }
    const apis = [
      async () => {
        const res = await fetch(`https://api.frankfurter.app/latest?from=${pair.base}&to=${pair.quote}`);
        return (await res.json()).rates?.[pair.quote];
      },
      async () => {
        const res = await fetch(`https://open.er-api.com/v6/latest/${pair.base}`);
        return (await res.json()).rates?.[pair.quote];
      },
    ];
    for (const fn of apis) {
      try {
        const rate = await fn();
        if (rate && !isNaN(rate)) return parseFloat(rate);
      } catch (_) { continue; }
    }
    return null;
  } catch (_) { return null; }
};

const fetchRealForexData = async (pair) => {
  const rate = await fetchTwelveDataPrice(pair);
  return rate !== null ? rate : fetchFallbackData(pair);
};

const fetchAllForexData = async () => {
  const results = [];
  for (let i = 0; i < CURRENCY_PAIRS.length; i += BATCH_SIZE) {
    const batch = CURRENCY_PAIRS.slice(i, i + BATCH_SIZE);
    const res = await Promise.all(batch.map(async pair => ({ pair, rate: await fetchRealForexData(pair) })));
    results.push(...res);
    if (i + BATCH_SIZE < CURRENCY_PAIRS.length) await new Promise(r => setTimeout(r, 500));
  }
  return results;
};

// ─────────────────────────────────────────────────────────────────────────────
// FOREX PREDICTOR
// ─────────────────────────────────────────────────────────────────────────────
class ForexPredictor {
  constructor() { this.historicalData = {}; }

  setHistory(symbol, history) {
    this.historicalData[symbol] = Array.isArray(history) ? history : [];
  }

  // ── Synthetic history ──────────────────────────────────────────────────────
  // FIX #6 – The previous implementation used unshift() inside the loop, which
  //           produced a chronologically-reversed array (newest at index 0).
  //           All indicator calculations (EMA, RSI, MACD) expect oldest-first
  //           ordering. The fix builds bars in a temporary array and reverses
  //           once at the end, guaranteeing index 0 = oldest bar.
  generateSyntheticHistory(symbol, currentPrice, needed) {
    const isGold = symbol.includes('XAU');
    const isJPY = symbol.includes('JPY');
    const baseVol = isGold ? 0.006 : isJPY ? 0.003 : 0.0025;

    const symHash = symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const daySeed = Math.floor(Date.now() / 86400000);
    const getStr = cur =>
      Math.sin((daySeed * 0.1 + cur.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) * 0.7) * 0.0015;

    const base = symbol.substring(0, 3);
    const quote = symbol.substring(3, 6) || 'USD';
    let bias = getStr(base) - getStr(quote);
    if (Math.abs(bias) < 0.0003) bias = (symHash % 2 === 0 ? 1 : -1) * 0.0005;

    // Walk backwards from currentPrice, collecting bars newest-first, then reverse.
    const bars = [];
    let price = currentPrice;

    for (let i = 0; i < needed; i++) {
      const trend = price * bias;
      const noise = price * baseVol * (Math.random() * 2 - 1);
      const cycle = price * baseVol * 0.4 *
        Math.sin(i * (0.08 + (symHash % 15) * 0.01) + (symHash % 10) * 0.3);
      const spike = (i % (7 + symHash % 11) === 0)
        ? price * baseVol * (Math.random() > 0.5 ? 1.5 : -1.5)
        : 0;

      const raw = price - (trend + noise + cycle + spike);
      // Clamp ±2% per bar in both directions
      price = Math.min(price * 1.02, Math.max(price * 0.98, raw));
      if (price <= 0) price = currentPrice * 0.5;

      // i=0 is 1 bar before currentPrice; i=needed-1 is the oldest bar
      bars.push({ price, timestamp: Date.now() - ((i + 1) * 60000) });
    }

    // Reverse: index 0 = oldest, index needed-1 = most-recent synthetic bar
    return bars.reverse();
  }

  ensureDataSufficiency(symbol, currentPrice) {
    if (!this.historicalData[symbol]) this.historicalData[symbol] = [];
    const MIN = 120; // well above MACD warm-up (35) and all other indicators
    const count = this.historicalData[symbol].length;
    if (count < MIN) {
      const synth = this.generateSyntheticHistory(symbol, currentPrice, MIN - count);
      // Prepend synthetic (older) bars before any real bars already present
      this.historicalData[symbol] = [...synth, ...this.historicalData[symbol]];
    }
  }

  addDataPoint(symbol, price) {
    if (!price || isNaN(price) || price <= 0) return;
    this.ensureDataSufficiency(symbol, price);
    this.historicalData[symbol].push({ price, timestamp: Date.now() });
    if (this.historicalData[symbol].length > 200) this.historicalData[symbol].shift();
  }

  // ── RSI (Wilder's SMMA, period 14) ────────────────────────────────────────
  calculateRSI(prices, period = 14) {
    if (!prices || prices.length < period + 1) return 50;
    const slice = prices.slice(-(period * 3 + 1));
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
      const d = slice[i] - slice[i - 1];
      if (d > 0) avgGain += d; else avgLoss += Math.abs(d);
    }
    avgGain /= period;
    avgLoss /= period;
    for (let i = period + 1; i < slice.length; i++) {
      const d = slice[i] - slice[i - 1];
      avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
      avgLoss = (avgLoss * (period - 1) + (d < 0 ? Math.abs(d) : 0)) / period;
    }
    if (avgGain === 0 && avgLoss === 0) return 50;
    if (avgLoss === 0) return 100;
    if (avgGain === 0) return 0;
    return 100 - 100 / (1 + avgGain / avgLoss);
  }

  // ── EMA – single final value ───────────────────────────────────────────────
  calculateEMA(prices, period) {
    if (!prices || prices.length === 0) return 0;
    if (prices.length < period) return prices.reduce((a, b) => a + b, 0) / prices.length;
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
    return ema;
  }

  // ── EMA – full array (nulls where insufficient data) ──────────────────────
  calculateEMASeries(prices, period) {
    const res = new Array(prices.length).fill(null);
    if (prices.length < period) return res;
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    res[period - 1] = ema;
    for (let i = period; i < prices.length; i++) {
      ema = prices[i] * k + ema * (1 - k);
      res[i] = ema;
    }
    return res;
  }

  // ── MACD (12, 26, 9) ──────────────────────────────────────────────────────
  // Minimum warm-up: 26 bars for EMA-26, then 9 MACD values for the signal
  // EMA → 35 bars total. ensureDataSufficiency guarantees MIN=120, so the
  // guard below is purely a safety net for edge cases.
  calculateMACD(prices) {
    const empty = { macd: 0, signal: 0, histogram: 0 };
    if (!prices || prices.length < 35) return empty;
    const e12 = this.calculateEMASeries(prices, 12);
    const e26 = this.calculateEMASeries(prices, 26);
    const macdSeries = [];
    for (let i = 0; i < prices.length; i++) {
      if (e12[i] !== null && e26[i] !== null) macdSeries.push(e12[i] - e26[i]);
    }
    if (macdSeries.length < 9) return empty;
    const sig = this.calculateEMA(macdSeries, 9);
    const line = macdSeries[macdSeries.length - 1];
    return { macd: line, signal: sig, histogram: line - sig };
  }

  // ── Bollinger Bands (20, 2σ) – population std dev (÷N) ───────────────────
  calculateBollinger(prices, period = 20) {
    const empty = { percentB: 0.5, bandwidth: 0, upper: 0, lower: 0, middle: 0 };
    if (!prices || prices.length < period) return empty;
    const slice = prices.slice(-period);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const stdDev = Math.sqrt(slice.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / period);
    const upper = mean + stdDev * 2;
    const lower = mean - stdDev * 2;
    const cur = prices[prices.length - 1];
    const pctB = upper !== lower ? (cur - lower) / (upper - lower) : 0.5;
    return {
      percentB: Math.max(0, Math.min(1, pctB)),
      bandwidth: mean > 0 ? (upper - lower) / mean : 0,
      upper, lower, middle: mean,
    };
  }

  // ── ATR – Wilder's 14-period (close-to-close TR) ──────────────────────────
  calculateATR(prices, period = 14) {
    if (!prices || prices.length < 2) return 0;
    const trs = [];
    for (let i = 1; i < prices.length; i++) trs.push(Math.abs(prices[i] - prices[i - 1]));
    if (trs.length === 0) return 0;
    if (trs.length < period) return trs.reduce((a, b) => a + b, 0) / trs.length;
    let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) atr = (atr * (period - 1) + trs[i]) / period;
    return atr;
  }

  // ── Main prediction ────────────────────────────────────────────────────────
  predictNextPrice(symbol, pair) {
    const hist = this.historicalData[symbol];
    if (!hist || hist.length === 0) return null;
    const prices = hist.map(d => d.price).filter(p => !isNaN(p) && p > 0);
    if (prices.length === 0) return null;
    const cur = prices[prices.length - 1];

    const rsi = this.calculateRSI(prices, 14);
    const macd = this.calculateMACD(prices);
    const bb = this.calculateBollinger(prices, 20);
    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    const ema50 = this.calculateEMA(prices, 50);
    const rawATR = this.calculateATR(prices, 14);
    const finalATR = Math.max(cur * 0.0001, Math.min(rawATR, cur * 0.02));

    // ── Scoring (–16 to +16) ──────────────────────────────────────────────
    let score = 0;

    // 1. EMA 12/26 cross (±3)
    score += ema12 > ema26 ? 3 : -3;

    // 2. Price vs EMA50 – medium-term trend (±2, only when history is sufficient)
    if (prices.length >= 50) score += cur > ema50 ? 2 : -2;

    // 3. RSI momentum (0 to ±5)
    if (rsi < 20) score += 5;
    else if (rsi < 30) score += 3;
    else if (rsi < 40) score += 1;
    else if (rsi > 80) score -= 5;
    else if (rsi > 70) score -= 3;
    else if (rsi > 60) score -= 1;

    // 4. MACD line + histogram (0 to ±3)
    if (macd.histogram > 0 && macd.macd > 0) score += 3;
    else if (macd.histogram > 0 && macd.macd <= 0) score += 1;
    else if (macd.histogram < 0 && macd.macd < 0) score -= 3;
    else if (macd.histogram < 0 && macd.macd >= 0) score -= 1;

    // 5. Bollinger %B mean-reversion (0 to ±3)
    if (bb.percentB < 0.05) score += 3;
    else if (bb.percentB < 0.20) score += 2;
    else if (bb.percentB < 0.35) score += 1;
    else if (bb.percentB > 0.95) score -= 3;
    else if (bb.percentB > 0.80) score -= 2;
    else if (bb.percentB > 0.65) score -= 1;

    // ── Contradiction guards ───────────────────────────────────────────────
    const isStrongFloor = rsi < 30 || bb.percentB < 0.15;
    const isStrongCeiling = rsi > 70 || bb.percentB > 0.85;

    let finalTrend;
    if (score >= 4 && !isStrongCeiling) finalTrend = 'bullish';
    else if (score <= -4 && !isStrongFloor) finalTrend = 'bearish';
    else finalTrend = 'neutral';
    if (isStrongCeiling && finalTrend === 'bullish') finalTrend = 'neutral';
    if (isStrongFloor && finalTrend === 'bearish') finalTrend = 'neutral';

    // ── Confidence ────────────────────────────────────────────────────────
    // Directional: 55–99%
    // FIX #7 – Neutral hard-capped at 49 (not 50) so floating-point rounding
    //           can never push a neutral reading past the directional gate of 50.
    let confidence;
    if (finalTrend === 'neutral') {
      confidence = Math.max(30, Math.min(49, 50 - (Math.abs(score) / MAX_SCORE) * 10));
    } else {
      confidence = Math.min(99, 55 + (Math.abs(score) / MAX_SCORE) * 44);
    }

    // ── Predicted price (1-bar ATR-based drift) ────────────────────────────
    let drift = 0;
    if (finalTrend === 'bullish') drift = finalATR * 1.5;
    else if (finalTrend === 'bearish') drift = -finalATR * 1.5;
    else {
      const mom = macd.histogram !== 0 ? macd.histogram : ema12 - ema26;
      drift = finalATR * 0.3 * (mom >= 0 ? 1 : -1);
    }
    // FIX #11 – toFixed fallback uses pair.pipDigits (never falls back to 5/4)
    const predictedPrice = parseFloat((cur + drift).toFixed(pair.pipDigits || 2));

    // FIX #14 – production console.log removed; uncomment locally for debugging
    // console.log(`[QuantAI] ${symbol} | Score:${score}/${MAX_SCORE} | Trend:${finalTrend} | Conf:${confidence.toFixed(0)}%`);

    return {
      predictedPrice, confidence, trend: finalTrend,
      rsi, macd, bollinger: bb, atr: finalATR,
      ema12, ema26, ema50, score,
      levels: { support: bb.lower, resistance: bb.upper },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT: FEATURED RECOMMENDATION
// ─────────────────────────────────────────────────────────────────────────────
const FeaturedRecommendation = ({ data, riskReward }) => {
  if (!data || !data.prediction) return null;
  const { pair, currentRate, prediction } = data;

  // Neutral confidence is hard-capped at 49, so this gate always holds.
  // Both checks kept for defensive clarity.
  if (prediction.trend === 'neutral' || prediction.confidence <= 50) {
    return (
      <div className="bg-white rounded-3xl p-8 shadow-lg mb-8 border border-slate-200 text-center">
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Market Analysis in Progress</h2>
        <p className="text-slate-500">Waiting for clear volatility setup. Current signals are mixed.</p>
      </div>
    );
  }

  const isBullish = prediction.trend === 'bullish';
  const atr = prediction.atr || currentRate * 0.002;
  const spreadBuffer = pair.pipValue * SPREAD_MULTIPLIER;
  const minSL = pair.pipValue * 20;
  const slDist = Math.max(minSL, atr * 2);
  const tpDist = slDist * riskReward;

  // FIX #2 – SELL TP previously added spreadBuffer (entry - tpDist + spread),
  //           which inflated the profit target. Both directions now subtract
  //           spread from the favourable side, correctly reducing net profit.
  const entry = currentRate;
  const stopLoss = isBullish
    ? entry - slDist - spreadBuffer
    : entry + slDist + spreadBuffer;
  const takeProfit = isBullish
    ? entry + tpDist - spreadBuffer
    : entry - tpDist - spreadBuffer;

  // Map raw score (–16..+16) → 0.0–10.0 display scale
  const scoreOutOf10 = ((prediction.score + MAX_SCORE) / (2 * MAX_SCORE) * 10).toFixed(1);

  return (
    <div className="relative overflow-hidden bg-white rounded-3xl p-1 shadow-lg mb-8 border border-slate-200">
      <div className="absolute top-0 right-0 p-32 bg-indigo-50/50 rounded-full blur-3xl -mr-16 -mt-16" />
      <div className="absolute bottom-0 left-0 p-32 bg-emerald-50/50 rounded-full blur-3xl -ml-16 -mb-16" />

      <div className="relative bg-white/50 backdrop-blur-sm rounded-[20px] p-6 md:p-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-3 py-1 rounded-full border border-emerald-200 animate-pulse">
                PRIME SETUP
              </span>
              <span className="text-slate-500 text-xs uppercase tracking-wider font-semibold">
                AI Confidence: {prediction.confidence.toFixed(0)}%
              </span>
              <span className="text-slate-400 text-xs font-medium">· RR 1:{riskReward}</span>
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 flex items-center gap-3">
              {pair.name}
              <span className="text-slate-400 text-xl font-normal">/ {pair.symbol}</span>
            </h2>
          </div>
          <div className="text-right hidden md:block">
            <div className="text-sm text-slate-500 font-medium">Current Price</div>
            <div className="text-3xl font-mono font-bold text-slate-800 tracking-tight">
              {formatPrice(currentRate, pair.symbol)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className={`col-span-1 rounded-2xl p-6 flex flex-col items-center justify-center border-2 ${isBullish ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
            <span className={`text-sm font-bold uppercase tracking-widest mb-2 ${isBullish ? 'text-emerald-700' : 'text-rose-700'}`}>
              Recommendation
            </span>
            <div className={`text-4xl font-black ${isBullish ? 'text-emerald-600' : 'text-rose-600'}`}>
              {isBullish ? 'BUY' : 'SELL'}
            </div>
            <div className="mt-2 text-slate-600 text-sm text-center font-medium">
              Score: {scoreOutOf10}/10
            </div>
          </div>

          <div className="col-span-1 md:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex flex-col justify-between hover:bg-white hover:shadow-md transition-all">
              <div className="flex items-center gap-2 text-rose-500 mb-2">
                <Shield className="w-4 h-4" />
                <span className="text-sm font-bold">Stop Loss</span>
              </div>
              <div className="text-2xl font-mono text-slate-800 font-semibold">{formatPrice(stopLoss, pair.symbol)}</div>
              <div className="text-xs text-slate-500 mt-1">Incl. spread buffer</div>
            </div>

            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex flex-col justify-between hover:bg-white hover:shadow-md transition-all">
              <div className="flex items-center gap-2 text-blue-500 mb-2">
                <Crosshair className="w-4 h-4" />
                <span className="text-sm font-bold">Entry Zone</span>
              </div>
              <div className="text-2xl font-mono text-slate-800 font-semibold">{formatPrice(entry, pair.symbol)}</div>
              <div className="text-xs text-slate-500 mt-1">Market Execution</div>
            </div>

            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex flex-col justify-between hover:bg-white hover:shadow-md transition-all relative overflow-hidden">
              <div className="absolute right-0 top-0 p-8 bg-emerald-100/30 rounded-full -mr-4 -mt-4" />
              <div className="flex items-center gap-2 text-emerald-600 mb-2">
                <Target className="w-4 h-4" />
                <span className="text-sm font-bold">Take Profit</span>
              </div>
              <div className="text-2xl font-mono text-slate-800 font-semibold">{formatPrice(takeProfit, pair.symbol)}</div>
              <div className="text-xs text-slate-500 mt-1">Target 1:{riskReward} RR</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT: TRADE SETTINGS & CALCULATOR
// ─────────────────────────────────────────────────────────────────────────────
const TradeSettings = ({ currencyData, sharedRiskReward, onRiskRewardChange }) => {
  const [riskPercent, setRiskPercent] = useState(() => Number(localStorage.getItem('quantai_risk_percent')) || 2);
  const [accountBalance, setAccountBalance] = useState(() => Number(localStorage.getItem('quantai_balance')) || 10000);
  const [selectedPair, setSelectedPair] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [useManualLot, setUseManualLot] = useState(false);
  const [manualLot, setManualLot] = useState(0.01);

  useEffect(() => {
    localStorage.setItem('quantai_risk_percent', riskPercent);
    localStorage.setItem('quantai_balance', accountBalance);
  }, [riskPercent, accountBalance]);

  // FIX #10 – Auto-select only considers directional pairs, so the calculator
  //            always opens on an actionable signal rather than the highest-
  //            confidence neutral pair. Falls back to any pair when none are
  //            directional (e.g. on first load before predictions run).
  useEffect(() => {
    if (!selectedPair && currencyData.length > 0) {
      const directional = currencyData.filter(d => d.prediction?.trend !== 'neutral');
      const pool = directional.length > 0 ? directional : currencyData;
      const best = pool.reduce(
        (p, c) => (c.prediction?.confidence > (p?.prediction?.confidence || 0)) ? c : p, {}
      );
      if (best.pair) setSelectedPair(best.pair.symbol);
    }
  }, [currencyData, selectedPair]);

  const generateTradeSignal = () => {
    const item = currencyData.find(d => d.pair.symbol === selectedPair);
    if (!item?.prediction || !item.currentRate) return null;
    const { prediction, currentRate, pair } = item;

    // Signal derived directly from prediction.trend — single source of truth
    const signal = prediction.trend === 'bullish' ? 'BUY'
      : prediction.trend === 'bearish' ? 'SELL'
        : 'HOLD';

    const atr = prediction.atr || currentRate * 0.002;
    const spreadBuffer = pair.pipValue * SPREAD_MULTIPLIER;
    const minSL = pair.pipValue * 20;
    const slDist = Math.max(minSL, atr * 2);
    const tpDist = slDist * sharedRiskReward;

    // Only BUY / SELL get levels; HOLD returns null.
    // FIX #2 – SELL TP subtracts spread (matching FeaturedRecommendation).
    const sl = signal === 'BUY' ? currentRate - slDist - spreadBuffer
      : signal === 'SELL' ? currentRate + slDist + spreadBuffer
        : null;
    const tp = signal === 'BUY' ? currentRate + tpDist - spreadBuffer
      : signal === 'SELL' ? currentRate - tpDist - spreadBuffer
        : null;

    // ── Position sizing ────────────────────────────────────────────────────
    const riskAmount = accountBalance * (riskPercent / 100);
    const pipValueUSD = getPipValueUSD(pair.symbol, currentRate, currencyData);
    const pipsAtRisk = slDist / pair.pipValue;
    const lotSizeRaw = pipValueUSD > 0 && pipsAtRisk > 0
      ? riskAmount / (pipsAtRisk * pipValueUSD)
      : 0.01;
    const lotSize = useManualLot
      ? manualLot
      : Math.min(50, Math.max(0.01, parseFloat(lotSizeRaw.toFixed(2))));

    // Risk / reward only meaningful for directional signals
    const actualRisk = signal !== 'HOLD' ? lotSize * pipsAtRisk * pipValueUSD : 0;
    const pipsReward = tpDist / pair.pipValue;
    const actualProfit = signal !== 'HOLD' ? lotSize * pipsReward * pipValueUSD : 0;

    // Directional score split for display
    const bullishDisplay = Math.round((prediction.score + MAX_SCORE) / 2);
    const bearishDisplay = MAX_SCORE - bullishDisplay;

    // FIX #4 – Math.round replaces Math.ceil so score=0 renders 0 strength bars
    //           (Math.ceil(0.3125) = 1, overstating very weak signals).
    const strength = Math.min(5, Math.round((Math.abs(prediction.score) / MAX_SCORE) * 5));

    // Adaptive decimal places per instrument
    const macdDecimals = pair.pipDigits >= 5 ? 5 : pair.pipDigits + 2;

    // FIX #3 – tpPips gated on signal: HOLD never shows a phantom non-zero pip count
    return {
      pair: pair.symbol,
      signal,
      entry: currentRate,
      sl,
      tp,
      lotSize,
      riskAmount: actualRisk,
      potentialProfit: actualProfit,
      confidence: prediction.confidence,
      prediction,
      bullishDisplay,
      bearishDisplay,
      strength,
      slPips: pipsAtRisk.toFixed(1),
      tpPips: signal !== 'HOLD' ? pipsReward.toFixed(1) : '---',
      pipValueUSD: pipValueUSD.toFixed(4),
      macdDecimals,
    };
  };

  const trade = generateTradeSignal();

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-lg mb-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <Calculator className="w-5 h-5 text-indigo-600" />
          Trade Calculator & Execution
        </h2>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-sm text-slate-500 hover:text-indigo-600 flex items-center gap-1 font-medium transition-colors"
        >
          {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          Advanced
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* ── INPUTS ── */}
        <div className="space-y-4">
          <div>
            <label className="text-xs text-slate-500 uppercase font-bold">Currency Pair</label>
            <select
              value={selectedPair}
              onChange={e => setSelectedPair(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-lg p-3 mt-1 focus:ring-2 focus:ring-indigo-500 outline-none transition-shadow font-medium"
            >
              {currencyData.map(d => (
                <option key={d.pair.symbol} value={d.pair.symbol}>
                  {d.pair.symbol} – {d.pair.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-500 uppercase font-bold">Balance ($)</label>
              <input
                type="number" min="1" value={accountBalance}
                onChange={e => setAccountBalance(Math.max(1, Number(e.target.value)))}
                className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-lg p-3 mt-1 outline-none focus:border-indigo-500 font-medium"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 uppercase font-bold">Risk (%)</label>
              <input
                type="number" min="0.1" max="100" step="0.5" value={riskPercent}
                onChange={e => setRiskPercent(Math.min(100, Math.max(0.1, Number(e.target.value))))}
                className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-lg p-3 mt-1 outline-none focus:border-indigo-500 font-medium"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox" checked={useManualLot}
              onChange={e => setUseManualLot(e.target.checked)}
              className="rounded bg-slate-100 border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <label className="text-sm text-slate-600 font-medium">Manual Lot Size</label>
            {useManualLot && (
              <input
                type="number" min="0.01" step="0.01" value={manualLot}
                onChange={e => setManualLot(Math.max(0.01, Number(e.target.value)))}
                className="ml-auto w-24 bg-slate-50 border border-slate-200 text-slate-800 rounded p-1 text-sm text-right font-medium"
              />
            )}
          </div>

          <div className="pt-2">
            <label className="text-xs text-slate-500 uppercase font-bold">Risk:Reward Ratio</label>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="range" min="1" max="5" step="0.5" value={sharedRiskReward}
                onChange={e => onRiskRewardChange(Number(e.target.value))}
                className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
              <span className="text-sm font-mono font-bold text-slate-700 w-12 text-right">
                1:{sharedRiskReward}
              </span>
            </div>
          </div>
        </div>

        {/* ── SIGNAL DASHBOARD ── */}
        {trade && (
          <div className="lg:col-span-2 bg-slate-50 border border-slate-200 rounded-xl p-5 shadow-sm">
            <div className="flex justify-between items-start mb-4 pb-4 border-b border-slate-200">
              <div>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Trade Signal</div>
                <div className={`text-3xl font-black ${trade.signal === 'BUY' ? 'text-emerald-600' : trade.signal === 'SELL' ? 'text-rose-600' : 'text-slate-400'}`}>
                  {trade.signal}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Confidence</div>
                <div className="text-2xl font-bold text-slate-800 flex items-center justify-end gap-2">
                  {trade.confidence.toFixed(0)}%
                  <span className={`text-xs px-2 py-0.5 rounded-full ${trade.signal === 'BUY' ? 'bg-emerald-100 text-emerald-700' : trade.signal === 'SELL' ? 'bg-rose-100 text-rose-700' : 'bg-slate-200 text-slate-600'}`}>
                    {trade.signal}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="bg-white p-3 rounded-lg border border-slate-100">
                <span className="text-[10px] uppercase text-slate-400 font-bold">Bull Score</span>
                <div className="text-xl font-bold text-emerald-600">{trade.bullishDisplay}/{MAX_SCORE}</div>
              </div>
              <div className="bg-white p-3 rounded-lg border border-slate-100">
                <span className="text-[10px] uppercase text-slate-400 font-bold">Bear Score</span>
                <div className="text-xl font-bold text-rose-600">{trade.bearishDisplay}/{MAX_SCORE}</div>
              </div>
              <div className="bg-white p-3 rounded-lg border border-slate-100">
                <span className="text-[10px] uppercase text-slate-400 font-bold">Strength</span>
                <div className="flex items-center gap-1 mt-1">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className={`h-2 w-full rounded-full ${i < trade.strength ? 'bg-indigo-500' : 'bg-slate-200'}`} />
                  ))}
                </div>
              </div>
              <div className="bg-white p-3 rounded-lg border border-slate-100">
                <span className="text-[10px] uppercase text-slate-400 font-bold">Pip Value</span>
                <div className="text-sm font-mono font-medium text-slate-700 mt-0.5">${trade.pipValueUSD}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-4 gap-x-6 text-sm font-mono border-t border-slate-200 pt-4">
              <div>
                <div className="text-slate-400 text-xs mb-1">Entry Price</div>
                <div className="font-bold text-slate-800">{formatPrice(trade.entry, trade.pair)}</div>
              </div>
              <div>
                <div className="text-slate-400 text-xs mb-1">Target (TP)</div>
                <div className="font-bold text-indigo-600">
                  {trade.signal !== 'HOLD' ? formatPrice(trade.tp, trade.pair) : '---'}
                </div>
              </div>
              <div>
                <div className="text-slate-400 text-xs mb-1">Lot Size</div>
                <div className="font-bold text-slate-800">
                  {trade.lotSize}
                  <span className="text-[10px] text-slate-400 font-sans font-normal ml-1">
                    ({trade.lotSize >= 1 ? 'Std' : trade.lotSize >= 0.1 ? 'Mini' : 'Micro'})
                  </span>
                </div>
              </div>

              <div className="col-span-2 sm:col-span-3 grid grid-cols-2 gap-4 mt-2">
                <div className="bg-rose-50 p-2 rounded border border-rose-100">
                  <div className="text-[10px] text-rose-400 font-bold uppercase mb-1">Stop Loss</div>
                  <div className="flex justify-between items-baseline">
                    <span className="font-bold text-rose-700">
                      {trade.signal !== 'HOLD' ? formatPrice(trade.sl, trade.pair) : '---'}
                    </span>
                    {trade.signal !== 'HOLD' && (
                      <span className="text-xs text-rose-500">-{trade.slPips} pips</span>
                    )}
                  </div>
                  <div className="text-[10px] text-rose-400 mt-1">
                    Risk: {trade.signal !== 'HOLD' ? `$${trade.riskAmount.toFixed(2)}` : 'N/A (HOLD)'}
                  </div>
                </div>
                <div className="bg-emerald-50 p-2 rounded border border-emerald-100">
                  <div className="text-[10px] text-emerald-500 font-bold uppercase mb-1">Take Profit</div>
                  <div className="flex justify-between items-baseline">
                    <span className="font-bold text-emerald-700">
                      {trade.signal !== 'HOLD' ? formatPrice(trade.tp, trade.pair) : '---'}
                    </span>
                    {trade.signal !== 'HOLD' && (
                      <span className="text-xs text-emerald-600">+{trade.tpPips} pips</span>
                    )}
                  </div>
                  <div className="text-[10px] text-emerald-500 mt-1">
                    Profit: {trade.signal !== 'HOLD' ? `$${trade.potentialProfit.toFixed(2)}` : 'N/A (HOLD)'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── ADVANCED STATS ── */}
      {showAdvanced && trade?.prediction && (
        <div className="mt-6 pt-6 border-t border-slate-100 grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
            <div className="text-xs text-slate-500 uppercase font-semibold">RSI (14)</div>
            <div className={`font-mono font-bold text-lg ${trade.prediction.rsi > 70 ? 'text-rose-500' : trade.prediction.rsi < 30 ? 'text-emerald-600' : 'text-slate-700'}`}>
              {trade.prediction.rsi.toFixed(1)}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {trade.prediction.rsi > 70 ? 'Overbought' : trade.prediction.rsi < 30 ? 'Oversold' : 'Neutral'}
            </div>
          </div>
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
            <div className="text-xs text-slate-500 uppercase font-semibold">MACD Hist.</div>
            <div className={`font-mono font-bold text-lg ${trade.prediction.macd.histogram > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
              {trade.prediction.macd.histogram.toFixed(trade.macdDecimals)}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {trade.prediction.macd.histogram > 0 ? 'Bullish' : 'Bearish'}
            </div>
          </div>
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
            <div className="text-xs text-slate-500 uppercase font-semibold">Bollinger %B</div>
            <div className={`font-mono font-bold text-lg ${trade.prediction.bollinger.percentB > 0.8 ? 'text-rose-500' : trade.prediction.bollinger.percentB < 0.2 ? 'text-emerald-600' : 'text-blue-600'}`}>
              {(trade.prediction.bollinger.percentB * 100).toFixed(1)}%
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {trade.prediction.bollinger.percentB > 0.8 ? 'Near Upper Band' : trade.prediction.bollinger.percentB < 0.2 ? 'Near Lower Band' : 'Mid-Band'}
            </div>
          </div>
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
            <div className="text-xs text-slate-500 uppercase font-semibold">EMA Cross</div>
            <div className={`font-mono font-bold text-lg ${trade.prediction.ema12 > trade.prediction.ema26 ? 'text-emerald-600' : 'text-rose-500'}`}>
              {trade.prediction.ema12 > trade.prediction.ema26 ? 'GOLDEN' : 'DEATH'}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">EMA 12 / 26</div>
          </div>
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
            <div className="text-xs text-slate-500 uppercase font-semibold">ATR (14)</div>
            <div className="font-mono font-bold text-lg text-indigo-600">
              {trade.prediction.atr.toFixed(trade.macdDecimals)}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">Volatility</div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
const ForexDashboard = () => {
  const [data, setData] = useState([]);
  const [predictor] = useState(new ForexPredictor());
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dataSource, setDataSource] = useState('Loading...');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(6);

  // Single source of truth for RR — both FeaturedCard and Calculator read this
  const [sharedRiskReward, setSharedRiskReward] = useState(
    () => Number(localStorage.getItem('quantai_risk_reward')) || 2
  );
  const handleRiskRewardChange = useCallback((val) => {
    setSharedRiskReward(val);
    localStorage.setItem('quantai_risk_reward', val);
  }, []);

  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState([{
    role: 'assistant',
    content: 'QuantAI Analyst online. Market volatility detected. How can I assist?',
  }]);
  const [input, setInput] = useState('');
  const msgEndRef = useRef(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  // ── Build pipeline ───────────────────────────────────────────────────────
  const buildFormatted = useCallback((res, existingData) => {
    return res.map(r => {
      let rate = r.rate;
      if (!rate || isNaN(rate)) {
        rate = existingData.find(d => d.pair.symbol === r.pair.symbol)?.currentRate ?? null;
      }
      if (!rate || isNaN(rate) || rate <= 0) return null;
      predictor.addDataPoint(r.pair.symbol, rate);
      const prediction = predictor.predictNextPrice(r.pair.symbol, r.pair);
      return {
        pair: r.pair,
        currentRate: rate,
        // FIX #12 – persist full 200-bar memory, not the previous 120-bar truncation
        history: predictor.historicalData[r.pair.symbol].slice(-200),
        prediction,
      };
    }).filter(Boolean);
  }, [predictor]);

  const persistCache = useCallback((formatted) => {
    const ts = Date.now();
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: ts, data: formatted })); } catch (_) { }
    return ts;
  }, []);

  // ── Init ─────────────────────────────────────────────────────────────────
  const initData = useCallback(async () => {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        const { timestamp, data: parsed } = JSON.parse(cached);
        parsed.forEach(item => {
          if (item.history?.length > 0) predictor.setHistory(item.pair.symbol, item.history);
        });
        const withPred = parsed.map(item => ({
          ...item,
          prediction: predictor.predictNextPrice(item.pair.symbol, item.pair),
        }));
        setData(withPred);
        setLastUpdated(timestamp);
        setLoading(false);
        if (Date.now() - timestamp < UPDATE_INTERVAL) {
          setDataSource('Twelve Data API (Cached)');
          return;
        }
        setDataSource('Cached (Refreshing...)');
      } catch (e) { console.error('[QuantAI] Cache error:', e); }
    }

    try {
      setDataSource('Fetching live data...');
      const res = await fetchAllForexData();
      const formatted = buildFormatted(res, dataRef.current);
      if (formatted.length > 0) {
        const ts = persistCache(formatted);
        setData(formatted);
        setLastUpdated(ts);
        setDataSource('Twelve Data API (Live)');
      }
    } catch (err) {
      console.error('[QuantAI] Init fetch failed:', err);
      setDataSource('Error – using cached data');
    } finally {
      setLoading(false);
    }
  }, [predictor, buildFormatted, persistCache]);

  // ── Scheduled update ─────────────────────────────────────────────────────
  // FIX #13 – Side-effects (persistCache, setLastUpdated, setDataSource) are
  //           moved OUTSIDE the setData updater function. React's updater must
  //           be a pure function; in Strict Mode it is called twice, which would
  //           have caused double cache writes and a setState-inside-setState.
  const update = useCallback(async () => {
    setDataSource('Updating prices...');
    try {
      const res = await fetchAllForexData();
      setData(prev => prev.map(item => {
        const fetched = res.find(r => r.pair.symbol === item.pair.symbol);
        const newRate = fetched?.rate;
        if (!newRate || isNaN(newRate)) return item;
        predictor.addDataPoint(item.pair.symbol, newRate);
        const prediction = predictor.predictNextPrice(item.pair.symbol, item.pair);
        const newHistory = [...item.history, { price: newRate, timestamp: Date.now() }].slice(-200);
        return { ...item, currentRate: newRate, history: newHistory, prediction };
      }));
      // Side-effects run once, outside the updater
      const ts = persistCache(dataRef.current);
      setLastUpdated(ts);
      setDataSource('Twelve Data API (Live)');
    } catch (err) { console.error('[QuantAI] Update failed:', err); }
  }, [predictor, persistCache]);

  // ── Force refresh ─────────────────────────────────────────────────────────
  const forceRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setDataSource('Force refreshing...');
    try { localStorage.removeItem(CACHE_KEY); } catch (_) { }
    CURRENCY_PAIRS.forEach(p => predictor.setHistory(p.symbol, []));
    try {
      const res = await fetchAllForexData();
      const formatted = buildFormatted(res, []);
      if (formatted.length > 0) {
        const ts = persistCache(formatted);
        setData(formatted);
        setLastUpdated(ts);
        setDataSource('Twelve Data API (Refreshed)');
      }
    } catch (err) {
      console.error('[QuantAI] Force refresh failed:', err);
      setDataSource('Error – refresh failed');
    } finally { setIsRefreshing(false); }
  }, [predictor, buildFormatted, persistCache]);

  useEffect(() => { initData(); }, [initData]);
  useEffect(() => {
    if (!loading) {
      const id = setInterval(update, UPDATE_INTERVAL);
      return () => clearInterval(id);
    }
  }, [loading, update]);
  useEffect(() => { msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleChat = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    const userMsg = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setMessages(prev => [...prev, { role: 'assistant', content: '⏳ Analyzing markets...', isLoading: true }]);
    try {
      const result = await sendMessageToAI(userMsg, data, messages);
      setMessages(prev => [...prev.filter(m => !m.isLoading), { role: 'assistant', content: result.message }]);
    } catch (_) {
      setMessages(prev => [...prev.filter(m => !m.isLoading), { role: 'assistant', content: getFallbackResponse(userMsg, data) }]);
    }
  };

  // FIX #1 – Only directional pairs are candidates for the Featured card so it
  //           always shows an actionable BUY or SELL, never a neutral one that
  //           renders as the "mixed signals" placeholder. Falls back to the
  //           global pool only when every pair is currently neutral.
  const bestData = data.length > 0
    ? (() => {
      const directional = data.filter(d => d.prediction?.trend !== 'neutral');
      const pool = directional.length > 0 ? directional : data;
      return pool.reduce(
        (p, c) => (c.prediction?.confidence > (p?.prediction?.confidence || 0)) ? c : p,
        null
      );
    })()
    : null;

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <RefreshCw className="w-10 h-10 animate-spin text-indigo-600" />
        <span className="text-slate-500 font-mono tracking-widest animate-pulse font-medium">
          INITIALIZING QUANT MODELS...
        </span>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-indigo-100 selection:text-indigo-900">

      {/* ── HEADER ── */}
      <nav className="border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-lg shadow-md shadow-indigo-200">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <h1 className="font-bold text-lg tracking-tight text-slate-900">
              QUANT<span className="text-indigo-600">AI</span>
            </h1>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono text-slate-500">
            <button
              onClick={forceRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 border border-slate-200">
              <span className={`w-2 h-2 rounded-full ${isRefreshing ? 'bg-amber-500' : 'bg-emerald-500'} animate-pulse`} />
              {isRefreshing ? 'UPDATING' : 'LIVE'}
            </span>
            <span className="hidden sm:inline text-slate-400 font-medium">
              {new Date(lastUpdated).toLocaleTimeString()}
            </span>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">

        <APIStatusBanner batchSize={BATCH_SIZE} lastUpdated={lastUpdated} dataSource={dataSource} />

        {bestData && (
          <FeaturedRecommendation data={bestData} riskReward={sharedRiskReward} />
        )}

        <TradeSettings
          currencyData={data}
          sharedRiskReward={sharedRiskReward}
          onRiskRewardChange={handleRiskRewardChange}
        />

        <PaginationControls
          currentPage={currentPage}
          totalPages={Math.ceil(data.length / itemsPerPage)}
          onPageChange={setCurrentPage}
          totalItems={data.length}
        />

        {/* ── MARKET GRID ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {data.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map(item => {
            const pred = item.prediction;
            const isUp = pred?.trend === 'bullish';
            const isDown = pred?.trend === 'bearish';
            const color = isUp ? '#10b981' : isDown ? '#f43f5e' : '#94a3b8';
            const signal = isUp ? 'BUY' : isDown ? 'SELL' : 'HOLD';
            const sigClr = isUp ? 'text-emerald-600' : isDown ? 'text-rose-600' : 'text-slate-500';

            // Adaptive MACD decimal places per instrument
            const macdDecimals = item.pair.pipDigits >= 5 ? 5 : item.pair.pipDigits + 2;

            return (
              <div
                key={item.pair.symbol}
                className="bg-white rounded-2xl border border-slate-200 hover:border-indigo-200 hover:shadow-md transition-all p-5 relative overflow-hidden"
              >
                <div className="flex justify-between items-start mb-4 relative z-10">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-xs border border-slate-200">
                      {item.pair.base}
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-800 text-lg">{item.pair.symbol}</h3>
                      <span className="text-xs text-slate-500 font-medium">{item.pair.name}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-mono font-bold text-slate-800">
                      {formatPrice(item.currentRate, item.pair.symbol)}
                    </div>
                    {pred && (
                      <div className={`text-xs flex items-center justify-end gap-1 font-semibold ${isUp ? 'text-emerald-600' : isDown ? 'text-rose-600' : 'text-slate-400'}`}>
                        {isUp ? <TrendingUp className="w-3 h-3" />
                          : isDown ? <TrendingDown className="w-3 h-3" />
                            : <Minus className="w-3 h-3" />}
                        <span>{pred.confidence.toFixed(0)}% Conf.</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* MINI CHART */}
                <div className="h-24 w-full mb-4 relative z-10">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={item.history}>
                      <defs>
                        <linearGradient id={`grad${item.pair.symbol}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={color} stopOpacity={0.2} />
                          <stop offset="95%" stopColor={color} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <Area
                        type="monotone" dataKey="price"
                        stroke={color} fill={`url(#grad${item.pair.symbol})`}
                        strokeWidth={2} dot={false} isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* INDICATOR GRID */}
                <div className="grid grid-cols-3 gap-2 relative z-10">
                  <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-100">
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">RSI</div>
                    <div className={`text-sm font-mono font-bold ${pred?.rsi > 70 ? 'text-rose-500' : pred?.rsi < 30 ? 'text-emerald-600' : 'text-slate-600'}`}>
                      {pred ? pred.rsi.toFixed(1) : '-'}
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-100">
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">MACD</div>
                    <div className={`text-sm font-mono font-bold ${pred?.macd?.histogram > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {pred ? pred.macd.histogram.toFixed(macdDecimals) : '-'}
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-100">
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">BB %B</div>
                    <div className={`text-sm font-mono font-bold ${pred?.bollinger?.percentB > 0.8 ? 'text-rose-500' : pred?.bollinger?.percentB < 0.2 ? 'text-emerald-600' : 'text-blue-600'}`}>
                      {pred ? (pred.bollinger.percentB * 100).toFixed(0) + '%' : '-'}
                    </div>
                  </div>

                  <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-100">
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">Target</div>
                    <div className="text-sm font-mono text-slate-700 font-semibold">
                      {pred ? formatPrice(pred.predictedPrice, item.pair.symbol) : '-'}
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-100">
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">Action</div>
                    <div className={`text-sm font-bold ${sigClr}`}>{signal}</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-100">
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">EMA</div>
                    <div className={`text-sm font-bold ${pred?.ema12 > pred?.ema26 ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {pred ? (pred.ema12 > pred.ema26 ? 'BULL' : 'BEAR') : '-'}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {/* ── CHAT INTERFACE ── */}
      <div className="fixed bottom-6 right-6 z-50">
        {!chatOpen ? (
          <button
            onClick={() => setChatOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white p-4 rounded-full shadow-xl shadow-indigo-300 transition-transform hover:scale-105 flex items-center justify-center"
          >
            <Bot className="w-6 h-6" />
          </button>
        ) : (
          <div className="bg-white border border-slate-200 w-80 sm:w-96 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="bg-slate-50 p-4 flex justify-between items-center border-b border-slate-200">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="font-bold text-slate-800 text-sm">QuantAI Analyst</span>
              </div>
              <button onClick={() => setChatOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="h-80 overflow-y-auto p-4 space-y-4 bg-white">
              {messages.map((m, i) => {
                const renderFormatted = (text) =>
                  text.split(/(\*\*[^*]+\*\*)/g).map((part, idx) =>
                    part.startsWith('**') && part.endsWith('**')
                      ? <strong key={idx} className="font-semibold">{part.slice(2, -2)}</strong>
                      : <span key={idx}>{part}</span>
                  );
                return (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm shadow-sm whitespace-pre-wrap ${m.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-none'
                        : 'bg-slate-100 text-slate-700 border border-slate-200 rounded-bl-none'
                      }`}>
                      {renderFormatted(m.content)}
                    </div>
                  </div>
                );
              })}
              <div ref={msgEndRef} />
            </div>
            <form onSubmit={handleChat} className="p-3 bg-slate-50 border-t border-slate-200 flex gap-2">
              <input
                className="flex-1 bg-white border border-slate-300 rounded-full px-4 py-2 text-sm text-slate-800 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                placeholder="Ask about XAU, EUR..."
                value={input}
                onChange={e => setInput(e.target.value)}
              />
              <button
                type="submit"
                className="bg-indigo-600 text-white p-2 rounded-full hover:bg-indigo-700 flex items-center justify-center shadow-md shadow-indigo-200"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

export default ForexDashboard;