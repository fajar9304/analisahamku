// =====================================================================
// 🔥 SERVER TERPADU: Scraper Saham & Kripto + Gemini Proxy + Token Fix
// =====================================================================

const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const fetch = require("node-fetch");
const { initializeApp } = require("firebase/app");
const { getDatabase, ref, set, remove } = require("firebase/database");
const { getAuth, signInAnonymously } = require("firebase/auth");

// ---------------------------------------------------------------------
// KONFIGURASI
// ---------------------------------------------------------------------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.5-flash-preview-09-2025";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
const GOOGLE_SEARCH_TOOL = { google_search: {} };

const STOCK_TICKERS_FOR_CRON = ["BBCA.JK", "BBRI.JK", "TLKM.JK"];
const CRYPTO_TICKERS_FOR_CRON = ["BTC-USD", "ETH-USD"];
const ALL_CRON_TICKERS = [...STOCK_TICKERS_FOR_CRON, ...CRYPTO_TICKERS_FOR_CRON];

const firebaseConfig = {
  apiKey: "AIzaSyCCV7FD5FQqVW1WnP-Zu6UWAhAz19dthso",
  authDomain: "analisahamku.firebaseapp.com",
  projectId: "analisahamku",
  storageBucket: "analisahamku.appspot.com",
  messagingSenderId: "503947258604",
  appId: "1:503947258604:web:f5b10c998ce395405413c9",
  databaseURL: "https://analisahamku-default-rtdb.asia-southeast1.firebasedatabase.app",
};

// ---------------------------------------------------------------------
// INISIALISASI SERVER & FIREBASE
// ---------------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;
const firebaseApp = initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);
const auth = getAuth(firebaseApp);
let currentToken = "";

app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------
// 🔐 AUTH ANONIM FIREBASE UNTUK SERVER
// ---------------------------------------------------------------------
async function ensureAuth() {
  if (!auth.currentUser) {
    try {
      await signInAnonymously(auth);
      console.log("✅ Server login anonim ke Firebase berhasil.");
    } catch (e) {
      console.error("❌ Gagal login anonim:", e.message);
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------
// 📊 SCRAPER SAHAM & KRIPTO (Yahoo Finance)
// ---------------------------------------------------------------------
async function getAssetPriceData(ticker) {
  try {
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
      ticker
    )}?modules=price`;
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!response.ok) return null;
    const json = await response.json();
    const result = json?.quoteSummary?.result?.[0]?.price;
    if (!result) return null;

    return {
      symbol: result.symbol,
      shortName: result.shortName || result.longName || result.symbol,
      currency: result.currency,
      regularMarketPrice: result.regularMarketPrice?.raw ?? null,
      regularMarketChangePercent: result.regularMarketChangePercent?.fmt ?? null,
    };
  } catch (error) {
    console.error(`⚠️ Gagal mengambil data harga untuk ${ticker}:`, error.message);
    return null;
  }
}

// ---------------------------------------------------------------------
// 🤖 ANALISIS AI via PROXY INTERNAL (TOKEN OTOMATIS)
// ---------------------------------------------------------------------
async function getAiAnalysisViaProxy(assetName, isCrypto) {
  let prompt;
  if (isCrypto) {
    prompt = `Berikan ringkasan singkat (maksimal 2 kalimat) mengenai sentimen pasar dan volatilitas saat ini untuk aset crypto ${assetName}.`;
  } else {
    prompt = `Berikan ringkasan singkat (maksimal 2 kalimat) mengenai sentimen pasar saat ini untuk saham ${assetName}.`;
  }

  const proxyUrl = `http://localhost:${PORT}/api/gemini-proxy`;
  try {
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-auth-token": currentToken, // ✅ token otomatis dikirim
      },
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`⚠️ Proxy call failed (${response.status}):`, err);
      return "Analisis AI tidak tersedia (Proxy error).";
    }

    const data = await response.json();
    return data.text || "Tidak ada analisis.";
  } catch (error) {
    console.error(`⚠️ Gagal analisis AI via Proxy untuk ${assetName}:`, error.message);
    return "Gagal memuat analisis AI.";
  }
}

