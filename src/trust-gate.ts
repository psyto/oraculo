import { PublicKey, Connection } from '@solana/web3.js';
import {
  createTrustEngine,
  TrustConfidence,
  type TrustDimension,
  type TrustPropagationEngine,
  type SovereignScores,
  readSovereignScores,
} from '@lattice/sdk';
import type {
  StepVerification,
  PresentationAction,
  SessionMemory,
} from './types.js';
import { getCachedTrust, cacheTrust, getCachedSovereign, cacheSovereign } from './memory.js';

export class TrustGate {
  private engine: TrustPropagationEngine;
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
    const { engine } = createTrustEngine(connection);
    this.engine = engine;
  }

  /** Assess trust between origin and target wallet, with session caching */
  async assessWallet(
    origin: string,
    target: string,
    dimension: TrustDimension,
    stepId: string,
    memory: SessionMemory,
  ): Promise<StepVerification> {
    // Check cache first
    const cached = getCachedTrust(memory, origin, target, String(dimension));
    if (cached) {
      return { ...cached, stepId };
    }

    const originKey = new PublicKey(origin);
    const targetKey = new PublicKey(target);

    const assessment = await this.engine.assess(originKey, targetKey, dimension);

    const action = mapConfidenceToAction(assessment.confidence);

    const verification: StepVerification = {
      stepId,
      action,
      confidence: assessment.confidence,
      trustWeight: assessment.trustWeight,
      path: assessment.path.map((p: PublicKey) => p.toBase58()),
      caveat: buildCaveat(assessment.confidence, assessment.trustWeight, assessment.depth),
    };

    // Cache result
    cacheTrust(memory, origin, target, String(dimension), verification);

    return verification;
  }

  /** Read SOVEREIGN scores for a wallet, with caching */
  async getSovereignScores(
    wallet: string,
    memory: SessionMemory,
  ): Promise<{ scores: Record<string, number>; tier: number }> {
    const cached = getCachedSovereign(memory, wallet);
    if (cached) {
      return { scores: cached.scores, tier: cached.tier };
    }

    const walletKey = new PublicKey(wallet);
    const sovereign = await readSovereignScores(this.connection, walletKey);

    if (!sovereign) {
      return { scores: {}, tier: 0 };
    }

    const scores: Record<string, number> = {
      trading: sovereign.trading,
      civic: sovereign.civic,
      developer: sovereign.developer,
      infra: sovereign.infra,
      creator: sovereign.creator,
    };

    const tier = sovereign.tier;
    cacheSovereign(memory, wallet, scores, tier);

    return { scores, tier };
  }
}

function mapConfidenceToAction(confidence: TrustConfidence): PresentationAction {
  switch (confidence) {
    case TrustConfidence.High:
      return 'present';
    case TrustConfidence.Medium:
      return 'present_with_caveat';
    case TrustConfidence.Low:
      return 'warn';
    case TrustConfidence.None:
      return 'omit';
    default:
      return 'omit';
  }
}

function buildCaveat(
  confidence: TrustConfidence,
  trustWeight: number,
  depth: number,
): string | null {
  switch (confidence) {
    case TrustConfidence.High:
      return null;
    case TrustConfidence.Medium:
      return `Trust path found (${depth} hops, weight ${trustWeight.toFixed(2)}). Results may need independent verification.`;
    case TrustConfidence.Low:
      return `Weak trust path (${depth} hops, weight ${trustWeight.toFixed(2)}). Treat this data with caution.`;
    case TrustConfidence.None:
      return `No trust path found. This data cannot be verified and has been omitted.`;
    default:
      return null;
  }
}
