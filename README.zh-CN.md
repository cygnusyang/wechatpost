# MultiPost - 微信公众号发布工具

VS Code 扩展 - 将 Markdown 文件一键发布到微信公众号，支持 Mermaid 图表自动渲染上传，支持 Chrome CDP 全自动登录+发布。

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

所有命令都以 `MultiPost: ` 前缀显示在命令面板中。

### 方式一：CDP 全自动推荐（推荐）

**CDP Fully Automated Upload**

1. 打开 `.md` Markdown 文件
2. 打开命令面板（`Cmd+Shift+P` / `Ctrl+Shift+P`）
3. 输入 `CDP Fully Automated Upload` 执行
4. 如果未登录：会自动打开 Chrome，扫码登录后自动保存凭据并上传
5. 如果已登录：直接在浏览器中创建草稿
6. Mermaid 图表会自动渲染为图片并上传到微信 CDN

### 方式二：手动 Cookie 模式

1. **Input Cookie (Manual Login)** - 手动输入从浏览器复制的 Cookie
2. **Upload to WeChat Official Accounts** - 上传当前 Markdown 到微信公众号草稿

### 其他命令

- **Preview MultiPost Format** - 在侧边栏预览转换后的微信 HTML 格式
- **Logout MultiPost** - 清除保存的登录凭据

### 预览微信格式

1. 打开一个 `.md` Markdown 文件
2. 打开命令面板，输入 `Preview MultiPost Format`
3. 会在侧边打开预览窗口，显示微信公众号格式的预览

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
