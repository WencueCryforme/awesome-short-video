export type TooLargeFlag = 'THE_FILE_SIZE_IS_TOO_LARGE'

export interface CatalogEntry {
  title: string
  desc: string
  filename: string
  source: string
  source_id?: string
  allow_iframe?: boolean
  default_mode?: 'onsite' | 'upstream'
  tags: string[]
  flag?: TooLargeFlag
}

export interface CatalogManifest {
  desc: string
  filepath: string
  filesize: string
  tags: string
  blank: CatalogEntry
  total: CatalogEntry[]
}
