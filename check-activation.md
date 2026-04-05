# MultiPost扩展激活检查指南

## 1. 检查扩展是否已安装
1. 打开VS Code
2. 进入扩展视图 (Ctrl+Shift+X)
3. 搜索 "MultiPost - WeChat Publisher"
4. 确认扩展已安装且未禁用

## 2. 查看扩展激活状态
1. 打开开发者工具: Ctrl+Shift+P -> "Developer: Toggle Developer Tools"
2. 在Console选项卡中查看日志
3. 打开CHANGELOG.md文件（markdown文件应触发激活）
4. 在Console中搜索 "MultiPost" 或 "wechat-publisher" 相关日志

## 3. 检查扩展输出通道
1. 在VS Code底部状态栏，查看是否有"MultiPost"输出通道
2. 或打开输出面板: Ctrl+Shift+U
3. 在输出通道选择器中选择 "MultiPost"
4. 查看是否有激活日志，例如：
   ```
   === Starting MultiPost extension activation ===
   Step 1: Initializing services...
   Step 2: Loading saved authentication from storage...
   Step 3: Registering commands...
   ```

## 4. 尝试执行命令
如果扩展已激活，可以通过以下方式执行命令：

### 方法1: Command Palette命令面板
1. 按 Ctrl+Shift+P 打开命令面板
2. 输入 "wechat-publisher.loginWeChat" 或搜索 "Login WeChat"
3. 如果命令存在，会显示 "Login WeChat Official Accounts"

### 方法2: 编辑器右键菜单
1. 打开一个markdown文件
2. 右键单击编辑器
3. 查看上下文菜单中是否有"WeChat Publisher"相关选项

### 方法3: 状态栏按钮
检查VS Code状态栏是否有WeChat Publisher的图标

## 5. 常见问题排查

### 问题1: 扩展未激活
**症状**: 命令面板找不到wechat-publisher相关命令
**可能原因**:
- 激活事件未触发（未打开markdown文件）
- 扩展依赖缺失
- 编译错误

**解决方案**:
1. 确保打开了一个.md文件
2. 重新安装扩展
3. 查看开发者工具控制台错误

### 问题2: 激活但命令不显示
**症状**: 扩展有激活日志但命令不显示
**可能原因**:
- package.json命令配置错误
- 命令注册失败
- VS Code缓存问题

**解决方案**:
1. 重新加载VS Code窗口: Ctrl+Shift+P -> "Developer: Reload Window"
2. 重启VS Code
3. 检查package.json命令配置

### 问题3: 编译错误
**症状**: 开发者工具控制台有JavaScript错误
**可能原因**:
- 依赖模块缺失
- TypeScript编译问题
- 模块导入错误

**解决方案**:
1. 运行 `npm run vscode:prepublish` 重新编译
2. 检查node_modules是否完整
3. 查看编译错误日志

## 6. 手动测试激活

你可以通过以下命令检查编译输出是否正常：

```bash
cd /Users/cygnus/work/github/MultiPost
npm run vscode:prepublish
```

然后检查输出文件：
- `out/extension.js` 是否存在且非空
- `out/` 目录下是否有其他必要的.js文件

## 7. 如果仍然有问题

1. **提供错误信息**: 从开发者工具控制台复制完整错误日志
2. **检查扩展版本**: 当前版本 0.1.10
3. **验证VS Code版本**: 需要VS Code ^1.80.0
4. **查看CHANGELOG**: 最新修复是node-fetch兼容性问题

## 8. 快速测试脚本

运行以下脚本检查扩展编译状态：

```bash
node check-extension.js
```