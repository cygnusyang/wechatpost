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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const WeChatService_1 = require("./services/WeChatService");
const PreviewService_1 = require("./services/PreviewService");
const SettingsService_1 = require("./services/SettingsService");
const extractTitle_1 = require("./utils/extractTitle");
const processMarkdown_1 = require("./utils/processMarkdown");
let weChatService;
let previewService;
let settingsService;
async function activate(context) {
    try {
        // Initialize services
        weChatService = new WeChatService_1.WeChatService(context.secrets);
        previewService = new PreviewService_1.PreviewService(context.extensionUri);
        settingsService = new SettingsService_1.SettingsService(context);
        // Load saved auth
        await weChatService.loadAuthFromStorage();
        // Register commands
        let disposable = vscode.commands.registerCommand('wechat-publisher.preview', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor');
                return;
            }
            const markdown = editor.document.getText();
            previewService.openPreview(markdown);
            updatePreviewAuthStatus();
        });
        context.subscriptions.push(disposable);
        disposable = vscode.commands.registerCommand('wechat-publisher.loginWeChat', async () => {
            const panel = vscode.window.createWebviewPanel('wechatLogin', 'WeChat Login', vscode.ViewColumn.One, {
                enableScripts: true,
            });
            panel.webview.html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>WeChat Login</title>
  <style>
    body { margin: 0; padding: 16px; }
    .container { max-width: 400px; margin: 0 auto; text-align: center; }
    h2 { margin-bottom: 16px; }
    p { color: #666; }
    iframe { width: 100%; height: 600px; border: 1px solid #eee; border-radius: 8px; }
  </style>
</head>
<body>
  <div class="container">
    <h2>Scan QR Code to Login</h2>
    <p>Please scan the QR code below using WeChat to login</p>
    <iframe src="https://mp.weixin.qq.com/"></iframe>
  </div>
</body>
</html>
      `;
            // After login, check auth
            panel.onDidDispose(async () => {
                const result = await weChatService.checkAuth();
                if (result.isAuthenticated) {
                    vscode.window.showInformationMessage(`Logged in as ${result.authInfo?.nickName}`);
                    updatePreviewAuthStatus();
                }
                else {
                    vscode.window.showErrorMessage('Login failed. Please try again.');
                }
            });
        });
        context.subscriptions.push(disposable);
        disposable = vscode.commands.registerCommand('wechat-publisher.logoutWeChat', async () => {
            weChatService.clearAuth();
            vscode.window.showInformationMessage('Logged out from WeChat');
            updatePreviewAuthStatus();
        });
        context.subscriptions.push(disposable);
        disposable = vscode.commands.registerCommand('wechat-publisher.uploadToWeChat', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor');
                return;
            }
            const authInfo = weChatService.getAuthInfo();
            if (!authInfo) {
                vscode.window.showErrorMessage('Not logged in. Please login first.');
                await vscode.commands.executeCommand('wechat-publisher.loginWeChat');
                return;
            }
            // Check auth is still valid
            const authCheck = await weChatService.checkAuth();
            if (!authCheck.isAuthenticated) {
                vscode.window.showErrorMessage('Authentication expired. Please login again.');
                return;
            }
            const markdown = editor.document.getText();
            const fileName = editor.document.fileName;
            const title = (0, extractTitle_1.extractTitle)(markdown) || fileName.split('/').pop()?.replace(/\.md$/, '') || 'Untitled';
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Uploading to WeChat...',
                cancellable: false,
            }, async () => {
                try {
                    const { html, errors } = await (0, processMarkdown_1.processMarkdownForUpload)(markdown, weChatService);
                    if (errors.length > 0) {
                        vscode.window.showWarningMessage(`Upload completed with ${errors.length} errors: ${errors[0]}`);
                    }
                    const author = settingsService.getDefaultAuthor() || authInfo.nickName || '';
                    const digest = html.replace(/<[^>]*>/g, '').slice(0, 120);
                    const result = await weChatService.createDraft(title, author, html, digest);
                    if (result.success && result.draftUrl) {
                        vscode.window.showInformationMessage('Draft created successfully!');
                        if (settingsService.shouldAutoOpenDraft()) {
                            await vscode.env.openExternal(vscode.Uri.parse(result.draftUrl));
                        }
                    }
                    else {
                        vscode.window.showErrorMessage(`Upload failed: ${result.error}`);
                    }
                }
                catch (error) {
                    vscode.window.showErrorMessage(`Upload failed: ${error.message}`);
                }
            });
        });
        context.subscriptions.push(disposable);
        // Listen for messages from webview
        const panel = previewService.getPanel();
        if (panel) {
            panel.webview.onDidReceiveMessage(async (message) => {
                if (message.type === 'uploadToWeChat') {
                    await vscode.commands.executeCommand('wechat-publisher.uploadToWeChat');
                }
                else if (message.type === 'copyHtml') {
                    await vscode.env.clipboard.writeText(message.html);
                    vscode.window.showInformationMessage('HTML copied to clipboard');
                }
            }, undefined, context.subscriptions);
        }
    }
    catch (error) {
        console.error('Failed to activate extension:', error);
        vscode.window.showErrorMessage(`Failed to activate MultiPost: ${error.message}`);
        throw error;
    }
}
function updatePreviewAuthStatus() {
    const authInfo = weChatService.getAuthInfo();
    previewService.updateAuthStatus(!!authInfo, authInfo?.nickName);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map