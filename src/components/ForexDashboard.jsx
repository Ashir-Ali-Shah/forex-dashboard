import React, { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from 'react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import {
  TrendingUp, TrendingDown, Activity, RefreshCw, ChevronDown, ChevronUp,
  Target, X, Send, Bot, Shield, Crosshair, Calculator, AlertCircle, Clock,
  AlertTriangle, Zap,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────
const TWELVE_DATA_API_KEY = process.env.REACT_APP_TWELVE_DATA_API_KEY || '';
const GROQ_API_KEY = process.env.REACT_APP_GROQ_API_KEY || '';

const MISSING_KEYS = [];
if (!TWELVE_DATA_API_KEY) MISSING_KEYS.push('REACT_APP_TWELVE_DATA_API_KEY');
if (!GROQ_API_KEY) MISSING_KEYS.push('REACT_APP_GROQ_API_KEY');

const UPDATE_INTERVAL = 300_000;
const BATCH_SIZE = 4;
const TIMESERIES_SIZE = 100;
const CACHE_KEY = 'forex_dashboard_v19';
const MAX_CACHE_BYTES = 3_000_000;
const MIN_DISTINCT_PRICES = 10;

// Unified spread constant used everywhere
const SPREAD_PIPS = 2;

const CURRENCY_PAIRS = [
  { symbol: 'XAUUSD', base: 'XAU', quote: 'USD', name: 'Gold / USD', type: 'commodity', pipValue: 0.1, pipDigits: 2, lotPipUSD: 100, priority: 1 },
  { symbol: 'EURUSD', base: 'EUR', quote: 'USD', name: 'EUR / USD', type: 'major', pipValue: 0.0001, pipDigits: 5, lotPipUSD: 10, priority: 1 },
  { symbol: 'GBPUSD', base: 'GBP', quote: 'USD', name: 'GBP / USD', type: 'major', pipValue: 0.0001, pipDigits: 5, lotPipUSD: 10, priority: 1 },
  { symbol: 'USDJPY', base: 'USD', quote: 'JPY', name: 'USD / JPY', type: 'major', pipValue: 0.01, pipDigits: 3, lotPipUSD: null, priority: 1 },
  { symbol: 'USDCAD', base: 'USD', quote: 'CAD', name: 'USD / CAD', type: 'major', pipValue: 0.0001, pipDigits: 5, lotPipUSD: 10, priority: 2 },
  { symbol: 'USDCHF', base: 'USD', quote: 'CHF', name: 'USD / CHF', type: 'major', pipValue: 0.0001, pipDigits: 5, lotPipUSD: 10, priority: 2 },
  { symbol: 'AUDUSD', base: 'AUD', quote: 'USD', name: 'AUD / USD', type: 'major', pipValue: 0.0001, pipDigits: 5, lotPipUSD: 10, priority: 2 },
  { symbol: 'AUDJPY', base: 'AUD', quote: 'JPY', name: 'AUD / JPY', type: 'cross', pipValue: 0.01, pipDigits: 3, lotPipUSD: null, priority: 3 },
];

const JPY_APPROX_RATE = 150;

const getPipUSD = (pair, currentRate) => {
  if (pair.lotPipUSD !== null) return pair.lotPipUSD;
  const rate = (currentRate && isFinite(currentRate) && currentRate > 0)
    ? currentRate : JPY_APPROX_RATE;
  return (pair.pipValue / rate) * 100_000;
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────
const formatPrice = (price, symbol) => {
  if (price == null || isNaN(price) || price === 0) return '---';
  const pair = CURRENCY_PAIRS.find(p => p.symbol === symbol);
  return Number(price).toFixed(pair ? pair.pipDigits : 4);
};

const countDistinctPrices = candles => {
  if (!candles || candles.length === 0) return 0;
  return new Set(candles.map(c => c.price)).size;
};

let _gradientCounter = 0;
const makeGradientId = symbol => `g-${symbol}-${++_gradientCounter}`;

// ─────────────────────────────────────────────────────────────────────────────
// RATE LIMITER
// Sequential promise chain — rate-limits only TwelveData requests.
// Free fallback APIs (frankfurter, er-api) bypass this entirely (FIX #4).
// ─────────────────────────────────────────────────────────────────────────────
class RateLimiter {
  constructor(maxPerMinute = 8) {
    this.max = maxPerMinute;
    this.calls = [];
    this._chain = Promise.resolve();
  }

  wait() {
    this._chain = this._chain.then(() => this._acquire()).catch(() => { });
    return this._chain;
  }

  async _acquire() {
    const now = Date.now();
    this.calls = this.calls.filter(t => now - t < 60_000);
    if (this.calls.length >= this.max) {
      const waitMs = 60_000 - (now - this.calls[0]) + 300;
      if (waitMs > 0) {
        await new Promise(r => setTimeout(r, waitMs));
        this.calls = this.calls.filter(t => Date.now() - t < 60_000);
      }
    }
    this.calls.push(Date.now());
  }
}
const rateLimiter = new RateLimiter(8);

// ─────────────────────────────────────────────────────────────────────────────
// DATA FETCHING
// ─────────────────────────────────────────────────────────────────────────────
const twelveSymbol = pair =>
  pair.base === 'XAU' ? 'XAU/USD' : `${pair.base}/${pair.quote}`;

const safeFetch = async (url, signal) => {
  const res = await fetch(url, signal ? { signal } : {});
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
};

const fetchTimeSeries = async (pair, signal) => {
  if (!TWELVE_DATA_API_KEY) return null;
  try {
    await rateLimiter.wait();
    if (signal?.aborted) return null;

    const sym = twelveSymbol(pair);
    const url =
      `https://api.twelvedata.com/time_series` +
      `?symbol=${encodeURIComponent(sym)}` +
      `&interval=5min` +
      `&outputsize=${TIMESERIES_SIZE}` +
      `&apikey=${TWELVE_DATA_API_KEY}`;

    const json = await safeFetch(url, signal);
    if (json?.status === 'error') {
      console.warn(`[QuantAI] TS error (${sym}):`, json.message);
      return null;
    }
    if (!Array.isArray(json?.values) || json.values.length === 0) return null;

    const candles = [...json.values].reverse().map((c, i) => ({
      price: parseFloat(c.close),
      open: parseFloat(c.open),
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      timestamp: new Date(c.datetime).getTime() ||
        Date.now() - (json.values.length - i) * 300_000,
    }));

    const distinct = countDistinctPrices(candles);
    if (distinct < MIN_DISTINCT_PRICES) {
      console.warn(
        `[QuantAI] Stale candles for ${sym}: ` +
        `only ${distinct} distinct prices in ${candles.length} bars. Falling back.`
      );
      return null;
    }

    return candles;
  } catch (err) {
    if (err.name === 'AbortError') return null;
    console.error(`[QuantAI] fetchTimeSeries(${pair.symbol}):`, err);
    return null;
  }
};

// FIX #4: Free fallback APIs (frankfurter, er-api) no longer use rateLimiter.
// The rate limiter is only for TwelveData endpoints. Removing it here prevents
// free-API requests from consuming the shared TwelveData quota window and
// causing spurious 60-second delays on those calls.
const fetchSpotFallback = async (pair, signal) => {
  if (pair.base === 'XAU') {
    // XAU only available via TwelveData — rate-limit applies here
    if (!TWELVE_DATA_API_KEY) return null;
    try {
      await rateLimiter.wait();
      if (signal?.aborted) return null;
      const d = await safeFetch(
        `https://api.twelvedata.com/price?symbol=XAU%2FUSD&apikey=${TWELVE_DATA_API_KEY}`,
        signal
      );
      if (d?.price && !isNaN(parseFloat(d.price))) return parseFloat(d.price);
    } catch (err) {
      if (err.name === 'AbortError') return null;
    }
    return null;
  }

  // Free public APIs — NO rate limiter
  const apis = [
    async () => {
      if (signal?.aborted) return null;
      const d = await safeFetch(
        `https://api.frankfurter.app/latest?from=${pair.base}&to=${pair.quote}`,
        signal
      );
      const v = d?.rates?.[pair.quote];
      return (v && !isNaN(parseFloat(v))) ? parseFloat(v) : null;
    },
    async () => {
      if (signal?.aborted) return null;
      const d = await safeFetch(
        `https://open.er-api.com/v6/latest/${pair.base}`,
        signal
      );
      const v = d?.rates?.[pair.quote];
      return (v && !isNaN(parseFloat(v))) ? parseFloat(v) : null;
    },
  ];

  for (const fn of apis) {
    try {
      const v = await fn();
      if (v && !isNaN(v)) return v;
    } catch (err) {
      if (err.name === 'AbortError') return null;
    }
  }
  return null;
};

const fetchAllTimeSeries = async (signal) => {
  const out = {};
  for (let i = 0; i < CURRENCY_PAIRS.length; i += BATCH_SIZE) {
    if (signal?.aborted) break;
    const batch = CURRENCY_PAIRS.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async p => ({ symbol: p.symbol, series: await fetchTimeSeries(p, signal) }))
    );
    results.forEach(r => { if (r.series) out[r.symbol] = r.series; });
    if (i + BATCH_SIZE < CURRENCY_PAIRS.length) {
      await new Promise(r => {
        const t = setTimeout(r, 1_000);
        signal?.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true });
      });
    }
  }
  return out;
};

