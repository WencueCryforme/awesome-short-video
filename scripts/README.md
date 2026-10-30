# scripts 辅助脚本

> 本目录存放由 Agent 撰写并维护的辅助脚本,用于补充 Agent 工具能力的不足,以及供 GitHub Actions 工作流调用。

## 目录结构

```
scripts/
├── gui/
│   └── add-video-reaction/         # 新增条目页面的静态资源
│       ├── app.js                  # 页面交互脚本
│       ├── index.html              # 页面结构
│       └── style.css               # 页面样式
├── lib/                            # 共享库
│   ├── child.mjs                   # 子脚本调用与结果解析
│   ├── cli.mjs                     # 命令行解析与路径解析
│   ├── fs-util.mjs                 # 临时文件清理与原子写回
│   ├── hash-id.mjs                 # 条目 hash_id 计算
│   ├── json-style.mjs              # JSON 排版风格识别与写回
│   ├── manifest-entry.mjs          # 条目字段定义与表单转换
│   ├── manifest-his.mjs            # 清单历史文件读写与新旧条目配对
│   ├── pinyin-sort.mjs             # 拼音排序
│   ├── result.mjs                  # 结果输出协议
│   ├── similarity.mjs              # 条目相似度与编辑距离
│   └── version.mjs                 # 版本号读取与日期换算
├── tests/                          # 脚本测试
│   ├── build-single-video-pages.test.mjs
│   ├── check-video-manifest.test.mjs
│   ├── helpers.mjs
│   ├── merge-into-manifest-his.test.mjs
│   ├── sort-video-manifest_tags.test.mjs
│   ├── sync-version.test.mjs
│   └── try2-update-manifest-his.test.mjs
├── add-new-video-reaction.mjs      # 图形界面新增条目
├── build-single-video-pages.mjs    # 逐视频静态页生成
├── catch-video-cover.mjs           # 批量捕获视频封面
├── check-video-manifest.mjs        # 清单校验
├── merge-into-manifest-his.mjs     # 手工指定历史条目配对
├── sort-video-manifest_tags.mjs    # 清单排序
├── sync-version.mjs                # 版本号同步与校验
└── try2-update-manifest-his.mjs    # 清单历史文件同步
```

## 输出协议

全部脚本的标准输出有且只有一个 JSON 对象,形如 Promise 的完成或拒绝状态,便于跨脚本捕获与解析。缺省格式化为多行缩进输出,便于人直接阅读;命令行带 `--inline` 时压成单行并去掉多余空白,便于跨脚本按行解析。

| 状态 | 标准输出 | 退出码 |
|:---:|:---:|:---:|
| 成功 | `{ "ok": true, "data": ... }` | 0 |
| 失败 | `{ "ok": false, "error": { "kind": ..., "message": ..., "details"?: ... } }` | 1 |

- 过程信息不再混入标准输出,中间步骤与检查项放进 `data` 或 `error.details`
- 需要提示人的内容一律写入标准错误,例如本地页面的访问地址
- `--inline` 为全部脚本共有的选项,由共享库统一解析与输出,各脚本的参数表不再单列
- 跨脚本调用一律携带 `--inline`,并以子进程最后一行的结果对象判定,解析失败按子脚本输出异常处理

## check-video-manifest.mjs

只读校验清单,以及清单与标签预选项的一致性,不修改任何文件。视频文件存放在对象存储,本仓库不再校验视频目录。

```bash
node scripts/check-video-manifest.mjs
node scripts/check-video-manifest.mjs --manifest video/manifest.json --tags video/tags.json
```

| 参数 | 说明 |
|:---:|:---:|
| `--manifest <path>` | 待校验清单,缺省为 `video/manifest.json` |
| `--tags <path>` | 标签预选项文件,缺省由清单 `tags` 字段相对解析 |

检查项包含读取清单,清单结构,清单字段,条目集合,空模板字段,条目字段,条目 hash_id,条目 hash_id 唯一,文件名唯一,解析标签文件,读取标签文件,标签预选项结构,标签预选项合法,条目标签在预选项内。空模板字段要求 `blank` 的键与条目字段集合完全一致。失败时 `error.message` 给出首个失败项与具体问题,`error.details.checks` 给出全部检查项。

`hash_id` 缺失,格式非法或重复都按硬失败处理;条目内容与 `hash_id` 对应的摘要不一致只写入 `data.warnings`,退出码仍为 0,因为 `hash_id` 首次分配后不再重算,内容变化属于正常编辑。

## sort-video-manifest_tags.mjs

按拼音重排标签预选项与每个条目的标签数组,并按标签数组与标题重排条目;缺少 `hash_id` 的条目按排序后的内容补算,已有 `hash_id` 默认沿用以保持分享链接稳定。

