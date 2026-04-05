const fs = require('fs');
const path = require('path');

console.log('=== Debug: Testing extension activation simulation ===');

// 模拟的vscode API (简化的mock)
const mockVSCode = {
  window: {
    createOutputChannel: (name) => {
      console.log(`[Mock] Created output channel: ${name}`);
      return {
        appendLine: (msg) => console.log(`[Output:${name}] ${msg}`),
        show: () => console.log('[Mock] Show output channel'),
        dispose: () => {}
      };
    },
    showErrorMessage: (msg) => console.log(`[Mock Error] ${msg}`),
    showInformationMessage: (msg) => console.log(`[Mock Info] ${msg}`),
    showWarningMessage: (msg) => console.log(`[Mock Warn] ${msg}`),
    activeTextEditor: null,
    createWebviewPanel: () => {
      console.log('[Mock] Created webview panel');
      return {
        webview: { html: '' },
        onDidDispose: (callback) => {
          console.log('[Mock] onDidDispose registered');
          setTimeout(callback, 100);
        },
        dispose: () => {}
      };
    },
    withProgress: (options, task) => {
      console.log('[Mock] Starting progress', options.title);
      return task();
    }
  },
  commands: {
    registerCommand: (command, handler) => {
      console.log(`[Mock] Registered command: ${command}`);
      return {
        dispose: () => console.log(`[Mock] Disposed command: ${command}`)
      };
    },
    executeCommand: async (command) => {
      console.log(`[Mock] Executing command: ${command}`);
      return Promise.resolve();
    }
  },
  ProgressLocation: {
    Notification: 'notification'
  },
  ExtensionMode: {
    Production: 1,
    Development: 2,
    Test: 3
  },
  env: {
    clipboard: {
      writeText: (text) => {
        console.log(`[Mock] Clipboard write: ${text.substring(0, 50)}...`);
        return Promise.resolve();
      }
    },
    openExternal: (uri) => {
      console.log(`[Mock] Open external: ${uri}`);
      return Promise.resolve();
    }
  },
  Uri: {
    parse: (uri) => ({ toString: () => uri }),
    file: (path) => ({ toString: () => `file://${path}` })
  },
  workspace: {
    getConfiguration: () => ({
      get: () => null
    })
  }
};

// 模拟扩展上下文
const mockContext = {
  extensionPath: __dirname,
  subscriptions: [],
  extensionUri: mockVSCode.Uri.file(__dirname),
  secrets: {
    get: async (key) => {
      console.log(`[Mock] SecretStorage.get(${key})`);
      return null;
    },
    store: async (key, value) => {
      console.log(`[Mock] SecretStorage.store(${key}, [${value.length} chars])`);
    },
    delete: async (key) => {
      console.log(`[Mock] SecretStorage.delete(${key})`);
    }
  },
  extensionMode: mockVSCode.ExtensionMode.Production,
  subscriptions: {
    push: (disposable) => {
      console.log('[Mock] Added subscription');
    }
  }
};

// 加载编译后的扩展
async function testActivation() {
  try {
    console.log('\n=== Loading compiled extension ===');
    
    // 检查编译文件
    const extensionPath = './out/extension.js';
    if (!fs.existsSync(extensionPath)) {
      console.error('❌ Compiled extension not found. Run: npm run compile');
      return false;
    }
    
    console.log(`Compiled file size: ${fs.statSync(extensionPath).size} bytes`);
    
    // 在测试环境中模拟require
    global.vscode = mockVSCode;
    
    // 动态加载扩展模块
    const extensionModule = require('./out/extension.js');
    console.log('✅ Extension module loaded');
    
    // 调用activate
    console.log('\n=== Calling activate() ===');
    await extensionModule.activate(mockContext);
    
    console.log('✅ Activation completed successfully');
    
    // 尝试模拟命令执行
    console.log('\n=== Testing command simulation ===');
    console.log('Note: Commands will be mocked, not actually executed');
    
    return true;
    
  } catch (error) {
    console.error('❌ Activation failed:');
    console.error(`Error: ${error.message}`);
    console.error(`Stack: ${error.stack}`);
    
    // 检查常见错误
    if (error.message.includes('Cannot find module')) {
      console.error('\nMissing module. Check dependencies:');
      console.error('1. Ensure node_modules is installed: npm install');
      console.error('2. Check if all dependencies are in package.json');
    }
    
    return false;
  }
}

// 运行测试
testActivation().then(success => {
  console.log(success ? '\n✅ Test passed!' : '\n❌ Test failed!');
  console.log('\nNext steps:');
  console.log('1. Install extension in VS Code:');
  console.log('   - Open Extensions view (Ctrl+Shift+X)');
  console.log('   - Click "..." -> "Install from VSIX..."');
  console.log('   - Select multipost-0.1.10.vsix');
  console.log('\n2. Open a .md file to trigger activation');
  console.log('\n3. Check output in:');
  console.log('   - Output panel -> MultiPost channel');
  console.log('   - Developer Tools console (Ctrl+Shift+P -> "Toggle Developer Tools")');
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});