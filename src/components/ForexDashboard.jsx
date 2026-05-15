import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import {
    TrendingUp, TrendingDown, Activity, RefreshCw, ChevronDown, ChevronUp,
    Target, X, Send, Bot, Calculator, AlertCircle, Clock,
    AlertTriangle, Zap, BarChart3, Eye, EyeOff, DollarSign, ArrowUpRight,
    ArrowDownRight, Gauge, Globe, Minus, Award, Info, Layers, Volume2,
    Loader2,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// API CONFIGURATION
// Keys are read from .env file via process.env (REACT_APP_ prefix).
// ─────────────────────────────────────────────────────────────────────────────
const TWELVE_DATA_BASE = 'https://api.twelvedata.com';
const GROQ_BASE = 'https://api.groq.com/openai/v1/chat/completions';

const getKey = (name) => {
    if (name === 'td_api_key') return process.env.REACT_APP_TWELVE_DATA_API_KEY || '';
    if (name === 'groq_api_key') return process.env.REACT_APP_GROQ_API_KEY || '';
    return '';
};
const hasTwelveKey = () => Boolean(getKey('td_api_key'));
const hasGroqKey = () => Boolean(getKey('groq_api_key'));

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────
const UPDATE_INTERVAL = 300_000;
const BATCH_SIZE = 8;
const BATCH_DELAY_MS = 0;
const TIMESERIES_SIZE = 500;
const HTF_SIZE = 100;
const CACHE_KEY = 'forex_dashboard_v61';
const CACHE_SCHEMA_VERSION = 17;
const MAX_CACHE_BYTES = 4_500_000;
const MIN_DISTINCT_PRICES = 10;
const SPREAD_PIPS = 2;
const WARMUP_CANDLES = 40;

const WF_TRAIN_RATIO = 0.60;
const WF_MIN_TEST_TRADES = 5;
const WF_WINDOW_CANDLES = 30;
const WF_BT_WARMUP = 35;
const WF_CANDLE_BUCKET = 5;
const WF_CACHE_MAX = 60;
const QUALIFIED_CONFIDENCE_MIN = 40;

const VOLUME_SMA_PERIOD = 20;
const VOLUME_MULTIPLIER = 1.2;
const MACD_VALIDITY_ATR_RATIO = 0.005;
const HTF_SUPPRESS_ADX_THRESHOLD = 25;
const DETERMINISTIC_SLIPPAGE_PIPS = 1.0;

const _jpyState = { rate: 155, timestamp: 0 };
const updateJpyFallback = (rate) => {
    if (rate && isFinite(rate) && rate > 0) { _jpyState.rate = rate; _jpyState.timestamp = Date.now(); }
};

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

const PAIRS_CONFIG_HASH = CURRENCY_PAIRS.map(p => `${p.symbol}:${p.pipValue}:${p.pipDigits}`).join('|');

const getPipUSD = (pair, currentRate) => {
    if (pair.lotPipUSD !== null) return { value: pair.lotPipUSD, usingFallback: false, fallbackAgeMinutes: 0 };
    const isJPY = pair.quote === 'JPY';
    if (!isJPY) {
        // Safety fallback for any future non-JPY pair without a fixed lotPipUSD
        return { value: 10, usingFallback: true, fallbackAgeMinutes: null };
    }
    // For ALL JPY-quoted pairs, pip value in USD = (pipValue / USDJPY_rate) × 100,000.
    // Only USDJPY's own currentRate IS the USDJPY rate; cross pairs (AUDJPY, etc.)
    // must use the stored USDJPY rate to avoid converting into the base currency
    // instead of USD.
    const isUSDBase = pair.base === 'USD';
    if (isUSDBase && currentRate && isFinite(currentRate) && currentRate > 0) {
        // This IS the live USDJPY rate — update the global fallback and use it directly
        updateJpyFallback(currentRate);
        const value = (pair.pipValue / currentRate) * 100_000;
        return { value, usingFallback: false, fallbackAgeMinutes: 0 };
    }
    // Cross pair (e.g. AUDJPY) or no live rate: use the stored USDJPY rate
    const usdjpyRate = _jpyState.rate;
    const value = (pair.pipValue / usdjpyRate) * 100_000;
    const fallbackAgeMinutes = _jpyState.timestamp > 0
        ? Math.round((Date.now() - _jpyState.timestamp) / 60_000) : null;
    return { value, usingFallback: true, fallbackAgeMinutes };
};

// ─────────────────────────────────────────────────────────────────────────────
// SESSION AWARENESS
// ─────────────────────────────────────────────────────────────────────────────
const SESSIONS = {
    sydney: { name: 'Sydney', open: 21, close: 6, color: '#06b6d4', pairs: ['AUDUSD', 'AUDJPY', 'USDCAD'] },
    tokyo: { name: 'Tokyo', open: 0, close: 9, color: '#0ea5e9', pairs: ['USDJPY', 'AUDJPY', 'USDCAD'] },
    london: { name: 'London', open: 7, close: 16, color: '#3b82f6', pairs: ['GBPUSD', 'EURUSD', 'USDCHF', 'USDCAD'] },
    newyork: { name: 'New York', open: 12, close: 21, color: '#10b981', pairs: ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCAD', 'XAUUSD'] },
};

const getActiveSessions = (utcHour) =>
    Object.entries(SESSIONS).filter(([, s]) => {
        if (s.open < s.close) return utcHour >= s.open && utcHour < s.close;
        return utcHour >= s.open || utcHour < s.close;
    }).map(([key, s]) => ({ key, ...s }));

const getSessionQuality = (symbol, activeSessions) => {
    const relevant = activeSessions.filter(s => s.pairs.includes(symbol));
    if (relevant.length === 0) return { quality: 'low', label: 'Off-session', score: 0.5 };
    if (relevant.length >= 2) return { quality: 'high', label: 'Session overlap', score: 1.2 };
    return { quality: 'medium', label: relevant[0].name + ' session', score: 1.0 };
};

const getSessionOpenPrice = (candles, activeSessions) => {
    if (!candles || candles.length === 0) return null;
    const nowMs = Date.now();
    const utcHour = new Date(nowMs).getUTCHours();
    const todaySessions = activeSessions.filter(s => s.open <= utcHour);
    if (todaySessions.length === 0) return candles[0]?.price ?? null;
    const sessionOpenHour = Math.min(...todaySessions.map(s => s.open));
    const utcMidnight = new Date(nowMs);
    utcMidnight.setUTCHours(0, 0, 0, 0);
    const sessionStartMs = utcMidnight.getTime() + sessionOpenHour * 3_600_000;
    const found = candles.find(c => c.timestamp >= sessionStartMs);
    return (found ?? candles[0])?.price ?? null;
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────
const formatPrice = (price, symbol) => {
    if (price == null || !isFinite(price) || price === 0) return '---';
    const pair = CURRENCY_PAIRS.find(p => p.symbol === symbol);
    return Number(price).toFixed(pair ? pair.pipDigits : 4);
};

const countDistinctPrices = candles => {
    if (!candles || candles.length === 0) return 0;
    return new Set(candles.map(c => c.price)).size;
};

const makeGradientId = symbol => `grad-${symbol.replace(/[^a-zA-Z0-9]/g, '')}`;

const formatPctChange = (current, previous) => {
    if (!current || !previous || previous === 0) return { value: 0, text: '0.00%' };
    const pct = ((current - previous) / previous) * 100;
    return { value: pct, text: `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` };
};

const renderBold = text =>
    text.split('\n').map((line, li) => (
        <p key={li} className={li > 0 ? 'mt-1.5' : ''}>
            {line.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
                p.startsWith('**') && p.endsWith('**')
                    ? <strong key={i} className="text-cyan-600">{p.slice(2, -2)}</strong>
                    : <span key={i}>{p}</span>
            )}
        </p>
    ));

const formatMacdNormalised = (val, atr, pipValue) => {
    if (val == null || !isFinite(val)) return '—';
    if (atr && isFinite(atr) && atr > 0) {
        const ratio = (val / atr) * 100;
        return `${ratio >= 0 ? '+' : ''}${ratio.toFixed(1)}%`;
    }
    const digits = pipValue <= 0.0001 ? 6 : pipValue <= 0.01 ? 4 : 2;
    return val.toFixed(digits);
};

const minBalanceForRisk = (pair, effectiveSLPips, riskPct, currentRate) => {
    const { value: pipUSD } = getPipUSD(pair, currentRate);
    const minLotRisk = 0.01 * effectiveSLPips * pipUSD;
    return Math.ceil((minLotRisk / (riskPct / 100)) / 100) * 100;
};

// ─────────────────────────────────────────────────────────────────────────────
// RATE LIMITER
// ─────────────────────────────────────────────────────────────────────────────
class RateLimiter {
    constructor(maxPerMinute = 6) { this.max = maxPerMinute; this.calls = []; }
    async wait() { return this._acquire(); }
    async _acquire() {
        const now = Date.now();
        this.calls = this.calls.filter(t => now - t < 60_000);
        if (this.calls.length >= this.max) {
            const waitMs = 60_000 - (now - this.calls[0]) + 500;
            if (waitMs > 0) {
                await new Promise(r => setTimeout(r, waitMs));
                this.calls = this.calls.filter(t => Date.now() - t < 60_000);
            }
        }
        this.calls.push(Date.now());
    }
    reset() { this.calls = []; }
}
const rateLimiter = new RateLimiter(6);

// ─────────────────────────────────────────────────────────────────────────────
// FETCH HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const safeFetch = async (url, signal) => {
    const res = await fetch(url, signal ? { signal } : {});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
};

const twelveDataUrl = (endpoint, params = {}) => {
    const qs = new URLSearchParams({ ...params, apikey: getKey('td_api_key') }).toString();
    return `${TWELVE_DATA_BASE}/${endpoint}?${qs}`;
};

const twelveSymbol = pair => pair.base === 'XAU' ? 'XAU/USD' : `${pair.base}/${pair.quote}`;

const parseCandles = (values, defaultLength) =>
    [...values].reverse().map((c, i) => ({
        price: parseFloat(c.close),
        open: parseFloat(c.open),
        high: parseFloat(c.high),
        low: parseFloat(c.low),
        volume: parseFloat(c.volume || 0),
        timestamp: new Date(c.datetime).getTime() || Date.now() - (defaultLength - i) * 300_000,
    })).filter(c => isFinite(c.price) && c.price > 0);

const fetchTimeSeries = async (pair, signal) => {
    if (!hasTwelveKey()) { console.warn(`[${pair.symbol}] No API key`); return null; }
    try {
        await rateLimiter.wait();
        if (signal?.aborted) return null;
        const url = twelveDataUrl('time_series', { symbol: twelveSymbol(pair), interval: '5min', outputsize: TIMESERIES_SIZE });
        const json = await safeFetch(url, signal);
        if (json?.status === 'error') { console.warn(`[${pair.symbol}] API:`, json.message); return null; }
        if (!Array.isArray(json?.values) || json.values.length < 5) return null;
        const candles = parseCandles(json.values, json.values.length);
        if (countDistinctPrices(candles) < MIN_DISTINCT_PRICES) return null;
        if (pair.symbol === 'USDJPY' && candles.length > 0) updateJpyFallback(candles[candles.length - 1].price);
        return candles;
    } catch (err) {
        if (err.name === 'AbortError') return null;
        console.error(`[${pair.symbol}] fetchTimeSeries:`, err.message);
        return null;
    }
};

const fetchHTFCandles = async (pair, signal) => {
    if (!hasTwelveKey()) return null;
    try {
        await rateLimiter.wait();
        if (signal?.aborted) return null;
        const url = twelveDataUrl('time_series', { symbol: twelveSymbol(pair), interval: '1h', outputsize: HTF_SIZE });
        const json = await safeFetch(url, signal);
        if (json?.status === 'error' || !Array.isArray(json?.values) || json.values.length < 10) return null;
        return parseCandles(json.values, json.values.length);
    } catch (err) {
        if (err.name === 'AbortError') return null;
        return null;
    }
};

const fetchSpotFallback = async (pair, signal) => {
    if (pair.base === 'XAU') {
        if (!hasTwelveKey()) return null;
        try {
            await rateLimiter.wait();
            if (signal?.aborted) return null;
            const url = twelveDataUrl('price', { symbol: 'XAU/USD' });
            const d = await safeFetch(url, signal);
            if (d?.price && !isNaN(parseFloat(d.price))) return { price: parseFloat(d.price), isStale: false };
        } catch { /* intentional */ }
        return null;
    }
    const apis = [
        async () => {
            const d = await safeFetch(`https://api.frankfurter.app/latest?from=${pair.base}&to=${pair.quote}`, signal);
            const v = d?.rates?.[pair.quote];
            return (v && !isNaN(parseFloat(v))) ? parseFloat(v) : null;
        },
        async () => {
            const d = await safeFetch(`https://open.er-api.com/v6/latest/${pair.base}`, signal);
            const v = d?.rates?.[pair.quote];
            return (v && !isNaN(parseFloat(v))) ? parseFloat(v) : null;
        },
    ];
    for (const fn of apis) {
        try {
            const v = await fn();
            if (v && !isNaN(v)) return { price: v, isStale: true };
        } catch (err) { if (signal?.aborted) return null; }
    }
    return null;
};

const fetchTimeSeriesWithRetry = async (pair, signal, retries = 2) => {
    for (let attempt = 0; attempt <= retries; attempt++) {
        if (signal?.aborted) return null;
        const result = await fetchTimeSeries(pair, signal);
        if (result) return result;
        if (attempt < retries) {
            await new Promise(r => {
                const t = setTimeout(r, (attempt + 1) * 5_000);
                signal?.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true });
            });
        }
    }
    return null;
};

const fetchAllTimeSeries = async (signal) => {
    const out = {};
    for (let i = 0; i < CURRENCY_PAIRS.length; i += BATCH_SIZE) {
        if (signal?.aborted) break;
        const batch = CURRENCY_PAIRS.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
            batch.map(async p => {
                const [series, htf] = await Promise.all([
                    fetchTimeSeriesWithRetry(p, signal),
                    fetchHTFCandles(p, signal),
                ]);
                return { symbol: p.symbol, series, htf };
            })
        );
        for (const result of results) {
            if (result.status === 'fulfilled' && result.value.series) {
                out[result.value.symbol] = { series: result.value.series, htf: result.value.htf };
            }
        }
        if (i + BATCH_SIZE < CURRENCY_PAIRS.length) {
            await new Promise(r => {
                const t = setTimeout(r, BATCH_DELAY_MS);
                signal?.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true });
            });
        }
    }
    return out;
};

const fetchSpotPrice = async (pair, signal) => {
    if (!hasTwelveKey()) {
        const fb = await fetchSpotFallback(pair, signal);
        return fb ? fb.price : null;
    }
    try {
        await rateLimiter.wait();
        if (signal?.aborted) return null;
        const url = twelveDataUrl('price', { symbol: twelveSymbol(pair) });
        const d = await safeFetch(url, signal);
        if (d?.price && !isNaN(parseFloat(d.price))) {
            const rate = parseFloat(d.price);
            if (pair.symbol === 'USDJPY') updateJpyFallback(rate);
            return rate;
        }
    } catch (err) { if (signal?.aborted) return null; }
    const fb = await fetchSpotFallback(pair, signal);
    return fb ? fb.price : null;
};

// ─────────────────────────────────────────────────────────────────────────────
// CACHE
// ─────────────────────────────────────────────────────────────────────────────
const serializeForCache = pairs => pairs.map(item => ({
    pair: item.pair, currentRate: item.currentRate, history: item.history, htfHistory: item.htfHistory,
}));

const safeSetCache = (pairs, timestamp) => {
    try {
        const payload = JSON.stringify({
            timestamp, schemaVersion: CACHE_SCHEMA_VERSION, pairsConfigHash: PAIRS_CONFIG_HASH,
            data: serializeForCache(pairs),
        });
        if (new TextEncoder().encode(payload).length > MAX_CACHE_BYTES) return;
        localStorage.setItem(CACHE_KEY, payload);
    } catch (err) {
        if (err.name !== 'QuotaExceededError' && err.name !== 'NS_ERROR_DOM_QUOTA_REACHED')
            console.warn('Cache write failed:', err.message);
    }
};

const safeRemoveCache = () => { try { localStorage.removeItem(CACHE_KEY); } catch { /* intentional */ } };

const safeReadCache = () => {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION) { safeRemoveCache(); return null; }
        if (parsed.pairsConfigHash !== PAIRS_CONFIG_HASH) { safeRemoveCache(); return null; }
        if (!Array.isArray(parsed.data)) { safeRemoveCache(); return null; }
        if (!parsed.data.every(item => item?.pair?.symbol && Array.isArray(item.history))) {
            safeRemoveCache(); return null;
        }
        return parsed;
    } catch { safeRemoveCache(); return null; }
};

// ─────────────────────────────────────────────────────────────────────────────
// MATH HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const linearRegressionOnPrices = (prices) => {
    const n = prices.length;
    if (n < 3) return { slope: 0, intercept: 0, r2: 0 };
    let sx = 0, sy = 0, sxy = 0, sx2 = 0;
    for (let i = 0; i < n; i++) { sx += i; sy += prices[i]; sxy += i * prices[i]; sx2 += i * i; }
    const denom = n * sx2 - sx * sx;
    if (denom === 0) return { slope: 0, intercept: 0, r2: 0 };
    const slope = (n * sxy - sx * sy) / denom;
    const intercept = (sy - slope * sx) / n;
    const yMean = sy / n;
    let ssRes = 0, ssTot = 0;
    for (let i = 0; i < n; i++) {
        ssRes += (prices[i] - (intercept + slope * i)) ** 2;
        ssTot += (prices[i] - yMean) ** 2;
    }
    const r2 = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);
    return { slope, intercept, r2 };
};

