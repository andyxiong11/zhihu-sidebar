import * as vscode from 'vscode';
import { execFile } from 'node:child_process';

// 这个文件只负责一件事：和“知乎数据”打交道。
// 也就是说：
// - 去哪里请求
// - 请求完怎么转成我们自己的数据结构
// - 缓存怎么处理
// 都放在这里。
//
// 这样做好处是：后面你要自己接真实点赞/评论接口时，
// 基本只需要改这个文件，不需要同时去改 Webview UI。

export interface ZhihuRecommendationItem {
  // 这是我们“最终喂给前端页面”的一条推荐卡片结构。
  // 不一定和知乎原始接口长得一样。
  // 这里是我们整理后的“前端友好数据”。
  id: string;
  title: string;
  excerpt: string;
  detail: string;
  author: string;
  authorHeadline: string;
  url: string;
  voteupCount: number;
  commentCount: number;
  favorCount: number;
  canVote: boolean;
  canComment: boolean;
  comments: ZhihuCommentItem[];
  actionState: {
    liked: boolean;
    disliked: boolean;
    favored: boolean;
  };
}

export interface ZhihuCommentItem {
  // 评论区展示用的最小结构。
  id: string;
  author: string;
  content: string;
  voteCount: number;
  createdAtText: string;
}

export interface ZhihuRecommendationPage {
  items: ZhihuRecommendationItem[];
  nextPage: number | null;
}

const RECOMMENDATION_API_URL =
  'https://www.zhihu.com/api/v3/feed/topstory/recommend';
const CACHE_TTL = 5 * 60 * 1000;

// 分页缓存。
// key 是页码，value 是这一页的数据和缓存时间。
// 这样向下滚动加载更多时，不会反复请求同一页。
const pageCache = new Map<number, { data: ZhihuRecommendationPage; cachedAt: number }>();

export class MissingCookieError extends Error {
  constructor() {
    super('还没有配置知乎 Cookie。');
    this.name = 'MissingCookieError';
  }
}

export async function getZhihuRecommendationPage(
  page: number
): Promise<ZhihuRecommendationPage> {
  // 1. 先拿到你在 VSCode 设置里填写的知乎 Cookie
  const cookie = getZhihuCookie();

  if (!cookie) {
    throw new MissingCookieError();
  }

  // 2. 看这一页是不是已经缓存过，而且还没过期
  const cached = pageCache.get(page);
  const now = Date.now();

  if (cached && now - cached.cachedAt < CACHE_TTL) {
    return cached.data;
  }

  // 3. 真正发请求拿原始数据
  const raw = await requestZhihuRecommendation(cookie, page);

  if (raw.error) {
    throw new Error(raw.error.message || '知乎接口返回了错误。');
  }

  // 4. 把知乎原始结构整理成我们自己的前端结构
  const items = (raw.data || [])
    .map(mapRecommendationItem)
    .filter((item): item is ZhihuRecommendationItem => item !== null);

  const data = {
    items,
    nextPage: getNextPage(raw.paging, page, items.length)
  };

  pageCache.set(page, {
    data,
    cachedAt: now
  });

  return data;
}

export function clearZhihuRecommendationCache() {
  // 手动刷新时会调用这个方法，把旧分页缓存全部清掉。
  pageCache.clear();
}

export function isMissingCookieError(error: unknown): error is MissingCookieError {
  // 这个函数是一个 TypeScript 类型守卫。
  // 作用是：帮助调用方判断“当前错误是不是没配 Cookie 导致的”。
  return error instanceof MissingCookieError;
}

function getZhihuCookie() {
  // 从 VSCode 配置系统里读我们自己的配置项。
  return vscode.workspace
    .getConfiguration('zhihuSidebar')
    .get<string>('cookie', '')
    .trim();
}

function getNextPage(
  paging: ZhihuRecommendationResponse['paging'],
  currentPage: number,
  itemCount: number
) {
  // 这个函数的任务是算出“下一页页码”。
  //
  // 优先级：
  // 1. 如果接口明确说已经到底了，就返回 null
  // 2. 如果接口给了 next 链接，就从 next 链接里解析 page_number
  // 3. 如果接口没给，但这一页还有内容，就保守地猜下一页是 currentPage + 1
  if (paging?.is_end) {
    return null;
  }

  const nextUrl = paging?.next;

  if (!nextUrl) {
    return itemCount > 0 ? currentPage + 1 : null;
  }

  try {
    const url = new URL(nextUrl);
    const nextPage = url.searchParams.get('page_number');

    if (!nextPage) {
      return itemCount > 0 ? currentPage + 1 : null;
    }

    const parsed = Number(nextPage);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return itemCount > 0 ? currentPage + 1 : null;
  }
}

