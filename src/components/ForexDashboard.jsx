import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import {
    TrendingUp, TrendingDown, Activity, RefreshCw, ChevronDown, ChevronUp,
    Target, X, Send, Bot, Calculator, AlertCircle, Clock,
    AlertTriangle, Zap, Eye, EyeOff, DollarSign, ArrowUpRight,
    ArrowDownRight, Gauge, Globe, Minus, Info, Layers, Volume2,
    Star, Filter,
} from 'lucide-react';

const TWELVE_DATA_BASE =
    process.env.REACT_APP_PROXY_TWELVEDATA_URL || 'https://api.twelvedata.com';
const GROQ_BASE =
    process.env.REACT_APP_PROXY_GROQ_URL ||
    'https://api.groq.com/openai/v1/chat/completions';

const TWELVE_DATA_API_KEY = process.env.REACT_APP_TWELVE_DATA_API_KEY || '';
const GROQ_API_KEY = process.env.REACT_APP_GROQ_API_KEY || '';

const hasTwelveKey = () => Boolean(TWELVE_DATA_API_KEY);
const hasGroqKey = () => Boolean(GROQ_API_KEY);

const UPDATE_INTERVAL = 300_000;
const TIMESERIES_SIZE = 500;
const HTF_SIZE = 100;
const BATCH_DELAY_MS = 15_000;
const CACHE_KEY = 'forex_dashboard_v70';
const CACHE_SCHEMA_VERSION = 20;
const MAX_CACHE_BYTES = 4_500_000;
const MIN_DISTINCT_PRICES = 10;
const SPREAD_PIPS = 2;
const WARMUP_CANDLES = 40;

const TIER_PRIME = 65;
const TIER_WATCH = 45;
const TIER_WEAK = 30;

const MAX_BULL_BEAR = 12;
const REALISTIC_MAX_SCORE = 8;
const MAX_MOMENTUM_CONTRIB = 5;

const HTF_SUPPRESS_ADX_THRESHOLD = 25;
const MACD_VALIDITY_ATR_RATIO = 0.005;
const VOLUME_SMA_PERIOD = 20;
const VOLUME_MULTIPLIER = 1.2;

const _jpyState = { rate: 155, timestamp: 0 };
const updateJpyFallback = (rate) => {
    if (rate && isFinite(rate) && rate > 0) {
        _jpyState.rate = rate;
        _jpyState.timestamp = Date.now();
    }
};

const CURRENCY_PAIRS = [
    { symbol: 'XAUUSD', base: 'XAU', quote: 'USD', name: 'Gold / USD', type: 'commodity', pipValue: 0.1, pipDigits: 2, lotPipUSD: 100, priority: 1, flag: '🥇', maxSLPips: 200 },
    { symbol: 'EURUSD', base: 'EUR', quote: 'USD', name: 'EUR / USD', type: 'major', pipValue: 0.0001, pipDigits: 5, lotPipUSD: 10, priority: 1, flag: '🇪🇺', maxSLPips: 80 },
    { symbol: 'GBPUSD', base: 'GBP', quote: 'USD', name: 'GBP / USD', type: 'major', pipValue: 0.0001, pipDigits: 5, lotPipUSD: 10, priority: 1, flag: '🇬🇧', maxSLPips: 100 },
    { symbol: 'USDJPY', base: 'USD', quote: 'JPY', name: 'USD / JPY', type: 'major', pipValue: 0.01, pipDigits: 3, lotPipUSD: null, priority: 1, flag: '🇯🇵', maxSLPips: 80 },
    { symbol: 'USDCAD', base: 'USD', quote: 'CAD', name: 'USD / CAD', type: 'major', pipValue: 0.0001, pipDigits: 5, lotPipUSD: 10, priority: 2, flag: '🇨🇦', maxSLPips: 80 },
    { symbol: 'USDCHF', base: 'USD', quote: 'CHF', name: 'USD / CHF', type: 'major', pipValue: 0.0001, pipDigits: 5, lotPipUSD: 10, priority: 2, flag: '🇨🇭', maxSLPips: 80 },
    { symbol: 'AUDUSD', base: 'AUD', quote: 'USD', name: 'AUD / USD', type: 'major', pipValue: 0.0001, pipDigits: 5, lotPipUSD: 10, priority: 2, flag: '🇦🇺', maxSLPips: 80 },
    { symbol: 'AUDJPY', base: 'AUD', quote: 'JPY', name: 'AUD / JPY', type: 'cross', pipValue: 0.01, pipDigits: 3, lotPipUSD: null, priority: 3, flag: '🌏', maxSLPips: 100 },
];

const PAIRS_CONFIG_HASH = CURRENCY_PAIRS.map(p => `${p.symbol}:${p.pipValue}:${p.pipDigits}`).join('|');

const getPipUSD = (pair, currentRate) => {
    if (pair.lotPipUSD !== null) return { value: pair.lotPipUSD, usingFallback: false, fallbackAgeMinutes: 0 };
    const isJPY = pair.quote === 'JPY';
    const hasLiveRate = isJPY && currentRate && isFinite(currentRate) && currentRate > 0;
    if (hasLiveRate) updateJpyFallback(currentRate);
    const rate = hasLiveRate ? currentRate : _jpyState.rate;
    const value = (pair.pipValue / rate) * 100_000;
    const fallbackAgeMinutes = _jpyState.timestamp > 0 ? Math.round((Date.now() - _jpyState.timestamp) / 60_000) : null;
    return { value, usingFallback: !hasLiveRate, fallbackAgeMinutes };
};

const SESSIONS = {
    sydney: { name: 'Sydney', open: 21, close: 6, color: '#06b6d4', icon: '🌏', pairs: ['AUDUSD', 'AUDJPY', 'USDCAD'] },
    tokyo: { name: 'Tokyo', open: 0, close: 9, color: '#8b5cf6', icon: '🇯🇵', pairs: ['USDJPY', 'AUDJPY', 'USDCAD'] },
    london: { name: 'London', open: 7, close: 16, color: '#3b82f6', icon: '🇬🇧', pairs: ['GBPUSD', 'EURUSD', 'USDCHF', 'USDCAD'] },
    newyork: { name: 'New York', open: 12, close: 21, color: '#10b981', icon: '🗽', pairs: ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCAD', 'XAUUSD'] },
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
    return { quality: 'medium', label: relevant[0].name, score: 1.0 };
};

const getSessionOpenPrice = (candles, activeSessions) => {
    if (!candles || candles.length === 0) return null;
    const nowMs = Date.now();
    const utcHour = new Date(nowMs).getUTCHours();
    const utcMinute = new Date(nowMs).getUTCMinutes();
    const nowMinuteOfDay = utcHour * 60 + utcMinute;
    let bestSession = null, bestMinsAgo = Infinity;
    activeSessions.forEach(s => {
        const openMinuteOfDay = s.open * 60;
        let minsAgo = nowMinuteOfDay - openMinuteOfDay;
        if (minsAgo < 0) minsAgo += 24 * 60;
        if (minsAgo < bestMinsAgo) { bestMinsAgo = minsAgo; bestSession = s; }
    });
    if (!bestSession) return candles[0]?.price ?? null;
    const utcMidnight = new Date(nowMs);
    utcMidnight.setUTCHours(0, 0, 0, 0);
    const sessionStartMs = utcMidnight.getTime() + bestSession.open * 3_600_000;
    const adjustedStartMs = sessionStartMs > nowMs ? sessionStartMs - 86_400_000 : sessionStartMs;
    const found = candles.find(c => c.timestamp >= adjustedStartMs);
    return (found ?? candles[0])?.price ?? null;
};

const NULL_DISPLAY = '—';

const formatPrice = (price, symbol) => {
    if (price == null || !isFinite(price) || price === 0) return '---';
    const pair = CURRENCY_PAIRS.find(p => p.symbol === symbol);
    return Number(price).toFixed(pair ? pair.pipDigits : 4);
};

const countDistinctPrices = candles => {
    if (!candles || candles.length === 0) return 0;
    return new Set(candles.map(c => c.price)).size;
};

const makeGradientId = (symbol, suffix = '') => `grad-${symbol.replace(/[^a-zA-Z0-9]/g, '')}${suffix}`;

const formatPctChange = (current, previous) => {
    if (!current || !previous || previous === 0) return { value: 0, text: '0.00%' };
    const pct = ((current - previous) / previous) * 100;
    return { value: pct, text: `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` };
};

const toLogReturns = prices => {
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
        if (prices[i - 1] > 0 && prices[i] > 0) returns.push(Math.log(prices[i] / prices[i - 1]));
        else returns.push(0);
    }
    return returns;
};

const renderBold = text =>
    text.split('\n').map((line, li) => (
        <p key={li} className={li > 0 ? 'mt-1.5' : ''}>
            {line.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
                p.startsWith('**') && p.endsWith('**')
                    ? <strong key={i} className="text-indigo-300">{p.slice(2, -2)}</strong>
                    : <span key={i}>{p}</span>
            )}
        </p>
    ));

const formatMacdNormalised = (val, atr, pipValue) => {
    if (val == null || !isFinite(val)) return NULL_DISPLAY;
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
    const raw = minLotRisk / (riskPct / 100);
    return Math.max(50, Math.ceil(raw / 50) * 50);
};

const getPairTier = (d) => {
    if (!d?.prediction) return 'none';
    if (!d.prediction.dataQualityOk) return 'warming';
    const str = d.prediction.signalStrength ?? 0;
    const signal = d.prediction.signal;
    if (signal === 'HOLD') return str >= TIER_WATCH ? 'watch' : 'weak';
    if (str >= TIER_PRIME) return 'prime';
    if (str >= TIER_WATCH) return 'watch';
    return 'weak';
};
const isPrimePair = (d) => getPairTier(d) === 'prime';
const isWatchPair = (d) => ['prime', 'watch'].includes(getPairTier(d));

class RateLimiter {
    constructor(maxPerMinute = 8) { this.max = maxPerMinute; this.calls = []; }
    async wait() { return this._acquire(); }
    async _acquire() {
        const now = Date.now();
        this.calls = this.calls.filter(t => now - t < 60_000);
        if (this.calls.length >= this.max) {
            const waitMs = 60_000 - (now - this.calls[0]) + 1_000;
            if (waitMs > 0) {
                await new Promise(r => setTimeout(r, waitMs));
                this.calls = this.calls.filter(t => Date.now() - t < 60_000);
            }
        }
        this.calls.push(Date.now());
    }
    reset() { this.calls = []; }
}
const rateLimiter = new RateLimiter(8);

const safeFetch = async (url, signal) => {
    const res = await fetch(url, signal ? { signal } : {});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
};

