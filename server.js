// Server Scraper Saham & Kripto + Gemini Proxy Aman (FINAL v5 - FIX route & fetch)

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

// === ASSET LIST ===
const STOCK_TICKERS_FOR_CRON = ["BBCA.JK", "BBRI.JK", "TLKM.JK"];
const CRYPTO_TICKERS_FOR_CRON = ["BTC-USD", "ETH-USD"];
const ALL_CRON_TICKERS = [...STOCK_TICKERS_FOR_CRON, ...CRYPTO_TICKERS_FOR_CRON];

// === INIT FIREBASE & SERVER ===
const app = express();
const PORT = process.env.PORT || 3000;
const firebaseApp = initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);
const auth = getAuth(firebaseApp);
let currentToken = "";

app.use(cors());
app.use(express.json());

// === FIREBASE AUTH ===
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

// === SCRAPER ===
async function getAssetPriceData(ticker) {
  try {
    const headers = { "User-Agent": "Mozilla/5.0" };
    // 1️⃣ Coba ambil dari Yahoo Finance
    let response = await fetch(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(
        ticker
      )}`,
      { headers }
    );
    const json = await response.json();
    let result = json?.quoteResponse?.result?.[0];

    // 2️⃣ Fallback ke CoinGecko jika crypto tidak ditemukan
    if ((!result || !result.regularMarketPrice) && ticker.endsWith("-USD")) {
      const coinId = ticker.split("-")[0].toLowerCase();
      const cg = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`
      );
      const cgData = await cg.json();
      if (cgData[coinId]) {
        result = {
          symbol: ticker,
          shortName: coinId.toUpperCase(),
          currency: "USD",
          regularMarketPrice: cgData[coinId].usd,
          regularMarketChangePercent: null,
        };
      }
    }

    if (!result) return null;

    return {
      symbol: result.symbol || ticker,
      shortName: result.shortName || result.longName || ticker,
      currency: result.currency || "IDR",
      regularMarketPrice:
        result.regularMarketPrice?.raw ||
        result.regularMarketPrice ||
        null,
      regularMarketChangePercent:
        result.regularMarketChangePercent?.raw ||
        result.regularMarketChangePercent ||
        null,
    };
  } catch (e) {
    console.error(`❌ Gagal fetch ${ticker}:`, e.message);
    return null;
  }
}

// === AI ANALYSIS ===
async function getAiAnalysis(assetName, isCrypto) {
  const prompt = isCrypto
    ? `Berikan ringkasan singkat (maksimal 2 kalimat) tentang sentimen pasar dan volatilitas terkini untuk aset kripto ${assetName}.`
    : `Berikan ringkasan singkat (maksimal 2 kalimat) tentang sentimen pasar untuk saham ${assetName}.`;

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
    if (!data) {
      console.warn(`⚠️ Tidak ada data untuk ${ticker}`);
      continue;
    }
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

// ⬆️ PENTING: letakkan /api/token SEBELUM /api/:symbol
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

// === START ===
app.listen(PORT, async () => {
  console.log(`✅ Server aktif di port ${PORT}`);
  await ensureAuth();
  await generateAndSaveNewToken();
  await runAnalysisEngine();
  cron.schedule("*/30 * * * *", generateAndSaveNewToken);
  cron.schedule("0 * * * *", runAnalysisEngine);
  console.log("🕒 Scheduler aktif.");
});
