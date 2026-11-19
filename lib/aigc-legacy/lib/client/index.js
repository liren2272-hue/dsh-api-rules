/**
 * dsh-tongji-aigc 客户端设置卡片。
 *
 * 出现在「设置 → 插件」。设计取向（状态优先的极简设置卡）：
 *   一张卡里只让一件事最重要——「你现在是谁」。身份用大字号做主角，登录/退出
 *   是唯一主动作；靠留白与字重分层，不靠逐层描边把信息框起来。
 *
 * 登录流程（自动，无输入框、无粘贴）：
 *   1. 点「统一身份认证登录」→ 宿主 /login-start 在本机找一个 Edge / Chrome，
 *      开一个独立临时配置目录的隔离窗口并加载一个临时生成的扩展，再打开 SSO 授权页
 *      （不是用户平时的浏览器，独立 --user-data-dir，不碰用户配置）；
 *   2. 用户就在那个隔离窗口完成同济统一身份认证；站点把令牌写进该窗口
 *      sessionStorage（地址栏不留 token）；
 *   3. 临时扩展的 content script 轮询 sessionStorage.access_token，读到后通过顶层导航
 *      location.replace(本机 DSH /api/dsh-api-rules/aigc/relay?token=...) 回传（顶层导航不受
 *      mixed-content 拦截，可绕过 HTTPS→HTTP 限制）、校验、落盘；
 *   4. 卡片后台轮询 /api/dsh-api-rules/aigc/status，一旦 configured 变 true 自动切到「已登录」并显示身份；
 *      登录窗口关闭 / 超时后临时扩展与配置目录被删除（关窗即卸载）。
 *   5. 仅当本机确实没有可用 Edge / Chrome 时，才降级为「复制取令牌脚本」（no-cors 回传）。
 *
 * 为什么是「临时扩展 + 隔离窗口」：宿主无法跨进程 / 跨源读用户浏览器的 sessionStorage；
 * 必须有一段代码跑在用户登录的那个浏览器会话里读令牌再回传。临时扩展只在本次登录写入
 * 并加载、用完即删，不要求开发者模式、不在用户常用浏览器里留下任何痕迹。
 *
 * 约定（照 dsh-api-rules 卡片）：
 *   - 纯 React DOM + 组件级 <style>，React 在 factory 顶层取一次；
 *   - 文案用扁平点号 key，`t(key)` 调用，中英两份字典同写；
 *   - 样式只用宿主真实存在的 --dsw-* token，且带兜底色，主按钮随深浅主题反转；
 *   - 字号分层：20px 标题/身份，14px 正文与按钮，13px 辅助，绝不靠 11px 撑版面。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-tongji-aigc',
  factory(require) {
    const name = 'dsh-tongji-aigc-client'
    const inject = ['slots', 'locale']
    const ReactTop = require('react')

    const zh = {
      'card.signIn': '统一身份认证登录',
      'card.signInBusy': '正在打开登录窗口…',
      'card.ssoFailed': '无法打开登录窗口，请确认本机装有 Edge 或 Chrome 后重试。',
      'card.waitingTitle': '等待登录完成',
      'card.waitingHint': '请在刚弹出的登录窗口里完成同济统一身份认证。登录成功后这里会自动变为已登录，无需复制或粘贴任何令牌；关闭该窗口即结束本次登录。',
      'card.waitingTimeout': '还没检测到登录。可以再点一次登录，或改用下方的备用方式。',
      'card.signOut': '退出登录',
      'card.signOutBusy': '正在退出…',
      'card.signedInAs': '当前登录',
      'card.stateOk': '登录有效',
      'card.stateExpired': '登录已过期',
      'card.autoOk': '登录态已自动同步。',
      'card.signedOutOk': '已退出登录。',
      'card.fallbackTitle': '自动登录暂不可用',
      'card.fallbackHint': '未检测到可用的 Edge / Chrome。可用备用方式：复制一段脚本，切到已登录的同济 AIGC 页面，按 F12 在 Console 里粘贴运行，令牌会自动回传。',
      'card.copyScript': '复制取令牌脚本',
      'card.copied': '脚本已复制。请切到同济 AIGC 页面，按 F12 → Console 粘贴并回车；完成后这里会自动更新。',
      'card.copyFailed': '复制失败，请手动选中下方脚本复制。',
      'card.scriptLabel': '备用脚本',
      'card.notLoggedIn': '尚未登录',
      'card.offline': '暂时无法读取登录状态',
      'card.retry': '重试',
      'card.accountTitle': '统一身份认证',
      'card.accountHint': '点击下方按钮打开同济统一身份认证页面，按提示完成登录（如遇人脸/短信验证照常操作），令牌自动保存，无需复制粘贴。',
      'card.username': '工号 / 学号',
      'card.password': '密码',
      'card.checkcode': '验证码',
      'card.captchaAlt': '登录验证码',
      'card.captchaRefresh': '换一张',
      'card.captchaLoading': '验证码加载中…',
      'card.captchaEmpty': '验证码未加载',
      'card.accountSignIn': '登录',
      'card.accountBusy': '正在登录…',
      'card.accountOk': '登录成功，令牌已保存。',
      'card.accountFailed': '登录失败，请核对工号、密码与验证码后重试。',
      'card.formMissing': '请填写工号、密码与验证码。',
      'card.browserSignIn': '统一身份认证登录',
      'card.browserBusy': '正在打开浏览器…',
      'card.browserWaiting': '已在浏览器打开同济登录页，请在弹出的窗口完成登录（含人脸/短信）…',
      'card.browserOk': '浏览器登录成功，令牌已保存。',
      'card.browserFailed': '浏览器登录失败，请重试。',
      'card.browserCancelled': '已取消浏览器登录。',
      'card.browserCancel': '取消登录',
      'card.quotaTitle': '额度监控',
      'card.refresh': '刷新',
      'card.refreshing': '刷新中…',
      'card.pointsLabel': '可用积分',
      'card.pointsUnit': '积分',
      'card.periodUsed': '本周期已用',
      'card.nextReset': '下次重置',
      'card.imageQuota': '图片额度',
      'card.videoQuota': '视频额度',
      'card.remainingOf': '剩余',
      'card.unitImage': '张',
      'card.unitVideo': '秒',
      'card.quotaLoading': '正在读取额度…',
      'card.quotaUnavailable': '额度暂时无法读取，点刷新重试。',
      'card.expiredTitle': '登录已过期',
      'card.expiredHint': '令牌已失效，请重新登录以继续使用同济 AIGC 的全部能力。',
      'card.reSignIn': '重新登录',
      'card.quotaWarn': '紧张',
      'card.quotaDanger': '告急',
    }

    const en = {
      'card.signIn': 'Unified identity sign-in',
      'card.signInBusy': 'Opening the sign-in window…',
      'card.ssoFailed': 'Could not open the sign-in window; make sure Edge or Chrome is installed and retry.',
      'card.waitingTitle': 'Waiting for sign-in',
      'card.waitingHint': 'Finish the Tongji unified identity sign-in in the window that just popped up. This card turns into "signed in" automatically — no token copying or pasting needed. Closing that window ends this sign-in attempt.',
      'card.waitingTimeout': 'Sign-in not detected yet. Try the button again, or use the fallback below.',
      'card.signOut': 'Sign out',
      'card.signOutBusy': 'Signing out…',
      'card.signedInAs': 'Signed in as',
      'card.stateOk': 'Signed in',
      'card.stateExpired': 'Session expired',
      'card.autoOk': 'Sign-in state synced automatically.',
      'card.signedOutOk': 'Signed out.',
      'card.fallbackTitle': 'Automatic sign-in unavailable',
      'card.fallbackHint': 'No usable Edge / Chrome was detected. Use the fallback: copy a short script, switch to the already signed-in Tongji AIGC page, press F12 and paste it into the Console. The token is sent back automatically.',
      'card.copyScript': 'Copy token script',
      'card.copied': 'Script copied. Switch to the Tongji AIGC page, press F12, paste into the Console and press Enter; this card updates automatically.',
      'card.copyFailed': 'Copy failed. Select the script below and copy it manually.',
      'card.scriptLabel': 'Fallback script',
      'card.notLoggedIn': 'Not signed in',
      'card.offline': 'Could not read the sign-in state',
      'card.retry': 'Retry',
      'card.accountTitle': 'Unified sign-in',
      'card.accountHint': 'Click the button to open the Tongji unified sign-in page and complete the login (follow any face/SMS prompts). The token is saved automatically — no copy-paste needed.',
      'card.username': 'Tongji ID',
      'card.password': 'Password',
      'card.checkcode': 'Captcha',
      'card.captchaAlt': 'Sign-in captcha',
      'card.captchaRefresh': 'New captcha',
      'card.captchaLoading': 'Loading captcha…',
      'card.captchaEmpty': 'Captcha not loaded',
      'card.accountSignIn': 'Sign in',
      'card.accountBusy': 'Signing in…',
      'card.accountOk': 'Signed in. Token saved.',
      'card.accountFailed': 'Sign-in failed. Check your ID, password and captcha, then retry.',
      'card.formMissing': 'Enter your Tongji ID, password and captcha.',
      'card.browserSignIn': 'Sign in with Tongji ID',
      'card.browserBusy': 'Opening browser…',
      'card.browserWaiting': 'Tongji login opened in a browser window. Finish signing in there (face/SMS if asked)…',
      'card.browserOk': 'Signed in via browser. Token saved.',
      'card.browserFailed': 'Browser sign-in failed. Please retry.',
      'card.browserCancelled': 'Browser sign-in cancelled.',
      'card.browserCancel': 'Cancel sign-in',
      'card.quotaTitle': 'Quota',
      'card.refresh': 'Refresh',
      'card.refreshing': 'Refreshing…',
      'card.pointsLabel': 'Available points',
      'card.pointsUnit': 'pts',
      'card.periodUsed': 'Used this cycle',
      'card.nextReset': 'Next reset',
      'card.imageQuota': 'Image quota',
      'card.videoQuota': 'Video quota',
      'card.remainingOf': 'Remaining',
      'card.unitImage': 'images',
      'card.unitVideo': 'seconds',
      'card.quotaLoading': 'Loading quota…',
      'card.quotaUnavailable': 'Quota unavailable right now. Tap refresh to retry.',
      'card.expiredTitle': 'Session expired',
      'card.expiredHint': 'Your token has expired. Sign in again to keep using Tongji AIGC.',
      'card.reSignIn': 'Sign in again',
      'card.quotaWarn': 'High',
      'card.quotaDanger': 'Critical',
    }

    const CSS = [
      '.ta-card{display:flex;flex-direction:column;gap:18px;font-family:var(--dsw-font-family, var(--dsw-font, system-ui, sans-serif));color:var(--dsw-alias-label-primary, #1b1b1c);}',
      '.ta-card *{box-sizing:border-box;}',
      '.ta-rule{height:1px;background:var(--dsw-alias-border-l1, #e3e5e8);border:0;margin:0;}',
      '.ta-main{display:flex;flex-direction:column;gap:14px;}',
      '.ta-eyebrow{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary, #7a7a7d);}',
      '.ta-identity{display:flex;flex-direction:column;gap:4px;min-width:0;}',
      '.ta-name{margin:0;font-size:20px;font-weight:600;line-height:1.35;word-break:break-word;color:var(--dsw-alias-label-primary, #1b1b1c);}',
      '.ta-meta{margin:0;font-size:14px;line-height:1.6;color:var(--dsw-alias-label-secondary, #5a5a5c);word-break:break-word;}',
      '.ta-state{display:inline-flex;align-items:center;gap:8px;font-size:14px;line-height:1.6;color:var(--dsw-alias-label-secondary, #5a5a5c);flex-wrap:wrap;}',
      '.ta-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;background:var(--dsw-alias-state-success-primary, #1a7f37);}',
      '.ta-dot.bad{background:var(--dsw-alias-state-error-primary, #d93026);}',
      '.ta-dot.idle{background:var(--dsw-alias-label-tertiary, #7a7a7d);}',
      '.ta-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}',
      '.ta-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:var(--dsw-radius-md, 8px);padding:10px 18px;font-family:inherit;font-size:14px;font-weight:600;line-height:1.4;cursor:pointer;transition:background-color .16s ease, opacity .16s ease;}',
      '.ta-btn:focus-visible{outline:2px solid var(--dsw-focus-ring-color, #2f6feb);outline-offset:2px;}',
      '.ta-btn:disabled{opacity:.55;cursor:not-allowed;}',
      '.ta-btn.primary{background:var(--dsw-alias-button-primary-fill, currentColor);color:var(--dsw-alias-label-primary-foreground, CanvasText);border:1px solid transparent;}',
      '.ta-btn.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover, currentColor);}',
      '.ta-btn.ghost{background:transparent;color:var(--dsw-alias-label-secondary, #5a5a5c);border:1px solid var(--dsw-alias-border-l2, #d0d3d8);}',
      '.ta-btn.ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover, #f2f4f7);}',
      '.ta-wait{display:flex;align-items:flex-start;gap:10px;padding:14px 16px;border-radius:var(--dsw-radius-md, 8px);background:var(--dsw-alias-bg-layer-2, #f7f8fa);}',
      '.ta-wait-dot{width:8px;height:8px;margin-top:7px;border-radius:50%;flex:0 0 auto;background:var(--dsw-alias-brand-primary, #2f6feb);animation:ta-pulse 1.4s ease-in-out infinite;}',
      '@keyframes ta-pulse{0%,100%{opacity:.35;}50%{opacity:1;}}',
      '.ta-wait-body{display:flex;flex-direction:column;gap:4px;min-width:0;}',
      '.ta-wait-title{font-size:14px;font-weight:600;line-height:1.5;color:var(--dsw-alias-label-primary, #1b1b1c);}',
      '.ta-wait-hint{font-size:14px;line-height:1.65;color:var(--dsw-alias-label-secondary, #5a5a5c);overflow-wrap:anywhere;}',
      '.ta-note{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary, #5a5a5c);overflow-wrap:anywhere;}',
      '.ta-note.ok{color:var(--dsw-alias-state-success-primary, #1a7f37);}',
      '.ta-note.bad{color:var(--dsw-alias-state-error-primary, #d93026);}',
      '.ta-fallback{display:flex;flex-direction:column;gap:10px;padding:14px 16px;border-radius:var(--dsw-radius-md, 8px);background:var(--dsw-alias-bg-layer-2, #f7f8fa);}',
      '.ta-fallback-title{font-size:14px;font-weight:600;line-height:1.5;color:var(--dsw-alias-label-primary, #1b1b1c);}',
      '.ta-fallback-hint{margin:0;font-size:13px;line-height:1.65;color:var(--dsw-alias-label-secondary, #5a5a5c);overflow-wrap:anywhere;}',
      '.ta-script{margin:0;padding:10px 12px;border-radius:var(--dsw-radius-sm, 6px);background:var(--dsw-alias-bg-layer-1, #fff);border:1px solid var(--dsw-alias-border-l2, #d0d3d8);font-family:var(--dsw-font-markdown-code-font-family, ui-monospace, monospace);font-size:12px;line-height:1.6;color:var(--dsw-alias-label-primary, #1b1b1c);white-space:pre-wrap;word-break:break-all;user-select:all;}',
      '.ta-script-label{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary, #7a7a7d);}',
      '.ta-form{display:flex;flex-direction:column;gap:10px;padding-top:2px;}',
      '.ta-form-hint{margin:0;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-tertiary, #7a7a7d);overflow-wrap:anywhere;}',
      '.ta-input{width:100%;box-sizing:border-box;padding:9px 12px;border-radius:var(--dsw-radius-sm, 6px);border:1px solid var(--dsw-alias-border-l2, #d0d3d8);background:var(--dsw-alias-bg-layer-1, #fff);color:var(--dsw-alias-label-primary, #1b1b1c);font-family:inherit;font-size:14px;line-height:1.4;}',
      '.ta-input:focus{outline:2px solid var(--dsw-focus-ring-color, #2f6feb);outline-offset:1px;border-color:transparent;}',
      '.ta-input:disabled{opacity:.55;}',
      '.ta-captcha-row{display:flex;align-items:center;gap:10px;}',
      '.ta-captcha{height:42px;width:auto;border-radius:var(--dsw-radius-sm, 6px);border:1px solid var(--dsw-alias-border-l2, #d0d3d8);display:block;}',
      '.ta-captcha-empty,.ta-captcha-loading{font-size:12px;color:var(--dsw-alias-label-tertiary, #7a7a7d);min-width:96px;}',
      '.ta-captcha-refresh{flex:none;padding:7px 12px;font-size:13px;font-weight:500;}',
      '.ta-form-err{margin:0;font-size:12px;line-height:1.5;color:#c0392b;}',
      // ---- 额度监控：积分 44px 主角，两个百分比 22px 次级 ----
      // 配色原则：状态色一律走宿主语义 token（var(--dsw-alias-state-*)，仅带 fallback），
      // 阈值由 data-tier 属性（normal/warn/danger）驱动，绝不写死裸十六进制填充色。
      // 12px 辅助行统一用 label-secondary（实测 ≥5.8:1）而非 tertiary，保证 WCAG AA。
      '.ta-quota{display:flex;flex-direction:column;gap:10px;}',
      '.ta-quota-head{display:flex;align-items:center;justify-content:space-between;gap:10px;}',
      '.ta-quota-head-label{font-size:13px;font-weight:600;line-height:1.5;letter-spacing:.02em;color:var(--dsw-alias-label-secondary, #5a5a5c);}',
      '.ta-refresh{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;padding:4px 6px;border-radius:var(--dsw-radius-sm, 6px);font-family:inherit;font-size:12px;line-height:1.4;color:var(--dsw-alias-label-secondary, #5a5a5c);cursor:pointer;}',
      '.ta-refresh:hover:not(:disabled){color:var(--dsw-alias-brand-primary, #2f6feb);background:var(--dsw-alias-bg-layer-2, #f7f8fa);}',
      '.ta-refresh:focus-visible{outline:2px solid var(--dsw-focus-ring-color, #2f6feb);outline-offset:2px;}',
      '.ta-refresh:disabled{opacity:.55;cursor:not-allowed;}',
      '.ta-refresh svg{width:13px;height:13px;display:block;}',
      '.ta-refresh.spinning svg{animation:ta-spin .9s linear infinite;}',
      '@keyframes ta-spin{to{transform:rotate(360deg);}}',
      '.ta-balance{position:relative;display:flex;flex-direction:column;gap:0;padding:18px 20px 16px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1, #e3e5e8);background:var(--dsw-alias-bg-layer-2, #f7f8fa);overflow:hidden;}',
      '.ta-balance::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--dsw-alias-brand-primary, #2f6feb);}',
      '.ta-balance-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;}',
      '.ta-balance-label{font-size:13px;font-weight:600;line-height:1.5;color:var(--dsw-alias-label-secondary, #5a5a5c);}',
      '.ta-balance-value{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;}',
      '.ta-points{margin:0;font-size:44px;font-weight:700;line-height:1.05;letter-spacing:-.025em;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary, #1b1b1c);}',
      '.ta-points-unit{font-size:14px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-secondary, #5a5a5c);}',
      '.ta-balance-sub{margin:8px 0 0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary, #5a5a5c);}',
      '.ta-balance-sep{height:1px;background:var(--dsw-alias-border-l1, #e3e5e8);border:0;margin:16px 0 14px;}',
      '.ta-meters{display:grid;grid-template-columns:1fr 1fr;gap:0;}',
      '.ta-meter{min-width:0;padding-right:18px;}',
      '.ta-meter + .ta-meter{padding-right:0;padding-left:18px;border-left:1px solid var(--dsw-alias-border-l1, #e3e5e8);}',
      '.ta-meter-top{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px 8px;row-gap:4px;}',
      '.ta-meter-label{font-size:12px;font-weight:600;line-height:1.5;color:var(--dsw-alias-label-secondary, #5a5a5c);white-space:nowrap;}',
      '.ta-meter-right{display:inline-flex;align-items:center;gap:8px;margin-left:auto;}',
      '.ta-meter-pct{font-size:22px;font-weight:700;line-height:1.2;letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary, #1b1b1c);}',
      // 状态冗余：高占用时百分比数字本身染状态色 + 带 ⚠ 图标的文字徽标，去色后也能读出告急。
      '.ta-meter-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:999px;font-size:11px;font-weight:700;line-height:1.4;white-space:nowrap;border:1px solid currentColor;}',
      '.ta-meter-badge svg{width:12px;height:12px;display:block;}',
      // 轨道：用更实的 border-l2 底 + 一圈 border-l1 描边，深浅两套都能看清全长，不再悬空。
      '.ta-meter-track{height:7px;border-radius:999px;background:var(--dsw-alias-border-l2, #c6cbd2);border:1px solid var(--dsw-alias-border-l1, #b0b6bf);overflow:hidden;margin:9px 0 7px;}',
      '.ta-meter-fill{height:100%;border-radius:999px;transition:width .45s cubic-bezier(.2,.7,.3,1);}',
      '.ta-meter-sub{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary, #5a5a5c);font-variant-numeric:tabular-nums;}',
      // 三段阈值：normal 蓝(brand) / warn 橙(state-warning) / danger 红(state-error)，全走 token。
      '.ta-meter[data-tier="normal"] .ta-meter-fill{background:var(--dsw-alias-brand-primary, #2f6feb);}',
      '.ta-meter[data-tier="warn"] .ta-meter-fill{background:var(--dsw-alias-state-warning-primary, #9a6700);}',
      '.ta-meter[data-tier="danger"] .ta-meter-fill{background:var(--dsw-alias-state-error-primary, #c0261a);}',
      '.ta-meter[data-tier="warn"] .ta-meter-pct,.ta-meter[data-tier="warn"] .ta-meter-badge{color:var(--dsw-alias-state-warning-primary, #9a6700);}',
      '.ta-meter[data-tier="danger"] .ta-meter-pct,.ta-meter[data-tier="danger"] .ta-meter-badge{color:var(--dsw-alias-state-error-primary, #c0261a);}',
      '.ta-quota-loading,.ta-quota-error{font-size:13px;line-height:1.6;padding:14px 16px;border-radius:12px;background:var(--dsw-alias-bg-layer-2, #f7f8fa);color:var(--dsw-alias-label-secondary, #5a5a5c);}',
      '.ta-quota-error{color:var(--dsw-alias-state-error-primary, #d93026);}',
      // ---- 令牌失效告警 ----
      '.ta-expired{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border-radius:12px;border:1px solid var(--dsw-alias-state-error-primary, #d93026);background:var(--dsw-alias-bg-layer-2, #f7f8fa);}',
      '.ta-expired-icon{flex:0 0 auto;width:18px;height:18px;margin-top:1px;color:var(--dsw-alias-state-error-primary, #d93026);}',
      '.ta-expired-body{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1;}',
      '.ta-expired-title{font-size:14px;font-weight:700;line-height:1.5;color:var(--dsw-alias-state-error-primary, #d93026);}',
      '.ta-expired-hint{margin:0;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary, #5a5a5c);}',
      '.ta-expired-btn{align-self:flex-start;margin-top:2px;padding:7px 14px;font-size:13px;}',
      '@media (max-width:520px){.ta-points{font-size:38px;}.ta-meters{grid-template-columns:1fr;gap:14px;}.ta-meter + .ta-meter{padding-left:0;border-left:0;border-top:1px solid var(--dsw-alias-border-l1,#e3e5e8);padding-top:14px;}}',
    ].join('')

    /** 生成备用回传脚本：用运行时宿主源拼端点，端口不写死。 */
    function buildRelayScript(origin) {
      return [
        "(async () => {",
        "  const token = sessionStorage.getItem('access_token');",
        "  if (!token) { console.error('未登录：请先在本页面完成同济统一身份认证'); return; }",
        "  const relay = '" + origin + "/api/dsh-api-rules/aigc/relay?token=' + encodeURIComponent(token);",
        "  window.location.replace(relay);",
        "})()",
      ].join('\n')
    }

    /** 额度剩余百分比：展示「还剩多少」而非「用了多少」，limit<=0 归零，封顶 100。 */
    function quotaPct(used, limit) {
      const u = Number(used)
      const l = Number(limit)
      if (!Number.isFinite(u) || !Number.isFinite(l) || l <= 0) return 0
      const remaining = Math.max(0, l - u)
      return Math.min(100, Math.round((remaining / l) * 100))
    }
    /** 进度条/状态语义（按剩余百分比）：剩余<=10% 危险 / <=30% 告警 / 否则正常。 */
    function quotaTier(pctValue) {
      if (pctValue <= 10) return 'danger'
      if (pctValue <= 30) return 'warn'
      return 'normal'
    }
    function fmtNum(n) {
      const v = Number(n)
      return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '0'
    }
    /** "2026-11-19T20:11:33+08:00" → "11-19 20:11" */
    function fmtReset(iso) {
      if (!iso) return ''
      const s = String(iso)
      const m = s.match(/^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
      return m ? m[1] + '-' + m[2] + ' ' + m[3] + ':' + m[4] : s.slice(0, 16).replace('T', ' ')
    }

    function App({ React, t }) {
      const [status, setStatus] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [waiting, setWaiting] = React.useState(false)
      const [notice, setNotice] = React.useState(null)
      const [noticeTone, setNoticeTone] = React.useState('info')
      const [fallback, setFallback] = React.useState(null)
      const [scriptVisible, setScriptVisible] = React.useState(false)
      // 额度监控：quota 为 /api/dsh-api-rules/aigc/quota 的聚合结果；单独 loading/error，不拖垮主卡片。
      const [quota, setQuota] = React.useState(null)
      const [quotaBusy, setQuotaBusy] = React.useState(false)
      const [quotaError, setQuotaError] = React.useState(null)
      const pollRef = React.useRef(null)

      // 派生量提前到最顶部：任何 useEffect / useCallback 依赖它们都不会踩 TDZ 白屏坑。
      const offline = status?.__offline === true
      const configured = status?.configured === true
      const expired = status?.expired === true
      const user = status?.user || null

      const stopPolling = React.useCallback(() => {
        if (pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = null
        }
      }, [])

      React.useEffect(() => () => stopPolling(), [stopPolling])

      const load = React.useCallback(async () => {
        try {
          const res = await fetch('/api/dsh-api-rules/aigc/status', { cache: 'no-store' })
          const data = await res.json()
          if (!res.ok) throw new Error(data?.error || 'status failed')
          setStatus(data)
        } catch {
          setStatus({ __offline: true })
        }
      }, [])

      React.useEffect(() => {
        load()
      }, [load])

      /** 拉额度聚合数据；后端各步独立容错，单个失败只置 quotaError，其余照常渲染。 */
      const loadQuota = React.useCallback(async () => {
        setQuotaBusy(true)
        setQuotaError(null)
        try {
          const res = await fetch('/api/dsh-api-rules/aigc/quota', { cache: 'no-store' })
          const data = await res.json()
          if (!res.ok) throw new Error(data?.error || 'quota failed')
          setQuota(data)
        } catch (error) {
          setQuotaError(String(error?.message || error))
          setQuota(null)
        } finally {
          setQuotaBusy(false)
        }
      }, [])

      // 登录态就绪后自动拉一次额度；令牌失效/未登录时不打扰上游。
      React.useEffect(() => {
        if (configured && !expired) loadQuota()
        else {
          setQuota(null)
          setQuotaError(null)
        }
      }, [configured, expired, loadQuota])

      /** 轮询直到 configured=true；auto 模式遇到环境缺失则切到降级。 */
      const startPolling = React.useCallback(
        (mode) => {
          stopPolling()
          let ticks = 0
          pollRef.current = setInterval(async () => {
            ticks += 1
            if (ticks > 90) {
              stopPolling()
              setWaiting(false)
              setNotice(t('card.waitingTimeout'))
              setNoticeTone('bad')
              return
            }
            try {
              const path = mode === 'status' ? '/api/dsh-api-rules/aigc/status' : '/api/dsh-api-rules/aigc/auto-login'
              const res = await fetch(path, { cache: 'no-store' })
              const data = await res.json()
              if (data?.configured === true) {
                stopPolling()
                setWaiting(false)
                setFallback(null)
                setScriptVisible(false)
                await load()
                setNotice(mode === 'auto' ? t('card.autoOk') : t('card.autoOk'))
                setNoticeTone('ok')
                return
              }
              if (mode === 'auto' && (res.status === 503 || data?.pending === false)) {
                stopPolling()
                setWaiting(false)
                setFallback(data)
              }
            } catch {
              /* 网络抖动，下一轮继续 */
            }
          }, 2000)
        },
        [load, stopPolling, t],
      )

      const signIn = async () => {
        if (busy || waiting) return
        setBusy('signin')
        setNotice(null)
        setFallback(null)
        setScriptVisible(false)
        try {
          // 关键：不再 window.open 到用户自己的 Chrome，也不依赖浏览器自动化服务。
          // 由宿主 login-start 在本机找一个 Edge / Chrome，开一个隔离的一次性窗口并加载
          // 临时扩展；用户在那个窗口完成 SSO，扩展通过顶层导航把令牌回传 DSH 并落盘。
          // 把当前宿主源带上，扩展回传端点才能真正命中本机 DSH（端口不写死）。
          const origin = String(window.location?.origin || '')
          const res = await fetch('/api/dsh-api-rules/aigc/login-start', {
            method: 'POST',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(origin ? { origin } : {}),
          })
          const data = await res.json()
          if (!res.ok || data?.started !== true) {
            // 环境缺失（503 pending=false）→ 降级；其余当普通错误提示
            if (res.status === 503 || data?.pending === false) {
              setFallback(data)
            } else {
              throw new Error(data?.detail || data?.error || t('card.ssoFailed'))
            }
          } else {
            setWaiting(true)
            startPolling('auto')
          }
        } catch (error) {
          setNotice(String(error?.message || error))
          setNoticeTone('bad')
        } finally {
          setBusy('')
        }
      }

      const signOut = async () => {
        if (busy) return
        stopPolling()
        setWaiting(false)
        setBusy('signout')
        setNotice(null)
        setFallback(null)
        try {
          const res = await fetch('/api/dsh-api-rules/aigc/token', { method: 'DELETE', cache: 'no-store' })
          if (!res.ok) throw new Error('sign out failed')
          setNotice(t('card.signedOutOk'))
          setNoticeTone('ok')
          await load()
        } catch (error) {
          setNotice(String(error?.message || error))
          setNoticeTone('bad')
        } finally {
          setBusy('')
        }
      }

      const copyScript = async () => {
        const origin = String(window.location?.origin || '')
        const script = buildRelayScript(origin)
        let copied = false
        try {
          await navigator.clipboard.writeText(script)
          copied = true
        } catch {
          copied = false
        }
        setScriptVisible(!copied)
        setNotice(copied ? t('card.copied') : t('card.copyFailed'))
        setNoticeTone(copied ? 'ok' : 'bad')
        // 回传落盘后 status 会变 configured，轮询状态即可，不再依赖浏览器自动化。
        setWaiting(true)
        startPolling('status')
      }

      // ---- 统一身份认证登录（弹浏览器，主路径）----
      const [formErr, setFormErr] = React.useState(null)

      // ---- 浏览器自动化登录（绕开 IAM 风控的人脸/短信增强认证）----
      const [browserBusy, setBrowserBusy] = React.useState(false)
      const [browserPolling, setBrowserPolling] = React.useState(false)

      /** 弹真浏览器登录（含人脸/短信），常驻 CDP 监听抓 token。 */
      const browserSignIn = async () => {
        if (browserBusy || browserPolling || busy !== '') return
        setFormErr(null)
        setBrowserBusy(true)
        try {
          const res = await fetch('/api/dsh-api-rules/aigc/browser-login-start', { method: 'POST', cache: 'no-store' })
          const data = await res.json()
          if (!res.ok || !data?.started) throw new Error(data?.detail || data?.error || 'start failed')
          setBrowserPolling(true)
          setNotice(t('card.browserWaiting'))
          setNoticeTone('')
          // 轮询，最多 10 分钟
          const deadline = Date.now() + 10 * 60 * 1000
          let ok = false
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 1500))
            let pr
            try {
              pr = await (await fetch('/api/dsh-api-rules/aigc/browser-login-poll', { method: 'POST', cache: 'no-store' })).json()
            } catch { continue }
            if (pr?.pending === false) {
              if (pr.configured === true) {
                setBrowserPolling(false)
                setBrowserBusy(false)
                await load()
                setNotice(t('card.browserOk'))
                setNoticeTone('ok')
                ok = true
              } else {
                setFormErr(pr?.detail || t('card.browserFailed'))
                setBrowserPolling(false)
              }
              break
            }
            if (pr?.reason === 'browser_closed' || pr?.reason === 'timeout' || pr?.reason === 'no_session') {
              setBrowserPolling(false)
              break
            }
          }
          if (!ok && !browserPolling === false) { /* loop end without ok */ }
          if (!ok) {
            setBrowserPolling(false)
            if (!formErr) setNotice(t('card.browserCancelled'))
          }
        } catch (error) {
          setFormErr(String(error?.message || error))
          setBrowserPolling(false)
        } finally {
          setBrowserBusy(false)
        }
      }

      /** 取消浏览器登录。 */
      const browserCancel = async () => {
        try { await fetch('/api/dsh-api-rules/aigc/browser-login-cancel', { method: 'POST', cache: 'no-store' }) } catch {}
        setBrowserPolling(false)
        setNotice(t('card.browserCancelled'))
        setNoticeTone('')
      }

      const e = React.createElement
      const relayScript = buildRelayScript(String(window.location?.origin || ''))

      /** 一个额度 meter：标签 + 大百分比（小字号相对积分）+ 状态徽标 + 进度条 + 用量副行。 */
      const renderMeter = (labelKey, unitKey, bucket) => {
        const pctValue = quotaPct(bucket?.used, bucket?.limit)
        const remaining = Math.max(0, Number(bucket?.limit) - Number(bucket?.used))
        const tier = quotaTier(pctValue)
        const badge = tier === 'danger'
          ? e('span', { className: 'ta-meter-badge' },
              e('svg', { viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': 'true' },
                e('path', { d: 'M8 1.5 15 14H1L8 1.5zm0 3.2L2.8 13h10.4L8 4.7zM7.2 7h1.6v3.4H7.2V7zm0 4.3h1.6v1.5H7.2v-1.5z' })),
              t('card.quotaDanger'))
          : tier === 'warn'
            ? e('span', { className: 'ta-meter-badge' },
                e('svg', { viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': 'true' },
                  e('path', { d: 'M8 1.5 15 14H1L8 1.5zm0 3.2L2.8 13h10.4L8 4.7zM7.2 7h1.6v3.4H7.2V7zm0 4.3h1.6v1.5H7.2v-1.5z' })),
                t('card.quotaWarn'))
            : null
        return e(
          'div',
          { className: 'ta-meter', 'data-tier': tier },
          e('div', { className: 'ta-meter-top' },
            e('span', { className: 'ta-meter-label' }, t(labelKey)),
            e('span', { className: 'ta-meter-right' },
              badge,
              e('span', { className: 'ta-meter-pct' }, pctValue + '%'),
            ),
          ),
          e('div', { className: 'ta-meter-track' },
            e('div', { className: 'ta-meter-fill', style: { width: pctValue + '%' } }),
          ),
          e('div', { className: 'ta-meter-sub' },
            t('card.remainingOf') + ' ' + fmtNum(remaining) + ' / ' + fmtNum(bucket?.limit) + ' ' + t(unitKey),
          ),
        )
      }

      /** 额度监控区：积分大字 + 图片/视频两个小百分比。 */
      const renderQuota = () => {
        if (!configured || expired) return null
        const head = e('div', { className: 'ta-quota-head' },
          e('span', { className: 'ta-quota-head-label' }, t('card.quotaTitle')),
          e('button', {
            className: 'ta-refresh' + (quotaBusy ? ' spinning' : ''),
            type: 'button',
            onClick: loadQuota,
            disabled: quotaBusy,
            title: t('card.refresh'),
            'aria-label': t('card.refresh'),
          },
            e('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'aria-hidden': 'true' },
              e('path', { d: 'M13.5 8a5.5 5.5 0 1 1-1.4-3.7M13.5 2.5V5h-2.5' })),
            e('span', null, quotaBusy ? t('card.refreshing') : t('card.refresh')),
          ),
        )
        let body
        if (quotaBusy && !quota) {
          body = e('div', { className: 'ta-quota-loading' }, t('card.quotaLoading'))
        } else if (quotaError || !quota || quota.configured === false) {
          body = e('div', { className: 'ta-quota-error' }, t('card.quotaUnavailable'))
        } else {
          const p = quota.points || {}
          const resetStr = fmtReset(p.nextResetAt)
          body = e('div', { className: 'ta-balance' },
            e('div', { className: 'ta-balance-top' },
              e('span', { className: 'ta-balance-label' }, t('card.pointsLabel')),
            ),
            e('div', { className: 'ta-balance-value' },
              e('span', { className: 'ta-points' }, fmtNum(p.total)),
              e('span', { className: 'ta-points-unit' }, t('card.pointsUnit')),
            ),
            e('p', { className: 'ta-balance-sub' },
              t('card.periodUsed') + ' ' + fmtNum(p.periodUsed) +
                (resetStr ? ' · ' + t('card.nextReset') + ' ' + resetStr : ''),
            ),
            e('hr', { className: 'ta-balance-sep' }),
            e('div', { className: 'ta-meters' },
              renderMeter('card.imageQuota', 'card.unitImage', quota.image),
              renderMeter('card.videoQuota', 'card.unitVideo', quota.video),
            ),
          )
        }
        return e('div', { className: 'ta-quota' }, head, body)
      }

      /** 令牌失效告警：明确告知 + 重新登录按钮（复用浏览器登录主路径）。 */
      const renderExpired = () => {
        if (!expired) return null
        return e('div', { className: 'ta-expired' },
          e('svg', { className: 'ta-expired-icon', viewBox: '0 0 20 20', fill: 'currentColor', 'aria-hidden': 'true' },
            e('path', { d: 'M10 2 19 18H1L10 2zm0 3.4L2.6 16.5h14.8L10 5.4zM9.1 8.5h1.8v4.6H9.1V8.5zm0 5.6h1.8v1.9H9.1v-1.9z' }),
          ),
          e('div', { className: 'ta-expired-body' },
            e('span', { className: 'ta-expired-title' }, t('card.expiredTitle')),
            e('p', { className: 'ta-expired-hint' }, t('card.expiredHint')),
            e('button', {
              className: 'ta-btn primary ta-expired-btn',
              type: 'button',
              onClick: browserSignIn,
              disabled: busy !== '' || browserBusy,
            }, t('card.reSignIn')),
          ),
        )
      }

      const meta = user
        ? [user.college, user.role_display_name || user.role_name].filter(Boolean).join(' · ')
        : ''

      return e(
        'div',
        { className: 'ta-card' },
        e('style', null, CSS),
        e('hr', { className: 'ta-rule' }),

        e(
          'div',
          { className: 'ta-main' },
          configured && user
            ? e(
                'div',
                { className: 'ta-identity' },
                e('span', { className: 'ta-eyebrow' }, t('card.signedInAs')),
                e('p', { className: 'ta-name' }, user.nickname || user.username || t('card.signedInAs')),
                meta ? e('p', { className: 'ta-meta' }, meta) : null,
              )
            : null,

          e(
            'div',
            { className: 'ta-state' },
            e('span', {
              className: 'ta-dot' + (configured ? (expired ? ' bad' : '') : ' idle'),
            }),
            e(
              'span',
              null,
              configured
                ? expired
                  ? t('card.stateExpired')
                  : t('card.stateOk')
                : offline
                  ? t('card.offline')
                  : t('card.notLoggedIn'),
            ),
          ),

          // 令牌信息/到期时间按需求移除；失效时给明确告警 + 重新登录。
          renderExpired(),

          // 额度监控（积分大字 + 图片/视频小百分比）；未登录或失效时不显示。
          renderQuota(),

          waiting
            ? e(
                'div',
                { className: 'ta-wait' },
                e('span', { className: 'ta-wait-dot' }),
                e(
                  'div',
                  { className: 'ta-wait-body' },
                  e('span', { className: 'ta-wait-title' }, t('card.waitingTitle')),
                  e('span', { className: 'ta-wait-hint' }, t('card.waitingHint')),
                ),
              )
            : null,

          e(
            'div',
            { className: 'ta-actions' },
            !configured
              ? null
              : e(
                  'button',
                  {
                    className: 'ta-btn ghost',
                    type: 'button',
                    onClick: signOut,
                    disabled: busy !== '',
                  },
                  busy === 'signout' ? t('card.signOutBusy') : t('card.signOut'),
                ),
            offline
              ? e(
                  'button',
                  { className: 'ta-btn ghost', type: 'button', onClick: load },
                  t('card.retry'),
                )
              : null,
          ),

          // 统一身份认证登录：一个按钮，点它弹浏览器完成登录（含人脸/短信）。
          !configured
            ? e(
                'div',
                { className: 'ta-form' },
                e('div', { className: 'ta-eyebrow' }, t('card.accountTitle')),
                e('p', { className: 'ta-form-hint' }, t('card.accountHint')),
                formErr ? e('p', { className: 'ta-form-err' }, formErr) : null,
                e(
                  'button',
                  {
                    className: 'ta-btn primary',
                    type: 'button',
                    onClick: browserPolling ? browserCancel : browserSignIn,
                    disabled: busy !== '' || (browserBusy && !browserPolling),
                  },
                  browserPolling ? t('card.browserCancel') : (browserBusy ? t('card.browserBusy') : t('card.browserSignIn')),
                ),
              )
            : null,

          fallback && !configured
            ? e(
                'div',
                { className: 'ta-fallback' },
                e('span', { className: 'ta-fallback-title' }, t('card.fallbackTitle')),
                e('p', { className: 'ta-fallback-hint' }, t('card.fallbackHint')),
                e(
                  'button',
                  { className: 'ta-btn ghost', type: 'button', onClick: copyScript },
                  t('card.copyScript'),
                ),
                scriptVisible
                  ? e(
                      'div',
                      null,
                      e('div', { className: 'ta-script-label' }, t('card.scriptLabel')),
                      e('pre', { className: 'ta-script' }, relayScript),
                    )
                  : null,
              )
            : null,

          notice
            ? e('div', { className: 'ta-note ' + (noticeTone === 'ok' ? 'ok' : noticeTone === 'bad' ? 'bad' : '') }, notice)
            : null,
        ),
      )
    }

    function apply(ctx) {
      const namespace = 'settings.tongji-aigc'
      ctx.effect(() => ctx.locale.register(namespace, { zh, en }), '[dsh-tongji-aigc] register locale')
      const t = ctx.locale.bind(namespace)
      ctx.slots.inject(
        'plugins.bundle.config',
        () =>
          ctx.slots.register(
            { name: 'plugins.bundle.config', key: '@local/dsh-tongji-aigc', locale: namespace },
            () => ReactTop.createElement(App, { React: ReactTop, t }),
          ),
      )
    }

    return { apply, inject, name }
  },
})
