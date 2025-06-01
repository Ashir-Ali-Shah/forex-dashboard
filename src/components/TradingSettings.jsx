import React, { useState, useEffect, useCallback } from 'react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  RadialBarChart,
  RadialBar,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line
} from 'recharts';
import { 
  TrendingUp, 
  TrendingDown,
  PieChart as PieChartIcon, 
  Activity, 
  BarChart3, 
  Target,
  DollarSign,
  Percent,
  Settings,
  RefreshCw,
  AlertCircle
} from 'lucide-react';

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

// Real-time forex data fetcher
const fetchForexData = async () => {
  try {
    const response = await fetch(`https://api.exchangerate-api.com/v4/latest/USD`);
    
    if (!response.ok) {
      throw new Error('Failed to fetch forex data');
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching forex data:', error);
    try {
      const response = await fetch('https://api.fxratesapi.com/latest');
      const data = await response.json();
      return data;
    } catch (fallbackError) {
      throw new Error('All forex APIs failed');
    }
  }
};

// Calculate currency pair rates from base rates
const calculatePairRate = (baseRates, baseCurrency, quoteCurrency) => {
  if (baseCurrency === 'USD') {
    return baseRates[quoteCurrency] || 1;
  } else if (quoteCurrency === 'USD') {
    return 1 / (baseRates[baseCurrency] || 1);
  } else {
    const baseToUSD = 1 / (baseRates[baseCurrency] || 1);
    const quoteToUSD = 1 / (baseRates[quoteCurrency] || 1);
    return baseToUSD / quoteToUSD;
  }
};

// Generate historical-like data for demo
const generateHistoricalData = (currentRate, days = 30) => {
  const data = [];
  const baseDate = new Date();
  
  for (let i = days; i >= 0; i--) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() - i);
    
    const volatility = (Math.random() - 0.5) * 0.04;
    const rate = currentRate * (1 + volatility * (i / days));
    
    data.push({
      date: date.toISOString().split('T')[0],
      rate: parseFloat(rate.toFixed(4)),
      volume: Math.floor(Math.random() * 1000000) + 500000
    });
  }
  
  return data;
};

