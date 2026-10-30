/* 站点内容与可调参数集中存放,便于整体替换 */
export const SITE = {
  title: 'awesome-short-video',
  subtitle: '精选短视频',
  description: '个人精选收藏短视频在线浏览',
  author: {
    name: 'WencueCryforme',
    url: 'https://github.com/WencueCryforme'
  },
  repositoryUrl: 'https://github.com/WencueCryforme/awesome-short-video',
  version: '26.10.30',
  /* 视频文件的对象存储基地址,所有入库视频统一存放于此,已自带结尾斜杠 */
  video_oss_base_url: 'https://wencuecryforme-awesome-short-video.uxiyu.xyz/file/',
  /* 封面图片的站点内目录与后缀,封面文件名为视频文件名加后缀,随构建产物一起发布,目录已自带结尾斜杠 */
  video_cover_dir: 'cover/',
  video_cover_extension: '.jpg',
  /* 版权年份 */
  copyrightYear: 2026,
  /* 主题偏好的本地存储键 */
  themeStorageKey: 'awesome-short-video-theme',
  /* 静音偏好的本地存储键 */
  mutedStorageKey: 'awesome-short-video-muted'
} as const

/* 默认主题 */
export const DEFAULT_THEME = 'light' as const

/* 话题 URL 参数 */
export const TOPIC_QUERY_PARAM = 'topic'
export const TOPIC_QUERY_SEPARATOR = '_'

/* 视频分享 URL 参数,取值为条目的 hash_id */
export const VIDEO_QUERY_PARAM = 'video'

/* 交互时间参数,单位毫秒 */
export const INTERACTION = {
  /* 首页标签双击判定窗口 */
  homeDoubleClickMs: 300,
  /* 话题标签双击判定窗口 */
  topicDoubleClickMs: 300,
  /* 视频区域双击判定窗口 */
  videoDoubleClickMs: 200,
  /* 视频暂停/继续后的点击冷却 */
  videoClickCooldownMs: 200,
  /* 视频首帧出现后封面延后隐藏的时长,避免视频与封面同时淡入淡出时透出黑底 */
  coverHideDelayMs: 200
} as const

/* 视频标题轮播参数 */
export const TITLE_MARQUEE = {
  startPauseMs: 1000,
  endPauseMs: 1000,
  speedPxPerSecond: 50,
  minScrollMs: 2000
} as const

/* 视频流到底提示 */
export const FEED_END_MESSAGE = '已经到底啦~'
export const FEED_END_TOAST_COOLDOWN_MS = 500

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
