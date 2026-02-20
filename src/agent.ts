import { Connection } from '@solana/web3.js';
import type {
  AgentConfig,
  AgentOutput,
  RegisteredTool,
  SessionMemory,
} from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import { McpBridge } from './mcp-bridge.js';
import { TrustGate } from './trust-gate.js';
import { Planner } from './planner.js';
import { Synthesizer } from './synthesizer.js';
import { Verifier } from './verifier.js';
import { Executor } from './executor.js';
import {
  createSessionMemory,
  addUserMessage,
  addAssistantMessage,
  trimHistory,
} from './memory.js';

export class OraculoAgent {
  private config: AgentConfig;
  private mcpBridge: McpBridge;
  private trustGate: TrustGate;
  private planner: Planner;
  private synthesizer: Synthesizer;
  private verifier: Verifier;
  private executor: Executor;
  private memory: SessionMemory;
  private tools: RegisteredTool[] = [];
  private initialized = false;

  /** The user's wallet address, used as trust origin */
  originWallet: string | null = null;

  constructor(config: Partial<AgentConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.mcpBridge = new McpBridge(this.config.mcpServerPath);

    const connection = new Connection(this.config.solanaRpcUrl);
    this.trustGate = new TrustGate(connection);

    this.planner = new Planner(this.config);
    this.synthesizer = new Synthesizer(this.mcpBridge, this.trustGate, this.config);
    this.verifier = new Verifier(this.trustGate, this.config);
    this.executor = new Executor(this.config);
    this.memory = createSessionMemory();
  }

  /** Connect to MCP server and discover tools */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.config.mcpServerPath) {
      await this.mcpBridge.connect();
      this.tools = this.mcpBridge.getTools();
    }

    this.initialized = true;
  }

  /** Run the 4-phase loop for a user message */
  async run(userMessage: string): Promise<AgentOutput> {
    if (!this.initialized) {
      await this.initialize();
    }

    addUserMessage(this.memory, userMessage);

    let currentMessage = userMessage;
    let iterations = 0;

    while (iterations < this.config.maxIterations) {
      iterations++;

      // Phase 1: Plan
      const plan = await this.planner.plan(currentMessage, this.tools, this.memory);

      // If direct response (no tools needed), return immediately
      if (plan.directResponse) {
        const output: AgentOutput = {
          type: 'response',
          content: plan.directResponse,
          trustAnnotations: [],
        };
        addAssistantMessage(this.memory, plan.directResponse);
        trimHistory(this.memory);
        return output;
      }

      // Phase 2: Synthesize (execute tools)
      const synthesis = await this.synthesizer.synthesize(plan, this.memory);

      // Phase 3: Verify (trust-gate results)
      const verification = await this.verifier.verify(
        plan,
        synthesis,
        this.originWallet,
        this.memory,
      );

      // Phase 4: Execute (produce output)
      const output = await this.executor.execute(
        userMessage,
        synthesis,
        verification,
        this.memory,
      );

      // If follow_up, iterate with the new plan
      if (output.type === 'follow_up') {
        currentMessage = `Follow-up: ${output.content}`;
        continue;
      }

      // Store response in memory
      const responseText = output.type === 'response'
        ? output.content
        : output.description;
      addAssistantMessage(this.memory, responseText);
      trimHistory(this.memory);

      return output;
    }

    // Max iterations reached
    return {
      type: 'response',
      content: 'I was unable to fully verify all the data within the iteration limit. Here is what I found so far — please treat unverified data with caution.',
      trustAnnotations: [],
    };
  }

  /** Clean shutdown */
  async shutdown(): Promise<void> {
    await this.mcpBridge.disconnect();
    this.initialized = false;
  }

  /** Get discovered tools (for inspection/debugging) */
  getRegisteredTools(): RegisteredTool[] {
    return this.tools;
  }

  /** Get session memory (for inspection/debugging) */
  getMemory(): SessionMemory {
    return this.memory;
  }
}
