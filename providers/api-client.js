/**
 * API Client - Unified interface for all AI providers
 * Handles OpenAI-compatible and custom API formats
 */

class APIClient {
  constructor(providerManager) {
    this.providerManager = providerManager;
    this.abortController = null;
  }

  // Abort ongoing request
  abort() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  // Send message to active provider
  async sendMessage(messages, options = {}) {
    const provider = this.providerManager.getActiveProvider();
    const apiKey = this.providerManager.getProviderKey(provider?.id);
    const model = this.providerManager.getProviderModel(provider?.id);

    if (!provider || !apiKey) {
      throw new Error('No active provider or API key configured');
    }

    this.abortController = new AbortController();

    try {
      if (provider.openaiCompatible) {
        return await this.sendOpenAICompatible(provider, apiKey, model, messages, options);
      } else if (provider.id === 'gemini') {
        return await this.sendGemini(provider, apiKey, model, messages, options);
      } else if (provider.id === 'anthropic') {
        return await this.sendAnthropic(provider, apiKey, model, messages, options);
      } else {
        throw new Error(`Unsupported provider: ${provider.id}`);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Request aborted');
        return null;
      }
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  // Send streaming message
  async sendMessageStream(messages, options = {}) {
    const provider = this.providerManager.getActiveProvider();
    const apiKey = this.providerManager.getProviderKey(provider?.id);
    const model = this.providerManager.getProviderModel(provider?.id);

    if (!provider || !apiKey) {
      throw new Error('No active provider or API key configured');
    }

    this.abortController = new AbortController();

    try {
      if (provider.openaiCompatible) {
        return await this.streamOpenAICompatible(provider, apiKey, model, messages, options);
      } else if (provider.id === 'gemini') {
        return await this.streamGemini(provider, apiKey, model, messages, options);
      } else if (provider.id === 'anthropic') {
        return await this.streamAnthropic(provider, apiKey, model, messages, options);
      } else {
        throw new Error(`Unsupported provider: ${provider.id}`);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Stream aborted');
        return null;
      }
      throw error;
    } finally {
      this.abortController = null;
    }
  }

  // OpenAI-compatible API (GPT, Grok, Mistral, DeepSeek, Groq, Together)
  async sendOpenAICompatible(provider, apiKey, model, messages, options) {
    const url = `${provider.endpoint}/chat/completions`;

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `${provider.headerPrefix || 'Bearer '}${apiKey}`
    };

    const body = {
      model: model,
      messages: messages,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature || 0.7,
      stream: false
    };

    if (options.tools) {
      body.tools = options.tools;
      body.tool_choice = options.toolChoice || 'auto';
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
      signal: this.abortController?.signal
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `API request failed: ${response.status}`);
    }

    const data = await response.json();
    return {
      content: data.choices[0]?.message?.content || '',
      role: 'assistant',
      model: data.model,
      usage: data.usage,
      toolCalls: data.choices[0]?.message?.tool_calls || null
    };
  }

  // OpenAI-compatible streaming
  async streamOpenAICompatible(provider, apiKey, model, messages, options) {
    const url = `${provider.endpoint}/chat/completions`;

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `${provider.headerPrefix || 'Bearer '}${apiKey}`
    };

    const body = {
      model: model,
      messages: messages,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature || 0.7,
      stream: true
    };

    if (options.tools) {
      body.tools = options.tools;
      body.tool_choice = options.toolChoice || 'auto';
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
      signal: this.abortController?.signal
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `API request failed: ${response.status}`);
    }

    return this.processOpenAIStream(response);
  }

  // Process OpenAI stream
  async processOpenAIStream(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            return { content: fullContent, role: 'assistant' };
          }

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices[0]?.delta?.content;
            if (delta) {
              fullContent += delta;
              // Emit event for streaming UI
              if (typeof window !== 'undefined' && window.onStreamChunk) {
                window.onStreamChunk(delta);
              }
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }

    return { content: fullContent, role: 'assistant' };
  }

  // Gemini API
  async sendGemini(provider, apiKey, model, messages, options) {
    const url = `${provider.endpoint}/models/${model}:generateContent?key=${apiKey}`;

    // Convert messages to Gemini format
    const contents = this.convertToGeminiFormat(messages);

    const body = {
      contents: contents,
      generationConfig: {
        maxOutputTokens: options.maxTokens || 4096,
        temperature: options.temperature || 0.7
      }
    };

    if (options.systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: options.systemPrompt }]
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: this.abortController?.signal
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `Gemini API failed: ${response.status}`);
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return {
      content: content,
      role: 'assistant',
      model: model,
      usage: data.usageMetadata
    };
  }

  // Gemini streaming
  async streamGemini(provider, apiKey, model, messages, options) {
    const url = `${provider.endpoint}/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;

    const contents = this.convertToGeminiFormat(messages);

    const body = {
      contents: contents,
      generationConfig: {
        maxOutputTokens: options.maxTokens || 4096,
        temperature: options.temperature || 0.7
      }
    };

    if (options.systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: options.systemPrompt }]
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: this.abortController?.signal
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `Gemini API failed: ${response.status}`);
    }

    return this.processGeminiStream(response);
  }

  // Process Gemini stream
  async processGeminiStream(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (content) {
              fullContent += content;
              if (typeof window !== 'undefined' && window.onStreamChunk) {
                window.onStreamChunk(content);
              }
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }

    return { content: fullContent, role: 'assistant' };
  }

  // Convert messages to Gemini format
  convertToGeminiFormat(messages) {
    const contents = [];
    let systemParts = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemParts.push({ text: msg.content });
      } else if (msg.role === 'user') {
        contents.push({
          role: 'user',
          parts: [{ text: msg.content }]
        });
      } else if (msg.role === 'assistant') {
        contents.push({
          role: 'model',
          parts: [{ text: msg.content }]
        });
      }
    }

    return contents;
  }

  // Anthropic API (for completeness)
  async sendAnthropic(provider, apiKey, model, messages, options) {
    const url = `${provider.endpoint}/messages`;

    // Extract system message
    const systemMsg = messages.find(m => m.role === 'system');
    const otherMsgs = messages.filter(m => m.role !== 'system');

    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    };

    const body = {
      model: model,
      max_tokens: options.maxTokens || 4096,
      messages: otherMsgs.map(m => ({
        role: m.role,
        content: m.content
      }))
    };

    if (systemMsg) {
      body.system = systemMsg.content;
    }

    if (options.tools) {
      body.tools = options.tools;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
      signal: this.abortController?.signal
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `Anthropic API failed: ${response.status}`);
    }

    const data = await response.json();
    const content = data.content?.[0]?.text || '';

    return {
      content: content,
      role: 'assistant',
      model: data.model,
      usage: data.usage,
      toolCalls: data.content?.filter(c => c.type === 'tool_use') || null
    };
  }

  // Test provider connection
  async testConnection(providerId) {
    const provider = this.providerManager.getProvider(providerId);
    const apiKey = this.providerManager.getProviderKey(providerId);

    if (!provider || !apiKey) {
      return { success: false, error: 'Provider or API key not configured' };
    }

    try {
      const testMessages = [
        { role: 'user', content: 'Hello! Please respond with just "OK" to confirm the connection works.' }
      ];

      const result = await this.sendMessage(testMessages, { maxTokens: 50 });

      return {
        success: true,
        response: result.content,
        model: result.model
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { APIClient };
} else {
  window.APIClient = APIClient;
}
