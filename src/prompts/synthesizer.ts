export function buildSynthesizerPrompt(
  stepSummaries: Array<{ stepId: string; toolName: string; output: string; error: string | null }>,
): string {
  const results = stepSummaries
    .map((s) => {
      if (s.error) {
        return `[Step ${s.stepId} — ${s.toolName}] ERROR: ${s.error}`;
      }
      return `[Step ${s.stepId} — ${s.toolName}] ${s.output}`;
    })
    .join('\n\n');

  return `You are ORACULO in the SYNTHESIS phase. Multiple tools have been executed. Aggregate their results into a coherent context summary.

## Tool Results
${results}

## Instructions
1. Combine the tool outputs into a unified, coherent summary
2. Highlight key findings (scores, trust levels, encrypted data status)
3. Note any errors or missing data
4. Do NOT make trust judgments — that is the Verifier's job
5. Keep the summary factual and concise

Provide the aggregated context as a clear, structured summary.`;
}
