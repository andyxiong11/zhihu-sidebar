import * as vscode from 'vscode';
import {
  clearZhihuRecommendationCache,
  getZhihuRecommendationPage,
  isMissingCookieError
} from './zhihuService';

export class ZhihuViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private nextPage: number | null = 1;
  private isLoading = false;

  public resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;

    view.webview.options = {
      enableScripts: true
    };

    view.webview.html = this.getHtml();

    view.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!this.isValidMessage(message)) {
        return;
      }

      if (message.type === 'ready' || message.type === 'refresh') {
        await this.refresh();
      }

      if (message.type === 'loadMore') {
        await this.loadMore();
      }

      if (message.type === 'openSettings') {
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'zhihuSidebar.cookie'
        );
      }
    });
  }

  public async refresh() {
    clearZhihuRecommendationCache();
    this.nextPage = 1;
    await this.loadPage(true);
  }

  private async loadMore() {
    if (this.nextPage === null) {
      this.postMessage({
        type: 'loadingState',
        payload: {
          isLoading: false,
          hasMore: false
        }
      });
      return;
    }

    await this.loadPage(false);
  }

  private async loadPage(replace: boolean) {
    if (!this.view || this.isLoading || this.nextPage === null) {
      return;
    }

    this.isLoading = true;
    this.postMessage({
      type: 'loadingState',
      payload: {
        isLoading: true,
        hasMore: true
      }
    });

    try {
      const pageToLoad = replace ? 1 : this.nextPage;

      if (pageToLoad === null) {
        return;
      }

      const page = await getZhihuRecommendationPage(pageToLoad);
      this.nextPage = page.nextPage;

      this.postMessage({
        type: 'data',
        payload: {
          items: page.items,
          replace,
          hasMore: this.nextPage !== null
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';

      if (isMissingCookieError(error)) {
        this.postMessage({
          type: 'missingCookie',
          payload: message
        });
        return;
      }

      this.postMessage({
        type: 'error',
        payload: message
      });
    } finally {
      this.isLoading = false;
      this.postMessage({
        type: 'loadingState',
        payload: {
          isLoading: false,
          hasMore: this.nextPage !== null
        }
      });
    }
  }

  private postMessage(message: unknown) {
    this.view?.webview.postMessage(message);
  }

  private isValidMessage(
    message: unknown
  ): message is
    | { type: 'ready' | 'refresh' | 'loadMore' }
    | { type: 'openSettings' } {
    if (!message || typeof message !== 'object') {
      return false;
    }

    const candidate = message as { type?: unknown };

    return (
      candidate.type === 'ready' ||
      candidate.type === 'refresh' ||
      candidate.type === 'loadMore' ||
      candidate.type === 'openSettings'
    );
  }

  private getHtml() {
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
        z-index: 1;
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

      .button-link {
        background: transparent;
        border: none;
        color: var(--vscode-textLink-foreground);
        padding: 0;
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
        opacity: 0.85;
        margin-bottom: 8px;
        line-height: 1.6;
      }

      .item-author {
        font-size: 12px;
        opacity: 0.75;
        margin-bottom: 8px;
      }

      .item-detail {
        display: none;
        margin-top: 8px;
        padding: 10px;
        border-radius: 6px;
        background: var(--vscode-textBlockQuote-background);
        font-size: 12px;
        line-height: 1.7;
        white-space: pre-wrap;
      }

      .item-detail.is-expanded {
        display: block;
      }

      .item-actions {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .empty {
        padding: 16px 12px;
        font-size: 12px;
        opacity: 0.8;
      }

      .footer {
        padding: 12px;
        text-align: center;
        font-size: 12px;
        opacity: 0.8;
      }
    </style>
  </head>
  <body>
    <div class="toolbar">
      <div class="title">知乎推荐</div>
      <button id="refreshButton" class="button">刷新</button>
    </div>
    <div id="app" class="empty">加载中...</div>
    <div id="footer" class="footer" hidden>向下滚动以加载更多</div>

    <script>
      const vscode = acquireVsCodeApi();
      const app = document.getElementById('app');
      const footer = document.getElementById('footer');
      const refreshButton = document.getElementById('refreshButton');

      const state = {
        items: [],
        isLoading: false,
        hasMore: true
      };

      function escapeHtml(text) {
        return String(text)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }

      function truncate(text, maxLength) {
        if (text.length <= maxLength) {
          return text;
        }

        return text.slice(0, maxLength) + '...';
      }

      function renderList() {
        if (!Array.isArray(state.items) || state.items.length === 0) {
          app.className = 'empty';
          app.textContent = state.isLoading ? '加载中...' : '当前没有可展示的知乎内容。';
          footer.hidden = true;
          return;
        }

        app.className = 'list';
        app.innerHTML = state.items.map((item, index) => {
          const title = escapeHtml(item.title);
          const excerpt = escapeHtml(truncate(item.excerpt || '', 120));
          const detail = escapeHtml(item.detail || item.excerpt || '');
          const author = escapeHtml(item.author || '未知作者');
          const authorHeadline = escapeHtml(item.authorHeadline || '');
          const detailId = 'detail-' + index;

          return \`
            <div class="item">
              <div class="item-title">\${index + 1}. \${title}</div>
              <div class="item-author">\${author}\${authorHeadline ? ' · ' + authorHeadline : ''}</div>
              <div class="item-meta">\${excerpt}</div>
              <div class="item-actions">
                <button class="button toggle-button" data-detail-id="\${detailId}">展开</button>
              </div>
              <div class="item-detail" id="\${detailId}">\${detail}</div>
            </div>
          \`;
        }).join('');

        bindToggleButtons();
        footer.hidden = false;
        footer.textContent = state.isLoading
          ? '正在加载更多...'
          : state.hasMore
            ? '向下滚动以加载更多'
            : '已经到底了';
      }

      function bindToggleButtons() {
        document.querySelectorAll('.toggle-button').forEach((button) => {
          button.addEventListener('click', () => {
            const detailId = button.getAttribute('data-detail-id');

            if (!detailId) {
              return;
            }

            const detail = document.getElementById(detailId);

            if (!detail) {
              return;
            }

            const expanded = detail.classList.toggle('is-expanded');
            button.textContent = expanded ? '收起' : '展开';
          });
        });
      }

      function renderMissingCookie(message) {
        app.className = 'empty';
        app.innerHTML = \`
          <div style="line-height:1.7;">
            <div style="margin-bottom:8px;">\${escapeHtml(message)}</div>
            <button id="openSettingsButton" class="button">打开设置填写 Cookie</button>
          </div>
        \`;
        footer.hidden = true;

        const openSettingsButton = document.getElementById('openSettingsButton');
        openSettingsButton?.addEventListener('click', () => {
          vscode.postMessage({ type: 'openSettings' });
        });
      }

      function mergeItems(existingItems, incomingItems) {
        const map = new Map();

        existingItems.concat(incomingItems).forEach((item) => {
          map.set(item.id, item);
        });

        return Array.from(map.values());
      }

      function maybeLoadMore() {
        const scrollBottom = window.scrollY + window.innerHeight;
        const threshold = document.body.scrollHeight - 160;

        if (scrollBottom < threshold) {
          return;
        }

        if (state.isLoading || !state.hasMore) {
          return;
        }

        state.isLoading = true;
        renderList();
        vscode.postMessage({ type: 'loadMore' });
      }

      window.addEventListener('message', (event) => {
        const message = event.data;

        if (message.type === 'data') {
          const payload = message.payload || {};
          const incomingItems = Array.isArray(payload.items) ? payload.items : [];

          state.items = payload.replace
            ? incomingItems
            : mergeItems(state.items, incomingItems);
          state.hasMore = Boolean(payload.hasMore);
          renderList();
        }

        if (message.type === 'loadingState') {
          state.isLoading = Boolean(message.payload?.isLoading);
          state.hasMore = Boolean(message.payload?.hasMore);
          renderList();
        }

        if (message.type === 'missingCookie') {
          renderMissingCookie(message.payload);
        }

        if (message.type === 'error') {
          app.className = 'empty';
          app.textContent = '加载失败：' + message.payload;
          footer.hidden = true;
        }
      });

      refreshButton.addEventListener('click', () => {
        state.items = [];
        state.isLoading = true;
        state.hasMore = true;
        renderList();
        vscode.postMessage({ type: 'refresh' });
      });

      window.addEventListener('scroll', maybeLoadMore, { passive: true });
      vscode.postMessage({ type: 'ready' });
    </script>
  </body>
</html>`;
  }
}
