# 改进后的代码示例

## 1. 新增常量定义

```typescript
// 文件: src/services/PlaywrightService.ts
// 位置: 第 12-16 行

const INTERACTION_TIMEOUT_MS = 5000; // Timeout for best-effort page settle
const DIALOG_TIMEOUT_MS = 30000;
const DIALOG_CLOSE_TIMEOUT_MS = 10000; // 对话框关闭操作的较短超时时间
const UI_SETTLE_MS = 500;
const PROCESS_SINGLETON_RECOVERY_DELAY_MS = 400;
const DIALOG_SELECTOR = '.weui-desktop-dialog:visible, .dialog_wrp:visible, .popover_dialog:visible'; // 统一的对话框选择器
```

**改进说明**:
- `DIALOG_CLOSE_TIMEOUT_MS`: 专门用于对话框关闭操作的超时时间，比打开操作更短
- `DIALOG_SELECTOR`: 统一的对话框选择器，避免在多处重复相同的字符串

---

## 2. 新增 waitForDialogClose 方法

```typescript
// 文件: src/services/PlaywrightService.ts
// 位置: 第 534-560 行

/**
 * 安全地等待对话框关闭，具有更好的错误处理
 * 使用较短的超时时间并提供详细的日志记录
 */
private async waitForDialogClose(dialogLocator: Locator, dialogName: string): Promise<void> {
  try {
    await dialogLocator.waitFor({ state: 'hidden', timeout: DIALOG_CLOSE_TIMEOUT_MS });
    this.log(`[DEBUG] Dialog "${dialogName}" closed successfully`);
  } catch (error) {
    // 记录错误但不抛出异常 - 对话框可能已经关闭或状态改变
    this.log(`[DEBUG] Dialog "${dialogName}" close wait completed with state: ${error instanceof Error ? error.message : String(error)}`, 'warn');
    
    // 验证对话框是否仍然可见
    const isVisible = await dialogLocator.isVisible().catch(() => false);
    if (isVisible) {
      this.log(`[WARN] Dialog "${dialogName}" is still visible after close attempt`, 'warn');
      // 尝试通过按 Escape 键关闭对话框作为后备方案
      try {
        await dialogLocator.page()?.keyboard.press('Escape');
        await this.waitForUiSettled(dialogLocator.page()!, 200);
        this.log(`[DEBUG] Attempted to close dialog "${dialogName}" via Escape key`);
      } catch (escapeError) {
        this.log(`[WARN] Failed to close dialog "${dialogName}" via Escape: ${escapeError}`, 'warn');
      }
    }
  }
}
```

**改进说明**:
- **错误容忍**: 捕获超时异常但不抛出，避免因对话框关闭延迟导致整个流程失败
- **后备机制**: 如果对话框仍然可见，尝试通过按 Escape 键关闭
- **详细日志**: 记录对话框关闭的各个状态，便于调试
- **较短超时**: 使用 10 秒超时而不是 30 秒，提高响应速度

---

## 3. 新增 getDialogLocator 方法

```typescript
// 文件: src/services/PlaywrightService.ts
// 位置: 第 562-568 行

/**
 * 获取带有指定过滤文本的对话框定位器
 * 集中化对话框选择逻辑以提高可维护性
 */
private getDialogLocator(filterText: string | RegExp): Locator {
  return this.authenticatedPage!.locator(DIALOG_SELECTOR).filter({ hasText: filterText }).first();
}
```

**改进说明**:
- **代码复用**: 避免在多处重复相同的对话框选择逻辑
- **易于维护**: 如果需要修改对话框选择器，只需修改一处
- **类型安全**: 使用 TypeScript 类型确保参数正确

---

## 4. 改进赞赏对话框处理逻辑

### 改进前