const twelveDataUrl = (endpoint, params = {}) => {
    const qs = new URLSearchParams({ ...params, apikey: TWELVE_DATA_API_KEY }).toString();
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
    if (!hasTwelveKey()) return null;
    try {
        await rateLimiter.wait();
        if (signal?.aborted) return null;
        const url = twelveDataUrl('time_series', { symbol: twelveSymbol(pair), interval: '5min', outputsize: TIMESERIES_SIZE });
        const json = await safeFetch(url, signal);
        if (json?.status === 'error' || !Array.isArray(json?.values) || json.values.length < 5) return null;
        const candles = parseCandles(json.values, json.values.length);
        if (countDistinctPrices(candles) < MIN_DISTINCT_PRICES) return null;
        if (pair.symbol === 'USDJPY' && candles.length > 0) updateJpyFallback(candles[candles.length - 1].price);
        return candles;
    } catch (err) {
        if (err.name === 'AbortError') return null;
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
        } catch { }
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

const fetchAllTimeSeries = async (signal, onProgress) => {
    const out = {};
    for (let i = 0; i < CURRENCY_PAIRS.length; i++) {
        if (signal?.aborted) break;
        const p = CURRENCY_PAIRS[i];
        onProgress?.({ done: i, total: CURRENCY_PAIRS.length, symbol: p.symbol, phase: 'series' });
        const series = await fetchTimeSeriesWithRetry(p, signal);
        if (signal?.aborted) break;
        onProgress?.({ done: i, total: CURRENCY_PAIRS.length, symbol: p.symbol, phase: 'htf' });
        const htf = await fetchHTFCandles(p, signal);
        if (series) out[p.symbol] = { series, htf };
        onProgress?.({ done: i + 1, total: CURRENCY_PAIRS.length, symbol: p.symbol, phase: 'done' });
        if (i < CURRENCY_PAIRS.length - 1) {
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

const serializeForCache = pairs =>
    pairs.map(item => ({ pair: item.pair, currentRate: item.currentRate, history: item.history, htfHistory: item.htfHistory }));

const safeSetCache = (pairs, timestamp) => {
    try {
        const payload = JSON.stringify({ timestamp, schemaVersion: CACHE_SCHEMA_VERSION, pairsConfigHash: PAIRS_CONFIG_HASH, data: serializeForCache(pairs) });
        const byteSize = new TextEncoder().encode(payload).length;
        if (byteSize > MAX_CACHE_BYTES) return false;
        localStorage.setItem(CACHE_KEY, payload);
        return true;
    } catch (err) { return false; }
};

const safeRemoveCache = () => { try { localStorage.removeItem(CACHE_KEY); } catch { } };

const safeReadCache = () => {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION) { safeRemoveCache(); return null; }
        if (parsed.pairsConfigHash !== PAIRS_CONFIG_HASH) { safeRemoveCache(); return null; }
        if (!Array.isArray(parsed.data)) { safeRemoveCache(); return null; }
        if (!parsed.data.every(item => item?.pair?.symbol && Array.isArray(item.history))) { safeRemoveCache(); return null; }
        return parsed;
    } catch { safeRemoveCache(); return null; }
};

const linearRegressionOnReturns = (prices, horizon = 1) => {
    const n = prices.length;
    if (n < 3) return { slope: 0, intercept: 0, r2: 0, predictedLogReturn: 0 };
    const returns = toLogReturns(prices);
    const m = returns.length;
    if (m < 2) return { slope: 0, intercept: 0, r2: 0, predictedLogReturn: returns[m - 1] ?? 0 };
    let sx = 0, sy = 0, sxy = 0, sx2 = 0;
    for (let i = 0; i < m; i++) { sx += i; sy += returns[i]; sxy += i * returns[i]; sx2 += i * i; }
    const denom = m * sx2 - sx * sx;
    if (denom === 0) return { slope: 0, intercept: 0, r2: 0, predictedLogReturn: returns[m - 1] };
    const slope = (m * sxy - sx * sy) / denom;
    const intercept = (sy - slope * sx) / m;
    const yMean = sy / m;
    let ssRes = 0, ssTot = 0;
    for (let i = 0; i < m; i++) {
        ssRes += (returns[i] - (intercept + slope * i)) ** 2;
        ssTot += (returns[i] - yMean) ** 2;
    }
    const r2 = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);
    return { slope, intercept, r2, predictedLogReturn: intercept + slope * (m - 1 + horizon) };
};

const safeMin = arr => arr.length > 0 ? Math.min(...arr) : null;
const safeMax = arr => arr.length > 0 ? Math.max(...arr) : null;

const findSwingLevels = (candles, lookback = 5) => {
    const highs = [], lows = [];
    for (let i = lookback; i < candles.length - lookback; i++) {
        const h = candles[i].high ?? candles[i].price;
        const l = candles[i].low ?? candles[i].price;
        if (candles.slice(i - lookback, i).every(x => (x.high ?? x.price) <= h) && candles.slice(i + 1, i + lookback + 1).every(x => (x.high ?? x.price) <= h)) highs.push(h);
        if (candles.slice(i - lookback, i).every(x => (x.low ?? x.price) >= l) && candles.slice(i + 1, i + lookback + 1).every(x => (x.low ?? x.price) >= l)) lows.push(l);
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
        const h = candles[i].high ?? candles[i].price, l = candles[i].low ?? candles[i].price;
        const ph = candles[i - 1].high ?? candles[i - 1].price, pl = candles[i - 1].low ?? candles[i - 1].price;
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
    const atr14 = smooth(trueRanges, period), dmp14 = smooth(dmPlus, period), dmm14 = smooth(dmMinus, period);
    const dx = atr14.map((atr, i) => {
        if (atr === 0) return 0;
        const diP = (dmp14[i] / atr) * 100, diM = (dmm14[i] / atr) * 100;
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
    const lastVol = vols[vols.length - 1];
    const smaVols = vols.slice(-(VOLUME_SMA_PERIOD + 1), -1);
    const sma = smaVols.reduce((a, b) => a + b, 0) / VOLUME_SMA_PERIOD;
    if (sma === 0) return { confirmed: null, ratio: null, hasData: false };
    const ratio = lastVol / sma;
    return { confirmed: ratio >= VOLUME_MULTIPLIER, ratio, hasData: true };
};

const computeHTFAlignment = (htfCandles) => {
    if (!htfCandles || htfCandles.length < 30) return { aligned: null, htfTrend: null, htfAdx: null, htfTrending: false };
    const htfPrices = htfCandles.map(c => c.price);
    const htfEma12 = calcEMA(htfPrices, 12), htfEma26 = calcEMA(htfPrices, 26);
    if (htfEma12 === null || htfEma26 === null) return { aligned: null, htfTrend: null, htfAdx: null, htfTrending: false };
    const htfTrend = htfEma12 > htfEma26 ? 'bullish' : 'bearish';
    const htfAdxResult = computeADX(htfCandles);
    return { aligned: true, htfTrend, htfEma12, htfEma26, htfAdx: htfAdxResult.adx, htfTrending: htfAdxResult.trending };
};

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
    bull = Math.min(MAX_BULL_BEAR, bull);
    bear = Math.min(MAX_BULL_BEAR, bear);
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
    if (volumeConf?.hasData && volumeConf?.confirmed === false && signal !== 'HOLD') { signal = 'HOLD'; volSuppressed = true; }
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

class ForexPredictor {
    constructor() { this._store = {}; this._htfStore = {}; }
    setHistory(symbol, candles) { this._store[symbol] = (candles || []).slice(-TIMESERIES_SIZE); }
    setHTFHistory(symbol, candles) { this._htfStore[symbol] = (candles || []).slice(-HTF_SIZE); }
    getHistory(symbol) { return this._store[symbol] || []; }
    getHTFHistory(symbol) { return this._htfStore[symbol] || []; }
    addTick(symbol, price) {
        if (!this._store[symbol]) this._store[symbol] = [];
        const store = this._store[symbol];
        if (store.length > 0) {
            const last = store[store.length - 1];
            if (last._isTick) { last.high = Math.max(last.high ?? last.price, price); last.low = Math.min(last.low ?? last.price, price); last.price = price; last.timestamp = Date.now(); while (store.length > TIMESERIES_SIZE) store.shift(); return; }
        }
        store.push({ price, high: price, low: price, open: price, volume: 0, timestamp: Date.now(), _isTick: true });
        while (store.length > TIMESERIES_SIZE) store.shift();
    }
    _rsi(prices, period = 14) {
        if (prices.length < period + 1) return null;
        let gains = 0, losses = 0;
        for (let i = 1; i <= period; i++) { const d = prices[i] - prices[i - 1]; if (d >= 0) gains += d; else losses -= d; }
        let ag = gains / period, al = losses / period;
        for (let i = period + 1; i < prices.length; i++) { const d = prices[i] - prices[i - 1]; ag = (ag * (period - 1) + Math.max(d, 0)) / period; al = (al * (period - 1) + Math.max(-d, 0)) / period; }
        if (al === 0 && ag === 0) return 50; if (al === 0) return 100; if (ag === 0) return 0;
        return 100 - 100 / (1 + ag / al);
    }
    _macd(prices, pipValue = 0.0001, atr = null) {
        if (prices.length < 35) return { valid: false, macd: 0, signal: 0, histogram: 0 };
        const emaSeries = (p, len) => { const k = 2 / (len + 1), out = []; let ema = p.slice(0, len).reduce((a, b) => a + b, 0) / len; out.push(ema); for (let i = len; i < p.length; i++) { ema = p[i] * k + ema * (1 - k); out.push(ema); } return out; };
        const e12 = emaSeries(prices, 12), e26 = emaSeries(prices, 26);
        const off12 = e12.length - e26.length;
        const macdLine = e26.map((v, i) => e12[i + off12] - v);
        if (macdLine.length < 9) return { valid: false, macd: 0, signal: 0, histogram: 0 };
        const signalK = 2 / 10;
        let sig = macdLine.slice(0, 9).reduce((a, b) => a + b, 0) / 9;
        for (let i = 9; i < macdLine.length; i++) sig = macdLine[i] * signalK + sig * (1 - signalK);
        const last = macdLine[macdLine.length - 1], histogram = last - sig;
        const pipFlat = pipValue * 0.5;
        const relativeFlat = (atr && isFinite(atr) && atr > 0) ? Math.max(pipFlat, atr * MACD_VALIDITY_ATR_RATIO) : pipFlat;
        if (Math.abs(histogram) < relativeFlat) return { valid: false, macd: last, signal: sig, histogram };
        return { valid: true, macd: last, signal: sig, histogram };
    }
    _bollinger(prices, period = 20) {
        if (prices.length < period) return { percentB: 0.5, bandwidth: 0, upper: 0, lower: 0, mid: 0, valid: false };
        const sl = prices.slice(-period), mean = sl.reduce((a, b) => a + b, 0) / period;
        const std = Math.sqrt(sl.reduce((s, p) => s + (p - mean) ** 2, 0) / period);
        if (std === 0) return { percentB: 0.5, bandwidth: 0, upper: mean, lower: mean, mid: mean, valid: false };
        const upper = mean + std * 2, lower = mean - std * 2, cur = prices[prices.length - 1];
        const pB = (cur - lower) / (upper - lower);
        if (!isFinite(pB)) return { percentB: 0.5, bandwidth: std * 4 / mean, upper, lower, mid: mean, valid: false };
        return { percentB: pB, bandwidth: std * 4 / mean, upper, lower, mid: mean, valid: true };
    }
    _atr(candles, period = 14) {
        if (!candles || candles.length < 2) return null;
        const trs = [];
        for (let i = 1; i < candles.length; i++) { const h = candles[i].high ?? candles[i].price, l = candles[i].low ?? candles[i].price, pc = candles[i - 1].price; trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))); }
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
            let high = -Infinity, low = Infinity;
            for (const c of slice) { const h = c.high ?? c.price, l = c.low ?? c.price; if (h > high) high = h; if (l < low) low = l; }
            const close = candles[i].price, range = high - low;
            kValues.push(range > 0 ? ((close - low) / range) * 100 : 50);
        }
        if (kValues.length < dPeriod) return null;
        const k = kValues[kValues.length - 1], d = kValues.slice(-dPeriod).reduce((a, b) => a + b, 0) / dPeriod;
        return { k, d, valid: true };
    }
    _williamsR(candles, period = 14) {
        if (!candles || candles.length < period) return null;
        const slice = candles.slice(-period);
        let high = -Infinity, low = Infinity;
        for (const c of slice) { const h = c.high ?? c.price, l = c.low ?? c.price; if (h > high) high = h; if (l < low) low = l; }
        const close = candles[candles.length - 1].price, range = high - low;
        if (range === 0) return -50;
        return ((high - close) / range) * -100;
    }
    _momentum(prices, period = 10) {
        if (prices.length < period + 1) return null;
        const current = prices[prices.length - 1], past = prices[prices.length - 1 - period];
        return past !== 0 ? ((current - past) / past) * 100 : 0;
    }
    _pivotPoints(candles) {
        if (!candles || candles.length < 2) return null;
        const last = candles[candles.length - 1], h = last.high ?? last.price, l = last.low ?? last.price, c = last.price;
        const pivot = (h + l + c) / 3;
        return { pivot, r1: 2 * pivot - l, r2: pivot + (h - l), s1: 2 * pivot - h, s2: pivot - (h - l) };
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
        const ema12 = ema12Raw ?? cur, ema26 = ema26Raw ?? cur, ema50 = ema50Raw ?? cur;
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
        const reg = linearRegressionOnReturns(prices.slice(-regWindow), 1);
        const regShort = linearRegressionOnReturns(prices.slice(-15), 1);
        const regMed = linearRegressionOnReturns(prices.slice(-30), 1);
        const regLong = linearRegressionOnReturns(prices.slice(-Math.min(n, 80)), 1);
        let wDrift = 0, wTotal = 0;
        const wReg = 3.0 * Math.max(0.1, reg.r2);
        wDrift += cur * reg.predictedLogReturn * wReg; wTotal += wReg;
        if (emaValid) { wDrift += (ema12 - ema26) * 0.5 * 2.0; wTotal += 2.0; }
        let rsiDrift = 0;
        if (rsiValid) {
            if (rsi <= 20) rsiDrift = atr * 1.5; else if (rsi <= 30) rsiDrift = atr * 1.0;
            else if (rsi < 40) rsiDrift = atr * 0.3;
            else if (rsi >= 80) rsiDrift = -atr * 1.5; else if (rsi >= 70) rsiDrift = -atr * 1.0;
            else if (rsi > 60) rsiDrift = -atr * 0.3;
        }
        wDrift += rsiDrift * 1.5; wTotal += 1.5;
        if (macdValid) { const macdDrift = macd.histogram !== 0 ? Math.sign(macd.histogram) * Math.min(atr, Math.abs(macd.histogram) * 5) : 0; wDrift += macdDrift * 1.5; wTotal += 1.5; }
        let bbDrift = 0;
        if (bbValid) {
            if (bb.percentB < 0.10) bbDrift = atr * 1.0; else if (bb.percentB < 0.20) bbDrift = atr * 0.6;
            else if (bb.percentB < 0.30) bbDrift = atr * 0.3;
            else if (bb.percentB > 0.90) bbDrift = -atr * 1.0; else if (bb.percentB > 0.80) bbDrift = -atr * 0.6;
            else if (bb.percentB > 0.70) bbDrift = -atr * 0.3;
        }
        wDrift += bbDrift * 1.0; wTotal += 1.0;
        if (stoch?.valid) { let stochDrift = 0; if (stoch.k < 20) stochDrift = atr * 0.8; else if (stoch.k < 30) stochDrift = atr * 0.4; else if (stoch.k > 80) stochDrift = -atr * 0.8; else if (stoch.k > 70) stochDrift = -atr * 0.4; wDrift += stochDrift * 0.8; wTotal += 0.8; }
        if (momentum !== null) { wDrift += Math.sign(momentum) * Math.min(atr * 0.5, Math.abs(momentum / 100) * atr) * 0.6; wTotal += 0.6; }
        const rawDrift = wTotal > 0 ? wDrift / wTotal : 0;
        const clampedDrift = Math.max(-atr * 2.5, Math.min(atr * 2.5, rawDrift));
        const sig = computeSignal({ rsi, rsiValid, macdHist: macd.histogram, macdValid, ema12: emaValid ? ema12 : cur, ema26: emaValid ? ema26 : cur, emaValid, bbPercentB: bb.percentB, bbValid, regSlope: reg.slope, adxTrending: adxResult.trending, volumeConf, htfAlignment });
        let predictedPrice = parseFloat((cur + clampedDrift).toFixed(pair.pipDigits ?? 5));
        if (predictedPrice === cur) {
            const pip = pair.pipValue ?? Math.pow(10, -(pair.pipDigits ?? 5));
            if (sig.signal === 'BUY') predictedPrice = parseFloat((cur + pip).toFixed(pair.pipDigits));
            else if (sig.signal === 'SELL') predictedPrice = parseFloat((cur - pip).toFixed(pair.pipDigits));
        }
        const priceMovesAgainstSignal = (sig.signal === 'BUY' && predictedPrice < cur) || (sig.signal === 'SELL' && predictedPrice > cur);
        const totalEntryFrictionEst = (SPREAD_PIPS + 1.5) * pair.pipValue;
        const moveTooSmall = sig.signal !== 'HOLD' && Math.abs(predictedPrice - cur) < totalEntryFrictionEst * 2;
        const regimeBonus = adxResult.trending ? 6 : 0;
        const sessionBonus = sessionQuality.score > 1.0 ? 4 : 0;
        const isBull = sig.signal === 'BUY';
        const srBonus = isBull && nearestResistance !== null && isFinite(nearestResistance) && (nearestResistance - cur) > atr * 3 ? 5 : !isBull && nearestSupport !== null && isFinite(nearestSupport) && (cur - nearestSupport) > atr * 3 ? 5 : 0;
        const volumeBonus = volumeConf.hasData && volumeConf.confirmed === true ? 3 : 0;
        const volumePenalty = volumeConf.hasData && volumeConf.confirmed === false ? -5 : 0;
        const htfBonus = htfAlignment.htfTrend !== null && ((sig.rawSignal === 'BUY' && htfAlignment.htfTrend === 'bullish') || (sig.rawSignal === 'SELL' && htfAlignment.htfTrend === 'bearish')) ? 5 : 0;
        const htfPenalty = sig.htfSuppressed ? 10 : 0;
        const dataConf = Math.min(1, n / 80);
        const indAgree = Math.min(1, Math.abs(sig.netScore) / MAX_BULL_BEAR);
        const stalePenalty = dataQualityOk ? 0 : 30;
        const warmupPenalty = (!rsiValid ? 10 : 0) + (!macdValid ? 5 : 0) + (!emaValid ? 5 : 0) + (!bbValid ? 5 : 0) + stalePenalty;
        const regFit = reg.r2;
        const r2Penalty = regFit < 0.001 ? 10 : regFit < 0.005 ? 5 : 0;
        const hardCap = !dataQualityOk ? 35 : 95;
        const rawStrengthScore = Math.round(25 + dataConf * 25 + indAgree * 28 + regFit * 10 + regimeBonus + sessionBonus + srBonus + volumeBonus + volumePenalty + htfBonus - warmupPenalty - r2Penalty - htfPenalty);
        const signalStrength = Math.min(hardCap, Math.max(1, rawStrengthScore));
        const strengthLabel = signalStrength >= 70 ? 'Strong' : signalStrength >= 50 ? 'Moderate' : signalStrength >= 30 ? 'Weak' : 'Very Weak';
        const bbDisplay = { ...bb, percentB: Math.max(0, Math.min(1, bb.percentB)) };
        const sessionOpenPrice = getSessionOpenPrice(candles, activeSessions);
        const sessionChange = formatPctChange(cur, sessionOpenPrice ?? cur);
        const volatility = atr / cur * 100;
        const volatilityLabel = volatility > 0.5 ? 'High' : volatility > 0.2 ? 'Medium' : 'Low';
        const slippage = pair.pipValue * 1.5;
        const totalEntryFriction = slippage + pair.pipValue * SPREAD_PIPS;
        const rawAtrSL = Math.max(pair.pipValue * 15, atr * 2);
        const maxSLDist = (pair.maxSLPips ?? 200) * pair.pipValue;
        const atrSL = Math.min(rawAtrSL, maxSLDist);
        const structuralSL = (isBull && nearestSupport !== null && isFinite(nearestSupport)) ? Math.min(atrSL, cur - nearestSupport + atr * 0.5) : null;
        const effectiveSLDist = structuralSL ? Math.max(pair.pipValue * 10, Math.min(structuralSL, atrSL)) : atrSL;
        const largeSlNormal = pair.type === 'commodity';
        return {
            predictedPrice, confidence: signalStrength, confidenceLabel: strengthLabel,
            signalStrength, strengthLabel, trend: sig.trend, signal: sig.signal, rawSignal: sig.rawSignal,
            bull: sig.bull, bear: sig.bear, strength: sig.strength, netScore: sig.netScore,
            hasConflict: sig.hasConflict, conflictType: sig.conflictType,
            htfSuppressed: sig.htfSuppressed, volSuppressed: sig.volSuppressed,
            priceMovesAgainstSignal, moveTooSmall,
            rsi, rsiValid, macd, macdValid,
            bollinger: bbDisplay, bollingerRaw: bb, bbValid,
            atr, ema12, ema26, ema50, emaValid,
            regression: { slope: reg.slope, r2: reg.r2, logReturn: reg.predictedLogReturn },
            regressionMulti: { short: regShort, medium: regMed, long: regLong },
            levels: { support: cur - atr * 2, resistance: cur + atr * 2 },
            swingLevels, nearestResistance: nearestResistance ?? null, nearestSupport: nearestSupport ?? null,
            adx: adxResult, regimeBonus, sessionBonus, srBonus, volumeBonus, volumePenalty, htfBonus, r2Penalty,
            effectiveSLDist, totalEntryFriction, slippage, largeSlNormal,
            dataPoints: n, distinctPrices: distinctCount, dataQualityOk,
            stochastic: stoch, momentum, williamsR, pivots,
            sessionChange, volatility, volatilityLabel, sessionQuality,
            driftContribution: regFit < 0.001 ? 0 : clampedDrift,
            volumeConf, htfAlignment,
        };
    }
}

