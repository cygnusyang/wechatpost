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

      // 添加网络监听，查看网页返回的数据
      page.on('response', async (response) => {
        // 过滤微信API请求
        if (response.url().includes('cgi-bin') && response.url().includes('mp.weixin.qq.com')) {
          this.log(`[DEBUG] API Response: ${response.url()} - ${response.status()}`, 'info');
          try {
            // 尝试获取响应内容
            if (response.headers()['content-type']?.includes('application/json')) {
              const jsonData = await response.json();
              this.log(`[DEBUG] JSON Response: ${JSON.stringify(jsonData)}`, 'info');
            } else {
              const textData = await response.text();
              if (textData.length < 500) { // 只记录较短的响应内容
                this.log(`[DEBUG] Text Response: ${textData}`, 'info');
              }
            }
          } catch (error) {
            this.log(`[DEBUG] Failed to parse response: ${error}`, 'warn');
          }
        }
      });

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

      // Step 3: Navigate through the new interface (using the same steps as the Python script)
      // 内容管理 → 草稿箱 → 新的创作 → 写新文章
      this.log('[DEBUG] Step 3: Navigating to content management');
      await page.getByTitle('内容管理').click();
      await page.waitForLoadState('networkidle', { timeout: 60000 });

      this.log('[DEBUG] Step 4: Navigating to draft box');
      await page.getByRole('link', { name: '草稿箱' }).click();
      await page.waitForLoadState('networkidle', { timeout: 60000 });

      this.log('[DEBUG] Step 5: Clicking "New Creation"');
      await page.getByText('新的创作').click();
      await page.waitForLoadState('networkidle', { timeout: 60000 });

      this.log('[DEBUG] Step 6: Clicking "Write New Article"');
      let page1: Page;
      const popupPromise = page.waitForEvent('popup', { timeout: 60000 });
      await page.getByRole('link', { name: '写新文章' }).click();
      try {
        page1 = await popupPromise;
      } catch (error) {
        // 如果没有弹出新窗口，可能是在当前窗口跳转
        this.log('[DEBUG] No popup detected, checking current page');
        page1 = page;
      }

      if (page1 && page1 !== page) {
        this.log('[DEBUG] Step 6: New page opened for article editing');
        await page1.waitForLoadState('networkidle', { timeout: 60000 });
        this.authenticatedPage = page1; // 更新为新页面

        // 获取并分析新页面的 HTML 内容，以便确定元素定位策略
        const pageHTML = await this.authenticatedPage.content();
        this.log(`[DEBUG] New page HTML length: ${pageHTML.length}`);

        // 分析页面结构，查找关键元素
        if (pageHTML.includes('edui1_contentplaceholder')) {
          this.log('[DEBUG] Page contains edui1_contentplaceholder');
        }
        if (pageHTML.includes('从这里开始写正文')) {
          this.log('[DEBUG] Page contains "从这里开始写正文" placeholder');
        }
        if (pageHTML.includes('请在这里输入标题')) {
          this.log('[DEBUG] Page contains "请在这里输入标题" input');
        }
      }

      // Step 7: Fill in the form based on page structure
      this.log('[DEBUG] Step 7: Filling in article details based on page structure');

      // Fill title
      this.log('[DEBUG] Step 7a: Filling title');
      try {
        const titleSelector = this.authenticatedPage.getByRole('textbox', { name: '请在这里输入标题' });
        await titleSelector.waitFor({ timeout: 60000 });
        await titleSelector.click();
        await titleSelector.fill(title);
        this.log(`[DEBUG] Title filled: "${title}"`);
      } catch (error) {
        this.log(`[DEBUG] Failed to fill title: ${error}`, 'error');
        throw error;
      }

      // Fill author
      this.log('[DEBUG] Step 7b: Filling author');
      await this.fillAuthorField(author);

      // Fill content
      this.log('[DEBUG] Step 8: Filling content');
      await this.fillContentField(content);

      // Fill digest if provided
      if (digest) {
        this.log('[DEBUG] Step 9: Filling digest');
        await this.fillDigestField(digest);
      }

      // Save as draft
      this.log('[DEBUG] Step 10: Saving as draft');
      try {
        const saveButton = this.authenticatedPage.getByRole('button', { name: '保存为草稿' });
        await saveButton.waitFor({ timeout: 60000 });

        // 点击保存按钮并等待导航完成
        const navigationPromise = this.authenticatedPage.waitForLoadState('networkidle', { timeout: 60000 });
        await saveButton.click();
        await navigationPromise;
      } catch (error) {
        this.log(`[DEBUG] Failed to save draft: ${error}`, 'error');
        throw error;
      }

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
   * Fill author field with robust locator strategy
   */
  private async fillAuthorField(author: string): Promise<void> {
    try {
      this.log(`[DEBUG] Trying to fill author: "${author}"`);
      const authorSelector = this.authenticatedPage!.getByRole('textbox', { name: '请输入作者' });

      await authorSelector.waitFor({ timeout: 30000 });

      // 使用与参考脚本相同的方法：先点击，再使用 Tab 键，最后填充
      await authorSelector.click();
      await authorSelector.press('Tab');

      // 填充作者名称
      await authorSelector.fill(author);
      this.log(`[DEBUG] Author filled: "${author}"`);
    } catch (error) {
      this.log(`[DEBUG] Failed to fill author with reference selector: ${error}`, 'warn');

      // 备用策略：尝试其他定位方法
      try {
        const authorInputSelectors = [
          this.authenticatedPage!.locator('input[name="author"]'),
          this.authenticatedPage!.locator('input[type="text"]').filter({ hasText: '请输入作者' }),
          this.authenticatedPage!.getByPlaceholder('请输入作者')
        ];

        let authorFilled = false;
        for (const selector of authorInputSelectors) {
          try {
            await selector.waitFor({ timeout: 10000 });
            await selector.click();
            await selector.fill(author);
            this.log(`[DEBUG] Author filled with fallback selector: "${author}"`);
            authorFilled = true;
            break;
          } catch (fallbackError) {
            this.log(`[DEBUG] Fallback selector failed: ${fallbackError}`, 'warn');
          }
        }

        if (!authorFilled) {
          this.log('[DEBUG] Author field not found, skipping', 'warn');
        }
      } catch (fallbackError) {
        this.log(`[DEBUG] Fallback strategies also failed: ${fallbackError}`, 'error');
      }
    }
  }

  /**
   * Fill content field with robust locator strategy
   */
  private async fillContentField(content: string): Promise<void> {
    try {
      // 微信公众号现在使用 ProseMirror 富文本编辑器
      const proseMirrorSelector = this.authenticatedPage!.locator('div.ProseMirror');

      if (await proseMirrorSelector.count() > 0) {
        await proseMirrorSelector.waitFor({ timeout: 30000 });
        await proseMirrorSelector.click();
        await proseMirrorSelector.fill(content);
        return;
      }

      // 如果 ProseMirror 未找到，尝试其他方法
      const ueditorSelector = this.authenticatedPage!.locator('#ueditor_0');
      if (await ueditorSelector.count() > 0) {
        await ueditorSelector.waitFor({ timeout: 30000 });
        await ueditorSelector.click();

        try {
          const editableArea = ueditorSelector.locator('div[contenteditable="true"]');
          if (await editableArea.count() > 0) {
            await editableArea.fill(content);
            return;
          }
        } catch (error) {
          // 忽略 UEditor 内部错误，继续尝试其他方法
        }
      }

      // 如果上述方法都失败，尝试更简单的方法
      const contenteditableSelector = this.authenticatedPage!.locator('[contenteditable="true"]');
      if (await contenteditableSelector.count() > 0) {
        await contenteditableSelector.waitFor({ timeout: 30000 });
        await contenteditableSelector.first().click();
        await contenteditableSelector.first().fill(content);
        return;
      }

      // 最后尝试原始的参考脚本选择器
      await this.authenticatedPage!.locator('section').click();
      const contentSelector = this.authenticatedPage!.locator('div').filter({ hasText: /^从这里开始写正文$/ }).first();
      await contentSelector.waitFor({ timeout: 30000 });
      await contentSelector.click();
      await contentSelector.fill(content);

    } catch (error) {
      this.log(`[DEBUG] Failed to fill content: ${error}`, 'error');

      // 只在出错时打印详细的调试信息
      try {
        const bodyHTML = await this.authenticatedPage!.locator('body').innerHTML();
        const editorRelatedHTML = bodyHTML.match(/<div[^>]*ProseMirror[^>]*>[\s\S]{0,200}<\/div>/) ||
                                   bodyHTML.match(/<div[^>]*ueditor[^>]*>[\s\S]{0,200}<\/div>/) ||
                                   bodyHTML.match(/<div[^>]*contenteditable[^>]*>[\s\S]{0,200}<\/div>/);
        if (editorRelatedHTML) {
          this.log(`[DEBUG] Editor-related HTML snippet: ${editorRelatedHTML[0]}`, 'warn');
        }
      } catch (htmlError) {
        this.log(`[DEBUG] Failed to extract editor HTML snippet: ${htmlError}`, 'warn');
      }
    }
  }

  /**
   * Fill digest field with robust locator strategy
   */
  private async fillDigestField(digest: string): Promise<void> {
    try {
      const digestSelector = this.authenticatedPage!.getByRole('textbox', { name: '请输入摘要' });
      await digestSelector.waitFor({ timeout: 30000 });
      await digestSelector.click();
      await digestSelector.fill(digest);
    } catch (error) {
      this.log(`[DEBUG] Digest field not found: ${error}`, 'warn');
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