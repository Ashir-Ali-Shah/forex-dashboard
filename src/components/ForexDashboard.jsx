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
  Line
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
  Zap,
  Clock,
  Signal,
  Minus,
  Wifi,
  Calculator,
  ArrowUp,
  ArrowDown,
  BarChart2,
  Eye,
  EyeOff,
  Globe,
  ChevronDown,
  ChevronUp,
  Settings
} from 'lucide-react';

// Utility function for momentum direction
const getMomentumDirection = (momentum) => {
  if (momentum > 0.001) return { direction: 'Strong Up', color: 'text-emerald-600', icon: TrendingUp };
  if (momentum > 0) return { direction: 'Up', color: 'text-green-500', icon: TrendingUp };
  if (momentum < -0.001) return { direction: 'Strong Down', color: 'text-red-600', icon: TrendingDown };
  if (momentum < 0) return { direction: 'Down', color: 'text-red-500', icon: TrendingDown };
  return { direction: 'Flat', color: 'text-slate-500', icon: Minus };
};

// Currency pairs configuration
const CURRENCY_PAIRS = [
  { symbol: 'XAUUSD', base: 'XAU', quote: 'USD', name: 'Gold/USD', type: 'commodity' },
  { symbol: 'EURUSD', base: 'EUR', quote: 'USD', name: 'EUR/USD', type: 'major' },
  { symbol: 'GBPUSD', base: 'GBP', quote: 'USD', name: 'GBP/USD', type: 'major' },
  { symbol: 'USDCAD', base: 'USD', quote: 'CAD', name: 'USD/CAD', type: 'major' },
  { symbol: 'USDCHF', base: 'USD', quote: 'CHF', name: 'USD/CHF', type: 'major' },
  { symbol: 'USDJPY', base: 'USD', quote: 'JPY', name: 'USD/JPY', type: 'major' },
  { symbol: 'AUDCAD', base: 'AUD', quote: 'CAD', name: 'AUD/CAD', type: 'cross' },
  { symbol: 'AUDCHF', base: 'AUD', quote: 'CHF', name: 'AUD/CHF', type: 'cross' },
  { symbol: 'AUDJPY', base: 'AUD', quote: 'JPY', name: 'AUD/JPY', type: 'cross' },
  { symbol: 'AUDNZD', base: 'AUD', quote: 'NZD', name: 'AUD/NZD', type: 'cross' }
];

// Simulate real-time forex data with realistic fluctuations
const generateRealisticRate = (symbol, previousRate) => {
  const baseRates = {
    'XAUUSD': 2000 + Math.random() * 100,
    'EURUSD': 1.08 + Math.random() * 0.1,
    'GBPUSD': 1.25 + Math.random() * 0.1,
    'USDCAD': 1.35 + Math.random() * 0.1,
    'USDCHF': 0.90 + Math.random() * 0.1,
    'USDJPY': 150 + Math.random() * 10,
    'AUDCAD': 0.91 + Math.random() * 0.05,
    'AUDCHF': 0.60 + Math.random() * 0.05,
    'AUDJPY': 98 + Math.random() * 5,
    'AUDNZD': 1.08 + Math.random() * 0.05
  };

  if (previousRate) {
    // Generate realistic price movement (±0.5% max change)
    const maxChange = 0.005;
    const change = (Math.random() - 0.5) * 2 * maxChange;
    return previousRate * (1 + change);
  }
  
  return baseRates[symbol] || 1;
};