```bash
node scripts/sort-video-manifest_tags.mjs
node scripts/sort-video-manifest_tags.mjs --force
node scripts/sort-video-manifest_tags.mjs --check
node scripts/sort-video-manifest_tags.mjs --check --manifest video/manifest.json --tags video/tags.json
```

| 参数 | 说明 |
|:---:|:---:|
| `--check` | 只读比对: 复制出临时文件对其排序并校验,结果与原文件不一致时报错,始终不写回原文件 |
| `--force` | 按当前内容强制重算全部 `hash_id`,已有分享链接与已收录页面随之失效 |
| `--manifest <path>` | 待排序清单,缺省为 `video/manifest.json` |
| `--tags <path>` | 标签预选项文件,缺省由清单 `tags` 字段相对解析 |

不带 `--check` 时才写回原文件,且写回采用临时文件加改名的方式;任意检查失败时不改动原文件,并清理过程中产生的临时文件。

## 条目 hash_id

清单每个条目带有 `hash_id`,供站点分享链接与逐视频页面定位条目,由脚本生成,人工不维护。

- 计算范围是条目自身的全部字段,计算前排除 `hash_id` 字段本身
- 计算前对条目内容做行压缩,去掉缩进与无用空白,保证同一内容得到同一结果
- 对压缩后的内容取 sha-512,转十六进制后截取前 16 个字符
- 首次分配: 缺少 `hash_id` 的条目在排序时按当时的内容算出一个并写回清单
- 此后保守沿用: 条目内容变化时 `hash_id` 保持不变,早先发出的分享链接与已收录页面继续有效;确实需要重算时显式带 `--force`
- `check-video-manifest.mjs` 只校验格式与唯一性,内容与摘要不一致只作提示,两者共用 `scripts/lib/hash-id.mjs`

## 清单历史文件

`video/manifest.his.json` 与清单同结构,另加 `archived` 数组,用于留存条目历次登记的 `hash_id` 以及已删除条目的完整快照。该文件由脚本维护,人工不直接编辑。

- 每个条目的 `hash_id` 是数组,每项形如 `{"id": "...", "date": "yyyy.MM.dd"}`,`date` 为该 id 的登记日期,登记后不再更新
- `total` 按清单顺序记录当前条目,`archived` 记录已从清单删除的条目,每项带 `removedDate`
- 新增条目与内容大幅改写后新旧条目无法自动配对时,先由 `try2-update-manifest-his.mjs` 报冲突,再由 `merge-into-manifest-his.mjs` 人工指定配对
- 自动配对分三步: 先按文件名完全一致配对,再按条目字段拼接文本的相似度配对,相似度不足阈值或最优结果不唯一时一律留给人工
- 相似度阈值由 `scripts/lib/similarity.mjs` 的 `SIMILARITY_THRESHOLD` 定义,当前 `0.6`;新增条目的重复判定与历史配对共用该值,调整只改这一处
- 排版刻意压成"一个条目一行": 顶层结构各占一行,每个条目压成一条 JSON,不含缩进与无效空白;手工重排或手工改写都会被 `--check` 判定为与清单不一致,需由脚本重新写回

## try2-update-manifest-his.mjs

把清单与历史文件比对,写回更新后的历史文件。默认在写盘前拦住需要人工判定的情形,带 `--check` 时只比对不写文件。

```bash
node scripts/try2-update-manifest-his.mjs
node scripts/try2-update-manifest-his.mjs --check
node scripts/try2-update-manifest-his.mjs --accept-new 157cfa275e9d4ac5
```

| 参数 | 说明 |
|:---:|:---:|
| `--check` | 只比对,历史文件缺失或与清单不一致时以 `kind` 为 `his` 失败 |
| `--accept-new <hash_id>` | 声明该 hash_id 是新条目,登记日期取当前 `VERSION`,可重复给出 |
| `--bootstrap` | 历史文件缺失时按清单建立基线,缺省在历史文件不存在时同样按基线处理 |
| `--manifest <path>` | 清单路径,缺省为 `video/manifest.json` |
| `--his <path>` | 历史文件路径,缺省为清单同目录的 `manifest.his.json` |

配对结果分四类: 命中已有历史条目,声明或自动登记的新 id,从清单删除因而归档的条目,以及无法判定需要人工处理的条目。清单里有条目缺少合法 `hash_id` 时直接失败,提示先运行排序脚本。

## merge-into-manifest-his.mjs

按 `--old` 与 `--new` 成对给出人工配对,解决 `try2-update-manifest-his.mjs` 报出的冲突,冲突清零后才写盘。脚本不做交互,反复运行并逐次补齐配对即可。

