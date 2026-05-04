import * as vscode from 'vscode';
import { ExtensionSettings, SettingsService } from './services/SettingsService';
import { PlaywrightService } from './services/PlaywrightService';
import { extractTitle } from './utils/extractTitle';

let settingsService: SettingsService;
let playwrightService: PlaywrightService;
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
    settingsService = new SettingsService();
    playwrightService = new PlaywrightService(outputChannel);
    log('Services initialized successfully');

    log('Step 2: Registering commands...');
    log(`Available vscode.commands: ${typeof vscode.commands}`);

    // Register commands
    let disposable = vscode.commands.registerCommand(
      'multipost.logoutWeChat',
      async () => {
        log('Command invoked: multipost.logoutWeChat');
        await playwrightService.close();
        vscode.window.showInformationMessage('Logged out from MultiPost');
        log('User logged out successfully');
      }
    );
    context.subscriptions.push(disposable);
    log('Command registered: multipost.logoutWeChat');

    // Register Playwright-based upload command as the main command
    disposable = vscode.commands.registerCommand(
      'multipost.uploadToWeChat',
      async () => {
        log('Command invoked: multipost.uploadToWeChat (Playwright Automated Upload)');
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
            title: 'Starting Playwright automated upload...',
            cancellable: false,
          },
          async (progress) => {
            await handlePlaywrightFullAutomatedUpload(markdown, title, progress);
          }
        );
      }
    );
    context.subscriptions.push(disposable);
    log('Command registered: multipost.uploadToWeChat');

    disposable = vscode.commands.registerCommand(
      'multipost.preview',
      async () => {
        log('Command invoked: multipost.preview');
        await previewCurrentDocument();
      }
    );
    context.subscriptions.push(disposable);
    log('Command registered: multipost.preview');

    disposable = vscode.commands.registerCommand(
      'multipost.configurePublishOptions',
      async () => {
        log('Command invoked: multipost.configurePublishOptions');
        await configurePublishOptions();
      }
    );
    context.subscriptions.push(disposable);
    log('Command registered: multipost.configurePublishOptions');

    log('All commands registered successfully');

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildPreviewWebviewHtml(title: string, bodyHtml: string): string {
  const safeTitle = escapeHtml(title);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MultiPost Preview</title>
  <style>
    :root {
      --page-bg: #f5f7fa;
      --card-bg: #ffffff;
      --text-main: #1f2329;
      --text-sub: #6b7280;
      --border: #e5e7eb;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: var(--page-bg);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    }
    .wrap {
      max-width: 900px;
      margin: 0 auto;
      padding: 24px 16px 48px;
    }
    .meta {
      margin-bottom: 14px;
      color: var(--text-sub);
      font-size: 13px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 22px 18px;
      box-shadow: 0 4px 16px rgba(15, 23, 42, 0.05);
    }
    .title {
      margin: 0 0 18px;
      font-size: 28px;
      line-height: 1.35;
      font-weight: 700;
      word-break: break-word;
    }
    @media (max-width: 768px) {
      .wrap {
        padding: 14px 10px 28px;
      }
      .card {
        border-radius: 10px;
        padding: 16px 12px;
      }
      .title {
        font-size: 24px;
      }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <div class="meta">MultiPost 预览（与上传样式保持一致）</div>
    <article class="card">
      <h1 class="title">${safeTitle}</h1>
      ${bodyHtml}
    </article>
  </main>
</body>
</html>`;
}

async function previewCurrentDocument(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active editor');
    log('Error: No active editor for preview', 'error');
    return;
  }

  const markdown = editor.document.getText();
  const fileName = editor.document.fileName;
  const title = extractTitle(markdown) || fileName.split('/').pop()?.replace(/\.md$/, '') || 'Untitled';
  const settings = settingsService.getSettings();

  const renderedHtml = await playwrightService.renderMarkdownPreview(markdown, settings.contentStyle);
  const panel = vscode.window.createWebviewPanel(
    'multipostPreview',
    `MultiPost Preview: ${title}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: false,
      retainContextWhenHidden: true,
    }
  );
  panel.webview.html = buildPreviewWebviewHtml(title, renderedHtml);
}

