// === ANALISAHAMKU v3 - Server Terpadu ===
// Fungsi: Scraper (Yahoo Finance), AI Analysis (Gemini), Caching (RTDB), & Proxy Aman AI.
// VERSI ADAPTASI: Menggunakan Scraper v3.1 (dengan fallback)

import express from "express";
import cors from "cors";
import cron from "node-cron";
// import fetch from "node-fetch"; // <-- DIHAPUS: Gunakan fetch bawaan Node.js v18+
import { initializeApp } from "firebase/app";
// Hapus getAuth, signInAnonymously karena server tidak memerlukan autentikasi Anonim lagi
import { getDatabase, ref, set } from "firebase/database";

// --- KONFIGURASI ENV & FIREBASE ---
// ... (sisa kode tidak berubah) ...
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyDWDY9e36xDuNdtd36DCSloDqO5zwvq_8w"; // Gunakan ENV atau fallback
// ... (sisa kode tidak berubah) ...
const firebaseConfig = {
  apiKey: "AIzaSyCCV7FD5FQqVW1WnP-Zu6UWAhAz19dthso",
// ... (sisa kode tidak berubah) ...
  databaseURL: "https://analisahamku-default-rtdb.asia-southeast1.firebasedatabase.app",
};

// --- LIST SAHAM & KRIPTO ---
// ... (sisa kode tidak berubah) ...
const ALL_TICKERS = [...STOCK_TICKERS, ...CRYPTO_TICKERS];

// --- INISIALISASI SERVER & FIREBASE ---
const app = express();
// ... (sisa kode tidak berubah) ...
const db = getDatabase(firebaseApp);

// --- UTILS ---
function delay(ms) {
// ... (sisa kode tidak berubah) ...
}

// --- SCRAPER YAHOO FINANCE (VERSI ADAPTASI V3.1 - DENGAN FALLBACK) ---
async function getAssetPriceData(ticker) {
  try {
    // 1️⃣ Coba ambil via quoteSummary
// ... (sisa kode tidak berubah) ...
        };
      }
    }

    // 2️⃣ Fallback ke chart endpoint (Jika quoteSummary gagal atau tidak ada harga)
// ... (sisa kode tidak berubah) ...
      regularMarketChangePercent: "0.00%", // Fallback tidak menyediakan % change
    };
  } catch (e) {
// ... (sisa kode tidak berubah) ...
    return null;
  }
}


// --- ANALISIS AI (GEMINI) UNTUK CRON JOB ---
async function getAiAnalysis(name, isCrypto) {
// ... (sisa kode tidak berubah) ...
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
// ... (sisa kode tidak berubah) ...
      return `Analisis AI tidak tersedia untuk ${name}.`;
    }

    const data = await res.json();
// ... (sisa kode tidak berubah) ...
    return text || `Analisis AI tidak tersedia untuk ${name}.`;
  } catch (e) {
    console.error(`[AI ERROR] ${name}:`, e);
// ... (sisa kode tidak berubah) ...
  }
}

// --- ENGINE UTAMA ---
async function runAnalysisEngine() {
// ... (sisa kode tidak berubah) ...
        .replace("-", "_")}`;
      await set(ref(db, path), combined);
      console.log(`✅ ${ticker} berhasil disimpan ke Firebase.`);
// ... (sisa kode tidak berubah) ...
    }

    await delay(2500); // beri jeda antar permintaan AI untuk menghindari limit
  }
// ... (sisa kode tidak berubah) ...
}

// --- API REALTIME (Data Harga & Ringkasan AI dari Cache) ---
// Frontend (analisahamku.html) akan memanggil endpoint ini untuk data harga.
app.get("/api/:symbol", async (req, res) => {
// ... (sisa kode tidak berubah) ...
        // Format respons kompatibel dengan struktur lama (PENTING)
        chart: { result: [{ meta: { regularMarketPrice: price.regularMarketPrice, instrumentDisplayName: price.shortName } }] }
    });
});


// --- API PROXY GEMINI AMAN (MENGGANTIKAN LOGIKA TOKEN LAMA) ---
// Frontend (analisahamku.html) akan memanggil endpoint ini untuk semua analisis mendalam.
app.post('/api/gemini-proxy', async (req, res) => {
// ... (sisa kode tidak berubah) ...
                details: errorDetails 
            });
        }
        
        const geminiResult = await geminiResponse.json();
        const textData = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!textData) {
// ... (sisa kode tidak berubah) ...
        }

        // Mengembalikan hasil dalam format { text: "..." }
        res.json({ text: textData });

    } catch (error) {
// ... (sisa kode tidak berubah) ...
        res.status(500).json({ error: 'Internal server error during API call.' });
    }
});

// --- KEEP ALIVE UNTUK RENDER ---
// ... (sisa kode tidak berubah) ...
    .catch(() => console.log("[PING] Gagal menjaga koneksi aktif."));
}, 12 * 60 * 1000); // setiap 12 menit

// --- START SERVER ---
app.get("/", (req, res) =>
  res.send("✅ Server Analisa Saham & Crypto v3.1 (Adapted) Aktif!")
);

app.listen(PORT, () => {
// ... (sisa kode tidak berubah) ...
  cron.schedule("0 * * * *", runAnalysisEngine); // jalan tiap jam
  console.log("Penjadwal analisis aktif (tiap jam).");
});

