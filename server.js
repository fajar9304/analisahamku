// Server Backend Terpadu: Menggabungkan Scraper Harga, Analisis Terjadwal, dan Secure Gemini Proxy.
// -------------------------------------------------------------------------

import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import fetch from 'node-fetch'; 
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, remove } from 'firebase/database';
import { performance } from 'perf_hooks'; // Untuk mengukur waktu respon

// --- KONFIGURASI ENV & FIREBASE ---
// PERHATIAN: Pastikan GEMINI_API_KEY didefinisikan di lingkungan server Anda (process.env.GEMINI_API_KEY)

const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
// Menggunakan model terbaru yang cepat dan direkomendasikan untuk proxy
const GEMINI_MODEL = 'gemini-2.5-flash-preview-09-2025'; 
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
const GOOGLE_SEARCH_TOOL = { "google_search": {} };

const firebaseConfig = {
    apiKey: "AIzaSyCCV7FD5FQqVW1WnP-Zu6UWAhAz19dthso",
    authDomain: "analisahamku.firebaseapp.com",
    projectId: "analisahamku",
    storageBucket: "analisahamku.appspot.com",
    messagingSenderId: "503947258604",
    appId: "1:503947258604:web:f5b10c998ce395405413c9",
    databaseURL: "https://analisahamku-default-rtdb.asia-southeast1.firebasedatabase.app"
};

// Ticker untuk penjadwalan harian/per jam (diperlukan data harga mentah)
const STOCK_TICKERS_FOR_CRON = ['BBCA.JK', 'BBRI.JK', 'TLKM.JK', 'UNVR.JK'];
const CRYPTO_TICKERS_FOR_CRON = ['BTC-USD', 'ETH-USD', 'GOOG']; // Tambahkan GOOG untuk contoh saham AS
const ALL_CRON_TICKERS = [...STOCK_TICKERS_FOR_CRON, ...CRYPTO_TICKERS_FOR_CRON]; 


// --- INISIALISASI ---

const app = express();
const PORT = process.env.PORT || 3000;
const firebaseApp = initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);
let currentToken = '';

app.use(cors());
app.use(express.json());


// --- FUNGSI GEMINI PROXY (Inti Keamanan) ---

/**
 * Fungsi internal untuk memanggil Gemini API dengan payload yang sudah divalidasi.
 * Ini adalah fungsi dasar yang digunakan oleh PROXY dan Analisis Terjadwal.
 * Mengimplementasikan logika structured output dan Google Search Tool.
 */
async function callGeminiApi(prompt, schema) {
    if (!GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY is not configured on the server environment.');
    }

    let payload = {
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: {
            parts: [{ text: "Anda adalah analis saham dan keuangan profesional. Berikan respon yang akurat, berdasarkan data real-time jika memungkinkan, dan patuhi JSON schema yang diberikan." }]
        }
    };

    if (schema) {
        try {
            payload.generationConfig = {
                responseMimeType: "application/json",
                // Schema diterima sebagai string dari klien, harus di-parse
                responseSchema: JSON.parse(schema), 
            };
            // JANGAN tambahkan TOOLS jika ada schema untuk menghindari konflik
        } catch (e) {
            throw new Error('Invalid JSON schema format.');
        }
    } else {
        // Jika TIDAK ADA skema, tambahkan Google Search Tool
        payload.tools = [GOOGLE_SEARCH_TOOL];
    }
    
    // Panggilan API dengan retry logic (Exponential Backoff)
    const MAX_RETRIES = 3;
    let lastError = null;

    for (let i = 0; i < MAX_RETRIES; i++) {
        const startTime = performance.now();
        try {
            const geminiResponse = await fetch(GEMINI_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!geminiResponse.ok) {
                lastError = new Error(`Gemini API call failed with status ${geminiResponse.status}.`);
                const errorDetails = await geminiResponse.text();
                lastError.details = errorDetails;
                // Lanjut ke retry jika bukan percobaan terakhir
                if (i < MAX_RETRIES - 1) continue; 
                throw lastError;
            }
            
            const geminiResult = await geminiResponse.json();
            const textData = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!textData) {
                const rejectionReason = geminiResult.promptFeedback?.blockReason || 'Unknown';
                lastError = new Error(`Gemini API call failed: Empty content (Blocked: ${rejectionReason}).`);
                 // Lanjut ke retry jika bukan percobaan terakhir
                if (i < MAX_RETRIES - 1) continue;
                throw lastError;
            }
            
            const endTime = performance.now();
            console.log(`[Gemini Proxy] Response time: ${((endTime - startTime) / 1000).toFixed(2)}s`);

            return { text: textData };

        } catch (error) {
            lastError = error;
            console.error(`[Gemini Proxy] Attempt ${i + 1} failed: ${error.message}`);
            if (i < MAX_RETRIES - 1) {
                // Exponential backoff
                const delay = Math.pow(2, i) * 1000 + Math.random() * 500;
                await new Promise(res => setTimeout(res, delay));
            }
        }
    }
    throw lastError; // Lemparkan error setelah semua percobaan gagal
}


