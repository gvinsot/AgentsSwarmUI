import Anthropic from '@anthropic-ai/sdk';

// ─── Ollama Provider ────────────────────────────────────────────────────────
export class OllamaProvider {
  constructor(baseUrl, model) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.model = model;
  }

  async chat(messages, options = {}) {
    const body = {
      model: this.model,
      messages: messages.map(m => ({
        role: m.role === 'system' ? 'system' : m.role,
        content: m.content
      })),
      stream: false,
      options: {
        temperature: options.temperature ?? 0.7,
        num_predict: options.maxTokens ?? 4096,
      }
    };

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama error ${res.status}: ${text}`);
    }

    const data = await res.json();
    return {
      content: data.message?.content || '',
      model: this.model,
      provider: 'ollama',
      usage: {
        inputTokens: data.prompt_eval_count || 0,
        outputTokens: data.eval_count || 0
      }
    };
  }

  async *chatStream(messages, options = {}) {
    const body = {
      model: this.model,
      messages: messages.map(m => ({
        role: m.role === 'system' ? 'system' : m.role,
        content: m.content
      })),
      stream: true,
      options: {
        temperature: options.temperature ?? 0.7,
        num_predict: options.maxTokens ?? 4096,
      }
    };

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama error ${res.status}: ${text}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.message?.content) {
            yield { type: 'text', text: data.message.content };
          }
          if (data.done) {
            yield {
              type: 'done',
              usage: {
                inputTokens: data.prompt_eval_count || 0,
                outputTokens: data.eval_count || 0
              }
            };
          }
        } catch (e) {
          // skip malformed lines
        }
      }
    }
  }

  async ping() {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}

// ─── Claude Provider ────────────────────────────────────────────────────────
export class ClaudeProvider {
  constructor(apiKey, model) {
    this.client = new Anthropic({ apiKey });
    this.model = model || 'claude-sonnet-4-20250514';
  }

  async chat(messages, options = {}) {
    const systemMsg = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system').map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content
    }));

    // Ensure messages alternate correctly
    const sanitized = this._sanitizeMessages(chatMessages);

    const params = {
      model: this.model,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.7,
      messages: sanitized,
    };
    if (systemMsg) params.system = systemMsg.content;

    const response = await this.client.messages.create(params);

    return {
      content: response.content.map(c => c.text).join(''),
      model: this.model,
      provider: 'claude',
      usage: {
        inputTokens: response.usage?.input_tokens || 0,
        outputTokens: response.usage?.output_tokens || 0
      }
    };
  }

  async *chatStream(messages, options = {}) {
    const systemMsg = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system').map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content
    }));

    const sanitized = this._sanitizeMessages(chatMessages);

    const params = {
      model: this.model,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.7,
      messages: sanitized,
      stream: true,
    };
    if (systemMsg) params.system = systemMsg.content;

    const stream = this.client.messages.stream(params);

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.text) {
        yield { type: 'text', text: event.delta.text };
      }
    }

    const finalMessage = await stream.finalMessage();
    yield {
      type: 'done',
      usage: {
        inputTokens: finalMessage.usage?.input_tokens || 0,
        outputTokens: finalMessage.usage?.output_tokens || 0
      }
    };
  }

  async ping() {
    try {
      // Simple validation - try a minimal request
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'ping' }]
      });
      return !!response;
    } catch {
      return false;
    }
  }

  _sanitizeMessages(messages) {
    if (messages.length === 0) return [{ role: 'user', content: 'Hello' }];
    
    const result = [];
    let lastRole = null;
    
    for (const msg of messages) {
      if (msg.role === lastRole) {
        // Merge consecutive same-role messages
        result[result.length - 1].content += '\n' + msg.content;
      } else {
        result.push({ ...msg });
        lastRole = msg.role;
      }
    }
    
    // Ensure first message is from user
    if (result[0]?.role !== 'user') {
      result.unshift({ role: 'user', content: '(continue)' });
    }
    
    return result;
  }
}

// ─── Provider Factory ───────────────────────────────────────────────────────
export function createProvider(config) {
  switch (config.provider) {
    case 'ollama':
      return new OllamaProvider(
        config.endpoint || process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
        config.model
      );
    case 'claude':
      return new ClaudeProvider(
        config.apiKey || process.env.ANTHROPIC_API_KEY,
        config.model
      );
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
