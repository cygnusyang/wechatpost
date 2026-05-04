import * as vscode from 'vscode';
import { ExtensionSettings, SettingsService } from './services/SettingsService';
import { PlaywrightService } from './services/PlaywrightService';
import { initLogger, log, showOutputChannel, getOutputChannel } from './logger';
import { previewCurrentDocument } from './preview';
import { configurePublishOptions } from './config';
import { handlePlaywrightFullAutomatedUpload, getMarkdownAndTitleFromEditor } from './upload';

let settingsService: SettingsService;
let playwrightService: PlaywrightService;

export function activate(context: vscode.ExtensionContext) {
  // Initialize logger first
  const outputChannel = initLogger(context);

  log('=== Starting WeChatPost extension activation ===');
  log(`Extension context: ${JSON.stringify({
    extensionPath: context.extensionPath,
    subscriptionsCount: context.subscriptions.length,
    extensionUri: context.extensionUri.toString()
  })}`);

  try {
    log('Step 1: Initializing services...');
    // Initialize services
    settingsService = new SettingsService();
    playwrightService = new PlaywrightService(outputChannel);
    log('Services initialized successfully');

    log('Step 2: Registering commands...');

    // Register commands
    let disposable = vscode.commands.registerCommand(
      'wechatpost.logoutWeChat',
      async () => {
        log('Command invoked: wechatpost.logoutWeChat');
        await playwrightService.close();
        vscode.window.showInformationMessage('Logged out from WeChatPost');
        log('User logged out successfully');
      }
    );
    context.subscriptions.push(disposable);
    log('Command registered: wechatpost.logoutWeChat');

    // Register Playwright-based upload command as the main command
    disposable = vscode.commands.registerCommand(
      'wechatpost.uploadToWeChat',
      async () => {
        log('Command invoked: wechatpost.uploadToWeChat (Playwright Automated Upload)');
        const result = getMarkdownAndTitleFromEditor();
        if (!result) {
          return;
        }

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Starting Playwright automated upload...',
            cancellable: false,
          },
          async (progress) => {
            await handlePlaywrightFullAutomatedUpload(
              result.markdown,
              result.title,
              progress,
              settingsService,
              playwrightService
            );
          }
        );
      }
    );
    context.subscriptions.push(disposable);
    log('Command registered: wechatpost.uploadToWeChat');

    disposable = vscode.commands.registerCommand(
      'wechatpost.preview',
      async () => {
        log('Command invoked: wechatpost.preview');
        await previewCurrentDocument(
          playwrightService,
          () => settingsService.getSettings()
        );
      }
    );
    context.subscriptions.push(disposable);
    log('Command registered: wechatpost.preview');

    disposable = vscode.commands.registerCommand(
      'wechatpost.configurePublishOptions',
      async () => {
        log('Command invoked: wechatpost.configurePublishOptions');
        await configurePublishOptions(settingsService);
      }
    );
    context.subscriptions.push(disposable);
    log('Command registered: wechatpost.configurePublishOptions');

    log('All commands registered successfully');
    log('=== WeChatPost extension activation completed successfully ===');
  } catch (error) {
    const errorMessage = (error as Error).message;
    const errorStack = error instanceof Error && error.stack ? error.stack : 'No stack trace';

    log(`=== WeChatPost extension activation FAILED ===`, 'error');
    log(`Error message: ${errorMessage}`, 'error');
    log(`Stack trace: ${errorStack}`, 'error');

    console.error('Failed to activate extension:', error);
    vscode.window.showErrorMessage(`Failed to activate WeChatPost: ${errorMessage}`);
    showOutputChannel(true);
  }
}

export function deactivate() {
  if (playwrightService) {
    playwrightService.close();
  }
}
