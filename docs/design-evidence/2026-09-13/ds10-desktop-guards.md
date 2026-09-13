# DS-10 · 桌面设计检查与维护交接

本地实现与工程验证完成，进入 PR 提交阶段；未合并。原实施及运行验证基线 `07eac89584776ea18ae5040d2d2b37673c9084c2`，分支 `ds/10-desktop-design-guards`，2026-09-13，执行者 Codex。完整计划与 SC 仍维护于负责人唯一主计划，本文仅为仓内结果索引。风险类别：CI 门禁调整；本次只完善已有报告及维护说明，无产品 UI、CI 接线或远端 required 变更。

## 实际改动

- 复用既有 `design-layer-report.mjs`，补齐 gap-x/gap-y、逻辑 padding；从 `desktop-bindings.json` 读取真实间距变量，不建第二份白名单。直接已登记来源、未知变量、纯引用计算、混合裸值/回退、裸值分别报告；`--space-4` 已登记，旧计划探针 `--spacing-4` 未登记。
- 保持 report，未知角色不猜按钮间距，不改 Permission 的四处 `py-[1px]`，不新增颜色豁免。颜色阻断、inventory 新鲜度、Token 生成单测、Mobile 原有门禁及 CI 分片汇总保持。
- 报告 hash 新增绑定表输入；缺失/损坏绑定经真实 CLI 验证退出 2，`--report` 不吞操作错误。读取在调用期进行，不在 import 时抛出不受主入口处理的异常。
- 现有设计索引新增查错/生成/新增入口/维护道路；治理 §8/12、Token README、DS-9 证据与人工台账回填实际状态，不将 pilot 批量升级 migrated。

## 静态与历史验证

既有审计/inventory 联跑 65 项通过；最终审计 13 项通过（含真实 CLI 错误/报告退出码及 verify/Windows 汇总传播）。Token 5 文件 47 项通过，含临时生成、全部输出缺失/手改/过期反例和真实源改值。最终根 related 通过：runner 533 pass / 1 存量 skip，Desktop related 17.7s；Desktop/Token typecheck、生成新鲜度与 50 surface（36 Desktop + 14 Mobile）inventory 新鲜度通过。候选颜色 unexpected=0，10 项 report 均来自既有未跟踪 ui-showcase，不纳入本批。未改测试调度/依赖/单测 CI，不触发全 workspace 回退；未声称本候选远端 CI 已运行。

[本次 23 组历史回放](./ds10-replay.json) 使用当前脚本与绑定，沿用 DS-7 的 20 个固定样本并加入 DS-7/8/9 最终合并相对第一父提交；全部预期阻断 0、实际阻断 0。报告数不是违规数，历史 PR 已合入不等于全部视觉合规。DS-6/7/8/9 报告数分别为 14/44/110/41；色彩阻断能力另由既有消费者违规注入证明。

复现时读取 JSON 中的 base/head 调用 `audit` 或真实 CLI：

```bash
node scripts/hardcoded-color-audit.mjs --base-ref <base> --head-ref <head> --report --json
node --test scripts/__tests__/hardcoded-color-audit.test.mjs scripts/__tests__/design-inventory.test.mjs
pnpm --filter @cindy/design-tokens test
```

对比 scriptHashes、counts 和 candidateHash；脚本或绑定有变化则重新生成结果并解释差异，不覆写旧证据充当未运行的通过。

本轮只读远端 main rules：DCO、verify、Windows unit tests；至少 1 个批准并解决审查线程。未改接线/required，治理 §8 的新增接线审核前置本次不触发；正常 PR 审查仍适用，未声称管理员已批准本候选。

## 实际运行与证据边界

安全包装启动成功：`DESKTOP_DEV_VERDICT=ready`， Global 独立 `ds10` 沙箱，macOS Electron，基线同上；不复制真实任务数据；依启动合同只读显示本机 OpenAI 身份，未发起登录/断开、模型请求、调度或对外业务写操作。截图/脚本/日志在负责人主计划目录 `附件/DS-10/`，未上传公开附件、不入 Git。

`runtime.json` 共 22 项通过：11 内置主题的真实 Permission、局部/全局/并存覆盖与自定义 radius；图片/视频/模型在默认 Light/Dark 的初始焦点、连续 Tab/Shift+Tab 不越出、Escape 关闭恢复。实际 model-viewer 加载本地 GLB、shadow DOM 存在且方向键改变 camera orbit，补足 DS-9 jsdom 未验证的浏览器交互部分。截图为 `default-{light,dark}.png` 与各 Lightbox 两模式文件。

首轮脚本把触发器放入 React 管理的根节点，重绘后被移除，修正采证挂载位置；旧 glTF 测试资源内嵌 data URL 被既有 CSP 拒绝，改用同一几何的 GLB Blob 样本后通过，未放宽 CSP 或改媒体实现。它们是采证修正，不是产品缺陷修复。

改风格演练 style-drill.json 通过：只改 reference/foundations.json 与 reference/color.json，再走实际 Terrazzo 生成。真实 SettingsTextInput/Input、AssistantMessage/消息动作和 Permission 的结果如下；无需组件代码补丁。恢复原源并重生成后，所有采样 computed 值与演练前一致，源/生成物没有留下 diff。

