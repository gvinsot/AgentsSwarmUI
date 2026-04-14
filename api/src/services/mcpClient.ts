import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

/**
 * Low-level MCP client wrapping the official SDK.
 * Handles connect (Streamable HTTP with SSE fallback), tool discovery, and tool calls.
 */
export class MCPClient {
  clientName: string;
  client: Client | null;
  transport: StreamableHTTPClientTransport | SSEClientTransport | null;
  tools: any[];

  constructor(name: string = 'PulsarTeam') {
    this.clientName = name;
    this.client = null;
    this.transport = null;
    this.tools = [];
  }

  /**
   * Connect to an MCP server. Tries Streamable HTTP first, falls back to SSE.
   * @param {string} url — MCP server endpoint (e.g. http://host:8000/ai/mcp)
   * @param {object} [options]
   * @param {Record<string,string>} [options.headers] — extra HTTP headers (e.g. Authorization)
   * @returns {{ serverInfo, tools[] }}
   */
  async connect(url: string, { headers }: { headers?: Record<string, string> } = {}): Promise<{ tools: any[] }> {
    await this.close();

    const parsedUrl = new URL(url);
    const requestInit = headers ? { headers } : undefined;

    // Try Streamable HTTP transport first
    try {
      this.transport = new StreamableHTTPClientTransport(parsedUrl, { requestInit });
      this.client = new Client({ name: this.clientName, version: '1.0.0' });
      await this.client.connect(this.transport);
      console.log(`🔌 [MCP] Connected via Streamable HTTP to ${url}`);
    } catch (err) {
      // Fallback to SSE transport for older servers
      console.log(`🔌 [MCP] Streamable HTTP failed for ${url}, trying SSE fallback...`);
      try {
        await this.close();
        this.transport = new SSEClientTransport(parsedUrl, { requestInit, eventSourceInit: { fetch: (u: any, init: any) => fetch(u, { ...init, ...requestInit }) } });
        this.client = new Client({ name: this.clientName, version: '1.0.0' });
        await this.client.connect(this.transport);
        console.log(`🔌 [MCP] Connected via SSE to ${url}`);
      } catch (sseErr: any) {
        await this.close();
        throw new Error(`Failed to connect to MCP server at ${url}: ${sseErr.message}`);
      }
    }

    // Discover tools
    this.tools = await this.listTools();
    return {
      tools: this.tools
    };
  }

  /**
   * List all tools from the connected server (handles pagination).
   */
  async listTools(): Promise<any[]> {
    if (!this.client) throw new Error('Not connected');

    const allTools: any[] = [];
    let cursor: string | undefined;
    do {
      const result = await this.client.listTools(cursor ? { cursor } : {});
      allTools.push(...(result.tools || []));
      cursor = result.nextCursor;
    } while (cursor);

    return allTools;
  }

  /**
   * Call a tool on the connected server.
   * @param {string} name — tool name
   * @param {object} args — tool arguments
   * @returns {{ content: Array, isError: boolean }}
   */
  async callTool(name: string, args: Record<string, any> = {}): Promise<{ content: any[]; isError: boolean }> {
    if (!this.client) throw new Error('Not connected');

    const result = await this.client.callTool({ name, arguments: args });
    return {
      content: (result.content as any[]) || [],
      isError: (result.isError as boolean) || false
    };
  }

  /**
   * Close the connection and clean up.
   */
  async close(): Promise<void> {
    try {
      if (this.transport && typeof (this.transport as any).terminateSession === 'function') {
        await (this.transport as any).terminateSession().catch(() => {});
      }
      if (this.client) {
        await this.client.close().catch(() => {});
      }
    } catch {
      // Ignore cleanup errors
    }
    this.client = null;
    this.transport = null;
    this.tools = [];
  }

  get isConnected(): boolean {
    return this.client !== null;
  }
}
