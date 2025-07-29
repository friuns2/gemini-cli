/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SlashCommand, CommandContext, MessageActionReturn } from './types.js';
import { 
  getOauthClient, 
  clearCachedCredentialFile,
  getAvailableAccounts,
  switchToAccount,
  removeAccount,
  AuthType
} from '@google/gemini-cli-core';

export const authCommand: SlashCommand = {
  name: 'auth',
  description: 'manage multiple authentication accounts',
  subCommands: [
    {
      name: 'add',
      description: 'add a new authentication account',
      action: async (context: CommandContext): Promise<MessageActionReturn> => {
        const { config, settings } = context.services;
        
        if (!config) {
          return {
            type: 'message',
            messageType: 'error',
            content: 'Configuration not available'
          };
        }

        try {
          const authType = settings.merged.selectedAuthType || AuthType.LOGIN_WITH_GOOGLE;
          await getOauthClient(authType, config);
          
          return {
            type: 'message',
            messageType: 'info',
            content: 'New account successfully added and activated'
          };
        } catch (error) {
          return {
            type: 'message',
            messageType: 'error',
            content: `Failed to add account: ${error instanceof Error ? error.message : 'Unknown error'}`
          };
        }
      }
    },
    {
      name: 'switch',
      description: 'switch to a different account',
      action: async (context: CommandContext, args: string): Promise<MessageActionReturn> => {
        const email = args.trim();
        
        if (!email) {
          return {
            type: 'message',
            messageType: 'error',
            content: 'Please provide an email address: /auth switch <email>'
          };
        }

        try {
          const success = await switchToAccount(email);
          
          if (success) {
            return {
              type: 'message',
              messageType: 'info',
              content: `Switched to account: ${email}`
            };
          } else {
            return {
              type: 'message',
              messageType: 'error',
              content: `Account not found: ${email}`
            };
          }
        } catch (error) {
          return {
            type: 'message',
            messageType: 'error',
            content: `Failed to switch account: ${error instanceof Error ? error.message : 'Unknown error'}`
          };
        }
      },
      completion: async (context: CommandContext, partialArg: string): Promise<string[]> => {
        try {
          const accounts = await getAvailableAccounts();
          return accounts.filter(email => 
            email.toLowerCase().includes(partialArg.toLowerCase())
          );
        } catch {
          return [];
        }
      }
    },
    {
      name: 'list',
      description: 'list all authenticated accounts',
      action: async (): Promise<MessageActionReturn> => {
        try {
          const accounts = await getAvailableAccounts();
          
          if (accounts.length === 0) {
            return {
              type: 'message',
              messageType: 'info',
              content: 'No authenticated accounts found'
            };
          }

          const accountList = accounts.map((email, index) => 
            `  ${index + 1}. ${email}`
          ).join('\n');

          return {
            type: 'message',
            messageType: 'info',
            content: `Authenticated accounts:\n${accountList}`
          };
        } catch (error) {
          return {
            type: 'message',
            messageType: 'error',
            content: `Failed to list accounts: ${error instanceof Error ? error.message : 'Unknown error'}`
          };
        }
      }
    },
    {
      name: 'remove',
      description: 'remove an account',
      action: async (context: CommandContext, args: string): Promise<MessageActionReturn> => {
        const email = args.trim();
        
        if (!email) {
          return {
            type: 'message',
            messageType: 'error',
            content: 'Please provide an email address: /auth remove <email>'
          };
        }

        try {
          const success = await removeAccount(email);
          
          if (success) {
            return {
              type: 'message',
              messageType: 'info',
              content: `Removed account: ${email}`
            };
          } else {
            return {
              type: 'message',
              messageType: 'error',
              content: `Account not found: ${email}`
            };
          }
        } catch (error) {
          return {
            type: 'message',
            messageType: 'error',
            content: `Failed to remove account: ${error instanceof Error ? error.message : 'Unknown error'}`
          };
        }
      },
      completion: async (context: CommandContext, partialArg: string): Promise<string[]> => {
        try {
          const accounts = await getAvailableAccounts();
          return accounts.filter(email => 
            email.toLowerCase().includes(partialArg.toLowerCase())
          );
        } catch {
          return [];
        }
      }
    }
  ]
}; 