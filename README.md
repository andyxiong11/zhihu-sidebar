# Zhihu Sidebar

这是一个最小可运行的 VSCode 插件示例。

## 功能

- 在 VSCode 底部显示一个 `Zhihu` 面板
- 面板里展示知乎热榜的示例数据
- 点击条目后用浏览器打开知乎页面
- 支持手动刷新

## 运行步骤

1. 安装依赖：`npm install`
2. 编译：`npm run build`
3. 用 VSCode 打开这个目录
4. 按 `F5` 启动扩展开发宿主
5. 在新窗口底部找到 `Zhihu` 面板

## 说明

当前版本已经支持通过 Cookie 拉取你自己的知乎推荐流。

## 如何配置个人推荐

1. 打开 VSCode 设置
2. 搜索 `zhihuSidebar.cookie`
3. 在已登录知乎的浏览器里打开开发者工具
4. 找到发往 `zhihu.com` 的请求
5. 复制其中完整的 `Cookie` 请求头
6. 粘贴到插件设置里

如果 Cookie 失效，面板会提示重新配置。
