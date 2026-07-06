import * as vscode from 'vscode';
import {
  clearZhihuRecommendationCache,
  getZhihuRecommendationPage,
  isMissingCookieError
} from './zhihuService';

// 这个类负责“底部知乎面板”的整套行为。
// 你可以把它理解成：
// - 上半部分：和 VSCode 打交道
// - 下半部分：生成 Webview 页面
// - 中间部分：在“页面消息”和“数据请求”之间做桥接
export class ZhihuViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private nextPage: number | null = 1;
  private isLoading = false;

  public resolveWebviewView(view: vscode.WebviewView) {
    // 当 VSCode 真正要显示这个视图时，会调用这个方法。
    // 这时我们才拿到了真正的 webview 实例。
    this.view = view;

    view.webview.options = {
      // Webview 里的按钮点击、滚动监听、postMessage 都依赖脚本执行。
      enableScripts: true
    };

    // 把整张页面的 HTML 一次性塞进去。
    view.webview.html = this.getHtml();

    view.webview.onDidReceiveMessage(async (message: unknown) => {
      // Webview 里的前端脚本可以通过 vscode.postMessage(...) 往这里发消息。
      // 这里就是“前端 -> 扩展宿主”的入口。
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
    // 手动刷新时，先清空缓存，再从第一页重新加载。
    clearZhihuRecommendationCache();
    this.nextPage = 1;
    await this.loadPage(true);
  }

  private async loadMore() {
    // 这个方法只负责“加载下一页”。
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
    // replace=true  表示“整页替换”，通常用于首次加载或手动刷新
    // replace=false 表示“往后追加”，通常用于滚动到底部加载更多
    if (!this.view || this.isLoading || this.nextPage === null) {
      return;
    }

    // 用一个简单布尔值，避免重复请求同一页或并发翻页。
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

      // 把数据再发回 Webview，让前端去渲染。
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
        // 缺 Cookie 是一个“可引导修复”的特殊错误，所以单独发一种消息类型。
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
    // 统一包一下 postMessage，后面要改发送逻辑时更方便。
    this.view?.webview.postMessage(message);
  }

  private isValidMessage(
    message: unknown
  ): message is
    | { type: 'ready' | 'refresh' | 'loadMore' }
    | { type: 'openSettings' } {
    // 这里也是一个类型守卫。
    // 作用是：保证只有我们认识的消息类型，才会进入后续逻辑。
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
    // 这里返回的是整个 Webview 页面的 HTML。
    // 因为这个项目还很小，把 HTML / CSS / JS 放在一起会更容易学习。
    // 如果以后页面变复杂，再考虑拆文件。
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
        border-radius: 999px;
        padding: 4px 10px;
        cursor: pointer;
      }

      .button:hover {
        background: var(--vscode-button-hoverBackground);
      }

      .button-muted {
        border: 1px solid var(--vscode-panel-border);
        background: transparent;
        color: var(--vscode-foreground);
      }

      .button-active {
        background: #0f88eb;
        color: #fff;
        border-color: #0f88eb;
      }

      .list {
        padding: 8px 12px 16px;
      }

      .item {
        padding: 14px 0;
        border-bottom: 1px solid var(--vscode-panel-border);
      }

      .item-title {
        font-size: 14px;
        font-weight: 700;
        line-height: 1.55;
        margin-bottom: 8px;
      }

      .item-meta {
        font-size: 12px;
        opacity: 0.9;
        margin-bottom: 10px;
        line-height: 1.75;
      }

      .item-author {
        font-size: 12px;
        opacity: 0.75;
        margin-bottom: 8px;
      }

      .item-detail {
        display: none;
        margin-top: 10px;
        padding-top: 8px;
        font-size: 12px;
        line-height: 1.8;
        white-space: pre-wrap;
      }

      .item-detail.is-expanded {
        display: block;
      }

      .item-actions {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
      }

      .action-link {
        border: none;
        background: transparent;
        color: var(--vscode-descriptionForeground);
        padding: 4px 0;
        cursor: pointer;
      }

      .action-link:hover {
        color: var(--vscode-textLink-foreground);
      }

      .comments {
        display: none;
        margin-top: 10px;
        border-top: 1px solid var(--vscode-panel-border);
        padding-top: 10px;
      }

      .comments.is-expanded {
        display: block;
      }

      .comment-item {
        padding: 10px 0;
        border-bottom: 1px solid var(--vscode-panel-border);
      }

      .comment-author {
        font-size: 12px;
        font-weight: 600;
        margin-bottom: 4px;
      }

      .comment-content {
        font-size: 12px;
        line-height: 1.7;
        margin-bottom: 6px;
      }

      .comment-meta {
        font-size: 11px;
        opacity: 0.75;
      }

      .comment-empty {
        font-size: 12px;
        opacity: 0.8;
        padding: 6px 0;
      }

      .pending-tip {
        margin-top: 8px;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
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

      // 这是 Webview 自己维护的本地状态。
      // 你可以把它理解成一个非常轻量的“前端 store”。
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

      function formatCount(count) {
        const value = Number(count || 0);

        if (value >= 10000) {
          return (value / 10000).toFixed(value >= 100000 ? 0 : 1) + '万';
        }

        return String(value);
      }

      function renderList() {
        // renderList 是这个页面最核心的渲染函数。
        // 每次状态变化后，我们都会重新拼接整段 HTML。
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
          const commentsId = 'comments-' + index;
          const comments = Array.isArray(item.comments) ? item.comments : [];
          const commentsHtml = comments.length > 0
            ? comments.map((comment) => {
                return (
                  '<div class="comment-item">' +
                    '<div class="comment-author">' + escapeHtml(comment.author) + '</div>' +
                    '<div class="comment-content">' + escapeHtml(comment.content) + '</div>' +
                    '<div class="comment-meta">' +
                      escapeHtml(comment.createdAtText) + ' · 赞同 ' + formatCount(comment.voteCount) +
                    '</div>' +
                  '</div>'
                );
              }).join('')
            : '<div class="comment-empty">当前接口没有返回评论预览，后续接入真实评论接口后这里会显示完整评论列表。</div>';

          return \`
            <div class="item" data-item-id="\${escapeHtml(item.id)}">
              <div class="item-title">\${index + 1}. \${title}</div>
              <div class="item-author">\${author}\${authorHeadline ? ' · ' + authorHeadline : ''}</div>
              <div class="item-meta">\${excerpt}</div>
              <div class="item-actions">
                <button
                  class="button \${item.actionState?.liked ? 'button-active' : ''}"
                  data-action="like"
                  data-item-id="\${escapeHtml(item.id)}"
                >
                  赞同 \${formatCount(item.voteupCount)}
                </button>
                <button
                  class="button button-muted \${item.actionState?.disliked ? 'button-active' : ''}"
                  data-action="dislike"
                  data-item-id="\${escapeHtml(item.id)}"
                >
                  反对
                </button>
                <button
                  class="button button-muted \${item.actionState?.favored ? 'button-active' : ''}"
                  data-action="favor"
                  data-item-id="\${escapeHtml(item.id)}"
                >
                  喜欢 \${formatCount(item.favorCount)}
                </button>
                <button
                  class="action-link"
                  data-action="toggle-comments"
                  data-item-id="\${escapeHtml(item.id)}"
                  data-comments-id="\${commentsId}"
                >
                  \${formatCount(item.commentCount)} 条评论
                </button>
                <button
                  class="action-link"
                  data-action="toggle-detail"
                  data-detail-id="\${detailId}"
                >
                  展开
                </button>
              </div>
              <div class="item-detail" id="\${detailId}">\${detail}</div>
              <div class="comments" id="\${commentsId}">
                \${commentsHtml}
                <div class="pending-tip">当前赞同 / 反对 / 喜欢 / 评论展开是本地交互版，等你抓到真实接口后我再帮你接成真正写回知乎。</div>
              </div>
            </div>
          \`;
        }).join('');

        bindItemButtons();
        footer.hidden = false;
        footer.textContent = state.isLoading
          ? '正在加载更多...'
          : state.hasMore
            ? '向下滚动以加载更多'
            : '已经到底了';
      }

      function bindItemButtons() {
        // 因为上面是用 innerHTML 整段重渲染出来的，
        // 所以每次 render 后都要重新绑定按钮事件。
        document.querySelectorAll('[data-action="toggle-detail"]').forEach((button) => {
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

        document.querySelectorAll('[data-action="toggle-comments"]').forEach((button) => {
          button.addEventListener('click', () => {
            const commentsId = button.getAttribute('data-comments-id');

            if (!commentsId) {
              return;
            }

            const comments = document.getElementById(commentsId);

            if (!comments) {
              return;
            }

            const expanded = comments.classList.toggle('is-expanded');
            button.textContent = expanded ? '收起评论' : getCommentLabel(button.getAttribute('data-item-id'));
          });
        });

        document.querySelectorAll('[data-action="like"]').forEach((button) => {
          button.addEventListener('click', () => {
            updateActionState(button.getAttribute('data-item-id'), 'like');
          });
        });

        document.querySelectorAll('[data-action="dislike"]').forEach((button) => {
          button.addEventListener('click', () => {
            updateActionState(button.getAttribute('data-item-id'), 'dislike');
          });
        });

        document.querySelectorAll('[data-action="favor"]').forEach((button) => {
          button.addEventListener('click', () => {
            updateActionState(button.getAttribute('data-item-id'), 'favor');
          });
        });
      }

      function updateActionState(itemId, actionType) {
        // 这里是“本地交互版”的赞同 / 反对 / 喜欢状态修改逻辑。
        // 现在先只改前端状态，不写回知乎接口。
        // 你以后接真实接口时，可以把“先请求后更新”或者“先乐观更新后回滚”放在这里。
        if (!itemId) {
          return;
        }

        state.items = state.items.map((item) => {
          if (item.id !== itemId) {
            return item;
          }

          const nextItem = {
            ...item,
            actionState: {
              ...item.actionState
            }
          };

          if (actionType === 'like') {
            const nextLiked = !nextItem.actionState.liked;
            nextItem.actionState.liked = nextLiked;

            if (nextLiked && nextItem.actionState.disliked) {
              nextItem.actionState.disliked = false;
            }

            nextItem.voteupCount += nextLiked ? 1 : -1;
          }

          if (actionType === 'dislike') {
            const nextDisliked = !nextItem.actionState.disliked;
            nextItem.actionState.disliked = nextDisliked;

            if (nextDisliked && nextItem.actionState.liked) {
              nextItem.actionState.liked = false;
              nextItem.voteupCount = Math.max(0, nextItem.voteupCount - 1);
            }
          }

          if (actionType === 'favor') {
            const nextFavored = !nextItem.actionState.favored;
            nextItem.actionState.favored = nextFavored;
            nextItem.favorCount += nextFavored ? 1 : -1;
          }

          nextItem.voteupCount = Math.max(0, nextItem.voteupCount);
          nextItem.favorCount = Math.max(0, nextItem.favorCount);

          return nextItem;
        });

        renderList();
      }

      function getCommentLabel(itemId) {
        const item = state.items.find((entry) => entry.id === itemId);
        return item ? \`\${formatCount(item.commentCount)} 条评论\` : '评论';
      }

      function renderMissingCookie(message) {
        // 当扩展宿主告诉我们“没配 Cookie”时，直接渲染一个引导页。
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
        // 滚动加载下一页时，接口有可能出现重复项。
        // 这里按 id 去重，避免同一条内容重复显示。
        const map = new Map();

        existingItems.concat(incomingItems).forEach((item) => {
          map.set(item.id, item);
        });

        return Array.from(map.values());
      }

      function maybeLoadMore() {
        // 这是最简单的“触底加载更多”实现：
        // 当滚动条接近页面底部时，告诉扩展宿主去加载下一页。
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
        // 这里接收的是“扩展宿主 -> Webview”的消息。
        // 也就是说，和上面的 onDidReceiveMessage 正好是反方向。
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
        // 刷新时，先把前端状态重置成“正在加载”，再通知扩展宿主重新请求第一页。
        state.items = [];
        state.isLoading = true;
        state.hasMore = true;
        renderList();
        vscode.postMessage({ type: 'refresh' });
      });

      window.addEventListener('scroll', maybeLoadMore, { passive: true });

      // 页面第一次准备好后，主动发一个 ready 消息。
      // 扩展宿主收到后，就会真正开始加载第一页数据。
      vscode.postMessage({ type: 'ready' });
    </script>
  </body>
</html>`;
  }
}
