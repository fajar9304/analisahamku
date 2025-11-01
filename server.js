// === ANALISAHAMKU v3 - Server Terpadu ===
// Fungsi: Scraper (Yahoo Finance), AI Analysis (Gemini), Caching (RTDB), & Proxy Aman AI.
// VERSI ADAPTASI: Menggunakan Scraper v3.1 (dengan fallback)

import express from "express";
import cors from "cors";
import cron from "node-cron";
import fetch from "node-fetch";
import { initializeApp } from "firebase/app";
// Hapus getAuth, signInAnonymously karena server tidak memerlukan autentikasi Anonim lagi
import { getDatabase, ref, set } from "firebase/database";

// --- KONFIGURASI ENV & FIREBASE ---

// PENTING: Kunci API Gemini harus diambil dari environment variable di Render
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyDWDY9e36xDuNdtd36DCSloDqO5zwvq_8w"; // Gunakan ENV atau fallback
const GEMINI_MODEL = "gemini-2.5-flash-preview-09-2025"; // Upgrade ke model terbaru untuk grounding
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
const GOOGLE_SEARCH_TOOL = { "google_search": {} };


const firebaseConfig = {
  apiKey: "AIzaSyCCV7FD5FQqVW1WnP-Zu6UWAhAz19dthso",
  authDomain: "analisahamku.firebaseapp.com",
  projectId: "analisahamku",
  storageBucket: "analisahamku.appspot.com",
  messagingSenderId: "503947258604",
  appId: "1:503947258604:web:f5b10c998ce395405413c9",
  databaseURL: "https://analisahamku-default-rtdb.asia-southeast1.firebasedatabase.app",
};

// --- LIST SAHAM & KRIPTO ---
const STOCK_TICKERS = ["BBCA.JK", "BBRI.JK", "TLKM.JK"];
const CRYPTO_TICKERS = ["BTC-USD", "ETH-USD"];
const ALL_TICKERS = [...STOCK_TICKERS, ...CRYPTO_TICKERS];

// --- INISIALISASI SERVER & FIREBASE ---
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

// --- UTILS ---
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- SCRAPER YAHOO FINANCE (VERSI ADAPTASI V3.1 - DENGAN FALLBACK) ---
async function getAssetPriceData(ticker) {
  try {
    // 1️⃣ Coba ambil via quoteSummary
    const url1 = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
      ticker
    )}?modules=price`;
    const r1 = await fetch(url1, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (r1.ok) {
      const j1 = await r1.json();
      const p = j1?.quoteSummary?.result?.[0]?.price;
      if (p && p.regularMarketPrice) {
        return {
          symbol: p.symbol,
          shortName: p.shortName || p.longName || p.symbol,
          currency: p.currency,
          regularMarketPrice: p.regularMarketPrice.raw,
          regularMarketChangePercent: p.regularMarketChangePercent?.fmt ?? "0%",
        };
      }
    }

    // 2️⃣ Fallback ke chart endpoint (Jika quoteSummary gagal atau tidak ada harga)
    const url2 = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?region=US&lang=en-US`;
    const r2 = await fetch(url2, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r2.ok) {
        console.warn(`[WARNING] Yahoo API gagal (Fallback): ${ticker}`);
        return null;
    }

    const j2 = await r2.json();
    const meta = j2?.chart?.result?.[0]?.meta;
    if (!meta) return null;

    return {
      symbol: meta.symbol,
      shortName: meta.instrumentDisplayName || meta.symbol,
      currency: meta.currency,
      regularMarketPrice: meta.regularMarketPrice,
      regularMarketChangePercent: "0.00%", // Fallback tidak menyediakan % change
    };
  } catch (e) {
    console.error(`[ERROR] Fetch harga gagal untuk ${ticker}:`, e);
    return null;
  }
}


