import { chromium, Browser, BrowserContext, Locator, Page } from 'playwright';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import MarkdownIt from 'markdown-it';
import type { ContentStyleSettings } from './SettingsService';

const LOGIN_TIMEOUT_MS = 120000; // 2 minutes timeout for user to scan QR
const POLL_INTERVAL_MS = 1000; // Check every 1 second for login completion
const BUTTON_ACTIVATION_DELAY_MS = 120; // Delay for button activation after hover
const INTERACTION_TIMEOUT_MS = 2000; // Timeout for best-effort page settle
const DIALOG_TIMEOUT_MS = 30000;
const DRAFT_CREATION_ENTRY_TIMEOUT_MS = 8000;
const ARTICLE_EDITOR_POPUP_TIMEOUT_MS = 10000;
const DIALOG_CLOSE_TIMEOUT_MS = 10000; // Shorter timeout for dialog close operations
const UI_SETTLE_MS = 120;
const PROCESS_SINGLETON_RECOVERY_DELAY_MS = 400;
const DIALOG_SELECTOR = '.weui-desktop-dialog:visible, .dialog_wrp:visible, .popover_dialog:visible';
const REWARD_DIALOG_POLL_INTERVAL_MS = 120;
const MERMAID_LOCAL_RUNTIME_RELATIVE_PATH = path.join('mermaid', 'dist', 'mermaid.min.js');
const MERMAID_UPLOAD_WAIT_MS = 30000;
const MERMAID_UPLOAD_INPUT_SETTLE_MS = 80;
const MERMAID_IMAGE_LOAD_TIMEOUT_MS = 10000;
const MERMAID_STANDALONE_BROWSER_ARGS = ['--disable-dev-shm-usage', '--disable-gpu'];
const MERMAID_RENDER_EVAL_TIMEOUT_MS = 45000;

interface MermaidUploadTask {
  token: string;
  filePath: string;
  fallbackText: string;
}

export class PlaywrightService {
  private outputChannel: vscode.OutputChannel;
  private context: BrowserContext | null = null;
  private authenticatedPage: Page | null = null;
  private userDataDir: string;
  private markdownParser: MarkdownIt;
  private mermaidRuntimeSource: string | null = null;

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

  private async getMermaidRuntimeSource(): Promise<string | null> {
    if (this.mermaidRuntimeSource) {
      return this.mermaidRuntimeSource;
    }

    try {
      const runtimeCandidates: string[] = [];
      try {
        runtimeCandidates.push(require.resolve(MERMAID_LOCAL_RUNTIME_RELATIVE_PATH));
      } catch {
        // ignore and try fallback path below
      }
      runtimeCandidates.push(path.join(process.cwd(), 'node_modules', MERMAID_LOCAL_RUNTIME_RELATIVE_PATH));

      let scriptSource: string | null = null;
      for (const candidate of runtimeCandidates) {
        try {
          scriptSource = fs.readFileSync(candidate, 'utf8');
          this.log(`[DEBUG] Mermaid runtime loaded from local path: ${candidate}`);
          break;
        } catch {
          // Try next candidate.
        }
      }

      if (!scriptSource) {
        this.log(
          `Unable to load local Mermaid runtime. Tried: ${runtimeCandidates.join(', ')}`,
          'warn'
        );
        return null;
      }

      if (!scriptSource.includes('mermaid')) {
        this.log('Local Mermaid runtime script looks invalid', 'warn');
        return null;
      }

      this.mermaidRuntimeSource = scriptSource;
      return scriptSource;
    } catch (error) {
      this.log(`Failed to load local Mermaid runtime script: ${error}`, 'warn');
      return null;
    }
  }

  private async ensureMermaidRuntime(page: Page): Promise<boolean> {
    const hasMermaid = await page.evaluate(() => typeof (window as any).mermaid !== 'undefined');
    if (hasMermaid) {
      return true;
    }

    const runtimeSource = await this.getMermaidRuntimeSource();
    if (!runtimeSource) {
      return false;
    }

    const hasMermaidAfterEval = await page.evaluate((scriptSource) => {
      try {
        if (typeof (window as any).mermaid === 'undefined') {
          (0, eval)(scriptSource);
        }
        return typeof (window as any).mermaid !== 'undefined';
      } catch {
        return false;
      }
    }, runtimeSource);

    if (!hasMermaidAfterEval) {
      this.log('Mermaid runtime is still unavailable after eval fallback', 'warn');
    }

    return hasMermaidAfterEval;
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

  private async renderMermaidToPngDataUrl(diagramCode: string): Promise<string | null> {
    const context = this.context;
    if (!context) {
      return null;
    }

    const traceId = this.createMermaidRenderTraceId(diagramCode);
    this.log(`[DEBUG] Mermaid render start (${traceId}): ${this.summarizeMermaidCodeForLog(diagramCode)}`);

    let renderBrowser: Browser | null = null;
    let renderContext: BrowserContext | null = null;
    let renderPage: Page | null = null;
    let detachDebugHooks: (() => void) | null = null;
    try {
      try {
        renderBrowser = await chromium.launch({
          headless: true,
          args: MERMAID_STANDALONE_BROWSER_ARGS,
        });
        renderContext = await renderBrowser.newContext();
        renderPage = await renderContext.newPage();
        this.log(`[DEBUG] Mermaid rendering uses standalone Chromium instance (${traceId})`);
      } catch (standaloneLaunchError) {
        this.log(
          `[DEBUG] Failed to launch standalone Mermaid browser (${traceId}), fallback to shared browser context: ${standaloneLaunchError}`,
          'warn'
        );
        const browser = typeof context.browser === 'function' ? context.browser() : null;
        if (browser) {
          renderContext = await browser.newContext();
          renderPage = await renderContext.newPage();
          this.log(`[DEBUG] Mermaid rendering uses dedicated ephemeral browser context (${traceId})`);
        } else {
          renderPage = await context.newPage();
          this.log(`[DEBUG] Mermaid rendering uses shared login context page (${traceId})`, 'warn');
        }
      }

      detachDebugHooks = this.attachMermaidRenderPageDebugHooks(renderPage, traceId);
      await renderPage.goto('about:blank', { waitUntil: 'domcontentloaded' });
      this.log(`[DEBUG] Mermaid render page ready (${traceId}), url=${renderPage.url()}`);

      const runtimeReady = await this.ensureMermaidRuntime(renderPage);
      if (!runtimeReady) {
        this.log(`Mermaid runtime is unavailable in isolated render page (${traceId})`, 'warn');
        return null;
      }

      const evaluatePromise = renderPage.evaluate(
        async ({ code, imageLoadTimeoutMs, currentTraceId }) => {
          const trace = (message: string) => {
            // eslint-disable-next-line no-console
            console.debug(`[MP_MERMAID_TRACE:${currentTraceId}] ${message}`);
          };

          const diagnostics: {
            parseAttempted: boolean;
            parseOk: boolean;
            parseError: string | null;
            renderMs: number | null;
            imageLoadMs: number | null;
            svgLength: number;
            totalMs: number;
          } = {
            parseAttempted: false,
            parseOk: false,
            parseError: null,
            renderMs: null,
            imageLoadMs: null,
            svgLength: 0,
            totalMs: 0,
          };

          const startedAt = Date.now();
          trace('evaluate-start');

          const mermaidApi = (window as any).mermaid;
          if (!mermaidApi) {
            diagnostics.totalMs = Date.now() - startedAt;
            return { dataUrl: null, error: 'window.mermaid is undefined', diagnostics };
          }

          const parseDimension = (value: string | null): number | null => {
            if (!value) {
              return null;
            }
            const normalized = value.trim().toLowerCase();
            if (!normalized || normalized.endsWith('%')) {
              return null;
            }
            const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)(px)?$/);
            if (!match) {
              return null;
            }
            const parsed = Number.parseFloat(match[1]);
            return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
          };

          const getIntrinsicSize = (svgEl: SVGSVGElement): { width: number; height: number } => {
            const viewBox = svgEl.getAttribute('viewBox');
            if (viewBox) {
              const parts = viewBox
                .trim()
                .split(/\s+/)
                .map((item) => Number.parseFloat(item));
              if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3])) {
                if (parts[2] > 0 && parts[3] > 0) {
                  return { width: parts[2], height: parts[3] };
                }
              }
            }

            const widthAttr = parseDimension(svgEl.getAttribute('width'));
            const heightAttr = parseDimension(svgEl.getAttribute('height'));
            if (widthAttr && heightAttr) {
              return { width: widthAttr, height: heightAttr };
            }

            const rect = svgEl.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              return { width: rect.width, height: rect.height };
            }

