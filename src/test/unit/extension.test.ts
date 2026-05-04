import * as vscode from 'vscode';
import { activate, deactivate } from 'src/extension';
import { SettingsService } from 'src/services/SettingsService';
import { PlaywrightService } from 'src/services/PlaywrightService';
import { extractTitle } from 'src/utils/extractTitle';

jest.mock('src/services/SettingsService');
jest.mock('src/services/PlaywrightService');
jest.mock('src/utils/extractTitle', () => ({
  extractTitle: jest.fn(),
}));

describe('extension', () => {
  let registeredCommands: Map<string, (...args: any[]) => unknown>;
  let mockContext: vscode.ExtensionContext;

  const mockGetSettings = jest.fn(() => ({
    defaultAuthor: 'Default Author',
    digestLength: 120,
    declareOriginal: true,
    enableAppreciation: true,
    defaultCollection: '智能体',
    publishDirectly: true,
    contentStyle: {
      themePreset: 'classic',
      bodyFontSize: 16,
      lineHeight: 1.85,
      textColor: '#1f2329',
      headingColor: '#0f172a',
      linkColor: '#0969da',
    },
  }));
  const mockUpdateSettings = jest.fn().mockResolvedValue(undefined);
  const mockStartFirstTimeLogin = jest.fn().mockResolvedValue(undefined);
  const mockHasSavedLogin = jest.fn().mockResolvedValue(false);
  const mockRestoreLogin = jest.fn().mockResolvedValue(undefined);
  const mockCreateDraftInBrowser = jest.fn().mockResolvedValue('https://example.com/draft');
  const mockRenderMarkdownPreview = jest.fn().mockResolvedValue('<section><p>Preview</p></section>');
  const mockIsSessionActive = jest.fn(() => false);
  const mockClose = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    registeredCommands = new Map();
    mockContext = {
      extensionPath: '/test/extension',
      extensionUri: { toString: () => 'file:///test/extension' },
      subscriptions: [] as { dispose: () => void }[],
    } as unknown as vscode.ExtensionContext;

    jest.clearAllMocks();

    (vscode.commands.registerCommand as jest.Mock).mockImplementation((id, callback) => {
      registeredCommands.set(id, callback);
      return { dispose: jest.fn() };
    });

    (vscode.window.createOutputChannel as jest.Mock).mockReturnValue({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
    });

    (vscode.window.withProgress as jest.Mock).mockImplementation(async (_options, task) => {
      return task({ report: jest.fn() });
    });

    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);
    (vscode.window.showErrorMessage as jest.Mock).mockResolvedValue(undefined);
    (vscode.window.showInputBox as jest.Mock).mockResolvedValue(undefined);
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);
    (vscode.window as any).activeTextEditor = undefined;

    (SettingsService as jest.Mock).mockImplementation(() => ({
      getSettings: mockGetSettings,
      updateSettings: mockUpdateSettings,
    }));

    (PlaywrightService as jest.Mock).mockImplementation(() => ({
      startFirstTimeLogin: mockStartFirstTimeLogin,
      hasSavedLogin: mockHasSavedLogin,
      restoreLogin: mockRestoreLogin,
      createDraftInBrowser: mockCreateDraftInBrowser,
      renderMarkdownPreview: mockRenderMarkdownPreview,
      isSessionActive: mockIsSessionActive,
      close: mockClose,
    }));

    (extractTitle as jest.Mock).mockReturnValue('Extracted Title');
  });

  afterEach(() => {
    (vscode.window as any).activeTextEditor = undefined;
  });

  it('registers upload, logout, preview and configure commands', async () => {
    await activate(mockContext);

    expect(vscode.commands.registerCommand).toHaveBeenCalledTimes(4);
    expect(registeredCommands.has('wechatpost.uploadToWeChat')).toBe(true);
    expect(registeredCommands.has('wechatpost.logoutWeChat')).toBe(true);
    expect(registeredCommands.has('wechatpost.preview')).toBe(true);
    expect(registeredCommands.has('wechatpost.configurePublishOptions')).toBe(true);
  });

  it('opens preview webview for active markdown editor', async () => {
    await activate(mockContext);

    (vscode.window as any).activeTextEditor = {
      document: {
        getText: () => '# Test Title\n\nBody',
        fileName: '/tmp/demo.md',
      },
    };

    await registeredCommands.get('wechatpost.preview')!();

    expect(mockRenderMarkdownPreview).toHaveBeenCalledWith(
      '# Test Title\n\nBody',
      {
        themePreset: 'classic',
        bodyFontSize: 16,
        lineHeight: 1.85,
        textColor: '#1f2329',
        headingColor: '#0f172a',
        linkColor: '#0969da',
      }
    );
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it('shows error when upload runs without active editor', async () => {
    await activate(mockContext);

    await registeredCommands.get('wechatpost.uploadToWeChat')!();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('No active editor');
  });

  it('performs login and creates draft when session is not active', async () => {
    await activate(mockContext);

    (vscode.window as any).activeTextEditor = {
      document: {
        getText: () => '# Test Title\n\nBody',
        fileName: '/tmp/demo.md',
      },
    };

    await registeredCommands.get('wechatpost.uploadToWeChat')!();

    expect(mockStartFirstTimeLogin).toHaveBeenCalledTimes(1);
    expect(mockCreateDraftInBrowser).toHaveBeenCalledWith(
      'Extracted Title',
      'Default Author',
      '# Test Title\n\nBody',
      '# Test Title\n\nBody',
      true,
      true,
      '智能体',
      true,
      {
        themePreset: 'classic',
        bodyFontSize: 16,
        lineHeight: 1.85,
        textColor: '#1f2329',
        headingColor: '#0f172a',
        linkColor: '#0969da',
      }
    );
  });

  it('saves publish options from configure command', async () => {
    await activate(mockContext);

    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('Alice')
      .mockResolvedValueOnce('智能体')
      .mockResolvedValueOnce('80')
      .mockResolvedValueOnce('17')
      .mockResolvedValueOnce('1.9')
      .mockResolvedValueOnce('#222222')
      .mockResolvedValueOnce('#111111')
      .mockResolvedValueOnce('#0077cc');

    (vscode.window.showQuickPick as jest.Mock)
      .mockResolvedValueOnce({ label: '经典 (classic)', value: 'classic' })
      .mockResolvedValueOnce({ label: '是', value: true })
      .mockResolvedValueOnce({ label: '否', value: false })
      .mockResolvedValueOnce({ label: '是', value: true });

    await registeredCommands.get('wechatpost.configurePublishOptions')!();

    expect(mockUpdateSettings).toHaveBeenCalledWith({
      defaultAuthor: 'Alice',
      defaultCollection: '智能体',
      digestLength: 80,
      declareOriginal: true,
      enableAppreciation: false,
      publishDirectly: true,
      contentStyle: {
        themePreset: 'classic',
        bodyFontSize: 17,
        lineHeight: 1.9,
        textColor: '#222222',
        headingColor: '#111111',
        linkColor: '#0077cc',
      },
    });
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('WeChatPost 发布选项已保存');
  });

  it('logs out by closing playwright session', async () => {
    await activate(mockContext);

    await registeredCommands.get('wechatpost.logoutWeChat')!();

    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Logged out from WeChatPost');
  });

  it('deactivate closes playwright session when initialized', async () => {
    await activate(mockContext);

    deactivate();

    expect(mockClose).toHaveBeenCalled();
  });
});
