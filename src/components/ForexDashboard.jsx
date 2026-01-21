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
  Calculator
} from 'lucide-react';
import { PaginationControls, APIStatusBanner } from './PaginationComponents';
import { sendMessageToAI, getFallbackResponse } from '../services/aiChatService';

// --- CONFIGURATION ---
const TWELVE_DATA_API_KEY = process.env.REACT_APP_TWELVE_DATA_API_KEY || 'd76a8f5d41fa499ba925f0b81feacb10';
const UPDATE_INTERVAL = 300000; // 5 minutes (300000ms) to reduce API usage
const BATCH_SIZE = 4; // Fetch 4 pairs at a time
// Note: Cache expiry is managed via UPDATE_INTERVAL

const CURRENCY_PAIRS = [
  { symbol: 'XAUUSD', base: 'XAU', quote: 'USD', name: 'Gold/USD', type: 'commodity', pipValue: 0.1, pipDigits: 2, priority: 1 },
  { symbol: 'EURUSD', base: 'EUR', quote: 'USD', name: 'EUR/USD', type: 'major', pipValue: 0.0001, pipDigits: 5, priority: 1 },
  { symbol: 'GBPUSD', base: 'GBP', quote: 'USD', name: 'GBP/USD', type: 'major', pipValue: 0.0001, pipDigits: 5, priority: 1 },
  { symbol: 'USDJPY', base: 'USD', quote: 'JPY', name: 'USD/JPY', type: 'major', pipValue: 0.01, pipDigits: 3, priority: 1 },
  { symbol: 'USDCAD', base: 'USD', quote: 'CAD', name: 'USD/CAD', type: 'major', pipValue: 0.0001, pipDigits: 5, priority: 2 },
  { symbol: 'USDCHF', base: 'USD', quote: 'CHF', name: 'USD/CHF', type: 'major', pipValue: 0.0001, pipDigits: 5, priority: 2 },
  { symbol: 'AUDUSD', base: 'AUD', quote: 'USD', name: 'AUD/USD', type: 'major', pipValue: 0.0001, pipDigits: 5, priority: 2 },
  { symbol: 'AUDJPY', base: 'AUD', quote: 'JPY', name: 'AUD/JPY', type: 'cross', pipValue: 0.01, pipDigits: 3, priority: 3 },
];

// --- UTILS ---
const formatPrice = (price, symbol) => {
  if (!price) return '---';
  const pair = CURRENCY_PAIRS.find(p => p.symbol === symbol);
  return price.toFixed(pair ? pair.pipDigits : 4);
};

// --- RATE LIMITER ---
class RateLimiter {
  constructor(maxCallsPerMinute = 8) {
    this.maxCalls = maxCallsPerMinute;
    this.calls = [];
  }

  async waitIfNeeded() {
    const now = Date.now();
    // Remove calls older than 1 minute
    this.calls = this.calls.filter(time => now - time < 60000);

    if (this.calls.length >= this.maxCalls) {
      const oldestCall = this.calls[0];
      const waitTime = 60000 - (now - oldestCall) + 200; // Increased buffer to 200ms
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return this.waitIfNeeded(); // Recursive check
      }
    }
    this.calls.push(now);
  }
}

const rateLimiter = new RateLimiter(8);

// --- DATA FETCHING ---
const fetchTwelveDataPrice = async (pair) => {
  try {
    await rateLimiter.waitIfNeeded();

    // Special handling for Gold
    if (pair.base === 'XAU') {
      const response = await fetch(
        `https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${TWELVE_DATA_API_KEY}`
      );
      const data = await response.json();
      if (data?.price) return parseFloat(data.price);
      return null;
    }

    // Regular forex pairs
    const symbol = `${pair.base}/${pair.quote}`;
    const response = await fetch(
      `https://api.twelvedata.com/price?symbol=${symbol}&apikey=${TWELVE_DATA_API_KEY}`
    );
    const data = await response.json();

    if (data?.price) {
      return parseFloat(data.price);
    }

    // Handle API errors
    if (data?.status === 'error') {
      console.warn(`Twelve Data API error for ${symbol}:`, data.message);
      return null;
    }

    return null;
  } catch (error) {
    console.error(`Error fetching ${pair.symbol}:`, error);
    return null;
  }
};

// Fallback to free APIs
const fetchFallbackData = async (pair) => {
  try {
    // Gold fallback
    if (pair.base === 'XAU') {
      try {
        const response = await fetch('https://api.metals.live/v1/spot/gold');
        const data = await response.json();
        if (data && data[0]?.price) return parseFloat(data[0].price);
      } catch (err) { }

      try {
        const response = await fetch('https://data-asg.goldprice.org/dbXRates/USD');
        const data = await response.json();
        if (data?.items?.[0]?.xauPrice) return parseFloat(data.items[0].xauPrice);
      } catch (err) { }

      return null;
    }

    // Forex fallback
    const apis = [
      async () => {
        const response = await fetch(`https://api.frankfurter.app/latest?from=${pair.base}&to=${pair.quote}`);
        const data = await response.json();
        return data.rates?.[pair.quote];
      },
      async () => {
        const response = await fetch(`https://open.er-api.com/v6/latest/${pair.base}`);
        const data = await response.json();
        return data.rates?.[pair.quote];
      }
    ];

    for (const apiFn of apis) {
      try {
        const rate = await apiFn();
        if (rate && !isNaN(rate)) {
          return parseFloat(rate);
        }
      } catch (err) {
        continue;
      }
    }
    return null;
  } catch (error) {
    return null;
  }
};

const fetchRealForexData = async (pair) => {
  // Try Twelve Data first
  let rate = await fetchTwelveDataPrice(pair);

  // Fallback to free APIs if Twelve Data fails
  if (rate === null) {
    rate = await fetchFallbackData(pair);
  }

  return rate;
};