const fetchSpotPrice = async (pair, signal) => {
  if (!TWELVE_DATA_API_KEY) return fetchSpotFallback(pair, signal);
  try {
    await rateLimiter.wait();
    if (signal?.aborted) return null;
    const sym = twelveSymbol(pair);
    const d = await safeFetch(
      `https://api.twelvedata.com/price?symbol=${encodeURIComponent(sym)}&apikey=${TWELVE_DATA_API_KEY}`,
      signal
    );
    if (d?.price && !isNaN(parseFloat(d.price))) return parseFloat(d.price);
  } catch (err) {
    if (err.name === 'AbortError') return null;
  }
  return fetchSpotFallback(pair, signal);
};

// ─────────────────────────────────────────────────────────────────────────────
// localStorage helpers — predictions excluded from cache
// ─────────────────────────────────────────────────────────────────────────────
const serializeForCache = (pairs) =>
  pairs.map(item => ({
    pair: item.pair,
    currentRate: item.currentRate,
    history: item.history,
  }));

const safeSetCache = (pairs, timestamp) => {
  try {
    const payload = JSON.stringify({ timestamp, data: serializeForCache(pairs) });
    if (payload.length > MAX_CACHE_BYTES) {
      console.warn('[QuantAI] Cache payload too large, skipping write.');
      return;
    }
    localStorage.setItem(CACHE_KEY, payload);
  } catch (e) {
    console.warn('[QuantAI] Cache write failed:', e);
  }
};

const safeRemoveCache = () => {
  try { localStorage.removeItem(CACHE_KEY); } catch (_) { }
};

const safeReadCache = () => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    safeRemoveCache();
    return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// MATH HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const linearRegression = (prices, horizon = 1) => {
  const n = prices.length;
  if (n < 2) return { slope: 0, intercept: prices[0] ?? 0, r2: 0, predictedNext: prices[0] ?? 0 };
  let sx = 0, sy = 0, sxy = 0, sx2 = 0;
  for (let i = 0; i < n; i++) {
    sx += i; sy += prices[i]; sxy += i * prices[i]; sx2 += i * i;
  }
  const denom = n * sx2 - sx * sx;
  if (denom === 0) return { slope: 0, intercept: prices[0], r2: 0, predictedNext: prices[n - 1] };
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const yMean = sy / n;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    ssRes += (prices[i] - (intercept + slope * i)) ** 2;
    ssTot += (prices[i] - yMean) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);
  const predictedNext = intercept + slope * (n - 1 + horizon);
  return { slope, intercept, r2, predictedNext };
};

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL ENGINE
// FIX #6: deepOversold override threshold relaxed from `netScore >= 0` to
// `netScore > -4`. Previously a mildly bearish score (e.g. -2) with RSI at 22
// would fall through to HOLD entirely, discarding a strong mean-reversion
// signal. Now the deep oversold condition can override up to a moderate bearish
// bias, matching the symmetric logic for deepOverbought.
// ─────────────────────────────────────────────────────────────────────────────
const MAX_BULL_BEAR = 12;
const REALISTIC_MAX_SCORE = 8;

const computeSignal = ({
  rsi, rsiValid,
  macdHist, macdValid,
  ema12, ema26, emaValid,
  bbPercentB, bbValid,
  regSlope,
}) => {
  let bull = 0, bear = 0;

  if (emaValid) {
    if (ema12 > ema26) bull += 2; else bear += 2;
  }
  if (regSlope > 0) bull += 1; else if (regSlope < 0) bear += 1;
  if (macdValid) {
    if (macdHist > 0) bull += 2; else if (macdHist < 0) bear += 2;
  }

  if (rsiValid) {
    if (rsi < 20) bull += 4;
    else if (rsi < 30) bull += 3;
    else if (rsi < 40) bull += 1;
    else if (rsi > 80) bear += 4;
    else if (rsi > 70) bear += 3;
    else if (rsi > 60) bear += 1;
  }

  if (bbValid) {
    if (bbPercentB < 0.10) bull += 3;
    else if (bbPercentB < 0.20) bull += 2;
    else if (bbPercentB < 0.30) bull += 1;
    else if (bbPercentB > 0.90) bear += 3;
    else if (bbPercentB > 0.80) bear += 2;
    else if (bbPercentB > 0.70) bear += 1;
  }

  const netScore = bull - bear;

  const deepOversold = rsiValid && bbValid && (rsi < 30 || bbPercentB < 0.10);
  const deepOverbought = rsiValid && bbValid && (rsi > 70 || bbPercentB > 0.90);

  // FIX #6: Threshold changed from `>= 0` / `<= 0` to `> -4` / `< 4`.
  // The original guard required zero/positive net score for oversold override,
  // causing HOLD on deeply oversold assets with any bearish signal. The new
  // threshold allows the extreme reversal to override a moderate contrary bias
  // (up to netScore = ±3), while still deferring to a strong trend (±4+).
  let signal;
  if (deepOversold && netScore > -4) signal = 'BUY';
  else if (deepOverbought && netScore < 4) signal = 'SELL';
  else if (netScore >= 4) signal = 'BUY';
  else if (netScore <= -4) signal = 'SELL';
  else signal = 'HOLD';

  const trend = signal === 'BUY' ? 'bullish' : signal === 'SELL' ? 'bearish' : 'neutral';
  const strength = Math.min(5, Math.round(Math.abs(netScore) / REALISTIC_MAX_SCORE * 5));

  const hasOversoldConflict = rsiValid && signal === 'SELL' && (rsi < 35 || (bbValid && bbPercentB < 0.25));
  const hasOverboughtConflict = rsiValid && signal === 'BUY' && (rsi > 65 || (bbValid && bbPercentB > 0.75));
  const hasConflict = hasOversoldConflict || hasOverboughtConflict;
  const conflictType = hasOversoldConflict ? 'oversold' : hasOverboughtConflict ? 'overbought' : null;

  return { bull, bear, signal, trend, strength, netScore, hasConflict, conflictType };
};

// ─────────────────────────────────────────────────────────────────────────────
// PREDICTOR
// ─────────────────────────────────────────────────────────────────────────────
class ForexPredictor {
  constructor() { this._store = {}; }

  setHistory(symbol, candles) { this._store[symbol] = (candles || []).slice(-120); }
  getHistory(symbol) { return this._store[symbol] || []; }

  addTick(symbol, price) {
    if (!this._store[symbol]) this._store[symbol] = [];
    const store = this._store[symbol];
    if (store.length > 0) {
      const last = store[store.length - 1];
      if (last.price === price && (Date.now() - last.timestamp) < 1000) return;
    }
    store.push({ price, timestamp: Date.now() });
    if (store.length > 120) store.shift();
  }

  _ema(prices, period) {
    if (!prices.length || prices.length < period) return null;
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
    return ema;
  }

