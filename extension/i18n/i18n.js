// i18n.js — Simple internationalization module for Glide
// Loads translations from JSON files and provides t() function

const I18N = {
  currentLang: "en",
  translations: {},

  async init() {
    // Get saved language from storage
    try {
      const s = await chrome.storage.local.get(["language"]);
      this.currentLang = s.language || "en";
    } catch (_) {
      this.currentLang = "en";
    }
    await this.loadTranslations(this.currentLang);
  },

  async loadTranslations(lang) {
    try {
      const response = await fetch(chrome.runtime.getURL(`i18n/${lang}.json`));
      if (response.ok) {
        this.translations = await response.json();
        this.currentLang = lang;
      } else {
        // Fallback to English
        const fallback = await fetch(chrome.runtime.getURL("i18n/en.json"));
        this.translations = await fallback.json();
        this.currentLang = "en";
      }
    } catch (_) {
      this.translations = {};
    }
  },

  // Translate a key with optional variables
  t(key, vars = {}) {
    let text = this.translations[key] || key;
    // Replace {variable} placeholders
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, "g"), v);
    }
    return text;
  },

  // Get current language
  getLang() {
    return this.currentLang;
  },

  // Set language and reload translations
  async setLang(lang) {
    this.currentLang = lang;
    await chrome.storage.local.set({ language: lang });
    await this.loadTranslations(lang);
    // Dispatch event for UI to update
    window.dispatchEvent(new CustomEvent("languageChanged", { detail: { lang } }));
  },

  // Get available languages
  getAvailableLanguages() {
    return [
      { code: "en", name: "English" },
      { code: "hi", name: "हिन्दी" },
    ];
  },
};

// Initialize on load
I18N.init();
