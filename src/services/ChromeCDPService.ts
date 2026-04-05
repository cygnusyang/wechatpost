// ChromeCDPService - Uses Puppeteer (CDP) to automate Chrome browser for WeChat login
// Launches external Chrome, lets user scan QR code, extracts cookies automatically

import puppeteer from 'puppeteer';
import type { Page } from 'puppeteer';
import * as vscode from 'vscode';

const LOGIN_TIMEOUT_MS = 120000; // 2 minutes timeout for user to scan QR
const POLL_INTERVAL_MS = 2000; // Check every 2 seconds for login completion

export class ChromeCDPService {
  private outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
  }

  private log(message: string, level: 'info' | 'error' = 'info'): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [CDP Login] [${level.toUpperCase()}] ${message}`;
    this.outputChannel.appendLine(logMessage);
    if (level === 'error') {
      console.error(logMessage);
    } else {
      console.log(logMessage);
    }
  }

  /**
   * Start the Chrome CDP login flow
   * @returns Array of cookie strings in format "name=value"
   */
  async startLoginFlow(): Promise<string[]> {
    this.log('Starting Chrome CDP login flow');

    const browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args: [
        '--start-maximized',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    this.log('Chrome browser launched');

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
        await browser.close();
        throw new Error('Login timeout. Please try again and scan the QR code within 2 minutes.');
      }

      this.log('Login detected, extracting cookies');

      // Get all cookies from the page
      const cookies = await page.cookies();
      this.log(`Extracted ${cookies.length} cookies from Chrome`);

      // Format cookies into the expected format "name=value"
      const cookieStrings = cookies.map(cookie => `${cookie.name}=${cookie.value}`);

      // Close the browser
      await browser.close();
      this.log('Browser closed, login flow completed successfully');

      return cookieStrings;
    } catch (error) {
      this.log(`Error during login flow: ${error}`, 'error');
      try {
        await browser.close();
      } catch (closeError) {
        this.log(`Failed to close browser: ${closeError}`, 'error');
      }
      throw error;
    }
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
