export interface ZhihuHotItem {
  title: string;
  excerpt: string;
  url: string;
}

// 这里先用静态示例数据，确保插件结构能先跑起来。
// 等你后面想接入真实接口时，只需要改这个文件，不用动 Webview 结构。
const mockHotList: ZhihuHotItem[] = [
  {
    title: '为什么很多人喜欢在通勤路上刷知乎？',
    excerpt: '示例数据：你后面可以把这里替换成真实知乎内容。',
    url: 'https://www.zhihu.com/hot'
  },
  {
    title: '程序员第一次写 VSCode 插件，最小闭环应该怎么做？',
    excerpt: '建议先把“能显示内容”跑通，再逐步接入真实数据。',
    url: 'https://www.zhihu.com/hot'
  },
  {
    title: 'Webview、命令、视图注册各自负责什么？',
    excerpt: '这几个是 VSCode 扩展开发里最核心的基础概念。',
    url: 'https://www.zhihu.com/hot'
  }
];

export async function getZhihuHotList(): Promise<ZhihuHotItem[]> {
  // 用 Promise 包一层，是为了让它的调用形式和未来的真实异步请求保持一致。
  return Promise.resolve(mockHotList);
}
