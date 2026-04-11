import { chromium, Browser, Page } from 'playwright';
import * as vscode from 'vscode';

const LOGIN_TIMEOUT_MS = 120000; // 2 minutes timeout for user to scan QR
const POLL_INTERVAL_MS = 2000; // Check every 2 seconds for login completion

export class PlaywrightService {
  private outputChannel: vscode.OutputChannel;
  private browser: Browser | null = null;
  private authenticatedPage: Page | null = null;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
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
   * Strictly following test.py logic
   */
  async createDraftInBrowser(
    title: string,
    author: string,
    content: string,
    digest?: string,
    isOriginal?: boolean,
    enableAppreciation?: boolean,
    defaultCollection?: string,
    publish?: boolean
  ): Promise<string> {
    if (!this.browser || !this.authenticatedPage) {
      throw new Error('No authenticated browser session. Please login first.');
    }

    const page = this.authenticatedPage;
    this.log(`[DEBUG] Starting draft creation following test.py logic`);
    this.log(`[DEBUG] Title: "${title}", Author: "${author}", Content length: ${content.length}`);

    try {
      await page.bringToFront();

      // Step 1: ensure current browser page is in authenticated state
      const isLoggedIn = await this.waitForLogin(page);
      if (!isLoggedIn) {
        throw new Error('Current browser session is not logged in. Please complete QR login first.');
      }

      // Step 2: Navigate through interface (strictly following test.py logic)
      // 内容管理 → 草稿箱 → 新的创作 → 写新文章
      this.log('[DEBUG] Step 2: Clicking "内容管理"');
      await page.getByText('内容管理').click();
      await page.waitForLoadState('networkidle', { timeout: 60000 });

      this.log('[DEBUG] Step 3: Clicking "草稿箱"');
      await page.getByRole('link', { name: '草稿箱' }).click();
      await page.waitForLoadState('networkidle', { timeout: 60000 });

      this.log('[DEBUG] Step 4: Clicking add button');
      await page.locator('.weui-desktop-card__icon-add').click();
      await page.waitForLoadState('networkidle', { timeout: 60000 });

      this.log('[DEBUG] Step 5: Clicking "写新文章" and waiting for popup');
      let page1: Page;
      const popupPromise = page.waitForEvent('popup', { timeout: 60000 });
      await page.getByRole('link', { name: '写新文章' }).click();
      try {
        page1 = await popupPromise;
      } catch (error) {
        // 如果没有弹出新窗口，可能是在当前窗口跳转
        this.log('[DEBUG] No popup detected, using current page');
        page1 = page;
      }

      if (page1 && page1 !== page) {
        this.log('[DEBUG] New page opened for article editing');
        await page1.waitForLoadState('networkidle', { timeout: 60000 });
        this.authenticatedPage = page1; // 更新为新页面
      }

      // Step 6: Fill title (following test.py logic)
      this.log('[DEBUG] Step 6: Filling title');
      const titleSelector = this.authenticatedPage.getByRole('textbox', { name: '请在这里输入标题' });
      await titleSelector.waitFor({ timeout: 60000 });
      await titleSelector.click();
      await titleSelector.fill(title);
      this.log(`[DEBUG] Title filled: "${title}"`);

      // Step 7: Fill author (following test.py logic)
      this.log('[DEBUG] Step 7: Filling author');
      const authorSelector = this.authenticatedPage.getByRole('textbox', { name: '请输入作者' });
      await authorSelector.waitFor({ timeout: 60000 });
      await authorSelector.click();
      await authorSelector.fill(author);
      this.log(`[DEBUG] Author filled: "${author}"`);

      // Step 8: Fill content (following test.py logic)
      this.log('[DEBUG] Step 8: Filling content');
      await this.authenticatedPage.locator('section').click();
      const contentSelector = this.authenticatedPage.locator('div').filter({ hasText: /^从这里开始写正文$/ }).nth(5);
      await contentSelector.waitFor({ timeout: 60000 });
      await contentSelector.fill(content);
      this.log(`[DEBUG] Content filled, length: ${content.length}`);

      // Step 9: Click article settings (following test.py logic)
      this.log('[DEBUG] Step 9: Clicking "文章设置"');
      await this.authenticatedPage.locator('#bot_bar_left_container').getByText('文章设置').click();
      await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 60000 });

