import * as vscode from 'vscode';
import { ZhihuViewProvider } from './ZhihuViewProvider';

export function activate(context: vscode.ExtensionContext) {
  // 这里创建我们自己的视图提供者。
  // 它负责把“底部知乎面板”真正渲染出来。
  const provider = new ZhihuViewProvider();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('zhihuSidebar.view', provider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zhihuSidebar.refresh', async () => {
      await provider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zhihuSidebar.openSettings', async () => {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'zhihuSidebar.cookie'
      );
    })
  );
}

export function deactivate() {
  // 这个最小示例里没有额外资源需要手动释放，所以留空即可。
}
