// Server Scraper Saham & Kripto + Gemini Proxy Aman (FINAL v4 - Sinkron Firebase Config)

import express from "express";
import cors from "cors";
import cron from "node-cron";
import fetch from "node-fetch";
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getDatabase, ref, set, remove } from "firebase/database";

// === KONFIGURASI FIREBASE (DARI CONFIG TERBARU KAMU) ===
const firebaseConfig = {
  apiKey: "AIzaSyCCV7FD5FQqVW1WnP-Zu6UWAhAz19dthso",
  authDomain: "analisahamku.firebaseapp.com",
  databaseURL: "https://analisahamku-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "analisahamku",
  storageBucket: "analisahamku.firebasestorage.app",
  messagingSenderId: "503947258604",
  appId: "1:503947258604:web:f5b10c998ce395405413c9"
};

// === KONFIGURASI MODEL AI ===
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
const GOOGLE_SEARCH_TOOL = { google_search: {} };

// === DAFTAR ASET ===
const STOCK_TICKERS_FOR_CRON = ["BBCA.JK", "BBRI.JK", "TLKM.JK"];
const CRYPTO_TICKERS_FOR_CRON = ["BTC-USD", "ETH-USD"];
const ALL_CRON_TICKERS = [...STOCK_TICKERS_FOR_CRON, ...CRYPTO_TICKERS_FOR_CRON];

// === INISIALISASI FIREBASE & SERVER ===
const app = express();
const PORT = process.env.PORT || 3000;
const firebaseApp = initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);
const auth = getAuth(firebaseApp);

app.use(cors());
app.use(express.json());

let currentToken = "";

// === AUTENTIKASI FIREBASE (LOGIN ANONIM SERVER) ===
async function ensureAuth() {
  if (!auth.currentUser) {
    try {
      await signInAnonymously(auth);
      console.log("✅ Firebase login anonim berhasil.");
    } catch (e) {
      console.error("❌ Gagal login anonim Firebase:", e.message);
      return false;
    }
  }
  return true;
}

// === SCRAPER SAHAM & CRYPTO ===
async function getAssetPriceData(ticker) {
  try {
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      Accept: "application/json, text/plain, */*",
    };

    // 1️⃣ Coba ambil dari Yahoo Finance (v7)
    let response = await fetch(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(
        ticker
      )}`,
      { headers }
    );

    if (!response.ok) {
      console.warn(`⚠️ Yahoo v7 gagal (${response.status}), coba fallback...`);
      response = await fetch(
        `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
          ticker
        )}?modules=price`,
        { headers }
      );
    }

    const json = await response.json();
    let result =
      json?.quoteResponse?.result?.[0] ||
      json?.quoteSummary?.result?.[0]?.price ||
      null;

    // 2️⃣ Jika crypto dan tidak ada data di Yahoo → fallback ke CoinGecko
    if (!result && ticker.endsWith("-USD")) {
      const coinId = ticker.split("-")[0].toLowerCase();
      const cgRes = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`
      );
      const cgJson = await cgRes.json();
      const price = cgJson[coinId]?.usd;
      if (price) {
        result = {
          symbol: ticker,
          shortName: coinId.toUpperCase(),
          currency: "USD",
          regularMarketPrice: price,
        };
      }
    }

    if (!result) {
      console.warn(`⚠️ Tidak ada data untuk ${ticker}`);
      return null;
    }

    return {
      symbol: result.symbol || ticker,
      shortName: result.shortName || result.longName || ticker,
      currency: result.currency || "IDR",
      regularMarketPrice:
        result.regularMarketPrice?.raw ||
        result.regularMarketPrice ||
        result.regularMarketLastPrice?.raw ||
        result.regularMarketLastPrice ||
        null,
      regularMarketChangePercent:
        result.regularMarketChangePercent?.raw ||
        result.regularMarketChangePercent ||
        null,
    };
  } catch (error) {
    console.error(`❌ Gagal ambil data ${ticker}:`, error.message);
    return null;
  }
}

// === ANALISIS AI ===
async function getAiAnalysis(assetName, isCrypto) {
  const prompt = isCrypto
    ? `Berikan ringkasan singkat (maksimal 2 kalimat) tentang sentimen pasar dan volatilitas terkini untuk aset kripto ${assetName}.`
    : `Berikan ringkasan singkat (maksimal 2 kalimat) tentang sentimen pasar saat ini untuk saham ${assetName}.`;

  try {
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      tools: [GOOGLE_SEARCH_TOOL],
    };

    const res = await fetch(GEMINI_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    return (
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Analisis AI tidak tersedia."
    );
  } catch (error) {
    console.error("❌ Gagal analisis AI:", error.message);
    return "Analisis AI gagal dimuat.";
  }
}

// === ENGINE UTAMA ===
async function runAnalysisEngine() {
  console.log(`🚀 Jalankan analisis otomatis ${new Date().toLocaleString()}`);
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
      const safePath = ticker.replace(".", "_").replace("-", "_");
      await set(ref(database, `stock_analysis/${safePath}`), final);
      console.log(`✅ ${ticker} berhasil disimpan ke RTDB.`);
    } catch (e) {
      console.error(`❌ Gagal simpan ${ticker}:`, e.message);
    }
  }

  console.log("♻️ Siklus analisis selesai.");
}

// === TOKEN MANAGEMENT ===
async function generateAndSaveNewToken() {
  if (!(await ensureAuth())) return;

  const oldToken = currentToken;
  const newToken = Math.floor(100000 + Math.random() * 900000).toString();
  currentToken = newToken;

  try {
    const tokenRef = ref(database, "tokens/" + currentToken);
    await set(tokenRef, { createdAt: new Date().toISOString() });
    console.log(`🔑 Token baru: ${currentToken}`);

    if (oldToken) await remove(ref(database, "tokens/" + oldToken));
  } catch (e) {
    console.error("❌ Gagal menyimpan token:", e.message);
  }
}

// === ENDPOINTS ===
app.get("/", (_, res) => res.send("✅ Server Scraper & Gemini Proxy aktif!"));
app.get("/api/token", (_, res) => res.json({ token: currentToken }));

app.get("/api/:symbol", async (req, res) => {
  const { symbol } = req.params;
  const isCrypto = symbol.endsWith("-USD");
  const data = await getAssetPriceData(symbol);

  if (!data)
    return res.status(404).json({ error: `Data tidak ditemukan: ${symbol}` });

  const ai = await getAiAnalysis(data.shortName, isCrypto);
  res.json({ ...data, aiAnalysis: ai });
});

// === SERVER START ===
app.listen(PORT, async () => {
  console.log(`✅ Server aktif di port ${PORT}`);
  await ensureAuth();
  await generateAndSaveNewToken();
  await runAnalysisEngine();

  cron.schedule("*/30 * * * *", generateAndSaveNewToken); // token tiap 30 menit
  cron.schedule("0 * * * *", runAnalysisEngine); // analisis tiap jam
  console.log("🕒 Penjadwal aktif: token (30m) dan analisis (1h).");
});
