/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { URL } from 'url';
import { Config } from '@google/gemini-cli-core';

export interface WebApiServerOptions {
  port?: number;
  onMessage?: (message: string) => void;
  config?: Config;
}

export class WebApiServer {
  private server: Server | null = null;
  private port: number;
  private onMessage?: (message: string) => void;
  private config?: Config;

  constructor(options: WebApiServerOptions = {}) {
    this.port = options.port || 3001;
    this.onMessage = options.onMessage;
    this.config = options.config;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (err) => {
        if ((err as any).code === 'EADDRINUSE') {
          // Try next port if current one is in use
          this.port++;
          this.server?.listen(this.port);
        } else {
          reject(err);
        }
      });

      this.server.listen(this.port, () => {
        console.log(`\n🌐 Web API server started on http://localhost:${this.port}`);
        console.log(`📡 Send messages via: http://localhost:${this.port}/?msg="your message here"`);
        resolve();
      });
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (!req.url) {
      this.sendResponse(res, 400, { error: 'Invalid request' });
      return;
    }

    try {
      const url = new URL(req.url, `http://localhost:${this.port}`);
      const pathname = url.pathname;

      if (pathname === '/') {
        const msg = url.searchParams.get('msg');
        
        if (!msg) {
          this.sendResponse(res, 400, { 
            error: 'Missing msg parameter', 
            usage: 'Use /?msg="your message here"',
            example: `http://localhost:${this.port}/?msg="hello"`
          });
          return;
        }

        // Inject the message into the interactive session
        if (this.onMessage) {
          this.onMessage(msg);
          this.sendResponse(res, 200, { 
            success: true, 
            message: `Message "${msg}" sent to interactive session`,
            timestamp: new Date().toISOString()
          });
        } else {
          this.sendResponse(res, 500, { error: 'Message handler not available' });
        }
        return;
      }

      if (pathname === '/status') {
        this.sendResponse(res, 200, {
          status: 'running',
          port: this.port,
          timestamp: new Date().toISOString(),
          endpoints: {
            message: `/?msg="your message"`,
            status: '/status'
          }
        });
        return;
      }

      // 404 for unknown endpoints
      this.sendResponse(res, 404, { error: 'Endpoint not found' });
    } catch (error) {
      console.error('Error handling request:', error);
      this.sendResponse(res, 500, { error: 'Internal server error' });
    }
  }

  private sendResponse(res: ServerResponse, statusCode: number, data: any): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('🔴 Web API server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getPort(): number {
    return this.port;
  }
} 