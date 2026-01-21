// AI Chat Service - Uses Groq Cloud API (Llama 3) for high-speed forex analysis
// Get your free API key at: https://console.groq.com/keys

const GROQ_API_KEY = process.env.REACT_APP_GROQ_API_KEY || 'YOUR_GROQ_API_KEY';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile'; // Latest Llama 3.3 70B model

/**
 * Formats forex data into a context string for the AI
 */
export const formatForexContext = (forexData) => {
    if (!forexData || forexData.length === 0) {
        return "No forex data available yet.";
    }

    const timestamp = new Date().toLocaleString();

    let context = `## LIVE FOREX MARKET DATA (as of ${timestamp})\n\n`;

    // Sort by confidence for better context
    const sortedData = [...forexData]
        .filter(d => d.prediction)
        .sort((a, b) => (b.prediction?.confidence || 0) - (a.prediction?.confidence || 0));

    sortedData.forEach((item, index) => {
        const p = item.prediction;
        if (!p) return;

        const signal = p.trend === 'bullish' ? 'BUY' : p.trend === 'bearish' ? 'SELL' : 'HOLD';
        const trend = p.ema12 > p.ema26 ? 'Uptrend' : 'Downtrend';
        const macdSignal = p.macd.histogram > 0 ? 'Bullish' : 'Bearish';
        const rsiStatus = p.rsi > 70 ? 'Overbought' : p.rsi < 30 ? 'Oversold' : 'Neutral';

        context += `### ${index + 1}. ${item.pair.name} (${item.pair.symbol})\n`;
        context += `- **Current Price**: ${item.currentRate?.toFixed(item.pair.pipDigits || 5)}\n`;
        context += `- **Signal**: ${signal}\n`;
        context += `- **Confidence**: ${p.confidence?.toFixed(0)}%\n`;
        context += `- **RSI (14)**: ${p.rsi?.toFixed(1)} (${rsiStatus})\n`;
        context += `- **MACD Histogram**: ${p.macd.histogram?.toFixed(5)} (${macdSignal})\n`;
        context += `- **Trend**: ${trend} (EMA12: ${p.ema12?.toFixed(5)}, EMA26: ${p.ema26?.toFixed(5)})\n`;
        context += `- **Bollinger %B**: ${(p.bollinger.percentB * 100)?.toFixed(0)}%\n`;
        context += `- **Predicted Target**: ${p.predictedPrice?.toFixed(item.pair.pipDigits || 5)}\n`;
        context += `- **ATR (Volatility)**: ${p.atr?.toFixed(5)}\n\n`;
    });

    // Add market summary
    const bullishCount = sortedData.filter(d => d.prediction?.trend === 'bullish').length;
    const bearishCount = sortedData.filter(d => d.prediction?.trend === 'bearish').length;
    const neutralCount = sortedData.length - bullishCount - bearishCount;

    context += `## MARKET SUMMARY\n`;
    context += `- Total Pairs Tracked: ${sortedData.length}\n`;
    context += `- Bullish Signals: ${bullishCount}\n`;
    context += `- Bearish Signals: ${bearishCount}\n`;
    context += `- Neutral Signals: ${neutralCount}\n`;
    context += `- Highest Confidence: ${sortedData[0]?.pair.symbol} (${sortedData[0]?.prediction?.confidence?.toFixed(0)}%)\n`;

    return context;
};

/**
 * System prompt that defines the AI's personality and capabilities
 */
const getSystemPrompt = (forexContext) => {
    return `You are QuantAI, an expert forex trading analyst AI assistant. You have access to real-time market data and technical indicators.

## YOUR CAPABILITIES:
- Analyze currency pairs using technical indicators (RSI, MACD, Bollinger Bands, EMA)
- Provide buy/sell/hold recommendations with reasoning
- Explain technical concepts in simple terms
- Assess risk levels and suggest position sizing
- Compare currencies and identify opportunities

## YOUR PERSONALITY:
- Professional but approachable
- Data-driven and analytical
- Cautious about risk - always mention stop losses
- Educational - explain WHY, not just WHAT

## RESPONSE GUIDELINES:
- Use emojis sparingly for visual clarity (🟢 for buy, 🔴 for sell, ⚪ for hold)
- Keep responses concise but informative
- Always base recommendations on the actual data provided
- If asked about a specific pair, focus on that pair's data
- Include confidence levels and key indicators in your analysis
- Warn about risks when confidence is below 60%

## CURRENT MARKET DATA:
${forexContext}

## IMPORTANT RULES:
1. Only recommend trades based on the data above - never make up data
2. If RSI is 0.0 or 50.0 exactly, mention that more data is needed for accurate RSI
3. Always remind users that forex trading involves risk
4. Be honest if a signal seems contradictory (e.g., bearish MACD but bullish trend)
5. Explain your reasoning using the actual indicator values`;
};

/**
 * Sends a message to Groq API and returns the AI response
 */
