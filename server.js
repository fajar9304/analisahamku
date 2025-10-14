// Server Backend untuk Generate Token dan PROXY GEMINI API
// -------------------------------------------------------------------------

// 1. Impor library yang dibutuhkan
const express = require('express');
const cron = require('node-cron');
const cors = require('cors');
// TAMBAHAN: Impor node-fetch untuk panggilan API eksternal (Gemini)
const fetch = require('node-fetch'); 
// PERUBAHAN: Impor Firebase (tetap)
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, remove } = require('firebase/database');

// 2. Konfigurasi Lingkungan (Environment Variables)
// **PENTING:** Ambil Kunci API Gemini dari Environment Variables Render
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const GEMINI_MODEL = 'gemini-2.5-flash-preview-05-20';
// URL API yang akan dipanggil secara aman dari Server
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
const GOOGLE_SEARCH_TOOL = { "google_search": {} }; // Alat Google Search untuk grounding

// 3. Konfigurasi Firebase (Salin dari aplikasi utama Anda)
const firebaseConfig = {
    apiKey: "AIzaSyCCV7FD5FQqVW1WnP-Zu6UWAhAz19dthso",
    authDomain: "analisahamku.firebaseapp.com",
    projectId: "analisahamku",
    storageBucket: "analisahamku.appspot.com",
    messagingSenderId: "503947258604",
    appId: "1:503947258604:web:f5b10c998ce395405413c9",
    databaseURL: "https://analisahamku-default-rtdb.asia-southeast1.firebasedatabase.app"
};

// 4. Inisialisasi Firebase & Express
const firebaseApp = initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);
const app = express();
const PORT = process.env.PORT || 3000;

// 5. Variabel untuk menyimpan token saat ini
let currentToken = '';

// 6. Konfigurasi Middleware
app.use(cors());
// BARU: Middleware untuk memproses body JSON dari client (PENTING untuk proxy)
app.use(express.json()); 

// 7. Fungsi untuk membuat dan menyimpan token baru (tetap sama)
async function generateAndSaveNewToken() {
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
        console.error("Gagal menyimpan atau menghapus token di Firebase:", error);
    }
}

// 8. API Endpoint untuk PROXY PANGGILAN GEMINI (BARU & PENTING)
// Endpoint ini menerima prompt dan schema dari aplikasi HTML Anda
app.post('/gemini-proxy', async (req, res) => {
    // 8.1. Cek Kunci API
    if (!GEMINI_API_KEY) {
        // Ini hanya terjadi jika Anda lupa mengkonfigurasi Environment Variable di Render
        return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
    }

    const { prompt, schema } = req.body;

    if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required.' });
    }

    // 8.2. Membangun Payload untuk Google API
    let payload = {
        contents: [{ parts: [{ text: prompt }] }],
        // Mengaktifkan Google Search untuk semua query AI
        tools: [GOOGLE_SEARCH_TOOL],
        systemInstruction: {
             parts: [{ text: "Anda adalah analis saham dan keuangan profesional. Berikan respon yang akurat, berdasarkan data real-time jika memungkinkan, dan patuhi JSON schema yang diberikan." }]
        }
    };

    if (schema) {
        // Jika schema diterima, tambahkan konfigurasi untuk structured output (JSON)
        try {
            payload.generationConfig = {
                responseMimeType: "application/json",
                // schema dikirim sebagai string dari client, harus di-parse.
                responseSchema: JSON.parse(schema), 
            };
        } catch (e) {
            return res.status(400).json({ error: 'Invalid JSON schema format.' });
        }
    }

    // 8.3. Melakukan Panggilan Aman ke Gemini API
    try {
        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!geminiResponse.ok) {
            const errorDetails = await geminiResponse.text();
            console.error("Gemini API Error:", errorDetails);
            // Meneruskan status error dari Google API ke client
            return res.status(geminiResponse.status).json({ 
                error: 'Gemini API call failed', 
                details: errorDetails 
            });
        }
        
        const geminiResult = await geminiResponse.json();

        // 8.4. BARU: Ekstraksi konten teks dari respons Gemini
        const textData = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!textData) {
            console.error("Gemini response structure invalid or empty:", geminiResult);
            return res.status(500).json({ error: 'Gemini API call failed: Empty content in response.' });
        }
        
        // Mengirimkan data dalam format yang diharapkan oleh client: { text: "..." }
        // Ini memastikan kode di index.html (const textData = result.text;) berfungsi
        res.json({ text: textData });

    } catch (error) {
        console.error("Error during Gemini proxy operation:", error);
        res.status(500).json({ error: 'Internal server error during API call.' });
    }
});

// 9. API Endpoint untuk mengambil token (opsional, bisa dihapus jika tidak perlu)
app.get('/api/get-token', (req, res) => {
    res.json({ token: currentToken });
});

// 10. Menjalankan server
app.listen(PORT, () => {
    console.log(`Server backend berjalan di http://localhost:${PORT}`);
    
    // 11. Logika Inisialisasi dan Penjadwalan
    console.log("Membuat token awal...");
    generateAndSaveNewToken();

    cron.schedule('*/30 * * * *', () => {
        console.log("Waktunya pembaruan token terjadwal (30 menit)...");
        generateAndSaveNewToken();
    });

    console.log("Penjadwal token aktif. Token akan diperbarui dan disimpan ke Firebase setiap 30 menit.");
});
