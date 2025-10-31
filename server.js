// Server Scraper Saham & Kripto Terpadu dengan Secure AI Proxy
// Versi FIXED: Token Verification pakai Firebase SDK (bukan fetch)

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const fetch = require('node-fetch');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, remove, get } = require('firebase/database');
const { getAuth, signInAnonymously } = require('firebase/auth');

// --- KONFIGURASI ENV & FIREBASE ---
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

// --- INISIALISASI ---
const app = express();
const PORT = process.env.PORT || 3000;
const firebaseApp = initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);
const auth = getAuth(firebaseApp);
let currentToken = '';

app.use(cors());
app.use(express.json());

// --- AUTH FIX ---
async function ensureAuth() {
    if (!auth.currentUser) {
        try {
            await signInAnonymously(auth);
            console.log("✅ Server: Login anonim berhasil.");
        } catch (e) {
            console.error("❌ Gagal login anonim:", e.message);
            return false;
        }
    }
    return true;
}

// --- SCRAPER DATA ---
async function getAssetPriceData(ticker) {
    try {
        const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=price`;
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
        console.error(`Gagal ambil data ${ticker}:`, error.message);
        return null;
    }
}

// --- AI ANALYSIS VIA INTERNAL PROXY ---
async function getAiAnalysisViaProxy(assetName, isCrypto) {
    let prompt = isCrypto
        ? `Berikan ringkasan singkat (maksimal 2 kalimat) mengenai sentimen pasar dan volatilitas saat ini untuk aset crypto ${assetName}.`
        : `Berikan ringkasan singkat (maksimal 2 kalimat) mengenai sentimen pasar saat ini untuk saham ${assetName}.`;

    const proxyUrl = `http://localhost:${PORT}/api/gemini-proxy`;

    try {
        const response = await fetch(proxyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-auth-token': currentToken },
            body: JSON.stringify({ prompt })
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Proxy gagal (${response.status}):`, errorText);
            return "Analisis AI tidak tersedia (Proxy error).";
        }
        const data = await response.json();
        return data.text || "Tidak ada analisis.";
    } catch (error) {
        console.error("Gagal memanggil Proxy AI:", error.message);
        return "Gagal memuat analisis AI.";
    }
}

// --- ENGINE UTAMA ---
async function runAnalysisEngine() {
    console.log(`[${new Date().toLocaleString('id-ID')}] Menjalankan analisis...`);
    if (!await ensureAuth()) return;

    for (const ticker of ALL_CRON_TICKERS) {
        const isCrypto = ticker.endsWith('-USD');
        const priceData = await getAssetPriceData(ticker);
        if (!priceData) continue;

        const aiSummary = await getAiAnalysisViaProxy(priceData.shortName, isCrypto);
        const combinedData = {
            ...priceData,
            aiAnalysis: aiSummary,
            lastUpdated: new Date().toISOString()
        };

        try {
            const dbRef = ref(database, 'stock_analysis/' + ticker.replace('.', '_').replace('-', '_'));
            await set(dbRef, combinedData);
            console.log(`💾 Data ${ticker} tersimpan.`);
        } catch (error) {
            console.error(`❌ Gagal simpan ${ticker}:`, error.message);
        }
    }

    console.log("✅ Siklus analisis selesai.");
}

// --- TOKEN GENERATOR ---
async function generateAndSaveNewToken() {
    if (!await ensureAuth()) return;
    const oldToken = currentToken;
    const newToken = Math.floor(100000 + Math.random() * 900000).toString();
    currentToken = newToken;

    try {
        const tokenRef = ref(database, 'tokens/' + currentToken);
        await set(tokenRef, { createdAt: new Date().toISOString() });
        console.log(`🔑 Token baru disimpan: ${currentToken}`);

        if (oldToken) {
            await remove(ref(database, 'tokens/' + oldToken));
            console.log(`🧹 Token lama dihapus: ${oldToken}`);
        }
    } catch (error) {
        console.error("❌ Gagal simpan token:", error.message);
    }
}

// --- API ENDPOINT UNTUK FRONTEND ---
app.get("/api/:symbol", async (req, res) => {
    const { symbol } = req.params;
    const isCrypto = symbol.endsWith('-USD');

    const priceData = await getAssetPriceData(symbol);
    if (!priceData) return res.status(404).json({ error: `Aset ${symbol} tidak ditemukan.` });

    const aiSummary = await getAiAnalysisViaProxy(priceData.shortName, isCrypto);

    const result = {
        ...priceData,
        aiAnalysis: aiSummary,
        companyName: priceData.shortName,
        chart: { result: [{ meta: { regularMarketPrice: priceData.regularMarketPrice } }] }
    };

    res.json(result);
});

// --- FIXED: TOKEN VERIFICATION VIA FIREBASE SDK ---
app.post('/api/gemini-proxy', async (req, res) => {
    const clientToken = req.headers['x-auth-token'];
    const { prompt, schema } = req.body;

    if (!prompt) return res.status(400).json({ error: 'Prompt is required.' });
    if (!clientToken) return res.status(401).json({ error: 'Unauthorized: Missing token.' });

    try {
        // BACA TOKEN DARI RTDB (PAKAI SDK)
        const tokenRef = ref(database, 'tokens/' + clientToken);
        const snapshot = await get(tokenRef);

        if (!snapshot.exists()) {
            return res.status(401).json({ error: 'Unauthorized: Invalid token.' });
        }
    } catch (e) {
        console.error("Gagal membaca token dari RTDB:", e.message);
        return res.status(500).json({ error: 'Internal server error during token verification.' });
    }

    if (!GEMINI_API_KEY)
        return res.status(500).json({ error: 'GEMINI_API_KEY is not configured.' });

    // --- PROSES KONTEN KE GEMINI ---
    let payload = {
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: {
            parts: [{ text: "Anda adalah analis keuangan profesional. Berikan jawaban singkat dan faktual." }]
        }
    };

    if (schema) {
        try {
            payload.generationConfig = {
                responseMimeType: "application/json",
                responseSchema: JSON.parse(schema),
            };
        } catch {
            return res.status(400).json({ error: 'Invalid schema format.' });
        }
    } else {
        payload.tools = [GOOGLE_SEARCH_TOOL];
    }

    try {
        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!geminiResponse.ok) {
            const err = await geminiResponse.text();
            console.error("Gemini API error:", err);
            return res.status(geminiResponse.status).json({ error: 'Gemini API call failed', details: err });
        }

        const result = await geminiResponse.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text || "Tidak ada hasil.";

        res.json({ text });
    } catch (error) {
        console.error("Error during Gemini call:", error.message);
        res.status(500).json({ error: 'Internal server error during API call.' });
    }
});

app.get("/", (_, res) => res.send("🚀 Server Analisis Saham & Kripto Aktif!"));

// --- STARTUP ---
app.listen(PORT, async () => {
    console.log(`🌐 Server berjalan di port ${PORT}`);
    await ensureAuth();
    await generateAndSaveNewToken();
    await runAnalysisEngine();

    cron.schedule('*/30 * * * *', generateAndSaveNewToken);
    cron.schedule('0 * * * *', runAnalysisEngine);
    console.log("⏰ CRON aktif: Token (30 menit), Analisis (tiap jam)");
});
