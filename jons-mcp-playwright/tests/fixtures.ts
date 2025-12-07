/**
 * Test fixtures for jons-mcp-playwright
 */

import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { test as baseTest, expect as baseExpect } from '@playwright/test';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import type { Config } from '../config';
import type { Stream } from 'stream';
import type { IncomingMessage, ServerResponse } from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * Simple test HTTP server
 */
class SimpleTestServer {
  private server: http.Server;
  private routes: Map<string, RouteHandler> = new Map();
  public PREFIX: string;

  constructor(port: number) {
    this.PREFIX = `http://localhost:${port}`;
    this.server = http.createServer((req, res) => {
      const path = req.url || '/';
      const handler = this.routes.get(path);
      if (handler) {
        handler(req, res);
      } else {
        res.statusCode = 404;
        res.end('Not found');
      }
    });
  }

  static async create(port: number): Promise<SimpleTestServer> {
    const server = new SimpleTestServer(port);
    await new Promise<void>((resolve) => server.server.listen(port, resolve));
    return server;
  }

  setRoute(path: string, handler: RouteHandler): void {
    this.routes.set(path, handler);
  }

  reset(): void {
    this.routes.clear();
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

export type StartClient = (options?: {
  args?: string[];
  config?: Config;
}) => Promise<{ client: Client; stderr: () => string }>;

type TestFixtures = {
  client: Client;
  startClient: StartClient;
  server: SimpleTestServer;
};

type WorkerFixtures = {
  _workerServers: { server: SimpleTestServer };
};

export const test = baseTest.extend<TestFixtures, WorkerFixtures>({
  client: async ({ startClient }, use) => {
    const { client } = await startClient();
    await use(client);
  },

  startClient: async ({}, use, testInfo) => {
    const clients: Client[] = [];

    await use(async (options) => {
      const args: string[] = ['--playwright-headless'];
      if (process.env.CI && process.platform === 'linux') {
        args.push('--playwright-no-sandbox');
      }
      if (options?.args) {
        args.push(...options.args);
      }

      // Apply config options as CLI args
      if (options?.config) {
        if (options.config.includeDeveloperTools) {
          args.push('--include-developer-tools');
        }
        if (options.config.adblock !== undefined) {
          if (options.config.adblock === true) {
            args.push('--adblock');
          } else if (typeof options.config.adblock === 'string') {
            args.push(`--adblock=${options.config.adblock}`);
          }
        }
        if (options.config.adblockLists) {
          args.push(`--adblock-lists=${options.config.adblockLists}`);
        }
      }

      const client = new Client({ name: 'test', version: '1.0.0' });

      const transport = new StdioClientTransport({
        command: 'node',
        args: [path.join(__dirname, '../cli.js'), ...args],
        cwd: path.join(__dirname, '..'),
        stderr: 'pipe',
        env: {
          ...process.env,
          DEBUG: 'pw:mcp:test',
          DEBUG_COLORS: '0',
          DEBUG_HIDE_DATE: '1',
        },
      });

      let stderrBuffer = '';
      (transport.stderr as Stream)?.on('data', (data) => {
        if (process.env.PWMCP_DEBUG) {
          process.stderr.write(data);
        }
        stderrBuffer += data.toString();
      });

      clients.push(client);
      await client.connect(transport);
      await client.ping();
      return { client, stderr: () => stderrBuffer };
    });

    await Promise.all(clients.map((client) => client.close()));
  },

  _workerServers: [
    async ({}, use, workerInfo) => {
      const port = 9000 + workerInfo.workerIndex * 2;
      const server = await SimpleTestServer.create(port);
      await use({ server });
      await server.stop();
    },
    { scope: 'worker' },
  ],

  server: async ({ _workerServers }, use) => {
    _workerServers.server.reset();
    await use(_workerServers.server);
  },
});

export const expect = baseExpect.extend({
  toContainYaml(response: any, substring: string) {
    const text = response.content?.[0]?.text || '';
    const isNot = this.isNot;
    const pass = text.includes(substring);

    return {
      pass: isNot ? !pass : pass,
      message: () =>
        isNot
          ? `Expected response not to contain: ${substring}`
          : `Expected response to contain: ${substring}\n\nActual:\n${text}`,
    };
  },

  toHaveError(response: any) {
    const isNot = this.isNot;
    const pass = response.isError === true;

    return {
      pass: isNot ? !pass : pass,
      message: () =>
        isNot
          ? `Expected response not to be an error`
          : `Expected response to be an error\n\nActual: isError=${response.isError}`,
    };
  },
});

/**
 * Extract YAML from a response
 */
export function extractYaml(response: any): string | null {
  const text = response.content?.[0]?.text || '';
  const match = text.match(/```yaml\n([\s\S]*?)\n```/);
  return match ? match[1] : null;
}

/**
 * Count elements in YAML
 */
export function countYamlElements(yaml: string): number {
  return (yaml.match(/^- /gm) || []).length;
}