// --- FUNGSI SCRAPER HARGA (Menggantikan File A, Bagian 1) ---

async function getAssetPriceData(ticker) {
    try {
        // Menggunakan url yang lebih cepat untuk data harga mentah
        const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=price`;
        const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (!response.ok) return null;
        const json = await response.json();
        const result = json?.quoteSummary?.result?.[0]?.price;
        
        if (!result) {
            return null;
        }
        
        return {
            symbol: result.symbol,
            shortName: result.shortName || result.longName || result.symbol,
            currency: result.currency,
            regularMarketPrice: result.regularMarketPrice?.raw ?? null, 
            regularMarketChangePercent: result.regularMarketChangePercent?.fmt ?? null,
        };
    } catch (error) {
        console.error(`Gagal mengambil data harga untuk ${ticker}:`, error);
        return null;
    }
}

/**
 * FUNGSI KRITIS: Menggantikan fungsi getAiAnalysis di File A.
 * Fungsi ini memanggil fungsi internal PROXY (callGeminiApi) untuk keamanan.
 */
async function getAiAnalysisViaProxy(assetName, isCrypto) {
    let prompt;
    if (isCrypto) {
        prompt = `Berikan ringkasan singkat (maksimal 2 kalimat) mengenai sentimen pasar dan volatilitas saat ini untuk aset crypto ${assetName}.`;
    } else {
        prompt = `Berikan ringkasan singkat (maksimal 2 kalimat) mengenai sentimen pasar saat ini untuk saham ${assetName}.`;
    }
    
    try {
        // Panggil fungsi proxy internal. Tanpa schema, ia akan menggunakan Google Search Tool.
        const result = await callGeminiApi(prompt, null);
        return result.text;
    } catch (error) {
        console.error(`Gagal mendapatkan analisis AI untuk ${assetName}:`, error);
        return "Gagal memuat analisis AI.";
    }
}


// --- FUNGSI PENJADWALAN (Menggantikan File A, Bagian 2) ---

async function runAnalysisEngine() {
    console.log(`[${new Date().toLocaleString('id-ID')}] Memulai mesin analis (Saham & Kripto)...`);
    
    for (const ticker of ALL_CRON_TICKERS) {
        const isCrypto = ticker.endsWith('-USD');
        const priceData = await getAssetPriceData(ticker);
        
        if (!priceData) continue;
        
        // KRITIS: Menggunakan proxy internal yang aman
        const aiSummary = await getAiAnalysisViaProxy(priceData.shortName, isCrypto);
        
        const combinedData = { 
            ...priceData, 
            regularMarketPrice: priceData.regularMarketPrice,
            aiAnalysis: aiSummary, 
            lastUpdated: new Date().toISOString() 
        };
        
        try {
            const dbRef = ref(database, 'stock_analysis/' + ticker.replace('.', '_').replace('-', '_')); 
            await set(dbRef, combinedData);
            console.log(`Data cache untuk ${ticker} berhasil disimpan.`);
        } catch (error) {
            console.error(`Gagal menyimpan data cache ${ticker}:`, error);
        }
    }
    console.log("Siklus analisis terjadwal selesai.");
}


// --- RUTE API EXPRESS ---

// Rute Utama
app.get('/', (req, res) => {
    res.send(`Unified Stock Analysis API Server is Running. Gemini Model: ${GEMINI_MODEL}`);
});


// 1. API Endpoint Harga & Summary (Menggantikan File A, /api/:symbol)
app.get("/api/:symbol", async (req, res) => {
    const { symbol } = req.params;
    const isCrypto = symbol.endsWith('-USD');

    // 1. Ambil Data Harga
    const priceData = await getAssetPriceData(symbol);
    
    if (!priceData) {
        // Fallback untuk Chart Data (diperlukan struktur chart)
        try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?region=US&lang=en-US`;
            const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
            if (!response.ok) {
                 return res.status(404).json({ error: `Aset tidak ditemukan atau API tidak merespon untuk: ${symbol}` });
            }
            const data = await response.json();
            const latestPrice = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
            const companyName = data?.chart?.result?.[0]?.meta?.instrumentDisplayName || symbol;
            
            return res.json({ 
                ...data,
                regularMarketPrice: latestPrice,
                companyName: companyName,
                aiAnalysis: "Analisis AI tidak tersedia dalam mode chart."
            });
        } catch(e) {
             return res.status(500).json({ error: "Terjadi kesalahan server saat mengambil data chart." });
        }
    }
    
    // 2. Ambil Analisis AI (Summary) - KRITIS: Menggunakan proxy internal yang aman
    const aiSummary = await getAiAnalysisViaProxy(priceData.shortName, isCrypto);
    
    // 3. Gabungkan dan kembalikan
    const finalResult = {
        ...priceData,
        regularMarketPrice: priceData.regularMarketPrice,
        companyName: priceData.shortName,
        aiAnalysis: aiSummary,
        // Tambahkan properti chart kosong untuk kompatibilitas frontend
        chart: { result: [{ meta: { regularMarketPrice: priceData.regularMarketPrice, instrumentDisplayName: priceData.shortName } }] }
    };

    res.json(finalResult);
});


