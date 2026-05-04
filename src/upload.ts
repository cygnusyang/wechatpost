import * as vscode from 'vscode';
import { extractTitle } from './utils/extractTitle';
import { ExtensionSettings, SettingsService } from './services/SettingsService';
import { PlaywrightService } from './services/PlaywrightService';
import { log } from './logger';

/**
 * Handle fully automated Playwright upload workflow:
 * - Ensure authenticated (login if needed)
 * - Create draft in browser via Playwright automation
 */
export async function handlePlaywrightFullAutomatedUpload(
  markdown: string,
  title: string,
  progress: vscode.Progress<{ message?: string }>,
  settingsService: SettingsService,
  playwrightService: PlaywrightService
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

export function getMarkdownAndTitleFromEditor(): { markdown: string; title: string } | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active editor');
    log('Error: No active editor', 'error');
    return null;
  }

  const markdown = editor.document.getText();
  const fileName = editor.document.fileName;
  const title = extractTitle(markdown) || fileName.split('/').pop()?.replace(/\.md$/, '') || 'Untitled';
  log(`Extracted title: "${title}", markdown length: ${markdown.length} characters`);

  return { markdown, title };
}
