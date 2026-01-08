// ═══════════════════════════════════════════════════════════
//  COOKIE CONSENT BANNER (GDPR Compliant)
// ═══════════════════════════════════════════════════════════

export class CookieConsent {
    constructor() {
        this.consentKey = 'goobyarena_cookie_consent';
        this.init();
    }

    init() {
        // Check if user already gave consent
        const consent = localStorage.getItem(this.consentKey);

        if (!consent) {
            this.showBanner();
        }
    }

    showBanner() {
        // Prevent multiple banners
        if (document.getElementById('cookieConsentBanner')) return;

        const banner = document.createElement('div');
        banner.id = 'cookieConsentBanner';
        banner.innerHTML = `
            <div style="position: fixed; bottom: 0; left: 0; right: 0; background: linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(30, 41, 59, 0.98)); backdrop-filter: blur(12px); padding: 20px; z-index: 10000; border-top: 2px solid rgba(250, 204, 21, 0.3); box-shadow: 0 -4px 20px rgba(0,0,0,0.5);">
                <div style="max-width: 1200px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap;">
                    <div style="flex: 1; min-width: 300px;">
                        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                            <span style="font-size: 1.5rem;">🍪</span>
                            <h3 style="color: #facc15; font-family: 'Orbitron', sans-serif; margin: 0; font-size: 1.1rem;">Cookie Notice</h3>
                        </div>
                        <p style="color: #cbd5e1; margin: 0; font-size: 0.9rem; line-height: 1.5;">
                            We use cookies and similar technologies to enhance your gaming experience, analyze traffic, and for advertising. 
                            By clicking "Accept", you consent to our use of cookies. 
                            <a href="/privacy.html" target="_blank" style="color: #60a5fa; text-decoration: underline;">Privacy Policy</a>
                        </p>
                    </div>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        <button id="cookieReject" style="padding: 12px 24px; background: rgba(239, 68, 68, 0.2); border: 1px solid #ef4444; border-radius: 8px; color: #fca5a5; cursor: pointer; font-family: 'Orbitron', sans-serif; font-weight: bold; transition: all 0.2s; font-size: 0.9rem;">
                            Reject
                        </button>
                        <button id="cookieAccept" style="padding: 12px 24px; background: linear-gradient(135deg, #22c55e, #16a34a); border: none; border-radius: 8px; color: white; cursor: pointer; font-family: 'Orbitron', sans-serif; font-weight: bold; box-shadow: 0 4px 15px rgba(34, 197, 94, 0.4); transition: all 0.2s; font-size: 0.9rem;">
                            Accept All
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(banner);

        // Button handlers
        document.getElementById('cookieAccept').onclick = () => this.acceptCookies();
        document.getElementById('cookieReject').onclick = () => this.rejectCookies();

        // Hover effects
        const acceptBtn = document.getElementById('cookieAccept');
        const rejectBtn = document.getElementById('cookieReject');

        acceptBtn.onmouseenter = () => acceptBtn.style.transform = 'translateY(-2px)';
        acceptBtn.onmouseleave = () => acceptBtn.style.transform = 'translateY(0)';

        rejectBtn.onmouseenter = () => rejectBtn.style.background = 'rgba(239, 68, 68, 0.3)';
        rejectBtn.onmouseleave = () => rejectBtn.style.background = 'rgba(239, 68, 68, 0.2)';
    }

    acceptCookies() {
        localStorage.setItem(this.consentKey, 'accepted');
        this.removeBanner();
        console.log('✅ Cookies accepted');
    }

    rejectCookies() {
        localStorage.setItem(this.consentKey, 'rejected');
        this.removeBanner();
        console.log('❌ Cookies rejected');
    }

    removeBanner() {
        const banner = document.getElementById('cookieConsentBanner');
        if (banner) {
            banner.style.animation = 'slideDown 0.3s ease-out';
            setTimeout(() => banner.remove(), 300);
        }
    }
}

// Auto-init
if (typeof window !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        new CookieConsent();
    });
}

export default CookieConsent;
