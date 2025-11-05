import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import * as dotenv from 'dotenv';

// Muat variabel lingkungan dari file .env
dotenv.config();

// === KONFIGURASI ===
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // AMAN
const GEMINI_MODEL = "gemini-2.5-flash-preview-09-2025"; // Model yang mendukung grounding & JSON
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// === FUNGSI UTILITAS (DARI KODE LAMA ANDA) ===
// Fungsi ini sempurna untuk mengambil data harga, kita akan mempertahankannya.
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

    // 2️⃣ Fallback ke chart endpoint
    const url2 = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?region=US&lang=en-US`;
    const r2 = await fetch(url2, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r2.ok) return null;

    const j2 = await r2.json();
    const meta = j2?.chart?.result?.[0]?.meta;
    if (!meta) return null;

    return {
      symbol: meta.symbol,
      shortName: meta.instrumentDisplayName || meta.symbol,
      currency: meta.currency,
      regularMarketPrice: meta.regularMarketPrice,
      regularMarketChangePercent: "0.00%", // Fallback tidak menyediakan ini
    };
  } catch (e) {
    console.error(`❌ Gagal ambil data ${ticker}:`, e);
    return null;
  }
}

// === ENDPOINT 1: API HARGA ===
// Endpoint ini dicocokkan dengan PRICE_API_URL di aplikasi Anda
app.get("/api/:symbol", async (req, res) => {
  const { symbol } = req.params;
  const data = await getAssetPriceData(symbol);
  if (!data) {
    return res.status(404).json({ error: `Data tidak ditemukan: ${symbol}` });
  }
  
  // HANYA mengembalikan data harga (tanpa AI), ini membuat aplikasi lebih cepat
  // Aplikasi akan memanggil endpoint AI secara terpisah jika perlu.
  res.json(data); // <-- PERBAIKAN: Ini sebelumnya '_res.json(data)'
});

// === ENDPOINT BARU (STEP 1): API KURS USD/IDR ===
app.get("/api/rates/usd-idr", async (req, res) => {
  const ticker = "IDR=X"; // Ticker Yahoo Finance untuk USD ke IDR
  const data = await getAssetPriceData(ticker);
  
  if (!data || !data.regularMarketPrice) {
    console.error("❌ Gagal mengambil kurs IDR=X dari Yahoo Finance.");
    return res.status(404).json({ error: "Gagal mengambil data kurs USD/IDR." });
  }
  
  // Kembalikan hanya kursnya dalam format JSON yang sederhana
  res.json({ rate: data.regularMarketPrice });
});
// === AKHIR ENDPOINT BARU ===

// === ENDPOINT 2: PROXY AI GEMINI ===
// Endpoint ini dicocokkan dengan RENDER_AI_PROXY_URL di aplikasi Anda
app.post("/api/gemini-proxy", async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: "Kunci API Gemini belum diatur di server." });
  }

  const { prompt, schema } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "Prompt tidak boleh kosong." });
  }

  // 1. Siapkan payload dasar
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    // 2. SELALU aktifkan alat Google Search (grounding)
    // Ini akan memberdayakan SEMUA fitur AI (screener, analisis, dll)
    // dengan data web real-time.
    tools: [{ "google_search": {} }], 
  };

  // 3. Jika ada skema, tambahkan ke payload
  if (schema) {
    try {
      const parsedSchema = JSON.parse(schema);
      payload.generationConfig = {
        responseMimeType: "application/json",
        responseSchema: parsedSchema
      };
      // --- PERBAIKAN: Hapus tools jika skema ada ---
      // Gemini tidak mengizinkan 'tools' (grounding) dan 'responseSchema' (JSON) secara bersamaan.
      delete payload.tools; 
      // --- AKHIR PERBAIKAN ---
    } catch (e) {
      console.error("Skema JSON tidak valid:", e);
      return res.status(400).json({ error: "Skema JSON tidak valid." });
    }
  }

  // 4. Panggil Google Gemini
  try {
    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
S     body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Error dari Gemini:", errorData);
      return res.status(response.status).json({ error: `Error dari Gemini: ${errorData}` });
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      console.error("Respon Gemini tidak valid:", data);
      return res.status(500).json({ error: "Respon tidak valid dari AI." });
  S }

    // 5. Kembalikan dalam format yang diharapkan aplikasi: { text: "..." }
    res.json({ text: text });

  } catch (error) {
    console.error("Error saat memanggil Gemini Proxy:", error);
    res.status(500).json({ error: "Gagal menghubungi server AI." });
  }
});

// === KEEP ALIVE (DARI KODE LAMA ANDA) ===
// Ini penting untuk layanan gratis di Render agar tidak tidur
setInterval(() => {
  // PERBAIKAN: Server harus mem-ping URL-nya sendiri (analisahamku-v2)
  fetch("https://analisahamku-v2.onrender.com/") 
    .catch(() => console.log("[PING] Render tetap hidup."));
}, 12 * 60 * 1000); // Setiap 12 menit

// === START SERVER ===
app.get("/", (req, res) => res.send("✅ Server Terpadu Analisahamku v1.0 aktif."));
app.listen(PORT, () => {
  console.log(`Server berjalan di port ${PORT}`);
  if (!GEMINI_API_KEY) {
    console.warn("⚠️ PERINGATAN: GEMINI_API_KEY belum diatur. Endpoint /api/gemini-proxy akan gagal.");
  }
});