const safeMin = arr => arr.length > 0 ? Math.min(...arr) : null;
const safeMax = arr => arr.length > 0 ? Math.max(...arr) : null;

const findSwingLevels = (candles, lookback = 5) => {
    const highs = [], lows = [];
    for (let i = lookback; i < candles.length - lookback; i++) {
        const h = candles[i].high ?? candles[i].price;
        const l = candles[i].low ?? candles[i].price;
        if (candles.slice(i - lookback, i).every(x => (x.high ?? x.price) <= h) &&
            candles.slice(i + 1, i + lookback + 1).every(x => (x.high ?? x.price) <= h)) highs.push(h);
        if (candles.slice(i - lookback, i).every(x => (x.low ?? x.price) >= l) &&
            candles.slice(i + 1, i + lookback + 1).every(x => (x.low ?? x.price) >= l)) lows.push(l);
    }
    return { swingHighs: highs.slice(-3), swingLows: lows.slice(-3) };
};

const computeNearestSR = (swingLevels, cur) => {
    const higherHighs = swingLevels.swingHighs.filter(h => isFinite(h) && h > cur);
    const lowerLows = swingLevels.swingLows.filter(l => isFinite(l) && l < cur);
    return { nearestResistance: safeMin(higherHighs), nearestSupport: safeMax(lowerLows) };
};

const computeADX = (candles, period = 14) => {
    const hasOHLC = candles.some(c => c.high !== undefined && c.low !== undefined && c.high !== c.low);
    if (!hasOHLC || candles.length < period * 2) return { adx: null, trending: false };
    const trueRanges = [], dmPlus = [], dmMinus = [];
    for (let i = 1; i < candles.length; i++) {
        const h = candles[i].high ?? candles[i].price;
        const l = candles[i].low ?? candles[i].price;
        const ph = candles[i - 1].high ?? candles[i - 1].price;
        const pl = candles[i - 1].low ?? candles[i - 1].price;
        const pc = candles[i - 1].price;
        trueRanges.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
        const up = h - ph, dn = pl - l;
        dmPlus.push(up > dn && up > 0 ? up : 0);
        dmMinus.push(dn > up && dn > 0 ? dn : 0);
    }
    const smooth = (arr, p) => {
        let val = arr.slice(0, p).reduce((a, b) => a + b, 0);
        const out = [val];
        for (let i = p; i < arr.length; i++) { val = val - val / p + arr[i]; out.push(val); }
        return out;
    };
    const atr14 = smooth(trueRanges, period);
    const dmp14 = smooth(dmPlus, period);
    const dmm14 = smooth(dmMinus, period);
    const dx = atr14.map((atr, i) => {
        if (atr === 0) return 0;
        const diP = (dmp14[i] / atr) * 100;
        const diM = (dmm14[i] / atr) * 100;
        return Math.abs(diP - diM) / (diP + diM + 0.0001) * 100;
    });
    let adxVal = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < dx.length; i++) adxVal = (adxVal * (period - 1) + dx[i]) / period;
    return { adx: adxVal, trending: adxVal > 20 };
};

const calcEMA = (prices, period) => {
    if (!prices || prices.length < period) return null;
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
    return ema;
};

const computeVolumeConfirmation = (candles) => {
    if (!candles || candles.length < VOLUME_SMA_PERIOD + 1) return { confirmed: null, ratio: null, hasData: false };
    const vols = candles.map(c => c.volume || 0);
    const windowVols = vols.slice(-(VOLUME_SMA_PERIOD + 1));
    const nonZeroCount = windowVols.filter(v => v > 0).length;
    const hasRealVolData = nonZeroCount > VOLUME_SMA_PERIOD * 0.5;
    if (!hasRealVolData) return { confirmed: null, ratio: null, hasData: false };
    const smaVols = vols.slice(-(VOLUME_SMA_PERIOD + 1), -1);
    const sma = smaVols.reduce((a, b) => a + b, 0) / VOLUME_SMA_PERIOD;
    if (sma === 0) return { confirmed: null, ratio: null, hasData: false };
    const ratio = vols[vols.length - 1] / sma;
    return { confirmed: ratio >= VOLUME_MULTIPLIER, ratio, hasData: true };
};

const computeHTFAlignment = (htfCandles) => {
    if (!htfCandles || htfCandles.length < 30) return { aligned: null, htfTrend: null, htfAdx: null, htfTrending: false };
    const htfPrices = htfCandles.map(c => c.price);
    const htfEma12 = calcEMA(htfPrices, 12);
    const htfEma26 = calcEMA(htfPrices, 26);
    if (htfEma12 === null || htfEma26 === null) return { aligned: null, htfTrend: null, htfAdx: null, htfTrending: false };
    const htfTrend = htfEma12 > htfEma26 ? 'bullish' : 'bearish';
    const htfAdxResult = computeADX(htfCandles);
    return { aligned: true, htfTrend, htfEma12, htfEma26, htfAdx: htfAdxResult.adx, htfTrending: htfAdxResult.trending };
};

const _rsiCalc = (prices, period = 14) => {
    if (prices.length < period * 2 + 1) return null;
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
};

const _emaCalcSimple = (prices, period) => {
    if (prices.length < period) return null;
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
    return ema;
};

const simulateFill = (candle, direction, pair) => {
    const slippageCost = DETERMINISTIC_SLIPPAGE_PIPS * pair.pipValue;
    const spreadCost = SPREAD_PIPS * pair.pipValue;
    if (direction === 'BUY') return (candle.open ?? candle.price) + spreadCost + slippageCost;
    return (candle.open ?? candle.price) - spreadCost - slippageCost;
};

// ─────────────────────────────────────────────────────────────────────────────
// WALK-FORWARD BACKTEST
// ─────────────────────────────────────────────────────────────────────────────
const runWalkForwardBacktest = (candles, pair) => {
    const clean = candles.filter(c => !c._isTick);
    const neededCandles = Math.ceil(80 / (1 - WF_TRAIN_RATIO)) + WF_WINDOW_CANDLES + WF_BT_WARMUP;
    if (!clean || clean.length < neededCandles) {
        return { insufficient: true, reason: `Need ≥${neededCandles} candles, have ${clean?.length ?? 0}`, total: 0 };
    }
    const trainEnd = Math.floor(clean.length * WF_TRAIN_RATIO);
    const testStart = trainEnd;
    const maxLoopStart = clean.length - WF_WINDOW_CANDLES;
    const loopStart = testStart + WF_BT_WARMUP;
    if (loopStart >= maxLoopStart) return { insufficient: true, reason: `Test window too small`, total: 0 };

    const results = { total: 0, wins: 0, losses: 0, pnl: 0 };
    const scoreBuckets = {};
    const getBucket = absScore => absScore >= 6 ? '6+' : absScore >= 3 ? '3-5' : '0-2';

    for (let i = loopStart; i < maxLoopStart; i += WF_CANDLE_BUCKET) {
        const slice = clean.slice(0, i);
        const prices = slice.map(c => c.price);
        if (prices.length < 35) continue;
        const e12 = _emaCalcSimple(prices, 12);
        const e26 = _emaCalcSimple(prices, 26);
        if (e12 === null || e26 === null) continue;
        const rsi = _rsiCalc(prices);
        if (rsi === null) continue;
        let atrSum = 0;
        const atrPeriod = 14;
        for (let j = Math.max(1, slice.length - atrPeriod); j < slice.length; j++)
            atrSum += Math.abs(slice[j].price - slice[j - 1].price);
        const atr = atrSum / Math.min(atrPeriod, slice.length - 1) || pair.pipValue * 10;
        const slDist = Math.max(pair.pipValue * 15, atr * 2);
        const tpDist = slDist * 2;
        let signal = null, scoreAbs = 0;
        if (e12 > e26 && rsi >= 25 && rsi <= 55) { signal = 'BUY'; scoreAbs = Math.round((55 - rsi) / 10 + 1); }
        else if (e12 < e26 && rsi >= 45 && rsi <= 75) { signal = 'SELL'; scoreAbs = Math.round((rsi - 45) / 10 + 1); }
        if (!signal) continue;
        const volConf = computeVolumeConfirmation(slice);
        if (volConf.confirmed === false) continue;
        const entryCandle = clean[i];
        const fillPrice = simulateFill(entryCandle, signal, pair);
        const cur = fillPrice;
        const future = clean.slice(i + 1, i + WF_WINDOW_CANDLES);
        let outcome = 'open';
        for (const fc of future) {
            if (signal === 'BUY') { if (fc.high >= cur + tpDist) { outcome = 'win'; break; } if (fc.low <= cur - slDist) { outcome = 'loss'; break; } }
            else { if (fc.low <= cur - tpDist) { outcome = 'win'; break; } if (fc.high >= cur + slDist) { outcome = 'loss'; break; } }
        }
        if (outcome === 'open') continue;
        results.total++;
        const pipPnl = outcome === 'win' ? tpDist / pair.pipValue : -(slDist / pair.pipValue);
        results.pnl += pipPnl;
        if (outcome === 'win') results.wins++; else results.losses++;
        const bucket = getBucket(scoreAbs);
        if (!scoreBuckets[bucket]) scoreBuckets[bucket] = { wins: 0, total: 0 };
        scoreBuckets[bucket].total++;
        if (outcome === 'win') scoreBuckets[bucket].wins++;
    }
    if (results.total < WF_MIN_TEST_TRADES)
        return { insufficient: true, reason: `Only ${results.total} test trades (need ≥${WF_MIN_TEST_TRADES})`, total: results.total };

    results.winRate = (results.wins / results.total) * 100;
    results.expectancy = results.pnl / results.total;
    results.trainCandles = trainEnd;
    results.testCandles = clean.length - testStart;
    results.isWalkForward = true;
    results.insufficient = false;
    results.calibration = {};
    for (const [bucket, data] of Object.entries(scoreBuckets)) {
        if (data.total >= 3) results.calibration[bucket] = (data.wins / data.total) * 100;
    }
    return results;
};

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL ENGINE
// ─────────────────────────────────────────────────────────────────────────────
const MAX_BULL_BEAR = 12;
const REALISTIC_MAX_SCORE = 8;
const MAX_MOMENTUM_CONTRIB = 5;

const computeSignal = ({ rsi, rsiValid, macdHist, macdValid, ema12, ema26, emaValid, bbPercentB, bbValid, regSlope, adxTrending, volumeConf, htfAlignment }) => {
    let bull = 0, bear = 0;
    if (emaValid) { if (ema12 > ema26) bull += 2; else bear += 2; }
    if (regSlope > 0) bull += 1; else if (regSlope < 0) bear += 1;
    if (macdValid) { if (macdHist > 0) bull += 2; else if (macdHist < 0) bear += 2; }
    let rsiBull = 0, rsiBear = 0;
    if (rsiValid) {
        if (rsi <= 20) rsiBull += 4; else if (rsi <= 30) rsiBull += 3; else if (rsi < 40) rsiBull += 1;
        else if (rsi >= 80) rsiBear += 4; else if (rsi >= 70) rsiBear += 3; else if (rsi > 60) rsiBear += 1;
    }
    let bbBull = 0, bbBear = 0;
    if (bbValid) {
        if (bbPercentB < 0.10) bbBull += 3; else if (bbPercentB < 0.20) bbBull += 2; else if (bbPercentB < 0.30) bbBull += 1;
        else if (bbPercentB > 0.90) bbBear += 3; else if (bbPercentB > 0.80) bbBear += 2; else if (bbPercentB > 0.70) bbBear += 1;
    }
    bull += Math.min(MAX_MOMENTUM_CONTRIB, rsiBull + bbBull);
    bear += Math.min(MAX_MOMENTUM_CONTRIB, rsiBear + bbBear);
    const htfTrend = htfAlignment?.htfTrend ?? null;
    if (htfTrend === 'bullish') bull += 1; else if (htfTrend === 'bearish') bear += 1;
    const netScore = bull - bear;
    const emaAlignedBull = !emaValid || ema12 >= ema26;
    const emaAlignedBear = !emaValid || ema12 <= ema26;
    const deepOversold = rsiValid && bbValid && (rsi <= 30 || bbPercentB < 0.10) && bull >= 2 && emaAlignedBull;
    const deepOverbought = rsiValid && bbValid && (rsi >= 70 || bbPercentB > 0.90) && bear >= 2 && emaAlignedBear;
    const threshold = adxTrending ? 3 : 5;
    let rawSignal;
    if (deepOversold && netScore > -threshold) rawSignal = 'BUY';
    else if (deepOverbought && netScore < threshold) rawSignal = 'SELL';
    else if (netScore >= threshold) rawSignal = 'BUY';
    else if (netScore <= -threshold) rawSignal = 'SELL';
    else rawSignal = 'HOLD';
    let signal = rawSignal, htfSuppressed = false;
    if (htfTrend !== null && htfAlignment?.htfTrending && (htfAlignment?.htfAdx ?? 0) >= HTF_SUPPRESS_ADX_THRESHOLD) {
        if (rawSignal === 'BUY' && htfTrend === 'bearish') { signal = 'HOLD'; htfSuppressed = true; }
        if (rawSignal === 'SELL' && htfTrend === 'bullish') { signal = 'HOLD'; htfSuppressed = true; }
    }
    let volSuppressed = false;
    if (volumeConf?.hasData && volumeConf?.confirmed === false && signal !== 'HOLD') {
        signal = 'HOLD'; volSuppressed = true;
    }
    const trend = signal === 'BUY' ? 'bullish' : signal === 'SELL' ? 'bearish' : 'neutral';
    const strength = Math.min(5, Math.round(Math.abs(netScore) / REALISTIC_MAX_SCORE * 5));
    const hasOversoldConflict = rsiValid && ((signal === 'SELL' && (rsi < 35 || (bbValid && bbPercentB < 0.25))) || (signal === 'BUY' && macdValid && macdHist < 0 && rsi < 35));
    const hasTrendingSellConflict = signal === 'SELL' && adxTrending && rsiValid && rsi < 60;
    const hasTrendingBuyConflict = signal === 'BUY' && adxTrending && rsiValid && rsi > 40;
    const hasOverboughtConflict = rsiValid && ((signal === 'BUY' && (rsi > 65 || (bbValid && bbPercentB > 0.75))) || (signal === 'SELL' && macdValid && macdHist > 0 && rsi < 65));
    const hasConflict = hasOversoldConflict || hasOverboughtConflict || hasTrendingSellConflict || hasTrendingBuyConflict;
    const conflictType = hasOversoldConflict ? 'oversold' : hasOverboughtConflict ? 'overbought' : hasTrendingSellConflict ? 'trending-sell' : hasTrendingBuyConflict ? 'trending-buy' : null;
    return { bull, bear, signal, rawSignal, trend, strength, netScore, hasConflict, conflictType, htfSuppressed, volSuppressed };
};

// ─────────────────────────────────────────────────────────────────────────────
// PREDICTOR ENGINE
// ─────────────────────────────────────────────────────────────────────────────
class ForexPredictor {
    constructor() { this._store = {}; this._htfStore = {}; this._backtestCache = {}; }
    setHistory(symbol, candles) { this._store[symbol] = (candles || []).slice(-TIMESERIES_SIZE); }
    setHTFHistory(symbol, candles) { this._htfStore[symbol] = (candles || []).slice(-HTF_SIZE); }
    getHistory(symbol) { return this._store[symbol] || []; }
    getHTFHistory(symbol) { return this._htfStore[symbol] || []; }

    addTick(symbol, price) {
        if (!this._store[symbol]) this._store[symbol] = [];
        const store = this._store[symbol];
        if (store.length > 0) {
            const last = store[store.length - 1];
            if (last._isTick) {
                last.high = Math.max(last.high ?? last.price, price);
                last.low = Math.min(last.low ?? last.price, price);
                last.price = price; last.timestamp = Date.now();
                while (store.length > TIMESERIES_SIZE) store.shift();
                return;
            }
        }
        store.push({ price, high: price, low: price, open: price, volume: 0, timestamp: Date.now(), _isTick: true });
        while (store.length > TIMESERIES_SIZE) store.shift();
    }

    _rsi(prices, period = 14) { return _rsiCalc(prices, period); }

    _macd(prices, pipValue = 0.0001, atr = null) {
        if (prices.length < 35) return { valid: false, macd: 0, signal: 0, histogram: 0 };
        const emaSeries = (p, len) => {
            const k = 2 / (len + 1), out = [];
            let ema = p.slice(0, len).reduce((a, b) => a + b, 0) / len;
            out.push(ema);
            for (let i = len; i < p.length; i++) { ema = p[i] * k + ema * (1 - k); out.push(ema); }
            return out;
        };
        const e12 = emaSeries(prices, 12);
        const e26 = emaSeries(prices, 26);
        const off12 = e12.length - e26.length;
        const macdLine = e26.map((v, i) => e12[i + off12] - v);
        if (macdLine.length < 9) return { valid: false, macd: 0, signal: 0, histogram: 0 };
        const signalK = 2 / 10;
        let sig = macdLine.slice(0, 9).reduce((a, b) => a + b, 0) / 9;
        for (let i = 9; i < macdLine.length; i++) sig = macdLine[i] * signalK + sig * (1 - signalK);
        const last = macdLine[macdLine.length - 1];
        const histogram = last - sig;
        const pipFlat = pipValue * 0.5;
        const relativeFlat = (atr && isFinite(atr) && atr > 0) ? Math.max(pipFlat, atr * MACD_VALIDITY_ATR_RATIO) : pipFlat;
        if (Math.abs(histogram) < relativeFlat) return { valid: false, macd: last, signal: sig, histogram };
        return { valid: true, macd: last, signal: sig, histogram };
    }

