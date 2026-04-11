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
    });

    expect(mockUpdate).toHaveBeenCalledTimes(6);
    expect(mockUpdate).toHaveBeenCalledWith('defaultAuthor', 'Alice', vscode.ConfigurationTarget.Global);
    expect(mockUpdate).toHaveBeenCalledWith('digestLength', 100, vscode.ConfigurationTarget.Global);
    expect(mockUpdate).toHaveBeenCalledWith('declareOriginal', true, vscode.ConfigurationTarget.Global);
    expect(mockUpdate).toHaveBeenCalledWith('enableAppreciation', false, vscode.ConfigurationTarget.Global);
    expect(mockUpdate).toHaveBeenCalledWith('defaultCollection', 'Collection A', vscode.ConfigurationTarget.Global);
    expect(mockUpdate).toHaveBeenCalledWith('publishDirectly', true, vscode.ConfigurationTarget.Global);
  });
});
