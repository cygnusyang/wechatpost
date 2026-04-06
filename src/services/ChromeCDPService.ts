// ChromeCDPService - Uses Puppeteer (CDP) to automate Chrome browser for WeChat login and publishing
// Launches external Chrome, supports:
// 1. First-time login: user scans QR, extract cookies automatically
// 2. Authenticated session: inject existing cookies, keep browser open for automated publishing

import puppeteer from 'puppeteer';
import type { Browser, Page, CookieParam } from 'puppeteer';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const LOGIN_TIMEOUT_MS = 120000; // 2 minutes timeout for user to scan QR
const POLL_INTERVAL_MS = 2000; // Check every 2 seconds for login completion

export class ChromeCDPService {
  private outputChannel: vscode.OutputChannel;
  private browser: Browser | null = null;
  private authenticatedPage: Page | null = null;
  private userDataDir: string;

  constructor(outputChannel: vscode.OutputChannel, storagePath: string) {
    this.outputChannel = outputChannel;
    this.userDataDir = path.join(storagePath, 'chrome-profile');
    fs.mkdirSync(this.userDataDir, { recursive: true });
  }

  private log(message: string, level: 'info' | 'error' | 'warn' = 'info'): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [CDP] [${level.toUpperCase()}] ${message}`;
    this.outputChannel.appendLine(logMessage);
    if (level === 'error') {
      console.error(logMessage);
    } else {
      console.log(logMessage);
    }
  }

  /**
   * First-time login flow - launch Chrome, let user scan QR, extract cookies
   * @returns Array of full cookie objects from Puppeteer
   */
  async startFirstTimeLogin(): Promise<CookieParam[]> {
    this.log('Starting first-time login flow');

    const browser = await this.launchBrowser();
    this.browser = browser;

    try {
      const page = await browser.newPage();
      this.log('New page opened, navigating to mp.weixin.qq.com');

      await page.goto('https://mp.weixin.qq.com/', {
        waitUntil: 'networkidle2',
      });

      this.log('Page loaded, waiting for user to scan QR code and login');
      vscode.window.showInformationMessage('Chrome opened. Please scan QR code to login. Waiting...');

      // Wait for login to complete by checking if token exists in window.global
      const isLoggedIn = await this.waitForLogin(page);

      if (!isLoggedIn) {
        this.log('Login timeout waiting for user to scan QR', 'error');
        await this.close();
        throw new Error('Login timeout. Please try again and scan QR code within 2 minutes.');
      }

      this.log('Login detected, extracting cookies');

      // Get all cookies from page for current URL
      const cookies = await page.cookies();
      this.log(`Extracted ${cookies.length} cookies from Chrome`);

      // Keep browser open for authenticated session
      this.authenticatedPage = page;
      this.log('Login flow completed, browser kept open for authenticated operations');

      return cookies;
    } catch (error) {
      this.log(`Error during login flow: ${error}`, 'error');
      await this.close();
      throw error;
    }
  }

  private async launchBrowser(): Promise<Browser> {
    return await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      userDataDir: this.userDataDir,
      args: [
        '--start-maximized',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-crashpad',
        '--disable-breakpad',
      ],
    });
  }

  /**
   * Start an authenticated session with existing cookies from local storage
   * @param cookies Array of full CookieParam objects extracted from Chrome
   */
  async startAuthenticatedSession(cookies: CookieParam[]): Promise<void> {
    this.log(`Starting authenticated session with ${cookies.length} saved cookies`);

    // If we already have an active connected browser session, reuse it
    if (this.browser && this.browser.connected && this.authenticatedPage) {
      this.log('Reusing existing active browser session');
      return;
    }

    // If we get here, either browser is closed or disconnected - need to start a new one
    this.log('No active browser session, starting new');

    // Clean up any existing browser object
    if (this.browser) {
      try {
        if (!this.browser.connected) {
          this.browser = null;
          this.authenticatedPage = null;
        }
      } catch (error) {
        this.log(`Error cleaning up disconnected browser: ${error}`, 'info');
        this.browser = null;
        this.authenticatedPage = null;
      }
    }

    const validCookies = cookies
      .map(cookie => this.normalizeCookieForInjection(cookie))
      .filter((cookie): cookie is CookieParam => cookie !== null);

    this.log(`Filtered to ${validCookies.length} valid cookies out of ${cookies.length} total`);

    this.browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args: [
        '--start-maximized',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    try {
      const page = await this.browser.newPage();

      // Navigate first (required for domain/path cookie validation in CDP)
      // CDP cannot set cookies with domain until page is on correct domain
      await page.goto('https://mp.weixin.qq.com/', {
        waitUntil: 'networkidle2',
      });

      // Now set cookies after navigation - set one by one with individual error handling
      // If a cookie fails, just log and skip it (inspired by automation/buying scripts)
      let successCount = 0;
      let failCount = 0;
      const context = page.browserContext();
      for (const cookie of validCookies) {
        try {
          // 使用类型断言来告诉TypeScript，cookie已经符合CookieData的类型要求
          await context.setCookie(cookie as any);
          successCount++;
        } catch (error) {
          failCount++;
          this.log(`Failed to set cookie "${cookie.name}", skipping it. Error: ${error}`, 'warn');
        }
      }
      this.log(`Cookie injection complete: ${successCount} succeeded, ${failCount} failed`);

      // Only fail if all cookies failed
      if (successCount === 0 && failCount > 0) {
        throw new Error(`All ${failCount} cookies failed to set. Cannot proceed with authentication.`);
      }

      // Check if we're already logged in
      const isLoggedIn = await this.waitForLogin(page);

      if (isLoggedIn) {
        this.log('Already authenticated with saved cookies');
        vscode.window.showInformationMessage('Chrome opened, already authenticated with saved login');
      } else {
        this.log('Not logged in with saved cookies, waiting for user to scan QR');
        vscode.window.showInformationMessage('Chrome opened. Please scan QR code to login');
        const loggedIn = await this.waitForLogin(page);
        if (!loggedIn) {
          await this.close();
          throw new Error('Login timeout. Please try again.');
        }
        this.log('Login completed after QR scan');
      }

      this.authenticatedPage = page;
      this.log('Authenticated session ready');
    } catch (error) {
      this.log(`Error starting authenticated session: ${error}`, 'error');
      await this.close();
      throw error;
    }
  }

  private normalizeCookieForInjection(cookie: CookieParam): any {
    if (!cookie?.name || typeof cookie.value !== 'string') {
      this.log(`Skipping invalid cookie (missing name/value): ${JSON.stringify(cookie)}`, 'warn');
      return null;
    }

    const normalized: any = {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain || '.mp.weixin.qq.com', // 确保domain属性始终有值
      path: cookie.path || '/',
    };

    if (typeof cookie.url === 'string' && cookie.url.length > 0) {
      normalized.url = cookie.url;
    }

    if (typeof cookie.secure === 'boolean') {
      normalized.secure = cookie.secure;
    }
    if (typeof cookie.httpOnly === 'boolean') {
      normalized.httpOnly = cookie.httpOnly;
    }

    // sameSite - only accept exact valid values
    const validSameSiteValues = ['Strict', 'Lax', 'None'] as const;
    if (typeof cookie.sameSite === 'string' && validSameSiteValues.includes(cookie.sameSite as any)) {
      normalized.sameSite = cookie.sameSite as any;
    }
    // else: omit entirely

    // expires - only add if it's a positive finite number (0 = session cookie, omit)
    if (typeof cookie.expires === 'number' && Number.isFinite(cookie.expires) && cookie.expires > 0) {
      normalized.expires = cookie.expires;
    }
    // else: omit entirely

    return normalized;
  }

  /**
   * Create a new draft directly in WeChat MP via browser automation
   * @param title Article title
   * @param author Article author
   * @param content Article HTML content
   * @param digest Article digest
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

    // 导航路径：首页 → 内容管理 → 草稿箱 → 新的创作
    const homeUrl = 'https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN';
    this.log(`[DEBUG] Step 2: Navigating to home page: ${homeUrl}`);
    await page.goto(homeUrl, {
      waitUntil: 'networkidle2',
    });
    const homeFinalUrl = page.url();
    this.log(`[DEBUG] Step 2 complete: Navigated to home. Final URL: ${homeFinalUrl}`);

    // 点击内容管理
    this.log('[DEBUG] Step 3: Clicking content management');
    const contentManagementSelectors = [
      'a[href*="content"]',
      'a[href*="draft"]',
      'a[title*="内容"]',
      'a[title*="管理"]',
      'a:has(span:contains("内容"))',
      'a:has(span:contains("管理"))'
    ];

    let contentManagementClicked = false;
    for (const selector of contentManagementSelectors) {
      try {
        this.log(`[DEBUG] Trying selector: ${selector}`);
        await page.waitForSelector(selector, { timeout: 5000, visible: true });
        this.log(`[DEBUG] Selector found: ${selector}, clicking...`);
        await page.click(selector);
        contentManagementClicked = true;
        this.log('[DEBUG] Content management clicked');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        this.log(`[DEBUG] Navigated to: ${page.url()}`);
        break;
      } catch (error) {
        this.log(`[DEBUG] Selector ${selector} not found: ${error}`);
      }
    }

    if (!contentManagementClicked) {
      this.log('[DEBUG] Content management not found, trying direct navigation');
      await page.goto('https://mp.weixin.qq.com/cgi-bin/appmsg?action=list&type=10&count=20&day=7', {
        waitUntil: 'networkidle2',
      });
    }

    // 点击草稿箱
    this.log('[DEBUG] Step 4: Clicking draft box');
    const draftBoxSelectors = [
      'a[href*="draft"]',
      'a[title*="草稿"]',
      'a:has(span:contains("草稿"))',
      'a[href*="appmsg?action=draft"]'
    ];

    let draftBoxClicked = false;
    for (const selector of draftBoxSelectors) {
      try {
        this.log(`[DEBUG] Trying selector: ${selector}`);
        await page.waitForSelector(selector, { timeout: 5000, visible: true });
        this.log(`[DEBUG] Selector found: ${selector}, clicking...`);
        await page.click(selector);
        draftBoxClicked = true;
        this.log('[DEBUG] Draft box clicked');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        this.log(`[DEBUG] Navigated to: ${page.url()}`);
        break;
      } catch (error) {
        this.log(`[DEBUG] Selector ${selector} not found: ${error}`);
      }
    }

    if (!draftBoxClicked) {
      this.log('[DEBUG] Draft box not found, trying direct navigation');
      await page.goto('https://mp.weixin.qq.com/cgi-bin/appmsg?action=draft', {
        waitUntil: 'networkidle2',
      });
    }

    // 点击新的创作
    this.log('[DEBUG] Step 5: Clicking new creation');
    const newCreationSelectors = [
      'a[href*="appmsg_edit"]',
      'a[href*="operate_appmsg"]',
      'a[title*="新建"]',
      'a[title*="创作"]',
      'a:has(span:contains("新建"))',
      'a:has(span:contains("创作"))',
      'button:contains("新建")',
      'button:contains("创作")',
      '[class*="new"]',
      '.weui-btn-new'
    ];

    let newCreationClicked = false;
    for (const selector of newCreationSelectors) {
      try {
        this.log(`[DEBUG] Trying selector: ${selector}`);
        await page.waitForSelector(selector, { timeout: 5000, visible: true });
        this.log(`[DEBUG] Selector found: ${selector}, clicking...`);
        await page.click(selector);
        newCreationClicked = true;
        this.log('[DEBUG] New creation clicked');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        this.log(`[DEBUG] Navigated to: ${page.url()}`);
        break;
      } catch (error) {
        this.log(`[DEBUG] Selector ${selector} not found: ${error}`);
      }
    }

    if (!newCreationClicked) {
      this.log('[DEBUG] New creation button not found, trying direct navigation');
      await page.goto('https://mp.weixin.qq.com/cgi-bin/operate_appmsg?t=media/appmsg_edit&action=edit&type=77&appmsgid=100000000', {
        waitUntil: 'networkidle2',
      });
    }

    // 点击"写新文章"按钮（如果存在）
    this.log('[DEBUG] Step 6: Checking and clicking "Write New Article" button');
    const writeNewArticleSelectors = [
      'a[href*="appmsg_edit"]',
      'a[title*="写新文章"]',
      'a:has(span:contains("写新文章"))',
      'button:contains("写新文章")',
      '[class*="write"]'
    ];

    let writeNewArticleClicked = false;
    for (const selector of writeNewArticleSelectors) {
      try {
        this.log(`[DEBUG] Trying selector: ${selector}`);
        await page.waitForSelector(selector, { timeout: 3000, visible: true });
        this.log(`[DEBUG] Selector found: ${selector}, clicking...`);
        await page.click(selector);
        writeNewArticleClicked = true;
        this.log('[DEBUG] Write New Article button clicked');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        this.log(`[DEBUG] Navigated to: ${page.url()}`);
        break;
      } catch (error) {
        this.log(`[DEBUG] Selector ${selector} not found or failed to click: ${error}`);
      }
    }

    if (!writeNewArticleClicked) {
      this.log('[DEBUG] Write New Article button not found or not needed');
    }

    // Wait for editor to load
    this.log('[DEBUG] Step 6: Waiting for editor to load');

    // Wait for editor to load - try multiple selectors
    const editorSelectors = ['#js_media_edit', '#editorContainer', '.editor-container', '.ueditor-wrapper'];
    let editorElement = null;
    for (const selector of editorSelectors) {
      try {
        this.log(`[DEBUG] Trying selector: ${selector}`);
        await page.waitForSelector(selector, { timeout: 5000 });
        editorElement = selector;
        this.log(`[DEBUG] Editor loaded, found selector: ${selector}`);
        break;
      } catch (error) {
        this.log(`[DEBUG] Selector ${selector} not found: ${error}`);
        // Try next selector
      }
    }

    if (!editorElement) {
      // Fallback: just wait for title field which should always exist
      this.log('[DEBUG] Editor selectors not found, waiting for title field instead');

      // Debug: Check what elements are actually on page
      this.log('[DEBUG] Inspecting page structure...');
      const pageContent = await page.evaluate(() => {
        // Get all input elements
        const inputs = Array.from(document.querySelectorAll('input')).map(el => ({
          id: el.id,
          name: el.name,
          type: el.type,
          placeholder: el.placeholder,
        }));
        // Get all textareas
        const textareas = Array.from(document.querySelectorAll('textarea')).map(el => ({
          id: el.id,
          name: el.name,
        }));
        // Get any elements with 'title' in their id or class
        const titleElements = Array.from(document.querySelectorAll('[id*="title"], [class*="title"]')).map(el => ({
          tagName: el.tagName,
          id: el.id,
          className: el.className,
        }));
        // Get page page title and body text to help diagnose
        const pageTitle = document.title;
        const bodyText = document.body?.innerText?.substring(0, 500) || '';
        const bodyHTML = document.body?.innerHTML?.substring(0, 1000) || '';
        return { inputs, textareas, titleElements, url: window.location.href, pageTitle, bodyText, bodyHTML };
      });
      this.log(`[DEBUG] Page structure: ${JSON.stringify(pageContent, null, 2)}`);

      this.log('[DEBUG] Waiting for #title field (30s timeout)...');
      await page.waitForSelector('#title', { timeout: 30000 });
      this.log('[DEBUG] Title field found, continuing...');
    }

    // Fill title
    this.log('[DEBUG] Step 6: Filling title field');
    await page.waitForSelector('#title', { timeout: 10000 });
    await page.evaluate((titleText: string) => {
      const titleInput = document.getElementById('title') as HTMLInputElement;
      if (titleInput) {
        titleInput.value = titleText;
        // Trigger input event to notify WeChat JS
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, title);
    this.log('[DEBUG] Title filled');

    // Fill author
    this.log('[DEBUG] Step 7: Filling author field');
    await page.waitForSelector('#author', { timeout: 10000 });
    await page.evaluate((authorText: string) => {
      const authorInput = document.getElementById('author') as HTMLInputElement;
      if (authorInput) {
        authorInput.value = authorText;
        authorInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, author);
    this.log('[DEBUG] Author filled');

    // Wait for rich text editor iframe to load
    this.log('[DEBUG] Step 8: Waiting for editor iframe (#ueditor_iframe)');
    await page.waitForSelector('#ueditor_iframe', { timeout: 10000 });
    this.log('[DEBUG] Editor iframe found, looking for ueditor frame');
    const frame = page.frames().find(f => f.url().includes('ueditor'));

    if (!frame) {
      throw new Error('Could not find editor iframe');
    }
    this.log(`[DEBUG] Found editor frame, URL: ${frame.url()}`);

    // Wait for body to be available
    this.log('[DEBUG] Step 9: Waiting for editor body');
    await frame.waitForSelector('body', { timeout: 10000 });
    this.log('[DEBUG] Editor body ready');

    // Set HTML content into editor
    this.log('[DEBUG] Step 10: Setting article HTML content');
    await frame.evaluate((html: string) => {
      const body = document.body;
      if (body) {
        body.innerHTML = html;
        // Trigger change event
        body.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, content);
    this.log('[DEBUG] Article content set');

    // Fill digest if provided
    if (digest) {
      this.log('[DEBUG] Step 11: Filling digest if available');
      try {
        await page.waitForSelector('#digest', { timeout: 5000 });
        await page.evaluate((digestText: string) => {
          const digestInput = document.getElementById('digest') as HTMLTextAreaElement;
          if (digestInput) {
            digestInput.value = digestText;
            digestInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, digest);
        this.log('[DEBUG] Digest filled');
      } catch (error) {
        this.log('[DEBUG] Digest field not found, skipping');
      }
    }

    // Find save draft button and click it
    this.log('[DEBUG] Step 12: Finding and clicking Save Draft button (#js_submit)');
    await page.waitForSelector('#js_submit', { timeout: 10000 });
    this.log('[DEBUG] Save Draft button found, clicking...');
    await page.click('#js_submit');
    this.log('[DEBUG] Save Draft button clicked');

    // Wait for save to complete and get to draft URL
    this.log('[DEBUG] Step 13: Waiting for navigation after save (60s timeout)');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
    this.log('[DEBUG] Navigation complete');

    // Get current URL which is the edit URL for created draft
    const draftUrl = page.url();
    this.log(`[DEBUG] Step 14: Draft created successfully, URL: ${draftUrl}`);
    vscode.window.showInformationMessage('Draft created successfully in Chrome');

    return draftUrl;
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

  /**
   * Wait for login to complete by polling page for token presence
   * We check if window.global has token which indicates successful login
   */
  private async waitForLogin(page: Page): Promise<boolean> {
    const startTime = Date.now();
    let checksPassed = 0;

    while (Date.now() - startTime < LOGIN_TIMEOUT_MS) {
      try {
        // Check if we have token in window.global (WeChat MP sets this after login)
        const hasToken = await page.evaluate(() => {
          // @ts-ignore
          return !!(window.global && window.global.token);
        });

        if (hasToken) {
          this.log('Login detected: token found in window.global');
          return true;
        }

        // Also check if user_info exists as an alternative indicator
        const hasUserInfo = await page.evaluate(() => {
          // @ts-ignore
          return !!(window.global && window.global.user_info);
        });

        if (hasUserInfo) {
          this.log('Login detected: user_info found in window.global');
          return true;
        }

        // Additional check: if URL contains 'token=' parameter, we're likely logged in
        const url = page.url();
        if (url.includes('token=') && !url.includes('appmsg_edit')) {
          this.log(`Login detected: token found in URL: ${url}`);
          return true;
        }

        // Debug: periodically log window.global content
        checksPassed++;
        if (checksPassed % 5 === 0) {
          const globalContent = await page.evaluate(() => {
            // @ts-ignore
            return typeof window.global !== 'undefined' ? JSON.stringify(window.global, null, 2) : 'window.global undefined';
          });
          this.log(`Login check # ${checksPassed}: page URL = ${url}`);
          this.log(`window.global content: ${globalContent.substring(0, 500)}`, 'info');
        }
      } catch (evalError) {
        // Ignore evaluation errors, continue polling
        this.log(`Evaluation error during login check: ${evalError}`, 'info');
      }

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    // Timeout - log current page state before giving up
    this.log(`Login timeout: checking final page state`, 'warn');
    try {
      const finalUrl = page.url();
      this.log(`Final page URL: ${finalUrl}`, 'warn');
      const globalContent = await page.evaluate(() => {
        // @ts-ignore
        return typeof window.global !== 'undefined' ? JSON.stringify(window.global, null, 2) : 'window.global undefined';
      });
      this.log(`Final window.global: ${globalContent}`, 'warn');
    } catch (e) {
      this.log(`Could not capture final page state: ${e}`, 'error');
    }

    return false;
  }
}
