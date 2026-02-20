import type { StepVerification } from '../types.js';

export function buildVerifierPrompt(
  aggregatedContext: string,
  verifications: StepVerification[],
): string {
  const trustSummary = verifications
    .map((v) => {
      const status = v.action === 'present'
        ? 'TRUSTED'
        : v.action === 'present_with_caveat'
          ? 'CAVEAT'
          : v.action === 'warn'
            ? 'WARNING'
            : 'OMITTED';

      return `[Step ${v.stepId}] ${status} — confidence: ${v.confidence}, weight: ${v.trustWeight.toFixed(2)}, path depth: ${v.path.length}${v.caveat ? `, caveat: ${v.caveat}` : ''}`;
    })
    .join('\n');

  return `You are ORACULO in the VERIFICATION phase. Review the aggregated context alongside trust assessments and produce trust-aware caveats.

## Aggregated Context
${aggregatedContext}

## Trust Assessments
${trustSummary}

## Instructions
1. For each CAVEAT or WARNING step, generate a natural language caveat explaining the trust implications
2. For OMITTED steps, note that data was excluded due to insufficient trust
3. Consider the overall trustworthiness of the information
4. Produce a list of caveats (if any) that should be shown to the user
5. If critical data was omitted, suggest what the user could do to establish trust

Respond with a JSON object:
{
  "caveats": ["caveat1", "caveat2"],
  "overallAssessment": "brief overall trust assessment"
}`;
}