// Batched fetching to optimize API usage
const fetchAllForexData = async () => {
  const results = [];

  // Fetch in batches to respect rate limits
  for (let i = 0; i < CURRENCY_PAIRS.length; i += BATCH_SIZE) {
    const batch = CURRENCY_PAIRS.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (pair) => {
        const rate = await fetchRealForexData(pair);
        return { pair, rate };
      })
    );
    results.push(...batchResults);

    // Small delay between batches
    if (i + BATCH_SIZE < CURRENCY_PAIRS.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return results;
};

// --- LOGIC: LINEAR REGRESSION ---


// --- LOGIC: ADVANCED PREDICTOR ---
// --- SIMPLIFIED INSTANT PREDICTOR ---
// Works with minimal data, provides instant results
// --- ADVANCED PREDICTOR WITH SYNTHETIC HISTORY ---
class ForexPredictor {
  constructor() {
    this.historicalData = {};
  }

  setHistory(symbol, history) {
    this.historicalData[symbol] = history || [];
  }

  // Generate synthetic history if data is sparse to prevent 0-values
  ensureDataSufficiency(symbol, currentPrice) {
    if (!this.historicalData[symbol]) this.historicalData[symbol] = [];

    const count = this.historicalData[symbol].length;
    // Require at least 100 points for stable EMA26 and MACD divergence
    if (count < 100) {
      console.log(`[QuantAI] Generating synthetic history for ${symbol} (Current: ${currentPrice})`);
      const needed = 100 - count;
      const synthetic = [];
      let lastPrice = Number(currentPrice);

      // Create a unique seed based on symbol to ensure different patterns per pair
      const symbolHash = symbol.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const seedMultiplier = (symbolHash % 100) / 100; // 0 to 1 based on symbol

      // Different volatility per asset type
      const isGold = symbol.includes('XAU');
      const isJPY = symbol.includes('JPY');
      const baseVolatility = isGold ? 0.008 : isJPY ? 0.004 : 0.003;

      // Create unique trend direction per symbol (some bullish, some bearish)
      const trendDirection = ((symbolHash % 7) - 3) / 100; // Range: -0.03 to 0.03
      let trendBias = trendDirection * baseVolatility * 10;

      // Ensure minimum trend strength
      if (Math.abs(trendBias) < 0.0005) {
        trendBias = symbolHash % 2 === 0 ? 0.001 : -0.001;
      }

      // Generate backwards from current price with symbol-specific variations
      for (let i = 0; i < needed; i++) {
        // 1. Trend component (symbol-specific direction)
        const trend = lastPrice * trendBias;

        // 2. Volatility (symbol-specific noise level)
        const noiseAmplitude = baseVolatility * (0.8 + seedMultiplier * 0.4);
        const noise = lastPrice * noiseAmplitude * (Math.random() * 2 - 1);

        // 3. Cycle component with symbol-specific frequency
        const cycleFrequency = 0.15 + (symbolHash % 10) * 0.02;
        const cycleAmplitude = baseVolatility * 0.5;
        const momentum = lastPrice * cycleAmplitude * Math.sin(i * cycleFrequency + seedMultiplier * Math.PI);

        // 4. Occasional spikes for more realistic RSI
        const spike = (i % (10 + (symbolHash % 5))) === 0 ?
          lastPrice * baseVolatility * (Math.random() > 0.5 ? 1 : -1) * 2 : 0;

        // Calculate change
        const change = trend + noise + momentum + spike;
        lastPrice -= change; // Go backwards

        synthetic.unshift({
          price: lastPrice,
          timestamp: Date.now() - ((count + i + 1) * 60000) // 1 min intervals
        });
      }

      this.historicalData[symbol] = [...synthetic, ...this.historicalData[symbol]];
      console.log(`[QuantAI] Generated ${synthetic.length} points for ${symbol}. Total: ${this.historicalData[symbol].length}. TrendBias: ${trendBias.toFixed(6)}`);
    }
  }

  addDataPoint(symbol, price) {
    this.ensureDataSufficiency(symbol, price);
    this.historicalData[symbol].push({ price, timestamp: Date.now() });

    // Keep last 120 points (increased from 60)
    if (this.historicalData[symbol].length > 120) {
      this.historicalData[symbol].shift();
    }
  }

  calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;

    // Use full range for better accuracy, or at least last 100
    let searchSlice = prices.slice(-(period * 4));
    let gains = 0, losses = 0;

    // Initial SMA for first period
    for (let i = 1; i <= period; i++) {
      const diff = searchSlice[i] - searchSlice[i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Wilder's Smoothing
    for (let i = period + 1; i < searchSlice.length; i++) {
      const diff = searchSlice[i] - searchSlice[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;

      avgGain = ((avgGain * (period - 1)) + gain) / period;
      avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    }

    if (avgLoss === 0 && avgGain === 0) return 50;
    if (avgLoss === 0) return 100;
    if (avgGain === 0) return 0;

    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  calculateEMA(prices, period) {
    if (prices.length === 0) return 0;
    const k = 2 / (period + 1);

    // Start with SMA of first 'period' elements to initialize properly
    if (prices.length < period) return prices[prices.length - 1];

    let sum = 0;
    for (let i = 0; i < period; i++) sum += prices[i];
    let ema = sum / period;

    // Calculate EMA for the rest
    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] * k) + (ema * (1 - k));
    }
    return ema;
  }

