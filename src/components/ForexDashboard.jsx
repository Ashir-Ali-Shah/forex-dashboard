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
  Clock, 
  Wifi, 
  ChevronDown, 
  ChevronUp, 
  Target, 
  X,
  Send,
  Bot,
  Shield,
  Crosshair,
  Calculator,
  Zap,
  ArrowUp,
  ArrowDown,
  MinusCircle,
  BarChart2,
  AlertTriangle,
  Layers,
  Info
} from 'lucide-react';

// --- CONFIGURATION ---
const CURRENCY_PAIRS = [
  { symbol: 'XAUUSD', base: 'XAU', quote: 'USD', name: 'Gold/USD', type: 'commodity', pipValue: 0.1, pipDigits: 2 },
  { symbol: 'EURUSD', base: 'EUR', quote: 'USD', name: 'EUR/USD', type: 'major', pipValue: 0.0001, pipDigits: 5 },
  { symbol: 'GBPUSD', base: 'GBP', quote: 'USD', name: 'GBP/USD', type: 'major', pipValue: 0.0001, pipDigits: 5 },
  { symbol: 'USDCAD', base: 'USD', quote: 'CAD', name: 'USD/CAD', type: 'major', pipValue: 0.0001, pipDigits: 5 },
  { symbol: 'USDJPY', base: 'USD', quote: 'JPY', name: 'USD/JPY', type: 'major', pipValue: 0.01, pipDigits: 3 },
  { symbol: 'USDCHF', base: 'USD', quote: 'CHF', name: 'USD/CHF', type: 'major', pipValue: 0.0001, pipDigits: 5 },
  { symbol: 'AUDUSD', base: 'AUD', quote: 'USD', name: 'AUD/USD', type: 'major', pipValue: 0.0001, pipDigits: 5 },
  { symbol: 'AUDJPY', base: 'AUD', quote: 'JPY', name: 'AUD/JPY', type: 'cross', pipValue: 0.01, pipDigits: 3 },
];

// --- UTILS ---
const formatPrice = (price, symbol) => {
  if (!price) return '---';
  const pair = CURRENCY_PAIRS.find(p => p.symbol === symbol);
  return price.toFixed(pair ? pair.pipDigits : 4);
};

