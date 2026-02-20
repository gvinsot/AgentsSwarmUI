import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

// ─── Ollama Provider ────────────────────────────────────────────────────────
// Retry helper for Ollama fetch calls — handles transient 'fetch failed'
// or HTTP 503 when Ollama is busy with another request.
const OLLAMA_MAX_RETRIES = 4;
const OLLAMA_BASE_DELAY_MS = 2000;

async function ollamaFetchWithRetry(url, options, maxRetries = OLLAMA_MAX_RETRIES) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      // Ollama returns 503 when busy — retry
      if (res.status === 503 && attempt < maxRetries) {
        const delay = OLLAMA_BASE_DELAY_MS * Math.pow(2, attempt);
        console.log(`⚠️  [Ollama] 503 busy — retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return res;
    } catch (err) {
      // Transient network errors (fetch failed, ECONNREFUSED, etc.)
      if (attempt < maxRetries) {
        const delay = OLLAMA_BASE_DELAY_MS * Math.pow(2, attempt);
        console.log(`⚠️  [Ollama] ${err.message} — retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}
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

    const res = await ollamaFetchWithRetry(`${this.baseUrl}/api/chat`, {
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

    const res = await ollamaFetchWithRetry(`${this.baseUrl}/api/chat`, {
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

// ─── OpenAI Provider ────────────────────────────────────────────────────────
// Completion-only models (legacy, use /v1/completions endpoint)
const OPENAI_COMPLETION_MODELS = [
  'gpt-3.5-turbo-instruct', 'davinci-002', 'babbage-002',
  'text-davinci-003', 'text-davinci-002', 'text-curie-001', 'text-babbage-001', 'text-ada-001'
];

export class OpenAIProvider {
  constructor(apiKey, model) {
    this.client = new OpenAI({ apiKey });
    this.model = model || 'gpt-4o';
    this.isCompletionModel = OPENAI_COMPLETION_MODELS.some(m => this.model.startsWith(m));
  }

  async chat(messages, options = {}) {
    if (this.isCompletionModel) {
      return this._completionChat(messages, options);
    }
    return this._chatCompletion(messages, options);
  }

  async _chatCompletion(messages, options = {}) {
    const params = {
      model: this.model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content
      })),
      temperature: options.temperature ?? 0.7,
      max_completion_tokens: options.maxTokens || 4096,
    };

    const response = await this.client.chat.completions.create(params);

    return {
      content: response.choices[0]?.message?.content || '',
      model: this.model,
      provider: 'openai',
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0
      }
    };
  }

  async _completionChat(messages, options = {}) {
    // Convert messages to a single prompt for completion models
    const prompt = messages.map(m => {
      if (m.role === 'system') return `System: ${m.content}`;
      if (m.role === 'user') return `Human: ${m.content}`;
      return `Assistant: ${m.content}`;
    }).join('\n\n') + '\n\nAssistant:';

    const response = await this.client.completions.create({
      model: this.model,
      prompt,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens || 4096,
    });

    return {
      content: response.choices[0]?.text?.trim() || '',
      model: this.model,
      provider: 'openai',
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0
      }
    };
  }

  async *chatStream(messages, options = {}) {
    if (this.isCompletionModel) {
      yield* this._completionStream(messages, options);
    } else {
      yield* this._chatCompletionStream(messages, options);
    }
  }

  async *_chatCompletionStream(messages, options = {}) {
    const params = {
      model: this.model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content
      })),
      temperature: options.temperature ?? 0.7,
      max_completion_tokens: options.maxTokens || 4096,
      stream: true,
      stream_options: { include_usage: true },
    };

    const stream = await this.client.chat.completions.create(params);

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        yield { type: 'text', text: delta.content };
      }

      // Final chunk with usage
      if (chunk.usage) {
        yield {
          type: 'done',
          usage: {
            inputTokens: chunk.usage.prompt_tokens || 0,
            outputTokens: chunk.usage.completion_tokens || 0
          }
        };
      }
    }
  }

  async *_completionStream(messages, options = {}) {
    // Convert messages to a single prompt for completion models
    const prompt = messages.map(m => {
      if (m.role === 'system') return `System: ${m.content}`;
      if (m.role === 'user') return `Human: ${m.content}`;
      return `Assistant: ${m.content}`;
    }).join('\n\n') + '\n\nAssistant:';

    const stream = await this.client.completions.create({
      model: this.model,
      prompt,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens || 4096,
      stream: true,
    });

    let totalTokens = 0;
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.text;
      if (text) {
        yield { type: 'text', text };
        totalTokens++;
      }
    }

    yield {
      type: 'done',
      usage: { inputTokens: 0, outputTokens: totalTokens }
    };
  }

  async ping() {
    try {
      if (this.isCompletionModel) {
        const response = await this.client.completions.create({
          model: this.model,
          prompt: 'ping',
          max_tokens: 5,
        });
        return !!response;
      }
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_completion_tokens: 5,
        messages: [{ role: 'user', content: 'ping' }]
      });
      return !!response;
    } catch {
      return false;
    }
  }
}

// ─── vLLM Provider (OpenAI-compatible) ──────────────────────────────────────
export class VLLMProvider {
  constructor(baseUrl, model, apiKey) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.model = model;
    this.client = new OpenAI({
      apiKey: apiKey || 'dummy',  // vLLM may not require an API key
      baseURL: `${this.baseUrl}/v1`,
    });
  }

  async chat(messages, options = {}) {
    const params = {
      model: this.model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content
      })),
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens || 4096,
    };

    const response = await this.client.chat.completions.create(params);

    return {
      content: response.choices[0]?.message?.content || '',
      model: this.model,
      provider: 'vllm',
      usage: {
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0
      }
    };
  }

  async *chatStream(messages, options = {}) {
    const params = {
      model: this.model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content
      })),
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens || 4096,
      stream: true,
      stream_options: { include_usage: true },
    };

    const stream = await this.client.chat.completions.create(params);

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        yield { type: 'text', text: delta.content };
      }

      if (chunk.usage) {
        yield {
          type: 'done',
          usage: {
            inputTokens: chunk.usage.prompt_tokens || 0,
            outputTokens: chunk.usage.completion_tokens || 0
          }
        };
      }
    }
  }

  async ping() {
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, { signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
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
    case 'openai':
      return new OpenAIProvider(
        config.apiKey || process.env.OPENAI_API_KEY,
        config.model
      );
    case 'vllm':
      return new VLLMProvider(
        config.endpoint || process.env.VLLM_BASE_URL || 'http://localhost:8000',
        config.model,
        config.apiKey || process.env.VLLM_API_KEY || ''
      );
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