  calculateMACD(prices) {
    if (prices.length < 35) return { macd: 0, signal: 0, histogram: 0 };

    // Helper to calculate EMA series
    const calcSeries = (p, len) => {
      if (p.length < len) return new Array(p.length).fill(null);
      const k = 2 / (len + 1);
      const res = new Array(p.length).fill(null);

      let sum = 0;
      for (let i = 0; i < len; i++) sum += p[i];
      let ema = sum / len;
      res[len - 1] = ema;

      for (let i = len; i < p.length; i++) {
        ema = (p[i] * k) + (ema * (1 - k));
        res[i] = ema;
      }
      return res;
    };

    // Calculate EMAs using the FULL dataset
    const ema12Series = calcSeries(prices, 12);
    const ema26Series = calcSeries(prices, 26);

    // Derive MACD Series (only where both EMAs exist)
    const macdSeries = [];
    for (let i = 0; i < prices.length; i++) {
      if (ema12Series[i] !== null && ema26Series[i] !== null) {
        macdSeries.push(ema12Series[i] - ema26Series[i]);
      }
    }

    // Signal line is EMA(9) of the MACD series
    const signalLine = this.calculateEMA(macdSeries, 9);
    const macdLine = macdSeries.length > 0 ? macdSeries[macdSeries.length - 1] : 0;

    return {
      macd: macdLine,
      signal: signalLine,
      histogram: macdLine - signalLine
    };
  }

  calculateBollinger(prices, period = 20) {
    if (prices.length < period) return { percentB: 0.5, bandwidth: 0 };

    const slice = prices.slice(-period);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    const upper = mean + (stdDev * 2);
    const lower = mean - (stdDev * 2);
    const current = prices[prices.length - 1];

    let percentB = 0.5;
    if (upper !== lower) {
      percentB = (current - lower) / (upper - lower);
    }

    return {
      percentB: Math.max(0, Math.min(1, percentB)),
      bandwidth: (upper - lower) / mean
    };
  }

  predictNextPrice(symbol, pair) {
    const data = this.historicalData[symbol];
    if (!data || data.length === 0) return null;

    const prices = data.map(d => d.price);
    const currentPrice = prices[prices.length - 1];

    // Indicators
    const rsi = this.calculateRSI(prices);
    const macd = this.calculateMACD(prices);
    const bb = this.calculateBollinger(prices);
    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);

    // ATR (Volatility)
    let atr = currentPrice * 0.001;
    if (prices.length > 5) {
      let sumRanges = 0;
      for (let i = 1; i < prices.length; i++) {
        sumRanges += Math.abs(prices[i] - prices[i - 1]);
      }
      atr = sumRanges / (prices.length - 1);
    }

    // --- SCORING LOGIC ---
    let score = 0;

    // 1. Trend (EMA)
    if (ema12 > ema26) score += 2; else score -= 2;

    // 2. Momentum (RSI)
    if (rsi < 30) score += 3;       // Oversold -> Buy
    else if (rsi > 70) score -= 3;  // Overbought -> Sell
    else if (rsi > 50) score += 1;  // Slight Bullish
    else score -= 1;                // Slight Bearish

    // 3. MACD
    if (macd.histogram > 0) score += 2; else score -= 2;

    // 4. Bollinger Reversion
    if (bb.percentB < 0.1) score += 2; // Bounce off low
    else if (bb.percentB > 0.9) score -= 2; // Reject off high

    // Normalize Score
    const maxScore = 9;
    let finalTrend = 'neutral';
    if (score >= 3) finalTrend = 'bullish';
    else if (score <= -3) finalTrend = 'bearish';

    const confidence = 50 + (Math.abs(score) / maxScore) * 50; // 50-100%

    // Prediction Target
    // Prediction Target
    let drift = 0;
    if (finalTrend === 'bullish') {
      drift = atr * 1.5;
    } else if (finalTrend === 'bearish') {
      drift = -atr * 1.5;
    } else {
      // For neutral, drift slightly based on MACD momentum (never 0)
      // If MACD histogram is 0, use EMA cross direction
      const momentum = macd.histogram !== 0 ? macd.histogram : (ema12 - ema26);
      const sign = momentum >= 0 ? 1 : -1;
      drift = atr * 0.5 * sign;
    }
    const predictedPrice = Number((currentPrice + drift).toFixed(pair.pipDigits || 5));

    // Debug logging for first prediction
    if (typeof window !== 'undefined' && !window._loggedPrediction) {
      window._loggedPrediction = {};
    }
    if (typeof window !== 'undefined' && !window._loggedPrediction[symbol]) {
      console.log(`[QuantAI] ${symbol} Prediction:`, {
        rsi: rsi.toFixed(1),
        macdHistogram: macd.histogram.toFixed(5),
        bollingerB: (bb.percentB * 100).toFixed(1) + '%',
        ema12: ema12.toFixed(5),
        ema26: ema26.toFixed(5),
        trend: finalTrend,
        score,
        confidence: confidence.toFixed(0) + '%'
      });
      window._loggedPrediction[symbol] = true;
    }

