/**
 * Provider Manager - Multi-AI Provider Support
 * Supports: Gemini, GPT, Grok, Mistral, DeepSeek, Anthropic, etc.
 */

// Default provider configurations
const DEFAULT_PROVIDERS = {
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro'],
    defaultModel: 'gemini-2.0-flash',
    authType: 'api_key',
    authParam: 'key',
    authLocation: 'url', // or 'header'
    headerName: 'x-goog-api-key',
    openaiCompatible: false,
    free: true,
    description: 'Google Gemini - Free tier available'
  },
  openai: {
    id: 'openai',
    name: 'OpenAI GPT',
    endpoint: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    defaultModel: 'gpt-4o-mini',
    authType: 'api_key',
    authParam: 'api_key',
    authLocation: 'header',
    headerName: 'Authorization',
    headerPrefix: 'Bearer ',
    openaiCompatible: true,
    free: false,
    description: 'OpenAI GPT - $5 free credits for new accounts'
  },
  grok: {
    id: 'grok',
    name: 'xAI Grok',
    endpoint: 'https://api.x.ai/v1',
    models: ['grok-2', 'grok-2-mini', 'grok-beta'],
    defaultModel: 'grok-2-mini',
    authType: 'api_key',
    authParam: 'api_key',
    authLocation: 'header',
    headerName: 'Authorization',
    headerPrefix: 'Bearer ',
    openaiCompatible: true,
    free: false,
    description: 'xAI Grok - Limited free usage'
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-coder'],
    defaultModel: 'deepseek-chat',
    authType: 'api_key',
    authParam: 'api_key',
    authLocation: 'header',
    headerName: 'Authorization',
    headerPrefix: 'Bearer ',
    openaiCompatible: true,
    free: true,
    description: 'DeepSeek - Free tier available'
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral AI',
    endpoint: 'https://api.mistral.ai/v1',
    models: ['mistral-tiny', 'mistral-small', 'mistral-medium', 'mistral-large-latest'],
    defaultModel: 'mistral-tiny',
    authType: 'api_key',
    authParam: 'api_key',
    authLocation: 'header',
    headerName: 'Authorization',
    headerPrefix: 'Bearer ',
    openaiCompatible: true,
    free: true,
    description: 'Mistral AI - Free tier available'
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1',
    models: ['llama-3.1-8b-instant', 'llama-3.1-70b-versatile', 'mixtral-8x7b-32768'],
    defaultModel: 'llama-3.1-8b-instant',
    authType: 'api_key',
    authParam: 'api_key',
    authLocation: 'header',
    headerName: 'Authorization',
    headerPrefix: 'Bearer ',
    openaiCompatible: true,
    free: true,
    description: 'Groq - Free tier available, fast inference'
  },
  together: {
    id: 'together',
    name: 'Together AI',
    endpoint: 'https://api.together.xyz/v1',
    models: ['meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo'],
    defaultModel: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
    authType: 'api_key',
    authParam: 'api_key',
    authLocation: 'header',
    headerName: 'Authorization',
    headerPrefix: 'Bearer ',
    openaiCompatible: true,
    free: true,
    description: 'Together AI - Free tier available'
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic Claude',
    endpoint: 'https://api.anthropic.com/v1',
    models: ['claude-3-5-haiku-20241022', 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'],
    defaultModel: 'claude-3-5-haiku-20241022',
    authType: 'api_key',
    authParam: 'api_key',
    authLocation: 'header',
    headerName: 'x-api-key',
    openaiCompatible: false,
    free: false,
    description: 'Anthropic Claude - Paid API'
  }
};

class ProviderManager {
  constructor() {
    this.providers = { ...DEFAULT_PROVIDERS };
    this.activeProviderId = null;
    this.providerKeys = {};
    this.selectedModels = {};
  }

  // Initialize from Chrome storage
  async init() {
    try {
      const data = await chrome.storage.local.get([
        'providerManager_activeProvider',
        'providerManager_providerKeys',
        'providerManager_selectedModels',
        'providerManager_customProviders'
      ]);

      this.activeProviderId = data.providerManager_activeProvider || null;
      this.providerKeys = data.providerManager_providerKeys || {};
      this.selectedModels = data.providerManager_selectedModels || {};

      // Add custom providers if any
      if (data.providerManager_customProviders) {
        Object.assign(this.providers, data.providerManager_customProviders);
      }

      // If no active provider, set first available one
      if (!this.activeProviderId) {
        const firstWithKey = Object.keys(this.providerKeys).find(id => this.providerKeys[id]);
        if (firstWithKey) {
          this.activeProviderId = firstWithKey;
          await this.save();
        }
      }

      return true;
    } catch (error) {
      console.error('ProviderManager init error:', error);
      return false;
    }
  }

