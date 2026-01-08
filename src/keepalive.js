// ═══════════════════════════════════════════════════════════
//  KEEP-ALIVE SERVICE (Render.com Sleep Önleme)
//  Her 14 dakikada bir sunucuya ping atar
// ═══════════════════════════════════════════════════════════

const SERVER_URL = 'https://gooby-arena.onrender.com';

function keepAlive() {
    fetch(`${SERVER_URL}/health`)
        .then(res => {
            if (res.ok) {
                console.log('✅ Keep-alive ping successful', new Date().toLocaleTimeString());
            }
        })
        .catch(err => {
            console.warn('⚠️ Keep-alive ping failed:', err.message);
        });
}

// Production'da aktif et
if (typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
    // Sayfa yüklendiğinde başlat
    setTimeout(() => {
        keepAlive();
        // 14 dakikada bir tekrarla (Render 15 dk'da sleep moduna giriyor)
        setInterval(keepAlive, 14 * 60 * 1000);
    }, 5000);

    console.log('🔄 Keep-alive service started (14min interval)');
}

export default keepAlive;
