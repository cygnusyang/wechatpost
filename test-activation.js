const vscode = require('vscode');
const path = require('path');

// 模拟 VS Code 的扩展上下文
const mockContext = {
  extensionPath: path.join(__dirname),
  subscriptions: [],
  extensionUri: vscode.Uri.file(path.join(__dirname)),
  secrets: {
    get: async () => null,
    store: async () => {},
    delete: async () => {}
  }
};

// 尝试加载并激活扩展
async function testActivation() {
  try {
    console.log('Testing extension activation...');
    
    // 动态导入扩展模块
    const extensionModule = require('./out/extension.js');
    
    console.log('Extension module loaded, calling activate...');
    await extensionModule.activate(mockContext);
    
    console.log('Activation successful!');
    
    // 尝试执行命令
    console.log('Testing command execution...');
    try {
      await vscode.commands.executeCommand('wechat-publisher.loginWeChat');
      console.log('Command executed successfully!');
    } catch (error) {
      console.error('Error executing command:', error.message);
      console.error('Stack:', error.stack);
    }
    
    return true;
  } catch (error) {
    console.error('Activation failed:', error.message);
    console.error('Stack:', error.stack);
    return false;
  }
}

// 运行测试
testActivation().then(success => {
  console.log(success ? 'Test passed!' : 'Test failed!');
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});