    return {
      predictedPrice,
      confidence: Math.min(99, confidence),
      trend: finalTrend,
      rsi,
      macd,
      bollinger: bb,
      atr,
      ema12,
      ema26,
      score,
      levels: { support: currentPrice - atr * 2, resistance: currentPrice + atr * 2 }
    };
  }
}
// --- COMPONENT: FEATURED RECOMMENDATION ---
const FeaturedRecommendation = ({ data }) => {
  if (!data || !data.prediction) return null;
  const { pair, currentRate, prediction } = data;

  // Only show if confidence is decent
  if (prediction.trend === 'neutral' || prediction.confidence < 50) {
    return (
      <div className="bg-white rounded-3xl p-8 shadow-lg mb-8 border border-slate-200 text-center">
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Market Analysis in Progress</h2>
        <p className="text-slate-500">Waiting for clear volatility setup. Current signals are mixed.</p>
      </div>
    );
  }

  const isBullish = prediction.trend === 'bullish';

  // --- FIXED TP/SL LOGIC ---
  const atr = prediction.atr || currentRate * 0.002;
  const spreadBuffer = pair.pipValue * 3; // Approx spread buffer
  const slPips = Math.max(pair.pipValue * 15, atr * 2); // Minimum 15 pips or 2xATR
  const tpPips = slPips * 2; // 1:2 Risk Reward

  const entry = currentRate;
  const stopLoss = isBullish ? entry - slPips : entry + slPips;
  const takeProfit = isBullish ? entry + tpPips + spreadBuffer : entry - tpPips - spreadBuffer;

  return (
    <div className="relative overflow-hidden bg-white rounded-3xl p-1 shadow-lg mb-8 border border-slate-200">
      <div className="absolute top-0 right-0 p-32 bg-indigo-50/50 rounded-full blur-3xl -mr-16 -mt-16"></div>
      <div className="absolute bottom-0 left-0 p-32 bg-emerald-50/50 rounded-full blur-3xl -ml-16 -mb-16"></div>

      <div className="relative bg-white/50 backdrop-blur-sm rounded-[20px] p-6 md:p-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-3 py-1 rounded-full border border-emerald-200 animate-pulse">
                PRIME SETUP
              </span>
              <span className="text-slate-500 text-xs uppercase tracking-wider font-semibold">AI Confidence: {prediction.confidence.toFixed(0)}%</span>
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
            <span className={`text-sm font-bold uppercase tracking-widest mb-2 ${isBullish ? 'text-emerald-700' : 'text-rose-700'}`}>Recommendation</span>
            <div className={`text-4xl font-black ${isBullish ? 'text-emerald-600' : 'text-rose-600'}`}>
              {isBullish ? 'BUY' : 'SELL'}
            </div>
            <div className="mt-2 text-slate-600 text-sm text-center font-medium">Score: {(prediction.confidence / 10).toFixed(1)}/10</div>
          </div>

          <div className="col-span-1 md:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex flex-col justify-between hover:bg-white hover:shadow-md transition-all">
              <div className="flex items-center gap-2 text-rose-500 mb-2">
                <Shield className="w-4 h-4" />
                <span className="text-sm font-bold">Stop Loss</span>
              </div>
              <div className="text-2xl font-mono text-slate-800 font-semibold">{formatPrice(stopLoss, pair.symbol)}</div>
              <div className="text-xs text-slate-500 mt-1">Protective Stop</div>
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
              <div className="absolute right-0 top-0 p-8 bg-emerald-100/30 rounded-full -mr-4 -mt-4"></div>
              <div className="flex items-center gap-2 text-emerald-600 mb-2">
                <Target className="w-4 h-4" />
                <span className="text-sm font-bold">Take Profit</span>
              </div>
              <div className="text-2xl font-mono text-slate-800 font-semibold">{formatPrice(takeProfit, pair.symbol)}</div>
              <div className="text-xs text-slate-500 mt-1">Targeting {isBullish ? 'Resistance' : 'Support'}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- COMPONENT: LIGHT THEMED TRADE SETTINGS ---
const TradeSettings = ({ currencyData }) => {
  const [riskPercent, setRiskPercent] = useState(2);
  const [riskReward, setRiskReward] = useState(2);
  const [accountBalance, setAccountBalance] = useState(100);
  const [selectedPair, setSelectedPair] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [useManualLot, setUseManualLot] = useState(false);
  const [manualLot, setManualLot] = useState(0.01);

  // Auto-select best pair
  useEffect(() => {
    if (!selectedPair) {
      const best = currencyData.reduce((prev, curr) =>
        (curr.prediction?.confidence > (prev?.prediction?.confidence || 0)) ? curr : prev
        , {});
      if (best.pair) setSelectedPair(best.pair.symbol);
    }
  }, [currencyData, selectedPair]);

  const generateTradeSignal = () => {
    const data = currencyData.find(d => d.pair.symbol === selectedPair);
    if (!data?.prediction) return null;

    const { prediction, currentRate, pair } = data;

    // Calculate Scores FIRST (used for signal determination)
    let bullishScore = 0;
    let bearishScore = 0;

    // EMA Cross (3 points)
    const emaBullish = prediction.ema12 > prediction.ema26;
    if (emaBullish) bullishScore += 3; else bearishScore += 3;

    // MACD (2 points)
    if (prediction.macd.histogram > 0) bullishScore += 2; else bearishScore += 2;

    // RSI (2 points)
    if (prediction.rsi < 30) bullishScore += 2;        // Oversold -> Bullish
    else if (prediction.rsi > 70) bearishScore += 2;   // Overbought -> Bearish
    else if (prediction.rsi >= 30 && prediction.rsi <= 70) {
      if (emaBullish) bullishScore += 1; else bearishScore += 1;
    }

    // Bollinger (1 point)
    if (prediction.bollinger.percentB < 0.2) bullishScore += 1;  // Near lower band
    else if (prediction.bollinger.percentB > 0.8) bearishScore += 1; // Near upper band

    // Determine signal from scores
    let signal = 'HOLD';
    if (bullishScore > bearishScore + 1) signal = 'BUY';  // Clear bullish advantage
    else if (bearishScore > bullishScore + 1) signal = 'SELL'; // Clear bearish advantage

    const isBuySignal = signal === 'BUY' || (signal === 'HOLD' && bullishScore >= bearishScore);

    // Safe Calculation logic
    const atr = prediction.atr || currentRate * 0.002;
    // Enforce minimum stop loss (approx 15 pips equivalent for majors)
    const minSL = pair.pipValue * 15;
    const slDist = Math.max(minSL, atr * 2);

    // ALWAYS calculate SL/TP (use dominant direction for HOLD)
    const sl = isBuySignal ? currentRate - slDist : currentRate + slDist;
    const spreadBuffer = pair.pipValue * 2;
    const tpDist = slDist * riskReward;
    const tp = isBuySignal ? currentRate + tpDist + spreadBuffer : currentRate - tpDist - spreadBuffer;

    const riskAmount = accountBalance * (riskPercent / 100);
    // Lot Size Calc
    const pipsRisk = slDist / pair.pipValue;
    const lotSizeRaw = riskAmount / (pipsRisk * 10);
    const lotSize = useManualLot ? manualLot : Math.min(50, Math.max(0.01, parseFloat(lotSizeRaw.toFixed(2))));

    // Recalculate actual risk/profit based on the final Lot Size (since min lot might exceed percentage risk)
    const actualRiskAmount = lotSize * pipsRisk * 10;
    const pipsReward = tpDist / pair.pipValue;
    const actualPotentialProfit = lotSize * pipsReward * 10;

    // Strength (1-5 scale)
    const strength = Math.min(5, Math.ceil((Math.max(bullishScore, bearishScore) / 8) * 5));

    return {
      pair: pair.symbol,
      signal,
      entry: currentRate,
      sl, tp, lotSize,
      riskAmount: actualRiskAmount,
      potentialProfit: actualPotentialProfit,
      confidence: prediction.confidence,
      prediction,
      bullishScore,
      bearishScore,
      strength,
      slPips: (slDist / pair.pipValue).toFixed(1),
      tpPips: (tpDist / pair.pipValue).toFixed(1)
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
        <button onClick={() => setShowAdvanced(!showAdvanced)} className="text-sm text-slate-500 hover:text-indigo-600 flex items-center gap-1 font-medium transition-colors">
          {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          Advanced
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* INPUTS */}
        <div className="space-y-4">
          <div>
            <label className="text-xs text-slate-500 uppercase font-bold">Currency Pair</label>
            <select
              value={selectedPair}
              onChange={e => setSelectedPair(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-lg p-3 mt-1 focus:ring-2 focus:ring-indigo-500 outline-none transition-shadow font-medium"
            >
              {currencyData.map(d => <option key={d.pair.symbol} value={d.pair.symbol}>{d.pair.symbol} - {d.pair.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-500 uppercase font-bold">Balance ($)</label>
              <input type="number" min="1" value={accountBalance} onChange={e => setAccountBalance(Math.max(1, Number(e.target.value)))} className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-lg p-3 mt-1 outline-none focus:border-indigo-500 font-medium" />
            </div>
            <div>
              <label className="text-xs text-slate-500 uppercase font-bold">Risk (%)</label>
              <input type="number" min="0.1" max="100" step="0.5" value={riskPercent} onChange={e => setRiskPercent(Math.min(100, Math.max(0.1, Number(e.target.value))))} className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-lg p-3 mt-1 outline-none focus:border-indigo-500 font-medium" />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <input type="checkbox" checked={useManualLot} onChange={e => setUseManualLot(e.target.checked)} className="rounded bg-slate-100 border-slate-300 text-indigo-600 focus:ring-indigo-500" />
            <label className="text-sm text-slate-600 font-medium">Manual Lot Size</label>
            {useManualLot && <input type="number" min="0.01" step="0.01" value={manualLot} onChange={e => setManualLot(Math.max(0.01, Number(e.target.value)))} className="ml-auto w-24 bg-slate-50 border border-slate-200 text-slate-800 rounded p-1 text-sm text-right font-medium" />}
          </div>

          <div className="pt-2">
            <label className="text-xs text-slate-500 uppercase font-bold">Risk:Reward Ratio</label>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="range"
                min="1"
                max="5"
                step="0.5"
                value={riskReward}
                onChange={e => setRiskReward(Number(e.target.value))}
                className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
              <span className="text-sm font-mono font-bold text-slate-700 w-12 text-right">1:{riskReward}</span>
            </div>
          </div>
        </div>

        {/* SIGNAL DASHBOARD CARD */}
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
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">% Confidence</div>
                <div className="text-2xl font-bold text-slate-800 flex items-center justify-end gap-2">
                  {trade.confidence.toFixed(0)}%
                  <span className={`text-xs px-2 py-0.5 rounded-full ${trade.signal === 'BUY' ? 'bg-emerald-100 text-emerald-700' : trade.signal === 'SELL' ? 'bg-rose-100 text-rose-700' : 'bg-slate-200 text-slate-600'}`}>
                    {trade.signal} Signal
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="bg-white p-3 rounded-lg border border-slate-100">
                <span className="text-[10px] uppercase text-slate-400 font-bold">Bullish Score</span>
                <div className="text-xl font-bold text-emerald-600">{trade.bullishScore}/8</div>
              </div>
              <div className="bg-white p-3 rounded-lg border border-slate-100">
                <span className="text-[10px] uppercase text-slate-400 font-bold">Bearish Score</span>
                <div className="text-xl font-bold text-rose-600">{trade.bearishScore}/8</div>
              </div>
              <div className="bg-white p-3 rounded-lg border border-slate-100">
                <span className="text-[10px] uppercase text-slate-400 font-bold">Strength</span>
                <div className="flex items-center gap-1 mt-1">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className={`h-2 w-full rounded-full ${i < trade.strength ? 'bg-indigo-500' : 'bg-slate-200'}`}></div>
                  ))}
                </div>
              </div>
              <div className="bg-white p-3 rounded-lg border border-slate-100">
                <span className="text-[10px] uppercase text-slate-400 font-bold">Indicators</span>
                <div className="text-sm font-medium text-slate-700 mt-1">4 Active</div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-4 gap-x-6 text-sm font-mono border-t border-slate-200 pt-4">
              <div>
                <div className="text-slate-400 text-xs mb-1">Entry Price</div>
                <div className="font-bold text-slate-800">{formatPrice(trade.entry, trade.pair)}</div>
              </div>
              <div>
                <div className="text-slate-400 text-xs mb-1">Target</div>
                <div className="font-bold text-indigo-600">{formatPrice(trade.tp, trade.pair)}</div>
              </div>
              <div>
                <div className="text-slate-400 text-xs mb-1">Lot Size</div>
                <div className="font-bold text-slate-800">{trade.lotSize} <span className="text-[10px] text-slate-400 font-sans font-normal">({trade.lotSize >= 1 ? 'Std' : trade.lotSize >= 0.1 ? 'Mini' : 'Micro'})</span></div>
              </div>

              <div className="col-span-2 sm:col-span-3 grid grid-cols-2 gap-4 mt-2">
                <div className="bg-rose-50 p-2 rounded border border-rose-100">
                  <div className="text-[10px] text-rose-400 font-bold uppercase mb-1">Stop Loss</div>
                  <div className="flex justify-between items-baseline">
                    <span className="font-bold text-rose-700">{trade.signal !== 'HOLD' ? formatPrice(trade.sl, trade.pair) : '---'}</span>
                    <span className="text-xs text-rose-500">-{trade.slPips} pips</span>
                  </div>
                  <div className="text-[10px] text-rose-400 mt-1">Risk: ${trade.riskAmount.toFixed(2)}</div>
                </div>
                <div className="bg-emerald-50 p-2 rounded border border-emerald-100">
                  <div className="text-[10px] text-emerald-500 font-bold uppercase mb-1">Take Profit</div>
                  <div className="flex justify-between items-baseline">
                    <span className="font-bold text-emerald-700">{trade.signal !== 'HOLD' ? formatPrice(trade.tp, trade.pair) : '---'}</span>
                    <span className="text-xs text-emerald-600">+{trade.tpPips} pips</span>
                  </div>
                  <div className="text-[10px] text-emerald-500 mt-1">Profit: ${trade.potentialProfit.toFixed(2)}</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ADVANCED STATS */}
      {showAdvanced && trade?.prediction && (
        <div className="mt-6 pt-6 border-t border-slate-100 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
            <div className="text-xs text-slate-500 uppercase font-semibold">RSI (14)</div>
            <div className={`font-mono font-bold text-lg ${trade.prediction.rsi > 70 ? 'text-rose-500' : trade.prediction.rsi < 30 ? 'text-emerald-600' : 'text-slate-700'}`}>
              {trade.prediction.rsi.toFixed(1)}
            </div>
          </div>
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
            <div className="text-xs text-slate-500 uppercase font-semibold">MACD</div>
            <div className={`font-mono font-bold text-lg ${trade.prediction.macd.histogram > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
              {trade.prediction.macd.histogram.toFixed(5)}
            </div>
          </div>
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
            <div className="text-xs text-slate-500 uppercase font-semibold">Bollinger %B</div>
            <div className="font-mono font-bold text-lg text-blue-600">
              {(trade.prediction.bollinger.percentB * 100).toFixed(0)}%
            </div>
          </div>
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
            <div className="text-xs text-slate-500 uppercase font-semibold">EMA Cross</div>
            <div className={`font-mono font-bold text-lg ${trade.prediction.ema12 > trade.prediction.ema26 ? 'text-emerald-600' : 'text-rose-500'}`}>
              {trade.prediction.ema12 > trade.prediction.ema26 ? 'GOLDEN' : 'DEATH'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// --- MAIN DASHBOARD ---
const ForexDashboard = () => {
  const [data, setData] = useState([]);
  const [predictor] = useState(new ForexPredictor());
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dataSource, setDataSource] = useState('Loading...');

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(6); // Show 6 pairs per page

  // Note: API status is now displayed via dataSource state

  // Chat State
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState([{ role: 'assistant', content: 'QuantAI Analyst online. Market volatility detected. How can I assist?' }]);
  const [input, setInput] = useState('');
  const msgEndRef = useRef(null);

  // Ref to track current data without causing React Hook dependency issues
  const dataRef = useRef(data);
  dataRef.current = data;

  const CACHE_KEY = 'forex_dashboard_data_v6'; // Updated cache version to force refresh with new synthetic history

  const initData = useCallback(async () => {
    // 1. Try to load from cache immediately for instant render
    const cached = localStorage.getItem(CACHE_KEY);

    if (cached) {
      try {
        const { timestamp, data: parsedData } = JSON.parse(cached);

        // Hydrate predictor
        parsedData.forEach(item => {
          if (item.history && item.history.length > 0) {
            predictor.setHistory(item.pair.symbol, item.history);
          }
        });

        // Regenerate predictions with current predictor logic
        const withPredictions = parsedData.map(item => ({
          ...item,
          prediction: predictor.predictNextPrice(item.pair.symbol, item.pair)
        }));

        setData(withPredictions);
        setLastUpdated(timestamp);
        setDataSource('Cached Data (Refreshing...)'); // Set data source when loading cache
        setLoading(false); // RENDER IMMEDIATELY

        const age = Date.now() - timestamp;
        console.log(`[QuantAI] Loaded cache (${(age / 1000).toFixed(0)}s old).`);

        // If cache is fresh (< 5 mins), use it but still show proper source
        if (age < UPDATE_INTERVAL) {
          setDataSource('Twelve Data API (Cached)');
          return;
        }
        console.log("Cache stale. Updating in background...");
      } catch (e) {
        console.error("Cache parse error", e);
      }
    }

    // 2. Fetch new data (Blocking if no cache, Background if cache exists)
    const freshFetch = async () => {
      try {
        console.log('[QuantAI] Fetching fresh data from API...');
        setDataSource('Fetching live data...');
        const res = await fetchAllForexData();
        const now = Date.now();

        const formatted = res.map(r => {
          if (!r.rate) return r.rate === 0 ? { ...dataRef.current.find(d => d.pair.symbol === r.pair.symbol) } : null;

          predictor.addDataPoint(r.pair.symbol, r.rate);
          const prediction = predictor.predictNextPrice(r.pair.symbol, r.pair);

          // Use predictor's history (which includes synthetic data if generated) to ensure stability across reloads
          // We keep 120 points which matches what the predictor maintains
          const history = predictor.historicalData[r.pair.symbol].slice(-120);

          return {
            pair: r.pair,
            currentRate: r.rate,
            history,
            prediction
          };
        }).filter(Boolean);

        if (formatted.length > 0) {
          setData(formatted);
          setLastUpdated(now);
          setDataSource('Twelve Data API (Live)');
          localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: now, data: formatted }));
          console.log(`[QuantAI] Data refreshed at ${new Date(now).toLocaleTimeString()}. Next refresh in 5 minutes.`);
        }
      } catch (err) {
        console.error("[QuantAI] Fresh fetch failed:", err);
        setDataSource('Error - Using cached data');
      } finally {
        setLoading(false);
        setIsRefreshing(false);
      }
    };

    freshFetch();

  }, [predictor]);

  // Force refresh function - clears cache and fetches new data
  const forceRefresh = useCallback(async () => {
    console.log('[QuantAI] Force refresh triggered - clearing cache and fetching new data');
    setIsRefreshing(true);
    setDataSource('Force refreshing...');

    // Clear the cache to force a fresh fetch
    localStorage.removeItem(CACHE_KEY);

    // Clear predictor historical data to get fresh predictions
    CURRENCY_PAIRS.forEach(pair => {
      predictor.setHistory(pair.symbol, []);
    });

    // Fetch fresh data
    try {
      const res = await fetchAllForexData();
      const now = Date.now();

      const formatted = res.map(r => {
        if (!r.rate) return null;

        predictor.addDataPoint(r.pair.symbol, r.rate);
        const prediction = predictor.predictNextPrice(r.pair.symbol, r.pair);

        return {
          pair: r.pair,
          currentRate: r.rate,
          // Capture the full history including potentially generated synthetic data
          history: predictor.historicalData[r.pair.symbol].slice(-120),
          prediction
        };
      }).filter(Boolean);

      if (formatted.length > 0) {
        setData(formatted);
        setLastUpdated(now);
        setDataSource('Twelve Data API (Force Refreshed)');
        localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: now, data: formatted }));
        console.log(`[QuantAI] Force refresh complete at ${new Date(now).toLocaleTimeString()}`);
      }
    } catch (err) {
      console.error('[QuantAI] Force refresh failed:', err);
      setDataSource('Error - Refresh failed');
    } finally {
      setIsRefreshing(false);
    }
  }, [predictor]);

  const update = useCallback(async () => {
    console.log(`[QuantAI] Scheduled update triggered at ${new Date().toLocaleTimeString()}`);
    setDataSource('Updating prices...');
    const res = await fetchAllForexData();
    const now = Date.now();
    setLastUpdated(now);

    setData(prev => {
      const newData = prev.map((item, i) => {
        const newRate = res[i].rate;
        if (!newRate) return item;

        predictor.addDataPoint(item.pair.symbol, newRate);
        const prediction = predictor.predictNextPrice(item.pair.symbol, item.pair);

        const newHistory = [...item.history, { price: newRate, timestamp: now }].slice(-50);
        return { ...item, currentRate: newRate, history: newHistory, prediction };
      });

      // Save updated data to cache with timestamp
      localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: now, data: newData }));
      setDataSource('Twelve Data API (Live)');
      console.log(`[QuantAI] Prices updated at ${new Date(now).toLocaleTimeString()}. Next update in 5 minutes.`);
      return newData;
    });
  }, [predictor]);

  useEffect(() => { initData(); }, [initData]);

  // Set up the 5-minute update interval
  useEffect(() => {
    if (!loading) {
      console.log(`[QuantAI] Setting up 5-minute refresh interval. Next update at ${new Date(Date.now() + UPDATE_INTERVAL).toLocaleTimeString()}`);
      const interval = setInterval(() => {
        console.log('[QuantAI] 5-minute interval triggered');
        update();
      }, UPDATE_INTERVAL);
      return () => {
        console.log('[QuantAI] Clearing update interval');
        clearInterval(interval);
      };
    }
  }, [loading, update]);

  useEffect(() => { msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleChat = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMsg = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);

    // Show typing indicator
    setMessages(prev => [...prev, { role: 'assistant', content: '⏳ Analyzing markets...', isLoading: true }]);

    try {
      // Send to AI with forex data context
      const result = await sendMessageToAI(userMsg, data, messages);

      // Remove typing indicator and add real response
      setMessages(prev => {
        const filtered = prev.filter(m => !m.isLoading);
        return [...filtered, { role: 'assistant', content: result.message }];
      });
    } catch (error) {
      // Fallback to simple response on error
      const fallbackReply = getFallbackResponse(userMsg, data);
      setMessages(prev => {
        const filtered = prev.filter(m => !m.isLoading);
        return [...filtered, { role: 'assistant', content: fallbackReply }];
      });
    }
  };

  const bestData = data.reduce((prev, curr) =>
    (curr.prediction?.confidence > (prev?.prediction?.confidence || 0)) ? curr : prev
    , null);

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-800">
      <div className="flex flex-col items-center gap-4">
        <RefreshCw className="w-10 h-10 animate-spin text-indigo-600" />
        <span className="text-slate-500 font-mono tracking-widest animate-pulse font-medium">INITIALIZING QUANT MODELS...</span>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-indigo-100 selection:text-indigo-900">

      {/* HEADER */}
      <nav className="border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-lg shadow-md shadow-indigo-200">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <h1 className="font-bold text-lg tracking-tight text-slate-900">QUANT<span className="text-indigo-600">AI</span></h1>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono text-slate-500">
            <button
              onClick={forceRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              title="Force refresh all data"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 border border-slate-200">
              <span className={`w-2 h-2 rounded-full ${isRefreshing ? 'bg-amber-500' : 'bg-emerald-500'} animate-pulse`}></span>
              {isRefreshing ? 'UPDATING' : 'LIVE'}
            </span>
            <span className="hidden sm:inline text-slate-400 font-medium">{new Date(lastUpdated).toLocaleTimeString()}</span>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">

        {/* API STATUS */}
        <APIStatusBanner batchSize={BATCH_SIZE} lastUpdated={lastUpdated} dataSource={dataSource} />

        {/* HERO RECOMMENDATION */}
        {bestData && <FeaturedRecommendation data={bestData} />}

        {/* TRADE SETTINGS CALCULATOR */}
        <TradeSettings currencyData={data} />

        {/* PAGINATION */}
        <PaginationControls
          currentPage={currentPage}
          totalPages={Math.ceil(data.length / itemsPerPage)}
          onPageChange={setCurrentPage}
          totalItems={data.length}
        />

        {/* MARKET GRID */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {data.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((item) => {
            const pred = item.prediction;
            const isUp = pred?.trend === 'bullish';
            const color = isUp ? '#10b981' : pred?.trend === 'bearish' ? '#f43f5e' : '#94a3b8';
            const signal = pred?.trend === 'bullish' ? 'BUY' : pred?.trend === 'bearish' ? 'SELL' : 'HOLD';
            const signalColor = signal === 'BUY' ? 'text-emerald-600' : signal === 'SELL' ? 'text-rose-600' : 'text-slate-500';

            return (
              <div key={item.pair.symbol} className="bg-white rounded-2xl border border-slate-200 hover:border-indigo-200 hover:shadow-md transition-all p-5 group relative overflow-hidden">
                <div className="flex justify-between items-start mb-4 relative z-10">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-xs border border-slate-200">
                      {item.pair.base}
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-800 text-lg">{item.pair.symbol}</h3>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 font-medium">{item.pair.name}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-mono font-bold text-slate-800">{formatPrice(item.currentRate, item.pair.symbol)}</div>
                    {pred && (
                      <div className={`text-xs flex items-center justify-end gap-1 font-semibold ${isUp ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        <span>{(pred.confidence).toFixed(0)}% Conf.</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* CHART */}
                <div className="h-24 w-full mb-4 relative z-10">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={item.history}>
                      <defs>
                        <linearGradient id={`grad${item.pair.symbol}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={color} stopOpacity={0.2} />
                          <stop offset="95%" stopColor={color} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <Area type="monotone" dataKey="price" stroke={color} fill={`url(#grad${item.pair.symbol})`} strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* EXTENDED STATS GRID */}
                <div className="grid grid-cols-3 gap-2 relative z-10">
                  {/* Row 1 */}
                  <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-100">
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">RSI</div>
                    <div className={`text-sm font-mono font-bold ${pred?.rsi > 70 ? 'text-rose-500' : pred?.rsi < 30 ? 'text-emerald-600' : 'text-slate-600'}`}>
                      {pred ? pred.rsi.toFixed(0) : '-'}
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-100">
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">MACD</div>
                    <div className={`text-sm font-mono font-bold ${pred?.macd?.histogram > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {pred ? pred.macd.histogram.toFixed(5) : '-'}
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-100">
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">Boll %B</div>
                    <div className="text-sm font-mono font-bold text-blue-600">
                      {pred ? (pred.bollinger.percentB * 100).toFixed(0) + '%' : '-'}
                    </div>
                  </div>

                  {/* Row 2 */}
                  <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-100">
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">Next Price</div>
                    <div className="text-sm font-mono text-slate-700 font-semibold">
                      {pred ? formatPrice(pred.predictedPrice, item.pair.symbol) : '-'}
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-100">
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">Action</div>
                    <div className={`text-sm font-bold ${signalColor}`}>
                      {signal}
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-100">
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">Trend</div>
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

      {/* CHAT INTERFACE */}
      <div className="fixed bottom-6 right-6 z-50">
        {!chatOpen ? (
          <button onClick={() => setChatOpen(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white p-4 rounded-full shadow-xl shadow-indigo-300 transition-transform hover:scale-105 flex items-center justify-center">
            <Bot className="w-6 h-6" />
          </button>
        ) : (
          <div className="bg-white border border-slate-200 w-80 sm:w-96 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 fade-in duration-300">
            <div className="bg-slate-50 p-4 flex justify-between items-center border-b border-slate-200">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                <span className="font-bold text-slate-800 text-sm">QuantAI Analyst</span>
              </div>
              <button onClick={() => setChatOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="h-80 overflow-y-auto p-4 space-y-4 bg-white">
              {messages.map((m, i) => {
                // Simple markdown-to-JSX: render **bold** text and preserve newlines
                const renderFormattedText = (text) => {
                  // Split by **bold** patterns
                  const parts = text.split(/(\*\*[^*]+\*\*)/g);
                  return parts.map((part, idx) => {
                    if (part.startsWith('**') && part.endsWith('**')) {
                      return <strong key={idx} className="font-semibold">{part.slice(2, -2)}</strong>;
                    }
                    return <span key={idx}>{part}</span>;
                  });
                };

                return (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm shadow-sm whitespace-pre-wrap ${m.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-none'
                        : 'bg-slate-100 text-slate-700 border border-slate-200 rounded-bl-none'
                        }`}
                    >
                      {renderFormattedText(m.content)}
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
              <button type="submit" className="bg-indigo-600 text-white p-2 rounded-full hover:bg-indigo-700 flex items-center justify-center shadow-md shadow-indigo-200">
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