// ---------------------------------------------------------------------
// 🧠 MESIN ANALISIS OTOMATIS
// ---------------------------------------------------------------------
async function runAnalysisEngine() {
  console.log(`[${new Date().toLocaleString("id-ID")}] 🚀 Menjalankan analisis saham & kripto...`);

  if (!(await ensureAuth())) {
    console.error("❌ Autentikasi Firebase gagal.");
    return;
  }

  for (const ticker of ALL_CRON_TICKERS) {
    const isCrypto = ticker.endsWith("-USD");
    const priceData = await getAssetPriceData(ticker);
    if (!priceData) continue;

    const aiSummary = await getAiAnalysisViaProxy(priceData.shortName, isCrypto);
    const combinedData = {
      ...priceData,
      aiAnalysis: aiSummary,
      lastUpdated: new Date().toISOString(),
    };

    try {
      const dbRef = ref(database, "stock_analysis/" + ticker.replace(".", "_").replace("-", "_"));
      await set(dbRef, combinedData);
      console.log(`✅ Data ${ticker} tersimpan.`);
    } catch (error) {
      console.error(`❌ Gagal menyimpan ${ticker}:`, error.message);
    }
  }
  console.log("🟢 Siklus analisis selesai.\n");
}

// ---------------------------------------------------------------------
// 🔑 TOKEN HANDLER
// ---------------------------------------------------------------------
async function generateAndSaveNewToken() {
  if (!(await ensureAuth())) return;
  const oldToken = currentToken;
  const newToken = Math.floor(100000 + Math.random() * 900000).toString();
  currentToken = newToken;

  try {
    const tokenRef = ref(database, "tokens/" + currentToken);
    await set(tokenRef, { createdAt: new Date().toISOString() });
    console.log(`🔑 Token baru ${currentToken} disimpan ke Firebase.`);
    if (oldToken) await remove(ref(database, "tokens/" + oldToken));
  } catch (error) {
    console.error("❌ Gagal simpan token:", error.message);
  }
}

// ---------------------------------------------------------------------
// 🌐 ENDPOINTS
// ---------------------------------------------------------------------

// ✅ Ambil token aktif
app.get("/api/get-token", (req, res) => {
  if (!currentToken) return res.status(500).json({ error: "Token belum tersedia di server." });
  res.json({ token: currentToken });
});

// ✅ Ambil data saham/kripto + analisis
app.get("/api/:symbol", async (req, res) => {
  const { symbol } = req.params;
  const isCrypto = symbol.endsWith("-USD");
  const priceData = await getAssetPriceData(symbol);
  if (!priceData) return res.status(404).json({ error: `Data ${symbol} tidak ditemukan.` });

  const aiSummary = await getAiAnalysisViaProxy(priceData.shortName, isCrypto);
  const result = { ...priceData, aiAnalysis: aiSummary };
  res.json(result);
});

// ✅ Proxy Gemini (cek token)
app.post("/api/gemini-proxy", async (req, res) => {
  const clientToken = req.headers["x-auth-token"];
  if (!clientToken && req.hostname !== "localhost") {
    return res.status(401).json({ error: "Unauthorized: Missing token." });
  }

  const tokenUrl = `${firebaseConfig.databaseURL}/tokens/${clientToken}.json`;
  const tokenRes = await fetch(tokenUrl);
  const tokenData = await tokenRes.json();
  if (!tokenData && req.hostname !== "localhost") {
    return res.status(401).json({ error: "Unauthorized: Invalid token." });
  }

  const { prompt, schema } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt is required." });

  let payload = { contents: [{ parts: [{ text: prompt }] }] };
  if (schema) {
    payload.generationConfig = {
      responseMimeType: "application/json",
      responseSchema: JSON.parse(schema),
    };
  } else {
    payload.tools = [GOOGLE_SEARCH_TOOL];
  }

  try {
    const geminiResp = await fetch(GEMINI_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await geminiResp.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "Tidak ada hasil.";
    res.json({ text });
  } catch (e) {
    console.error("Gemini Proxy Error:", e.message);
    res.status(500).json({ error: "Internal server error during Gemini call." });
  }
});

// Root check
app.get("/", (req, res) => res.send("✅ Server Scraper & Gemini Proxy aktif!"));

// ---------------------------------------------------------------------
// 🚀 JALANKAN SERVER
// ---------------------------------------------------------------------
app.listen(PORT, async () => {
  console.log(`🌍 Server berjalan di port ${PORT}`);
  await ensureAuth();
  await generateAndSaveNewToken();
  await runAnalysisEngine();

  cron.schedule("*/30 * * * *", generateAndSaveNewToken);
  cron.schedule("0 * * * *", runAnalysisEngine);
  console.log("⏱️ Jadwal token & analisis aktif setiap jam.");
});
