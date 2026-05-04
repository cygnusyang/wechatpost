[中文版本 (Chinese Version)](README.zh-CN.md)

<div align="center">
  <br />
  <img src="https://raw.githubusercontent.com/cygnusyang/wechatpost/main/media/icon.png" alt="WeChatPost Logo" width="128" height="128">
  <h1 style="border-bottom: none;">🚀 WeChatPost - WeChat Publisher</h1>
  <p style="font-size: 1.2em;">One-click publish Markdown directly to WeChat Official Accounts from VSCode</p>
</div>

## ✨ Features

- ✅ **Full Markdown / GFM Support** - Complete Markdown and GitHub Flavored Markdown support
- ✅ **Mermaid Diagram Rendering** - Automatic rendering and upload of Mermaid diagrams
- ✅ **Code Highlighting** - Beautiful syntax highlighting using highlight.js
- ✅ **Content Style Customization** - Theme presets (classic, magazine, minimal) with customizable colors and fonts
- ✅ **Persistent Login State** - Login session persists across VSCode restarts, no need to scan QR every time
- ✅ **QR Code Login** - Mobile QR code login (no developer资质/AppID required)
- ✅ **One-Click Publish** - Direct publish to official account draft box
- ✅ **Image Upload** - Automatic upload of all images to WeChat CDN
- ✅ **Secure Storage** - Authentication information stored safely in VSCode keychain

## 📦 Installation

### From VSIX File

1. Download `wechatpost-<version>.vsix` file
2. Open VSCode Extensions panel (Cmd+Shift+X / Ctrl+Shift+X)
3. Click the top-right `...` menu
4. Select **"Install from VSIX..."**
5. Select the `.vsix` file and restart VSCode

## 🚀 Usage

All commands are prefixed with `WeChatPost: ` in the command palette.

### Method 1: Playwright Automated (Recommended)

1. Open a `.md` Markdown file
2. Open Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
3. Type `WeChatPost: Publish Current Markdown to WeChat` and execute
4. **If not logged in**: Chrome will open automatically, scan QR code to login, save credentials, and upload
5. **If already logged in**: Directly create draft in browser (login state persists across restarts)
6. Mermaid diagrams are automatically rendered to images and uploaded to WeChat CDN

### Method 2: Manual Cookie Mode

1. **Input Cookie (Manual Login)** - Manually enter cookie copied from browser
2. **WeChatPost: Publish Current Markdown to WeChat** - Upload current Markdown to WeChat official account draft

### Other Commands

- **WeChatPost: Configure Publishing Options** - Configure default author, original declaration, appreciation, collection, and content style
- **WeChatPost: Preview WeChat Article Layout** - Preview converted WeChat HTML format in sidebar
- **WeChatPost: Sign Out of WeChat Session** - Clear saved login credentials

### Preview WeChat Format

1. Open a `.md` Markdown file
2. Open Command Palette, type `WeChatPost: Preview WeChat Article Layout`
3. A preview window will open showing the WeChat official account format

## ⚙️ Configuration

Search for `wechatPublisher` in VSCode settings or use `WeChatPost: Configure Publishing Options` command:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `wechatPublisher.defaultAuthor` | `string` | `""` | Default author name used when creating a WeChat draft |
| `wechatPublisher.digestLength` | `number` | `120` | Digest length extracted from markdown content |
| `wechatPublisher.declareOriginal` | `boolean` | `true` | Enable original declaration by default |
| `wechatPublisher.enableAppreciation` | `boolean` | `true` | Enable appreciation by default |
| `wechatPublisher.defaultCollection` | `string` | `"智能体"` | Default collection name used in WeChat |
| `wechatPublisher.publishDirectly` | `boolean` | `true` | Publish directly by default; disable to save as draft |
| `wechatPublisher.contentThemePreset` | `string` | `"classic"` | Content theme preset: classic, magazine, or minimal |
| `wechatPublisher.contentBodyFontSize` | `number` | `16` | Body font size in pixels (12-22) |
| `wechatPublisher.contentLineHeight` | `number` | `1.85` | Body line height (1.2-2.4) |
| `wechatPublisher.contentTextColor` | `string` | `"#1f2329"` | Body text color in HEX format |
| `wechatPublisher.contentHeadingColor` | `string` | `"#0f172a"` | Heading text color in HEX format |
| `wechatPublisher.contentLinkColor` | `string` | `"#0969da"` | Link and emphasis color in HEX format |

## 📝 Notes

- This plugin uses cookie authentication from WeChat Official Accounts web interface, no developer资质 required
- Mermaid diagrams are rendered as PNG images and uploaded to WeChat CDN
- All external images are automatically uploaded to WeChat CDN
- Authentication information is securely stored in VSCode secret storage, never stored in plain text

## 🛠️ Development

```bash
# Install dependencies
npm install

# Compile backend
npm run compile

# Compile frontend preview
npm run build:webview

# Full repackage
npm run vscode:prepublish

# Package VSIX
npx vsce package
```

## 📄 License

MIT

---

Made with ❤️ by cygnus
