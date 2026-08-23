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
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wechatpost-playwright-'));
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
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wechatpost-playwright-'));
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

  it('fills the first visible matching editor field', async () => {
    const service = new PlaywrightService({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
      name: 'test',
    } as any);

    const absentLocator = { count: jest.fn().mockResolvedValue(0) };
    const hiddenTarget = {
      isVisible: jest.fn().mockResolvedValue(false),
    };
    const matchingTarget = {
      isVisible: jest.fn().mockResolvedValue(true),
      click: jest.fn().mockResolvedValue(undefined),
      fill: jest.fn().mockResolvedValue(undefined),
    };
    const matchingLocator = {
      count: jest.fn().mockResolvedValue(2),
      nth: jest.fn((index: number) => (index === 0 ? hiddenTarget : matchingTarget)),
    };

    await (service as any).fillFirstVisible(
      {},
      'title',
      [
        { name: 'absent', locator: absentLocator },
        { name: 'matching', locator: matchingLocator },
      ],
      'Article title'
    );

    expect(hiddenTarget.isVisible).toHaveBeenCalled();
    expect(matchingTarget.isVisible).toHaveBeenCalled();
    expect(matchingTarget.click).toHaveBeenCalled();
    expect(matchingTarget.fill).toHaveBeenCalledWith('Article title');
  });

  it('fills a hidden backing input through the DOM fallback', async () => {
    const service = new PlaywrightService({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
      name: 'test',
    } as any);

    const hiddenTarget = {
      isVisible: jest.fn().mockResolvedValue(false),
      evaluate: jest.fn().mockResolvedValue(true),
    };
    const hiddenLocator = {
      count: jest.fn().mockResolvedValue(1),
      nth: jest.fn(() => hiddenTarget),
    };

    await (service as any).fillFirstVisible(
      {},
      'title',
      [{ name: 'hidden title textarea', locator: hiddenLocator }],
      'Article title'
    );

    expect(hiddenTarget.evaluate).toHaveBeenCalledWith(expect.any(Function), 'Article title');
  });

  it('fills a hidden backing input using Playwright forced input events', async () => {
    const service = new PlaywrightService({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
      name: 'test',
    } as any);

    const hiddenTarget = {
      isVisible: jest.fn().mockResolvedValue(false),
      fill: jest.fn().mockResolvedValue(undefined),
      dispatchEvent: jest.fn().mockResolvedValue(undefined),
      inputValue: jest.fn().mockResolvedValue('Article title'),
    };
    const hiddenLocator = {
      count: jest.fn().mockResolvedValue(1),
      nth: jest.fn(() => hiddenTarget),
    };

    await (service as any).fillFirstVisible(
      {},
      'title',
      [{ name: 'hidden title textarea', locator: hiddenLocator }],
      'Article title'
    );

    expect(hiddenTarget.fill).toHaveBeenCalledWith('Article title', { force: true });
    expect(hiddenTarget.dispatchEvent).toHaveBeenCalledWith('change');
    expect(hiddenTarget.dispatchEvent).toHaveBeenCalledWith('blur');
  });

  it('removes leading frontmatter before rendering article content', () => {
    const service = new PlaywrightService({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
      name: 'test',
    } as any);

    const markdown = [
      '---',
      'title: Test article',
      'tags: [test]',
      '---',
      '',
      '# Test article',
      '',
      'Article body',
    ].join('\n');

    const withoutFrontmatter = (service as any).stripLeadingFrontmatter(markdown);
    const body = (service as any).stripLeadingTopLevelHeading(withoutFrontmatter);

    expect(body).toBe('Article body');
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

  it('renders mermaid images inline for editor content', async () => {
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
    expect(result.tasks[0].label).toContain('Mermaid Diagram 1');
    expect(result.tasks[0].dataUrl).toBe('data:image/png;base64,AAAA');
    expect(result.html).toContain('MP_MERMAID_UPLOAD_TOKEN_0_');
    expect(result.html).not.toContain('MP_MERMAID_PLACEHOLDER_0');
  });

  it('renders inline figure svg as a preview image', async () => {
    const service = new PlaywrightService({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
      name: 'test',
    } as any);

    jest
      .spyOn(service as any, 'renderSvgMarkupToPngDataUrl')
      .mockResolvedValue('data:image/png;base64,SVGPNG');

    const html = await (service as any).renderMarkdownToWechatHtml(
      '<figure><svg viewBox="0 0 10 10"><rect width="10" height="10" /></svg></figure>',
      contentStyle
    );

    expect(html).toContain('data:image/png;base64,SVGPNG');
    expect(html).not.toContain('MP_INLINE_SVG_PLACEHOLDER_0');
    expect(html).not.toContain('<svg');
  });

  it('renders inline svg images inline for editor content', async () => {
    const service = new PlaywrightService({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
      name: 'test',
    } as any);

    jest.spyOn(service as any, 'renderSvgMarkupToPngDataUrl').mockResolvedValue('data:image/png;base64,SVGPNG');
    jest.spyOn(service as any, 'writeDataUrlToTempPng').mockResolvedValue('/tmp/svg-test.png');

    const result = await (service as any).renderMarkdownToWechatHtmlWithUploadPlan(
      '<figure><svg viewBox="0 0 10 10"><rect width="10" height="10" /></svg></figure>',
      contentStyle
    );

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].label).toContain('Inline SVG 1');
    expect(result.tasks[0].dataUrl).toBe('data:image/png;base64,SVGPNG');
    expect(result.html).toContain('MP_SVG_UPLOAD_TOKEN_0_');
    expect(result.html).not.toContain('MP_INLINE_SVG_PLACEHOLDER_0');
  });

  it('does not build a mermaid upload task when the rendered PNG exceeds WeChat limits', async () => {
    const service = new PlaywrightService({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
      name: 'test',
    } as any);

    const oversizedPngDataUrl = `data:image/png;base64,${Buffer.alloc(901 * 1024).toString('base64')}`;
    jest.spyOn(service as any, 'renderMermaidToPngDataUrl').mockResolvedValue(oversizedPngDataUrl);

    const result = await (service as any).renderMarkdownToWechatHtmlWithUploadPlan(
      '```mermaid\ngraph TD\nA-->B\n```',
      contentStyle
    );

    expect(result.tasks).toHaveLength(0);
    expect(result.html).toContain('language-mermaid');
    expect(result.html).toContain('graph TD');
  });
});
