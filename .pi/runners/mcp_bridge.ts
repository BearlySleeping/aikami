// .pi/runners/mcp_bridge.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

export type MCPBridgeConfig = {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
};

export type MCPToolDefinition = {
  name: string;
  description?: string;
  parameters: unknown;
};

/**
 * MCPBridge establishes a 1-to-1 local stdio connection with an external
 * Model Context Protocol server, exposing its tools to the Aikami agent swarm.
 */
export class MCPBridge {
  private _client: Client;
  private _transport: StdioClientTransport | null = null;
  private _isConnected = false;
  readonly name: string;

  constructor(config: MCPBridgeConfig) {
    this.name = config.name;
    this._client = new Client(
      { name: 'aikami-swarm-client', version: '1.0.0' },
      { capabilities: { sampling: { tools: {} } } },
    );

    // Store config for lazy connect
    this._config = config;
  }

  private readonly _config: MCPBridgeConfig;

  /**
   * Spawns the MCP server as a child process and establishes the JSON-RPC handshake.
   */
  async connect(): Promise<void> {
    if (this._isConnected) {
      return;
    }

    console.log(`[MCP Bridge] Spawning server process: ${this.name}...`);
    this._transport = new StdioClientTransport({
      command: this._config.command,
      args: this._config.args,
      env: this._sanitizeEnv(this._config.env),
    });

    try {
      await this._client.connect(this._transport);
      this._isConnected = true;
      const serverVersion = this._client.getServerVersion();
      console.log(
        `[MCP Bridge] Connected to ${this.name} (v${serverVersion?.version ?? 'unknown'})`,
      );
    } catch (error) {
      console.error(`[MCP Bridge] Handshake failure with ${this.name}:`, error);
      throw error;
    }
  }

  /**
   * Discovers and retrieves the structural JSON schemas for all available tools.
   */
  async getAvailableTools(): Promise<MCPToolDefinition[]> {
    this._ensureConnection();

    const toolsResult = await this._client.listTools();
    return toolsResult.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    }));
  }

  /**
   * Executes a specific tool on the connected MCP server and parses the response.
   */
  async executeTool(toolName: string, args: Record<string, unknown>): Promise<string> {
    this._ensureConnection();

    try {
      console.log(`[MCP Bridge] Executing tool: ${toolName}...`);
      const rawResult = await this._client.callTool(
        { name: toolName, arguments: args },
        CallToolResultSchema,
      );
      const result = rawResult as {
        isError?: boolean;
        content: Array<{ type: string; text?: string; resource?: { uri: string } }>;
      };

      if (result.isError) {
        throw new Error(`Tool execution error: ${JSON.stringify(result.content)}`);
      }

      const outputs: string[] = [];
      for (const content of result.content) {
        if (content.type === 'text') {
          outputs.push(content.text ?? '');
        } else if (content.type === 'resource') {
          outputs.push(`[Resource: ${content.resource?.uri ?? 'unknown'}]`);
        }
      }
      return outputs.join('\n');
    } catch (error) {
      console.error(`[MCP Bridge] Failed to execute ${toolName}:`, error);
      throw error;
    }
  }

  /**
   * Terminates the child process and cleans up IPC channels.
   */
  async disconnect(): Promise<void> {
    if (this._transport) {
      console.log(`[MCP Bridge] Terminating connection to ${this.name}...`);
      await this._transport.close();
      this._isConnected = false;
      this._transport = null;
    }
  }

  private _ensureConnection(): void {
    if (!this._isConnected) {
      throw new Error('MCP Client is not connected. Call .connect() first.');
    }
  }

  /**
   * Filters out undefined values from env objects to satisfy Record<string, string>.
   */
  private _sanitizeEnv(extra?: Record<string, string>): Record<string, string> {
    const base: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        base[key] = value;
      }
    }
    if (extra) {
      Object.assign(base, extra);
    }
    return base;
  }
}
