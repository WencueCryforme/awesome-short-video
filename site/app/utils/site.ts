/* 站点外观与内容相关的设计细节集中存放,便于整体替换 */
export const SITE = {
  title: 'awesome-short-video',
  subtitle: '个人短视频流',
  description: '个人版抖音式竖屏短视频流,上下滑动浏览,支持标签筛选与来源跳转',
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

export type SiteConfig = typeof SITE
