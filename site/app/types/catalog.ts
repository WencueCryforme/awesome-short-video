export interface CatalogEntry {
  title: string
  desc: string
  filename: string
  source: string
  source_id?: string
  tags: string[]
}

export interface CatalogManifest {
  desc: string
  filesize: string
  tags: string
  blank: CatalogEntry
  total: CatalogEntry[]
}
