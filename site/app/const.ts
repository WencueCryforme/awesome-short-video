/* 站点内容与可调参数集中存放,便于整体替换 */
export const SITE = {
  title: 'awesome-short-video',
  subtitle: '个人短视频流',
  description: '个人版抖音式竖屏短视频流,上下滑动浏览,支持话题与搜索',
  author: {
    name: 'WencueCryforme',
    url: 'https://github.com/WencueCryforme'
  },
  repositoryUrl: 'https://github.com/WencueCryforme/awesome-short-video',
  version: '26.10.18',
  /* 入库视频目录,相对站点基路径 */
  videoDir: 'video/file',
  /* 过大文件的条目标记,与清单约定一致 */
  tooLargeFlag: 'THE_FILE_SIZE_IS_TOO_LARGE',
  /* 版权年份 */
  copyrightYear: 2026,
  /* 主题偏好的本地存储键 */
  themeStorageKey: 'awesome-short-video-theme'
} as const

/* 默认主题 */
export const DEFAULT_THEME = 'light' as const

/* 视频封面预加载时间点 */
export const VIDEO_COVER_FRAGMENT = '#t=0.1'

/* 交互时间参数,单位毫秒 */
export const INTERACTION = {
  /* 首页标签双击判定窗口 */
  homeDoubleClickMs: 300,
  /* 话题标签双击判定窗口 */
  topicDoubleClickMs: 300,
  /* 视频区域双击判定窗口 */
  videoDoubleClickMs: 200,
  /* 视频暂停/继续后的点击冷却 */
  videoClickCooldownMs: 200
} as const

/* 通知气泡参数 */
export const TOAST = {
  /* 单条通知显示时长 */
  durationMs: 2000,
  /* 同时保留的最大条数 */
  maxCount: 1
} as const

/* 话题气泡布局参数 */
export const TOPIC_BUBBLE = {
  gap: 6,
  padding: 10,
  border: 1
} as const

/* 上游嵌入参数 */
export const EMBED = {
  douyinPlayerUrl: 'https://open.douyin.com/player/video',
  douyinAutoplay: '0'
} as const

export type SiteConfig = typeof SITE
