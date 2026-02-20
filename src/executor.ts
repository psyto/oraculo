import Anthropic from '@anthropic-ai/sdk';
import type {
  AgentOutput,
  SynthesisResult,
  VerificationResult,
  TrustAnnotation,
  AgentConfig,
  SessionMemory,
} from './types.js';

export class Executor {
  private anthropic: Anthropic;
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
    this.anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
  }

  async execute(
    userMessage: string,
    synthesis: SynthesisResult,
    verification: VerificationResult,
    _memory: SessionMemory,
  ): Promise<AgentOutput> {
    // If verification failed and there's a follow-up plan, return follow_up
    if (!verification.overallPassed && verification.followUpPlan) {
      return {
        type: 'follow_up',
        content: `Some data could not be verified through the trust graph. ${verification.caveats.join(' ')}`,
        nextPlan: verification.followUpPlan,
      };
    }

    // Build trust annotations from verifications
    const trustAnnotations = buildTrustAnnotations(verification);

    // Generate final response via Claude
    const content = await this.generateResponse(
      userMessage,
      synthesis.aggregatedContext,
      verification.caveats,
      trustAnnotations,
    );

    // Detect if the response describes an action
    if (isActionResponse(content)) {
      return {
        type: 'action',
        description: content,
        actionType: 'on_chain',
        params: {},
        requiresConfirmation: true,
        trustAnnotations,
      };
    }

    return {
      type: 'response',
      content,
      trustAnnotations,
    };
  }

  private async generateResponse(
    userMessage: string,
    aggregatedContext: string,
    caveats: string[],
    trustAnnotations: TrustAnnotation[],
  ): Promise<string> {
    const caveatSection = caveats.length > 0
      ? `\n\n## Trust Caveats\n${caveats.map((c) => `- ${c}`).join('\n')}`
      : '';

    const annotationSection = trustAnnotations.length > 0
      ? `\n\n## Trust Annotations\n${trustAnnotations.map((a) => `- ${a.source}: ${a.confidence}${a.caveat ? ` (${a.caveat})` : ''}`).join('\n')}`
      : '';

    const prompt = `You are ORACULO in the EXECUTION phase. Generate a final response for the user.

## User's Original Question
${userMessage}

## Aggregated Context (from tool results)
${aggregatedContext}
${caveatSection}
${annotationSection}

## Instructions
1. Answer the user's question using the aggregated context
2. Include any trust caveats naturally in your response
3. If data was flagged with warnings, clearly communicate the trust implications
4. Be helpful, concise, and transparent about data provenance
5. Do NOT reveal internal tool names or implementation details`;

    const response = await this.anthropic.messages.create({
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
  }
}

function buildTrustAnnotations(verification: VerificationResult): TrustAnnotation[] {
  return Array.from(verification.stepVerifications.values()).map((v) => ({
    source: v.stepId,
    confidence: v.confidence,
    caveat: v.caveat,
  }));
}

function isActionResponse(content: string): boolean {
  const actionKeywords = [
    'execute transaction',
    'submit transaction',
    'sign and send',
    'confirm to proceed',
    'on-chain action',
  ];
  const lower = content.toLowerCase();
  return actionKeywords.some((kw) => lower.includes(kw));
}
