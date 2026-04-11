import * as vscode from 'vscode';
import { SettingsService } from 'src/services/SettingsService';

jest.mock('vscode', () => ({
  workspace: {
    getConfiguration: jest.fn(),
  },
  ConfigurationTarget: {
    Global: 1,
  },
}));

describe('SettingsService', () => {
  let mockUpdate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdate = jest.fn().mockResolvedValue(undefined);
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((_key: string, defaultValue: unknown) => defaultValue),
      update: mockUpdate,
    });
  });

  it('returns default author when configuration is empty', () => {
    const service = new SettingsService();

    expect(service.getDefaultAuthor()).toBe('');
    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('wechatPublisher');
  });

  it('returns custom author when configured', () => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((key: string, defaultValue: unknown) => {
        if (key === 'defaultAuthor') {
          return 'Custom Author';
        }
        return defaultValue;
      }),
    });

    const service = new SettingsService();

    expect(service.getDefaultAuthor()).toBe('Custom Author');
  });

  it('returns settings object with full publish options', () => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((key: string, defaultValue: unknown) => {
        if (key === 'defaultAuthor') {
          return 'Team Author';
        }
        if (key === 'digestLength') {
          return 80;
        }
        if (key === 'declareOriginal') {
          return false;
        }
        if (key === 'enableAppreciation') {
          return false;
        }
        if (key === 'defaultCollection') {
          return 'Tech';
        }
        if (key === 'publishDirectly') {
          return false;
        }
        if (key === 'contentThemePreset') {
          return 'magazine';
        }
        if (key === 'contentBodyFontSize') {
          return 17;
        }
        if (key === 'contentLineHeight') {
          return 1.9;
        }
        if (key === 'contentTextColor') {
          return '#222222';
        }
        if (key === 'contentHeadingColor') {
          return '#111111';
        }
        if (key === 'contentLinkColor') {
          return '#0077cc';
        }
        return defaultValue;
      }),
      update: mockUpdate,
    });

    const service = new SettingsService();

    expect(service.getSettings()).toEqual({
      defaultAuthor: 'Team Author',
      digestLength: 80,
      declareOriginal: false,
      enableAppreciation: false,
      defaultCollection: 'Tech',
      publishDirectly: false,
      contentStyle: {
        themePreset: 'magazine',
        bodyFontSize: 17,
        lineHeight: 1.9,
        textColor: '#222222',
        headingColor: '#111111',
        linkColor: '#0077cc',
      },
    });
  });

  it('updates all settings to global configuration', async () => {
    const service = new SettingsService();

    await service.updateSettings({
      defaultAuthor: 'Alice',
      digestLength: 100,
      declareOriginal: true,
      enableAppreciation: false,
      defaultCollection: 'Collection A',
      publishDirectly: true,
      contentStyle: {
        themePreset: 'classic',
        bodyFontSize: 16,
        lineHeight: 1.85,
        textColor: '#1f2329',
        headingColor: '#0f172a',
        linkColor: '#0969da',
      },
    });

    expect(mockUpdate).toHaveBeenCalledTimes(12);
    expect(mockUpdate).toHaveBeenCalledWith('defaultAuthor', 'Alice', vscode.ConfigurationTarget.Global);
    expect(mockUpdate).toHaveBeenCalledWith('digestLength', 100, vscode.ConfigurationTarget.Global);
    expect(mockUpdate).toHaveBeenCalledWith('declareOriginal', true, vscode.ConfigurationTarget.Global);
    expect(mockUpdate).toHaveBeenCalledWith('enableAppreciation', false, vscode.ConfigurationTarget.Global);
    expect(mockUpdate).toHaveBeenCalledWith('defaultCollection', 'Collection A', vscode.ConfigurationTarget.Global);
    expect(mockUpdate).toHaveBeenCalledWith('publishDirectly', true, vscode.ConfigurationTarget.Global);
    expect(mockUpdate).toHaveBeenCalledWith('contentThemePreset', 'classic', vscode.ConfigurationTarget.Global);
    expect(mockUpdate).toHaveBeenCalledWith('contentBodyFontSize', 16, vscode.ConfigurationTarget.Global);
    expect(mockUpdate).toHaveBeenCalledWith('contentLineHeight', 1.85, vscode.ConfigurationTarget.Global);
    expect(mockUpdate).toHaveBeenCalledWith('contentTextColor', '#1f2329', vscode.ConfigurationTarget.Global);
    expect(mockUpdate).toHaveBeenCalledWith('contentHeadingColor', '#0f172a', vscode.ConfigurationTarget.Global);
    expect(mockUpdate).toHaveBeenCalledWith('contentLinkColor', '#0969da', vscode.ConfigurationTarget.Global);
  });
});
