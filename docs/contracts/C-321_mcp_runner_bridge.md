# Contract: C-321 - MCP (Model Context Protocol) Stdio Runner Bridge

## 1. Metadata
- **ID:** C-321
- **Title:** MCP Stdio Runner Bridge and Tool Execution Adapter
- **Status:** DRAFT
- **Author:** Aikami AI Collaborator
- **Target Stack:** Bun, TypeScript, @modelcontextprotocol/sdk, Child Process (stdio)

## 2. Context & Objectives
To prevent reinventing complex local developer tools (like AST parsers, local SQLite managers, and accessibility-tree visual testers), the `.pi` swarm architecture will integrate directly with the open-source Model Context Protocol (MCP) ecosystem. This contract implements a unified execution bridge in `.pi/runners/mcp_bridge.ts`. It leverages the official `@modelcontextprotocol/sdk` to spawn background MCP servers as child processes and communicates via JSON-RPC over `stdio`. This grants the internal `aikami-dev` agent swarm real-time, type-safe access to world-class local environment capabilities.

## 3. Architecture & Requirements

### 3.1 Targeted Output Layout
1. **The MCP Bridge Class:** A robust TypeScript adapter that abstracts process spawning, transport connection, capability negotiation, and tool-calling execution.
2. **Dynamic Spawning:** Support for both Node/Bun scripts (e.g., `npx tsx server.ts`) and natively compiled Rust binaries (e.g., `oxc-ast-mcp` or `biome`).
3. **Graceful Teardown:** Prevent zombie processes by strictly managing the lifecycle of the child `stdio` transport.

### 3.2 Security and Validation Constraints
- All data exchanges must happen via local `stdio` streams to guarantee strict 1-to-1 process isolation.
- Network or HTTP-based MCP transports should be explicitly disabled for local environment operations to prevent SSRF vulnerabilities.

---

## 4. Implementation Specification

### 4.1 Dependency Requirement
Before implementing, ensure the required SDK is installed in the `.pi/` environment.
```bash
cd .pi && bun add @modelcontextprotocol/sdk zod
```

### 4.2 Technical Source Implementation

```typescript
// .pi/runners/mcp_bridge.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface MCPBridgeConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface MCPToolDefinition {
  name: string;
  description?: string;
  parameters: any;
}

/**
 * MCPBridge establishes a 1-to-1 local stdio connection with an external
 * Model Context Protocol server, exposing its tools to the Aikami agent swarm.
 */
export class MCPBridge {
  private client: Client;
  private transport: StdioClientTransport | null = null;
  private isConnected: boolean = false;

  constructor(private config: MCPBridgeConfig) {
    // Initialize the official MCP client schema
    this.client = new Client(
      { name: "aikami-swarm-client", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );
  }

  /**
   * Spawns the MCP server as a child process and establishes the JSON-RPC handshake.
   */
  public async connect(): Promise<void> {
    if (this.isConnected) return;

    console.log(`[MCP Bridge] Spawning server process: ${this.config.name}...`);
    this.transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args,
      env: {
        ...process.env,
        ...this.config.env,
      }
    });

    try {
      await this.client.connect(this.transport);
      this.isConnected = true;
      const serverVersion = this.client.getServerVersion();
      console.log(`[MCP Bridge] Successfully connected to ${this.config.name} (v${serverVersion?.version || 'unknown'})`);
    } catch (error) {
      console.error(`[MCP Bridge] Handshake failure with ${this.config.name}:`, error);
      throw error;
    }
  }

  /**
   * Discovers and retrieves the structural JSON schemas for all available tools.
   */
  public async getAvailableTools(): Promise<MCPToolDefinition[]> {
    this.ensureConnection();

    const toolsResult = await this.client.listTools();
    return toolsResult.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    }));
  }

  /**
   * Executes a specific tool on the connected MCP server and parses the response.
   */
  public async executeTool(toolName: string, args: Record<string, any>): Promise<string> {
    this.ensureConnection();

    try {
      console.log(`[MCP Bridge] Executing tool: ${toolName}...`);
      const result: CallToolResult = await this.client.callTool({
        name: toolName,
        arguments: args,
      });

      if (result.isError) {
        throw new Error(`Tool execution error: ${JSON.stringify(result.content)}`);
      }

      // Parse and aggregate the returned content blocks
      const outputs: string[] = [];
      for (const content of result.content) {
        if (content.type === "text") {
          outputs.push(content.text);
        } else if (content.type === "resource") {
          outputs.push(`[Resource: ${content.resource.uri}]`);
        }
      }
      return outputs.join("\n");

    } catch (error) {
      console.error(`[MCP Bridge] Failed to execute ${toolName}:`, error);
      throw error;
    }
  }

  /**
   * Terminates the child process and cleans up IPC channels.
   */
  public async disconnect(): Promise<void> {
    if (this.transport) {
      console.log(`[MCP Bridge] Terminating connection to ${this.config.name}...`);
      await this.transport.close();
      this.isConnected = false;
      this.transport = null;
    }
  }

  private ensureConnection(): void {
    if (!this.isConnected) {
      throw new Error("MCP Client is not connected. Call .connect() first.");
    }
  }
}
```

### 4.3 Swarm Orchestration Integration

Modify `.pi/scripts/update_skills.ts` or the agent bootstrapper to map the `MCPBridge.executeTool` function into standard tools accessible by the Swarm Agents (e.g., injecting the Playwright or Biome capabilities as function calls into the `QA` and `Coder` prompts).

---

## 5. Verification Gate Criteria

### 5.1 Syntax & Compilation

- Run `cd .pi && bun add @modelcontextprotocol/sdk zod`.
- Execute a syntax check using `bun x biome check .pi/runners/mcp_bridge.ts`.

### 5.2 Local Transport Testing

- Create a test script that instantiates the `MCPBridge` class pointed to a lightweight local command (e.g., an `npx @modelcontextprotocol/server-everything` instance), calls `getAvailableTools()`, logs the output, and calls `disconnect()`.

---

## 6. Execution Command

`/contract docs/contracts/C-321_mcp_runner_bridge.md`
