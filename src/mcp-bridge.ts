import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type Anthropic from '@anthropic-ai/sdk';
import type { RegisteredTool } from './types.js';

export class McpBridge {
  private client: Client;
  private transport: StdioClientTransport | null = null;
  private tools: RegisteredTool[] = [];
  private serverPath: string;

  constructor(serverPath: string) {
    this.serverPath = serverPath;
    this.client = new Client(
      { name: 'oraculo-agent', version: '0.1.0' },
      { capabilities: {} },
    );
  }

  /** Spawn the Veil MCP server and discover tools */
  async connect(): Promise<void> {
    this.transport = new StdioClientTransport({
      command: 'node',
      args: [this.serverPath],
    });

    await this.client.connect(this.transport);

    const { tools } = await this.client.listTools();

    this.tools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema as Record<string, unknown>,
      source: 'mcp' as const,
    }));
  }

  /** Call an MCP tool by name */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.client.callTool({ name, arguments: args });

    // MCP tool results come as content array; extract text content
    if (Array.isArray(result.content)) {
      const textParts = result.content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map((c) => c.text);

      const joined = textParts.join('\n');

      // Try to parse as JSON
      try {
        return JSON.parse(joined);
      } catch {
        return joined;
      }
    }

    return result.content;
  }

  /** Return discovered tools as RegisteredTool[] */
  getTools(): RegisteredTool[] {
    return this.tools;
  }

  /** Convert RegisteredTool to Anthropic Tool format */
  static toAnthropicTools(tools: RegisteredTool[]): Anthropic.Tool[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object' as const,
        ...t.inputSchema,
      },
    }));
  }

  /** Clean shutdown */
  async disconnect(): Promise<void> {
    await this.transport?.close();
    this.transport = null;
    this.tools = [];
  }
}
