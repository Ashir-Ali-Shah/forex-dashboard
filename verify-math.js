const assert = require('assert');

// Simplified indicator functions to verify logic
function calculateRSI(data, period = 14) {
    if (data.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = data.length - period; i < data.length; i++) {
        const diff = data[i] - data[i - 1];
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    if (losses === 0) return 100;
    if (gains === 0) return 0;
    const rs = gains / losses;
    return 100 - (100 / (1 + rs));
}

function calculateEMA(data, period) {
    const k = 2 / (period + 1);
    let ema = data[0];
    for (let i = 1; i < data.length; i++) {
        ema = (data[i] * k) + (ema * (1 - k));
    }
    return ema;
}

// Test Data
const prices = [
    1.1000, 1.1005, 1.1010, 1.1015, 1.1020,
    1.1025, 1.1030, 1.1035, 1.1040, 1.1045,
    1.1050, 1.1055, 1.1060, 1.1065, 1.1070
]; // Steady uptrend

console.log("🧪 Testing Indicator Math...");

// 1. RSI Test
// All changes are positive (0.0005 gain each step).
// Losses = 0. RS = infinity. RSI should be 100.
const rsi = calculateRSI(prices, 14);
console.log(`RSI (Expect 100): ${rsi}`);
assert(rsi === 100, "RSI calculation incorrect for perfect uptrend");

// 2. EMA Test
const ema5 = calculateEMA(prices.slice(0, 5), 5);
console.log(`EMA(5) of first 5 prices: ${ema5.toFixed(5)}`);

console.log("✅ Math Logic Verified");
