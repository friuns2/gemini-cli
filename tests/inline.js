/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// inline.js - Standalone OAuth authentication for Gemini CLI

import { OAuth2Client } from 'google-auth-library';
import * as http from 'http';
import url from 'url';
import crypto from 'crypto';
import * as net from 'net';
import open from 'open';
import { promises as fs } from 'node:fs';
import * as os from 'os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout } from 'node:timers';

// OAuth Client configuration
const OAUTH_CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
const OAUTH_CLIENT_SECRET = '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';
const OAUTH_SCOPE = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

const HTTP_REDIRECT = 301;
const SIGN_IN_SUCCESS_URL = 'https://developers.google.com/gemini-code-assist/auth_success_gemini';
const SIGN_IN_FAILURE_URL = 'https://developers.google.com/gemini-code-assist/auth_failure_gemini';
const GEMINI_DIR = '.gemini';
const CREDENTIAL_FILENAME = 'oauth_creds3.json';

// Code Assist API configuration
const CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com';
const CODE_ASSIST_API_VERSION = 'v1internal';

// TokenCyclingManager to handle multiple accounts
class TokenCyclingManager {
  static instance;
  tokenStore = { tokens: [], currentIndex: 0 };
  initialized = false;

  static getInstance() {
    if (!TokenCyclingManager.instance) {
      TokenCyclingManager.instance = new TokenCyclingManager();
    }
    return TokenCyclingManager.instance;
  }

  async initialize() {
    if (this.initialized) return;
    try {
      const filePath = getCachedCredentialPath();
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      if (parsed.tokens && Array.isArray(parsed.tokens)) {
        this.tokenStore = parsed;
      } else if (parsed.access_token || parsed.refresh_token) {
        // Convert legacy single token to new format
        this.tokenStore = {
          tokens: [{
            credentials: parsed,
            addedAt: Date.now()
          }],
          currentIndex: 0
        };
        await this.saveTokenStore();
      }
    } catch (error) {
      // File doesn't exist or is corrupted, start fresh
      this.tokenStore = { tokens: [], currentIndex: 0 };
    }
    this.initialized = true;
  }

  async addToken(credentials, email, projectId) {
    await this.initialize();
    // Check if token already exists (by refresh_token or access_token)
    const existingIndex = this.tokenStore.tokens.findIndex(token => 
      token.credentials.refresh_token === credentials.refresh_token ||
      (token.credentials.access_token === credentials.access_token && credentials.access_token)
    );
    if (existingIndex !== -1) {
      // Update existing token
      this.tokenStore.tokens[existingIndex] = {
        credentials,
        email,
        projectId,
        addedAt: Date.now()
      };
      console.log(`Updated existing token for ${email || 'unknown user'}${projectId ? ` with project ${projectId}` : ''}`);
    } else {
      // Add new token
      this.tokenStore.tokens.push({
        credentials,
        email,
        projectId,
        addedAt: Date.now()
      });
      console.log(`Added new token for ${email || 'unknown user'}${projectId ? ` with project ${projectId}` : ''}. Total tokens: ${this.tokenStore.tokens.length}`);
    }
    await this.saveTokenStore();
  }

  async getNextToken() {
    await this.initialize();
    if (this.tokenStore.tokens.length === 0) {
      return null;
    }
    const token = this.tokenStore.tokens[this.tokenStore.currentIndex];
    // Cycle to next token for next request
    this.tokenStore.currentIndex = (this.tokenStore.currentIndex + 1) % this.tokenStore.tokens.length;
    await this.saveTokenStore();
    console.log(`Using token ${this.tokenStore.currentIndex === 0 ? this.tokenStore.tokens.length : this.tokenStore.currentIndex} of ${this.tokenStore.tokens.length} for ${token.email || 'unknown user'}${token.projectId ? ` with project ${token.projectId}` : ''}`);
    return token;
  }

  async getAllTokens() {
    await this.initialize();
    return [...this.tokenStore.tokens];
  }

  async clearAllTokens() {
    this.tokenStore = { tokens: [], currentIndex: 0 };
    await this.saveTokenStore();
    console.log('Cleared all tokens');
  }

  getTokenCount() {
    return this.tokenStore.tokens.length;
  }