  _rsi(prices, period = 14) {
    const minBars = period * 2 + 1;
    if (prices.length < minBars) return null;
    const slice = prices.slice(-(period * 3));
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
      const d = slice[i] - slice[i - 1];
      if (d >= 0) gains += d; else losses -= d;
    }
    let ag = gains / period, al = losses / period;
    for (let i = period + 1; i < slice.length; i++) {
      const d = slice[i] - slice[i - 1];
      ag = (ag * (period - 1) + Math.max(d, 0)) / period;
      al = (al * (period - 1) + Math.max(-d, 0)) / period;
    }
    if (al === 0 && ag === 0) return 50;
    if (al === 0) return 100;
    if (ag === 0) return 0;
    return 100 - 100 / (1 + ag / al);
  }

  // FIX #10: Guard the signal-line seed against macdLine being shorter than 9
  // bars. Previously `slice(0, 9)` on a 6-bar macdLine would silently seed on
  // 6 values, producing an incorrect (too-smooth) signal average. Now we only
  // compute when there are enough bars, and return valid:false otherwise.
  _macd(prices, pipValue = 0.0001) {
    if (prices.length < 35) return { valid: false, macd: 0, signal: 0, histogram: 0 };

    const emaSeries = (p, len) => {
      const k = 2 / (len + 1);
      const out = [];
      let ema = p.slice(0, len).reduce((a, b) => a + b, 0) / len;
      out.push(ema);
      for (let i = len; i < p.length; i++) { ema = p[i] * k + ema * (1 - k); out.push(ema); }
      return out;
    };

    const e12 = emaSeries(prices, 12);
    const e26 = emaSeries(prices, 26);
    const off12 = e12.length - e26.length;
    const macdLine = e26.map((v, i) => e12[i + off12] - v);

    // FIX #10: Require at least 9 bars in the MACD line to seed the signal properly
    if (macdLine.length < 9) return { valid: false, macd: 0, signal: 0, histogram: 0 };

    const signalK = 2 / 10; // EMA(9): k = 2/(9+1) = 0.2
    let sig = macdLine.slice(0, 9).reduce((a, b) => a + b, 0) / 9;
    for (let i = 9; i < macdLine.length; i++) sig = macdLine[i] * signalK + sig * (1 - signalK);

    const last = macdLine[macdLine.length - 1];
    const histogram = last - sig;

    const flatThreshold = pipValue * 0.01;
    if (Math.abs(histogram) < flatThreshold) {
      return { valid: false, macd: last, signal: sig, histogram };
    }
    return { valid: true, macd: last, signal: sig, histogram };
  }

  // FIX #5: Removed the `pB > 2.0 || pB < -1.0` invalidity check.
  // Price trading 1–2 std deviations OUTSIDE the Bollinger bands is a valid
  // (and often highly actionable) extreme signal — the original check was
  // discarding these cases as `valid: false`, silently killing the strongest
  // BB-driven buy/sell signals. We now only reject mathematically undefined
  // values (NaN/Infinity) where std=0 is the root cause.
  _bollinger(prices, period = 20) {
    if (prices.length < period) {
      return { percentB: 0.5, bandwidth: 0, upper: 0, lower: 0, mid: 0, valid: false };
    }
    const sl = prices.slice(-period);
    const mean = sl.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(sl.reduce((s, p) => s + (p - mean) ** 2, 0) / period);

    if (std === 0) {
      return { percentB: 0.5, bandwidth: 0, upper: mean, lower: mean, mid: mean, valid: false };
    }

    const upper = mean + std * 2;
    const lower = mean - std * 2;
    const cur = prices[prices.length - 1];
    const pB = (cur - lower) / (upper - lower);

    // FIX #5: Only reject truly undefined values — extreme band breaks are valid
    if (!isFinite(pB)) {
      return { percentB: 0.5, bandwidth: std * 4 / mean, upper, lower, mid: mean, valid: false };
    }

    return { percentB: pB, bandwidth: std * 4 / mean, upper, lower, mid: mean, valid: true };
  }

  _atr(candles, period = 14) {
    if (!candles || candles.length < 2) return null;
    const hasOHLC = candles[0].high !== undefined;
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      if (hasOHLC) {
        const { high, low } = candles[i];
        const pClose = candles[i - 1].price;
        trs.push(Math.max(high - low, Math.abs(high - pClose), Math.abs(low - pClose)));
      } else {
        trs.push(Math.abs(candles[i].price - candles[i - 1].price));
      }
    }
    if (trs.length < period) return trs.reduce((a, b) => a + b, 0) / trs.length || null;
    let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) atr = (atr * (period - 1) + trs[i]) / period;
    return atr > 0 ? atr : null;
  }

  predict(symbol, pair) {
    const candles = this._store[symbol];
    if (!candles || candles.length < 5) return null;

    const prices = candles.map(c => c.price);
    const cur = prices[prices.length - 1];
    const n = prices.length;

    const distinctCount = countDistinctPrices(candles);
    const dataQualityOk = distinctCount >= MIN_DISTINCT_PRICES;

    const rsiRaw = dataQualityOk ? this._rsi(prices) : null;
    const rsi = rsiRaw ?? 50;
    const rsiValid = rsiRaw !== null && dataQualityOk;

    const macd = dataQualityOk ? this._macd(prices, pair.pipValue) : { valid: false, macd: 0, signal: 0, histogram: 0 };
    const macdValid = macd.valid;

    const bb = this._bollinger(prices);
    const bbValid = bb.valid && dataQualityOk;

    const ema12Raw = dataQualityOk ? this._ema(prices, 12) : null;
    const ema26Raw = dataQualityOk ? this._ema(prices, 26) : null;
    const ema12 = ema12Raw ?? cur;
    const ema26 = ema26Raw ?? cur;
    const emaValid = ema12Raw !== null && ema26Raw !== null && dataQualityOk;

    const rawATR = this._atr(candles);

    // FIX #8: Commodity ATR floor increased from 3× to 50× pipValue.
    // XAUUSD pipValue=0.1 → old floor: $0.30, new floor: $5.00.
    // At gold prices of ~$2000, the old floor produced SL/TP distances of
    // cents, making the trade calculator output nonsensical. $5 is a more
    // realistic minimum for gold volatility; forex pairs are unchanged.
    const pipFloorMult = pair.type === 'commodity' ? 50 : 10;
    const pipMin = pair.pipValue * pipFloorMult;
    const atr = (rawATR && rawATR > pipMin) ? rawATR : pipMin;

    const regWindow = Math.min(n, 30);
    const reg = linearRegression(prices.slice(-regWindow), 1);

    // FIX #3: Removed the inner clamp on rawRegDrift.
    // The original code clamped regDrift to ±atr*2.0 before adding it to the
    // weighted sum, then clamped the entire rawDrift to ±atr*2.5 again. This
    // double-suppression meant a strongly trending regression (regDrift = 3×ATR)
    // was first cut to 2×ATR, then the weighted average rarely exceeded 2×ATR
    // either, so the outer clamp rarely added value. Now rawRegDrift flows into
    // the weighted sum uncapped; the single outer clamp at ±atr*2.5 provides
    // the necessary sanity bound.
    const rawRegDrift = reg.predictedNext - cur;

    let wDrift = 0, wTotal = 0;

    const wReg = 3.0 * Math.max(0.1, reg.r2);
    wDrift += rawRegDrift * wReg; wTotal += wReg;   // FIX #3: removed inner clamp

    if (emaValid) {
      const emaDrift = (ema12 - ema26) * 0.5;
      wDrift += emaDrift * 2.0; wTotal += 2.0;
    }

    let rsiDrift = 0;
    if (rsiValid) {
      if (rsi < 20) rsiDrift = atr * 1.5;
      else if (rsi < 30) rsiDrift = atr * 1.0;
      else if (rsi < 40) rsiDrift = atr * 0.3;
      else if (rsi > 80) rsiDrift = -atr * 1.5;
      else if (rsi > 70) rsiDrift = -atr * 1.0;
      else if (rsi > 60) rsiDrift = -atr * 0.3;
    }
    wDrift += rsiDrift * 1.5; wTotal += 1.5;

    if (macdValid) {
      const macdDrift = macd.histogram !== 0
        ? Math.sign(macd.histogram) * Math.min(atr, Math.abs(macd.histogram) * 5)
        : 0;
      wDrift += macdDrift * 1.5; wTotal += 1.5;
    }

    let bbDrift = 0;
    if (bbValid) {
      // FIX #5 companion: bb.percentB can now legitimately exceed [0,1].
      // Use the raw value for drift calculation so extreme band excursions
      // produce stronger mean-reversion nudges.
      if (bb.percentB < 0.10) bbDrift = atr * 1.0;
      else if (bb.percentB < 0.20) bbDrift = atr * 0.6;
      else if (bb.percentB < 0.30) bbDrift = atr * 0.3;
      else if (bb.percentB > 0.90) bbDrift = -atr * 1.0;
      else if (bb.percentB > 0.80) bbDrift = -atr * 0.6;
      else if (bb.percentB > 0.70) bbDrift = -atr * 0.3;
    }
    wDrift += bbDrift * 1.0; wTotal += 1.0;

    const rawDrift = wTotal > 0 ? wDrift / wTotal : 0;
    const clampedDrift = Math.max(-atr * 2.5, Math.min(atr * 2.5, rawDrift)); // single clamp

    let predictedPrice = parseFloat((cur + clampedDrift).toFixed(pair.pipDigits ?? 5));

    const sig = computeSignal({
      rsi, rsiValid,
      macdHist: macd.histogram, macdValid,
      ema12: emaValid ? ema12 : cur,
      ema26: emaValid ? ema26 : cur,
      emaValid,
      bbPercentB: bb.percentB, bbValid,
      regSlope: reg.slope,
    });

    if (predictedPrice === cur) {
      const pip = pair.pipValue ?? Math.pow(10, -(pair.pipDigits ?? 5));
      if (sig.signal === 'BUY') predictedPrice = parseFloat((cur + pip).toFixed(pair.pipDigits));
      else if (sig.signal === 'SELL') predictedPrice = parseFloat((cur - pip).toFixed(pair.pipDigits));
    }

    const dataConf = Math.min(1, n / 50);
    const indAgree = Math.min(1, Math.abs(sig.netScore) / MAX_BULL_BEAR);
    const regFit = reg.r2;

    const stalePenalty = dataQualityOk ? 0 : 30;
    const warmupPenalty =
      (!rsiValid ? 10 : 0) +
      (!macdValid ? 5 : 0) +
      (!emaValid ? 5 : 0) +
      (!bbValid ? 5 : 0) +
      stalePenalty;

    const confidence = Math.min(99, Math.max(0, Math.round(
      20 + dataConf * 20 + indAgree * 40 + regFit * 19 - warmupPenalty
    )));

    // Clamp percentB for display only — raw value used in signals above
    const bbDisplay = { ...bb, percentB: Math.max(0, Math.min(1, bb.percentB)) };

    return {
      predictedPrice, confidence,
      trend: sig.trend,
      signal: sig.signal,
      bull: sig.bull,
      bear: sig.bear,
      strength: sig.strength,
      netScore: sig.netScore,
      hasConflict: sig.hasConflict,
      conflictType: sig.conflictType,
      rsi, rsiValid,
      macd, macdValid,
      bollinger: bbDisplay,
      bollingerRaw: bb,
      bbValid,
      atr, ema12, ema26, emaValid,
      regression: { slope: reg.slope, r2: reg.r2 },
      levels: { support: cur - atr * 2, resistance: cur + atr * 2 },
      dataPoints: n,
      distinctPrices: distinctCount,
      dataQualityOk,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AI CHAT via Groq
// FIX #1 (abort message cleanup): sendToGroq abort or any error now always
// removes the pending loading entry before either returning or adding the
// fallback reply. Previously on AbortError the loading bubble was never
// cleaned, and would stack with the next user message's loading bubble.
// ─────────────────────────────────────────────────────────────────────────────
const sendToGroq = async (forexData, history, signal) => {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not configured');

  const marketContext = forexData
    .filter(d => d.prediction)
    .map(d => {
      const p = d.prediction;
      const macdStr = p.macdValid
        ? `MACD_hist=${p.macd.histogram.toFixed(5)}`
        : `MACD_hist=N/A(${p.dataQualityOk ? 'warmup' : 'stale-data'})`;
      const rawBB = p.bollingerRaw?.percentB ?? p.bollinger.percentB;
      const bbStr = p.bbValid
        ? `BB%B=${(rawBB * 100).toFixed(1)}%`
        : `BB%B=N/A(${p.dataQualityOk ? 'warmup' : 'stale-data'})`;
      const rsiStr = p.rsiValid
        ? `RSI=${p.rsi.toFixed(1)}`
        : `RSI=N/A(${p.dataQualityOk ? 'warmup' : 'stale-data'})`;
      const pricePrec = d.pair.pipDigits ?? 5;
      return (
        `${d.pair.symbol}: price=${formatPrice(d.currentRate, d.pair.symbol)} ` +
        `signal=${p.signal} trend=${p.trend} confidence=${p.confidence}% ` +
        `${rsiStr} ${macdStr} ${bbStr} ` +
        `EMA12=${p.ema12.toFixed(pricePrec)} EMA26=${p.ema26.toFixed(pricePrec)} ` +
        `bull=${p.bull} bear=${p.bear} ` +
        `nextPrice=${formatPrice(p.predictedPrice, d.pair.symbol)} ` +
        `ATR=${p.atr.toFixed(pricePrec)} dataPoints=${p.dataPoints} ` +
        `distinctPrices=${p.distinctPrices} dataQuality=${p.dataQualityOk ? 'ok' : 'STALE'}`
      );
    })
    .join('\n');

  const systemPrompt =
    `You are QuantAI, a professional forex & commodities analyst. ` +
    `Respond concisely, use **bold** for key figures. ` +
    `If dataQuality=STALE for a pair, note that indicators are unreliable for that pair. ` +
    `Current live market data (5-min candles, real prices only):\n${marketContext}`;

  const messages = history
    .filter(m => !m.isLoading)
    .slice(-12)
    .map(m => ({ role: m.role, content: m.content }));

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.4,
      max_tokens: 400,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Groq API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Groq returned empty or malformed response');
  }
  return content;
};

const getFallbackReply = (msg, data) => {
  const m = msg.toLowerCase();
  const best = data.reduce((p, c) =>
    (c.prediction?.confidence > (p?.prediction?.confidence ?? 0) ? c : p), null);
  if (!best) return 'Loading market data, please wait…';
  if (m.includes('gold') || m.includes('xau'))
    return `XAU/USD is at ${formatPrice(best?.currentRate, 'XAUUSD')}. Signal: ${best?.prediction?.signal ?? 'N/A'}.`;
  return `Best setup: **${best.pair.symbol}** at ${formatPrice(best.currentRate, best.pair.symbol)} — ${best.prediction?.signal} (${best.prediction?.confidence}% confidence).`;
};

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
const StaleDataWarning = ({ pred }) => {
  if (!pred || pred.dataQualityOk) return null;
  return (
    <div className="flex items-center gap-1.5 mt-1 text-[10px] text-orange-700 font-semibold bg-orange-50 border border-orange-200 rounded-full px-2 py-0.5 w-fit">
      <Zap className="w-3 h-3 flex-shrink-0" />
      Stale data ({pred.distinctPrices} distinct prices) — indicators unreliable
    </div>
  );
};

const ConflictWarning = ({ pred }) => {
  if (!pred?.hasConflict) return null;
  const msg = pred.conflictType === 'oversold'
    ? 'Oversold — mean reversion risk vs bearish signal'
    : 'Overbought — mean reversion risk vs bullish signal';
  return (
    <div className="flex items-center gap-1.5 mt-1 text-[10px] text-amber-600 font-semibold bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 w-fit">
      <AlertTriangle className="w-3 h-3 flex-shrink-0" />
      {msg}
    </div>
  );
};

const MissingKeysBanner = ({ keys }) => (
  <div className="mb-6 px-4 py-4 bg-rose-50 border border-rose-300 rounded-xl text-sm text-rose-800 shadow-sm">
    <div className="flex items-center gap-2 font-bold mb-1">
      <AlertCircle className="w-4 h-4" /> Missing environment variables
    </div>
    <p className="text-xs mb-2">
      Set the following variables before starting the dev server.
      API keys must never be hardcoded — they are visible in the client bundle.
    </p>
    <ul className="font-mono text-xs space-y-0.5">
      {keys.map(k => <li key={k} className="bg-rose-100 px-2 py-0.5 rounded">{k}</li>)}
    </ul>
  </div>
);

const APIStatusBanner = ({ dataSource, lastUpdated, isRefreshing }) => (
  <div className="flex items-center gap-3 mb-6 px-4 py-3 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-500 shadow-sm">
    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isRefreshing ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`} />
    <span className="flex-1 truncate">{dataSource}</span>
    <Clock className="w-3.5 h-3.5 flex-shrink-0" />
    <span className="flex-shrink-0">Updated {new Date(lastUpdated).toLocaleTimeString()}</span>
  </div>
);

const PaginationControls = ({ currentPage, totalPages, onPageChange, totalItems }) => {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between mb-4 text-sm text-slate-500">
      <span>{totalItems} pairs · Page {currentPage}/{totalPages}</span>
      <div className="flex gap-2">
        <button
          onClick={() => onPageChange(p => Math.max(1, p - 1))}
          disabled={currentPage === 1}
          className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-indigo-400 disabled:opacity-40 transition"
        >‹ Prev</button>
        <button
          onClick={() => onPageChange(p => Math.min(totalPages, p + 1))}
          disabled={currentPage === totalPages}
          className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-indigo-400 disabled:opacity-40 transition"
        >Next ›</button>
      </div>
    </div>
  );
};

const FeaturedRecommendation = ({ data: d }) => {
  if (!d?.prediction) return null;
  const { pair, currentRate, prediction: pred } = d;

  const isWeak =
    !pred ||
    pred.trend === 'neutral' ||
    pred.confidence < 50 ||
    pred.regression.r2 < 0.15 ||
    !pred.dataQualityOk;

  if (isWeak) {
    return (
      <div className="bg-white rounded-3xl p-8 shadow-lg mb-8 border border-slate-200 text-center">
        <AlertCircle className="w-8 h-8 text-amber-400 mx-auto mb-3" />
        <h2 className="text-xl font-bold text-slate-800 mb-1">No High-Quality Setup</h2>
        <p className="text-slate-500 text-sm">
          {pred && !pred.dataQualityOk
            ? `Stale/repeated candle data detected (${pred.distinctPrices} distinct prices). Indicators are unreliable — waiting for clean data.`
            : pred
              ? `Indicators are inconclusive or trend fit is too weak (bull:${pred.bull} bear:${pred.bear}, R²=${pred.regression.r2.toFixed(2)}). Waiting for a cleaner setup.`
              : 'Waiting for prediction data…'
          }
        </p>
      </div>
    );
  }

  const isBull = pred.trend === 'bullish';
  const atr = pred.atr;
  const slDist = Math.max(pair.pipValue * 15, atr * 2);
  const tpDist = slDist * 2;
  const spread = pair.pipValue * SPREAD_PIPS;
  const sl = isBull ? currentRate - slDist : currentRate + slDist;
  const tp = isBull ? currentRate + tpDist + spread : currentRate - tpDist - spread;

  return (
    <div className="relative overflow-hidden bg-white rounded-3xl p-1 shadow-lg mb-8 border border-slate-200">
      <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/60 via-white to-emerald-50/40 pointer-events-none rounded-3xl" />
      <div className="relative rounded-[20px] p-6 md:p-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-3 py-1 rounded-full border border-emerald-200 animate-pulse">
                PRIME SETUP
              </span>
              <span className="text-slate-500 text-xs font-semibold tracking-wider">
                AI Confidence: {pred.confidence}%
              </span>
              <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full border border-slate-200">
                Bull {pred.bull} / Bear {pred.bear}
              </span>
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 flex items-center gap-3">
              {pair.name}
              <span className="text-slate-400 text-xl font-normal">/ {pair.symbol}</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Based on {pred.dataPoints} real 5-min candles · R²={pred.regression.r2.toFixed(2)}
              · ATR={pred.atr.toFixed(pair.pipDigits > 3 ? 5 : 3)}
              · {pred.distinctPrices} distinct prices
            </p>
            <StaleDataWarning pred={pred} />
            <ConflictWarning pred={pred} />
          </div>
          <div className="text-right hidden md:block">
            <div className="text-sm text-slate-500 font-medium">Current Price</div>
            <div className="text-3xl font-mono font-bold text-slate-800 tracking-tight">
              {formatPrice(currentRate, pair.symbol)}
            </div>
            <div className={`text-sm font-mono mt-1 ${isBull ? 'text-emerald-600' : 'text-rose-500'}`}>
              → {formatPrice(pred.predictedPrice, pair.symbol)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className={`col-span-1 rounded-2xl p-6 flex flex-col items-center justify-center border-2
            ${isBull ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
            <span className={`text-sm font-bold uppercase tracking-widest mb-2 ${isBull ? 'text-emerald-700' : 'text-rose-700'}`}>
              Action
            </span>
            <div className={`text-4xl font-black ${isBull ? 'text-emerald-600' : 'text-rose-600'}`}>
              {pred.signal}
            </div>
            <div className="mt-2 text-slate-500 text-xs text-center">
              Score: {(pred.confidence / 10).toFixed(1)}/10
            </div>
          </div>

          <div className="col-span-1 md:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: 'Stop Loss', val: sl, icon: <Shield className="w-4 h-4" />, color: 'text-rose-500', note: 'Protective Stop' },
              { label: 'Entry Zone', val: currentRate, icon: <Crosshair className="w-4 h-4" />, color: 'text-blue-500', note: 'Market Execution' },
              { label: 'Take Profit', val: tp, icon: <Target className="w-4 h-4" />, color: 'text-emerald-600', note: isBull ? 'Target Resistance' : 'Target Support' },
            ].map(item => (
              <div key={item.label}
                className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex flex-col justify-between hover:bg-white hover:shadow-md transition-all">
                <div className={`flex items-center gap-2 ${item.color} mb-2`}>
                  {item.icon}<span className="text-sm font-bold">{item.label}</span>
                </div>
                <div className="text-2xl font-mono text-slate-800 font-semibold">
                  {formatPrice(item.val, pair.symbol)}
                </div>
                <div className="text-xs text-slate-500 mt-1">{item.note}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TRADE CALCULATOR
// ─────────────────────────────────────────────────────────────────────────────
const TradeSettings = ({ currencyData }) => {
  const [riskPct, setRiskPct] = useState(2);
  const [rrRatio, setRrRatio] = useState(2);
  const [balance, setBalance] = useState(1000);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [showAdv, setShowAdv] = useState(false);
  const [manualLot, setManualLot] = useState(false);
  const [lotSize, setLotSize] = useState(0.01);

  useEffect(() => {
    if (!selectedSymbol && currencyData.length) {
      const best = currencyData.reduce((p, c) =>
        (c.prediction?.confidence ?? 0) > (p?.prediction?.confidence ?? 0) ? c : p, currencyData[0]);
      if (best?.pair) setSelectedSymbol(best.pair.symbol);
    }
  }, [currencyData, selectedSymbol]);

  const trade = useMemo(() => {
    const d = currencyData.find(x => x.pair.symbol === selectedSymbol);
    if (!d?.prediction) return null;
    const { prediction: pred, currentRate, pair: pairMeta } = d;

    const isBuy = pred.signal === 'BUY';
    const atr = pred.atr;
    const slDist = Math.max(pairMeta.pipValue * 15, atr * 2);
    const tpDist = slDist * rrRatio;
    const spread = pairMeta.pipValue * SPREAD_PIPS;
    const sl = isBuy ? currentRate - slDist : currentRate + slDist;
    const tp = isBuy ? currentRate + tpDist + spread : currentRate - tpDist - spread;

    const pipUSD = getPipUSD(pairMeta, currentRate);
    const pipsRisk = slDist / pairMeta.pipValue;
    const pipsTp = tpDist / pairMeta.pipValue;

    const riskAmt = balance * (riskPct / 100);
    const autoLot = Math.min(50, Math.max(0.01,
      parseFloat((riskAmt / (pipsRisk * pipUSD)).toFixed(2))
    ));
    const finalLot = manualLot ? lotSize : autoLot;

    return {
      signal: pred.signal, isBuy,
      entry: currentRate, sl, tp,
      lot: finalLot,
      riskAmt: finalLot * pipsRisk * pipUSD,
      profit: finalLot * pipsTp * pipUSD,
      slPips: pipsRisk.toFixed(1),
      tpPips: pipsTp.toFixed(1),
      bull: pred.bull,
      bear: pred.bear,
      strength: pred.strength,
      netScore: pred.netScore,
      hasConflict: pred.hasConflict,
      conflictType: pred.conflictType,
      pred, pairMeta, currentRate,
    };
  }, [currencyData, selectedSymbol, rrRatio, balance, riskPct, manualLot, lotSize]);

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-lg mb-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <Calculator className="w-5 h-5 text-indigo-600" />Trade Calculator
        </h2>
        <button
          onClick={() => setShowAdv(!showAdv)}
          className="text-sm text-slate-500 hover:text-indigo-600 flex items-center gap-1 font-medium transition-colors"
        >
          {showAdv ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}Advanced
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="space-y-4">
          <div>
            <label className="text-xs text-slate-500 uppercase font-bold">Currency Pair</label>
            <select
              value={selectedSymbol}
              onChange={e => setSelectedSymbol(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-lg p-3 mt-1 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
            >
              {currencyData.map(d =>
                <option key={d.pair.symbol} value={d.pair.symbol}>
                  {d.pair.symbol} — {d.pair.name}
                  {d.prediction && !d.prediction.dataQualityOk ? ' ⚠ stale' : ''}
                </option>
              )}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-500 uppercase font-bold">Balance ($)</label>
              <input
                type="number" min="1" value={balance}
                onChange={e => setBalance(Math.max(1, Number(e.target.value)))}
                className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-lg p-3 mt-1 outline-none focus:border-indigo-500 font-medium"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 uppercase font-bold">Risk (%)</label>
              <input
                type="number" min="0.1" max="100" step="0.5" value={riskPct}
                onChange={e => setRiskPct(Math.min(100, Math.max(0.1, Number(e.target.value))))}
                className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-lg p-3 mt-1 outline-none focus:border-indigo-500 font-medium"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox" checked={manualLot}
              onChange={e => setManualLot(e.target.checked)}
              className="rounded bg-slate-100 border-slate-300 text-indigo-600"
            />
            <label className="text-sm text-slate-600 font-medium">Manual Lot Size</label>
            {manualLot && (
              <input
                type="number" min="0.01" step="0.01" value={lotSize}
                onChange={e => setLotSize(Math.max(0.01, Number(e.target.value)))}
                className="ml-auto w-24 bg-slate-50 border border-slate-200 text-slate-800 rounded p-1 text-sm text-right font-medium"
              />
            )}
          </div>
          <div>
            <label className="text-xs text-slate-500 uppercase font-bold">Risk:Reward</label>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="range" min="1" max="5" step="0.5" value={rrRatio}
                onChange={e => setRrRatio(Number(e.target.value))}
                className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
              <span className="text-sm font-mono font-bold text-slate-700 w-12 text-right">1:{rrRatio}</span>
            </div>
          </div>
        </div>

        {trade && (
          <div className="lg:col-span-2 bg-slate-50 border border-slate-200 rounded-xl p-5 shadow-sm">
            <StaleDataWarning pred={trade.pred} />
            <div className="flex justify-between items-start mb-4 pb-4 border-b border-slate-200 mt-2">
              <div>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Signal</div>
                <div className={`text-3xl font-black ${trade.signal === 'BUY' ? 'text-emerald-600' :
                  trade.signal === 'SELL' ? 'text-rose-600' : 'text-slate-400'
                  }`}>
                  {trade.signal}
                </div>
                <ConflictWarning pred={{ hasConflict: trade.hasConflict, conflictType: trade.conflictType }} />
              </div>
              <div className="text-right">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Confidence</div>
                <div className="text-2xl font-bold text-slate-800">{trade.pred.confidence}%</div>
                <div className="text-xs text-slate-500 mt-0.5">{trade.pred.dataPoints} real candles</div>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3 mb-4">
              <div className="bg-white p-3 rounded-lg border border-slate-100">
                <div className="text-[10px] uppercase text-slate-400 font-bold">Bull</div>
                <div className="text-xl font-bold text-emerald-600">{trade.bull}</div>
              </div>
              <div className="bg-white p-3 rounded-lg border border-slate-100">
                <div className="text-[10px] uppercase text-slate-400 font-bold">Bear</div>
                <div className="text-xl font-bold text-rose-600">{trade.bear}</div>
              </div>
              <div className="bg-white p-3 rounded-lg border border-slate-100 col-span-2">
                <div className="text-[10px] uppercase text-slate-400 font-bold mb-1">Strength</div>
                <div className="flex gap-1">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className={`h-2 flex-1 rounded-full ${i < trade.strength
                      ? trade.signal === 'BUY' ? 'bg-emerald-500'
                        : trade.signal === 'SELL' ? 'bg-rose-500'
                          : 'bg-slate-400'
                      : 'bg-slate-200'}`} />
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 border-t border-slate-200 pt-4">
              <div className="bg-rose-50 p-3 rounded-lg border border-rose-100">
                <div className="text-[10px] text-rose-400 font-bold uppercase mb-1">Stop Loss</div>
                <div className="flex justify-between items-baseline">
                  <span className="font-bold text-rose-700 font-mono">{formatPrice(trade.sl, selectedSymbol)}</span>
                  <span className="text-xs text-rose-500">-{trade.slPips} pips</span>
                </div>
                <div className="text-[10px] text-rose-400 mt-1">Risk: ${trade.riskAmt.toFixed(2)}</div>
              </div>
              <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-100">
                <div className="text-[10px] text-emerald-500 font-bold uppercase mb-1">Take Profit</div>
                <div className="flex justify-between items-baseline">
                  <span className="font-bold text-emerald-700 font-mono">{formatPrice(trade.tp, selectedSymbol)}</span>
                  <span className="text-xs text-emerald-600">+{trade.tpPips} pips</span>
                </div>
                <div className="text-[10px] text-emerald-500 mt-1">Profit: ${trade.profit.toFixed(2)}</div>
              </div>
            </div>

            <div className="flex justify-between items-center mt-3 text-xs font-mono text-slate-500 border-t border-slate-100 pt-3">
              <span>Entry: <strong className="text-slate-700">{formatPrice(trade.entry, selectedSymbol)}</strong></span>
              <span>Lot: <strong className="text-slate-700">{trade.lot}</strong></span>
              <span>R²: <strong className="text-indigo-600">{trade.pred.regression.r2.toFixed(2)}</strong></span>
            </div>
          </div>
        )}
      </div>

      {showAdv && trade?.pred && (
        <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            {
              label: 'RSI (14)',
              val: trade.pred.rsiValid ? trade.pred.rsi.toFixed(1) : 'N/A',
              sub: !trade.pred.rsiValid
                ? (trade.pred.dataQualityOk ? 'Insufficient data (<29 bars)' : 'Stale data detected')
                : trade.pred.rsi < 30 ? '⚡ Oversold (BUY bias)'
                  : trade.pred.rsi > 70 ? '⚡ Overbought (SELL bias)'
                    : trade.pred.rsi < 40 ? '⚠ Approaching oversold'
                      : trade.pred.rsi > 60 ? '⚠ Approaching overbought'
                        : 'Neutral',
              color: !trade.pred.rsiValid ? 'text-slate-400'
                : trade.pred.rsi >= 70 ? 'text-rose-500'
                  : trade.pred.rsi <= 30 ? 'text-emerald-600'
                    : 'text-slate-700',
            },
            {
              label: 'MACD Hist',
              val: trade.pred.macdValid ? trade.pred.macd.histogram.toFixed(5) : 'N/A',
              sub: !trade.pred.macdValid
                ? (trade.pred.dataQualityOk ? 'Insufficient data (<35 bars)' : 'Stale/flat prices')
                : trade.pred.macd.histogram > 0 ? 'Bullish momentum' : 'Bearish momentum',
              color: !trade.pred.macdValid ? 'text-slate-400'
                : trade.pred.macd.histogram > 0 ? 'text-emerald-600'
                  : 'text-rose-500',
            },
            {
              label: 'Boll %B',
              val: trade.pred.bbValid
                ? (trade.pred.bollinger.percentB * 100).toFixed(0) + '%' : 'N/A',
              sub: !trade.pred.bbValid
                ? (trade.pred.dataQualityOk ? 'Insufficient data (<20 bars)' : 'Zero std — stale prices')
                : trade.pred.bollinger.percentB <= 0.10 ? '⚡ Below lower band'
                  : trade.pred.bollinger.percentB < 0.20 ? '⚠ Near lower band'
                    : trade.pred.bollinger.percentB >= 0.90 ? '⚡ Above upper band'
                      : trade.pred.bollinger.percentB > 0.80 ? '⚠ Near upper band'
                        : 'Mid range',
              color: !trade.pred.bbValid ? 'text-slate-400' : 'text-blue-600',
            },
            {
              label: 'EMA Cross',
              val: !trade.pred.emaValid ? 'N/A'
                : trade.pred.ema12 > trade.pred.ema26 ? 'GOLDEN' : 'DEATH',
              sub: !trade.pred.emaValid
                ? (trade.pred.dataQualityOk ? 'Insufficient data (<26 bars)' : 'Stale data detected')
                : `12=${trade.pred.ema12.toFixed(4)} / 26=${trade.pred.ema26.toFixed(4)}`,
              color: !trade.pred.emaValid ? 'text-slate-400'
                : trade.pred.ema12 > trade.pred.ema26 ? 'text-emerald-600' : 'text-rose-500',
            },
          ].map(item => (
            <div key={item.label} className="bg-slate-50 p-3 rounded-lg border border-slate-100">
              <div className="text-xs text-slate-500 uppercase font-semibold">{item.label}</div>
              <div className={`font-mono font-bold text-lg ${item.color}`}>{item.val}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">{item.sub}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PAIR CARD — gradient ID stable per mount via useRef
// ─────────────────────────────────────────────────────────────────────────────
const PairCard = ({ item }) => {
  const gradientId = useRef(makeGradientId(item.pair.symbol)).current;
  const pred = item.prediction;
  const isBull = pred?.trend === 'bullish';
  const color = isBull ? '#10b981' : pred?.trend === 'bearish' ? '#f43f5e' : '#94a3b8';
  const signal = pred?.signal ?? 'HOLD';
  const sigColor =
    signal === 'BUY' ? 'text-emerald-600' :
      signal === 'SELL' ? 'text-rose-600' : 'text-slate-500';

  return (
    <div className={`bg-white rounded-2xl border hover:shadow-md transition-all p-5 overflow-hidden
      ${pred && !pred.dataQualityOk
        ? 'border-orange-200 bg-orange-50/30'
        : 'border-slate-200 hover:border-indigo-200'}`}
    >
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-bold text-xs border border-slate-200">
            {item.pair.base}
          </div>
          <div>
            <h3 className="font-bold text-slate-800 text-lg leading-none">{item.pair.symbol}</h3>
            <span className="text-xs text-slate-500">{item.pair.name}</span>
            <StaleDataWarning pred={pred} />
            <ConflictWarning pred={pred} />
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-mono font-bold text-slate-800">
            {formatPrice(item.currentRate, item.pair.symbol)}
          </div>
          {pred && (
            <div className={`text-xs flex items-center justify-end gap-1 font-semibold ${isBull ? 'text-emerald-600' : 'text-rose-600'}`}>
              {isBull
                ? <TrendingUp className="w-3 h-3" />
                : <TrendingDown className="w-3 h-3" />}
              {pred.confidence}% conf.
            </div>
          )}
        </div>
      </div>

      <div className="h-20 w-full mb-4">
        {item.history.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={item.history}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone" dataKey="price"
                stroke={color} fill={`url(#${gradientId})`}
                strokeWidth={2} dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-slate-400">
            Awaiting data…
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          {
            label: 'RSI',
            val: pred?.rsiValid ? pred.rsi.toFixed(0) : 'N/A',
            color: !pred?.rsiValid ? 'text-slate-400'
              : pred.rsi > 70 ? 'text-rose-500'
                : pred.rsi < 30 ? 'text-emerald-600'
                  : 'text-slate-600',
          },
          {
            label: 'MACD',
            val: pred?.macdValid ? pred.macd.histogram.toFixed(4) : 'N/A',
            color: !pred?.macdValid ? 'text-slate-400'
              : (pred.macd.histogram ?? 0) > 0 ? 'text-emerald-600' : 'text-rose-500',
          },
          {
            label: 'BB %B',
            val: pred?.bbValid ? (pred.bollinger.percentB * 100).toFixed(0) + '%' : 'N/A',
            color: !pred?.bbValid ? 'text-slate-400'
              : pred.bollinger.percentB < 0.20 ? 'text-emerald-600'
                : pred.bollinger.percentB > 0.80 ? 'text-rose-500'
                  : 'text-blue-600',
          },
          {
            label: 'Next',
            val: pred ? formatPrice(pred.predictedPrice, item.pair.symbol) : '—',
            color: pred
              ? pred.predictedPrice > item.currentRate ? 'text-emerald-600' : 'text-rose-500'
              : 'text-slate-400',
          },
          {
            label: 'Action',
            val: signal,
            color: sigColor,
          },
          {
            label: 'Bull/Bear',
            val: pred ? `${pred.bull}/${pred.bear}` : '—',
            color: pred?.bull > pred?.bear ? 'text-emerald-600'
              : pred?.bear > pred?.bull ? 'text-rose-500'
                : 'text-slate-500',
          },
        ].map(cell => (
          <div key={cell.label} className="bg-slate-50 rounded-lg p-2 text-center border border-slate-100">
            <div className="text-[10px] text-slate-400 uppercase font-semibold">{cell.label}</div>
            <div className={`text-sm font-mono font-bold ${cell.color} truncate`}>{cell.val}</div>
          </div>
        ))}
      </div>

      {pred && (
        <div className="mt-2 text-[10px] text-slate-400 text-center">
          {pred.dataPoints} candles · {pred.distinctPrices} distinct · R²={pred.regression.r2.toFixed(2)}
          · ATR={pred.atr.toFixed(pred.atr < 0.01 ? 5 : 2)}
          {!pred.dataQualityOk && (
            <span className="ml-1 text-orange-500 font-semibold">· ⚠ stale data</span>
          )}
          {pred.dataQualityOk && pred.regression.r2 < 0.15 && (
            <span className="ml-1 text-amber-500 font-semibold">· weak trend fit</span>
          )}
          {pred.dataQualityOk && !pred.emaValid && (
            <span className="ml-1 text-slate-400">· EMA warming up</span>
          )}
          {pred.dataQualityOk && !pred.macdValid && (
            <span className="ml-1 text-slate-400">· MACD warming up</span>
          )}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
const ForexDashboard = () => {
  const [pairsData, setPairsData] = useState([]);
  const [predictor] = useState(new ForexPredictor());
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dataSource, setDataSource] = useState('Initialising…');
  const [page, setPage] = useState(1);
  const PER_PAGE = 6;

  const [chatOpen, setChatOpen] = useState(false);

  const msgIdRef = useRef(0);
  const makeMsg = useCallback((role, content, extra = {}) => ({
    id: ++msgIdRef.current, role, content, ...extra,
  }), []);

  const [messages, setMessages] = useState(() => [
    { id: 1, role: 'assistant', content: 'QuantAI initialising. Market data is loading — ask me anything once it\'s ready.' },
  ]);
  const [input, setInput] = useState('');
  const msgEndRef = useRef(null);

  const pairsRef = useRef(pairsData);
  const messagesRef = useRef(messages);
  useLayoutEffect(() => { pairsRef.current = pairsData; }, [pairsData]);
  useLayoutEffect(() => { messagesRef.current = messages; }, [messages]);

  const groqAbortRef = useRef(null);
  const abortRef = useRef(null);

  const tickRunning = useRef(false);

  const rehydratePair = useCallback(symbol =>
    CURRENCY_PAIRS.find(p => p.symbol === symbol) ?? null, []);

  // FIX #7: When rate is null/falsy, preserve the predictor's history in the
  // returned object rather than returning `history: []`. The old code dropped
  // the history array, so on the next buildPairs call `prev.history` was empty,
  // causing the predictor to also lose its data. Now history is always fetched
  // from the predictor first, then used in both the null-rate early-return and
  // the normal path.
  const buildPairs = useCallback((tsMap, prevPairs = []) => {
    return CURRENCY_PAIRS.map(pairMeta => {
      const ts = tsMap[pairMeta.symbol];
      const prev = prevPairs.find(p => p.pair.symbol === pairMeta.symbol);

      if (ts && ts.length > 0) {
        predictor.setHistory(pairMeta.symbol, ts);
      } else if (prev?.history?.length) {
        predictor.setHistory(pairMeta.symbol, prev.history);
      }

      const rate = ts?.[ts.length - 1]?.price ?? prev?.currentRate ?? null;
      // FIX #7: Always read history from predictor (may have been set above)
      const history = predictor.getHistory(pairMeta.symbol).slice(-120);

      if (!rate) return { pair: pairMeta, currentRate: null, history, prediction: null };

      const prediction = predictor.predict(pairMeta.symbol, pairMeta);
      return { pair: pairMeta, currentRate: rate, history, prediction };
    });
  }, [predictor]);

  const initData = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    const cached = safeReadCache();
    if (cached) {
      const { timestamp, data: cd } = cached;
      const age = Date.now() - timestamp;
      cd.forEach(item => {
        const pair = rehydratePair(item.pair?.symbol);
        if (pair && item.history?.length) predictor.setHistory(pair.symbol, item.history);
      });
      const withPred = cd.map(item => {
        const pair = rehydratePair(item.pair?.symbol);
        if (!pair) return item;
        return { ...item, pair, prediction: predictor.predict(pair.symbol, pair) };
      }).filter(x => x.pair);
      setPairsData(withPred);
      setLastUpdated(timestamp);
      setDataSource(`Cached real data (${Math.round(age / 60000)}m old — refreshing…)`);
      setLoading(false);
      if (age < UPDATE_INTERVAL) { setDataSource('Twelve Data API (cached)'); return; }
    }

    setDataSource('Fetching live 5-min candles from Twelve Data…');
    try {
      const tsMap = await fetchAllTimeSeries(signal);
      if (signal.aborted) return;
      const pairs = buildPairs(tsMap);
      const now = Date.now();
      setPairsData(pairs);
      setLastUpdated(now);
      setPage(1);
      const liveCount = Object.keys(tsMap).length;
      const staleCount = pairs.filter(p => p.prediction && !p.prediction.dataQualityOk).length;
      setDataSource(
        `Twelve Data API — ${liveCount}/${CURRENCY_PAIRS.length} pairs live` +
        (staleCount > 0 ? ` · ${staleCount} pairs flagged stale` : '')
      );
      safeSetCache(pairs, now);
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[QuantAI] Init failed:', err);
      setDataSource('Error fetching data — check console');
    } finally {
      setLoading(false);
    }
  }, [predictor, buildPairs, rehydratePair]);

  // FIX #9: Save predictor histories before wiping them. If fetchAllTimeSeries
  // returns empty or the call is aborted, we restore from the saved snapshot so
  // tick-accumulated data that isn't in localStorage is not permanently lost.
  const forceRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setDataSource('Force refreshing from Twelve Data…');
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    // FIX #9: Capture current state (including tick-accumulated histories)
    // before clearing, so we can restore if the fetch fails or is aborted.
    const snapshot = pairsRef.current;
    safeRemoveCache();
    CURRENCY_PAIRS.forEach(p => predictor.setHistory(p.symbol, []));

    try {
      const tsMap = await fetchAllTimeSeries(signal);
      if (signal.aborted) return;

      if (Object.keys(tsMap).length === 0) {
        console.warn('[QuantAI] Force refresh returned empty tsMap — restoring last known state');
        // FIX #9: Restore saved histories into predictor before rebuilding
        snapshot.forEach(item => {
          if (item.history?.length) predictor.setHistory(item.pair.symbol, item.history);
        });
        setPairsData(snapshot);
        setDataSource('Refresh returned no data — showing last known state');
        return;
      }

      const pairs = buildPairs(tsMap);
      const now = Date.now();
      setPairsData(pairs);
      setLastUpdated(now);
      setPage(1);
      const liveCount = Object.keys(tsMap).length;
      const staleCount = pairs.filter(p => p.prediction && !p.prediction.dataQualityOk).length;
      setDataSource(
        `Twelve Data API — ${liveCount}/${CURRENCY_PAIRS.length} pairs live` +
        (staleCount > 0 ? ` · ${staleCount} pairs flagged stale` : '')
      );
      safeSetCache(pairs, now);
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[QuantAI] Force refresh failed:', err);
      // FIX #9: Also restore on unexpected errors
      snapshot.forEach(item => {
        if (item.history?.length) predictor.setHistory(item.pair.symbol, item.history);
      });
      setPairsData(snapshot);
      setDataSource('Refresh failed — showing last known state');
    } finally {
      setIsRefreshing(false);
    }
  }, [predictor, buildPairs]);

  // FIX #2: Added proper catch block to tickUpdate. Previously any non-abort
  // error thrown by fetchSpotPrice (e.g. HTTP 500, DNS failure, JSON parse
  // error) would propagate out of the try-finally as an unhandled rejection,
  // silently killing the tick loop for that interval. The catch now logs the
  // error and updates the UI status without crashing the component.
  const tickUpdate = useCallback(async () => {
    if (tickRunning.current) return;
    tickRunning.current = true;

    const tickController = abortRef.current;
    const signal = tickController?.signal;
    if (signal?.aborted) { tickRunning.current = false; return; }

    setDataSource('Updating spot prices…');
    const now = Date.now();

    try {
      const batch1 = await Promise.all(
        CURRENCY_PAIRS.slice(0, BATCH_SIZE).map(async p => ({
          symbol: p.symbol, rate: await fetchSpotPrice(p, signal),
        }))
      );
      if (signal?.aborted) return;

      await new Promise(r => {
        const t = setTimeout(r, 1_500);
        signal?.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true });
      });
      if (signal?.aborted) return;

      const batch2 = await Promise.all(
        CURRENCY_PAIRS.slice(BATCH_SIZE).map(async p => ({
          symbol: p.symbol, rate: await fetchSpotPrice(p, signal),
        }))
      );
      if (signal?.aborted) return;

      const allUpdates = [...batch1, ...batch2];
      const prevPairs = pairsRef.current;

      const nextPairs = prevPairs.map(item => {
        const upd = allUpdates.find(u => u.symbol === item.pair.symbol);
        const rate = upd?.rate ?? item.currentRate;
        if (!rate) return item;
        predictor.addTick(item.pair.symbol, rate);
        const prediction = predictor.predict(item.pair.symbol, item.pair);
        const history = predictor.getHistory(item.pair.symbol).slice(-120);
        return { ...item, currentRate: rate, history, prediction };
      });

      setPairsData(nextPairs);
      setLastUpdated(now);
      setDataSource('Twelve Data API (live tick)');
      safeSetCache(nextPairs, now);

    } catch (err) {
      // FIX #2: Catch non-abort errors — log them and update status
      if (err.name !== 'AbortError') {
        console.error('[QuantAI] Tick update error:', err);
        setDataSource('Tick update failed — will retry next interval');
      }
    } finally {
      tickRunning.current = false;
    }
  }, [predictor]);

  useEffect(() => {
    initData();
    return () => { if (abortRef.current) abortRef.current.abort(); };
  }, [initData]);

  useEffect(() => {
    if (loading) return;
    const id = setInterval(tickUpdate, UPDATE_INTERVAL);
    return () => clearInterval(id);
  }, [loading, tickUpdate]);

  useEffect(() => { msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const renderBold = text =>
    text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
      p.startsWith('**') && p.endsWith('**')
        ? <strong key={i}>{p.slice(2, -2)}</strong>
        : <span key={i}>{p}</span>
    );

  // FIX #1: handleChat now always removes all loading messages before exiting,
  // whether via successful reply, abort, or error fallback. The previous code
  // had `if (err.name === 'AbortError') return` which left the "⏳ Analysing…"
  // bubble on screen permanently when a new message was sent mid-request.
  // A helper function centralises the cleanup so no exit path can forget it.
  const handleChat = async e => {
    e.preventDefault();
    if (!input.trim()) return;
    const userMsg = input.trim();
    setInput('');

    if (groqAbortRef.current) groqAbortRef.current.abort();
    const groqController = new AbortController();
    groqAbortRef.current = groqController;

    const userEntry = makeMsg('user', userMsg);
    const loadingEntry = makeMsg('assistant', '⏳ Analysing…', { isLoading: true });

    const historyForGroq = [...messagesRef.current, userEntry]
      .filter(m => !m.isLoading)
      .slice(-12);

    setMessages(prev => [...prev, userEntry, loadingEntry]);

    // FIX #1: Always strip loading messages on any exit path
    const removeLoading = (extra = []) =>
      setMessages(prev => [...prev.filter(m => !m.isLoading), ...extra]);

    try {
      const reply = await sendToGroq(pairsRef.current, historyForGroq, groqController.signal);
      if (groqController.signal.aborted) {
        removeLoading(); // FIX #1: clean up on abort
        return;
      }
      removeLoading([makeMsg('assistant', reply)]);
    } catch (err) {
      if (err.name === 'AbortError') {
        removeLoading(); // FIX #1: clean up on abort error
        return;
      }
      console.error('[QuantAI] Groq error:', err);
      const fb = getFallbackReply(userMsg, pairsRef.current);
      removeLoading([makeMsg('assistant', fb)]);
    }
  };

  useEffect(() => {
    return () => { if (groqAbortRef.current) groqAbortRef.current.abort(); };
  }, []);

  const qualifiedPairs = pairsData.filter(d =>
    d.prediction?.trend !== 'neutral' &&
    (d.prediction?.confidence ?? 0) >= 50 &&
    (d.prediction?.regression?.r2 ?? 0) >= 0.15 &&
    d.prediction?.dataQualityOk
  );

  const bestData = (
    qualifiedPairs.length > 0
      ? qualifiedPairs
      : pairsData.filter(d => d.prediction !== null)
  ).reduce((p, c) =>
    (c.prediction?.confidence ?? 0) > (p?.prediction?.confidence ?? 0) ? c : p
    , null);

  const pagePairs = pairsData.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  if (MISSING_KEYS.length > 0 && pairsData.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full">
          <MissingKeysBanner keys={MISSING_KEYS} />
          <p className="text-xs text-slate-500 text-center mt-2">
            Create a <code className="bg-slate-100 px-1 rounded">.env</code> file in your project root and restart the dev server.
          </p>
        </div>
      </div>
    );
  }

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <RefreshCw className="w-10 h-10 animate-spin text-indigo-600" />
        <span className="text-slate-500 font-mono tracking-widest animate-pulse font-medium">
          LOADING REAL MARKET DATA…
        </span>
        <p className="text-xs text-slate-400 max-w-xs text-center">
          Fetching {TIMESERIES_SIZE} real 5-min OHLCV candles per pair from Twelve Data.
          No synthetic data is ever generated.
        </p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans">
      <nav className="border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-lg shadow-md shadow-indigo-200">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <h1 className="font-bold text-lg tracking-tight text-slate-900">
              QUANT<span className="text-indigo-600">AI</span>
            </h1>
            <span className="hidden sm:inline text-xs bg-indigo-50 text-indigo-600 border border-indigo-100 px-2 py-0.5 rounded-full font-medium">
              Real Data Only
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono text-slate-500">
            <button
              onClick={forceRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium disabled:opacity-50 transition-colors shadow-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{isRefreshing ? 'Refreshing…' : 'Refresh'}</span>
            </button>
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 border border-slate-200">
              <span className={`w-2 h-2 rounded-full ${isRefreshing ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`} />
              {isRefreshing ? 'UPDATING' : 'LIVE'}
            </span>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {MISSING_KEYS.length > 0 && <MissingKeysBanner keys={MISSING_KEYS} />}
        <APIStatusBanner dataSource={dataSource} lastUpdated={lastUpdated} isRefreshing={isRefreshing} />
        {bestData && <FeaturedRecommendation data={bestData} />}
        <TradeSettings currencyData={pairsData} />
        <PaginationControls
          currentPage={page}
          totalPages={Math.ceil(pairsData.length / PER_PAGE)}
          onPageChange={setPage}
          totalItems={pairsData.length}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {pagePairs.map(item => (
            <PairCard key={item.pair.symbol} item={item} />
          ))}
        </div>
      </main>

      {/* CHAT */}
      <div className="fixed bottom-6 right-6 z-50">
        {!chatOpen ? (
          <button
            onClick={() => setChatOpen(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white p-4 rounded-full shadow-xl shadow-indigo-300 transition-transform hover:scale-105"
          >
            <Bot className="w-6 h-6" />
          </button>
        ) : (
          <div className="bg-white border border-slate-200 w-80 sm:w-96 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="bg-slate-50 p-4 flex justify-between items-center border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="font-bold text-slate-800 text-sm">QuantAI Analyst</span>
                <span className="text-[10px] text-slate-400 font-mono">Llama 3.3 70B</span>
              </div>
              <button onClick={() => setChatOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="h-80 overflow-y-auto p-4 space-y-4 bg-white">
              {messages.map(m => (
                <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap
                    ${m.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-none'
                      : 'bg-slate-100 text-slate-700 border border-slate-200 rounded-bl-none'
                    }`}>
                    {renderBold(m.content)}
                  </div>
                </div>
              ))}
              <div ref={msgEndRef} />
            </div>
            <form onSubmit={handleChat} className="p-3 bg-slate-50 border-t border-slate-200 flex gap-2">
              <input
                className="flex-1 bg-white border border-slate-300 rounded-full px-4 py-2 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                placeholder="Ask about XAU, EUR/USD…"
                value={input}
                onChange={e => setInput(e.target.value)}
              />
              <button
                type="submit"
                disabled={!GROQ_API_KEY}
                title={!GROQ_API_KEY ? 'REACT_APP_GROQ_API_KEY not set' : 'Send'}
                className="bg-indigo-600 text-white p-2 rounded-full hover:bg-indigo-700 shadow-md shadow-indigo-200 disabled:opacity-40"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
            {!GROQ_API_KEY && (
              <p className="text-[10px] text-rose-500 text-center pb-2">
                Set REACT_APP_GROQ_API_KEY to enable AI chat.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ForexDashboard;