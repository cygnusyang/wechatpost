# 安装使用说明

## 安装方法

### 方法 1：从 VSIX 文件安装（推荐）

扩展已经打包好了：`wechatpost-1.0.0.vsix`

1. 打开 VSCode
2. 打开扩展面板（Ctrl+Shift+X 或 Cmd+Shift+X）
3. 点击右上角 `...` 菜单
4. 选择 **"从 VSIX 安装..."**
5. 选择文件：`wechatpost-1.0.0.vsix`
6. 重启 VSCode 生效

### 方法 2：开发模式运行

如果你想修改代码，可以在开发模式运行：

```bash
cd WeChatPost
npm install
npm run compile
# 按 F5 启动扩展开发窗口
```

## 使用方法

所有命令都以 `WeChatPost: ` 前缀显示在命令面板中。

### 1. CDP 全自动推荐（推荐）

**WeChatPost: Publish Current Markdown to WeChat**

1. 打开 `.md` Markdown 文件
2. 打开命令面板（`Cmd+Shift+P` / `Ctrl+Shift+P`）
3. 输入 `WeChatPost: Publish Current Markdown to WeChat` 执行
4. 如果未登录：会自动打开 Chrome，扫码登录后自动保存凭据并上传
5. 如果已登录：直接在浏览器中创建草稿
6. Mermaid 图表会自动渲染为图片并上传到微信 CDN

### 2. 手动 Cookie 模式

1. **Input Cookie (Manual Login)** - 手动输入从浏览器复制的 Cookie
2. **WeChatPost: Publish Current Markdown to WeChat** - 上传当前 Markdown 到微信公众号草稿

### 3. 预览微信格式

1. 打开一个 `.md` Markdown 文件
2. 打开命令面板，输入 `WeChatPost: Preview WeChat Article Layout`
3. 会在侧边打开预览窗口，显示微信公众号格式的预览

### 4. 发布到微信公众号

在预览窗口点击 **"Upload to WeChat"** 按钮，或者：

1. 打开命令面板
2. 输入 `WeChatPost: Publish Current Markdown to WeChat`
3. 等待上传完成
4. 上传成功后会自动打开微信公众号草稿页面，你可以在那里编辑和发布

### 5. 退出登录

打开命令面板，输入 `WeChatPost: Sign Out of WeChat Session`

## 功能特性

- ✅ 完整支持 Markdown / GFM
- ✅ 支持 Mermaid 图表自动渲染上传
- ✅ 代码高亮（highlight.js）
- ✅ 默认微信样式主题
- ✅ 手机扫码登录（不需要开发者资质/AppID）
- ✅ 一键发布到公众号草稿箱
- ✅ 自动上传所有图片到微信 CDN
- ✅ VSCode 安全存储认证信息

## 配置

可以在 VSCode 设置中搜索 `wechatPublisher` 进行配置：

- `wechatPublisher.defaultAuthor` - 默认作者名（发布时使用）
- `wechatPublisher.autoOpenDraftAfterPublish` - 发布成功后是否自动打开草稿页面（默认：true）

## 注意事项

- 本插件使用网页版公众号后台的 Cookie 认证方式，不需要公众号开发者资质
- Mermaid 图表会被渲染为 PNG 图片上传到微信 CDN
- 所有外部图片都会自动上传到微信 CDN
- 认证信息安全保存在 VSCode 密钥存储中，不会明文存储

## 项目结构

```
WeChatPost/
├── src/                    # VSCode 扩展后端 (TypeScript)
│   ├── extension.ts        # 入口文件
│   ├── interfaces/         # 接口定义
│   ├── services/           # 业务服务
│   └── utils/              # 工具函数
├── webview-src/            # 预览界面 (React + TypeScript)
│   ├── src/
│   │   ├── components/     # React 组件
│   │   ├── hooks/          # React Hooks
│   │   ├── plugins/        # unified 插件 (remark/rehype)
│   │   └── themes/         # 主题样式
│   └── vite.config.ts      # Vite 配置
├── media/                  # 构建输出
└── wechatpost-1.0.0.vsix    # 安装包
```

## 开发

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