// --- ANALISIS AI (GEMINI) UNTUK CRON JOB ---
async function getAiAnalysis(name, isCrypto) {
  const prompt = isCrypto
    ? `Ringkas sentimen pasar terkini untuk aset kripto ${name} (maksimal 2 kalimat).`
    : `Ringkas sentimen pasar terkini untuk saham ${name} (maksimal 2 kalimat).`;
    
    // Gunakan payload dengan Google Search Tool untuk Cron Job
    const payload = { 
        contents: [{ parts: [{ text: prompt }] }],
        tools: [GOOGLE_SEARCH_TOOL],
        systemInstruction: { parts: [{ text: "Anda adalah analis keuangan profesional, berikan ringkasan yang ringkas dan berdasarkan data terkini." }] }
    };

  try {
    const res = await fetch(GEMINI_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.warn(`[AI SKIP] ${name} gagal dianalisis. Status: ${res.status}`);
      return `Analisis AI tidak tersedia untuk ${name}.`;
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return text || `Analisis AI tidak tersedia untuk ${name}.`;
  } catch (e) {
    console.error(`[AI ERROR] ${name}:`, e);
    return `Gagal memuat analisis untuk ${name}.`;
  }
}

// --- ENGINE UTAMA ---
async function runAnalysisEngine() {
  console.log(
    `[${new Date().toLocaleString("id-ID")}] 🚀 Memulai analisis otomatis saham & crypto...`
  );

  for (const ticker of ALL_TICKERS) {
    const isCrypto = ticker.endsWith("-USD");
    const data = await getAssetPriceData(ticker); // <- Menggunakan fungsi baru yang robust
    if (!data) {
      console.warn(`[SKIP] Data tidak ditemukan: ${ticker}`);
      continue;
    }
    
    const aiText = await getAiAnalysis(data.shortName, isCrypto);
    const combined = {
      ...data,
      aiAnalysis: aiText,
      lastUpdated: new Date().toISOString(),
    };

    try {
      const path = `stock_analysis/${ticker
        .replace(".", "_")
        .replace("-", "_")}`;
      await set(ref(db, path), combined);
      console.log(`✅ ${ticker} berhasil disimpan ke Firebase.`);
    } catch (err) {
      console.error(`❌ Gagal menyimpan ${ticker}:`, err.message);
    }

    await delay(2500); // beri jeda antar permintaan AI untuk menghindari limit
  }

  console.log("✅ Siklus analisis selesai.\n");
}

// --- API REALTIME (Data Harga & Ringkasan AI dari Cache) ---
// Frontend (analisahamku.html) akan memanggil endpoint ini untuk data harga.
app.get("/api/:symbol", async (req, res) => {
    const { symbol } = req.params;
    const isCrypto = symbol.endsWith("-USD");

    const price = await getAssetPriceData(symbol); // <- Menggunakan fungsi baru yang robust
    if (!price)
        return res.status(404).json({ error: `Data tidak ditemukan: ${symbol}` });

    const ai = await getAiAnalysis(price.shortName, isCrypto);
    
    // Sesuaikan respons agar kompatibel dengan frontend yang mengharapkan AI Analysis
    res.json({
        ...price,
        aiAnalysis: ai,
        lastUpdated: new Date().toISOString(),
        // Format respons kompatibel dengan struktur lama (PENTING)
        chart: { result: [{ meta: { regularMarketPrice: price.regularMarketPrice, instrumentDisplayName: price.shortName } }] }
    });
});


// --- API PROXY GEMINI AMAN (MENGGANTIKAN LOGIKA TOKEN LAMA) ---
// Frontend (analisahamku.html) akan memanggil endpoint ini untuk semua analisis mendalam.
app.post('/api/gemini-proxy', async (req, res) => {
    // Tidak perlu verifikasi token, karena kuncinya aman di server ENV.
    
    if (!GEMINI_API_KEY || GEMINI_API_KEY.startsWith("AIzaSyDWDY9e36xDuNdtd36DCSloDqO5zwvq_8w")) {
        console.error("FATAL: GEMINI_API_KEY tidak dikonfigurasi di server Environment Variables.");
        return res.status(500).json({ error: 'GEMINI_API_KEY is not securely configured on the server.' });
    }

    const { prompt, schema } = req.body;

    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required.' });
  _message_trunc_

