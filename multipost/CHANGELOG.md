# Change Log

## 0.1.5 (2026-04-05)

- 🐛 Fix: command not found when invoking command before opening markdown file
- VS Code automatically activates extension when any command is invoked from command palette
- 👍 canvas with all native libraries included in VSIX for macOS
- 🏷️ Bump version to 0.1.5

## 0.1.4 (2026-04-05)

- ✅ Add complete test coverage
- 🧪 Added tests for all modules: WeChatService, PreviewService, SettingsService, all utilities
- 📊 Achieve 82.65% overall test coverage (meets ≥ 80% requirement)
- ♻️ Refactored: extracted `processMarkdown` functions from extension.ts to standalone `processMarkdown.ts` for better testability
- ✨ All 43 tests pass
- 🏷️ Bump version to 0.1.4

## 0.1.3 (2026-04-05)

- 🐛 Fix: missing dependencies in VSIX package
- 📦 Fixed .vscodeignore to include node_modules dependencies
- ⬆️ Upgrade canvas to v3.2.3 to resolve peer dependency conflict with jsdom
- 🏷️ Bump version to 0.1.3

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
