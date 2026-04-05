// WeChat service interface

import type { CookieParam } from 'puppeteer';

export interface WeChatAuthInfo {
  token: string;
  ticket: string;
  userName: string;
  nickName: string;
  svrTime: number;
  avatar: string;
  cookies: CookieParam[];
}

export interface WeChatUploadResult {
  success: boolean;
  cdnUrl?: string;
  error?: string;
}

export interface WeChatDraftResult {
  success: boolean;
  appMsgId?: number;
  draftUrl?: string;
  error?: string;
}

export interface IWeChatService {
  /**
   * Check if we're authenticated with WeChat
   */
  checkAuth(): Promise<{ isAuthenticated: boolean; authInfo?: WeChatAuthInfo }>;

  /**
   * Check authentication with user-provided cookies from browser
   */
  checkAuthWithCookies(userCookies: string[] | CookieParam[]): Promise<{ isAuthenticated: boolean; authInfo?: WeChatAuthInfo }>;

  /**
   * Upload image buffer to WeChat media server
   */
  uploadImage(buffer: Buffer, filename: string): Promise<WeChatUploadResult>;

  /**
   * Create a new article draft
   */
  createDraft(
    title: string,
    author: string,
    content: string,
    digest?: string
  ): Promise<WeChatDraftResult>;

  /**
   * Get current auth info
   */
  getAuthInfo(): WeChatAuthInfo | null;

  /**
   * Clear authentication (logout)
   */
  clearAuth(): void;

  /**
   * Save auth info to secret storage
   */
  saveAuthInfo(authInfo: WeChatAuthInfo): Promise<void>;
}
