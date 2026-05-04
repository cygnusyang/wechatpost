import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

export function initLogger(context: vscode.ExtensionContext): vscode.OutputChannel {
  outputChannel = vscode.window.createOutputChannel('WeChatPost');
  context.subscriptions.push(outputChannel);
  return outputChannel;
}

export function getOutputChannel(): vscode.OutputChannel | undefined {
  return outputChannel;
}

export function log(message: string, level: 'info' | 'error' | 'warn' = 'info'): void {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

  if (outputChannel) {
    outputChannel.appendLine(logMessage);
  }

  if (level === 'error') {
    console.error(logMessage);
  } else {
    console.log(logMessage);
  }
}

export function showOutputChannel(preserveFocus = true): void {
  if (outputChannel) {
    outputChannel.show(preserveFocus);
  }
}