            return { width: 1200, height: 675 };
          };

          mermaidApi.initialize({ startOnLoad: false, securityLevel: 'loose' });

          if (typeof mermaidApi.parse === 'function') {
            diagnostics.parseAttempted = true;
            trace('parse-start');
            try {
              await mermaidApi.parse(code);
              diagnostics.parseOk = true;
              trace('parse-ok');
            } catch (parseError: any) {
              diagnostics.parseError = parseError?.message ? String(parseError.message) : String(parseError);
              diagnostics.totalMs = Date.now() - startedAt;
              trace(`parse-failed ${diagnostics.parseError}`);
              return { dataUrl: null, error: `mermaid.parse failed: ${diagnostics.parseError}`, diagnostics };
            }
          }

          const renderId = `mp-mermaid-${Date.now()}`;
          const container = document.createElement('div');
          container.style.position = 'fixed';
          container.style.left = '-99999px';
          container.style.top = '0';
          container.style.opacity = '0';
          document.body.appendChild(container);

          try {
            const renderStartAt = Date.now();
            trace('render-start');
            const result = await mermaidApi.render(renderId, code, container);
            diagnostics.renderMs = Date.now() - renderStartAt;
            diagnostics.svgLength = typeof result.svg === 'string' ? result.svg.length : 0;
            trace(`render-ok renderMs=${diagnostics.renderMs} svgLength=${diagnostics.svgLength}`);

            const parser = new DOMParser();
            const svgDoc = parser.parseFromString(result.svg as string, 'image/svg+xml');
            const svgEl = svgDoc.querySelector('svg');
            if (!svgEl) {
              diagnostics.totalMs = Date.now() - startedAt;
              return { dataUrl: null, error: 'Rendered SVG is missing <svg> root', diagnostics };
            }

            const intrinsicSize = getIntrinsicSize(svgEl);
            const width = intrinsicSize.width;
            const height = intrinsicSize.height;
            trace(`intrinsic-size width=${Math.round(width)} height=${Math.round(height)}`);

            const maxDimension = 2000;
            const scale = Math.min(1, maxDimension / Math.max(width, height));
            const finalWidth = Math.max(1, Math.round(width * scale));
            const finalHeight = Math.max(1, Math.round(height * scale));

            const svgBlob = new Blob([result.svg as string], { type: 'image/svg+xml;charset=utf-8' });
            const svgUrl = URL.createObjectURL(svgBlob);

            try {
              const imageLoadStartedAt = Date.now();
              trace('image-load-start');
              const imageResult = await new Promise<{ pngUrl: string | null; reason: string | null }>((resolve) => {
                const timeoutId = window.setTimeout(() => {
                  trace('image-load-timeout');
                  resolve({ pngUrl: null, reason: 'image-load-timeout' });
                }, imageLoadTimeoutMs);
                const image = new Image();
                image.onload = () => {
                  window.clearTimeout(timeoutId);
                  const canvas = document.createElement('canvas');
                  canvas.width = finalWidth;
                  canvas.height = finalHeight;
                  const ctx = canvas.getContext('2d');
                  if (!ctx) {
                    resolve({ pngUrl: null, reason: 'canvas-2d-context-unavailable' });
                    return;
                  }
                  ctx.fillStyle = '#ffffff';
                  ctx.fillRect(0, 0, canvas.width, canvas.height);
                  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
                  try {
                    resolve({ pngUrl: canvas.toDataURL('image/png'), reason: null });
                  } catch (toDataUrlError: any) {
                    const message = toDataUrlError?.message
                      ? String(toDataUrlError.message)
                      : String(toDataUrlError);
                    trace(`toDataURL-failed ${message}`);
                    resolve({ pngUrl: null, reason: `toDataURL-failed: ${message}` });
                  }
                };
                image.onerror = () => {
                  window.clearTimeout(timeoutId);
                  trace('image-load-error');
                  resolve({ pngUrl: null, reason: 'image-load-error' });
                };
                image.src = svgUrl;
              });
              diagnostics.imageLoadMs = Date.now() - imageLoadStartedAt;
              if (!imageResult.pngUrl) {
                diagnostics.totalMs = Date.now() - startedAt;
                return {
                  dataUrl: null,
                  error: `SVG image decode/canvas draw failed: ${imageResult.reason ?? 'unknown'}`,
                  diagnostics,
                };
              }
              diagnostics.totalMs = Date.now() - startedAt;
              trace(`image-load-ok imageLoadMs=${diagnostics.imageLoadMs}`);
              return { dataUrl: imageResult.pngUrl, error: null, diagnostics };
            } finally {
              URL.revokeObjectURL(svgUrl);
            }
          } catch (renderError: any) {
            const message = renderError?.message ? String(renderError.message) : String(renderError);
            diagnostics.totalMs = Date.now() - startedAt;
            trace(`render-failed ${message}`);
            return { dataUrl: null, error: `mermaid.render failed: ${message}`, diagnostics };
          } finally {
            container.remove();
            trace(`evaluate-end totalMs=${Date.now() - startedAt}`);
          }
        },
        {
          code: diagramCode,
          imageLoadTimeoutMs: MERMAID_IMAGE_LOAD_TIMEOUT_MS,
          currentTraceId: traceId,
        }
      );

      const timeoutMarker = Symbol('MERMAID_EVAL_TIMEOUT');
      let evalTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
      const evalResultOrTimeout = await Promise.race([
        evaluatePromise,
        new Promise<symbol>((resolve) => {
          evalTimeoutHandle = setTimeout(() => resolve(timeoutMarker), MERMAID_RENDER_EVAL_TIMEOUT_MS);
        }),
      ]);
      if (evalTimeoutHandle) {
        clearTimeout(evalTimeoutHandle);
      }

      if (evalResultOrTimeout === timeoutMarker) {
        this.log(
          `[WARN] Mermaid evaluate timed out after ${MERMAID_RENDER_EVAL_TIMEOUT_MS}ms (${traceId}), pageUrl=${renderPage.url()}, closed=${renderPage.isClosed()}`,
          'warn'
        );
        return null;
      }

      const evalResult = evalResultOrTimeout as
        | string
        | null
        | {
            dataUrl?: string | null;
            error?: string | null;
            diagnostics?: {
              parseAttempted?: boolean;
              parseOk?: boolean;
              parseError?: string | null;
              renderMs?: number | null;
              imageLoadMs?: number | null;
              svgLength?: number;
              totalMs?: number;
            };
          };

      const pngDataUrl =
        evalResult && typeof evalResult === 'object' && 'dataUrl' in evalResult
          ? ((evalResult as { dataUrl?: string | null }).dataUrl ?? null)
          : (evalResult as string | null);
      const renderError =
        evalResult && typeof evalResult === 'object' && 'error' in evalResult
          ? ((evalResult as { error?: string | null }).error ?? null)
          : null;
      const renderDiagnostics =
        evalResult && typeof evalResult === 'object' && 'diagnostics' in evalResult
          ? ((evalResult as { diagnostics?: Record<string, unknown> }).diagnostics ?? null)
          : null;

      if (renderError) {
        this.log(`Mermaid render returned error detail (${traceId}): ${renderError}`, 'warn');
      }

      if (renderDiagnostics) {
        this.log(
          `[DEBUG] Mermaid render diagnostics (${traceId}): ${JSON.stringify(renderDiagnostics)}`,
          'info'
        );
      }

      if (
        !pngDataUrl &&
        renderError &&
        /tainted canvases may not be exported|toDataURL-failed/i.test(renderError) &&
        renderPage &&
        !renderPage.isClosed()
      ) {
        this.log(`[WARN] Mermaid canvas export is tainted, trying screenshot fallback (${traceId})`, 'warn');
        const fallbackDataUrl = await this.renderMermaidPngViaElementScreenshot(renderPage, diagramCode, traceId);
        if (fallbackDataUrl) {
          return fallbackDataUrl;
        }
      }

      if (!pngDataUrl) {
        return null;
      }

      const approxBytes = Math.floor(((pngDataUrl.length - 'data:image/png;base64,'.length) * 3) / 4);
      const maxBytes = 2 * 1024 * 1024;
      if (approxBytes > maxBytes) {
        this.log(
          `Mermaid diagram is too large after PNG render (${approxBytes} bytes), fallback to code block (${traceId})`,
          'warn'
        );
        return null;
      }

      this.log(`[DEBUG] Mermaid render success (${traceId}), pngBytes≈${approxBytes}`);
      return pngDataUrl;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Execution context was destroyed')) {
        const pageState = renderPage
          ? `url=${renderPage.url()}, closed=${renderPage.isClosed()}`
          : 'renderPage not created';
        this.log(`Mermaid render context was destroyed (${traceId}, ${pageState})`, 'warn');
      }
      this.log(`Failed to render Mermaid diagram, fallback to text block (${traceId}): ${error}`, 'warn');
      return null;
    } finally {
      if (detachDebugHooks && renderPage && !renderPage.isClosed()) {
        detachDebugHooks();
      }
      if (renderBrowser) {
        await renderBrowser.close().catch((closeError) => {
          this.log(`Failed to close Mermaid standalone browser: ${closeError}`, 'warn');
        });
      } else if (renderContext && !renderContext.isClosed()) {
        await renderContext.close().catch((closeError) => {
          this.log(`Failed to close Mermaid render context: ${closeError}`, 'warn');
        });
      } else if (renderPage && !renderPage.isClosed()) {
        await renderPage.close().catch((closeError) => {
          this.log(`Failed to close Mermaid render page: ${closeError}`, 'warn');
        });
      }
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

  private async writeDataUrlToTempPng(dataUrl: string, index: number): Promise<string | null> {
    try {
      const prefix = 'data:image/png;base64,';
      if (!dataUrl.startsWith(prefix)) {
        return null;
      }
      const base64 = dataUrl.slice(prefix.length);
      const buffer = Buffer.from(base64, 'base64');
      const filePath = path.join(
        os.tmpdir(),
        `multipost-mermaid-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}.png`
      );
      fs.writeFileSync(filePath, buffer);
      return filePath;
    } catch (error) {
      this.log(`Failed to write Mermaid PNG temp file: ${error}`, 'warn');
      return null;
    }
  }

  private summarizeMermaidCodeForLog(diagramCode: string): string {
    const normalized = diagramCode.replace(/\s+/g, ' ').trim();
    const head = normalized.slice(0, 80);
    const tail = normalized.length > 140 ? normalized.slice(-60) : '';
    const hasInitDirective = /^\s*%%\{init:/.test(diagramCode);
    return `len=${diagramCode.length}, hasInit=${hasInitDirective}, head="${head}"${tail ? `, tail="${tail}"` : ''}`;
  }

  private createMermaidRenderTraceId(diagramCode: string): string {
    const suffix = Math.random().toString(36).slice(2, 8);
    return `mermaid-${Date.now()}-${diagramCode.length}-${suffix}`;
  }

  private attachMermaidRenderPageDebugHooks(page: Page, traceId: string): () => void {
    if (typeof (page as any).on !== 'function' || typeof (page as any).off !== 'function') {
      return () => {};
    }

    const consoleListener = (msg: any) => {
      const text = typeof msg.text === 'function' ? msg.text() : String(msg);
      if (text.includes(`[MP_MERMAID_TRACE:${traceId}]`)) {
        this.log(`[DEBUG] ${text}`);
      }
    };
    const pageErrorListener = (error: Error) => {
      this.log(`[WARN] Mermaid pageerror (${traceId}): ${error.message}`, 'warn');
    };
    const crashListener = () => {
      this.log(`[WARN] Mermaid page crashed (${traceId})`, 'warn');
    };
    const closeListener = () => {
      this.log(`[DEBUG] Mermaid render page closed (${traceId})`);
    };
    const frameNavigatedListener = (frame: any) => {
      try {
        if (frame === page.mainFrame()) {
          this.log(`[DEBUG] Mermaid main frame navigated (${traceId}): ${frame.url()}`);
        }
      } catch {
        // ignore telemetry errors
      }
    };

    page.on('console', consoleListener);
    page.on('pageerror', pageErrorListener);
    page.on('crash', crashListener);
    page.on('close', closeListener);
    page.on('framenavigated', frameNavigatedListener);

    return () => {
      page.off('console', consoleListener);
      page.off('pageerror', pageErrorListener);
      page.off('crash', crashListener);
      page.off('close', closeListener);
      page.off('framenavigated', frameNavigatedListener);
    };
  }

  private async renderMermaidPngViaElementScreenshot(
    renderPage: Page,
    diagramCode: string,
    traceId: string
  ): Promise<string | null> {
    try {
      const meta = await renderPage.evaluate(async ({ code, currentTraceId }) => {
        const trace = (message: string) => {
          // eslint-disable-next-line no-console
          console.debug(`[MP_MERMAID_TRACE:${currentTraceId}] screenshot-fallback ${message}`);
        };

        const mermaidApi = (window as any).mermaid;
        if (!mermaidApi) {
          return { containerId: null, error: 'window.mermaid is undefined in screenshot fallback' };
        }

        const parseDimension = (value: string | null): number | null => {
          if (!value) {
            return null;
          }
          const normalized = value.trim().toLowerCase();
          if (!normalized || normalized.endsWith('%')) {
            return null;
          }
          const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)(px)?$/);
          if (!match) {
            return null;
          }
          const parsed = Number.parseFloat(match[1]);
          return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        };

        const getIntrinsicSize = (svgEl: SVGSVGElement): { width: number; height: number } => {
          const viewBox = svgEl.getAttribute('viewBox');
          if (viewBox) {
            const parts = viewBox
              .trim()
              .split(/\s+/)
              .map((item) => Number.parseFloat(item));
            if (parts.length === 4 && Number.isFinite(parts[2]) && Number.isFinite(parts[3])) {
              if (parts[2] > 0 && parts[3] > 0) {
                return { width: parts[2], height: parts[3] };
              }
            }
          }

          const widthAttr = parseDimension(svgEl.getAttribute('width'));
          const heightAttr = parseDimension(svgEl.getAttribute('height'));
          if (widthAttr && heightAttr) {
            return { width: widthAttr, height: heightAttr };
          }

          const rect = svgEl.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return { width: rect.width, height: rect.height };
          }

          return { width: 1200, height: 675 };
        };

        mermaidApi.initialize({ startOnLoad: false, securityLevel: 'loose' });

        const containerId = `mp-mermaid-shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const host = document.createElement('div');
        host.id = containerId;
        host.style.position = 'absolute';
        host.style.left = '0';
        host.style.top = '0';
        host.style.padding = '8px';
        host.style.background = '#ffffff';
        host.style.display = 'inline-block';
        document.body.appendChild(host);

        trace('render-start');
        const renderId = `mp-mermaid-shot-${Date.now()}`;
        const result = await mermaidApi.render(renderId, code, host);
        host.innerHTML = result.svg as string;
        const svgEl = host.querySelector('svg');
        if (!svgEl) {
          host.remove();
          return { containerId: null, error: 'Screenshot fallback rendered SVG is missing <svg> root' };
        }

        const intrinsicSize = getIntrinsicSize(svgEl);
        const width = intrinsicSize.width;
        const height = intrinsicSize.height;

        svgEl.setAttribute('width', `${Math.ceil(width)}`);
        svgEl.setAttribute('height', `${Math.ceil(height)}`);
        trace(`render-ok width=${Math.ceil(width)} height=${Math.ceil(height)}`);
        return { containerId, error: null };
      }, { code: diagramCode, currentTraceId: traceId });

      const containerId = meta?.containerId ?? null;
      const fallbackError = meta?.error ?? null;
      if (!containerId) {
        this.log(`Mermaid screenshot fallback setup failed (${traceId}): ${fallbackError ?? 'unknown error'}`, 'warn');
        return null;
      }

      const target = renderPage.locator(`#${containerId}`);
      await target.waitFor({ state: 'visible', timeout: 5000 });
      const pngBuffer = await target.screenshot({ type: 'png' });
      await renderPage.evaluate((id) => {
        document.getElementById(id)?.remove();
      }, containerId);
      this.log(`[DEBUG] Mermaid screenshot fallback succeeded (${traceId}), bytes=${pngBuffer.length}`);
      return `data:image/png;base64,${pngBuffer.toString('base64')}`;
    } catch (error) {
      this.log(`Mermaid screenshot fallback failed (${traceId}): ${error}`, 'warn');
      return null;
    }
  }

  private isLatexFormula(text: string): boolean {
    if (/[\\^_{}]/.test(text)) return true;
    if (/[α-ωΑ-Ω]/.test(text)) return true;
    if (/[∑∏∫∂∇∞≠≤≥±×÷√]/.test(text)) return true;
    return false;
  }

  /**
   * 处理 LaTeX 公式，将其转换为图片
   */
  private processLatex(content: string): string {
    const LATEX_API = 'https://latex.codecogs.com/png.latex';

    content = content.replace(/\$\$([^$]+)\$\$/g, (match, latex) => {
      if (!this.isLatexFormula(latex)) return match;
      const encoded = encodeURIComponent(latex.trim());
      return `<p style="text-align: center;"><img src="${LATEX_API}?\\dpi{150}${encoded}" alt="formula" style="vertical-align: middle; max-width: 100%;"></p>`;
    });

    content = content.replace(/\$([^$]+)\$/g, (match, latex) => {
      if (!this.isLatexFormula(latex)) return match;
      const encoded = encodeURIComponent(latex.trim());
      return `<img src="${LATEX_API}?\\dpi{120}${encoded}" alt="formula" style="vertical-align: middle;">`;
    });

    return content;
  }

  /**
   * 移除外部链接（微信不允许非 mp.weixin.qq.com 域名的链接）
   * 将 <a href="外部链接">文字</a> 转换为 文字
   */
  private stripExternalLinks(content: string): string {
    return content.replace(
      /<a\s+[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (match, href, text) => {
        // 保留微信域名的链接
        if (href && (
          href.includes('mp.weixin.qq.com') ||
          href.includes('weixin.qq.com') ||
          href.startsWith('#') ||  // 锚点链接
          href.startsWith('javascript:')  // JS 链接
        )) {
          return match;
        }
        // 外部链接只保留文字
        return text;
      }
    );
  }

  /**
   * 压缩 HTML 标签间的空白
   */
  private compactHtml(content: string): string {
    return content
      .replace(/>\s+</g, '><') // 移除标签间的空白
      .replace(/\s+/g, ' ') // 将多个空格合并为一个
      .trim();
  }

  private async renderMarkdownToWechatHtml(markdown: string, style: ContentStyleSettings): Promise<string> {
    const mermaidBlocks: string[] = [];
    const markdownWithPlaceholders = markdown.replace(/```mermaid\s*([\s\S]*?)```/g, (_match, mermaidCode: string) => {
      const token = `MP_MERMAID_PLACEHOLDER_${mermaidBlocks.length}`;
      mermaidBlocks.push(mermaidCode.trim());
      return token;
    });

    let html = this.markdownParser.render(markdownWithPlaceholders);

    // 处理 LaTeX 公式
    html = this.processLatex(html);

    // 先替换 Mermaid 占位符，再处理代码块（避免相互影响）
    for (let i = 0; i < mermaidBlocks.length; i += 1) {
      const token = `MP_MERMAID_PLACEHOLDER_${i}`;
      const diagramCode = mermaidBlocks[i];
      this.log(`[DEBUG] Mermaid diagram ${i + 1} source summary: ${this.summarizeMermaidCodeForLog(diagramCode)}`);
      const dataUrl = await this.renderMermaidToPngDataUrl(diagramCode);
      const fallbackText = `<pre><code class="language-mermaid">${this.markdownParser.utils.escapeHtml(diagramCode)}</code></pre>`;
      const mermaidHtml = dataUrl
        ? `<p><img src="${dataUrl}" alt="Mermaid Diagram ${i + 1}" style="max-width: 100%;" /></p>`
        : fallbackText;

      // 更健壮的替换逻辑
      const pPattern = new RegExp(`<p>${token}</p>`, 'g');
      const tokenPattern = new RegExp(token, 'g');

      html = html.replace(pPattern, mermaidHtml).replace(tokenPattern, mermaidHtml);

      this.log(`[DEBUG] Mermaid diagram ${i + 1} ${dataUrl ? 'rendered' : 'fallback to code block'}`);
    }

    // 处理外部链接（只保留微信域名链接）
    html = this.stripExternalLinks(html);

    // 压缩 HTML 标签
    html = this.compactHtml(html);

    // 修复代码块换行符被压缩的问题 - 确保 pre 标签中的内容保留换行符
    html = html.replace(/<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g, (_match, attrs, content) => {
      // 微信公众号编辑器可能会压缩代码块中的换行符
      // 我们需要确保换行符被正确地保留和渲染
      let processedContent = content;

      // 方法1：将换行符替换为 <br> 标签（更可靠）
      processedContent = processedContent.replace(/\n/g, '<br>');

      // 同时确保空格和制表符也被正确保留
      processedContent = processedContent.replace(/  /g, '&nbsp;&nbsp;');
      processedContent = processedContent.replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');

      return `<pre><code${attrs}>${processedContent}</code></pre>`;
    });

    return this.applyThemedStyles(html, style);
  }

  private async renderMarkdownToWechatHtmlWithUploadPlan(
    markdown: string,
    style: ContentStyleSettings
  ): Promise<{ html: string; tasks: MermaidUploadTask[] }> {
    const mermaidBlocks: string[] = [];
    const markdownWithPlaceholders = markdown.replace(/```mermaid\s*([\s\S]*?)```/g, (_match, mermaidCode: string) => {
      const token = `MP_MERMAID_PLACEHOLDER_${mermaidBlocks.length}`;
      mermaidBlocks.push(mermaidCode.trim());
      return token;
    });

    let html = this.markdownParser.render(markdownWithPlaceholders);
    const tasks: MermaidUploadTask[] = [];

    for (let i = 0; i < mermaidBlocks.length; i += 1) {
      const token = `MP_MERMAID_PLACEHOLDER_${i}`;
      const diagramCode = mermaidBlocks[i];
      this.log(`[DEBUG] Mermaid diagram ${i + 1} source summary: ${this.summarizeMermaidCodeForLog(diagramCode)}`);
      const dataUrl = await this.renderMermaidToPngDataUrl(diagramCode);
      const fallbackText = `<pre><code class="language-mermaid">${this.markdownParser.utils.escapeHtml(diagramCode)}</code></pre>`;

      let replacement = fallbackText;
      if (dataUrl) {
        const filePath = await this.writeDataUrlToTempPng(dataUrl, i);
        if (filePath) {
          const uploadToken = `MP_MERMAID_UPLOAD_TOKEN_${i}_${Date.now()}`;
          replacement = `<p>${uploadToken}</p>`;
          tasks.push({
            token: uploadToken,
            filePath,
            fallbackText: '[Mermaid 图]',
          });
          this.log(`[DEBUG] Mermaid diagram ${i + 1} rendered to temp file: ${filePath}`);
        } else {
          this.log(`[DEBUG] Mermaid diagram ${i + 1} temp file write failed, fallback to code block`, 'warn');
        }
      } else {
        this.log(`[DEBUG] Mermaid diagram ${i + 1} fallback to code block`, 'warn');
      }

      const pPattern = new RegExp(`<p>${token}</p>`, 'g');
      const tokenPattern = new RegExp(token, 'g');
      html = html.replace(pPattern, replacement).replace(tokenPattern, replacement);
    }

    // Keep code block line breaks visible in WeChat editor.
    html = html.replace(/<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g, (_match, attrs, content) => {
      let processedContent = content;
      processedContent = processedContent.replace(/\n/g, '<br>');
      processedContent = processedContent.replace(/  /g, '&nbsp;&nbsp;');
      processedContent = processedContent.replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');
      return `<pre><code${attrs}>${processedContent}</code></pre>`;
    });

    return {
      html: this.applyThemedStyles(html, style),
      tasks,
    };
  }

  private async getEditorState(token?: string): Promise<{ hasToken: boolean; imageCount: number }> {
    if (!this.authenticatedPage) {
      return { hasToken: false, imageCount: 0 };
    }

    return this.authenticatedPage.evaluate((searchToken) => {
      const editors = Array.from(document.querySelectorAll('[contenteditable="true"]')) as HTMLElement[];
      const visibleEditors = editors.filter((el) => el.offsetParent !== null);
      const editor = visibleEditors[0];
      if (!editor) {
        return { hasToken: false, imageCount: 0 };
      }
      const text = editor.innerText || '';
      return {
        hasToken: searchToken ? text.includes(searchToken) : false,
        imageCount: editor.querySelectorAll('img').length,
      };
    }, token);
  }

  private async focusEditorAtToken(token: string): Promise<boolean> {
    if (!this.authenticatedPage) {
      return false;
    }

    return this.authenticatedPage.evaluate((searchToken) => {
      const editors = Array.from(document.querySelectorAll('[contenteditable="true"]')) as HTMLElement[];
      const visibleEditors = editors.filter((el) => el.offsetParent !== null);
      const editor = visibleEditors[0];
      if (!editor) {
        return false;
      }

      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      let targetNode: Text | null = null;
      let targetOffset = -1;

      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const offset = node.data.indexOf(searchToken);
        if (offset >= 0) {
          targetNode = node;
          targetOffset = offset;
          break;
        }
      }

      if (!targetNode || targetOffset < 0) {
        return false;
      }

      editor.focus();
      const selection = window.getSelection();
      if (!selection) {
        return false;
      }

      const range = document.createRange();
      range.setStart(targetNode, targetOffset);
      range.setEnd(targetNode, targetOffset + searchToken.length);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }, token);
  }

  private async replaceTokenInEditor(token: string, replacementText: string): Promise<boolean> {
    if (!this.authenticatedPage) {
      return false;
    }

    return this.authenticatedPage.evaluate(
      ({ searchToken, replacement }) => {
        const editors = Array.from(document.querySelectorAll('[contenteditable="true"]')) as HTMLElement[];
        const visibleEditors = editors.filter((el) => el.offsetParent !== null);
        const editor = visibleEditors[0];
        if (!editor) {
          return false;
        }

        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
        const touchedParagraphs = new Set<HTMLElement>();
        let replaced = false;

        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          if (!node.data.includes(searchToken)) {
            continue;
          }
          node.data = node.data.split(searchToken).join(replacement);
          replaced = true;
          const paragraph = node.parentElement?.closest('p');
          if (paragraph) {
            touchedParagraphs.add(paragraph);
          }
        }

        if (!replaced) {
          return false;
        }

        if (!replacement.trim()) {
          touchedParagraphs.forEach((paragraph) => {
            if ((paragraph.innerText || '').trim() === '') {
              paragraph.remove();
            }
          });
        }

        editor.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      },
      { searchToken: token, replacement: replacementText }
    );
  }

  private async waitForMermaidUploadResult(token: string, baselineImageCount: number): Promise<boolean> {
    if (!this.authenticatedPage) {
      return false;
    }

    try {
      await this.authenticatedPage.waitForFunction(
        ({ searchToken, baseline }) => {
          const editors = Array.from(document.querySelectorAll('[contenteditable="true"]')) as HTMLElement[];
          const visibleEditors = editors.filter((el) => el.offsetParent !== null);
          const editor = visibleEditors[0];
          if (!editor) {
            return false;
          }
          const text = editor.innerText || '';
          const imageCount = editor.querySelectorAll('img').length;
          return !text.includes(searchToken) || imageCount > baseline;
        },
        { searchToken: token, baseline: baselineImageCount },
        { timeout: MERMAID_UPLOAD_WAIT_MS }
      );
      return true;
    } catch {
      return false;
    }
  }

  private async tryUploadImageAtCursor(filePath: string, token: string): Promise<boolean> {
    if (!this.authenticatedPage) {
      return false;
    }

    const selectors = [
      'input[type="file"][accept*="image" i]',
      'input[type="file"][accept*=".png" i]',
      'input[type="file"][name*="image" i]',
      'input[type="file"]',
    ];

    for (const selector of selectors) {
      const inputs = this.authenticatedPage.locator(selector);
      const count = Math.min(await inputs.count().catch(() => 0), 10);
      for (let i = 0; i < count; i += 1) {
        const baseline = await this.getEditorState(token);
        if (!baseline.hasToken) {
          return true;
        }

        try {
          await inputs.nth(i).setInputFiles(filePath, { timeout: 5000 });
          await this.authenticatedPage.waitForTimeout(MERMAID_UPLOAD_INPUT_SETTLE_MS);
        } catch {
          continue;
        }

        const uploaded = await this.waitForMermaidUploadResult(token, baseline.imageCount);
        if (uploaded) {
          this.log(`[DEBUG] Mermaid image uploaded via ${selector} [${i}]`);
          return true;
        }
      }
    }

    return false;
  }

  private removeTempFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      this.log(`Failed to remove Mermaid temp file ${filePath}: ${error}`, 'warn');
    }
  }

  private async uploadDeferredMermaidImages(tasks: MermaidUploadTask[]): Promise<void> {
    if (!this.authenticatedPage || tasks.length === 0) {
      return;
    }

    for (let i = 0; i < tasks.length; i += 1) {
      const task = tasks[i];
      try {
        const hasToken = await this.getEditorState(task.token);
        if (!hasToken.hasToken) {
          this.log(`[DEBUG] Mermaid upload token missing before upload, skip task ${i + 1}`, 'warn');
          continue;
        }

        const focused = await this.focusEditorAtToken(task.token);
        if (!focused) {
          this.log(`[DEBUG] Failed to focus Mermaid token, fallback to text for task ${i + 1}`, 'warn');
          await this.replaceTokenInEditor(task.token, task.fallbackText);
          continue;
        }

        const uploaded = await this.tryUploadImageAtCursor(task.filePath, task.token);
        if (!uploaded) {
          this.log(`[DEBUG] Mermaid image upload failed, fallback to text for task ${i + 1}`, 'warn');
          await this.replaceTokenInEditor(task.token, task.fallbackText);
          continue;
        }

        await this.replaceTokenInEditor(task.token, '');
      } finally {
        this.removeTempFile(task.filePath);
      }
    }
  }

  private async fillBodyWithFormattedMarkdown(markdown: string, style: ContentStyleSettings): Promise<void> {
    if (!this.authenticatedPage) {
      throw new Error('No authenticated page available.');
    }

    const { html, tasks } = await this.renderMarkdownToWechatHtmlWithUploadPlan(markdown, style);

    try {
      await this.authenticatedPage.evaluate((renderedHtml) => {
        const editor = Array.from(document.querySelectorAll('[contenteditable="true"]'))
          .filter((el): el is HTMLElement => el instanceof HTMLElement && el.offsetParent !== null)
          .find((el) => (el.innerText || '').trim().includes('从这里开始写正文'));

        if (!editor) {
          throw new Error('Editable content area not found.');
        }

        editor.focus();
        editor.innerHTML = renderedHtml;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }, html);

      if (tasks.length > 0) {
        this.log(`[DEBUG] Uploading ${tasks.length} Mermaid image(s) to editor`);
        await this.uploadDeferredMermaidImages(tasks);
      }
    } catch (error) {
      tasks.forEach((task) => this.removeTempFile(task.filePath));
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

  /**
   * 格式化微信公众号 API 错误信息
   */
  private formatWechatError(res: { ret?: number; base_resp?: { ret: number } }): string {
    const ret = res.ret ?? res.base_resp?.ret;

    const errorMap: Record<number, string> = {
      [-6]: '请输入验证码',
      [-8]: '请输入验证码',
      [-1]: '系统错误，请注意备份内容后重试',
      [-2]: '参数错误，请注意备份内容后重试',
      [-5]: '服务错误，请注意备份内容后重试',
      [-99]: '内容超出字数，请调整',
      [-206]: '服务负荷过大，请稍后重试',
      [200002]: '参数错误，请注意备份内容后重试',
      [200003]: '登录态超时，请重新登录',
      [412]: '图文中含非法外链',
      [62752]: '可能含有具备安全风险的链接，请检查',
      [64502]: '你输入的微信号不存在',
      [64505]: '发送预览失败，请稍后再试',
      [64506]: '保存失败，链接不合法',
      [64507]: '内容不能包含外部链接',
      [64562]: '请勿插入非微信域名的链接',
      [64509]: '正文中不能包含超过3个视频',
      [64515]: '当前素材非最新内容，请重新打开并编辑',
      [64702]: '标题超出64字长度限制',
      [64703]: '摘要超出120字长度限制',
      [64705]: '内容超出字数，请调整',
      [10806]: '正文不能有违规内容，请重新编辑',
      [10807]: '内容不能违反公众平台协议',
      [220001]: '素材管理中的存储数量已达上限',
      [220002]: '图片库已达到存储上限',
    };

    return errorMap[ret as number] || `同步失败 (错误码: ${ret})`;
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

  private async clickNewDraftCreationEntry(page: Page): Promise<void> {
    const creationEntryCandidates: Array<{ name: string; locator: Locator }> = [
      { name: 'button[新的创作]', locator: page.getByRole('button', { name: '新的创作', exact: true }) },
      { name: 'link[新的创作]', locator: page.getByRole('link', { name: '新的创作', exact: true }) },
      { name: 'text[新的创作]', locator: page.getByText('新的创作', { exact: true }) },
      { name: 'legacy add icon', locator: page.locator('.weui-desktop-card__icon-add') },
    ];

    let lastError: unknown;
    for (const candidate of creationEntryCandidates) {
      const count = await candidate.locator.count().catch(() => 0);
      if (count === 0) {
        continue;
      }

      try {
        this.log(`[DEBUG] Clicking draft creation entry via ${candidate.name}`);
        await this.clickAndStabilize(candidate.locator, page, DRAFT_CREATION_ENTRY_TIMEOUT_MS);
        return;
      } catch (error) {
        lastError = error;
        this.log(`[DEBUG] Draft creation entry ${candidate.name} failed: ${error}`, 'warn');
      }
    }

    throw new Error(`Unable to find or click draft creation entry "新的创作". Last error: ${lastError}`);
  }

  private async clickArticleCreationType(page: Page): Promise<void> {
    const articleTypeCandidates: Array<{ name: string; locator: Locator }> = [
      { name: 'button[文章]', locator: page.getByRole('button', { name: '文章', exact: true }) },
      { name: 'link[文章]', locator: page.getByRole('link', { name: '文章', exact: true }) },
      { name: 'text[文章]', locator: page.getByText('文章', { exact: true }) },
    ];

    let lastError: unknown;
    for (const candidate of articleTypeCandidates) {
      const count = await candidate.locator.count().catch(() => 0);
      if (count === 0) {
        continue;
      }

      try {
        this.log(`[DEBUG] Selecting creation type via ${candidate.name}`);
        await this.clickAndStabilize(candidate.locator, page, DRAFT_CREATION_ENTRY_TIMEOUT_MS);
        return;
      } catch (error) {
        lastError = error;
        this.log(`[DEBUG] Creation type ${candidate.name} failed: ${error}`, 'warn');
      }
    }

    throw new Error(`Unable to select creation type "文章". Last error: ${lastError}`);
  }

  private async selectArticleCreationTypeAndResolveEditorPage(page: Page): Promise<Page> {
    const popupPromise = page.waitForEvent('popup', { timeout: ARTICLE_EDITOR_POPUP_TIMEOUT_MS });

    await this.clickArticleCreationType(page);

    try {
      const editorPage = await popupPromise;
      await editorPage.waitForLoadState('domcontentloaded', { timeout: DIALOG_TIMEOUT_MS });
      this.log('[DEBUG] Article editor opened in a new tab after selecting "文章"');
      return editorPage;
    } catch (error) {
      this.log(`[DEBUG] No new tab detected after selecting "文章"; using current page: ${error}`, 'warn');
      return page;
    }
  }

  private async clickAiCoverEntry(timeoutMs: number = DIALOG_TIMEOUT_MS): Promise<void> {
    if (!this.authenticatedPage) {
      throw new Error('No authenticated page available.');
    }

    const page = this.authenticatedPage;
    const aiEntryCandidates: Array<{ name: string; locator: Locator }> = [
      { name: 'a.js_aiImage', locator: page.locator('a.js_aiImage').first() },
      { name: 'link[AI 配图]', locator: page.getByRole('link', { name: 'AI 配图' }).first() },
      { name: '.pop-opr__button(hasText=AI 配图)', locator: page.locator('.pop-opr__button').filter({ hasText: 'AI 配图' }).first() },
    ];

    for (const candidate of aiEntryCandidates) {
      const count = await candidate.locator.count().catch(() => 0);
      if (count === 0) {
        continue;
      }

      await candidate.locator.waitFor({ state: 'attached', timeout: Math.min(timeoutMs, 8000) });
      const isVisible = await candidate.locator.isVisible().catch(() => false);
      this.log(`[DEBUG] Trying AI cover entry via ${candidate.name}, visible=${isVisible}`);

      if (!isVisible) {
        continue;
      }

      try {
        await candidate.locator.click({ timeout: 3000 });
        await this.maybeWaitForNavigation(page);
        this.log(`[DEBUG] AI cover entry clicked via ${candidate.name}`);
        return;
      } catch (clickError) {
        this.log(`[DEBUG] Normal click failed for ${candidate.name}: ${clickError}`, 'warn');
      }

      try {
        await candidate.locator.click({ force: true, timeout: 3000 });
        await this.maybeWaitForNavigation(page);
        this.log(`[DEBUG] AI cover entry force-clicked via ${candidate.name}`);
        return;
      } catch (forceClickError) {
        this.log(`[DEBUG] Force click failed for ${candidate.name}: ${forceClickError}`, 'warn');
      }
    }

    const domClicked = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('a.js_aiImage, a.pop-opr__button')) as HTMLElement[];
      const target = candidates.find((el) => (el.innerText || '').trim().includes('AI 配图'));
      if (!target) {
        return false;
      }
      target.click();
      return true;
    });

    if (domClicked) {
      await this.maybeWaitForNavigation(page);
      this.log('[DEBUG] AI cover entry clicked via DOM fallback');
      return;
    }

    throw new Error('Unable to click "AI 配图" entry after actionability and fallback attempts.');
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

      // Step 2: Navigate through interface
      // 内容管理 → 草稿箱 → 新的创作 → 文章
      this.log('[DEBUG] Step 2: Clicking "内容管理"');
      await this.clickAndStabilize(page.getByText('内容管理'), page);

      this.log('[DEBUG] Step 3: Clicking "草稿箱"');
      await this.clickAndStabilize(page.getByRole('link', { name: '草稿箱' }), page);

      this.log('[DEBUG] Step 4: Clicking "新的创作"');
      await this.clickNewDraftCreationEntry(page);

      this.log('[DEBUG] Step 5: Selecting "文章"');
      const editorPage = await this.selectArticleCreationTypeAndResolveEditorPage(page);

      this.log('[DEBUG] Step 6: Article editor opened after selecting "文章"');
      this.setAuthenticatedPage(editorPage);

      // Step 7: Fill title (following test.py logic)
      this.log('[DEBUG] Step 7: Filling title');
      const titleSelector = this.authenticatedPage.getByRole('textbox', { name: '请在这里输入标题' });
      await titleSelector.waitFor({ timeout: 60000 });
      await titleSelector.click();
      await titleSelector.fill(title);
      this.log(`[DEBUG] Title filled: "${title}"`);

      // Step 8: Fill author (following test.py logic)
      this.log('[DEBUG] Step 8: Filling author');
      const authorSelector = this.authenticatedPage.getByRole('textbox', { name: '请输入作者' });
      await authorSelector.waitFor({ timeout: 60000 });
      await authorSelector.click();
      await authorSelector.fill(author);
      this.log(`[DEBUG] Author filled: "${author}"`);

      // Step 9: Fill content (following test.py logic)
      this.log('[DEBUG] Step 9: Filling formatted content from markdown');
      const bodyContent = this.stripLeadingTopLevelHeading(content);
      if (bodyContent !== content) {
        this.log('[DEBUG] Removed leading H1 from body markdown before upload');
      }
      await this.fillBodyWithFormattedMarkdown(bodyContent, contentStyle);
      this.log(`[DEBUG] Formatted content filled, body markdown length: ${bodyContent.length}`);

      // Step 10: Click article settings (following test.py logic)
      this.log('[DEBUG] Step 10: Clicking "文章设置"');
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
      await this.authenticatedPage.locator('a.js_aiImage').first().waitFor({ state: 'attached', timeout: DIALOG_TIMEOUT_MS });
      await this.clickAiCoverEntry();

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
        await this.waitForUiSettled(this.authenticatedPage, 250);

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
    this.mermaidRuntimeSource = null;
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
