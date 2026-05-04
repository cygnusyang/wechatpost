import * as vscode from 'vscode';
import { ExtensionSettings, SettingsService } from './services/SettingsService';
import { log } from './logger';

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
      title: 'WeChatPost 配置',
      placeHolder: `当前: ${currentValue}`,
      ignoreFocusOut: true,
    }
  );

  return picked?.value;
}

export async function configurePublishOptions(settingsService: SettingsService): Promise<void> {
  const current = settingsService.getSettings();

  const defaultAuthor = await vscode.window.showInputBox({
    title: 'WeChatPost 配置',
    prompt: '默认作者名',
    value: current.defaultAuthor,
    ignoreFocusOut: true,
  });
  if (defaultAuthor === undefined) {
    return;
  }

  const defaultCollection = await vscode.window.showInputBox({
    title: 'WeChatPost 配置',
    prompt: '默认合集名',
    value: current.defaultCollection,
    ignoreFocusOut: true,
  });
  if (defaultCollection === undefined) {
    return;
  }

  const digestLengthInput = await vscode.window.showInputBox({
    title: 'WeChatPost 配置',
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
    title: 'WeChatPost 配置',
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
    title: 'WeChatPost 配置',
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
    title: 'WeChatPost 配置',
    prompt: '正文字色（HEX，例如 #1f2329）',
    value: current.contentStyle.textColor,
    ignoreFocusOut: true,
    validateInput: (value: string) => /^#([0-9a-fA-F]{6})$/.test(value) ? undefined : '请输入 6 位 HEX 颜色，如 #1f2329',
  });
  if (textColorInput === undefined) {
    return;
  }

  const headingColorInput = await vscode.window.showInputBox({
    title: 'WeChatPost 配置',
    prompt: '标题颜色（HEX，例如 #0f172a）',
    value: current.contentStyle.headingColor,
    ignoreFocusOut: true,
    validateInput: (value: string) => /^#([0-9a-fA-F]{6})$/.test(value) ? undefined : '请输入 6 位 HEX 颜色，如 #0f172a',
  });
  if (headingColorInput === undefined) {
    return;
  }

  const linkColorInput = await vscode.window.showInputBox({
    title: 'WeChatPost 配置',
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
  vscode.window.showInformationMessage('WeChatPost 发布选项已保存');
}
