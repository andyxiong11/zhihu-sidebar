import * as vscode from 'vscode';
import { ZhihuViewProvider } from './ZhihuViewProvider';

export function activate(context: vscode.ExtensionContext) {
  // 这是插件真正的入口函数。
  // 当 VSCode 认为这个插件需要被激活时，就会先执行这里。
  //
  // 你可以先把它理解成：
  // 1. 创建一个“知乎面板控制器”
  // 2. 把这个控制器注册给 VSCode
  // 3. 再注册几个按钮/命令，供面板或命令面板调用
  const provider = new ZhihuViewProvider();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('zhihuSidebar.view', provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zhihuSidebar.refresh', async () => {
      // 这个命令的作用很简单：告诉面板重新拉取数据。
      await provider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zhihuSidebar.openSettings', async () => {
      // 这里直接跳到 VSCode 设置页，并把搜索词定位到我们的 cookie 配置项。
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'zhihuSidebar.cookie'
      );
    })
  );
}

export function deactivate() {
  // 有些插件会在这里关闭定时器、断开连接、释放文件句柄。
  // 我们这个项目目前没有这类资源，所以可以保持为空。
}
