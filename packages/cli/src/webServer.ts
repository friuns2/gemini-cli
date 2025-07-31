/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { URL } from 'url';
import { Config, ApprovalMode, ShellTool, EditTool, WriteFileTool, AuthType } from '@google/gemini-cli-core';
import { LoadedSettings, USER_SETTINGS_PATH } from './config/settings.js';
import { Extension } from './config/extension.js';
import { CliArgs, loadCliConfig } from './config/config.js';
import { runNonInteractive } from './nonInteractiveCli.js';
import { validateAuthMethod } from './config/auth.js';

interface WebServerOptions {
  port: number;
  config: Config;
  settings: LoadedSettings;
  extensions: Extension[];
  argv: CliArgs;
}

export class WebServer {
  private server: http.Server;
  private port: number;
  private config: Config;
  private settings: LoadedSettings;
  private extensions: Extension[];
  private argv: CliArgs;

  constructor(options: WebServerOptions) {
    this.port = options.port;
    this.config = options.config;
    this.settings = options.settings;
    this.extensions = options.extensions;
    this.argv = options.argv;
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        this.serveIndex(res);
      } else if (req.method === 'POST' && url.pathname === '/execute') {
        await this.handleExecuteCommand(req, res);
      } else if (req.method === 'GET' && url.pathname === '/status') {
        this.handleStatus(res);
      } else {
        this.serve404(res);
      }
    } catch (error) {
      console.error('Error handling request:', error);
      this.serve500(res, error);
    }
  }

  private serveIndex(res: http.ServerResponse) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Gemini CLI Web Interface</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        
        .container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            width: 100%;
            max-width: 800px;
            padding: 40px;
        }
        
        .header {
            text-align: center;
            margin-bottom: 40px;
        }
        
        .header h1 {
            color: #333;
            font-size: 2.5em;
            margin-bottom: 10px;
            background: linear-gradient(135deg, #667eea, #764ba2);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        
        .header p {
            color: #666;
            font-size: 1.1em;
        }
        
        .command-section {
            margin-bottom: 30px;
        }
        
        .input-group {
            position: relative;
            margin-bottom: 20px;
        }
        
        .input-group label {
            display: block;
            margin-bottom: 8px;
            color: #333;
            font-weight: 600;
        }
        
        .input-group input[type="text"] {
            width: 100%;
            padding: 15px 20px;
            border: 2px solid #e1e5e9;
            border-radius: 10px;
            font-size: 16px;
            transition: all 0.3s ease;
            outline: none;
        }
        
        .input-group input[type="text"]:focus {
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }
        
        .button-group {
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
        }
        
        .btn {
            padding: 15px 30px;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            min-width: 140px;
        }
        
        .btn-primary {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
        }
        
        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
        }
        
        .btn-secondary {
            background: #f8f9fa;
            color: #333;
            border: 2px solid #e1e5e9;
        }
        
        .btn-secondary:hover {
            background: #e9ecef;
            transform: translateY(-1px);
        }
        
        .output-section {
            margin-top: 30px;
        }
        
        .output-container {
            background: #f8f9fa;
            border: 2px solid #e1e5e9;
            border-radius: 10px;
            padding: 20px;
            min-height: 200px;
            max-height: 400px;
            overflow-y: auto;
        }
        
        .output-content {
            font-family: 'Courier New', monospace;
            font-size: 14px;
            line-height: 1.6;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        
        .loading {
            display: none;
            text-align: center;
            color: #667eea;
            font-style: italic;
        }
        
        .error {
            color: #dc3545;
        }
        
        .success {
            color: #28a745;
        }
        
        .examples {
            margin-top: 30px;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 10px;
        }
        
        .examples h3 {
            color: #333;
            margin-bottom: 15px;
        }
        
        .example-commands {
            display: grid;
            gap: 10px;
        }
        
        .example-command {
            background: white;
            padding: 10px 15px;
            border-radius: 8px;
            border: 1px solid #e1e5e9;
            cursor: pointer;
            transition: all 0.2s ease;
            font-family: 'Courier New', monospace;
            font-size: 14px;
        }
        
        .example-command:hover {
            background: #667eea;
            color: white;
            transform: translateX(5px);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🤖 Gemini CLI</h1>
            <p>Web Interface - Execute commands remotely</p>
        </div>
        
        <div class="command-section">
            <div class="input-group">
                <label for="commandInput">Enter your command:</label>
                <input type="text" id="commandInput" placeholder="e.g., help, list files, write a Python script..." autofocus>
            </div>
            
            <div class="button-group">
                <button type="button" class="btn btn-primary" onclick="executeCommand()">
                    Execute Command
                </button>
                <button type="button" class="btn btn-secondary" onclick="clearOutput()">
                    Clear Output
                </button>
            </div>
        </div>
        
        <div class="output-section">
            <label>Output:</label>
            <div class="output-container">
                <div class="loading" id="loading">Executing command...</div>
                <div class="output-content" id="output">Ready to execute commands. Type a command above and click "Execute Command".</div>
            </div>
        </div>
        
        <div class="examples">
            <h3>📝 Example Commands</h3>
            <div class="example-commands">
                <div class="example-command" onclick="setCommand('help')">help</div>
                <div class="example-command" onclick="setCommand('list files in current directory')">list files in current directory</div>
                <div class="example-command" onclick="setCommand('show me the package.json file')">show me the package.json file</div>
                <div class="example-command" onclick="setCommand('write a simple hello world python script')">write a simple hello world python script</div>
                <div class="example-command" onclick="setCommand('explain what this project does')">explain what this project does</div>
            </div>
        </div>
    </div>

    <script>
        function setCommand(command) {
            document.getElementById('commandInput').value = command;
            document.getElementById('commandInput').focus();
        }
        
        function clearOutput() {
            document.getElementById('output').textContent = 'Output cleared. Ready for next command.';
            document.getElementById('output').className = 'output-content';
        }
        
        async function executeCommand() {
            const input = document.getElementById('commandInput');
            const output = document.getElementById('output');
            const loading = document.getElementById('loading');
            const command = input.value.trim();
            
            if (!command) {
                output.textContent = 'Please enter a command.';
                output.className = 'output-content error';
                return;
            }
            
            // Show loading state
            loading.style.display = 'block';
            output.style.display = 'none';
            
            try {
                const response = await fetch('/execute', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ command })
                });
                
                const result = await response.json();
                
                // Hide loading state
                loading.style.display = 'none';
                output.style.display = 'block';
                
                if (response.ok) {
                    output.textContent = result.output || 'Command executed successfully (no output).';
                    output.className = 'output-content success';
                } else {
                    output.textContent = result.error || 'An error occurred.';
                    output.className = 'output-content error';
                }
            } catch (error) {
                // Hide loading state
                loading.style.display = 'none';
                output.style.display = 'block';
                
                output.textContent = 'Network error: ' + error.message;
                output.className = 'output-content error';
            }
            
            // Clear input for next command
            input.value = '';
            input.focus();
        }
        
        // Allow Enter key to execute command
        document.getElementById('commandInput').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                executeCommand();
            }
        });
        
        // Focus on input when page loads
        window.onload = function() {
            document.getElementById('commandInput').focus();
        };
    </script>
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  private async handleExecuteCommand(req: http.IncomingMessage, res: http.ServerResponse) {
    let body = '';
    
    for await (const chunk of req) {
      body += chunk.toString();
    }
    
    try {
      const { command } = JSON.parse(body);
      
      if (!command || typeof command !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid command' }));
        return;
      }
      
      console.log(`[Web UI] Executing command: ${command}`);
      
      // Capture stdout to return the output
      const originalStdoutWrite = process.stdout.write;
      const originalStderrWrite = process.stderr.write;
      let capturedOutput = '';
      let capturedError = '';
      
      // Override stdout.write to capture output
      process.stdout.write = function(chunk: any, encoding?: any, cb?: any) {
        if (typeof chunk === 'string') {
          capturedOutput += chunk;
        }
        return true;
      } as any;
      
      // Override stderr.write to capture errors  
      process.stderr.write = function(chunk: any, encoding?: any, cb?: any) {
        if (typeof chunk === 'string') {
          capturedError += chunk;
        }
        return true;
      } as any;
      
      try {
        // Create a non-interactive config for command execution
        const nonInteractiveConfig = await this.loadNonInteractiveConfig(
          this.config,
          this.extensions,
          this.settings,
          this.argv,
        );
        
        // Execute the command like non-interactive CLI
        await runNonInteractive(
          nonInteractiveConfig,
          command,
          `web-${Date.now()}`
        );
        
        // Restore original stdout/stderr
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
        
        const output = capturedOutput || capturedError || 'Command executed successfully.';
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ output: output.trim() }));
        
      } catch (error) {
        // Restore original stdout/stderr
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
        
        console.error('[Web UI] Command execution error:', error);
        
        const errorMessage = capturedError || (error instanceof Error ? error.message : 'Unknown error');
        
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: errorMessage }));
      }
      
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  }

  private handleStatus(res: http.ServerResponse) {
    const status = {
      status: 'running',
      timestamp: new Date().toISOString(),
      model: this.config.getModel(),
      version: process.env.npm_package_version || 'unknown'
    };
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
  }

  private serve404(res: http.ServerResponse) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }

  private serve500(res: http.ServerResponse, error: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal Server Error' }));
  }

  private async loadNonInteractiveConfig(
    config: Config,
    extensions: Extension[],
    settings: LoadedSettings,
    argv: CliArgs,
  ) {
    let finalConfig = config;
    if (config.getApprovalMode() !== ApprovalMode.YOLO) {
      // Everything is not allowed, ensure that only read-only tools are configured.
      const existingExcludeTools = settings.merged.excludeTools || [];
      const interactiveTools = [
        ShellTool.Name,
        EditTool.Name,
        WriteFileTool.Name,
      ];

      const newExcludeTools = [
        ...new Set([...existingExcludeTools, ...interactiveTools]),
      ];

      const nonInteractiveSettings = {
        ...settings.merged,
        excludeTools: newExcludeTools,
      };
      finalConfig = await loadCliConfig(
        nonInteractiveSettings,
        extensions,
        config.getSessionId(),
        argv,
      );
      await finalConfig.initialize();
    }

    return await this.validateNonInterActiveAuth(
      settings.merged.selectedAuthType,
      finalConfig,
    );
  }

  private async validateNonInterActiveAuth(
    selectedAuthType: AuthType | undefined,
    nonInteractiveConfig: Config,
  ) {
    // making a special case for the cli. many headless environments might not have a settings.json set
    // so if GEMINI_API_KEY is set, we'll use that. However since the oauth things are interactive anyway, we'll
    // still expect that exists
    if (!selectedAuthType && !process.env.GEMINI_API_KEY) {
      console.error(
        `Please set an Auth method in your ${USER_SETTINGS_PATH} OR specify GEMINI_API_KEY env variable file before running`,
      );
      process.exit(1);
    }

    selectedAuthType = selectedAuthType || AuthType.USE_GEMINI;
    const err = validateAuthMethod(selectedAuthType);
    if (err != null) {
      console.error(err);
      process.exit(1);
    }

    await nonInteractiveConfig.refreshAuth(selectedAuthType);
    return nonInteractiveConfig;
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, (err?: Error) => {
        if (err) {
          reject(err);
        } else {
          console.log(`🌐 Web interface available at: http://localhost:${this.port}`);
          console.log(`   Send commands through the web interface or POST to /execute`);
          resolve();
        }
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        console.log('Web server stopped.');
        resolve();
      });
    });
  }
} 