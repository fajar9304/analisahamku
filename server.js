// ======================================================
// 📈 SERVER FINAL: Analisa Saham & Kripto (Yahoo + Gemini + Firebase)
// ======================================================

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const fetch = require('node-fetch');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, remove } = require('firebase/database');
const { getAuth, signInAnonymously } = require('firebase/auth');

// ------------------------------------------------------
// 🔐 KONFIGURASI
// ------------------------------------------------------

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash-preview-09-2025';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
const GOOGLE_SEARCH_TOOL = { "google_search": {} };

const STOCK_TICKERS_FOR_CRON = ['BBCA.JK', 'BBRI.JK', 'TLKM.JK'];
const CRYPTO_TICKERS_FOR_CRON = ['BTC-USD', 'ETH-USD'];
const ALL_CRON_TICKERS = [...STOCK_TICKERS_FOR_CRON, ...CRYPTO_TICKERS_FOR_CRON];

const firebaseConfig = {
  apiKey: "AIzaSyCCV7FD5FQqVW1WnP-Zu6UWAhAz19dthso",
  authDomain: "analisahamku.firebaseapp.com",
  projectId: "analisahamku",
  storageBucket: "analisahamku.appspot.com",
  messagingSenderId: "503947258604",
  appId: "1:503947258604:web:f5b10c998ce395405413c9",
  databaseURL: "https://analisahamku-default-rtdb.asia-southeast1.firebasedatabase.app"
};

// ------------------------------------------------------
// 🧠 INISIALISASI
// ------------------------------------------------------

const app = express();
const PORT = process.env.PORT || 3000;
const firebaseApp = initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);
const auth = getAuth(firebaseApp);
let currentToken = '';

app.use(cors());
app.use(express.json());

// ------------------------------------------------------
// 🔐 FUNGSI AUTHENTIKASI ANONIM
// ------------------------------------------------------

async function ensureAuth() {
  if (!auth.currentUser) {
    try {
      await signInAnonymously(auth);
      console.log("✅ Server: Login anonim Firebase berhasil.");
    } catch (e) {
      console.error("❌ Gagal login anonim Firebase:", e.message);
      return false;
    }
  }
  return true;
}

// ------------------------------------------------------
// 💹 FUNGSI SCRAPER DATA HARGA (Yahoo v7)
// ------------------------------------------------------

async function getAssetPriceData(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      console.error(`❌ HTTP ${response.status} untuk ${ticker}`);
      return null;
    }

    const json = await response.json();
    const result = json?.quoteResponse?.result?.[0];
    if (!result) return null;

    return {
      symbol: result.symbol,
      shortName: result.shortName || result.longName || result.symbol,
      currency: result.currency,
      regularMarketPrice: result.regularMarketPrice ?? null,
      regularMarketChangePercent: result.regularMarketChangePercent ?? null,
    };
  } catch (error) {
    console.error(`⚠️ Gagal ambil data harga ${ticker}:`, error.message);
    return null;
  }
}

// ------------------------------------------------------
// 🤖 FUNGSI ANALISIS GEMINI (via Proxy Internal)
// ------------------------------------------------------

async function getAiAnalysisViaProxy(assetName, isCrypto) {
  const prompt = isCrypto
    ? `Berikan ringkasan singkat (maksimal 2 kalimat) mengenai sentimen pasar dan volatilitas saat ini untuk aset crypto ${assetName}.`
    : `Berikan ringkasan singkat (maksimal 2 kalimat) mengenai sentimen pasar saat ini untuk saham ${assetName}.`;

  try {
    const response = await fetch(`http://localhost:${PORT}/api/gemini-proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-auth-token': currentToken },
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Proxy error (${response.status}):`, errorText);
      return "Analisis AI tidak tersedia.";
    }

    const data = await response.json();
    return data.text || "Tidak ada analisis.";
  } catch (error) {
    console.error("⚠️ Error AI Proxy:", error.message);
    return "Gagal memuat analisis AI.";
  }
}

// ------------------------------------------------------
// ⚙️ ENGINE UTAMA ANALISIS
// ------------------------------------------------------

