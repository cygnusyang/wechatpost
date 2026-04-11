# Change Log

## 1.0.0 (2026-04-11)

- 🎉 **Major Release**: Persistent login state with Playwright user data directory
- ✨ **Feature**: Login state now persists across VSCode restarts - no need to scan QR code every time
- 🔧 **Improve**: Browser session saved to `~/.multipost/playwright-user-data`
- 🔧 **Improve**: Added `hasSavedLogin()` and `restoreLogin()` methods for session management
- 🔧 **Improve**: Better UI interaction helpers with `clickAndStabilize()` and `waitForUiSettled()`
- 🔧 **Improve**: Replaced `networkidle` waits with `domcontentloaded` for faster execution
- 🔧 **Improve**: Enhanced Mermaid rendering diagram support
- 🔧 **Improve**: Simplified original declaration and appreciation handling
- 🐛 **Fix**: Better collection selection with fallback to first option
- 🧹 **Cleanup**: Removed unused files and simplified codebase

## 0.5.8 (2026-04-11)

- 🐛 Fix: Original declaration logic - added "原创" and "文字原创" clicks, and original agreement popup handling
- 🐛 Fix: Appreciation settings - updated to match test.py flow with complete appreciation account setup
- 🐛 Fix: Article collection logic - added "每篇文章最多添加1个合集" confirmation step
- 🐛 Fix: Publish flow - added group notification and scheduled publish options handling
- 🔧 Improve: PlaywrightService - aligned all automation steps with test.py reference implementation

## 0.5.7 (2026-04-06)

- 🐛 Fix: Article content field filling - improved selector strategy to match WeChat Official Accounts' new interface
- 🐛 Fix: Author field filling - updated to use the same strategy as Python reference script
- 🐛 Fix: Mermaid renderer - added null check for API response to handle network errors gracefully
- 🚀 Improve: Content filling method - added support for ProseMirror editor and enhanced robustness

## 0.5.6 (2026-04-06)

- 🎉 Major refactor: **Remove CDP mode and use Playwright as default**
- 🐛 Fix: Playwright navigation timeout - increased timeout to 60 seconds and optimized navigation flow
- 🔧 Improve: Draft creation - directly navigate to editor URL instead of menu navigation
- 🔧 Update: Command palette - removed CDP command, renamed Playwright command to "Upload to WeChat Official Accounts"
- 📦 Remove: Puppeteer dependency (no longer needed for CDP mode)
- 🧪 Test: Updated all tests to reflect Playwright implementation
- 🏷️ Bump version to 0.5.6

## 0.5.5 (2026-04-06)

- 🐛 Fix: Unified output channels - WeChatService now uses "MultiPost" channel instead of separate "MultiPost WeChat"
- 🔧 Improve: Login detection - added URL token check and debug logging for better troubleshooting
- 🏷️ Bump version to 0.5.5

## 0.5.4 (2026-04-06)

- 🐛 Fix: CDP launch - removed call to missing `launchBrowser` helper, directly use Puppeteer launch
- 🏷️ Bump version to 0.5.4

## 0.5.3 (2026-04-06)

- 🐛 Fix: CDP cookie order - navigate to domain before setting cookies (fixes "All cookies failed")
- ♻️ Refactor: keep only one upload command, remove duplicate command entry
- ♻️ Refactor: remove manual cookie login, always use CDP protocol for uploads
- 🏷️ Bump version to 0.5.3

## 0.5.2 (2026-04-06)

- 🐛 Fix: invalid cookie fields in CDP - save full CookieParam objects with required fields
- ✅ Add filtering + per-cookie error handling for invalid cookie entries
- 🔁 Backward compatibility for older cookie formats stored in Secret Storage
- 🧪 Test fixes for WeChatService and CDP cookie handling
- 🏷️ Bump version to 0.5.2

## 0.5.1 (2026-04-05)

- ✨ **Complete CDP-based workflow**: Both login AND publish now happen in Chrome via CDP automation
- 🔄 **Auto cookie injection**: If you've logged in before, saved cookies are automatically injected into Chrome - you don't need to scan QR code every time!
- 🤖 **Fully browser-based automation**: Chrome stays open after login, publishing is done automatically in the browser
- 👍 Still keeps **Manual Cookie Input** with API upload as alternative option
- 🔒 Credentials are still saved securely in VSCode Secret Storage

## 0.4.0 (2026-04-05)

- 🧹 Cleanup: **Remove broken webview login** - the old webview-based automatic login couldn't display QR code correctly because WeChat blocks embedding in iframes, so it's removed now
- 👉 **Default to Chrome CDP Fully Automated Login** - The primary login method is now fully automatic via Puppeteer/CDP
- 👍 Still keeps **Manual Cookie Input** as fallback option for advanced users
- 🎯 Simplified command menu - fewer options, clearer workflow

## 0.3.0 (2026-04-05)

- ✨ New Feature: **Chrome CDP (Puppeteer) Fully Automated Login** - Add third login method that automatically launches Chrome browser, lets you scan QR code, and extracts cookies automatically. This solves the QR code display issue in VSCode webview (WeChat blocks QR in iframes).
- 🔒 Uses Chrome DevTools Protocol via Puppeteer for reliable browser automation
- 🤖 Fully automatic - just run the command, scan QR, done! No manual cookie copying needed
- 👉 New command: `Login WeChat via Chrome CDP (Fully Automated)` in command palette
- 👍 Backward compatible - existing webview login and manual cookie input still work

## 0.2.4 (2026-04-05)

- 🐛 Fix: **Draft creation reports failure when actually succeeded** - incorrect success checking logic. WeChat API returns `base_resp.ret = 0` for success (not `err_msg = "ok"`), so add proper success condition check.

## 0.2.3 (2026-04-05)

- 🐛 Fix: **Stuck in "Activating" forever** - `.vscodeignore` was excluding all `node_modules` except `canvas`, causing `Cannot find module 'node-fetch'` error on activation. Now includes all production dependencies in VSIX.
- 🐛 Fix: QR code not showing in webview - added `<base href="https://mp.weixin.qq.com/">` to fix relative resource paths (images, CSS, JS)
- ✨ Already had **Manual Cookie Input** command for when QR code doesn't show in webview - added to command palette so users can find it
- 🐛 Fix: "parameter error (200002)" when creating draft - added missing required parameter `count=1` which WeChat API requires

## 0.2.2 (2026-04-05)

- 🐛 Fix: `invalid session` error when creating draft - token extraction failed because Node.js request doesn't share browser session
- ✨ Add **Automatic Login**: now `Login WeChat Official Accounts` opens VSCode Webview directly, you scan QR and login completes automatically (no manual cookie copy needed!)
- ✨ Add **Manual Cookie Input** command as fallback
- 🔐 This guarantees the plugin uses the same authenticated session as your browser
- 🔧 Improve token extraction: added two more regex patterns to handle newer WeChat MP pages
- 🐛 Fix: `参数错误 (200002)` when creating draft - moved `f=json` to URL query params to match WeChat API expectations

## 0.2.0 (2026-04-05)

- ✨ Add extension icon (WeChat green theme with document + upload arrow)
- 🎨 Icon in SVG format available, convert to PNG for VSCode Marketplace
- 🏷️ Bump version to 0.2.0 (new feature → bump minor version)

## 0.1.13 (2026-04-05)

- 🐛 Fix: compile error after regex refactoring - variable names mismatch
- ✅ Further improve regex robustness - 6 different patterns for token extraction
- 📖 Add version information to README
- 🏷️ Bump version to 0.1.13

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
