import { chromium, BrowserContext, Locator, Page } from 'playwright';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import MarkdownIt from 'markdown-it';
import type { ContentStyleSettings } from './SettingsService';

const LOGIN_TIMEOUT_MS = 120000; // 2 minutes timeout for user to scan QR
const POLL_INTERVAL_MS = 2000; // Check every 2 seconds for login completion
const BUTTON_ACTIVATION_DELAY_MS = 500; // Delay for button activation after hover
const INTERACTION_TIMEOUT_MS = 5000; // Timeout for best-effort page settle
const DIALOG_TIMEOUT_MS = 30000;
const DIALOG_CLOSE_TIMEOUT_MS = 10000; // Shorter timeout for dialog close operations
const UI_SETTLE_MS = 500;
const PROCESS_SINGLETON_RECOVERY_DELAY_MS = 400;
const DIALOG_SELECTOR = '.weui-desktop-dialog:visible, .dialog_wrp:visible, .popover_dialog:visible';
const REWARD_DIALOG_POLL_INTERVAL_MS = 200;

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

  private getPersistentLaunchArgs(): string[] {
    return [
      '--start-maximized',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-crashpad',
      '--disable-breakpad',
    ];
  }

  private isProcessSingletonError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /ProcessSingleton|profile.+already in use|another instance of Chromium/i.test(message);
  }

  private clearProfileSingletonLocks(): void {
    const singletonCandidates = [
      'SingletonLock',
      'SingletonCookie',
      'SingletonSocket',
      'SingletonSocketLock',
      path.join('Default', 'SingletonLock'),
      path.join('Default', 'SingletonCookie'),
      path.join('Default', 'SingletonSocket'),
      path.join('Default', 'SingletonSocketLock'),
    ];

    for (const relativePath of singletonCandidates) {
      const targetPath = path.join(this.userDataDir, relativePath);
      try {
        if (!fs.existsSync(targetPath)) {
          continue;
        }
        fs.rmSync(targetPath, { force: true, recursive: true });
        this.log(`Removed stale Chromium singleton artifact: ${targetPath}`, 'warn');
      } catch (cleanupError) {
        this.log(`Failed to remove singleton artifact ${targetPath}: ${cleanupError}`, 'warn');
      }
    }
  }

  private async launchPersistentContextWithRecovery(): Promise<BrowserContext> {
    try {
      return await chromium.launchPersistentContext(this.userDataDir, {
        headless: false,
        args: this.getPersistentLaunchArgs(),
      });
    } catch (launchError) {
      if (!this.isProcessSingletonError(launchError)) {
        throw launchError;
      }

      this.log(
        'Chromium profile appears locked (ProcessSingleton). Attempting one cleanup-and-retry cycle.',
        'warn'
      );

      await this.close();
      this.clearProfileSingletonLocks();
      await new Promise((resolve) => setTimeout(resolve, PROCESS_SINGLETON_RECOVERY_DELAY_MS));

      return chromium.launchPersistentContext(this.userDataDir, {
        headless: false,
        args: this.getPersistentLaunchArgs(),
      });
    }
  }

  private attachContextLifecycleHandlers(context: BrowserContext): void {
    context.once('close', () => {
      if (this.context === context) {
        this.log('Browser context closed; clearing Playwright session references', 'warn');
        this.context = null;
        this.authenticatedPage = null;
      }
    });
  }

  private getOpenPageFromContext(context: BrowserContext): Page | null {
    try {
      const pages = context.pages();
      for (let index = pages.length - 1; index >= 0; index -= 1) {
        const page = pages[index];
        if (!page.isClosed()) {
          return page;
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  private setAuthenticatedPage(page: Page): void {
    this.authenticatedPage = page;

    page.once('close', () => {
      if (this.authenticatedPage !== page) {
        return;
      }

      const context = this.context;
      if (!context) {
        this.authenticatedPage = null;
        return;
      }

      const fallbackPage = this.getOpenPageFromContext(context);
      if (fallbackPage) {
        this.log('Authenticated page closed; switching to another open page', 'warn');
        this.setAuthenticatedPage(fallbackPage);
        return;
      }

      this.log('Authenticated page closed; no open page remains in current context', 'warn');
      this.authenticatedPage = null;
    });
  }

  private getActiveSessionPage(): Page {
    const context = this.context;
    if (!context) {
      throw new Error('No authenticated browser session. Please login first.');
    }

    const currentPage = this.authenticatedPage;
    if (currentPage && !currentPage.isClosed()) {
      return currentPage;
    }

    const fallbackPage = this.getOpenPageFromContext(context);
    if (fallbackPage) {
      this.log('Recovered active page from existing browser context');
      this.setAuthenticatedPage(fallbackPage);
      return fallbackPage;
    }

    this.authenticatedPage = null;
    throw new Error('No authenticated browser page is available. Please login again.');
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

  /**
   * Remove the first top-level heading when it appears as the first content block.
   * WeChat article title is already filled in the title input, so the body should not repeat it.
   */
  private stripLeadingTopLevelHeading(markdown: string): string {
    const lines = markdown.split(/\r?\n/);
    let firstContentIndex = 0;
    while (firstContentIndex < lines.length && lines[firstContentIndex].trim() === '') {
      firstContentIndex += 1;
    }

    if (firstContentIndex >= lines.length) {
      return markdown;
    }

    const currentLine = lines[firstContentIndex].trim();
    let removeEndIndex = -1;

    // ATX style: # Title (allow optional space like "#Title")
    if (/^#(?!#)\s*\S/.test(currentLine)) {
      removeEndIndex = firstContentIndex;
    } else {
      // Setext style:
      // Title
      // =====
      const nextIndex = firstContentIndex + 1;
      if (
        nextIndex < lines.length &&
        lines[firstContentIndex].trim() !== '' &&
        /^=+\s*$/.test(lines[nextIndex].trim())
      ) {
        removeEndIndex = nextIndex;
      }
    }

    if (removeEndIndex === -1) {
      return markdown;
    }

    // Remove the heading block and subsequent empty lines
    while (removeEndIndex + 1 < lines.length && lines[removeEndIndex + 1].trim() === '') {
      removeEndIndex += 1;
    }

    lines.splice(firstContentIndex, removeEndIndex - firstContentIndex + 1);
    return lines.join('\n');
  }

  private async renderMermaidToSvgDataUrl(diagramCode: string): Promise<string | null> {
    if (!this.authenticatedPage) {
      return null;
    }

    const page = this.authenticatedPage;

    try {
      const hasMermaid = await page.evaluate(() => typeof (window as any).mermaid !== 'undefined');
      if (!hasMermaid) {
        try {
          await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js' });
        } catch (loadError) {
          this.log(`Failed to load Mermaid script in current page: ${loadError}`, 'warn');
          return null;
        }
      }

      const svg = await page.evaluate(async (code) => {
        const mermaidApi = (window as any).mermaid;
        if (!mermaidApi) {
          return null;
        }

        mermaidApi.initialize({ startOnLoad: false, securityLevel: 'loose' });
        const renderId = `mp-mermaid-${Date.now()}`;
        const container = document.createElement('div');
        container.style.position = 'fixed';
        container.style.left = '-99999px';
        container.style.top = '0';
        container.style.opacity = '0';
        document.body.appendChild(container);

        try {
          const result = await mermaidApi.render(renderId, code, container);
          return result.svg as string;
        } finally {
          container.remove();
        }
      }, diagramCode);

      if (!svg) {
        return null;
      }

      return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    } catch (error) {
      this.log(`Failed to render Mermaid diagram, fallback to text block: ${error}`, 'warn');
      return null;
    }
  }

  private normalizeHexColor(color: string, fallback: string): string {
    if (/^#[0-9a-fA-F]{6}$/.test(color)) {
      return color.toLowerCase();
    }
    return fallback;
  }

  private mixHexColors(from: string, to: string, weight: number): string {
    const safeWeight = Math.max(0, Math.min(1, weight));
    const parse = (value: string, index: number) => Number.parseInt(value.slice(index, index + 2), 16);
    const fromHex = this.normalizeHexColor(from, '#000000').slice(1);
    const toHex = this.normalizeHexColor(to, '#ffffff').slice(1);
    const mixed = [0, 2, 4].map((index) => {
      const channel = Math.round(parse(fromHex, index) * (1 - safeWeight) + parse(toHex, index) * safeWeight);
      return channel.toString(16).padStart(2, '0');
    });
    return `#${mixed.join('')}`;
  }

  private getThemeTokens(style: ContentStyleSettings): {
    titleAlign: 'left' | 'center';
    quoteBg: string;
    quoteBorder: string;
    inlineCodeBg: string;
    blockCodeBg: string;
    blockCodeBorder: string;
    tableHeaderBg: string;
    dividerColor: string;
    emphasisBg: string;
  } {
    const safeLink = this.normalizeHexColor(style.linkColor, '#0969da');
    const safeText = this.normalizeHexColor(style.textColor, '#1f2329');

    switch (style.themePreset) {
      case 'magazine':
        return {
          titleAlign: 'center',
          quoteBg: this.mixHexColors(safeLink, '#ffffff', 0.92),
          quoteBorder: safeLink,
          inlineCodeBg: this.mixHexColors('#f5efe2', '#ffffff', 0.35),
          blockCodeBg: this.mixHexColors('#f8f4ec', '#ffffff', 0.3),
          blockCodeBorder: this.mixHexColors(safeLink, '#ffffff', 0.78),
          tableHeaderBg: this.mixHexColors(safeLink, '#ffffff', 0.86),
          dividerColor: this.mixHexColors(safeLink, '#ffffff', 0.7),
          emphasisBg: this.mixHexColors(safeLink, '#ffffff', 0.9),
        };
      case 'minimal':
        return {
          titleAlign: 'left',
          quoteBg: '#f6f8fa',
          quoteBorder: this.mixHexColors(safeLink, '#ffffff', 0.45),
          inlineCodeBg: '#f6f8fa',
          blockCodeBg: '#f6f8fa',
          blockCodeBorder: '#d0d7de',
          tableHeaderBg: '#f6f8fa',
          dividerColor: '#d0d7de',
          emphasisBg: this.mixHexColors(safeLink, '#ffffff', 0.9),
        };
      case 'classic':
      default:
        return {
          titleAlign: 'left',
          quoteBg: this.mixHexColors(safeLink, '#ffffff', 0.9),
          quoteBorder: safeLink,
          inlineCodeBg: this.mixHexColors(safeText, '#ffffff', 0.92),
          blockCodeBg: this.mixHexColors(safeText, '#ffffff', 0.95),
          blockCodeBorder: this.mixHexColors(safeLink, '#ffffff', 0.82),
          tableHeaderBg: this.mixHexColors(safeLink, '#ffffff', 0.88),
          dividerColor: this.mixHexColors(safeLink, '#ffffff', 0.78),
          emphasisBg: this.mixHexColors(safeLink, '#ffffff', 0.9),
        };
    }
  }

  private applyThemedStyles(html: string, style: ContentStyleSettings): string {
    const safeStyle: ContentStyleSettings = {
      themePreset: style.themePreset ?? 'classic',
      bodyFontSize: style.bodyFontSize,
      lineHeight: style.lineHeight,
      textColor: this.normalizeHexColor(style.textColor, '#1f2329'),
      headingColor: this.normalizeHexColor(style.headingColor, '#0f172a'),
      linkColor: this.normalizeHexColor(style.linkColor, '#0969da'),
    };

    const tokens = this.getThemeTokens(safeStyle);
    const h1Size = safeStyle.bodyFontSize + 14;
    const h2Size = safeStyle.bodyFontSize + 9;
    const h3Size = safeStyle.bodyFontSize + 5;

    const withImageStyles = html.replace(/<img([^>]*?)>/g, (_match, attrs: string) => {
      if (/style\s*=/.test(attrs)) {
        return `<img${attrs}>`;
      }
      return `<img${attrs} style="max-width:100%;height:auto;display:block;margin:18px auto;border-radius:10px;" />`;
    });

    const styled = withImageStyles
      .replace(
        /<h1>/g,
        `<h1 style="margin:32px 0 20px;padding-bottom:12px;font-size:${h1Size}px;line-height:1.32;font-weight:700;color:${safeStyle.headingColor};text-align:${tokens.titleAlign};border-bottom:1px solid ${tokens.dividerColor};">`
      )
      .replace(
        /<h2>/g,
        `<h2 style="margin:28px 0 16px;padding-left:10px;border-left:4px solid ${safeStyle.linkColor};font-size:${h2Size}px;line-height:1.4;font-weight:700;color:${safeStyle.headingColor};">`
      )
      .replace(
        /<h3>/g,
        `<h3 style="margin:22px 0 12px;font-size:${h3Size}px;line-height:1.45;font-weight:650;color:${safeStyle.headingColor};">`
      )
      .replace(
        /<p>/g,
        `<p style="margin:0 0 18px;font-size:${safeStyle.bodyFontSize}px;line-height:${safeStyle.lineHeight};color:${safeStyle.textColor};letter-spacing:0.01em;">`
      )
      .replace(/<ul>/g, `<ul style="margin:0 0 18px;padding-left:1.25em;font-size:${safeStyle.bodyFontSize}px;line-height:${safeStyle.lineHeight};">`)
      .replace(/<ol>/g, `<ol style="margin:0 0 18px;padding-left:1.25em;font-size:${safeStyle.bodyFontSize}px;line-height:${safeStyle.lineHeight};">`)
      .replace(/<li>/g, '<li style="margin-bottom:10px;">')
      .replace(
        /<blockquote>/g,
        `<blockquote style="margin:0 0 20px;padding:12px 14px;border-left:4px solid ${tokens.quoteBorder};background:${tokens.quoteBg};color:${safeStyle.textColor};border-radius:6px;">`
      )
      .replace(
        /<pre>/g,
        `<pre style="margin:0 0 18px;padding:14px;overflow:auto;background:${tokens.blockCodeBg};border:1px solid ${tokens.blockCodeBorder};border-radius:10px;font-size:${Math.max(13, safeStyle.bodyFontSize - 2)}px;line-height:1.65;">`
      )
      .replace(/<code>/g, `<code style="font-family:Menlo,Consolas,'Courier New',monospace;background:${tokens.inlineCodeBg};padding:2px 4px;border-radius:4px;">`)
      .replace(/<strong>/g, `<strong style="color:${safeStyle.headingColor};background:${tokens.emphasisBg};padding:0 2px;border-radius:3px;">`)
      .replace(/<em>/g, `<em style="color:${safeStyle.headingColor};font-style:italic;">`)
      .replace(/<hr>/g, `<hr style="border:0;border-top:1px solid ${tokens.dividerColor};margin:28px 0;">`)
      .replace(
        /<table>/g,
        '<table style="width:100%;border-collapse:collapse;margin:0 0 20px;font-size:14px;line-height:1.7;">'
      )
      .replace(
        /<th>/g,
        `<th style="padding:8px 10px;border:1px solid ${tokens.dividerColor};background:${tokens.tableHeaderBg};font-weight:600;text-align:left;">`
      )
      .replace(/<td>/g, `<td style="padding:8px 10px;border:1px solid ${tokens.dividerColor};">`)
      .replace(/<a /g, `<a style="color:${safeStyle.linkColor};text-decoration:underline;text-underline-offset:2px;" `);

    return `<section style="max-width:760px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC','Helvetica Neue',Arial,sans-serif;word-break:break-word;color:${safeStyle.textColor};">${styled}</section>`;
  }

  private async renderMarkdownToWechatHtml(markdown: string, style: ContentStyleSettings): Promise<string> {
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

    return this.applyThemedStyles(html, style);
  }

  private async fillBodyWithFormattedMarkdown(markdown: string, style: ContentStyleSettings): Promise<void> {
    if (!this.authenticatedPage) {
      throw new Error('No authenticated page available.');
    }

    const html = await this.renderMarkdownToWechatHtml(markdown, style);

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

  /**
   * Render markdown to themed HTML for local preview in VS Code webview.
   * Mermaid blocks will fallback to code blocks when no authenticated page is available.
   */
  async renderMarkdownPreview(markdown: string, style: ContentStyleSettings): Promise<string> {
    const bodyMarkdown = this.stripLeadingTopLevelHeading(markdown);
    return this.renderMarkdownToWechatHtml(bodyMarkdown, style);
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
   * Safely wait for a dialog to close with
   * Uses a shorter timeout and provides detailed logging
   */
  private async waitForDialogClose(dialogLocator: Locator, dialogName: string): Promise<void> {
    try {
      await dialogLocator.waitFor({ state: 'hidden', timeout: DIALOG_CLOSE_TIMEOUT_MS });
      this.log(`[DEBUG] Dialog "${dialogName}" closed successfully`);
    } catch (error) {
      // Log the error but don't throw - the dialog might have already closed or changed state
      this.log(`[DEBUG] Dialog "${dialogName}" close wait completed with state: ${error instanceof Error ? error.message : String(error)}`, 'warn');
      
      // Verify if dialog is actually still visible
      const isVisible = await dialogLocator.isVisible().catch(() => false);
      if (isVisible) {
        this.log(`[WARN] Dialog "${dialogName}" is still visible after close attempt`, 'warn');
        // Try to close it by pressing Escape as a fallback
        try {
          await dialogLocator.page()?.keyboard.press('Escape');
          await this.waitForUiSettled(dialogLocator.page()!, 200);
          this.log(`[DEBUG] Attempted to close dialog "${dialogName}" via Escape key`);
        } catch (escapeError) {
          this.log(`[WARN] Failed to close dialog "${dialogName}" via Escape: ${escapeError}`, 'warn');
        }
      }
    }
  }

  /**
   * Get a dialog locator with the specified filter text
   * Centralizes dialog selection logic for better maintainability
   */
  private getDialogLocator(filterText: string | RegExp): Locator {
    return this.authenticatedPage!.locator(DIALOG_SELECTOR).filter({ hasText: filterText }).first();
  }

  private async findRewardDialog(timeoutMs: number = DIALOG_TIMEOUT_MS): Promise<Locator> {
    const page = this.authenticatedPage!;
    const rewardDialogCandidates: Locator[] = [
      page
        .locator(DIALOG_SELECTOR)
        .filter({
          has: page.getByRole('textbox', { name: /选择或搜索赞赏账户/ }),
        })
        .first(),
      page
        .locator(DIALOG_SELECTOR)
        .filter({ hasText: /赞赏类型|赞赏自动回复/ })
        .first(),
    ];

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const candidate of rewardDialogCandidates) {
        const isVisible = await candidate.isVisible().catch(() => false);
        if (isVisible) {
          return candidate;
        }
      }
      await page.waitForTimeout(REWARD_DIALOG_POLL_INTERVAL_MS);
    }

    throw new Error('Unable to locate appreciation settings dialog.');
  }

  private async openRewardDialog(): Promise<Locator> {
    const page = this.authenticatedPage!;
    const rewardSettingArea = page.locator('#js_reward_setting_area').first();
    await rewardSettingArea.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });

    const triggerCandidates: Locator[] = [
      rewardSettingArea.getByText('不开启', { exact: true }).first(),
      rewardSettingArea.getByText('已开启').first(),
      rewardSettingArea.getByText('赞赏').first(),
      rewardSettingArea.locator('.weui-desktop-btn, .weui-desktop-switch, .weui-desktop-icon-checkbox').first(),
      rewardSettingArea,
    ];

    for (const trigger of triggerCandidates) {
      const matchCount = await trigger.count().catch(() => 0);
      if (matchCount === 0) {
        continue;
      }

      try {
        await trigger.click();
        await this.waitForUiSettled(page);
      } catch {
        continue;
      }

      try {
        const rewardDialog = await this.findRewardDialog(8000);
        this.log('[DEBUG] Reward dialog opened');
        return rewardDialog;
      } catch {
        // Keep trying with the next trigger candidate.
      }
    }

    throw new Error('Unable to open appreciation settings dialog.');
  }

  private async getAppreciationCheckbox(rewardDialog: Locator): Promise<Locator> {
    const checkboxCandidates: Locator[] = [
      rewardDialog
        .locator('xpath=.//*[contains(normalize-space(.), "统一")]//*[contains(@class, "weui-desktop-icon-checkbox")]')
        .first(),
      rewardDialog
        .locator('xpath=.//*[contains(normalize-space(.), "赞赏自动回复")]//*[contains(@class, "weui-desktop-icon-checkbox")]')
        .first(),
      rewardDialog.locator('.weui-desktop-icon-checkbox').last(),
      rewardDialog.locator('.weui-desktop-icon-checkbox').first(),
    ];

    for (const candidate of checkboxCandidates) {
      const matchCount = await candidate.count().catch(() => 0);
      if (matchCount > 0) {
        await candidate.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });
        return candidate;
      }
    }

    throw new Error('Unable to locate appreciation checkbox in reward dialog.');
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
    
    const context = await this.launchPersistentContextWithRecovery();
    this.context = context;
    this.attachContextLifecycleHandlers(context);

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
      this.setAuthenticatedPage(page);
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

    const browser = await this.launchPersistentContextWithRecovery();
    this.context = browser;
    this.attachContextLifecycleHandlers(browser);

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
      this.setAuthenticatedPage(page);
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
    publish?: boolean,
    contentStyle: ContentStyleSettings = {
      themePreset: 'classic',
      bodyFontSize: 16,
      lineHeight: 1.85,
      textColor: '#1f2329',
      headingColor: '#0f172a',
      linkColor: '#0969da',
    }
  ): Promise<string> {
    let page = this.getActiveSessionPage();
    this.setAuthenticatedPage(page);
    if (!this.context || !this.authenticatedPage) {
      throw new Error('No authenticated browser session. Please login first.');
    }
    this.log(`[DEBUG] Starting draft creation following test.py logic`);
    this.log(`[DEBUG] Title: "${title}", Author: "${author}", Content length: ${content.length}`);

    try {
      try {
        await page.bringToFront();
      } catch (bringToFrontError) {
        this.log(`Initial page activation failed, trying session recovery: ${bringToFrontError}`, 'warn');
        const recoveredPage = this.getActiveSessionPage();
        await recoveredPage.bringToFront();
        page = recoveredPage;
      }

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
        this.setAuthenticatedPage(page1); // 更新为新页面
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
      const bodyContent = this.stripLeadingTopLevelHeading(content);
      if (bodyContent !== content) {
        this.log('[DEBUG] Removed leading H1 from body markdown before upload');
      }
      await this.fillBodyWithFormattedMarkdown(bodyContent, contentStyle);
      this.log(`[DEBUG] Formatted content filled, body markdown length: ${bodyContent.length}`);

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
        .locator(DIALOG_SELECTOR)
        .last();
      await aiConfirmDialog.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });
      await aiConfirmDialog.getByRole('button', { name: '确认' }).first().click();
      await this.waitForDialogClose(aiConfirmDialog, 'AI配图确认');

      // Step 18: Set original declaration if enabled (following test.py logic)
      if (isOriginal) {
        this.log('[DEBUG] Step 18: Setting original declaration');
        await this.authenticatedPage.getByText('原创').nth(2).click();
        await this.waitForUiSettled(this.authenticatedPage);
        await this.authenticatedPage.getByText('文字原创').click();
        await this.waitForUiSettled(this.authenticatedPage);
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

        const originalDialog = this.getDialogLocator(/我已阅读并同意|原创|声明/);
        await originalDialog.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });

        // Keep behavior aligned with playwright-wechat.py but avoid toggling off:
        // click checkbox only when it is currently unchecked.
        const originalAgreementCheckbox = originalDialog.locator('.weui-desktop-icon-checkbox').first();
        await originalAgreementCheckbox.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });
        const checkboxClass = (await originalAgreementCheckbox.getAttribute('class')) || '';
        const ariaChecked = await originalAgreementCheckbox.getAttribute('aria-checked');
        const isChecked = /(checked|selected|active|on)/i.test(checkboxClass) || ariaChecked === 'true';
        if (!isChecked) {
          await originalAgreementCheckbox.click();
          await this.waitForUiSettled(this.authenticatedPage);
          this.log('[DEBUG] Original agreement checkbox checked');
        } else {
          this.log('[DEBUG] Original agreement checkbox already checked, skipping click');
        }

        const confirmButton = originalDialog.getByRole('button', { name: '确定' }).first();
        await confirmButton.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });
        await confirmButton.click();
        await this.waitForDialogClose(originalDialog, '原创声明');
        this.log('[DEBUG] Original declaration set');
      }

      // Step 19: Set appreciation according to config (following test.py logic)
      this.log(`[DEBUG] Step 19: ${enableAppreciation ? 'Enabling' : 'Disabling'} appreciation`);

      try {
        const rewardDialog = await this.openRewardDialog();

        if (enableAppreciation) {
          const rewardAccountInput = rewardDialog.getByRole('textbox', { name: '选择或搜索赞赏账户' }).first();
          await rewardAccountInput.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });
          await rewardAccountInput.click();
          await this.waitForUiSettled(this.authenticatedPage);

          const rewardTypeTab = rewardDialog.getByText('赞赏类型').first();
          await rewardTypeTab.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });
          await rewardTypeTab.click();
          await this.waitForUiSettled(this.authenticatedPage);

          const rewardAccountOption = this.authenticatedPage.locator('#vue_app').getByText('赞赏账户', { exact: true }).first();
          await rewardAccountOption.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });
          await rewardAccountOption.click();
          await this.waitForUiSettled(this.authenticatedPage);

          const autoReplyOption = rewardDialog.getByText('赞赏自动回复').first();
          await autoReplyOption.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });
          await autoReplyOption.click();
          await this.waitForUiSettled(this.authenticatedPage);

          // Ensure we click the real appreciation option (prefer "统一", fallback to known checkbox targets).
          const appreciationAgreementCheckbox = await this.getAppreciationCheckbox(rewardDialog);
          const appreciationCheckboxClass = (await appreciationAgreementCheckbox.getAttribute('class')) || '';
          const appreciationAriaChecked = await appreciationAgreementCheckbox.getAttribute('aria-checked');
          const appreciationChecked =
            /(checked|selected|active|on)/i.test(appreciationCheckboxClass) || appreciationAriaChecked === 'true';
          if (!appreciationChecked) {
            await appreciationAgreementCheckbox.click();
            await this.waitForUiSettled(this.authenticatedPage);
            this.log('[DEBUG] Appreciation checkbox checked');
          } else {
            this.log('[DEBUG] Appreciation checkbox already checked, skipping click');
          }
        } else {
          const disableOption = rewardDialog.getByText('不开启', { exact: true }).first();
          await disableOption.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });
          await disableOption.click();
          await this.waitForUiSettled(this.authenticatedPage);
          this.log('[DEBUG] Appreciation set to "不开启"');
        }

        const confirmButton = rewardDialog.getByRole('button', { name: '确定' }).first();
        await confirmButton.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });
        await confirmButton.click();

        await this.waitForDialogClose(rewardDialog, '赞赏类型');
        this.log(`[DEBUG] Appreciation ${enableAppreciation ? 'enabled' : 'disabled'}`);
      } catch (appreciationError) {
        this.log(
          `[ERROR] Failed to set appreciation: ${appreciationError instanceof Error ? appreciationError.message : String(appreciationError)}`,
          'error'
        );
        throw new Error(
          `Failed to set appreciation: ${appreciationError instanceof Error ? appreciationError.message : String(appreciationError)}`
        );
      }

      // Step 20: Set collection if provided (following test.py logic)
      if (defaultCollection) {
        this.log(`[DEBUG] Step 20: Setting collection: ${defaultCollection}`);
        await this.authenticatedPage.locator('#js_article_tags_area').getByText('未添加').click();

        const collectionDialog = this.getDialogLocator('每篇文章最多添加1个合集');
        await collectionDialog.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });

        const collectionInput = collectionDialog.getByRole('textbox', { name: '请选择合集' }).first();
        await collectionInput.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });
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
        await collectionConfirmButton.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });
        await collectionConfirmButton.click();
        await this.waitForDialogClose(collectionDialog, '合集');
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
    if (!this.context) {
      return false;
    }

    const page = this.authenticatedPage;
    if (page && !page.isClosed()) {
      return true;
    }

    const fallbackPage = this.getOpenPageFromContext(this.context);
    if (fallbackPage) {
      this.setAuthenticatedPage(fallbackPage);
      return true;
    }

    this.authenticatedPage = null;
    return false;
  }
}