const MAX_CHAT_MESSAGES = 50;
let _globalMsgId = 1;
const makeMsg = (role, content, extra = {}) => ({ id: _globalMsgId++, role, content, ...extra });

const sendToGroq = async (forexData, history, signal) => {
    if (!hasGroqKey()) throw new Error('No Groq API key');
    const validPairs = forexData.filter(d => d.prediction?.dataQualityOk);
    const stalePairs = forexData.filter(d => d.prediction && !d.prediction.dataQualityOk);
    const marketContext = validPairs.map(d => {
        const p = d.prediction;
        const tier = getPairTier(d);
        const adxStr = p.adx.adx ? `ADX=${p.adx.adx.toFixed(0)}(${p.adx.trending ? 'trending' : 'choppy'})` : 'ADX=N/A';
        const volStr = !p.volumeConf.hasData ? 'vol=OTC' : `vol=${p.volumeConf.confirmed ? '✓' : '✗'}(${p.volumeConf.ratio?.toFixed(2)}×)`;
        const htfStr = p.htfAlignment.htfTrend ? `HTF=${p.htfAlignment.htfTrend}(ADX=${p.htfAlignment.htfAdx?.toFixed(0) ?? 'N/A'})${p.htfSuppressed ? '(suppressed)' : ''}` : 'HTF=n/a';
        return `${d.pair.symbol}[${tier}]: ${formatPrice(d.currentRate, d.pair.symbol)} sig=${p.signal}(raw=${p.rawSignal}) str=${p.signalStrength}% R²=${p.regression.r2.toFixed(3)} RSI=${p.rsiValid ? p.rsi.toFixed(1) : 'N/A'} ${adxStr} ${volStr} ${htfStr}`.trim();
    }).join('\n');
    const staleNote = stalePairs.length > 0 ? `\n\nSTALE: ${stalePairs.map(d => d.pair.symbol).join(', ')}` : '';
    const systemPrompt = `You are QuantAI, a professional forex analyst. Be concise and direct. Use **bold** for key levels and signals.\n\nMarket data:\n${marketContext}${staleNote}`;
    const apiMessages = history.filter(m => !m.isLoading).map(m => ({ role: m.role, content: m.content }));
    const res = await fetch(GROQ_BASE, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'system', content: systemPrompt }, ...apiMessages], temperature: 0.4, max_tokens: 500 }),
    });
    if (!res.ok) throw new Error(`Groq ${res.status}`);
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('Empty response');
    return content;
};