```bash
node scripts/merge-into-manifest-his.mjs
node scripts/merge-into-manifest-his.mjs --old 157cfa275e9d4ac5 --new 8d8aba8d6c4c8891
node scripts/merge-into-manifest-his.mjs --old none --new 8d8aba8d6c4c8891
```

| 参数 | 说明 |
|:---:|:---:|
| `--old <hash_id>` | 历史文件里的旧 id,取 `none` 表示该新条目没有历史记录,可重复给出 |
| `--new <hash_id>` | 清单里的新 id,必须已存在于清单,可重复给出 |
| `--manifest <path>` | 清单路径,缺省为 `video/manifest.json` |
| `--his <path>` | 历史文件路径,缺省为清单同目录的 `manifest.his.json` |

`--old` 与 `--new` 数量必须相等,按下标成对生效。配对成功时旧 id 的历史记录保留,新 id 追加在后并记上当前 `VERSION` 的登记日期;未被配对的旧条目按删除处理,连同元信息快照一并转入 `archived`。

## add-new-video-reaction.mjs

启动本地页面,逐项填写后追加一条清单条目。只负责收集与追加信息,字段校验交给 `check-video-manifest.mjs`。

```bash
node scripts/add-new-video-reaction.mjs
node scripts/add-new-video-reaction.mjs --manifest video/manifest.json --port 8123 --no-open
```

| 参数 | 说明 |
|:---:|:---:|
| `--manifest <path>` | 待追加清单,缺省为 `video/manifest.json` |
| `--tags <path>` | 标签预选项文件,缺省由清单 `tags` 字段相对解析 |
| `--port <number>` | 本地页面端口,缺省 `0` 表示由系统分配 |
| `--no-open` | 不自动打开浏览器,只把地址写入标准错误 |

填写流程:

1. 页面以清单 `blank` 空模板为初值,在内存中构造临时条目对象
2. 必填文本为标题,简介,文件名,来源链接;来源编号由复选框控制,勾选后必填
3. 标签为多选,选项来自标签预选项文件,不得为空
4. 点击确定添加后先校验界面状态,不通过时定位到具体字段并提示
5. 通过后复制出临时清单并追加条目,依次执行排序脚本与校验脚本,全部通过才写回正式清单
6. 失败时删除临时文件,保留填写内容,可直接修改后重试;成功后页面报告结果,清空按钮重置表单
7. 清空属于破坏性操作,点击后按钮原位替换为确认按钮,3 秒内再次点击才执行,超时自动回归初始状态

视频文件规则: 站点按 `filename` 从对象存储读取视频,本仓库只保留清单条目,不存放视频文件;新增条目前需先把视频上传到对象存储的同一路径下。

## catch-video-cover.mjs

从本地 `video/file/` 批量捕获视频封面,写入 `video/cover/`,封面文件名为视频文件名加 `.jpg`,由 ffmpeg 以最高质量直接输出,不做缩放与二次压缩。封面不写入清单,站点按视频文件名拼接封面地址。该脚本只用于快速批量取封面,产物需人工审查,不进入 CI。

```bash
node scripts/catch-video-cover.mjs
node scripts/catch-video-cover.mjs --check
node scripts/catch-video-cover.mjs --single video/file/示例.mp4
node scripts/catch-video-cover.mjs --td 8
```

| 参数 | 说明 |
|:---:|:---:|
| `--check` | 只校验视频与封面的一一对应关系,不捕获封面 |
| `--single` | 单文件模式,只处理第一个位置参数 |
| `-Ox` | 判断严苛等级,`x` 取 `1` 到 `3`,缺失时取 `-O2`;等级即取前 `x` 个条件做逻辑与 |
| `--debug` | 把处理进度,判定细节与结尾的个数统计写到标准错误,标准输出仍只有一个结果对象 |
| `--td` | 并发线程数上限,`1` 到 `16` 的整数,缺失时取 `4`;实际并发还要受 CPU 核数一半约束 |

取帧策略: 从第 0 秒起按 `10` 秒采样步长取画面,最多尝试 `30` 次,逐个采样点按判断严苛等级的条件判定,取第一个全部满足的画面。采样步长与尝试次数是两个独立配置项,不相互推导。条件按顺序累加,`-O1` 只用第一条,`-O2` 用前两条,`-O3` 用全部三条: 一是颜色族个数不少于 3;二是像素最多的颜色族不超过该帧像素总数 60%;三是达标颜色族个数不少于 2,达标指该颜色族的像素按 4 邻接连通性划分后集合数量不超过 2。颜色族由像素按通道高位量化成色格后,由像素数量从多到少的色格依次归并而成,与某个颜色族中心各通道差值都不超过容差的色格并入该族,一个颜色族按一种颜色计数;尝试次数用完仍不满足时退化为第 3 秒画面,视频短于 3 秒取最后一帧。视频后缀,封面后缀,采样步长,尝试次数,退化时间点,尾帧偏移,量化位宽,颜色容差,连通性,判定阈值,默认等级,并发线程数上限,线程数与核数的折算比例与写出质量集中在脚本顶部配置区。并发按文件分发,单个视频由一个线程全程处理,输出顺序与单线程一致。校验模式下缺失与多出的封面都会在 `error.details` 中列出。

