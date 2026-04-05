import * as vscode from 'vscode';
import { WeChatService } from './services/WeChatService';
import { PreviewService } from './services/PreviewService';
import { SettingsService } from './services/SettingsService';
import { ChromeCDPService } from './services/ChromeCDPService';
import { extractTitle } from './utils/extractTitle';

let weChatService: WeChatService;
let previewService: PreviewService;
let settingsService: SettingsService;
let chromeCdpService: ChromeCDPService;
let outputChannel: vscode.OutputChannel;

function log(message: string, level: 'info' | 'error' | 'warn' = 'info'): void {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

  if (outputChannel) {
    outputChannel.appendLine(logMessage);
  }

  if (level === 'error') {
    console.error(logMessage);
  } else {
    console.log(logMessage);
  }
}

export async function activate(context: vscode.ExtensionContext) {
  // Create output channel for logging
  outputChannel = vscode.window.createOutputChannel('MultiPost');
  context.subscriptions.push(outputChannel);

  log('=== Starting MultiPost extension activation ===');
  log(`Extension context: ${JSON.stringify({
    extensionPath: context.extensionPath,
    subscriptionsCount: context.subscriptions.length,
    extensionUri: context.extensionUri.toString()
  })}`);

  try {
    log('Step 1: Initializing services...');
    // Initialize services
    weChatService = new WeChatService(context.secrets);
    previewService = new PreviewService(context.extensionUri);
    settingsService = new SettingsService(context);
    const storagePath = context.globalStorageUri?.fsPath || context.extensionPath;
    chromeCdpService = new ChromeCDPService(outputChannel, storagePath);
    log('Services initialized successfully');

    previewService.setMessageHandler(async (message) => {
      log(`Received message from preview webview: ${message.type}`);
      if (message.type === 'uploadToWeChat') {
        await vscode.commands.executeCommand('multipost.uploadToWeChat');
      } else if (message.type === 'copyHtml') {
        await vscode.env.clipboard.writeText(message.html);
        vscode.window.showInformationMessage('HTML copied to clipboard');
        log('HTML copied to clipboard');
      }
    });

    log('Step 2: Registering commands...');
    log(`Available vscode.commands: ${typeof vscode.commands}`);
    
    // Register commands
    let disposable = vscode.commands.registerCommand(
      'multipost.preview',
      () => {
        log('Command invoked: multipost.preview');
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showErrorMessage('No active editor');
          log('Error: No active editor', 'error');
          return;
        }
        const markdown = editor.document.getText();
        log(`Got markdown from editor: ${markdown.length} characters`);
        previewService.openPreview(markdown);
        updatePreviewAuthStatus();
        log('Preview opened successfully');
      }
    );
    context.subscriptions.push(disposable);
    log(`Command registered: multipost.preview, disposable: ${!!disposable}`);

    disposable = vscode.commands.registerCommand(
      'multipost.logoutWeChat',
      async () => {
        log('Command invoked: multipost.logoutWeChat');
        weChatService.clearAuth();
        vscode.window.showInformationMessage('Logged out from MultiPost');
        updatePreviewAuthStatus();
        log('User logged out successfully');
      }
    );
    context.subscriptions.push(disposable);
    log('Command registered: multipost.logoutWeChat');

    // Chrome CDP Fully Automated Upload - login if needed then upload current file
    disposable = vscode.commands.registerCommand(
      'multipost.loginWeChatChromeCdp',
      async () => {
        log('Command invoked: multipost.loginWeChatChromeCdp (Fully Automated CDP Upload)');

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showErrorMessage('No active editor');
          log('Error: No active editor', 'error');
          return;
        }

        const markdown = editor.document.getText();
        const fileName = editor.document.fileName;
        const title = extractTitle(markdown) || fileName.split('/').pop()?.replace(/\.md$/, '') || 'Untitled';
        log(`Extracted title: "${title}", markdown length: ${markdown.length} characters`);

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Starting Chrome CDP automated upload...',
            cancellable: false,
          },
          async (progress) => {
            await handleCdpFullAutomatedUpload(markdown, title, progress);
          }
        );
      }
    );
    context.subscriptions.push(disposable);
    log('Command registered: multipost.loginWeChatChromeCdp (Fully Automated CDP Upload)');

    disposable = vscode.commands.registerCommand(
      'multipost.uploadToWeChat',
      async () => {
        log('Command invoked: multipost.uploadToWeChat (CDP Automated Upload)');
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showErrorMessage('No active editor');
          log('Error: No active editor', 'error');
          return;
        }

        const markdown = editor.document.getText();
        const fileName = editor.document.fileName;
        const title = extractTitle(markdown) || fileName.split('/').pop()?.replace(/\.md$/, '') || 'Untitled';
        log(`Extracted title: "${title}", markdown length: ${markdown.length} characters`);

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Starting CDP automated upload...',
            cancellable: false,
          },
          async (progress) => {
            await handleCdpFullAutomatedUpload(markdown, title, progress);
          }
        );
      }
    );
    context.subscriptions.push(disposable);
    log('Command registered: multipost.uploadToWeChat');

    log('All commands registered successfully');

    log('Step 3: Loading saved authentication from storage in background...');
    void weChatService.loadAuthFromStorage().then(() => {
      log('Saved auth loaded');
      updatePreviewAuthStatus();
    }).catch((error) => {
      log(`Background auth load failed: ${(error as Error).message}`, 'warn');
    });

    log('=== MultiPost extension activation completed successfully ===');
  } catch (error) {
    const errorMsg = (error as Error).message;
    const errorStack = error instanceof Error && error.stack ? error.stack : 'No stack trace';

    log(`=== MultiPost extension activation FAILED ===`, 'error');
    log(`Error message: ${errorMsg}`, 'error');
    log(`Stack trace: ${errorStack}`, 'error');

    console.error('Failed to activate extension:', error);
    vscode.window.showErrorMessage(`Failed to activate MultiPost: ${errorMsg}`);
    outputChannel.show(true);
    throw error;
  }
}