const getFallbackReply = (data) => {
    const validData = data.filter(d => d.prediction?.dataQualityOk);
    const pool = validData.length > 0 ? validData : data.filter(d => d.prediction !== null);
    const best = pool.reduce((p, c) => (c.prediction?.signalStrength ?? 0) > (p?.prediction?.signalStrength ?? 0) ? c : p, null);
    if (!best) return 'Loading market data — please wait.';
    return `Best setup: **${best.pair.symbol}** at ${formatPrice(best.currentRate, best.pair.symbol)} — ${best.prediction?.signal} (${best.prediction?.signalStrength}% confluence).`;
};

class ErrorBoundary extends React.Component {
    constructor(props) { super(props); this.state = { hasError: false, error: null }; }
    static getDerivedStateFromError(error) { return { hasError: true, error }; }
    componentDidCatch(error, info) { console.error('[ErrorBoundary]', error, info); }
    render() {
        if (this.state.hasError) {
            return (
                <div className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-4 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-bold text-rose-400">Error</p>
                        <button onClick={() => this.setState({ hasError: false, error: null })} className="mt-2 text-xs text-rose-400 underline">Retry</button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

// ─── UI Components ───────────────────────────────────────────────────────────

const PulseDot = ({ color = 'bg-emerald-400' }) => (
    <span className="relative flex h-2.5 w-2.5">
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${color} opacity-75`} />
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${color}`} />
    </span>
);

const TierBadge = ({ tier }) => {
    const cfg = {
        prime: { label: '★ PRIME', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
        watch: { label: '◎ WATCH', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
        weak: { label: '○ WEAK', cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
        warming: { label: '⏳ LOADING', cls: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
        none: { label: NULL_DISPLAY, cls: 'bg-slate-500/10 text-slate-500 border-slate-500/20' },
    };
    const { label, cls } = cfg[tier] ?? cfg.none;
    return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>;
};

const SignalBadge = ({ signal, size = 'md' }) => {
    const styles = {
        BUY: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
        SELL: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
        HOLD: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
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
                <div key={i} className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${i < strength ? signal === 'BUY' ? 'bg-emerald-400' : signal === 'SELL' ? 'bg-rose-400' : 'bg-slate-500' : 'bg-black/10'}`} />
            ))}
        </div>
    </div>
);

const GlassCard = ({ children, className = '', glow = '' }) => (
    <div className={`relative bg-white/[0.04] backdrop-blur-xl border border-black/[0.08] rounded-2xl overflow-hidden ${className}`}>
        {glow && <div className={`absolute inset-0 ${glow} opacity-10 pointer-events-none rounded-2xl`} />}
        <div className="relative">{children}</div>
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

// Compact warning badge — just an icon + brief label, no paragraphs
const WarnBadge = ({ icon: Icon, label, color = 'amber' }) => {
    const colors = {
        amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
        orange: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
        purple: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
        slate: 'text-slate-500 bg-slate-500/10 border-slate-500/20',
        emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
        rose: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
    };
    return (
        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${colors[color]}`}>
            <Icon className="w-3 h-3 flex-shrink-0" />{label}
        </span>
    );
};

const PairWarnings = ({ pred }) => {
    if (!pred) return null;
    return (
        <div className="flex flex-wrap gap-1 mt-1">
            {!pred.dataQualityOk && <WarnBadge icon={Zap} label="Loading data…" color="orange" />}
            {pred.htfSuppressed && <WarnBadge icon={Layers} label="HTF conflict" color="purple" />}
            {pred.hasConflict && <WarnBadge icon={AlertTriangle} label="Mixed signals" color="amber" />}
            {pred.volSuppressed && <WarnBadge icon={Volume2} label="Low volume" color="slate" />}
            {pred.moveTooSmall && <WarnBadge icon={Info} label="Tight move" color="slate" />}
            {pred.volumeConf?.hasData && pred.volumeConf?.confirmed && <WarnBadge icon={Volume2} label="Vol confirmed" color="emerald" />}
        </div>
    );
};

const RegimeBadge = ({ adx }) =>
    !adx?.adx ? null : (
        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${adx.trending ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-slate-500/10 text-slate-500 border-slate-500/20'}`}>
            <Gauge className="w-2.5 h-2.5" />{adx.trending ? `Trend ADX ${adx.adx.toFixed(0)}` : `Range ADX ${adx.adx.toFixed(0)}`}
        </span>
    );

const HTFBadge = ({ htfAlignment }) =>
    !htfAlignment?.htfTrend ? null : (
        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${htfAlignment.htfTrend === 'bullish' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
            <Layers className="w-2.5 h-2.5" />1H {htfAlignment.htfTrend === 'bullish' ? '↑' : '↓'}
            {htfAlignment.htfAdx ? ` ${htfAlignment.htfAdx.toFixed(0)}` : ''}
        </span>
    );

const FetchProgressBar = ({ progress }) => {
    if (!progress) return null;
    const pct = Math.round((progress.done / progress.total) * 100);
    return (
        <div className="mb-4 p-3 bg-indigo-500/5 border border-indigo-500/15 rounded-xl">
            <div className="flex justify-between text-[10px] text-indigo-400 font-mono mb-1.5">
                <span>{progress.symbol} ({progress.phase})</span>
                <span>{progress.done}/{progress.total} · {pct}%</span>
            </div>
            <div className="h-1 bg-black/10 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
};

// ─── Featured Card ────────────────────────────────────────────────────────────

const FeaturedRecommendation = ({ data: d, allData }) => {
    if (!d?.prediction) {
        return (
            <GlassCard className="p-8 mb-8 text-center">
                <AlertCircle className="w-10 h-10 text-amber-500/60 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-slate-900/70 mb-2">Collecting Data</h2>
                <p className="text-slate-700 text-sm">Building candle history — signals appear shortly.</p>
            </GlassCard>
        );
    }

    const { pair, currentRate, prediction: pred } = d;
    const tier = getPairTier(d);
    const isBull = pred.trend === 'bullish';
    const isActionable = pred.signal !== 'HOLD';

    const slDist = pred.effectiveSLDist;
    const tpDist = slDist * 2;
    const entryWithSlippage = isBull ? currentRate + pred.totalEntryFriction : currentRate - pred.totalEntryFriction;
    const sl = isBull ? entryWithSlippage - slDist : entryWithSlippage + slDist;
    const tp = isBull ? entryWithSlippage + tpDist : entryWithSlippage - tpDist;

    return (
        <GlassCard
            className="p-1 mb-8 shadow-2xl"
            glow={tier === 'prime' && isBull ? 'bg-gradient-to-br from-emerald-500/20 via-transparent to-cyan-500/10' : tier === 'prime' && !isBull ? 'bg-gradient-to-br from-rose-500/20 via-transparent to-orange-500/10' : 'bg-gradient-to-br from-amber-500/10 via-transparent to-transparent'}
        >
            <div className="p-6 md:p-8">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                    <div>
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <TierBadge tier={tier} />
                            <RegimeBadge adx={pred.adx} />
                            <HTFBadge htfAlignment={pred.htfAlignment} />
                            {pred.sessionQuality?.quality === 'high' && (
                                <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-bold">
                                    <Clock className="w-2.5 h-2.5 inline mr-0.5" />{pred.sessionQuality.label}
                                </span>
                            )}
                        </div>
                        <h2 className="text-3xl md:text-4xl font-bold text-slate-900 flex items-center gap-3">
                            <span className="text-2xl">{pair.flag}</span>
                            {pair.name}
                        </h2>
                        <PairWarnings pred={pred} />
                    </div>
                    <div className="text-right hidden md:block">
                        <div className="text-xs text-slate-600 font-medium mb-1">Price</div>
                        <div className="text-3xl font-mono font-bold text-slate-900">{formatPrice(currentRate, pair.symbol)}</div>
                        <div className={`text-sm font-mono mt-1 flex items-center justify-end gap-1 ${isBull ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {isBull ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                            → {formatPrice(pred.predictedPrice, pair.symbol)}
                        </div>
                        <div className={`text-xs mt-1 ${pred.sessionChange.value >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            Session: {pred.sessionChange.text}
                        </div>
                    </div>
                </div>

                {isActionable ? (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className={`col-span-1 rounded-2xl p-6 flex flex-col items-center justify-center border ${isBull ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-rose-500/10 border-rose-500/20'}`}>
                            <span className={`text-sm font-bold uppercase tracking-widest mb-2 ${isBull ? 'text-emerald-500' : 'text-rose-500'}`}>Signal</span>
                            <div className={`text-4xl font-black ${isBull ? 'text-emerald-400' : 'text-rose-400'}`}>{pred.signal}</div>
                            <div className="mt-3 w-full"><StrengthBar strength={pred.strength} signal={pred.signal} /></div>
                            <div className="mt-2 text-slate-700 text-xs">{pred.signalStrength}% confluence</div>
                            <div className="mt-1 text-[10px] text-slate-600">{pred.volatilityLabel} volatility</div>
                        </div>
                        <div className="col-span-1 md:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                            {[
                                { label: 'Stop Loss', val: sl, color: 'text-rose-400', bg: 'bg-rose-500/5 border-rose-500/10', note: `${(slDist / pair.pipValue).toFixed(0)} pips` },
                                { label: 'Entry', val: entryWithSlippage, color: 'text-cyan-400', bg: 'bg-cyan-500/5 border-cyan-500/10', note: 'Incl. spread' },
                                { label: 'Take Profit', val: tp, color: 'text-emerald-400', bg: 'bg-emerald-500/5 border-emerald-500/10', note: `${(tpDist / pair.pipValue).toFixed(0)} pips` },
                            ].map(item => (
                                <div key={item.label} className={`rounded-xl p-4 border flex flex-col justify-between hover:scale-[1.02] transition-all duration-300 ${item.bg}`}>
                                    <div className={`flex items-center gap-2 ${item.color} mb-2`}>
                                        <Target className="w-4 h-4" />
                                        <span className="text-sm font-bold">{item.label}</span>
                                    </div>
                                    <div className="text-2xl font-mono text-slate-900 font-semibold">{formatPrice(item.val, pair.symbol)}</div>
                                    <div className="text-xs text-slate-700 mt-1">{item.note}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="md:col-span-1 bg-slate-500/5 border border-slate-500/15 rounded-2xl p-5 flex flex-col items-center justify-center">
                            <Minus className="w-8 h-8 text-slate-400 mb-2" />
                            <div className="text-2xl font-black text-slate-400">HOLD</div>
                            <div className="text-xs text-slate-600 mt-2 text-center">No clear edge right now</div>
                            <div className="mt-3 w-full"><StrengthBar strength={pred.strength} signal={pred.signal} /></div>
                        </div>
                        <div className="md:col-span-2 grid grid-cols-2 gap-3">
                            {[
                                { label: 'RSI', val: pred.rsiValid ? pred.rsi.toFixed(1) : NULL_DISPLAY, color: pred.rsiValid && pred.rsi <= 30 ? 'text-emerald-400' : pred.rsiValid && pred.rsi >= 70 ? 'text-rose-400' : 'text-slate-900', sub: pred.rsiValid ? (pred.rsi <= 30 ? 'Oversold' : pred.rsi >= 70 ? 'Overbought' : 'Neutral') : '—' },
                                { label: 'EMA', val: pred.emaValid ? (pred.ema12 > pred.ema26 ? 'GOLDEN' : 'DEATH') : NULL_DISPLAY, color: pred.emaValid ? (pred.ema12 > pred.ema26 ? 'text-emerald-400' : 'text-rose-400') : 'text-slate-500', sub: pred.emaValid ? `12 vs 26` : '—' },
                                { label: 'ADX', val: pred.adx.adx ? pred.adx.adx.toFixed(0) : NULL_DISPLAY, color: pred.adx.trending ? 'text-blue-400' : 'text-slate-600', sub: pred.adx.trending ? 'Trending' : 'Ranging' },
                                { label: '1H Trend', val: pred.htfAlignment.htfTrend ?? NULL_DISPLAY, color: pred.htfAlignment.htfTrend === 'bullish' ? 'text-emerald-400' : pred.htfAlignment.htfTrend === 'bearish' ? 'text-rose-400' : 'text-slate-500', sub: pred.htfSuppressed ? '⚠ Opposing' : '—' },
                            ].map(item => <MetricCell key={item.label} {...item} />)}
                        </div>
                        {(() => {
                            const others = (allData || []).filter(x => x.pair.symbol !== pair.symbol && isWatchPair(x) && x.prediction?.signal !== 'HOLD');
                            if (others.length === 0) return null;
                            return (
                                <div className="md:col-span-3 border-t border-black/[0.06] pt-4">
                                    <p className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                        <Star className="w-3.5 h-3.5 text-amber-400" />Other setups
                                    </p>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                        {others.slice(0, 4).map(o => (
                                            <div key={o.pair.symbol} className="bg-black/[0.03] border border-black/[0.06] rounded-xl p-3">
                                                <div className="flex items-center gap-1.5 mb-1">
                                                    <span className="text-sm">{o.pair.flag}</span>
                                                    <span className="text-xs font-bold text-slate-900">{o.pair.symbol}</span>
                                                    <TierBadge tier={getPairTier(o)} />
                                                </div>
                                                <SignalBadge signal={o.prediction.signal} size="sm" />
                                                <div className="text-[10px] text-slate-600 mt-1">{o.prediction.signalStrength}%</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                )}
            </div>
        </GlassCard>
    );
};

// ─── Trade Calculator ─────────────────────────────────────────────────────────

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
    const [slippagePips, setSlippagePips] = useState(1.5);

    const bestQualifiedSymbol = useMemo(() => {
        const tierOrder = { prime: 0, watch: 1, weak: 2, warming: 3, none: 4 };
        const tiered = [...currencyData].sort((a, b) => {
            const tA = tierOrder[getPairTier(a)] ?? 4, tB = tierOrder[getPairTier(b)] ?? 4;
            if (tA !== tB) return tA - tB;
            return (b.prediction?.signalStrength ?? 0) - (a.prediction?.signalStrength ?? 0);
        });
        return tiered[0]?.pair?.symbol ?? '';
    }, [currencyData]);

    const lastAutoSelected = useRef('');
    useEffect(() => {
        if (!bestQualifiedSymbol) return;
        if (!selectedSymbol) { setSelectedSymbol(bestQualifiedSymbol); lastAutoSelected.current = bestQualifiedSymbol; return; }
        if (selectedSymbol === lastAutoSelected.current && selectedSymbol !== bestQualifiedSymbol) {
            const current = pairMap.get(selectedSymbol);
            if (!current || getPairTier(current) === 'none') { setSelectedSymbol(bestQualifiedSymbol); lastAutoSelected.current = bestQualifiedSymbol; }
        }
    }, [bestQualifiedSymbol]); // eslint-disable-line

    const handleSymbolChange = (sym) => { setSelectedSymbol(sym); lastAutoSelected.current = ''; };
    const selectedPairData = pairMap.get(selectedSymbol) ?? null;

    const trade = useMemo(() => {
        const d = selectedPairData;
        if (!d?.prediction || !d.currentRate) return null;
        const { prediction: pred, currentRate, pair: pairMeta } = d;
        const directionBuy = pred.signal !== 'SELL';
        const slDist = pred.effectiveSLDist, tpDist = slDist * rrRatio;
        const totalFriction = (spreadPips + slippagePips) * pairMeta.pipValue;
        const entry = directionBuy ? currentRate + totalFriction : currentRate - totalFriction;
        const sl = directionBuy ? entry - slDist - totalFriction : entry + slDist + totalFriction;
        const tp = directionBuy ? entry + tpDist : entry - tpDist;
        const { value: pipUSD, usingFallback: pipUSDFallback, fallbackAgeMinutes } = getPipUSD(pairMeta, currentRate);
        const slPips = slDist / pairMeta.pipValue, tpPips = tpDist / pairMeta.pipValue;
        const effectiveSlPips = slPips + spreadPips + slippagePips;
        const riskAmt = balance * (riskPct / 100);
        const autoLotRaw = riskAmt / (effectiveSlPips * pipUSD);
        const autoLot = Math.min(50, Math.max(0.01, parseFloat(autoLotRaw.toFixed(2))));
        const finalLot = manualLot ? lotSize : autoLot;
        const actualRisk = finalLot * effectiveSlPips * pipUSD;
        const profit = finalLot * tpPips * pipUSD;
        const actualRR = actualRisk > 0 ? profit / actualRisk : 0;
        const breakevenWinRate = (1 / (1 + rrRatio)) * 100;
        const evAt50 = (0.5 * profit) - (0.5 * actualRisk);
        const overRisk = actualRisk > riskAmt * 1.05;
        const overRiskPct = balance > 0 ? (actualRisk / balance) * 100 : 0;
        const recMinBalance = minBalanceForRisk(pairMeta, effectiveSlPips, riskPct, currentRate);
        const tier = getPairTier(d);
        return { signal: pred.signal, directionBuy, entry, sl, tp, lot: finalLot, autoLot, slPips, tpPips, effectiveSlPips, spreadPips, slippagePips, totalFriction, actualRisk, profit, targetRR: rrRatio, actualRR, riskAmt, breakevenWinRate, evAt50, overRisk, overRiskPct, recMinBalance, bull: pred.bull, bear: pred.bear, strength: pred.strength, netScore: pred.netScore, hasConflict: pred.hasConflict, conflictType: pred.conflictType, priceMovesAgainstSignal: pred.priceMovesAgainstSignal, moveTooSmall: pred.moveTooSmall, pred, pairMeta, currentRate, pipUSD, pipUSDFallback, fallbackAgeMinutes, structuralSLUsed: pred.nearestSupport !== null && isFinite(pred.nearestSupport ?? Infinity), tier, largeSlNormal: pred.largeSlNormal };
    }, [selectedPairData, rrRatio, balance, riskPct, manualLot, lotSize, spreadPips, slippagePips]);

    const lastAutoLot = useRef(null);
    useEffect(() => {
        if (manualLot) return;
        if (trade?.autoLot == null) return;
        if (lastAutoLot.current !== trade.autoLot) { lastAutoLot.current = trade.autoLot; setLotSize(trade.autoLot); }
    }, [trade?.autoLot, manualLot]);

    return (
        <GlassCard className="p-6 mb-8">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2 flex-wrap">
                    <div className="bg-gradient-to-br from-violet-500 to-indigo-600 p-2 rounded-lg">
                        <Calculator className="w-5 h-5 text-white" />
                    </div>
                    Trade Calculator
                    {trade && <TierBadge tier={trade.tier} />}
                    {trade?.structuralSLUsed && <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full font-bold">Structural SL</span>}
                    {trade?.pipUSDFallback && <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full font-bold">⚠ Est. pip</span>}
                </h2>
                <button onClick={() => setShowAdv(!showAdv)} className="text-sm text-slate-600 hover:text-indigo-400 flex items-center gap-1 font-medium transition-colors">
                    {showAdv ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}Indicators
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                <div className="space-y-4">
                    <div>
                        <label className="text-xs text-slate-700 uppercase font-bold tracking-wider">Pair</label>
                        <select value={selectedSymbol} onChange={e => handleSymbolChange(e.target.value)} className="w-full bg-black/[0.05] border border-black/[0.08] text-slate-900 rounded-xl p-3 mt-1 focus:ring-2 focus:ring-indigo-500 outline-none font-medium appearance-none cursor-pointer hover:bg-white/[0.08] transition">
                            {currencyData.map(d => {
                                const tier = getPairTier(d);
                                const emoji = tier === 'prime' ? '★' : tier === 'watch' ? '◎' : tier === 'weak' ? '○' : tier === 'warming' ? '⏳' : '';
                                return <option key={d.pair.symbol} value={d.pair.symbol} className="bg-white text-slate-900">{d.pair.flag} {d.pair.symbol} {emoji}</option>;
                            })}
                        </select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-slate-700 uppercase font-bold tracking-wider flex items-center gap-1">
                                <DollarSign className="w-3 h-3" />Balance
                                <button onClick={() => setShowBalance(!showBalance)} className="ml-auto text-slate-600">{showBalance ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}</button>
                            </label>
                            <input type={showBalance ? 'number' : 'password'} min="1" value={balance} onChange={e => setBalance(Math.max(1, Number(e.target.value)))} className="w-full bg-black/[0.05] border border-black/[0.08] text-slate-900 rounded-xl p-3 mt-1 outline-none focus:border-indigo-500 font-medium" />
                        </div>
                        <div>
                            <label className="text-xs text-slate-700 uppercase font-bold tracking-wider">Risk %</label>
                            <input type="number" min="0.1" max="100" step="0.5" value={riskPct} onChange={e => setRiskPct(Math.min(100, Math.max(0.1, Number(e.target.value))))} className="w-full bg-black/[0.05] border border-black/[0.08] text-slate-900 rounded-xl p-3 mt-1 outline-none focus:border-indigo-500 font-medium" />
                        </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                        <input type="checkbox" id="manual-lot" checked={manualLot} onChange={e => setManualLot(e.target.checked)} className="rounded bg-black/10 border-black/20 text-indigo-600" />
                        <label htmlFor="manual-lot" className="text-sm text-slate-600 font-medium">Manual Lot</label>
                        {manualLot && <input type="number" min="0.01" step="0.01" value={lotSize} onChange={e => setLotSize(Math.max(0.01, Number(e.target.value)))} className="ml-auto w-24 bg-black/[0.05] border border-black/[0.08] text-slate-900 rounded-lg p-1.5 text-sm text-right font-medium" />}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-slate-700 uppercase font-bold tracking-wider">Spread (p)</label>
                            <input type="number" min="0" max="20" step="1" value={spreadPips} onChange={e => setSpreadPips(Math.max(0, Number(e.target.value)))} className="w-full bg-black/[0.05] border border-black/[0.08] text-slate-900 rounded-xl p-3 mt-1 outline-none focus:border-indigo-500 font-medium" />
                        </div>
                        <div>
                            <label className="text-xs text-slate-700 uppercase font-bold tracking-wider">Slippage (p)</label>
                            <input type="number" min="0" max="10" step="0.5" value={slippagePips} onChange={e => setSlippagePips(Math.max(0, Number(e.target.value)))} className="w-full bg-black/[0.05] border border-black/[0.08] text-slate-900 rounded-xl p-3 mt-1 outline-none focus:border-indigo-500 font-medium" />
                        </div>
                    </div>

                    <div>
                        <label className="text-xs text-slate-700 uppercase font-bold tracking-wider">Risk : Reward</label>
                        <div className="flex items-center gap-3 mt-1">
                            <input type="range" min="1" max="5" step="0.5" value={rrRatio} onChange={e => setRrRatio(Number(e.target.value))} className="flex-1 h-1.5 bg-black/10 rounded-lg appearance-none cursor-pointer accent-indigo-500" />
                            <span className="text-sm font-mono font-bold text-indigo-400 w-12 text-right">1:{rrRatio}</span>
                        </div>
                    </div>
                </div>

                {trade ? (
                    <div className="lg:col-span-2 bg-black/[0.02] border border-black/[0.06] rounded-xl p-5">
                        {trade.overRisk && (
                            <div className="flex items-start gap-2 mb-3 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-700 font-semibold">
                                <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-500 mt-0.5" />
                                <div>
                                    Risk ${trade.actualRisk.toFixed(2)} ({trade.overRiskPct.toFixed(1)}%) exceeds {riskPct}% target.
                                    Min balance: <strong>${trade.recMinBalance.toLocaleString()}</strong>
                                </div>
                            </div>
                        )}

                        <div className="flex justify-between items-start mb-4 pb-4 border-b border-black/[0.06]">
                            <div>
                                <SignalBadge signal={trade.signal} size="lg" />
                                <div className="mt-2 flex gap-2 flex-wrap">
                                    <RegimeBadge adx={trade.pred.adx} />
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-2xl font-bold text-indigo-400">{trade.pred.signalStrength}%</div>
                                <div className="text-xs text-slate-600">confluence</div>
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

                        <div className="grid grid-cols-2 gap-4 border-t border-black/[0.06] pt-4">
                            <div className="bg-rose-500/5 p-3 rounded-lg border border-rose-500/10">
                                <div className="text-[10px] text-rose-500 font-bold uppercase mb-1">Stop Loss</div>
                                <div className="flex justify-between items-baseline">
                                    <span className="font-bold text-rose-400 font-mono">{formatPrice(trade.sl, selectedSymbol)}</span>
                                    <span className="text-xs text-rose-500/70">-{trade.effectiveSlPips.toFixed(1)}p</span>
                                </div>
                                <div className="text-[10px] text-rose-500/60 mt-1">Risk: ${trade.actualRisk.toFixed(2)}</div>
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
                            <span>R:R <strong className={trade.actualRR >= trade.targetRR * 0.9 ? 'text-emerald-400' : 'text-amber-400'}>{trade.actualRR.toFixed(2)}×</strong></span>
                            <span>${trade.pipUSD.toFixed(2)}/pip{trade.pipUSDFallback ? '*' : ''}</span>
                        </div>
                    </div>
                ) : (
                    <div className="lg:col-span-2 bg-black/[0.02] border border-black/[0.06] rounded-xl p-5 flex items-center justify-center text-slate-700 text-sm">
                        Select a pair with data
                    </div>
                )}
            </div>

            {trade && (
                <div className="border-t border-black/[0.06] pt-6">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <GlassCard className="p-4">
                            <div className="text-[10px] text-slate-700 uppercase font-bold mb-1">Breakeven Win Rate</div>
                            <div className="text-2xl font-mono font-bold text-slate-900">{trade.breakevenWinRate.toFixed(0)}%</div>
                            <div className="text-[10px] text-slate-700 mt-1">at 1:{rrRatio}</div>
                        </GlassCard>
                        <GlassCard className="p-4">
                            <div className="text-[10px] text-slate-700 uppercase font-bold mb-1">EV @ 50% Win Rate</div>
                            <div className={`text-2xl font-mono font-bold ${trade.evAt50 >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{trade.evAt50 >= 0 ? '+' : ''}${trade.evAt50.toFixed(2)}</div>
                            <div className="text-[10px] text-slate-700 mt-1">{trade.evAt50 >= 0 ? 'Positive edge' : 'Raise R:R'}</div>
                        </GlassCard>
                        <GlassCard className="p-4">
                            <div className="text-[10px] text-slate-700 uppercase font-bold mb-1">Risk Per Trade</div>
                            <div className={`text-2xl font-mono font-bold ${trade.overRisk ? 'text-amber-500' : 'text-rose-400'}`}>${trade.actualRisk.toFixed(2)}</div>
                            <div className="text-[10px] text-slate-700 mt-1">{trade.overRiskPct.toFixed(1)}%</div>
                        </GlassCard>
                    </div>
                </div>
            )}

            {showAdv && trade?.pred && (
                <div className="mt-4 pt-4 border-t border-black/[0.06] grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                        { label: 'RSI (14)', val: trade.pred.rsiValid ? trade.pred.rsi.toFixed(1) : NULL_DISPLAY, sub: !trade.pred.rsiValid ? '—' : trade.pred.rsi <= 30 ? 'Oversold' : trade.pred.rsi >= 70 ? 'Overbought' : 'Neutral', color: !trade.pred.rsiValid ? 'text-slate-600' : trade.pred.rsi >= 70 ? 'text-rose-400' : trade.pred.rsi <= 30 ? 'text-emerald-400' : 'text-slate-900' },
                        { label: 'MACD', val: trade.pred.macd.histogram !== undefined ? formatMacdNormalised(trade.pred.macd.histogram, trade.pred.atr, trade.pairMeta.pipValue) : NULL_DISPLAY, sub: !trade.pred.macdValid ? 'Flat' : trade.pred.macd.histogram > 0 ? 'Bullish' : 'Bearish', color: !trade.pred.macdValid ? 'text-slate-600' : trade.pred.macd.histogram > 0 ? 'text-emerald-400' : 'text-rose-400' },
                        { label: 'BB %B', val: trade.pred.bbValid ? (trade.pred.bollinger.percentB * 100).toFixed(0) + '%' : NULL_DISPLAY, sub: !trade.pred.bbValid ? '—' : trade.pred.bollinger.percentB <= 0.10 ? 'Below band' : trade.pred.bollinger.percentB >= 0.90 ? 'Above band' : 'Mid', color: !trade.pred.bbValid ? 'text-slate-600' : 'text-cyan-400' },
                        { label: 'EMA Cross', val: !trade.pred.emaValid ? NULL_DISPLAY : trade.pred.ema12 > trade.pred.ema26 ? 'GOLDEN' : 'DEATH', sub: !trade.pred.emaValid ? '—' : `12 / 26`, color: !trade.pred.emaValid ? 'text-slate-600' : trade.pred.ema12 > trade.pred.ema26 ? 'text-emerald-400' : 'text-rose-400' },
                        { label: 'ADX', val: trade.pred.adx.adx ? trade.pred.adx.adx.toFixed(0) : NULL_DISPLAY, sub: trade.pred.adx.trending ? 'Trending' : 'Choppy', color: trade.pred.adx.trending ? 'text-blue-400' : 'text-slate-600' },
                        { label: 'Stochastic', val: trade.pred.stochastic?.valid ? `${trade.pred.stochastic.k.toFixed(0)}/${trade.pred.stochastic.d.toFixed(0)}` : NULL_DISPLAY, sub: trade.pred.stochastic?.valid ? trade.pred.stochastic.k < 20 ? 'Oversold' : trade.pred.stochastic.k > 80 ? 'Overbought' : 'Neutral' : '—', color: !trade.pred.stochastic?.valid ? 'text-slate-600' : trade.pred.stochastic.k < 20 ? 'text-emerald-400' : trade.pred.stochastic.k > 80 ? 'text-rose-400' : 'text-slate-900' },
                        { label: '1H Trend', val: trade.pred.htfAlignment.htfTrend ?? NULL_DISPLAY, sub: trade.pred.htfSuppressed ? '⚠ Opposing' : '—', color: trade.pred.htfAlignment.htfTrend === 'bullish' ? 'text-emerald-400' : trade.pred.htfAlignment.htfTrend === 'bearish' ? 'text-rose-400' : 'text-slate-600' },
                        { label: 'Volume', val: !trade.pred.volumeConf.hasData ? 'OTC' : trade.pred.volumeConf.confirmed ? 'High' : 'Low', sub: !trade.pred.volumeConf.hasData ? 'No data' : `${trade.pred.volumeConf.ratio?.toFixed(2)}× avg`, color: !trade.pred.volumeConf.hasData ? 'text-slate-500' : trade.pred.volumeConf.confirmed ? 'text-emerald-400' : 'text-rose-400' },
                    ].map(item => <MetricCell key={item.label} {...item} />)}
                </div>
            )}
        </GlassCard>
    );
};

// ─── Market Ticker ─────────────────────────────────────────────────────────────

const MarketTicker = ({ data }) => {
    if (!data || data.length === 0) return null;
    return (
        <div className="mb-6 overflow-hidden">
            <div className="flex gap-2 flex-wrap">
                {data.filter(d => d.currentRate).map(d => {
                    const pred = d.prediction;
                    const change = pred?.sessionChange;
                    const tier = getPairTier(d);
                    return (
                        <div key={d.pair.symbol} className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 border rounded-xl ${tier === 'prime' ? 'bg-emerald-500/5 border-emerald-500/15' : tier === 'watch' ? 'bg-amber-500/5 border-amber-500/15' : 'bg-black/[0.03] border-black/[0.06]'}`}>
                            <span className="text-sm">{d.pair.flag}</span>
                            <span className="text-xs font-bold text-slate-900">{d.pair.symbol}</span>
                            <span className="text-xs font-mono text-slate-700">{formatPrice(d.currentRate, d.pair.symbol)}</span>
                            {change && <span className={`text-[10px] font-mono font-bold ${change.value >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{change.text}</span>}
                            {pred && <SignalBadge signal={pred.signal} size="sm" />}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// ─── Market Sentiment ─────────────────────────────────────────────────────────

const MarketSentiment = ({ data }) => {
    const stats = useMemo(() => {
        const withPred = data.filter(d => d.prediction);
        const ready = withPred.filter(d => d.prediction.dataQualityOk);
        const buys = ready.filter(d => d.prediction.signal === 'BUY').length;
        const sells = ready.filter(d => d.prediction.signal === 'SELL').length;
        const holds = ready.filter(d => d.prediction.signal === 'HOLD').length;
        const avgStr = ready.length > 0 ? Math.round(ready.reduce((s, d) => s + d.prediction.signalStrength, 0) / ready.length) : 0;
        const trending = ready.filter(d => d.prediction.adx?.trending).length;
        const warmingUp = withPred.filter(d => !d.prediction.dataQualityOk).length;
        const primeCount = ready.filter(isPrimePair).length;
        const watchCount = ready.filter(d => !isPrimePair(d) && isWatchPair(d)).length;
        return { buys, sells, holds, avgStr, total: ready.length, trending, warmingUp, primeCount, watchCount };
    }, [data]);

    if (stats.total === 0 && stats.warmingUp === 0) return null;
    const sentiment = stats.buys > stats.sells ? 'Bullish' : stats.sells > stats.buys ? 'Bearish' : stats.total === 0 ? 'Loading' : 'Neutral';
    const sentColor = sentiment === 'Bullish' ? 'text-emerald-500' : sentiment === 'Bearish' ? 'text-rose-500' : 'text-slate-600';

    return (
        <GlassCard className="p-5 mb-6">
            <div className="flex items-center gap-2 mb-4">
                <Gauge className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-bold text-slate-900">Market Overview</h3>
                {stats.warmingUp > 0 && <span className="text-[10px] text-orange-400 font-bold ml-auto">⏳ {stats.warmingUp} loading</span>}
            </div>
            <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
                {[
                    { label: 'Bias', val: sentiment, color: sentColor, bg: 'bg-black/[0.03] border-black/[0.06]' },
                    { label: 'BUY', val: stats.buys, color: 'text-emerald-400', bg: 'bg-emerald-500/5 border-emerald-500/10' },
                    { label: 'SELL', val: stats.sells, color: 'text-rose-400', bg: 'bg-rose-500/5 border-rose-500/10' },
                    { label: 'HOLD', val: stats.holds, color: 'text-slate-600', bg: 'bg-black/[0.03] border-black/[0.06]' },
                    { label: 'Avg', val: stats.total > 0 ? `${stats.avgStr}%` : NULL_DISPLAY, color: stats.avgStr >= TIER_PRIME ? 'text-emerald-400' : stats.avgStr >= TIER_WATCH ? 'text-indigo-400' : 'text-amber-400', bg: 'bg-black/[0.03] border-black/[0.06]' },
                    { label: 'Prime', val: `${stats.primeCount}/${stats.total}`, color: stats.primeCount > 0 ? 'text-emerald-400' : 'text-slate-500', bg: stats.primeCount > 0 ? 'bg-emerald-500/5 border-emerald-500/10' : 'bg-black/[0.03] border-black/[0.06]' },
                    { label: 'Watch', val: `${stats.watchCount}/${stats.total}`, color: stats.watchCount > 0 ? 'text-amber-400' : 'text-slate-500', bg: stats.watchCount > 0 ? 'bg-amber-500/5 border-amber-500/10' : 'bg-black/[0.03] border-black/[0.06]' },
                    { label: 'Trend', val: stats.trending, color: 'text-blue-400', bg: 'bg-black/[0.03] border-black/[0.06]' },
                ].map(item => (
                    <div key={item.label} className={`rounded-xl p-3 text-center border ${item.bg}`}>
                        <div className="text-[10px] text-slate-700 uppercase font-bold">{item.label}</div>
                        <div className={`text-lg font-bold ${item.color}`}>{item.val}</div>
                    </div>
                ))}
            </div>
        </GlassCard>
    );
};

// ─── Pair Card ────────────────────────────────────────────────────────────────

const PairCardInner = ({ item }) => {
    const gradientId = makeGradientId(item.pair.symbol, '-card');
    const pred = item.prediction;
    const tier = getPairTier(item);
    const isBull = pred?.trend === 'bullish';
    const color = isBull ? '#10b981' : pred?.trend === 'bearish' ? '#f43f5e' : '#64748b';
    const signal = pred?.signal ?? 'HOLD';

    return (
        <GlassCard
            className={`p-5 hover:scale-[1.02] transition-all duration-300 cursor-default group ${tier === 'prime' ? 'border-emerald-500/15' : tier === 'watch' ? 'border-amber-500/15' : ''}`}
            glow={isBull ? 'bg-gradient-to-br from-emerald-500/5 to-transparent' : pred?.trend === 'bearish' ? 'bg-gradient-to-br from-rose-500/5 to-transparent' : ''}
        >
            <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/[0.06] flex items-center justify-center text-lg border border-black/[0.08] group-hover:scale-110 transition-transform">
                        {item.pair.flag}
                    </div>
                    <div>
                        <div className="flex items-center gap-1.5">
                            <h3 className="font-bold text-slate-900 text-lg leading-none">{item.pair.symbol}</h3>
                            <TierBadge tier={tier} />
                        </div>
                        <span className="text-xs text-slate-700">{item.pair.name}</span>
                        <PairWarnings pred={pred} />
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-lg font-mono font-bold text-slate-900">{formatPrice(item.currentRate, item.pair.symbol)}</div>
                    {pred && <div className={`text-xs font-mono mt-0.5 ${pred.sessionChange.value >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{pred.sessionChange.text}</div>}
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
                    <div className="h-full flex items-center justify-center text-xs text-slate-600">Loading…</div>
                )}
            </div>

            <div className="grid grid-cols-4 gap-2 mb-3">
                {[
                    { label: 'RSI', val: pred?.rsiValid ? pred.rsi.toFixed(0) : NULL_DISPLAY, color: !pred?.rsiValid ? 'text-slate-600' : pred.rsi >= 70 ? 'text-rose-400' : pred.rsi <= 30 ? 'text-emerald-400' : 'text-slate-900' },
                    { label: 'MACD', val: pred?.macd?.histogram !== undefined ? formatMacdNormalised(pred.macd.histogram, pred.atr, item.pair.pipValue) : NULL_DISPLAY, color: !pred?.macdValid ? 'text-slate-500' : (pred.macd.histogram ?? 0) > 0 ? 'text-emerald-400' : 'text-rose-400' },
                    { label: 'ADX', val: pred?.adx?.adx ? pred.adx.adx.toFixed(0) : NULL_DISPLAY, color: pred?.adx?.trending ? 'text-blue-400' : 'text-slate-600' },
                    { label: 'Vol', val: !pred?.volumeConf?.hasData ? '—' : pred?.volumeConf?.confirmed ? '✓' : '✗', color: !pred?.volumeConf?.hasData ? 'text-slate-400' : pred?.volumeConf?.confirmed ? 'text-emerald-400' : 'text-rose-400' },
                ].map(cell => (
                    <div key={cell.label} className="bg-black/[0.03] rounded-lg p-2 text-center border border-white/[0.05]">
                        <div className="text-[10px] text-slate-700 uppercase font-semibold">{cell.label}</div>
                        <div className={`text-sm font-mono font-bold ${cell.color} truncate`}>{cell.val}</div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-3 gap-2">
                {[
                    { label: 'Target', val: pred ? formatPrice(pred.predictedPrice, item.pair.symbol) : NULL_DISPLAY, color: pred ? pred.predictedPrice > item.currentRate ? 'text-emerald-400' : 'text-rose-400' : 'text-slate-600' },
                    { label: 'Signal', val: signal, color: signal === 'BUY' ? 'text-emerald-400' : signal === 'SELL' ? 'text-rose-400' : 'text-slate-500' },
                    { label: 'Confluence', val: pred ? `${pred.signalStrength}%` : NULL_DISPLAY, color: pred?.signalStrength >= TIER_PRIME ? 'text-emerald-400' : pred?.signalStrength >= TIER_WATCH ? 'text-amber-400' : 'text-slate-500' },
                ].map(cell => (
                    <div key={cell.label} className="bg-black/[0.03] rounded-lg p-2 text-center border border-white/[0.05]">
                        <div className="text-[10px] text-slate-700 uppercase font-semibold">{cell.label}</div>
                        <div className={`text-sm font-mono font-bold ${cell.color} truncate`}>{cell.val}</div>
                    </div>
                ))}
            </div>

            {pred?.htfAlignment?.htfTrend && <div className="mt-2 flex gap-1"><HTFBadge htfAlignment={pred.htfAlignment} /></div>}
        </GlassCard>
    );
};

const PairCard = (props) => (
    <ErrorBoundary><PairCardInner {...props} /></ErrorBoundary>
);

const PaginationControls = ({ currentPage, totalPages, onPageChange, totalItems }) => {
    if (totalPages <= 1) return null;
    return (
        <div className="flex items-center justify-between mb-6 text-sm text-slate-700">
            <span>{totalItems} pairs · Page {currentPage}/{totalPages}</span>
            <div className="flex gap-2">
                <button onClick={() => onPageChange(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-4 py-2 rounded-xl bg-black/[0.05] border border-black/[0.08] hover:border-indigo-500/50 disabled:opacity-30 transition text-slate-900 font-medium">‹ Prev</button>
                <button onClick={() => onPageChange(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="px-4 py-2 rounded-xl bg-black/[0.05] border border-black/[0.08] hover:border-indigo-500/50 disabled:opacity-30 transition text-slate-900 font-medium">Next ›</button>
            </div>
        </div>
    );
};

// ─── Main Dashboard ────────────────────────────────────────────────────────────

const ForexDashboard = () => {
    const [pairsData, setPairsData] = useState([]);
    const [predictor] = useState(() => new ForexPredictor());
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState(Date.now());
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [dataSource, setDataSource] = useState('Initialising…');
    const [page, setPage] = useState(1);
    const [activeSessions, setActiveSessions] = useState(() => getActiveSessions(new Date().getUTCHours()));
    const [fetchProgress, setFetchProgress] = useState(null);
    const PER_PAGE = 8;

    const mountedRef = useRef(true);
    useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
    const ifMounted = useCallback((fn) => { if (mountedRef.current) fn(); }, []);

    const [chatOpen, setChatOpen] = useState(false);
    const chatGenRef = useRef(0);
    const [messages, setMessages] = useState(() => [makeMsg('assistant', 'QuantAI ready. Ask about any pair, signal, or setup.')]);
    const [input, setInput] = useState('');
    const msgEndRef = useRef(null);

    const pairsRef = useRef(pairsData);
    const messagesRef = useRef(messages);
    useEffect(() => { pairsRef.current = pairsData; }, [pairsData]);
    useEffect(() => { messagesRef.current = messages; }, [messages]);

    const groqAbortRef = useRef(null);
    const longAbortRef = useRef(null);
    const tickAbortRef = useRef(null);
    const tickRunning = useRef(false);
    const refreshLock = useRef(false);

    useEffect(() => {
        const update = () => ifMounted(() => setActiveSessions(getActiveSessions(new Date().getUTCHours())));
        const id = setInterval(update, 60_000);
        return () => clearInterval(id);
    }, [ifMounted]);

    const rehydratePair = useCallback(symbol => CURRENCY_PAIRS.find(p => p.symbol === symbol) ?? null, []);

    const buildPairs = useCallback((tsMap, prevPairs = []) => {
        const sessions = getActiveSessions(new Date().getUTCHours());
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
            if (!rate) return { pair: pairMeta, currentRate: null, history, htfHistory, prediction: null };
            const sessionQuality = getSessionQuality(pairMeta.symbol, sessions);
            const prediction = predictor.predict(pairMeta.symbol, pairMeta, sessionQuality, sessions);
            return { pair: pairMeta, currentRate: rate, history, htfHistory, prediction };
        });
    }, [predictor]);

    const initData = useCallback(async () => {
        if (longAbortRef.current) longAbortRef.current.abort();
        const controller = new AbortController();
        longAbortRef.current = controller;
        const { signal } = controller;

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
            const sessions = getActiveSessions(new Date().getUTCHours());
            const withPred = cd.map(item => {
                const pair = rehydratePair(item.pair?.symbol);
                if (!pair) return null;
                const sessionQuality = getSessionQuality(pair.symbol, sessions);
                return { pair, currentRate: item.currentRate, history: item.history, htfHistory: item.htfHistory ?? [], prediction: predictor.predict(pair.symbol, pair, sessionQuality, sessions) };
            }).filter(Boolean);
            ifMounted(() => { setPairsData(withPred); setLastUpdated(timestamp); setDataSource(`Cached — refreshing…`); setLoading(false); });
            if (age < UPDATE_INTERVAL) { ifMounted(() => setDataSource('Live (cached)')); return; }
        }

        ifMounted(() => { setDataSource('Fetching data…'); setFetchProgress({ done: 0, total: CURRENCY_PAIRS.length, symbol: '', phase: 'start' }); });

        try {
            const tsMap = await fetchAllTimeSeries(signal, prog => ifMounted(() => setFetchProgress(prog)));
            if (signal.aborted) return;
            ifMounted(() => setFetchProgress(null));
            const pairs = buildPairs(tsMap);
            const now = Date.now();
            const liveCount = Object.keys(tsMap).length;
            ifMounted(() => { setPairsData(pairs); setLastUpdated(now); setPage(1); setDataSource(`Live · ${liveCount}/${CURRENCY_PAIRS.length} pairs`); });
            safeSetCache(pairs, now);
        } catch (err) {
            if (err.name === 'AbortError') return;
            ifMounted(() => { setDataSource('Fetch failed'); setFetchProgress(null); });
        } finally {
            ifMounted(() => setLoading(false));
        }
    }, [predictor, buildPairs, rehydratePair, ifMounted]);

    const forceRefresh = useCallback(async () => {
        if (refreshLock.current) return;
        refreshLock.current = true;
        ifMounted(() => setIsRefreshing(true));
        if (longAbortRef.current) longAbortRef.current.abort();
        if (tickAbortRef.current) tickAbortRef.current.abort();
        tickRunning.current = false;
        rateLimiter.reset();
        const controller = new AbortController();
        longAbortRef.current = controller;
        const { signal } = controller;
        const snapshot = pairsRef.current;
        ifMounted(() => { setDataSource('Refreshing…'); setFetchProgress({ done: 0, total: CURRENCY_PAIRS.length, symbol: '', phase: 'start' }); });
        CURRENCY_PAIRS.forEach(p => predictor.setHistory(p.symbol, []));
        safeRemoveCache();
        try {
            const tsMap = await fetchAllTimeSeries(signal, prog => ifMounted(() => setFetchProgress(prog)));
            if (signal.aborted) return;
            ifMounted(() => setFetchProgress(null));
            if (Object.keys(tsMap).length === 0) {
                snapshot.forEach(item => { if (item.history?.length) predictor.setHistory(item.pair.symbol, item.history); if (item.htfHistory?.length) predictor.setHTFHistory(item.pair.symbol, item.htfHistory); });
                ifMounted(() => { setPairsData(snapshot); setDataSource('No data — showing cached'); });
                return;
            }
            const pairs = buildPairs(tsMap);
            const now = Date.now();
            ifMounted(() => { setPairsData(pairs); setLastUpdated(now); setPage(1); setDataSource(`Live · ${Object.keys(tsMap).length}/${CURRENCY_PAIRS.length} pairs`); });
            safeSetCache(pairs, now);
        } catch (err) {
            if (err.name === 'AbortError') return;
            snapshot.forEach(item => { if (item.history?.length) predictor.setHistory(item.pair.symbol, item.history); if (item.htfHistory?.length) predictor.setHTFHistory(item.pair.symbol, item.htfHistory); });
            ifMounted(() => { setPairsData(snapshot); setDataSource('Refresh failed — showing last data'); setFetchProgress(null); });
        } finally {
            ifMounted(() => setIsRefreshing(false));
            refreshLock.current = false;
        }
    }, [predictor, buildPairs, ifMounted]);

    const tickUpdate = useCallback(async () => {
        if (tickRunning.current || refreshLock.current) return;
        tickRunning.current = true;
        if (tickAbortRef.current) tickAbortRef.current.abort();
        const tickController = new AbortController();
        tickAbortRef.current = tickController;
        const { signal } = tickController;
        try {
            const now = Date.now();
            const updates = [];
            for (const p of CURRENCY_PAIRS) {
                if (signal.aborted || refreshLock.current) break;
                const rate = await fetchSpotPrice(p, signal);
                updates.push({ symbol: p.symbol, rate });
            }
            if (signal.aborted || refreshLock.current) return;
            const prevPairs = pairsRef.current;
            const sessions = getActiveSessions(new Date().getUTCHours());
            const nextPairs = prevPairs.map(item => {
                if (signal.aborted || refreshLock.current) return item;
                const upd = updates.find(u => u.symbol === item.pair.symbol);
                const rate = upd?.rate ?? item.currentRate;
                if (!rate) return item;
                predictor.addTick(item.pair.symbol, rate);
                const sessionQuality = getSessionQuality(item.pair.symbol, sessions);
                const prediction = predictor.predict(item.pair.symbol, item.pair, sessionQuality, sessions);
                const history = predictor.getHistory(item.pair.symbol).slice(-TIMESERIES_SIZE);
                return { ...item, currentRate: rate, history, prediction };
            });
            if (signal.aborted || refreshLock.current) return;
            ifMounted(() => { setPairsData(nextPairs); setLastUpdated(now); setDataSource(`Live · 5-min poll`); });
            safeSetCache(nextPairs, now);
        } catch (err) {
            if (err.name !== 'AbortError') ifMounted(() => setDataSource('Update failed — retrying'));
        } finally { tickRunning.current = false; }
    }, [predictor, ifMounted]);

    useEffect(() => { initData(); return () => { if (longAbortRef.current) longAbortRef.current.abort(); }; }, [initData]);
    useEffect(() => { if (loading) return; const id = setInterval(tickUpdate, UPDATE_INTERVAL); return () => { clearInterval(id); if (tickAbortRef.current) tickAbortRef.current.abort(); }; }, [loading, tickUpdate]);
    useEffect(() => { msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

    const primePairs = pairsData.filter(isPrimePair);
    const watchPairs = pairsData.filter(d => !isPrimePair(d) && isWatchPair(d));
    const anyPairs = pairsData.filter(d => d.prediction !== null);
    const bestData = (primePairs.length > 0 ? primePairs : watchPairs.length > 0 ? watchPairs : anyPairs)
        .reduce((p, c) => (c.prediction?.signalStrength ?? 0) > (p?.prediction?.signalStrength ?? 0) ? c : p, null);
    const pagePairs = pairsData.slice((page - 1) * PER_PAGE, page * PER_PAGE);
    const warmingUpCount = pairsData.filter(d => d.prediction && !d.prediction.dataQualityOk).length;
    const pairMap = useMemo(() => new Map(pairsData.map(d => [d.pair.symbol, d])), [pairsData]);

    const handleChat = useCallback(async (e) => {
        e.preventDefault();
        if (!input.trim()) return;
        const userMsg = input.trim();
        setInput('');
        const thisGen = (chatGenRef.current = chatGenRef.current + 1);
        if (groqAbortRef.current) groqAbortRef.current.abort();
        const groqController = new AbortController();
        groqAbortRef.current = groqController;
        const userEntry = makeMsg('user', userMsg);
        const loadingEntry = makeMsg('assistant', '⏳ Analysing…', { isLoading: true });
        const recentMsgs = [...messagesRef.current.filter(m => !m.isLoading), userEntry].slice(-12);
        setMessages(prev => { const trimmed = prev.filter(m => !m.isLoading).slice(-(MAX_CHAT_MESSAGES - 2)); return [...trimmed, userEntry, loadingEntry]; });
        const commitReply = (replyMsg) => { if (chatGenRef.current !== thisGen) return; setMessages(prev => [...prev.filter(m => !m.isLoading).slice(-(MAX_CHAT_MESSAGES - 1)), replyMsg]); };
        const clearLoading = () => { if (chatGenRef.current !== thisGen) return; setMessages(prev => prev.filter(m => !m.isLoading)); };
        try {
            const reply = await sendToGroq(pairsRef.current, recentMsgs, groqController.signal);
            if (groqController.signal.aborted) { clearLoading(); return; }
            commitReply(makeMsg('assistant', reply));
        } catch (err) {
            if (err.name === 'AbortError') { clearLoading(); return; }
            commitReply(makeMsg('assistant', getFallbackReply(pairsRef.current)));
        }
    }, [input]);

    useEffect(() => { return () => { if (groqAbortRef.current) groqAbortRef.current.abort(); }; }, []);

    if (loading) return (
        <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center">
            <div className="flex flex-col items-center gap-6 max-w-sm px-6">
                <div className="relative">
                    <div className="absolute inset-0 bg-indigo-500/20 rounded-full blur-2xl animate-pulse" />
                    <RefreshCw className="w-12 h-12 animate-spin text-indigo-400 relative" />
                </div>
                <span className="text-slate-600 font-mono tracking-[0.3em] animate-pulse font-medium text-sm">LOADING</span>
                {fetchProgress && <FetchProgressBar progress={fetchProgress} />}
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans">
            <nav className="border-b border-black/[0.06] bg-[#f8fafc]/80 backdrop-blur-2xl sticky top-0 z-40">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="bg-gradient-to-br from-indigo-500 to-violet-600 p-2 rounded-xl shadow-lg shadow-indigo-500/20">
                            <Activity className="w-5 h-5 text-white" />
                        </div>
                        <h1 className="font-bold text-lg tracking-tight">QUANT<span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">AI</span></h1>
                        {activeSessions.length > 0 && (
                            <div className="hidden sm:flex gap-1">
                                {activeSessions.map(s => (
                                    <span key={s.key} className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: s.color + '20', color: s.color, border: `1px solid ${s.color}30` }}>{s.icon} {s.name}</span>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-600 font-mono">
                            <Clock className="w-3.5 h-3.5" />
                            {new Date(lastUpdated).toLocaleTimeString()}
                        </div>
                        <button onClick={forceRefresh} disabled={isRefreshing} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-medium disabled:opacity-50 transition-all shadow-lg shadow-indigo-500/20">
                            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                            <span className="hidden sm:inline">{isRefreshing ? 'Refreshing…' : 'Refresh'}</span>
                        </button>
                        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/[0.05] border border-black/[0.08]">
                            <PulseDot color={isRefreshing ? 'bg-amber-400' : warmingUpCount > 0 ? 'bg-orange-400' : 'bg-emerald-400'} />
                            <span className="text-xs font-bold tracking-wider text-slate-600">{isRefreshing ? 'UPDATING' : 'LIVE'}</span>
                        </span>
                    </div>
                </div>
            </nav>

            <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
                {fetchProgress && <FetchProgressBar progress={fetchProgress} />}
                <MarketTicker data={pairsData} />
                <MarketSentiment data={pairsData} />
                <ErrorBoundary>
                    <FeaturedRecommendation data={bestData} allData={pairsData} />
                </ErrorBoundary>
                <TradeSettings pairMap={pairMap} currencyData={pairsData} />

                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                        <Globe className="w-5 h-5 text-indigo-400" />All Pairs
                    </h2>
                    <div className="flex items-center gap-3">
                        <div className="flex gap-1.5">
                            <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-bold">{primePairs.length} prime</span>
                            <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full font-bold">{watchPairs.length} watch</span>
                        </div>
                    </div>
                </div>

                <PaginationControls currentPage={page} totalPages={Math.ceil(pairsData.length / PER_PAGE)} onPageChange={setPage} totalItems={pairsData.length} />

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                    {pagePairs.map(item => <PairCard key={item.pair.symbol} item={item} />)}
                </div>
            </main>

            {/* Chat */}
            <div className="fixed bottom-6 right-6 z-50">
                {!chatOpen ? (
                    <button onClick={() => setChatOpen(true)} className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white p-4 rounded-2xl shadow-2xl shadow-indigo-500/30 transition-all hover:scale-105">
                        <Bot className="w-6 h-6" />
                    </button>
                ) : (
                    <div className="bg-white border border-black/[0.08] rounded-2xl shadow-2xl flex flex-col overflow-hidden backdrop-blur-xl" style={{ width: 'min(384px, calc(100vw - 24px))' }} role="dialog" aria-label="QuantAI chat" aria-modal="true">
                        <div className="bg-gradient-to-r from-indigo-600/20 to-violet-600/20 p-4 flex justify-between items-center border-b border-black/[0.08]">
                            <div className="flex items-center gap-2">
                                <PulseDot color="bg-emerald-400" />
                                <span className="font-bold text-slate-900 text-sm">QuantAI</span>
                            </div>
                            <button onClick={() => setChatOpen(false)} className="text-slate-700 hover:text-slate-900"><X className="w-4 h-4" /></button>
                        </div>
                        <div className="h-80 overflow-y-auto p-4 space-y-4" role="log" aria-live="polite">
                            {messages.map(m => (
                                <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm ${m.role === 'user' ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-br-sm' : 'bg-black/[0.05] text-slate-700 border border-black/[0.08] rounded-bl-sm'}`}>
                                        {renderBold(m.content)}
                                    </div>
                                </div>
                            ))}
                            <div ref={msgEndRef} />
                        </div>
                        <div className="p-3 bg-slate-50 border-t border-black/[0.08] flex gap-2 min-w-0">
                            <input className="flex-1 min-w-0 bg-black/[0.05] border border-black/[0.08] rounded-full px-4 py-2 text-sm text-slate-900 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50" placeholder="Ask about any pair…" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChat(e); } }} />
                            <button onClick={handleChat} disabled={!input.trim()} className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white p-2.5 rounded-full disabled:opacity-40 transition-all flex-shrink-0"><Send className="w-4 h-4" /></button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ForexDashboard;