// Custom Tooltip Components
const CustomTooltip = ({ active, payload, label, formatter }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white/95 backdrop-blur-md p-4 border-0 rounded-xl shadow-2xl border border-gray-200/50">
        <p className="font-semibold text-gray-800 text-sm mb-2">{label}</p>
        {payload.map((entry, index) => (
          <div key={index} className="flex items-center gap-2 mb-1">
            <div 
              className="w-3 h-3 rounded-full" 
              style={{ backgroundColor: entry.color }}
            />
            <p className="text-gray-600 text-sm font-medium">
              {formatter ? formatter(entry.value, entry.name) : `${entry.name}: ${entry.value}`}
            </p>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

const TradingSettings = () => {
  // State for forex data
  const [forexData, setForexData] = useState({});
  const [historicalData, setHistoricalData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  
  // Trading settings state
  const [settings, setSettings] = useState({
    selectedPair: 'EURUSD',
    riskPercentage: 2.5,
    winRate: 65,
    riskRewardRatio: 1.8,
    accountBalance: 10000,
    lotSize: 0.1
  });

  // Chart data state
  const [performanceData, setPerformanceData] = useState([]);
  const [pairComparisonData, setPairComparisonData] = useState([]);
  const [riskData, setRiskData] = useState([]);
  const [riskComponents, setRiskComponents] = useState([]);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchForexData();
      
      // Convert base rates to our currency pairs
      const pairRates = {};
      CURRENCY_PAIRS.forEach(pair => {
        const rate = calculatePairRate(data.rates, pair.base, pair.quote);
        pairRates[pair.symbol] = rate;
      });
      
      setForexData(pairRates);
      
      // Generate historical data for selected pair
      if (pairRates[settings.selectedPair]) {
        const historical = generateHistoricalData(pairRates[settings.selectedPair]);
        setHistoricalData(historical);
      }
      
      setLastUpdate(new Date().toLocaleTimeString());
      setIsLoading(false);
    } catch (err) {
      setError(err.message);
      setIsLoading(false);
    }
  }, [settings.selectedPair]);

  // Generate dynamic chart data based on real forex rates
  useEffect(() => {
    if (Object.keys(forexData).length > 0) {
      // Performance scenarios based on current rates
      const scenarios = [
        { 
          scenario: 'Bearish', 
          return: -(settings.accountBalance * 0.15), 
          fill: '#ef4444',
          color: '#ef4444'
        },
        { 
          scenario: 'Conservative', 
          return: settings.accountBalance * 0.08, 
          fill: '#f59e0b',
          color: '#f59e0b'
        },
        { 
          scenario: 'Moderate', 
          return: settings.accountBalance * 0.18, 
          fill: '#3b82f6',
          color: '#3b82f6'
        },
        { 
          scenario: 'Aggressive', 
          return: settings.accountBalance * 0.35, 
          fill: '#10b981',
          color: '#10b981'
        }
      ];
      setPerformanceData(scenarios);

      // Currency pair comparison based on real rates
      const majorPairs = CURRENCY_PAIRS.slice(1, 7);
      const comparison = majorPairs.map((pair, index) => {
        const rate = forexData[pair.symbol] || 1;
        const volatility = Math.random() * 0.02 + 0.01;
        const expectedReturn = settings.accountBalance * volatility * (settings.winRate / 100);
        
        const colors = [
          '#8884d8', '#83a6ed', '#8dd1e1', '#82ca9d', 
          '#a4de6c', '#d0ed57', '#ffc658', '#ff8042'
        ];
        
        return {
          pair: pair.symbol,
          expectedReturn: expectedReturn,
          currentRate: rate,
          fill: colors[index % colors.length],
          color: colors[index % colors.length]
        };
      });
      setPairComparisonData(comparison);

      // Risk assessment
      const kellyCriterion = Math.max(0, ((settings.winRate / 100) - ((1 - settings.winRate / 100) / settings.riskRewardRatio)) * 100);
      const volatilityRisk = Math.min(100, (settings.riskPercentage * 10) + 
                                    ((100 - settings.winRate) * 0.5) + 
                                    (settings.riskRewardRatio * 5));
      const riskScore = Math.min(100, (kellyCriterion * 0.4) + (volatilityRisk * 0.6));
      
      setRiskData([
        { name: 'Overall Risk', value: riskScore, fill: '#ef4444' }
      ]);
      
      setRiskComponents([
        { name: 'Kelly Criterion', value: kellyCriterion, fill: '#10b981' },
        { name: 'Volatility', value: volatilityRisk, fill: '#f59e0b' }
      ]);
    }
  }, [forexData, settings]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleSettingChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  // Calculate expected value
  const calculateExpectedValue = () => {
    const winProbability = settings.winRate / 100;
    const lossProbability = 1 - winProbability;
    const riskAmount = settings.accountBalance * (settings.riskPercentage / 100);
    const winAmount = riskAmount * settings.riskRewardRatio;
    
    return (winAmount * winProbability) - (riskAmount * lossProbability);
  };

  // Calculate ROI with compounding effect
  const calculateROI = () => {
    const monthlyTrades = 20;
    const expectedValue = calculateExpectedValue();
    
    let balance = settings.accountBalance;
    const monthlyReturns = [];
    
    for (let i = 0; i < 12; i++) {
      balance += expectedValue * monthlyTrades;
      const roi = ((balance - settings.accountBalance) / settings.accountBalance) * 100;
      monthlyReturns.push({
        month: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i],
        roi: roi,
        balance: balance
      });
    }
    
    return monthlyReturns;
  };

  // Calculate annualized ROI percentage
  const calculateAnnualizedROI = () => {
    const monthlyTrades = 20;
    const expectedValue = calculateExpectedValue();
    const monthlyReturn = expectedValue * monthlyTrades;
    const annualReturn = monthlyReturn * 12;
    return (annualReturn / settings.accountBalance) * 100;
  };

  const expectedValue = calculateExpectedValue();
  const roiData = calculateROI();
  const roiPercentage = calculateAnnualizedROI();

  const recommendation = {
    text: expectedValue > 0 ? 'Profitable Strategy' : 'High Risk Strategy',
    color: expectedValue > 0 ? 'text-green-600' : 'text-red-600',
    icon: expectedValue > 0 ? TrendingUp : TrendingDown
  };

  // Color scheme for consistent styling
  const chartColors = {
    areaFill: '#3b82f6',
    bearish: '#ef4444',
    conservative: '#f59e0b',
    moderate: '#3b82f6',
    aggressive: '#10b981',
    winRate: '#10b981',
    lossRate: '#ef4444',
    roi: '#06b6d4',
    risk: '#ef4444'
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 bg-clip-text text-transparent mb-2">
              Advanced Trading Configuration
            </h1>
            <p className="text-gray-600 text-lg">Real-time forex analytics and strategy optimization</p>
          </div>
          
          <button
            onClick={fetchData}
            disabled={isLoading}
            className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            <span>{isLoading ? 'Updating...' : 'Refresh Data'}</span>
          </button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex items-center">
            <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
            <div>
              <p className="text-red-800 font-medium">Failed to fetch forex data</p>
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          </div>
        )}

        {/* Settings Panel */}
        <div className="bg-gradient-to-br from-white to-gray-50/80 rounded-2xl shadow-xl p-6 border border-gray-100/50 backdrop-blur-sm">
          <div className="flex items-center space-x-3 mb-6">
            <div className="p-2 bg-gradient-to-r from-indigo-400 to-purple-500 rounded-lg">
              <Settings className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Trading Parameters</h2>
              <p className="text-sm text-gray-500">Configure your trading strategy</p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Currency Pair</label>
              <select
                value={settings.selectedPair}
                onChange={(e) => handleSettingChange('selectedPair', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-black"
              >
                {CURRENCY_PAIRS.map(pair => (
                  <option key={pair.symbol} value={pair.symbol}>{pair.symbol}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Risk %</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="10"
                value={settings.riskPercentage}
                onChange={(e) => handleSettingChange('riskPercentage', parseFloat(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-black"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Win Rate %</label>
              <input
                type="number"
                min="10"
                max="95"
                value={settings.winRate}
                onChange={(e) => handleSettingChange('winRate', parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-black"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Risk:Reward</label>
              <input
                type="number"
                step="0.1"
                min="0.5"
                max="5"
                value={settings.riskRewardRatio}
                onChange={(e) => handleSettingChange('riskRewardRatio', parseFloat(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-black"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Account Balance</label>
              <input
                type="number"
                min="1000"
                step="1000"
                value={settings.accountBalance}
                onChange={(e) => handleSettingChange('accountBalance', parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-black"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Lot Size</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max="10"
                value={settings.lotSize}
                onChange={(e) => handleSettingChange('lotSize', parseFloat(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-black"
              />
            </div>
          </div>
        </div>

        {/* Main Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Price History Chart */}
          <div className="lg:col-span-2 bg-gradient-to-br from-white to-gray-50/80 rounded-2xl shadow-xl p-6 border border-gray-100/50 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-gradient-to-r from-blue-400 to-indigo-500 rounded-lg">
                  <TrendingUp className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{settings.selectedPair} Price History</h2>
                  <p className="text-sm text-gray-500">30-day price movement</p>
                </div>
              </div>
              <div className="flex items-center space-x-2 px-4 py-2 rounded-full bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200">
                <span className="text-sm font-medium text-blue-700">
                  Current: {forexData[settings.selectedPair]?.toFixed(4) || '---'}
                </span>
              </div>
            </div>
            
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={historicalData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chartColors.areaFill} stopOpacity={0.8}/>
                      <stop offset="100%" stopColor={chartColors.areaFill} stopOpacity={0.1}/>
                    </linearGradient>
                  </defs>
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12, fill: '#64748b', fontWeight: 500 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(date) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  />
                  <YAxis 
                    tick={{ fontSize: 12, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => value.toFixed(4)}
                  />
                  <Tooltip 
                    content={<CustomTooltip formatter={(value, name) => [value.toFixed(4), name]} />}
                    cursor={{ stroke: 'rgba(59, 130, 246, 0.1)', strokeWidth: 2 }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="rate" 
                    stroke={chartColors.areaFill} 
                    fill="url(#priceGradient)"
                    name="Exchange Rate"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Enhanced Strategy Risk Pie Chart */}
          <div className="bg-gradient-to-br from-white via-blue-50/30 to-indigo-50/50 min-h-[450px] rounded-2xl w-full m-1 p-6 relative shadow-xl border border-blue-100/30 backdrop-blur-sm">
            {/* Header with enhanced styling */}
            <div className="mb-6 text-center">
              <div className="flex items-center justify-center space-x-3 mb-3">
                <div className="p-2 bg-gradient-to-r from-blue-400/20 to-indigo-500/20 rounded-lg border border-blue-200/30">
                  <PieChartIcon className="w-5 h-5 text-indigo-600" />
                </div>
                <h3 className="text-lg font-semibold bg-gradient-to-r from-indigo-700 to-blue-600 bg-clip-text text-transparent">
                  Strategy Risk Analysis
                </h3>
              </div>
              <p className="text-sm text-gray-600 mb-4">Risk distribution by component</p>
              
              {/* Total Risk Display with enhanced styling */}
              <div className="inline-flex items-center bg-gradient-to-r from-blue-50 via-indigo-50 to-blue-50 px-5 py-2.5 rounded-full border border-blue-200/40 shadow-sm">
                <div className="w-2 h-2 bg-gradient-to-r from-blue-400 to-indigo-500 rounded-full mr-2 animate-pulse"></div>
                <span className="text-indigo-700 font-semibold text-sm">
                  Overall Risk Score: {riskData[0]?.value.toFixed(1) || '0'}%
                </span>
              </div>
            </div>
            
            <div style={{ width: '100%', height: '300px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  {/* Enhanced gradient definitions with lighter dashboard colors */}
                  <defs>
                    <filter id="riskShadow" x="-50%" y="-50%" width="200%" height="200%">
                      <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="rgba(59,130,246,0.15)"/>
                      <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="rgba(99,102,241,0.1)"/>
                    </filter>
                    
                    {/* Kelly Criterion - Light Green (matching aggressive from dashboard) */}
                    <linearGradient id="kellyGradient" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#a7f3d0" stopOpacity={0.9}/>
                      <stop offset="50%" stopColor="#6ee7b7" stopOpacity={0.8}/>
                      <stop offset="100%" stopColor="#34d399" stopOpacity={0.7}/>
                    </linearGradient>
                    
                    {/* Volatility - Light Orange (matching conservative from dashboard) */}
                    <linearGradient id="volatilityGradient" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#fed7aa" stopOpacity={0.9}/>
                      <stop offset="50%" stopColor="#fdba74" stopOpacity={0.8}/>
                      <stop offset="100%" stopColor="#fb923c" stopOpacity={0.7}/>
                    </linearGradient>
                  </defs>
                  
                  <Pie
                    data={riskComponents}
                    cx="50%"
                    cy="50%"
                    innerRadius="55%"
                    outerRadius="90%"
                    dataKey="value"
                    labelLine={false}
                    stroke="rgba(255,255,255,0.9)"
                    strokeWidth={3}
                    filter="url(#riskShadow)"
                  >
                    {riskComponents.map((entry, index) => (
                      <Cell 
                        key={`riskCell-${index}`} 
                        fill={index === 0 ? 'url(#kellyGradient)' : 'url(#volatilityGradient)'}
                      />
                    ))}
                  </Pie>
                  <Tooltip 
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0];
                        return (
                          <div className="bg-white/95 backdrop-blur-md p-4 border-0 rounded-xl shadow-2xl border border-blue-200/30">
                            <p className="font-semibold text-indigo-800 text-sm mb-2">{data.name}</p>
                            <div className="flex items-center gap-2">
                              <div 
                                className="w-3 h-3 rounded-full shadow-sm" 
                                style={{ 
                                  background: data.name === 'Kelly Criterion' 
                                    ? 'linear-gradient(135deg, #a7f3d0, #34d399)' 
                                    : 'linear-gradient(135deg, #fed7aa, #fb923c)'
                                }}
                              />
                              <p className="text-gray-700 text-sm font-medium">
                                Risk Level: {data.value.toFixed(1)}%
                              </p>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            
            {/* Enhanced Center Text Display */}
            
            
            {/* Risk components breakdown */}
            <div className="grid grid-cols-2 gap-4 mt-6">
              {riskComponents.map((component, index) => (
                <div key={index} className="bg-gray-50 rounded-lg p-3 flex flex-col">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-700">{component.name}</span>
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: component.fill }} />
                  </div>
                  <div className="text-xl font-bold text-gray-800 mt-1">
                    {component.value.toFixed(1)}%
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5 mt-2">
                    <div 
                      className="h-1.5 rounded-full" 
                      style={{ 
                        width: `${Math.min(100, component.value)}%`,
                        backgroundColor: component.fill
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Performance Analysis */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Performance Scenarios - REFERENCE STYLE */}
          <div className="bg-gradient-to-br from-white to-gray-50/80 rounded-2xl shadow-xl p-6 border border-gray-100/50 backdrop-blur-sm">
            <div className="flex items-center space-x-3 mb-6">
              <div className="p-2 bg-gradient-to-r from-purple-400 to-pink-500 rounded-lg">
                <PieChartIcon className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">Performance Scenarios</h2>
                <p className="text-sm text-gray-500">Expected returns under different conditions</p>
              </div>
            </div>
            
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={performanceData} barCategoryGap="20%" margin={{ top: 20, right: 30, left: 0, bottom: 10 }}>
                  <XAxis 
                    dataKey="scenario" 
                    tick={{ fontSize: 11, fill: '#64748b', fontWeight: 500 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis 
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => `$${(value/1000).toFixed(1)}k`}
                  />
                  <Tooltip 
                    content={<CustomTooltip formatter={(value) => [`$${value.toFixed(0)}`, ' Expected Return']} />}
                    cursor={{ stroke: 'rgba(0,0,0,0.05)', strokeWidth: 0 }}
                  />
                  <Bar 
                    dataKey="return" 
                    radius={[8, 8, 0, 0]}
                    stroke="rgba(255,255,255,0.3)"
                    strokeWidth={1}
                  >
                    {performanceData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Currency Pair Performance - MATCHED STYLE */}
          <div className="bg-gradient-to-br from-white to-gray-50/80 rounded-2xl shadow-xl p-6 border border-gray-100/50 backdrop-blur-sm">
            <div className="flex items-center space-x-3 mb-6">
              <div className="p-2 bg-gradient-to-r from-green-400 to-teal-500 rounded-lg">
                <BarChart3 className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">Pair Comparison</h2>
                <p className="text-sm text-gray-500">Expected returns by currency pair</p>
              </div>
            </div>
            
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pairComparisonData} barCategoryGap="15%" margin={{ top: 20, right: 30, left: 0, bottom: 10 }}>
                  <XAxis 
                    dataKey="pair"
                    tick={{ fontSize: 11, fill: '#64748b', fontWeight: 500 }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                  />
                  <YAxis 
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => `$${(value/1000).toFixed(0)}k`}
                  />
                  <Tooltip 
                    content={<CustomTooltip formatter={(value) => [`$${value.toFixed(0)}`, ' Expected Return']} />}
                    cursor={{ stroke: 'rgba(0,0,0,0.05)', strokeWidth: 0 }}
                  />
                  <Bar 
                    dataKey="expectedReturn" 
                    radius={[8, 8, 0, 0]}
                    stroke="rgba(255,255,255,0.3)"
                    strokeWidth={1}
                  >
                    {pairComparisonData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Bottom Row: ROI and Win Rate */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* ROI Analysis - MATCHED STYLE */}
          <div className="bg-gradient-to-br from-white to-gray-50/80 rounded-2xl shadow-xl p-6 border border-gray-100/50 backdrop-blur-sm">
            <div className="flex items-center space-x-3 mb-6">
              <div className="p-2 bg-gradient-to-r from-cyan-400 to-blue-500 rounded-lg">
                <DollarSign className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">ROI Analysis</h2>
                <p className="text-sm text-gray-500">Cumulative return on investment</p>
              </div>
              <div className="ml-auto flex items-center space-x-2 px-4 py-2 rounded-full bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200">
                <span className="text-sm font-medium text-blue-700">
                  Annual: {roiPercentage.toFixed(1)}%
                </span>
              </div>
            </div>
            
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={roiData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="roiGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chartColors.roi} stopOpacity={0.8}/>
                      <stop offset="100%" stopColor={chartColors.roi} stopOpacity={0.1}/>
                    </linearGradient>
                  </defs>
                  <XAxis 
                    dataKey="month" 
                    tick={{ fontSize: 11, fill: '#64748b', fontWeight: 500 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis 
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => `${value.toFixed(0)}%`}
                  />
                  <Tooltip 
                    content={<CustomTooltip formatter={(value, name) => {
                      if (name === 'roi') return [`${value.toFixed(1)}%`, 'ROI'];
                      return [`$${value.toFixed(0)}`, 'Balance'];
                    }} />}
                    cursor={{ stroke: 'rgba(59, 130, 246, 0.1)', strokeWidth: 2 }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="roi" 
                    stroke={chartColors.roi} 
                    strokeWidth={2}
                    dot={{ stroke: chartColors.roi, strokeWidth: 2, r: 4, fill: 'white' }}
                    activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="roi" 
                    stroke="none" 
                    fill="url(#roiGradient)"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Win Rate Probability - MATCHED STYLE */}
          <div className="bg-gradient-to-br from-white to-gray-50/80 rounded-2xl shadow-xl p-6 border border-gray-100/50 backdrop-blur-sm">
            <div className="flex items-center space-x-3 mb-6">
              <div className="p-2 bg-gradient-to-r from-amber-400 to-orange-500 rounded-lg">
                <Target className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">Win Rate Probability</h2>
                <p className="text-sm text-gray-500">Success likelihood based on historical patterns</p>
              </div>
            </div>
            
            <div className="h-64 flex flex-col">
              <div className="flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <defs>
                      <linearGradient id="winGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={chartColors.winRate} stopOpacity={0.9}/>
                        <stop offset="100%" stopColor={chartColors.winRate} stopOpacity={0.7}/>
                      </linearGradient>
                      <linearGradient id="lossGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={chartColors.lossRate} stopOpacity={0.9}/>
                        <stop offset="100%" stopColor={chartColors.lossRate} stopOpacity={0.7}/>
                      </linearGradient>
                    </defs>
                    <Pie
                      data={[
                        { name: 'Wins', value: settings.winRate },
                        { name: 'Losses', value: 100 - settings.winRate }
                      ]}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                      startAngle={90}
                      endAngle={-270}
                    >
                      <Cell key="wins" fill="url(#winGradient)" stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
                      <Cell key="losses" fill="url(#lossGradient)" stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
                    </Pie>
                    <Tooltip 
                      content={<CustomTooltip formatter={(value) => [`${value}%`, 'Probability']} />}
                    />
                    <text 
                      x="50%" 
                      y="45%" 
                      textAnchor="middle" 
                      dominantBaseline="middle" 
                      className="text-2xl font-bold fill-gray-700"
                    >
                      {settings.winRate}%
                    </text>
                    <text 
                      x="50%" 
                      y="55%" 
                      textAnchor="middle" 
                      dominantBaseline="middle" 
                      className="text-sm fill-gray-500"
                    >
                      Win Rate
                    </text>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div className="flex items-center justify-center bg-green-50 rounded-lg py-2">
                  <div className="w-3 h-3 rounded-full bg-green-500 mr-2"></div>
                  <span className="text-sm font-medium text-green-700">
                    Wins: {settings.winRate}%
                  </span>
                </div>
                <div className="flex items-center justify-center bg-red-50 rounded-lg py-2">
                  <div className="w-3 h-3 rounded-full bg-red-500 mr-2"></div>
                  <span className="text-sm font-medium text-red-700">
                    Losses: {100 - settings.winRate}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Key Metrics and Recommendation */}
        <div className="bg-gradient-to-br from-white to-gray-50/80 rounded-2xl shadow-xl p-6 border border-gray-100/50 backdrop-blur-sm">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-xl border border-blue-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-blue-700">Expected Value</span>
                <DollarSign className="w-4 h-4 text-blue-500" />
              </div>
              <p className="text-2xl font-bold text-blue-900">
                ${expectedValue > 0 ? '+' : ''}{expectedValue.toFixed(2)}
              </p>
              <p className="text-xs text-blue-600 mt-1">Per trade</p>
            </div>
            
            <div className="bg-gradient-to-r from-green-50 to-teal-50 p-4 rounded-xl border border-green-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-green-700">Annual ROI</span>
                <Percent className="w-4 h-4 text-green-500" />
              </div>
              <p className="text-2xl font-bold text-green-900">
                {roiPercentage.toFixed(1)}%
              </p>
              <p className="text-xs text-green-600 mt-1">Projected return</p>
            </div>
            
            <div className="bg-gradient-to-r from-amber-50 to-orange-50 p-4 rounded-xl border border-amber-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-amber-700">Risk Exposure</span>
                <AlertCircle className="w-4 h-4 text-amber-500" />
              </div>
              <p className="text-2xl font-bold text-amber-900">
                ${(settings.accountBalance * (settings.riskPercentage / 100)).toFixed(0)}
              </p>
              <p className="text-xs text-amber-600 mt-1">Per trade</p>
            </div>
            
            <div className={`bg-gradient-to-r ${expectedValue > 0 ? 'from-emerald-50 to-green-50 border-emerald-100' : 'from-rose-50 to-red-50 border-rose-100'} p-4 rounded-xl border`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">Recommendation</span>
                <recommendation.icon className={`w-4 h-4 ${expectedValue > 0 ? 'text-emerald-500' : 'text-rose-500'}`} />
              </div>
              <p className={`text-xl font-bold ${recommendation.color}`}>
                {recommendation.text}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Based on current parameters
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-sm text-gray-500 pt-4">
          <p>Last updated: {lastUpdate || 'Never'}</p>
          <p className="mt-1">Forex trading involves substantial risk of loss and is not suitable for all investors.</p>
        </div>
      </div>
    </div>
  );
};

export default TradingSettings;