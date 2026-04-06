import { chromium, Browser, Page } from 'playwright';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const LOGIN_TIMEOUT_MS = 120000; // 2 minutes timeout for user to scan QR
const POLL_INTERVAL_MS = 2000; // Check every 2 seconds for login completion

export class PlaywrightService {
  private outputChannel: vscode.OutputChannel;
  private browser: Browser | null = null;
  private authenticatedPage: Page | null = null;
  private userDataDir: string;

  constructor(outputChannel: vscode.OutputChannel, storagePath: string) {
    this.outputChannel = outputChannel;
    this.userDataDir = path.join(storagePath, 'playwright-profile');
    fs.mkdirSync(this.userDataDir, { recursive: true });
  }

  private log(message: string, level: 'info' | 'error' | 'warn' = 'info'): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [Playwright] [${level.toUpperCase()}] ${message}`;
    this.outputChannel.appendLine(logMessage);
    if (level === 'error') {
      console.error(logMessage);
    } else {
      console.log(logMessage);
    }
  }

  /**
   * First-time login flow - launch Chrome, let user scan QR, extract cookies
   */
  async startFirstTimeLogin(): Promise<void> {
    this.log('Starting first-time login flow');

    const browser = await chromium.launch({
      headless: false,
      args: [
        '--start-maximized',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-crashpad',
        '--disable-breakpad',
      ],
    });
    this.browser = browser;

    try {
      const page = await browser.newPage();
      this.log('New page opened, navigating to mp.weixin.qq.com');

      await page.goto('https://mp.weixin.qq.com/', {
        waitUntil: 'networkidle',
      });

      this.log('Page loaded, waiting for user to scan QR code and login');
      vscode.window.showInformationMessage('Chrome opened. Please scan QR code to login. Waiting...');

      // Wait for login to complete by polling
      const isLoggedIn = await this.waitForLogin(page);

      if (!isLoggedIn) {
        this.log('Login timeout waiting for user to scan QR', 'error');
        await this.close();
        throw new Error('Login timeout. Please try again and scan QR code within 2 minutes.');
      }

      this.log('Login detected');

      // Keep browser open for authenticated session
      this.authenticatedPage = page;
      this.log('Login flow completed, browser kept open for authenticated operations');

    } catch (error) {
      this.log(`Error during login flow: ${error}`, 'error');
      await this.close();
      throw error;
    }
  }

  /**
   * Wait for login to complete by polling page for token presence
   */
  private async waitForLogin(page: Page): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < LOGIN_TIMEOUT_MS) {
      try {
        // Check if we have token in window.__wxjs_environment (WeChat MP sets this after login)
        const hasToken = await page.evaluate(() => {
          const global = (window as any).global;
          return !!(global && global.token);
        });

        if (hasToken) {
          this.log('Login detected: token found in window.global');
          return true;
        }

        // Check if user_info exists
        const hasUserInfo = await page.evaluate(() => {
          const global = (window as any).global;
          return !!(global && global.user_info);
        });

        if (hasUserInfo) {
          this.log('Login detected: user_info found in window.global');
          return true;
        }

        // Check if URL contains 'token=' parameter
        const url = page.url();
        if (url.includes('token=') && !url.includes('appmsg_edit')) {
          this.log(`Login detected: token found in URL: ${url}`);
          return true;
        }

        // Check if page contains user info elements
        const hasUserElements = await page.evaluate(() => {
          return document.querySelector('.user-avatar') ||
                 document.querySelector('.nickname') ||
                 document.querySelector('.user-info');
        });

        if (hasUserElements) {
          this.log('Login detected: user info elements found');
          return true;
        }

        // Check if page contains logout button
        const hasLogoutButton = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('a')).some(link => {
            const text = link.innerText || '';
            return text.includes('退出');
          });
        });

        if (hasLogoutButton) {
          this.log('Login detected: logout button found');
          return true;
        }
      } catch (evalError) {
        // Ignore evaluation errors, continue polling
        this.log(`Evaluation error during login check: ${evalError}`, 'info');
      }

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    this.log('Login timeout', 'warn');
    return false;
  }

  /**
   * Create a new draft directly in WeChat MP via browser automation (Playwright version)
   */
  async createDraftInBrowser(
    title: string,
    author: string,
    content: string,
    digest?: string
  ): Promise<string> {
    if (!this.browser || !this.authenticatedPage) {
      throw new Error('No authenticated browser session. Please login first.');
    }

    const page = this.authenticatedPage;
    this.log(`[DEBUG] Step 1: Starting draft creation`);
    this.log(`[DEBUG] Title: "${title}", Author: "${author}", Content length: ${content.length}`);

    try {
      await page.bringToFront();

      // Step 2: ensure current browser page is in authenticated state
      const isLoggedIn = await this.waitForLogin(page);
      if (!isLoggedIn) {
        throw new Error('Current browser session is not logged in. Please complete QR login first.');
      }

      // Step 3: Navigate through the new interface
      // 内容管理 → 草稿箱 → 新的创作 → 写新文章
      this.log('[DEBUG] Step 3: Navigating to content management');
      await page.getByTitle('内容管理').click();
      await page.waitForNavigation({ waitUntil: 'networkidle' });

      this.log('[DEBUG] Step 4: Navigating to draft box');
      await page.getByRole('link', { name: '草稿箱' }).click();
      await page.waitForNavigation({ waitUntil: 'networkidle' });

      this.log('[DEBUG] Step 5: Clicking "New Creation"');
      await page.getByText('新的创作').click();

      this.log('[DEBUG] Step 6: Clicking "Write New Article"');
      const [newPage] = await Promise.all([
        page.waitForEvent('popup'),
        page.getByRole('link', { name: '写新文章' }).click()
      ]);

      if (newPage) {
        this.log('[DEBUG] Step 6: New page opened for article editing');
        await newPage.waitForLoadState('networkidle');
        this.authenticatedPage = newPage; // 更新为新页面
      }

      // Step 7: Fill in the form
      this.log('[DEBUG] Step 7: Filling in article details');

      // Fill title
      await this.authenticatedPage.getByRole('textbox', { name: '请在这里输入标题' }).click();
      await this.authenticatedPage.getByRole('textbox', { name: '请在这里输入标题' }).fill(title);

      // Fill author
      await this.authenticatedPage.getByRole('textbox', { name: '请输入作者' }).click();
      await this.authenticatedPage.getByRole('textbox', { name: '请输入作者' }).fill(author);

      // Fill content
      await this.authenticatedPage.locator('section').click();
      await this.authenticatedPage.locator('div').filter({ hasText: /^从这里开始写正文$/ }).nth(5).fill(content);

      // Fill digest if provided
      if (digest) {
        this.log('[DEBUG] Step 8: Filling digest');
        try {
          await this.authenticatedPage.getByRole('textbox', { name: '请输入摘要' }).click();
          await this.authenticatedPage.getByRole('textbox', { name: '请输入摘要' }).fill(digest);
        } catch (error) {
          this.log(`[DEBUG] Digest field not found: ${error}`, 'warn');
        }
      }

      // Save as draft
      this.log('[DEBUG] Step 9: Saving as draft');
      await this.authenticatedPage.getByRole('button', { name: '保存为草稿' }).click();
      await this.authenticatedPage.waitForNavigation({ waitUntil: 'networkidle' });

      const draftUrl = this.authenticatedPage.url();
      this.log(`[DEBUG] Draft created successfully: ${draftUrl}`);

      vscode.window.showInformationMessage('Draft created successfully in Chrome');

      return draftUrl;

    } catch (error) {
      this.log(`[DEBUG] Error creating draft: ${error}`, 'error');
      throw error;
    }
  }

  /**
   * Close browser session
   */
  async close(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (error) {
        this.log(`Error closing browser: ${error}`, 'error');
      }
      this.browser = null;
      this.authenticatedPage = null;
    }
  }

  /**
   * Check if we have an active authenticated session
   */
  isSessionActive(): boolean {
    return !!(this.browser && this.authenticatedPage);
  }
}
