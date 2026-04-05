# Change Log

## 0.1.2 (2026-04-05)

- 📝 Add README.md
- 🏷️ Bump version to 0.1.2

## 0.1.1 (2026-04-05)

- 🐛 Fix: Command 'wechat-publisher.preview' not found error
  - Fixed mermaid module loading issue: mermaid was accessing browser globals at module load time in Node.js environment
  - Changed to lazy load mermaid with jsdom providing DOM environment
  - Added missing production dependencies: `node-fetch` and `form-data`
- 🏷️ Update publisher info to cygnus
- 🏷️ Bump version to 0.1.1

## 0.1.0 (2026-04-05)

- 🎉 Initial release
- MultiPost - WeChat Publisher VSCode extension
- Publish Markdown directly to WeChat Official Accounts
- Support Mermaid diagram rendering
- Support code highlighting
- WeChat preview panel
