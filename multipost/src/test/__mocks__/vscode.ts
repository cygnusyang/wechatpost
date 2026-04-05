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
  showErrorMessage: jest.fn(),
  showInformationMessage: jest.fn(),
  showWarningMessage: jest.fn(),
  withProgress: jest.fn((_, cb) => cb()),
  createWebviewPanel: jest.fn(() => {
    return {
      webview: {
        html: '',
        postMessage: jest.fn(),
        asWebviewUri: jest.fn((uri: any) => uri),
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
  file: jest.fn((path: string) => ({ scheme: 'file', path })),
  joinPath: jest.fn(),
  parse: jest.fn(),
};

export enum ViewColumn {
  Beside = -2,
  One = 1,
  Two = 2,
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