async function promptBoolean(
  title: string,
  currentValue: boolean
): Promise<boolean | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: '是', value: true },
      { label: '否', value: false },
    ],
    {
      title,
      placeHolder: currentValue ? '当前: 是' : '当前: 否',
      ignoreFocusOut: true,
    }
  );

  return picked?.value;
}

async function promptThemePreset(
  currentValue: ExtensionSettings['contentStyle']['themePreset']
): Promise<ExtensionSettings['contentStyle']['themePreset'] | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: '经典 (classic)', value: 'classic' as const },
      { label: '杂志 (magazine)', value: 'magazine' as const },
      { label: '简约 (minimal)', value: 'minimal' as const },
    ],
    {
      title: 'MultiPost 配置',
      placeHolder: `当前: ${currentValue}`,
      ignoreFocusOut: true,
    }
  );

  return picked?.value;
}

async function configurePublishOptions(): Promise<void> {
  const current = settingsService.getSettings();

  const defaultAuthor = await vscode.window.showInputBox({
    title: 'MultiPost 配置',
    prompt: '默认作者名',
    value: current.defaultAuthor,
    ignoreFocusOut: true,
  });
  if (defaultAuthor === undefined) {
    return;
  }

  const defaultCollection = await vscode.window.showInputBox({
    title: 'MultiPost 配置',
    prompt: '默认合集名',
    value: current.defaultCollection,
    ignoreFocusOut: true,
  });
  if (defaultCollection === undefined) {
    return;
  }

  const digestLengthInput = await vscode.window.showInputBox({
    title: 'MultiPost 配置',
    prompt: '摘要长度（字符数）',
    value: String(current.digestLength),
    ignoreFocusOut: true,
    validateInput: (value: string) => {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) {
        return '请输入大于等于 0 的整数';
      }
      return undefined;
    },
  });
  if (digestLengthInput === undefined) {
    return;
  }

  const themePreset = await promptThemePreset(current.contentStyle.themePreset);
  if (themePreset === undefined) {
    return;
  }

  const bodyFontSizeInput = await vscode.window.showInputBox({
    title: 'MultiPost 配置',
    prompt: '正文字号（px）',
    value: String(current.contentStyle.bodyFontSize),
    ignoreFocusOut: true,
    validateInput: (value: string) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 12 || parsed > 22) {
        return '请输入 12 到 22 之间的数字';
      }
      return undefined;
    },
  });
  if (bodyFontSizeInput === undefined) {
    return;
  }

  const lineHeightInput = await vscode.window.showInputBox({
    title: 'MultiPost 配置',
    prompt: '正文行高（如 1.85）',
    value: String(current.contentStyle.lineHeight),
    ignoreFocusOut: true,
    validateInput: (value: string) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 1.2 || parsed > 2.4) {
        return '请输入 1.2 到 2.4 之间的数字';
      }
      return undefined;
    },
  });
  if (lineHeightInput === undefined) {
    return;
  }

  const textColorInput = await vscode.window.showInputBox({
    title: 'MultiPost 配置',
    prompt: '正文字色（HEX，例如 #1f2329）',
    value: current.contentStyle.textColor,
    ignoreFocusOut: true,
    validateInput: (value: string) => /^#([0-9a-fA-F]{6})$/.test(value) ? undefined : '请输入 6 位 HEX 颜色，如 #1f2329',
  });
  if (textColorInput === undefined) {
    return;
  }

  const headingColorInput = await vscode.window.showInputBox({
    title: 'MultiPost 配置',
    prompt: '标题颜色（HEX，例如 #0f172a）',
    value: current.contentStyle.headingColor,
    ignoreFocusOut: true,
    validateInput: (value: string) => /^#([0-9a-fA-F]{6})$/.test(value) ? undefined : '请输入 6 位 HEX 颜色，如 #0f172a',
  });
  if (headingColorInput === undefined) {
    return;
  }

  const linkColorInput = await vscode.window.showInputBox({
    title: 'MultiPost 配置',
    prompt: '链接/强调色（HEX，例如 #0969da）',
    value: current.contentStyle.linkColor,
    ignoreFocusOut: true,
    validateInput: (value: string) => /^#([0-9a-fA-F]{6})$/.test(value) ? undefined : '请输入 6 位 HEX 颜色，如 #0969da',
  });
  if (linkColorInput === undefined) {
    return;
  }

  const declareOriginal = await promptBoolean('默认开启原创声明', current.declareOriginal);
  if (declareOriginal === undefined) {
    return;
  }

  const enableAppreciation = await promptBoolean('默认开启赞赏', current.enableAppreciation);
  if (enableAppreciation === undefined) {
    return;
  }

  const publishDirectly = await promptBoolean('默认直接发布（否则保存草稿）', current.publishDirectly);
  if (publishDirectly === undefined) {
    return;
  }

  const updated: ExtensionSettings = {
    defaultAuthor: defaultAuthor.trim(),
    defaultCollection: defaultCollection.trim(),
    digestLength: Number(digestLengthInput),
    declareOriginal,
    enableAppreciation,
    publishDirectly,
    contentStyle: {
      themePreset,
      bodyFontSize: Number(bodyFontSizeInput),
      lineHeight: Number(lineHeightInput),
      textColor: textColorInput,
      headingColor: headingColorInput,
      linkColor: linkColorInput,
    },
  };

  await settingsService.updateSettings(updated);
  vscode.window.showInformationMessage('MultiPost 发布选项已保存');
}

