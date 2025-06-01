import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, TrendingUp, TrendingDown, Eye, Star, Clock } from 'lucide-react';

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

// Fetch real-time forex data
const fetchForexRates = async () => {
  try {
    // Using exchangerate-api.com (free, no API key required)
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    
    if (!response.ok) {
      throw new Error('Network response was not ok');
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching data:', error);
    throw error;
  }
};

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
  let rate = currentRate * 0.999; // Start slightly lower
  
  for (let i = 0; i < points; i++) {
    const variation = (Math.random() - 0.5) * 0.001;
    rate += variation;
    data.push({
      time: `${i}m`,
      value: parseFloat(rate.toFixed(4))
    });
  }
  
  // Ensure last point is current rate
  data[data.length - 1].value = currentRate;
  return data;
};

// Advanced Trading Card Component
const TradingCard = ({ pair, rate, change, changePercent, historicalData, isWatchlisted, onToggleWatchlist }) => {
  const isPositive = change >= 0;
  const volatilityColors = {
    low: 'text-green-500',
    medium: 'text-yellow-500',
    high: 'text-red-500'
  };

  const formatRate = (rate) => {
    if (pair.symbol.includes('JPY')) {
      return rate.toFixed(3);
    } else if (pair.symbol === 'XAUUSD') {
      return rate.toFixed(2);
    }
    return rate.toFixed(4);
  };

  return (
    <div className="bg-white rounded-lg shadow-md hover:shadow-lg transition-all duration-200 border border-gray-200">
      {/* Header */}
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
              onClick={() => onToggleWatchlist(pair.symbol)}
              className={`p-1 rounded ${isWatchlisted ? 'text-yellow-500' : 'text-gray-400 hover:text-yellow-500'}`}
            >
              <Star className={`w-4 h-4 ${isWatchlisted ? 'fill-current' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Price Section */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-2xl font-bold text-gray-900">
            {formatRate(rate)}
          </div>
          <div className={`flex items-center space-x-1 ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
            {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            <span className="font-medium">{change.toFixed(4)}</span>
            <span className="text-sm">({changePercent.toFixed(2)}%)</span>
          </div>
        </div>

        {/* Mini Chart */}
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

        {/* Trading Info */}
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

  const fetchData = async () => {
    try {
      setError(null);
      const data = await fetchForexRates();
      
      setPreviousRates(forexRates);
      
      const newRates = {};
      TRADING_PAIRS.forEach(pair => {
        const rate = calculateRate(data.rates, pair.base, pair.quote);
        newRates[pair.symbol] = rate;
      });
      
      setForexRates(newRates);
      setLastUpdate(new Date());
      setIsLoading(false);
    } catch (err) {
      setError('Failed to fetch forex data');
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000); // Update every 15 seconds
    return () => clearInterval(interval);
  }, []);

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
        {/* Header */}
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

        {/* Market Status */}
        <MarketStatus />

        {/* Trading Cards */}
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
              />
            );
          })}
        </div>

        {/* Loading State */}
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