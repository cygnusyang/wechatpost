const fs = require('fs');
const path = require('path');

console.log('=== MultiPost Extension Diagnostic ===\n');

// 1. 检查package.json配置
console.log('1. Package Configuration:');
const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
console.log(`   Engine: vscode ${pkg.engines.vscode}`);
console.log(`   Main: ${pkg.main}`);
console.log(`   Activation Events: ${pkg.activationEvents.length}`);

// 2. 检查命令列表
console.log('\n2. Commands:');
pkg.contributes.commands.forEach((cmd, i) => {
  console.log(`   ${i+1}. ${cmd.command} -> "${cmd.title}"`);
});

// 3. 检查编译输出
console.log('\n3. Compiled Output:');
const outPath = './out/extension.js';
if (fs.existsSync(outPath)) {
  const stats = fs.statSync(outPath);
  console.log(`   ${outPath}: ${stats.size} bytes`);
  
  // 检查文件内容
  const content = fs.readFileSync(outPath, 'utf8');
  const lines = content.split('\n');
  
  // 检查关键函数是否存在
  const hasActivate = content.includes('activate');
  const hasLoginCommand = content.includes('wechat-publisher.loginWeChat');
  const hasPreviewCommand = content.includes('wechat-publisher.preview');
  const hasUploadCommand = content.includes('wechat-publisher.uploadToWeChat');
  
  console.log(`   Contains activate function: ${hasActivate}`);
  console.log(`   Contains login command: ${hasLoginCommand}`);
  console.log(`   Contains preview command: ${hasPreviewCommand}`);
  console.log(`   Contains upload command: ${hasUploadCommand}`);
  
  // 检查行数
  console.log(`   Total lines: ${lines.length}`);
  
  // 检查是否有明显的错误语法
  const errorPatterns = [
    /SyntaxError/i,
    /ReferenceError/i,
    /TypeError/i,
    /Cannot find module/,
    /require.*is not defined/
  ];
  
  let foundErrors = false;
  errorPatterns.forEach(pattern => {
    if (pattern.test(content)) {
      console.log(`   ⚠️  Found potential error pattern: ${pattern}`);
      foundErrors = true;
    }
  });
  
  if (!foundErrors) {
    console.log('   ✅ No obvious syntax errors found');
  }
} else {
  console.log(`   ❌ ${outPath} not found!`);
}

// 4. 检查依赖安装
console.log('\n4. Dependencies:');
const nodeModulesPath = './node_modules';
if (fs.existsSync(nodeModulesPath)) {
  console.log(`   node_modules exists: ${fs.statSync(nodeModulesPath).isDirectory()}`);
  
  const criticalDeps = ['node-fetch', 'form-data', 'vscode'];
  criticalDeps.forEach(dep => {
    const depPath = path.join(nodeModulesPath, dep);
    console.log(`   ${dep}: ${fs.existsSync(depPath) ? '✓' : '✗'}`);
  });
} else {
  console.log('   ❌ node_modules not found!');
}

// 5. 检查TypeScript编译配置
console.log('\n5. TypeScript Configuration:');
const tsconfig = JSON.parse(fs.readFileSync('./tsconfig.json', 'utf8'));
console.log(`   Target: ${tsconfig.compilerOptions.target}`);
console.log(`   Module: ${tsconfig.compilerOptions.module}`);
console.log(`   Out Dir: ${tsconfig.compilerOptions.outDir}`);
console.log(`   Strict: ${tsconfig.compilerOptions.strict}`);

// 6. 激活事件分析
console.log('\n6. Activation Analysis:');
console.log('   Activation events are:');
pkg.activationEvents.forEach(evt => {
  console.log(`     - ${evt}`);
});

console.log('\n=== Diagnostic Complete ===');
console.log('\nRecommendations:');
console.log('1. Make sure extension is compiled with: npm run vscode:prepublish');
console.log('2. Install the .vsix file in VS Code:');
console.log('   - Open Extensions view (Ctrl+Shift+X)');
console.log('   - Click "..." menu -> "Install from VSIX..."');
console.log('   - Select multipost-0.1.10.vsix');
console.log('3. Check VS Code Developer Tools (Ctrl+Shift+P -> "Developer: Toggle Developer Tools")');
console.log('4. Open a markdown file to trigger "onLanguage:markdown" activation');
console.log('5. Try commands in Command Palette (Ctrl+Shift+P -> "wechat-publisher")');