// --- DATA FETCHING ---
const fetchRealForexData = async (pair) => {
  try {
    // 1. Gold Specific Logic
    if (pair.base === 'XAU') {
      try {
        const response = await fetch('https://api.metals.live/v1/spot/gold');
        const data = await response.json();
        if (data && data[0]?.price) return parseFloat(data[0].price);
      } catch (err) {}
      
      try {
        const response = await fetch('https://data-asg.goldprice.org/dbXRates/USD');
        const data = await response.json();
        if (data?.items?.[0]?.xauPrice) return parseFloat(data.items[0].xauPrice);
      } catch (err) {}
      
      return null;
    }
    
    // 2. Forex Logic
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

const fetchAllForexData = async () => {
  const results = await Promise.all(
    CURRENCY_PAIRS.map(async (pair) => {
      const rate = await fetchRealForexData(pair);
      return { pair, rate };
    })
  );
  return results;
};

// --- LOGIC: LINEAR REGRESSION ---
class LinearRegressionModel {
  constructor() {
    this.slope = 0; this.intercept = 0; this.rSquared = 0; this.dataPoints = [];
  }

  fit(data) {
    if (data.length < 5) return this;
    // Use smoothed data for regression to reduce noise flipping
    this.dataPoints = data.map((point, index) => ({ x: index, y: point.price }));
    const n = this.dataPoints.length;
    const x = this.dataPoints.map(p => p.x);
    const y = this.dataPoints.map(p => p.y);
    
    const meanX = x.reduce((a, b) => a + b, 0) / n;
    const meanY = y.reduce((a, b) => a + b, 0) / n;
    
    const numerator = x.reduce((acc, xi, i) => acc + (xi - meanX) * (y[i] - meanY), 0);
    const denominator = x.reduce((acc, xi) => acc + Math.pow(xi - meanX, 2), 0);
    
    this.slope = denominator !== 0 ? numerator / denominator : 0;
    this.intercept = meanY - this.slope * meanX;
    
    // R-Squared
    const ssTot = y.reduce((acc, yi) => acc + Math.pow(yi - meanY, 2), 0);
    const ssRes = y.reduce((acc, yi, i) => {
      const predicted = this.slope * x[i] + this.intercept;
      return acc + Math.pow(yi - predicted, 2);
    }, 0);
    
    this.rSquared = ssTot !== 0 ? 1 - (ssRes / ssTot) : 0;
    return this;
  }

  predict(steps = 1) {
    const nextX = this.dataPoints.length + steps - 1;
    const prediction = this.slope * nextX + this.intercept;
    return {
      prediction,
      confidence: Math.max(0, Math.min(100, this.rSquared * 100))
    };
  }
}

// --- LOGIC: ADVANCED PREDICTOR ---
class ForexPredictor {
  constructor() {
    this.historicalData = {};
    this.linearModels = {};
    this.emaValues = {};
  }

  addDataPoint(symbol, price) {
    if (!this.historicalData[symbol]) this.historicalData[symbol] = [];
    this.historicalData[symbol].push({ price, timestamp: Date.now() });
    if (this.historicalData[symbol].length > 100) this.historicalData[symbol].shift();
    
    if (this.historicalData[symbol].length >= 10) {
      if (!this.linearModels[symbol]) this.linearModels[symbol] = new LinearRegressionModel();
      this.linearModels[symbol].fit(this.historicalData[symbol]);
    }
  }

  calculateSMA(data, period) {
    if (data.length < period) return null;
    return data.slice(-period).reduce((sum, item) => sum + item.price, 0) / period;
  }

  calculateEMA(data, period, symbol) {
    if (data.length === 0) return null;
    if (!this.emaValues[symbol]) this.emaValues[symbol] = {};
    const multiplier = 2 / (period + 1);
    const currentPrice = data[data.length - 1].price;
    
    if (!this.emaValues[symbol][period]) {
        this.emaValues[symbol][period] = this.calculateSMA(data, Math.min(period, data.length)) || currentPrice;
    } else {
        this.emaValues[symbol][period] = (currentPrice * multiplier) + (this.emaValues[symbol][period] * (1 - multiplier));
    }
    return this.emaValues[symbol][period];
  }

  calculateRSI(data, period = 14) {
    if (data.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = data.length - period; i < data.length; i++) {
      const diff = data[i].price - data[i-1].price;
      if (diff >= 0) gains += diff; else losses -= diff;
    }
    const rs = losses === 0 ? 100 : gains / losses;
    return 100 - (100 / (1 + rs));
  }

  calculateMACD(data, fast=12, slow=26, signal=9, symbol) {
    if (data.length < slow) return { macd: 0, signal: 0, histogram: 0 };
    const fastEMA = this.calculateEMA(data, fast, symbol + '_f');
    const slowEMA = this.calculateEMA(data, slow, symbol + '_s');
    const macdLine = fastEMA - slowEMA;
    
    if (!this.emaValues[symbol + '_sig']) this.emaValues[symbol + '_sig'] = macdLine;
    const sigMult = 2 / (signal + 1);
    this.emaValues[symbol + '_sig'] = (macdLine * sigMult) + (this.emaValues[symbol + '_sig'] * (1 - sigMult));
    
    return { macd: macdLine, signal: this.emaValues[symbol + '_sig'], histogram: macdLine - this.emaValues[symbol + '_sig'] };
  }

  calculateBollinger(data, period=20, mult=2) {
    if (data.length < period) return { percentB: 0.5, bandwidth: 0 };
    const sma = this.calculateSMA(data, period);
    const sqDiffs = data.slice(-period).map(d => Math.pow(d.price - sma, 2));
    const stdDev = Math.sqrt(sqDiffs.reduce((a,b)=>a+b,0)/period);
    const upper = sma + (stdDev * mult);
    const lower = sma - (stdDev * mult);
    return { 
        percentB: (data[data.length-1].price - lower) / (upper - lower),
        bandwidth: (upper - lower) / sma 
    };
  }

  calculateATR(data, period=14) {
      if(data.length < 2) return 0;
      const trs = data.slice(-period).map((d, i, arr) => {
          if(i===0) return 0;
          return Math.abs(d.price - arr[i-1].price);
      });
      return trs.reduce((a,b)=>a+b,0) / trs.length;
  }

  predictNextPrice(symbol) {
    const data = this.historicalData[symbol];
    if (!data || data.length < 15) return null;

    const linearModel = this.linearModels[symbol];
    const linearRes = linearModel ? linearModel.predict(1) : { prediction: data[data.length-1].price, confidence: 0 };
    
    // Indicators
    const rsi = this.calculateRSI(data);
    const macd = this.calculateMACD(data, 12, 26, 9, symbol);
    const bb = this.calculateBollinger(data);
    const ema12 = this.calculateEMA(data, 12, symbol);
    const ema26 = this.calculateEMA(data, 26, symbol);
    const atr = this.calculateATR(data);
    
    // --- STABILIZED SCORING LOGIC ---
    let score = 0; 
    
    // 1. Trend Filter (EMA Cross) - Strongest Weight
    const trendBullish = ema12 > ema26;
    if (trendBullish) score += 3; else score -= 3;

    // 2. Momentum Confirmation (MACD)
    if (macd.histogram > 0) score += 2; else score -= 2;

    // 3. Oscillator Filter (RSI) - only trade against trend if extreme
    if (trendBullish) {
        if (rsi < 30) score += 2; // Buy dip
        else if (rsi > 80) score -= 1; // Caution
        else score += 1; // Trend continuation
    } else {
        if (rsi > 70) score -= 2; // Sell rally
        else if (rsi < 20) score += 1; // Caution
        else score -= 1; // Trend continuation
    }

    // 4. Linear Regression Slope Confirmation
    if (linearModel && Math.abs(linearModel.slope) > 0.00005) {
        if(linearModel.slope > 0) score += 2; else score -= 2;
    }

    // Normalize Confidence (0 to 100)
    // Max theoretical score is approx 8.
    let confidence = Math.min(99, Math.max(10, (Math.abs(score) / 8) * 100));
    
    // --- HYSTERESIS / THRESHOLDING ---
    // Only flip signal if confidence is high.
    // If score is weak (-2 to 2), force Neutral.
    let trend = 'neutral';
    if (score > 2.5) trend = 'bullish';
    else if (score < -2.5) trend = 'bearish';

    // Technical Adjustment to Linear Prediction based on ATR
    let predictedPrice = linearRes.prediction;
    const volatilityFactor = atr * 0.5;
    if(trend === 'bullish') predictedPrice += volatilityFactor;
    else if(trend === 'bearish') predictedPrice -= volatilityFactor;

    return {
        predictedPrice,
        confidence,
        trend,
        rsi,
        macd,
        bollinger: bb,
        atr,
        ema12,
        ema26,
        linearModel,
        linearPrediction: linearRes.prediction,
        score // Debugging/Internal use
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
            <div className="mt-2 text-slate-600 text-sm text-center font-medium">Score: {(prediction.confidence/10).toFixed(1)}/10</div>
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
  const [accountBalance, setAccountBalance] = useState(10000);
  const [selectedPair, setSelectedPair] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [useManualLot, setUseManualLot] = useState(false);
  const [manualLot, setManualLot] = useState(0.01);

  // Auto-select best pair
  useEffect(() => {
    if(!selectedPair) {
        const best = currencyData.reduce((prev, curr) => 
            (curr.prediction?.confidence > (prev?.prediction?.confidence || 0)) ? curr : prev
        , {});
        if(best.pair) setSelectedPair(best.pair.symbol);
    }
  }, [currencyData, selectedPair]);

  const generateTradeSignal = () => {
    const data = currencyData.find(d => d.pair.symbol === selectedPair);
    if (!data?.prediction) return null;

    const { prediction, currentRate, pair } = data;
    
    // Stabilized signal display
    let signal = 'HOLD';
    if (prediction.trend === 'bullish') signal = 'BUY';
    else if (prediction.trend === 'bearish') signal = 'SELL';

    const isBullish = signal === 'BUY';
    const isBearish = signal === 'SELL';
    
    // Safe Calculation logic
    const atr = prediction.atr || currentRate * 0.002;
    // Enforce minimum stop loss (approx 15 pips equivalent for majors)
    const minSL = pair.pipValue * 15;
    const slDist = Math.max(minSL, atr * 2);
    
    // Calculate Levels
    const sl = isBullish ? currentRate - slDist : isBearish ? currentRate + slDist : 0;
    // Ensure TP is always profitable relative to entry (Spread simulation added)
    const spreadBuffer = pair.pipValue * 2; 
    const tpDist = slDist * riskReward;
    const tp = isBullish ? currentRate + tpDist + spreadBuffer : isBearish ? currentRate - tpDist - spreadBuffer : 0;
    
    const riskAmount = accountBalance * (riskPercent / 100);
    // Lot Size Calc
    const pipsRisk = slDist / pair.pipValue;
    const lotSizeRaw = riskAmount / (pipsRisk * 10);
    const lotSize = useManualLot ? manualLot : Math.min(50, Math.max(0.01, parseFloat(lotSizeRaw.toFixed(2))));
    
    const potentialProfit = riskAmount * riskReward;

    // Calculate Scores for detailed view
    let bullishScore = 0;
    let bearishScore = 0;
    
    // Deconstruct score from prediction (approximate reconstruction for UI)
    const emaBullish = prediction.ema12 > prediction.ema26;
    if(emaBullish) bullishScore += 3; else bearishScore += 3;
    
    if(prediction.macd.histogram > 0) bullishScore += 2; else bearishScore += 2;
    
    if(prediction.rsi < 30) bullishScore += 2;
    if(prediction.rsi > 70) bearishScore += 2;
    if(prediction.rsi >= 30 && prediction.rsi <= 70) {
        if(emaBullish) bullishScore += 1; else bearishScore += 1;
    }
    
    // Strength (1-5)
    const totalScore = bullishScore + bearishScore;
    const strength = Math.min(5, Math.ceil((Math.max(bullishScore, bearishScore) / 8) * 5));

    return {
        pair: pair.symbol,
        signal,
        entry: currentRate,
        sl, tp, lotSize, riskAmount, potentialProfit, 
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
           <Calculator className="w-5 h-5 text-indigo-600"/>
           Trade Calculator & Execution
        </h2>
        <button onClick={()=>setShowAdvanced(!showAdvanced)} className="text-sm text-slate-500 hover:text-indigo-600 flex items-center gap-1 font-medium transition-colors">
           {showAdvanced ? <ChevronUp className="w-4 h-4"/> : <ChevronDown className="w-4 h-4"/>}
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
                 onChange={e=>setSelectedPair(e.target.value)}
                 className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-lg p-3 mt-1 focus:ring-2 focus:ring-indigo-500 outline-none transition-shadow font-medium"
               >
                 {currencyData.map(d => <option key={d.pair.symbol} value={d.pair.symbol}>{d.pair.symbol} - {d.pair.name}</option>)}
               </select>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
                <div>
                   <label className="text-xs text-slate-500 uppercase font-bold">Balance ($)</label>
                   <input type="number" value={accountBalance} onChange={e=>setAccountBalance(Number(e.target.value))} className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-lg p-3 mt-1 outline-none focus:border-indigo-500 font-medium"/>
                </div>
                <div>
                   <label className="text-xs text-slate-500 uppercase font-bold">Risk (%)</label>
                   <input type="number" step="0.5" value={riskPercent} onChange={e=>setRiskPercent(Number(e.target.value))} className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-lg p-3 mt-1 outline-none focus:border-indigo-500 font-medium"/>
                </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
                <input type="checkbox" checked={useManualLot} onChange={e=>setUseManualLot(e.target.checked)} className="rounded bg-slate-100 border-slate-300 text-indigo-600 focus:ring-indigo-500"/>
                <label className="text-sm text-slate-600 font-medium">Manual Lot Size</label>
                {useManualLot && <input type="number" step="0.01" value={manualLot} onChange={e=>setManualLot(Number(e.target.value))} className="ml-auto w-24 bg-slate-50 border border-slate-200 text-slate-800 rounded p-1 text-sm text-right font-medium"/>}
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
  
  // Chat State
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState([{role: 'assistant', content: 'QuantAI Analyst online. Market volatility detected. How can I assist?'}]);
  const [input, setInput] = useState('');
  const msgEndRef = useRef(null);

  const initData = useCallback(async () => {
    const res = await fetchAllForexData();
    const formatted = res.map(r => ({
      pair: r.pair,
      currentRate: r.rate || 0,
      history: r.rate ? [{price: r.rate, timestamp: Date.now()}] : [],
      prediction: null
    }));
    // Pre-seed some data removed as per request for pure real API data on start
    setData(formatted);
    setLoading(false);
  }, [predictor]);

  const update = useCallback(async () => {
    const res = await fetchAllForexData();
    setLastUpdated(Date.now());
    setData(prev => prev.map((item, i) => {
      const newRate = res[i].rate;
      if (!newRate) return item;
      
      predictor.addDataPoint(item.pair.symbol, newRate);
      const prediction = predictor.predictNextPrice(item.pair.symbol);
      
      const newHistory = [...item.history, {price: newRate, timestamp: Date.now()}].slice(-50);
      return { ...item, currentRate: newRate, history: newHistory, prediction };
    }));
  }, [predictor]);

  useEffect(() => { initData(); }, [initData]);
  useEffect(() => {
    if(!loading) {
      const interval = setInterval(update, 5000);
      return () => clearInterval(interval);
    }
  }, [loading, update]);

  useEffect(() => { msgEndRef.current?.scrollIntoView({behavior:'smooth'}); }, [messages]);

  const handleChat = (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    const userMsg = input;
    setInput('');
    setMessages(p => [...p, { role: 'user', content: userMsg }]);

    // Access current data state inside the timeout by using a ref or relying on closure if data is fresh
    // Since handleChat is recreated on render with new 'data', this closure works.
    setTimeout(() => {
        const up = userMsg.toUpperCase();
        let reply = "I'm analyzing the latest market ticks...";
        
        // Helper to format a pair recommendation
        const formatRec = (d) => {
            const p = d.prediction;
            const action = p.trend === 'bullish' ? 'BUY' : 'SELL';
            return `${d.pair.symbol} is a strong ${action} (Conf: ${p.confidence.toFixed(0)}%). RSI: ${p.rsi.toFixed(1)}. Target: ${formatPrice(p.predictedPrice, d.pair.symbol)}.`;
        };

        // Filter valid predictions
        const validData = data.filter(d => d.prediction && d.prediction.confidence > 0);

        // 1. EDUCATIONAL / DEFINITIONS
        if (up.includes('WHAT IS') || up.includes('MEAN') || up.includes('DEFINE') || up.includes('EXPLAIN')) {
            if (up.includes('RSI')) {
                reply = "RSI (Relative Strength Index) measures the speed and change of price movements. Values above 70 indicate an asset is 'Overbought' (potential sell), while values below 30 indicate 'Oversold' (potential buy). In this dashboard, it acts as a momentum filter.";
            } else if (up.includes('MACD')) {
                reply = "MACD (Moving Average Convergence Divergence) follows trends and momentum. We look for the histogram to be positive (bullish) or negative (bearish) to confirm the trend direction suggested by EMAs.";
            } else if (up.includes('BOLLINGER') || up.includes('BANDS')) {
                reply = "Bollinger Bands measure volatility. When price touches the upper band, it may be overextended. We use the %B indicator here to see where price is relative to the bands (0=Lower, 1=Upper).";
            } else if (up.includes('CONFIDENCE')) {
                reply = "Confidence is my internal score (0-100%) calculated by weighting multiple indicators: Trend (EMA), Momentum (MACD), Volatility (ATR), and Strength (RSI). A score > 60% triggers a trade signal.";
            } else if (up.includes('LINEAR') || up.includes('REGRESSION')) {
                reply = "Linear Regression fits a straight line through recent prices to determine the core trend direction (slope). It helps filter out noise and confirms if the overall path is up or down.";
            } else if (up.includes('TARGET') || up.includes('TP') || up.includes('TAKE PROFIT')) {
                reply = "'Target' or 'Take Profit' (TP) is the price level where a trader intends to close an open position for a profit. In this dashboard, targets are calculated dynamically based on recent volatility (ATR) and risk-to-reward ratios.";
            } else if (up.includes('STOP') || up.includes('SL') || up.includes('LOSS')) {
                reply = "'Stop Loss' (SL) is a price level placed to limit potential losses on an open position. If the market moves against you to this point, the trade is closed automatically to protect your capital.";
            } else {
                reply = "I can explain technical terms like RSI, MACD, Bollinger Bands, Confidence, Targets, or Stop Losses. Just ask 'What is [Term]?'.";
            }
        }
        else if (validData.length === 0) {
             setMessages(p => [...p, { role: 'assistant', content: "I'm still gathering data to generate reliable signals. Please wait a few moments for the feed to stabilize." }]);
             return;
        }
        // INTENT: BUY
        else if (up.includes('BUY') && !up.includes('SELL')) {
            const bestBuy = validData
                .filter(d => d.prediction.trend === 'bullish')
                .reduce((prev, curr) => (curr.prediction.confidence > (prev?.prediction?.confidence || 0) ? curr : prev), null);
            
            if (bestBuy) {
                reply = `Based on current metrics, the best BUY setup is ${bestBuy.pair.name}. ${formatRec(bestBuy)}`;
            } else {
                reply = "Currently, I don't see any high-confidence BUY signals. Markets appear bearish or neutral. Consider waiting or looking for short opportunities.";
            }
        }
        // INTENT: SELL
        else if (up.includes('SELL') && !up.includes('BUY')) {
            const bestSell = validData
                .filter(d => d.prediction.trend === 'bearish')
                .reduce((prev, curr) => (curr.prediction.confidence > (prev?.prediction?.confidence || 0) ? curr : prev), null);
            
            if (bestSell) {
                reply = `Based on bearish momentum, the best SELL setup is ${bestSell.pair.name}. ${formatRec(bestSell)}`;
            } else {
                reply = "I don't see any strong SELL signals right now. The market might be trending up or consolidating.";
            }
        }
        // INTENT: GENERAL RECOMMENDATION / BEST
        else if (up.includes('RECOMMEND') || up.includes('BEST') || up.includes('TRADE') || up.includes('WHAT') || up.includes('WHICH')) {
            const best = validData.reduce((prev, curr) => (curr.prediction.confidence > (prev?.prediction?.confidence || 0) ? curr : prev), null);
            if (best) {
                reply = `The highest probability trade right now is ${best.pair.symbol}. ${formatRec(best)}`;
            } else {
                reply = "Market volatility is low. No clear signals detected yet.";
            }
        }
        // INTENT: SPECIFIC PAIR
        else {
             // Check for specific pair mention
            const mentionedPair = data.find(d => 
                up.includes(d.pair.base) || 
                up.includes(d.pair.symbol) || 
                (up.includes('GOLD') && d.pair.base === 'XAU')
            );

            if (mentionedPair && mentionedPair.prediction) {
                const p = mentionedPair.prediction;
                reply = `${mentionedPair.pair.name} Analysis:
                • Price: ${formatPrice(mentionedPair.currentRate, mentionedPair.pair.symbol)}
                • Trend: ${p.trend.toUpperCase()}
                • Confidence: ${p.confidence.toFixed(0)}%
                • RSI: ${p.rsi.toFixed(1)}
                • Next Target: ${formatPrice(p.predictedPrice, mentionedPair.pair.symbol)}`;
            } else if (up.includes('RISK') || up.includes('LOT')) {
                reply = "I suggest sticking to the 1% rule. Use the Calculator above to size your positions based on the live Stop Loss levels provided.";
            } else {
                reply = "I can help you analyze specific pairs (e.g., 'Analyze Gold') or find the best Buy/Sell setups based on live RSI and Regression metrics. What do you need?";
            }
        }

        setMessages(p => [...p, { role: 'assistant', content: reply }]);
    }, 800);
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
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 border border-slate-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              SOCKET_CONNECTED
            </span>
            <span className="hidden sm:inline text-slate-400 font-medium">{new Date(lastUpdated).toLocaleTimeString()}</span>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        
        {/* HERO RECOMMENDATION */}
        {bestData && <FeaturedRecommendation data={bestData} />}

        {/* TRADE SETTINGS CALCULATOR */}
        <TradeSettings currencyData={data} />

        {/* MARKET GRID */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {data.map((item) => {
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
                           {isUp ? <TrendingUp className="w-3 h-3"/> : <TrendingDown className="w-3 h-3"/>}
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
                            <stop offset="5%" stopColor={color} stopOpacity={0.2}/>
                            <stop offset="95%" stopColor={color} stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <Area type="monotone" dataKey="price" stroke={color} fill={`url(#grad${item.pair.symbol})`} strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  {/* MINI STATS */}
                  <div className="grid grid-cols-3 gap-2 relative z-10">
                     <div className="bg-slate-50 rounded-lg p-2 text-center border border-slate-100">
                        <div className="text-[10px] text-slate-400 uppercase font-semibold">RSI</div>
                        <div className={`text-sm font-mono font-bold ${pred?.rsi > 70 ? 'text-rose-500' : pred?.rsi < 30 ? 'text-emerald-600' : 'text-slate-600'}`}>
                           {pred ? pred.rsi.toFixed(0) : '-'}
                        </div>
                     </div>
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
               <button onClick={() => setChatOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4"/></button>
             </div>
             <div className="h-80 overflow-y-auto p-4 space-y-4 bg-white">
               {messages.map((m, i) => (
                 <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                   <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm shadow-sm ${m.role === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-slate-100 text-slate-700 border border-slate-200 rounded-bl-none'}`}>
                     {m.content}
                   </div>
                 </div>
               ))}
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
