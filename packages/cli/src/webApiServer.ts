/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { URL } from 'url';
import { Config } from '@google/gemini-cli-core';
import * as fs from 'fs/promises';
import * as path from 'path';

const HTML_FILE_PATH = path.join(__dirname, '..' , 'ui', 'index.html');

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

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
          // Serve index.html if no msg parameter
          try {
            const htmlContent = await fs.readFile(HTML_FILE_PATH, 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(htmlContent);
          } catch (readError) {
            console.error('Error serving index.html:', readError);
            this.sendResponse(res, 500, { 
              error: 'Failed to load web interface', 
              details: readError instanceof Error ? readError.message : String(readError)
            });
          }
          return;
        }

        // Inject the message into the interactive session
        if (this.onMessage) {
          try {
            this.onMessage(msg);
            this.sendResponse(res, 200, { 
              success: true, 
              message: `Message "${msg}" sent to interactive session`,
              timestamp: new Date().toISOString(),
              note: 'Check terminal for processing status'
            });
          } catch (error) {
            console.error('Error processing message:', error);
            this.sendResponse(res, 500, { 
              error: 'Failed to process message', 
              details: error instanceof Error ? error.message : String(error)
            });
          }
        } else {
          this.sendResponse(res, 503, { 
            error: 'Message handler not available', 
            message: 'Interactive session may not be ready yet'
          });
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