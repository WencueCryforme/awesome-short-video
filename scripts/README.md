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
│   ├── json-style.mjs              # JSON 排版风格识别与写回
│   ├── manifest-entry.mjs          # 条目字段定义与表单转换
│   ├── pinyin-sort.mjs             # 拼音排序
│   └── result.mjs                  # 结果输出协议
├── tests/                          # 脚本测试
│   ├── check-video-manifest.test.mjs
│   ├── helpers.mjs
│   └── sort-video-manifest_tags.test.mjs
├── add-new-video-reaction.mjs      # 图形界面新增条目
├── check-video-manifest.mjs        # 清单校验
└── sort-video-manifest_tags.mjs    # 清单排序
```

## 输出协议

全部脚本的标准输出有且只有一行 JSON 对象,形如 Promise 的完成或拒绝状态,便于跨脚本捕获与解析。

| 状态 | 标准输出 | 退出码 |
|:---:|:---:|:---:|
| 成功 | `{ "ok": true, "data": ... }` | 0 |
| 失败 | `{ "ok": false, "error": { "kind": ..., "message": ..., "details"?: ... } }` | 1 |

- 过程信息不再混入标准输出,中间步骤与检查项放进 `data` 或 `error.details`
- 需要提示人的内容一律写入标准错误,例如本地页面的访问地址
- 跨脚本调用以子进程最后一行的结果对象判定,解析失败按子脚本输出异常处理

## check-video-manifest.mjs

只读校验清单与视频目录,以及清单与标签预选项的一致性,不修改任何文件。

```bash
node scripts/check-video-manifest.mjs
node scripts/check-video-manifest.mjs --manifest video/manifest.json --tags video/tags.json
```

| 参数 | 说明 |
|:---:|:---:|
| `--manifest <path>` | 待校验清单,缺省为 `video/manifest.json` |
| `--tags <path>` | 标签预选项文件,缺省由清单 `tags` 字段相对解析 |

检查项包含清单可解析,清单字段完整,条目集合,条目字段,文件名唯一,入库视频目录,普通条目文件存在,过大条目未入库,无清单外文件,读取标签文件,标签预选项结构,标签预选项合法,条目标签在预选项内。失败时 `error.message` 给出首个失败项与具体问题,`error.details.checks` 给出全部检查项。

## sort-video-manifest_tags.mjs

按拼音重排标签预选项与每个条目的标签数组,并按标签数组与标题重排条目。

```bash
node scripts/sort-video-manifest_tags.mjs
node scripts/sort-video-manifest_tags.mjs --check
node scripts/sort-video-manifest_tags.mjs --check --manifest video/manifest.json --tags video/tags.json
```

| 参数 | 说明 |
|:---:|:---:|
| `--check` | 先校验原文件,再复制出临时文件对其排序并再次校验,全部通过才覆写原文件 |
| `--manifest <path>` | 待排序清单,缺省为 `video/manifest.json` |
| `--tags <path>` | 标签预选项文件,缺省由清单 `tags` 字段相对解析 |

任意检查失败时不改动原文件,并清理过程中产生的临时文件。

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
3. `allow_iframe` 与 `default_mode` 为必选单选,取值等于缺省时不写入该字段
4. 标签为多选,选项来自标签预选项文件,不得为空
5. 标记为必选,取值为无或 `THE_FILE_SIZE_IS_TOO_LARGE`,取值等于无时不写入该字段
6. 点击确定添加后先校验界面状态与视频文件位置,不通过时定位到具体字段并提示
7. 通过后复制出临时清单并追加条目,依次执行排序脚本与校验脚本,全部通过才写回正式清单
8. 失败时删除临时文件,保留填写内容,可直接修改后重试;成功后页面报告结果,清空按钮重置表单
9. 清空属于破坏性操作,点击后按钮原位替换为确认按钮,3 秒内再次点击才执行,超时自动回归初始状态

视频文件位置规则: 普通条目的文件必须存在于入库视频目录;标记为体积过大的条目的文件不得出现在入库视频目录,只保留在不进 git 追踪的体积过大视频目录。

## tests

```bash
npm test
```

测试使用 Node.js 内置 test runner,夹具在临时目录内创建清单,标签文件与视频文件,断言脚本的标准输出满足上述单行结果对象协议。