export const sendMessageToAI = async (userMessage, forexData, conversationHistory = []) => {
    // Check if API key is configured
    if (GROQ_API_KEY === 'YOUR_GROQ_API_KEY') {
        return {
            success: false,
            error: 'API_KEY_MISSING',
            message: `⚠️ **AI not configured**

To enable AI-powered responses, you need to:

1. Get a free Groq API key at:
   https://console.groq.com/keys

2. Open \`src/services/aiChatService.js\`

3. Replace \`YOUR_GROQ_API_KEY\` with your key

The chat will use Llama 3 for intelligent analysis once configured!`
        };
    }

    try {
        const forexContext = formatForexContext(forexData);
        const systemPromptMessage = { role: 'system', content: getSystemPrompt(forexContext) };

        // Prepare messages array (OpenAI format)
        // 1. System Prompt with Data
        // 2. Recent history (last 6 messages)
        // 3. User message

        const messages = [systemPromptMessage];

        if (conversationHistory.length > 0) {
            const recentHistory = conversationHistory.slice(-6).map(m => ({
                role: m.role,
                content: m.content
            }));
            messages.push(...recentHistory);
        }

        // Add current user message if it's not already in history (it usually is handled by caller, but safe to ensure)
        // In our implementation, the caller might append it to UI state before calling this. 
        // We'll trust the caller passes 'userMessage' as the NEW message to send.
        messages.push({ role: 'user', content: userMessage });

        const response = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: MODEL,
                messages: messages,
                temperature: 0.5,
                max_tokens: 1024,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('Groq API Error:', errorData);

            if (response.status === 429) {
                return {
                    success: false,
                    error: 'RATE_LIMITED',
                    message: '⏳ API rate limit reached. Please wait a moment and try again.'
                };
            }

            return {
                success: false,
                error: 'API_ERROR',
                message: `❌ AI service error: ${errorData.error?.message || 'Unknown error'}`
            };
        }

        const data = await response.json();

        if (data.choices && data.choices[0]?.message?.content) {
            return {
                success: true,
                message: data.choices[0].message.content
            };
        }

        return {
            success: false,
            error: 'EMPTY_RESPONSE',
            message: '🤔 The AI returned an empty response. Please try rephrasing your question.'
        };

    } catch (error) {
        console.error('AI Chat Error:', error);
        return {
            success: false,
            error: 'NETWORK_ERROR',
            message: `🔌 Connection error: ${error.message}. Check your internet connection.`
        };
    }
};

/**
 * Fallback to rule-based responses when AI is unavailable
 */
export const getFallbackResponse = (userMessage, forexData) => {
    const up = userMessage.toUpperCase();

    if (!forexData || forexData.length === 0) {
        return "⏳ Market data is loading. Please wait a moment...";
    }

    const validData = forexData.filter(d => d.prediction && d.prediction.confidence > 0);
    const sorted = [...validData].sort((a, b) => b.prediction.confidence - a.prediction.confidence);

    // Simple intent matching
    if (up.includes('BUY') || up.includes('LONG')) {
        const bullish = sorted.filter(d => d.prediction.trend === 'bullish');
        if (bullish.length > 0) {
            const best = bullish[0];
            return `🟢 **Top BUY: ${best.pair.symbol}**
      
• Price: ${best.currentRate?.toFixed(best.pair.pipDigits || 5)}
• Confidence: ${best.prediction.confidence?.toFixed(0)}%
• RSI: ${best.prediction.rsi?.toFixed(1)}
• Target: ${best.prediction.predictedPrice?.toFixed(best.pair.pipDigits || 5)}

⚠️ AI analysis unavailable. Configure API key for detailed insights.`;
        }
        return "No strong BUY signals detected right now.";
    }

    if (up.includes('SELL') || up.includes('SHORT')) {
        const bearish = sorted.filter(d => d.prediction.trend === 'bearish');
        if (bearish.length > 0) {
            const best = bearish[0];
            return `🔴 **Top SELL: ${best.pair.symbol}**
      
• Price: ${best.currentRate?.toFixed(best.pair.pipDigits || 5)}
• Confidence: ${best.prediction.confidence?.toFixed(0)}%
• RSI: ${best.prediction.rsi?.toFixed(1)}
• Target: ${best.prediction.predictedPrice?.toFixed(best.pair.pipDigits || 5)}

⚠️ AI analysis unavailable. Configure API key for detailed insights.`;
        }
        return "No strong SELL signals detected right now.";
    }

    // Default
    if (sorted.length > 0) {
        const best = sorted[0];
        const signal = best.prediction.trend === 'bullish' ? '🟢 BUY' :
            best.prediction.trend === 'bearish' ? '🔴 SELL' : '⚪ HOLD';
        return `📊 **Best Setup: ${best.pair.symbol}** - ${signal}

• Confidence: ${best.prediction.confidence?.toFixed(0)}%
• Price: ${best.currentRate?.toFixed(best.pair.pipDigits || 5)}

Configure the Groq API key for intelligent AI analysis!`;
    }

    return "I'm analyzing the markets. Ask me about specific pairs or what to buy/sell!";
};
