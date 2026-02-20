import type Anthropic from '@anthropic-ai/sdk';
import type {
  SessionMemory,
  StepVerification,
  TrustCacheEntry,
  SovereignCacheEntry,
  ToolHistoryEntry,
} from './types.js';
import { TRUST_CACHE_TTL_MS, MAX_HISTORY_MESSAGES } from './types.js';

export function createSessionMemory(): SessionMemory {
  return {
    messages: [],
    trustCache: new Map(),
    sovereignCache: new Map(),
    toolHistory: [],
  };
}

export function addUserMessage(
  memory: SessionMemory,
  content: string,
): void {
  memory.messages.push({ role: 'user', content });
}

export function addAssistantMessage(
  memory: SessionMemory,
  content: string,
): void {
  memory.messages.push({ role: 'assistant', content });
}

export function addToolResults(
  memory: SessionMemory,
  toolUseId: string,
  toolName: string,
  input: Record<string, unknown>,
  output: unknown,
): void {
  memory.toolHistory.push({
    toolName,
    input,
    output,
    timestamp: Date.now(),
  });

  // Add as assistant tool_use + user tool_result pair for Anthropic message format
  memory.messages.push({
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: toolUseId,
        name: toolName,
        input,
      },
    ],
  });

  memory.messages.push({
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: typeof output === 'string' ? output : JSON.stringify(output),
      },
    ],
  });
}

/** Build a trust cache key from origin + target + dimension */
function trustCacheKey(origin: string, target: string, dimension: string): string {
  return `${origin}:${target}:${dimension}`;
}

export function getCachedTrust(
  memory: SessionMemory,
  origin: string,
  target: string,
  dimension: string,
): StepVerification | null {
  const key = trustCacheKey(origin, target, dimension);
  const entry = memory.trustCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memory.trustCache.delete(key);
    return null;
  }
  return entry.assessment;
}

export function cacheTrust(
  memory: SessionMemory,
  origin: string,
  target: string,
  dimension: string,
  assessment: StepVerification,
): void {
  const key = trustCacheKey(origin, target, dimension);
  memory.trustCache.set(key, {
    assessment,
    expiresAt: Date.now() + TRUST_CACHE_TTL_MS,
  });
}

export function getCachedSovereign(
  memory: SessionMemory,
  wallet: string,
): SovereignCacheEntry | null {
  const entry = memory.sovereignCache.get(wallet);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memory.sovereignCache.delete(wallet);
    return null;
  }
  return entry;
}

export function cacheSovereign(
  memory: SessionMemory,
  wallet: string,
  scores: Record<string, number>,
  tier: number,
): void {
  memory.sovereignCache.set(wallet, {
    scores,
    tier,
    expiresAt: Date.now() + TRUST_CACHE_TTL_MS,
  });
}

export function trimHistory(memory: SessionMemory): void {
  if (memory.messages.length <= MAX_HISTORY_MESSAGES) return;

  // Keep first message (system context) and last N messages
  const keep = MAX_HISTORY_MESSAGES - 2;
  const trimmed = memory.messages.slice(-keep);

  // Ensure first message is user role (Anthropic requirement)
  if (trimmed.length > 0 && trimmed[0].role !== 'user') {
    trimmed.shift();
  }

  memory.messages = trimmed;
}

export function getConversationMessages(
  memory: SessionMemory,
): Anthropic.MessageParam[] {
  return memory.messages;
}
