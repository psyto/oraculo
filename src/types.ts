import type { PublicKey } from '@solana/web3.js';
import type { TrustConfidence, TrustDimension } from '@lattice/sdk';
import type Anthropic from '@anthropic-ai/sdk';

// ── Agent Configuration ──────────────────────────────────────────────

export interface AgentConfig {
  anthropicApiKey: string;
  model: string;
  mcpServerPath: string;
  solanaRpcUrl: string;
  trustThresholds: TrustThresholds;
  maxIterations: number;
  maxTokens: number;
}

export interface TrustThresholds {
  /** Minimum confidence to present without caveat */
  present: TrustConfidence;
  /** Minimum confidence to present with caveat */
  presentWithCaveat: TrustConfidence;
  /** Below this, warn the user */
  warn: TrustConfidence;
}

// ── Plan (Phase 1 output) ────────────────────────────────────────────

export interface Plan {
  steps: PlanStep[];
  reasoning: string;
  /** If true, Claude responded directly without needing tools */
  directResponse: string | null;
}

export interface PlanStep {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  /** Step IDs this step depends on */
  dependsOn: string[];
  /** Whether this step's results need trust verification */
  requiresVerification: boolean;
}

// ── Synthesis (Phase 2 output) ───────────────────────────────────────

export interface SynthesisResult {
  stepResults: Map<string, StepResult>;
  aggregatedContext: string;
}

export interface StepResult {
  stepId: string;
  toolName: string;
  output: unknown;
  error: string | null;
  durationMs: number;
}

// ── Verification (Phase 3 output) ────────────────────────────────────

export interface VerificationResult {
  stepVerifications: Map<string, StepVerification>;
  overallPassed: boolean;
  caveats: string[];
  followUpPlan: Plan | null;
}

export interface StepVerification {
  stepId: string;
  action: PresentationAction;
  confidence: TrustConfidence;
  trustWeight: number;
  path: string[];
  caveat: string | null;
}

export type PresentationAction =
  | 'present'
  | 'present_with_caveat'
  | 'warn'
  | 'omit';

// ── Agent Output (Phase 4 output) ────────────────────────────────────

export type AgentOutput =
  | AgentResponseOutput
  | AgentActionOutput
  | AgentFollowUpOutput;

export interface AgentResponseOutput {
  type: 'response';
  content: string;
  trustAnnotations: TrustAnnotation[];
}

export interface AgentActionOutput {
  type: 'action';
  description: string;
  actionType: string;
  params: Record<string, unknown>;
  requiresConfirmation: boolean;
  trustAnnotations: TrustAnnotation[];
}

export interface AgentFollowUpOutput {
  type: 'follow_up';
  content: string;
  nextPlan: Plan;
}

export interface TrustAnnotation {
  source: string;
  confidence: TrustConfidence;
  caveat: string | null;
}

// ── Registered Tool ──────────────────────────────────────────────────

export interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  source: 'mcp' | 'lattice';
}

// ── Session Memory ───────────────────────────────────────────────────

export interface SessionMemory {
  messages: Anthropic.MessageParam[];
  trustCache: Map<string, TrustCacheEntry>;
  sovereignCache: Map<string, SovereignCacheEntry>;
  toolHistory: ToolHistoryEntry[];
}

export interface TrustCacheEntry {
  assessment: StepVerification;
  expiresAt: number;
}

export interface SovereignCacheEntry {
  scores: Record<string, number>;
  tier: number;
  expiresAt: number;
}

export interface ToolHistoryEntry {
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
  timestamp: number;
}

// ── Constants ────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: AgentConfig = {
  anthropicApiKey: '',
  model: 'claude-sonnet-4-5-20250929',
  mcpServerPath: '',
  solanaRpcUrl: 'https://api.mainnet-beta.solana.com',
  trustThresholds: {
    present: 'high' as TrustConfidence,
    presentWithCaveat: 'medium' as TrustConfidence,
    warn: 'low' as TrustConfidence,
  },
  maxIterations: 10,
  maxTokens: 4096,
};

/** Tools that involve identity/trust data and require verification */
export const VERIFICATION_REQUIRED_TOOLS = new Set([
  'sovereign_read',
  'trust_query',
  'trust_score',
  'lattice_query',
  'lattice_assess',
  'vault_read',
  'vault_disclose',
]);

/** Trust cache TTL: 5 minutes */
export const TRUST_CACHE_TTL_MS = 5 * 60 * 1000;

/** Max conversation messages before trimming */
export const MAX_HISTORY_MESSAGES = 50;