    _bollinger(prices, period = 20) {
        if (prices.length < period) return { percentB: 0.5, bandwidth: 0, upper: 0, lower: 0, mid: 0, valid: false };
        const sl = prices.slice(-period);
        const mean = sl.reduce((a, b) => a + b, 0) / period;
        const std = Math.sqrt(sl.reduce((s, p) => s + (p - mean) ** 2, 0) / period);
        if (std === 0) return { percentB: 0.5, bandwidth: 0, upper: mean, lower: mean, mid: mean, valid: false };
        const upper = mean + std * 2, lower = mean - std * 2;
        const cur = prices[prices.length - 1];
        const pB = (cur - lower) / (upper - lower);
        if (!isFinite(pB)) return { percentB: 0.5, bandwidth: std * 4 / mean, upper, lower, mid: mean, valid: false };
        return { percentB: pB, bandwidth: std * 4 / mean, upper, lower, mid: mean, valid: true };
    }

    _atr(candles, period = 14) {
        if (!candles || candles.length < 2) return null;
        const trs = [];
        for (let i = 1; i < candles.length; i++) {
            const h = candles[i].high ?? candles[i].price;
            const l = candles[i].low ?? candles[i].price;
            const pc = candles[i - 1].price;
            trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
        }
        if (trs.length < period) return trs.reduce((a, b) => a + b, 0) / trs.length || null;
        let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = period; i < trs.length; i++) atr = (atr * (period - 1) + trs[i]) / period;
        return atr > 0 ? atr : null;
    }

    _stochastic(candles, kPeriod = 14, dPeriod = 3) {
        if (!candles || candles.length < kPeriod + dPeriod) return null;
        const kValues = [];
        for (let i = kPeriod - 1; i < candles.length; i++) {
            const slice = candles.slice(i - kPeriod + 1, i + 1);
            const high = Math.max(...slice.map(c => c.high ?? c.price));
            const low = Math.min(...slice.map(c => c.low ?? c.price));
            const close = candles[i].price, range = high - low;
            kValues.push(range > 0 ? ((close - low) / range) * 100 : 50);
        }
        if (kValues.length < dPeriod) return null;
        const k = kValues[kValues.length - 1];
        const d = kValues.slice(-dPeriod).reduce((a, b) => a + b, 0) / dPeriod;
        return { k, d, valid: true };
    }

    _momentum(prices, period = 10) {
        if (prices.length < period + 1) return null;
        const current = prices[prices.length - 1], past = prices[prices.length - 1 - period];
        return past !== 0 ? ((current - past) / past) * 100 : 0;
    }

    _williamsR(candles, period = 14) {
        if (!candles || candles.length < period) return null;
        const slice = candles.slice(-period);
        const high = Math.max(...slice.map(c => c.high ?? c.price));
        const low = Math.min(...slice.map(c => c.low ?? c.price));
        const close = candles[candles.length - 1].price, range = high - low;
        if (range === 0) return -50;
        return ((high - close) / range) * -100;
    }

    _pivotPoints(candles) {
        if (!candles || candles.length < 2) return null;
        const last = candles[candles.length - 1];
        const h = last.high ?? last.price, l = last.low ?? last.price, c = last.price;
        const pivot = (h + l + c) / 3;
        return { pivot, r1: 2 * pivot - l, r2: pivot + (h - l), s1: 2 * pivot - h, s2: pivot - (h - l) };
    }

    _pruneBacktestCache() {
        const keys = Object.keys(this._backtestCache);
        if (keys.length > WF_CACHE_MAX)
            keys.slice(0, Math.floor(keys.length / 2)).forEach(k => delete this._backtestCache[k]);
    }

    getBacktest(symbol, pair, dataQualityOk = true) {
        const candles = this._store[symbol];
        if (!candles) return null;
        const bucket = Math.floor(candles.length / WF_CANDLE_BUCKET) * WF_CANDLE_BUCKET;
        const key = `${symbol}_${bucket}`;
        if (this._backtestCache[key]?._wasWarmup && dataQualityOk) delete this._backtestCache[key];
        if (this._backtestCache[key]) return this._backtestCache[key];
        const result = runWalkForwardBacktest(candles, pair);
        if (result) {
            result._wasWarmup = !dataQualityOk;
            this._backtestCache[key] = result;
            this._pruneBacktestCache();
        }
        return result;
    }

    clearBacktestCache() { this._backtestCache = {}; }

    getCalibratedWinRate(backtest, netScore) {
        if (!backtest?.calibration || backtest.insufficient) return null;
        const absScore = Math.abs(netScore);
        const bucket = absScore >= 6 ? '6+' : absScore >= 3 ? '3-5' : '0-2';
        return backtest.calibration[bucket] ?? null;
    }

    predict(symbol, pair, sessionQuality = { score: 1.0 }, activeSessions = []) {
        const candles = this._store[symbol];
        if (!candles || candles.length < 5) return null;
        const htfCandles = this._htfStore[symbol] || [];
        const prices = candles.map(c => c.price);
        const cur = prices[prices.length - 1];
        const n = prices.length;
        const distinctCount = countDistinctPrices(candles);
        const dataQualityOk = distinctCount >= MIN_DISTINCT_PRICES && n >= WARMUP_CANDLES;

        const rsiRaw = dataQualityOk ? this._rsi(prices) : null;
        const rsi = rsiRaw ?? 50;
        const rsiValid = rsiRaw !== null && dataQualityOk;
        const rawATR = this._atr(candles);
        const macd = dataQualityOk ? this._macd(prices, pair.pipValue, rawATR) : { valid: false, macd: 0, signal: 0, histogram: 0 };
        const macdValid = macd.valid;
        const bb = this._bollinger(prices);
        const bbValid = bb.valid && dataQualityOk;
        const ema12Raw = dataQualityOk ? calcEMA(prices, 12) : null;
        const ema26Raw = dataQualityOk ? calcEMA(prices, 26) : null;
        const ema50Raw = dataQualityOk ? calcEMA(prices, 50) : null;
        const ema12 = ema12Raw ?? cur;
        const ema26 = ema26Raw ?? cur;
        const ema50 = ema50Raw ?? cur;
        const emaValid = ema12Raw !== null && ema26Raw !== null && dataQualityOk;
        const stoch = dataQualityOk ? this._stochastic(candles) : null;
        const momentum = dataQualityOk ? this._momentum(prices) : null;
        const williamsR = dataQualityOk ? this._williamsR(candles) : null;
        const pivots = this._pivotPoints(candles);
        const adxResult = dataQualityOk ? computeADX(candles) : { adx: null, trending: false };
        const swingLevels = findSwingLevels(candles);
        const { nearestResistance, nearestSupport } = computeNearestSR(swingLevels, cur);
        const volumeConf = computeVolumeConfirmation(candles);
        const htfAlignment = computeHTFAlignment(htfCandles);

        const pipFloorMult = pair.type === 'commodity' ? 20 : 10;
        const pipMin = pair.pipValue * pipFloorMult;
        const atr = (rawATR && rawATR > pipMin) ? rawATR : pipMin;

        const regWindow = Math.min(n, 50);
        const reg = linearRegressionOnPrices(prices.slice(-regWindow));
        const regShort = linearRegressionOnPrices(prices.slice(-15));
        const regMed = linearRegressionOnPrices(prices.slice(-30));
        const regLong = linearRegressionOnPrices(prices.slice(-Math.min(n, 80)));

        const priceSlopeDrift = reg.slope * 3;
        let wDrift = 0, wTotal = 0;
        const wReg = 3.0 * Math.max(0.05, reg.r2);
        wDrift += priceSlopeDrift * wReg; wTotal += wReg;
        if (emaValid) { wDrift += (ema12 - ema26) * 0.5 * 2.0; wTotal += 2.0; }
        let rsiDrift = 0;
        if (rsiValid) {
            if (rsi <= 20) rsiDrift = atr * 1.5; else if (rsi <= 30) rsiDrift = atr * 1.0;
            else if (rsi < 40) rsiDrift = atr * 0.3;
            else if (rsi >= 80) rsiDrift = -atr * 1.5; else if (rsi >= 70) rsiDrift = -atr * 1.0;
            else if (rsi > 60) rsiDrift = -atr * 0.3;
        }
        wDrift += rsiDrift * 1.5; wTotal += 1.5;
        if (macdValid) {
            const macdDrift = macd.histogram !== 0 ? Math.sign(macd.histogram) * Math.min(atr, Math.abs(macd.histogram) * 5) : 0;
            wDrift += macdDrift * 1.5; wTotal += 1.5;
        }
        let bbDrift = 0;
        if (bbValid) {
            if (bb.percentB < 0.10) bbDrift = atr * 1.0; else if (bb.percentB < 0.20) bbDrift = atr * 0.6;
            else if (bb.percentB < 0.30) bbDrift = atr * 0.3;
            else if (bb.percentB > 0.90) bbDrift = -atr * 1.0; else if (bb.percentB > 0.80) bbDrift = -atr * 0.6;
            else if (bb.percentB > 0.70) bbDrift = -atr * 0.3;
        }
        wDrift += bbDrift * 1.0; wTotal += 1.0;
        if (stoch?.valid) {
            let stochDrift = 0;
            if (stoch.k < 20) stochDrift = atr * 0.8; else if (stoch.k < 30) stochDrift = atr * 0.4;
            else if (stoch.k > 80) stochDrift = -atr * 0.8; else if (stoch.k > 70) stochDrift = -atr * 0.4;
            wDrift += stochDrift * 0.8; wTotal += 0.8;
        }
        if (momentum !== null) {
            wDrift += Math.sign(momentum) * Math.min(atr * 0.5, Math.abs(momentum / 100) * atr) * 0.6;
            wTotal += 0.6;
        }
        const rawDrift = wTotal > 0 ? wDrift / wTotal : 0;
        const clampedDrift = Math.max(-atr * 2.5, Math.min(atr * 2.5, rawDrift));

        const sig = computeSignal({
            rsi, rsiValid, macdHist: macd.histogram, macdValid,
            ema12: emaValid ? ema12 : cur, ema26: emaValid ? ema26 : cur, emaValid,
            bbPercentB: bb.percentB, bbValid, regSlope: reg.slope,
            adxTrending: adxResult.trending, volumeConf, htfAlignment,
        });

        let predictedPrice = parseFloat((cur + clampedDrift).toFixed(pair.pipDigits ?? 5));
        if (predictedPrice === cur) {
            const pip = pair.pipValue ?? Math.pow(10, -(pair.pipDigits ?? 5));
            if (sig.signal === 'BUY') predictedPrice = parseFloat((cur + pip).toFixed(pair.pipDigits));
            else if (sig.signal === 'SELL') predictedPrice = parseFloat((cur - pip).toFixed(pair.pipDigits));
        }

        const priceMovesAgainstSignal = (sig.signal === 'BUY' && predictedPrice < cur) || (sig.signal === 'SELL' && predictedPrice > cur);
        const totalEntryFrictionEst = (SPREAD_PIPS + DETERMINISTIC_SLIPPAGE_PIPS) * pair.pipValue;
        const moveTooSmall = sig.signal !== 'HOLD' && Math.abs(predictedPrice - cur) < totalEntryFrictionEst * 2;

        const regimeBonus = adxResult.trending ? 6 : 0;
        const sessionBonus = sessionQuality.score > 1.0 ? 4 : 0;
        const isBull = sig.signal === 'BUY';
        const srBonus =
            isBull && nearestResistance !== null && isFinite(nearestResistance) && (nearestResistance - cur) > atr * 3 ? 5
                : !isBull && nearestSupport !== null && isFinite(nearestSupport) && (cur - nearestSupport) > atr * 3 ? 5 : 0;
        const volumeBonus = volumeConf.hasData && volumeConf.confirmed === true ? 3 : 0;
        const volumePenalty = volumeConf.hasData && volumeConf.confirmed === false ? -5 : 0;
        const htfBonus = htfAlignment.htfTrend !== null &&
            ((sig.rawSignal === 'BUY' && htfAlignment.htfTrend === 'bullish') ||
                (sig.rawSignal === 'SELL' && htfAlignment.htfTrend === 'bearish')) ? 5 : 0;
        const htfPenalty = sig.htfSuppressed ? 10 : 0;
        const backtest = this.getBacktest(symbol, pair, dataQualityOk);
        const calibratedWinRate = this.getCalibratedWinRate(backtest, sig.netScore);

        if (sig.signal !== 'HOLD') {
            if (moveTooSmall || priceMovesAgainstSignal) {
                sig.signal = 'HOLD';
                sig.trend = 'neutral';
            } else if (calibratedWinRate !== null && calibratedWinRate < 45) {
                sig.signal = 'HOLD';
                sig.trend = 'neutral';
            } else if (calibratedWinRate === null && backtest && !backtest.insufficient && backtest.winRate < 0.45) {
                sig.signal = 'HOLD';
                sig.trend = 'neutral';
            }
        }
        const dataConf = Math.min(1, n / 80);
        const indAgree = Math.min(1, Math.abs(sig.netScore) / MAX_BULL_BEAR);
        const stalePenalty = dataQualityOk ? 0 : 30;
        const warmupPenalty = (!rsiValid ? 10 : 0) + (!macdValid ? 5 : 0) + (!emaValid ? 5 : 0) + (!bbValid ? 5 : 0) + stalePenalty;
        const regFit = reg.r2;
        const r2Penalty = regFit < 0.10 ? 10 : regFit < 0.30 ? 5 : 0;
        const hardCap = !dataQualityOk ? 35 : 95;
        const rawStrengthScore = Math.round(
            25 + dataConf * 25 + indAgree * 28 + regFit * 10
            + regimeBonus + sessionBonus + srBonus + volumeBonus + volumePenalty + htfBonus
            - warmupPenalty - r2Penalty - htfPenalty
        );
        const signalStrength = Math.min(hardCap, Math.max(1, rawStrengthScore));
        const strengthLabel = signalStrength >= 70 ? 'Strong' : signalStrength >= 50 ? 'Moderate' : signalStrength >= 30 ? 'Weak' : 'Very Weak';
        const confidence = signalStrength;
        const confidenceLabel = strengthLabel;
        const bbDisplay = { ...bb, percentB: Math.max(0, Math.min(1, bb.percentB)) };
        const sessionOpenPrice = getSessionOpenPrice(candles, activeSessions);
        const sessionChange = formatPctChange(cur, sessionOpenPrice ?? cur);
        const volatility = atr / cur * 100;
        const volatilityLabel = volatility > 0.5 ? 'High' : volatility > 0.2 ? 'Medium' : 'Low';
        const slippage = pair.pipValue * DETERMINISTIC_SLIPPAGE_PIPS;
        const totalEntryFriction = slippage + pair.pipValue * SPREAD_PIPS;
        const atrSL = Math.max(pair.pipValue * 15, atr * 2);
        const structuralSL = (isBull && nearestSupport !== null && isFinite(nearestSupport))
            ? Math.min(atrSL, cur - nearestSupport + atr * 0.5) : null;
        const effectiveSLDist = structuralSL
            ? Math.max(pair.pipValue * 10, Math.min(structuralSL, atrSL)) : atrSL;

        return {
            predictedPrice, confidence, confidenceLabel, signalStrength, strengthLabel,
            calibratedWinRate, trend: sig.trend, signal: sig.signal, rawSignal: sig.rawSignal,
            bull: sig.bull, bear: sig.bear, strength: sig.strength, netScore: sig.netScore,
            hasConflict: sig.hasConflict, conflictType: sig.conflictType,
            htfSuppressed: sig.htfSuppressed, volSuppressed: sig.volSuppressed,
            priceMovesAgainstSignal, moveTooSmall,
            rsi, rsiValid, macd, macdValid,
            bollinger: bbDisplay, bollingerRaw: bb, bbValid,
            atr, ema12, ema26, ema50, emaValid,
            regression: { slope: reg.slope, r2: reg.r2 },
            regressionMulti: { short: regShort, medium: regMed, long: regLong },
            levels: { support: cur - atr * 2, resistance: cur + atr * 2 },
            swingLevels, nearestResistance: nearestResistance ?? null, nearestSupport: nearestSupport ?? null,
            adx: adxResult, regimeBonus, sessionBonus, srBonus, volumeBonus, volumePenalty, htfBonus, r2Penalty,
            effectiveSLDist, totalEntryFriction, slippage,
            dataPoints: n, distinctPrices: distinctCount, dataQualityOk,
            stochastic: stoch, momentum, williamsR, pivots,
            sessionChange, volatility, volatilityLabel,
            backtest, sessionQuality, driftContribution: clampedDrift,
            volumeConf, htfAlignment,
        };
    }
}

const isQualifiedPair = (d) =>
    d.prediction?.trend !== 'neutral'
    && (d.prediction?.signalStrength ?? 0) >= QUALIFIED_CONFIDENCE_MIN
    && d.prediction?.dataQualityOk;

// ─────────────────────────────────────────────────────────────────────────────
// AI CHAT
// ─────────────────────────────────────────────────────────────────────────────
const MAX_CHAT_MESSAGES = 50;

