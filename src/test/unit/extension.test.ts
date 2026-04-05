// Mock unified and related modules before importing extension
jest.mock('unified', () => ({
  unified: jest.fn(() => ({
    use: jest.fn().mockReturnThis(),
    process: jest.fn(async () => ({
      toString: () => '<html></html>',
    })),
  })),
}));
jest.mock('remark-parse', () => jest.fn());
jest.mock('remark-gfm', () => jest.fn());
jest.mock('remark-rehype', () => jest.fn());
jest.mock('rehype-highlight', () => jest.fn());
jest.mock('rehype-stringify', () => jest.fn());

// Mock vscode modules
jest.mock('vscode', () => {
  const original = jest.requireActual('vscode');
  return {
    ...original,
    window: {
      ...original.window,
      showErrorMessage: jest.fn(),
      showInformationMessage: jest.fn(),
      showWarningMessage: jest.fn(),
      showInputBox: jest.fn().mockResolvedValue(undefined),
      createOutputChannel: jest.fn(),
      withProgress: jest.fn((_, cb) => cb()),
      createWebviewPanel: jest.fn(),
    },
    commands: {
      registerCommand: jest.fn(),
      executeCommand: jest.fn(),
    },
    env: {
      openExternal: jest.fn(),
      clipboard: {
        writeText: jest.fn(),
      },
    },
    Uri: {
      file: jest.fn((path) => ({ path })),
      parse: jest.fn(),
    },
  };
});

import * as vscode from 'vscode';
import { activate, deactivate } from 'src/extension';

describe('extension', () => {
  let mockContext: vscode.ExtensionContext;

  beforeEach(() => {
    mockContext = {
      extensionUri: vscode.Uri.file('/test/extension'),
      secrets: {
        get: jest.fn(),
        store: jest.fn(),
        delete: jest.fn(),
        onDidChange: jest.fn(),
      } as unknown as vscode.SecretStorage,
      subscriptions: [],
      extensionPath: '',
      globalState: {
        get: jest.fn(),
        update: jest.fn(),
        setKeysForSync: jest.fn(),
        keys: jest.fn(() => []),
      },
      workspaceState: {
        get: jest.fn(),
        update: jest.fn(),
        keys: jest.fn(() => []),
      },
      storageUri: undefined,
      storagePath: undefined,
      globalStorageUri: undefined as any,
      globalStoragePath: '',
      logUri: undefined as any,
      logPath: '',
      asAbsolutePath: jest.fn((path) => path),
      // Add required missing properties
      environmentVariableCollection: {} as any,
      extensionMode: 1,
      extension: undefined as any,
      languageModelAccessInformation: undefined as any,
    } as vscode.ExtensionContext;

    jest.clearAllMocks();
  });

  it('should activate without error', async () => {
    await expect(activate(mockContext)).resolves.not.toThrow();
    // Should have registered all 5 commands
    expect(vscode.commands.registerCommand).toHaveBeenCalledTimes(5);
    // Output channel plus 5 commands should be pushed to subscriptions
    expect(mockContext.subscriptions).toHaveLength(6);

    // Get all the command callbacks and invoke them to get coverage
    const registerCommandCalls = (vscode.commands.registerCommand as jest.Mock).mock.calls;

    // Test preview command with no active editor
    const previewCallback = registerCommandCalls[0][1];
    previewCallback();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('No active editor');

    // Since no active editor, updatePreviewAuthStatus shouldn't error
    expect(previewCallback).not.toThrow();

    // Test login command - should handle no active editor
    const loginCallback = registerCommandCalls[3][1];
    loginCallback();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('No active editor');
    // Should not throw even though fetch will fail in mock

    // Test logout command - should clear auth and show message
    const logoutCallback = registerCommandCalls[1][1];
    logoutCallback();
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();

    // Test input cookie command - should show input box
    const inputCookieCallback = registerCommandCalls[2][1];
    inputCookieCallback();
    // Should not throw even when user cancels

    // Test upload command with no active editor
    const uploadCallback = registerCommandCalls[4][1];
    uploadCallback();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('No active editor');
  });

  it('should deactivate without error', () => {
    expect(() => deactivate()).not.toThrow();
  });
});
