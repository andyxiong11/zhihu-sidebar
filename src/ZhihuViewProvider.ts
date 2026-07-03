import * as vscode from 'vscode';
import { getZhihuHotList } from './zhihuService';

export class ZhihuViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor() {}

  public resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;

    view.webview.options = {
      enableScripts: true
    };

    view.webview.html = this.getHtml();

    view.webview.onDidReceiveMessage(async (message: unknown) => {
      // Webview 发消息给扩展宿主时，会进入这里。
      // 这是 VSCode 插件里最常见的通信方式之一。
      if (!this.isValidMessage(message)) {
        return;
      }

      if (message.type === 'ready' || message.type === 'refresh') {
        await this.loadData();
      }

      if (message.type === 'open') {
        await vscode.env.openExternal(vscode.Uri.parse(message.url));
      }
    });
  }

  public async refresh() {
    await this.loadData();
  }

  private async loadData() {
    if (!this.view) {
      return;
    }

    try {
      const list = await getZhihuHotList();
      this.view.webview.postMessage({
        type: 'data',
        payload: list
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';

      this.view.webview.postMessage({
        type: 'error',
        payload: message
      });
    }
  }

  private isValidMessage(
    message: unknown
  ): message is
    | { type: 'ready' | 'refresh' }
    | { type: 'open'; url: string } {
    if (!message || typeof message !== 'object') {
      return false;
    }

    const candidate = message as { type?: unknown; url?: unknown };

    if (candidate.type === 'ready' || candidate.type === 'refresh') {
      return true;
    }

    return candidate.type === 'open' && typeof candidate.url === 'string';
  }

  private getHtml() {
    // 这里直接返回一段 HTML。
    // 对新手来说，这样最容易理解：扩展负责准备页面，页面自己负责展示数据。
    return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      body {
        padding: 0;
        margin: 0;
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        font-family: var(--vscode-font-family);
      }

      .toolbar {
        position: sticky;
        top: 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 12px;
        border-bottom: 1px solid var(--vscode-panel-border);
        background: var(--vscode-editor-background);
      }

      .title {
        font-size: 13px;
        font-weight: 600;
      }

      .button {
        border: 1px solid var(--vscode-button-border, transparent);
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border-radius: 4px;
        padding: 4px 10px;
        cursor: pointer;
      }

      .button:hover {
        background: var(--vscode-button-hoverBackground);
      }

      .list {
        padding: 8px 12px 16px;
      }

      .item {
        padding: 12px 0;
        border-bottom: 1px solid var(--vscode-panel-border);
      }

      .item-title {
        font-size: 13px;
        font-weight: 600;
        line-height: 1.5;
        margin-bottom: 6px;
      }

      .item-meta {
        font-size: 12px;
        opacity: 0.8;
        margin-bottom: 8px;
      }

      .empty {
        padding: 16px 12px;
        font-size: 12px;
        opacity: 0.8;
      }
    </style>
  </head>
  <body>
    <div class="toolbar">
      <div class="title">知乎热榜</div>
      <button id="refreshButton" class="button">刷新</button>
    </div>
    <div id="app" class="empty">加载中...</div>

    <script>
      const vscode = acquireVsCodeApi();
      const app = document.getElementById('app');
      const refreshButton = document.getElementById('refreshButton');

      function escapeHtml(text) {
        return String(text)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }

      function renderList(items) {
        if (!Array.isArray(items) || items.length === 0) {
          app.className = 'empty';
          app.innerHTML = '当前没有可展示的知乎内容。';
          return;
        }

        app.className = 'list';
        app.innerHTML = items.map((item, index) => {
          const title = escapeHtml(item.title);
          const excerpt = escapeHtml(item.excerpt || '');
          const url = escapeHtml(item.url);

          return \`
            <div class="item">
              <div class="item-title">\${index + 1}. \${title}</div>
              <div class="item-meta">\${excerpt}</div>
              <button class="button open-button" data-url="\${url}">打开知乎</button>
            </div>
          \`;
        }).join('');

        document.querySelectorAll('.open-button').forEach((button) => {
          button.addEventListener('click', () => {
            const url = button.getAttribute('data-url');

            if (!url) {
              return;
            }

            vscode.postMessage({
              type: 'open',
              url
            });
          });
        });
      }

      window.addEventListener('message', (event) => {
        const message = event.data;

        if (message.type === 'data') {
          renderList(message.payload);
        }

        if (message.type === 'error') {
          app.className = 'empty';
          app.textContent = '加载失败：' + message.payload;
        }
      });

      refreshButton.addEventListener('click', () => {
        app.className = 'empty';
        app.textContent = '刷新中...';
        vscode.postMessage({ type: 'refresh' });
      });

      // Webview 初始化完成后，主动通知扩展去加载数据。
      vscode.postMessage({ type: 'ready' });
    </script>
  </body>
</html>`;
  }
}