const sendToGroq = async (forexData, history, signal) => {
    if (!hasGroqKey()) throw new Error('Groq API key not configured — add your Groq key in Settings ⚙');
    const validPairs = forexData.filter(d => d.prediction?.dataQualityOk);
    const stalePairs = forexData.filter(d => d.prediction && !d.prediction.dataQualityOk);
    const marketContext = validPairs.map(d => {
        const p = d.prediction;
        const bt = p.backtest && !p.backtest.insufficient
            ? `WF-backtest(${p.backtest.winRate.toFixed(0)}%WR, ${p.backtest.total} test-trades)`
            : `backtest=insufficient(${p.backtest?.reason ?? 'unknown'})`;
        const calWR = p.calibratedWinRate !== null ? `calibrated-WR=${p.calibratedWinRate.toFixed(0)}%` : 'cal-WR=n/a';
        const adxStr = p.adx.adx ? `ADX=${p.adx.adx.toFixed(0)}(${p.adx.trending ? 'trending' : 'choppy'})` : 'ADX=N/A';
        const volStr = !p.volumeConf.hasData ? 'vol=no-data(OTC-FX)' : `vol=${p.volumeConf.confirmed ? '✓confirmed' : '✗below-threshold'}(${p.volumeConf.ratio?.toFixed(2)}×)`;
        const htfStr = p.htfAlignment.htfTrend ? `HTF-1H=${p.htfAlignment.htfTrend}(ADX=${p.htfAlignment.htfAdx?.toFixed(0) ?? 'N/A'})${p.htfSuppressed ? '(suppressed)' : ''}` : 'HTF=n/a';
        const flags = [p.hasConflict ? `⚠conflict=${p.conflictType}` : '', p.moveTooSmall ? '⚠sub-cost' : '', p.volSuppressed ? '⚠vol-suppressed' : ''].filter(Boolean).join(' ');
        return `${d.pair.symbol}: price=${formatPrice(d.currentRate, d.pair.symbol)} signal=${p.signal}(raw=${p.rawSignal}) strength=${p.signalStrength}% ${calWR} R²=${p.regression.r2.toFixed(3)} RSI=${p.rsiValid ? p.rsi.toFixed(1) : 'N/A'} ${adxStr} ${bt} session=${p.sessionQuality.label} ${volStr} ${htfStr} ${flags}`.trim();
    }).join('\n');
    const staleNote = stalePairs.length > 0 ? `\n\nSTALE: ${stalePairs.map(d => d.pair.symbol).join(', ')}` : '';
    const systemPrompt = `You are QuantAI, a professional forex & commodities analyst. Use **bold** for key figures.\n\nSignal system notes:\n- Walk-forward backtest: ${Math.round(WF_TRAIN_RATIO * 100)}% train / ${Math.round((1 - WF_TRAIN_RATIO) * 100)}% test, ZERO overlap, deterministic fills (open+spread+${DETERMINISTIC_SLIPPAGE_PIPS}p fixed slippage)\n- Signal Strength (0-100): indicator agreement score — NOT win probability\n- Calibrated Win Rate: empirical win% from walk-forward test folds — the real probability estimate\n- Volume: OTC FX pairs have no real volume data (shown as "no-data") — volume gate only fires when exchange volume IS available\n- HTF gate: 5m signal suppressed ONLY when 1H EMA opposes AND 1H ADX > ${HTF_SUPPRESS_ADX_THRESHOLD}\n- Qualified threshold: Signal Strength ≥ ${QUALIFIED_CONFIDENCE_MIN}%\n\nFlag ⚠ conflicts. Only analyse valid-data pairs.\n\nMarket data:\n${marketContext}${staleNote}`;
    const apiMessages = history.map(m => ({ role: m.role, content: m.content }));
    const res = await fetch(GROQ_BASE, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getKey('groq_api_key')}` },
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'system', content: systemPrompt }, ...apiMessages], temperature: 0.4, max_tokens: 700 }),
    });
    if (!res.ok) throw new Error(`Groq ${res.status}`);
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('Empty response');
    return content;
};

const getFallbackReply = (msg, data) => {
    const validData = data.filter(d => d.prediction?.dataQualityOk);
    const pool = validData.length > 0 ? validData : data.filter(d => d.prediction !== null);
    const best = pool.reduce((p, c) => (c.prediction?.signalStrength ?? 0) > (p?.prediction?.signalStrength ?? 0) ? c : p, null);
    if (!best) return 'Loading market data — please wait a moment.';
    const calWR = best.prediction?.calibratedWinRate;
    return `Best setup: **${best.pair.symbol}** at ${formatPrice(best.currentRate, best.pair.symbol)} — ${best.prediction?.signal} (strength ${best.prediction?.signalStrength}%${calWR !== null ? `, est. ${calWR.toFixed(0)}% win rate` : ''}).`;
};



// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
const PulseDot = ({ color = 'bg-emerald-400' }) => (
    <span className="relative flex h-2.5 w-2.5">
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${color} opacity-75`} />
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${color}`} />
    </span>
);

const SignalBadge = ({ signal, size = 'md' }) => {
    const styles = {
        BUY: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
        SELL: 'bg-rose-500/20    text-rose-400    border-rose-500/30',
        HOLD: 'bg-slate-500/20   text-slate-600   border-slate-500/30',
    };
    const sizeStyles = { sm: 'text-[10px] px-2 py-0.5', md: 'text-xs px-3 py-1', lg: 'text-sm px-4 py-1.5' };
    return (
        <span className={`inline-flex items-center font-bold rounded-full border ${styles[signal] || styles.HOLD} ${sizeStyles[size]}`}>
            {signal === 'BUY' && <ArrowUpRight className="w-3 h-3 mr-1" />}
            {signal === 'SELL' && <ArrowDownRight className="w-3 h-3 mr-1" />}
            {signal === 'HOLD' && <Minus className="w-3 h-3 mr-1" />}
            {signal}
        </span>
    );
};

const StrengthBar = ({ strength = 0, signal = 'HOLD' }) => (
    <div className="flex items-center gap-1.5">
        <div className="flex gap-0.5 flex-1">
            {[...Array(5)].map((_, i) => (
                <div key={i} className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${i < strength
                    ? signal === 'BUY' ? 'bg-emerald-400' : signal === 'SELL' ? 'bg-rose-400' : 'bg-slate-500'
                    : 'bg-black/10'}`} />
            ))}
        </div>
        {strength === 0 && <span className="text-[9px] text-slate-500 font-medium">NEUTRAL</span>}
    </div>
);

const GlassCard = ({ children, className = '', glow = '' }) => (
    <div className={`relative bg-white/70 backdrop-blur-3xl border border-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] rounded-[2rem] transition-all duration-500 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] overflow-hidden ${className}`}>
        {glow && <div className={`absolute inset-0 ${glow} opacity-20 pointer-events-none`} />}
        <div className="relative z-10">{children}</div>
    </div>
);

const MetricCell = ({ label, value, sub, color = 'text-slate-900', icon }) => (
    <div className="bg-black/[0.03] border border-black/[0.06] rounded-xl p-3">
        <div className="flex items-center gap-1.5 text-[10px] text-slate-700 uppercase font-bold tracking-wider mb-1">
            {icon && <span className="opacity-60">{icon}</span>}{label}
        </div>
        <div className={`text-lg font-mono font-bold ${color} truncate`}>{value}</div>
        {sub && <div className="text-[10px] text-slate-700 mt-0.5 truncate">{sub}</div>}
    </div>
);

const StaleDataWarning = ({ pred }) => {
    if (!pred || pred.dataQualityOk) return null;
    return (
        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-orange-400 font-semibold bg-orange-500/10 border border-orange-500/20 rounded-full px-2 py-0.5 w-fit">
            <Zap className="w-3 h-3 flex-shrink-0" />
            Warming up — {pred.distinctPrices}/{MIN_DISTINCT_PRICES} prices · {pred.dataPoints}/{WARMUP_CANDLES} candles
        </div>
    );
};

const ConflictWarning = ({ pred }) => {
    if (!pred?.hasConflict) return null;
    const msg = pred.conflictType === 'oversold' ? 'Oversold but MACD bearish — momentum not confirmed'
        : pred.conflictType === 'overbought' ? 'Overbought but MACD bullish — momentum not confirmed'
            : pred.conflictType === 'trending-sell' ? 'SELL in trend but RSI < 60 — wait for overbought confirmation'
                : pred.conflictType === 'trending-buy' ? 'BUY in trend but RSI > 40 — wait for pullback'
                    : 'Mean reversion risk — conflicting indicators';
    return (
        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-amber-400 font-semibold bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5 w-fit">
            <AlertTriangle className="w-3 h-3 flex-shrink-0" />{msg}
        </div>
    );
};

const HTFSuppressionBadge = ({ pred }) => {
    if (!pred?.htfSuppressed) return null;
    return (
        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-sky-400 font-semibold bg-sky-500/10 border border-sky-500/20 rounded-full px-2 py-0.5 w-fit">
            <Layers className="w-3 h-3 flex-shrink-0" />
            1H strongly trending (ADX&gt;{HTF_SUPPRESS_ADX_THRESHOLD}) opposes 5m signal
        </div>
    );
};

const VolumeBadge = ({ pred }) => {
    if (!pred) return null;
    if (!pred.volumeConf?.hasData) return null;
    if (pred.volumeConf.confirmed) return (
        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-emerald-400 font-semibold bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5 w-fit">
            <Volume2 className="w-3 h-3 flex-shrink-0" />Volume confirmed ({pred.volumeConf.ratio?.toFixed(2)}× avg)
        </div>
    );
    return (
        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-slate-500 font-semibold bg-slate-500/10 border border-slate-500/20 rounded-full px-2 py-0.5 w-fit">
            <Volume2 className="w-3 h-3 flex-shrink-0" />Low volume ({pred.volumeConf.ratio?.toFixed(2)}× avg) — signal suppressed
        </div>
    );
};

const DirectionConflictWarning = ({ pred }) => {
    if (!pred?.priceMovesAgainstSignal) return null;
    return (
        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-orange-400 font-semibold bg-orange-500/10 border border-orange-500/20 rounded-full px-2 py-0.5 w-fit">
            <AlertTriangle className="w-3 h-3 flex-shrink-0" />Signal vs model price conflict — low conviction
        </div>
    );
};

const SmallMoveWarning = ({ pred }) => {
    if (!pred?.moveTooSmall) return null;
    return (
        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-slate-500 font-semibold bg-slate-500/10 border border-slate-500/20 rounded-full px-2 py-0.5 w-fit">
            <Info className="w-3 h-3 flex-shrink-0" />Predicted move smaller than spread+slippage — marginal edge
        </div>
    );
};

const LowR2Warning = ({ pred }) => {
    if (!pred || pred.regression.r2 >= 0.10) return null;
    return (
        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-slate-500 font-semibold bg-slate-500/10 border border-slate-500/20 rounded-full px-2 py-0.5 w-fit">
            <Info className="w-3 h-3 flex-shrink-0" />Ranging Market — No clear directional trend
        </div>
    );
};

const RegimeBadge = ({ adx }) => {
    if (!adx?.adx) return null;
    return (
        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border w-fit ${adx.trending ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-slate-500/10 text-slate-500 border-slate-500/20'}`}>
            <Gauge className="w-2.5 h-2.5" />{adx.trending ? `Trending ADX ${adx.adx.toFixed(0)}` : `Choppy ADX ${adx.adx.toFixed(0)}`}
        </span>
    );
};

const SessionBadge = ({ sessionQuality }) => {
    if (!sessionQuality) return null;
    const color = sessionQuality.quality === 'high' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
        : sessionQuality.quality === 'medium' ? 'text-blue-400 bg-blue-500/10 border-blue-500/20'
            : 'text-slate-500 bg-slate-500/10 border-slate-500/20';
    return (
        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border w-fit ${color}`}>
            <Clock className="w-2.5 h-2.5" />{sessionQuality.label}
        </span>
    );
};

const HTFBadge = ({ htfAlignment }) => {
    if (!htfAlignment?.htfTrend) return null;
    const isBull = htfAlignment.htfTrend === 'bullish';
    const adxStr = htfAlignment.htfAdx ? ` ADX:${htfAlignment.htfAdx.toFixed(0)}` : '';
    return (
        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border w-fit ${isBull ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}
            title={`1H EMA trend: ${htfAlignment.htfTrend}. ADX=${htfAlignment.htfAdx?.toFixed(0) ?? 'N/A'}. Suppression threshold: ADX>${HTF_SUPPRESS_ADX_THRESHOLD}`}>
            <Layers className="w-2.5 h-2.5" />1H {isBull ? 'Bull' : 'Bear'}{adxStr}
        </span>
    );
};

const BacktestBadge = ({ backtest }) => {
    if (!backtest) return <span className="text-[10px] text-slate-500">Walk-forward: no data yet</span>;
    if (backtest.insufficient) return <span className="text-[10px] text-slate-500" title={backtest.reason}>WF: insufficient ({backtest.reason})</span>;
    if (backtest.total < WF_MIN_TEST_TRADES) return <span className="text-[10px] text-slate-500">WF: &lt;{WF_MIN_TEST_TRADES} test trades</span>;
    const color = backtest.winRate >= 55 ? 'text-emerald-400' : backtest.winRate >= 45 ? 'text-amber-400' : 'text-rose-400';
    return (
        <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${color}`}
            title={`Walk-forward: ${backtest.trainCandles} train / ${backtest.testCandles} test candles. Deterministic fills. Zero overlap.`}>
            <Award className="w-2.5 h-2.5" />WF: {backtest.winRate.toFixed(0)}% WR ({backtest.total} trades)
        </span>
    );
};

