import * as vscode from 'vscode';
import { execFile } from 'node:child_process';

export interface ZhihuRecommendationItem {
  id: string;
  title: string;
  excerpt: string;
  detail: string;
  author: string;
  authorHeadline: string;
  url: string;
}

export interface ZhihuRecommendationPage {
  items: ZhihuRecommendationItem[];
  nextPage: number | null;
}

const RECOMMENDATION_API_URL =
  'https://www.zhihu.com/api/v3/feed/topstory/recommend';
const CACHE_TTL = 5 * 60 * 1000;

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
  const cookie = getZhihuCookie();

  if (!cookie) {
    throw new MissingCookieError();
  }

  const cached = pageCache.get(page);
  const now = Date.now();

  if (cached && now - cached.cachedAt < CACHE_TTL) {
    return cached.data;
  }

  const raw = await requestZhihuRecommendation(cookie, page);

  if (raw.error) {
    throw new Error(raw.error.message || '知乎接口返回了错误。');
  }

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
  pageCache.clear();
}

export function isMissingCookieError(error: unknown): error is MissingCookieError {
  return error instanceof MissingCookieError;
}

function getZhihuCookie() {
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
    id,
    title,
    excerpt,
    detail,
    author,
    authorHeadline,
    url
  };
}

function cleanText(value: string | undefined) {
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
        if (error) {
          reject(
            new Error(
              `知乎请求失败：${stderr || error.message}。如果你在公司网络或开了代理，也可能是网络环境拦截了该请求。`
            )
          );
          return;
        }

        try {
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
  };
}
