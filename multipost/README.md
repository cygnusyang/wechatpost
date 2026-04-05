# MultiPost - WeChat Publisher

VSCode 扩展，直接从 Markdown 发布文章到微信公众号。

## 功能特性

- ✅ 完整支持 Markdown / GFM
- ✅ 支持 Mermaid 图表自动渲染上传
- ✅ 代码高亮（highlight.js）
- ✅ 默认微信样式主题
- ✅ 手机扫码登录（不需要开发者资质/AppID）
- ✅ 一键发布到公众号草稿箱
- ✅ 自动上传所有图片到微信 CDN
- ✅ VSCode 安全存储认证信息

## 安装

从 VSIX 安装：

1. 下载 `multipost-<version>.vsix` 文件
2. 打开 VSCode 扩展面板 (Cmd+Shift+X / Ctrl+Shift+X)
3. 点击右上角 `...` 菜单
4. 选择 **"从 VSIX 安装..."**
5. 选择 `.vsix` 文件，重启 VSCode

## 使用方法

### 1. 登录微信公众号

1. 按 `Cmd+Shift+P` (macOS) 或 `Ctrl+Shift+P` (Windows/Linux) 打开命令面板
2. 输入 `WeChat: Login WeChat Official Accounts` 执行
3. 在打开的页面中，用微信扫码登录你的公众号后台
4. 登录成功后关闭登录标签页，插件会自动保存登录状态

### 2. 预览微信格式

1. 打开一个 `.md` Markdown 文件
2. 打开命令面板，输入 `WeChat: Preview WeChat Format`
3. 会在侧边打开预览窗口，显示微信公众号格式的预览

### 3. 发布到微信公众号

在预览窗口点击 **"Upload to WeChat"** 按钮，或者：

1. 打开命令面板
2. 输入 `WeChat: Upload to WeChat Official Accounts`
3. 等待上传完成
4. 上传成功后会自动打开微信公众号草稿页面，你可以在那里编辑和发布

### 4. 退出登录

打开命令面板，输入 `WeChat: Logout WeChat Official Accounts`

## 配置

可以在 VSCode 设置中搜索 `wechatPublisher` 进行配置：

- `wechatPublisher.defaultAuthor` - 默认作者名（发布时使用）
- `wechatPublisher.autoOpenDraftAfterPublish` - 发布成功后是否自动打开草稿页面（默认：true）

## 注意事项

- 本插件使用网页版公众号后台的 Cookie 认证方式，不需要公众号开发者资质
- Mermaid 图表会被渲染为 PNG 图片上传到微信 CDN
- 所有外部图片都会自动上传到微信 CDN
- 认证信息安全保存在 VSCode 密钥存储中，不会明文存储

## 开发

```bash
# 安装依赖
npm install

# 编译后端
npm run compile

# 编译前端预览
npm run build:webview

# 完整重新打包
npm run vscode:prepublish

# 打包 VSIX
npx vsce package
```

## 许可

MIT
