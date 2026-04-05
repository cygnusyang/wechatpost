import * as vscode from 'vscode';
import { WeChatService } from 'src/services/WeChatService';
import { WeChatAuthInfo } from 'src/interfaces/IWeChatService';
import type { CookieParam } from 'puppeteer';

// Mock external dependencies
jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('form-data', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    append: jest.fn(),
    getHeaders: jest.fn(() => ({})),
  })),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mockFetch = require('node-fetch').default as jest.Mock;

const makeCookie = (name: string, value: string): CookieParam => ({
  name,
  value,
  domain: '.mp.weixin.qq.com',
  path: '/',
  secure: true,
});

describe('WeChatService', () => {
  let mockSecretStorage: Partial<vscode.SecretStorage>;
  let weChatService: WeChatService;

  beforeEach(() => {
    mockSecretStorage = {
      get: jest.fn(),
      store: jest.fn(),
      delete: jest.fn(),
    };
    weChatService = new WeChatService(mockSecretStorage as vscode.SecretStorage);
    jest.clearAllMocks();
  });

  it('should create instance without error', () => {
    expect(weChatService).toBeDefined();
  });

  it('should return null auth info when no stored auth', async () => {
    (mockSecretStorage.get as jest.Mock).mockResolvedValue(null);
    await weChatService.loadAuthFromStorage();
    expect(weChatService.getAuthInfo()).toBeNull();
  });

  it('should load and parse stored auth correctly', async () => {
    const mockAuth: WeChatAuthInfo = {
      token: 'test-token',
      ticket: 'test-ticket',
      userName: 'test-user',
      nickName: 'Test User',
      svrTime: 123456,
      avatar: 'avatar-url',
      cookies: [],
    };
    (mockSecretStorage.get as jest.Mock).mockResolvedValue(JSON.stringify(mockAuth));

    await weChatService.loadAuthFromStorage();
    expect(weChatService.getAuthInfo()).toEqual(mockAuth);
  });

  it('should handle invalid JSON gracefully', async () => {
    (mockSecretStorage.get as jest.Mock).mockResolvedValue('not valid json {');
    await weChatService.loadAuthFromStorage();
    expect(weChatService.getAuthInfo()).toBeNull();
  });

  it('should clear auth correctly', () => {
    weChatService.clearAuth();
    expect(mockSecretStorage.delete).toHaveBeenCalled();
    expect(weChatService.getAuthInfo()).toBeNull();
  });

  it('should save auth info to storage', async () => {
    const mockAuth: WeChatAuthInfo = {
      token: 'test-token',
      ticket: 'test-ticket',
      userName: 'test-user',
      nickName: 'Test User',
      svrTime: 123456,
      avatar: 'avatar-url',
      cookies: [],
    };

    await weChatService.saveAuthInfo(mockAuth);
    expect(mockSecretStorage.store).toHaveBeenCalled();
    expect(weChatService.getAuthInfo()).toEqual(mockAuth);
  });

  it('should return not authenticated when token not found', async () => {
    mockFetch.mockResolvedValue({
      text: jest.fn().mockResolvedValue('<html>no token here</html>'),
      headers: {
        raw: jest.fn().mockReturnValue({ 'set-cookie': [] }),
      },
    });

    const result = await weChatService.checkAuth();
    expect(result.isAuthenticated).toBe(false);
  });

  it('should extract auth info when token found in html', async () => {
    const html = `
      <script>
        data: {
          t: "test-token",
          ticket: "test-ticket",
          user_name: "test-user",
          nick_name: "Test User",
          time: "123456",
          head_img: "https://example.com/avatar.jpg"
        }
      </script>
    `;

    mockFetch.mockResolvedValue({
      text: jest.fn().mockResolvedValue(html),
      headers: {
        raw: jest.fn().mockReturnValue({ 'set-cookie': ['cookie1=val', 'cookie2=val'] }),
      },
    });

    const result = await weChatService.checkAuth();
    expect(result.isAuthenticated).toBe(true);
    expect(result.authInfo).toBeDefined();
    expect(result.authInfo?.token).toBe('test-token');
    expect(result.authInfo?.ticket).toBe('test-ticket');
    expect(result.authInfo?.userName).toBe('test-user');
    expect(result.authInfo?.nickName).toBe('Test User');
    expect(mockSecretStorage.store).toHaveBeenCalled();
  });

  it('should handle fetch errors gracefully in checkAuth', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const result = await weChatService.checkAuth();
    expect(result.isAuthenticated).toBe(false);
  });

  it('should return error when uploading image without authentication', async () => {
    const buffer = Buffer.from('');
    const result = await weChatService.uploadImage(buffer, 'test.png');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Not authenticated');
  });

  it('should handle upload errors gracefully', async () => {
    const mockAuth: WeChatAuthInfo = {
      token: 'test-token',
      ticket: 'test-ticket',
      userName: 'test-user',
      nickName: 'Test User',
      svrTime: 123456,
      avatar: 'avatar-url',
      cookies: [],
    };

    await weChatService.saveAuthInfo(mockAuth);
    mockFetch.mockRejectedValue(new Error('Network error'));

    const buffer = Buffer.from('');
    const result = await weChatService.uploadImage(buffer, 'test.png');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Network error');
  });

  it('should return upload error when response indicates failure', async () => {
    const mockAuth: WeChatAuthInfo = {
      token: 'test-token',
      ticket: 'test-ticket',
      userName: 'test-user',
      nickName: 'Test User',
      svrTime: 123456,
      avatar: 'avatar-url',
      cookies: [makeCookie('cookie1', 'val'), makeCookie('cookie2', 'val')],
    };

    await weChatService.saveAuthInfo(mockAuth);
    mockFetch.mockResolvedValue({
      json: jest.fn().mockResolvedValue({
        base_resp: {
          err_msg: 'upload failed',
        },
      }),
    });

    const buffer = Buffer.from('');
    const result = await weChatService.uploadImage(buffer, 'test.png');
    expect(result.success).toBe(false);
    expect(result.error).toContain('upload failed');
  });

  it('should return error when createDraft without authentication', async () => {
    const result = await weChatService.createDraft('Title', 'Author', 'Content');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Not authenticated');
  });

  it('should handle createDraft errors gracefully', async () => {
    const mockAuth: WeChatAuthInfo = {
      token: 'test-token',
      ticket: 'test-ticket',
      userName: 'test-user',
      nickName: 'Test User',
      svrTime: 123456,
      avatar: 'avatar-url',
      cookies: [],
    };

    await weChatService.saveAuthInfo(mockAuth);
    mockFetch.mockRejectedValue(new Error('Network error'));

    const result = await weChatService.createDraft('Title', 'Author', 'Content');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Network error');
  });

  it('should return createDraft error when response indicates failure', async () => {
    const mockAuth: WeChatAuthInfo = {
      token: 'test-token',
      ticket: 'test-ticket',
      userName: 'test-user',
      nickName: 'Test User',
      svrTime: 123456,
      avatar: 'avatar-url',
      cookies: [makeCookie('cookie1', 'val')],
    };

    await weChatService.saveAuthInfo(mockAuth);
    mockFetch.mockResolvedValue({
      json: jest.fn().mockResolvedValue({
        errmsg: 'invalid token',
      }),
    });

    const result = await weChatService.createDraft('Title', 'Author', 'Content');
    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid token');
  });
});
