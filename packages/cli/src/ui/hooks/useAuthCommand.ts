/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect } from 'react';
import { LoadedSettings, SettingScope } from '../../config/settings.js';
import {
  AuthType,
  Config,
  clearCachedCredentialFile,
  getErrorMessage,
} from '@google/gemini-cli-core';
import { runExitCleanup } from '../../utils/cleanup.js';

export const useAuthCommand = (
  settings: LoadedSettings,
  setAuthError: (error: string | null) => void,
  config: Config,
) => {
  const [isAuthDialogOpen, setIsAuthDialogOpen] = useState(
    settings.merged.selectedAuthType === undefined,
  );

  const openAuthDialog = useCallback(() => {
    setIsAuthDialogOpen(true);
  }, []);

  const [isAuthenticating, setIsAuthenticating] = useState(false);

  useEffect(() => {
    const authFlow = async () => {
      const authType = settings.merged.selectedAuthType;
      if (isAuthDialogOpen || !authType) {
        return;
      }

      try {
        setIsAuthenticating(true);
        await config.refreshAuth(authType);
        console.log(`Authenticated via "${authType}".`);
      } catch (e) {
        setAuthError(`Failed to login. Message: ${getErrorMessage(e)}`);
        openAuthDialog();
      } finally {
        setIsAuthenticating(false);
      }
    };

    void authFlow();
  }, [isAuthDialogOpen, settings, config, setAuthError, openAuthDialog]);

  const handleAuthSelect = useCallback(
    async (authType: AuthType | undefined, scope: SettingScope) => {
      if (authType) {
        // For Google auth, we don't clear credentials anymore since we support multiple accounts
        // But we do need to force new auth to add a new account
        const currentAuthType = settings.merged.selectedAuthType;
        const forceNewAuth = currentAuthType === authType && authType === AuthType.LOGIN_WITH_GOOGLE;
        
        // Only clear cached credentials if switching to a different auth type
        if (currentAuthType !== authType) {
          await clearCachedCredentialFile();
        }
        
        settings.setValue(scope, 'selectedAuthType', authType);
        
        // Set a flag to force new auth on next refresh
        if (forceNewAuth) {
          // We'll use the config to signal that we want to force new auth
          // by calling refreshAuth with forceNewAuth=true immediately
          try {
            setIsAuthenticating(true);
            await config.refreshAuth(authType, true);
            console.log(`Added new account via "${authType}".`);
            setIsAuthenticating(false);
          } catch (e) {
            setAuthError(`Failed to add new account. Message: ${getErrorMessage(e)}`);
            setIsAuthenticating(false);
            return; // Keep dialog open on error
          }
        }
        
        if (authType === AuthType.LOGIN_WITH_GOOGLE && config.getNoBrowser()) {
          runExitCleanup();
          console.log(
            `
----------------------------------------------------------------
Logging in with Google... Please restart Gemini CLI to continue.
----------------------------------------------------------------
            `,
          );
          process.exit(0);
        }
      }
      setIsAuthDialogOpen(false);
      setAuthError(null);
    },
    [settings, setAuthError, config],
  );

  const cancelAuthentication = useCallback(() => {
    setIsAuthenticating(false);
  }, []);

  return {
    isAuthDialogOpen,
    openAuthDialog,
    handleAuthSelect,
    isAuthenticating,
    cancelAuthentication,
  };
};
