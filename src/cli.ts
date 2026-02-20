#!/usr/bin/env node

import * as readline from 'node:readline';
import { OraculoAgent } from './agent.js';
import type { AgentOutput, TrustAnnotation } from './types.js';
import { TrustConfidence } from '@lattice/sdk';

const BANNER = `
╔═══════════════════════════════════════════╗
║  ORACULO — SPECTER v2 Personal AI Agent  ║
║  Trust-verified AI with Veil privacy      ║
╚═══════════════════════════════════════════╝
`;

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required');
    process.exit(1);
  }

  const mcpServerPath = process.env.VEIL_MCP_SERVER_PATH ?? '';
  const solanaRpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
  const originWallet = process.env.ORIGIN_WALLET ?? null;

  const agent = new OraculoAgent({
    anthropicApiKey: apiKey,
    mcpServerPath,
    solanaRpcUrl,
  });

  if (originWallet) {
    agent.originWallet = originWallet;
  }

  console.log(BANNER);

  // Check if running in pipe mode (non-interactive)
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const input = Buffer.concat(chunks).toString('utf-8').trim();
    if (input) {
      try {
        await agent.initialize();
        const output = await agent.run(input);
        printOutput(output);
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
      } finally {
        await agent.shutdown();
      }
    }
    return;
  }

  // Interactive REPL
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('Connecting to Veil MCP server...');

  try {
    await agent.initialize();
    const tools = agent.getRegisteredTools();
    console.log(`Connected. ${tools.length} tools available.\n`);
    console.log('Type your message (or "exit" to quit):\n');
  } catch (err) {
    console.error('Failed to connect:', err instanceof Error ? err.message : err);
    console.log('Running in limited mode (no MCP tools).\n');
  }

  const prompt = () => {
    rl.question('you > ', async (input) => {
      const trimmed = input.trim();

      if (!trimmed || trimmed === 'exit' || trimmed === 'quit') {
        console.log('\nShutting down...');
        await agent.shutdown();
        rl.close();
        return;
      }

      try {
        const output = await agent.run(trimmed);
        printOutput(output);
      } catch (err) {
        console.error('Error:', err instanceof Error ? err.message : err);
      }

      console.log();
      prompt();
    });
  };

  prompt();
}

function printOutput(output: AgentOutput): void {
  switch (output.type) {
    case 'response':
      console.log(`\noraculo > ${output.content}`);
      printAnnotations(output.trustAnnotations);
      break;

    case 'action':
      console.log(`\noraculo > [ACTION] ${output.description}`);
      console.log(`  Type: ${output.actionType}`);
      if (output.requiresConfirmation) {
        console.log('  ⚠ Requires confirmation before execution');
      }
      printAnnotations(output.trustAnnotations);
      break;

    case 'follow_up':
      console.log(`\noraculo > ${output.content}`);
      console.log(`  → Following up with ${output.nextPlan.steps.length} additional step(s)...`);
      break;
  }
}

function printAnnotations(annotations: TrustAnnotation[]): void {
  if (annotations.length === 0) return;

  console.log('\n  Trust:');
  for (const ann of annotations) {
    const icon = ann.confidence === TrustConfidence.High
      ? '✓'
      : ann.confidence === TrustConfidence.Medium
        ? '~'
        : ann.confidence === TrustConfidence.Low
          ? '!'
          : '✗';
    console.log(`    ${icon} ${ann.source}: ${ann.confidence}${ann.caveat ? ` — ${ann.caveat}` : ''}`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
