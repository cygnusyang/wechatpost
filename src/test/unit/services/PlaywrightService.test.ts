import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PlaywrightService } from 'src/services/PlaywrightService';

const mockLaunchPersistentContext = jest.fn();
const mockLaunch = jest.fn();

jest.mock('playwright', () => ({
  chromium: {
    launchPersistentContext: (...args: unknown[]) => mockLaunchPersistentContext(...args),
    launch: (...args: unknown[]) => mockLaunch(...args),
  },
}));

describe('PlaywrightService', () => {
  const contentStyle = {
    themePreset: 'classic',
    bodyFontSize: 16,
    lineHeight: 1.85,
    textColor: '#1f2329',
    headingColor: '#0f172a',
    linkColor: '#0969da',
  } as const;

  const singletonRelPaths = [
    'SingletonLock',
    'SingletonCookie',
    'SingletonSocket',
    'SingletonSocketLock',
    path.join('Default', 'SingletonLock'),
    path.join('Default', 'SingletonCookie'),
    path.join('Default', 'SingletonSocket'),
    path.join('Default', 'SingletonSocketLock'),
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('recovers from ProcessSingleton lock by cleaning stale lock files and retrying once', async () => {
    const processSingletonError = new Error(
      'browserType.launchPersistentContext: Failed to create a ProcessSingleton for your profile directory.'
    );
    const context = {
      once: jest.fn(),
      pages: jest.fn(() => []),
    };

    mockLaunchPersistentContext
      .mockRejectedValueOnce(processSingletonError)
      .mockResolvedValueOnce(context);
    jest.useFakeTimers();

    const service = new PlaywrightService({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
      name: 'test',
    } as any);
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multipost-playwright-'));
    (service as any).userDataDir = userDataDir;
    const singletonPaths = singletonRelPaths.map((relPath) => path.join(userDataDir, relPath));
    for (const singletonPath of singletonPaths) {
      fs.mkdirSync(path.dirname(singletonPath), { recursive: true });
      fs.writeFileSync(singletonPath, 'lock');
    }

    try {
      const launchPromise = (service as any).launchPersistentContextWithRecovery();
      await jest.advanceTimersByTimeAsync(500);
      const launchedContext = await launchPromise;

      expect(launchedContext).toBe(context);
      expect(mockLaunchPersistentContext).toHaveBeenCalledTimes(2);
      for (const singletonPath of singletonPaths) {
        expect(fs.existsSync(singletonPath)).toBe(false);
      }
    } finally {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  it('does not retry for non-ProcessSingleton launch errors', async () => {
    const launchError = new Error('ECONNREFUSED');
    mockLaunchPersistentContext.mockRejectedValueOnce(launchError);

    const service = new PlaywrightService({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
      name: 'test',
    } as any);
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multipost-playwright-'));
    (service as any).userDataDir = userDataDir;
    const probeLockPath = path.join(userDataDir, 'SingletonLock');
    fs.writeFileSync(probeLockPath, 'lock');

    try {
      await expect((service as any).launchPersistentContextWithRecovery()).rejects.toThrow('ECONNREFUSED');
      expect(mockLaunchPersistentContext).toHaveBeenCalledTimes(1);
      expect(fs.existsSync(probeLockPath)).toBe(true);
    } finally {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  it('clicks the new draft creation button before legacy add icon', async () => {
    const service = new PlaywrightService({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
      name: 'test',
    } as any);

    const newCreationButton = { count: jest.fn().mockResolvedValue(1) };
    const legacyAddIcon = { count: jest.fn().mockResolvedValue(1) };
    const absentLocator = { count: jest.fn().mockResolvedValue(0) };
    const page = {
      getByRole: jest.fn((role: string, options: { name: string }) => {
        if (role === 'button' && options.name === '新的创作') {
          return newCreationButton;
        }
        return absentLocator;
      }),
      getByText: jest.fn(() => absentLocator),
      locator: jest.fn(() => legacyAddIcon),
    };
    const clickAndStabilize = jest
      .spyOn(service as any, 'clickAndStabilize')
      .mockResolvedValue(undefined);

    await (service as any).clickNewDraftCreationEntry(page);

    expect(clickAndStabilize).toHaveBeenCalledWith(newCreationButton, page, 8000);
    expect(legacyAddIcon.count).not.toHaveBeenCalled();
  });

  it('falls back to the legacy draft add icon when the new creation entry is unavailable', async () => {
    const service = new PlaywrightService({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
      name: 'test',
    } as any);

    const absentLocator = { count: jest.fn().mockResolvedValue(0) };
    const legacyAddIcon = { count: jest.fn().mockResolvedValue(1) };
    const page = {
      getByRole: jest.fn(() => absentLocator),
      getByText: jest.fn(() => absentLocator),
      locator: jest.fn(() => legacyAddIcon),
    };
    const clickAndStabilize = jest
      .spyOn(service as any, 'clickAndStabilize')
      .mockResolvedValue(undefined);

    await (service as any).clickNewDraftCreationEntry(page);

    expect(clickAndStabilize).toHaveBeenCalledWith(legacyAddIcon, page, 8000);
  });

  it('selects article from the new creation type popup', async () => {
    const service = new PlaywrightService({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
      name: 'test',
    } as any);

    const articleButton = { count: jest.fn().mockResolvedValue(1) };
    const absentLocator = { count: jest.fn().mockResolvedValue(0) };
    const page = {
      getByRole: jest.fn((role: string, options: { name: string }) => {
        if (role === 'button' && options.name === '文章') {
          return articleButton;
        }
        return absentLocator;
      }),
      getByText: jest.fn(() => absentLocator),
    };
    const clickAndStabilize = jest
      .spyOn(service as any, 'clickAndStabilize')
      .mockResolvedValue(undefined);

    await (service as any).clickArticleCreationType(page);

    expect(clickAndStabilize).toHaveBeenCalledWith(articleButton, page, 8000);
  });

  it('uses the popup tab as the article editor page after selecting article', async () => {
    const service = new PlaywrightService({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
      name: 'test',
    } as any);

    const editorPage = {
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
    };
    const page = {
      waitForEvent: jest.fn().mockResolvedValue(editorPage),
    };
    jest.spyOn(service as any, 'clickArticleCreationType').mockResolvedValue(undefined);

    const result = await (service as any).selectArticleCreationTypeAndResolveEditorPage(page);

    expect(result).toBe(editorPage);
    expect(page.waitForEvent).toHaveBeenCalledWith('popup', { timeout: 10000 });
    expect((service as any).clickArticleCreationType).toHaveBeenCalledWith(page);
    expect(editorPage.waitForLoadState).toHaveBeenCalledWith('domcontentloaded', { timeout: 30000 });
  });

  it('falls back to the current page when selecting article does not open a popup tab', async () => {
    const service = new PlaywrightService({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
      name: 'test',
    } as any);

    const page = {
      waitForEvent: jest.fn().mockRejectedValue(new Error('no popup')),
    };
    jest.spyOn(service as any, 'clickArticleCreationType').mockResolvedValue(undefined);

    const result = await (service as any).selectArticleCreationTypeAndResolveEditorPage(page);

    expect(result).toBe(page);
  });

  it('loads mermaid runtime through local-source eval injection', async () => {
    const service = new PlaywrightService({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
      name: 'test',
    } as any);

    const page = {
      evaluate: jest
        .fn()
        .mockResolvedValueOnce(false) // initial runtime check
        .mockResolvedValueOnce(true), // check after eval injection
    };

    jest.spyOn(service as any, 'getMermaidRuntimeSource').mockResolvedValue('window.mermaid = {};');

    const ready = await (service as any).ensureMermaidRuntime(page);
    expect(ready).toBe(true);
    expect((service as any).getMermaidRuntimeSource).toHaveBeenCalledTimes(1);
    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });

  it('renders mermaid on isolated page to avoid editor-page navigation interference', async () => {
    const service = new PlaywrightService({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
      name: 'test',
    } as any);

    mockLaunch.mockRejectedValueOnce(new Error('standalone launch unavailable'));
    const renderPage = {
      goto: jest.fn().mockResolvedValue(undefined),
      evaluate: jest.fn().mockResolvedValue('data:image/png;base64,AAAA'),
      close: jest.fn().mockResolvedValue(undefined),
      isClosed: jest.fn().mockReturnValue(false),
      url: jest.fn().mockReturnValue('about:blank'),
    };

    (service as any).context = {
      newPage: jest.fn().mockResolvedValue(renderPage),
    };
    jest.spyOn(service as any, 'ensureMermaidRuntime').mockResolvedValue(true);

    const result = await (service as any).renderMermaidToPngDataUrl('graph TD\nA-->B');

    expect(result).toBe('data:image/png;base64,AAAA');
    expect((service as any).context.newPage).toHaveBeenCalledTimes(1);
    expect(renderPage.goto).toHaveBeenCalledTimes(1);
    expect(renderPage.evaluate).toHaveBeenCalledTimes(1);
    expect(renderPage.close).toHaveBeenCalledTimes(1);
  });

  it('replaces mermaid placeholders with rendered image html', async () => {
    const service = new PlaywrightService({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
      name: 'test',
    } as any);

    jest
      .spyOn(service as any, 'renderMermaidToPngDataUrl')
      .mockResolvedValue('data:image/png;base64,AAAA');

    const html = await (service as any).renderMarkdownToWechatHtml(
      '```mermaid\ngraph TD\nA-->B\n```',
      contentStyle
    );

    expect(html).toContain('data:image/png;base64,AAAA');
    expect(html).not.toContain('MP_MERMAID_PLACEHOLDER_0');
  });

  it('falls back to mermaid code block when rendering fails', async () => {
    const service = new PlaywrightService({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
      name: 'test',
    } as any);

    jest.spyOn(service as any, 'renderMermaidToPngDataUrl').mockResolvedValue(null);

    const html = await (service as any).renderMarkdownToWechatHtml(
      '```mermaid\ngraph TD\nA-->B\n```',
      contentStyle
    );

    expect(html).toContain('language-mermaid');
    expect(html).toContain('graph TD');
  });

  it('builds upload plan with token placeholders for mermaid images', async () => {
    const service = new PlaywrightService({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
      name: 'test',
    } as any);

    jest.spyOn(service as any, 'renderMermaidToPngDataUrl').mockResolvedValue('data:image/png;base64,AAAA');
    jest.spyOn(service as any, 'writeDataUrlToTempPng').mockResolvedValue('/tmp/mermaid-test.png');

    const result = await (service as any).renderMarkdownToWechatHtmlWithUploadPlan(
      '```mermaid\ngraph TD\nA-->B\n```',
      contentStyle
    );

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].filePath).toBe('/tmp/mermaid-test.png');
    expect(result.tasks[0].token).toContain('MP_MERMAID_UPLOAD_TOKEN_0_');
    expect(result.html).toContain(result.tasks[0].token);
    expect(result.html).not.toContain('MP_MERMAID_PLACEHOLDER_0');
  });
});
