# 单元测试指南

## 概述

这个文档描述了如何为MultiPost工程编写和运行单元测试。我们已经建立了一个结构化的测试目录，使测试组织更加清晰。

## 目录结构

```
src/
├── services/           # 业务逻辑服务
├── utils/             # 工具函数
├── interfaces/        # TypeScript接口
└── test/              # 测试文件
    ├── __mocks__/     # Jest模拟模块
    ├── helpers/       # 测试辅助函数
    │   └── test-utils.ts
    └── unit/          # 单元测试
        ├── extension.test.ts
        ├── services/  # 服务层测试
        │   ├── PreviewService.test.ts
        │   ├── SettingsService.test.ts
        │   ├── WeChatService.test.ts
        │   └── defaultTheme.test.ts
        └── utils/     # 工具函数测试
            ├── extractTitle.test.ts
            ├── mermaidRenderer.test.ts
            └── processMarkdown.test.ts
```

## 运行测试

### 基本命令

```bash
# 运行所有测试
npm test

# 运行测试并生成覆盖率报告
npm run test:coverage

# 监视模式（开发时使用）
npm test -- --watch
```

### 运行特定测试

```bash
# 运行单个测试文件
npm test -- --testPathPattern=extractTitle

# 运行服务层测试
npm test -- --testPathPattern=services

# 运行工具函数测试
npm test -- --testPathPattern=utils
```

## 编写新测试

### 1. 选择测试位置

根据测试的类型，将测试文件放在适当的目录：

- **服务层测试**: `src/test/unit/services/`
- **工具函数测试**: `src/test/unit/utils/`
- **扩展测试**: `src/test/unit/`

### 2. 命名约定

- 测试文件: `[组件名].test.ts`
- 测试套件: `describe('[组件名]', () => { ... })`
- 测试用例: `it('应该做某事', () => { ... })`

### 3. 导入模块

使用绝对路径导入模块：

```typescript
// 正确
import { MyService } from 'src/services/MyService';
import { myUtil } from 'src/utils/myUtil';

// 错误（不要使用相对路径）
import { MyService } from '../../services/MyService';
```

### 4. 使用测试工具

`src/test/helpers/test-utils.ts` 提供了有用的测试辅助函数：

```typescript
import { 
  createMockVSCode, 
  createMockResponse, 
  createMockFileContent 
} from './helpers/test-utils';

// 创建模拟的VSCode API
const mockVSCode = createMockVSCode({
  showErrorMessage: jest.fn(),
  showInformationMessage: jest.fn(),
});

// 创建模拟的HTTP响应
const mockResponse = createMockResponse({ success: true }, 200);

// 创建模拟的文件内容
const mockFile = createMockFileContent('# Test Title\n\nContent');
```

### 5. 示例测试

```typescript
import { MyService } from 'src/services/MyService';
import { createMockVSCode } from 'src/test/helpers/test-utils';

describe('MyService', () => {
  let service: MyService;
  let mockVSCode: any;

  beforeEach(() => {
    mockVSCode = createMockVSCode();
    service = new MyService(mockVSCode);
  });

  it('应该成功初始化', () => {
    expect(service).toBeDefined();
  });

  it('应该正确处理数据', async () => {
    const result = await service.processData('test');
    expect(result).toBe('processed: test');
  });
});
```

## 测试覆盖率

项目配置了80%的覆盖率要求：

- 分支覆盖率: 80%
- 函数覆盖率: 80%
- 行覆盖率: 80%
- 语句覆盖率: 80%

运行覆盖率报告：

```bash
npm run test:coverage
```

报告会生成在 `coverage/` 目录中。

## 模拟策略

### 1. VSCode API

所有VSCode API都应该被模拟。使用 `createMockVSCode()` 函数创建一致的模拟环境。

### 2. HTTP请求

使用Jest模拟 `node-fetch` 模块。检查 `src/test/__mocks__/node-fetch.ts` 作为示例。

### 3. 外部依赖

在 `src/test/__mocks__/` 目录中为外部依赖创建模拟。

## 最佳实践

1. **保持测试独立**: 每个测试应该能够独立运行
2. **使用描述性名称**: 测试名称应该清晰描述测试的内容
3. **测试行为, 而不是实现**: 测试组件做了什么，而不是如何做
4. **避免测试私有方法**: 只测试公共API
5. **清理资源**: 在 `afterEach` 或 `afterAll` 中清理测试资源

## 故障排除

### 常见问题

1. **模块找不到错误**
   - 确保使用 `src/` 前缀导入模块
   - 检查 `tsconfig.test.json` 中的路径映射

2. **模拟不工作**
   - 检查 `src/test/__mocks__/` 目录中的模拟文件
   - 确保在测试文件中正确设置了jest.mock()

3. **覆盖率不足**
   - 运行 `npm run test:coverage` 查看未覆盖的代码
   - 确保测试所有分支和边界情况

## 开发工作流

1. 编写代码
2. 运行相关测试: `npm test -- --testPathPattern=[组件名]`
3. 修复任何失败的测试
4. 运行所有测试确保没有破坏其他功能
5. 运行覆盖率检查: `npm run test:coverage`
6. 提交代码