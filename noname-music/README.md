# 🎧 Noname Music — Bot Musik 24/7 (Noname Studios Creative)

Bot musik premium dengan panel **sticky** berbasis **Discord Components V2**, standby 24/7 di voice
`1527164677941891193`, bisa putar dari **YouTube, YouTube Music, dan Spotify**.

## ✨ Fitur
- **24/7 AFK** — otomatis join voice, masuk lagi kalau di-disconnect/dipindah, pulih sendiri kalau Lavalink restart
- **Panel sticky V2** — selalu di pesan paling bawah, progress bar live, artwork, antrian 5 lagu berikutnya
- **Tombol**: ⏮️ previous • ⏯️ pause • ⏭️ skip • ⏹️ stop • 🔀 shuffle • 🔉🔊 volume • 🔁 loop • ✨ autoplay • 📜 antrian • ➕ tambah lagu (form) • 🗑️ kosongkan • 🔄 refresh
- **Efek audio**: Bass Boost, Nightcore, Vaporwave, 8D, Soft
- **Autoplay** — antrian habis → lagu mirip (YouTube Mix) diputar otomatis; request member selalu diprioritaskan
- **Auto-pause** saat voice kosong, auto-resume saat ada member masuk
- **/play dengan autocomplete** (hasil pencarian muncul saat mengetik)
- Kontrol hanya untuk member di voice (Admin / role DJ bisa dari mana saja)

## 🧱 Kebutuhan
- Node.js **18.17+** (VPS kamu Node 20 ✅)
- **Java 17+** (untuk Lavalink)
- pm2

## 🚀 Setup di VPS (Ubuntu)

```bash
# 1. Upload folder ini ke VPS, misal ~/noname-music, lalu:
cd ~/noname-music
npm install

# 2. Java 17 (lewati kalau `java -version` sudah 17+)
sudo apt update && sudo apt install -y openjdk-17-jre-headless

# 3. Download Lavalink 4.2.2
cd lavalink
wget https://github.com/lavalink-devs/Lavalink/releases/download/4.2.2/Lavalink.jar
cd ..

# 4. Konfigurasi
cp .env.example .env
nano .env                     # isi DISCORD_TOKEN & LAVALINK_PASSWORD
nano lavalink/application.yml # samakan password: "..." dengan LAVALINK_PASSWORD

# 5. Jalankan keduanya
pm2 start ecosystem.config.cjs
pm2 save
pm2 logs noname-music
```

Start pertama Lavalink butuh ±1 menit untuk download plugin YouTube & Spotify.
Bot akan otomatis menyambung begitu Lavalink siap.

## ⚙️ Discord Developer Portal
1. Tab Bot → intent khusus tidak diperlukan. Nyalakan **Message Content Intent** hanya kalau `REQUEST_CHANNEL_MODE=true`
2. Undang bot dengan scope `bot` + `applications.commands`, izin:
   View Channels, Send Messages, Read Message History, Embed Links, Connect, Speak
   (+ Manage Messages kalau mode request aktif)

## 🎛️ Pemakaian
1. Di Discord: `/setup-panel channel:#music` (admin)
2. Masuk voice → klik **➕ Tambah Lagu** atau `/play`
3. `/help` untuk daftar semua command

## 🧪 Tes
```bash
npm test   # cek tampilan panel V2 + simulasi lengkap (play, skip, autoplay, 24/7, recovery Lavalink)
```

## 🛠️ Troubleshooting
| Masalah | Solusi |
|---|---|
| Panel merah "Server audio offline" | `pm2 logs noname-lavalink` — cek Java & password sama |
| Lagu YouTube gagal / "Sign in to confirm" | update `youtube-plugin` di application.yml ke versi terbaru, atau aktifkan `oauth` |
| Link Spotify tidak bisa | pastikan `lavasrc` `spotify: true`; isi `clientId/clientSecret` kalau perlu |
| Slash command tidak muncul | restart bot, command didaftarkan otomatis ke server saat bot online |
