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

    disposable = vscode.commands.registerCommand(
      'multipost.inputCookieWeChat',
      async () => {
        log('Command invoked: multipost.inputCookieWeChat');

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
    log('Command registered: multipost.inputCookieWeChat');

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
            try {
              const authInfo = weChatService.getAuthInfo();

              // If we have saved cookies but no active CDP session, start authenticated session
              if (authInfo && authInfo.cookies && authInfo.cookies.length > 0) {
                log(`Found saved auth (${authInfo.cookies.length} cookies), starting authenticated CDP session`);
                progress.report({ message: 'Starting Chrome with saved authentication...' });
                await chromeCdpService.startAuthenticatedSession(authInfo.cookies);
              } else if (!chromeCdpService.isSessionActive()) {
                // No auth and no active session - need to do first-time login
                log('No saved authentication, starting first-time login flow');
                progress.report({ message: 'Waiting for QR code scan...' });
                const cookies = await chromeCdpService.startFirstTimeLogin();
                log(`Got ${cookies.length} cookies from Chrome CDP login`);

                // Validate and save cookies
                const result = await weChatService.checkAuthWithCookies(cookies);
                if (!result.isAuthenticated || !result.authInfo) {
                  vscode.window.showErrorMessage('Login failed. Please try again.');
                  log('Login failed', 'error');
                  return;
                }

                log(`User authenticated: ${result.authInfo.nickName}`);
                updatePreviewAuthStatus();
              } else {
                // Already have an active CDP session - reuse it
                log('Reusing existing active CDP session (already authenticated)');
              }

              // Now we have an active authenticated CDP session - process and upload
              progress.report({ message: 'Processing markdown...' });
              log('Starting markdown processing...');
              const processMarkdownModule = await import('./utils/processMarkdown');
              const { processMarkdownForUpload } = processMarkdownModule;
              const { html, errors } = await processMarkdownForUpload(markdown, weChatService);
              if (errors.length > 0) {
                vscode.window.showWarningMessage(`Processing completed with ${errors.length} errors: ${errors[0]}`);
                log(`Warnings during processing: ${errors.length} errors`, 'warn');
                errors.forEach(err => log(`  - ${err}`, 'warn'));
              }

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
        );
      }
    );
    context.subscriptions.push(disposable);
    log('Command registered: multipost.loginWeChatChromeCdp (Fully Automated CDP Upload)');

    disposable = vscode.commands.registerCommand(
      'multipost.uploadToWeChat',
      async () => {
        log('Command invoked: multipost.uploadToWeChat');
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showErrorMessage('No active editor');
          log('Error: No active editor', 'error');
          return;
        }

        let authInfo = weChatService.getAuthInfo();

        // If not authenticated, we need to do a login first
        if (!authInfo) {
          log('Not authenticated, starting automatic CDP login before upload');
          vscode.window.showInformationMessage('Starting Chrome for login...');

          // Run the login flow
          const cookies = await chromeCdpService.startFirstTimeLogin();
          const result = await weChatService.checkAuthWithCookies(cookies);

          if (!result.isAuthenticated || !result.authInfo) {
            vscode.window.showErrorMessage('Login failed. Please try again.');
            log('Login failed', 'error');
            return;
          }

          authInfo = result.authInfo;
          log(`User authenticated: ${authInfo.nickName}`);
          updatePreviewAuthStatus();
        } else {
          log(`User authenticated: ${authInfo.nickName}`);

          // Check auth is still valid
          log('Checking if authentication is still valid...');
          const authCheck = await weChatService.checkAuth();
          if (!authCheck.isAuthenticated) {
            vscode.window.showErrorMessage('Authentication expired. Please login again.');
            log('Error: Authentication expired', 'error');
            return;
          }
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

              // If we have an active CDP session (Chrome is open), use browser automation to create draft
              // Otherwise, fall back to API upload for manual cookie login users
              if (chromeCdpService.isSessionActive()) {
                // CDP mode - create draft directly in browser via automation
                const draftUrl = await chromeCdpService.createDraftInBrowser(title, author, html, digest);
                vscode.window.showInformationMessage('Draft created successfully in Chrome!');
                log(`Draft created successfully: ${draftUrl}`);
              } else {
                // Manual mode - use API upload (original behavior)
                const result = await weChatService.createDraft(title, author, html, digest);
                if (result.success && result.draftUrl) {
                  vscode.window.showInformationMessage('Draft created successfully!');
                  log(`Draft created successfully: ${result.draftUrl}`);
                  if (settingsService.shouldAutoOpenDraft()) {
                    await vscode.env.openExternal(vscode.Uri.parse(result.draftUrl));
                    log('Opening draft in browser');
                  }
                } else {
                  vscode.window.showErrorMessage(`Upload failed: ${result.error}`);
                  log(`Upload failed: ${result.error}`, 'error');
                }
              }
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

export function deactivate() {}
