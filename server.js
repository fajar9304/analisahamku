// Server Scraper Saham & Kripto Terpadu dengan Secure AI Proxy
// Tujuan: Mengambil data harga, menganalisis dengan Gemini AI, menyimpan cache ke Firebase RTDB, 
//         dan melayani API Proxy yang aman.

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const fetch = require('node-fetch');
const { initializeApp } = require('firebase/app');
// RTDB Imports
const { getDatabase, ref, set, remove } = require('firebase/database');
// Auth Imports (KRITIS untuk mengatasi PERMISSION_DENIED)
const { getAuth, signInAnonymously } = require('firebase/auth'); 

// --- KONFIGURASI ENV & FIREBASE ---

// Kunci API Gemini harus diambil dari environment variable di Render
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const GEMINI_MODEL = 'gemini-2.5-flash-preview-09-2025'; // Model terbaru dan cepat
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
const GOOGLE_SEARCH_TOOL = { "google_search": {} };

// Tickers untuk CRON Job
const STOCK_TICKERS_FOR_CRON = ['BBCA.JK', 'BBRI.JK', 'TLKM.JK'];
const CRYPTO_TICKERS_FOR_CRON = ['BTC-USD', 'ETH-USD'];
const ALL_CRON_TICKERS = [...STOCK_TICKERS_FOR_CRON, ...CRYPTO_TICKERS_FOR_CRON];

// Konfigurasi Firebase (HARUS SESUAI dengan project Anda)
const firebaseConfig = {
    apiKey: "AIzaSyCCV7FD5FQqVW1WnP-Zu6UWAhAz19dthso",
    authDomain: "analisahamku.firebaseapp.com",
    projectId: "analisahamku",
    storageBucket: "analisahamku.appspot.com",
    messagingSenderId: "503947258604",
    appId: "1:503947258604:web:f5b10c998ce395405413c9",
    databaseURL: "https://analisahamku-default-rtdb.asia-southeast1.firebasedatabase.app"
};

// --- INISIALISASI ---

const app = express();
const PORT = process.env.PORT || 3000;
const firebaseApp = initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);
const auth = getAuth(firebaseApp); // Inisialisasi Auth
let currentToken = '';

app.use(cors());
app.use(express.json());

// --- FUNGSI AUTHENTIKASI KRITIS ---
// FUNGSI BARU: Memastikan server memiliki sesi login anonim yang valid (auth != null)
async function ensureAuth() {
    if (!auth.currentUser) {
        try {
            await signInAnonymously(auth);
            console.log("Server: Berhasil login Anonim untuk operasi RTDB.");
        } catch(e) {
            console.error("Server: Gagal login Anonim, operasi RTDB akan gagal:", e.message);
            return false;
        }
    }
    return true;
}

// --- FUNGSI-FUNGSI DATA & CRON ---

