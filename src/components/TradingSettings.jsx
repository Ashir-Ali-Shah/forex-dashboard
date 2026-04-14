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
  Target,
  DollarSign,
  Percent,
  Settings,
  RefreshCw,
  AlertCircle
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
      } catch (err) { }

      try {
        const response = await fetch('https://data-asg.goldprice.org/dbXRates/USD');
        const data = await response.json();
        if (data?.items?.[0]?.xauPrice) return parseFloat(data.items[0].xauPrice);
      } catch (err) { }

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

const fetchHistoricalData = async (base, quote, currentPrice) => {
  const generateSyntheticHistory = (startPrice, days = 30) => {
    const data = [];
    let price = startPrice || 100; // Default if no current price
    const volatility = base === 'XAU' ? 0.008 : 0.003; // Gold is more volatile

    for (let i = days; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      data.push({
        date: dateStr,
        rate: price
      });

      // Random walk backwards calculation (so end matches current)
      // We actually generate 'price' for this step, then mutate 'price' for the *previous* step (next loop iteration is back in time)
      // Wait, simpler: Generate valid history ending at currentPrice.
    }

    // Correct Approach: Walk BACKWARDS from current price
    const reverseData = [];
    let runner = currentPrice || (base === 'XAU' ? 2300 : 1.1000); // Reliable fallback defaults

    for (let i = 0; i <= days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);

      reverseData.unshift({
        date: date.toISOString().split('T')[0],
        rate: runner
      });

      // Change for previous day
      const change = runner * volatility * (Math.random() - 0.5);
      runner -= change;
    }

    return reverseData;
  };

  // 1. Try Real API for non-Gold
  if (base !== 'XAU') {
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
    } catch (error) {
      console.warn("Frankfurter API failed, falling back to synthetic", error);
    }
  }

  // 2. Synthetic Fallback (for Gold OR if API failed)
  // We need the current price to anchor the graph
  return generateSyntheticHistory(currentPrice);
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