  // Save to Chrome storage
  async save() {
    try {
      await chrome.storage.local.set({
        providerManager_activeProvider: this.activeProviderId,
        providerManager_providerKeys: this.providerKeys,
        providerManager_selectedModels: this.selectedModels
      });
      return true;
    } catch (error) {
      console.error('ProviderManager save error:', error);
      return false;
    }
  }

  // Get all providers
  getProviders() {
    return Object.values(this.providers);
  }

  // Get provider by ID
  getProvider(id) {
    return this.providers[id] || null;
  }

  // Get active provider
  getActiveProvider() {
    if (!this.activeProviderId) return null;
    return this.providers[this.activeProviderId] || null;
  }

  // Set active provider
  async setActiveProvider(id) {
    if (!this.providers[id]) {
      throw new Error(`Provider ${id} not found`);
    }
    this.activeProviderId = id;
    await this.save();
    return true;
  }

  // Set API key for a provider
  async setProviderKey(providerId, apiKey) {
    if (!this.providers[providerId]) {
      throw new Error(`Provider ${providerId} not found`);
    }
    this.providerKeys[providerId] = apiKey;
    await this.save();
    return true;
  }

  // Get API key for a provider
  getProviderKey(providerId) {
    return this.providerKeys[providerId] || null;
  }

  // Remove API key for a provider
  async removeProviderKey(providerId) {
    delete this.providerKeys[providerId];
    await this.save();
    return true;
  }

  // Set model for a provider
  async setProviderModel(providerId, model) {
    if (!this.providers[providerId]) {
      throw new Error(`Provider ${providerId} not found`);
    }
    this.selectedModels[providerId] = model;
    await this.save();
    return true;
  }

  // Get model for a provider
  getProviderModel(providerId) {
    return this.selectedModels[providerId] || this.providers[providerId]?.defaultModel || null;
  }

  // Check if provider has API key
  hasProviderKey(providerId) {
    return !!this.providerKeys[providerId];
  }

  // Get providers with keys
  getProvidersWithKeys() {
    return Object.values(this.providers).filter(p => this.providerKeys[p.id]);
  }

  // Add custom provider
  async addCustomProvider(config) {
    if (!config.id || !config.name || !config.endpoint) {
      throw new Error('Provider must have id, name, and endpoint');
    }
    this.providers[config.id] = {
      ...config,
      openaiCompatible: config.openaiCompatible !== false,
      authType: config.authType || 'api_key',
      authLocation: config.authLocation || 'header',
      headerName: config.headerName || 'Authorization',
      headerPrefix: config.headerPrefix || 'Bearer '
    };
    await chrome.storage.local.set({
      providerManager_customProviders: this.providers
    });
    return true;
  }

  // Remove custom provider
  async removeCustomProvider(id) {
    if (DEFAULT_PROVIDERS[id]) {
      throw new Error('Cannot remove default provider');
    }
    delete this.providers[id];
    delete this.providerKeys[id];
    delete this.selectedModels[id];
    if (this.activeProviderId === id) {
      this.activeProviderId = null;
    }
    await chrome.storage.local.set({
      providerManager_customProviders: this.providers
    });
    await this.save();
    return true;
  }

  // Validate API key format
  validateApiKey(providerId, apiKey) {
    const provider = this.providers[providerId];
    if (!provider) return false;

    // Basic validation based on provider
    switch (providerId) {
      case 'gemini':
        return apiKey && apiKey.length > 20;
      case 'openai':
        return apiKey && apiKey.startsWith('sk-') && apiKey.length > 20;
      case 'grok':
        return apiKey && apiKey.length > 10;
      case 'deepseek':
        return apiKey && apiKey.startsWith('sk-') && apiKey.length > 10;
      case 'mistral':
        return apiKey && apiKey.length > 20;
      case 'groq':
        return apiKey && apiKey.startsWith('gsk_') && apiKey.length > 20;
      case 'together':
        return apiKey && apiKey.length > 20;
      case 'anthropic':
        return apiKey && apiKey.startsWith('sk-ant-') && apiKey.length > 20;
      default:
        return apiKey && apiKey.length > 5;
    }
  }
}

// Export for use in extension
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ProviderManager, DEFAULT_PROVIDERS };
} else {
  // Browser context
  window.ProviderManager = ProviderManager;
  window.DEFAULT_PROVIDERS = DEFAULT_PROVIDERS;
}