const APIStatusBanner = ({ dataSource, lastUpdated, isRefreshing, warmingUp }) => (
    <div className="flex items-center gap-3 mb-6 px-4 py-3 bg-black/[0.03] border border-black/[0.06] rounded-xl text-xs font-mono text-slate-700">
        <PulseDot color={isRefreshing ? 'bg-amber-400' : 'bg-emerald-400'} />
        <span className="flex-1 truncate text-slate-600">{dataSource}</span>
        {warmingUp > 0 && <span className="text-orange-400 font-bold flex-shrink-0">⏳ {warmingUp} warming</span>}
        <Clock className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="flex-shrink-0">{new Date(lastUpdated).toLocaleTimeString()}</span>
    </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// LOADING SCREEN — Fixed: uses Loader2 (smooth spin) instead of RefreshCw
// ─────────────────────────────────────────────────────────────────────────────
const LoadingScreen = ({ estimatedSeconds }) => (
    <div className="min-h-screen bg-[#f1f5f9] flex items-center justify-center relative">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-transparent to-teal-500/10 pointer-events-none" />
        <div className="flex flex-col items-center gap-6 max-w-sm text-center px-6">
            <div className="relative">
                {/* Outer glow ring */}
                <div className="absolute inset-0 rounded-full bg-cyan-400/20 blur-2xl animate-pulse scale-150" />
                {/* Spinner ring */}
                <div className="relative w-20 h-20 flex items-center justify-center">
                    <svg className="absolute inset-0 w-20 h-20 animate-spin" viewBox="0 0 80 80" fill="none">
                        <circle cx="40" cy="40" r="36" stroke="#e2e8f0" strokeWidth="4" />
                        <circle cx="40" cy="40" r="36"
                            stroke="url(#spinGrad)" strokeWidth="4"
                            strokeLinecap="round" strokeDasharray="60 166" />
                        <defs>
                            <linearGradient id="spinGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#06b6d4" />
                                <stop offset="100%" stopColor="#0d9488" />
                            </linearGradient>
                        </defs>
                    </svg>
                    <Activity className="w-8 h-8 text-cyan-500 relative z-10" />
                </div>
            </div>
            <div>
                <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                    QUANT<span className="text-cyan-500">AI</span>
                </h1>
                <p className="text-sm text-slate-500 mt-1 font-medium animate-pulse">Loading live market data…</p>
            </div>
            <div className="w-full space-y-2 text-left bg-black/[0.03] border border-black/[0.06] rounded-xl p-4">
                {[
                    `Fetching ${TIMESERIES_SIZE} × 5-min candles per pair`,
                    'Fetching 1H higher timeframe candles',
                    'Running walk-forward backtests',
                    'Computing indicators & signals',
                ].map((step, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-slate-600">
                        <Loader2 className="w-3 h-3 text-cyan-500 animate-spin flex-shrink-0" style={{ animationDelay: `${i * 0.15}s` }} />
                        {step}
                    </div>
                ))}
            </div>

        </div>
    </div>
);


// ─────────────────────────────────────────────────────────────────────────────
// FEATURED RECOMMENDATION
// ─────────────────────────────────────────────────────────────────────────────
const FeaturedRecommendation = ({ data: d }) => {
    if (!d?.prediction) return null;
    const { pair, currentRate, prediction: pred } = d;
    const isPrime = pred?.trend !== 'neutral' && pred?.signalStrength >= QUALIFIED_CONFIDENCE_MIN && pred?.dataQualityOk;

    if (!isPrime) {
        return (
            <GlassCard className="p-8 mb-8 text-center" glow="bg-gradient-to-br from-amber-500/10 to-transparent">
                <AlertCircle className="w-10 h-10 text-amber-500/60 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-slate-900/70 mb-2">No High-Conviction Setup</h2>
                <p className="text-slate-700 text-sm max-w-md mx-auto">
                    {pred && !pred.dataQualityOk ? `Pairs warming up (need ${WARMUP_CANDLES} candles / ${MIN_DISTINCT_PRICES}+ distinct prices).`
                        : pred ? `All pairs below ${QUALIFIED_CONFIDENCE_MIN}% signal strength or suppressed.`
                            : 'Waiting for prediction data…'}
                </p>
            </GlassCard>
        );
    }

    const isBull = pred.trend === 'bullish';
    const slDist = pred.effectiveSLDist;
    const tpDist = slDist * 2;
    const entryWithSlippage = isBull ? currentRate + pred.totalEntryFriction : currentRate - pred.totalEntryFriction;
    const sl = isBull ? entryWithSlippage - slDist : entryWithSlippage + slDist;
    const tp = isBull ? entryWithSlippage + tpDist : entryWithSlippage - tpDist;
    const noBacktest = !pred.backtest || pred.backtest.insufficient || pred.backtest.total < WF_MIN_TEST_TRADES;

    return (
        <GlassCard className="p-1 mb-8 shadow-2xl"
            glow={isBull ? 'bg-gradient-to-br from-emerald-500/20 via-transparent to-cyan-500/10' : 'bg-gradient-to-br from-rose-500/20 via-transparent to-orange-500/10'}>
            <div className="p-6 md:p-8">
                {noBacktest && (
                    <div className="flex items-start gap-3 mb-4 px-4 py-3 bg-amber-500/10 border border-amber-500/25 rounded-xl">
                        <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="text-xs font-bold text-amber-600">Walk-Forward Data Unavailable</p>
                            <p className="text-[10px] text-amber-700 mt-0.5">{pred.backtest?.reason ?? `Need ≥${TIMESERIES_SIZE} real candles for WF split.`} Signal based on live indicators only — size down.</p>
                        </div>
                    </div>
                )}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                    <div>
                        <div className="flex items-center gap-2 mb-3 flex-wrap">
                            <span className={`text-xs font-bold px-3 py-1 rounded-full border animate-pulse ${isBull ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border-rose-500/30'}`}>★ PRIME SETUP</span>
                            <span className="text-slate-700 text-xs font-semibold tracking-wider">Strength: {pred.signalStrength}% ({pred.strengthLabel})</span>
                            {pred.calibratedWinRate !== null && (
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${pred.calibratedWinRate >= 55 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}
                                    title="Empirical win rate from walk-forward test folds with deterministic fills.">
                                    📊 Est. {pred.calibratedWinRate.toFixed(0)}% win rate (calibrated)
                                </span>
                            )}
                            {!noBacktest && (
                                <span className="text-xs text-slate-600 px-2 py-0.5 rounded-full border border-slate-500/20 bg-slate-500/5"
                                    title="Walk-forward: 60% train / 40% test, zero overlap, deterministic fills">
                                    WF: {pred.backtest.winRate.toFixed(0)}% ({pred.backtest.total} test)
                                </span>
                            )}
                        </div>
                        <h2 className="text-3xl md:text-4xl font-bold text-slate-900 flex items-center gap-3">
                            {pair.name}
                            <span className="text-slate-700 text-xl font-normal">/ {pair.symbol}</span>
                        </h2>
                        <div className="flex flex-wrap gap-2 mt-2">
                            <RegimeBadge adx={pred.adx} />
                            <SessionBadge sessionQuality={pred.sessionQuality} />
                            <HTFBadge htfAlignment={pred.htfAlignment} />
                        </div>
                        <p className="text-xs text-slate-700 mt-2">{pred.volatilityLabel} Volatility Environment</p>
                        <div className="flex flex-col gap-0.5 mt-1">
                            <LowR2Warning pred={pred} />
                            <SmallMoveWarning pred={pred} />
                            <ConflictWarning pred={pred} />
                            <DirectionConflictWarning pred={pred} />
                            <HTFSuppressionBadge pred={pred} />
                            <VolumeBadge pred={pred} />
                        </div>
                    </div>
                    <div className="text-right hidden md:block">
                        <div className="text-sm text-slate-700 font-medium mb-1">Current Price</div>
                        <div className="text-3xl font-mono font-bold text-slate-900 tracking-tight">{formatPrice(currentRate, pair.symbol)}</div>
                        <div className={`text-sm font-mono mt-1 flex items-center justify-end gap-1 ${isBull ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {isBull ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                            → {formatPrice(pred.predictedPrice, pair.symbol)}
                        </div>
                        <div className="text-[10px] text-slate-600 mt-1 font-mono">Entry friction: ~{(pred.totalEntryFriction / pair.pipValue).toFixed(1)}p</div>
                        <div className={`text-xs mt-1 ${pred.sessionChange.value >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>Session: {pred.sessionChange.text}</div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className={`col-span-1 rounded-2xl p-6 flex flex-col items-center justify-center border ${isBull ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-rose-500/10 border-rose-500/20'}`}>
                        <span className={`text-sm font-bold uppercase tracking-widest mb-2 ${isBull ? 'text-emerald-500' : 'text-rose-500'}`}>Action</span>
                        <div className={`text-4xl font-black ${isBull ? 'text-emerald-400' : 'text-rose-400'}`}>{pred.signal}</div>
                        <div className="mt-3 w-full"><StrengthBar strength={pred.strength} signal={pred.signal} /></div>
                        <div className="mt-2 text-slate-700 text-xs">{pred.volatilityLabel} Volatility</div>
                        <div className="mt-1 text-[10px] text-slate-600">{pred.adx.trending ? '📈 Trending' : '↔ Ranging'}</div>
                    </div>
                    <div className="col-span-1 md:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {[
                            { label: 'Stop Loss', val: sl, color: 'text-rose-400', bg: 'bg-rose-500/5    border-rose-500/10', note: `Structural · ${(slDist / pair.pipValue).toFixed(0)}p` },
                            { label: 'Entry (w/ costs)', val: entryWithSlippage, color: 'text-cyan-400', bg: 'bg-cyan-500/5    border-cyan-500/10', note: `Spread ${SPREAD_PIPS}p + Slippage ${DETERMINISTIC_SLIPPAGE_PIPS}p` },
                            { label: 'Take Profit', val: tp, color: 'text-emerald-400', bg: 'bg-emerald-500/5 border-emerald-500/10', note: isBull ? 'Target Resistance' : 'Target Support' },
                        ].map(item => (
                            <div key={item.label} className={`rounded-xl p-4 border flex flex-col justify-between hover:scale-[1.02] transition-all duration-300 ${item.bg}`}>
                                <div className={`flex items-center gap-2 ${item.color} mb-2`}><Target className="w-4 h-4" /><span className="text-sm font-bold">{item.label}</span></div>
                                <div className="text-2xl font-mono text-slate-900 font-semibold">{formatPrice(item.val, pair.symbol)}</div>
                                <div className="text-xs text-slate-700 mt-1">{item.note}</div>
                            </div>
                        ))}
                    </div>
                </div>



                {pred.calibratedWinRate !== null && (
                    <div className="mt-3 px-4 py-2 bg-cyan-500/5 border border-cyan-500/15 rounded-xl text-[10px] text-cyan-600">
                        <Info className="w-3 h-3 inline mr-1" />
                        <strong>Signal Strength {pred.signalStrength}%</strong> = indicator agreement (not win probability). &nbsp;
                        <strong>Calibrated WR {pred.calibratedWinRate.toFixed(0)}%</strong> = empirical rate from WF test folds with deterministic fills.
                    </div>
                )}
            </div>
        </GlassCard>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// TRADE CALCULATOR
// ─────────────────────────────────────────────────────────────────────────────
let _globalMsgId = 1;
const makeMsg = (role, content, extra = {}) => ({ id: _globalMsgId++, role, content, ...extra });

const TradeSettings = ({ pairMap, currencyData }) => {
    const [riskPct, setRiskPct] = useState(2);
    const [rrRatio, setRrRatio] = useState(2);
    const [balance, setBalance] = useState(1000);
    const [selectedSymbol, setSelectedSymbol] = useState('');
    const [showAdv, setShowAdv] = useState(false);
    const [manualLot, setManualLot] = useState(false);
    const [lotSize, setLotSize] = useState(0.01);
    const [spreadPips, setSpreadPips] = useState(SPREAD_PIPS);
    const [showBalance, setShowBalance] = useState(true);
    const [slippagePips, setSlippagePips] = useState(DETERMINISTIC_SLIPPAGE_PIPS);

    const bestQualifiedSymbol = useMemo(() => {
        const qualified = currencyData.filter(isQualifiedPair);
        const pool = qualified.length > 0 ? qualified : currencyData.filter(d => d.prediction !== null);
        if (pool.length === 0) return '';
        const best = pool.reduce((p, c) => (c.prediction?.signalStrength ?? 0) > (p?.prediction?.signalStrength ?? 0) ? c : p, pool[0]);
        return best?.pair?.symbol ?? '';
    }, [currencyData]);

    useEffect(() => { if (!selectedSymbol && bestQualifiedSymbol) setSelectedSymbol(bestQualifiedSymbol); }, [bestQualifiedSymbol]); // eslint-disable-line

    useEffect(() => {
        if (!selectedSymbol || !bestQualifiedSymbol || selectedSymbol === bestQualifiedSymbol) return;
        const current = pairMap.get(selectedSymbol);
        if (!current || !isQualifiedPair(current)) {
            const bestData = pairMap.get(bestQualifiedSymbol);
            if (bestData && isQualifiedPair(bestData)) setSelectedSymbol(bestQualifiedSymbol);
        }
    }, [bestQualifiedSymbol, selectedSymbol, pairMap]);

    const selectedPairData = pairMap.get(selectedSymbol) ?? null;
    const spd = selectedPairData;
    const spdSignal = spd?.prediction?.signal;
    const spdSignalStrength = spd?.prediction?.signalStrength;
    const spdCurrentRate = spd?.currentRate;
    const spdEffectiveSLDist = spd?.prediction?.effectiveSLDist;
    const spdNearestSupport = spd?.prediction?.nearestSupport;
    const spdDataPoints = spd?.prediction?.dataPoints;
    const spdPairSymbol = spd?.pair?.symbol;
    const spdPairPipValue = spd?.pair?.pipValue;
    const spdPairLotPipUSD = spd?.pair?.lotPipUSD;
    const spdPairQuote = spd?.pair?.quote;
    const spdPairType = spd?.pair?.type;
    const spdBacktestWinRate = spd?.prediction?.backtest?.insufficient ? null : spd?.prediction?.backtest?.winRate;
    const spdCalibWR = spd?.prediction?.calibratedWinRate;
    const spdBacktestTotal = spd?.prediction?.backtest?.total;

    const trade = useMemo(() => {
        const d = selectedPairData;
        if (!d?.prediction || !d.currentRate) return null;
        const { prediction: pred, currentRate, pair: pairMeta } = d;
        const directionBuy = pred.signal !== 'SELL';
        const slDist = pred.effectiveSLDist;
        const tpDist = slDist * rrRatio;
        const totalFriction = (spreadPips + slippagePips) * pairMeta.pipValue;
        const entry = directionBuy ? currentRate + totalFriction : currentRate - totalFriction;
        const sl = directionBuy ? entry - slDist : entry + slDist;
        const tp = directionBuy ? entry + tpDist : entry - tpDist;
        const { value: pipUSD, usingFallback: pipUSDFallback, fallbackAgeMinutes } = getPipUSD(pairMeta, currentRate);
        const slPips = slDist / pairMeta.pipValue;
        const tpPips = tpDist / pairMeta.pipValue;
        const effectiveSlPips = slPips + spreadPips + slippagePips;
        const riskAmt = balance * (riskPct / 100);
        const autoLotRaw = riskAmt / (effectiveSlPips * pipUSD);
        const autoLot = Math.min(50, Math.max(0.01, parseFloat(autoLotRaw.toFixed(2))));
        const finalLot = manualLot ? lotSize : autoLot;
        const actualRisk = finalLot * effectiveSlPips * pipUSD;
        const profit = finalLot * tpPips * pipUSD;
        const targetRR = rrRatio;
        const actualRR = actualRisk > 0 ? profit / actualRisk : 0;
        const breakevenWinRate = (1 / (1 + rrRatio)) * 100;
        const evAt50 = (0.5 * profit) - (0.5 * actualRisk);
        const bt = pred.backtest;
        const calibWR = pred.calibratedWinRate;
        const btWinRate = calibWR !== null
            ? calibWR / 100
            : (bt && !bt.insufficient && bt.total >= WF_MIN_TEST_TRADES ? bt.winRate / 100 : null);
        const evBacktested = btWinRate !== null ? btWinRate * profit - (1 - btWinRate) * actualRisk : null;
        const overRisk = actualRisk > riskAmt * 1.05;
        const overRiskPct = balance > 0 ? (actualRisk / balance) * 100 : 0;
        const recMinBalance = minBalanceForRisk(pairMeta, effectiveSlPips, riskPct, currentRate);
        const baseLots = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1.0];
        const maxScenarioLot = Math.max(0.1, Math.min(1.0, autoLot * 10));
        const filteredLots = baseLots.filter(l => l <= maxScenarioLot);
        if (!filteredLots.some(l => Math.abs(l - finalLot) < 0.005)) { filteredLots.push(finalLot); filteredLots.sort((a, b) => a - b); }
        const scenarios = filteredLots.map(l => ({
            lot: l, profit: l * tpPips * pipUSD, risk: l * effectiveSlPips * pipUSD,
            isActive: Math.abs(l - finalLot) < 0.005,
        }));
        const growthData = [];
        let bal = balance;
        growthData.push({ label: 'Start', value: parseFloat(bal.toFixed(2)) });
        for (let i = 1; i <= 20; i++) {
            bal = i % 2 === 1 ? bal + profit : Math.max(0, bal - actualRisk);
            growthData.push({ label: `T${i}`, value: parseFloat(bal.toFixed(2)) });
        }
        return {
            signal: pred.signal, directionBuy, entry, sl, tp, lot: finalLot, autoLot,
            slPips, tpPips, effectiveSlPips, spreadPips, slippagePips, totalFriction,
            actualRisk, profit, targetRR, actualRR, riskAmt,
            breakevenWinRate, evAt50, evBacktested, btWinRate, calibratedWinRate: calibWR,
            overRisk, overRiskPct, recMinBalance, scenarios, growthData,
            bull: pred.bull, bear: pred.bear, strength: pred.strength, netScore: pred.netScore,
            hasConflict: pred.hasConflict, conflictType: pred.conflictType,
            priceMovesAgainstSignal: pred.priceMovesAgainstSignal, moveTooSmall: pred.moveTooSmall,
            pred, pairMeta, currentRate, pipUSD, pipUSDFallback, fallbackAgeMinutes,
            structuralSLUsed: pred.nearestSupport !== null && isFinite(pred.nearestSupport ?? Infinity),
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        spdSignal, spdSignalStrength, spdCurrentRate, spdEffectiveSLDist, spdNearestSupport,
        spdDataPoints, spdPairSymbol, spdPairPipValue, spdPairLotPipUSD, spdPairQuote, spdPairType,
        spdBacktestWinRate, spdCalibWR, spdBacktestTotal,
        rrRatio, balance, riskPct, manualLot, lotSize, spreadPips, slippagePips,
    ]);

    useEffect(() => {
        if (!manualLot && trade?.autoLot != null)
            setLotSize(prev => Math.abs(prev - trade.autoLot) > 0.001 ? trade.autoLot : prev);
    }, [trade?.autoLot, manualLot]);

    const maxScenarioProfit = Math.max(...(trade?.scenarios.map(s => s.profit) ?? [1]));

    return (
        <GlassCard className="p-6 mb-8">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2 flex-wrap">
                    <div className="bg-gradient-to-br from-cyan-500 to-teal-600 p-2 rounded-lg"><Calculator className="w-5 h-5 text-white" /></div>
                    Trade Calculator
                    {trade?.structuralSLUsed && <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full font-bold">Structural SL</span>}
                    {trade?.pipUSDFallback && (
                        <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full font-bold" title={`Est. JPY rate ${_jpyState.rate.toFixed(2)}`}>
                            ⚠ Est. pip value{trade.fallbackAgeMinutes !== null ? ` (${trade.fallbackAgeMinutes}m ago)` : ''}
                        </span>
                    )}
                </h2>
                <button onClick={() => setShowAdv(!showAdv)} className="text-sm text-slate-600 hover:text-cyan-500 flex items-center gap-1 font-medium transition-colors">
                    {showAdv ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}Advanced
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                <div className="space-y-4">
                    <div>
                        <label className="text-xs text-slate-700 uppercase font-bold tracking-wider">Currency Pair</label>
                        <select value={selectedSymbol} onChange={e => setSelectedSymbol(e.target.value)}
                            className="w-full bg-black/[0.05] border border-black/[0.08] text-slate-900 rounded-xl p-3 mt-1 focus:ring-2 focus:ring-cyan-500 outline-none font-medium appearance-none cursor-pointer hover:bg-white/[0.08] transition">
                            {currencyData.map(d => {
                                const qualified = isQualifiedPair(d);
                                return (
                                    <option key={d.pair.symbol} value={d.pair.symbol} className="bg-white text-slate-900">
                                        {d.pair.symbol} — {d.pair.name}{qualified ? ' ✓' : d.prediction && !d.prediction.dataQualityOk ? ' ⚠ warming' : ''}
                                    </option>
                                );
                            })}
                        </select>
                        {selectedSymbol && !isQualifiedPair(pairMap.get(selectedSymbol)) && pairMap.get(selectedSymbol)?.prediction?.dataQualityOk && (
                            <p className="text-[10px] text-amber-600 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Below {QUALIFIED_CONFIDENCE_MIN}% strength — size down.</p>
                        )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-slate-700 uppercase font-bold tracking-wider flex items-center gap-1">
                                <DollarSign className="w-3 h-3" /> Balance
                                <button onClick={() => setShowBalance(!showBalance)} className="ml-auto text-slate-600">
                                    {showBalance ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                                </button>
                            </label>
                            <input type={showBalance ? 'number' : 'password'} min="1" value={balance}
                                onChange={e => setBalance(Math.max(1, Number(e.target.value)))}
                                className="w-full bg-black/[0.05] border border-black/[0.08] text-slate-900 rounded-xl p-3 mt-1 outline-none focus:border-cyan-500 font-medium" />
                        </div>
                        <div>
                            <label className="text-xs text-slate-700 uppercase font-bold tracking-wider">Risk (%)</label>
                            <input type="number" min="0.1" max="100" step="0.5" value={riskPct}
                                onChange={e => setRiskPct(Math.min(100, Math.max(0.1, Number(e.target.value))))}
                                className="w-full bg-black/[0.05] border border-black/[0.08] text-slate-900 rounded-xl p-3 mt-1 outline-none focus:border-cyan-500 font-medium" />
                        </div>
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                        <input type="checkbox" id="manual-lot" checked={manualLot} onChange={e => setManualLot(e.target.checked)} className="rounded bg-black/10 border-black/20 text-cyan-600" />
                        <label htmlFor="manual-lot" className="text-sm text-slate-600 font-medium">Manual Lot</label>
                        {manualLot && (
                            <input type="number" min="0.01" step="0.01" value={lotSize}
                                onChange={e => setLotSize(Math.max(0.01, Number(e.target.value)))}
                                className="ml-auto w-24 bg-black/[0.05] border border-black/[0.08] text-slate-900 rounded-lg p-1.5 text-sm text-right font-medium" />
                        )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-slate-700 uppercase font-bold tracking-wider">Spread (pips)</label>
                            <input type="number" min="0" max="20" step="1" value={spreadPips}
                                onChange={e => setSpreadPips(Math.max(0, Number(e.target.value)))}
                                className="w-full bg-black/[0.05] border border-black/[0.08] text-slate-900 rounded-xl p-3 mt-1 outline-none focus:border-cyan-500 font-medium" />
                        </div>
                        <div>
                            <label className="text-xs text-slate-700 uppercase font-bold tracking-wider">Slippage (pips)</label>
                            <input type="number" min="0" max="10" step="0.5" value={slippagePips}
                                onChange={e => setSlippagePips(Math.max(0, Number(e.target.value)))}
                                className="w-full bg-black/[0.05] border border-black/[0.08] text-slate-900 rounded-xl p-3 mt-1 outline-none focus:border-cyan-500 font-medium" />
                        </div>
                    </div>
                    <div>
                        <label className="text-xs text-slate-700 uppercase font-bold tracking-wider">Target Risk : Reward</label>
                        <div className="flex items-center gap-3 mt-1">
                            <input type="range" min="1" max="5" step="0.5" value={rrRatio} onChange={e => setRrRatio(Number(e.target.value))}
                                className="flex-1 h-1.5 bg-black/10 rounded-lg appearance-none cursor-pointer accent-cyan-500" />
                            <span className="text-sm font-mono font-bold text-cyan-500 w-12 text-right">1:{rrRatio}</span>
                        </div>
                    </div>
                </div>

                {trade ? (
                    <div className="lg:col-span-2 bg-black/[0.02] border border-black/[0.06] rounded-xl p-5">
                        <StaleDataWarning pred={trade.pred} />
                        <LowR2Warning pred={trade.pred} />
                        <SmallMoveWarning pred={trade.pred} />
                        <DirectionConflictWarning pred={trade.pred} />
                        <HTFSuppressionBadge pred={trade.pred} />
                        <VolumeBadge pred={trade.pred} />
                        {trade.overRisk && (
                            <div className="flex items-start gap-2 mb-3 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-700 font-semibold mt-2">
                                <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-500 mt-0.5" />
                                <div>
                                    <div>Min lot risks ${trade.actualRisk.toFixed(2)} ({trade.overRiskPct.toFixed(1)}%) — exceeds {riskPct}% target.</div>
                                    <div className="font-normal text-amber-600 mt-0.5">Recommended minimum balance: <strong>${trade.recMinBalance.toLocaleString()}</strong></div>
                                </div>
                            </div>
                        )}
                        <div className="bg-cyan-500/5 border border-cyan-500/15 rounded-xl p-3 mb-3 text-xs mt-2">
                            <div className="font-bold text-cyan-600 mb-1">Signal Strength vs Win Probability</div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="text-center bg-black/[0.03] rounded-lg p-2">
                                    <div className="text-[10px] text-slate-600 uppercase font-bold">Signal Strength</div>
                                    <div className="text-xl font-bold text-cyan-500">{trade.pred.signalStrength}%</div>
                                    <div className="text-[9px] text-slate-500">indicator agreement</div>
                                </div>
                                <div className="text-center bg-black/[0.03] rounded-lg p-2">
                                    <div className="text-[10px] text-slate-600 uppercase font-bold">Est. Win Rate</div>
                                    <div className={`text-xl font-bold ${trade.calibratedWinRate !== null ? trade.calibratedWinRate >= 55 ? 'text-emerald-400' : 'text-amber-400' : 'text-slate-400'}`}>
                                        {trade.calibratedWinRate !== null ? `${trade.calibratedWinRate.toFixed(0)}%` : 'N/A'}
                                    </div>
                                    <div className="text-[9px] text-slate-500">{trade.calibratedWinRate !== null ? 'WF calibrated' : trade.pred.backtest?.reason ?? 'need more candles'}</div>
                                </div>
                            </div>
                        </div>
                        <div className="flex justify-between items-start mb-4 pb-4 border-b border-black/[0.06]">
                            <div>
                                <SignalBadge signal={trade.signal} size="lg" />
                                <div className="mt-2 flex gap-2 flex-wrap">
                                    <BacktestBadge backtest={trade.pred.backtest} />
                                    <RegimeBadge adx={trade.pred.adx} />
                                </div>
                                <ConflictWarning pred={{ hasConflict: trade.hasConflict, conflictType: trade.conflictType }} />
                            </div>
                            <div className="text-right">
                                <div className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Strength</div>
                                <div className="text-2xl font-bold text-slate-900">{trade.pred.signalStrength}%</div>
                                <div className="text-xs text-slate-700 mt-0.5">{trade.pred.dataPoints} candles</div>
                            </div>
                        </div>
                        <div className="grid grid-cols-4 gap-3 mb-4">
                            <div className="bg-emerald-500/5 p-3 rounded-lg border border-emerald-500/10">
                                <div className="text-[10px] uppercase text-slate-700 font-bold">Bull</div>
                                <div className="text-xl font-bold text-emerald-400">{trade.bull}</div>
                            </div>
                            <div className="bg-rose-500/5 p-3 rounded-lg border border-rose-500/10">
                                <div className="text-[10px] uppercase text-slate-700 font-bold">Bear</div>
                                <div className="text-xl font-bold text-rose-400">{trade.bear}</div>
                            </div>
                            <div className="bg-black/[0.03] p-3 rounded-lg border border-black/[0.06] col-span-2">
                                <div className="text-[10px] uppercase text-slate-700 font-bold mb-1">Strength</div>
                                <StrengthBar strength={trade.strength} signal={trade.signal} />
                            </div>
                        </div>
                        <div className="bg-amber-500/5 border border-amber-500/10 rounded-xl p-3 mb-4 text-xs">
                            <div className="font-bold text-amber-600 mb-1 flex items-center gap-1"><Info className="w-3 h-3" />Execution Costs</div>
                            <div className="grid grid-cols-3 gap-2 text-center">
                                <div><div className="text-slate-600">Spread</div><div className="font-mono font-bold text-slate-900">{trade.spreadPips}p</div></div>
                                <div><div className="text-slate-600">Slippage</div><div className="font-mono font-bold text-slate-900">{trade.slippagePips}p</div></div>
                                <div><div className="text-slate-600">Total</div><div className="font-mono font-bold text-amber-600">{(trade.spreadPips + trade.slippagePips).toFixed(1)}p</div></div>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 border-t border-black/[0.06] pt-4">
                            <div className="bg-rose-500/5 p-3 rounded-lg border border-rose-500/10">
                                <div className="text-[10px] text-rose-500 font-bold uppercase mb-1">Stop Loss</div>
                                <div className="flex justify-between items-baseline">
                                    <span className="font-bold text-rose-400 font-mono">{formatPrice(trade.sl, selectedSymbol)}</span>
                                    <span className="text-xs text-rose-500/70">-{trade.slPips.toFixed(1)}p</span>
                                </div>
                                <div className="text-[10px] text-rose-500/60 mt-1">{trade.structuralSLUsed ? '📍 Structural' : 'ATR-based'} · Risk: ${trade.actualRisk.toFixed(2)} (incl. {trade.spreadPips + trade.slippagePips}p costs)</div>
                            </div>
                            <div className="bg-emerald-500/5 p-3 rounded-lg border border-emerald-500/10">
                                <div className="text-[10px] text-emerald-500 font-bold uppercase mb-1">Take Profit</div>
                                <div className="flex justify-between items-baseline">
                                    <span className="font-bold text-emerald-400 font-mono">{formatPrice(trade.tp, selectedSymbol)}</span>
                                    <span className="text-xs text-emerald-500/70">+{trade.tpPips.toFixed(1)}p</span>
                                </div>
                                <div className="text-[10px] text-emerald-500/60 mt-1">Profit: ${trade.profit.toFixed(2)}</div>
                            </div>
                        </div>
                        <div className="flex justify-between items-center mt-3 text-xs font-mono text-slate-700 border-t border-black/[0.06] pt-3 flex-wrap gap-2">
                            <span>Entry: <strong className="text-slate-900">{formatPrice(trade.entry, selectedSymbol)}</strong></span>
                            <span>Lot: <strong className="text-slate-900">{trade.lot}</strong></span>
                            <span title="Actual R:R after execution costs" className="cursor-help">
                                Target R: <strong className="text-cyan-500">1:{trade.targetRR}</strong>
                                {' '}· Actual R: <strong className={trade.actualRR >= trade.targetRR * 0.9 ? 'text-emerald-400' : 'text-amber-400'}>{trade.actualRR.toFixed(2)}×</strong>
                            </span>
                            <span>Pip/lot: <strong className="text-slate-700">${trade.pipUSD.toFixed(2)}{trade.pipUSDFallback ? '*' : ''}</strong></span>
                        </div>
                    </div>
                ) : (
                    <div className="lg:col-span-2 bg-black/[0.02] border border-black/[0.06] rounded-xl p-5 flex items-center justify-center text-slate-700 text-sm">
                        Select a pair with active prediction data
                    </div>
                )}
            </div>

            {trade && (
                <div className="border-t border-black/[0.06] pt-6 space-y-6">
                    {trade.evBacktested !== null && (
                        <div className={`p-4 rounded-xl border flex items-center gap-4 ${trade.evBacktested >= 0 ? 'bg-emerald-500/5 border-emerald-500/10' : 'bg-rose-500/5 border-rose-500/10'}`}>
                            <Award className={`w-5 h-5 flex-shrink-0 ${trade.evBacktested >= 0 ? 'text-emerald-400' : 'text-rose-400'}`} />
                            <div>
                                <div className="text-xs font-bold text-slate-900">Walk-Forward Calibrated Expected Value</div>
                                <div className="text-xs text-slate-700 mt-0.5">
                                    Using {trade.calibratedWinRate !== null ? `${trade.calibratedWinRate.toFixed(0)}% calibrated WR` : `${(trade.btWinRate * 100).toFixed(0)}% WF WR`}
                                    {' '}({trade.pred.backtest?.total ?? 0} test trades):
                                    <span className={`font-mono font-bold ml-1 ${trade.evBacktested >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {trade.evBacktested >= 0 ? '+' : ''}${trade.evBacktested.toFixed(2)} per trade
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}
                    <div className="flex items-center gap-2"><BarChart3 className="w-4 h-4 text-cyan-500" /><h3 className="text-sm font-bold text-slate-900">Profit Projections</h3></div>
                    <div className="bg-black/[0.02] rounded-xl border border-black/[0.06] p-4">
                        <div className="text-xs font-bold text-slate-700 uppercase mb-3">Lot Size Scenarios</div>
                        <div className="space-y-2">
                            {trade.scenarios.map(s => {
                                const pct = maxScenarioProfit > 0 ? Math.round((s.profit / maxScenarioProfit) * 100) : 0;
                                return (
                                    <div key={s.lot} className={`flex items-center gap-3 py-1.5 px-3 rounded-lg transition-all ${s.isActive ? 'bg-cyan-500/10 border border-cyan-500/20' : ''}`}>
                                        <span className={`text-xs font-mono w-16 flex-shrink-0 ${s.isActive ? 'text-cyan-500 font-bold' : 'text-slate-500'}`}>{s.lot} lot</span>
                                        <div className="flex-1 h-1.5 bg-black/10 rounded-full overflow-hidden">
                                            <div style={{ width: `${pct}%` }} className={`h-full rounded-full transition-all duration-500 ${s.isActive ? 'bg-cyan-500' : 'bg-emerald-500/60'}`} />
                                        </div>
                                        <span className="text-xs font-mono text-emerald-400 w-20 text-right font-semibold">+${s.profit.toFixed(2)}</span>
                                        <span className="text-xs font-mono text-rose-400/70 w-20 text-right">-${s.risk.toFixed(2)}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <GlassCard className="p-4">
                            <div className="text-[10px] text-slate-700 uppercase font-bold mb-1">Breakeven Win Rate</div>
                            <div className="text-2xl font-mono font-bold text-slate-900">{trade.breakevenWinRate.toFixed(0)}%</div>
                            <div className="text-[10px] text-slate-700 mt-1">Required at 1:{rrRatio}</div>
                        </GlassCard>
                        <GlassCard className="p-4">
                            <div className="text-[10px] text-slate-700 uppercase font-bold mb-1">EV at 50% Win Rate</div>
                            <div className={`text-2xl font-mono font-bold ${trade.evAt50 >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {trade.evAt50 >= 0 ? '+' : ''}${trade.evAt50.toFixed(2)}
                            </div>
                            <div className="text-[10px] text-slate-700 mt-1">{trade.evAt50 >= 0 ? 'Positive edge at 50%' : 'Need higher R:R'}</div>
                        </GlassCard>
                        <GlassCard className="p-4">
                            <div className="text-[10px] text-slate-700 uppercase font-bold mb-1">Net Risk Per Trade</div>
                            <div className={`text-2xl font-mono font-bold ${trade.overRisk ? 'text-amber-500' : 'text-rose-400'}`}>${trade.actualRisk.toFixed(2)}</div>
                            <div className="text-[10px] text-slate-700 mt-1">{trade.overRiskPct.toFixed(1)}% · incl. costs</div>
                        </GlassCard>
                    </div>
                    <GlassCard className="p-4">
                        <div className="text-xs font-bold text-slate-600 uppercase mb-0.5">Projected Growth — 20 Trades (Alternating Win/Loss)</div>
                        <div className="text-[10px] text-slate-500 mb-2">Illustrative — not Monte Carlo</div>
                        <div className="h-32 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={trade.growthData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor={trade.growthData[trade.growthData.length - 1].value >= balance ? '#10b981' : '#f43f5e'} stopOpacity={0.3} />
                                            <stop offset="95%" stopColor={trade.growthData[trade.growthData.length - 1].value >= balance ? '#10b981' : '#f43f5e'} stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <Area type="monotone" dataKey="value"
                                        stroke={trade.growthData[trade.growthData.length - 1].value >= balance ? '#10b981' : '#f43f5e'}
                                        fill="url(#growthGrad)" strokeWidth={2} dot={false} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-700 mt-1">
                            <span>Start: ${balance.toLocaleString()}</span>
                            <span className={trade.growthData[trade.growthData.length - 1].value >= balance ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold'}>
                                After 20: ${trade.growthData[trade.growthData.length - 1].value.toFixed(2)}
                            </span>
                        </div>
                    </GlassCard>
                </div>
            )}

            {showAdv && trade?.pred && (
                <div className="mt-4 pt-4 border-t border-black/[0.06] grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                        { label: 'RSI (14)', val: trade.pred.rsiValid ? trade.pred.rsi.toFixed(1) : 'N/A', sub: !trade.pred.rsiValid ? 'Insufficient data' : trade.pred.rsi <= 30 ? '⚡ Oversold' : trade.pred.rsi >= 70 ? '⚡ Overbought' : 'Neutral', color: !trade.pred.rsiValid ? 'text-slate-600' : trade.pred.rsi >= 70 ? 'text-rose-400' : trade.pred.rsi <= 30 ? 'text-emerald-400' : 'text-slate-900' },
                        { label: 'MACD (ATR%)', val: trade.pred.macd.histogram !== undefined ? formatMacdNormalised(trade.pred.macd.histogram, trade.pred.atr, trade.pairMeta.pipValue) : 'N/A', sub: !trade.pred.macdValid ? 'Below noise floor' : trade.pred.macd.histogram > 0 ? 'Bullish momentum' : 'Bearish momentum', color: !trade.pred.macdValid ? 'text-slate-600' : trade.pred.macd.histogram > 0 ? 'text-emerald-400' : 'text-rose-400' },
                        { label: 'BB %B', val: trade.pred.bbValid ? (trade.pred.bollinger.percentB * 100).toFixed(0) + '%' : 'N/A', sub: !trade.pred.bbValid ? 'Insufficient' : trade.pred.bollinger.percentB <= 0.10 ? '⚡ Below lower' : trade.pred.bollinger.percentB >= 0.90 ? '⚡ Above upper' : 'Mid range', color: !trade.pred.bbValid ? 'text-slate-600' : 'text-cyan-500' },
                        { label: 'EMA Cross', val: !trade.pred.emaValid ? 'N/A' : trade.pred.ema12 > trade.pred.ema26 ? 'GOLDEN' : 'DEATH', sub: !trade.pred.emaValid ? 'Insufficient' : `12=${formatPrice(trade.pred.ema12, selectedSymbol)} / 26=${formatPrice(trade.pred.ema26, selectedSymbol)}`, color: !trade.pred.emaValid ? 'text-slate-600' : trade.pred.ema12 > trade.pred.ema26 ? 'text-emerald-400' : 'text-rose-400' },
                        { label: 'ADX', val: trade.pred.adx.adx ? trade.pred.adx.adx.toFixed(0) : 'N/A', sub: trade.pred.adx.trending ? 'Trending (>20)' : 'Choppy (<20)', color: trade.pred.adx.trending ? 'text-blue-400' : 'text-slate-600' },
                        { label: 'Stochastic', val: trade.pred.stochastic?.valid ? `${trade.pred.stochastic.k.toFixed(0)}/${trade.pred.stochastic.d.toFixed(0)}` : 'N/A', sub: trade.pred.stochastic?.valid ? trade.pred.stochastic.k < 20 ? '⚡ Oversold' : trade.pred.stochastic.k > 80 ? '⚡ Overbought' : 'Neutral' : 'Insufficient', color: !trade.pred.stochastic?.valid ? 'text-slate-600' : trade.pred.stochastic.k < 20 ? 'text-emerald-400' : trade.pred.stochastic.k > 80 ? 'text-rose-400' : 'text-slate-900' },
                        { label: '1H Trend', val: trade.pred.htfAlignment.htfTrend ? `${trade.pred.htfAlignment.htfTrend} (${trade.pred.htfAlignment.htfAdx?.toFixed(0) ?? '?'})` : 'N/A', sub: trade.pred.htfSuppressed ? `⚠ Suppressed (ADX>${HTF_SUPPRESS_ADX_THRESHOLD})` : trade.pred.htfAlignment.htfTrend ? `Aligned · threshold ADX>${HTF_SUPPRESS_ADX_THRESHOLD}` : 'No 1H data', color: trade.pred.htfAlignment.htfTrend === 'bullish' ? 'text-emerald-400' : trade.pred.htfAlignment.htfTrend === 'bearish' ? 'text-rose-400' : 'text-slate-600' },
                        { label: 'Volume', val: !trade.pred.volumeConf.hasData ? 'OTC/N/A' : trade.pred.volumeConf.confirmed ? 'High' : 'Low', sub: !trade.pred.volumeConf.hasData ? 'No real vol data (OTC FX)' : `${trade.pred.volumeConf.ratio?.toFixed(2)}× SMA`, color: !trade.pred.volumeConf.hasData ? 'text-slate-500' : trade.pred.volumeConf.confirmed ? 'text-emerald-400' : 'text-rose-400' },
                    ].map(item => <MetricCell key={item.label} {...item} />)}
                </div>
            )}
        </GlassCard>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// MARKET TICKER
// ─────────────────────────────────────────────────────────────────────────────
const MarketTicker = ({ data }) => {
    if (!data || data.length === 0) return null;
    return (
        <div className="mb-6 overflow-hidden">
            <div className="flex gap-3 flex-wrap">
                {data.filter(d => d.currentRate).map(d => {
                    const pred = d.prediction;
                    const change = pred?.sessionChange;
                    return (
                        <div key={d.pair.symbol} className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-black/[0.03] border border-black/[0.06] rounded-xl">
                            <span className="text-xs font-bold text-slate-900">{d.pair.symbol}</span>
                            <span className="text-xs font-mono text-slate-700">{formatPrice(d.currentRate, d.pair.symbol)}</span>
                            {change && <span className={`text-[10px] font-mono font-bold ${change.value >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{change.text}</span>}
                            {pred && <SignalBadge signal={pred.signal} size="sm" />}
                            {pred?.adx?.trending && <span className="text-[10px] text-blue-400">📈</span>}
                            {pred?.volumeConf?.hasData && pred?.volumeConf?.confirmed && <span className="text-[10px] text-emerald-400" title="Volume confirmed">🔊</span>}
                            {pred?.htfAlignment?.htfTrend && (
                                <span className={`text-[10px] ${pred.htfAlignment.htfTrend === 'bullish' ? 'text-emerald-400' : 'text-rose-400'}`}
                                    title={`1H ${pred.htfAlignment.htfTrend} (ADX ${pred.htfAlignment.htfAdx?.toFixed(0) ?? 'N/A'})`}>1H</span>
                            )}
                            {pred && !pred.dataQualityOk && <span className="text-[10px] text-orange-400">⏳</span>}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// PAIR CARD
// ─────────────────────────────────────────────────────────────────────────────
const PairCard = ({ item }) => {
    const gradientId = makeGradientId(item.pair.symbol);
    const pred = item.prediction;
    const isBull = pred?.trend === 'bullish';
    const color = isBull ? '#10b981' : pred?.trend === 'bearish' ? '#f43f5e' : '#64748b';
    const signal = pred?.signal ?? 'HOLD';

    return (
        <GlassCard
            className={`p-5 hover:scale-[1.02] transition-all duration-300 cursor-default group ${pred && !pred.dataQualityOk ? 'border-orange-500/20' : ''}`}
            glow={isBull ? 'bg-gradient-to-br from-emerald-500/5 to-transparent' : pred?.trend === 'bearish' ? 'bg-gradient-to-br from-rose-500/5 to-transparent' : ''}>
            <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/[0.06] flex items-center justify-center text-lg border border-black/[0.08] font-bold text-slate-700 group-hover:scale-110 transition-transform">{item.pair.base.substring(0, 1)}</div>
                    <div>
                        <h3 className="font-bold text-slate-900 text-lg leading-none">{item.pair.symbol}</h3>
                        <span className="text-xs text-slate-700">{item.pair.name}</span>
                        <div className="flex flex-col gap-0.5 mt-1">
                            <StaleDataWarning pred={pred} />
                            <LowR2Warning pred={pred} />
                            <SmallMoveWarning pred={pred} />
                            <ConflictWarning pred={pred} />
                            <DirectionConflictWarning pred={pred} />
                            <HTFSuppressionBadge pred={pred} />
                            {pred?.adx && <RegimeBadge adx={pred.adx} />}
                        </div>
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-lg font-mono font-bold text-slate-900">{formatPrice(item.currentRate, item.pair.symbol)}</div>
                    {pred && <div className={`text-xs font-mono mt-0.5 ${pred.sessionChange.value >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{pred.sessionChange.text}</div>}
                    {pred?.backtest && !pred.backtest.insufficient && pred.backtest.total >= WF_MIN_TEST_TRADES && (
                        <div className={`text-[10px] font-mono mt-0.5 ${pred.backtest.winRate >= 55 ? 'text-emerald-500' : pred.backtest.winRate >= 45 ? 'text-amber-500' : 'text-rose-500'}`}
                            title={`WF: ${pred.backtest.trainCandles} train / ${pred.backtest.testCandles} test`}>
                            WF: {pred.backtest.winRate.toFixed(0)}% WR
                        </div>
                    )}
                    {pred?.calibratedWinRate !== null && pred?.calibratedWinRate !== undefined && (
                        <div className={`text-[10px] font-mono mt-0.5 font-bold ${pred.calibratedWinRate >= 55 ? 'text-emerald-500' : 'text-amber-500'}`}
                            title="Calibrated WR from WF score buckets">Cal: {pred.calibratedWinRate.toFixed(0)}%</div>
                    )}
                </div>
            </div>
            <div className="h-20 w-full mb-4 rounded-lg overflow-hidden">
                {item.history.length > 1 ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={item.history}>
                            <defs>
                                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                                    <stop offset="95%" stopColor={color} stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <Area type="monotone" dataKey="price" stroke={color} fill={`url(#${gradientId})`} strokeWidth={2} dot={false} />
                        </AreaChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="h-full flex items-center justify-center text-xs text-slate-600">Awaiting data…</div>
                )}
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
                {[
                    { label: 'RSI', val: pred?.rsiValid ? pred.rsi.toFixed(0) : '—', color: !pred?.rsiValid ? 'text-slate-600' : pred.rsi >= 70 ? 'text-rose-400' : pred.rsi <= 30 ? 'text-emerald-400' : 'text-slate-900' },
                    { label: 'ADX', val: pred?.adx?.adx ? pred.adx.adx.toFixed(0) : '—', color: pred?.adx?.trending ? 'text-blue-400' : 'text-slate-600' },
                ].map(cell => (
                    <div key={cell.label} className="bg-black/[0.03] rounded-lg p-2 text-center border border-white/[0.05]">
                        <div className="text-[10px] text-slate-700 uppercase font-semibold">{cell.label}</div>
                        <div className={`text-sm font-mono font-bold ${cell.color} truncate`}>{cell.val}</div>
                    </div>
                ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
                {[
                    { label: 'Signal', val: signal, color: signal === 'BUY' ? 'text-emerald-400' : signal === 'SELL' ? 'text-rose-400' : 'text-slate-500' },
                    { label: 'Strength', val: pred ? `${pred.signalStrength}%` : '—', color: pred?.signalStrength >= 70 ? 'text-emerald-400' : pred?.signalStrength >= QUALIFIED_CONFIDENCE_MIN ? 'text-amber-400' : 'text-slate-500' },
                ].map(cell => (
                    <div key={cell.label} className="bg-black/[0.03] rounded-lg p-2 text-center border border-white/[0.05]">
                        <div className="text-[10px] text-slate-700 uppercase font-semibold">{cell.label}</div>
                        <div className={`text-sm font-mono font-bold ${cell.color} truncate`}>{cell.val}</div>
                    </div>
                ))}
            </div>
            {pred?.htfAlignment?.htfTrend && <div className="mt-2 flex gap-1"><HTFBadge htfAlignment={pred.htfAlignment} /></div>}
            {pred && (
                <div className="mt-3 flex items-center justify-center text-[10px] text-slate-600">
                    <span className={pred.volatilityLabel === 'High' ? 'text-amber-500' : ''}>{pred.volatilityLabel} Volatility</span>
                </div>
            )}
        </GlassCard>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// PAGINATION
// ─────────────────────────────────────────────────────────────────────────────
const PaginationControls = ({ currentPage, totalPages, onPageChange, totalItems }) => {
    if (totalPages <= 1) return null;
    return (
        <div className="flex items-center justify-between mb-6 text-sm text-slate-700">
            <span>{totalItems} pairs · Page {currentPage}/{totalPages}</span>
            <div className="flex gap-2">
                <button onClick={() => onPageChange(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                    className="px-4 py-2 rounded-xl bg-black/[0.05] border border-black/[0.08] hover:border-cyan-500/50 disabled:opacity-30 transition text-slate-900 font-medium">‹ Prev</button>
                <button onClick={() => onPageChange(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                    className="px-4 py-2 rounded-xl bg-black/[0.05] border border-black/[0.08] hover:border-cyan-500/50 disabled:opacity-30 transition text-slate-900 font-medium">Next ›</button>
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// MARKET SENTIMENT
// ─────────────────────────────────────────────────────────────────────────────
const MarketSentiment = ({ data }) => {
    const stats = useMemo(() => {
        const withPred = data.filter(d => d.prediction);
        const ready = withPred.filter(d => d.prediction.dataQualityOk);
        const buys = ready.filter(d => d.prediction.signal === 'BUY').length;
        const sells = ready.filter(d => d.prediction.signal === 'SELL').length;
        const holds = ready.filter(d => d.prediction.signal === 'HOLD').length;
        const avgStr = ready.length > 0 ? Math.round(ready.reduce((s, d) => s + d.prediction.signalStrength, 0) / ready.length) : 0;
        const trending = ready.filter(d => d.prediction.adx?.trending).length;
        const volConfirmed = ready.filter(d => d.prediction.volumeConf?.hasData && d.prediction.volumeConf?.confirmed === true).length;
        const volAvailable = ready.filter(d => d.prediction.volumeConf?.hasData).length;
        const btPairs = ready.filter(d => d.prediction.backtest && !d.prediction.backtest.insufficient && d.prediction.backtest.total >= WF_MIN_TEST_TRADES);
        const avgBt = btPairs.length > 0 ? Math.round(btPairs.reduce((s, d) => s + d.prediction.backtest.winRate, 0) / btPairs.length) : null;
        const warmingUp = withPred.filter(d => !d.prediction.dataQualityOk).length;
        const qualifiedCount = ready.filter(d => isQualifiedPair(d)).length;
        return { buys, sells, holds, avgStr, total: ready.length, trending, volConfirmed, volAvailable, avgBt, btPairsCount: btPairs.length, warmingUp, qualifiedCount };
    }, [data]);

    if (stats.total === 0 && stats.warmingUp === 0) return null;
    const sentiment = stats.buys > stats.sells ? 'Bullish' : stats.sells > stats.buys ? 'Bearish' : stats.total === 0 ? 'Loading' : 'Neutral';
    const sentColor = sentiment === 'Bullish' ? 'text-emerald-500' : sentiment === 'Bearish' ? 'text-rose-500' : 'text-slate-600';

    return (
        <GlassCard className="p-5 mb-6">
            <div className="flex items-center gap-2 mb-4">
                <Gauge className="w-4 h-4 text-cyan-500" />
                <h3 className="text-sm font-bold text-slate-900">Market Sentiment</h3>
                {stats.warmingUp > 0 && <span className="text-[10px] text-orange-400 font-bold ml-auto">⏳ {stats.warmingUp} warming</span>}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                {[
                    { label: 'Overall', val: sentiment, color: sentColor, bg: 'bg-black/[0.03] border-black/[0.06]' },
                    { label: 'BUY', val: stats.buys, color: 'text-emerald-400', bg: 'bg-emerald-500/5 border-emerald-500/10' },
                    { label: 'SELL', val: stats.sells, color: 'text-rose-400', bg: 'bg-rose-500/5    border-rose-500/10' },
                    { label: 'HOLD', val: stats.holds, color: 'text-slate-600', bg: 'bg-black/[0.03]  border-black/[0.06]' },
                    { label: 'Avg Str', val: stats.total > 0 ? `${stats.avgStr}%` : '—', color: stats.avgStr >= 65 ? 'text-emerald-400' : stats.avgStr >= QUALIFIED_CONFIDENCE_MIN ? 'text-cyan-500' : 'text-amber-400', bg: 'bg-black/[0.03] border-black/[0.06]', tooltip: 'Average signal strength (indicator agreement), not win probability.' },
                    { label: 'Trend', val: stats.trending, color: 'text-blue-400', bg: 'bg-black/[0.03] border-black/[0.06]' },
                ].map(item => (
                    <div key={item.label} className={`rounded-xl p-3 text-center border ${item.bg}`} title={item.tooltip}>
                        <div className="text-[10px] text-slate-700 uppercase font-bold flex items-center justify-center gap-1">
                            {item.label}{item.tooltip && <Info className="w-2.5 h-2.5 text-slate-400" />}
                        </div>
                        <div className={`text-lg font-bold ${item.color}`}>{item.val}</div>
                    </div>
                ))}
            </div>
        </GlassCard>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
const ForexDashboard = () => {
    const [pairsData, setPairsData] = useState([]);
    const [predictor] = useState(() => new ForexPredictor());
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState(Date.now());
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [dataSource, setDataSource] = useState('Initialising…');
    const [page, setPage] = useState(1);
    const [activeSessions, setActiveSessions] = useState([]);

    const PER_PAGE = 8;

    const mountedRef = useRef(true);
    const idleCallbacks = useRef([]);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            idleCallbacks.current.forEach(id => { try { cancelIdleCallback(id); } catch { clearTimeout(id); } });
        };
    }, []);

    const safeSet = useCallback((setter) => (...args) => { if (mountedRef.current) setter(...args); }, []);
    const safePairsSet = useMemo(() => safeSet(setPairsData), [safeSet]);
    const safeLoadSet = useMemo(() => safeSet(setLoading), [safeSet]);
    const safeUpdatedSet = useMemo(() => safeSet(setLastUpdated), [safeSet]);
    const safeRefreshSet = useMemo(() => safeSet(setIsRefreshing), [safeSet]);
    const safeSourceSet = useMemo(() => safeSet(setDataSource), [safeSet]);
    const safePageSet = useMemo(() => safeSet(setPage), [safeSet]);

    const [chatOpen, setChatOpen] = useState(false);
    const chatGenRef = useRef(0);
    const [messages, setMessages] = useState(() => [
        makeMsg('assistant', `QuantAI online.\n\nDeterministic slippage · environment configurations · price-level regression · idle scheduling.\n\nWaiting for data…`),
    ]);
    const [input, setInput] = useState('');
    const msgEndRef = useRef(null);

    const pairsRef = useRef(pairsData);
    const messagesRef = useRef(messages);
    pairsRef.current = pairsData;
    messagesRef.current = messages;

    const groqAbortRef = useRef(null);
    const longAbortRef = useRef(null);
    const tickAbortRef = useRef(null);
    const tickRunning = useRef(false);
    const refreshLock = useRef(false);

    useEffect(() => {
        const update = () => setActiveSessions(getActiveSessions(new Date().getUTCHours()));
        update();
        const id = setInterval(update, 60_000);
        return () => clearInterval(id);
    }, []);

    const rehydratePair = useCallback(symbol => CURRENCY_PAIRS.find(p => p.symbol === symbol) ?? null, []);

    const schedulePredictions = useCallback((pairs, sessions) => {
        return new Promise(resolve => {
            const results = [...pairs];
            let idx = 0;
            const processNext = () => {
                if (!mountedRef.current || idx >= results.length) { resolve(results); return; }
                const item = results[idx++];
                if (item.currentRate) {
                    const sessionQuality = getSessionQuality(item.pair.symbol, sessions);
                    item.prediction = predictor.predict(item.pair.symbol, item.pair, sessionQuality, sessions);
                }
                const schedFn = typeof requestIdleCallback === 'function'
                    ? (cb) => { const id = requestIdleCallback(cb, { timeout: 500 }); idleCallbacks.current.push(id); return id; }
                    : (cb) => { const id = setTimeout(cb, 0); idleCallbacks.current.push(id); return id; };
                schedFn(processNext);
            };
            processNext();
        });
    }, [predictor]);

    const buildPairsShell = useCallback((tsMap, prevPairs = []) => {
        return CURRENCY_PAIRS.map(pairMeta => {
            const ts = tsMap[pairMeta.symbol];
            const prev = prevPairs.find(p => p.pair.symbol === pairMeta.symbol);
            if (ts?.series?.length) predictor.setHistory(pairMeta.symbol, ts.series);
            else if (prev?.history?.length) predictor.setHistory(pairMeta.symbol, prev.history);
            if (ts?.htf?.length) predictor.setHTFHistory(pairMeta.symbol, ts.htf);
            else if (prev?.htfHistory?.length) predictor.setHTFHistory(pairMeta.symbol, prev.htfHistory);
            const rate = ts?.series?.[ts.series.length - 1]?.price ?? prev?.currentRate ?? null;
            const history = predictor.getHistory(pairMeta.symbol).slice(-TIMESERIES_SIZE);
            const htfHistory = predictor.getHTFHistory(pairMeta.symbol).slice(-HTF_SIZE);
            return { pair: pairMeta, currentRate: rate, history, htfHistory, prediction: null };
        });
    }, [predictor]);

    const initData = useCallback(async () => {
        if (longAbortRef.current) longAbortRef.current.abort();
        const controller = new AbortController();
        longAbortRef.current = controller;
        const { signal } = controller;
        const sessions = getActiveSessions(new Date().getUTCHours());

        const cached = safeReadCache();
        if (cached) {
            const { timestamp, data: cd } = cached;
            const age = Date.now() - timestamp;
            cd.forEach(item => {
                const pair = rehydratePair(item.pair?.symbol);
                if (pair) {
                    if (item.history?.length) predictor.setHistory(pair.symbol, item.history);
                    if (item.htfHistory?.length) predictor.setHTFHistory(pair.symbol, item.htfHistory);
                }
            });
            const shells = cd.map(item => {
                const pair = rehydratePair(item.pair?.symbol);
                if (!pair) return null;
                return { pair, currentRate: item.currentRate, history: item.history, htfHistory: item.htfHistory ?? [], prediction: null };
            }).filter(Boolean);
            const completed = await schedulePredictions(shells, sessions);
            safePairsSet(completed);
            safeUpdatedSet(timestamp);
            safeSourceSet(`Cached (${Math.round(age / 60000)}m old${age >= UPDATE_INTERVAL ? ' — refreshing…' : ''})`);
            if (age < UPDATE_INTERVAL) { return; }
        }

        const estSeconds = Math.ceil((CURRENCY_PAIRS.length / BATCH_SIZE) * (BATCH_DELAY_MS / 1000));
        safeSourceSet(`Fetching ${TIMESERIES_SIZE} 5-min candles + 1H HTF per pair — est. ~${estSeconds}s…`);
        try {
            const tsMap = await fetchAllTimeSeries(signal);
            if (signal.aborted) return;
            const shells = buildPairsShell(tsMap);
            const now = Date.now();
            const completed = await schedulePredictions(shells, sessions);
            safePairsSet(completed);
            safeUpdatedSet(now);
            safePageSet(1);
            const liveCount = Object.keys(tsMap).length;
            const readyCount = completed.filter(p => p.prediction?.dataQualityOk).length;
            const btCount = completed.filter(p => p.prediction?.backtest && !p.prediction.backtest.insufficient).length;
            safeSourceSet(`Twelve Data — ${liveCount}/${CURRENCY_PAIRS.length} pairs · ${readyCount} ready · ${btCount} with WF`);
            safeSetCache(completed, now);
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.error('initData error:', err);
            safeSourceSet('Error fetching data — check console.');
        } finally {
            safeLoadSet(false);
        }
    }, [predictor, buildPairsShell, rehydratePair, safePairsSet, safeUpdatedSet, safeSourceSet, safeLoadSet, safePageSet, schedulePredictions]);

    const forceRefresh = useCallback(async () => {
        if (refreshLock.current) return;
        refreshLock.current = true;
        safeRefreshSet(true);
        if (longAbortRef.current) longAbortRef.current.abort();
        if (tickAbortRef.current) tickAbortRef.current.abort();
        tickRunning.current = false;
        rateLimiter.reset();
        const controller = new AbortController();
        longAbortRef.current = controller;
        const { signal } = controller;
        const sessions = getActiveSessions(new Date().getUTCHours());
        const snapshot = pairsRef.current;
        CURRENCY_PAIRS.forEach(p => predictor.setHistory(p.symbol, []));
        predictor.clearBacktestCache();
        safeRemoveCache();
        const estSeconds = Math.ceil((CURRENCY_PAIRS.length / BATCH_SIZE) * (BATCH_DELAY_MS / 1000));
        safeSourceSet(`Refreshing — est. ~${estSeconds}s…`);
        try {
            const tsMap = await fetchAllTimeSeries(signal);
            if (signal.aborted) return;
            if (Object.keys(tsMap).length === 0) {
                snapshot.forEach(item => { if (item.history?.length) predictor.setHistory(item.pair.symbol, item.history); });
                safePairsSet(snapshot);
                safeSourceSet('No data returned — showing last known state. Retry in 1 min.');
                return;
            }
            const shells = buildPairsShell(tsMap);
            const now = Date.now();
            const completed = await schedulePredictions(shells, sessions);
            safePairsSet(completed);
            safeUpdatedSet(now);
            safePageSet(1);
            const readyCount = completed.filter(p => p.prediction?.dataQualityOk).length;
            safeSourceSet(`Twelve Data — ${Object.keys(tsMap).length}/${CURRENCY_PAIRS.length} pairs · ${readyCount} ready`);
            safeSetCache(completed, now);
        } catch (err) {
            if (err.name === 'AbortError') return;
            snapshot.forEach(item => { if (item.history?.length) predictor.setHistory(item.pair.symbol, item.history); });
            safePairsSet(snapshot);
            safeSourceSet('Refresh failed — showing last known state');
        } finally {
            safeRefreshSet(false);
            refreshLock.current = false;
        }
    }, [predictor, buildPairsShell, safePairsSet, safeUpdatedSet, safeSourceSet, safeRefreshSet, safePageSet, schedulePredictions]);

    const tickUpdate = useCallback(async () => {
        if (tickRunning.current || refreshLock.current) return;
        tickRunning.current = true;
        if (tickAbortRef.current) tickAbortRef.current.abort();
        const tickController = new AbortController();
        tickAbortRef.current = tickController;
        const { signal } = tickController;
        const sessions = getActiveSessions(new Date().getUTCHours());
        try {
            safeSourceSet(prev => prev.includes('warming') ? prev : 'Updating spot prices…');
            const now = Date.now();
            const batch1 = await Promise.allSettled(CURRENCY_PAIRS.slice(0, BATCH_SIZE).map(async p => ({ symbol: p.symbol, rate: await fetchSpotPrice(p, signal) })));
            if (signal.aborted || refreshLock.current) return;
            await new Promise(r => { const t = setTimeout(r, BATCH_DELAY_MS / 2); signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });
            if (signal.aborted || refreshLock.current) return;
            const batch2 = await Promise.allSettled(CURRENCY_PAIRS.slice(BATCH_SIZE).map(async p => ({ symbol: p.symbol, rate: await fetchSpotPrice(p, signal) })));
            if (signal.aborted || refreshLock.current) return;
            const allUpdates = [
                ...batch1.filter(r => r.status === 'fulfilled').map(r => r.value),
                ...batch2.filter(r => r.status === 'fulfilled').map(r => r.value),
            ];
            const prevPairs = pairsRef.current;
            const shells = prevPairs.map(item => {
                const upd = allUpdates.find(u => u.symbol === item.pair.symbol);
                const rate = upd?.rate ?? item.currentRate;
                if (!rate) return { ...item };
                predictor.addTick(item.pair.symbol, rate);
                const history = predictor.getHistory(item.pair.symbol).slice(-TIMESERIES_SIZE);
                return { ...item, currentRate: rate, history, prediction: null };
            });
            const completed = await schedulePredictions(shells, sessions);
            if (signal.aborted || refreshLock.current) return;
            safePairsSet(completed);
            safeUpdatedSet(now);
            const readyCount = completed.filter(p => p.prediction?.dataQualityOk).length;
            const warmingCount = completed.filter(p => p.prediction && !p.prediction.dataQualityOk).length;
            const btCount = completed.filter(p => p.prediction?.backtest && !p.prediction.backtest.insufficient).length;
            safeSourceSet(`Twelve Data (5-min poll) · ${readyCount} ready · ${btCount} WF · ${warmingCount} warming`);
            safeSetCache(completed, now);
        } catch (err) {
            if (err.name !== 'AbortError') safeSourceSet('Tick failed — retrying next interval');
        } finally {
            tickRunning.current = false;
        }
    }, [predictor, safePairsSet, safeUpdatedSet, safeSourceSet, schedulePredictions]);

    useEffect(() => {
        safeLoadSet(true);
        initData().finally(() => safeLoadSet(false));
        return () => { if (longAbortRef.current) longAbortRef.current.abort(); };
    }, []); // eslint-disable-line

    useEffect(() => {
        if (loading) return;
        const id = setInterval(tickUpdate, UPDATE_INTERVAL);
        return () => { clearInterval(id); if (tickAbortRef.current) tickAbortRef.current.abort(); };
    }, [loading, tickUpdate]);

    useEffect(() => { msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

    const qualifiedPairs = pairsData.filter(isQualifiedPair);
    const bestData = (qualifiedPairs.length > 0 ? qualifiedPairs : pairsData.filter(d => d.prediction !== null))
        .reduce((p, c) => (c.prediction?.signalStrength ?? 0) > (p?.prediction?.signalStrength ?? 0) ? c : p, null);

    const pagePairs = pairsData.slice((page - 1) * PER_PAGE, page * PER_PAGE);
    const warmingUpCount = pairsData.filter(d => d.prediction && !d.prediction.dataQualityOk).length;
    const pairMap = useMemo(() => new Map(pairsData.map(d => [d.pair.symbol, d])), [pairsData]);
    const estSeconds = Math.ceil((CURRENCY_PAIRS.length / BATCH_SIZE) * (BATCH_DELAY_MS / 1000));

    const handleChat = useCallback(async (e) => {
        e.preventDefault();
        if (!input.trim()) return;
        const userMsg = input.trim();
        setInput('');
        const thisGen = ++chatGenRef.current;
        if (groqAbortRef.current) groqAbortRef.current.abort();
        const groqController = new AbortController();
        groqAbortRef.current = groqController;
        const userEntry = makeMsg('user', userMsg);
        const loadingEntry = makeMsg('assistant', '⏳ Analysing…', { isLoading: true });
        const allMsgs = messagesRef.current.filter(m => !m.isLoading);
        const recentMsgs = [...allMsgs, userEntry].slice(-12);
        setMessages(prev => { const trimmed = prev.filter(m => !m.isLoading).slice(-(MAX_CHAT_MESSAGES - 2)); return [...trimmed, userEntry, loadingEntry]; });
        const commitReply = (msg) => { if (chatGenRef.current !== thisGen) return; setMessages(prev => [...prev.filter(m => !m.isLoading).slice(-(MAX_CHAT_MESSAGES - 1)), msg]); };
        const clearLoading = () => { if (chatGenRef.current !== thisGen) return; setMessages(prev => prev.filter(m => !m.isLoading)); };
        try {
            const reply = await sendToGroq(pairsRef.current, recentMsgs, groqController.signal);
            if (groqController.signal.aborted) { clearLoading(); return; }
            commitReply(makeMsg('assistant', reply));
        } catch (err) {
            if (err.name === 'AbortError') { clearLoading(); return; }
            commitReply(makeMsg('assistant', getFallbackReply(userMsg, pairsRef.current)));
        }
    }, [input]);

    useEffect(() => { return () => { if (groqAbortRef.current) groqAbortRef.current.abort(); }; }, []);

    // ── Render priority: loading → dashboard ──────────────────────────────────

    if (loading) return <LoadingScreen estimatedSeconds={estSeconds} />;

    return (
        <div className="min-h-screen bg-[#f1f5f9] text-slate-900 font-sans selection:bg-cyan-500/30 selection:text-cyan-900 relative">
            <div className="fixed inset-0 w-full h-full bg-gradient-to-br from-cyan-500/10 via-transparent to-teal-500/10 pointer-events-none z-0" />

            <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 bg-cyan-600 text-white px-4 py-2 rounded-lg z-50">Skip to main content</a>

            <nav className="border-b border-black/[0.06] bg-[#f8fafc]/80 backdrop-blur-2xl sticky top-0 z-40">
                <div className="w-full mx-auto px-6 lg:px-12 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="bg-gradient-to-br from-cyan-500 to-teal-600 p-2 rounded-xl shadow-lg shadow-cyan-500/20">
                            <Activity className="w-5 h-5 text-white" />
                        </div>
                        <h1 className="font-bold text-lg tracking-tight">QUANT<span className="bg-gradient-to-r from-cyan-500 to-teal-500 bg-clip-text text-transparent">AI</span></h1>
                        <span className="hidden sm:inline text-[10px] bg-cyan-500/10 text-cyan-600 border border-cyan-500/20 px-2 py-0.5 rounded-full font-bold tracking-wider">v5 · Live Market Mode</span>
                        {activeSessions.length > 0 && (
                            <div className="hidden sm:flex gap-1">
                                {activeSessions.map(s => (
                                    <span key={s.key} className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full font-bold shadow-sm backdrop-blur-sm"
                                        style={{ background: s.color + '15', color: s.color, border: `1px solid ${s.color}25` }}>
                                        <Globe className="w-3 h-3" style={{ opacity: 0.8 }} /> {s.name}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={forceRefresh} disabled={isRefreshing}
                            className={`group flex items-center gap-2 px-5 py-2.5 rounded-full font-semibold tracking-wide text-sm transition-all duration-500 ease-out shadow-[0_4px_20px_rgb(0,0,0,0.05)] hover:shadow-[0_4px_25px_rgb(0,0,0,0.1)] hover:-translate-y-0.5 active:translate-y-0 active:scale-95 ${isRefreshing
                                    ? 'bg-slate-200/80 text-slate-400 border border-slate-300/50 cursor-not-allowed'
                                    : 'bg-white/90 backdrop-blur-md border border-white/80 text-slate-700 hover:border-cyan-500/30 hover:text-cyan-600'
                                }`}>
                            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-700 ease-in-out'}`} />
                            <span className="hidden sm:inline">{isRefreshing ? 'Updating...' : 'Refresh Data'}</span>
                        </button>
                        <span className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/60 backdrop-blur-md border border-white/80 shadow-[0_2px_10px_rgb(0,0,0,0.02)]">
                            <PulseDot color={isRefreshing ? 'bg-amber-400' : warmingUpCount > 0 ? 'bg-orange-400' : 'bg-emerald-400'} />
                            <span className="text-[11px] font-bold tracking-widest text-slate-600">{isRefreshing ? 'UPDATING' : warmingUpCount > 0 ? `${warmingUpCount} WARM` : '5-MIN'}</span>
                        </span>
                    </div>
                </div>
            </nav>

            <main id="main-content" className="w-full relative z-10 mx-auto px-4 sm:px-6 lg:px-12 py-8">
                <APIStatusBanner dataSource={dataSource} lastUpdated={lastUpdated} isRefreshing={isRefreshing} warmingUp={warmingUpCount} />
                <MarketTicker data={pairsData} />
                <MarketSentiment data={pairsData} />
                {bestData && <FeaturedRecommendation data={bestData} />}
                <TradeSettings pairMap={pairMap} currencyData={pairsData} />
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2"><Globe className="w-5 h-5 text-cyan-500" />Market Overview</h2>
                    <span className="text-xs text-slate-700 font-mono">{pairsData.filter(d => d.currentRate).length} active pairs</span>
                </div>
                <PaginationControls currentPage={page} totalPages={Math.ceil(pairsData.length / PER_PAGE)} onPageChange={setPage} totalItems={pairsData.length} />
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                    {pagePairs.map(item => <PairCard key={item.pair.symbol} item={item} />)}
                </div>
            </main>

            {/* CHAT PANEL */}
            <div className="fixed bottom-6 right-6 z-50">
                {!chatOpen ? (
                    <button onClick={() => setChatOpen(true)}
                        className="bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white p-4 rounded-2xl shadow-2xl shadow-cyan-500/30 transition-all hover:scale-105">
                        <Bot className="w-6 h-6" />
                    </button>
                ) : (
                    <div className="bg-white border border-black/[0.08] rounded-2xl shadow-2xl flex flex-col overflow-hidden backdrop-blur-xl"
                        style={{ width: 'min(384px, calc(100vw - 24px))' }}
                        role="dialog" aria-label="QuantAI chat" aria-modal="true">
                        <div className="bg-gradient-to-r from-cyan-600/20 to-teal-600/20 p-4 flex justify-between items-center border-b border-black/[0.08]">
                            <div className="flex items-center gap-2">
                                <PulseDot color="bg-emerald-400" />
                                <span className="font-bold text-slate-900 text-sm">QuantAI</span>
                                <span className="text-[10px] text-slate-700 font-mono">Llama 3.3 70B · v5</span>
                            </div>
                            <button onClick={() => setChatOpen(false)} className="text-slate-700 hover:text-slate-900"><X className="w-4 h-4" /></button>
                        </div>
                        <div className="h-80 overflow-y-auto p-4 space-y-4 scrollbar-hide" role="log" aria-live="polite">
                            {messages.map(m => (
                                <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm ${m.role === 'user' ? 'bg-gradient-to-r from-cyan-600 to-teal-600 text-white rounded-br-sm' : 'bg-black/[0.05] text-slate-700 border border-black/[0.08] rounded-bl-sm'}`}>
                                        {renderBold(m.content)}
                                    </div>
                                </div>
                            ))}
                            <div ref={msgEndRef} />
                        </div>
                        <div className="p-3 bg-slate-50 border-t border-black/[0.08] flex gap-2 min-w-0">
                            <input
                                className="flex-1 min-w-0 bg-black/[0.05] border border-black/[0.08] rounded-full px-4 py-2 text-sm text-slate-900 placeholder-slate-600 focus:outline-none focus:border-cyan-500/50"
                                placeholder="Ask about signals, WF backtest, HTF…"
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChat(e); } }}
                            />
                            <button onClick={handleChat} disabled={!input.trim()} className="bg-gradient-to-r from-cyan-600 to-teal-600 text-white p-2.5 rounded-full disabled:opacity-40 transition-all flex-shrink-0">
                                <Send className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ForexDashboard;