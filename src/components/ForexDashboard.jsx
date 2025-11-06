import React, { useState, useEffect, useCallback } from 'react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  ComposedChart
} from 'recharts';
import { 
  TrendingUp, 
  TrendingDown,
  Activity, 
  BarChart3, 
  DollarSign,
  RefreshCw,
  AlertCircle,
  Brain,
  Clock,
  Minus,
  Wifi,
  Calculator,
  ArrowUp,
  ArrowDown,
  Eye,
  EyeOff,
  Globe,
  ChevronDown,
  ChevronUp,
  Settings,
  Target,
  AlertTriangle,
  Layers,
  WifiOff,
  TrendingFlat,
  Zap,
  BarChart2
} from 'lucide-react';

const CURRENCY_PAIRS = [
  { symbol: 'XAUUSD', base: 'XAU', quote: 'USD', name: 'Gold/USD', type: 'commodity', pipValue: 0.1, pipDigits: 2 },
  { symbol: 'EURUSD', base: 'EUR', quote: 'USD', name: 'EUR/USD', type: 'major', pipValue: 0.0001, pipDigits: 5 },
  { symbol: 'GBPUSD', base: 'GBP', quote: 'USD', name: 'GBP/USD', type: 'major', pipValue: 0.0001, pipDigits: 5 },
  { symbol: 'USDCAD', base: 'USD', quote: 'CAD', name: 'USD/CAD', type: 'major', pipValue: 0.0001, pipDigits: 5 },
  { symbol: 'USDCHF', base: 'USD', quote: 'CHF', name: 'USD/CHF', type: 'major', pipValue: 0.0001, pipDigits: 5 },
  { symbol: 'USDJPY', base: 'USD', quote: 'JPY', name: 'USD/JPY', type: 'major', pipValue: 0.01, pipDigits: 3 },
  { symbol: 'AUDCAD', base: 'AUD', quote: 'CAD', name: 'AUD/CAD', type: 'cross', pipValue: 0.0001, pipDigits: 5 },
  { symbol: 'AUDCHF', base: 'AUD', quote: 'CHF', name: 'AUD/CHF', type: 'cross', pipValue: 0.0001, pipDigits: 5 },
  { symbol: 'AUDJPY', base: 'AUD', quote: 'JPY', name: 'AUD/JPY', type: 'cross', pipValue: 0.01, pipDigits: 3 },
  { symbol: 'AUDNZD', base: 'AUD', quote: 'NZD', name: 'AUD/NZD', type: 'cross', pipValue: 0.0001, pipDigits: 5 }
];

const getMomentumDirection = (momentum) => {
  if (momentum > 0.001) return { direction: 'Strong Up', color: 'text-emerald-600', icon: TrendingUp };
  if (momentum > 0) return { direction: 'Up', color: 'text-green-500', icon: TrendingUp };
  if (momentum < -0.001) return { direction: 'Strong Down', color: 'text-red-600', icon: TrendingDown };
  if (momentum < 0) return { direction: 'Down', color: 'text-red-500', icon: TrendingDown };
  return { direction: 'Flat', color: 'text-slate-500', icon: Minus };
};

