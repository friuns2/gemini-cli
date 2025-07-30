/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getErrorMessage, listAccounts, switchAccount } from '@google/gemini-cli-core';
import { MessageType } from '../types.js';
import { SlashCommand, SlashCommandActionReturn } from './types.js';

export const switchCommand: SlashCommand = {
  name: 'switch',
  description: 'Switch between authenticated accounts.',
  subCommands: [
    {
      name: 'list',
      description: 'List all available accounts.',
      action: async (context) => {
        try {
          const accounts = await listAccounts();
          
          if (accounts.length === 0) {
            context.ui.addItem(
              {
                type: MessageType.INFO,
                text: 'No accounts found. Use /auth to add an account.',
              },
              Date.now(),
            );
            return;
          }

          const accountsList = accounts
            .map((account, index) => {
              const activeMarker = account.isActive ? ' (active)' : '';
              const displayName = account.name ? ` (${account.name})` : '';
              return `${index + 1}. ${account.email}${displayName}${activeMarker}`;
            })
            .join('\n');

          const config = context.services.config;
          const cycleStatus = config?.getAutoCycleAccounts() ? 'enabled' : 'disabled';

          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: `Available accounts:\n${accountsList}\n\nAuto-cycling: ${cycleStatus}\n\nUse /switch <number> to switch accounts or /switch cycle to toggle auto-cycling.`,
            },
            Date.now(),
          );
        } catch (error) {
          const errorMessage = getErrorMessage(error);
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: `Error listing accounts: ${errorMessage}`,
            },
            Date.now(),
          );
        }
      },
    },
    {
      name: 'cycle',
      description: 'Toggle automatic account cycling for each message.',
      action: async (context) => {
        try {
          const config = context.services.config;
          if (!config) {
            context.ui.addItem(
              {
                type: MessageType.ERROR,
                text: 'Config not available.',
              },
              Date.now(),
            );
            return;
          }

          const currentStatus = config.getAutoCycleAccounts();
          const newStatus = !currentStatus;
          config.setAutoCycleAccounts(newStatus);

          const statusText = newStatus ? 'enabled' : 'disabled';
          const description = newStatus 
            ? 'Each message will automatically use the next account in rotation.' 
            : 'Manual account switching only.';

          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: `Auto-cycling ${statusText}. ${description}`,
            },
            Date.now(),
          );
        } catch (error) {
          const errorMessage = getErrorMessage(error);
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: `Error toggling auto-cycle: ${errorMessage}`,
            },
            Date.now(),
          );
        }
      },
    },
  ],
  action: async (context, args): Promise<SlashCommandActionReturn | void> => {
    if (!args || args.trim() === '') {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /switch <account_number>, /switch list, or /switch cycle',
      };
    }

    const argsTrimmed = args.trim();
    
    // If it's 'list' or 'cycle', handle it via subcommand
    if (argsTrimmed === 'list' || argsTrimmed === 'cycle') {
      return;
    }

    const accountNumber = parseInt(argsTrimmed, 10);
    if (isNaN(accountNumber) || accountNumber < 1) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Account number must be a positive integer. Use /switch list to see available accounts.',
      };
    }

    try {
      const accounts = await listAccounts();
      
      if (accounts.length === 0) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'No accounts found. Use /auth to add an account.',
        };
      }

      if (accountNumber > accounts.length) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Account number ${accountNumber} not found. Available accounts: 1-${accounts.length}`,
        };
      }

      const targetAccount = accounts[accountNumber - 1];
      
      if (targetAccount.isActive) {
        return {
          type: 'message',
          messageType: 'info',
          content: `Account ${targetAccount.email} is already active.`,
        };
      }

      context.ui.addItem(
        {
          type: MessageType.INFO,
          text: `Switching to account: ${targetAccount.email}...`,
        },
        Date.now(),
      );

      const switchSuccess = await switchAccount(targetAccount.id);
      
      if (!switchSuccess) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Failed to switch to account ${targetAccount.email}`,
        };
      }

      // Refresh auth to reload with new account credentials
      try {
        const config = context.services.config;
        if (!config) {
          throw new Error('Config not available');
        }
        
        // Get the current auth type from settings
        const currentAuthType = context.services.settings.merged.selectedAuthType;
        if (!currentAuthType) {
          throw new Error('No auth type configured');
        }
        
        // Refresh auth which will recreate the OAuth client and content generator with new credentials
        await config.refreshAuth(currentAuthType);

        context.ui.addItem(
          {
            type: MessageType.INFO,
            text: `Successfully switched to account: ${targetAccount.email}`,
          },
          Date.now(),
        );
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        context.ui.addItem(
          {
            type: MessageType.ERROR,
            text: `Switched account but failed to refresh auth: ${errorMessage}`,
          },
          Date.now(),
        );
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      return {
        type: 'message',
        messageType: 'error',
        content: `Error switching account: ${errorMessage}`,
      };
    }
  },
}; 