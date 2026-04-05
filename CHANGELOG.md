# Change Log

## 0.1.12 (2026-04-05)

- 🐛 Fix: failed to extract token after login - regex matched wrong position
- 🔧 Make token extraction more robust - try multiple regex patterns
- 📝 Increase HTML preview length for better debugging
- 🏷️ Bump version to 0.1.12

## 0.1.11 (2026-04-05)

- 🐛 Fix: WeChat login QR code fails to load - WeChat blocks page embedding in iframe
- 🔄 Changed login flow: open login page in external browser instead of iframe
- ✨ User scans QR in browser, then clicks "Confirm Login" in VSCode
- 🛡️ Add Content-Security-Policy to preview webview for improved security
- 🎯 Improve path resolution for webview assets
- 🏷️ Bump version to 0.1.11

## 0.1.10 (2026-04-05)

- 🐛 Fix: ESM compatibility issue - node-fetch@3 is ESM-only, incompatible with VSCode extension CommonJS
- Downgraded to node-fetch@2 which supports CommonJS
- This should fix the "Error: require() of ES Module" failure during activation
- 🏷️ Bump version to 0.1.10

## 0.1.9 (2026-04-05)

- 🐛 Fix: `Cannot find module 'node-fetch'` - add missing runtime dependencies to dependencies
- `node-fetch` and `form-data` are required at runtime, must be in `dependencies` not `devDependencies`
- 🏷️ Bump version to 0.1.9

## 0.1.8 (2026-04-05)

- 🐛 Fix: Ensure all commands are available from command palette without open Markdown file
- 🚀 Add explicit onCommand activation events for all four commands
- 🔍 Already has comprehensive debug logging for easier troubleshooting
- 🏷️ Bump version to 0.1.8

## 0.1.7 (2026-04-05)

- 🔍 Add comprehensive debug logging throughout the extension
- 🛠️ Improved error tracing for activation and command execution
- All activation steps logged to MultiPost output channel
- 🏷️ Bump version to 0.1.7

## 0.1.6 (2026-04-05)

- 🔧 Ensure error messages show on activation failure
- 🐛 Fix: ensure activation completes even if canvas fails to load
- 🏷️ Bump version to 0.1.6

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
