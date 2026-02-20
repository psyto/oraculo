import Anthropic from '@anthropic-ai/sdk';
import type { Plan, PlanStep, RegisteredTool, SessionMemory, AgentConfig } from './types.js';
import { VERIFICATION_REQUIRED_TOOLS } from './types.js';
import { PLANNER_SYSTEM_PROMPT } from './prompts/planner.js';
import { getConversationMessages } from './memory.js';
import { McpBridge } from './mcp-bridge.js';

/** Synthetic LATTICE tools exposed to the planner alongside MCP tools */
const LATTICE_SYNTHETIC_TOOLS: RegisteredTool[] = [
  {
    name: 'lattice_query',
    description:
      'BFS trust propagation from an origin wallet. Returns ranked trusted nodes within the trust graph for a given dimension.',
    inputSchema: {
      type: 'object',
      properties: {
        origin: { type: 'string', description: 'Origin wallet address (base58)' },
        dimension: {
          type: 'number',
          description: 'Trust dimension: 0=Trading, 1=Civic, 2=Developer, 3=Infra, 4=Creator',
        },
        maxDepth: { type: 'number', description: 'Max BFS depth (default 3, max 6)' },
        minScore: { type: 'number', description: 'Minimum SOVEREIGN score filter (0-10000)' },
      },
      required: ['origin', 'dimension'],
    },
    source: 'lattice',
  },
  {
    name: 'lattice_assess',
    description:
      'Assess trust between two wallets on a specific dimension. Returns confidence level (high/medium/low/none), trust weight, and shortest path.',
    inputSchema: {
      type: 'object',
      properties: {
        origin: { type: 'string', description: 'Origin wallet address (base58)' },
        target: { type: 'string', description: 'Target wallet address (base58)' },
        dimension: {
          type: 'number',
          description: 'Trust dimension: 0=Trading, 1=Civic, 2=Developer, 3=Infra, 4=Creator',
        },
      },
      required: ['origin', 'target', 'dimension'],
    },
    source: 'lattice',
  },
];

export class Planner {
  private anthropic: Anthropic;
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
    this.anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
  }

  async plan(
    userMessage: string,
    tools: RegisteredTool[],
    memory: SessionMemory,
  ): Promise<Plan> {
    const allTools = [...tools, ...LATTICE_SYNTHETIC_TOOLS];
    const anthropicTools = McpBridge.toAnthropicTools(allTools);

    const messages = getConversationMessages(memory);

    const response = await this.anthropic.messages.create({
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      system: PLANNER_SYSTEM_PROMPT,
      tools: anthropicTools,
      messages: [
        ...messages,
        { role: 'user', content: userMessage },
      ],
    });

    // If Claude responded with text only (no tool use), return direct response
    if (response.stop_reason === 'end_turn') {
      const textContent = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n');

      return {
        steps: [],
        reasoning: 'Direct response — no tools needed.',
        directResponse: textContent,
      };
    }

    // Extract tool_use blocks as plan steps (dry-run — no execution)
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    const textBlocks = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    const steps: PlanStep[] = toolUseBlocks.map((block, index) => ({
      id: `step_${index}`,
      toolName: block.name,
      input: block.input as Record<string, unknown>,
      dependsOn: inferDependencies(block, toolUseBlocks, index),
      requiresVerification: VERIFICATION_REQUIRED_TOOLS.has(block.name),
    }));

    return {
      steps,
      reasoning: textBlocks || 'Plan generated from tool selections.',
      directResponse: null,
    };
  }
}

/** Infer step dependencies based on tool ordering and data flow */
function inferDependencies(
  _current: Anthropic.ToolUseBlock,
  allBlocks: Anthropic.ToolUseBlock[],
  currentIndex: number,
): string[] {
  const deps: string[] = [];

  // Simple heuristic: if a later tool references data that an earlier tool produces,
  // mark it as dependent. For now, trust/verify tools depend on identity reads.
  const identityTools = new Set(['sovereign_read', 'trust_query', 'trust_score']);
  const dependentTools = new Set(['lattice_assess', 'lattice_query', 'vault_disclose']);

  if (dependentTools.has(_current.name)) {
    for (let i = 0; i < currentIndex; i++) {
      if (identityTools.has(allBlocks[i].name)) {
        deps.push(`step_${i}`);
      }
    }
  }

  return deps;
}
