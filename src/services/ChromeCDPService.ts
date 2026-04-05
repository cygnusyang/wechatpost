// ChromeCDPService - Uses Puppeteer (CDP) to automate Chrome browser for WeChat login and publishing
// Launches external Chrome, supports:
// 1. First-time login: user scans QR, extract cookies automatically
// 2. Authenticated session: inject existing cookies, keep browser open for automated publishing

import puppeteer from 'puppeteer';
import type { Browser, Page, CookieParam } from 'puppeteer';
import * as vscode from 'vscode';

const LOGIN_TIMEOUT_MS = 120000; // 2 minutes timeout for user to scan QR
const POLL_INTERVAL_MS = 2000; // Check every 2 seconds for login completion

export class ChromeCDPService {
  private outputChannel: vscode.OutputChannel;
  private browser: Browser | null = null;
  private authenticatedPage: Page | null = null;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
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

    const browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args: [
        '--start-maximized',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    this.browser = browser;

    try {
      const page = await browser.newPage();
      this.log('New page opened, navigating to mp.weixin.qq.com');

      await page.goto('https://mp.weixin.qq.com/', {
        waitUntil: 'networkidle2',
      });

      this.log('Page loaded, waiting for user to scan QR code and login');
      vscode.window.showInformationMessage('Chrome opened. Please scan the QR code to login. Waiting...');

      // Wait for login to complete by checking if token exists in window.global
      const isLoggedIn = await this.waitForLogin(page);

      if (!isLoggedIn) {
        this.log('Login timeout waiting for user to scan QR', 'error');
        await this.close();
        throw new Error('Login timeout. Please try again and scan the QR code within 2 minutes.');
      }

      this.log('Login detected, extracting cookies');

      // Get all cookies from the page for the current URL
      const cookies = await page.cookies(page.url());
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

    // Cookies are already full CookieParam objects from storage (saved when extracted from Chrome)

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

      // Set cookies before navigating
      for (const cookie of cookies) {
        await page.setCookie(cookie);
      }
      this.log(`Injected ${cookies.length} cookies into browser`);

      await page.goto('https://mp.weixin.qq.com/', {
        waitUntil: 'networkidle2',
      });

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
    this.log(`Starting draft creation: title="${title}"`);

    // Navigate to the draft creation page
    const createUrl = 'https://mp.weixin.qq.com/cgi-bin/operate_appmsg?t=media/appmsg_edit&action=edit&type=77&appmsgid=100000000';
    await page.goto(createUrl, {
      waitUntil: 'networkidle2',
    });
    this.log('Navigated to draft creation page');

    // Wait for editor to load
    await page.waitForSelector('#js_media_edit', { timeout: 30000 });
    this.log('Editor loaded');

    // Fill title
    await page.waitForSelector('#title', { timeout: 10000 });
    await page.evaluate((titleText: string) => {
      const titleInput = document.getElementById('title') as HTMLInputElement;
      if (titleInput) {
        titleInput.value = titleText;
        // Trigger input event to notify WeChat JS
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, title);
    this.log('Filled title');

    // Fill author
    await page.waitForSelector('#author', { timeout: 10000 });
    await page.evaluate((authorText: string) => {
      const authorInput = document.getElementById('author') as HTMLInputElement;
      if (authorInput) {
        authorInput.value = authorText;
        authorInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, author);
    this.log('Filled author');

    // Wait for the rich text editor iframe to load
    await page.waitForSelector('#ueditor_iframe', { timeout: 10000 });
    const frame = page.frames().find(f => f.url().includes('ueditor'));

    if (!frame) {
      throw new Error('Could not find editor iframe');
    }

    // Wait for body to be available
    await frame.waitForSelector('body', { timeout: 10000 });

    // Set the HTML content into the editor
    await frame.evaluate((html: string) => {
      const body = document.body;
      if (body) {
        body.innerHTML = html;
        // Trigger change event
        body.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, content);
    this.log('Filled article content');

    // Fill digest if provided
    if (digest) {
      try {
        await page.waitForSelector('#digest', { timeout: 5000 });
        await page.evaluate((digestText: string) => {
          const digestInput = document.getElementById('digest') as HTMLTextAreaElement;
          if (digestInput) {
            digestInput.value = digestText;
            digestInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, digest);
        this.log('Filled digest');
      } catch (error) {
        this.log('Digest field not found, skipping', 'info');
      }
    }

    // Find the save draft button and click it
    await page.waitForSelector('#js_save', { timeout: 10000 });
    await page.click('#js_save');
    this.log('Clicked Save Draft button');

    // Wait for save to complete and get the draft URL
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });

    // Get the current URL which is the edit URL for the created draft
    const draftUrl = page.url();
    this.log(`Draft created successfully, draft URL: ${draftUrl}`);
    vscode.window.showInformationMessage('Draft created successfully in Chrome');

    return draftUrl;
  }

  /**
   * Close the browser session
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
   * Wait for login to complete by polling the page for token presence
   * We check if window.global has token which indicates successful login
   */
  private async waitForLogin(page: Page): Promise<boolean> {
    const startTime = Date.now();

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
      } catch (evalError) {
        // Ignore evaluation errors, continue polling
        this.log(`Evaluation error during login check: ${evalError}`, 'info');
      }

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    // Timeout
    return false;
  }
}
