export const workspace = {
  getConfiguration: jest.fn(() => ({
    get: jest.fn((key: string, defaultValue: any) => defaultValue),
  })),
};

export const commands = {
  registerCommand: jest.fn(),
  executeCommand: jest.fn(),
};

export const window = {
  createOutputChannel: jest.fn(() => ({
    appendLine: jest.fn(),
    show: jest.fn(),
    dispose: jest.fn(),
  })),
  showErrorMessage: jest.fn(),
  showInformationMessage: jest.fn(),
  showWarningMessage: jest.fn(),
  showInputBox: jest.fn(),
  withProgress: jest.fn((_, cb) => cb()),
  createWebviewPanel: jest.fn(() => {
    return {
      webview: {
        html: '',
        postMessage: jest.fn(),
        asWebviewUri: jest.fn((uri: any) => uri),
        onDidReceiveMessage: jest.fn(),
        cspSource: 'vscode-webview://test',
      },
      reveal: jest.fn(),
      onDidDispose: jest.fn(),
    };
  }),
  activeTextEditor: undefined,
};

export const env = {
  openExternal: jest.fn(),
  clipboard: {
    writeText: jest.fn(),
  },
};

export const Uri = {
  file: jest.fn((path: string) => ({ scheme: 'file', path, fsPath: path })),
  joinPath: jest.fn((base: any, ...paths: string[]) => ({
    scheme: 'file',
    path: [base.path || base.fsPath, ...paths].join('/'),
    fsPath: [base.fsPath || base.path, ...paths].join('/'),
  })),
  parse: jest.fn(),
};

export enum ViewColumn {
  Beside = -2,
  One = 1,
  Two = 2,
}

export enum ProgressLocation {
  Notification = 15,
}

export type ExtensionContext = {
  extensionUri: any;
  secrets: any;
  subscriptions: any[];
};

export class SecretStorage {
  get = jest.fn();
  store = jest.fn();
  delete = jest.fn();
}
