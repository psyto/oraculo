# ORACULO

Personal AI Agent for SPECTER v2 — an intelligent, trust-verified assistant that orchestrates privacy tools and trust verification on the Solana blockchain.

## Overview

ORACULO is an agentic AI system powered by Anthropic Claude that provides trust-aware responses by integrating with:

- **Veil MCP Server** — Privacy-preserving operations (encryption, identity, vault management)
- **LATTICE SDK** — Decentralized trust graph traversal and verification
- **Solana** — On-chain transaction execution with trust annotations

The agent operates through a 4-phase loop: **Plan → Synthesize → Verify → Execute**, ensuring every response carries trust confidence metadata.

## Architecture

```
User Query
    │
    ▼
┌─────────────────────────────────────────────┐
│  Phase 1: PLANNER                           │
│  Claude analyzes input, selects tools       │
│  (20+ Veil MCP tools + LATTICE queries)     │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│  Phase 2: SYNTHESIZER                       │
│  Executes plan steps with dependency-aware  │
│  parallelization, aggregates results        │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│  Phase 3: VERIFIER                          │
│  Trust-gates results via LATTICE engine     │
│  Confidence: High/Medium/Low/None           │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│  Phase 4: EXECUTOR                          │
│  Generates final response with trust        │
│  annotations and confidence metadata        │
└─────────────────────────────────────────────┘
```

## Project Structure

```
src/
├── agent.ts          # Main agent orchestrator (4-phase loop)
├── cli.ts            # Interactive REPL + pipe mode CLI
├── index.ts          # Public API exports
├── types.ts          # TypeScript interfaces & constants
├── mcp-bridge.ts     # MCP client for Veil privacy tools
├── trust-gate.ts     # Trust assessment engine (LATTICE)
├── planner.ts        # Phase 1: Tool selection planning
├── synthesizer.ts    # Phase 2: Tool execution & aggregation
├── verifier.ts       # Phase 3: Trust verification
├── executor.ts       # Phase 4: Final response generation
├── memory.ts         # Session state & caching
└── prompts/          # System prompts for each phase
```

## Features

- **Trust-Aware Responses** — Every response includes trust confidence levels (High/Medium/Low/None) with caveats
- **BFS Trust Graph Traversal** — Queries trust across 5 dimensions: Trading, Civic, Developer, Infra, Creator
- **Privacy-First** — Routes sensitive operations through Veil MCP for encryption, secret sharing, and ZK proofs
- **Session Memory** — Conversation history, trust assessment caching (5-min TTL), and tool execution tracking
- **Interactive + Pipe Mode** — Use as a REPL for real-time conversation or pipe mode for batch processing

## Prerequisites

- Node.js 18+
- Anthropic API key

## Setup

```bash
npm install
npm run build
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | — | Claude API authentication |
| `VEIL_MCP_SERVER_PATH` | No | — | Path to Veil MCP server executable |
| `SOLANA_RPC_URL` | No | `https://api.mainnet-beta.solana.com` | Solana RPC endpoint |
| `ORIGIN_WALLET` | No | — | Wallet address for trust origin |

## Usage

### Interactive Mode

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
npm start
```

### Pipe Mode

```bash
echo "What is my SOVEREIGN score?" | npm start
```

### Programmatic API

```typescript
import { createAgent } from '@oraculo/agent';

const agent = await createAgent({
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  mcpServerPath: process.env.VEIL_MCP_SERVER_PATH,
  originWallet: "your_wallet_address"
});

await agent.initialize();
const output = await agent.run("Who do I trust on the trading dimension?");
console.log(output);
await agent.shutdown();
```

## Dependencies

- `@anthropic-ai/sdk` — Claude AI reasoning engine
- `@modelcontextprotocol/sdk` — MCP client for Veil integration
- `@lattice/sdk` — Trust graph propagation (local dependency)
- `@solana/web3.js` — Solana blockchain interaction

## License

MIT
