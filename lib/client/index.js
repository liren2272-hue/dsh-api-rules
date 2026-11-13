/**
 * 设置卡片：为每条已接入的 API 渲染一个「页面」（顶部标签切换），首个是 CodeArts。
 * 填写 AK/SK 后经 host 路由写到 `<DSH_HOME>/.api-rules/accounts.json`（与上游目录隔离）。
 *
 * 绑定在 `plugins.bundle.config` 槽位，出现在「设置 → 插件」里，不需要额外导航入口。
 *
 * 实现要点（全部经 app.asar 取证，勿改）：
 *  - `t` 是函数 `t(key, vars)`，绝不可 `t.xxx`。
 *  - **字典必须是扁平的「点号字面量 key」**：宿主 locale 的 lookup 只做
 *    `locales.get(locale)[key]`（见 app.asar 的 dsh-client-locale/lib/client.js），
 *    `localeSeat()` 只是 `face.bind(ns)` 的薄包装，不会展平嵌套对象。
 *    历史版本把文案写成 `section: { codearts: ... }` 再 `t('section.codearts')`，
 *    查表永远 miss、回落到 key 字面量，卡片就露出英文 route.label 和裸 key。
 *  - 纯 React DOM + 组件级 `<style>`；CSS 变量只用 app.asar 里真实存在的
 *    `--dsw-alias-*` / `--dsw-font-*` / `--dsw-radius-*` token，且一律带兜底色。
 *  - 深浅色适配靠 token 自身翻转（深色覆盖在 `body[data-ds-dark-theme]`），
 *    本文件绝不写死颜色；主按钮 = button-primary-fill 底 + label-primary-foreground 字。
 *  - 分区列表来自 `GET /api/api-rules/accounts`，新增 route 即多一个标签，本文件零改动。
 *  - 明文永不进 input.value：服务端只回掩码，掩码只出现在 placeholder / label 右侧。
 *  - 透传路由的可用性只由 `health`（checked/ok/models/error）推导，绝不看 configured。
 *
 * @module dsh-api-rules/client
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-api-rules',
  factory(require) {
    const name = 'dsh-api-rules-client'
    const inject = ['slots', 'locale']
    // React 在 factory 顶层取一次：组件渲染期 require('react') 会抛错。
    const ReactTop = require('react')

    // ── 文案（扁平点号 key，中文优先） ───────────────────────────────────────
    const zh = {
      'card.title': 'API 规则',
      'card.subtitle': '把多个上游模型服务集中到一处管理：凭据只存本机，插件直接调用上游。',
      'card.chip': '{ok} / {total} 个就绪',
      'card.chipAll': '{total} 个 API · 全部就绪',

      'tab.codearts': 'CodeArts',
      'tab.officeace': 'OfficeAce',
      'tab.cline': 'Cline',
      'tab.raccoon': 'Raccoon',

      'name.codearts': 'CodeArts 账号',
      'desc.codearts': '用 AK / SK 直接签名调用 CodeArts 模型网关，密钥不出本机。',
      'name.officeace': 'OfficeAce 账号',
      'desc.officeace': '账号与登录都在上游管理面板里维护，插件只做转发。',
      'name.cline': 'Cline 账号',
      'desc.cline': '免费模型提示账号不足时，到管理面板里补一个 Cline 账号。',
      'name.raccoon': 'Raccoon 账号',
      'desc.raccoon': '由插件自动拉起的 Raccoon 控制台，首次进入填一次管理密钥。',
      'tab.loomy2api': 'Loomy',
      'name.loomy2api': 'Loomy 账号',
      'desc.loomy2api': '由插件自动拉起的 Loomy 星火网关，自动复用本机 Loomy 登录态，无需手动填密钥。',
      'tab.minimax2api': 'MiniMax',
      'name.minimax2api': 'MiniMax 账号',
      'desc.minimax2api': '由插件自动拉起的 MiniMax 网关，到面板粘贴 MiniMax Agent 的 JWT 添加账号即可。',

      'panel.title': '管理面板',
      'panel.note.officeace': '链接已带好口令，点开即可管理账号。',
      'panel.note.cline': '免费模型提示账号不足时，在这里添加 Cline 账号。',
      'panel.note.raccoon': '首次进入要填一次管理密钥：raccoon-local-admin，填过就不再询问。',
      'panel.note.loomy2api': '面板密码：sk-loomy-local。登录后可加账号、看积分/用量/日志。',
      'panel.note.minimax2api': '面板密码：sk-mm-local。登录后粘贴 MiniMax Agent 的 JWT `_token` 添加账号、看用量。',
      'tab.qoder2api-hub': 'Qoder',
      'name.qoder2api-hub': 'Qoder 账号',
      'panel.note.qoder2api-hub': '新 Go 桥（Zhengyuuuui/qoder2api）。控制台 :3588，密码 qoder-local；首次需在控制台用 Qoder 账号 OAuth/PAT 登录，桥 :8963 才会监听。',
      'tab.trae2api-hub': 'Trae',
      'name.trae2api-hub': 'Trae 账号',
      'panel.note.trae2api-hub': '新 Go 桥（XCool-603/trae2api）。控制台 :7870；CN 账号从本机 Trae 客户端凭据自动导入，无需手动登录。',
      'panel.note.default': '账号与登录都在这个面板里完成。',
      'panel.open': '打开管理面板',
      'panel.missing': '这条路由还没配置管理面板地址。',

      'mm.title': 'MiniMax 账号',
      'mm.empty': '还没有账号。粘贴 MiniMax Agent 的 JWT `_token` 添加一个。',
      'mm.addTitle': '添加账号',
      'mm.tokenPh': '粘贴 MiniMax Agent JWT _token',
      'mm.namePh': '账号备注（可选）',
      'mm.add': '添加',
      'mm.delete': '删除',

      'status.loading': '读取中…',
      'status.unconfigured': '未配置',
      'status.saved': '已就绪',
      'status.up': '上游可用',
      'status.down': '上游不可用',
      'status.unreachable': '上游不可达',
      'meta.models': '{n} 个模型',
      'meta.autolaunch': '插件自动拉起',

      'field.ak': 'Access Key（AK）',
      'field.sk': 'Secret Key（SK）',
      'field.baseUrl': '网关地址',
      'field.authorization': 'Authorization',
      'field.endpointDesc': '填自己的网关地址与凭据，插件直接请求这个上游。',
      'ph.ak': '粘贴 AK',
      'ph.sk': '粘贴 SK',
      'ph.baseUrl': 'https://…/v2',
      'ph.authorization': '粘贴整串，例如 Basic xxxxxxxx',
      'ph.saved': '留空则不修改',
      'mask.saved': '已保存 {hint}',

      'action.save': '保存',
      'action.saving': '保存中…',
      'action.clear': '清除',
      'action.clearConfirm': '确认清除',
      'action.clearing': '清除中…',

      'sync.button': '同步可用模型',
      'sync.running': '同步中…',
      'sync.done': '同步完成：新增 {added}、移除 {removed}、跳过 {skipped}',
      'sync.fail': '同步失败：{message}',
      'sync.last': '上次启用时同步：新增 {added}、移除 {removed}',
      'sync.idle': '还没有同步过可用模型。',
      'sync.hint': '插件每次启用都会自动刷新可用模型；也可点上面的按钮手动同步。改动写入本机模型声明，用「模型选择器」编辑器微调即可。',

      'error.bothRequired': 'AK 和 SK 要同时填写',
      'error.baseUrlRequired': '网关地址要以 http:// 或 https:// 开头',
      'error.authRequired': 'Authorization 不能为空',
      'error.load': '读取账号失败：{message}',
      'error.save': '保存失败：{message}',
      'error.clear': '清除失败：{message}',

      'empty.none': '还没有可配置的 API。',
      'alert.proxyDown': '规则前置层没有监听（端口 {port}{error}），所有 API 都会失败。重启 DSH 即可恢复。',
      'foot': '凭据只保存在本机 ~/.dsh/.api-rules/accounts.json，卸载插件即彻底清除，不会写进插件配置。',

      // 生图/生视频通道（goal-58ba6a2c）
      'media.title': '生图 / 生视频',
      'media.desc': '直连上游媒体端点，绕过 chat 清单，不会被生图模型当聊天模型调。',
      'media.kind.images': '生图',
      'media.kind.videos': '生视频',
      'media.model': '模型',
      'media.prompt': '提示词',
      'media.promptPlaceholder': '描述要生成的内容，例如：苜蓿叶立交桥夜景俯视，车流光轨',
      'media.size': '尺寸',
      'media.width': '宽（像素）',
      'media.height': '高（像素）',
      'media.duration': '时长（秒）',
      'media.ratio': '画幅',
      'media.resolution': '分辨率',
      'media.generate': '生成',
      'media.generating': '生成中…',
      'media.note.image': '生成通常 10~90 秒，生图模型不支持「思考」。',
      'media.note.video': '快档模型约 20 秒返回；慢档可能要等几分钟到十几分钟，请勿关闭页面。',
      'media.success.image': '生成成功，耗时 {seconds} 秒。',
      'media.success.video': '生成完成，耗时 {seconds} 秒。',
      'media.success.async': '已提交任务 {taskId}，状态 {status}，稍后重试可取结果。',
      'media.result': '生成结果',
      'media.download': '下载 / 打开',
      'media.empty': '填好提示词后点「生成」。',
      'media.error': '生成失败：{message}',
      'media.upstreamDown': '该路由的上游没有监听（健康检查 {status}），生成前请先确认上游已启动。',
    }

    const en = {
      'card.title': 'API Rules',
      'card.subtitle': 'Manage every upstream model service in one place. Credentials stay on this machine.',
      'card.chip': '{ok} / {total} ready',
      'card.chipAll': '{total} APIs · all ready',

      'tab.codearts': 'CodeArts',
      'tab.officeace': 'OfficeAce',
      'tab.cline': 'Cline',
      'tab.raccoon': 'Raccoon',

      'name.codearts': 'CodeArts account',
      'desc.codearts': 'Signs requests with your AK / SK and calls the CodeArts gateway directly.',
      'name.officeace': 'OfficeAce account',
      'desc.officeace': 'Accounts and login live in the upstream admin panel; this plugin only forwards.',
      'name.cline': 'Cline account',
      'desc.cline': 'When a free model reports no account, add a Cline account in the admin panel.',
      'name.raccoon': 'Raccoon account',
      'desc.raccoon': 'Console for the Raccoon upstream this plugin launches; the key is asked once.',
      'tab.loomy2api': 'Loomy',
      'name.loomy2api': 'Loomy account',
      'desc.loomy2api': 'Loomy Spark gateway launched by this plugin; it reuses your local Loomy login automatically.',
      'tab.minimax2api': 'MiniMax',
      'name.minimax2api': 'MiniMax account',
      'desc.minimax2api': 'MiniMax gateway launched by this plugin; paste your MiniMax Agent JWT in its panel to add an account.',

      'panel.title': 'Admin panel',
      'panel.note.officeace': 'The link already carries the token — just open it.',
      'panel.note.cline': 'Add a Cline account here when a free model reports no account.',
      'panel.note.raccoon': 'The first visit asks for the management key: raccoon-local-admin.',
      'panel.note.loomy2api': 'Panel password: sk-loomy-local. After login you can add accounts and view points / usage / logs.',
      'panel.note.minimax2api': 'Panel password: sk-mm-local. After login, paste your MiniMax Agent JWT `_token` to add an account and view usage.',
      'tab.qoder2api-hub': 'Qoder',
      'name.qoder2api-hub': 'Qoder account',
      'panel.note.qoder2api-hub': 'New Go bridge (Zhengyuuuui/qoder2api). Console :3588, password qoder-local; log in a Qoder account via OAuth/PAT in the console before the :8963 bridge starts listening.',
      'tab.trae2api-hub': 'Trae',
      'name.trae2api-hub': 'Trae account',
      'panel.note.trae2api-hub': 'New Go bridge (XCool-603/trae2api). Console :7870; the CN account is auto-imported from the local Trae desktop client credentials — no manual login needed.',
      'panel.note.default': 'Accounts and login are handled in this panel.',
      'panel.open': 'Open admin panel',
      'panel.missing': 'This route has no admin panel URL configured.',

      'mm.title': 'MiniMax accounts',
      'mm.empty': 'No accounts yet. Paste a MiniMax Agent JWT `_token` to add one.',
      'mm.addTitle': 'Add account',
      'mm.tokenPh': 'Paste MiniMax Agent JWT _token',
      'mm.namePh': 'Account label (optional)',
      'mm.add': 'Add',
      'mm.delete': 'Delete',

      'status.loading': 'Loading…',
      'status.unconfigured': 'Not configured',
      'status.saved': 'Ready',
      'status.up': 'Upstream available',
      'status.down': 'Upstream unavailable',
      'status.unreachable': 'Upstream unreachable',
      'meta.models': '{n} models',
      'meta.autolaunch': 'Launched by plugin',

      'field.ak': 'Access Key (AK)',
      'field.sk': 'Secret Key (SK)',
      'field.baseUrl': 'Gateway URL',
      'field.authorization': 'Authorization',
      'field.endpointDesc': 'Point the plugin straight at your own gateway.',
      'ph.ak': 'Paste AK',
      'ph.sk': 'Paste SK',
      'ph.baseUrl': 'https://…/v2',
      'ph.authorization': 'Paste the whole value, e.g. Basic xxxxxxxx',
      'ph.saved': 'Leave blank to keep it',
      'mask.saved': 'Saved {hint}',

      'action.save': 'Save',
      'action.saving': 'Saving…',
      'action.clear': 'Clear',
      'action.clearConfirm': 'Confirm clear',
      'action.clearing': 'Clearing…',

      'sync.button': 'Sync models',
      'sync.running': 'Syncing…',
      'sync.done': 'Sync done: {added} added, {removed} removed, {skipped} skipped',
      'sync.fail': 'Sync failed: {message}',
      'sync.last': 'Last sync on enable: {added} added, {removed} removed',
      'sync.idle': 'Available models have not been synced yet.',
      'sync.hint': 'The plugin refreshes available models every time it is enabled; you can also click the button above to sync manually. Changes are written to the local model declarations — fine-tune them in the model selector editor.',

      'error.bothRequired': 'Fill in both AK and SK',
      'error.baseUrlRequired': 'The gateway URL must start with http:// or https://',
      'error.authRequired': 'Authorization must not be empty',
      'error.load': 'Failed to load: {message}',
      'error.save': 'Failed to save: {message}',
      'error.clear': 'Failed to clear: {message}',

      'empty.none': 'No API to configure yet.',
      'alert.proxyDown': 'The rule proxy is not listening (port {port}{error}), so every API will fail. Restart DSH to recover.',
      'foot': 'Credentials are stored locally in ~/.dsh/.api-rules/accounts.json and removed with the plugin.',

      // Image / video channel (goal-58ba6a2c)
      'media.title': 'Image / Video',
      'media.desc': 'Calls the upstream media endpoints directly, bypassing the chat roster so image models are never sent to a chat endpoint.',
      'media.kind.images': 'Image',
      'media.kind.videos': 'Video',
      'media.model': 'Model',
      'media.prompt': 'Prompt',
      'media.promptPlaceholder': 'Describe what to generate, e.g. aerial night view of a cloverleaf interchange with light trails',
      'media.size': 'Size',
      'media.width': 'Width (px)',
      'media.height': 'Height (px)',
      'media.duration': 'Duration (s)',
      'media.ratio': 'Aspect ratio',
      'media.resolution': 'Resolution',
      'media.generate': 'Generate',
      'media.generating': 'Generating…',
      'media.note.image': 'Usually 10–90 seconds. Image models do not support thinking levels.',
      'media.note.video': 'Fast tiers return in about 20 seconds; slow tiers can take several minutes — keep this page open.',
      'media.success.image': 'Done in {seconds}s.',
      'media.success.video': 'Done in {seconds}s.',
      'media.success.async': 'Task {taskId} submitted, status {status}. Try again later to fetch the result.',
      'media.result': 'Result',
      'media.download': 'Download / open',
      'media.empty': 'Fill in a prompt and click Generate.',
      'media.error': 'Generation failed: {message}',
      'media.upstreamDown': 'The upstream for this route is not listening (health {status}); start it before generating.',
    }

    // ── 样式（类名统一 arc- 前缀；只用已核验 token，且一律带兜底） ─────────────
    const CSS = [
      /* 卡片骨架：宽度跟着 DSH 设置卡片走，不自己设最大宽度 */
      '.arc{width:100%;box-sizing:border-box;display:flex;flex-direction:column;font-family:var(--dsw-font-family,inherit);color:var(--dsw-alias-label-primary,CanvasText);}',
      '.arc *{box-sizing:border-box;}',

      /* 头部：左标题 + 右汇总 chip */
      '.arc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:4px 0 14px;}',
      '.arc-headMain{display:flex;flex-direction:column;gap:4px;min-width:0;}',
      '.arc-title{font-size:var(--dsw-font-s-strong-14-font-size,14px);line-height:var(--dsw-font-s-strong-14-line-height,22px);font-weight:var(--dsw-font-s-strong-14-font-weight,600);color:var(--dsw-alias-label-primary,CanvasText);}',
      '.arc-sub{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:var(--dsw-font-xxs-12-line-height,18px);color:var(--dsw-alias-label-secondary,#5c5c5c);}',
      '.arc-chip{flex:none;display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));background:var(--dsw-alias-bg-layer-1,transparent);font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:1;color:var(--dsw-alias-label-secondary,#8a8a8a);white-space:nowrap;}',
      '.arc-chip__dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#2ea44f);flex:none;}',
      '.arc-chip__dot.idle{background:var(--dsw-alias-label-quaternary,#b5b5b5);}',

      /* 标签栏：pill 胶囊，横向可滚动（路由多了也不换行挤压） */
      '.arc-tabs{display:flex;gap:4px;padding:0 0 12px;overflow-x:auto;scrollbar-width:none;}',
      '.arc-tabs::-webkit-scrollbar{display:none;}',
      '.arc-tab{flex:0 0 auto;display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 12px;border:.5px solid transparent;border-radius:999px;background:transparent;font-family:inherit;font-size:var(--dsw-font-xs-13-font-size,13px);line-height:1;font-weight:500;color:var(--dsw-alias-label-secondary,#5c5c5c);cursor:pointer;transition:background 140ms ease,color 140ms ease,border-color 140ms ease;}',
      '.arc-tab:hover{color:var(--dsw-alias-label-primary,CanvasText);background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));}',
      '.arc-tab[aria-selected="true"]{color:var(--dsw-alias-label-primary,CanvasText);font-weight:600;background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.16));border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.2));}',
      '.arc-tab:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176e6));outline-offset:1px;}',
      '.arc-tab__dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-label-quaternary,#b5b5b5);}',
      '.arc-tab__dot.ok{background:var(--dsw-alias-state-success-primary,#2ea44f);}',
      '.arc-tab__dot.err{background:var(--dsw-alias-state-error-primary,#d64545);}',

      /* 分区容器 */
      '.arc-pane{border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l2,rgba(127,127,127,.2)));background:var(--dsw-alias-settings-card-fill,transparent);border-radius:var(--dsw-radius-lg,10px);padding:14px 14px 12px;display:flex;flex-direction:column;gap:12px;}',
      '.arc-paneHead{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;}',
      '.arc-paneTitle{font-size:var(--dsw-font-xs-strong-13-font-size,13px);line-height:var(--dsw-font-xs-strong-13-line-height,20px);font-weight:600;color:var(--dsw-alias-label-primary,CanvasText);}',
      '.arc-paneDesc{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:var(--dsw-font-xxs-12-line-height,18px);color:var(--dsw-alias-label-secondary,#5c5c5c);margin-top:2px;}',

      /* 状态徽章：tone 只决定颜色，深浅色都靠 token 翻转 */
      '.arc-badge{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 8px;border-radius:var(--dsw-radius-md,6px);font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:1;white-space:nowrap;color:var(--dsw-alias-label-secondary,#8a8a8a);background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));}',
      '.arc-badge__dot{width:6px;height:6px;border-radius:50%;flex:none;background:currentColor;}',
      '.arc-badge.ok{color:var(--dsw-alias-state-success-primary,#2ea44f);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#2ea44f) 14%,transparent);}',
      '.arc-badge.err{color:var(--dsw-alias-state-error-primary,#d64545);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d64545) 14%,transparent);}',
      '.arc-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;color:var(--dsw-alias-label-secondary,#5c5c5c);}',
      '.arc-meta__sep{width:1px;height:10px;background:var(--dsw-alias-border-l3,rgba(127,127,127,.24));}',

      /* 表单 */
      '.arc-fields{display:flex;flex-direction:column;gap:12px;}',
      '.arc-field{display:flex;flex-direction:column;gap:6px;min-width:0;}',
      '.arc-fieldTop{display:flex;align-items:baseline;justify-content:space-between;gap:10px;}',
      '.arc-label{font-size:var(--dsw-font-xxs-strong-12-font-size,12px);line-height:18px;font-weight:600;color:var(--dsw-alias-label-secondary,#8a8a8a);}',
      '.arc-mask{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;color:var(--dsw-alias-label-quaternary,#b5b5b5);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%;}',
      '.arc-input{width:100%;height:34px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.28));border-radius:var(--dsw-radius-md,6px);background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,CanvasText);font-family:inherit;font-size:var(--dsw-font-s-14-font-size,14px);line-height:22px;outline:none;transition:border-color 140ms ease,box-shadow 140ms ease;}',
      '.arc-input::placeholder{color:var(--dsw-alias-label-tertiary,#6b6b6b);}',
      '.arc-input:hover{border-color:var(--dsw-alias-border-l3,rgba(127,127,127,.32));}',
      '.arc-input:focus{border-color:var(--dsw-alias-state-business-primary,#4176e6);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 18%,transparent);}',
      '.arc-input.invalid{border-color:var(--dsw-alias-state-error-primary,#d64545);}',
      '.arc-input.invalid:focus{box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-error-primary,#d64545) 18%,transparent);}',
      '.arc-fieldError{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;color:var(--dsw-alias-state-error-primary,#d64545);}',

      /* 面板卡（托管路由） */
      '.arc-panel{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:var(--dsw-radius-md,6px);background:var(--dsw-alias-bg-module-platform,transparent);}',
      '.arc-panel__icon{width:28px;height:28px;flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:var(--dsw-radius-sm,4px);background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));color:var(--dsw-alias-label-secondary,#8a8a8a);}',
      '.arc-panel__icon>svg{width:14px;height:14px;display:block;}',
      '.arc-panel__text{flex:1 1 180px;min-width:0;}',
      '.arc-panel__title{font-size:var(--dsw-font-xs-strong-13-font-size,13px);line-height:18px;font-weight:600;color:var(--dsw-alias-label-primary,CanvasText);}',
      '.arc-panel__note{margin-top:2px;font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;color:var(--dsw-alias-label-secondary,#5c5c5c);}',

      /* 按钮：主按钮底色与字色都随主题翻转（深色下是近白底 + 深字） */
      '.arc-actions{display:flex;justify-content:flex-end;align-items:center;gap:8px;flex-wrap:wrap;}',
      '.arc-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 14px;border-radius:var(--dsw-radius-md,6px);border:.5px solid transparent;font-family:inherit;font-size:var(--dsw-font-xs-13-font-size,13px);line-height:1;font-weight:600;cursor:pointer;transition:background 140ms ease,border-color 140ms ease,color 140ms ease;white-space:nowrap;}',
      '.arc-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176e6));outline-offset:2px;}',
      '.arc-btn:disabled{opacity:.45;cursor:default;}',
      '.arc-btn.primary{background:var(--dsw-alias-button-primary-fill,#1b1b1c);color:var(--dsw-alias-label-primary-foreground,#fff);}',
      '.arc-btn.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#43454a);}',
      '.arc-btn.ghost{background:transparent;border-color:var(--dsw-alias-border-l4,rgba(127,127,127,.28));color:var(--dsw-alias-label-secondary,#8a8a8a);font-weight:500;}',
      '.arc-btn.ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));color:var(--dsw-alias-label-primary,CanvasText);}',
      '.arc-btn.ghost.danger{color:var(--dsw-alias-state-error-primary,#d64545);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d64545) 42%,transparent);}',
      '.arc-btn.ghost.danger:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d64545) 12%,transparent);color:var(--dsw-alias-state-error-primary,#d64545);}',
      /* 管理面板按钮（锚点）：视觉同主按钮，语义是导航 */
      '.arc-link{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 14px;text-decoration:none;border-radius:var(--dsw-radius-md,6px);background:var(--dsw-alias-button-primary-fill,#1b1b1c);color:var(--dsw-alias-label-primary-foreground,#fff);font-size:var(--dsw-font-xs-13-font-size,13px);line-height:1;font-weight:600;white-space:nowrap;transition:background 140ms ease,transform 140ms ease;}',
      '.arc-link:hover{background:var(--dsw-alias-button-primary-hover,#43454a);}',
      '.arc-link:active{transform:translateY(1px);}',
      '.arc-link:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176e6));outline-offset:2px;}',
      '.arc-link>svg{width:13px;height:13px;display:block;flex:none;}',

      /* 全局错误条 */
      '.arc-alert{display:flex;align-items:flex-start;gap:8px;padding:9px 11px;margin-bottom:12px;border-radius:var(--dsw-radius-md,6px);border:.5px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#d64545) 32%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d64545) 10%,transparent);color:var(--dsw-alias-state-error-primary,#d64545);font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;}',

      /* 模型同步条 */
      '.arc-headSide{display:flex;align-items:center;gap:8px;flex:none;}',
      '.arc-sync-btn{white-space:nowrap;}',
      '.arc-sync-note{margin:0 0 12px;padding:9px 11px;border-radius:var(--dsw-radius-md,6px);border:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));background:var(--dsw-alias-bg-layer-1,transparent);}',
      '.arc-sync-line{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;color:var(--dsw-alias-label-secondary,#5c5c5c);}',
      '.arc-sync-line.ok{color:var(--dsw-alias-state-success-primary,#2ea44f);}',
      '.arc-sync-line.err{color:var(--dsw-alias-state-error-primary,#d64545);}',
      '.arc-sync-hint{margin-top:4px;font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;color:var(--dsw-alias-label-tertiary,#6b6b6b);}',

      /* 底部说明 */
      '.arc-foot{margin-top:12px;padding-top:10px;border-top:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;color:var(--dsw-alias-label-tertiary,#6b6b6b);}',

      /* 生图/生视频通道（goal-58ba6a2c） */
      '.arc-media{margin-top:14px;padding-top:14px;border-top:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));display:flex;flex-direction:column;gap:10px;}',
      '.arc-mediaHead{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;}',
      '.arc-mediaTitle{font-size:var(--dsw-font-xs-strong-13-font-size,13px);line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary,CanvasText);}',
      '.arc-mediaDesc{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;color:var(--dsw-alias-label-tertiary,#6b6b6b);}',
      '.arc-mediaKind{display:inline-flex;border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.28));border-radius:var(--dsw-radius-md,6px);overflow:hidden;flex:none;align-self:flex-start;}',
      '.arc-mediaKind button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#8a8a8a);font-family:inherit;font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:1;padding:7px 14px;cursor:pointer;transition:background 140ms ease,color 140ms ease;}',
      '.arc-mediaKind button+button{border-left:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.28));}',
      '.arc-mediaKind button[aria-pressed="true"]{background:var(--dsw-alias-button-primary-fill,#1b1b1c);color:var(--dsw-alias-label-primary-foreground,#fff);font-weight:600;}',
      '.arc-mediaForm{display:grid;grid-template-columns:1fr 1fr;gap:10px;}',
      '.arc-mediaForm>.arc-field.arc-prompt{grid-column:1/-1;}',
      '.arc-mediaTextarea{width:100%;min-height:74px;max-height:180px;resize:vertical;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.28));border-radius:var(--dsw-radius-md,6px);background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,CanvasText);font-family:inherit;font-size:var(--dsw-font-s-14-font-size,14px);line-height:22px;outline:none;}',
      '.arc-mediaSize{display:flex;align-items:center;gap:8px;width:100%;}',
      '.arc-mediaSize>.arc-input{flex:1;min-width:0;text-align:center;}',
      '.arc-mediaX{flex:none;color:var(--dsw-alias-label-tertiary,#6b6b6b);font-size:var(--dsw-font-s-14-font-size,14px);line-height:1;}',
      '.arc-mediaTextarea:focus{border-color:var(--dsw-alias-state-business-primary,#4176e6);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 18%,transparent);}',
      '.arc-mediaActions{display:flex;align-items:center;gap:10px;grid-column:1/-1;}',
      '.arc-mediaNote{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;color:var(--dsw-alias-label-tertiary,#6b6b6b);}',
      '.arc-mediaResult{margin-top:4px;display:flex;flex-direction:column;gap:8px;}',
      '.arc-mediaPreview{max-width:100%;border-radius:var(--dsw-radius-md,6px);border:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));}',
      '.arc-mediaVideo{width:100%;max-width:420px;border-radius:var(--dsw-radius-md,6px);border:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));}',
      '.arc-mediaLink{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;color:var(--dsw-alias-state-business-primary,#4176e6);word-break:break-all;}',
      '.arc-mediaOk{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;color:var(--dsw-alias-state-success-primary,#2ea44f);}',
      '.arc-mediaErr{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;color:var(--dsw-alias-state-error-primary,#d64545);}',
    ].join('')

    // ── 小工具 ──────────────────────────────────────────────────────────────
    const EMPTY_DRAFT = { ak: '', sk: '', baseUrl: '', authorization: '' }

    /**
     * 路由状态推导：托管路由只认 health，签名路由看 configured（它没有上游探测）。
     * @param {Object} route 路由快照（含 credentialKind / configured / health）
     * @returns {{tone: 'ok'|'err'|'', key: string}}
     */
    function routeStatus(route) {
      const health = route && route.health
      const checked = Boolean(health && health.checked)
      if (checked) {
        return health.ok ? { tone: 'ok', key: 'status.up' } : { tone: 'err', key: 'status.down' }
      }
      if (!route || !route.configured) return { tone: '', key: 'status.unconfigured' }
      // 签名路由没有上游探测端点：已配置即『就绪』，但徽章文案说「已就绪」而不是「可用」，
      // 不替上游打包票，也不把它排除在汇总计数之外。
      return { tone: 'ok', key: 'status.saved' }
    }

    /**
     * 登录面板跳转（锚点语义 + 主按钮视觉）。
     * @param {Object} props
     * @param {React} props.React 已注入的 React factory
     * @param {string} props.href 上游管理面板地址
     * @param {string} props.label 按钮文案
     * @returns {React.ReactElement}
     */
    function PanelLink(props) {
      const React = props.React
      const icon = React.createElement(
        'svg',
        {
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        React.createElement('path', { d: 'M15 3h6v6' }),
        React.createElement('path', { d: 'M10 14 21 3' }),
        React.createElement('path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }),
      )
      return React.createElement(
        'a',
        { href: props.href, target: '_blank', rel: 'noreferrer', className: 'arc-link' },
        icon,
        React.createElement('span', null, props.label),
      )
    }

    /**
     * 生图/生视频通道（goal-58ba6a2c）。挂在支持 media 的路由 pane 底部，直连上游媒体端点，
     * 绕过 chat 清单——生图/生视频模型不该被当聊天模型发到 /v1/chat/completions。
     *
     * 表单按 media.images / media.videos 动态切换；结果展示 image 用 <img>、video 用 <video>，
     * 其余（task/async/空 data）都退成链接。生成动作走 onGenerate（宿主 /api/api-rules/media-generate）。
     *
     * @param {Object} props
     * @param {React} props.React 已注入的 React factory
     * @param {(key: string, vars?: Object) => string} props.t 本地化
     * @param {string} props.routeId 目标路由 id
     * @param {{images: string[], videos: string[]}} props.media 该路由的媒体通道声明
     * @param {Object|null} props.health 上游健康状态（null = 未探测）
     * @param {(routeId: string, kind: 'images'|'videos', payload: Object) => Promise<Object>} props.onGenerate
     * @returns {React.ReactElement|null} 无媒体通道时返回 null，pane 不挂载
     */
    function MediaSection(props) {
      const React = props.React
      const t = props.t
      const media = props.media || { images: [], videos: [] }
      const { useState } = React
      const initialKind = media.images && media.images.length > 0 ? 'images' : media.videos && media.videos.length > 0 ? 'videos' : null
      const [kind, setKind] = useState(initialKind)
      const [model, setModel] = useState('')
      const [prompt, setPrompt] = useState('')
      const [width, setWidth] = useState('1024')
      const [height, setHeight] = useState('1024')
      const [duration, setDuration] = useState('6')
      const [busy, setBusy] = useState(false)
      const [result, setResult] = useState(null) // { kind, url, raw, seconds, error }

      if (!initialKind) return null
      const models = (kind === 'images' ? media.images : media.videos) || []
      const currentModel = model && models.includes(model) ? model : (models[0] || '')
      const health = props.health || null
      const upstreamDown = Boolean(health && health.checked === true && health.ok !== true)

      const switchKind = (next) => {
        if (next === kind) return
        setKind(next)
        setResult(null)
      }

      const generate = async () => {
        if (busy) return
        if (!prompt.trim()) return
        setBusy(true)
        setResult(null)
        const startedAt = Date.now()
        const payload = { model: currentModel, prompt: prompt.trim() }
        if (kind === 'images') {
          payload.size = width.trim() + 'x' + height.trim()
        } else {
          const seconds = Number(duration)
          if (Number.isFinite(seconds) && seconds > 0) payload.duration = Math.round(seconds)
        }
        try {
          const raw = await props.onGenerate(props.routeId, kind, payload)
          const seconds = Math.round((Date.now() - startedAt) / 1000)
          const url = extractMediaUrl(raw, kind)
          setResult({ kind, url, raw, seconds, error: '' })
        } catch (e) {
          setResult({ kind, url: '', raw: null, seconds: Math.round((Date.now() - startedAt) / 1000), error: String((e && e.message) || e) })
        } finally {
          setBusy(false)
        }
      }

      const kindTabs = []
      if (media.images && media.images.length > 0) kindTabs.push('images')
      if (media.videos && media.videos.length > 0) kindTabs.push('videos')

      const noteKey = kind === 'images' ? 'media.note.image' : 'media.note.video'
      return React.createElement(
        'div',
        { className: 'arc-media' },
        React.createElement(
          'div',
          { className: 'arc-mediaHead' },
          React.createElement('div', { className: 'arc-mediaTitle' }, t('media.title')),
          React.createElement('div', { className: 'arc-mediaDesc' }, t('media.desc')),
        ),
        kindTabs.length > 1
          ? React.createElement(
              'div',
              { className: 'arc-mediaKind', role: 'group' },
              kindTabs.map((k) =>
                React.createElement(
                  'button',
                  { key: k, type: 'button', 'aria-pressed': k === kind ? 'true' : 'false', onClick: () => switchKind(k) },
                  t(k === 'images' ? 'media.kind.images' : 'media.kind.videos'),
                ),
              ),
            )
          : null,
        React.createElement(
          'div',
          { className: 'arc-mediaForm' },
          React.createElement(
            'div',
            { className: 'arc-field' },
            React.createElement('label', { className: 'arc-label' }, t('media.model')),
            React.createElement(
              'select',
              {
                className: 'arc-input',
                value: currentModel,
                onChange: (e) => setModel(e.target.value),
                disabled: busy,
              },
              models.map((id) => React.createElement('option', { key: id, value: id }, id)),
            ),
          ),
          kind === 'images'
            ? React.createElement(
                'div',
                { className: 'arc-field' },
                React.createElement('label', { className: 'arc-label' }, t('media.size')),
                React.createElement(
                  'div',
                  { className: 'arc-mediaSize' },
                  React.createElement('input', {
                    className: 'arc-input',
                    type: 'number',
                    min: '64',
                    max: '4096',
                    step: '64',
                    value: width,
                    onChange: (e) => setWidth(e.target.value),
                    'aria-label': t('media.width'),
                    disabled: busy,
                  }),
                  React.createElement('span', { className: 'arc-mediaX', 'aria-hidden': 'true' }, '×'),
                  React.createElement('input', {
                    className: 'arc-input',
                    type: 'number',
                    min: '64',
                    max: '4096',
                    step: '64',
                    value: height,
                    onChange: (e) => setHeight(e.target.value),
                    'aria-label': t('media.height'),
                    disabled: busy,
                  }),
                ),
              )
            : React.createElement(
                'div',
                { className: 'arc-field' },
                React.createElement('label', { className: 'arc-label' }, t('media.duration')),
                React.createElement('input', {
                  className: 'arc-input',
                  type: 'number',
                  min: '1',
                  max: '60',
                  value: duration,
                  onChange: (e) => setDuration(e.target.value),
                  disabled: busy,
                }),
              ),
          React.createElement(
            'div',
            { className: 'arc-field arc-prompt' },
            React.createElement('label', { className: 'arc-label' }, t('media.prompt')),
            React.createElement('textarea', {
              className: 'arc-mediaTextarea',
              value: prompt,
              onChange: (e) => setPrompt(e.target.value),
              placeholder: t('media.promptPlaceholder'),
              disabled: busy,
            }),
          ),
          React.createElement(
            'div',
            { className: 'arc-mediaActions' },
            React.createElement(
              'button',
              { className: 'arc-btn primary', type: 'button', onClick: generate, disabled: busy || !prompt.trim() || upstreamDown },
              busy ? t('media.generating') : t('media.generate'),
            ),
            React.createElement('div', { className: 'arc-mediaNote' }, t(noteKey)),
          ),
        ),
        upstreamDown ? React.createElement('div', { className: 'arc-mediaErr' }, t('media.upstreamDown', { status: health.status || '?' })) : null,
        result
          ? React.createElement(MediaResult, { React, t, result })
          : React.createElement('div', { className: 'arc-mediaNote' }, t('media.empty')),
      )
    }

    /**
     * 从 media-generate 回包里取可展示地址。上游格式各异：标准 OpenAI {data:[{url}]}、
     * minimax 视频 {url} 或 {video:{url}}，慢档返回 {task,status} 无 url——后者退成链接展示。
     * @param {Object} raw media-generate 的 JSON 回包
     * @param {'images'|'videos'} kind
     * @returns {string}
     */
    function extractMediaUrl(raw, kind) {
      if (!raw || typeof raw !== 'object') return ''
      if (typeof raw.url === 'string' && raw.url) return raw.url
      if (typeof raw.video_url === 'string' && raw.video_url) return raw.video_url
      if (raw.video && typeof raw.video.url === 'string') return raw.video.url
      if (raw.video && typeof raw.video.video_url === 'string') return raw.video.video_url
      if (Array.isArray(raw.data) && raw.data.length > 0) {
        const first = raw.data[0]
        if (typeof first === 'string') return first
        if (first && typeof first.url === 'string') return first.url
        if (first && typeof first.b64_json === 'string') return 'data:image/png;base64,' + first.b64_json
      }
      return ''
    }

    /**
     * 生成结果展示：图片 <img>、视频 <video>、其余退成链接或 task 文案。
     * @param {Object} props { React, t, result:{kind,url,raw,seconds,error} }
     * @returns {React.ReactElement}
     */
    function MediaResult(props) {
      const React = props.React
      const t = props.t
      const r = props.result
      if (r.error) return React.createElement('div', { className: 'arc-mediaErr' }, t('media.error', { message: r.error }))
      const successLine = r.url
        ? t(r.kind === 'images' ? 'media.success.image' : 'media.success.video', { seconds: r.seconds })
        : t('media.success.async', {
            taskId: (r.raw && (r.raw.task_id || r.raw.taskId || r.raw.id)) || '?',
            status: (r.raw && r.raw.status) || '?',
          })
      const preview = r.url
        ? r.kind === 'images'
          ? React.createElement('img', { className: 'arc-mediaPreview', src: r.url, alt: '' })
          : React.createElement('video', { className: 'arc-mediaVideo', src: r.url, controls: true })
        : null
      return React.createElement(
        'div',
        { className: 'arc-mediaResult' },
        React.createElement('div', { className: 'arc-mediaTitle' }, t('media.result')),
        React.createElement('div', { className: 'arc-mediaOk' }, successLine),
        preview,
        r.url
          ? React.createElement('a', { className: 'arc-mediaLink', href: r.url, target: '_blank', rel: 'noreferrer' }, t('media.download'))
          : null,
      )
    }

    function ApiRulesCard(props) {
      const React = props.React
      const t = props.t
      const { useState, useEffect, useRef, useCallback } = React

      // routes: 路由列表（服务端顺序即标签顺序）
      // saved: routeId -> 快照（掩码 / health / adminUrl …，永不含明文）
      // drafts: routeId -> { ak, sk, baseUrl, authorization } 纯本地
      // errors: routeId -> { field, message }
      const [routes, setRoutes] = useState([])
      const [saved, setSaved] = useState({})
      const [drafts, setDrafts] = useState({})
      const [errors, setErrors] = useState({})
      const [global, setGlobal] = useState('')
      /**
       * 前置层监听状态（服务端回传的 data.proxy）。
       *
       * 2026-11-08 的事故里，六条 API 全断而这张卡片完全正常——它读的是配置，
       * 配置确实没错，错的是「端口没起来」。监听挂了必须在这里显式报警。
       */
      const [proxyDown, setProxyDown] = useState(null)
      const [busy, setBusy] = useState('') // '' | 'save:<id>' | 'clear:<id>' | 'clear:<id>:go'
      const [tab, setTab] = useState('')
      /** 最近一次模型同步摘要（accounts 端点回传的 data.modelSync）。 */
      const [modelSync, setModelSync] = useState(null)
      const [syncBusy, setSyncBusy] = useState(false)
      /** 手动同步的即时反馈：{ text, ok } 或 null。 */
      const [syncFlash, setSyncFlash] = useState(null)
      const alive = useRef(true)
      const confirmTimer = useRef(null)

      const safeSet = (setter) => (value) => {
        if (alive.current) setter(value)
      }

      const load = useCallback(async () => {
        try {
          const res = await fetch('/api/api-rules/accounts')
          if (!res.ok) throw new Error('HTTP ' + res.status)
          const data = await res.json()
          const list = Array.isArray(data.routes) ? data.routes : []
          if (!alive.current) return
          const map = {}
          for (const r of list) {
            map[r.id] = {
              configured: Boolean(r.configured),
              akHint: r.akHint || '',
              skHint: r.skHint || '',
              // 'aksk'（签名器路由）/ 'endpoint'（自带凭据：地址 + Authorization）/ 'managed'
              credentialKind: r.credentialKind || undefined,
              baseUrl: r.baseUrl || '',
              authorizationHint: r.authorizationHint || '',
              // 管理面板地址（patch 里的 adminUrl）；缺了它就不要渲染跳转按钮。
              adminUrl: typeof r.adminUrl === 'string' ? r.adminUrl : '',
              autoLaunched: Boolean(r.autoLaunched),
              updatedAt: r.updatedAt ?? null,
              models: typeof r.models === 'number' ? r.models : 0,
              needsCredential: Boolean(r.needsCredential),
              health: r.health || null,
            }
          }
          setRoutes(list)
          setSaved(map)
          setGlobal('')
          // 旧宿主不返回 proxy 键：undefined 表示「不知道」，不报警。
          const proxy = data.proxy
          setProxyDown(proxy && proxy.listening === false ? { port: proxy.port, error: proxy.error || '' } : null)
          setModelSync(data.modelSync || null)
        } catch (e) {
          if (!alive.current) return
          // 端点缺失时退化为单一 codearts 分区，保证卡片起码可填。
          setRoutes([{ id: 'codearts', label: 'CodeArts', needsCredential: true, credentialKind: 'aksk' }])
          setSaved({
            codearts: {
              configured: false,
              akHint: '',
              skHint: '',
              credentialKind: 'aksk',
              baseUrl: '',
              authorizationHint: '',
              adminUrl: '',
              autoLaunched: false,
              updatedAt: null,
              models: 0,
              needsCredential: true,
              health: null,
            },
          })
          setGlobal(t('error.load', { message: String((e && e.message) || e) }))
        }
      }, [t])

      useEffect(() => {
        alive.current = true
        load()
        const poll = setInterval(load, 60000)
        return () => {
          alive.current = false
          clearInterval(poll)
          if (confirmTimer.current) clearTimeout(confirmTimer.current)
        }
      }, [load])

      const setDraft = useCallback(
        (id, patch) =>
          safeSet(setDrafts)((prev) => ({ ...prev, [id]: { ...EMPTY_DRAFT, ...prev[id], ...patch } })),
        [],
      )
      const setError = useCallback((id, err) => safeSet(setErrors)((prev) => ({ ...prev, [id]: err })), [])
      const clearError = useCallback(
        (id) =>
          safeSet(setErrors)((prev) => {
            const next = { ...prev }
            delete next[id]
            return next
          }),
        [],
      )

      const onSave = useCallback(
        async (id) => {
          const draft = drafts[id] || EMPTY_DRAFT
          const snap = saved[id] || {}
          const endpoint = snap.credentialKind === 'endpoint'
          let payload
          if (endpoint) {
            // 自带凭据路由：地址必须合法；已保存过时 Authorization 允许留空 = 不更改。
            const baseUrl = draft.baseUrl.trim() !== '' ? draft.baseUrl.trim() : snap.baseUrl || ''
            if (!/^https?:\/\//iu.test(baseUrl)) {
              setError(id, { field: 'baseUrl', message: t('error.baseUrlRequired') })
              return
            }
            if (draft.authorization.trim() === '' && !snap.configured) {
              setError(id, { field: 'authorization', message: t('error.authRequired') })
              return
            }
            payload = { baseUrl, authorization: draft.authorization.trim() }
          } else {
            if (draft.ak.trim() === '' || draft.sk.trim() === '') {
              setError(id, { field: 'route', message: t('error.bothRequired') })
              return
            }
            payload = { ak: draft.ak, sk: draft.sk }
          }
          clearError(id)
          setBusy('save:' + id)
          try {
            const res = await fetch('/api/api-rules/account?route=' + encodeURIComponent(id), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })
            if (!res.ok) {
              const body = await res.json().catch(() => ({}))
              throw new Error(body.error || 'HTTP ' + res.status)
            }
            setDraft(id, { ...EMPTY_DRAFT })
            await load()
          } catch (e) {
            setError(id, { field: 'route', message: t('error.save', { message: String((e && e.message) || e) }) })
          } finally {
            if (alive.current) setBusy('')
          }
        },
        [drafts, saved, load, t, setDraft, setError, clearError],
      )

      const onClear = useCallback(
        async (id) => {
          if (busy === 'clear:' + id) {
            // 二次确认已呈现，本次点击执行删除（不用 window.confirm）。
            if (confirmTimer.current) clearTimeout(confirmTimer.current)
            setBusy('clear:' + id + ':go')
            try {
              const res = await fetch('/api/api-rules/account?route=' + encodeURIComponent(id), { method: 'DELETE' })
              if (!res.ok) throw new Error('HTTP ' + res.status)
              setDraft(id, { ...EMPTY_DRAFT })
              await load()
            } catch (e) {
              setError(id, { field: 'route', message: t('error.clear', { message: String((e && e.message) || e) }) })
            } finally {
              if (alive.current) setBusy('')
            }
            return
          }
          // 首次点击：原地变成「确认清除」，5 秒无操作自动回退。
          setBusy('clear:' + id)
          if (confirmTimer.current) clearTimeout(confirmTimer.current)
          confirmTimer.current = setTimeout(() => {
            if (alive.current) setBusy('')
          }, 5000)
        },
        [busy, load, t, setDraft, setError],
      )

      /** 手动触发一次「同步可用模型」：POST 后回显结果并重载 accounts 摘要。 */
      const onSync = useCallback(
        async () => {
          if (syncBusy) return
          setSyncBusy(true)
          setSyncFlash(null)
          try {
            const res = await fetch('/api/api-rules/models-sync', { method: 'POST' })
            const body = await res.json().catch(() => ({}))
            if (!res.ok || body.ok === false) throw new Error(body.error || 'HTTP ' + res.status)
            safeSet(setSyncFlash)({
              ok: true,
              text: t('sync.done', {
                added: String((body.added || []).length),
                removed: String((body.removed || []).length),
                skipped: String((body.skipped || []).length),
              }),
            })
            await load()
          } catch (e) {
            safeSet(setSyncFlash)({ ok: false, text: t('sync.fail', { message: String((e && e.message) || e) }) })
          } finally {
            if (alive.current) setSyncBusy(false)
          }
        },
        [syncBusy, load, t],
      )

      const activeTab = tab && routes.some((r) => r.id === tab) ? tab : (routes[0] && routes[0].id) || ''
      const active = routes.find((r) => r.id === activeTab)

      // 标签名 / 分区标题共用同一套本地化名称；字典缺失时回落到 route.label。
      const tabName = (route) => {
        const key = 'tab.' + route.id
        const localized = t(key)
        return typeof localized === 'string' && localized !== key ? localized : route.label || route.id
      }
      const paneName = (route) => {
        const key = 'name.' + route.id
        const localized = t(key)
        return typeof localized === 'string' && localized !== key ? localized : route.label || route.id
      }
      const routeText = (id, field, fallbackKey) => {
        const key = field === 'panelNote' ? 'panel.note.' + id : 'panel.title'
        const localized = t(key)
        if (typeof localized === 'string' && localized !== key) return localized
        return fallbackKey ? t(fallbackKey) : ''
      }

      // 顶部汇总：可用 = health 通过，或签名路由已配置
      const okCount = routes.filter((r) => routeStatus(saved[r.id] || r).tone === 'ok').length
      const snapshotOf = (id) =>
        saved[id] || {
          configured: false,
          akHint: '',
          skHint: '',
          credentialKind: undefined,
          baseUrl: '',
          authorizationHint: '',
          adminUrl: '',
          autoLaunched: false,
          updatedAt: null,
          models: 0,
          needsCredential: false,
          health: null,
        }

      /**
       * 生图/生视频生成（goal-58ba6a2c）。同源调宿主 /api/api-rules/media-generate，
       * 由宿主侧转发到插件网关 media()、再到上游 images/videos/generations。
       * 上游非 2xx 时宿主把 JSON 原样回传（{error:...}），这里统一抛 Error 让 MediaSection 展示。
       * @param {string} routeId 目标路由 id
       * @param {'images'|'videos'} kind
       * @param {Object} payload { model, prompt, size? | duration? }
       * @returns {Promise<Object>} 上游 JSON 回包
       */
      const generateMedia = async (routeId, kind, payload) => {
        const res = await fetch('/api/api-rules/media-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ routeId, kind, payload }),
        })
        let json = null
        try {
          json = await res.json()
        } catch {
          json = null
        }
        if (!res.ok) {
          const message = json && json.error ? json.error : 'HTTP ' + res.status
          throw new Error(message)
        }
        return json
      }

      const syncButton = React.createElement(
        'button',
        {
          type: 'button',
          className: 'arc-btn ghost arc-sync-btn',
          onClick: onSync,
          disabled: syncBusy,
        },
        syncBusy ? t('sync.running') : t('sync.button'),
      )

      const header = React.createElement(
        'div',
        { className: 'arc-head' },
        React.createElement(
          'div',
          { className: 'arc-headMain' },
          React.createElement('div', { className: 'arc-title' }, t('card.title')),
          React.createElement('div', { className: 'arc-sub' }, t('card.subtitle')),
        ),
        React.createElement(
          'div',
          { className: 'arc-headSide' },
          routes.length > 0
            ? React.createElement(
                'div',
                { className: 'arc-chip' },
                React.createElement('span', { className: 'arc-chip__dot' + (okCount === 0 ? ' idle' : ''), 'aria-hidden': 'true' }),
                React.createElement(
                  'span',
                  null,
                  okCount === routes.length
                    ? t('card.chipAll', { total: String(routes.length) })
                    : t('card.chip', { ok: String(okCount), total: String(routes.length) }),
                ),
              )
            : null,
          syncButton,
        ),
      )

      const syncLine = syncFlash
        ? syncFlash.text
        : modelSync
          ? t('sync.last', {
              added: String((modelSync.added || []).length),
              removed: String((modelSync.removed || []).length),
            })
          : t('sync.idle')
      const syncNote = React.createElement(
        'div',
        { className: 'arc-sync-note' },
        React.createElement(
          'div',
          { className: 'arc-sync-line' + (syncFlash ? (syncFlash.ok ? ' ok' : ' err') : '') },
          syncLine,
        ),
        React.createElement('div', { className: 'arc-sync-hint' }, t('sync.hint')),
      )

      const tabs = React.createElement(
        'div',
        { className: 'arc-tabs', role: 'tablist' },
        ...routes.map((r) => {
          const st = routeStatus(snapshotOf(r.id))
          return React.createElement(
            'button',
            {
              key: r.id,
              type: 'button',
              role: 'tab',
              'aria-selected': r.id === activeTab ? 'true' : 'false',
              className: 'arc-tab',
              onClick: () => safeSet(setTab)(r.id),
            },
            React.createElement('span', { className: 'arc-tab__dot' + (st.tone ? ' ' + st.tone : ''), 'aria-hidden': 'true' }),
            tabName(r),
          )
        }),
      )

      const alert = global
        ? React.createElement('div', { className: 'arc-alert', role: 'alert' }, global)
        : proxyDown
          ? React.createElement(
              'div',
              { className: 'arc-alert', role: 'alert' },
              t('alert.proxyDown', {
                port: String(proxyDown.port ?? ''),
                error: proxyDown.error ? '：' + proxyDown.error : '',
              }),
            )
          : null

      // ── 当前分区 ──────────────────────────────────────────────────────────
      let pane = null
      if (!active) {
        pane = React.createElement(
          'div',
          { className: 'arc-pane' },
          React.createElement('div', { className: 'arc-paneDesc' }, t('empty.none')),
        )
      } else {
        const id = active.id
        const snap = snapshotOf(id)
        const draft = drafts[id] || EMPTY_DRAFT
        const err = errors[id]
        const st = routeStatus(snap)
        const endpoint = snap.credentialKind === 'endpoint'
        const managed = snap.credentialKind === 'managed' || (snap.credentialKind === undefined && !snap.needsCredential)
        const isCredential = Boolean(snap.needsCredential) && !managed

        // 「脏」判定：地址被改成别的值，或填了新凭据。
        const baseUrlValue = draft.baseUrl !== '' ? draft.baseUrl : snap.baseUrl || ''
        const dirty = endpoint
          ? baseUrlValue.trim() !== String(snap.baseUrl || '').trim() || draft.authorization.trim() !== ''
          : draft.ak.trim() !== '' || draft.sk.trim() !== ''
        const isBusySave = busy === 'save:' + id
        const isBusyClear = busy === 'clear:' + id || busy === 'clear:' + id + ':go'
        const canSave = dirty && !err && busy === ''

        const field = (key, labelText, placeholder, value, invalid, type) =>
          React.createElement(
            'div',
            { className: 'arc-field' },
            React.createElement(
              'div',
              { className: 'arc-fieldTop' },
              React.createElement('div', { className: 'arc-label' }, labelText),
              snap.configured && (snap.akHint || snap.skHint || snap.authorizationHint)
                ? React.createElement(
                    'div',
                    { className: 'arc-mask' },
                    t('mask.saved', {
                      hint:
                        key === 'ak'
                          ? snap.akHint || ''
                          : key === 'sk'
                            ? snap.skHint || ''
                            : key === 'authorization'
                              ? '••••'
                              : '',
                    }),
                  )
                : null,
            ),
            React.createElement('input', {
              className: 'arc-input' + (invalid ? ' invalid' : ''),
              type: type || 'password',
              value,
              placeholder,
              autoComplete: 'off',
              spellCheck: false,
              'aria-invalid': invalid ? 'true' : 'false',
              onChange: (e) => {
                clearError(id)
                setDraft(id, { [key]: e.target.value })
              },
            }),
            err && err.field === key
              ? React.createElement('div', { className: 'arc-fieldError' }, err.message)
              : null,
          )

        const actions = React.createElement(
          'div',
          { className: 'arc-actions' },
          snap.configured
            ? React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'arc-btn ghost' + (busy === 'clear:' + id ? ' danger' : ''),
                  onClick: () => onClear(id),
                  disabled: busy !== '' && !isBusyClear,
                },
                isBusyClear
                  ? busy === 'clear:' + id + ':go'
                    ? t('action.clearing')
                    : t('action.clearConfirm')
                  : t('action.clear'),
              )
            : null,
          React.createElement(
            'button',
            { type: 'button', className: 'arc-btn primary', onClick: () => onSave(id), disabled: !canSave },
            isBusySave ? t('action.saving') : t('action.save'),
          ),
        )

        let body
        const panelUrl = typeof snap.adminUrl === 'string' ? snap.adminUrl.trim() : ''

        if (managed) {
          // 托管 / 透传路由：账号与登录都在上游自己的面板里完成，本插件不收集任何密钥。
          body = React.createElement(
            'div',
            { className: 'arc-fields' },
            panelUrl !== ''
              ? React.createElement(
                  'div',
                  { className: 'arc-panel' },
                  React.createElement(
                    'span',
                    { className: 'arc-panel__icon', 'aria-hidden': 'true' },
                    React.createElement(
                      'svg',
                      { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
                      React.createElement('rect', { x: 3, y: 11, width: 18, height: 11, rx: 2 }),
                      React.createElement('path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }),
                    ),
                  ),
                  React.createElement(
                    'div',
                    { className: 'arc-panel__text' },
                    React.createElement('div', { className: 'arc-panel__title' }, routeText(id, 'panelTitle', 'panel.title')),
                    React.createElement(
                      'div',
                      { className: 'arc-panel__note' },
                      routeText(id, 'panelNote', 'panel.note.default'),
                    ),
                  ),
                  React.createElement(PanelLink, { React, href: panelUrl, label: t('panel.open') }),
                )
              : React.createElement('div', { className: 'arc-paneDesc' }, t('panel.missing')),
          )
        } else if (endpoint) {
          body = React.createElement(
            'div',
            { className: 'arc-fields' },
            React.createElement('div', { className: 'arc-paneDesc' }, t('field.endpointDesc')),
            field('baseUrl', t('field.baseUrl'), t('ph.baseUrl'), baseUrlValue, Boolean(err && err.field === 'baseUrl'), 'text'),
            field(
              'authorization',
              t('field.authorization'),
              snap.configured ? t('ph.saved') : t('ph.authorization'),
              draft.authorization,
              Boolean(err && err.field === 'authorization'),
            ),
          )
        } else {
          body = React.createElement(
            'div',
            { className: 'arc-fields' },
            field(
              'ak',
              t('field.ak'),
              snap.configured ? t('ph.saved') : t('ph.ak'),
              draft.ak,
              Boolean(err && err.field === 'ak'),
            ),
            field(
              'sk',
              t('field.sk'),
              snap.configured ? t('ph.saved') : t('ph.sk'),
              draft.sk,
              Boolean(err && err.field === 'sk'),
            ),
          )
        }

        // 元信息行：模型数 + 是否插件自动拉起（只有有值时才渲染，避免空分隔符）
        const metaBits = []
        if (snap.models > 0) metaBits.push(t('meta.models', { n: String(snap.models) }))
        if (snap.autoLaunched) metaBits.push(t('meta.autolaunch'))
        const meta =
          metaBits.length > 0
            ? React.createElement(
                'div',
                { className: 'arc-meta' },
                ...metaBits.flatMap((text, i) =>
                  i === 0
                    ? [React.createElement('span', { key: 'm' + i }, text)]
                    : [
                        React.createElement('span', { key: 's' + i, className: 'arc-meta__sep', 'aria-hidden': 'true' }),
                        React.createElement('span', { key: 'm' + i }, text),
                      ],
                ),
              )
            : null

        const paneDescKey = 'desc.' + id
        const paneDesc = t(paneDescKey)
        const hasDesc = typeof paneDesc === 'string' && paneDesc !== paneDescKey

        pane = React.createElement(
          'div',
          { className: 'arc-pane', role: 'tabpanel' },
          React.createElement(
            'div',
            { className: 'arc-paneHead' },
            React.createElement(
              'div',
              { style: { minWidth: 0 } },
              React.createElement('div', { className: 'arc-paneTitle' }, paneName(active)),
              hasDesc ? React.createElement('div', { className: 'arc-paneDesc' }, paneDesc) : null,
            ),
            React.createElement(
              'span',
              { className: 'arc-badge' + (st.tone ? ' ' + st.tone : '') },
              React.createElement('span', { className: 'arc-badge__dot', 'aria-hidden': 'true' }),
              t(st.key),
            ),
          ),
          meta,
          body,
          active && active.media
            ? React.createElement(MediaSection, {
                React,
                t,
                routeId: active.id,
                media: active.media,
                health: (saved[active.id] && saved[active.id].health) || (active.health || null),
                onGenerate: generateMedia,
              })
            : null,
          err && err.field === 'route' ? React.createElement('div', { className: 'arc-fieldError' }, err.message) : null,
          isCredential ? actions : null,
        )
      }

      return React.createElement(
        'div',
        { className: 'arc' },
        React.createElement('style', null, CSS),
        header,
        syncNote,
        tabs,
        alert,
        pane,
        React.createElement('div', { className: 'arc-foot' }, t('foot')),
      )
    }

    function apply(ctx) {
      try {
        const namespace = 'settings.api-rules'
        ctx.effect(() => ctx.locale.register(namespace, { zh, en }), 'dsh-api-rules: settings copy')
        const t = ctx.locale.bind(namespace)
        const React = require('react')
        ctx.slots.inject('plugins.bundle.config', () =>
          ctx.slots.register(
            { name: 'plugins.bundle.config', key: '@local/dsh-api-rules', locale: namespace },
            () => React.createElement(ApiRulesCard, { React, t }),
          ),
        )
      } catch (e) {
        console.error('[dsh-api-rules] client apply failed:', e)
      }
    }

    return { apply, inject, name }
  },
})

