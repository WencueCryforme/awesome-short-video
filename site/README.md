# site

基于 Nuxt 的纯前端静态站点,用于展示 `video/manifest.json` 记录的短视频

## 环境

- Node.js
- npm

## 本地开发

```
npm install
npm run dev
```

## 构建

```
npm run generate
```

静态产物位于 `.output/public`,包含站点页面与入库视频目录

## 部署基路径

站点默认部署在根路径,部署到 GitHub Pages 项目页时通过环境变量指定仓库子路径

```
NUXT_APP_BASE_URL=/<仓库名>/ npm run generate
```

## 数据来源

- 清单与标签预选项在构建期读取,站点不回写源文件
- 过大的视频目录不进入构建产物
- 标记为过大文件的条目只展示来源跳转,不加载视频