async function getAssetPriceData(ticker) {
    // ... (Fungsi ini tidak berubah dan masih menggunakan Yahoo Finance)
    try {
        const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=price`;
        const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (!response.ok) return null;
        const json = await response.json();
        const result = json?.quoteSummary?.result?.[0]?.price;
        
        if (!result) {
            console.warn(`[WARNING] Data harga kosong untuk ticker: ${ticker}`);
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

// FUNGSI BARU: Analisis AI yang dialihkan ke PROXY internal (lebih aman dan fleksibel)
async function getAiAnalysisViaProxy(assetName, isCrypto) {
    let prompt;
    if (isCrypto) {
        prompt = `Berikan ringkasan singkat (maksimal 2 kalimat) mengenai sentimen pasar dan volatilitas saat ini untuk aset crypto ${assetName}.`;
    } else {
        prompt = `Berikan ringkasan singkat (maksimal 2 kalimat) mengenai sentimen pasar saat ini untuk saham ${assetName}.`;
    }

    // Panggil endpoint proxy internal yang aman
    const proxyUrl = `http://localhost:${PORT}/api/gemini-proxy`;
    try {
        const response = await fetch(proxyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // Karena ini adalah panggilan server-to-server, kita tidak perlu token
            body: JSON.stringify({ prompt: prompt })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Proxy call failed (${response.status}):`, errorText);
            return "Analisis AI tidak tersedia (Proxy error).";
        }
        const data = await response.json();
        return data.text || "Tidak ada analisis.";

    } catch (error) {
        console.error(`Gagal mendapatkan analisis AI via Proxy untuk ${assetName}:`, error.message);
        return "Gagal memuat analisis AI.";
    }
}

async function runAnalysisEngine() {
    console.log(`[${new Date().toLocaleString('id-ID')}] Memulai mesin analis (Saham & Kripto)...`);
    
    // Pastikan server terautentikasi sebelum operasi tulis RTDB
    if (!await ensureAuth()) {
        console.error("Gagal menjalankan Engine Analisis karena masalah autentikasi.");
        return;
    }

    for (const ticker of ALL_CRON_TICKERS) {
        const isCrypto = ticker.endsWith('-USD');
        const priceData = await getAssetPriceData(ticker);
        
        if (!priceData) continue;
        
        // Panggil AI melalui fungsi proxy internal
        const aiSummary = await getAiAnalysisViaProxy(priceData.shortName, isCrypto); 
        
        const combinedData = { 
            ...priceData, 
            regularMarketPrice: priceData.regularMarketPrice,
            aiAnalysis: aiSummary, 
            lastUpdated: new Date().toISOString() 
        };
        
        try {
            const dbRef = ref(database, 'stock_analysis/' + ticker.replace('.', '_').replace('-', '_')); 
            // Operasi SET ini sekarang akan berhasil karena ensureAuth() telah dijalankan
            await set(dbRef, combinedData);
            console.log(`Data untuk ${ticker} berhasil disimpan.`);
        } catch (error) {
            console.error(`Gagal menyimpan data ${ticker}:`, error.message);
        }
    }
    console.log("Siklus analisis selesai.");
}

// --- FUNGSI MANAJEMEN TOKEN DENGAN AUTH FIX ---

async function generateAndSaveNewToken() {
    // Pastikan server terautentikasi sebelum operasi tulis RTDB
    if (!await ensureAuth()) {
        console.error("Gagal membuat token baru karena masalah autentikasi.");
        return;
    }

    const oldToken = currentToken;
    const newToken = Math.floor(100000 + Math.random() * 900000).toString();
    currentToken = newToken;
    
    try {
        const tokenRef = ref(database, 'tokens/' + currentToken);
        await set(tokenRef, {
            createdAt: new Date().toISOString()
        });
        console.log(`[${new Date().toLocaleString('id-ID')}] Token baru ${currentToken} berhasil disimpan ke Firebase.`);
        
        if (oldToken) {
            const oldTokenRef = ref(database, 'tokens/' + oldToken);
            await remove(oldTokenRef);
            console.log(`[${new Date().toLocaleString('id-ID')}] Token lama ${oldToken} berhasil dihapus dari Firebase.`);
        }
    } catch (error) {
        // Error ini sekarang harusnya TIDAK terjadi karena adanya ensureAuth()
        console.error("Gagal menyimpan atau menghapus token di Firebase:", error.message); 
    }
}

// --- SERVER API ENDPOINTS ---

// Endpoint untuk mengambil data harga real-time (juga memicu analisis AI)
app.get("/api/:symbol", async (req, res) => {
    const { symbol } = req.params;
    const isCrypto = symbol.endsWith('-USD');

    // 1. Ambil Data Harga (Price)
    const priceData = await getAssetPriceData(symbol);
    
    if (!priceData) {
        return res.status(404).json({ error: `Aset tidak ditemukan atau API tidak merespon untuk: ${symbol}` });
    }
    
    // 2. Ambil Analisis AI (Summary) melalui PROXY internal
    const aiSummary = await getAiAnalysisViaProxy(priceData.shortName, isCrypto);
    
    // 3. Gabungkan dan kembalikan data
    const finalResult = {
        ...priceData,
        regularMarketPrice: priceData.regularMarketPrice,
        companyName: priceData.shortName,
        aiAnalysis: aiSummary,
        // Properti kompatibilitas untuk frontend
        chart: { result: [{ meta: { regularMarketPrice: priceData.regularMarketPrice, instrumentDisplayName: priceData.shortName } }] }
    };

    res.json(finalResult);
});


// API Endpoint PROXY GEMINI untuk aplikasi frontend (MEMBUTUHKAN TOKEN)
app.post('/api/gemini-proxy', async (req, res) => {
    // SECURITY: Autentikasi token yang dikirim dari frontend
    const clientToken = req.headers['x-auth-token'];
    const dbRef = ref(database, 'tokens/' + clientToken);
    
    // Kita tidak perlu login di sini, hanya perlu membaca data token
    try {
        const tokenSnapshot = await fetch(`https://${database.app.options.authDomain}/tokens/${clientToken}.json`);
        const tokenData = await tokenSnapshot.json();

        // 1. Validasi Token
        if (!clientToken || !tokenData) {
            return res.status(401).json({ error: 'Unauthorized: Invalid or missing token.' });
        }
    } catch (e) {
         console.error("Gagal membaca token:", e.message);
         return res.status(500).json({ error: 'Internal server error during token verification.' });
    }

    if (!GEMINI_API_KEY) {
        return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
    }

    const { prompt, schema } = req.body;

    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required.' });
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
                responseSchema: JSON.parse(schema),
            };
        } catch (e) {
            return res.status(400).json({ error: 'Invalid JSON schema format.' });
        }
    } else {
        // Jika TIDAK ADA skema, tambahkan Google Search Tool
        payload.tools = [GOOGLE_SEARCH_TOOL];
    }

    // Melakukan Panggilan Aman ke Gemini API
    try {
        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!geminiResponse.ok) {
            const errorDetails = await geminiResponse.text();
            console.error("Gemini API Error:", errorDetails);
            return res.status(geminiResponse.status).json({ 
                error: 'Gemini API call failed', 
                details: errorDetails 
            });
        }
        
        const geminiResult = await geminiResponse.json();
        const textData = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!textData) {
            console.error("Gemini response structure invalid or empty:", geminiResult);
            return res.status(500).json({ error: 'Gemini API call failed: Empty content in response.' });
        }
        
        // Hapus token setelah berhasil digunakan (Opsional, tapi bagus untuk keamanan)
        // Note: Ini dilakukan di frontend menggunakan onSnapshot (lebih baik)
        // Hapus token lama setelah berhasil disimpan, token yang baru akan digunakan

        res.json({ text: textData });

    } catch (error) {
        console.error("Error during Gemini proxy operation:", error);
        res.status(500).json({ error: 'Internal server error during API call.' });
    }
});


app.get("/", (req, res) => {
    res.send("Server API dan Penganalisis Saham & Kripto Aktif! 🚀");
});


// --- PENJADWALAN & SERVER START ---

app.listen(PORT, async () => {
    console.log(`Server terpadu berjalan di port ${PORT}`);
    
    // Autentikasi awal dan pembuatan token
    await ensureAuth(); // BARU: Autentikasi saat startup
    
    console.log("Membuat token awal...");
    generateAndSaveNewToken();
    
    // Jalankan analisis sekali saat start
    runAnalysisEngine(); 
    
    // Penjadwalan: Token (setiap 30 menit)
    cron.schedule('*/30 * * * *', () => {
        console.log("Waktunya pembaruan token terjadwal (30 menit)...");
        generateAndSaveNewToken();
    });

    // Penjadwalan: Analisis Harga (setiap jam)
    cron.schedule('0 * * * *', runAnalysisEngine);
    console.log("Penjadwal analisis aktif (setiap jam).");
});
