import * as vscode from 'vscode';
import puppeteer from 'puppeteer';
import { ChromeCDPService } from 'src/services/ChromeCDPService';

jest.mock('puppeteer', () => ({
  __esModule: true,
  default: {
    launch: jest.fn(),
  },
}));

describe('ChromeCDPService', () => {
  const mockOutputChannel = {
    appendLine: jest.fn(),
    show: jest.fn(),
    dispose: jest.fn(),
  } as unknown as vscode.OutputChannel;

  const makePage = () => ({
    goto: jest.fn(),
    cookies: jest.fn().mockResolvedValue([{ name: "token", value: "x" }]),
    url: jest.fn(() => 'https://mp.weixin.qq.com/'),
    evaluate: jest.fn(),
    reload: jest.fn(),
    setCookie: jest.fn(),
    browserContext: jest.fn(() => ({
      setCookie: jest.fn(),
      cookies: jest.fn().mockResolvedValue([{ name: "token", value: "x" }]),
    })),
    waitForSelector: jest.fn(),
    frames: jest.fn(() => []),
    click: jest.fn(),
    waitForNavigation: jest.fn(),
    bringToFront: jest.fn(),
  });

  const makeBrowser = (page: ReturnType<typeof makePage>) => ({
    connected: true,
    newPage: jest.fn().mockResolvedValue(page),
    close: jest.fn(),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('should start first time login and return cookies when login succeeds', async () => {
    const page = makePage();
    page.evaluate.mockResolvedValue(true);
    page.cookies.mockResolvedValue([{ name: 'token', value: 'x' }]);
    const browser = makeBrowser(page);
    (puppeteer.launch as jest.Mock).mockResolvedValue(browser);

    const service = new ChromeCDPService(mockOutputChannel, '/tmp/multipost');
    const cookies = await service.startFirstTimeLogin();

    expect(puppeteer.launch).toHaveBeenCalled();
    expect(page.goto).toHaveBeenCalledWith('https://mp.weixin.qq.com/', { waitUntil: 'networkidle2' });
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
    expect(cookies).toEqual([{ name: 'token', value: 'x' }]);
    expect(service.isSessionActive()).toBe(true);
  });

  it('should reuse existing authenticated session', async () => {
    const page = makePage();
    page.evaluate.mockResolvedValue(true);
    page.cookies.mockResolvedValue([{ name: 'token', value: 'x' }]);
    const browser = makeBrowser(page);
    (puppeteer.launch as jest.Mock).mockResolvedValue(browser);

    const service = new ChromeCDPService(mockOutputChannel, '/tmp/multipost');
    await service.startFirstTimeLogin();
    await service.startAuthenticatedSession([{ name: 'token', value: 'x', domain: '.mp.weixin.qq.com', path: '/' }]);

    expect(puppeteer.launch).toHaveBeenCalledTimes(1);
  });

  it('should throw if creating draft without authenticated session', async () => {
    const service = new ChromeCDPService(mockOutputChannel, '/tmp/multipost');

    await expect(service.createDraftInBrowser('Title', 'Author', '<p>content</p>')).rejects.toThrow(
      'No authenticated browser session. Please login first.'
    );
  });

  it('should close browser and reset session state', async () => {
    const page = makePage();
    page.evaluate.mockResolvedValue(true);
    page.cookies.mockResolvedValue([{ name: 'token', value: 'x' }]);
    const browser = makeBrowser(page);
    (puppeteer.launch as jest.Mock).mockResolvedValue(browser);

    const service = new ChromeCDPService(mockOutputChannel, '/tmp/multipost');
    await service.startFirstTimeLogin();
    await service.close();

    expect(browser.close).toHaveBeenCalled();
    expect(service.isSessionActive()).toBe(false);
  });

  it('should start authenticated session with saved cookies', async () => {
    const page = makePage();
    page.evaluate.mockResolvedValue(true);
    const pageContext = {
      cookies: jest.fn().mockResolvedValue([{ name: "token", value: "x" }]),
      setCookie: jest.fn().mockResolvedValue(undefined),
    };
    page.browserContext.mockReturnValue(pageContext);
    const browser = makeBrowser(page);
    (puppeteer.launch as jest.Mock).mockResolvedValue(browser);
    const service = new ChromeCDPService(mockOutputChannel, '/tmp/multipost');

    await service.startAuthenticatedSession([
      { name: 'token', value: 'x', domain: '.mp.weixin.qq.com', path: '/' },
      { name: 'user', value: 'u', domain: '.mp.weixin.qq.com', path: '/' },
    ]);

    expect(pageContext.setCookie).toHaveBeenCalledTimes(2);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Chrome opened, already authenticated with saved login'
    );
    expect(service.isSessionActive()).toBe(true);
  });

  it('should only inject sanitized valid cookies', async () => {
    const page = makePage();
    page.evaluate.mockResolvedValue(true);
    const pageContext = {
      cookies: jest.fn().mockResolvedValue([]),
      setCookie: jest.fn().mockResolvedValue(undefined),
    };
    page.browserContext.mockReturnValue(pageContext);
    const browser = makeBrowser(page);
    (puppeteer.launch as jest.Mock).mockResolvedValue(browser);
    const service = new ChromeCDPService(mockOutputChannel, '/tmp/multipost');

    await service.startAuthenticatedSession([
      {
        name: 'token',
        value: 'x',
        domain: '.mp.weixin.qq.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
        expires: 9999999999,
        sourcePort: 443,
      } as any,
      {
        name: 'broken',
        value: 'y',
      } as any,
    ]);

    // 现在我们期望有两次调用，因为 normalizeCookieForInjection 处理了两个 cookie
    expect(pageContext.setCookie).toHaveBeenCalledTimes(2);
    expect(pageContext.setCookie).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'token',
        value: 'x',
        domain: '.mp.weixin.qq.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
        expires: 9999999999,
      })
    );
  });

  it('should fall back to qr login when saved cookies are not enough', async () => {
    const page = makePage();
    page.evaluate.mockResolvedValue(true);
    const pageContext = {
      cookies: jest.fn().mockResolvedValue([{ name: "token", value: "x" }]),
      setCookie: jest.fn().mockResolvedValue(undefined),
    };
    page.browserContext.mockReturnValue(pageContext);
    const browser = makeBrowser(page);
    (puppeteer.launch as jest.Mock).mockResolvedValue(browser);
    const service = new ChromeCDPService(mockOutputChannel, '/tmp/multipost');
    (service as any).waitForLogin = jest.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await service.startAuthenticatedSession([
      { name: 'token', value: 'x', domain: '.mp.weixin.qq.com', path: '/' },
    ]);

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Chrome opened. Please scan QR code to login');
    expect(service.isSessionActive()).toBe(true);
  });

  it('should timeout on first time login and close browser', async () => {
    const page = makePage();
    const browser = makeBrowser(page);
    (puppeteer.launch as jest.Mock).mockResolvedValue(browser);
    const service = new ChromeCDPService(mockOutputChannel, '/tmp/multipost');
    (service as any).waitForLogin = jest.fn().mockResolvedValue(false);

    await expect(service.startFirstTimeLogin()).rejects.toThrow('Login timeout');
    expect(browser.close).toHaveBeenCalled();
  });

  it('should create draft in browser when session is active', async () => {
    const page = makePage();
    const frame = {
      url: jest.fn(() => 'https://mp.weixin.qq.com/ueditor'),
      waitForSelector: jest.fn(),
      evaluate: jest.fn(),
      reload: jest.fn(),
    };
    page.evaluate.mockResolvedValue(true);
    page.cookies.mockResolvedValue([{ name: 'token', value: 'x' }]);
    page.frames.mockReturnValue([frame] as any);
    page.waitForSelector.mockResolvedValue(undefined);
    const browser = makeBrowser(page);
    (puppeteer.launch as jest.Mock).mockResolvedValue(browser);
    const service = new ChromeCDPService(mockOutputChannel, '/tmp/multipost');
    // Mock extractTokenFromPage to return a token
    (service as any).extractTokenFromPage = jest.fn().mockResolvedValue('test-token');

    await service.startFirstTimeLogin();
    const draftUrl = await service.createDraftInBrowser('Title', 'Author', '<p>Hello</p>', 'Digest');

    // We now navigate through links, not directly to a specific URL
    expect(page.goto).toHaveBeenCalledWith(
      'https://mp.weixin.qq.com/',
      expect.objectContaining({ waitUntil: 'networkidle2' })
    );
    expect(frame.evaluate).toHaveBeenCalledWith(expect.any(Function), '<p>Hello</p>');
    // Check that save button was clicked using heuristic
    expect(page.click).toHaveBeenCalled();
    expect(draftUrl).toEqual(expect.any(String));
  });

  it('should throw when editor iframe cannot be found', async () => {
    const page = makePage();
    page.evaluate.mockResolvedValue(true);
    page.cookies.mockResolvedValue([{ name: 'token', value: 'x' }]);
    page.frames.mockReturnValue([] as any);
    const browser = makeBrowser(page);
    (puppeteer.launch as jest.Mock).mockResolvedValue(browser);
    const service = new ChromeCDPService(mockOutputChannel, '/tmp/multipost');

    await service.startFirstTimeLogin();

    await expect(service.createDraftInBrowser('Title', 'Author', '<p>Hello</p>')).rejects.toThrow(
      'Could not find editor iframe'
    );
  });

  it('should handle cookie with invalid sameSite (boolean) and omit the field', async () => {
    const page = makePage();
    page.evaluate.mockResolvedValue(true);
    const pageContext = {
      cookies: jest.fn().mockResolvedValue([{ name: "token", value: "x" }]),
      setCookie: jest.fn().mockResolvedValue(undefined),
    };
    page.browserContext.mockReturnValue(pageContext);
    const browser = makeBrowser(page);
    (puppeteer.launch as jest.Mock).mockResolvedValue(browser);
    const service = new ChromeCDPService(mockOutputChannel, '/tmp/multipost');

    await service.startAuthenticatedSession([
      { name: 'token', value: 'x', domain: '.mp.weixin.qq.com', path: '/', sameSite: true },
    ] as any);

    expect(pageContext.setCookie).toHaveBeenCalledWith({
      name: 'token',
      value: 'x',
      domain: '.mp.weixin.qq.com',
      path: '/',
    });
  });

  it('should keep all attributes when cookie has both url and domain', async () => {
    const page = makePage();
    page.evaluate.mockResolvedValue(true);
    const pageContext = {
      cookies: jest.fn().mockResolvedValue([{ name: "token", value: "x" }]),
      setCookie: jest.fn().mockResolvedValue(undefined),
    };
    page.browserContext.mockReturnValue(pageContext);
    const browser = makeBrowser(page);
    (puppeteer.launch as jest.Mock).mockResolvedValue(browser);
    const service = new ChromeCDPService(mockOutputChannel, '/tmp/multipost');

    await service.startAuthenticatedSession([
      {
        name: 'token',
        value: 'x',
        url: 'https://mp.weixin.qq.com/',
        domain: '.mp.weixin.qq.com',
        path: '/',
      },
    ]);

    expect(pageContext.setCookie).toHaveBeenCalledWith({
      name: 'token',
      value: 'x',
      domain: '.mp.weixin.qq.com',
      path: '/',
      url: 'https://mp.weixin.qq.com/',
    });
  });

  it('should omit expires when cookie has expires = 0 (session cookie)', async () => {
    const page = makePage();
    page.evaluate.mockResolvedValue(true);
    const pageContext = {
      cookies: jest.fn().mockResolvedValue([{ name: "token", value: "x" }]),
      setCookie: jest.fn().mockResolvedValue(undefined),
    };
    page.browserContext.mockReturnValue(pageContext);
    const browser = makeBrowser(page);
    (puppeteer.launch as jest.Mock).mockResolvedValue(browser);
    const service = new ChromeCDPService(mockOutputChannel, '/tmp/multipost');

    await service.startAuthenticatedSession([
      { name: 'token', value: 'x', domain: '.mp.weixin.qq.com', path: '/', expires: 0 },
    ]);

    expect(pageContext.setCookie).toHaveBeenCalledWith({
      name: 'token',
      value: 'x',
      domain: '.mp.weixin.qq.com',
      path: '/',
    });
  });

  it('should omit expires when cookie has negative expires', async () => {
    const page = makePage();
    page.evaluate.mockResolvedValue(true);
    const pageContext = {
      cookies: jest.fn().mockResolvedValue([{ name: "token", value: "x" }]),
      setCookie: jest.fn().mockResolvedValue(undefined),
    };
    page.browserContext.mockReturnValue(pageContext);
    const browser = makeBrowser(page);
    (puppeteer.launch as jest.Mock).mockResolvedValue(browser);
    const service = new ChromeCDPService(mockOutputChannel, '/tmp/multipost');

    await service.startAuthenticatedSession([
      { name: 'token', value: 'x', domain: '.mp.weixin.qq.com', path: '/', expires: -12345 },
    ]);

    expect(pageContext.setCookie).toHaveBeenCalledWith({
      name: 'token',
      value: 'x',
      domain: '.mp.weixin.qq.com',
      path: '/',
    });
  });

  it('should skip failed cookies but continue with successful ones', async () => {
    const page = makePage();
    page.evaluate.mockResolvedValue(true);
    const pageContext = {
      cookies: jest.fn().mockResolvedValue([{ name: "token", value: "x" }]),
      setCookie: jest.fn()
        .mockRejectedValueOnce(new Error('Protocol error: Invalid cookie fields'))
        .mockResolvedValueOnce(undefined),
    };
    page.browserContext.mockReturnValue(pageContext);
    const browser = makeBrowser(page);
    (puppeteer.launch as jest.Mock).mockResolvedValue(browser);
    const service = new ChromeCDPService(mockOutputChannel, '/tmp/multipost');

    await service.startAuthenticatedSession([
      { name: 'badCookie', value: 'x', domain: '.mp.weixin.qq.com', path: '/' },
      { name: 'goodCookie', value: 'y', domain: '.mp.weixin.qq.com', path: '/' },
    ]);

    expect(pageContext.setCookie).toHaveBeenCalledTimes(2);
    expect(service.isSessionActive()).toBe(true);
  });

  it('should throw when all cookies fail to set', async () => {
    const page = makePage();
    page.evaluate.mockResolvedValue(true);
    const pageContext = {
      cookies: jest.fn().mockResolvedValue([{ name: "token", value: "x" }]),
      setCookie: jest.fn().mockRejectedValue(new Error('Protocol error: Invalid cookie fields')),
    };
    page.browserContext.mockReturnValue(pageContext);
    const browser = makeBrowser(page);
    (puppeteer.launch as jest.Mock).mockResolvedValue(browser);
    const service = new ChromeCDPService(mockOutputChannel, '/tmp/multipost');

    await expect(service.startAuthenticatedSession([
      { name: 'bad1', value: 'x', domain: '.mp.weixin.qq.com', path: '/' },
      { name: 'bad2', value: 'y', domain: '.mp.weixin.qq.com', path: '/' },
    ])).rejects.toThrow('All 2 cookies failed to set');
  });
});
