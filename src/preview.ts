import * as vscode from 'vscode';
import { extractTitle } from './utils/extractTitle';
import { ExtensionSettings } from './services/SettingsService';
import { PlaywrightService } from './services/PlaywrightService';
import { log } from './logger';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildPreviewWebviewHtml(title: string, bodyHtml: string): string {
  const safeTitle = escapeHtml(title);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>WeChatPost Preview</title>
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
    <div class="meta">WeChatPost 预览（与上传样式保持一致）</div>
    <article class="card">
      <h1 class="title">${safeTitle}</h1>
      ${bodyHtml}
    </article>
  </main>
</body>
</html>`;
}

export async function previewCurrentDocument(
  playwrightService: PlaywrightService,
  getSettings: () => ExtensionSettings
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active editor');
    log('Error: No active editor for preview', 'error');
    return;
  }

  const markdown = editor.document.getText();
  const fileName = editor.document.fileName;
  const title = extractTitle(markdown) || fileName.split('/').pop()?.replace(/\.md$/, '') || 'Untitled';
  const settings = getSettings();

  const renderedHtml = await playwrightService.renderMarkdownPreview(markdown, settings.contentStyle);
  const panel = vscode.window.createWebviewPanel(
    'wechatpostPreview',
    `WeChatPost Preview: ${title}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: false,
      retainContextWhenHidden: true,
    }
  );
  panel.webview.html = buildPreviewWebviewHtml(title, renderedHtml);
}
