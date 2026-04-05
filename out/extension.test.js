"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
// Mock unified and related modules before importing extension
jest.mock('unified', () => ({
    unified: jest.fn(() => ({
        use: jest.fn().mockReturnThis(),
        process: jest.fn(async () => ({
            toString: () => '<html></html>',
        })),
    })),
}));
jest.mock('remark-parse', () => jest.fn());
jest.mock('remark-gfm', () => jest.fn());
jest.mock('remark-rehype', () => jest.fn());
jest.mock('rehype-highlight', () => jest.fn());
jest.mock('rehype-stringify', () => jest.fn());
// Mock vscode modules
jest.mock('vscode', () => {
    const original = jest.requireActual('vscode');
    return {
        ...original,
        window: {
            ...original.window,
            showErrorMessage: jest.fn(),
            showInformationMessage: jest.fn(),
            showWarningMessage: jest.fn(),
            showInputBox: jest.fn().mockResolvedValue(undefined),
            createOutputChannel: jest.fn(),
            withProgress: jest.fn((_, cb) => cb()),
            createWebviewPanel: jest.fn(),
        },
        commands: {
            registerCommand: jest.fn(),
            executeCommand: jest.fn(),
        },
        env: {
            openExternal: jest.fn(),
            clipboard: {
                writeText: jest.fn(),
            },
        },
        Uri: {
            file: jest.fn((path) => ({ path })),
            parse: jest.fn(),
        },
    };
});
const vscode = __importStar(require("vscode"));
const extension_1 = require("./extension");
describe('extension', () => {
    let mockContext;
    beforeEach(() => {
        mockContext = {
            extensionUri: vscode.Uri.file('/test/extension'),
            secrets: {
                get: jest.fn(),
                store: jest.fn(),
                delete: jest.fn(),
                onDidChange: jest.fn(),
            },
            subscriptions: [],
            extensionPath: '',
            globalState: {
                get: jest.fn(),
                update: jest.fn(),
                setKeysForSync: jest.fn(),
                keys: jest.fn(() => []),
            },
            workspaceState: {
                get: jest.fn(),
                update: jest.fn(),
                keys: jest.fn(() => []),
            },
            storageUri: undefined,
            storagePath: undefined,
            globalStorageUri: undefined,
            globalStoragePath: '',
            logUri: undefined,
            logPath: '',
            asAbsolutePath: jest.fn((path) => path),
            // Add required missing properties
            environmentVariableCollection: {},
            extensionMode: 1,
            extension: undefined,
            languageModelAccessInformation: undefined,
        };
        jest.clearAllMocks();
    });
    it('should activate without error', async () => {
        await expect((0, extension_1.activate)(mockContext)).resolves.not.toThrow();
        // Should have registered all 5 commands
        expect(vscode.commands.registerCommand).toHaveBeenCalledTimes(5);
        // Output channel plus 5 commands should be pushed to subscriptions
        expect(mockContext.subscriptions).toHaveLength(6);
        // Get all the command callbacks and invoke them to get coverage
        const registerCommandCalls = vscode.commands.registerCommand.mock.calls;
        // Test preview command with no active editor
        const previewCallback = registerCommandCalls[0][1];
        previewCallback();
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('No active editor');
        // Since no active editor, updatePreviewAuthStatus shouldn't error
        expect(previewCallback).not.toThrow();
        // Test login command - should open webview panel
        const loginCallback = registerCommandCalls[1][1];
        loginCallback();
        expect(vscode.window.createWebviewPanel).toHaveBeenCalled();
        // Should not throw even though fetch will fail in mock
        // Test logout command - should clear auth and show message
        const logoutCallback = registerCommandCalls[2][1];
        logoutCallback();
        expect(vscode.window.showInformationMessage).toHaveBeenCalled();
        // Test input cookie command - should show input box
        const inputCookieCallback = registerCommandCalls[3][1];
        inputCookieCallback();
        // Should not throw even when user cancels
        // Test upload command with no active editor
        const uploadCallback = registerCommandCalls[4][1];
        uploadCallback();
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('No active editor');
    });
    it('should deactivate without error', () => {
        expect(() => (0, extension_1.deactivate)()).not.toThrow();
    });
});
//# sourceMappingURL=extension.test.js.map