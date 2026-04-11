import * as vscode from 'vscode';

export interface ContentStyleSettings {
  themePreset: 'classic' | 'magazine' | 'minimal';
  bodyFontSize: number;
  lineHeight: number;
  textColor: string;
  headingColor: string;
  linkColor: string;
}

export interface ExtensionSettings {
  defaultAuthor: string;
  digestLength: number;
  declareOriginal: boolean;
  enableAppreciation: boolean;
  defaultCollection: string;
  publishDirectly: boolean;
  contentStyle: ContentStyleSettings;
}

export class SettingsService {
  getSettings(): ExtensionSettings {
    const config = vscode.workspace.getConfiguration('wechatPublisher');
    return {
      defaultAuthor: config.get('defaultAuthor', ''),
      digestLength: config.get('digestLength', 120),
      declareOriginal: config.get('declareOriginal', true),
      enableAppreciation: config.get('enableAppreciation', true),
      defaultCollection: config.get('defaultCollection', '智能体'),
      publishDirectly: config.get('publishDirectly', true),
      contentStyle: {
        themePreset: config.get('contentThemePreset', 'classic'),
        bodyFontSize: config.get('contentBodyFontSize', 16),
        lineHeight: config.get('contentLineHeight', 1.85),
        textColor: config.get('contentTextColor', '#1f2329'),
        headingColor: config.get('contentHeadingColor', '#0f172a'),
        linkColor: config.get('contentLinkColor', '#0969da'),
      },
    };
  }

  getDefaultAuthor(): string {
    return this.getSettings().defaultAuthor;
  }

  async updateSettings(settings: ExtensionSettings): Promise<void> {
    const config = vscode.workspace.getConfiguration('wechatPublisher');
    await config.update('defaultAuthor', settings.defaultAuthor, vscode.ConfigurationTarget.Global);
    await config.update('digestLength', settings.digestLength, vscode.ConfigurationTarget.Global);
    await config.update('declareOriginal', settings.declareOriginal, vscode.ConfigurationTarget.Global);
    await config.update('enableAppreciation', settings.enableAppreciation, vscode.ConfigurationTarget.Global);
    await config.update('defaultCollection', settings.defaultCollection, vscode.ConfigurationTarget.Global);
    await config.update('publishDirectly', settings.publishDirectly, vscode.ConfigurationTarget.Global);
    await config.update('contentThemePreset', settings.contentStyle.themePreset, vscode.ConfigurationTarget.Global);
    await config.update('contentBodyFontSize', settings.contentStyle.bodyFontSize, vscode.ConfigurationTarget.Global);
    await config.update('contentLineHeight', settings.contentStyle.lineHeight, vscode.ConfigurationTarget.Global);
    await config.update('contentTextColor', settings.contentStyle.textColor, vscode.ConfigurationTarget.Global);
    await config.update('contentHeadingColor', settings.contentStyle.headingColor, vscode.ConfigurationTarget.Global);
    await config.update('contentLinkColor', settings.contentStyle.linkColor, vscode.ConfigurationTarget.Global);
  }
}
