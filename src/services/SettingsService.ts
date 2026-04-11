import * as vscode from 'vscode';

export interface ExtensionSettings {
  defaultAuthor: string;
  digestLength: number;
  declareOriginal: boolean;
  enableAppreciation: boolean;
  defaultCollection: string;
  publishDirectly: boolean;
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
  }
}
