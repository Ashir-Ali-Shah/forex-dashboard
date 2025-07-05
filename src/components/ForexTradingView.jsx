import React, { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, TrendingUp, TrendingDown, Eye, Star, Clock, Settings, Target, Calculator, ArrowUp, ArrowDown, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';

// Advanced currency pairs with additional metadata
const TRADING_PAIRS = [
  { 
    symbol: 'XAUUSD', 
    base: 'XAU', 
    quote: 'USD', 
    name: 'Gold/USD',
    type: 'commodity',
    volatility: 'high',
    spread: 0.5,
    session: 'london'
  },
  { 
    symbol: 'EURUSD', 
    base: 'EUR', 
    quote: 'USD', 
    name: 'EUR/USD',
    type: 'major',
    volatility: 'medium',
    spread: 0.1,
    session: 'london'
  },
  { 
    symbol: 'GBPUSD', 
    base: 'GBP', 
    quote: 'USD', 
    name: 'GBP/USD',
    type: 'major',
    volatility: 'high',
    spread: 0.2,
    session: 'london'
  },
  { 
    symbol: 'USDJPY', 
    base: 'USD', 
    quote: 'JPY', 
    name: 'USD/JPY',
    type: 'major',
    volatility: 'medium',
    spread: 0.1,
    session: 'tokyo'
  }
];

// Forex Predictor Class
class ForexPredictor {
  constructor() {
    this.historicalData = {};
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
  }

  calculateMovingAverage(data, window) {
    if (data.length < window) return null;
    const slice = data.slice(-window);
    return slice.reduce((acc, item) => acc + item.price, 0) / window;
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

  predictNextPrice(symbol) {
    const data = this.historicalData[symbol];
    if (!data || data.length < 5) return null;

    const sma5 = this.calculateMovingAverage(data, 5);
    const sma10 = this.calculateMovingAverage(data, 10);
    const momentum = this.calculateMomentum(data);
    const volatility = this.calculateVolatility(data);
    const currentPrice = data[data.length - 1].price;
    
    // Trend analysis
    let trend = 'neutral';
    if (sma5 && sma10) {
      if (sma5 > sma10 * 1.002) trend = 'bullish';
      else if (sma5 < sma10 * 0.998) trend = 'bearish';
    }
    
    // Confidence calculation
    const confidence = Math.min(95, Math.max(20, 
      (data.length / 30) * 100 * (1 - Math.min(volatility * 20, 0.7))
    ));
    
    // Price prediction
    const momentumPrediction = currentPrice * (1 + momentum * 0.3);
    const smaPrediction = sma5 || currentPrice;
    let predictedPrice = (momentumPrediction * 0.4 + smaPrediction * 0.6);
    
    // Adjust prediction based on trend
    const volatilityAdjustment = volatility * 0.05;
    if (trend === 'bullish') predictedPrice += volatilityAdjustment;
    if (trend === 'bearish') predictedPrice -= volatilityAdjustment;
    
    return {
      predictedPrice,
      confidence,
      trend,
      momentum,
      volatility,
      sma5,
      sma10
    };
  }
}

// Trading Card Component
const TradingCard = ({ 
  pair, 
  rate, 
  change, 
  changePercent, 
  historicalData, 
  isWatchlisted, 
  onToggleWatchlist,
  prediction,
  isSelected,
  onClick
}) => {
  const isPositive = change >= 0;
  const volatilityColors = {
    low: 'text-green-500',
    medium: 'text-yellow-500',
    high: 'text-red-500'
  };

  const formatRate = (rate) => {
    if (pair.symbol.includes('JPY')) return rate.toFixed(3);
    if (pair.symbol === 'XAUUSD') return rate.toFixed(2);
    return rate.toFixed(4);
  };

  const getSignal = () => {
    if (!prediction) return 'neutral';
    
    const priceDirection = prediction.predictedPrice > rate ? 'bullish' : 'bearish';
    
    // Conflict detection
    if (prediction.trend !== priceDirection && prediction.trend !== 'neutral') {
      return 'conflict';
    }
    
    // Signal generation
    if (prediction.predictedPrice > rate * 1.001) return 'buy';
    if (prediction.predictedPrice < rate * 0.999) return 'sell';
    return 'neutral';
  };

  const signal = getSignal();
  const signalColors = {
    buy: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    sell: 'bg-red-100 text-red-800 border-red-200',
    neutral: 'bg-gray-100 text-gray-800 border-gray-200',
    conflict: 'bg-amber-100 text-amber-800 border-amber-200'
  };

  return (
    <div 
      className={`bg-white rounded-lg shadow-md hover:shadow-lg transition-all duration-200 border ${
        isSelected ? 'border-blue-500 ring-2 ring-blue-300' : 'border-gray-200'
      } cursor-pointer`}
      onClick={() => onClick(pair.symbol)}
    >
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-lg text-gray-900">{pair.symbol}</h3>
            <p className="text-sm text-gray-500">{pair.name}</p>
          </div>
          <div className="flex items-center space-x-2">
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
              pair.type === 'major' ? 'bg-blue-100 text-blue-800' : 
              pair.type === 'commodity' ? 'bg-yellow-100 text-yellow-800' :
              'bg-green-100 text-green-800'
            }`}>
              {pair.type.toUpperCase()}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleWatchlist(pair.symbol);
              }}
              className={`p-1 rounded ${isWatchlisted ? 'text-yellow-500' : 'text-gray-400 hover:text-yellow-500'}`}
            >
              <Star className={`w-4 h-4 ${isWatchlisted ? 'fill-current' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-2xl font-bold text-gray-900">
            {formatRate(rate)}
          </div>
          <div className={`flex items-center space-x-1 ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
            {isPositive ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
            <span className="font-medium">{Math.abs(change).toFixed(4)}</span>
            <span className="text-sm">({Math.abs(changePercent).toFixed(2)}%)</span>
          </div>
        </div>

        <div className="h-16 mb-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={historicalData}>
              <Line 
                type="monotone" 
                dataKey="value" 
                stroke={isPositive ? "#10b981" : "#ef4444"} 
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {prediction && (
          <div className={`mb-3 px-3 py-2 rounded-md text-sm font-medium text-center ${signalColors[signal]}`}>
            {signal === 'buy' && 'BUY Signal'}
            {signal === 'sell' && 'SELL Signal'}
            {signal === 'neutral' && 'Neutral'}
            {signal === 'conflict' && 'Conflict Detected'}
          </div>
        )}

        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-gray-500">Spread</p>
            <p className="font-medium">{pair.spread} pips</p>
          </div>
          <div>
            <p className="text-gray-500">Volatility</p>
            <p className={`font-medium capitalize ${volatilityColors[pair.volatility]}`}>
              {pair.volatility}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Session</p>
            <p className="font-medium capitalize">{pair.session}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

// Trade Settings Component
const TradeSettings = ({ 
  selectedPair, 
  prediction, 
  currentRate,
  onRiskChange,
  onPairChange,
  riskSettings
}) => {
  const [expanded, setExpanded] = useState(true);
  
  if (!selectedPair || !prediction) return null;
  
  const getSignal = () => {
    const priceDirection = prediction.predictedPrice > currentRate ? 'bullish' : 'bearish';
    
    // Conflict detection
    if (prediction.trend !== priceDirection && prediction.trend !== 'neutral') {
      return { signal: 'HOLD', conflict: true };
    }
    
    // Signal generation
    if (prediction.predictedPrice > currentRate * 1.001) return { signal: 'BUY', conflict: false };
    if (prediction.predictedPrice < currentRate * 0.999) return { signal: 'SELL', conflict: false };
    return { signal: 'HOLD', conflict: false };
  };

  const { signal, conflict } = getSignal();
  const pips = selectedPair.includes('JPY') ? 0.01 : 0.0001;
  
  // Calculate SL and TP based on volatility
  const atr = prediction.volatility * currentRate;
  const slDistance = atr * 2;
  const tpDistance = slDistance * riskSettings.riskReward;
  
  const sl = signal === 'BUY' ? currentRate - slDistance : currentRate + slDistance;
  const tp = signal === 'BUY' ? currentRate + tpDistance : currentRate - tpDistance;
  
  // Lot size calculation
  const riskAmount = riskSettings.accountBalance * (riskSettings.riskPercent / 100);
  const slPips = Math.abs(currentRate - sl) / pips;
  const pipValue = selectedPair.endsWith('USD') ? 10 : 10;
  const lotSize = Math.min(10, Math.max(0.01, riskAmount / (slPips * pipValue)));
  
  const formatRate = (rate) => {
    if (selectedPair.includes('JPY')) return rate.toFixed(3);
    if (selectedPair === 'XAUUSD') return rate.toFixed(2);
    return rate.toFixed(4);
  };

  return (
    <div className="bg-white rounded-lg shadow-md mb-6 overflow-hidden">
      <div 
        className="p-4 border-b border-gray-200 flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <h3 className="font-bold text-gray-800 flex items-center">
          <Settings className="w-5 h-5 mr-2 text-blue-600" />
          Trade Settings & Signals
        </h3>
        {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
      </div>
      
      {expanded && (
        <div className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Currency Pair
                </label>
                <select 
                  value={selectedPair}
                  onChange={(e) => onPairChange(e.target.value)}
                  className="w-full bg-gray-100 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {TRADING_PAIRS.map(pair => (
                    <option key={pair.symbol} value={pair.symbol}>
                      {pair.symbol} - {pair.name}
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Risk %</label>
                  <input
                    type="number"
                    min="0.5"
                    max="10"
                    step="0.5"
                    value={riskSettings.riskPercent}
                    onChange={(e) => onRiskChange('riskPercent', e.target.value)}
                    className="w-full bg-gray-100 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">R:R Ratio</label>
                  <input
                    type="number"
                    min="1"
                    max="5"
                    step="0.5"
                    value={riskSettings.riskReward}
                    onChange={(e) => onRiskChange('riskReward', e.target.value)}
                    className="w-full bg-gray-100 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Balance ($)</label>
                  <input
                    type="number"
                    min="1000"
                    value={riskSettings.accountBalance}
                    onChange={(e) => onRiskChange('accountBalance', e.target.value)}
                    className="w-full bg-gray-100 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
            
            <div className="bg-blue-50 rounded-lg p-4">
              <h4 className="font-medium text-gray-800 mb-3 flex items-center">
                <Target className="w-4 h-4 mr-2 text-blue-600" />
                Trading Signal
              </h4>
              
              {signal !== 'HOLD' ? (
                <div className="space-y-4">
                  <div className={`p-3 rounded-lg text-center font-bold ${
                    signal === 'BUY' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 
                    'bg-red-100 text-red-800 border border-red-200'
                  }`}>
                    {signal} Signal ({prediction.confidence}% confidence)
                    {conflict && (
                      <div className="mt-2 flex items-center justify-center text-sm font-normal text-amber-700">
                        <AlertTriangle className="w-4 h-4 mr-1" />
                        Conflict detected between trend and prediction
                      </div>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white p-3 rounded border">
                      <div className="text-sm text-gray-600">Entry</div>
                      <div className="font-bold">{formatRate(currentRate)}</div>
                    </div>
                    <div className="bg-white p-3 rounded border">
                      <div className="text-sm text-gray-600">Lot Size</div>
                      <div className="font-bold">{lotSize.toFixed(2)}</div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white p-3 rounded border border-red-200">
                      <div className="text-sm text-red-600">Stop Loss</div>
                      <div className="font-bold text-red-700">{formatRate(sl)}</div>
                      <div className="text-xs text-red-600">{Math.round(slPips)} pips</div>
                    </div>
                    <div className="bg-white p-3 rounded border border-emerald-200">
                      <div className="text-sm text-emerald-600">Take Profit</div>
                      <div className="font-bold text-emerald-700">{formatRate(tp)}</div>
                      <div className="text-xs text-emerald-600">
                        {Math.round(Math.abs(tp - currentRate) / pips)} pips
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-gray-100 rounded-lg text-center">
                  <div className="text-gray-700 font-medium">No trading signal</div>
                  <div className="text-sm text-gray-600 mt-1">
                    Market conditions are neutral
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Market Status Component
const MarketStatus = () => {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const getMarketSession = () => {
    const hour = currentTime.getUTCHours();
    if (hour >= 22 || hour < 5) return { name: 'Sydney', status: 'active', color: 'text-green-500' };
    if (hour >= 0 && hour < 9) return { name: 'Tokyo', status: 'active', color: 'text-blue-500' };
    if (hour >= 8 && hour < 17) return { name: 'London', status: 'active', color: 'text-purple-500' };
    if (hour >= 13 && hour < 22) return { name: 'New York', status: 'active', color: 'text-orange-500' };
    return { name: 'Closed', status: 'inactive', color: 'text-gray-500' };
  };

  const session = getMarketSession();

  return (
    <div className="bg-gradient-to-r from-slate-800 to-slate-900 rounded-lg p-6 text-white mb-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold mb-2 flex items-center">
            <Activity className="w-5 h-5 mr-2" />
            Market Status
          </h2>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Clock className="w-4 h-4" />
              <span>{currentTime.toLocaleTimeString()}</span>
            </div>
            <div className={`flex items-center space-x-2 ${session.color}`}>
              <div className="w-2 h-2 rounded-full bg-current animate-pulse"></div>
              <span>{session.name} Session</span>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm opacity-80">Active Trading</div>
          <div className="text-2xl font-bold">24/7</div>
        </div>
      </div>
    </div>
  );
};

// Main Trading View Component
const ForexTradingView = () => {
  const [forexRates, setForexRates] = useState({});
  const [previousRates, setPreviousRates] = useState({});
  const [watchlist, setWatchlist] = useState(new Set(['EURUSD', 'XAUUSD']));
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [selectedPair, setSelectedPair] = useState('EURUSD');
  const [riskSettings, setRiskSettings] = useState({
    riskPercent: 2,
    riskReward: 2,
    accountBalance: 10000
  });
  const [predictor] = useState(new ForexPredictor());
  const [predictions, setPredictions] = useState({});
  const [highestConfidencePair, setHighestConfidencePair] = useState(null);

  // Fetch real-time forex data
  const fetchData = useCallback(async () => {
    try {
      const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
      
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      
      const data = await response.json();
      
      setPreviousRates(forexRates);
      
      const newRates = {};
      TRADING_PAIRS.forEach(pair => {
        const rate = calculateRate(data.rates, pair.base, pair.quote);
        newRates[pair.symbol] = rate;
        predictor.addDataPoint(pair.symbol, rate);
      });
      
      // Get predictions
      const newPredictions = {};
      let highestConfidence = 0;
      let highestPair = null;
      
      TRADING_PAIRS.forEach(pair => {
        const prediction = predictor.predictNextPrice(pair.symbol);
        newPredictions[pair.symbol] = prediction;
        
        if (prediction && prediction.confidence > highestConfidence) {
          highestConfidence = prediction.confidence;
          highestPair = pair.symbol;
        }
      });
      
      setPredictions(newPredictions);
      setHighestConfidencePair(highestPair);
      setForexRates(newRates);
      setLastUpdate(new Date());
      setIsLoading(false);
    } catch (err) {
      setError('Failed to fetch forex data');
      setIsLoading(false);
    }
  }, [forexRates, predictor]);

  // Calculate pair rate from base USD rates
  const calculateRate = (rates, baseCurrency, quoteCurrency) => {
    if (baseCurrency === 'USD') {
      return rates[quoteCurrency] || 1;
    } else if (quoteCurrency === 'USD') {
      return 1 / (rates[baseCurrency] || 1);
    } else {
      return (1 / rates[baseCurrency]) * rates[quoteCurrency] || 1;
    }
  };

  // Generate historical data points for mini charts
  const generateHistoricalData = (currentRate, points = 20) => {
    const data = [];
    let rate = currentRate * 0.999;
    
    for (let i = 0; i < points; i++) {
      const variation = (Math.random() - 0.5) * 0.001;
      rate += variation;
      data.push({
        time: `${i}m`,
        value: parseFloat(rate.toFixed(4))
      });
    }
    
    data[data.length - 1].value = currentRate;
    return data;
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const toggleWatchlist = (symbol) => {
    const newWatchlist = new Set(watchlist);
    if (newWatchlist.has(symbol)) {
      newWatchlist.delete(symbol);
    } else {
      newWatchlist.add(symbol);
    }
    setWatchlist(newWatchlist);
  };

  const getChangeData = (symbol) => {
    const current = forexRates[symbol] || 0;
    const previous = previousRates[symbol] || current;
    const change = current - previous;
    const changePercent = previous ? (change / previous) * 100 : 0;
    return { change, changePercent };
  };

  const handleRiskChange = (field, value) => {
    setRiskSettings(prev => ({
      ...prev,
      [field]: Number(value)
    }));
  };

  const handlePairSelect = (symbol) => {
    setSelectedPair(symbol);
  };

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center p-8">
          <div className="text-red-500 mb-4">
            <Activity className="w-16 h-16 mx-auto" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Connection Error</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button 
            onClick={fetchData}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Forex Trading Dashboard</h1>
              <p className="text-gray-600">Professional real-time market analysis</p>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-sm text-gray-500">
                {lastUpdate && `Last updated: ${lastUpdate.toLocaleTimeString()}`}
              </div>
              <div className="flex items-center space-x-2">
                <Eye className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-600">{watchlist.size} Watchlisted</span>
              </div>
            </div>
          </div>
        </div>

        <MarketStatus />

        <TradeSettings 
          selectedPair={selectedPair}
          prediction={predictions[selectedPair]}
          currentRate={forexRates[selectedPair]}
          onRiskChange={handleRiskChange}
          onPairChange={handlePairSelect}
          riskSettings={riskSettings}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          {TRADING_PAIRS.map(pair => {
            const rate = forexRates[pair.symbol] || 0;
            const { change, changePercent } = getChangeData(pair.symbol);
            const historicalData = generateHistoricalData(rate);
            
            return (
              <TradingCard
                key={pair.symbol}
                pair={pair}
                rate={rate}
                change={change}
                changePercent={changePercent}
                historicalData={historicalData}
                isWatchlisted={watchlist.has(pair.symbol)}
                onToggleWatchlist={toggleWatchlist}
                prediction={predictions[pair.symbol]}
                isSelected={selectedPair === pair.symbol}
                onClick={handlePairSelect}
              />
            );
          })}
        </div>

        {isLoading && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg shadow-lg">
              <div className="flex items-center space-x-3">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                <span className="text-gray-700">Loading market data...</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ForexTradingView;
