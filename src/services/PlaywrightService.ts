import { chromium, BrowserContext, Locator, Page } from 'playwright';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import MarkdownIt from 'markdown-it';

const LOGIN_TIMEOUT_MS = 120000; // 2 minutes timeout for user to scan QR
const POLL_INTERVAL_MS = 2000; // Check every 2 seconds for login completion
const BUTTON_ACTIVATION_DELAY_MS = 500; // Delay for button activation after hover
const INTERACTION_TIMEOUT_MS = 5000; // Timeout for best-effort page settle
const DIALOG_TIMEOUT_MS = 30000;
const UI_SETTLE_MS = 500;

export class PlaywrightService {
  private outputChannel: vscode.OutputChannel;
  private context: BrowserContext | null = null;
  private authenticatedPage: Page | null = null;
  private userDataDir: string;
  private markdownParser: MarkdownIt;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
    this.markdownParser = new MarkdownIt({
      breaks: true,
      linkify: true,
    });
    // Set up user data directory for persistent login state
    const homeDir = os.homedir();
    this.userDataDir = path.join(homeDir, '.multipost', 'playwright-user-data');
    this.log(`User data directory: ${this.userDataDir}`);
  }

  private toWechatPlainText(markdown: string): string {
    return markdown
      .replace(/```mermaid[\s\S]*?```/g, '[Mermaid 图]')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/^###\s+(.+)$/gm, '$1')
      .replace(/^##\s+(.+)$/gm, '【$1】')
      .replace(/^#\s+(.+)$/gm, '【$1】')
      .replace(/^\s*[-*]\s+/gm, '• ')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/__(.*?)__/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[(.*?)\]\((.*?)\)/g, '$1 ($2)')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private async renderMermaidToSvgDataUrl(diagramCode: string): Promise<string | null> {
    if (!this.context) {
      return null;
    }

    const renderPage = await this.context.newPage();
    try {
      await renderPage.setContent('<html><body><div id="root"></div></body></html>');
      await renderPage.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js' });

      const svg = await renderPage.evaluate(async (code) => {
        const mermaidApi = (window as any).mermaid;
        mermaidApi.initialize({ startOnLoad: false, securityLevel: 'loose' });
        const renderId = `mp-mermaid-${Date.now()}`;
        const result = await mermaidApi.render(renderId, code);
        return result.svg as string;
      }, diagramCode);

      return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    } catch (error) {
      this.log(`Failed to render Mermaid diagram, fallback to text block: ${error}`, 'warn');
      return null;
    } finally {
      await renderPage.close();
    }
  }

  private async renderMarkdownToWechatHtml(markdown: string): Promise<string> {
    const mermaidBlocks: string[] = [];
    const markdownWithPlaceholders = markdown.replace(/```mermaid\s*([\s\S]*?)```/g, (_match, mermaidCode: string) => {
      const token = `MP_MERMAID_PLACEHOLDER_${mermaidBlocks.length}`;
      mermaidBlocks.push(mermaidCode.trim());
      return token;
    });

    let html = this.markdownParser.render(markdownWithPlaceholders);

    for (let i = 0; i < mermaidBlocks.length; i += 1) {
      const token = `MP_MERMAID_PLACEHOLDER_${i}`;
      const diagramCode = mermaidBlocks[i];
      const dataUrl = await this.renderMermaidToSvgDataUrl(diagramCode);
      const fallbackText = `<pre><code>${this.markdownParser.utils.escapeHtml(diagramCode)}</code></pre>`;
      const mermaidHtml = dataUrl
        ? `<p><img src="${dataUrl}" alt="Mermaid Diagram ${i + 1}" style="max-width: 100%;" /></p>`
        : fallbackText;

      html = html.replace(`<p>${token}</p>`, mermaidHtml).replace(token, mermaidHtml);
    }

    return html;
  }

  private async fillBodyWithFormattedMarkdown(markdown: string): Promise<void> {
    if (!this.authenticatedPage) {
      throw new Error('No authenticated page available.');
    }

    const html = await this.renderMarkdownToWechatHtml(markdown);

    try {
      await this.authenticatedPage.evaluate((renderedHtml) => {
        const candidates = Array.from(document.querySelectorAll('[contenteditable="true"]')) as HTMLElement[];
        const visibleCandidates = candidates.filter((el) => el.offsetParent !== null);
        const editor = visibleCandidates[0];

        if (!editor) {
          throw new Error('Editable content area not found.');
        }

        editor.focus();
        editor.innerHTML = renderedHtml;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }, html);
    } catch (error) {
      this.log(`Failed to inject formatted HTML, fallback to plain text fill: ${error}`, 'warn');
      const fallbackText = this.toWechatPlainText(markdown);
      await this.authenticatedPage.locator('section').click();
      const contentSelector = this.authenticatedPage.locator('div').filter({ hasText: /^从这里开始写正文$/ }).nth(5);
      await contentSelector.waitFor({ timeout: 60000 });
      await contentSelector.fill(fallbackText);
    }
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

  private async waitForUiSettled(page: Page, delayMs: number = UI_SETTLE_MS): Promise<void> {
    await page.waitForTimeout(delayMs);
  }

  private async maybeWaitForNavigation(page: Page, timeoutMs: number = INTERACTION_TIMEOUT_MS): Promise<void> {
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs });
    } catch {
      // Most modal interactions do not navigate; ignore timeout here.
    }
    await this.waitForUiSettled(page);
  }

  private async clickAndStabilize(locator: Locator, page: Page, timeoutMs: number = DIALOG_TIMEOUT_MS): Promise<void> {
    const target = locator.first();
    await target.waitFor({ state: 'visible', timeout: timeoutMs });
    await target.click();
    await this.maybeWaitForNavigation(page);
  }

  /**
   * Check if there's an existing saved login state
   */
  async hasSavedLogin(): Promise<boolean> {
    this.log('Checking for saved login state...');

    const cookieFiles = [
      path.join(this.userDataDir, 'Default', 'Cookies'),
      path.join(this.userDataDir, 'Default', 'Network', 'Cookies'),
      path.join(this.userDataDir, 'Default', 'Network', 'Cookies-journal'),
    ];

    const hasLoginData = cookieFiles.some((cookiePath) => fs.existsSync(cookiePath));
    this.log(hasLoginData ? 'Found local login profile data' : 'No local login profile data found');
    return hasLoginData;
  }

  /**
   * Restore existing login session
   */
  async restoreLogin(): Promise<void> {
    this.log('Restoring saved login session...');
    
    const context = await chromium.launchPersistentContext(this.userDataDir, {
      headless: false,
      args: [
        '--start-maximized',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-crashpad',
        '--disable-breakpad',
      ],
    });
    this.context = context;

    try {
      const page = await context.newPage();
      this.log('New page opened, navigating to mp.weixin.qq.com');

      await page.goto('https://mp.weixin.qq.com/', {
        waitUntil: 'networkidle',
      });

      // Verify login is still valid
      const isLoggedIn = await this.waitForLogin(page);
      
      if (!isLoggedIn) {
        this.log('Saved login session is invalid', 'error');
        await this.close();
        throw new Error('Saved login session is invalid. Please login again.');
      }

      this.log('Login session restored successfully');

      // Keep browser open for authenticated session
      this.authenticatedPage = page;
      this.log('Login restoration completed, browser kept open for authenticated operations');

    } catch (error) {
      this.log(`Error during login restoration: ${error}`, 'error');
      await this.close();
      throw error;
    }
  }

  /**
   * First-time login flow - launch Chrome, let user scan QR, extract cookies
   */
  async startFirstTimeLogin(): Promise<void> {
    this.log('Starting first-time login flow');

    const browser = await chromium.launchPersistentContext(this.userDataDir, {
      headless: false,
      args: [
        '--start-maximized',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-crashpad',
        '--disable-breakpad',
      ],
    });
    this.context = browser;

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
  private async waitForLogin(page: Page, timeout: number = LOGIN_TIMEOUT_MS): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
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
    if (!this.context || !this.authenticatedPage) {
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
      await this.clickAndStabilize(page.getByText('内容管理'), page);

      this.log('[DEBUG] Step 3: Clicking "草稿箱"');
      await this.clickAndStabilize(page.getByRole('link', { name: '草稿箱' }), page);

      this.log('[DEBUG] Step 4: Clicking add button');
      await this.clickAndStabilize(page.locator('.weui-desktop-card__icon-add'), page);

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
        await page1.waitForLoadState('domcontentloaded', { timeout: 60000 });
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
      this.log('[DEBUG] Step 8: Filling formatted content from markdown');
      await this.fillBodyWithFormattedMarkdown(content);
      this.log(`[DEBUG] Formatted content filled, original markdown length: ${content.length}`);

      // Step 9: Click article settings (following test.py logic)
      this.log('[DEBUG] Step 9: Clicking "文章设置"');
      await this.clickAndStabilize(
        this.authenticatedPage.locator('#bot_bar_left_container').getByText('文章设置'),
        this.authenticatedPage
      );

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
      await this.maybeWaitForNavigation(this.authenticatedPage);
      await coverButton.click();
      await this.maybeWaitForNavigation(this.authenticatedPage);

      // Step 12: Click AI cover (following test.py logic)
      this.log('[DEBUG] Step 12: Clicking "AI 配图"');
      await this.clickAndStabilize(this.authenticatedPage.getByRole('link', { name: 'AI 配图' }), this.authenticatedPage);

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
      await this.authenticatedPage.locator('.ai-image-item-wrp:visible').first().waitFor({ timeout: 60000 });

      // Step 15: Select image (following test.py logic)
      this.log('[DEBUG] Step 15: Selecting AI generated image');
      const imageSelector = this.authenticatedPage.locator('.ai-image-item-wrp:visible').first();
      await imageSelector.waitFor({ timeout: 60000 });
      await imageSelector.click();
      this.log('[DEBUG] Image selected');

      // Step 16: Click use (following test.py logic)
      this.log('[DEBUG] Step 16: Clicking "使用"');
      const useButton = this.authenticatedPage.getByRole('button', { name: '使用' }).last();
      await useButton.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });
      if (!(await useButton.isEnabled())) {
        throw new Error('AI cover "使用" button is disabled. Please ensure an image style is selected.');
      }
      await useButton.click();
      await this.waitForUiSettled(this.authenticatedPage);

      // Step 17: Click confirm (following test.py logic)
      this.log('[DEBUG] Step 17: Clicking "确认"');
      const aiConfirmDialog = this.authenticatedPage
        .locator('.weui-desktop-dialog:visible, .dialog_wrp:visible, .popover_dialog:visible')
        .last();
      await aiConfirmDialog.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });
      await aiConfirmDialog.getByRole('button', { name: '确认' }).first().click();
      await aiConfirmDialog.waitFor({ state: 'hidden', timeout: DIALOG_TIMEOUT_MS });

      // Step 18: Set original declaration if enabled (following test.py logic)
      if (isOriginal) {
        this.log('[DEBUG] Step 18: Setting original declaration');
        await this.clickAndStabilize(this.authenticatedPage.getByText('原创').nth(2), this.authenticatedPage);
        await this.clickAndStabilize(this.authenticatedPage.getByText('文字原创'), this.authenticatedPage);
        await this.authenticatedPage.locator('#js_original_edit_box').getByRole('textbox', { name: '请输入作者' }).click();
        await this.waitForUiSettled(this.authenticatedPage);
        
        // Handle original agreement popup
        const popupPromise = this.authenticatedPage.waitForEvent('popup', { timeout: 10000 });
        await this.authenticatedPage.locator('.original_agreement').click();
        try {
          const page2 = await popupPromise;
          await page2.close();
        } catch (error) {
          this.log('[DEBUG] No popup detected for original agreement', 'warn');
        }

        const originalDialog = this.authenticatedPage
          .locator('.weui-desktop-dialog:visible, .dialog_wrp:visible, .popover_dialog:visible')
          .filter({ hasText: /我已阅读并同意|原创|声明/ })
          .first();
        await originalDialog.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });

        // Ensure the agreement checkbox is checked before confirming.
        const agreementText = originalDialog.getByText(/我已阅读并同意/).first();
        if (await agreementText.isVisible({ timeout: 1500 }).catch(() => false)) {
          let agreementCheckbox = agreementText
            .locator('xpath=ancestor::*[self::label or self::div][1]')
            .locator('.weui-desktop-icon-checkbox')
            .first();

          if ((await agreementCheckbox.count()) === 0) {
            agreementCheckbox = originalDialog.locator('.weui-desktop-icon-checkbox').first();
          }

          const className = (await agreementCheckbox.getAttribute('class')) || '';
          const isChecked = /checked|selected|active/.test(className);
          if (!isChecked) {
            await agreementCheckbox.click();
            await this.waitForUiSettled(this.authenticatedPage);
            this.log('[DEBUG] Original agreement checkbox checked');
          }
        }

        // Hover over confirm button to activate it
        const originalConfirmButton = originalDialog.getByRole('button', { name: '确定' }).first();
        await originalConfirmButton.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });
        await originalConfirmButton.hover();
        await this.authenticatedPage.waitForTimeout(BUTTON_ACTIVATION_DELAY_MS);
        await originalConfirmButton.click();
        await originalDialog.waitFor({ state: 'hidden', timeout: DIALOG_TIMEOUT_MS });
        this.log('[DEBUG] Original declaration set');
      }

      // Step 19: Set appreciation if enabled (following test.py logic)
      if (enableAppreciation) {
        this.log('[DEBUG] Step 19: Setting appreciation');
        await this.clickAndStabilize(
          this.authenticatedPage.locator('#js_reward_setting_area').getByText(/不开启|赞赏作者|公益捐赠/),
          this.authenticatedPage
        );

        const rewardDialog = this.authenticatedPage
          .locator('.weui-desktop-dialog:visible, .dialog_wrp:visible, .popover_dialog:visible')
          .filter({ hasText: '赞赏类型' })
          .first();
        await rewardDialog.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });

        const accountInput = rewardDialog.getByRole('textbox', { name: /选择或搜索赞赏账户|赞赏账户/ }).first();
        if (await accountInput.isVisible({ timeout: 1500 }).catch(() => false)) {
          await accountInput.click();
          await accountInput.press('ArrowDown');
          await accountInput.press('Enter');
        }

        const confirmButton = rewardDialog.getByRole('button', { name: '确定' }).first();
        await confirmButton.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });
        if (!(await confirmButton.isEnabled())) {
          await confirmButton.hover();
          await this.authenticatedPage.waitForTimeout(BUTTON_ACTIVATION_DELAY_MS);
        }
        await confirmButton.click();
        await rewardDialog.waitFor({ state: 'hidden', timeout: DIALOG_TIMEOUT_MS });
        this.log('[DEBUG] Appreciation enabled');
      }

      // Step 20: Set collection if provided (following test.py logic)
      if (defaultCollection) {
        this.log(`[DEBUG] Step 20: Setting collection: ${defaultCollection}`);
        await this.authenticatedPage.locator('#js_article_tags_area').getByText('未添加').click();

        const collectionDialog = this.authenticatedPage
          .locator('.weui-desktop-dialog:visible, .dialog_wrp:visible, .popover_dialog:visible')
          .filter({ hasText: '每篇文章最多添加1个合集' })
          .first();
        await collectionDialog.waitFor({ state: 'visible', timeout: 30000 });

        const collectionInput = collectionDialog.getByRole('textbox', { name: '请选择合集' }).first();
        await collectionInput.waitFor({ state: 'visible', timeout: 30000 });
        await collectionInput.click();

        try {
          // Prefer exact match by collection name when it exists.
          const targetCollection = collectionDialog.getByText(defaultCollection, { exact: true }).first();
          await targetCollection.waitFor({ state: 'visible', timeout: 2500 });
          await targetCollection.click();
        } catch (selectByNameError) {
          // Fallback: select the first dropdown option.
          this.log(`[DEBUG] Collection "${defaultCollection}" not found, selecting first option: ${selectByNameError}`, 'warn');
          await collectionInput.press('ArrowDown');
          await collectionInput.press('Enter');
        }

        const collectionConfirmButton = collectionDialog.getByRole('button', { name: '确认' }).first();
        await collectionConfirmButton.waitFor({ state: 'visible', timeout: 30000 });
        await collectionConfirmButton.click();
        await collectionDialog.waitFor({ state: 'hidden', timeout: 30000 });
        this.log(`[DEBUG] Collection set: ${defaultCollection}`);
      }

      // Step 21: Save as draft or publish (following test.py logic)
      if (publish) {
        this.log('[DEBUG] Step 21: Publishing article');
        await this.clickAndStabilize(this.authenticatedPage.getByRole('button', { name: '发表' }), this.authenticatedPage);

        this.log('[DEBUG] Step 22: Clicking "群发通知"');
        await this.clickAndStabilize(this.authenticatedPage.getByText('群发通知', { exact: true }), this.authenticatedPage);

        this.log('[DEBUG] Step 23: Clicking "定时发表"');
        await this.clickAndStabilize(this.authenticatedPage.getByText('定时发表', { exact: true }), this.authenticatedPage);

        this.log('[DEBUG] Step 24: Confirming publish');
        await this.clickAndStabilize(
          this.authenticatedPage.locator('#vue_app').getByRole('button', { name: '发表' }),
          this.authenticatedPage
        );

        this.log('[DEBUG] Step 25: Clicking "未开启群发通知"');
        await this.clickAndStabilize(this.authenticatedPage.getByText('未开启群发通知', { exact: true }), this.authenticatedPage);

        this.log('[DEBUG] Step 26: Clicking content recommendation notice');
        await this.clickAndStabilize(
          this.authenticatedPage.getByText('内容将展示在公众号主页，若允许平台推荐，内容有可能被推荐至看一看或其他推荐场景。'),
          this.authenticatedPage
        );

        this.log('[DEBUG] Step 27: Clicking "继续发表"');
        await this.clickAndStabilize(this.authenticatedPage.getByRole('button', { name: '继续发表' }), this.authenticatedPage);

        this.log('[DEBUG] Article published successfully');
        vscode.window.showInformationMessage('Article published successfully in Chrome');
      } else {
        this.log('[DEBUG] Step 21: Saving as draft');
        const saveButton = this.authenticatedPage.getByRole('button', { name: '保存为草稿' });
        await saveButton.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });
        await saveButton.hover();
        await this.authenticatedPage.waitForTimeout(BUTTON_ACTIVATION_DELAY_MS);
        await saveButton.click();
        await this.waitForUiSettled(this.authenticatedPage, 1000);

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
    if (this.context) {
      try {
        await this.context.close();
      } catch (error) {
        this.log(`Error closing browser context: ${error}`, 'error');
      }
      this.context = null;
      this.authenticatedPage = null;
    }
  }

  /**
   * Check if we have an active authenticated session
   */
  isSessionActive(): boolean {
    return !!(this.context && this.authenticatedPage);
  }
}
