import * as vscode from 'vscode';
import { IWeChatService, WeChatAuthInfo, WeChatUploadResult, WeChatDraftResult } from '../interfaces/IWeChatService';
import fetch from 'node-fetch';
import FormData from 'form-data';
import type { CookieParam } from 'puppeteer';

const STORAGE_KEY = 'wechat-publisher.auth';
const STORAGE_LOAD_TIMEOUT_MS = 1500;

export class WeChatService implements IWeChatService {
  private authInfo: WeChatAuthInfo | null = null;
  private secretStorage: vscode.SecretStorage;
  private outputChannel: vscode.OutputChannel;

  constructor(secretStorage: vscode.SecretStorage, outputChannel?: vscode.OutputChannel) {
    this.secretStorage = secretStorage;
    this.outputChannel = outputChannel || vscode.window.createOutputChannel('MultiPost WeChat');
  }

  private log(message: string, level: 'info' | 'error' | 'warn' = 'info'): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    
    if (level === 'error') {
      this.outputChannel.appendLine(logMessage);
      console.error(logMessage);
    } else {
      this.outputChannel.appendLine(logMessage);
      console.log(logMessage);
    }
  }

  private showOutputChannel(): void {
    this.outputChannel.show(true);
  }

  async loadAuthFromStorage(): Promise<void> {
    this.log('Loading auth from storage...');
    let stored: string | undefined;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      const storageRead = Promise.resolve(this.secretStorage.get(STORAGE_KEY))
        .catch((err: unknown) => {
          this.log('Secret storage get failed: ' + String(err), 'error');
          return undefined;
        });

      const timeout = new Promise<undefined>((resolve) => {
        timeoutHandle = setTimeout(() => {
          this.log('Secret storage read timed out after ' + STORAGE_LOAD_TIMEOUT_MS + 'ms', 'warn');
          resolve(undefined);
        }, STORAGE_LOAD_TIMEOUT_MS);
      });

      stored = await Promise.race([storageRead, timeout]);
    } catch (error) {
      this.log('Failed to read auth from secret storage', 'error');
      this.log(String(error), 'error');
      this.authInfo = null;
      return;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }

    if (stored) {
      try {
        this.authInfo = JSON.parse(stored);
        // Backward compatibility: convert old string[] cookies to new CookieParam[] format
        if (this.authInfo && this.authInfo.cookies.length > 0 && typeof this.authInfo.cookies[0] === 'string') {
          this.log('Converting old cookie format (string[]) to new format (CookieParam[])', 'info');
          const oneYearFromNow = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
          this.authInfo.cookies = (this.authInfo.cookies as unknown as string[]).map(cookieStr => {
            const [name, value] = cookieStr.split('=', 2);
            return {
              name,
              value,
              domain: '.mp.weixin.qq.com',
              path: '/',
              expires: oneYearFromNow,
              httpOnly: false,
              secure: true,
              sameSite: 'Lax',
            } as CookieParam;
          }).filter(cookie => !!cookie.name && cookie.value !== undefined);
          // Save the converted format
          await this.saveAuthInfo(this.authInfo);
          this.log(`Converted ${this.authInfo.cookies.length} cookies to new format`, 'info');
        }
        this.log(`Auth loaded successfully for user: ${this.authInfo?.nickName || 'unknown'}`);
      } catch (e) {
        this.log('Failed to parse stored auth data', 'error');
        this.log(String(e), 'error');
        this.authInfo = null;
      }
    } else {
      this.log('No stored auth data found or storage read timed out');
    }
  }

  getAuthInfo(): WeChatAuthInfo | null {
    return this.authInfo;
  }

  clearAuth(): void {
    this.authInfo = null;
    this.secretStorage.delete(STORAGE_KEY);
  }

  async saveAuthInfo(authInfo: WeChatAuthInfo): Promise<void> {
    this.authInfo = authInfo;
    await this.secretStorage.store(STORAGE_KEY, JSON.stringify(authInfo));
  }

  async checkAuth(): Promise<{ isAuthenticated: boolean; authInfo?: WeChatAuthInfo }> {
    this.log('Starting WeChat auth check...');
    this.showOutputChannel();

    try {
      const headers = this.getRequestHeaders();
      this.log('Sending request to WeChat...', 'info');

      const response = await fetch('https://mp.weixin.qq.com/', {
        method: 'GET',
        headers: headers,
        redirect: 'follow',
      });

      return this.extractAuthFromResponse(response);
    } catch (error) {
      this.log('WeChat auth check error:', 'error');
      this.log(String(error), 'error');
      if (error instanceof Error) {
        this.log(`Error stack: ${error.stack}`, 'error');
      }
      return { isAuthenticated: false };
    }
  }

  async checkAuthWithCookies(
    userCookies: string[] | CookieParam[]
  ): Promise<{ isAuthenticated: boolean; authInfo?: WeChatAuthInfo }> {
    this.log('Starting WeChat auth check with user-provided cookies...');
    this.showOutputChannel();

    try {
      // Convert input to CookieParam array for storage
      const oneYearFromNow = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
      const cookieParams: CookieParam[] = userCookies.map(cookie => {
        if (typeof cookie === 'string') {
          // Manual input: "name=value" -> convert to CookieParam
          const [name, value] = cookie.split('=', 2);
          return {
            name,
            value,
            domain: '.mp.weixin.qq.com',
            path: '/',
            expires: oneYearFromNow,
            httpOnly: false,
            secure: true,
            sameSite: 'Lax',
          } as CookieParam;
        }
        // CDP login: already full CookieParam from Puppeteer
        return cookie;
      }).filter(cookie => !!cookie.name && cookie.value !== undefined);

      // Create temporary auth with user's cookies
      const tempAuth: WeChatAuthInfo = {
        token: '',
        ticket: '',
        userName: '',
        nickName: '',
        svrTime: Date.now() / 1000,
        avatar: '',
        cookies: cookieParams,
      };

      const headers = this.getRequestHeaders(tempAuth);
      this.log(`Sending request with ${cookieParams.length} user cookies`, 'info');

      const response = await fetch('https://mp.weixin.qq.com/', {
        method: 'GET',
        headers: headers,
        redirect: 'follow',
      });

      const result = await this.extractAuthFromResponse(response);

      // If extraction successful, merge user cookies into the result
      if (result.isAuthenticated && result.authInfo) {
        // Combine user-provided cookies with any new cookies from response
        const combinedCookies = [...cookieParams, ...(result.authInfo.cookies || [])];
        // Deduplicate by cookie name (keep last one in case of overlap)
        const deduped = Array.from(
          new Map(combinedCookies.map(c => [c.name, c])).values()
        );
        result.authInfo.cookies = deduped;
        this.authInfo = result.authInfo;
        await this.saveAuthInfo(result.authInfo);
      }

      return result;
    } catch (error) {
      this.log('WeChat auth check with cookies error:', 'error');
      this.log(String(error), 'error');
      if (error instanceof Error) {
        this.log(`Error stack: ${error.stack}`, 'error');
      }
      return { isAuthenticated: false };
    }
  }

  private async extractAuthFromResponse(response: fetch.Response): Promise<{ isAuthenticated: boolean; authInfo?: WeChatAuthInfo }> {
    this.log(`Response status: ${response.status} ${response.statusText}`);

    const html = await response.text();
    this.log(`Response HTML length: ${html.length} characters`);

    // Extract tokens using regex from HTML
    // Try multiple patterns to handle different page structures (very robust)
    let tokenMatch: RegExpMatchArray | null = null;

    // Pattern 1: token = "xxx" or token: "xxx"
    tokenMatch = html.match(/token\s*[=:]\s*["']([^"']+)["']/);
    // Pattern 2: t = "xxx" or t: "xxx" (original pattern)
    if (!tokenMatch) tokenMatch = html.match(/t\s*[=:]\s*["']([^"']+)["']/);
    // Pattern 3: token without quotes
    if (!tokenMatch) tokenMatch = html.match(/token\s*[=:]\s*([a-zA-Z0-9_-]+)/);
    // Pattern 4: look inside script window assignment with any property
    if (!tokenMatch) tokenMatch = html.match(/token["']?\s*:\s*["']([^"']+)["']/);
    // Pattern 5: more greedy search across multiple lines
    if (!tokenMatch) tokenMatch = html.match(/window\.[^<]*token["']?\s*:\s*["']([^"']+)["']/);
    // Pattern 6: look for token in cgiData or similar
    if (!tokenMatch) tokenMatch = html.match(/cgiData\s*=\s*\{[\s\S]*?token["']?\s*:\s*["']([^"']+)["']/);
    // Pattern 7: look for window.__TOKEN__ or similar
    if (!tokenMatch) tokenMatch = html.match(/window\.__TOKEN__\s*=\s*["']([^"']+)["']/);
    // Pattern 8: look for token in any script tag
    if (!tokenMatch) tokenMatch = html.match(/<script[^>]*>[^<]*token["']?\s*:\s*["']([^"']+)["']/);

    if (!tokenMatch) {
      this.log('Failed to extract token from HTML', 'error');
      this.log('HTML preview (first 2000 chars):' + html.substring(0, 2000), 'error');
      return { isAuthenticated: false };
    }

    const token = tokenMatch[1].trim();
    this.log(`Token found: ${token}`);

    if (!token) {
      this.log('Token is empty after extraction', 'error');
      return { isAuthenticated: false };
    }

    // Try multiple patterns for other fields (very robust)
    const findMatch = (patterns: RegExp[]): string | undefined => {
      for (const pat of patterns) {
        const m = html.match(pat);
        if (m && m[1]) return m[1].trim();
      }
      return undefined;
    };

    const ticket = findMatch([
      /ticket\s*[=:]\s*["']([^"']+)["']/,
      /ticket:\s*["']([^"']+)["']/,
      /ticket["']?\s*:\s*["']([^"']+)["']/,
      /window\.[^<]*ticket["']?\s*:\s*["']([^"']+)["']/,
    ]);

    const userName = findMatch([
      /user_name\s*[=:]\s*["']([^"']+)["']/,
      /user_name:\s*["']([^"']+)["']/,
      /user_name["']?\s*:\s*["']([^"']+)["']/,
      /userName\s*[=:]\s*["']([^"']+)["']/,
    ]);

    const nickName = findMatch([
      /nick_name\s*[=:]\s*["']([^"']+)["']/,
      /nick_name:\s*["']([^"']+)["']/,
      /nick_name["']?\s*:\s*["']([^"']+)["']/,
      /nickName\s*[=:]\s*["']([^"']+)["']/,
    ]);

    const time = findMatch([
      /time\s*[=:]\s*["']?(\d+)["']?/,
      /time:\s*["'](\d+)["']/,
      /time["']?\s*:\s*["']?(\d+)["']?/,
      /svr_time\s*[=:]\s*["']?(\d+)["']?/,
    ]);

    const avatar = findMatch([
      /head_img\s*[=:]\s*["']([^"']+)["']/,
      /head_img:\s*['"]([^'"]+)['"]/,
      /head_img["']?\s*:\s*["']([^"']+)["']/,
      /headImg\s*[=:]\s*["']([^"']+)["']/,
    ]);

    const setCookieHeaders = response.headers.raw()['set-cookie'] || [];
    this.log(`Cookies received: ${setCookieHeaders.length} cookies`);

    // Convert set-cookie headers to CookieParam objects
    const oneYearFromNow = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
    const cookies: CookieParam[] = setCookieHeaders.map(cookieHeader => {
      // Parse name=value from beginning of set-cookie header
      const [nameValue] = cookieHeader.split(';');
      const [name, value] = nameValue.split('=', 2);
      return {
        name,
        value,
        domain: '.mp.weixin.qq.com',
        path: '/',
        expires: oneYearFromNow,
        httpOnly: cookieHeader.toLowerCase().includes('httponly'),
        secure: cookieHeader.toLowerCase().includes('secure'),
      };
    }).filter(cookie => !!cookie.name && cookie.value !== undefined);

    const newAuthInfo: WeChatAuthInfo = {
      token: token,
      ticket: ticket || '',
      userName: userName || '',
      nickName: nickName || '',
      svrTime: time ? Number(time) : Date.now() / 1000,
      avatar: avatar || '',
      cookies: cookies,
    };

    this.log(`Auth info extracted: nickName=${newAuthInfo.nickName}, userName=${newAuthInfo.userName}`);
    this.log('Saving auth info...');

    this.authInfo = newAuthInfo;
    await this.saveAuthInfo(newAuthInfo);

    this.log('Auth check successful!', 'info');
    return { isAuthenticated: true, authInfo: newAuthInfo };
  }

  async uploadImage(buffer: Buffer, filename: string): Promise<WeChatUploadResult> {
    this.log(`Starting image upload: ${filename}, size: ${buffer.length} bytes`);
    
    if (!this.authInfo) {
      this.log('Image upload failed: Not authenticated', 'error');
      return { success: false, error: 'Not authenticated' };
    }

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const random = Math.random();

      const params = new URLSearchParams({
        action: 'upload_material',
        f: 'json',
        scene: '8',
        writetype: 'doublewrite',
        groupid: '1',
        ticket_id: this.authInfo.userName,
        ticket: this.authInfo.ticket,
        svr_time: String(this.authInfo.svrTime),
        token: this.authInfo.token,
        lang: 'zh_CN',
        seq: String(timestamp),
        t: String(random),
      });

      const url = `https://mp.weixin.qq.com/cgi-bin/filetransfer?${params.toString()}`;
      this.log(`Upload URL: ${url}`);

      const form = new FormData();
      form.append('type', 'image/jpeg');
      form.append('id', String(timestamp));
      form.append('name', filename);
      form.append('lastModifiedDate', new Date().toUTCString());
      form.append('size', String(buffer.length));
      form.append('file', buffer, { filename: filename, contentType: 'image/jpeg' });

      const headers = this.getRequestHeaders();
      headers['Origin'] = 'https://mp.weixin.qq.com';
      headers['Referer'] = 'https://mp.weixin.qq.com/';

      // Combine form headers with our headers
      const formHeaders = form.getHeaders();
      const allHeaders = { ...headers, ...formHeaders };

      const response = await fetch(url, {
        method: 'POST',
        headers: allHeaders,
        body: form as any,
      });

      this.log(`Upload response status: ${response.status}`);
      const result: any = await response.json();
      this.log(`Upload response: ${JSON.stringify(result)}`);

      if (result.base_resp && result.base_resp.err_msg === 'ok') {
        this.log(`Image uploaded successfully: ${result.cdn_url}`);
        return { success: true, cdnUrl: result.cdn_url };
      } else {
        const error = result.base_resp?.err_msg || 'Upload failed';
        this.log(`Image upload failed: ${error}`, 'error');
        return {
          success: false,
          error: error,
        };
      }
    } catch (error) {
      this.log('Image upload error:', 'error');
      this.log(String(error), 'error');
      if (error instanceof Error) {
        this.log(`Error stack: ${error.stack}`, 'error');
      }
      return { success: false, error: String(error) };
    }
  }

  async createDraft(
    title: string,
    author: string,
    content: string,
    digest?: string
  ): Promise<WeChatDraftResult> {
    this.log(`Creating draft: title="${title}", author="${author}"`);
    
    if (!this.authInfo) {
      this.log('Draft creation failed: Not authenticated', 'error');
      return { success: false, error: 'Not authenticated' };
    }

    try {
      const params = new URLSearchParams({
        t: 'ajax-response',
        sub: 'create',
        type: '77',
        token: this.authInfo.token,
        f: 'json',
        lang: 'zh_CN',
      });

      const url = `https://mp.weixin.qq.com/cgi-bin/operate_appmsg?${params.toString()}`;
      this.log(`Draft creation URL: ${url}`);

      // Build form data with all required fields
      const form = new URLSearchParams();
      form.append('token', this.authInfo.token);
      form.append('lang', 'zh_CN');
      form.append('f', 'json');
      form.append('token', this.authInfo.token);

      // Article content - for single draft, index is 0
      form.append(`title0`, title);
      form.append(`author0`, author);
      form.append(`content0`, content);
      form.append(`digest0`, digest || '');
      form.append(`show_cover_pic0`, '0');
      form.append(`need_open_comment0`, '1');
      form.append(`only_fans_can_comment0`, '0');

      // Add required counters for multi article draft
      form.append('count', '1');
      form.append('multi_appmsgtoken', String(Math.floor(Math.random() * 1000000000)));

      const headers = this.getRequestHeaders();
      headers['Origin'] = 'https://mp.weixin.qq.com';
      headers['Referer'] = 'https://mp.weixin.qq.com/';
      headers['Content-Type'] = 'application/x-www-form-urlencoded';

      this.log(`Sending draft creation request...`);
      const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: form.toString(),
      });

      this.log(`Draft creation response status: ${response.status}`);
      const result: any = await response.json();
      this.log(`Draft creation response: ${JSON.stringify(result)}`);

      // WeChat API success: base_resp.ret === 0 means success, err_msg may be empty
      const isSuccess = result.errmsg === 'ok' ||
                       (result.base_resp && result.base_resp.ret === 0) ||
                       result.base_resp?.err_msg === 'ok' ||
                       result.ret === 0;

      if (isSuccess) {
        const appMsgId = result.appMsgId || result.appmsgid;
        const draftUrl = `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&appmsgid=${appMsgId}&token=${this.authInfo.token}&lang=zh_CN`;
        this.log(`Draft created successfully: appMsgId=${appMsgId}`);
        return { success: true, appMsgId, draftUrl };
      } else {
        const errMsg = result.errmsg || result.base_resp?.err_msg || 'Create draft failed';
        this.log(`Draft creation failed: ${errMsg}`, 'error');
        return { success: false, error: errMsg };
      }
    } catch (error) {
      this.log('Create draft error:', 'error');
      this.log(String(error), 'error');
      if (error instanceof Error) {
        this.log(`Error stack: ${error.stack}`, 'error');
      }
      return { success: false, error: String(error) };
    }
  }

  private getRequestHeaders(auth?: WeChatAuthInfo): Record<string, string> {
    const targetAuth = auth || this.authInfo;
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    if (targetAuth?.cookies) {
      headers['Cookie'] = targetAuth.cookies
        .map(cookie => `${cookie.name}=${cookie.value}`)
        .join('; ');
    }

    return headers;
  }
}