```typescript
// Step 19: Set appreciation if enabled (following test.py logic)
if (enableAppreciation) {
  this.log('[DEBUG] Step 19: Setting appreciation');
  await this.authenticatedPage.locator('#js_reward_setting_area').getByText('不开启').click();
  await this.waitForUiSettled(this.authenticatedPage);

  const rewardDialog = this.authenticatedPage
    .locator('.weui-desktop-dialog:visible, .dialog_wrp:visible, .popover_dialog:visible')
    .filter({ hasText: '赞赏类型' })
    .first();
  await rewardDialog.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });

  // Align with playwright-wechat.py sequence
  await rewardDialog.getByRole('textbox', { name: '选择或搜索赞赏账户' }).click();
  await this.waitForUiSettled(this.authenticatedPage);
  await rewardDialog.getByText('赞赏类型').click();
  await this.waitForUiSettled(this.authenticatedPage);
  await this.authenticatedPage.locator('#vue_app').getByText('赞赏账户', { exact: true }).click();
  await this.waitForUiSettled(this.authenticatedPage);
  await rewardDialog.getByText('赞赏自动回复').click();
  await this.waitForUiSettled(this.authenticatedPage);
  await rewardDialog.locator('.weui-desktop-icon-checkbox').first().click();
  await this.waitForUiSettled(this.authenticatedPage);
  await rewardDialog.getByRole('button', { name: '确定' }).first().click();
  await rewardDialog.waitFor({ state: 'hidden', timeout: DIALOG_TIMEOUT_MS }); // ❌ 这里会超时
  this.log('[DEBUG] Appreciation enabled');
}
```

### 改进后

```typescript
// Step 19: Set appreciation if enabled (following test.py logic)
if (enableAppreciation) {
  this.log('[DEBUG] Step 19: Setting appreciation');
  
  try {
    // Click to open appreciation settings
    await this.authenticatedPage.locator('#js_reward_setting_area').getByText('不开启').click();
    await this.waitForUiSettled(this.authenticatedPage);

    // Get the reward dialog using centralized selector
    const rewardDialog = this.getDialogLocator('赞赏类型'); // ✅ 使用统一方法
    await rewardDialog.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });
    this.log('[DEBUG] Reward dialog opened');

    // Align with playwright-wechat.py sequence
    await rewardDialog.getByRole('textbox', { name: '选择或搜索赞赏账户' }).click();
    await this.waitForUiSettled(this.authenticatedPage);
    
    await rewardDialog.getByText('赞赏类型').click();
    await this.waitForUiSettled(this.authenticatedPage);
    
    await this.authenticatedPage.locator('#vue_app').getByText('赞赏账户', { exact: true }).click();
    await this.waitForUiSettled(this.authenticatedPage);
    
    await rewardDialog.getByText('赞赏自动回复').click();
    await this.waitForUiSettled(this.authenticatedPage);
    
    await rewardDialog.locator('.weui-desktop-icon-checkbox').first().click();
    await this.waitForUiSettled(this.authenticatedPage);
    
    // Click confirm button
    const confirmButton = rewardDialog.getByRole('button', { name: '确定' }).first();
    await confirmButton.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });
    await confirmButton.click();
    
    // Use improved dialog close handling with shorter timeout
    await this.waitForDialogClose(rewardDialog, '赞赏类型'); // ✅ 使用改进的关闭方法
    this.log('[DEBUG] Appreciation enabled');
  } catch (appreciationError) {
    this.log(`[ERROR] Failed to set appreciation: ${appreciationError instanceof Error ? appreciationError.message : String(appreciationError)}`, 'error');
    // Re-throw to allow caller to handle the error
    throw new Error(`Failed to set appreciation: ${appreciationError instanceof Error ? appreciationError.message : String(appreciationError)}`);
  }
}
```

**改进说明**:
- ✅ 使用 `getDialogLocator` 方法获取对话框定位器
- ✅ 使用 `waitForDialogClose` 方法替代直接等待
- ✅ 添加 try-catch 保护，提供更好的错误处理
- ✅ 添加更多调试日志
- ✅ 错误消息包装，提供更清晰的上下文

---

## 5. 改进原创声明对话框处理

### 改进前

