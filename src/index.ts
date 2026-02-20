import { OraculoAgent } from './agent.js';

export { OraculoAgent };

export type {
  AgentConfig,
  AgentOutput,
  AgentResponseOutput,
  AgentActionOutput,
  AgentFollowUpOutput,
  Plan,
  PlanStep,
  SynthesisResult,
  StepResult,
  VerificationResult,
  StepVerification,
  PresentationAction,
  TrustAnnotation,
  RegisteredTool,
  SessionMemory,
  TrustThresholds,
} from './types.js';

export { DEFAULT_CONFIG } from './types.js';

export { McpBridge } from './mcp-bridge.js';
export { TrustGate } from './trust-gate.js';
export { Planner } from './planner.js';
export { Synthesizer } from './synthesizer.js';
export { Verifier } from './verifier.js';
export { Executor } from './executor.js';
export { createSessionMemory } from './memory.js';

/** Factory function for quick agent creation */
export function createAgent(config: {
  anthropicApiKey: string;
  mcpServerPath: string;
  solanaRpcUrl?: string;
  originWallet?: string;
}): OraculoAgent {
  const agent = new OraculoAgent({
    anthropicApiKey: config.anthropicApiKey,
    mcpServerPath: config.mcpServerPath,
    solanaRpcUrl: config.solanaRpcUrl,
  });

  if (config.originWallet) {
    agent.originWallet = config.originWallet;
  }

  return agent;
}