  async updateTokenProjectId(email, projectId) {
    await this.initialize();
    const index = this.tokenStore.tokens.findIndex(token => token.email === email);
    if (index !== -1) {
      this.tokenStore.tokens[index].projectId = projectId;
      console.log(`Updated project ID for ${email || 'unknown user'} to ${projectId}`);
      await this.saveTokenStore();
    }
  }

  async removeToken(index) {
    await this.initialize();
    if (index >= 0 && index < this.tokenStore.tokens.length) {
      const removedToken = this.tokenStore.tokens.splice(index, 1)[0];
      console.log(`Removed token for ${removedToken.email || 'unknown user'}`);
      // Adjust current index if necessary
      if (this.tokenStore.currentIndex >= this.tokenStore.tokens.length) {
        this.tokenStore.currentIndex = 0;
      }
      await this.saveTokenStore();
    }
  }

  async saveTokenStore() {
    const filePath = getCachedCredentialPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(this.tokenStore, null, 2));
  }
}

// User Tier enum
const UserTierId = {
  LEGACY: 'LEGACY',
  FREE: 'FREE',
  WORKSPACE_GCA: 'WORKSPACE_GCA',
  CLOUD_PAID: 'CLOUD_PAID'
};

// Project ID Required Error
class ProjectIdRequiredError extends Error {
  constructor() {
    super('This account requires setting the GOOGLE_CLOUD_PROJECT env var. See https://goo.gle/gemini-cli-auth-docs#workspace-gca');
  }
}

// Get available port for OAuth callback
function getAvailablePort() {
  return new Promise((resolve, reject) => {
    let port = 0;
    try {
      const server = net.createServer();
      server.listen(0, () => {
        const address = server.address();
        port = address.port;
      });
      server.on('listening', () => {
        server.close();
        server.unref();
      });
      server.on('error', (e) => reject(e));
      server.on('close', () => resolve(port));
    } catch (e) {
      reject(e);
    }
  });
}

// Web-based OAuth authentication
async function authWithWeb(client) {
  const port = await getAvailablePort();
  const redirectUri = `http://localhost:${port}/oauth2callback`;
  const state = crypto.randomBytes(32).toString('hex');
  const authUrl = client.generateAuthUrl({
    redirect_uri: redirectUri,
    access_type: 'offline',
    scope: OAUTH_SCOPE,
    state,
  });

  const loginCompletePromise = new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        if (req.url.indexOf('/oauth2callback') === -1) {
          res.writeHead(HTTP_REDIRECT, { Location: SIGN_IN_FAILURE_URL });
          res.end();
          reject(new Error('Unexpected request: ' + req.url));
        }
        
        const qs = new url.URL(req.url, 'http://localhost:3000').searchParams;
        if (qs.get('error')) {
          res.writeHead(HTTP_REDIRECT, { Location: SIGN_IN_FAILURE_URL });
          res.end();
          reject(new Error(`Error during authentication: ${qs.get('error')}`));
        } else if (qs.get('state') !== state) {
          res.end('State mismatch. Possible CSRF attack');
          reject(new Error('State mismatch. Possible CSRF attack'));
        } else if (qs.get('code')) {
          const { tokens } = await client.getToken({
            code: qs.get('code'),
            redirect_uri: redirectUri,
          });
          client.setCredentials(tokens);
          
          res.writeHead(HTTP_REDIRECT, { Location: SIGN_IN_SUCCESS_URL });
          res.end();
          resolve();
        } else {
          reject(new Error('No code found in request'));
        }
      } catch (e) {
        reject(e);
      } finally {
        server.close();
      }
    });
    server.listen(port);
  });

  return { authUrl, loginCompletePromise };
}

// Validate token
async function validateToken(credentials) {
  try {
    const tempClient = new OAuth2Client({
      clientId: OAUTH_CLIENT_ID,
      clientSecret: OAUTH_CLIENT_SECRET,
    });
    tempClient.setCredentials(credentials);

    const { token } = await tempClient.getAccessToken();
    if (!token) {
      return false;
    }

    await tempClient.getTokenInfo(token);
    return true;
  } catch (error) {
    console.warn('Token validation failed:', error.message);
    return false;
  }
}