// Enhanced Linear Regression Analysis
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
    
    // Calculate means
    const meanX = x.reduce((a, b) => a + b, 0) / n;
    const meanY = y.reduce((a, b) => a + b, 0) / n;
    
    // Calculate slope and intercept
    const numerator = x.reduce((acc, xi, i) => acc + (xi - meanX) * (y[i] - meanY), 0);
    const denominator = x.reduce((acc, xi) => acc + Math.pow(xi - meanX, 2), 0);
    
    this.slope = denominator !== 0 ? numerator / denominator : 0;
    this.intercept = meanY - this.slope * meanX;
    
    // Calculate R-squared
    const totalSumSquares = y.reduce((acc, yi) => acc + Math.pow(yi - meanY, 2), 0);
    const residualSumSquares = y.reduce((acc, yi, i) => {
      const predicted = this.slope * x[i] + this.intercept;
      return acc + Math.pow(yi - predicted, 2);
    }, 0);
    
    this.rSquared = totalSumSquares !== 0 ? 1 - (residualSumSquares / totalSumSquares) : 0;
    
    // Calculate standard error
    this.standardError = Math.sqrt(residualSumSquares / Math.max(n - 2, 1));
    
    return this;
  }

  predict(steps = 1) {
    const nextX = this.dataPoints.length + steps - 1;
    const prediction = this.slope * nextX + this.intercept;
    
    // Calculate confidence interval (95%)
    const t_value = 1.96;
    const margin = t_value * this.standardError;
    
    return {
      prediction: prediction,
      upperBound: prediction + margin,
      lowerBound: prediction - margin,
      confidence: Math.max(0, Math.min(100, this.rSquared * 100))
    };
  }

  getPredictionSeries(steps = 5) {
    const series = [];
    for (let i = 1; i <= steps; i++) {
      const result = this.predict(i);
      series.push({
        step: i,
        ...result,
        timestamp: Date.now() + (i * 30000)
      });
    }
    return series;
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

// Enhanced Forex Predictor
class ForexPredictor {
  constructor(windowSize = 10) {
    this.windowSize = windowSize;
    this.historicalData = {};
    this.linearModels = {};
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

  calculateMovingAverage(data, window) {
    if (data.length < window) return null;
    
    const slice = data.slice(-window);
    const sum = slice.reduce((acc, item) => acc + item.price, 0);
    return sum / window;
  }

  calculateMomentum(data, periods = 5) {
    if (data.length < periods + 1) return 0;
    
    const current = data[data.length - 1].price;
    const previous = data[data.length - 1 - periods].price;
    return (current - previous) / previous;
  }

  calculateVolatility(data, periods = 10) {
    if (data.length < periods) return 0;
    
    const prices = data.slice(-periods).map(d => d.price);
    const mean = prices.reduce((a, b) => a + b) / prices.length;
    const variance = prices.reduce((acc, price) => acc + Math.pow(price - mean, 2), 0) / prices.length;
    return Math.sqrt(variance);
  }

  calculateRSI(data, periods = 14) {
    if (data.length < periods + 1) return 50;
    
    const changes = [];
    for (let i = 1; i < data.length; i++) {
      changes.push(data[i].price - data[i-1].price);
    }
    
    const recentChanges = changes.slice(-periods);
    const gains = recentChanges.filter(c => c > 0);
    const losses = recentChanges.filter(c => c < 0).map(c => Math.abs(c));
    
    const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / periods : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / periods : 0;
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
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

    const sma5 = this.calculateMovingAverage(data, 5);
    const sma10 = this.calculateMovingAverage(data, Math.min(10, data.length));
    const sma20 = this.calculateMovingAverage(data, Math.min(20, data.length));
    const momentum = this.calculateMomentum(data);
    const volatility = this.calculateVolatility(data);
    const rsi = this.calculateRSI(data);
    
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
    
    if (momentum > 0.001) {
      if (trend === 'bullish') trendStrength += 1;
      else if (trend === 'neutral') trend = 'bullish';
    } else if (momentum < -0.001) {
      if (trend === 'bearish') trendStrength += 1;
      else if (trend === 'neutral') trend = 'bearish';
    }

    if (rsi > 70) {
      if (trend === 'bearish') trendStrength += 0.5;
    } else if (rsi < 30) {
      if (trend === 'bullish') trendStrength += 0.5;
    }

    const momentumPrediction = currentPrice * (1 + momentum * 0.3);
    const smaPrediction = sma5 || currentPrice;
    const meanReversionPrediction = currentPrice + (sma20 - currentPrice) * 0.1;
    
    let finalPrediction = currentPrice;
    
    if (linearPrediction) {
      const linearWeight = Math.min(0.6, linearConfidence / 100);
      const technicalWeight = 1 - linearWeight;
      
      finalPrediction = (linearPrediction * linearWeight) + 
                       ((momentumPrediction * 0.4 + smaPrediction * 0.4 + meanReversionPrediction * 0.2) * technicalWeight);
    } else {
      finalPrediction = momentumPrediction * 0.4 + smaPrediction * 0.4 + meanReversionPrediction * 0.2;
    }

    const volatilityAdjustment = volatility * 0.05;
    if (trend === 'bullish') {
      finalPrediction += volatilityAdjustment;
    } else if (trend === 'bearish') {
      finalPrediction -= volatilityAdjustment;
    }

    const baseConfidence = Math.min(95, Math.max(20, 
      (data.length / 30) * 100 * (1 - Math.min(volatility * 20, 0.7))
    ));
    
    const confidence = linearConfidence > 0 ? 
      Math.round((baseConfidence + linearConfidence) / 2) : 
      Math.round(baseConfidence);

    return {
      predictedPrice: finalPrediction,
      confidence: confidence,
      trend: trend,
      trendStrength: trendStrength,
      method: 'hybrid_ml_linear',
      currentPrice: currentPrice,
      momentum: momentum,
      volatility: volatility,
      rsi: rsi,
      sma5: sma5,
      sma10: sma10,
      sma20: sma20,
      linearRegression: linearModel ? {
        prediction: linearPrediction,
        confidence: linearConfidence,
        trend: linearTrend,
        rSquared: linearModel.rSquared,
        slope: linearModel.slope,
        quality: linearModel.getModelQuality(),
        futurePredictions: linearModel.getPredictionSeries(5)
      } : null
    };
  }
}

// Enhanced Currency Card Component
const CurrencyCard = ({ pair, currentRate, previousRate, prediction, isLoading, lastUpdate }) => {
  const [showDetails, setShowDetails] = useState(false);
  
  const change = currentRate && previousRate ? currentRate - previousRate : 0;
  const changePercent = previousRate ? (change / previousRate) * 100 : 0;
  const isPositive = change >= 0;

  const typeColors = {
    major: 'from-blue-500 via-indigo-500 to-purple-600',
    cross: 'from-emerald-500 via-teal-500 to-cyan-600',
    commodity: 'from-amber-500 via-orange-500 to-red-600'
  };

  const formatPrice = (price) => {
    if (!price) return '---';
    if (pair.symbol.includes('JPY')) {
      return price.toFixed(3);
    }
    if (pair.symbol === 'XAUUSD') {
      return price.toFixed(2);
    }
    return price.toFixed(4);
  };

  const getTrendIcon = (trend) => {
    switch(trend) {
      case 'bullish': return <TrendingUp className="w-4 h-4 text-emerald-500" />;
      case 'bearish': return <TrendingDown className="w-4 h-4 text-red-500" />;
      default: return <Minus className="w-4 h-4 text-slate-500" />;
    }
  };

  const getConfidenceColor = (confidence) => {
    if (confidence >= 80) return 'text-emerald-700 bg-emerald-100 border-emerald-200';
    if (confidence >= 60) return 'text-amber-700 bg-amber-100 border-amber-200';
    return 'text-red-700 bg-red-100 border-red-200';
  };

  const getRSIColor = (rsi) => {
    if (rsi > 70) return 'text-red-600 bg-red-50'; // Overbought
    if (rsi < 30) return 'text-emerald-600 bg-emerald-50'; // Oversold
    return 'text-blue-600 bg-blue-50'; // Normal
  };

  const getVolatilityLevel = (volatility) => {
    if (volatility > 0.01) return { level: 'High', color: 'text-red-600', bgColor: 'bg-red-50' };
    if (volatility > 0.005) return { level: 'Medium', color: 'text-amber-600', bgColor: 'bg-amber-50' };
    return { level: 'Low', color: 'text-emerald-600', bgColor: 'bg-emerald-50' };
  };

  const momentumData = prediction?.momentum !== undefined ? getMomentumDirection(prediction.momentum) : null;

  return (
    <div className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 border border-slate-200 overflow-hidden group hover:scale-[1.02]">
      <div className={`h-2 bg-gradient-to-r ${typeColors[pair.type]}`}></div>
      
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-xl font-bold text-slate-800">{pair.symbol}</h3>
            <p className="text-sm text-slate-600">{pair.name}</p>
            <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold bg-gradient-to-r ${typeColors[pair.type]} text-white mt-2 shadow-sm`}>
              {pair.type.toUpperCase()}
            </span>
          </div>
          <div className={`p-3 rounded-full bg-gradient-to-r ${typeColors[pair.type]} shadow-md`}>
            <DollarSign className="w-5 h-5 text-white" />
          </div>
        </div>

        {isLoading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-10 bg-slate-200 rounded-lg w-32"></div>
            <div className="h-5 bg-slate-200 rounded w-20"></div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Current Price */}
            <div className="bg-slate-50 rounded-xl p-4">
              <div className="text-xs font-medium text-slate-500 mb-1 uppercase tracking-wide">Current Price</div>
              <div className="text-3xl font-bold text-slate-900 mb-2">
                {formatPrice(currentRate)}
              </div>
              
              {previousRate && (
                <div className={`flex items-center space-x-2 text-sm font-semibold ${
                  isPositive ? 'text-emerald-600' : 'text-red-600'
                }`}>
                  {isPositive ? (
                    <ArrowUp className="w-4 h-4" />
                  ) : (
                    <ArrowDown className="w-4 h-4" />
                  )}
                  <span>{Math.abs(change).toFixed(4)}</span>
                  <span className="text-slate-500">•</span>
                  <span>{Math.abs(changePercent).toFixed(2)}%</span>
                </div>
              )}
            </div>

            {/* Technical Indicators */}
            {prediction && (
              <div className="grid grid-cols-2 gap-3">
                {/* RSI */}
                {prediction.rsi && (
                  <div className={`p-3 rounded-lg border ${getRSIColor(prediction.rsi)}`}>
                    <div className="text-xs font-medium mb-1">RSI (14)</div>
                    <div className="font-bold">
                      {prediction.rsi.toFixed(1)}
                      {prediction.rsi > 70 && <span className="text-red-500 ml-1 text-xs">OB</span>}
                      {prediction.rsi < 30 && <span className="text-emerald-500 ml-1 text-xs">OS</span>}
                    </div>
                  </div>
                )}

                {/* Moving Averages */}
                {prediction.sma5 && (
                  <div className="bg-blue-50 border border-blue-200 p-3 rounded-lg">
                    <div className="text-blue-700 font-medium text-xs mb-1">SMA 5</div>
                    <div className="text-slate-800 font-bold">{formatPrice(prediction.sma5)}</div>
                  </div>
                )}
                
                {prediction.sma10 && (
                  <div className="bg-purple-50 border border-purple-200 p-3 rounded-lg">
                    <div className="text-purple-700 font-medium text-xs mb-1">SMA 10</div>
                    <div className="text-slate-800 font-bold">{formatPrice(prediction.sma10)}</div>
                  </div>
                )}

                {/* Volatility */}
                {prediction.volatility !== undefined && (
                  <div className={`p-3 rounded-lg border ${getVolatilityLevel(prediction.volatility).bgColor} border-slate-200`}>
                    <div className="text-slate-700 font-medium text-xs mb-1">Volatility</div>
                    <div className={`font-bold ${getVolatilityLevel(prediction.volatility).color}`}>
                      {getVolatilityLevel(prediction.volatility).level}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Overall Prediction */}
            {prediction && prediction.predictedPrice && (
              <div className="bg-gradient-to-br from-indigo-50 to-purple-100 rounded-xl p-4 border border-indigo-200">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-2">
                    <Brain className="w-4 h-4 text-indigo-600" />
                    <span className="text-sm font-semibold text-slate-700">AI Prediction</span>
                  </div>
                  {getTrendIcon(prediction.trend)}
                </div>
                
                <div className="text-xl font-bold text-indigo-700 mb-3">
                  {formatPrice(prediction.predictedPrice)}
                </div>
                
                <div className="flex items-center justify-between mb-3">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getConfidenceColor(prediction.confidence)}`}>
                    {prediction.confidence}% confidence
                  </span>
                  <span className="text-slate-600 capitalize flex items-center text-sm">
                    {getTrendIcon(prediction.trend)}
                    <span className="ml-1 font-medium">{prediction.trend}</span>
                    {prediction.trendStrength > 1 && (
                      <span className="ml-1 text-indigo-600 font-semibold">Strong</span>
                    )}
                  </span>
                </div>
                
                {prediction.predictedPrice && currentRate && (
                  <div className="bg-white bg-opacity-70 p-3 rounded-lg border border-white">
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-slate-600">Expected change:</span>
                      <span className={`font-bold ${((prediction.predictedPrice - currentRate) / currentRate * 100) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {((prediction.predictedPrice - currentRate) / currentRate * 100).toFixed(2)}%
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Method:</span>
                      <span className="text-indigo-600 font-semibold">Hybrid AI + Linear</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Future Predictions Toggle */}
            {prediction?.linearRegression?.futurePredictions && (
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="w-full bg-gradient-to-r from-blue-50 to-indigo-50 hover:from-blue-100 hover:to-indigo-100 text-blue-700 py-3 px-4 rounded-xl transition-all flex items-center justify-center border border-blue-200 font-medium"
              >
                {showDetails ? <EyeOff className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
                {showDetails ? 'Hide' : 'Show'} Future Predictions
                {showDetails ? <ChevronUp className="w-4 h-4 ml-2" /> : <ChevronDown className="w-4 h-4 ml-2" />}
              </button>
            )}

            {/* Future Predictions Details */}
            {showDetails && prediction?.linearRegression?.futurePredictions && (
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3">
                <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center">
                  <BarChart2 className="w-4 h-4 mr-2" />
                  Next 5 Predictions (AI)
                </h4>
                {prediction.linearRegression.futurePredictions.map((pred, index) => (
                  <div key={index} className="flex justify-between items-center bg-white p-3 rounded-lg border border-slate-200">
                    <span className="text-slate-600 font-medium">Step {pred.step}:</span>
                    <div className="text-right">
                      <div className="font-bold text-slate-800">{formatPrice(pred.prediction)}</div>
                      <div className="text-xs text-slate-500 mt-1">
                        ±{formatPrice(Math.abs(pred.upperBound - pred.prediction))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Last update and connection status */}
            <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
              <div className="flex items-center">
                <Clock className="w-3 h-3 mr-1" />
                <span>Updated: {lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : '--:--'}</span>
              </div>
              <div className="flex items-center">
                <Wifi className="w-3 h-3 mr-1 text-emerald-500" />
                <span>Live</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};


// Forex Dashboard Component
const ForexDashboard = () => {
  const [currencyData, setCurrencyData] = useState([]);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedPair, setSelectedPair] = useState('EURUSD');
  const [chartType, setChartType] = useState('area');
  const [timeFrame, setTimeFrame] = useState('1h');
  const [predictor] = useState(new ForexPredictor());

  // Fetch forex data
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const simulatedData = CURRENCY_PAIRS.map(pair => {
        const previousData = currencyData.find(d => d.pair.symbol === pair.symbol) || {};
        const currentRate = generateRealisticRate(pair.symbol, previousData.currentRate);
        
        // Add data point to predictor
        predictor.addDataPoint(pair.symbol, currentRate);
        
        return {
          pair,
          currentRate,
          previousRate: previousData.currentRate || currentRate,
          prediction: predictor.predictNextPrice(pair.symbol),
          history: [...(previousData.history || []).slice(-59), { rate: currentRate, timestamp: Date.now() }],
          lastUpdate: Date.now()
        };
      });
      
      setCurrencyData(simulatedData);
      setLastUpdate(Date.now());
      setError(null);
    } catch (err) {
      setError('Failed to generate data');
    } finally {
      setLoading(false);
    }
  }, [currencyData, predictor]);

  // Initial data fetch
  useEffect(() => {
    fetchData();
  }, []);

  // Set up refresh interval
  useEffect(() => {
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Get selected currency data for charts
  const selectedCurrency = currencyData.find(d => d.pair.symbol === selectedPair) || {};
  const chartData = selectedCurrency.history || [];

  // Render chart based on selected type
  const renderChart = () => {
    if (!chartData.length) return <div className="text-slate-500 text-center py-12">No data available</div>;
    
    const commonProps = {
      data: chartData,
      margin: { top: 10, right: 30, left: 0, bottom: 0 }
    };

    switch(chartType) {
      case 'area':
        return (
          <AreaChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis 
              dataKey="timestamp" 
              tickFormatter={(ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} 
            />
            <YAxis domain={['auto', 'auto']} />
            <Tooltip 
              labelFormatter={(ts) => new Date(ts).toLocaleTimeString()} 
              formatter={(value) => [value.toFixed(4), 'Price']}
            />
            <Area type="monotone" dataKey="rate" stroke="#8884d8" fill="#8884d8" fillOpacity={0.3} />
          </AreaChart>
        );
      case 'line':
        return (
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis 
              dataKey="timestamp" 
              tickFormatter={(ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} 
            />
            <YAxis domain={['auto', 'auto']} />
            <Tooltip 
              labelFormatter={(ts) => new Date(ts).toLocaleTimeString()} 
              formatter={(value) => [value.toFixed(4), 'Price']}
            />
            <Line type="monotone" dataKey="rate" stroke="#82ca9d" strokeWidth={2} dot={false} />
          </LineChart>
        );
      case 'bar':
        return (
          <BarChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis 
              dataKey="timestamp" 
              tickFormatter={(ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} 
            />
            <YAxis domain={['auto', 'auto']} />
            <Tooltip 
              labelFormatter={(ts) => new Date(ts).toLocaleTimeString()} 
              formatter={(value) => [value.toFixed(4), 'Price']}
            />
            <Bar dataKey="rate" fill="#8884d8" barSize={6} />
          </BarChart>
        );
      default:
        return null;
    }
  };

  // Render prediction chart
  const renderPredictionChart = () => {
    if (!selectedCurrency.prediction?.linearRegression?.futurePredictions) {
      return <div className="text-slate-500 text-center py-12">No prediction data available</div>;
    }
    
    const data = [
      ...selectedCurrency.history.slice(-10).map(d => ({ ...d, type: 'Historical' })),
      ...selectedCurrency.prediction.linearRegression.futurePredictions.map(p => ({
        timestamp: p.timestamp,
        rate: p.prediction,
        upperBound: p.upperBound,
        lowerBound: p.lowerBound,
        type: 'Prediction'
      }))
    ];
    
    return (
      <LineChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis 
          dataKey="timestamp" 
          tickFormatter={(ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} 
        />
        <YAxis domain={['auto', 'auto']} />
        <Tooltip 
          labelFormatter={(ts) => new Date(ts).toLocaleTimeString()} 
          formatter={(value, name) => [value.toFixed(4), name === 'rate' ? 'Price' : name]}
        />
        <Legend />
        <Line type="monotone" dataKey="rate" stroke="#82ca9d" strokeWidth={2} name="Price" dot={false} />
        <Line type="monotone" dataKey="upperBound" stroke="#8884d8" strokeDasharray="3 3" name="Upper Bound" dot={false} />
        <Line type="monotone" dataKey="lowerBound" stroke="#8884d8" strokeDasharray="3 3" name="Lower Bound" dot={false} />
      </LineChart>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="bg-gradient-to-r from-indigo-700 to-purple-800 text-white shadow-lg">
        <div className="container mx-auto px-4 py-6 flex flex-col md:flex-row justify-between items-center">
          <div className="flex items-center space-x-3 mb-4 md:mb-0">
            <DollarSign className="w-8 h-8" />
            <div>
              <h1 className="text-2xl font-bold">Forex Trading Dashboard</h1>
              <p className="text-indigo-200 text-sm flex items-center">
                <Wifi className="w-4 h-4 mr-1" />
                Live Data • Updated: {lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : '--:--'}
              </p>
            </div>
          </div>
          
          <div className="flex space-x-3">
            <button 
              onClick={fetchData}
              disabled={loading}
              className="flex items-center bg-white bg-opacity-20 hover:bg-opacity-30 px-4 py-2 rounded-lg transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh Data
            </button>
            
            
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded">
            <div className="flex items-center">
              <AlertCircle className="w-5 h-5 mr-2" />
              <span>{error}</span>
            </div>
          </div>
        )}
        
        {/* Currency Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-8">
          {currencyData.map(data => (
            <CurrencyCard 
              key={data.pair.symbol}
              pair={data.pair}
              currentRate={data.currentRate}
              previousRate={data.previousRate}
              prediction={data.prediction}
              isLoading={loading}
              lastUpdate={data.lastUpdate}
            />
          ))}
        </div>
        
        {/* Charts Section */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-8">
          <div className="flex flex-wrap items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-slate-800 flex items-center">
              <BarChart3 className="w-5 h-5 mr-2 text-indigo-600" />
              Market Analysis (Past Historical Data)
            </h2>
            
            <div className="flex flex-wrap gap-3">
              <select 
                value={selectedPair}
                onChange={(e) => setSelectedPair(e.target.value)}
                className="bg-slate-100 border border-slate-300 rounded-xl px-4 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-indigo-500"              >
                {CURRENCY_PAIRS.map(pair => (
                  <option key={pair.symbol} value={pair.symbol}>{pair.symbol}</option>
                ))}
              </select>
              
              <select 
                value={chartType}
                onChange={(e) => setChartType(e.target.value)}
                className="bg-slate-100 border border-slate-300 rounded-xl px-4 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-indigo-500"              >
                <option value="area">Area Chart</option>
                <option value="line">Line Chart</option>
                <option value="bar">Bar Chart</option>
              </select>
              
              <select 
                value={timeFrame}
                onChange={(e) => setTimeFrame(e.target.value)}
                className="bg-slate-100 border border-slate-300 rounded-xl px-4 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-indigo-500"              >
                <option value="30m">30 Minutes</option>
                
              </select>
            </div>
          </div>
          
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              {renderChart()}
            </ResponsiveContainer>
          </div>
        </div>
        
        {/* Prediction Chart */}
          
      </main>

      {/* Footer */}
      <footer className="bg-gradient-to-r from-slate-800 to-slate-900 text-white py-6">
        <div className="container mx-auto px-4 text-center text-sm text-slate-400">
          <p>Forex Trading Dashboard • AI-Powered Analytics • Data updates every 30 seconds</p>
        </div>
      </footer>
    </div>
  );
};

export default ForexDashboard;