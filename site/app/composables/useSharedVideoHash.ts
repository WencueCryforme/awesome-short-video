import { VIDEO_QUERY_PARAM } from '~/const'

/*
  分享链接的视频标识在模块求值时快照一次,
  快照早于页面组件初始化与地址栏清理,组件实例重建后仍能取到
*/
function readShareHashId() {
  if (!import.meta.client) {
    return ''
  }
  const value = new URLSearchParams(window.location.search).get(VIDEO_QUERY_PARAM)
  return (value ?? '').trim()
}

/*
  标识只在当前页面会话内保存,不写入本地存储;
  刻意不使用 useState,避免预渲染状态序列化出的默认值覆盖地址栏快照;
  服务端恒为空且从不写入,不存在跨请求共享问题
*/
const shareHashId = ref(readShareHashId())

/* 分享进来的视频标识,由首页视频流定位使用,消费后由重排动作清空 */
export function useSharedVideoHash() {
  return shareHashId
}