| 实际消费 | 演练前 → 演练后 |
| --- | --- |
| 设置/聊天主文字颜色 | rgb(38,38,38) → rgb(51,51,51) |
| 设置/标准输入字号 | 14px → 15px |
| 实际助手消息字号 | 15px → 16px |
| 授权外层 padding / radius | 16px / 12px → 18px / 14px |
| 授权允许按钮字重 | 500 → 400 |
| 消息动作、输入、授权按钮过渡 | 0.15s → 0.12s |

允许按钮的局部颜色继续保留，未强制跟随全局文字颜色。演练值只用于受控证明，不是新设计裁决。初轮独立 Markdown 缺消息父层、热更新模块造成 Provider 实例不一致、启动遮罩影响截图，均在采证脚本补实际 AssistantMessage/同源 Provider、等待页面可交互后解决；未修改产品来迎合测试。

routes.json 的设置/供应商/新建三个实际路由 × 两模式共 6 组通过并采图；本轮是当前沙箱的页面运行核对，没有发起供应商业务或模型请求。实际账号业务、其它跨入口的全部状态仍未由这些样本覆盖。

## 未完成验收与回退

G2 的真实独立贡献者待安排，不能以 Agent 模拟替代；公开图片、Windows/Linux、实体 IME/缩放/拖窗、真实账号/远程业务仍缺完整证据。kirozeng 协调人员、平台与公开附件，执行者整理证据/复核，2026-09-17 复查；无已约定参与者的声明。

最新 DESIGN §5 已明确用量图表日期 Equivalent 控件是欠交付的非合规过渡，不只是“是否需要裁决”问题。该控件当前未由本批实现，G4 不因图表状态测试或已合并倒推通过。DS-10 不混入可见产品改造；继续在唯一主计划按真实影响处置，不能宣布本期所有目标完成。

回退本批报告分类、输入 hash 及对应测试/说明即可，保留 DS-7 阻断、DS-8 生成链和当前产品行为。Mobile 继续独立延期。工程完成、用户视觉确认、G1—G4 最终验收分别记录。


## 2026-09-14 单人自查与 E2E 复核

执行者自行检查全部候选 diff、脚本职责、真实绑定读取、测试用途与文档入口；没有发现需要修复的本批代码问题。实现继续只扩展两个既有脚本，不增加依赖、第二份白名单、组件目录或数值源。旧建模/快照辅助仍服务独立回归，不参与生产生成，不因文件数删除它们。此为单人自查，不是独立双审。

候选文件与此前 manifest 一致；复用来源 MATCH / ready 的同基线 Global 独立 ds10 实例。65 项审计/inventory 回归通过（含真实 CLI 的合法报告、颜色阻断、损坏/缺失输入退出码）；22 项客户端检查通过，补模型方向键改变视角的严格断言；6 组真实路由两模式运行断言通过，补横向溢出失败断言。Token 生成新鲜度通过，产品源码与源值/生成物无新增 diff。

新记录位于既有附件目录下 self-e2e-2026-09-14。页面截图接口两次超时，保留原日志；路由核验随后独立完成，仅记运行通过。授权/媒体截图成功，执行者目检亮色授权与暗色模型；不据此宣称全页或用户视觉验收。原 09-13 路由截图与改风格演练为同实现历史证据，本轮不改写。用户视觉确认及上节所有未完成项继续保留。


## 提交候选（2026-09-14）

用户明确授权执行者自查后提交 DS-10，并跳过本地双审；不将该授权记作用户视觉通过。分支已安全快进至 main `88f71211657420432ed956d91b2ef5a2564cd469`，原 10 文件候选恢复，inventory 人工区与主干生成区自动合并。两个脚本及测试无须因同步改写；完整 diff 自查无本批待修复问题，不新增无必要封装。

在该主干上运行 `pnpm install --frozen-lockfile` 后，`VITE_CINDY_AUTH_REGION=global pnpm test:unit:related` 通过：runner 540 pass / 1 存量 skip，Desktop related 18.3s。Desktop、Mobile、design-tokens typecheck，生成/50 surface 台账新鲜度、endpoint/i18n/brand/glossary、migration、scheduler、Mobile scope、9 项文档合同检查均通过；Device Link 类型与 9 项真实 loopback 集成也通过。已有未跟踪 ui-showcase 被 related 自动选入，仍不提交。

23 组固定历史回放的脚本/绑定 hash 与本候选一致，沿用原结果；原运行矩阵和截图仍绑定 07eac89584，不冒充新主干全量实机复验。新增主干的 open-path 生命周期/模型适配与 iOS 动画不属于本批；本批相对提交基线没有产品 UI、Token 源/生成物、依赖或 CI 配置改动。最终证据及单人自查回执在原附件目录的 submit-2026-09-14 中。提交走当前维护者 fork 与 DCO，不伪造双审共识或自动跟踪注册；最终远端检查以实际 PR 为准。
