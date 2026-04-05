import * as vscode from 'vscode';
import { WeChatService } from './services/WeChatService';
import { PreviewService } from './services/PreviewService';
import { SettingsService } from './services/SettingsService';
import { ChromeCDPService } from './services/ChromeCDPService';
import { extractTitle } from './utils/extractTitle';

let weChatService: WeChatService;
let previewService: PreviewService;
let settingsService: SettingsService;
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

    log('Registering loginWeChat command...');
    disposable = vscode.commands.registerCommand(
      'wechat-publisher.loginWeChat',
      async () => {
        log('Command invoked: wechat-publisher.loginWeChat');
        log(`Current weChatService: ${!!weChatService}, context: ${!!context}`);

        // Open WeChat MP login page in VSCode Webview for automatic cookie capture
        const panel = vscode.window.createWebviewPanel(
          'wechatLogin',
          'WeChat Login',
          vscode.ViewColumn.One,
          {
            enableScripts: true,
            retainContextWhenHidden: true,
          }
        );

        log('Opened login webview');

        // Inject script that will automatically send cookies back when login completes
        const injectedScript = `
<script>
let lastUrl = '';
let checkCount = 0;
const maxChecks = 600; // 5 minutes max (500ms interval)

function checkAndSendCookies() {
  // Check if we're logged in (page contains token/user info)
  const html = document.documentElement.innerHTML;
  if (html.includes('token') && (html.includes('user_name') || html.includes('userName'))) {
    // We're logged in, send cookies back
    const cookies = document.cookie;
    console.log('Login detected, sending cookies...');
    window.vscode.postMessage({
      type: 'loginComplete',
      cookies: cookies
    });
    return true;
  }
  checkCount++;
  if (checkCount >= maxChecks) {
    window.vscode.postMessage({
      type: 'loginTimeout',
      message: 'Login timeout. Please try again.'
    });
    return true;
  }
  return false;
}

// Poll for login completion
setInterval(() => {
  if (!checkAndSendCookies()) {
    // Check again later
  }
}, 500);
</script>
`;

        // Get the page HTML with injected script
        try {
          const response = await fetch('https://mp.weixin.qq.com/', {
            method: 'GET',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
          });
          let html = await response.text();

          // Add base tag to fix relative resource paths (images, css, js)
          if (html.includes('</head>')) {
            html = html.replace('</head>', `<base href="https://mp.weixin.qq.com/"></head>`);
          } else if (html.includes('<head>')) {
            html = html.replace('<head>', `<head><base href="https://mp.weixin.qq.com/">`);
          } else {
            // No head tag, add it at the beginning
            html = `<head><base href="https://mp.weixin.qq.com/"></head>${html}`;
          }

          // Inject our script before </body>
          if (html.includes('</body>')) {
            html = html.replace('</body>', `${injectedScript}</body>`);
          } else {
            html += injectedScript;
          }

          // Remove existing CSP to allow all resources and scripts
          html = html.replace(
            /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/ig,
            ''
          );

          panel.webview.html = html;
          log('Login page loaded in webview with base href fix');
        } catch (error) {
          panel.webview.html = `<html><body><h1>Failed to load login page</h1><p>${error}</p></body></html>`;
          log('Failed to load login page', 'error');
          log(String(error), 'error');
          return;
        }

        // Handle messages from webview
        panel.webview.onDidReceiveMessage(async (message) => {
          if (message.type === 'loginComplete') {
            log('Login complete received from webview, cookies length: ${message.cookies?.length}');

            // Parse cookie string into array
            const cookieStr = message.cookies as string;
            const cookies = cookieStr.split(';').map(c => c.trim()).filter(c => c);

            if (cookies.length === 0) {
              vscode.window.showErrorMessage('No cookies found after login. Please try again.');
              panel.dispose();
              return;
            }

            log(`Parsed ${cookies.length} cookies from webview`);

            // Check auth with these cookies
            const result = await weChatService.checkAuthWithCookies(cookies);
            if (result.isAuthenticated && result.authInfo) {
              vscode.window.showInformationMessage(`Logged in automatically as ${result.authInfo.nickName || 'user'}`);
              log(`Automatic login successful for user: ${result.authInfo.nickName}`);
              updatePreviewAuthStatus();
              panel.dispose();
            } else {
              vscode.window.showErrorMessage('Automatic login failed. Please try Manual Cookie Input.');
              log('Automatic login check failed', 'error');
            }
          } else if (message.type === 'loginTimeout') {
            vscode.window.showErrorMessage(message.message);
            log('Login timeout', 'warn');
            panel.dispose();
          }
        });
      }
    );
    context.subscriptions.push(disposable);
    log(`Command registered: wechat-publisher.loginWeChat, disposable: ${!!disposable}`);

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
    const chromeCdpService = new ChromeCDPService(outputChannel);
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
              const cookies = await chromeCdpService.startLoginFlow();
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
          await vscode.commands.executeCommand('wechat-publisher.loginWeChat');
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
            title: 'Uploading to WeChat...',
            cancellable: false,
          },
          async () => {
            try {
              log('Starting markdown processing and upload...');
              const processMarkdownModule = await import('./utils/processMarkdown');
              const { processMarkdownForUpload } = processMarkdownModule;
              const { html, errors } = await processMarkdownForUpload(markdown, weChatService);
              if (errors.length > 0) {
                vscode.window.showWarningMessage(`Upload completed with ${errors.length} errors: ${errors[0]}`);
                log(`Warnings during processing: ${errors.length} errors`, 'warn');
                errors.forEach(err => log(`  - ${err}`, 'warn'));
              }

              const author = settingsService.getDefaultAuthor() || authInfo.nickName || '';
              const digest = html.replace(/<[^>]*>/g, '').slice(0, 120);
              log(`Processing complete: HTML length = ${html.length} characters, author = "${author}"`);

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
