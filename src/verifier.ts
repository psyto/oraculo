import Anthropic from '@anthropic-ai/sdk';
import type {
  SynthesisResult,
  VerificationResult,
  StepVerification,
  Plan,
  SessionMemory,
  AgentConfig,
} from './types.js';
import { VERIFICATION_REQUIRED_TOOLS } from './types.js';
import { TrustGate } from './trust-gate.js';
import { buildVerifierPrompt } from './prompts/verifier.js';
import type { TrustDimension } from '@lattice/sdk';
import { TrustConfidence } from '@lattice/sdk';

/** Regex to extract Solana wallet addresses (base58, 32-44 chars) */
const WALLET_REGEX = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

export class Verifier {
  private trustGate: TrustGate;
  private anthropic: Anthropic;
  private config: AgentConfig;

  constructor(trustGate: TrustGate, config: AgentConfig) {
    this.trustGate = trustGate;
    this.config = config;
    this.anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
  }

  async verify(
    plan: Plan,
    synthesis: SynthesisResult,
    originWallet: string | null,
    memory: SessionMemory,
  ): Promise<VerificationResult> {
    const stepVerifications = new Map<string, StepVerification>();
    const stepsNeedingVerification = plan.steps.filter(
      (step) => step.requiresVerification && VERIFICATION_REQUIRED_TOOLS.has(step.toolName),
    );

    // If no steps need verification, pass everything through
    if (stepsNeedingVerification.length === 0 || !originWallet) {
      return {
        stepVerifications,
        overallPassed: true,
        caveats: [],
        followUpPlan: null,
      };
    }

    // Verify each step that requires trust assessment
    for (const step of stepsNeedingVerification) {
      const stepResult = synthesis.stepResults.get(step.id);
      if (!stepResult || stepResult.error) continue;

      // Extract wallet addresses from step output
      const outputStr = typeof stepResult.output === 'string'
        ? stepResult.output
        : JSON.stringify(stepResult.output);

      const wallets = extractWallets(outputStr);

      // Assess trust for each wallet found in the output
      for (const wallet of wallets) {
        if (wallet === originWallet) continue;

        const verification = await this.trustGate.assessWallet(
          originWallet,
          wallet,
          (step.input.dimension as TrustDimension) ?? 0,
          step.id,
          memory,
        );

        stepVerifications.set(step.id, verification);
      }
    }

    // Check if any critical data was omitted
    const verifications = Array.from(stepVerifications.values());
    const hasOmitted = verifications.some((v) => v.action === 'omit');

    // Generate natural language caveats via Claude
    const caveats = await this.generateCaveats(synthesis.aggregatedContext, verifications);

    return {
      stepVerifications,
      overallPassed: !hasOmitted,
      caveats,
      followUpPlan: hasOmitted ? buildFollowUpPlan(verifications) : null,
    };
  }

  private async generateCaveats(
    aggregatedContext: string,
    verifications: StepVerification[],
  ): Promise<string[]> {
    if (verifications.length === 0) return [];

    // If all are high confidence, no caveats needed
    if (verifications.every((v) => v.confidence === TrustConfidence.High)) {
      return [];
    }

    const prompt = buildVerifierPrompt(aggregatedContext, verifications);

    const response = await this.anthropic.messages.create({
      model: this.config.model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as {
          caveats: string[];
          overallAssessment: string;
        };
        return parsed.caveats;
      } catch {
        // Fall back to using verification caveats directly
      }
    }

    return verifications
      .filter((v) => v.caveat !== null)
      .map((v) => v.caveat!);
  }
}

function extractWallets(text: string): string[] {
  const matches = text.match(WALLET_REGEX) ?? [];
  // Deduplicate
  return [...new Set(matches)];
}

function buildFollowUpPlan(verifications: StepVerification[]): Plan {
  const omitted = verifications.filter((v) => v.action === 'omit');

  return {
    steps: omitted.map((v, i) => ({
      id: `followup_${i}`,
      toolName: 'lattice_query',
      input: {
        origin: v.path[0] ?? '',
        dimension: 0,
        maxDepth: 6,
      },
      dependsOn: [],
      requiresVerification: true,
    })),
    reasoning: `Trust verification failed for ${omitted.length} step(s). Attempting deeper BFS traversal to find trust paths.`,
    directResponse: null,
  };
}
