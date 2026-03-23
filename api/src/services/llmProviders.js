import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

// Model context window sizes (total tokens: input + output)
const MODEL_CONTEXT_LIMITS = {
  'claude-sonnet-4-20250514': 200000,
  'claude-opus-4-20250514': 200000,
  'claude-haiku-4-5-20251001': 200000,
  'claude-3-7-sonnet-latest': 200000,
  'claude-3-5-sonnet-latest': 200000,
  'claude-3-5-haiku-latest': 200000,
  'claude-sonnet-4-6': 200000,
  'claude-opus-4-6': 200000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'o1': 200000,
  'o1-mini': 128000,
  'o3': 200000,
  'o3-mini': 200000,
  'o4-mini': 200000,
  'deepseek-chat': 131072,
  'deepseek-reasoner': 131072,
};
const DEFAULT_CONTEXT_LIMIT = 131072;
const MIN_OUTPUT_TOKENS = 4096;
const DEFAULT_MAX_OUTPUT = 16384;

/**
 * Estimate token count from messages (~4 chars per token, rough but safe).
 */
function estimateTokenCount(messages, systemPrompt = '') {
  let charCount = systemPrompt ? systemPrompt.length : 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      charCount += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.text) charCount += block.text.length;
        else if (block.source?.data) charCount += block.source.data.length * 0.75; // base64
      }
    }
    if (msg.role) charCount += msg.role.length;
  }
  // ~4 chars per token, add 10% safety margin
  return Math.ceil(charCount / 4 * 1.1);
}

/**
 * Calculate safe max_tokens for output given estimated input tokens and model context limit.
 */
function safeMaxTokens(estimatedInput, model) {
  const contextLimit = MODEL_CONTEXT_LIMITS[model] || DEFAULT_CONTEXT_LIMIT;
  const available = contextLimit - estimatedInput;
  if (available < MIN_OUTPUT_TOKENS) {
    return MIN_OUTPUT_TOKENS; // minimum to get some output
  }
  // Cap at DEFAULT_MAX_OUTPUT to avoid excessive token usage
  return Math.min(available, DEFAULT_MAX_OUTPUT);
}

/**
 * Truncate older messages if estimated input exceeds the model's input budget.
 * Keeps the system prompt, the first message (task context), and the most recent messages.
 */
function truncateMessages(messages, maxInputTokens) {
  const estimatedTotal = estimateTokenCount(messages);
  if (estimatedTotal <= maxInputTokens) return messages;

  // Always keep first message (task/system context) and last 4 messages (recent conversation)
  if (messages.length <= 5) return messages;

  const keepFirst = 1;
  const keepLast = 4;
  const first = messages.slice(0, keepFirst);
  const last = messages.slice(-keepLast);

  // Try progressively removing middle messages
  let truncated = [...first, { role: 'user', content: '[Earlier conversation truncated to fit context window]' }, ...last];
  let est = estimateTokenCount(truncated);

  if (est <= maxInputTokens) {
    console.log(`[LLM] Truncated ${messages.length - keepFirst - keepLast} middle messages (${estimatedTotal} → ${est} estimated tokens)`);
    return truncated;
  }

  // If still too large, truncate the content of the last messages
  console.warn(`[LLM] Messages still too large after truncation (${est} tokens), trimming last messages`);
  return truncated;
}

// Providers registry
const providers = {};

/**
 * Register an LLM provider.
 * @param {string} name   – e.g. 'anthropic', 'openai', 'deepseek'
 * @param {object} impl   – { createClient(apiKey), callLLM(client, model, messages, opts) }
 */
export function registerProvider(name, impl) {
  providers[name] = impl;
}

/* ── built-in: Anthropic ─────────────────────────────────────── */
registerProvider('anthropic', {
  createClient(apiKey) {
    return new Anthropic({ apiKey });
  },

  async callLLM(client, model, messages, { onToken, signal, systemPrompt } = {}) {
    // Estimate input and calculate safe output tokens
    const estimatedInput = estimateTokenCount(messages, systemPrompt);
    const contextLimit = MODEL_CONTEXT_LIMITS[model] || DEFAULT_CONTEXT_LIMIT;
    const maxInputBudget = contextLimit - MIN_OUTPUT_TOKENS;

    // Truncate if input exceeds budget
    const safeMessages = truncateMessages(messages, maxInputBudget);
    const finalEstimatedInput = estimateTokenCount(safeMessages, systemPrompt);
    const maxTokens = safeMaxTokens(finalEstimatedInput, model);

    console.log(`[LLM] Model: ${model}, estimated input: ${finalEstimatedInput}, max_tokens: ${maxTokens}, context: ${contextLimit}`);

    const params = {
      model,
      max_tokens: maxTokens,
      messages: safeMessages,
    };
    if (systemPrompt) params.system = systemPrompt;

    if (typeof onToken === 'function') {
      let result = '';
      const stream = await client.messages.stream(params, { signal });
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta?.text) {
          result += event.delta.text;
          onToken(event.delta.text);
        }
      }
      return result;
    }

    const resp = await client.messages.create(params);
    return resp.content?.[0]?.text ?? '';
  },
});

/* ── built-in: OpenAI-compatible (openai, deepseek, etc.) ──── */
function openaiCompatible(name, baseURLFn) {
  registerProvider(name, {
    createClient(apiKey) {
      const opts = { apiKey };
      if (baseURLFn) opts.baseURL = baseURLFn();
      return new OpenAI(opts);
    },

    async callLLM(client, model, messages, { onToken, signal, systemPrompt } = {}) {
      const msgs = systemPrompt
        ? [{ role: 'system', content: systemPrompt }, ...messages]
        : [...messages];

      // Estimate input and calculate safe output tokens
      const estimatedInput = estimateTokenCount(msgs);
      const contextLimit = MODEL_CONTEXT_LIMITS[model] || DEFAULT_CONTEXT_LIMIT;
      const maxInputBudget = contextLimit - MIN_OUTPUT_TOKENS;

      const safeMsgs = truncateMessages(msgs, maxInputBudget);
      const finalEstimatedInput = estimateTokenCount(safeMsgs);
      const maxTokens = safeMaxTokens(finalEstimatedInput, model);

      console.log(`[LLM] Model: ${model}, estimated input: ${finalEstimatedInput}, max_tokens: ${maxTokens}, context: ${contextLimit}`);

      if (typeof onToken === 'function') {
        let result = '';
        const stream = await client.chat.completions.create(
          { model, messages: safeMsgs, max_tokens: maxTokens, stream: true },
          { signal },
        );
        for await (const chunk of stream) {
          const txt = chunk.choices?.[0]?.delta?.content;
          if (txt) { result += txt; onToken(txt); }
        }
        return result;
      }

      const resp = await client.chat.completions.create(
        { model, messages: safeMsgs, max_tokens: maxTokens },
        { signal },
      );
      return resp.choices?.[0]?.message?.content ?? '';
    },
  });
}

openaiCompatible('openai');
openaiCompatible('deepseek', () => process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com');
openaiCompatible('openrouter', () => 'https://openrouter.ai/api/v1');

/* ── public helpers ──────────────────────────────────────────── */

export function getProviderClient(providerName, apiKey) {
  const p = providers[providerName];
  if (!p) throw new Error(`Unknown LLM provider: ${providerName}`);
  return p.createClient(apiKey);
}

/**
 * Unified call: provider-agnostic streaming / non-streaming LLM call.
 */
export async function callLLM(providerName, client, model, messages, opts = {}) {
  const p = providers[providerName];
  if (!p) throw new Error(`Unknown LLM provider: ${providerName}`);
  return p.callLLM(client, model, messages, opts);
}