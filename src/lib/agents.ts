import Anthropic from "@anthropic-ai/sdk";
import { claudeRateLimiter } from "./rateLimiter";

const client = new Anthropic();

export interface AgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  tools?: Anthropic.Tool[];
  model?: string;
  maxTokens?: number;
}

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentResponse {
  content: string;
  toolCalls?: Anthropic.ContentBlock[];
  stopReason: string | null;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

// Default agents configuration
export const defaultAgents: Record<string, AgentConfig> = {
  general: {
    name: "General Assistant",
    description: "A helpful general-purpose assistant",
    systemPrompt:
      "You are a helpful assistant. Provide clear, accurate, and concise responses.",
    model: "claude-sonnet-4-20250514",
    maxTokens: 8096,
  },
  coder: {
    name: "Code Assistant",
    description: "Specialized in writing and reviewing code",
    systemPrompt:
      "You are an expert programmer. Help with coding tasks, debugging, and code review. Provide clean, well-documented code.",
    model: "claude-sonnet-4-20250514",
    maxTokens: 8096,
  },
  writer: {
    name: "Writing Assistant",
    description: "Specialized in creative and technical writing",
    systemPrompt:
      "You are a skilled writer. Help with creative writing, technical documentation, editing, and content creation.",
    model: "claude-sonnet-4-20250514",
    maxTokens: 8096,
  },
};

/**
 * Call a Claude agent with rate limiting.
 * 
 * All requests are routed through the rate limiter to ensure
 * we do not exceed 50 requests per minute (configurable via
 * CLAUDE_RATE_LIMIT_PER_MINUTE environment variable).
 */
export async function callAgent(
  agentConfig: AgentConfig,
  messages: AgentMessage[],
  onStream?: (text: string) => void
): Promise<AgentResponse> {
  const model = agentConfig.model || "claude-sonnet-4-20250514";
  const maxTokens = agentConfig.maxTokens || 8096;

  // Wrap the API call in the rate limiter to enforce request limits
  const response = await claudeRateLimiter.schedule(async () => {
    const status = claudeRateLimiter.getStatus();
    console.log(
      `[Agent:${agentConfig.name}] Making Claude API call. ` +
      `Rate limiter status: ${status.requestsInWindow}/${status.maxRequestsPerMinute} req/min, ` +
      `queue depth: ${status.queueDepth}`
    );

    if (onStream) {
      // Streaming response
      const stream = await client.messages.stream({
        model,
        max_tokens: maxTokens,
        system: agentConfig.systemPrompt,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        ...(agentConfig.tools && { tools: agentConfig.tools }),
      });

      let fullContent = "";

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          fullContent += event.delta.text;
          onStream(event.delta.text);
        }
      }

      const finalMessage = await stream.finalMessage();

      return {
        content: fullContent,
        toolCalls: finalMessage.content.filter(
          (block) => block.type === "tool_use"
        ),
        stopReason: finalMessage.stop_reason,
        usage: {
          inputTokens: finalMessage.usage.input_tokens,
          outputTokens: finalMessage.usage.output_tokens,
        },
      };
    } else {
      // Non-streaming response
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: agentConfig.systemPrompt,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        ...(agentConfig.tools && { tools: agentConfig.tools }),
      });

      const textContent = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n");

      return {
        content: textContent,
        toolCalls: response.content.filter((block) => block.type === "tool_use"),
        stopReason: response.stop_reason,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    }
  });

  return response;
}