async function runAnalysisEngine() {
  console.log(`[${new Date().toLocaleString('id-ID')}] ▶️ Menjalankan engine analisis...`);

  if (!await ensureAuth()) return;

  for (const ticker of ALL_CRON_TICKERS) {
    const isCrypto = ticker.endsWith('-USD');
    const priceData = await getAssetPriceData(ticker);
    if (!priceData) {
      console.warn(`⚠️ Data ${ticker} kosong, lewati.`);
      continue;
    }

    const aiSummary = await getAiAnalysisViaProxy(priceData.shortName, isCrypto);

    const combinedData = {
      ...priceData,
      aiAnalysis: aiSummary,
      lastUpdated: new Date().toISOString()
    };

    try {
      const dbRef = ref(database, 'stock_analysis/' + ticker.replace('.', '_').replace('-', '_'));
      await set(dbRef, combinedData);
      console.log(`✅ ${ticker} disimpan ke Firebase.`);
    } catch (error) {
      console.error(`❌ Gagal simpan ${ticker}:`, error.message);
    }
  }

  console.log("✅ Siklus analisis selesai.");
}

// ------------------------------------------------------
// 🔑 TOKEN MANAGEMENT
// ------------------------------------------------------

async function generateAndSaveNewToken() {
  if (!await ensureAuth()) return;

  const oldToken = currentToken;
  const newToken = Math.floor(100000 + Math.random() * 900000).toString();
  currentToken = newToken;

  try {
    const tokenRef = ref(database, 'tokens/' + currentToken);
    await set(tokenRef, { createdAt: new Date().toISOString() });

    console.log(`🔐 Token baru ${currentToken} tersimpan di Firebase.`);

    if (oldToken) {
      const oldTokenRef = ref(database, 'tokens/' + oldToken);
      await remove(oldTokenRef);
      console.log(`🗑️ Token lama ${oldToken} dihapus.`);
    }
  } catch (e) {
    console.error("❌ Gagal simpan token:", e.message);
  }
}

// ------------------------------------------------------
// 🌐 API ROUTES
// ------------------------------------------------------

app.get("/", (req, res) => res.send("✅ Server Scraper & Gemini Proxy aktif!"));

// ✅ Endpoint ambil token aktif
app.get('/api/get-token', (req, res) => {
  if (!currentToken) return res.status(500).json({ error: 'Token belum tersedia di server.' });
  res.json({ token: currentToken });
});

// ✅ Endpoint ambil data saham/kripto real-time
app.get("/api/:symbol", async (req, res) => {
  const { symbol } = req.params;
  const isCrypto = symbol.endsWith('-USD');
  const priceData = await getAssetPriceData(symbol);

  if (!priceData) return res.status(404).json({ error: `Data tidak ditemukan: ${symbol}` });

  const aiSummary = await getAiAnalysisViaProxy(priceData.shortName, isCrypto);

  res.json({
    ...priceData,
    companyName: priceData.shortName,
    aiAnalysis: aiSummary,
    chart: { result: [{ meta: { regularMarketPrice: priceData.regularMarketPrice } }] }
  });
});

// ✅ Endpoint Gemini Proxy
app.post('/api/gemini-proxy', async (req, res) => {
  const clientToken = req.headers['x-auth-token'];
  if (!clientToken || clientToken !== currentToken)
    return res.status(401).json({ error: "Unauthorized: Missing or invalid token." });

  if (!GEMINI_API_KEY)
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured.' });

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt is required.' });

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [GOOGLE_SEARCH_TOOL]
  };

  try {
    const geminiResponse = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const geminiResult = await geminiResponse.json();
    const textData = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text;
    res.json({ text: textData || "Tidak ada analisis." });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ------------------------------------------------------
// 🕐 JADWAL & START SERVER
// ------------------------------------------------------

app.listen(PORT, async () => {
  console.log(`🚀 Server berjalan di port ${PORT}`);
  await ensureAuth();
  await generateAndSaveNewToken();
  await runAnalysisEngine();

  cron.schedule('*/30 * * * *', generateAndSaveNewToken);
  cron.schedule('0 * * * *', runAnalysisEngine);

  console.log("⏱️ Cron aktif: Token (30m), Analisis (1h)");
});