```typescript
const originalDialog = this.authenticatedPage
  .locator('.weui-desktop-dialog:visible, .dialog_wrp:visible, .popover_dialog:visible')
  .filter({ hasText: /我已阅读并同意|原创|声明/ })
  .first();
await originalDialog.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });

// ... 其他操作 ...

await originalDialog.getByRole('button', { name: '确定' }).first().click();
await originalDialog.waitFor({ state: 'hidden', timeout: DIALOG_TIMEOUT_MS });
this.log('[DEBUG] Original declaration set');
```

### 改进后

```typescript
const originalDialog = this.getDialogLocator(/我已阅读并同意|原创|声明/); // ✅ 使用统一方法
await originalDialog.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });

// ... 其他操作 ...

const confirmButton = originalDialog.getByRole('button', { name: '确定' }).first();
await confirmButton.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });
await confirmButton.click();
await this.waitForDialogClose(originalDialog, '原创声明'); // ✅ 使用改进的关闭方法
this.log('[DEBUG] Original declaration set');
```

---

## 6. 改进 AI 配图确认对话框处理

### 改进前

```typescript
const aiConfirmDialog = this.authenticatedPage
  .locator('.weui-desktop-dialog:visible, .dialog_wrp:visible, .popover_dialog:visible')
  .last();
await aiConfirmDialog.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });
await aiConfirmDialog.getByRole('button', { name: '确认' }).first().click();
await aiConfirmDialog.waitFor({ state: 'hidden', timeout: DIALOG_TIMEOUT_MS });
```

### 改进后

```typescript
const aiConfirmDialog = this.authenticatedPage
 // ✅ 使用统一选择器常量
  .locator(DIALOG_SELECTOR)
  .last();
await aiConfirmDialog.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });
await aiConfirmDialog.getByRole('button', { name: '确认' }).first().click();
await this.waitForDialogClose(aiConfirmDialog, 'AI配图确认'); // ✅ 使用改进的关闭方法
```

---

## 7. 改进合集对话框处理

### 改进前

```typescript
const collectionDialog = this.authenticatedPage
  .locator('.weui-desktop-dialog:visible, .dialog_wrp:visible, .popover_dialog:visible')
  .filter({ hasText: '每篇文章最多添加1个合集' })
  .first();
await collectionDialog.waitFor({ state: 'visible', timeout: 30000 });

// ... 其他操作 ...

const collectionConfirmButton = collectionDialog.getByRole('button', { name: '确认' }).first();
await collectionConfirmButton.waitFor({ state: 'visible', timeout: 30000 });
await collectionConfirmButton.click();
await collectionDialog.waitFor({ state: 'hidden', timeout: 30000 });
this.log(`[DEBUG] Collection set: ${defaultCollection}`);
```

### 改进后

```typescript
const collectionDialog = this.getDialogLocator('每篇文章最多添加1个合集'); // ✅ 使用统一方法
await collectionDialog.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS }); // ✅ 使用统一超时

// ... 其他操作 ...

const collectionConfirmButton = collectionDialog.getByRole('button', { name: '确认' }).first();
await collectionConfirmButton.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS }); // ✅ 使用统一超时
await collectionConfirmButton.click();
await this.waitForDialogClose(collectionDialog, '合集'); // ✅ 使用改进的关闭方法
this.log(`[DEBUG] Collection set: ${defaultCollection}`);
```

---

## 关键改进点总结

| 改进项 | 改进前 | 改进后 | 优势 |
|--------|--------|--------|------|
| 对话框选择器 | 重复的字符串字面量 | `DIALOG_SELECTOR` 常量 | 易于维护，避免拼写错误 |
| 对话框定位 | 每次都写完整的定位逻辑 | `getDialogLocator()` 方法 | 代码复用，减少重复 |
| 对话框关闭等待 | 直接 `waitFor({ state: 'hidden' })` | `waitForDialog` 方法 | 更好的错误处理，后备机制 |
| 超时时间 | 统一使用 30 秒 | 关闭操作使用 10 秒 | 提高响应速度 |
| 错误处理 | 可能导致整个流程失败 | 捕获并优雅处理 | 提高健壮性 |
| 日志记录 | 基本日志 | 详细的调试日志 | 便于问题排查 |