// 2. API Endpoint PROXY GEMINI (Menggantikan File B, /api/gemini-proxy)
app.post('/api/gemini-proxy', async (req, res) => {
    const { prompt, schema } = req.body;

    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required.' });
    }
    
    try {
        // KRITIS: Panggil fungsi proxy internal yang sudah memiliki logic structured output/tools
        const result = await callGeminiApi(prompt, schema);
        res.json(result);
    } catch (error) {
        console.error("Error during Gemini proxy operation:", error);
        // Tangani error yang dilempar dari callGeminiApi
        const statusCode = error.details ? 400 : 500;
        res.status(statusCode).json({ error: error.message, details: error.details });
    }
});


// --- MANAJEMEN TOKEN (Dari File B) ---

/**
 * Fungsi untuk membuat dan menyimpan token baru (sebagai placeholder auth).
 */
async function generateAndSaveNewToken() {
    const oldToken = currentToken;
    const newToken = Math.floor(100000 + Math.random() * 900000).toString();
    currentToken = newToken;
    
    try {
        const tokenRef = ref(database, 'tokens/' + currentToken);
        await set(tokenRef, {
            createdAt: new Date().toISOString()
        });
        console.log(`[Token] Token baru ${currentToken} berhasil disimpan ke Firebase.`);
        if (oldToken) {
            const oldTokenRef = ref(database, 'tokens/' + oldToken);
            await remove(oldTokenRef);
            console.log(`[Token] Token lama ${oldToken} berhasil dihapus dari Firebase.`);
        }
    } catch (error) {
        console.error("Gagal menyimpan atau menghapus token di Firebase:", error);
    }
}

// Endpoint untuk mengambil token (Digunakan untuk debug/integrasi)
app.get('/api/get-token', (req, res) => {
    res.json({ token: currentToken });
});


// --- SERVER START ---

app.listen(PORT, () => {
    console.log(`Server Analisis Terpadu berjalan di port ${PORT}`);
    
    // Inisialisasi dan Penjadwalan:
    // 1. Token (setiap 30 menit)
    console.log("Membuat token awal...");
    generateAndSaveNewToken();
    cron.schedule('*/30 * * * *', () => {
        console.log("Waktunya pembaruan token terjadwal (30 menit)...");
        generateAndSaveNewToken();
    });

    // 2. Analisis Harga & AI Cache (setiap jam)
    console.log("Menjalankan analisis harga dan AI cache awal...");
    runAnalysisEngine(); 
    cron.schedule('0 * * * *', runAnalysisEngine); 
    console.log("Penjadwal analisis harga aktif (setiap jam).");
});
