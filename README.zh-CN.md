[English Version](README.md)

<div align="center">
  <br />
  <img src="https://raw.githubusercontent.com/cygnusyang/wechatpost/main/media/icon.png" alt="WeChatPost Logo" width="128" height="128">
  <h1 style="border-bottom: none;">🚀 WeChatPost - 微信公众号发布工具</h1>
  <p style="font-size: 1.2em;">从 VSCode 一键发布 Markdown 到微信公众号</p>
</div>

## ✨ 功能特性

- ✅ **完整 Markdown 支持** - 完全支持 Markdown 和 GitHub Flavored Markdown
- ✅ **Mermaid 图表渲染** - 自动渲染和上传 Mermaid 图表
- ✅ **代码高亮** - 使用 highlight.js 实现美观的语法高亮
- ✅ **微信样式主题** - 默认微信公众号风格主题
- ✅ **扫码登录** - 手机扫码登录（无需开发者资质/AppID）
- ✅ **一键发布** - 直接发布到公众号草稿箱
- ✅ **图片上传** - 自动上传所有图片到微信 CDN
- ✅ **安全存储** - 认证信息安全存储在 VSCode 密钥链中

## 📦 安装

### 从 VSIX 文件安装

1. 下载 `wechatpost-<version>.vsix` 文件
2. 打开 VSCode 扩展面板 (Cmd+Shift+X / Ctrl+Shift+X)
3. 点击右上角 `...` 菜单
4. 选择 **"从 VSIX 安装..."**
5. 选择 `.vsix` 文件，重启 VSCode

## 🚀 使用方法

所有命令都以 `WeChatPost: ` 前缀显示在命令面板中。

### 方式一：CDP 全自动（推荐）

1. 打开 `.md` Markdown 文件
2. 打开命令面板（`Cmd+Shift+P` / `Ctrl+Shift+P`）
3. 输入 `WeChatPost: Publish Current Markdown to WeChat` 执行
4. **未登录时**：会自动打开 Chrome，扫码登录后自动保存凭据并上传
5. **已登录时**：直接在浏览器中创建草稿
6. Mermaid 图表会自动渲染为图片并上传到微信 CDN

### 方式二：手动 Cookie 模式

1. **Input Cookie (Manual Login)** - 手动输入从浏览器复制的 Cookie
2. **WeChatPost: Publish Current Markdown to WeChat** - 上传当前 Markdown 到微信公众号草稿

### 其他命令

- **WeChatPost: Preview WeChat Article Layout** - 在侧边栏预览转换后的微信 HTML 格式
- **WeChatPost: Sign Out of WeChat Session** - 清除保存的登录凭据

### 预览微信格式

1. 打开一个 `.md` Markdown 文件
2. 打开命令面板，输入 `WeChatPost: Preview WeChat Article Layout`
3. 会在侧边打开预览窗口，显示微信公众号格式的预览

## ⚙️ 配置

可以在 VSCode 设置中搜索 `wechatPublisher` 进行配置：

| 设置项 | 类型 | 默认值 | 描述 |
|---------|------|---------|-------------|
| `wechatPublisher.defaultAuthor` | `string` | `""` | 发布时使用的默认作者名 |
| `wechatPublisher.digestLength` | `number` | `120` | 从 Markdown 内容中提取的摘要长度 |
| `wechatPublisher.declareOriginal` | `boolean` | `true` | 是否默认声明原创 |
| `wechatPublisher.enableAppreciation` | `boolean` | `true` | 是否默认开启赞赏功能 |
| `wechatPublisher.defaultCollection` | `string` | `"智能体"` | 微信公众号文章的默认合集名称 |
| `wechatPublisher.publishDirectly` | `boolean` | `true` | 是否默认直接发布，禁用则保存为草稿 |

## 📝 注意事项

- 本插件使用微信公众号网页版的 Cookie 认证方式，不需要公众号开发者资质
- Mermaid 图表会被渲染为 PNG 图片上传到微信 CDN
- 所有外部图片都会自动上传到微信 CDN
- 认证信息安全保存在 VSCode 密钥存储中，不会明文存储

## 🛠️ 开发

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

## 📄 许可

MIT

---

Made with ❤️ by cygnus
