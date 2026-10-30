export interface CatalogEntry {
  title: string
  desc: string
  filename: string
  source: string
  source_id?: string
  tags: string[]
  /* 由脚本按条目内容生成的标识,分享链接与首屏定位使用 */
  hash_id?: string
}

export interface CatalogManifest {
  desc: string
  filesize: string
  tags: string
  blank: CatalogEntry
  total: CatalogEntry[]
}
