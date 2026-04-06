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
const SettingsService_1 = require("./services/SettingsService");
const ChromeCDPService_1 = require("./services/ChromeCDPService");
const PlaywrightService_1 = require("./services/PlaywrightService");
const extractTitle_1 = require("./utils/extractTitle");
let weChatService;
let settingsService;
let chromeCdpService;
let playwrightService;
let outputChannel;
function log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    if (outputChannel) {
        outputChannel.appendLine(logMessage);
    }
    if (level === 'error') {
        console.error(logMessage);
    }
    else {
        console.log(logMessage);
    }
}
async function activate(context) {
    // Create output channel for logging
    outputChannel = vscode.window.createOutputChannel('MultiPost');
    context.subscriptions.push(outputChannel);
    log('=== Starting MultiPost extension activation ===');
    log(`Extension context: ${JSON.stringify({
        extensionPath: context.extensionPath,
        subscriptionsCount: context.subscriptions.length,
        extensionUri: context.extensionUri.toString()
    })}`);
    try {
        log('Step 1: Initializing services...');
        // Initialize services
        weChatService = new WeChatService_1.WeChatService(context.secrets, outputChannel);
        settingsService = new SettingsService_1.SettingsService(context);
        const storagePath = context.globalStorageUri?.fsPath || context.extensionPath;
        chromeCdpService = new ChromeCDPService_1.ChromeCDPService(outputChannel, storagePath);
        playwrightService = new PlaywrightService_1.PlaywrightService(outputChannel, storagePath);
        log('Services initialized successfully');
        log('Step 2: Registering commands...');
        log(`Available vscode.commands: ${typeof vscode.commands}`);
        // Register commands
        let disposable = vscode.commands.registerCommand('multipost.logoutWeChat', async () => {
            log('Command invoked: multipost.logoutWeChat');
            weChatService.clearAuth();
            vscode.window.showInformationMessage('Logged out from MultiPost');
            log('User logged out successfully');
        });
        context.subscriptions.push(disposable);
        log('Command registered: multipost.logoutWeChat');
        disposable = vscode.commands.registerCommand('multipost.uploadToWeChat', async () => {
            log('Command invoked: multipost.uploadToWeChat (CDP Automated Upload)');
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor');
                log('Error: No active editor', 'error');
                return;
            }
            const markdown = editor.document.getText();
            const fileName = editor.document.fileName;
            const title = (0, extractTitle_1.extractTitle)(markdown) || fileName.split('/').pop()?.replace(/\.md$/, '') || 'Untitled';
            log(`Extracted title: "${title}", markdown length: ${markdown.length} characters`);
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Starting CDP automated upload...',
                cancellable: false,
            }, async (progress) => {
                await handleCdpFullAutomatedUpload(markdown, title, progress);
            });
        });
        context.subscriptions.push(disposable);
        log('Command registered: multipost.uploadToWeChat');
        // Register Playwright-based upload command
        disposable = vscode.commands.registerCommand('multipost.uploadToWeChatPlaywright', async () => {
            log('Command invoked: multipost.uploadToWeChatPlaywright');
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor');
                log('Error: No active editor', 'error');
                return;
            }
            const markdown = editor.document.getText();
            const fileName = editor.document.fileName;
            const title = (0, extractTitle_1.extractTitle)(markdown) || fileName.split('/').pop()?.replace(/\.md$/, '') || 'Untitled';
            log(`Extracted title: "${title}", markdown length: ${markdown.length} characters`);
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Starting Playwright automated upload...',
                cancellable: false,
            }, async (progress) => {
                await handlePlaywrightFullAutomatedUpload(markdown, title, progress);
            });
        });
        context.subscriptions.push(disposable);
        log('Command registered: multipost.uploadToWeChatPlaywright');
        log('All commands registered successfully');
        log('Step 3: Loading saved authentication from storage in background...');
        void weChatService.loadAuthFromStorage().then(() => {
            log('Saved auth loaded');
        }).catch((error) => {
            log(`Background auth load failed: ${error.message}`, 'warn');
        });
        log('=== MultiPost extension activation completed successfully ===');
    }
    catch (error) {
        const errorMsg = error.message;
        const errorStack = error instanceof Error && error.stack ? error.stack : 'No stack trace';
        log(`=== MultiPost extension activation FAILED ===`, 'error');
        log(`Error message: ${errorMsg}`, 'error');
        log(`Stack trace: ${errorStack}`, 'error');
        console.error('Failed to activate extension:', error);
        vscode.window.showErrorMessage(`Failed to activate MultiPost: ${errorMsg}`);
        outputChannel.show(true);
        throw error;
    }
}
/**
 * Ensure we have an active authenticated CDP session
 * - If saved cookies exist: start authenticated session
 * - If no saved cookies: do first-time login flow
 * - If already active: reuse existing session
 * @returns true if session is ready, false if login failed
 */
