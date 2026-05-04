# Contributing to WeChatPost

感谢你对 WeChatPost 项目的关注！我们欢迎任何形式的贡献。

## Development Setup

1. Fork 并 clone 这个仓库
2. 安装依赖：`npm install`
3. 编译项目：`npm run compile`
4. 在 VSCode 中按 F5 启动扩展开发宿主

## Scripts

- `npm run compile` - 编译 TypeScript
- `npm run watch` - 监听文件变化并自动编译
- `npm run clean` - 清理构建产物
- `npm run rebuild` - 清理并重新编译
- `npm test` - 运行测试
- `npm run test:coverage` - 运行测试并生成覆盖率报告
- `npm run package` - 打包 VSIX

## Testing

- 单元测试使用 Jest
- E2E 测试使用 Playwright
- 请确保新代码有对应的测试覆盖

## Pull Request Guidelines

1. 确保 CI 检查通过
2. 更新相关文档（如果需要）
3. 添加测试覆盖新功能
4. 保持代码风格一致

## Release Process

1. 更新 CHANGELOG.md
2. 更新 package.json 中的版本号
3. 创建 git tag：`git tag -a vx.y.z -m "Release vx.y.z"`
4. 推送 tag：`git push origin vx.y.z`
5. GitHub Actions 会自动创建 release

## Code of Conduct

请保持友好和尊重的交流氛围。

## Questions

如有问题，欢迎提交 Issue！
