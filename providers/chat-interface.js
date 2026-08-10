/**
 * Chat Interface - Local chat UI replacement for Claude iframe
 * Uses ProviderManager and APIClient for multi-provider support
 */

class ChatInterface {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.providerManager = new ProviderManager();
    this.apiClient = new APIClient(this.providerManager);
    this.messages = [];
    this.isStreaming = false;
    this.onToolCall = null;
    this.onScreenshot = null;
  }

  async init() {
    await this.providerManager.init();
    this.render();
    this.bindEvents();
  }

  render() {
    this.container.innerHTML = `
      <div class="chat-interface">
        <div class="chat-header">
          <div class="provider-selector">
            <select id="provider-select">
              ${this.renderProviderOptions()}
            </select>
            <select id="model-select">
              ${this.renderModelOptions()}
            </select>
          </div>
          <button id="settings-btn" class="icon-btn" title="Settings">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          </button>
        </div>
        <div id="chat-messages" class="chat-messages">
          <div class="welcome-message">
            <h2>Welcome! 👋</h2>
            <p>Select a provider and start chatting.</p>
            <p class="hint">Click the gear icon to add your API key.</p>
          </div>
        </div>
        <div class="chat-input-container">
          <textarea id="chat-input" placeholder="Type your message..." rows="1"></textarea>
          <button id="send-btn" class="send-btn" title="Send">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
          <button id="stop-btn" class="stop-btn hidden" title="Stop">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2"></rect>
            </svg>
          </button>
        </div>
      </div>

      <!-- Settings Modal -->
      <div id="settings-modal" class="modal hidden">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Provider Settings</h3>
            <button id="close-modal" class="close-btn">&times;</button>
          </div>
          <div class="modal-body">
            <div class="settings-section">
              <h4>Add Provider API Key</h4>
              <div class="provider-list">
                ${this.renderProviderSettings()}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>${this.getStyles()}</style>
    `;
  }

  renderProviderOptions() {
    const providers = this.providerManager.getProviders();
    const activeId = this.providerManager.activeProviderId;
    return providers.map(p =>
      `<option value="${p.id}" ${p.id === activeId ? 'selected' : ''}>${p.name}</option>`
    ).join('');
  }

  renderModelOptions() {
    const provider = this.providerManager.getActiveProvider();
    if (!provider) return '<option value="">No provider selected</option>';

    const selectedModel = this.providerManager.getProviderModel(provider.id);
    return provider.models.map(m =>
      `<option value="${m}" ${m === selectedModel ? 'selected' : ''}>${m}</option>`
    ).join('');
  }

  renderProviderSettings() {
    const providers = this.providerManager.getProviders();
    return providers.map(p => {
      const hasKey = this.providerManager.hasProviderKey(p.id);
      const currentKey = this.providerManager.getProviderKey(p.id) || '';
      return `
        <div class="provider-setting-item">
          <div class="provider-info">
            <span class="provider-name">${p.name}</span>
            ${p.free ? '<span class="badge free">Free</span>' : '<span class="badge paid">Paid</span>'}
          </div>
          <input type="password"
                 class="api-key-input"
                 data-provider="${p.id}"
                 placeholder="Enter ${p.name} API key"
                 value="${currentKey}">
          <button class="save-key-btn" data-provider="${p.id}">
            ${hasKey ? 'Update' : 'Save'}
          </button>
          ${hasKey ? `<button class="remove-key-btn" data-provider="${p.id}">Remove</button>` : ''}
        </div>
      `;
    }).join('');
  }

  bindEvents() {
    // Provider select
    document.getElementById('provider-select')?.addEventListener('change', async (e) => {
      await this.providerManager.setActiveProvider(e.target.value);
      document.getElementById('model-select').innerHTML = this.renderModelOptions();
    });

    // Model select
    document.getElementById('model-select')?.addEventListener('change', async (e) => {
      await this.providerManager.setProviderModel(this.providerManager.activeProviderId, e.target.value);
    });

    // Send button
    document.getElementById('send-btn')?.addEventListener('click', () => this.sendMessage());

    // Stop button
    document.getElementById('stop-btn')?.addEventListener('click', () => this.stopMessage());

    // Enter to send
    document.getElementById('chat-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Auto-resize textarea
    document.getElementById('chat-input')?.addEventListener('input', (e) => {
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
    });

    // Settings modal
    document.getElementById('settings-btn')?.addEventListener('click', () => {
      document.getElementById('settings-modal')?.classList.remove('hidden');
    });

    document.getElementById('close-modal')?.addEventListener('click', () => {
      document.getElementById('settings-modal')?.classList.add('hidden');
    });

    // Save API keys
    document.querySelectorAll('.save-key-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const providerId = e.target.dataset.provider;
        const input = document.querySelector(`.api-key-input[data-provider="${providerId}"]`);
        const apiKey = input?.value?.trim();

        if (apiKey) {
          await this.providerManager.setProviderKey(providerId, apiKey);
          this.showNotification(`${providerId} API key saved!`, 'success');
          this.render();
          this.bindEvents();
        }
      });
    });

    // Remove API keys
    document.querySelectorAll('.remove-key-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const providerId = e.target.dataset.provider;
        await this.providerManager.removeProviderKey(providerId);
        this.showNotification(`${providerId} API key removed`, 'info');
        this.render();
        this.bindEvents();
      });
    });

    // Set streaming callback
    window.onStreamChunk = (chunk) => this.appendStreamChunk(chunk);
  }

  async sendMessage() {
    const input = document.getElementById('chat-input');
    const message = input?.value?.trim();

    if (!message || this.isStreaming) return;

    // Check if provider is configured
    if (!this.providerManager.getActiveProvider() || !this.providerManager.getProviderKey(this.providerManager.activeProviderId)) {
      this.showNotification('Please configure a provider API key first', 'error');
      return;
    }

    // Add user message
    this.addMessage('user', message);
    input.value = '';
    input.style.height = 'auto';

    // Show loading
    this.isStreaming = true;
    this.showLoading(true);

    try {
      // Prepare messages for API
      const apiMessages = this.messages.map(m => ({
        role: m.role,
        content: m.content
      }));

      // Add system prompt
      apiMessages.unshift({
        role: 'system',
        content: 'You are a helpful AI assistant. You can help with browsing, taking screenshots, clicking elements, and other browser tasks. When you need to perform an action, describe what you want to do.'
      });

      // Send to provider with streaming
      const result = await this.apiClient.sendMessageStream(apiMessages, {
        maxTokens: 4096,
        temperature: 0.7
      });

      if (result && result.content) {
        this.addMessage('assistant', result.content);
      }
    } catch (error) {
      console.error('Send message error:', error);
      this.showNotification(`Error: ${error.message}`, 'error');
    } finally {
      this.isStreaming = false;
      this.showLoading(false);
    }
  }

  stopMessage() {
    this.apiClient.abort();
    this.isStreaming = false;
    this.showLoading(false);
  }

  addMessage(role, content) {
    this.messages.push({ role, content });
    this.renderMessage(role, content);
    this.scrollToBottom();
  }

  renderMessage(role, content) {
    const messagesContainer = document.getElementById('chat-messages');
    const welcomeMsg = messagesContainer?.querySelector('.welcome-message');
    if (welcomeMsg) welcomeMsg.remove();

    const messageEl = document.createElement('div');
    messageEl.className = `message ${role}`;
    messageEl.innerHTML = `
      <div class="message-avatar">${role === 'user' ? '👤' : '🤖'}</div>
      <div class="message-content">${this.formatContent(content)}</div>
    `;
    messagesContainer?.appendChild(messageEl);
  }

  appendStreamChunk(chunk) {
    const messagesContainer = document.getElementById('chat-messages');
    const lastMessage = messagesContainer?.querySelector('.message.assistant:last-child');

    if (lastMessage) {
      const contentEl = lastMessage.querySelector('.message-content');
      if (contentEl) {
        contentEl.innerHTML = this.formatContent(contentEl.innerHTML + chunk);
        this.scrollToBottom();
      }
    } else {
      this.addMessage('assistant', chunk);
    }
  }

  formatContent(content) {
    // Basic markdown-like formatting
    return content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>');
  }

  showLoading(show) {
    const sendBtn = document.getElementById('send-btn');
    const stopBtn = document.getElementById('stop-btn');

    if (show) {
      sendBtn?.classList.add('hidden');
      stopBtn?.classList.remove('hidden');
    } else {
      sendBtn?.classList.remove('hidden');
      stopBtn?.classList.add('hidden');
    }
  }

  scrollToBottom() {
    const messagesContainer = document.getElementById('chat-messages');
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }

  showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    // Auto remove
    setTimeout(() => {
      notification.remove();
    }, 3000);
  }

  getStyles() {
    return `
      .chat-interface {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: #1a1a1a;
        color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .chat-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        background: #252525;
        border-bottom: 1px solid #333;
      }

      .provider-selector {
        display: flex;
        gap: 8px;
      }

      .provider-selector select {
        background: #333;
        color: #fff;
        border: 1px solid #444;
        border-radius: 6px;
        padding: 6px 12px;
        font-size: 13px;
        cursor: pointer;
      }

      .provider-selector select:hover {
        border-color: #666;
      }

      .icon-btn {
        background: transparent;
        border: none;
        color: #888;
        cursor: pointer;
        padding: 6px;
        border-radius: 6px;
        transition: all 0.2s;
      }

      .icon-btn:hover {
        background: #333;
        color: #fff;
      }

      .chat-messages {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
      }

      .welcome-message {
        text-align: center;
        padding: 40px 20px;
        color: #888;
      }

      .welcome-message h2 {
        margin: 0 0 8px 0;
        color: #fff;
      }

      .welcome-message .hint {
        font-size: 12px;
        color: #666;
        margin-top: 16px;
      }

      .message {
        display: flex;
        gap: 12px;
        margin-bottom: 16px;
        animation: fadeIn 0.3s ease;
      }

      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .message-avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: #333;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        flex-shrink: 0;
      }

      .message.user .message-avatar {
        background: #4a9eff;
      }

      .message-content {
        background: #252525;
        padding: 12px 16px;
        border-radius: 12px;
        max-width: 80%;
        line-height: 1.5;
        word-wrap: break-word;
      }

      .message.user .message-content {
        background: #4a9eff;
        color: #fff;
      }

      .message-content code {
        background: #333;
        padding: 2px 6px;
        border-radius: 4px;
        font-family: 'Monaco', 'Menlo', monospace;
        font-size: 13px;
      }

      .chat-input-container {
        display: flex;
        align-items: flex-end;
        gap: 8px;
        padding: 16px;
        background: #252525;
        border-top: 1px solid #333;
      }

      #chat-input {
        flex: 1;
        background: #333;
        color: #fff;
        border: 1px solid #444;
        border-radius: 12px;
        padding: 12px 16px;
        font-size: 14px;
        resize: none;
        max-height: 150px;
        font-family: inherit;
      }

      #chat-input:focus {
        outline: none;
        border-color: #4a9eff;
      }

      .send-btn, .stop-btn {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }

      .send-btn {
        background: #4a9eff;
        color: #fff;
      }

      .send-btn:hover {
        background: #3a8eef;
        transform: scale(1.05);
      }

      .stop-btn {
        background: #ff4a4a;
        color: #fff;
      }

      .stop-btn:hover {
        background: #ee3a3a;
      }

      .hidden {
        display: none !important;
      }

      /* Modal styles */
      .modal {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }

      .modal-content {
        background: #252525;
        border-radius: 12px;
        width: 90%;
        max-width: 500px;
        max-height: 80vh;
        overflow: hidden;
      }

      .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid #333;
      }

      .modal-header h3 {
        margin: 0;
        color: #fff;
      }

      .close-btn {
        background: transparent;
        border: none;
        color: #888;
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
      }

      .close-btn:hover {
        color: #fff;
      }

      .modal-body {
        padding: 20px;
        overflow-y: auto;
        max-height: calc(80vh - 60px);
      }

      .settings-section h4 {
        margin: 0 0 16px 0;
        color: #fff;
        font-size: 14px;
      }

      .provider-setting-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px;
        background: #1a1a1a;
        border-radius: 8px;
        margin-bottom: 8px;
      }

      .provider-info {
        flex: 1;
        min-width: 120px;
      }

      .provider-name {
        display: block;
        color: #fff;
        font-size: 13px;
        font-weight: 500;
      }

      .badge {
        display: inline-block;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 600;
        margin-top: 2px;
      }

      .badge.free {
        background: #2ecc71;
        color: #fff;
      }

      .badge.paid {
        background: #e74c3c;
        color: #fff;
      }

      .api-key-input {
        flex: 1;
        background: #333;
        color: #fff;
        border: 1px solid #444;
        border-radius: 6px;
        padding: 8px 12px;
        font-size: 12px;
        min-width: 150px;
      }

      .api-key-input:focus {
        outline: none;
        border-color: #4a9eff;
      }

      .save-key-btn, .remove-key-btn {
        padding: 8px 12px;
        border-radius: 6px;
        border: none;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .save-key-btn {
        background: #4a9eff;
        color: #fff;
      }

      .save-key-btn:hover {
        background: #3a8eef;
      }

      .remove-key-btn {
        background: #ff4a4a;
        color: #fff;
      }

      .remove-key-btn:hover {
        background: #ee3a3a;
      }

      /* Notification */
      .notification {
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 2000;
        animation: slideUp 0.3s ease;
      }

      @keyframes slideUp {
        from { transform: translateX(-50%) translateY(20px); opacity: 0; }
        to { transform: translateX(-50%) translateY(0); opacity: 1; }
      }

      .notification.success {
        background: #2ecc71;
        color: #fff;
      }

      .notification.error {
        background: #e74c3c;
        color: #fff;
      }

      .notification.info {
        background: #3498db;
        color: #fff;
      }
    `;
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ChatInterface };
} else {
  window.ChatInterface = ChatInterface;
}