// Get cached credential path
function getCachedCredentialPath() {
  return path.join(os.homedir(), GEMINI_DIR, CREDENTIAL_FILENAME);
}

// Main OAuth client function
async function getOauthClient(forceNewAuth = false) {
  const client = new OAuth2Client({
    clientId: OAUTH_CLIENT_ID,
    clientSecret: OAUTH_CLIENT_SECRET,
  });

  const tokenManager = TokenCyclingManager.getInstance();

  // Set up token caching
  client.on('tokens', async (tokens) => {
    // Get user info for the new token
    let userEmail;
    try {
      const tempClient = new OAuth2Client({
        clientId: OAUTH_CLIENT_ID,
        clientSecret: OAUTH_CLIENT_SECRET,
      });
      tempClient.setCredentials(tokens);
      const { token } = await tempClient.getAccessToken();
      if (token) {
        // Get user email
        const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (userInfoResponse.ok) {
          const userInfo = await userInfoResponse.json();
          userEmail = userInfo.email;
        }
      }
    } catch (error) {
      console.warn('Failed to get user info for new token:', error);
    }
    // Add token with email, projectId will be updated by setupUser
    await tokenManager.addToken(tokens, userEmail, undefined);
    console.log('Credentials cached successfully.');
  });

  // Try to load cached credentials first
  if (!forceNewAuth) {
    const cached = await tokenManager.getNextToken();
    if (cached && await validateToken(cached.credentials)) {
      client.setCredentials(cached.credentials);
 
      console.log(`Loaded cached credentials for ${cached.email || 'unknown user'}.`);
      return client;
    }
  }

  // Perform web authentication
  const webLogin = await authWithWeb(client);
  
  console.log('Code Assist login required.');
  console.log('Attempting to open authentication page in your browser.');
  console.log(`Otherwise navigate to:\n\n${webLogin.authUrl}\n`);
  
  await open(webLogin.authUrl);
  console.log('Waiting for authentication...');
  
  await webLogin.loginCompletePromise;
  console.log('Authentication successful!');
  
  return client;
}

// Code Assist API helper functions
async function makeCodeAssistRequest(client, method, requestBody = {}, signal) {
  const url = `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:${method}`;
  
  const response = await client.request({
    url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    responseType: 'json',
    body: JSON.stringify(requestBody),
    signal,
  });
  
  return response.data;
}

// Get onboard tier from load response
function getOnboardTier(loadResponse) {
  if (loadResponse.currentTier) {
    return loadResponse.currentTier;
  }
  
  if (loadResponse.allowedTiers) {
    for (const tier of loadResponse.allowedTiers) {
      if (tier.isDefault) {
        return tier;
      }
    }
  }
  
  return {
    name: '',
    description: '',
    id: UserTierId.LEGACY,
    userDefinedCloudaicompanionProject: true,
  };
}

// Setup user and get project ID (like in CLI)
async function setupUser(client) {
  let projectId = undefined;
  
  const clientMetadata = {
    ideType: 'IDE_UNSPECIFIED',
    platform: 'PLATFORM_UNSPECIFIED',
    pluginType: 'GEMINI',
    duetProject: projectId,
  };

  // Call loadCodeAssist API
  console.log('Calling loadCodeAssist API...');
  const loadRequest = {
    cloudaicompanionProject: projectId,
    metadata: clientMetadata,
  };

  const loadResponse = await makeCodeAssistRequest(client, 'loadCodeAssist', loadRequest);
  console.log('LoadCodeAssist response received');

  // If no project ID from env, try to get it from server response
  if (!projectId && loadResponse.cloudaicompanionProject) {
    projectId = loadResponse.cloudaicompanionProject;
    console.log(`Project ID discovered from server: ${projectId}`);
  }

  const tier = getOnboardTier(loadResponse);
  console.log(`User tier: ${tier.id}`);
  
  if (tier.userDefinedCloudaicompanionProject && !projectId) {
    throw new ProjectIdRequiredError();
  }

  const onboardRequest = {
    tierId: tier.id,
    cloudaicompanionProject: projectId,
    metadata: clientMetadata,
  };

  // Poll onboardUser until long running operation is complete
  console.log('Starting user onboarding...');
  let lroResponse = await makeCodeAssistRequest(client, 'onboardUser', onboardRequest);
  
  while (!lroResponse.done) {
    console.log('Onboarding in progress, waiting 5 seconds...');
    await new Promise((resolve) => setTimeout(resolve, 5000));
    lroResponse = await makeCodeAssistRequest(client, 'onboardUser', onboardRequest);
  }

  const finalProjectId = lroResponse.response?.cloudaicompanionProject?.id || projectId || '';
  console.log(`Final project ID: ${finalProjectId}`);
  
  return {
    projectId: finalProjectId,
    userTier: tier.id,
  };
}