async function ensureCdpAuthenticatedSession(progress) {
    const authInfo = weChatService.getAuthInfo();
    try {
        // If we have saved cookies but no active CDP session, start authenticated session
        if (authInfo && authInfo.cookies && authInfo.cookies.length > 0) {
            log(`Found saved auth (${authInfo.cookies.length} cookies), starting authenticated CDP session`);
            progress.report({ message: 'Starting Chrome with saved authentication...' });
            await chromeCdpService.startAuthenticatedSession(authInfo.cookies);
            return true;
        }
        // No auth and no active session - need to do first-time login
        if (!chromeCdpService.isSessionActive()) {
            log('No saved authentication, starting first-time login flow');
            progress.report({ message: 'Waiting for QR code scan...' });
            const cookies = await chromeCdpService.startFirstTimeLogin();
            log(`Got ${cookies.length} cookies from Chrome CDP login`);
            // Validate and save cookies
            const result = await weChatService.checkAuthWithCookies(cookies);
            if (!result.isAuthenticated || !result.authInfo) {
                vscode.window.showErrorMessage('Login failed. Please try again.');
                log('Login failed', 'error');
                return false;
            }
            log(`User authenticated: ${result.authInfo.nickName}`);
            return true;
        }
        // Already have an active CDP session - reuse it
        log('Reusing existing active CDP session (already authenticated)');
        return true;
    }
    catch (error) {
        // Let caller handle the error
        throw error;
    }
}
/**
 * Process markdown content and get HTML ready for upload
 * Handles mermaid diagram rendering and image uploading
 */
async function processMarkdownContent(markdown) {
    log('Starting markdown processing...');
    const processMarkdownModule = await Promise.resolve().then(() => __importStar(require('./utils/processMarkdown')));
    const { processMarkdownForUpload } = processMarkdownModule;
    const result = await processMarkdownForUpload(markdown, weChatService);
    if (result.errors.length > 0) {
        vscode.window.showWarningMessage(`Processing completed with ${result.errors.length} errors: ${result.errors[0]}`);
        log(`Warnings during processing: ${result.errors.length} errors`, 'warn');
        result.errors.forEach(err => log(`  - ${err}`, 'warn'));
    }
    return result;
}
/**
 * Handle fully automated Playwright upload workflow:
 * - Ensure authenticated (login if needed)
 * - Process markdown (render mermaid, upload images)
 * - Create draft in browser via Playwright automation
 */
async function handlePlaywrightFullAutomatedUpload(markdown, title, progress) {
    try {
        log('Starting Playwright upload workflow');
        // Step 1: Process markdown (render mermaid, upload images)
        progress.report({ message: 'Processing markdown...' });
        const { html } = await processMarkdownContent(markdown);
        // Step 2: Create draft directly in browser via Playwright automation
        progress.report({ message: 'Creating draft in Chrome (Playwright)...' });
        // Check if we need to login
        if (!playwrightService.isSessionActive()) {
            progress.report({ message: 'Waiting for QR code scan...' });
            await playwrightService.startFirstTimeLogin();
        }
        // Create draft
        const draftUrl = await playwrightService.createDraftInBrowser(title, settingsService.getDefaultAuthor() || 'Unknown', html, html.replace(/<[^>]*>/g, '').slice(0, 120) // 提取前120个字符作为摘要
        );
        vscode.window.showInformationMessage('Draft created successfully in Chrome via Playwright!');
        log(`Draft created successfully via Playwright: ${draftUrl}`);
    }
    catch (error) {
        vscode.window.showErrorMessage(`Playwright upload failed: ${error.message}`);
        log(`Unexpected error during Playwright upload: ${error.message}`, 'error');
        if (error instanceof Error && error.stack) {
            log(`Stack trace: ${error.stack}`, 'error');
        }
    }
}
/**
 * Handle fully automated CDP upload workflow:
 * - Ensure authenticated (login if needed)
 * - Process markdown (upload images, render mermaid)
 * - Create draft in browser via CDP automation
 */
async function handleCdpFullAutomatedUpload(markdown, title, progress) {
    try {
        // Step 1: Ensure we have an authenticated CDP session
        const sessionReady = await ensureCdpAuthenticatedSession(progress);
        if (!sessionReady) {
            return;
        }
        // Step 2: Process markdown (render mermaid, upload images)
        progress.report({ message: 'Processing markdown...' });
        const { html } = await processMarkdownContent(markdown);
        // Step 3: Prepare metadata and create draft in browser
        const currentAuthInfo = weChatService.getAuthInfo();
        const author = settingsService.getDefaultAuthor() || (currentAuthInfo?.nickName) || '';
        const digest = html.replace(/<[^>]*>/g, '').slice(0, 120);
        log(`Processing complete: HTML length = ${html.length} characters, author = "${author}"`);
        // Create draft directly in browser via CDP automation
        progress.report({ message: 'Creating draft in Chrome...' });
        const draftUrl = await chromeCdpService.createDraftInBrowser(title, author, html, digest);
        vscode.window.showInformationMessage('Draft created successfully in Chrome via CDP!');
        log(`Draft created successfully via CDP: ${draftUrl}`);
    }
    catch (error) {
        vscode.window.showErrorMessage(`CDP upload failed: ${error.message}`);
        log(`Unexpected error during CDP upload: ${error.message}`, 'error');
        if (error instanceof Error && error.stack) {
            log(`Stack trace: ${error.stack}`, 'error');
        }
    }
}
function deactivate() { }
//# sourceMappingURL=extension.js.map