      // Step 10: Fill digest if provided (following test.py logic)
      if (digest) {
        this.log('[DEBUG] Step 10: Filling digest');
        const digestSelector = this.authenticatedPage.getByRole('textbox', {
          name: '选填，不填写则默认抓取正文开头部分文字，摘要会在转发卡片和公众号会话展示。'
        });
        await digestSelector.waitFor({ timeout: 60000 });
        await digestSelector.click();
        await digestSelector.fill(digest);
        this.log(`[DEBUG] Digest filled: "${digest}"`);
      }

      // Step 11: Set cover image (following test.py logic - click twice)
      this.log('[DEBUG] Step 11: Setting cover image (clicking add_cover twice)');
      const coverButton = this.authenticatedPage.locator('.icon20_common.add_cover');
      await coverButton.waitFor({ timeout: 60000 });
      await coverButton.click();
      await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 30000 });
      await coverButton.click();
      await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 30000 });

      // Step 12: Click AI cover (following test.py logic)
      this.log('[DEBUG] Step 12: Clicking "AI 配图"');
      await this.authenticatedPage.getByRole('link', { name: 'AI 配图' }).click();
      await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 60000 });

      // Step 13: Input description (following test.py logic)
      this.log('[DEBUG] Step 13: Inputting description for AI image');
      const descriptionInput = this.authenticatedPage.getByRole('textbox', { name: '请描述你想要创作的内容' });
      await descriptionInput.waitFor({ timeout: 60000 });
      await descriptionInput.click();
      await descriptionInput.fill(title);
      this.log(`[DEBUG] Description filled: "${title}"`);

      // Step 14: Click start creation (following test.py logic)
      this.log('[DEBUG] Step 14: Clicking "开始创作"');
      await this.authenticatedPage.getByRole('button', { name: '开始创作' }).click();
      await this.authenticatedPage.waitForTimeout(10000); // Wait for AI to generate images

      // Step 15: Select image (following test.py logic)
      this.log('[DEBUG] Step 15: Selecting AI generated image');
      const imageSelector = this.authenticatedPage.locator('div:nth-child(8) > .ai-image-list > div:nth-child(4) > .ai-image-item-wrp');
      await imageSelector.waitFor({ timeout: 60000 });
      await imageSelector.click();
      this.log('[DEBUG] Image selected');

      // Step 16: Click use (following test.py logic)
      this.log('[DEBUG] Step 16: Clicking "使用"');
      await this.authenticatedPage.getByRole('button', { name: '使用' }).click();
      await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 60000 });

      // Step 17: Click confirm (following test.py logic)
      this.log('[DEBUG] Step 17: Clicking "确认"');
      await this.authenticatedPage.getByRole('button', { name: '确认' }).click();
      await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 60000 });

      // Step 18: Set original declaration if enabled (following test.py logic)
      if (isOriginal) {
        this.log('[DEBUG] Step 18: Setting original declaration');
        await this.authenticatedPage.getByText('原创').nth(2).click();
        await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 30000 });
        await this.authenticatedPage.getByText('文字原创').click();
        await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 30000 });
        await this.authenticatedPage.locator('#js_original_edit_box').getByRole('textbox', { name: '请输入作者' }).click();
        await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 30000 });
        
        // Handle original agreement popup
        const popupPromise = this.authenticatedPage.waitForEvent('popup', { timeout: 10000 });
        await this.authenticatedPage.locator('.original_agreement').click();
        try {
          const page2 = await popupPromise;
          await page2.close();
        } catch (error) {
          this.log('[DEBUG] No popup detected for original agreement', 'warn');
        }
        
        await this.authenticatedPage.locator('.weui-desktop-icon-checkbox').click();
        await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 30000 });
        
        // Hover over confirm button to activate it
        const originalConfirmButton = this.authenticatedPage.getByRole('button', { name: '确定' });
        await originalConfirmButton.hover();
        await this.authenticatedPage.waitForTimeout(500); // Waitress button to activate
        await originalConfirmButton.click();
        await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 30000 });
        this.log('[DEBUG] Original declaration set');
      }

      // Step 19: Set appreciation if enabled (following test.py logic)
      if (enableAppreciation) {
        this.log('[DEBUG] Step 19: Setting appreciation');
        await this.authenticatedPage.locator('#js_reward_setting_area').getByText('不开启').click();
        await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 30000 });
        await this.authenticatedPage.getByRole('textbox', { name: '选择或搜索赞赏账户' }).click();
        await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 30000 });
        await this.authenticatedPage.getByText('赞赏类型').click();
        await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 30000 });
        await this.authenticatedPage.locator('#vue_app').getByText('赞赏账户', { exact: true }).click();
        await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 30000 });
        await this.authenticatedPage.getByText('赞赏自动回复').click();
        await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 30000 });
        await this.authenticatedPage.locator('.weui-desktop-icon-checkbox').click();
        await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 30000 });
        await this.authenticatedPage.locator('.weui-desktop-icon-checkbox').click();
        await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 30000 });
        
        // Hover over the confirm button to activate it
        const confirmButton = this.authenticatedPage.getByRole('button', { name: '确定' });
        await confirmButton.hover();
        await this.authenticatedPage.waitForTimeout(500); // Wait for button to activate
        await confirmButton.click();
        await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 30000 });
        this.log('[DEBUG] Appreciation enabled');
      }

      // Step 20: Set collection if provided (following test.py logic)
      if (defaultCollection) {
        this.log(`[DEBUG] Step 20: Setting collection: ${defaultCollection}`);
        await this.authenticatedPage.locator('#js_article_tags_area').getByText('未添加').click();
        await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 30000 });
        await this.authenticatedPage.getByRole('textbox', { name: '请选择合集' }).click();
        await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 30000 });
        await this.authenticatedPage.getByText(defaultCollection).click();
        await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 30000 });
        await this.authenticatedPage.getByText('每篇文章最多添加1个合集').click();
        await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 30000 });
        await this.authenticatedPage.getByRole('button', { name: '确认' }).click();
        await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 30000 });
        this.log(`[DEBUG] Collection set: ${defaultCollection}`);
      }

      // Step 21: Save as draft or publish (following test.py logic)
      if (publish) {
        this.log('[DEBUG] Step 21: Publishing article');
        await this.authenticatedPage.getByRole('button', { name: '发表' }).click();
        await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 60000 });

        this.log('[DEBUG] Step 22: Clicking "群发通知"');
        await this.authenticatedPage.getByText('群发通知', { exact: true }).click();
        await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 30000 });

        this.log('[DEBUG] Step 23: Clicking "定时发表"');
        await this.authenticatedPage.getByText('定时发表', { exact: true }).click();
        await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 30000 });

        this.log('[DEBUG] Step 24: Confirming publish');
        await this.authenticatedPage.locator('#vue_app').getByRole('button', { name: '发表' }).click();
        await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 60000 });

        this.log('[DEBUG] Step 25: Clicking "未开启群发通知"');
        await this.authenticatedPage.getByText('未开启群发通知', { exact: true }).click();
        await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 30000 });

        this.log('[DEBUG] Step 26: Clicking content recommendation notice');
        await this.authenticatedPage.getByText('内容将展示在公众号主页，若允许平台推荐，内容有可能被推荐至看一看或其他推荐场景。').click();
        await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 30000 });

        this.log('[DEBUG] Step 27: Clicking "继续发表"');
        await this.authenticatedPage.getByRole('button', { name: '继续发表' }).click();
        await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 60000 });

        this.log('[DEBUG] Article published successfully');
        vscode.window.showInformationMessage('Article published successfully in Chrome');
      } else {
        this.log('[DEBUG] Step 21: Saving as draft');
        const saveButton = this.authenticatedPage.getByRole('button', { name: '保存为草稿' });
        await saveButton.waitFor({ timeout: 60000 });
        await saveButton.click();
        await this.authenticatedPage.waitForLoadState('networkidle', { timeout: 60000 });

        this.log('[DEBUG] Draft saved successfully');
        vscode.window.showInformationMessage('Draft saved successfully in Chrome');
      }

      const draftUrl = this.authenticatedPage.url();
      this.log(`[DEBUG] Final URL: ${draftUrl}`);

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
