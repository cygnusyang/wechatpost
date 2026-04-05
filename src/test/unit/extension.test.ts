import * as vscode from 'vscode';
import { CookieParam } from 'puppeteer';
import { activate, deactivate } from 'src/extension';
import { processMarkdownForUpload } from 'src/utils/processMarkdown';

const mockWeChatService: any = {
  loadAuthFromStorage: jest.fn().mockResolvedValue(undefined),
  clearAuth: jest.fn(),
  getAuthInfo: jest.fn(() => null),
  checkAuthWithCookies: jest.fn(),
  checkAuth: jest.fn(),
  createDraft: jest.fn(),
};

const mockPreviewService: any = {
  openPreview: jest.fn(),
  updateAuthStatus: jest.fn(),
  setMessageHandler: jest.fn(),
};

const mockSettingsService: any = {
  getDefaultAuthor: jest.fn(() => 'Default Author'),
  shouldAutoOpenDraft: jest.fn(() => true),
};

const mockChromeCdpService: any = {
  startFirstTimeLogin: jest.fn(),
  startAuthenticatedSession: jest.fn(),
  createDraftInBrowser: jest.fn(),
  isSessionActive: jest.fn(() => false),
};

jest.mock('src/services/WeChatService', () => ({
  WeChatService: jest.fn(() => mockWeChatService),
}));

jest.mock('src/services/PreviewService', () => ({
  PreviewService: jest.fn(() => mockPreviewService),
}));

jest.mock('src/services/SettingsService', () => ({
  SettingsService: jest.fn(() => mockSettingsService),
}));

jest.mock('src/services/ChromeCDPService', () => ({
  ChromeCDPService: jest.fn(() => mockChromeCdpService),
}));

jest.mock('src/utils/extractTitle', () => ({
  extractTitle: jest.fn(() => 'Extracted Title'),
}));

jest.mock('src/utils/processMarkdown', () => ({
  processMarkdownForUpload: jest.fn(async () => ({ html: '<p>rendered</p>', errors: [] })),
}));

