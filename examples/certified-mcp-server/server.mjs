#!/usr/bin/env node
/**
 * Reference "certified" MCP server (TRUS-1584).
 *
 * A minimal MCP server with a **protected** tool that only trusted agents may
 * call: before serving, it runs the calling agent through the TrustModel
 * reputation gate and refuses revoked / unrated / low-trust agents. This is the
 * demand-side loop made concrete — hand this to a design-partner server as the
 * "here's how you refuse untrusted agents" example.
 *
 * The caller declares its identity via the `agent` argument (its ANS name).
 * Cryptographic identity binding at the transport layer is the companion ticket
 * (stapled assertion, TRUS-1585); this example focuses on the gate decision.
 *
 * Run:  node server.mjs        (stdio MCP server)
 * Env:  MIN_SCORE (default 70), TRUSTMODEL_BASE_URL
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { gate } from "./gate.mjs";

const MIN_SCORE = Number(process.env.MIN_SCORE ?? 70);

const server = new McpServer({ name: "certified-example-mcp", version: "0.1.0" });

server.tool(
  "get_customer_record",
  "A protected tool. Only agents that pass the TrustModel reputation gate may call it — the " +
    "caller declares its ANS identity via `agent`, and the server refuses revoked / low-trust agents.",
  {
    agent: z.string().describe("The calling agent's ANS name (its identity)."),
    customer_id: z.string().describe("Customer record to fetch."),
  },
  async ({ agent, customer_id }) => {
    const decision = await gate(agent, { minScore: MIN_SCORE });

    if (decision.action !== "allow") {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                denied: true,
                action: decision.action,
                reason: decision.reason,
                agent,
                trust_score: decision.reputation.trust_score ?? null,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    // Agent cleared the gate — serve the (mock) protected data.
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              customer_id,
              record: { name: "Jane Doe", plan: "gold" },
              served_to: agent,
              trust_score: decision.reputation.trust_score,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
