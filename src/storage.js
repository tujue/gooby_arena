// ═══════════════════════════════════════════════════════════
//  STORAGE MANAGER - LocalStorage Wrapper
//  Saves user settings (audio, preferences)
// ═══════════════════════════════════════════════════════════

export class StorageManager {
    constructor() {
        this.prefix = 'goobyarena_';
    }

    // Save audio settings
    saveAudioSettings(musicVolume, sfxVolume) {
        try {
            localStorage.setItem(`${this.prefix}musicVolume`, musicVolume);
            localStorage.setItem(`${this.prefix}sfxVolume`, sfxVolume);
            console.log('✅ Audio settings saved');
        } catch (e) {
            console.warn('localStorage not available:', e);
        }
    }

    // Load audio settings
    loadAudioSettings() {
        try {
            return {
                musicVolume: parseFloat(localStorage.getItem(`${this.prefix}musicVolume`)) || 0.5,
                sfxVolume: parseFloat(localStorage.getItem(`${this.prefix}sfxVolume`)) || 0.7
            };
        } catch (e) {
            return { musicVolume: 0.5, sfxVolume: 0.7 };
        }
    }

    // Save cookie consent
    saveCookieConsent(accepted) {
        try {
            localStorage.setItem(`${this.prefix}cookieConsent`, accepted ? 'true' : 'false');
        } catch (e) { }
    }

    // Check if cookie consent given
    hasCookieConsent() {
        try {
            return localStorage.getItem(`${this.prefix}cookieConsent`) === 'true';
        } catch (e) {
            return false;
        }
    }

    // Save player profile
    saveProfile(name, color, face, hat) {
        try {
            const profile = { name, color, face, hat };
            localStorage.setItem(`${this.prefix}profile`, JSON.stringify(profile));
        } catch (e) { }
    }

    // Load player profile
    loadProfile() {
        try {
            const data = localStorage.getItem(`${this.prefix}profile`);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            return null;
        }
    }
}

export default StorageManager;