const fetchRealForexData = async (pair) => {
  try {
    if (pair.base === 'XAU') {
      try {
        const response = await fetch('https://api.metals.live/v1/spot/gold');
        const data = await response.json();
        if (data && data[0]?.price) {
          return parseFloat(data[0].price);
        }
      } catch (err) {
        console.log('Gold API attempt 1 failed');
      }
      
      try {
        const response = await fetch('https://data-asg.goldprice.org/dbXRates/USD');
        const data = await response.json();
        if (data?.items?.[0]?.xauPrice) {
          return parseFloat(data.items[0].xauPrice);
        }
      } catch (err) {
        console.log('Gold API attempt 2 failed');
      }
      
      return null;
    }
    
    const apis = [
      async () => {
        const response = await fetch(`https://api.frankfurter.app/latest?from=${pair.base}&to=${pair.quote}`);
        const data = await response.json();
        return data.rates?.[pair.quote];
      },
      async () => {
        const response = await fetch(`https://api.exchangerate-api.com/v4/latest/${pair.base}`);
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
    console.error(`Error fetching ${pair.symbol}:`, error);
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

class LinearRegressionModel {
  constructor() {
    this.slope = 0;
    this.intercept = 0;
    this.rSquared = 0;
    this.standardError = 0;
    this.dataPoints = [];
  }

  fit(data) {
    if (data.length < 2) return this;
    
    this.dataPoints = data.map((point, index) => ({
      x: index,
      y: point.price,
      timestamp: point.timestamp
    }));

    const n = this.dataPoints.length;
    const x = this.dataPoints.map(p => p.x);
    const y = this.dataPoints.map(p => p.y);
    
    const meanX = x.reduce((a, b) => a + b, 0) / n;
    const meanY = y.reduce((a, b) => a + b, 0) / n;
    
    const numerator = x.reduce((acc, xi, i) => acc + (xi - meanX) * (y[i] - meanY), 0);
    const denominator = x.reduce((acc, xi) => acc + Math.pow(xi - meanX, 2), 0);
    
    this.slope = denominator !== 0 ? numerator / denominator : 0;
    this.intercept = meanY - this.slope * meanX;
    
    const totalSumSquares = y.reduce((acc, yi) => acc + Math.pow(yi - meanY, 2), 0);
    const residualSumSquares = y.reduce((acc, yi, i) => {
      const predicted = this.slope * x[i] + this.intercept;
      return acc + Math.pow(yi - predicted, 2);
    }, 0);
    
    this.rSquared = totalSumSquares !== 0 ? 1 - (residualSumSquares / totalSumSquares) : 0;
    this.standardError = Math.sqrt(residualSumSquares / Math.max(n - 2, 1));
    
    return this;
  }

  predict(steps = 1) {
    const nextX = this.dataPoints.length + steps - 1;
    const prediction = this.slope * nextX + this.intercept;
    
    const t_value = 1.96;
    const margin = t_value * this.standardError;
    
    return {
      prediction: prediction,
      upperBound: prediction + margin,
      lowerBound: prediction - margin,
      confidence: Math.max(0, Math.min(100, this.rSquared * 100))
    };
  }

  getTrendDirection() {
    if (this.slope > 0.0001) return 'bullish';
    if (this.slope < -0.0001) return 'bearish';
    return 'neutral';
  }

  getModelQuality() {
    if (this.rSquared > 0.8) return { quality: 'Excellent', color: 'text-emerald-600', bgColor: 'bg-emerald-50' };
    if (this.rSquared > 0.6) return { quality: 'Good', color: 'text-blue-600', bgColor: 'bg-blue-50' };
    if (this.rSquared > 0.4) return { quality: 'Fair', color: 'text-amber-600', bgColor: 'bg-amber-50' };
    return { quality: 'Poor', color: 'text-red-600', bgColor: 'bg-red-50' };
  }
}

class ForexPredictor {
  constructor(windowSize = 10) {
    this.windowSize = windowSize;
    this.historicalData = {};
    this.linearModels = {};
    this.emaValues = {};
  }

  addDataPoint(symbol, price) {
    if (!this.historicalData[symbol]) {
      this.historicalData[symbol] = [];
    }
    
    this.historicalData[symbol].push({
      price: price,
      timestamp: Date.now()
    });

    if (this.historicalData[symbol].length > 100) {
      this.historicalData[symbol] = this.historicalData[symbol].slice(-100);
    }

    this.updateLinearModel(symbol);
  }

  updateLinearModel(symbol) {
    const data = this.historicalData[symbol];
    if (data && data.length >= 3) {
      if (!this.linearModels[symbol]) {
        this.linearModels[symbol] = new LinearRegressionModel();
      }
      this.linearModels[symbol].fit(data);
    }
  }

  calculateSMA(data, period) {
    if (data.length < period) return null;
    const slice = data.slice(-period);
    return slice.reduce((sum, item) => sum + item.price, 0) / period;
  }

  calculateEMA(data, period, symbol) {
    if (data.length === 0) return null;
    
    if (!this.emaValues[symbol]) {
      this.emaValues[symbol] = {};
    }
    
    const multiplier = 2 / (period + 1);
    const currentPrice = data[data.length - 1].price;
    
    if (!this.emaValues[symbol][period] || data.length < period) {
      const sma = this.calculateSMA(data.slice(0, Math.min(period, data.length)), Math.min(period, data.length));
      this.emaValues[symbol][period] = sma || currentPrice;
      return this.emaValues[symbol][period];
    }
    
    this.emaValues[symbol][period] = (currentPrice * multiplier) + (this.emaValues[symbol][period] * (1 - multiplier));
    return this.emaValues[symbol][period];
  }

  calculateMomentum(data, periods = 5) {
    if (data.length < periods + 1) return 0;
    
    const current = data[data.length - 1].price;
    const previous = data[data.length - 1 - periods].price;
    return (current - previous) / previous;
  }

  calculateATR(data, periods = 14) {
    if (data.length < periods + 1) return 0;
    
    const trueRanges = [];
    for (let i = 1; i < Math.min(data.length, periods + 1); i++) {
      const current = data[data.length - i];
      const previous = data[data.length - i - 1];
      
      const high = current.price * (1 + Math.random() * 0.001);
      const low = current.price * (1 - Math.random() * 0.001);
      const prevClose = previous.price;
      
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trueRanges.push(tr);
    }
    
    return trueRanges.reduce((sum, tr) => sum + tr, 0) / trueRanges.length;
  }

  calculateVolatility(data, periods = 10) {
    if (data.length < periods) return 0;
    
    const returns = [];
    for (let i = 1; i < Math.min(data.length, periods + 1); i++) {
      const current = data[data.length - i];
      const previous = data[data.length - i - 1];
      const return_val = Math.log(current.price / previous.price);
      returns.push(return_val);
    }
    
    const mean = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
    
    return Math.sqrt(variance * 252);
  }

  calculateRSI(data, periods = 14) {
    if (data.length < periods + 1) return 50;
    
    const changes = [];
    for (let i = 1; i < data.length; i++) {
      changes.push(data[i].price - data[i-1].price);
    }
    
    const recentChanges = changes.slice(-periods);
    
    let avgGain = 0;
    let avgLoss = 0;
    
    for (let i = 0; i < recentChanges.length; i++) {
      if (recentChanges[i] > 0) {
        avgGain += recentChanges[i];
      } else {
        avgLoss += Math.abs(recentChanges[i]);
      }
    }
    
    avgGain /= periods;
    avgLoss /= periods;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  calculateMACD(data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9, symbol) {
    if (data.length < slowPeriod) {
      return { macd: 0, signal: 0, histogram: 0 };
    }
    
    const fastEMA = this.calculateEMA(data, fastPeriod, symbol + '_fast');
    const slowEMA = this.calculateEMA(data, slowPeriod, symbol + '_slow');
    
    if (fastEMA === null || slowEMA === null) {
      return { macd: 0, signal: 0, histogram: 0 };
    }
    
    const currentMACD = fastEMA - slowEMA;
    
    if (!this.emaValues[symbol + '_macd_signal']) {
      this.emaValues[symbol + '_macd_signal'] = currentMACD;
    } else {
      const signalMultiplier = 2 / (signalPeriod + 1);
      this.emaValues[symbol + '_macd_signal'] = 
        (currentMACD * signalMultiplier) + (this.emaValues[symbol + '_macd_signal'] * (1 - signalMultiplier));
    }
    
    const histogram = currentMACD - this.emaValues[symbol + '_macd_signal'];
    
    return {
      macd: currentMACD,
      signal: this.emaValues[symbol + '_macd_signal'],
      histogram: histogram
    };
  }

  calculateBollingerBands(data, period = 20, multiplier = 2) {
    if (data.length < period) {
      return { upper: null, middle: null, lower: null, bandwidth: 0, percentB: 0.5 };
    }
    
    const sma = this.calculateSMA(data, period);
    if (sma === null) return { upper: null, middle: null, lower: null, bandwidth: 0, percentB: 0.5 };
    
    const prices = data.slice(-period).map(d => d.price);
    const squaredDiffs = prices.map(price => Math.pow(price - sma, 2));
    const variance = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / period;
    const standardDeviation = Math.sqrt(variance);
    
    const upper = sma + (standardDeviation * multiplier);
    const lower = sma - (standardDeviation * multiplier);
    const currentPrice = data[data.length - 1].price;
    
    return {
      upper: upper,
      middle: sma,
      lower: lower,
      bandwidth: (2 * multiplier * standardDeviation) / sma,
      percentB: (currentPrice - lower) / (upper - lower)
    };
  }

  calculateStochastic(data, kPeriod = 14) {
    if (data.length < kPeriod) {
      return { k: 50, d: 50 };
    }
    
    const recentData = data.slice(-kPeriod);
    const currentPrice = data[data.length - 1].price;
    
    const highs = recentData.map(d => d.price * (1 + Math.random() * 0.002));
    const lows = recentData.map(d => d.price * (1 - Math.random() * 0.002));
    
    const highestHigh = Math.max(...highs);
    const lowestLow = Math.min(...lows);
    
    const k = ((currentPrice - lowestLow) / (highestHigh - lowestLow)) * 100;
    
    return { 
      k: Math.max(0, Math.min(100, k)), 
      d: Math.max(0, Math.min(100, k))
    };
  }

  predictNextPrice(symbol) {
    const data = this.historicalData[symbol];
    const linearModel = this.linearModels[symbol];
    
    if (!data || data.length < 5) {
      return {
        predictedPrice: null,
        confidence: 0,
        trend: 'neutral',
        method: 'insufficient_data',
        linearRegression: null
      };
    }

    const sma5 = this.calculateSMA(data, 5);
    const sma10 = this.calculateSMA(data, Math.min(10, data.length));
    const sma20 = this.calculateSMA(data, Math.min(20, data.length));
    const ema12 = this.calculateEMA(data, 12, symbol);
    const ema26 = this.calculateEMA(data, 26, symbol);
    const momentum = this.calculateMomentum(data);
    const volatility = this.calculateVolatility(data);
    const atr = this.calculateATR(data);
    const rsi = this.calculateRSI(data);
    const macd = this.calculateMACD(data, 12, 26, 9, symbol);
    const bollinger = this.calculateBollingerBands(data);
    const stochastic = this.calculateStochastic(data);
    
    const currentPrice = data[data.length - 1].price;
    
    let linearPrediction = null;
    let linearConfidence = 0;
    let linearTrend = 'neutral';
    
    if (linearModel && data.length >= 3) {
      const predResult = linearModel.predict(1);
      linearPrediction = predResult.prediction;
      linearConfidence = predResult.confidence;
      linearTrend = linearModel.getTrendDirection();
    }

    let trend = 'neutral';
    let trendStrength = 0;
    
    if (sma5 && sma10) {
      if (sma5 > sma10 * 1.002) {
        trend = 'bullish';
        trendStrength += 1;
      } else if (sma5 < sma10 * 0.998) {
        trend = 'bearish';
        trendStrength += 1;
      }
    }
    
    if (ema12 && ema26) {
      if (ema12 > ema26) {
        if (trend === 'bullish') trendStrength += 1;
        else if (trend === 'neutral') trend = 'bullish';
      } else if (ema12 < ema26) {
        if (trend === 'bearish') trendStrength += 1;
        else if (trend === 'neutral') trend = 'bearish';
      }
    }
    
    if (momentum > 0.001) {
      if (trend === 'bullish') trendStrength += 1;
      else if (trend === 'neutral') trend = 'bullish';
    } else if (momentum < -0.001) {
      if (trend === 'bearish') trendStrength += 1;
      else if (trend === 'neutral') trend = 'bearish';
    }

    if (rsi > 70 && trend === 'bearish') trendStrength += 0.5;
    if (rsi < 30 && trend === 'bullish') trendStrength += 0.5;
    
    if (macd.macd > macd.signal && trend === 'bullish') trendStrength += 0.5;
    if (macd.macd < macd.signal && trend === 'bearish') trendStrength += 0.5;
    
    if (stochastic.k < 20 && trend === 'bullish') trendStrength += 0.3;
    if (stochastic.k > 80 && trend === 'bearish') trendStrength += 0.3;

    const momentumPrediction = currentPrice * (1 + momentum * 0.3);
    const smaPrediction = sma5 || currentPrice;
    const emaPrediction = ema12 || currentPrice;
    const meanReversionPrediction = currentPrice + ((sma20 || currentPrice) - currentPrice) * 0.1;
    
    let finalPrediction = currentPrice;
    
    if (linearPrediction) {
      const linearWeight = Math.min(0.4, linearConfidence / 100);
      const technicalWeight = 1 - linearWeight;
      
      const technicalPrediction = (
        momentumPrediction * 0.3 + 
        smaPrediction * 0.25 + 
        emaPrediction * 0.25 + 
        meanReversionPrediction * 0.2
      );
      
      finalPrediction = (linearPrediction * linearWeight) + (technicalPrediction * technicalWeight);
    } else {
      finalPrediction = (
        momentumPrediction * 0.3 + 
        smaPrediction * 0.25 + 
        emaPrediction * 0.25 + 
        meanReversionPrediction * 0.2
      );
    }

    const volatilityFactor = Math.min(0.02, atr / currentPrice);
    if (trend === 'bullish') {
      finalPrediction += currentPrice * volatilityFactor * 0.5;
    } else if (trend === 'bearish') {
      finalPrediction -= currentPrice * volatilityFactor * 0.5;
    }

    let baseConfidence = Math.min(95, Math.max(20, 
      (data.length / 50) * 100 * (1 - Math.min(volatility * 10, 0.8))
    ));
    
    if (trendStrength >= 3) baseConfidence += 10;
    else if (trendStrength >= 2) baseConfidence += 5;
    else if (trendStrength <= 0.5) baseConfidence -= 15;
    
    if ((rsi > 80 || rsi < 20) && trendStrength < 1) {
      baseConfidence -= 10;
    }
    
    const confidence = linearConfidence > 0 ? 
      Math.round((baseConfidence * 0.6) + (linearConfidence * 0.4)) : 
      Math.round(baseConfidence);

    return {
      predictedPrice: finalPrediction,
      confidence: Math.max(0, Math.min(100, confidence)),
      trend: trend,
      trendStrength: trendStrength,
      method: 'enhanced_multi_indicator',
      currentPrice: currentPrice,
      momentum: momentum,
      volatility: volatility,
      atr: atr,
      rsi: rsi,
      macd: macd,
      bollinger: bollinger,
      stochastic: stochastic,
      sma5: sma5,
      sma10: sma10,
      sma20: sma20,
      ema12: ema12,
      ema26: ema26,
      linearRegression: linearModel ? {
        prediction: linearPrediction,
        confidence: linearConfidence,
        trend: linearTrend,
        rSquared: linearModel.rSquared,
        slope: linearModel.slope,
        quality: linearModel.getModelQuality()
      } : null
    };
  }
}

const TradeSettings = ({ currencyData }) => {
  const [riskPercent, setRiskPercent] = useState(2);
  const [riskReward, setRiskReward] = useState(2);
  const [accountBalance, setAccountBalance] = useState(10000);
  const [selectedPair, setSelectedPair] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [manualLotSize, setManualLotSize] = useState(0.01);
  const [useManualLotSize, setUseManualLotSize] = useState(false);

  const highestConfidencePair = currencyData.reduce((best, current) => {
    if (!current.prediction?.confidence) return best;
    if (!best.prediction?.confidence) return current;
    return current.prediction.confidence > best.prediction.confidence ? current : best;
  }, {});

  useEffect(() => {
    if (highestConfidencePair?.pair?.symbol && !selectedPair) {
      setSelectedPair(highestConfidencePair.pair.symbol);
    }
  }, [highestConfidencePair, selectedPair]);

  const formatPrice = (price, symbol) => {
    if (!price) return '---';
    const pair = CURRENCY_PAIRS.find(p => p.symbol === symbol);
    if (!pair) return price.toFixed(5);
    return price.toFixed(pair.pipDigits);
  };

  const generateTradeSignal = () => {
    const data = currencyData.find(d => d.pair.symbol === selectedPair);
    if (!data?.prediction) return null;

    const { prediction, currentRate, pair } = data;
    
    let signal = 'BUY';
    let signalStrength = 1;
    let conflictWarning = false;
    
    const priceDirection = prediction.predictedPrice > currentRate ? 'bullish' : 'bearish';
    
    if (prediction.trend !== priceDirection && prediction.trend !== 'neutral') {
      conflictWarning = true;
    }
    
    let bullishScore = 0;
    let bearishScore = 0;
    let totalIndicators = 0;
    
    const priceChange = (prediction.predictedPrice - currentRate) / currentRate;
    if (Math.abs(priceChange) > 0.0005) {
      totalIndicators++;
      if (priceChange > 0) {
        bullishScore += 3.0;
      } else {
        bearishScore += 3.0;
      }
    }
    
    if (prediction.trend !== 'neutral') {
      totalIndicators++;
      if (prediction.trend === 'bullish') {
        bullishScore += 2.5;
      } else {
        bearishScore += 2.5;
      }
    }
    
    if (prediction.rsi !== 50) {
      totalIndicators++;
      if (prediction.rsi < 30) {
        bullishScore += 2.5;
      } else if (prediction.rsi > 70) {
        bearishScore += 2.5;
      } else if (prediction.rsi < 40) {
        bullishScore += 1.0;
      } else if (prediction.rsi > 60) {
        bearishScore += 1.0;
      }
    }
    
    if (prediction.macd.histogram !== 0) {
      totalIndicators++;
      if (prediction.macd.macd > prediction.macd.signal) {
        bullishScore += 2.0;
      } else if (prediction.macd.macd < prediction.macd.signal) {
        bearishScore += 2.0;
      }
    }
    
    if (prediction.momentum !== 0) {
      totalIndicators++;
      if (prediction.momentum > 0.001) {
        bullishScore += 2.0;
      } else if (prediction.momentum < -0.001) {
        bearishScore += 2.0;
      } else if (prediction.momentum > 0) {
        bullishScore += 0.8;
      } else if (prediction.momentum < 0) {
        bearishScore += 0.8;
      }
    }
    
    if (prediction.stochastic.k !== 50) {
      totalIndicators++;
      if (prediction.stochastic.k < 20) {
        bullishScore += 1.5;
      } else if (prediction.stochastic.k > 80) {
        bearishScore += 1.5;
      }
    }
    
    if (prediction.bollinger && prediction.bollinger.percentB !== 0.5) {
      totalIndicators++;
      if (prediction.bollinger.percentB < 0.2) {
        bullishScore += 1.5;
      } else if (prediction.bollinger.percentB > 0.8) {
        bearishScore += 1.5;
      }
    }
    
    if (prediction.ema12 && prediction.ema26) {
      totalIndicators++;
      const emaDiff = (prediction.ema12 - prediction.ema26) / prediction.ema26;
      if (emaDiff > 0.001) {
        bullishScore += 1.5;
      } else if (emaDiff < -0.001) {
        bearishScore += 1.5;
      }
    }
    
    const totalScore = bullishScore + bearishScore;
    let tradeConfidence = 0;
    
    if (bullishScore > bearishScore) {
      signal = 'BUY';
      const agreementRatio = bullishScore / (bullishScore + bearishScore);
      tradeConfidence = Math.round(agreementRatio * 100);
      signalStrength = Math.min(5, Math.max(1, Math.round((bullishScore / 2.5))));
    } else if (bearishScore > bullishScore) {
      signal = 'SELL';
      const agreementRatio = bearishScore / (bullishScore + bearishScore);
      tradeConfidence = Math.round(agreementRatio * 100);
      signalStrength = Math.min(5, Math.max(1, Math.round((bearishScore / 2.5))));
    } else {
      signal = priceDirection === 'bullish' ? 'BUY' : 'SELL';
      tradeConfidence = 50;
      signalStrength = 2;
    }
    
    if (conflictWarning) {
      tradeConfidence = Math.max(40, tradeConfidence - 10);
      signalStrength = Math.max(1, signalStrength - 1);
    }
    
    tradeConfidence = Math.max(45, tradeConfidence);

    const isBuy = signal === 'BUY';
    const pipSize = pair.symbol.includes('JPY') ? 0.01 : pair.symbol === 'XAUUSD' ? 0.1 : 0.0001;
    
    const atr = prediction.atr || (prediction.volatility * currentRate);
    const slMultiplier = Math.max(1.5, Math.min(3.5, 2 + (prediction.volatility * 5)));
    const tpMultiplier = riskReward;
    
    const slDistance = atr * slMultiplier;
    const tpDistance = slDistance * tpMultiplier;
        
    const sl = isBuy ? currentRate - slDistance : currentRate + slDistance;
    const tp = isBuy ? currentRate + tpDistance : currentRate - tpDistance;
    
    const riskAmount = accountBalance * (riskPercent / 100);
    const slPips = Math.abs(currentRate - sl) / pipSize;
    
    let pipValuePerStandardLot = 10;
    
    if (pair.symbol === 'XAUUSD') {
      pipValuePerStandardLot = 10;
    } else if (pair.symbol.includes('JPY')) {
      pipValuePerStandardLot = (0.01 / currentRate) * 100000;
    } else if (pair.quote === 'USD') {
      pipValuePerStandardLot = 10;
    } else {
      pipValuePerStandardLot = 10;
    }
    
    let lotSize;
    if (useManualLotSize) {
      lotSize = manualLotSize;
    } else {
      lotSize = riskAmount / (slPips * pipValuePerStandardLot);
      lotSize = Math.round(lotSize * 100) / 100;
      lotSize = Math.min(100, Math.max(0.01, lotSize));
    }

    const actualRisk = slPips * pipValuePerStandardLot * lotSize;
    const potentialProfit = actualRisk * riskReward;
    
    const riskExceedsLimit = !useManualLotSize && actualRisk > (accountBalance * riskPercent / 100) * 1.1;

    return {
      pair: selectedPair,
      pairName: pair.name,
      signal: signal,
      signalStrength: Math.min(5, signalStrength),
      bullishScore: Math.round(bullishScore * 10) / 10,
      bearishScore: Math.round(bearishScore * 10) / 10,
      totalIndicators: totalIndicators,
      entry: currentRate,
      predictedPrice: prediction.predictedPrice,
      priceChange: prediction.predictedPrice - currentRate,
      priceChangePercent: ((prediction.predictedPrice - currentRate) / currentRate) * 100,
      sl: sl,
      tp: tp,
      lotSize: Number(lotSize.toFixed(2)),
      confidence: tradeConfidence,
      pipsToSL: Math.round(slPips),
      pipsToTP: Math.round(Math.abs(tp - currentRate) / pipSize),
      riskAmount: actualRisk,
      potentialProfit: potentialProfit,
      riskExceedsLimit: riskExceedsLimit,
      pipValuePerStandardLot: pipValuePerStandardLot,
      isManualLotSize: useManualLotSize,
      conflictWarning: conflictWarning,
      indicators: {
        trend: prediction.trend,
        priceDirection: priceDirection,
        rsi: prediction.rsi,
        macd: prediction.macd,
        bollinger: prediction.bollinger,
        stochastic: prediction.stochastic,
        sma5: prediction.sma5,
        sma10: prediction.sma10,
        sma20: prediction.sma20,
        ema12: prediction.ema12,
        ema26: prediction.ema26,
        momentum: prediction.momentum,
        volatility: prediction.volatility,
        atr: prediction.atr
      }
    };
  };

  const tradeSignal = generateTradeSignal();
  const selectedData = currencyData.find(d => d.pair.symbol === selectedPair);

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-slate-800 flex items-center">
          <Settings className="w-5 h-5 mr-2 text-indigo-600" />
          Trade Settings & MT5 Signals
        </h2>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center text-sm text-slate-600 hover:text-indigo-600 transition-colors"
        >
          {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          Advanced
        </button>
      </div>

      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gradient-to-br from-indigo-50 to-blue-100 border border-indigo-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-indigo-700 text-sm font-medium">Account Balance</div>
              <DollarSign className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="text-2xl font-bold text-indigo-800">
              ${accountBalance.toLocaleString()}
            </div>
            <div className="text-xs text-indigo-600 mt-1">
              Risk per trade: {riskPercent}% (${(accountBalance * riskPercent / 100).toFixed(2)})
            </div>
          </div>

          <div className="bg-gradient-to-br from-emerald-50 to-green-100 border border-emerald-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-emerald-700 text-sm font-medium">Lot Size</div>
              <Layers className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="text-2xl font-bold text-emerald-800">
              {tradeSignal?.lotSize || '0.01'} lots
            </div>
            <div className="text-xs text-emerald-600 mt-1">
              {useManualLotSize ? 'Manual setting' : 'Auto-calculated'}
              {tradeSignal?.lotSize >= 1 ? ' • Standard' : tradeSignal?.lotSize >= 0.1 ? ' • Mini' : ' • Micro'}
            </div>
          </div>

          <div className="bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-purple-700 text-sm font-medium">Risk:Reward</div>
              <Calculator className="w-4 h-4 text-purple-600" />
            </div>
            <div className="text-2xl font-bold text-purple-800">
              1:{riskReward}
            </div>
            <div className="text-xs text-purple-600 mt-1">
              Potential: ${tradeSignal?.potentialProfit?.toFixed(2) || '0.00'} profit
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Currency Pair</label>
              <select
                value={selectedPair}
                onChange={(e) => setSelectedPair(e.target.value)}
                className="w-full bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Select pair...</option>
                {currencyData.map(({ pair }) => (
                  <option key={pair.symbol} value={pair.symbol}>
                    {pair.name} ({pair.symbol})
                  </option>
                ))}
              </select>
              {highestConfidencePair?.pair?.symbol === selectedPair && (
                <p className="text-xs text-emerald-600 mt-1 flex items-center">
                  <Target className="w-3 h-3 mr-1" />
                  Highest confidence pair selected
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Balance ($)</label>
              <input
                type="number"
                min="1000"
                value={accountBalance}
                onChange={(e) => setAccountBalance(Number(e.target.value))}
                className="w-full bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex items-center space-x-2 mb-2">
              <input
                type="checkbox"
                id="useManualLotSize"
                checked={useManualLotSize}
                onChange={(e) => setUseManualLotSize(e.target.checked)}
                className="w-4 h-4 text-indigo-600 bg-gray-100 border-gray-300 rounded focus:ring-indigo-500"
              />
              <label htmlFor="useManualLotSize" className="text-sm font-medium text-slate-700">
                Manual Lot Size
              </label>
            </div>

            {useManualLotSize ? (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Lot Size</label>
                <input
                  type="number"
                  min="0.01"
                  max="100"
                  step="0.01"
                  value={manualLotSize}
                  onChange={(e) => setManualLotSize(Number(e.target.value))}
                  className="w-full bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-slate-500 mt-1">
                  1.00 = 100,000 units | 0.10 = 10,000 units | 0.01 = 1,000 units (micro lot)
                </p>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Risk %</label>
                <input
                  type="number"
                  min="0.5"
                  max="10"
                  step="0.5"
                  value={riskPercent}
                  onChange={(e) => setRiskPercent(Number(e.target.value))}
                  className="w-full bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">R:R Ratio</label>
              <input
                type="number"
                min="1"
                max="5"
                step="0.5"
                value={riskReward}
                onChange={(e) => setRiskReward(Number(e.target.value))}
                className="w-full bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {selectedData?.prediction && (
            <div className="bg-slate-50 rounded-xl p-4">
              <h3 className="font-semibold text-slate-700 mb-3 flex items-center">
                <BarChart2 className="w-4 h-4 mr-2" />
                Technical Indicators
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-white rounded-lg p-3">
                  <div className="text-slate-600 mb-1">RSI (14)</div>
                  <div className={`font-bold ${selectedData.prediction.rsi > 70 ? 'text-red-600' : selectedData.prediction.rsi < 30 ? 'text-emerald-600' : 'text-blue-600'}`}>
                    {selectedData.prediction.rsi.toFixed(1)}
                    {selectedData.prediction.rsi > 70 && <span className="text-xs ml-1">OB</span>}
                    {selectedData.prediction.rsi < 30 && <span className="text-xs ml-1">OS</span>}
                  </div>
                </div>
                <div className="bg-white rounded-lg p-3">
                  <div className="text-slate-600 mb-1">MACD</div>
                  <div className={`font-bold ${selectedData.prediction.macd.macd > selectedData.prediction.macd.signal ? 'text-emerald-600' : 'text-red-600'}`}>
                    {selectedData.prediction.macd.macd.toFixed(4)}
                  </div>
                </div>
                <div className="bg-white rounded-lg p-3">
                  <div className="text-slate-600 mb-1">Stochastic</div>
                  <div className={`font-bold ${selectedData.prediction.stochastic.k > 80 ? 'text-red-600' : selectedData.prediction.stochastic.k < 20 ? 'text-emerald-600' : 'text-blue-600'}`}>
                    {selectedData.prediction.stochastic.k.toFixed(1)}
                  </div>
                </div>
                <div className="bg-white rounded-lg p-3">
                  <div className="text-slate-600 mb-1">BB Squeeze</div>
                  <div className={`font-bold ${selectedData.prediction.bollinger.bandwidth < 0.02 ? 'text-amber-600' : 'text-blue-600'}`}>
                    {selectedData.prediction.bollinger.bandwidth < 0.02 ? 'Tight' : 'Normal'}
                  </div>
                </div>
              </div>
              
              {selectedData.prediction.linearRegression && selectedData.prediction.linearRegression.rSquared > 0.1 && (
                <div className="bg-white rounded-lg p-3 mt-3">
                  <div className="text-slate-600 text-sm mb-2">Linear Regression Model</div>
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div className="text-center">
                      <div className="text-slate-500">Quality</div>
                      <div className={`font-bold ${selectedData.prediction.linearRegression.quality.color}`}>
                        {selectedData.prediction.linearRegression.quality.quality}
                      </div>
                      <div className="text-slate-400">R² = {selectedData.prediction.linearRegression.rSquared.toFixed(3)}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-slate-500">Slope</div>
                      <div className={`font-bold ${selectedData.prediction.linearRegression.slope > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {(selectedData.prediction.linearRegression.slope * 1000).toFixed(3)}
                      </div>
                      <div className="text-slate-400">×10³</div>
                    </div>
                    <div className="text-center">
                      <div className="text-slate-500">Prediction</div>
                      <div className="font-bold text-slate-800">
                        {formatPrice(selectedData.prediction.linearRegression.prediction, selectedPair)}
                      </div>
                      <div className="text-slate-400">{selectedData.prediction.linearRegression.confidence.toFixed(0)}%</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {tradeSignal && (
          <div className={`bg-gradient-to-br ${tradeSignal.signal === 'BUY' ? 'from-emerald-50 to-green-100 border-emerald-200' : 'from-red-50 to-red-100 border-red-200'} rounded-xl p-4 border`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-800">Trade Signal</h3>
              <div className="flex items-center space-x-3">
                {tradeSignal.conflictWarning && (
                  <span className="flex items-center text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded-full">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Conflict
                  </span>
                )}
                <span className={`px-3 py-1 rounded-full text-sm font-bold ${tradeSignal.signal === 'BUY' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
                  {tradeSignal.signal}
                </span>
              </div>
            </div>
            
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 p-3 rounded text-sm">
                <div className="font-semibold text-blue-800 mb-1">
                  {tradeSignal.confidence}% Confidence for {tradeSignal.signal} Signal
                </div>
                <div className="text-blue-700 text-xs">
                  Based on {tradeSignal.totalIndicators} technical indicators • Strength: {tradeSignal.signalStrength}/5
                </div>
              </div>

              {tradeSignal.riskExceedsLimit && (
                <div className="bg-red-50 border border-red-200 p-3 rounded text-xs text-red-800">
                  <div className="flex items-start">
                    <AlertCircle className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-semibold">Risk Management Warning</p>
                      <p className="mt-1">
                        Calculated risk (${tradeSignal.riskAmount.toFixed(2)}) exceeds your {riskPercent}% limit. Consider adjusting.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="bg-emerald-50 p-3 rounded">
                  <div className="text-emerald-700 text-xs mb-1">Bullish Score</div>
                  <div className="font-bold text-lg text-emerald-800">{tradeSignal.bullishScore}</div>
                </div>
                <div className="bg-red-50 p-3 rounded">
                  <div className="text-red-700 text-xs mb-1">Bearish Score</div>
                  <div className="font-bold text-lg text-red-800">{tradeSignal.bearishScore}</div>
                </div>
                <div className="bg-blue-50 p-3 rounded">
                  <div className="text-blue-700 text-xs mb-1">Strength</div>
                  <div className="font-bold text-lg text-blue-800">{tradeSignal.signalStrength}/5</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="bg-white bg-opacity-70 p-3 rounded">
                  <div className="text-slate-600 text-xs mb-1">Entry Price</div>
                  <div className="font-bold text-lg text-black">{formatPrice(tradeSignal.entry, selectedPair)}</div>
                  <div className="text-xs text-slate-500">
                    Target: {formatPrice(tradeSignal.predictedPrice, selectedPair)}
                  </div>
                </div>
                <div className="bg-white bg-opacity-70 p-3 rounded">
                  <div className="text-slate-600 text-xs mb-1">Lot Size</div>
                  <div className="font-bold text-lg text-black">{tradeSignal.lotSize} lots</div>
                  <div className="text-xs text-slate-500">
                    {tradeSignal.lotSize >= 1 ? 'Standard' : tradeSignal.lotSize >= 0.1 ? 'Mini' : 'Micro'}
                  </div>
                </div>
                <div className="bg-white bg-opacity-70 p-3 rounded">
                  <div className="text-slate-600 text-xs mb-1">Confidence</div>
                  <div className="font-bold text-lg text-black">{tradeSignal.confidence}%</div>
                  <div className="text-xs text-slate-500">
                    {tradeSignal.signal} signal
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-red-100 p-3 rounded">
                  <div className="text-red-700 font-medium">Stop Loss</div>
                  <div className="font-bold text-red-800 text-lg">{formatPrice(tradeSignal.sl, selectedPair)}</div>
                  <div className="text-xs text-red-600 flex items-center justify-between">
                    <span>{tradeSignal.pipsToSL} pips</span>
                    <span>Risk: ${tradeSignal.riskAmount.toFixed(2)}</span>
                  </div>
                </div>
                <div className="bg-emerald-100 p-3 rounded">
                  <div className="text-emerald-700 font-medium">Take Profit</div>
                  <div className="font-bold text-emerald-800 text-lg">{formatPrice(tradeSignal.tp, selectedPair)}</div>
                  <div className="text-xs text-emerald-600 flex items-center justify-between">
                    <span>{tradeSignal.pipsToTP} pips</span>
                    <span>Profit: ${tradeSignal.potentialProfit.toFixed(2)}</span>
                  </div>
                </div>
              </div>
              
              <div className="bg-slate-800 rounded-lg p-4 text-white">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-slate-300">MT5 Order Details</div>
                  <div className="text-xs text-slate-400">Ready to copy</div>
                </div>
                <div className="font-mono text-sm space-y-1">
                  <div>Symbol: <span className="text-yellow-400">{tradeSignal.pair}</span></div>
                  <div>Type: <span className={tradeSignal.signal === 'BUY' ? 'text-emerald-400' : 'text-red-400'}>{tradeSignal.signal}</span></div>
                  <div>Volume: <span className="text-blue-400">{tradeSignal.lotSize}</span></div>
                  <div>Price: <span className="text-white">{formatPrice(tradeSignal.entry, selectedPair)}</span></div>
                  <div>SL: <span className="text-red-400">{formatPrice(tradeSignal.sl, selectedPair)}</span></div>
                  <div>TP: <span className="text-emerald-400">{formatPrice(tradeSignal.tp, selectedPair)}</span></div>
                </div>
              </div>

              {tradeSignal.conflictWarning && (
                <div className="bg-amber-50 border border-amber-200 p-3 rounded text-xs text-amber-800">
                  <div className="flex items-start">
                    <AlertTriangle className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-semibold">Warning: Conflicting Signals</p>
                      <p className="mt-1">
                        Some indicators suggest different directions. Confidence adjusted. Consider waiting for clearer consensus.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {showAdvanced && selectedData?.prediction && (
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
            <h3 className="font-semibold text-slate-700 mb-3 flex items-center">
              <Brain className="w-4 h-4 mr-2" />
              Advanced Analytics
            </h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="bg-white rounded-lg p-3">
                  <div className="text-slate-600 mb-1">EMA 12/26 Cross</div>
                  <div className={`font-bold ${(selectedData.prediction.ema12 || 0) > (selectedData.prediction.ema26 || 0) ? 'text-emerald-600' : 'text-red-600'}`}>
                    {(selectedData.prediction.ema12 || 0) > (selectedData.prediction.ema26 || 0) ? 'Bullish' : 'Bearish'}
                  </div>
                  <div className="text-xs text-slate-500">
                    12: {formatPrice(selectedData.prediction.ema12, selectedPair)} | 26: {formatPrice(selectedData.prediction.ema26, selectedPair)}
                  </div>
                </div>
                <div className="bg-white rounded-lg p-3">
                  <div className="text-slate-600 mb-1">Volatility</div>
                  <div className="font-bold text-amber-600">
                    {(selectedData.prediction.volatility * 100).toFixed(2)}%
                  </div>
                  <div className="text-xs text-slate-500">
                    ATR: {formatPrice(selectedData.prediction.atr, selectedPair)}
                  </div>
                </div>
                <div className="bg-white rounded-lg p-3">
                  <div className="text-slate-600 mb-1">Momentum</div>
                  <div className={`font-bold ${selectedData.prediction.momentum > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {(selectedData.prediction.momentum * 100).toFixed(3)}%
                  </div>
                  <div className="text-xs text-slate-500">
                    5-period change
                  </div>
                </div>
                <div className="bg-white rounded-lg p-3">
                  <div className="text-slate-600 mb-1">BB Position</div>
                  <div className={`font-bold ${selectedData.prediction.bollinger.percentB > 0.8 ? 'text-red-600' : selectedData.prediction.bollinger.percentB < 0.2 ? 'text-emerald-600' : 'text-blue-600'}`}>
                    {(selectedData.prediction.bollinger.percentB * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-slate-500">
                    {selectedData.prediction.bollinger.percentB > 0.8 ? 'Near upper' : selectedData.prediction.bollinger.percentB < 0.2 ? 'Near lower' : 'Mid-band'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const ForexDashboard = () => {
  const [currencyData, setCurrencyData] = useState([]);
  const [isRunning, setIsRunning] = useState(true);
  const [predictor] = useState(() => new ForexPredictor());
  const [lastUpdate, setLastUpdate] = useState(Date.now());
  const [viewMode, setViewMode] = useState('cards');
  const [sortBy, setSortBy] = useState('confidence');
  const [showPredictions, setShowPredictions] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [apiStatus, setApiStatus] = useState('connecting');
  const [errorMessage, setErrorMessage] = useState('');

  const initializeData = useCallback(async () => {
    setIsLoading(true);
    setApiStatus('connecting');
    setErrorMessage('');
    
    try {
      const results = await fetchAllForexData();
      
      const initialData = results.map(({ pair, rate }) => ({
        pair,
        currentRate: rate || 0,
        previousRate: null,
        change: 0,
        changePercent: 0,
        prediction: null,
        history: [],
        dataSource: rate ? 'live' : 'unavailable'
      }));
      
      setCurrencyData(initialData);
      
      initialData.forEach(data => {
        if (data.currentRate > 0) {
          predictor.addDataPoint(data.pair.symbol, data.currentRate);
        }
      });
      
      const liveCount = initialData.filter(d => d.dataSource === 'live').length;
      
      if (liveCount === 0) {
        setApiStatus('error');
        setErrorMessage('Unable to fetch live data. All APIs are unavailable.');
      } else if (liveCount < initialData.length) {
        setApiStatus('partial');
        setErrorMessage(`${liveCount}/${initialData.length} pairs connected. Some data unavailable.`);
      } else {
        setApiStatus('connected');
      }
      
    } catch (error) {
      console.error('Initialization error:', error);
      setApiStatus('error');
      setErrorMessage('Failed to initialize data sources.');
    } finally {
      setIsLoading(false);
    }
  }, [predictor]);

  const updateData = useCallback(async () => {
    if (!isRunning) return;
    
    try {
      const results = await fetchAllForexData();
      
      setCurrencyData(prevData => 
        prevData.map((data, index) => {
          const newRate = results[index]?.rate;
          
          if (!newRate || newRate <= 0) {
            return { ...data, dataSource: 'unavailable' };
          }
          
          const change = newRate - data.currentRate;
          const changePercent = (change / data.currentRate) * 100;
          
          predictor.addDataPoint(data.pair.symbol, newRate);
          const prediction = predictor.predictNextPrice(data.pair.symbol);
          
          const newHistory = [...data.history, {
            timestamp: Date.now(),
            price: newRate,
            prediction: prediction.predictedPrice
          }].slice(-50);
          
          return {
            ...data,
            previousRate: data.currentRate,
            currentRate: newRate,
            change: change,
            changePercent: changePercent,
            prediction: prediction,
            history: newHistory,
            dataSource: 'live'
          };
        })
      );
      
      setLastUpdate(Date.now());
      setApiStatus('connected');
      
    } catch (error) {
      console.error('Update error:', error);
      setApiStatus('error');
    }
  }, [isRunning, predictor]);

  useEffect(() => {
    initializeData();
  }, [initializeData]);

  useEffect(() => {
    if (!isLoading) {
      const interval = setInterval(updateData, 5000);
      return () => clearInterval(interval);
    }
  }, [updateData, isLoading]);

  const formatPrice = (price, symbol) => {
    if (!price) return '---';
    if (symbol.includes('JPY')) return price.toFixed(3);
    if (symbol === 'XAUUSD') return price.toFixed(2);
    return price.toFixed(5);
  };

  const formatChange = (change, symbol) => {
    if (!change) return '0.0000';
    if (symbol.includes('JPY')) return change.toFixed(3);
    if (symbol === 'XAUUSD') return change.toFixed(2);
    return change.toFixed(5);
  };

  const getPairTypeColor = (type) => {
    switch (type) {
      case 'major': return 'bg-blue-100 text-blue-800';
      case 'cross': return 'bg-purple-100 text-purple-800';
      case 'commodity': return 'bg-amber-100 text-amber-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  const filteredAndSortedData = currencyData
    .filter(d => d.currentRate > 0)
    .sort((a, b) => {
      switch (sortBy) {
        case 'confidence':
          return (b.prediction?.confidence || 0) - (a.prediction?.confidence || 0);
        case 'volatility':
          return (b.prediction?.volatility || 0) - (a.prediction?.volatility || 0);
        case 'momentum':
          return Math.abs(b.prediction?.momentum || 0) - Math.abs(a.prediction?.momentum || 0);
        default:
          return 0;
      }
    });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 p-4 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
          <RefreshCw className="w-12 h-12 text-indigo-600 animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-800 mb-2">Connecting to Live Markets</h2>
          <p className="text-slate-600">Fetching real-time forex data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 p-4">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between space-y-4 md:space-y-0">
            <div>
              <h1 className="text-3xl font-bold text-slate-800 flex items-center">
                <Activity className="w-8 h-8 mr-3 text-indigo-600" />
                Real-Time Forex Predictor
              </h1>
              <p className="text-slate-600 mt-1">Live market data with AI-powered predictions</p>
            </div>
            
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <div className={`w-3 h-3 rounded-full ${
                  apiStatus === 'connected' ? 'bg-emerald-500 animate-pulse' : 
                  apiStatus === 'partial' ? 'bg-amber-500 animate-pulse' : 
                  apiStatus === 'error' ? 'bg-red-500' : 'bg-slate-400'
                }`}></div>
                <span className="text-sm text-slate-600">
                  {apiStatus === 'connected' ? 'Live Data' : 
                   apiStatus === 'partial' ? 'Partial Data' : 
                   apiStatus === 'error' ? 'Error' : 'Connecting...'}
                </span>
              </div>
              
              <button
                onClick={() => setIsRunning(!isRunning)}
                className={`flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isRunning 
                    ? 'bg-red-500 hover:bg-red-600 text-white' 
                    : 'bg-emerald-500 hover:bg-emerald-600 text-white'
                }`}
              >
                {isRunning ? (
                  <>
                    <Wifi className="w-4 h-4 mr-2" />
                    Pause
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Resume
                  </>
                )}
              </button>
            </div>
          </div>
          
          {errorMessage && (
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start">
              <AlertCircle className="w-5 h-5 text-amber-600 mr-2 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-amber-800">{errorMessage}</div>
            </div>
          )}
          
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-200">
            <div className="flex items-center space-x-4 text-sm text-slate-600">
              <div className="flex items-center">
                <Clock className="w-4 h-4 mr-1" />
                Last update: {new Date(lastUpdate).toLocaleTimeString()}
              </div>
              <div className="flex items-center">
                <Globe className="w-4 h-4 mr-1" />
                {filteredAndSortedData.length} pairs active
              </div>
            </div>
            
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setViewMode(viewMode === 'cards' ? 'table' : 'cards')}
                className="flex items-center px-3 py-1 text-sm text-slate-600 hover:text-indigo-600 transition-colors"
              >
                {viewMode === 'cards' ? <BarChart3 className="w-4 h-4 mr-1" /> : <Eye className="w-4 h-4 mr-1" />}
                {viewMode === 'cards' ? 'Table View' : 'Card View'}
              </button>
              
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="text-sm border border-slate-300 rounded px-2 py-1 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="confidence">Sort by Confidence</option>
                <option value="volatility">Sort by Volatility</option>
                <option value="momentum">Sort by Momentum</option>
              </select>
            </div>
          </div>
        </div>

        {viewMode === 'cards' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredAndSortedData.map(({ pair, currentRate, change, changePercent, prediction, history, dataSource }) => {
              const momentumData = getMomentumDirection(prediction?.momentum || 0);
              const MomentumIcon = momentumData.icon;
              
              return (
                <div key={pair.symbol} className="bg-white rounded-xl shadow-md hover:shadow-lg transition-shadow p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="font-bold text-slate-800">{pair.symbol}</h3>
                      <p className="text-xs text-slate-500">{pair.name}</p>
                    </div>
                    <div className="flex flex-col items-end space-y-1">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getPairTypeColor(pair.type)}`}>
                        {pair.type.toUpperCase()}
                      </span>
                      {dataSource === 'live' && (
                        <span className="flex items-center text-xs text-emerald-600">
                          <Wifi className="w-3 h-3 mr-1" />
                          Live
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-2xl font-bold text-slate-800">
                        {formatPrice(currentRate, pair.symbol)}
                      </div>
                      <div className={`flex items-center text-sm font-medium ${
                        changePercent >= 0 ? 'text-emerald-600' : 'text-red-600'
                      }`}>
                        {changePercent >= 0 ? <ArrowUp className="w-3 h-3 mr-1" /> : <ArrowDown className="w-3 h-3 mr-1" />}
                        {Math.abs(changePercent).toFixed(2)}%
                      </div>
                    </div>
                    
                    <div className="text-sm text-slate-600">
                      Change: <span className={changePercent >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                        {changePercent >= 0 ? '+' : ''}{formatChange(change, pair.symbol)}
                      </span>
                    </div>
                  </div>
                  
                  {prediction && showPredictions && (
                    <div className="mt-4 pt-3 border-t border-slate-100">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-slate-700">AI Prediction</span>
                        <div className="flex items-center">
                          <div className={`w-2 h-2 rounded-full mr-2 ${
                            prediction.confidence >= 80 ? 'bg-emerald-500' :
                            prediction.confidence >= 60 ? 'bg-amber-500' : 'bg-red-500'
                          }`}></div>
                          <span className="text-xs text-slate-500">{prediction.confidence}%</span>
                        </div>
                      </div>
                      
                      <div className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">Next Price:</span>
                          <span className="font-medium text-slate-800">
                            {formatPrice(prediction.predictedPrice, pair.symbol)}
                          </span>
                        </div>
                        
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">Trend:</span>
                          <span className={`font-medium capitalize ${
                            prediction.trend === 'bullish' ? 'text-emerald-600' :
                            prediction.trend === 'bearish' ? 'text-red-600' : 'text-slate-600'
                          }`}>
                            {prediction.trend}
                          </span>
                        </div>
                        
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-slate-600">Momentum:</span>
                          <div className={`flex items-center ${momentumData.color}`}>
                            <MomentumIcon className="w-3 h-3 mr-1" />
                            <span className="font-medium text-xs">{momentumData.direction}</span>
                          </div>
                        </div>
                        
                        {prediction.linearRegression && (
                          <div className="flex justify-between text-sm">
                          
                          </div>
                        )}
                      </div>
                      
                      {history.length > 10 && (
                        <div className="mt-3">
                          <ResponsiveContainer width="100%" height={60}>
                            <LineChart data={history.slice(-20)}>
                              <Line 
                                type="monotone" 
                                dataKey="price" 
                                stroke="#6366f1" 
                                strokeWidth={1.5}
                                dot={false}
                              />
                              <Line 
                                type="monotone" 
                                dataKey="prediction" 
                                stroke="#ef4444" 
                                strokeWidth={1}
                                strokeDasharray="3 3"
                                dot={false}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left p-4 font-semibold text-slate-700">Pair</th>
                    <th className="text-right p-4 font-semibold text-slate-700">Price</th>
                    <th className="text-right p-4 font-semibold text-slate-700">Change</th>
                    <th className="text-right p-4 font-semibold text-slate-700">Prediction</th>
                    <th className="text-right p-4 font-semibold text-slate-700">Confidence</th>
                    <th className="text-right p-4 font-semibold text-slate-700">Trend</th>
                    <th className="text-right p-4 font-semibold text-slate-700">RSI</th>
                    <th className="text-right p-4 font-semibold text-slate-700">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedData.map(({ pair, currentRate, change, changePercent, prediction, dataSource }) => (
                    <tr key={pair.symbol} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="p-4">
                        <div className="flex items-center">
                          <div>
                            <div className="font-semibold text-slate-800">{pair.symbol}</div>
                            <div className="text-xs text-slate-500">{pair.name}</div>
                          </div>
                          <span className={`ml-2 px-2 py-1 rounded-full text-xs font-medium ${getPairTypeColor(pair.type)}`}>
                            {pair.type}
                          </span>
                        </div>
                      </td>
                      <td className="p-4 text-right">
                        <div className="font-bold text-slate-800">{formatPrice(currentRate, pair.symbol)}</div>
                      </td>
                      <td className="p-4 text-right">
                        <div className={`flex items-center justify-end ${
                          changePercent >= 0 ? 'text-emerald-600' : 'text-red-600'
                        }`}>
                          {changePercent >= 0 ? <ArrowUp className="w-3 h-3 mr-1" /> : <ArrowDown className="w-3 h-3 mr-1" />}
                          <span className="font-medium">{Math.abs(changePercent).toFixed(2)}%</span>
                        </div>
                        <div className="text-xs text-slate-500">
                          {changePercent >= 0 ? '+' : ''}{formatChange(change, pair.symbol)}
                        </div>
                      </td>
                      <td className="p-4 text-right">
                        {prediction ? (
                          <div>
                            <div className="font-medium text-slate-800">
                              {formatPrice(prediction.predictedPrice, pair.symbol)}
                            </div>
                            <div className="text-xs text-slate-500">
                              {((prediction.predictedPrice - currentRate) / currentRate * 100).toFixed(2)}%
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400">---</span>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        {prediction ? (
                          <div className="flex items-center justify-end">
                            <div className={`w-2 h-2 rounded-full mr-2 ${
                              prediction.confidence >= 80 ? 'bg-emerald-500' :
                              prediction.confidence >= 60 ? 'bg-amber-500' : 'bg-red-500'
                            }`}></div>
                            <span className="font-medium">{prediction.confidence}%</span>
                          </div>
                        ) : (
                          <span className="text-slate-400">---</span>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        {prediction ? (
                          <span className={`font-medium capitalize ${
                            prediction.trend === 'bullish' ? 'text-emerald-600' :
                            prediction.trend === 'bearish' ? 'text-red-600' : 'text-slate-600'
                          }`}>
                            {prediction.trend}
                          </span>
                        ) : (
                          <span className="text-slate-400">---</span>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        {prediction ? (
                          <span className={`font-medium ${
                            prediction.rsi > 70 ? 'text-red-600' :
                            prediction.rsi < 30 ? 'text-emerald-600' : 'text-blue-600'
                          }`}>
                            {prediction.rsi.toFixed(1)}
                          </span>
                        ) : (
                          <span className="text-slate-400">---</span>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        {dataSource === 'live' ? (
                          <span className="flex items-center justify-end text-emerald-600 text-xs">
                            <Wifi className="w-3 h-3 mr-1" />
                            Live
                          </span>
                        ) : (
                          <span className="flex items-center justify-end text-slate-400 text-xs">
                            <WifiOff className="w-3 h-3 mr-1" />
                            N/A
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <TradeSettings currencyData={filteredAndSortedData} />

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl shadow-md p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-slate-600">Avg Confidence</h3>
              <Brain className="w-4 h-4 text-indigo-500" />
            </div>
            <div className="text-2xl font-bold text-slate-800">
              {Math.round(
                filteredAndSortedData
                  .filter(d => d.prediction?.confidence)
                  .reduce((sum, d) => sum + d.prediction.confidence, 0) /
                Math.max(filteredAndSortedData.filter(d => d.prediction?.confidence).length, 1)
              )}%
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Real-time analysis
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-md p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-slate-600">High Confidence</h3>
              <Target className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="text-2xl font-bold text-emerald-600">
              {filteredAndSortedData.filter(d => d.prediction?.confidence >= 75).length}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Pairs above 75%
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-md p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-slate-600">Bullish Trends</h3>
              <TrendingUp className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="text-2xl font-bold text-emerald-600">
              {filteredAndSortedData.filter(d => d.prediction?.trend === 'bullish').length}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Live market data
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-md p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-slate-600">Live Pairs</h3>
              <Wifi className="w-4 h-4 text-blue-500" />
            </div>
            <div className="text-2xl font-bold text-blue-600">
              {filteredAndSortedData.filter(d => d.dataSource === 'live').length}/{CURRENCY_PAIRS.length}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Connected sources
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-slate-800 flex items-center">
              <BarChart3 className="w-5 h-5 mr-2 text-indigo-600" />
              Live Market Overview
            </h2>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setShowPredictions(!showPredictions)}
                className="flex items-center text-sm text-slate-600 hover:text-indigo-600 transition-colors"
              >
                {showPredictions ? <EyeOff className="w-4 h-4 mr-1" /> : <Eye className="w-4 h-4 mr-1" />}
                {showPredictions ? 'Hide' : 'Show'} RSI
              </button>
            </div>
          </div>

          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={filteredAndSortedData.slice(0, 8)} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="pair.symbol" 
                tick={{ fontSize: 12 }}
                interval={0}
                angle={-45}
                textAnchor="end"
                height={80}
              />
              <YAxis 
                tick={{ fontSize: 12 }}
                label={{ value: 'Value', angle: -90, position: 'insideLeft' }}
              />
              <Tooltip 
                formatter={(value, name) => [
                  name === 'prediction.confidence' ? `${value}%` : 
                  name === 'prediction.rsi' ? `${value.toFixed(1)}` : 
                  value?.toFixed ? value.toFixed(2) : value, 
                  name === 'prediction.confidence' ? 'Confidence' :
                  name === 'prediction.rsi' ? 'RSI' : name
                ]}
                labelFormatter={(label) => `Pair: ${label}`}
                contentStyle={{ 
                  backgroundColor: '#f8fafc', 
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px'
                }}
              />
              <Legend />
              <Bar 
                dataKey="prediction.confidence" 
                name="Confidence %"
                fill="#6366f1"
                radius={[4, 4, 0, 0]}
              />
              {showPredictions && (
                <Bar 
                  dataKey={(data) => data.prediction?.rsi || 0}
                  name="RSI"
                  fill="#10b981"
                  radius={[4, 4, 0, 0]}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-4">
          <div className="text-center text-sm text-slate-500">
            <div className="flex items-center justify-center space-x-4 mb-2">
              <span className="flex items-center">
                <Wifi className="w-4 h-4 mr-1" />
                Real-Time Market Data
              </span>
              <span className="flex items-center">
                <Brain className="w-4 h-4 mr-1" />
                AI-Powered Predictions
              </span>
              <span className="flex items-center">
                <Target className="w-4 h-4 mr-1" />
                Multi-Indicator Analysis
              </span>
            </div>
            <div className="text-xs text-slate-400">
              Data sources: Frankfurter API, ExchangeRate-API, Metals Live API • Updates every 5 seconds
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForexDashboard;