// Send message to Gemini via Code Assist API (like CLI)
async function sendMessageToGemini(client, message, projectId) {
  try {
    // Create a proper GenerateContent request like the CLI does
    const generateContentRequest = {
      model: 'gemini-2.5-pro', // Use the same default model as CLI
      project: projectId, // Ensure project ID is included here
      request: {
        contents: [
          {
            role: 'user',
            parts: [{ text: message }]
          }
        ],
        generationConfig: {
          temperature: 0,
          topP: 1,
        }
      }
    };

    console.log('Sending generateContent request to Code Assist API...');
    console.log('Request payload:', JSON.stringify(generateContentRequest, null, 2));
    const response = await makeCodeAssistRequest(client, 'generateContent', generateContentRequest);
    
    // Extract the text response from the Code Assist API response
    if (response.response && response.response.candidates && response.response.candidates.length > 0) {
      const candidate = response.response.candidates[0];
      if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
        const textParts = candidate.content.parts
          .filter(part => part.text)
          .map(part => part.text)
          .join('');
        
        return { reply: textParts };
      }
    }
    
    return { reply: 'No response from Gemini' };
    
  } catch (error) {
    console.error('Error sending message to Gemini:', error.message);
    // Fallback: just echo the message for demo purposes
    return { reply: `Echo: ${message}` };
  }
}

// Main function
async function main() {
  try {
    console.log('Starting OAuth authentication...');

    const tokenManager = TokenCyclingManager.getInstance();

    // Clear existing accounts for a clean test
    await tokenManager.clearAllTokens();

    let addAnotherAccount = true;
    while (addAnotherAccount) {
      console.log('\nAuthenticating a new account...');
      // Force new authentication for each account added in this loop
      const oauthClient = await getOauthClient(true); 
      
      // Setup user and get project ID for the newly authenticated client
      const userInfo = await setupUser(oauthClient);
      
      // Crucial: Update the projectId for the account that was just added
      // We assume the last added token in tokenManager is the one we just authenticated
      // In a real app, you'd match by email or client ID to be more robust
      const allTokens = await tokenManager.getAllTokens();
      const lastAddedToken = allTokens[allTokens.length - 1];
      if (lastAddedToken && userInfo.projectId) {
        await tokenManager.updateTokenProjectId(lastAddedToken.email, userInfo.projectId);
      }


      const readline = await import('node:readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const answer = await new Promise(resolve => rl.question('Add another account? (y/n): ', resolve));
      rl.close();
      addAnotherAccount = answer.toLowerCase() === 'y';
    }

    // After all accounts are added and their project IDs are updated, re-fetch all accounts
    const allAccounts = await tokenManager.getAllTokens();

    // Send message to all authenticated accounts
    console.log('\nSending test message to all authenticated accounts...');
    if (allAccounts.length === 0) {
      console.log('No accounts authenticated. Exiting.');
      return;
    }

    for (const account of allAccounts) {
      if (account.credentials) {
        console.log(`\nSending message with account: ${account.email || 'unknown user'} (Project: ${account.projectId || 'N/A'})`);
        const tempClient = new OAuth2Client({
          clientId: OAUTH_CLIENT_ID,
          clientSecret: OAUTH_CLIENT_SECRET,
        });
        tempClient.setCredentials(account.credentials);

        const response = await sendMessageToGemini(tempClient, `Hello from ${account.email || 'an account'}!`, account.projectId);
        console.log('Gemini response:', response);
      }
    }
    
    console.log('\nOAuth authentication and message sending completed successfully!');
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Run the script
main().catch(console.error); 