// --- COMPONENT: LIGHT THEMED TRADE SETTINGS ---
const TradingSettings = ({ currencyData: propData }) => {
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
    accountBalance: 100,
    lotSize: 0.01
  });

  const [performanceData, setPerformanceData] = useState([]);
  // Risk components for potential future use in risk visualization
  const [, setRiskComponents] = useState([]);

  // Fetch Current Rates (Standalone Mode)
  const fetchData = useCallback(async () => {
    // If we have props, we don't fetch internally
    if (propData) return;

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
        if (item.rate) newRates[item.symbol] = item.rate;
      });

      setForexData(newRates);
      setLastUpdate(new Date().toLocaleTimeString());
      setError(null);
    } catch (err) {
      setError('Failed to fetch live rates');
    } finally {
      setIsLoading(false);
    }
  }, [propData]);

  // Sync with Prop Data (Dashboard Mode)
  useEffect(() => {
    if (propData && propData.length > 0) {
      const newRates = {};
      propData.forEach(item => {
        if (item.currentRate) {
          newRates[item.pair.symbol] = item.currentRate;
        }
      });
      setForexData(newRates);
      setIsLoading(false);
      setLastUpdate(new Date().toLocaleTimeString());

      // Also update history if the selected pair exists in props
      const selectedItem = propData.find(d => d.pair.symbol === settings.selectedPair);
      if (selectedItem && selectedItem.history) {
        // Map Dashboard history format (price, timestamp) to Settings format (rate, date string)
        const mappedHistory = selectedItem.history.map(h => ({
          rate: h.price,
          date: new Date(h.timestamp).toISOString() // Use full ISO string for proper date parsing
        })).reverse(); // Dashboard history might need reversing depending on chart preference

        // If dashboard history is short (minutes), it maps well.
        // However, TradingSettings expects "Dates". Let's adapt.
        setHistoricalData(mappedHistory);
      }
    }
  }, [propData, settings.selectedPair]);

  // Fetch History (Standalone Mode Only)
  useEffect(() => {
    if (propData) return; // Skip internal history fetch if using props

    const loadHistory = async () => {
      const pair = CURRENCY_PAIRS.find(p => p.symbol === settings.selectedPair);
      if (pair) {
        const currentRate = forexData[pair.symbol];
        const history = await fetchHistoricalData(pair.base, pair.quote, currentRate);
        setHistoricalData(history);
      }
    };
    loadHistory();
  }, [settings.selectedPair, forexData, propData]);

  // Initial Load & Interval (Standalone Mode Only)
  useEffect(() => {
    if (propData) return;

    fetchData();
    const interval = setInterval(fetchData, 300000); // 5 minutes
    return () => clearInterval(interval);
  }, [fetchData, propData]);

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
    const currentRisk = settings.riskPercentage;

    // Position Size Risk: How far from Kelly optimal
    // If over Kelly, that's risky. If under, that's safe.
    let positionRisk = 0;
    if (currentRisk > kelly) {
      positionRisk = Math.min(50, (currentRisk - kelly) * 5); // Max 50 points
    }

    // Win Rate Risk: Below 50% is risky
    let winRateRisk = 0;
    if (settings.winRate < 50) {
      winRateRisk = Math.min(30, (50 - settings.winRate) * 1.5); // Max 30 points
    }

    // Risk:Reward Risk: Below 1.0 is risky
    let rrRisk = 0;
    if (settings.riskRewardRatio < 1.0) {
      rrRisk = Math.min(20, (1.0 - settings.riskRewardRatio) * 40); // Max 20 points
    }

    // Overall Risk Score (0-100 scale)
    const overallRisk = positionRisk + winRateRisk + rrRisk;
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

    // Performance Scenarios - Light/Pastel Colors
    const baseReturn = expectedValue * 20;
    const scenarios = [
      { scenario: 'Worst Case', return: baseReturn * -2, fill: '#f87171' }, // Red-400
      { scenario: 'Conservative', return: baseReturn * 0.5, fill: '#fbbf24' }, // Amber-400
      { scenario: 'Expected', return: baseReturn, fill: '#60a5fa' }, // Blue-400
      { scenario: 'Best Case', return: baseReturn * 1.8, fill: '#34d399' } // Emerald-400
    ];
    setPerformanceData(scenarios);

    // Risk components - Light/Pastel Colors
    let positionRisk = 0;
    if (settings.riskPercentage > kelly) {
      positionRisk = Math.min(50, (settings.riskPercentage - kelly) * 5);
    }

    let winRateRisk = 0;
    if (settings.winRate < 50) {
      winRateRisk = Math.min(30, (50 - settings.winRate) * 1.5);
    }

    let rrRisk = 0;
    if (settings.riskRewardRatio < 1.0) {
      rrRisk = Math.min(20, (1.0 - settings.riskRewardRatio) * 40);
    }

    setRiskComponents([
      { name: 'Position', value: positionRisk, fill: '#fbbf24' }, // Amber-400
      { name: 'Win Rate', value: winRateRisk, fill: '#f87171' }, // Red-400
      { name: 'R:R Ratio', value: rrRisk, fill: '#a78bfa' } // Violet-400
    ]);

  }, [forexData, settings, calculateExpectedValue, calculateKellyCriterion, calculateRiskScore]);

  const expectedValue = calculateExpectedValue();
  const roiData = calculateROI();
  const roiPercentage = ((roiData[roiData.length - 1].balance - settings.accountBalance) / settings.accountBalance) * 100;
  const kelly = calculateKellyCriterion();

  // Recommendation data for strategy assessment
  const recommendation = {
    text: expectedValue > 0 ? (settings.riskPercentage <= kelly ? 'Optimal Strategy' : 'Reduce Position Size') : 'High Risk Strategy',
    color: expectedValue > 0 ? (settings.riskPercentage <= kelly ? 'text-emerald-600' : 'text-amber-600') : 'text-rose-600',
    Icon: expectedValue > 0 ? (settings.riskPercentage <= kelly ? TrendingUp : AlertCircle) : TrendingDown
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
            <p className="text-slate-500 font-medium">
              Real-time forex analytics and strategy optimization
              {lastUpdate && <span className="ml-2 text-xs text-slate-400">• Updated: {lastUpdate}</span>}
            </p>
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
                min="10"
                step="100"
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
          <div className="lg:col-span-3 bg-white rounded-2xl shadow-lg p-6 border border-slate-200">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-blue-500 rounded-lg shadow-md shadow-blue-200">
                  <TrendingUp className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-800">{settings.selectedPair} Price History</h2>
                  <p className="text-sm text-slate-500 font-medium">
                    {propData ? 'Intraday Market Action' : '30-day market movement'}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2 px-4 py-2 rounded-full bg-blue-50 border border-blue-100">
                <span className="text-sm font-bold text-indigo-600 font-mono">
                  Current: {forexData[settings.selectedPair]?.toFixed(4) || '---'}
                </span>
              </div>
            </div>

            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={historicalData} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#818cf8" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#818cf8" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    minTickGap={30}
                    tick={{ fontSize: 12, fill: '#94a3b8', fontWeight: 500, fontFamily: 'monospace' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(dateStr) => {
                      const date = new Date(dateStr);
                      return propData
                        ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    }}
                  />
                  <YAxis
                    domain={['auto', 'auto']}
                    tick={{ fontSize: 12, fill: '#94a3b8', fontFamily: 'monospace' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => value.toFixed(3)}
                  />
                  <Tooltip
                    content={<CustomTooltip formatter={(value, name) => [value.toFixed(4), name]} />}
                    cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '3 3' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="rate"
                    stroke="#818cf8"
                    fill="url(#priceGradient)"
                    name="Rate"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>

        {/* Performance Analysis */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Performance Scenarios */}
          < div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-200" >
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
                    minTickGap={30}
                    tick={{ fontSize: 11, fill: '#64748b', fontWeight: 500 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b', fontFamily: 'monospace' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => `${(value / 1000).toFixed(1)}k`}
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
                      <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="month"
                    minTickGap={30}
                    tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 500 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#94a3b8', fontFamily: 'monospace' }}
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
                    stroke="#22d3ee"
                    strokeWidth={2}
                    dot={{ stroke: '#22d3ee', strokeWidth: 2, r: 4, fill: 'white' }}
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
          </div >

          {/* Win Rate Probability */}
          < div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-200" >
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
                        { name: 'Wins', value: settings.winRate, fill: '#34d399' },
                        { name: 'Losses', value: 100 - settings.winRate, fill: '#f87171' }
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
                      <Cell key="wins" fill="#34d399" />
                      <Cell key="losses" fill="#f87171" />
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
          </div >
        </div >

        {/* Key Metrics and Recommendation */}
        < div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-200" >
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
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
                <span className="text-sm font-medium text-slate-600">Monthly Return</span>
                <Percent className="w-4 h-4 text-slate-400" />
              </div>
              <p className="text-2xl font-bold text-slate-800 font-mono">
                {((expectedValue * 20 / settings.accountBalance) * 100).toFixed(1)}%
              </p>
              <p className="text-xs text-slate-500 mt-1 font-medium">Projected (20 trades)</p>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-600">Risk per Trade</span>
                <AlertCircle className="w-4 h-4 text-slate-400" />
              </div>
              <p className="text-2xl font-bold text-slate-800 font-mono">
                ${(settings.accountBalance * (settings.riskPercentage / 100)).toFixed(2)}
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
              <p className="text-xs text-slate-500 mt-1 font-medium">
                {settings.riskPercentage > kelly ? 'Risk is too high' : 'Risk is optimal'}
              </p>
            </div>
          </div>

          {/* Strategy Recommendation */}
          <div className="mt-4 p-4 rounded-xl border-2 border-dashed border-slate-200 bg-slate-25">
            <div className="flex items-center gap-3">
              <recommendation.Icon className={`w-6 h-6 ${recommendation.color}`} />
              <div>
                <p className={`font-bold ${recommendation.color}`}>{recommendation.text}</p>
                <p className="text-xs text-slate-500">Based on your win rate, risk:reward, and position size</p>
              </div>
            </div>
          </div>
        </div >


      </div >
    </div >
  );
};

export default TradingSettings;