function mapRecommendationItem(
  item: ZhihuRecommendationDataItem
): ZhihuRecommendationItem | null {
  // 这里是“接口数据 -> 前端卡片数据”的核心转换逻辑。
  // 以后你自己接真实写接口、评论接口时，最值得重点看的就是这种“映射层”。
  const target = item.target;

  if (!target) {
    return null;
  }

  const title = target.title?.trim() || target.question?.title?.trim();

  if (!title) {
    return null;
  }

  const excerpt =
    cleanText(target.excerpt) ||
    cleanText(target.question?.excerpt) ||
    cleanText(target.author?.headline) ||
    '知乎推荐内容';

  const detail =
    cleanText(target.content) ||
    cleanText(target.excerpt) ||
    cleanText(target.question?.detail) ||
    cleanText(target.question?.excerpt) ||
    excerpt;

  const author = cleanText(target.author?.name) || '未知作者';
  const authorHeadline = cleanText(target.author?.headline) || '';

  const urlFromTarget = target.url?.trim() || target.question?.url?.trim();
  const url =
    urlFromTarget ||
    (target.question?.id
      ? `https://www.zhihu.com/question/${target.question.id}`
      : '');

  if (!url) {
    return null;
  }

  const id =
    String(target.id || item.id || url).trim();

  return {
    // 这里返回的是前端真正使用的统一结构。
    // 这样 Webview 不用关心知乎原始字段到底叫什么。
    id,
    title,
    excerpt,
    detail,
    author,
    authorHeadline,
    url,
    voteupCount: normalizeCount(target.voteup_count),
    commentCount: normalizeCount(target.comment_count),
    favorCount: normalizeCount(target.favlists_count),
    canVote: true,
    canComment: true,
    comments: buildMockComments(target),
    actionState: {
      liked: false,
      disliked: false,
      favored: false
    }
  };
}

function normalizeCount(value: number | string | undefined) {
  // 很多接口里的数字可能是 number，也可能是 string，甚至是 undefined。
  // 这里统一转成安全的 number。
  const count = Number(value);
  return Number.isFinite(count) ? count : 0;
}

function buildMockComments(target: ZhihuRecommendationDataItem['target']): ZhihuCommentItem[] {
  // 当前评论区先展示接口里可能带回来的 preview_comments。
  // 后面你接“真实评论列表接口”时，可以把这个函数替换掉。
  const comments = target?.preview_comments;

  if (!Array.isArray(comments) || comments.length === 0) {
    return [];
  }

  return comments
    .map((comment, index) => {
      const content = cleanText(comment.content);

      if (!content) {
        return null;
      }

      return {
        id: String(comment.id || index),
        author: cleanText(comment.author?.name) || '匿名用户',
        content,
        voteCount: normalizeCount(comment.vote_count),
        createdAtText: formatTimestamp(comment.created_time)
      };
    })
    .filter((comment): comment is ZhihuCommentItem => comment !== null);
}

function formatTimestamp(value: number | string | undefined) {
  // 把知乎接口里常见的 Unix 时间戳，转成更适合直接显示的文本。
  const timestamp = Number(value);

  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '刚刚';
  }

  const date = new Date(timestamp * 1000);

  if (Number.isNaN(date.getTime())) {
    return '刚刚';
  }

  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');

  return `${month}-${day} ${hour}:${minute}`;
}

function cleanText(value: string | undefined) {
  // 知乎接口里的部分字段可能带 HTML 或 HTML 实体。
  // 这里做一个最基础的“清洗文本”，方便直接塞进 Webview。
  if (!value) {
    return '';
  }

  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function requestZhihuRecommendation(
  cookie: string,
  page: number
): Promise<ZhihuRecommendationResponse> {
  return new Promise((resolve, reject) => {
    // 这里为什么不用 fetch，而是用 curl：
    // 之前我们已经遇到过 VSCode 扩展宿主里 TLS 握手失败的问题，
    // 但系统 curl 是能跑通的。
    // 所以这里是一个“优先能跑起来”的务实方案。
    execFile(
      'curl',
      [
        '-sS',
        '-L',
        '--max-redirs',
        '3',
        '-A',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        '-H',
        `Cookie: ${cookie}`,
        '-H',
        'Accept: application/json, text/plain, */*',
        '-H',
        'X-Requested-With: fetch',
        `${RECOMMENDATION_API_URL}?desktop=true&page_number=${page}`
      ],
      {
        maxBuffer: 1024 * 1024 * 3
      },
      (error, stdout, stderr) => {
        // stdout 是接口成功时的输出内容
        // stderr 是 curl 的错误输出
        if (error) {
          reject(
            new Error(
              `知乎请求失败：${stderr || error.message}。如果你在公司网络或开了代理，也可能是网络环境拦截了该请求。`
            )
          );
          return;
        }

        try {
          // 把 curl 输出的 JSON 文本转成 JS 对象。
          const raw = JSON.parse(stdout) as ZhihuRecommendationResponse;

          if (raw.error?.code === 101) {
            reject(new Error('知乎 Cookie 已失效或没有权限，请重新复制。'));
            return;
          }

          resolve(raw);
        } catch {
          reject(new Error('知乎返回的数据无法解析，请确认 Cookie 是否完整。'));
        }
      }
    );
  });
}

interface ZhihuRecommendationResponse {
  // 这是“知乎接口原始响应”的近似类型定义。
  // 注意：它不是完整的官方类型，只是当前项目用到哪些字段，就写哪些字段。
  data?: ZhihuRecommendationDataItem[];
  paging?: {
    next?: string;
    is_end?: boolean;
  };
  error?: {
    code?: number;
    name?: string;
    message?: string;
  };
}

interface ZhihuRecommendationDataItem {
  // 同样，这里描述的是“原始接口单项数据”的一部分。
  // 你以后自己加接口时，可以继续往这里补字段。
  id?: string | number;
  target?: {
    id?: string | number;
    title?: string;
    excerpt?: string;
    content?: string;
    url?: string;
    author?: {
      name?: string;
      headline?: string;
    };
    question?: {
      id?: number | string;
      title?: string;
      excerpt?: string;
      detail?: string;
      url?: string;
    };
    voteup_count?: number | string;
    comment_count?: number | string;
    favlists_count?: number | string;
    preview_comments?: Array<{
      id?: string | number;
      content?: string;
      created_time?: number | string;
      vote_count?: number | string;
      author?: {
        name?: string;
      };
    }>;
  };
}
