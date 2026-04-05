const vsix = require('./multipost-0.1.10.vsix');

// 创建一个简单的脚本，模拟VS Code扩展测试
console.log('VSIX file metadata:');
console.log(`Size: ${vsix.length} bytes`);
console.log('Note: To test extension activation in VS Code:');
console.log('1. Open VS Code');
console.log('2. Go to Extensions view (Ctrl+Shift+X)');
console.log('3. Click "..." menu and select "Install from VSIX..."');
console.log('4. Select multipost-0.1.10.vsix');
console.log('5. After installation, open Command Palette (Ctrl+Shift+P)');
console.log('6. Type "wechat-publisher" to see available commands');

// 检查package.json中的命令配置
const fs = require('fs');
const path = require('path');
const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
console.log('\nAvailable commands in package.json:');
packageJson.contributes.commands.forEach(cmd => {
  console.log(`  - ${cmd.command}: ${cmd.title}`);
});

console.log('\nActivation events:');
packageJson.activationEvents.forEach(event => {
  console.log(`  - ${event}`);
});

// 检查编译状态
console.log('\nChecking compiled files:');
const outFiles = ['out/extension.js', 'out/extension.js.map'];
outFiles.forEach(file => {
  const stats = fs.existsSync(file) ? fs.statSync(file) : null;
  console.log(`  - ${file}: ${stats ? `${stats.size} bytes` : 'NOT FOUND'}`);
});