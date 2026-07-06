export interface ZhihuHotItem {
  title: string;
  excerpt: string;
  url: string;
}

import * as vscode from 'vscode';
import { execFile } from 'node:child_process';

const RECOMMENDATION_API_URL =
  'https://www.zhihu.com/api/v3/feed/topstory/recommend?desktop=true&page_number=1';
const CACHE_TTL = 5 * 60 * 1000;

let cachedItems: ZhihuHotItem[] | undefined;
let cachedAt = 0;

export class MissingCookieError extends Error {
  constructor() {
    super('还没有配置知乎 Cookie。');
    this.name = 'MissingCookieError';
  }
}

export async function getZhihuHotList(): Promise<ZhihuHotItem[]> {
  const cookie = getZhihuCookie();

  if (!cookie) {
    throw new MissingCookieError();
  }

  const now = Date.now();

  // 简单缓存，避免你每次点开面板都重复打一次知乎接口。
  if (cachedItems && now - cachedAt < CACHE_TTL) {
    return cachedItems;
  }

  const raw = await requestZhihuRecommendation(cookie);

  if (raw.error) {
    throw new Error(raw.error.message || '知乎接口返回了错误。');
  }

  const items = (raw.data || [])
    .map(mapRecommendationItem)
    .filter((item): item is ZhihuHotItem => item !== null);

  cachedItems = items;
  cachedAt = now;

  return items;
}

export function isMissingCookieError(error: unknown): error is MissingCookieError {
  return error instanceof MissingCookieError;
}

function getZhihuCookie() {
  const value = vscode.workspace
    .getConfiguration('zhihuSidebar')
    .get<string>('cookie', '')
    .trim();

  return value;
}

function mapRecommendationItem(item: ZhihuRecommendationDataItem): ZhihuHotItem | null {
  const target = item.target;

  if (!target) {
    return null;
  }

  const title = target.title?.trim() || target.question?.title?.trim();

  if (!title) {
    return null;
  }

  const excerpt =
    target.excerpt?.trim() ||
    target.question?.excerpt?.trim() ||
    target.author?.headline?.trim() ||
    '知乎推荐内容';

  const urlFromTarget = target.url?.trim() || target.question?.url?.trim();
  const url =
    urlFromTarget ||
    (target.question?.id
      ? `https://www.zhihu.com/question/${target.question.id}`
      : '');

  if (!url) {
    return null;
  }

  return {
    title,
    excerpt,
    url
  };
}

function requestZhihuRecommendation(cookie: string): Promise<ZhihuRecommendationResponse> {
  return new Promise((resolve, reject) => {
    // 这里不用 Node 自己发 HTTPS，而是复用系统 curl。
    // 原因是你本机 curl 已经能连通知乎，但扩展宿主里的 Node TLS 握手失败。
    // 这样改动最小，也最贴近你当前机器的真实网络环境。
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
        RECOMMENDATION_API_URL
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
  error?: {
    code?: number;
    name?: string;
    message?: string;
  };
}

interface ZhihuRecommendationDataItem {
  target?: {
    title?: string;
    excerpt?: string;
    url?: string;
    author?: {
      headline?: string;
    };
    question?: {
      id?: number | string;
      title?: string;
      excerpt?: string;
      url?: string;
    };
  };
}