## build-single-video-pages.mjs

在构建期把清单里的每条视频渲染为独立静态页,写入站点产物目录,仓库内不保留生成结果。页面自带原生 `video` 控件直接播放对象存储中的文件,并提供来源链接,分享链接复制按钮与返回主页面的入口,便于搜索引擎为每条视频单独建立索引。历史文件里已归档的条目渲染为下架提示页,地址继续有效但不再提供播放,这类页面不进站点地图。

```bash
node scripts/build-single-video-pages.mjs
node scripts/build-single-video-pages.mjs --single 157cfa275e9d4ac5
node scripts/build-single-video-pages.mjs --check
node scripts/build-single-video-pages.mjs --out site/.output/public
```

| 参数 | 说明 |
|:---:|:---:|
| `--single <hash_id>` | 只生成该条目对应的页面,不改写 `sitemap.xml`,取值必须是 16 位小写十六进制 |
| `--out <path>` | 站点产物目录,缺省为 `site/.output/public`,相对路径按当前工作目录解析 |
| `--manifest <path>` | 待读取清单,缺省为 `video/manifest.json` |
| `--his <path>` | 清单历史文件,缺省为清单同目录的 `manifest.his.json`,文件不存在时按无归档处理 |
| `--check` | 只校验与渲染,不写文件 |

页面路径为 `video/<hash_id>/index.html`,站点地图为 `sitemap.xml`,收录站点首页与全部逐视频页面(不含下架页);全量运行同时写出 `robots.txt`,其 `Sitemap` 行与站点地图地址一致,两者都取自 `site/app/const.ts` 的 `siteUrl`。产物目录不存在时直接报错,需先执行 `npm run generate`;条目缺少合法 `hash_id` 时同样报错,需先执行排序脚本。页面里的站点名称,绝对地址,作者与对象存储基地址取自 `site/app/const.ts`,版本号取自仓库根目录的 `VERSION` 文件,必须是 `yyyy.MM.dd` 格式。

日期分工: 构建日期取 `VERSION`,更新日期取历史文件里该 `hash_id` 的登记日期,两者相同时只显示更新日期,显示形态在生成时决定。页面分享按钮复制页面自身的地址,提示文字写在页内,不使用浏览器原生弹窗。

页脚依次给出 `Copyright © 年份 作者` 的作者链接与指向仓库的站点名(不再单独放主页面入口,避免与正文底部的入口重复),标题,副标题,描述,站点绝对地址,作者名称与链接,仓库地址,对象存储基地址,封面目录与后缀,版权年份全部在生成期从 `site/app/const.ts` 的 `SITE` 常量读取,更换作者或仓库只改该文件;任取不到即报错,不会静默产出残缺页面。

## sync-version.mjs

以仓库根目录的 `VERSION` 文件为唯一来源,把版本号同步到代码与包文件里的版本号字段与版本徽章,避免多点手工改动后漂移。带 `--check` 时只比对不写文件,供 CI 与 `npm run version:check` 在构建前拦截不一致。

```bash
node scripts/sync-version.mjs
node scripts/sync-version.mjs --check
npm run version:sync
npm run version:check
```

| 参数 | 说明 |
|:---:|:---:|
| `--check` | 只比对,不写文件;存在差异时以 `kind` 为 `version` 失败,差异项在 `error.details.mismatches` 中列出 |
| `--root <path>` | 项目根目录,缺省为仓库根目录,相对路径按当前工作目录解析,主要供测试使用 |

同步目标共 6 个文件 7 处: 根 `package.json` 与站点 `package.json` 的 `version`,站点 `package-lock.json` 的根 `version` 与 `packages[""].version`,`site/app/const.ts` 的 `SITE.version`,中文与英文 README 的版本徽章。`VERSION` 内容只有版本号本身,不含任何空白符,缺失或格式不合规时直接报错。同步范围只含上述代码与包文件,`AGENTS.md` 与 `version.index.md` 等文档内的版本号无法由 `VERSION` 自动修正,版本号迭代时需手动更新。JSON 目标按两空格缩进重写并保留末尾换行,文本目标只替换版本号本身。

## tests

```bash
npm test
```

测试使用 Node.js 内置 test runner,夹具在临时目录内创建清单与标签文件,断言脚本的标准输出满足上述结果对象协议,并分别覆盖缺省的多行格式化输出与带 `--inline` 的单行输出。
