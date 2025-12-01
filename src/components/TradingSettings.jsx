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
  BarChart3, 
  Target,
  DollarSign,
  Percent,
  Settings,
  RefreshCw,
  AlertCircle,
  Activity
} from 'lucide-react';

// --- Configuration ---
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

// --- Real Data Fetching Logic ---

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
    
    // 2. Forex Logic (Cascade)
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

const fetchHistoricalData = async (base, quote) => {
  if (base === 'XAU') return []; // Gold history typically requires paid API
  
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 30);
  
  const startStr = startDate.toISOString().split('T')[0];
  
  try {
    const response = await fetch(`https://api.frankfurter.app/${startStr}..?from=${base}&to=${quote}`);
    const data = await response.json();
    
    if (data.rates) {
      return Object.keys(data.rates).map(date => ({
        date,
        rate: data.rates[date][quote]
      }));
    }
    return [];
  } catch (error) {
    console.error("History fetch failed", error);
    return [];
  }
};

// --- Sub-components ---

const CustomTooltip = ({ active, payload, label, formatter }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white/95 backdrop-blur-md p-4 border border-slate-200 rounded-xl shadow-lg">
        <p className="font-bold text-slate-800 text-sm mb-2 font-sans">{label}</p>
        {payload.map((entry, index) => (
          <div key={index} className="flex items-center gap-2 mb-1">
            <div 
              className="w-3 h-3 rounded-full" 
              style={{ backgroundColor: entry.color || entry.fill }}
            />
            <p className="text-slate-600 text-sm font-medium font-mono">
              {formatter ? formatter(entry.value, entry.name) : `${entry.name}: ${entry.value}`}
            </p>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

// --- Main Component ---

const TradingSettings = () => {
  const [forexData, setForexData] = useState({});
  const [historicalData, setHistoricalData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  
  const [settings, setSettings] = useState({
    selectedPair: 'EURUSD',
    riskPercentage: 2.5,
    winRate: 65,
    riskRewardRatio: 1.8,
    accountBalance: 10000,
    lotSize: 0.1
  });

  const [performanceData, setPerformanceData] = useState([]);
  const [pairComparisonData, setPairComparisonData] = useState([]);
  const [riskComponents, setRiskComponents] = useState([]);

  // Fetch Current Rates
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const results = await Promise.all(
        CURRENCY_PAIRS.map(async (pair) => {
          const rate = await fetchRealForexData(pair);
          return { symbol: pair.symbol, rate };
        })
      );
      
      const newRates = {};
      results.forEach(item => {
        if(item.rate) newRates[item.symbol] = item.rate;
      });
      
      setForexData(newRates);
      setLastUpdate(new Date().toLocaleTimeString());
      setError(null);
    } catch (err) {
      setError('Failed to fetch live rates');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch History
  useEffect(() => {
    const loadHistory = async () => {
      const pair = CURRENCY_PAIRS.find(p => p.symbol === settings.selectedPair);
      if (pair) {
        const history = await fetchHistoricalData(pair.base, pair.quote);
        setHistoricalData(history);
      }
    };
    loadHistory();
  }, [settings.selectedPair]);

  // Initial Load
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleSettingChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  // --- Calculations ---

  const calculateExpectedValue = useCallback(() => {
    const winProbability = settings.winRate / 100;
    const lossProbability = 1 - winProbability;
    const riskAmount = settings.accountBalance * (settings.riskPercentage / 100);
    const winAmount = riskAmount * settings.riskRewardRatio;
    return (winAmount * winProbability) - (riskAmount * lossProbability);
  }, [settings]);

  const calculateKellyCriterion = useCallback(() => {
    const winRate = settings.winRate / 100;
    const riskRewardRatio = settings.riskRewardRatio;
    const kelly = (winRate * riskRewardRatio - (1 - winRate)) / riskRewardRatio;
    return Math.max(0, Math.min(1, kelly)) * 100; 
  }, [settings]);

  const calculateRiskScore = useCallback(() => {
    const kelly = calculateKellyCriterion();
    const currentRiskPercentage = settings.riskPercentage;
    const kellyRisk = currentRiskPercentage > kelly ? Math.min(100, (currentRiskPercentage - kelly) * 10) : Math.max(0, kelly - currentRiskPercentage);
    const winRateRisk = Math.max(0, (70 - settings.winRate) * 2);
    const rrRisk = settings.riskRewardRatio < 1.5 ? (1.5 - settings.riskRewardRatio) * 30 : 0;
    
    const overallRisk = (kellyRisk * 0.4) + (winRateRisk * 0.4) + (rrRisk * 0.2);
    return Math.min(100, Math.max(0, overallRisk));
  }, [settings, calculateKellyCriterion]);

  const calculateROI = useCallback(() => {
    const tradesPerMonth = 20;
    const expectedValue = calculateExpectedValue();
    let balance = settings.accountBalance;
    const monthlyReturns = [];
    
    for (let i = 0; i < 12; i++) {
      const monthlyReturn = expectedValue * tradesPerMonth;
      balance += monthlyReturn;
      const roi = ((balance - settings.accountBalance) / settings.accountBalance) * 100;
      
      monthlyReturns.push({
        month: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i],
        roi: roi,
        balance: balance
      });
    }
    return monthlyReturns;
  }, [settings, calculateExpectedValue]);

  // --- Effects for Chart Data ---

  useEffect(() => {
    const expectedValue = calculateExpectedValue();
    const kelly = calculateKellyCriterion();
    
    // Performance Scenarios
    const baseReturn = expectedValue * 20;
    const scenarios = [
      { scenario: 'Worst Case', return: baseReturn * -2, fill: '#ef4444' },
      { scenario: 'Conservative', return: baseReturn * 0.5, fill: '#f59e0b' },
      { scenario: 'Expected', return: baseReturn, fill: '#3b82f6' },
      { scenario: 'Best Case', return: baseReturn * 1.8, fill: '#10b981' }
    ];
    setPerformanceData(scenarios);

    // Pair Comparison
    const majorPairs = CURRENCY_PAIRS.slice(1, 7);
    const comparison = majorPairs.map((pair, index) => {
      const volatilityMap = { 'EURUSD': 0.015, 'GBPUSD': 0.018, 'USDCAD': 0.012, 'USDCHF': 0.014, 'USDJPY': 0.016, 'AUDCAD': 0.020 };
      const volatility = volatilityMap[pair.symbol] || 0.015;
      const riskAmount = settings.accountBalance * (settings.riskPercentage / 100);
      const expectedReturn = riskAmount * settings.riskRewardRatio * (settings.winRate / 100) * volatility * 20;
      const colors = ['#8884d8', '#83a6ed', '#8dd1e1', '#82ca9d', '#a4de6c', '#d0ed57', '#ffc658', '#ff8042'];
      
      return {
        pair: pair.symbol,
        expectedReturn: expectedReturn,
        fill: colors[index % colors.length]
      };
    });
    setPairComparisonData(comparison);

    // Risk components
    const positionSizeRisk = Math.abs(settings.riskPercentage - kelly) * 5;
    const winRateRisk = settings.winRate < 60 ? (60 - settings.winRate) * 1.5 : Math.max(0, (settings.winRate - 80) * 2);
    setRiskComponents([
      { name: 'Position Size Risk', value: positionSizeRisk, fill: '#f59e0b' },
      { name: 'Win Rate Risk', value: winRateRisk, fill: '#ef4444' }
    ]);
    
  }, [forexData, settings, calculateExpectedValue, calculateKellyCriterion, calculateRiskScore]);

  const expectedValue = calculateExpectedValue();
  const roiData = calculateROI();
  const roiPercentage = ((roiData[roiData.length - 1].balance - settings.accountBalance) / settings.accountBalance) * 100;
  const kelly = calculateKellyCriterion();

  const recommendation = {
    text: expectedValue > 0 ? (settings.riskPercentage <= kelly ? 'Optimal Strategy' : 'Reduce Position Size') : 'High Risk Strategy',
    color: expectedValue > 0 ? (settings.riskPercentage <= kelly ? 'text-emerald-600' : 'text-amber-600') : 'text-rose-600',
    icon: expectedValue > 0 ? (settings.riskPercentage <= kelly ? TrendingUp : AlertCircle) : TrendingDown
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-indigo-100 selection:text-indigo-900 p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-slate-800 mb-2">
              Advanced Trading Configuration
            </h1>
            <p className="text-slate-500 font-medium">Real-time forex analytics and strategy optimization</p>
          </div>
          
          <button
            onClick={fetchData}
            disabled={isLoading}
            className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 shadow-md shadow-indigo-200"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            <span>{isLoading ? 'Updating...' : 'Refresh Data'}</span>
          </button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 mb-6 flex items-center">
            <AlertCircle className="w-5 h-5 text-rose-500 mr-2" />
            <div>
              <p className="text-rose-800 font-medium">Data Fetch Issue</p>
              <p className="text-rose-600 text-sm">{error}</p>
            </div>
          </div>
        )}

        {/* Settings Panel */}
        <div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-200">
          <div className="flex items-center space-x-3 mb-6">
            <div className="p-2 bg-indigo-600 rounded-lg shadow-md shadow-indigo-200">
              <Settings className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">Trading Parameters</h2>
              <p className="text-sm text-slate-500 font-medium">Configure your trading strategy</p>
            </div>
            <div className="ml-auto bg-blue-50 px-3 py-1 rounded-lg border border-blue-100">
              <span className="text-sm text-blue-700 font-medium font-mono">
                Kelly Criterion: {kelly.toFixed(1)}%
              </span>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Currency Pair</label>
              <select
                value={settings.selectedPair}
                onChange={(e) => handleSettingChange('selectedPair', e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-slate-800 font-medium transition-shadow"
              >
                {CURRENCY_PAIRS.map(pair => (
                  <option key={pair.symbol} value={pair.symbol}>{pair.symbol}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Risk %</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="10"
                value={settings.riskPercentage}
                onChange={(e) => handleSettingChange('riskPercentage', parseFloat(e.target.value))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-slate-800 font-mono font-medium"
              />
            </div>
            
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Win Rate %</label>
              <input
                type="number"
                min="10"
                max="95"
                value={settings.winRate}
                onChange={(e) => handleSettingChange('winRate', parseInt(e.target.value))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-slate-800 font-mono font-medium"
              />
            </div>
            
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Risk:Reward</label>
              <input
                type="number"
                step="0.1"
                min="0.5"
                max="5"
                value={settings.riskRewardRatio}
                onChange={(e) => handleSettingChange('riskRewardRatio', parseFloat(e.target.value))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-slate-800 font-mono font-medium"
              />
            </div>
            
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Balance ($)</label>
              <input
                type="number"
                min="1000"
                step="1000"
                value={settings.accountBalance}
                onChange={(e) => handleSettingChange('accountBalance', parseInt(e.target.value))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-slate-800 font-mono font-medium"
              />
            </div>
            
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Lot Size</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max="10"
                value={settings.lotSize}
                onChange={(e) => handleSettingChange('lotSize', parseFloat(e.target.value))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-slate-800 font-mono font-medium"
              />
            </div>
          </div>
        </div>

        {/* Main Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Price History Chart */}
          <div className="lg:col-span-2 bg-white rounded-2xl shadow-lg p-6 border border-slate-200">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-blue-500 rounded-lg shadow-md shadow-blue-200">
                  <TrendingUp className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-800">{settings.selectedPair} Price History</h2>
                  <p className="text-sm text-slate-500 font-medium">30-day market movement</p>
                </div>
              </div>
              <div className="flex items-center space-x-2 px-4 py-2 rounded-full bg-blue-50 border border-blue-100">
                <span className="text-sm font-bold text-indigo-600 font-mono">
                  Current: {forexData[settings.selectedPair]?.toFixed(4) || '---'}
                </span>
              </div>
            </div>
            
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={historicalData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.2}/>
                      <stop offset="100%" stopColor="#4f46e5" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12, fill: '#64748b', fontWeight: 500, fontFamily: 'monospace' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(date) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  />
                  <YAxis 
                    domain={['auto', 'auto']}
                    tick={{ fontSize: 12, fill: '#64748b', fontFamily: 'monospace' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => value.toFixed(3)}
                  />
                  <Tooltip 
                    content={<CustomTooltip formatter={(value, name) => [value.toFixed(4), name]} />}
                    cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '3 3' }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="rate" 
                    stroke="#4f46e5" 
                    fill="url(#priceGradient)"
                    name="Rate"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Strategy Risk Pie Chart */}
          <div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-200 flex flex-col">
            <div className="mb-6 text-center">
              <div className="flex items-center justify-center space-x-3 mb-3">
                <div className="p-2 bg-indigo-100 rounded-lg">
                  <PieChartIcon className="w-5 h-5 text-indigo-600" />
                </div>
                <h3 className="text-lg font-bold text-slate-800">
                  Strategy Risk Analysis
                </h3>
              </div>
              <p className="text-sm text-slate-500 font-medium mb-4">Risk distribution by component</p>
              
              <div className="inline-flex items-center bg-slate-50 px-5 py-2.5 rounded-full border border-slate-200">
                <div className="w-2 h-2 bg-indigo-600 rounded-full mr-2 animate-pulse"></div>
                <span className="text-slate-700 font-semibold text-sm font-mono">
                  Overall Risk Score: {calculateRiskScore().toFixed(1)}%
                </span>
              </div>
            </div>
            
            <div className="flex-1 min-h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={riskComponents}
                    cx="50%"
                    cy="50%"
                    innerRadius="55%"
                    outerRadius="80%"
                    dataKey="value"
                    labelLine={false}
                    stroke="#fff"
                    strokeWidth={2}
                  >
                    {riskComponents.map((entry, index) => (
                      <Cell 
                        key={`riskCell-${index}`} 
                        fill={entry.fill}
                      />
                    ))}
                  </Pie>
                  <Tooltip 
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0];
                        return (
                          <div className="bg-white p-3 border border-slate-200 rounded-lg shadow-lg">
                            <p className="font-bold text-slate-800 text-sm">{data.name}</p>
                            <p className="text-slate-600 text-xs font-mono">Risk: {data.value.toFixed(1)}%</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mt-4">
              {riskComponents.map((component, index) => (
                <div key={index} className="bg-slate-50 rounded-lg p-3 flex flex-col border border-slate-200">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-slate-500 uppercase">{component.name.split(' ')[0]}</span>
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: component.fill }} />
                  </div>
                  <div className="text-lg font-bold text-slate-800 font-mono">
                    {component.value.toFixed(1)}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Performance Analysis */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Performance Scenarios */}
          <div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-200">
            <div className="flex items-center space-x-3 mb-6">
              <div className="p-2 bg-purple-500 rounded-lg shadow-md shadow-purple-200">
                <PieChartIcon className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">Performance Scenarios</h2>
                <p className="text-sm text-slate-500 font-medium">Expected returns based on your settings</p>
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
                    tick={{ fontSize: 11, fill: '#64748b', fontFamily: 'monospace' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => `${(value/1000).toFixed(1)}k`}
                  />
                  <Tooltip 
                    content={<CustomTooltip formatter={(value) => [`${value.toFixed(0)}`, ' Monthly Return']} />}
                    cursor={{ fill: '#f1f5f9' }}
                  />
                  <Bar 
                    dataKey="return" 
                    radius={[4, 4, 0, 0]}
                  >
                    {performanceData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Currency Pair Performance */}
          <div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-200">
            <div className="flex items-center space-x-3 mb-6">
              <div className="p-2 bg-emerald-500 rounded-lg shadow-md shadow-emerald-200">
                <BarChart3 className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">Pair Comparison</h2>
                <p className="text-sm text-slate-500 font-medium">Expected returns by volatility</p>
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
                    tick={{ fontSize: 11, fill: '#64748b', fontFamily: 'monospace' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => `${(value/100).toFixed(0)}`}
                  />
                  <Tooltip 
                    content={<CustomTooltip formatter={(value) => [`${value.toFixed(0)}`, ' Monthly Expected']} />}
                    cursor={{ fill: '#f1f5f9' }}
                  />
                  <Bar 
                    dataKey="expectedReturn" 
                    radius={[4, 4, 0, 0]}
                  >
                    {pairComparisonData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Bottom Row: ROI and Win Rate */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* ROI Analysis */}
          <div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-200">
            <div className="flex items-center space-x-3 mb-6">
              <div className="p-2 bg-cyan-500 rounded-lg shadow-md shadow-cyan-200">
                <DollarSign className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">ROI Analysis</h2>
                <p className="text-sm text-slate-500 font-medium">Projected returns with compounding</p>
              </div>
              <div className="ml-auto flex items-center space-x-2 px-4 py-2 rounded-full bg-cyan-50 border border-cyan-100">
                <span className="text-sm font-bold text-cyan-700 font-mono">
                  Annual: {roiPercentage.toFixed(1)}%
                </span>
              </div>
            </div>
            
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={roiData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="roiGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.2}/>
                      <stop offset="100%" stopColor="#06b6d4" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis 
                    dataKey="month" 
                    tick={{ fontSize: 11, fill: '#64748b', fontWeight: 500 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis 
                    tick={{ fontSize: 11, fill: '#64748b', fontFamily: 'monospace' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => `${value.toFixed(0)}%`}
                  />
                  <Tooltip 
                    content={<CustomTooltip formatter={(value, name) => {
                      if (name === 'roi') return [`${value.toFixed(1)}%`, 'ROI'];
                      return [`${value.toFixed(0)}`, 'Balance'];
                    }} />}
                    cursor={{ stroke: '#cbd5e1', strokeWidth: 1 }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="roi" 
                    stroke="#06b6d4" 
                    strokeWidth={2}
                    dot={{ stroke: '#06b6d4', strokeWidth: 2, r: 4, fill: 'white' }}
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

          {/* Win Rate Probability */}
          <div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-200">
            <div className="flex items-center space-x-3 mb-6">
              <div className="p-2 bg-amber-500 rounded-lg shadow-md shadow-amber-200">
                <Target className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">Win Rate Analysis</h2>
                <p className="text-sm text-slate-500 font-medium">Success vs failure distribution</p>
              </div>
            </div>
            
            <div className="h-64 flex flex-col">
              <div className="flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Wins', value: settings.winRate, fill: '#10b981' },
                        { name: 'Losses', value: 100 - settings.winRate, fill: '#ef4444' }
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
                      <Cell key="wins" fill="#10b981" />
                      <Cell key="losses" fill="#ef4444" />
                    </Pie>
                    <Tooltip 
                      content={<CustomTooltip formatter={(value) => [`${value}%`, 'Probability']} />}
                    />
                    <text 
                      x="50%" 
                      y="45%" 
                      textAnchor="middle" 
                      dominantBaseline="middle" 
                      className="text-2xl font-bold fill-slate-800 font-mono"
                    >
                      {settings.winRate}%
                    </text>
                    <text 
                      x="50%" 
                      y="55%" 
                      textAnchor="middle" 
                      dominantBaseline="middle" 
                      className="text-sm fill-slate-500 font-medium"
                    >
                      Win Rate
                    </text>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div className="flex items-center justify-center bg-emerald-50 rounded-lg py-2 border border-emerald-100">
                  <div className="w-3 h-3 rounded-full bg-emerald-500 mr-2"></div>
                  <span className="text-sm font-medium text-emerald-700 font-mono">
                    Wins: {settings.winRate}%
                  </span>
                </div>
                <div className="flex items-center justify-center bg-rose-50 rounded-lg py-2 border border-rose-100">
                  <div className="w-3 h-3 rounded-full bg-rose-500 mr-2"></div>
                  <span className="text-sm font-medium text-rose-700 font-mono">
                    Losses: {100 - settings.winRate}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Key Metrics and Recommendation */}
        <div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-200">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-600">Expected Value</span>
                <DollarSign className="w-4 h-4 text-slate-400" />
              </div>
              <p className="text-2xl font-bold text-slate-800 font-mono">
                ${expectedValue > 0 ? '+' : ''}{expectedValue.toFixed(2)}
              </p>
              <p className="text-xs text-slate-500 mt-1 font-medium">Per trade</p>
            </div>
            
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-600">Annual ROI</span>
                <Percent className="w-4 h-4 text-slate-400" />
              </div>
              <p className="text-2xl font-bold text-slate-800 font-mono">
                {roiPercentage.toFixed(1)}%
              </p>
              <p className="text-xs text-slate-500 mt-1 font-medium">Projected return</p>
            </div>
            
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-600">Risk per Trade</span>
                <AlertCircle className="w-4 h-4 text-slate-400" />
              </div>
              <p className="text-2xl font-bold text-slate-800 font-mono">
                ${(settings.accountBalance * (settings.riskPercentage / 100)).toFixed(0)}
              </p>
              <p className="text-xs text-slate-500 mt-1 font-medium">{settings.riskPercentage}% of balance</p>
            </div>
            
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-600">Kelly Criterion</span>
                <Target className="w-4 h-4 text-slate-400" />
              </div>
              <p className="text-2xl font-bold text-slate-800 font-mono">
                {kelly.toFixed(1)}%
              </p>
              <p className="text-xs text-slate-500 mt-1 font-medium">Optimal risk size</p>
            </div>
            
            <div className={`p-4 rounded-xl border ${expectedValue > 0 ? 
              (settings.riskPercentage <= kelly ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200') : 
              'bg-rose-50 border-rose-200'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-700">Status</span>
                <Activity className={`w-4 h-4 ${recommendation.color}`} />
              </div>
              <p className={`text-lg font-bold ${recommendation.color}`}>
                {recommendation.text}
              </p>
              <p className="text-xs text-slate-500 mt-1 font-medium">
                {settings.riskPercentage > kelly ? `Reduce to ${kelly.toFixed(1)}%` : 'Strategy looks good'}
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-sm text-slate-400 pt-4 font-medium">
          <p>Last updated: {lastUpdate || 'Never'} | All calculations based on your current settings</p>
          <p className="mt-1">Forex trading involves substantial risk. Past performance does not guarantee future results.</p>
        </div>
      </div>
    </div>
  );
};

export default TradingSettings;
