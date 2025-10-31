// Server Scraper Saham & Kripto + Gemini Proxy (v6 - Stable & Auto-Fallback)

import express from "express";
import cors from "cors";
import cron from "node-cron";
import fetch from "node-fetch";
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getDatabase, ref, set, remove } from "firebase/database";

// === FIREBASE CONFIG ===
const firebaseConfig = {
  apiKey: "AIzaSyCCV7FD5FQqVW1WnP-Zu6UWAhAz19dthso",
  authDomain: "analisahamku.firebaseapp.com",
  databaseURL: "https://analisahamku-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "analisahamku",
  storageBucket: "analisahamku.firebasestorage.app",
  messagingSenderId: "503947258604",
  appId: "1:503947258604:web:f5b10c998ce395405413c9"
};

// === MODEL AI CONFIG ===
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
const GOOGLE_SEARCH_TOOL = { google_search: {} };

// === ASET LIST ===
const STOCK_TICKERS_FOR_CRON = ["BBCA.JK", "BBRI.JK", "TLKM.JK"];
const CRYPTO_TICKERS_FOR_CRON = ["BTC-USD", "ETH-USD"];
const ALL_CRON_TICKERS = [...STOCK_TICKERS_FOR_CRON, ...CRYPTO_TICKERS_FOR_CRON];

// === INISIALISASI ===
const app = express();
const PORT = process.env.PORT || 3000;
const firebaseApp = initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);
const auth = getAuth(firebaseApp);
let currentToken = "";

app.use(cors());
app.use(express.json());

// === FIREBASE LOGIN ANONIM ===
async function ensureAuth() {
  if (!auth.currentUser) {
    try {
      await signInAnonymously(auth);
      console.log("✅ Firebase login anonim berhasil.");
    } catch (e) {
      console.error("❌ Gagal login anonim:", e.message);
      return false;
    }
  }
  return true;
}

// === SCRAPER SAHAM & KRIPTO ===
async function getAssetPriceData(ticker) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Connection: "keep-alive",
  };

  try {
    console.log(`🔍 Fetching data untuk ${ticker} dari Yahoo...`);
    const res = await fetch(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(
        ticker
      )}`,
      { headers, timeout: 8000 }
    );
    const json = await res.json();
    const result = json?.quoteResponse?.result?.[0];

    if (result && result.regularMarketPrice) {
      console.log(`✅ Data ${ticker} berhasil diambil dari Yahoo.`);
      return {
        symbol: result.symbol || ticker,
        shortName: result.shortName || result.longName || ticker,
        currency: result.currency || "IDR",
        regularMarketPrice:
          result.regularMarketPrice?.raw || result.regularMarketPrice || null,
        regularMarketChangePercent:
          result.regularMarketChangePercent?.raw ||
          result.regularMarketChangePercent ||
          null,
      };
    }

    // === Fallback ke CoinGecko (jika crypto)
    if (ticker.endsWith("-USD")) {
      console.log(`⚠️ Yahoo gagal, fallback ke CoinGecko untuk ${ticker}`);
      const coinId = ticker.split("-")[0].toLowerCase();
      const cgRes = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`
      );
      const cgJson = await cgRes.json();
      if (cgJson[coinId]) {
        return {
          symbol: ticker,
          shortName: coinId.toUpperCase(),
          currency: "USD",
          regularMarketPrice: cgJson[coinId].usd,
          regularMarketChangePercent: null,
        };
      }
    }

    // === Jika tidak dapat data sama sekali
    console.warn(`❌ Tidak ada data ditemukan untuk ${ticker}`);
    return null;
  } catch (e) {
    console.error(`❌ Error fetch ${ticker}:`, e.message);
    return null;
  }
}

// === ANALISIS AI ===
async function getAiAnalysis(assetName, isCrypto) {
  const prompt = isCrypto
    ? `Berikan ringkasan singkat (maksimal 2 kalimat) tentang sentimen pasar dan volatilitas terkini untuk aset kripto ${assetName}.`
    : `Berikan ringkasan singkat (maksimal 2 kalimat) tentang sentimen pasar saat ini untuk saham ${assetName}.`;

  try {
    const res = await fetch(GEMINI_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [GOOGLE_SEARCH_TOOL],
      }),
    });
    const data = await res.json();
    return (
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Analisis AI tidak tersedia."
    );
  } catch (e) {
    console.error("❌ Gagal AI:", e.message);
    return "Analisis AI gagal dimuat.";
  }
}

// === ENGINE ===
async function runAnalysisEngine() {
  console.log(`🚀 Jalankan analisis ${new Date().toLocaleString()}`);
  if (!(await ensureAuth())) return;

  for (const ticker of ALL_CRON_TICKERS) {
    const isCrypto = ticker.endsWith("-USD");
    const data = await getAssetPriceData(ticker);
    if (!data) continue;

    const ai = await getAiAnalysis(data.shortName, isCrypto);
    const final = {
      ...data,
      aiAnalysis: ai,
      lastUpdated: new Date().toISOString(),
    };
    try {
      await set(
        ref(database, "stock_analysis/" + ticker.replace(/[.-]/g, "_")),
        final
      );
      console.log(`✅ ${ticker} disimpan ke Firebase.`);
    } catch (e) {
      console.error(`❌ Gagal simpan ${ticker}:`, e.message);
    }
  }
  console.log("♻️ Siklus selesai.");
}

// === TOKEN ===
async function generateAndSaveNewToken() {
  if (!(await ensureAuth())) return;
  const oldToken = currentToken;
  const newToken = Math.floor(100000 + Math.random() * 900000).toString();
  currentToken = newToken;
  try {
    await set(ref(database, "tokens/" + newToken), {
      createdAt: new Date().toISOString(),
    });
    if (oldToken) await remove(ref(database, "tokens/" + oldToken));
    console.log(`🔑 Token baru: ${newToken}`);
  } catch (e) {
    console.error("❌ Gagal simpan token:", e.message);
  }
}

// === ROUTES ===
app.get("/", (_, res) => res.send("✅ Server Scraper & Gemini Proxy aktif!"));

// ⬆️ Pastikan ini di atas /api/:symbol
app.get("/api/token", (_, res) => {
  if (!currentToken)
    return res.status(500).json({ error: "Token belum tersedia." });
  res.json({ token: currentToken });
});

app.get("/api/:symbol", async (req, res) => {
  const { symbol } = req.params;
  const isCrypto = symbol.endsWith("-USD");
  const data = await getAssetPriceData(symbol);
  if (!data)
    return res.status(404).json({ error: `Data tidak ditemukan: ${symbol}` });
  const ai = await getAiAnalysis(data.shortName, isCrypto);
  res.json({ ...data, aiAnalysis: ai });
});

// === START SERVER ===
app.listen(PORT, async () => {
  console.log(`✅ Server aktif di port ${PORT}`);
  await ensureAuth();
  await generateAndSaveNewToken();
  await runAnalysisEngine();
  cron.schedule("*/30 * * * *", generateAndSaveNewToken);
  cron.schedule("0 * * * *", runAnalysisEngine);
  console.log("🕒 Scheduler aktif.");
});