function updatePreviewAuthStatus(): void {
  const authInfo = weChatService.getAuthInfo();
  previewService.updateAuthStatus(!!authInfo, authInfo?.nickName);
}

/**
 * Ensure we have an active authenticated CDP session
 * - If saved cookies exist: start authenticated session
 * - If no saved cookies: do first-time login flow
 * - If already active: reuse existing session
 * @returns true if session is ready, false if login failed
 */
async function ensureCdpAuthenticatedSession(
  progress: vscode.Progress<{ message?: string }>
): Promise<boolean> {
  const authInfo = weChatService.getAuthInfo();

  try {
    // If we have saved cookies but no active CDP session, start authenticated session
    if (authInfo && authInfo.cookies && authInfo.cookies.length > 0) {
      log(`Found saved auth (${authInfo.cookies.length} cookies), starting authenticated CDP session`);
      progress.report({ message: 'Starting Chrome with saved authentication...' });
      await chromeCdpService.startAuthenticatedSession(authInfo.cookies);
      return true;
    }

    // No auth and no active session - need to do first-time login
    if (!chromeCdpService.isSessionActive()) {
      log('No saved authentication, starting first-time login flow');
      progress.report({ message: 'Waiting for QR code scan...' });
      const cookies = await chromeCdpService.startFirstTimeLogin();
      log(`Got ${cookies.length} cookies from Chrome CDP login`);

      // Validate and save cookies
      const result = await weChatService.checkAuthWithCookies(cookies);
      if (!result.isAuthenticated || !result.authInfo) {
        vscode.window.showErrorMessage('Login failed. Please try again.');
        log('Login failed', 'error');
        return false;
      }

      log(`User authenticated: ${result.authInfo.nickName}`);
      updatePreviewAuthStatus();
      return true;
    }

    // Already have an active CDP session - reuse it
    log('Reusing existing active CDP session (already authenticated)');
    return true;
  } catch (error) {
    // Let caller handle the error
    throw error;
  }
}

/**
 * Process markdown content and get HTML ready for upload
 * Handles mermaid diagram rendering and image uploading
 */
async function processMarkdownContent(
  markdown: string
): Promise<{ html: string; errors: string[] }> {
  log('Starting markdown processing...');
  const processMarkdownModule = await import('./utils/processMarkdown');
  const { processMarkdownForUpload } = processMarkdownModule;
  const result = await processMarkdownForUpload(markdown, weChatService);

  if (result.errors.length > 0) {
    vscode.window.showWarningMessage(`Processing completed with ${result.errors.length} errors: ${result.errors[0]}`);
    log(`Warnings during processing: ${result.errors.length} errors`, 'warn');
    result.errors.forEach(err => log(`  - ${err}`, 'warn'));
  }

  return result;
}

/**
 * Handle fully automated CDP upload workflow:
 * - Ensure authenticated (login if needed)
 * - Process markdown (upload images, render mermaid)
 * - Create draft in browser via CDP automation
 */
async function handleCdpFullAutomatedUpload(
  markdown: string,
  title: string,
  progress: vscode.Progress<{ message?: string }>
): Promise<void> {
  try {
    // Step 1: Ensure we have an authenticated CDP session
    const sessionReady = await ensureCdpAuthenticatedSession(progress);
    if (!sessionReady) {
      return;
    }

    // Step 2: Process markdown (render mermaid, upload images)
    progress.report({ message: 'Processing markdown...' });
    const { html } = await processMarkdownContent(markdown);

    // Step 3: Prepare metadata and create draft in browser
    const currentAuthInfo = weChatService.getAuthInfo();
    const author = settingsService.getDefaultAuthor() || (currentAuthInfo?.nickName) || '';
    const digest = html.replace(/<[^>]*>/g, '').slice(0, 120);
    log(`Processing complete: HTML length = ${html.length} characters, author = "${author}"`);

    // Create draft directly in browser via CDP automation
    progress.report({ message: 'Creating draft in Chrome...' });
    const draftUrl = await chromeCdpService.createDraftInBrowser(title, author, html, digest);
    vscode.window.showInformationMessage('Draft created successfully in Chrome via CDP!');
    log(`Draft created successfully via CDP: ${draftUrl}`);
  } catch (error) {
    vscode.window.showErrorMessage(`CDP upload failed: ${(error as Error).message}`);
    log(`Unexpected error during CDP upload: ${(error as Error).message}`, 'error');
    if (error instanceof Error && error.stack) {
      log(`Stack trace: ${error.stack}`, 'error');
    }
  }
}

export function deactivate() {}
