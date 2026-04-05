"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecretStorage = exports.ProgressLocation = exports.ViewColumn = exports.Uri = exports.env = exports.window = exports.commands = exports.workspace = void 0;
exports.workspace = {
    getConfiguration: jest.fn(() => ({
        get: jest.fn((key, defaultValue) => defaultValue),
    })),
};
exports.commands = {
    registerCommand: jest.fn(),
    executeCommand: jest.fn(),
};
exports.window = {
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
                asWebviewUri: jest.fn((uri) => uri),
                onDidReceiveMessage: jest.fn(),
                cspSource: 'vscode-webview://test',
            },
            reveal: jest.fn(),
            onDidDispose: jest.fn(),
        };
    }),
    activeTextEditor: undefined,
};
exports.env = {
    openExternal: jest.fn(),
    clipboard: {
        writeText: jest.fn(),
    },
};
exports.Uri = {
    file: jest.fn((path) => ({ scheme: 'file', path, fsPath: path })),
    joinPath: jest.fn((base, ...paths) => ({
        scheme: 'file',
        path: [base.path || base.fsPath, ...paths].join('/'),
        fsPath: [base.fsPath || base.path, ...paths].join('/'),
    })),
    parse: jest.fn(),
};
var ViewColumn;
(function (ViewColumn) {
    ViewColumn[ViewColumn["Beside"] = -2] = "Beside";
    ViewColumn[ViewColumn["One"] = 1] = "One";
    ViewColumn[ViewColumn["Two"] = 2] = "Two";
})(ViewColumn || (exports.ViewColumn = ViewColumn = {}));
var ProgressLocation;
(function (ProgressLocation) {
    ProgressLocation[ProgressLocation["Notification"] = 15] = "Notification";
})(ProgressLocation || (exports.ProgressLocation = ProgressLocation = {}));
class SecretStorage {
    constructor() {
        this.get = jest.fn();
        this.store = jest.fn();
        this.delete = jest.fn();
    }
}
exports.SecretStorage = SecretStorage;
//# sourceMappingURL=vscode.js.map