describe('extension', () => {
  let mockContext: vscode.ExtensionContext;
  let registeredCommands: Map<string, (...args: any[]) => any>;

  beforeEach(() => {
    registeredCommands = new Map();
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
    (vscode.window as any).activeTextEditor = undefined;
    (vscode.commands.registerCommand as jest.Mock).mockImplementation((id, callback) => {
      registeredCommands.set(id, callback);
      return { dispose: jest.fn() };
    });
    (vscode.window.createOutputChannel as jest.Mock).mockReturnValue({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
    });
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue(undefined);
    (vscode.window.withProgress as jest.Mock).mockImplementation((_, task) => task({ report: jest.fn() }));
    (vscode.Uri.parse as jest.Mock).mockImplementation((value: string) => value);
    mockWeChatService.getAuthInfo.mockReturnValue(null);
    mockChromeCdpService.isSessionActive.mockReturnValue(false);
    mockWeChatService.loadAuthFromStorage.mockResolvedValue(undefined);
    mockWeChatService.checkAuth.mockResolvedValue({ isAuthenticated: true });
    mockWeChatService.checkAuthWithCookies.mockResolvedValue({ isAuthenticated: true, authInfo: { nickName: 'Tester' } });
    mockWeChatService.createDraft.mockResolvedValue({ success: true, draftUrl: 'https://example.com/draft' });
    mockChromeCdpService.startFirstTimeLogin.mockResolvedValue([{ name: 'token', value: 'x', domain: '.mp.weixin.qq.com', path: '/' }]);
    mockChromeCdpService.startAuthenticatedSession.mockResolvedValue(undefined);
    mockChromeCdpService.createDraftInBrowser.mockResolvedValue('https://example.com/browser-draft');
    (processMarkdownForUpload as jest.Mock).mockResolvedValue({ html: '<p>rendered</p>', errors: [] });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should activate without error', async () => {
    await expect(activate(mockContext)).resolves.not.toThrow();
    expect(vscode.commands.registerCommand).toHaveBeenCalledTimes(4);
    expect(mockContext.subscriptions).toHaveLength(5);
  });

  it('should deactivate without error', () => {
    expect(() => deactivate()).not.toThrow();
  });

  it('should wire webview message handler for upload and copy', async () => {
    await activate(mockContext);
    const handler = mockPreviewService.setMessageHandler.mock.calls[0][0];

    await handler({ type: 'uploadToWeChat' });
    await handler({ type: 'copyHtml', html: '<p>x</p>' });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('multipost.uploadToWeChat');
    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('<p>x</p>');
  });

  it('should open preview for active editor', async () => {
    await activate(mockContext);
    (vscode.window as any).activeTextEditor = {
      document: {
        getText: () => '# Hello',
      },
    };

    registeredCommands.get('multipost.preview')!();

    expect(mockPreviewService.openPreview).toHaveBeenCalledWith('# Hello');
    expect(mockPreviewService.updateAuthStatus).toHaveBeenCalledWith(false, undefined);
  });

  it('should show error when preview runs without active editor', async () => {
    await activate(mockContext);

    registeredCommands.get('multipost.preview')!();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('No active editor');
  });

  it('should show error when chrome cdp command runs without active editor', async () => {
    await activate(mockContext);

    await registeredCommands.get('multipost.loginWeChatChromeCdp')!();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('No active editor');
  });

  it('should run chrome cdp command with saved auth cookies', async () => {
    await activate(mockContext);
    const report = jest.fn();
    (vscode.window.withProgress as jest.Mock).mockImplementation((_, task) => task({ report }));
    (vscode.window as any).activeTextEditor = {
      document: {
        getText: () => '# Title',
        fileName: '/tmp/demo.md',
      },
    };
    mockWeChatService.getAuthInfo.mockReturnValue({
      nickName: 'Tester',
      cookies: [{ name: 'token', value: 'x', domain: '.mp.weixin.qq.com', path: '/' }],
    });
    mockChromeCdpService.startAuthenticatedSession.mockResolvedValue(undefined);
    mockChromeCdpService.createDraftInBrowser.mockResolvedValue('https://example.com/browser-draft');

    await registeredCommands.get('multipost.loginWeChatChromeCdp')!();

    expect(mockChromeCdpService.startAuthenticatedSession).toHaveBeenCalled();
    expect(mockChromeCdpService.createDraftInBrowser).toHaveBeenCalled();
    expect(report).toHaveBeenCalled();
  });

  it('should stop cdp flow when login validation fails', async () => {
    await activate(mockContext);
    (vscode.window as any).activeTextEditor = {
      document: {
        getText: () => '# Title',
        fileName: '/tmp/demo.md',
      },
    };
    mockWeChatService.getAuthInfo.mockReturnValue(null);
    mockChromeCdpService.isSessionActive.mockReturnValue(false);
    mockChromeCdpService.startFirstTimeLogin.mockResolvedValue([{ name: 'token', value: 'x', domain: '.mp.weixin.qq.com', path: '/' }]);
    mockWeChatService.checkAuthWithCookies.mockResolvedValue({ isAuthenticated: false });

    await registeredCommands.get('multipost.loginWeChatChromeCdp')!();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Login failed. Please try again.');
  });

  it('should show error when upload runs without active editor', async () => {
    await activate(mockContext);

    await registeredCommands.get('multipost.uploadToWeChat')!();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('No active editor');
  });

  it('should logout and update preview auth status', async () => {
    await activate(mockContext);

    await registeredCommands.get('multipost.logoutWeChat')!();

    expect(mockWeChatService.clearAuth).toHaveBeenCalled();
    expect(mockPreviewService.updateAuthStatus).toHaveBeenCalledWith(false, undefined);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Logged out from MultiPost');
  });

  it('should show login failure during upload after cdp login', async () => {
    await activate(mockContext);
    const cookies = [{ name: 'token', value: 'x', domain: '.mp.weixin.qq.com', path: '/' }] as CookieParam[];
    (vscode.window as any).activeTextEditor = {
      document: {
        getText: () => '# Title',
        fileName: '/tmp/demo.md',
      },
    };
    mockWeChatService.getAuthInfo.mockReturnValue(null);
    mockChromeCdpService.startFirstTimeLogin.mockResolvedValue(cookies);
    mockWeChatService.checkAuthWithCookies.mockResolvedValue({ isAuthenticated: false });

    await registeredCommands.get('multipost.uploadToWeChat')!();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Login failed. Please try again.');
  });

  it('should show warning when markdown processing returns errors', async () => {
    await activate(mockContext);
    (vscode.window as any).activeTextEditor = {
      document: {
        getText: () => '# Title',
        fileName: '/tmp/demo.md',
      },
    };
    mockWeChatService.getAuthInfo.mockReturnValue({ nickName: 'Tester' });
    mockWeChatService.checkAuth.mockResolvedValue({ isAuthenticated: true });
    mockWeChatService.createDraft.mockResolvedValue({
      success: true,
      draftUrl: 'https://example.com/draft',
    });
    (processMarkdownForUpload as jest.Mock).mockResolvedValue({
      html: '<p>rendered</p>',
      errors: ['boom'],
    });

    await registeredCommands.get('multipost.uploadToWeChat')!();

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('Processing completed with 1 errors: boom');
  });

  it('should show upload error when markdown processing throws', async () => {
    await activate(mockContext);
    (vscode.window as any).activeTextEditor = {
      document: {
        getText: () => '# Title',
        fileName: '/tmp/demo.md',
      },
    };
    mockWeChatService.getAuthInfo.mockReturnValue({ nickName: 'Tester' });
    mockWeChatService.checkAuth.mockResolvedValue({ isAuthenticated: true });
    (processMarkdownForUpload as jest.Mock).mockRejectedValue(new Error('processor failed'));

    await registeredCommands.get('multipost.uploadToWeChat')!();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('CDP upload failed: processor failed');
  });

  it('should keep cdp session when already active during automated upload', async () => {
    await activate(mockContext);
    const report = jest.fn();
    (vscode.window.withProgress as jest.Mock).mockImplementation((_, task) => task({ report }));
    (vscode.window as any).activeTextEditor = {
      document: {
        getText: () => '# Title',
        fileName: '/tmp/demo.md',
      },
    };
    mockWeChatService.getAuthInfo.mockReturnValue(null);
    mockChromeCdpService.isSessionActive.mockReturnValue(true);
    mockChromeCdpService.createDraftInBrowser.mockResolvedValue('https://example.com/browser-draft');

    await registeredCommands.get('multipost.loginWeChatChromeCdp')!();

    expect(mockChromeCdpService.startFirstTimeLogin).not.toHaveBeenCalled();
    expect(mockChromeCdpService.createDraftInBrowser).toHaveBeenCalled();
  });

  it('should surface background auth load failure as warning log path', async () => {
    mockWeChatService.loadAuthFromStorage.mockRejectedValueOnce(new Error('load failed'));

    await activate(mockContext);
    await Promise.resolve();

    expect(mockPreviewService.updateAuthStatus).not.toHaveBeenCalledWith(true, expect.anything());
  });

  it('should start CDP login before upload when not authenticated', async () => {
    await activate(mockContext);
    const cookies = [{ name: 'token', value: 'x', domain: '.mp.weixin.qq.com', path: '/' }] as CookieParam[];
    (vscode.window as any).activeTextEditor = {
      document: {
        getText: () => '# Title',
        fileName: '/tmp/demo.md',
      },
    };
    mockWeChatService.getAuthInfo.mockReturnValue(null);
    mockChromeCdpService.startFirstTimeLogin.mockResolvedValue(cookies);
    mockWeChatService.checkAuthWithCookies.mockResolvedValue({
      isAuthenticated: true,
      authInfo: { nickName: 'Tester' },
    });
    mockWeChatService.createDraft.mockResolvedValue({
      success: true,
      draftUrl: 'https://example.com/draft',
    });

    await registeredCommands.get('multipost.uploadToWeChat')!();

    expect(mockChromeCdpService.startFirstTimeLogin).toHaveBeenCalled();
    expect(mockWeChatService.checkAuthWithCookies).toHaveBeenCalledWith(cookies);
  });

  it('should create draft in browser when CDP session is active', async () => {
    await activate(mockContext);
    (vscode.window as any).activeTextEditor = {
      document: {
        getText: () => '# Title',
        fileName: '/tmp/demo.md',
      },
    };
    mockWeChatService.getAuthInfo.mockReturnValue({ nickName: 'Tester' });
    mockWeChatService.checkAuth.mockResolvedValue({ isAuthenticated: true });
    mockChromeCdpService.isSessionActive.mockReturnValue(true);
    mockChromeCdpService.createDraftInBrowser.mockResolvedValue('https://example.com/browser-draft');

    await registeredCommands.get('multipost.uploadToWeChat')!();

    expect(mockChromeCdpService.createDraftInBrowser).toHaveBeenCalledWith(
      'Extracted Title',
      'Default Author',
      '<p>rendered</p>',
      'rendered'
    );
  });
});
