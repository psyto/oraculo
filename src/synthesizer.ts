import Anthropic from '@anthropic-ai/sdk';
import { PublicKey, Connection } from '@solana/web3.js';
import {
  createTrustEngine,
  type TrustDimension,
  type TrustNode,
} from '@lattice/sdk';
import type {
  Plan,
  PlanStep,
  SynthesisResult,
  StepResult,
  SessionMemory,
  AgentConfig,
} from './types.js';
import { McpBridge } from './mcp-bridge.js';
import { TrustGate } from './trust-gate.js';
import { buildSynthesizerPrompt } from './prompts/synthesizer.js';

export class Synthesizer {
  private mcpBridge: McpBridge;
  private trustGate: TrustGate;
  private anthropic: Anthropic;
  private config: AgentConfig;

  constructor(
    mcpBridge: McpBridge,
    trustGate: TrustGate,
    config: AgentConfig,
  ) {
    this.mcpBridge = mcpBridge;
    this.trustGate = trustGate;
    this.config = config;
    this.anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
  }

  async synthesize(plan: Plan, memory: SessionMemory): Promise<SynthesisResult> {
    const stepResults = new Map<string, StepResult>();

    // Group steps by dependency level for parallel execution
    const levels = buildExecutionLevels(plan.steps);

    for (const level of levels) {
      const results = await Promise.all(
        level.map((step) => this.executeStep(step, stepResults, memory)),
      );

      for (const result of results) {
        stepResults.set(result.stepId, result);
      }
    }

    // Aggregate results using Claude
    const aggregatedContext = await this.aggregate(stepResults);

    return { stepResults, aggregatedContext };
  }

  private async executeStep(
    step: PlanStep,
    _priorResults: Map<string, StepResult>,
    memory: SessionMemory,
  ): Promise<StepResult> {
    const start = Date.now();

    try {
      let output: unknown;

      if (step.toolName === 'lattice_query') {
        output = await this.executeLatticeQuery(step);
      } else if (step.toolName === 'lattice_assess') {
        output = await this.executeLatticeAssess(step, memory);
      } else {
        // Route to MCP bridge
        output = await this.mcpBridge.callTool(step.toolName, step.input);
      }

      return {
        stepId: step.id,
        toolName: step.toolName,
        output,
        error: null,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        stepId: step.id,
        toolName: step.toolName,
        output: null,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  private async executeLatticeQuery(step: PlanStep): Promise<unknown> {
    const { origin, dimension, maxDepth, minScore } = step.input as {
      origin: string;
      dimension: number;
      maxDepth?: number;
      minScore?: number;
    };

    const connection = new Connection(this.config.solanaRpcUrl);
    const { engine } = createTrustEngine(connection, {
      ...(maxDepth !== undefined && { maxDepth }),
      ...(minScore !== undefined && { minScore }),
    });

    const originKey = new PublicKey(origin);
    const result = await engine.query(originKey, dimension as TrustDimension);

    return {
      nodes: result.nodes.map((n: TrustNode) => ({
        wallet: n.wallet.toBase58(),
        trustWeight: n.trustWeight,
        dimensionScore: n.dimensionScore,
        depth: n.depth,
      })),
      totalDiscovered: result.totalDiscovered,
      maxDepthReached: result.maxDepthReached,
      durationMs: result.durationMs,
    };
  }

  private async executeLatticeAssess(
    step: PlanStep,
    memory: SessionMemory,
  ): Promise<unknown> {
    const { origin, target, dimension } = step.input as {
      origin: string;
      target: string;
      dimension: number;
    };

    const verification = await this.trustGate.assessWallet(
      origin,
      target,
      dimension as TrustDimension,
      step.id,
      memory,
    );

    return {
      confidence: verification.confidence,
      trustWeight: verification.trustWeight,
      path: verification.path,
      action: verification.action,
      caveat: verification.caveat,
    };
  }

  private async aggregate(stepResults: Map<string, StepResult>): Promise<string> {
    const summaries = Array.from(stepResults.values()).map((r) => ({
      stepId: r.stepId,
      toolName: r.toolName,
      output: r.error ? '' : (typeof r.output === 'string' ? r.output : JSON.stringify(r.output)),
      error: r.error,
    }));

    // If only one step and no errors, skip Claude aggregation
    if (summaries.length === 1 && !summaries[0].error) {
      return summaries[0].output;
    }

    const prompt = buildSynthesizerPrompt(summaries);

    const response = await this.anthropic.messages.create({
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    return text;
  }
}

/** Build execution levels from step dependencies for parallel execution */
function buildExecutionLevels(steps: PlanStep[]): PlanStep[][] {
  if (steps.length === 0) return [];

  const levels: PlanStep[][] = [];
  const completed = new Set<string>();

  let remaining = [...steps];

  while (remaining.length > 0) {
    const level: PlanStep[] = [];
    const stillRemaining: PlanStep[] = [];

    for (const step of remaining) {
      const depsResolved = step.dependsOn.every((dep) => completed.has(dep));
      if (depsResolved) {
        level.push(step);
      } else {
        stillRemaining.push(step);
      }
    }

    // Safety: if no progress, break to avoid infinite loop
    if (level.length === 0) {
      levels.push(stillRemaining);
      break;
    }

    levels.push(level);
    for (const step of level) {
      completed.add(step.id);
    }

    remaining = stillRemaining;
  }

  return levels;
}
