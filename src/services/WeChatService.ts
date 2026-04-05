import * as vscode from 'vscode';
import { IWeChatService, WeChatAuthInfo, WeChatUploadResult, WeChatDraftResult } from '../interfaces/IWeChatService';
import fetch from 'node-fetch';
import FormData from 'form-data';

const STORAGE_KEY = 'wechat-publisher.auth';
const STORAGE_LOAD_TIMEOUT_MS = 1500;

export class WeChatService implements IWeChatService {
  private authInfo: WeChatAuthInfo | null = null;
  private secretStorage: vscode.SecretStorage;
  private outputChannel: vscode.OutputChannel;

  constructor(secretStorage: vscode.SecretStorage) {
    this.secretStorage = secretStorage;
    this.outputChannel = vscode.window.createOutputChannel('MultiPost WeChat');
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

    try {
      // Force resolve after timeout regardless of secret storage state
      stored = await Promise.race([
        Promise.resolve(this.secretStorage.get(STORAGE_KEY))
          .catch((err: unknown) => {
            this.log('Secret storage get failed: ' + String(err), 'error');
            return undefined;
          }),
        new Promise<undefined>((resolve) => {
          setTimeout(() => {
            this.log('Secret storage read timed out after ' + STORAGE_LOAD_TIMEOUT_MS + 'ms', 'warn');
            resolve(undefined);
          }, STORAGE_LOAD_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      this.log('Failed to read auth from secret storage', 'error');
      this.log(String(error), 'error');
      this.authInfo = null;
      return;
    }

    if (stored) {
      try {
        this.authInfo = JSON.parse(stored);
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

      this.log(`Response status: ${response.status} ${response.statusText}`);
      this.log(`Response headers: ${JSON.stringify(response.headers.raw(), null, 2)}`);

      const html = await response.text();
      this.log(`Response HTML length: ${html.length} characters`);
      
      // Extract tokens using regex from HTML
      const tokenMatch = html.match(/data:\s*\{[\s\S]*?t:\s*["']([^"']+)["']/);
      if (!tokenMatch) {
        this.log('Failed to extract token from HTML', 'error');
        this.log('HTML preview (first 500 chars):' + html.substring(0, 500), 'error');
        return { isAuthenticated: false };
      }

      this.log(`Token found: ${tokenMatch[1]}`);

      const ticketMatch = html.match(/ticket:\s*["']([^"']+)["']/);
      const userNameMatch = html.match(/user_name:\s*["']([^"']+)["']/);
      const nickNameMatch = html.match(/nick_name:\s*["']([^"']+)["']/);
      const timeMatch = html.match(/time:\s*["'](\d+)["']/
);
      const avatarMatch = html.match(/head_img:\s*['"]([^'"]+)['"]/);

      const cookies = response.headers.raw()['set-cookie'] || [];
      this.log(`Cookies received: ${cookies.length} cookies`);

      const newAuthInfo: WeChatAuthInfo = {
        token: tokenMatch[1],
        ticket: ticketMatch ? ticketMatch[1] : '',
        userName: userNameMatch ? userNameMatch[1] : '',
        nickName: nickNameMatch ? nickNameMatch[1] : '',
        svrTime: timeMatch ? Number(timeMatch[1]) : Date.now() / 1000,
        avatar: avatarMatch ? avatarMatch[1] : '',
        cookies: cookies,
      };

      this.log(`Auth info extracted: nickName=${newAuthInfo.nickName}, userName=${newAuthInfo.userName}`);
      this.log('Saving auth info...');
      
      this.authInfo = newAuthInfo;
      await this.saveAuthInfo(newAuthInfo);

      this.log('Auth check successful!', 'info');
      return { isAuthenticated: true, authInfo: newAuthInfo };
    } catch (error) {
      this.log('WeChat auth check error:', 'error');
      this.log(String(error), 'error');
      if (error instanceof Error) {
        this.log(`Error stack: ${error.stack}`, 'error');
      }
      return { isAuthenticated: false };
    }
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
        lang: 'zh_CN',
      });

      const url = `https://mp.weixin.qq.com/cgi-bin/operate_appmsg?${params.toString()}`;
      this.log(`Draft creation URL: ${url}`);

      // Build form data with all required fields
      const form = new URLSearchParams();
      form.append('token', this.authInfo.token);
      form.append('lang', 'zh_CN');
      form.append('f', 'json');

      // Article content
      form.append(`title0`, title);
      form.append(`author0`, author);
      form.append(`content0`, content);
      form.append(`digest0`, digest || '');
      form.append(`show_cover_pic0`, '0');
      form.append(`need_open_comment0`, '1');
      form.append(`only_fans_can_comment0`, '0');

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

      if (result.errmsg === 'ok' || result.base_resp?.err_msg === 'ok') {
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

  private getRequestHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    if (this.authInfo?.cookies) {
      headers['Cookie'] = this.authInfo.cookies
        .map(cookie => cookie.split(';')[0])
        .join('; ');
    }

    return headers;
  }
}
