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
    chromeCdpService = new ChromeCDPService(outputChannel);
    log('Services initialized successfully');

    previewService.setMessageHandler(async (message) => {
      log(`Received message from preview webview: ${message.type}`);
      if (message.type === 'uploadToWeChat') {
        await vscode.commands.executeCommand('wechat-publisher.uploadToWeChat');
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
      'wechat-publisher.preview',
      () => {
        log('Command invoked: wechat-publisher.preview');
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
    log(`Command registered: wechat-publisher.preview, disposable: ${!!disposable}`);

    disposable = vscode.commands.registerCommand(
      'wechat-publisher.logoutWeChat',
      async () => {
        log('Command invoked: wechat-publisher.logoutWeChat');
        weChatService.clearAuth();
        vscode.window.showInformationMessage('Logged out from WeChat');
        updatePreviewAuthStatus();
        log('User logged out successfully');
      }
    );
    context.subscriptions.push(disposable);
    log('Command registered: wechat-publisher.logoutWeChat');

    disposable = vscode.commands.registerCommand(
      'wechat-publisher.inputCookieWeChat',
      async () => {
        log('Command invoked: wechat-publisher.inputCookieWeChat');

        const cookieInput = await vscode.window.showInputBox({
          prompt: 'Paste your cookie from browser (after logging into mp.weixin.qq.com)',
          placeHolder: 'cookie1=value1; cookie2=value2; ...',
          ignoreFocusOut: true,
        });

        if (!cookieInput) {
          log('Cookie input cancelled');
          return;
        }

        // Parse the cookie string into individual cookies (each becomes a set-cookie entry)
        const cookies = cookieInput.split(';').map(c => c.trim()).filter(c => c).map(c => {
          // Each cookie entry becomes a full set-cookie line like "name=value; ..."
          return c.includes('=') ? c : '';
        }).filter(c => c);

        if (cookies.length === 0) {
          vscode.window.showErrorMessage('No valid cookies found. Please paste in format: name1=value1; name2=value2');
          log('No valid cookies parsed from input', 'error');
          return;
        }

        log(`Parsed ${cookies.length} cookies from input`);

        // Now that we have the user's browser cookies, do the auth check
        const result = await weChatService.checkAuthWithCookies(cookies);
        if (result.isAuthenticated && result.authInfo) {
          vscode.window.showInformationMessage(`Logged in as ${result.authInfo.nickName || 'user'}`);
          log(`Login successful with manual cookie input`);
          updatePreviewAuthStatus();
        } else {
          vscode.window.showErrorMessage('Login failed. Please check your cookie and try again.');
          log('Login check failed with manual cookie input', 'error');
        }
      }
    );
    context.subscriptions.push(disposable);
    log('Command registered: wechat-publisher.inputCookieWeChat');

    // Chrome CDP Automated Login
    disposable = vscode.commands.registerCommand(
      'wechat-publisher.loginWeChatChromeCdp',
      async () => {
        log('Command invoked: wechat-publisher.loginWeChatChromeCdp');

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Starting Chrome for automated login...',
            cancellable: false,
          },
          async () => {
            try {
              log('Starting Chrome CDP automated login');
              const cookies = await chromeCdpService.startFirstTimeLogin();
              log(`Got ${cookies.length} cookies from Chrome CDP login`);

              // Validate cookies with existing WeChatService method
              const result = await weChatService.checkAuthWithCookies(cookies);
              if (result.isAuthenticated && result.authInfo) {
                vscode.window.showInformationMessage(`Automated login successful as ${result.authInfo.nickName || 'user'}`);
                log(`Chrome CDP login successful for user: ${result.authInfo.nickName}`);
                updatePreviewAuthStatus();
              } else {
                vscode.window.showErrorMessage('Automated login failed. Please try Manual Cookie Input.');
                log('Chrome CDP login authentication check failed', 'error');
              }
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error);
              vscode.window.showErrorMessage(`Chrome CDP login failed: ${errorMsg}`);
              log(`Chrome CDP login error: ${errorMsg}`, 'error');
            }
          }
        );
      }
    );
    context.subscriptions.push(disposable);
    log('Command registered: wechat-publisher.loginWeChatChromeCdp');

    disposable = vscode.commands.registerCommand(
      'wechat-publisher.uploadToWeChat',
      async () => {
        log('Command invoked: wechat-publisher.uploadToWeChat');
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showErrorMessage('No active editor');
          log('Error: No active editor', 'error');
          return;
        }

        const authInfo = weChatService.getAuthInfo();
        if (!authInfo) {
          vscode.window.showErrorMessage('Not logged in. Please login first.');
          log('Error: Not authenticated, prompting login', 'error');
          await vscode.commands.executeCommand('wechat-publisher.loginWeChatChromeCdp');
          return;
        }

        log(`User authenticated: ${authInfo.nickName}`);

        // Check auth is still valid
        log('Checking if authentication is still valid...');
        const authCheck = await weChatService.checkAuth();
        if (!authCheck.isAuthenticated) {
          vscode.window.showErrorMessage('Authentication expired. Please login again.');
          log('Error: Authentication expired', 'error');
          return;
        }

        const markdown = editor.document.getText();
        const fileName = editor.document.fileName;
        const title = extractTitle(markdown) || fileName.split('/').pop()?.replace(/\.md$/, '') || 'Untitled';
        log(`Extracted title: "${title}", markdown length: ${markdown.length} characters`);

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Processing and creating draft in Chrome...',
            cancellable: false,
          },
          async () => {
            try {
              log('Starting markdown processing...');
              const processMarkdownModule = await import('./utils/processMarkdown');
              const { processMarkdownForUpload } = processMarkdownModule;
              const { html, errors } = await processMarkdownForUpload(markdown, weChatService);
              if (errors.length > 0) {
                vscode.window.showWarningMessage(`Processing completed with ${errors.length} errors: ${errors[0]}`);
                log(`Warnings during processing: ${errors.length} errors`, 'warn');
                errors.forEach(err => log(`  - ${err}`, 'warn'));
              }

              const author = settingsService.getDefaultAuthor() || authInfo.nickName || '';
              const digest = html.replace(/<[^>]*>/g, '').slice(0, 120);
              log(`Processing complete: HTML length = ${html.length} characters, author = "${author}"`);

              // Check if we already have an active CDP session
              if (!chromeCdpService.isSessionActive()) {
                log('Starting new authenticated CDP session with saved cookies');
                await chromeCdpService.startAuthenticatedSession(authInfo.cookies);
              }

              // Create draft directly in browser via CDP automation
              const draftUrl = await chromeCdpService.createDraftInBrowser(title, author, html, digest);

              vscode.window.showInformationMessage('Draft created successfully in Chrome!');
              log(`Draft created successfully: ${draftUrl}`);
            } catch (error) {
              vscode.window.showErrorMessage(`Upload failed: ${(error as Error).message}`);
              log(`Unexpected error during upload: ${(error as Error).message}`, 'error');
              if (error instanceof Error && error.stack) {
                log(`Stack trace: ${error.stack}`, 'error');
              }
            }
          }
        );
      }
    );
    context.subscriptions.push(disposable);
    log('Command registered: wechat-publisher.uploadToWeChat');

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

export function deactivate() {}
