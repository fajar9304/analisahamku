// Server Backend untuk Generate dan Menyediakan Token (Terhubung ke Firebase)
// -------------------------------------------------------------------------

// 1. Impor library yang dibutuhkan
const express = require('express');
const cron = require('node-cron');
const cors = require('cors');
// PERUBAHAN: Impor Firebase
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, remove } = require('firebase/database');

// 2. Konfigurasi Firebase (Salin dari aplikasi utama Anda)
const firebaseConfig = {
  apiKey: "AIzaSyCCV7FD5FQqVW1WnP-Zu6UWAhAz19dthso",
  authDomain: "analisahamku.firebaseapp.com",
  projectId: "analisahamku",
  storageBucket: "analisahamku.appspot.com",
  messagingSenderId: "503947258604",
  appId: "1:503947258604:web:f5b10c998ce395405413c9",
  databaseURL: "https://analisahamku-default-rtdb.asia-southeast1.firebasedatabase.app"
};

// 3. Inisialisasi Firebase & Express
const firebaseApp = initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);
const app = express();
const PORT = process.env.PORT || 3000;

// 4. Variabel untuk menyimpan token saat ini
let currentToken = '';

// 5. Fungsi untuk membuat dan menyimpan token baru
async function generateAndSaveNewToken() {
    // Simpan token lama untuk dihapus nanti
    const oldToken = currentToken;

    // Buat token baru
    const newToken = Math.floor(100000 + Math.random() * 900000).toString();
    currentToken = newToken;
    
    try {
        // PERUBAHAN: Simpan token baru ke Firebase Realtime Database
        // Ini akan membuat path seperti /tokens/123456
        const tokenRef = ref(database, 'tokens/' + currentToken);
        await set(tokenRef, {
            createdAt: new Date().toISOString() // Simpan waktu pembuatan
        });
        console.log(`[${new Date().toLocaleString('id-ID')}] Token baru ${currentToken} berhasil disimpan ke Firebase.`);

        // PERUBAHAN: Hapus token lama dari Firebase jika ada
        if (oldToken) {
            const oldTokenRef = ref(database, 'tokens/' + oldToken);
            await remove(oldTokenRef);
            console.log(`[${new Date().toLocaleString('id-ID')}] Token lama ${oldToken} berhasil dihapus dari Firebase.`);
        }

    } catch (error) {
        console.error("Gagal menyimpan atau menghapus token di Firebase:", error);
    }
}

// 6. Konfigurasi Middleware
app.use(cors());

// 7. API Endpoint untuk mengambil token (opsional, bisa dihapus jika tidak perlu)
app.get('/api/get-token', (req, res) => {
    res.json({ token: currentToken });
});

// 8. Menjalankan server
app.listen(PORT, () => {
    console.log(`Server backend berjalan di http://localhost:${PORT}`);
    
    // 9. Logika Inisialisasi dan Penjadwalan
    
    // Buat token pertama kali saat server dinyalakan
    console.log("Membuat token awal...");
    generateAndSaveNewToken();

    // Jadwalkan fungsi untuk berjalan setiap 30 menit
    cron.schedule('*/30 * * * *', () => {
        console.log("Waktunya pembaruan token terjadwal (30 menit)...");
        generateAndSaveNewToken();
    });

    console.log("Penjadwal token aktif. Token akan diperbarui dan disimpan ke Firebase setiap 30 menit.");
});
