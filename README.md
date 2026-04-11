[中文版本 (Chinese Version)](README.zh-CN.md)

# MultiPost - WeChat Publisher

VS Code extension - One-click publish Markdown files to WeChat Official Accounts, supporting automatic Mermaid diagram rendering and upload, and Chrome CDP fully automated login + publishing.

## Features

- ✅ Full Markdown / GFM support
- ✅ Automatic Mermaid diagram rendering and upload
- ✅ Code highlighting (highlight.js)
- ✅ Default WeChat style theme
- ✅ Mobile QR code login (no developer资质/AppID required)
- ✅ One-click publish to official account draft box
- ✅ Automatic upload of all images to WeChat CDN
- ✅ VSCode secure storage for authentication information

## Installation

Install from VSIX:

1. Download `multipost-<version>.vsix` file
2. Open VSCode Extensions panel (Cmd+Shift+X / Ctrl+Shift+X)
3. Click the top-right `...` menu
4. Select **"Install from VSIX..."**
5. Select the `.vsix` file and restart VSCode

## Usage

All commands are prefixed with `MultiPost: ` in the command palette.

### Method 1: CDP Fully Automated (Recommended)

1. Open a `.md` Markdown file
2. Open Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
3. Type `CDP Fully Automated Upload` and execute
4. If not logged in: Chrome will open automatically, scan QR code to login, save credentials, and upload
5. If already logged in: Directly create draft in browser
6. Mermaid diagrams are automatically rendered to images and uploaded to WeChat CDN

### Method 2: Manual Cookie Mode

1. **Input Cookie (Manual Login)** - Manually enter cookie copied from browser
2. **Upload to WeChat Official Accounts** - Upload current Markdown to WeChat official account draft

### Other Commands

- **Preview MultiPost Format** - Preview converted WeChat HTML format in sidebar
- **Logout MultiPost** - Clear saved login credentials

### Preview WeChat Format

1. Open a `.md` Markdown file
2. Open Command Palette, type `Preview MultiPost Format`
3. A preview window will open showing the WeChat official account format

## Configuration

Search for `wechatPublisher` in VSCode settings:

- `wechatPublisher.defaultAuthor` - Default author name (used when publishing)
- `wechatPublisher.autoOpenDraftAfterPublish` - Whether to automatically open draft page after successful publishing (default: true)

## Notes

- This plugin uses cookie authentication from WeChat Official Accounts web interface, no developer资质 required
- Mermaid diagrams are rendered as PNG images and uploaded to WeChat CDN
- All external images are automatically uploaded to WeChat CDN
- Authentication information is securely stored in VSCode secret storage, never stored in plain text

## Development

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

## License

MIT

---

[中文版本 (Chinese Version)](README.zh-CN.md)
