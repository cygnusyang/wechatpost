import * as vscode from 'vscode';
import { SettingsService } from 'src/services/SettingsService';

// Mock vscode workspace
jest.mock('vscode', () => ({
  workspace: {
    getConfiguration: jest.fn(() => ({
      get: jest.fn((key: string, defaultValue: any) => defaultValue),
    })),
  },
}));

describe('SettingsService', () => {
  let mockContext: Partial<vscode.ExtensionContext> = {};
  let settingsService: SettingsService;

  beforeEach(() => {
    mockContext = {};
    settingsService = new SettingsService(mockContext as vscode.ExtensionContext);
    jest.clearAllMocks();
  });

  it('should create instance without error', () => {
    expect(settingsService).toBeDefined();
  });

  it('should return default author when not configured', () => {
    const result = settingsService.getDefaultAuthor();
    expect(result).toBe('');
  });

  it('should return default autoOpenDraft setting', () => {
    const result = settingsService.shouldAutoOpenDraft();
    expect(result).toBe(true);
  });

  it('should get settings from configuration', () => {
    const mockGet = jest.spyOn(vscode.workspace, 'getConfiguration');
    settingsService.getSettings();
    expect(mockGet).toHaveBeenCalledWith('wechatPublisher');
  });
});
