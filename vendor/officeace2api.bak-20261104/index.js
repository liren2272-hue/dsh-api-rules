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

      'panel.title': '管理面板',
      'panel.note.officeace': '链接已带好口令，点开即可管理账号。',
      'panel.note.cline': '免费模型提示账号不足时，在这里添加 Cline 账号。',
      'panel.note.raccoon': '首次进入要填一次管理密钥：raccoon-local-admin，填过就不再询问。',
      'panel.note.default': '账号与登录都在这个面板里完成。',
      'panel.open': '打开管理面板',
      'panel.missing': '这条路由还没配置管理面板地址。',

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

      'error.bothRequired': 'AK 和 SK 要同时填写',
      'error.baseUrlRequired': '网关地址要以 http:// 或 https:// 开头',
      'error.authRequired': 'Authorization 不能为空',
      'error.load': '读取账号失败：{message}',
      'error.save': '保存失败：{message}',
      'error.clear': '清除失败：{message}',

      'empty.none': '还没有可配置的 API。',
      'foot': '凭据只保存在本机 ~/.dsh/.api-rules/accounts.json，卸载插件即彻底清除，不会写进插件配置。',
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

      'panel.title': 'Admin panel',
      'panel.note.officeace': 'The link already carries the token — just open it.',
      'panel.note.cline': 'Add a Cline account here when a free model reports no account.',
      'panel.note.raccoon': 'The first visit asks for the management key: raccoon-local-admin.',
      'panel.note.default': 'Accounts and login are handled in this panel.',
      'panel.open': 'Open admin panel',
      'panel.missing': 'This route has no admin panel URL configured.',

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

      'error.bothRequired': 'Fill in both AK and SK',
      'error.baseUrlRequired': 'The gateway URL must start with http:// or https://',
      'error.authRequired': 'Authorization must not be empty',
      'error.load': 'Failed to load: {message}',
      'error.save': 'Failed to save: {message}',
      'error.clear': 'Failed to clear: {message}',

      'empty.none': 'No API to configure yet.',
      'foot': 'Credentials are stored locally in ~/.dsh/.api-rules/accounts.json and removed with the plugin.',
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

      /* 底部说明 */
      '.arc-foot{margin-top:12px;padding-top:10px;border-top:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;color:var(--dsw-alias-label-tertiary,#6b6b6b);}',
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
      const [busy, setBusy] = useState('') // '' | 'save:<id>' | 'clear:<id>' | 'clear:<id>:go'
      const [tab, setTab] = useState('')
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

      const header = React.createElement(
        'div',
        { className: 'arc-head' },
        React.createElement(
          'div',
          { className: 'arc-headMain' },
          React.createElement('div', { className: 'arc-title' }, t('card.title')),
          React.createElement('div', { className: 'arc-sub' }, t('card.subtitle')),
        ),
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
          err && err.field === 'route' ? React.createElement('div', { className: 'arc-fieldError' }, err.message) : null,
          isCredential ? actions : null,
        )
      }

      return React.createElement(
        'div',
        { className: 'arc' },
        React.createElement('style', null, CSS),
        header,
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