/**
 * Handle fully automated Playwright upload workflow:
 * - Ensure authenticated (login if needed)
 * - Create draft in browser via Playwright automation
 */
async function handlePlaywrightFullAutomatedUpload(
  markdown: string,
  title: string,
  progress: vscode.Progress<{ message?: string }>
): Promise<void> {
  try {
    log('Starting Playwright upload workflow');
    const publishSettings = settingsService.getSettings();

    // Step 1: Check if we need to login
    if (!playwrightService.isSessionActive()) {
      // Check if we have a saved login state
      const hasSavedLogin = await playwrightService.hasSavedLogin();
      
      if (hasSavedLogin) {
        progress.report({ message: 'Restoring saved login session...' });
        await playwrightService.restoreLogin();
      } else {
        progress.report({ message: 'Waiting for QR code scan...' });
        await playwrightService.startFirstTimeLogin();
      }
    }

    // Step 2: Create draft with full options
    const draftUrl = await playwrightService.createDraftInBrowser(
      title,
      publishSettings.defaultAuthor || 'Unknown',
      markdown, // 传递原始 markdown 而不是 HTML
      markdown.slice(0, publishSettings.digestLength), // 提取前N个字符作为摘要
      publishSettings.declareOriginal,
      publishSettings.enableAppreciation,
      publishSettings.defaultCollection,
      publishSettings.publishDirectly,
      publishSettings.contentStyle
    );

    const successMessage = publishSettings.publishDirectly
      ? 'Article published successfully in Chrome via Playwright!'
      : 'Draft created successfully in Chrome via Playwright!';
    vscode.window.showInformationMessage(successMessage);
    log(`${successMessage} URL: ${draftUrl}`);
  } catch (error) {
    vscode.window.showErrorMessage(`Playwright upload failed: ${(error as Error).message}`);
    log(`Unexpected error during Playwright upload: ${(error as Error).message}`, 'error');
    if (error instanceof Error && error.stack) {
      log(`Stack trace: ${error.stack}`, 'error');
    }
  }
}


export function deactivate() {
  if (playwrightService) {
    playwrightService.close();
  }
}
