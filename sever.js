# server.js – WebSocket + API + Sun.Win Analytics Engine

```js
const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const os = require('os');
const http = require('http');

// ==================== CONFIG ====================
const PORT = process.env.PORT || 3001;
const WS_URL = 'wss://websocket.azhkthg1.net/websocket?token=YOUR_TOKEN';

const WS_HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  'Origin': 'https://play.sun.win'
};

const RECONNECT_DELAY = 2500;
const PING_INTERVAL = 15000;
const MAX_HISTORY = 100;
const MAX_PREDICTION_HISTORY = 200;

// ==================== APP ====================
const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

// ==================== STORAGE ====================
let ws = null;
let pingInterval = null;
let reconnectTimeout = null;

let currentSessionId = null;

let historyForPrediction = [];
let predictionHistory = [];

let currentPrediction = {
  prediction: 'Chờ dữ liệu',
  confidence: 0,
  confidenceText: 'N/A',
  details: {}
};

// ==================== NETWORK INFO ====================
function getNetworkInfo() {
  const interfaces = os.networkInterfaces();
  let localIP = '127.0.0.1';

  for (const ifaceName in interfaces) {
    for (const iface of interfaces[ifaceName]) {
      if (!iface.internal && iface.family === 'IPv4') {
        localIP = iface.address;
        break;
      }
    }
  }

  return {
    localIP,
    publicIP: null
  };
}

// ==================== UTIL ====================
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function calculateStdDev(arr) {
  if (!arr || arr.length < 2) return 0;

  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;

  const variance = arr.reduce((sum, val) => {
    return sum + Math.pow(val - mean, 2);
  }, 0) / arr.length;

  return Math.sqrt(variance);
}

function getDiceFrequencies(history, limit = 10) {
  const freq = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
    6: 0
  };

  history.slice(0, limit).forEach(item => {
    freq[item.d1]++;
    freq[item.d2]++;
    freq[item.d3]++;
  });

  return freq;
}

// ==================== BASIC ANALYTICS ====================
function detectStreak(history) {
  if (!history.length) {
    return {
      streak: 0,
      result: null
    };
  }

  const latest = history[0].result;

  let streak = 0;

  for (const item of history) {
    if (item.result === latest) {
      streak++;
    } else {
      break;
    }
  }

  return {
    streak,
    result: latest
  };
}

function trendPrediction(history) {
  if (history.length < 6) return null;

  const last10 = history.slice(0, 10);

  const tai = last10.filter(x => x.result === 'Tài').length;
  const xiu = last10.filter(x => x.result === 'Xỉu').length;

  if (tai > xiu + 2) return 'Xỉu';
  if (xiu > tai + 2) return 'Tài';

  return null;
}

function streakBreakPrediction(history) {
  const streakData = detectStreak(history);

  if (streakData.streak >= 5) {
    return streakData.result === 'Tài' ? 'Xỉu' : 'Tài';
  }

  return null;
}

function sumTrendPrediction(history) {
  if (history.length < 8) return null;

  const totals = history.slice(0, 8).map(x => x.totalScore);

  const avg = totals.reduce((a, b) => a + b, 0) / totals.length;

  if (avg >= 11) return 'Tài';
  if (avg <= 10) return 'Xỉu';

  return null;
}

function dicePatternPrediction(history) {
  if (history.length < 10) return null;

  const freq = getDiceFrequencies(history, 10);

  const highDice = freq[4] + freq[5] + freq[6];
  const lowDice = freq[1] + freq[2] + freq[3];

  if (highDice > lowDice + 4) return 'Tài';
  if (lowDice > highDice + 4) return 'Xỉu';

  return null;
}

// ==================== MAIN PREDICTION ====================
async function generateAdvancedPrediction(history) {
  if (!history || history.length < 6) {
    return {
      prediction: 'Chờ đủ 6 phiên',
      confidence: 0,
      confidenceText: 'N/A',
      details: {
        reason: 'Không đủ dữ liệu'
      }
    };
  }

  let taiScore = 0;
  let xiuScore = 0;

  const logicResults = [];

  const trend = trendPrediction(history);
  const streakBreak = streakBreakPrediction(history);
  const sumTrend = sumTrendPrediction(history);
  const dicePattern = dicePatternPrediction(history);

  if (trend) {
    logicResults.push({
      logic: 'trend',
      prediction: trend,
      weight: 1.2
    });
  }

  if (streakBreak) {
    logicResults.push({
      logic: 'streak_break',
      prediction: streakBreak,
      weight: 1.4
    });
  }

  if (sumTrend) {
    logicResults.push({
      logic: 'sum_trend',
      prediction: sumTrend,
      weight: 1.1
    });
  }

  if (dicePattern) {
    logicResults.push({
      logic: 'dice_pattern',
      prediction: dicePattern,
      weight: 1.0
    });
  }

  logicResults.forEach(item => {
    if (item.prediction === 'Tài') {
      taiScore += item.weight;
    } else {
      xiuScore += item.weight;
    }
  });

  const finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';

  const confidence = Math.round(
    clamp(
      (Math.abs(taiScore - xiuScore) / (taiScore + xiuScore + 0.01)) * 100,
      5,
      95
    )
  );

  let confidenceText = 'Thấp';

  if (confidence >= 70) confidenceText = 'Rất cao';
  else if (confidence >= 50) confidenceText = 'Cao';
  else if (confidence >= 30) confidenceText = 'Trung bình';

  return {
    prediction: finalPrediction,
    confidence,
    confidenceText: `${confidenceText} (${confidence}%)`,
    details: {
      taiScore,
      xiuScore,
      logicResults
    }
  };
}

// ==================== PROCESS GAME RESULT ====================
async function processResult(data) {
  try {
    const session = Number(data.session || data.sid || 0);

    if (!session || currentSessionId === session) {
      return;
    }

    currentSessionId = session;

    const d1 = Number(data.d1 || 1);
    const d2 = Number(data.d2 || 1);
    const d3 = Number(data.d3 || 1);

    const totalScore = d1 + d2 + d3;

    const result = totalScore >= 11 ? 'Tài' : 'Xỉu';

    const item = {
      session,
      sid: session,
      d1,
      d2,
      d3,
      totalScore,
      result,
      timestamp: Date.now()
    };

    historyForPrediction.unshift(item);

    if (historyForPrediction.length > MAX_HISTORY) {
      historyForPrediction.pop();
    }

    currentPrediction = await generateAdvancedPrediction(historyForPrediction);

    predictionHistory.unshift({
      phien: session + 1,
      prediction: currentPrediction.prediction,
      confidence: currentPrediction.confidence,
      createdAt: Date.now()
    });

    if (predictionHistory.length > MAX_PREDICTION_HISTORY) {
      predictionHistory.pop();
    }

    console.log('');
    console.log('======================================');
    console.log(`🎲 Phiên: ${session}`);
    console.log(`🎯 Kết quả: ${result}`);
    console.log(`🎲 Xúc xắc: ${d1}-${d2}-${d3}`);
    console.log(`📊 Tổng: ${totalScore}`);
    console.log('--------------------------------------');
    console.log(`🤖 Dự đoán tiếp theo: ${currentPrediction.prediction}`);
    console.log(`📈 Độ tin cậy: ${currentPrediction.confidenceText}`);
    console.log('======================================');
    console.log('');

  } catch (err) {
    console.error('Process result error:', err.message);
  }
}

// ==================== WEBSOCKET ====================
function startPing() {
  clearInterval(pingInterval);

  pingInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, PING_INTERVAL);
}

function reconnectWebSocket() {
  clearTimeout(reconnectTimeout);

  reconnectTimeout = setTimeout(() => {
    connectWebSocket();
  }, RECONNECT_DELAY);
}

function connectWebSocket() {
  try {
    console.log('🔄 Connecting WebSocket...');

    ws = new WebSocket(WS_URL, {
      headers: WS_HEADERS
    });

    ws.on('open', () => {
      console.log('✅ WebSocket connected to Sun.Win');

      startPing();
    });

    ws.on('message', async (buffer) => {
      try {
        const text = buffer.toString();

        let data;

        try {
          data = JSON.parse(text);
        } catch {
          return;
        }

        // Tuỳ websocket thật trả về
        // chỉnh lại key ở đây
        if (data?.data?.d1) {
          await processResult(data.data);
        }

      } catch (err) {
        console.error('Message parse error:', err.message);
      }
    });

    ws.on('close', () => {
      console.log('❌ WebSocket disconnected');

      clearInterval(pingInterval);

      reconnectWebSocket();
    });

    ws.on('error', (err) => {
      console.error('WS Error:', err.message);
    });

  } catch (err) {
    console.error('Connect error:', err.message);

    reconnectWebSocket();
  }
}

// ==================== API ====================
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    message: 'Sun.Win Prediction API Running',
    totalHistory: historyForPrediction.length,
    currentPrediction
  });
});

app.get('/prediction', (req, res) => {
  const lastResult = historyForPrediction[0] || null;

  const nextPhien = lastResult
    ? lastResult.session + 1
    : 'Chờ...';

  if (historyForPrediction.length < 6) {
    return res.json({
      lastResult,
      phien_hien_tai: nextPhien,
      Prediction: 'Chờ đủ 6 phiên',
      confidence: 'N/A'
    });
  }

  res.json({
    phien_hien_tai: nextPhien,
    du_doan: currentPrediction.prediction,
    do_tin_cay: currentPrediction.confidenceText,
    confidence_number: currentPrediction.confidence,
    last_result: lastResult,
    details: currentPrediction.details,
    history_count: historyForPrediction.length,
    timestamp: Date.now()
  });
});

app.get('/taixiu', (req, res) => {
  const last = historyForPrediction[0];

  if (!last) {
    return res.json({
      status: false,
      message: 'Chưa có dữ liệu'
    });
  }

  res.json({
    status: true,
    phien: last.session,
    ket_qua: last.result,
    tong: last.totalScore,
    xuc_xac: [last.d1, last.d2, last.d3],
    next_prediction: currentPrediction.prediction,
    confidence: currentPrediction.confidenceText
  });
});

app.get('/history', (req, res) => {
  res.json({
    total: historyForPrediction.length,
    data: historyForPrediction
  });
});

app.get('/prediction-history', (req, res) => {
  res.json({
    total: predictionHistory.length,
    data: predictionHistory
  });
});

app.get('/stats', (req, res) => {
  const tai = historyForPrediction.filter(x => x.result === 'Tài').length;
  const xiu = historyForPrediction.filter(x => x.result === 'Xỉu').length;

  const totals = historyForPrediction.map(x => x.totalScore);

  const avg = totals.length
    ? totals.reduce((a, b) => a + b, 0) / totals.length
    : 0;

  const streak = detectStreak(historyForPrediction);

  res.json({
    total_sessions: historyForPrediction.length,
    tai_count: tai,
    xiu_count: xiu,
    average_sum: avg.toFixed(2),
    current_streak: streak,
    std_dev: calculateStdDev(totals).toFixed(2)
  });
});

// ==================== START ====================
server.listen(PORT, '0.0.0.0', () => {
  const network = getNetworkInfo();

  console.log('');
  console.log('======================================');
  console.log('🚀 SUN.WIN API STARTED');
  console.log('======================================');
  console.log(`🌐 PORT: ${PORT}`);
  console.log(`📡 LOCAL: http://${network.localIP}:${PORT}`);
  console.log(`📊 Prediction API: /prediction`);
  console.log(`📜 History API: /history`);
  console.log(`🎯 TaiXiu API: /taixiu`);
  console.log('======================================');
  console.log('');

  connectWebSocket();
});
```

# package.json

```json
{
  "name": "sunwin-api",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.19.2",
    "ws": "^8.17.0"
  }
}
```

# Render Start Command

```bash
npm install
npm start
```

# API Endpoints

* GET /prediction
* GET /taixiu
* GET /history
* GET /prediction-history
* GET /stats

# Deploy Render

1. Upload GitHub
2. Create Web Service on Render
3. Build Command:

```bash
npm install
```

4. Start Command:

```bash
npm start
```
