// lib/client/index.js
window.__ModuleLoader__.load({
  id: "@local/dsh-api-rules",
  factory(require2) {
    const name = "dsh-api-rules-client";
    const inject = ["slots", "locale"];
    const ReactTop = require2("react");
    const ReactDOMTop = require2("react-dom");
    const zh = {
      "card.title": "API \u89C4\u5219",
      "card.subtitle": "\u628A\u591A\u4E2A\u4E0A\u6E38\u6A21\u578B\u670D\u52A1\u96C6\u4E2D\u5230\u4E00\u5904\u7BA1\u7406\uFF1A\u51ED\u636E\u53EA\u5B58\u672C\u673A\uFF0C\u63D2\u4EF6\u76F4\u63A5\u8C03\u7528\u4E0A\u6E38\u3002",
      "card.chip": "{ok} / {total} \u4E2A\u5C31\u7EEA",
      "card.chipAll": "{total} \u4E2A API \xB7 \u5168\u90E8\u5C31\u7EEA",
      "tab.codearts": "CodeArts",
      "tab.officeace": "OfficeAce",
      "tab.cline": "Cline",
      "tab.raccoon": "Raccoon",
      "name.codearts": "CodeArts \u8D26\u53F7",
      "desc.codearts": "\u7528 AK / SK \u76F4\u63A5\u7B7E\u540D\u8C03\u7528 CodeArts \u6A21\u578B\u7F51\u5173\uFF0C\u5BC6\u94A5\u4E0D\u51FA\u672C\u673A\u3002",
      "name.officeace": "OfficeAce \u8D26\u53F7",
      "desc.officeace": "\u8D26\u53F7\u4E0E\u767B\u5F55\u90FD\u5728\u4E0A\u6E38\u7BA1\u7406\u9762\u677F\u91CC\u7EF4\u62A4\uFF0C\u63D2\u4EF6\u53EA\u505A\u8F6C\u53D1\u3002",
      "name.cline": "Cline \u8D26\u53F7",
      "desc.cline": "\u514D\u8D39\u6A21\u578B\u63D0\u793A\u8D26\u53F7\u4E0D\u8DB3\u65F6\uFF0C\u5230\u7BA1\u7406\u9762\u677F\u91CC\u8865\u4E00\u4E2A Cline \u8D26\u53F7\u3002",
      "name.raccoon": "Raccoon \u8D26\u53F7",
      "desc.raccoon": "\u7531\u63D2\u4EF6\u81EA\u52A8\u62C9\u8D77\u7684 Raccoon \u63A7\u5236\u53F0\uFF0C\u9996\u6B21\u8FDB\u5165\u586B\u4E00\u6B21\u7BA1\u7406\u5BC6\u94A5\u3002",
      "tab.loomy2api": "Loomy",
      "name.loomy2api": "Loomy \u8D26\u53F7",
      "desc.loomy2api": "\u7531\u63D2\u4EF6\u81EA\u52A8\u62C9\u8D77\u7684 Loomy \u661F\u706B\u7F51\u5173\uFF0C\u81EA\u52A8\u590D\u7528\u672C\u673A Loomy \u767B\u5F55\u6001\uFF0C\u65E0\u9700\u624B\u52A8\u586B\u5BC6\u94A5\u3002",
      "tab.minimax2api": "MiniMax",
      "name.minimax2api": "MiniMax \u8D26\u53F7",
      "desc.minimax2api": "\u7531\u63D2\u4EF6\u81EA\u52A8\u62C9\u8D77\u7684 MiniMax \u7F51\u5173\uFF0C\u5230\u9762\u677F\u7C98\u8D34 MiniMax Agent \u7684 JWT \u6DFB\u52A0\u8D26\u53F7\u5373\u53EF\u3002",
      "panel.title": "\u7BA1\u7406\u9762\u677F",
      "panel.note.officeace": "\u94FE\u63A5\u5DF2\u5E26\u597D\u53E3\u4EE4\uFF0C\u70B9\u5F00\u5373\u53EF\u7BA1\u7406\u8D26\u53F7\u3002",
      "panel.note.cline": "\u514D\u8D39\u6A21\u578B\u63D0\u793A\u8D26\u53F7\u4E0D\u8DB3\u65F6\uFF0C\u5728\u8FD9\u91CC\u6DFB\u52A0 Cline \u8D26\u53F7\u3002",
      "panel.note.raccoon": "\u9996\u6B21\u8FDB\u5165\u8981\u586B\u4E00\u6B21\u7BA1\u7406\u5BC6\u94A5\uFF1Araccoon-local-admin\uFF0C\u586B\u8FC7\u5C31\u4E0D\u518D\u8BE2\u95EE\u3002",
      "panel.note.loomy2api": "\u9762\u677F\u5BC6\u7801\uFF1Ask-loomy-local\u3002\u767B\u5F55\u540E\u53EF\u52A0\u8D26\u53F7\u3001\u770B\u79EF\u5206/\u7528\u91CF/\u65E5\u5FD7\u3002",
      "panel.note.minimax2api": "\u9762\u677F\u5BC6\u7801\uFF1Ask-mm-local\u3002\u767B\u5F55\u540E\u7C98\u8D34 MiniMax Agent \u7684 JWT `_token` \u6DFB\u52A0\u8D26\u53F7\u3001\u770B\u7528\u91CF\u3002",
      "tab.qoder2api-hub": "Qoder",
      "name.qoder2api-hub": "Qoder \u8D26\u53F7",
      "panel.note.qoder2api-hub": "\u65B0 Go \u6865\uFF08Zhengyuuuui/qoder2api\uFF09\u3002\u63A7\u5236\u53F0 :3588\uFF0C\u5BC6\u7801 qoder-local\uFF1B\u9996\u6B21\u9700\u5728\u63A7\u5236\u53F0\u7528 Qoder \u8D26\u53F7 OAuth/PAT \u767B\u5F55\uFF0C\u6865 :8963 \u624D\u4F1A\u76D1\u542C\u3002",
      "tab.trae2api-hub": "Trae",
      "name.trae2api-hub": "Trae \u8D26\u53F7",
      "panel.note.trae2api-hub": "\u65B0 Go \u6865\uFF08XCool-603/trae2api\uFF09\u3002\u63A7\u5236\u53F0 :7870\uFF1BCN \u8D26\u53F7\u4ECE\u672C\u673A Trae \u5BA2\u6237\u7AEF\u51ED\u636E\u81EA\u52A8\u5BFC\u5165\uFF0C\u65E0\u9700\u624B\u52A8\u767B\u5F55\u3002",
      "panel.note.default": "\u8D26\u53F7\u4E0E\u767B\u5F55\u90FD\u5728\u8FD9\u4E2A\u9762\u677F\u91CC\u5B8C\u6210\u3002",
      "panel.open": "\u6253\u5F00\u7BA1\u7406\u9762\u677F",
      "panel.missing": "\u8FD9\u6761\u8DEF\u7531\u8FD8\u6CA1\u914D\u7F6E\u7BA1\u7406\u9762\u677F\u5730\u5740\u3002",
      // 面板下方剩余积分
      "points.label": "\u5269\u4F59\u79EF\u5206",
      "points.permanent": "\u6C38\u4E45 {n}",
      "points.daily": "\u6BCF\u65E5 {n}",
      "points.popTitle": "{name} \u79EF\u5206\u660E\u7EC6",
      "points.openPanel": "\u6253\u5F00\u5DE5\u4F5C\u53F0",
      "points.cn": "\u56FD\u5185 {n}",
      "points.intl": "\u56FD\u9645 {n}",
      "points.cnLabel": "\u56FD\u5185",
      "points.intlLabel": "\u56FD\u9645",
      "points.permanentLabel": "\u6C38\u4E45",
      "points.dailyLabel": "\u6BCF\u65E5",
      "mm.title": "MiniMax \u8D26\u53F7",
      "mm.empty": "\u8FD8\u6CA1\u6709\u8D26\u53F7\u3002\u7C98\u8D34 MiniMax Agent \u7684 JWT `_token` \u6DFB\u52A0\u4E00\u4E2A\u3002",
      "mm.addTitle": "\u6DFB\u52A0\u8D26\u53F7",
      "mm.tokenPh": "\u7C98\u8D34 MiniMax Agent JWT _token",
      "mm.namePh": "\u8D26\u53F7\u5907\u6CE8\uFF08\u53EF\u9009\uFF09",
      "mm.add": "\u6DFB\u52A0",
      "mm.delete": "\u5220\u9664",
      "status.loading": "\u8BFB\u53D6\u4E2D\u2026",
      "status.unconfigured": "\u672A\u914D\u7F6E",
      "status.saved": "\u5DF2\u5C31\u7EEA",
      "status.up": "\u4E0A\u6E38\u53EF\u7528",
      "status.down": "\u4E0A\u6E38\u4E0D\u53EF\u7528",
      "status.unreachable": "\u4E0A\u6E38\u4E0D\u53EF\u8FBE",
      "meta.models": "{n} \u4E2A\u6A21\u578B",
      "meta.autolaunch": "\u63D2\u4EF6\u81EA\u52A8\u62C9\u8D77",
      "field.ak": "Access Key\uFF08AK\uFF09",
      "field.sk": "Secret Key\uFF08SK\uFF09",
      "field.baseUrl": "\u7F51\u5173\u5730\u5740",
      "field.authorization": "Authorization",
      "field.endpointDesc": "\u586B\u81EA\u5DF1\u7684\u7F51\u5173\u5730\u5740\u4E0E\u51ED\u636E\uFF0C\u63D2\u4EF6\u76F4\u63A5\u8BF7\u6C42\u8FD9\u4E2A\u4E0A\u6E38\u3002",
      "ph.ak": "\u7C98\u8D34 AK",
      "ph.sk": "\u7C98\u8D34 SK",
      "ph.baseUrl": "https://\u2026/v2",
      "ph.authorization": "\u7C98\u8D34\u6574\u4E32\uFF0C\u4F8B\u5982 Basic xxxxxxxx",
      "ph.saved": "\u7559\u7A7A\u5219\u4E0D\u4FEE\u6539",
      "mask.saved": "\u5DF2\u4FDD\u5B58 {hint}",
      "action.save": "\u4FDD\u5B58",
      "action.saving": "\u4FDD\u5B58\u4E2D\u2026",
      "action.clear": "\u6E05\u9664",
      "action.clearConfirm": "\u786E\u8BA4\u6E05\u9664",
      "action.clearing": "\u6E05\u9664\u4E2D\u2026",
      "sync.button": "\u540C\u6B65\u53EF\u7528\u6A21\u578B",
      "sync.running": "\u540C\u6B65\u4E2D\u2026",
      "sync.done": "\u540C\u6B65\u5B8C\u6210\uFF1A\u65B0\u589E {added}\u3001\u79FB\u9664 {removed}\u3001\u8DF3\u8FC7 {skipped}",
      "sync.fail": "\u540C\u6B65\u5931\u8D25\uFF1A{message}",
      "sync.last": "\u4E0A\u6B21\u542F\u7528\u65F6\u540C\u6B65\uFF1A\u65B0\u589E {added}\u3001\u79FB\u9664 {removed}",
      "sync.idle": "\u8FD8\u6CA1\u6709\u540C\u6B65\u8FC7\u53EF\u7528\u6A21\u578B\u3002",
      "sync.hint": "\u63D2\u4EF6\u6BCF\u6B21\u542F\u7528\u90FD\u4F1A\u81EA\u52A8\u5237\u65B0\u53EF\u7528\u6A21\u578B\uFF1B\u4E5F\u53EF\u70B9\u4E0A\u9762\u7684\u6309\u94AE\u624B\u52A8\u540C\u6B65\u3002\u6539\u52A8\u5199\u5165\u672C\u673A\u6A21\u578B\u58F0\u660E\uFF0C\u7528\u300C\u6A21\u578B\u9009\u62E9\u5668\u300D\u7F16\u8F91\u5668\u5FAE\u8C03\u5373\u53EF\u3002",
      "error.bothRequired": "AK \u548C SK \u8981\u540C\u65F6\u586B\u5199",
      "error.baseUrlRequired": "\u7F51\u5173\u5730\u5740\u8981\u4EE5 http:// \u6216 https:// \u5F00\u5934",
      "error.authRequired": "Authorization \u4E0D\u80FD\u4E3A\u7A7A",
      "error.load": "\u8BFB\u53D6\u8D26\u53F7\u5931\u8D25\uFF1A{message}",
      "error.save": "\u4FDD\u5B58\u5931\u8D25\uFF1A{message}",
      "error.clear": "\u6E05\u9664\u5931\u8D25\uFF1A{message}",
      "empty.none": "\u8FD8\u6CA1\u6709\u53EF\u914D\u7F6E\u7684 API\u3002",
      "alert.proxyDown": "\u89C4\u5219\u524D\u7F6E\u5C42\u6CA1\u6709\u76D1\u542C\uFF08\u7AEF\u53E3 {port}{error}\uFF09\uFF0C\u6240\u6709 API \u90FD\u4F1A\u5931\u8D25\u3002\u91CD\u542F DSH \u5373\u53EF\u6062\u590D\u3002",
      "foot": "\u51ED\u636E\u53EA\u4FDD\u5B58\u5728\u672C\u673A ~/.dsh/.api-rules/accounts.json\uFF0C\u5378\u8F7D\u63D2\u4EF6\u5373\u5F7B\u5E95\u6E05\u9664\uFF0C\u4E0D\u4F1A\u5199\u8FDB\u63D2\u4EF6\u914D\u7F6E\u3002",
      // 生图/生视频通道（goal-58ba6a2c）
      "media.title": "\u751F\u56FE / \u751F\u89C6\u9891",
      "media.desc": "\u76F4\u8FDE\u4E0A\u6E38\u5A92\u4F53\u7AEF\u70B9\uFF0C\u7ED5\u8FC7 chat \u6E05\u5355\uFF0C\u4E0D\u4F1A\u88AB\u751F\u56FE\u6A21\u578B\u5F53\u804A\u5929\u6A21\u578B\u8C03\u3002",
      "media.kind.images": "\u751F\u56FE",
      "media.kind.videos": "\u751F\u89C6\u9891",
      "media.model": "\u6A21\u578B",
      "media.prompt": "\u63D0\u793A\u8BCD",
      "media.promptPlaceholder": "\u63CF\u8FF0\u8981\u751F\u6210\u7684\u5185\u5BB9\uFF0C\u4F8B\u5982\uFF1A\u82DC\u84FF\u53F6\u7ACB\u4EA4\u6865\u591C\u666F\u4FEF\u89C6\uFF0C\u8F66\u6D41\u5149\u8F68",
      "media.size": "\u5C3A\u5BF8",
      "media.width": "\u5BBD\uFF08\u50CF\u7D20\uFF09",
      "media.height": "\u9AD8\uFF08\u50CF\u7D20\uFF09",
      "media.duration": "\u65F6\u957F\uFF08\u79D2\uFF09",
      "media.ratio": "\u753B\u5E45",
      "media.resolution": "\u5206\u8FA8\u7387",
      "media.generate": "\u751F\u6210",
      "media.generating": "\u751F\u6210\u4E2D\u2026",
      "media.note.image": "\u751F\u6210\u901A\u5E38 10~90 \u79D2\uFF0C\u751F\u56FE\u6A21\u578B\u4E0D\u652F\u6301\u300C\u601D\u8003\u300D\u3002",
      "media.note.video": "\u5FEB\u6863\u6A21\u578B\u7EA6 20 \u79D2\u8FD4\u56DE\uFF1B\u6162\u6863\u53EF\u80FD\u8981\u7B49\u51E0\u5206\u949F\u5230\u5341\u51E0\u5206\u949F\uFF0C\u8BF7\u52FF\u5173\u95ED\u9875\u9762\u3002",
      "media.success.image": "\u751F\u6210\u6210\u529F\uFF0C\u8017\u65F6 {seconds} \u79D2\u3002",
      "media.success.video": "\u751F\u6210\u5B8C\u6210\uFF0C\u8017\u65F6 {seconds} \u79D2\u3002",
      "media.success.async": "\u5DF2\u63D0\u4EA4\u4EFB\u52A1 {taskId}\uFF0C\u72B6\u6001 {status}\uFF0C\u7A0D\u540E\u91CD\u8BD5\u53EF\u53D6\u7ED3\u679C\u3002",
      "media.result": "\u751F\u6210\u7ED3\u679C",
      "media.download": "\u4E0B\u8F7D / \u6253\u5F00",
      "media.empty": "\u586B\u597D\u63D0\u793A\u8BCD\u540E\u70B9\u300C\u751F\u6210\u300D\u3002",
      "media.error": "\u751F\u6210\u5931\u8D25\uFF1A{message}",
      "media.upstreamDown": "\u8BE5\u8DEF\u7531\u7684\u4E0A\u6E38\u6CA1\u6709\u76D1\u542C\uFF08\u5065\u5EB7\u68C0\u67E5 {status}\uFF09\uFF0C\u751F\u6210\u524D\u8BF7\u5148\u786E\u8BA4\u4E0A\u6E38\u5DF2\u542F\u52A8\u3002"
    };
    const en = {
      "card.title": "API Rules",
      "card.subtitle": "Manage every upstream model service in one place. Credentials stay on this machine.",
      "card.chip": "{ok} / {total} ready",
      "card.chipAll": "{total} APIs \xB7 all ready",
      "tab.codearts": "CodeArts",
      "tab.officeace": "OfficeAce",
      "tab.cline": "Cline",
      "tab.raccoon": "Raccoon",
      "name.codearts": "CodeArts account",
      "desc.codearts": "Signs requests with your AK / SK and calls the CodeArts gateway directly.",
      "name.officeace": "OfficeAce account",
      "desc.officeace": "Accounts and login live in the upstream admin panel; this plugin only forwards.",
      "name.cline": "Cline account",
      "desc.cline": "When a free model reports no account, add a Cline account in the admin panel.",
      "name.raccoon": "Raccoon account",
      "desc.raccoon": "Console for the Raccoon upstream this plugin launches; the key is asked once.",
      "tab.loomy2api": "Loomy",
      "name.loomy2api": "Loomy account",
      "desc.loomy2api": "Loomy Spark gateway launched by this plugin; it reuses your local Loomy login automatically.",
      "tab.minimax2api": "MiniMax",
      "name.minimax2api": "MiniMax account",
      "desc.minimax2api": "MiniMax gateway launched by this plugin; paste your MiniMax Agent JWT in its panel to add an account.",
      "panel.title": "Admin panel",
      "panel.note.officeace": "The link already carries the token \u2014 just open it.",
      "panel.note.cline": "Add a Cline account here when a free model reports no account.",
      "panel.note.raccoon": "The first visit asks for the management key: raccoon-local-admin.",
      "panel.note.loomy2api": "Panel password: sk-loomy-local. After login you can add accounts and view points / usage / logs.",
      "panel.note.minimax2api": "Panel password: sk-mm-local. After login, paste your MiniMax Agent JWT `_token` to add an account and view usage.",
      "tab.qoder2api-hub": "Qoder",
      "name.qoder2api-hub": "Qoder account",
      "panel.note.qoder2api-hub": "New Go bridge (Zhengyuuuui/qoder2api). Console :3588, password qoder-local; log in a Qoder account via OAuth/PAT in the console before the :8963 bridge starts listening.",
      "tab.trae2api-hub": "Trae",
      "name.trae2api-hub": "Trae account",
      "panel.note.trae2api-hub": "New Go bridge (XCool-603/trae2api). Console :7870; the CN account is auto-imported from the local Trae desktop client credentials \u2014 no manual login needed.",
      "panel.note.default": "Accounts and login are handled in this panel.",
      "panel.open": "Open admin panel",
      "panel.missing": "This route has no admin panel URL configured.",
      // Points remaining shown under the panel
      "points.label": "Points remaining",
      "points.totalLabel": "Upstream Points",
      "points.permanent": "Lifetime {n}",
      "points.daily": "Daily {n}",
      "points.popTitle": "{name} points detail",
      "points.openPanel": "Open workbench",
      "points.cn": "CN {n}",
      "points.intl": "Global {n}",
      "points.cnLabel": "CN",
      "points.intlLabel": "Global",
      "points.permanentLabel": "Lifetime",
      "points.dailyLabel": "Daily",
      "mm.title": "MiniMax accounts",
      "mm.empty": "No accounts yet. Paste a MiniMax Agent JWT `_token` to add one.",
      "mm.addTitle": "Add account",
      "mm.tokenPh": "Paste MiniMax Agent JWT _token",
      "mm.namePh": "Account label (optional)",
      "mm.add": "Add",
      "mm.delete": "Delete",
      "status.loading": "Loading\u2026",
      "status.unconfigured": "Not configured",
      "status.saved": "Ready",
      "status.up": "Upstream available",
      "status.down": "Upstream unavailable",
      "status.unreachable": "Upstream unreachable",
      "meta.models": "{n} models",
      "meta.autolaunch": "Launched by plugin",
      "field.ak": "Access Key (AK)",
      "field.sk": "Secret Key (SK)",
      "field.baseUrl": "Gateway URL",
      "field.authorization": "Authorization",
      "field.endpointDesc": "Point the plugin straight at your own gateway.",
      "ph.ak": "Paste AK",
      "ph.sk": "Paste SK",
      "ph.baseUrl": "https://\u2026/v2",
      "ph.authorization": "Paste the whole value, e.g. Basic xxxxxxxx",
      "ph.saved": "Leave blank to keep it",
      "mask.saved": "Saved {hint}",
      "action.save": "Save",
      "action.saving": "Saving\u2026",
      "action.clear": "Clear",
      "action.clearConfirm": "Confirm clear",
      "action.clearing": "Clearing\u2026",
      "sync.button": "Sync models",
      "sync.running": "Syncing\u2026",
      "sync.done": "Sync done: {added} added, {removed} removed, {skipped} skipped",
      "sync.fail": "Sync failed: {message}",
      "sync.last": "Last sync on enable: {added} added, {removed} removed",
      "sync.idle": "Available models have not been synced yet.",
      "sync.hint": "The plugin refreshes available models every time it is enabled; you can also click the button above to sync manually. Changes are written to the local model declarations \u2014 fine-tune them in the model selector editor.",
      "error.bothRequired": "Fill in both AK and SK",
      "error.baseUrlRequired": "The gateway URL must start with http:// or https://",
      "error.authRequired": "Authorization must not be empty",
      "error.load": "Failed to load: {message}",
      "error.save": "Failed to save: {message}",
      "error.clear": "Failed to clear: {message}",
      "empty.none": "No API to configure yet.",
      "alert.proxyDown": "The rule proxy is not listening (port {port}{error}), so every API will fail. Restart DSH to recover.",
      "foot": "Credentials are stored locally in ~/.dsh/.api-rules/accounts.json and removed with the plugin.",
      // Image / video channel (goal-58ba6a2c)
      "media.title": "Image / Video",
      "media.desc": "Calls the upstream media endpoints directly, bypassing the chat roster so image models are never sent to a chat endpoint.",
      "media.kind.images": "Image",
      "media.kind.videos": "Video",
      "media.model": "Model",
      "media.prompt": "Prompt",
      "media.promptPlaceholder": "Describe what to generate, e.g. aerial night view of a cloverleaf interchange with light trails",
      "media.size": "Size",
      "media.width": "Width (px)",
      "media.height": "Height (px)",
      "media.duration": "Duration (s)",
      "media.ratio": "Aspect ratio",
      "media.resolution": "Resolution",
      "media.generate": "Generate",
      "media.generating": "Generating\u2026",
      "media.note.image": "Usually 10\u201390 seconds. Image models do not support thinking levels.",
      "media.note.video": "Fast tiers return in about 20 seconds; slow tiers can take several minutes \u2014 keep this page open.",
      "media.success.image": "Done in {seconds}s.",
      "media.success.video": "Done in {seconds}s.",
      "media.success.async": "Task {taskId} submitted, status {status}. Try again later to fetch the result.",
      "media.result": "Result",
      "media.download": "Download / open",
      "media.empty": "Fill in a prompt and click Generate.",
      "media.error": "Generation failed: {message}",
      "media.upstreamDown": "The upstream for this route is not listening (health {status}); start it before generating."
    };
    const CSS = [
      /* 卡片骨架：宽度跟着 DSH 设置卡片走，不自己设最大宽度 */
      ".arc{width:100%;box-sizing:border-box;display:flex;flex-direction:column;font-family:var(--dsw-font-family,inherit);color:var(--dsw-alias-label-primary,CanvasText);}",
      ".arc *{box-sizing:border-box;}",
      /* 头部：左标题 + 右汇总 chip */
      ".arc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:4px 0 14px;}",
      ".arc-headMain{display:flex;flex-direction:column;gap:4px;min-width:0;}",
      ".arc-title{font-size:var(--dsw-font-s-strong-14-font-size,14px);line-height:var(--dsw-font-s-strong-14-line-height,22px);font-weight:var(--dsw-font-s-strong-14-font-weight,600);color:var(--dsw-alias-label-primary,CanvasText);}",
      ".arc-sub{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:var(--dsw-font-xxs-12-line-height,18px);color:var(--dsw-alias-label-secondary,#5c5c5c);}",
      ".arc-chip{flex:none;display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));background:var(--dsw-alias-bg-layer-1,transparent);font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:1;color:var(--dsw-alias-label-secondary,#8a8a8a);white-space:nowrap;}",
      ".arc-chip__dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#2ea44f);flex:none;}",
      ".arc-chip__dot.idle{background:var(--dsw-alias-label-quaternary,#b5b5b5);}",
      /* 标签栏：pill 胶囊，横向可滚动（路由多了也不换行挤压） */
      ".arc-tabs{display:flex;gap:4px;padding:0 0 12px;overflow-x:auto;scrollbar-width:none;}",
      ".arc-tabs::-webkit-scrollbar{display:none;}",
      ".arc-tab{flex:0 0 auto;display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 12px;border:.5px solid transparent;border-radius:999px;background:transparent;font-family:inherit;font-size:var(--dsw-font-xs-13-font-size,13px);line-height:1;font-weight:500;color:var(--dsw-alias-label-secondary,#5c5c5c);cursor:pointer;transition:background 140ms ease,color 140ms ease,border-color 140ms ease;}",
      ".arc-tab:hover{color:var(--dsw-alias-label-primary,CanvasText);background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));}",
      '.arc-tab[aria-selected="true"]{color:var(--dsw-alias-label-primary,CanvasText);font-weight:600;background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.16));border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.2));}',
      ".arc-tab:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176e6));outline-offset:1px;}",
      ".arc-tab__dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-label-quaternary,#b5b5b5);}",
      ".arc-tab__dot.ok{background:var(--dsw-alias-state-success-primary,#2ea44f);}",
      ".arc-tab__dot.err{background:var(--dsw-alias-state-error-primary,#d64545);}",
      /* 分区容器 */
      ".arc-pane{border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l2,rgba(127,127,127,.2)));background:var(--dsw-alias-settings-card-fill,transparent);border-radius:var(--dsw-radius-lg,10px);padding:14px 14px 12px;display:flex;flex-direction:column;gap:12px;}",
      ".arc-paneHead{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;}",
      ".arc-paneTitle{font-size:var(--dsw-font-xs-strong-13-font-size,13px);line-height:var(--dsw-font-xs-strong-13-line-height,20px);font-weight:600;color:var(--dsw-alias-label-primary,CanvasText);}",
      ".arc-paneDesc{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:var(--dsw-font-xxs-12-line-height,18px);color:var(--dsw-alias-label-secondary,#5c5c5c);margin-top:2px;}",
      /* 状态徽章：tone 只决定颜色，深浅色都靠 token 翻转 */
      ".arc-badge{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 8px;border-radius:var(--dsw-radius-md,6px);font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:1;white-space:nowrap;color:var(--dsw-alias-label-secondary,#8a8a8a);background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));}",
      ".arc-badge__dot{width:6px;height:6px;border-radius:50%;flex:none;background:currentColor;}",
      ".arc-badge.ok{color:var(--dsw-alias-state-success-primary,#2ea44f);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#2ea44f) 14%,transparent);}",
      ".arc-badge.err{color:var(--dsw-alias-state-error-primary,#d64545);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d64545) 14%,transparent);}",
      ".arc-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;color:var(--dsw-alias-label-secondary,#5c5c5c);}",
      ".arc-meta__sep{width:1px;height:10px;background:var(--dsw-alias-border-l3,rgba(127,127,127,.24));}",
      /* 表单 */
      ".arc-fields{display:flex;flex-direction:column;gap:12px;}",
      ".arc-field{display:flex;flex-direction:column;gap:6px;min-width:0;}",
      ".arc-fieldTop{display:flex;align-items:baseline;justify-content:space-between;gap:10px;}",
      ".arc-label{font-size:var(--dsw-font-xxs-strong-12-font-size,12px);line-height:18px;font-weight:600;color:var(--dsw-alias-label-secondary,#8a8a8a);}",
      ".arc-mask{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;color:var(--dsw-alias-label-quaternary,#b5b5b5);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%;}",
      ".arc-input{width:100%;height:34px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.28));border-radius:var(--dsw-radius-md,6px);background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,CanvasText);font-family:inherit;font-size:var(--dsw-font-s-14-font-size,14px);line-height:22px;outline:none;transition:border-color 140ms ease,box-shadow 140ms ease;}",
      ".arc-input::placeholder{color:var(--dsw-alias-label-tertiary,#6b6b6b);}",
      ".arc-input:hover{border-color:var(--dsw-alias-border-l3,rgba(127,127,127,.32));}",
      ".arc-input:focus{border-color:var(--dsw-alias-state-business-primary,#4176e6);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 18%,transparent);}",
      ".arc-input.invalid{border-color:var(--dsw-alias-state-error-primary,#d64545);}",
      ".arc-input.invalid:focus{box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-error-primary,#d64545) 18%,transparent);}",
      ".arc-fieldError{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;color:var(--dsw-alias-state-error-primary,#d64545);}",
      /* 面板卡（托管路由） */
      ".arc-panel{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:var(--dsw-radius-md,6px);background:var(--dsw-alias-bg-module-platform,transparent);}",
      ".arc-panel__icon{width:28px;height:28px;flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:var(--dsw-radius-sm,4px);background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));color:var(--dsw-alias-label-secondary,#8a8a8a);}",
      ".arc-panel__icon>svg{width:14px;height:14px;display:block;}",
      ".arc-panel__text{flex:1 1 180px;min-width:0;}",
      ".arc-panel__title{font-size:var(--dsw-font-xs-strong-13-font-size,13px);line-height:18px;font-weight:600;color:var(--dsw-alias-label-primary,CanvasText);}",
      ".arc-panel__note{margin-top:2px;font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;color:var(--dsw-alias-label-secondary,#5c5c5c);}",
      /* 按钮：主按钮底色与字色都随主题翻转（深色下是近白底 + 深字） */
      ".arc-actions{display:flex;justify-content:flex-end;align-items:center;gap:8px;flex-wrap:wrap;}",
      ".arc-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 14px;border-radius:var(--dsw-radius-md,6px);border:.5px solid transparent;font-family:inherit;font-size:var(--dsw-font-xs-13-font-size,13px);line-height:1;font-weight:600;cursor:pointer;transition:background 140ms ease,border-color 140ms ease,color 140ms ease;white-space:nowrap;}",
      ".arc-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176e6));outline-offset:2px;}",
      ".arc-btn:disabled{opacity:.45;cursor:default;}",
      ".arc-btn.primary{background:var(--dsw-alias-button-primary-fill,#1b1b1c);color:var(--dsw-alias-label-primary-foreground,#fff);}",
      ".arc-btn.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#43454a);}",
      ".arc-btn.ghost{background:transparent;border-color:var(--dsw-alias-border-l4,rgba(127,127,127,.28));color:var(--dsw-alias-label-secondary,#8a8a8a);font-weight:500;}",
      ".arc-btn.ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));color:var(--dsw-alias-label-primary,CanvasText);}",
      ".arc-btn.ghost.danger{color:var(--dsw-alias-state-error-primary,#d64545);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d64545) 42%,transparent);}",
      ".arc-btn.ghost.danger:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d64545) 12%,transparent);color:var(--dsw-alias-state-error-primary,#d64545);}",
      /* 管理面板按钮（锚点）：视觉同主按钮，语义是导航 */
      ".arc-link{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 14px;text-decoration:none;border-radius:var(--dsw-radius-md,6px);background:var(--dsw-alias-button-primary-fill,#1b1b1c);color:var(--dsw-alias-label-primary-foreground,#fff);font-size:var(--dsw-font-xs-13-font-size,13px);line-height:1;font-weight:600;white-space:nowrap;transition:background 140ms ease,transform 140ms ease;}",
      ".arc-link:hover{background:var(--dsw-alias-button-primary-hover,#43454a);}",
      ".arc-link:active{transform:translateY(1px);}",
      ".arc-link:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176e6));outline-offset:2px;}",
      ".arc-link>svg{width:13px;height:13px;display:block;flex:none;}",
      /* 全局错误条 */
      ".arc-alert{display:flex;align-items:flex-start;gap:8px;padding:9px 11px;margin-bottom:12px;border-radius:var(--dsw-radius-md,6px);border:.5px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#d64545) 32%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d64545) 10%,transparent);color:var(--dsw-alias-state-error-primary,#d64545);font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;}",
      /* 模型同步条 */
      ".arc-headSide{display:flex;align-items:center;gap:8px;flex:none;}",
      ".arc-sync-btn{white-space:nowrap;}",
      ".arc-sync-note{margin:0 0 12px;padding:9px 11px;border-radius:var(--dsw-radius-md,6px);border:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));background:var(--dsw-alias-bg-layer-1,transparent);}",
      ".arc-sync-line{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;color:var(--dsw-alias-label-secondary,#5c5c5c);}",
      ".arc-sync-line.ok{color:var(--dsw-alias-state-success-primary,#2ea44f);}",
      ".arc-sync-line.err{color:var(--dsw-alias-state-error-primary,#d64545);}",
      ".arc-sync-hint{margin-top:4px;font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;color:var(--dsw-alias-label-tertiary,#6b6b6b);}",
      /* 底部说明 */
      ".arc-foot{margin-top:12px;padding-top:10px;border-top:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;color:var(--dsw-alias-label-tertiary,#6b6b6b);}",
      /* 面板下方剩余积分 */
      ".arc-points{margin-top:10px;padding:9px 11px;border-radius:var(--dsw-radius-md,6px);border:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));background:var(--dsw-alias-bg-layer-1,transparent);display:flex;align-items:center;gap:10px;flex-wrap:wrap;}",
      ".arc-points__label{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;color:var(--dsw-alias-label-secondary,#5c5c5c);}",
      ".arc-points__value{font-size:var(--dsw-font-xs-strong-13-font-size,13px);line-height:18px;font-weight:600;color:var(--dsw-alias-label-primary,CanvasText);}",
      ".arc-points__sub{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;color:var(--dsw-alias-label-tertiary,#6b6b6b);}",
      /* 生图/生视频通道（goal-58ba6a2c） */
      ".arc-media{margin-top:14px;padding-top:14px;border-top:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));display:flex;flex-direction:column;gap:10px;}",
      ".arc-mediaHead{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;}",
      ".arc-mediaTitle{font-size:var(--dsw-font-xs-strong-13-font-size,13px);line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary,CanvasText);}",
      ".arc-mediaDesc{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;color:var(--dsw-alias-label-tertiary,#6b6b6b);}",
      ".arc-mediaKind{display:inline-flex;border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.28));border-radius:var(--dsw-radius-md,6px);overflow:hidden;flex:none;align-self:flex-start;}",
      ".arc-mediaKind button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#8a8a8a);font-family:inherit;font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:1;padding:7px 14px;cursor:pointer;transition:background 140ms ease,color 140ms ease;}",
      ".arc-mediaKind button+button{border-left:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.28));}",
      '.arc-mediaKind button[aria-pressed="true"]{background:var(--dsw-alias-button-primary-fill,#1b1b1c);color:var(--dsw-alias-label-primary-foreground,#fff);font-weight:600;}',
      ".arc-mediaForm{display:grid;grid-template-columns:1fr 1fr;gap:10px;}",
      ".arc-mediaForm>.arc-field.arc-prompt{grid-column:1/-1;}",
      ".arc-mediaTextarea{width:100%;min-height:74px;max-height:180px;resize:vertical;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.28));border-radius:var(--dsw-radius-md,6px);background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,CanvasText);font-family:inherit;font-size:var(--dsw-font-s-14-font-size,14px);line-height:22px;outline:none;}",
      ".arc-mediaSize{display:flex;align-items:center;gap:8px;width:100%;}",
      ".arc-mediaSize>.arc-input{flex:1;min-width:0;text-align:center;}",
      ".arc-mediaX{flex:none;color:var(--dsw-alias-label-tertiary,#6b6b6b);font-size:var(--dsw-font-s-14-font-size,14px);line-height:1;}",
      ".arc-mediaTextarea:focus{border-color:var(--dsw-alias-state-business-primary,#4176e6);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 18%,transparent);}",
      ".arc-mediaActions{display:flex;align-items:center;gap:10px;grid-column:1/-1;}",
      ".arc-mediaNote{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;color:var(--dsw-alias-label-tertiary,#6b6b6b);}",
      ".arc-mediaResult{margin-top:4px;display:flex;flex-direction:column;gap:8px;}",
      ".arc-mediaPreview{max-width:100%;border-radius:var(--dsw-radius-md,6px);border:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));}",
      ".arc-mediaVideo{width:100%;max-width:420px;border-radius:var(--dsw-radius-md,6px);border:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.14));}",
      ".arc-mediaLink{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;color:var(--dsw-alias-state-business-primary,#4176e6);word-break:break-all;}",
      ".arc-mediaOk{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;color:var(--dsw-alias-state-success-primary,#2ea44f);}",
      ".arc-mediaErr{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;color:var(--dsw-alias-state-error-primary,#d64545);}"
    ].join("");
    const EMPTY_DRAFT = { ak: "", sk: "", baseUrl: "", authorization: "" };
    function routeStatus(route) {
      const health = route && route.health;
      const checked = Boolean(health && health.checked);
      if (checked) {
        return health.ok ? { tone: "ok", key: "status.up" } : { tone: "err", key: "status.down" };
      }
      if (!route || !route.configured) return { tone: "", key: "status.unconfigured" };
      return { tone: "ok", key: "status.saved" };
    }
    function PanelLink(props) {
      const React = props.React;
      const icon = React.createElement(
        "svg",
        {
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 2,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true"
        },
        React.createElement("path", { d: "M15 3h6v6" }),
        React.createElement("path", { d: "M10 14 21 3" }),
        React.createElement("path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" })
      );
      return React.createElement(
        "a",
        { href: props.href, target: "_blank", rel: "noreferrer", className: "arc-link" },
        icon,
        React.createElement("span", null, props.label)
      );
    }
    function MediaSection(props) {
      const React = props.React;
      const t = props.t;
      const media = props.media || { images: [], videos: [] };
      const { useState } = React;
      const initialKind = media.images && media.images.length > 0 ? "images" : media.videos && media.videos.length > 0 ? "videos" : null;
      const [kind, setKind] = useState(initialKind);
      const [model, setModel] = useState("");
      const [prompt, setPrompt] = useState("");
      const [width, setWidth] = useState("1024");
      const [height, setHeight] = useState("1024");
      const [duration, setDuration] = useState("6");
      const [busy, setBusy] = useState(false);
      const [result, setResult] = useState(null);
      if (!initialKind) return null;
      const models = (kind === "images" ? media.images : media.videos) || [];
      const currentModel = model && models.includes(model) ? model : models[0] || "";
      const health = props.health || null;
      const upstreamDown = Boolean(health && health.checked === true && health.ok !== true);
      const switchKind = (next) => {
        if (next === kind) return;
        setKind(next);
        setResult(null);
      };
      const generate = async () => {
        if (busy) return;
        if (!prompt.trim()) return;
        setBusy(true);
        setResult(null);
        const startedAt = Date.now();
        const payload = { model: currentModel, prompt: prompt.trim() };
        if (kind === "images") {
          payload.size = width.trim() + "x" + height.trim();
        } else {
          const seconds = Number(duration);
          if (Number.isFinite(seconds) && seconds > 0) payload.duration = Math.round(seconds);
        }
        try {
          const raw = await props.onGenerate(props.routeId, kind, payload);
          const seconds = Math.round((Date.now() - startedAt) / 1e3);
          const url = extractMediaUrl(raw, kind);
          setResult({ kind, url, raw, seconds, error: "" });
        } catch (e) {
          setResult({ kind, url: "", raw: null, seconds: Math.round((Date.now() - startedAt) / 1e3), error: String(e && e.message || e) });
        } finally {
          setBusy(false);
        }
      };
      const kindTabs = [];
      if (media.images && media.images.length > 0) kindTabs.push("images");
      if (media.videos && media.videos.length > 0) kindTabs.push("videos");
      const noteKey = kind === "images" ? "media.note.image" : "media.note.video";
      return React.createElement(
        "div",
        { className: "arc-media" },
        React.createElement(
          "div",
          { className: "arc-mediaHead" },
          React.createElement("div", { className: "arc-mediaTitle" }, t("media.title")),
          React.createElement("div", { className: "arc-mediaDesc" }, t("media.desc"))
        ),
        kindTabs.length > 1 ? React.createElement(
          "div",
          { className: "arc-mediaKind", role: "group" },
          kindTabs.map(
            (k) => React.createElement(
              "button",
              { key: k, type: "button", "aria-pressed": k === kind ? "true" : "false", onClick: () => switchKind(k) },
              t(k === "images" ? "media.kind.images" : "media.kind.videos")
            )
          )
        ) : null,
        React.createElement(
          "div",
          { className: "arc-mediaForm" },
          React.createElement(
            "div",
            { className: "arc-field" },
            React.createElement("label", { className: "arc-label" }, t("media.model")),
            React.createElement(
              "select",
              {
                className: "arc-input",
                value: currentModel,
                onChange: (e) => setModel(e.target.value),
                disabled: busy
              },
              models.map((id) => React.createElement("option", { key: id, value: id }, id))
            )
          ),
          kind === "images" ? React.createElement(
            "div",
            { className: "arc-field" },
            React.createElement("label", { className: "arc-label" }, t("media.size")),
            React.createElement(
              "div",
              { className: "arc-mediaSize" },
              React.createElement("input", {
                className: "arc-input",
                type: "number",
                min: "64",
                max: "4096",
                step: "64",
                value: width,
                onChange: (e) => setWidth(e.target.value),
                "aria-label": t("media.width"),
                disabled: busy
              }),
              React.createElement("span", { className: "arc-mediaX", "aria-hidden": "true" }, "\xD7"),
              React.createElement("input", {
                className: "arc-input",
                type: "number",
                min: "64",
                max: "4096",
                step: "64",
                value: height,
                onChange: (e) => setHeight(e.target.value),
                "aria-label": t("media.height"),
                disabled: busy
              })
            )
          ) : React.createElement(
            "div",
            { className: "arc-field" },
            React.createElement("label", { className: "arc-label" }, t("media.duration")),
            React.createElement("input", {
              className: "arc-input",
              type: "number",
              min: "1",
              max: "60",
              value: duration,
              onChange: (e) => setDuration(e.target.value),
              disabled: busy
            })
          ),
          React.createElement(
            "div",
            { className: "arc-field arc-prompt" },
            React.createElement("label", { className: "arc-label" }, t("media.prompt")),
            React.createElement("textarea", {
              className: "arc-mediaTextarea",
              value: prompt,
              onChange: (e) => setPrompt(e.target.value),
              placeholder: t("media.promptPlaceholder"),
              disabled: busy
            })
          ),
          React.createElement(
            "div",
            { className: "arc-mediaActions" },
            React.createElement(
              "button",
              { className: "arc-btn primary", type: "button", onClick: generate, disabled: busy || !prompt.trim() || upstreamDown },
              busy ? t("media.generating") : t("media.generate")
            ),
            React.createElement("div", { className: "arc-mediaNote" }, t(noteKey))
          )
        ),
        upstreamDown ? React.createElement("div", { className: "arc-mediaErr" }, t("media.upstreamDown", { status: health.status || "?" })) : null,
        result ? React.createElement(MediaResult, { React, t, result }) : React.createElement("div", { className: "arc-mediaNote" }, t("media.empty"))
      );
    }
    function extractMediaUrl(raw, kind) {
      if (!raw || typeof raw !== "object") return "";
      if (typeof raw.url === "string" && raw.url) return raw.url;
      if (typeof raw.video_url === "string" && raw.video_url) return raw.video_url;
      if (raw.video && typeof raw.video.url === "string") return raw.video.url;
      if (raw.video && typeof raw.video.video_url === "string") return raw.video.video_url;
      if (Array.isArray(raw.data) && raw.data.length > 0) {
        const first = raw.data[0];
        if (typeof first === "string") return first;
        if (first && typeof first.url === "string") return first.url;
        if (first && typeof first.b64_json === "string") return "data:image/png;base64," + first.b64_json;
      }
      return "";
    }
    function MediaResult(props) {
      const React = props.React;
      const t = props.t;
      const r = props.result;
      if (r.error) return React.createElement("div", { className: "arc-mediaErr" }, t("media.error", { message: r.error }));
      const successLine = r.url ? t(r.kind === "images" ? "media.success.image" : "media.success.video", { seconds: r.seconds }) : t("media.success.async", {
        taskId: r.raw && (r.raw.task_id || r.raw.taskId || r.raw.id) || "?",
        status: r.raw && r.raw.status || "?"
      });
      const preview = r.url ? r.kind === "images" ? React.createElement("img", { className: "arc-mediaPreview", src: r.url, alt: "" }) : React.createElement("video", { className: "arc-mediaVideo", src: r.url, controls: true }) : null;
      return React.createElement(
        "div",
        { className: "arc-mediaResult" },
        React.createElement("div", { className: "arc-mediaTitle" }, t("media.result")),
        React.createElement("div", { className: "arc-mediaOk" }, successLine),
        preview,
        r.url ? React.createElement("a", { className: "arc-mediaLink", href: r.url, target: "_blank", rel: "noreferrer" }, t("media.download")) : null
      );
    }
    function ApiRulesCard(props) {
      const React = props.React;
      const t = props.t;
      const { useState, useEffect, useRef, useCallback } = React;
      const [routes, setRoutes] = useState([]);
      const [saved, setSaved] = useState({});
      const [drafts, setDrafts] = useState({});
      const [errors, setErrors] = useState({});
      const [global, setGlobal] = useState("");
      const [proxyDown, setProxyDown] = useState(null);
      const [busy, setBusy] = useState("");
      const [tab, setTab] = useState("");
      const [modelSync, setModelSync] = useState(null);
      const [syncBusy, setSyncBusy] = useState(false);
      const [syncFlash, setSyncFlash] = useState(null);
      const alive = useRef(true);
      const confirmTimer = useRef(null);
      const safeSet = (setter) => (value) => {
        if (alive.current) setter(value);
      };
      const load = useCallback(async () => {
        try {
          const res = await fetch("/api/api-rules/accounts");
          if (!res.ok) throw new Error("HTTP " + res.status);
          const data = await res.json();
          const list = Array.isArray(data.routes) ? data.routes : [];
          if (!alive.current) return;
          const map = {};
          for (const r of list) {
            map[r.id] = {
              configured: Boolean(r.configured),
              akHint: r.akHint || "",
              skHint: r.skHint || "",
              // 'aksk'（签名器路由）/ 'endpoint'（自带凭据：地址 + Authorization）/ 'managed'
              credentialKind: r.credentialKind || void 0,
              baseUrl: r.baseUrl || "",
              authorizationHint: r.authorizationHint || "",
              // 管理面板地址（patch 里的 adminUrl）；缺了它就不要渲染跳转按钮。
              adminUrl: typeof r.adminUrl === "string" ? r.adminUrl : "",
              autoLaunched: Boolean(r.autoLaunched),
              updatedAt: r.updatedAt ?? null,
              models: typeof r.models === "number" ? r.models : 0,
              needsCredential: Boolean(r.needsCredential),
              health: r.health || null,
              points: r.points || null
            };
          }
          setRoutes(list);
          setSaved(map);
          setGlobal("");
          const proxy = data.proxy;
          setProxyDown(proxy && proxy.listening === false ? { port: proxy.port, error: proxy.error || "" } : null);
          setModelSync(data.modelSync || null);
        } catch (e) {
          if (!alive.current) return;
          setRoutes([{ id: "codearts", label: "CodeArts", needsCredential: true, credentialKind: "aksk" }]);
          setSaved({
            codearts: {
              configured: false,
              akHint: "",
              skHint: "",
              credentialKind: "aksk",
              baseUrl: "",
              authorizationHint: "",
              adminUrl: "",
              autoLaunched: false,
              updatedAt: null,
              models: 0,
              needsCredential: true,
              health: null,
              points: null
            }
          });
          setGlobal(t("error.load", { message: String(e && e.message || e) }));
        }
      }, [t]);
      useEffect(() => {
        alive.current = true;
        load();
        const poll = setInterval(load, 6e4);
        return () => {
          alive.current = false;
          clearInterval(poll);
          if (confirmTimer.current) clearTimeout(confirmTimer.current);
        };
      }, [load]);
      const setDraft = useCallback(
        (id, patch) => safeSet(setDrafts)((prev) => ({ ...prev, [id]: { ...EMPTY_DRAFT, ...prev[id], ...patch } })),
        []
      );
      const setError = useCallback((id, err) => safeSet(setErrors)((prev) => ({ ...prev, [id]: err })), []);
      const clearError = useCallback(
        (id) => safeSet(setErrors)((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        }),
        []
      );
      const onSave = useCallback(
        async (id) => {
          const draft = drafts[id] || EMPTY_DRAFT;
          const snap = saved[id] || {};
          const endpoint = snap.credentialKind === "endpoint";
          let payload;
          if (endpoint) {
            const baseUrl = draft.baseUrl.trim() !== "" ? draft.baseUrl.trim() : snap.baseUrl || "";
            if (!/^https?:\/\//iu.test(baseUrl)) {
              setError(id, { field: "baseUrl", message: t("error.baseUrlRequired") });
              return;
            }
            if (draft.authorization.trim() === "" && !snap.configured) {
              setError(id, { field: "authorization", message: t("error.authRequired") });
              return;
            }
            payload = { baseUrl, authorization: draft.authorization.trim() };
          } else {
            if (draft.ak.trim() === "" || draft.sk.trim() === "") {
              setError(id, { field: "route", message: t("error.bothRequired") });
              return;
            }
            payload = { ak: draft.ak, sk: draft.sk };
          }
          clearError(id);
          setBusy("save:" + id);
          try {
            const res = await fetch("/api/api-rules/account?route=" + encodeURIComponent(id), {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            });
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              throw new Error(body.error || "HTTP " + res.status);
            }
            setDraft(id, { ...EMPTY_DRAFT });
            await load();
          } catch (e) {
            setError(id, { field: "route", message: t("error.save", { message: String(e && e.message || e) }) });
          } finally {
            if (alive.current) setBusy("");
          }
        },
        [drafts, saved, load, t, setDraft, setError, clearError]
      );
      const onClear = useCallback(
        async (id) => {
          if (busy === "clear:" + id) {
            if (confirmTimer.current) clearTimeout(confirmTimer.current);
            setBusy("clear:" + id + ":go");
            try {
              const res = await fetch("/api/api-rules/account?route=" + encodeURIComponent(id), { method: "DELETE" });
              if (!res.ok) throw new Error("HTTP " + res.status);
              setDraft(id, { ...EMPTY_DRAFT });
              await load();
            } catch (e) {
              setError(id, { field: "route", message: t("error.clear", { message: String(e && e.message || e) }) });
            } finally {
              if (alive.current) setBusy("");
            }
            return;
          }
          setBusy("clear:" + id);
          if (confirmTimer.current) clearTimeout(confirmTimer.current);
          confirmTimer.current = setTimeout(() => {
            if (alive.current) setBusy("");
          }, 5e3);
        },
        [busy, load, t, setDraft, setError]
      );
      const onSync = useCallback(
        async () => {
          if (syncBusy) return;
          setSyncBusy(true);
          setSyncFlash(null);
          try {
            const res = await fetch("/api/api-rules/models-sync", { method: "POST" });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || body.ok === false) throw new Error(body.error || "HTTP " + res.status);
            safeSet(setSyncFlash)({
              ok: true,
              text: t("sync.done", {
                added: String((body.added || []).length),
                removed: String((body.removed || []).length),
                skipped: String((body.skipped || []).length)
              })
            });
            await load();
          } catch (e) {
            safeSet(setSyncFlash)({ ok: false, text: t("sync.fail", { message: String(e && e.message || e) }) });
          } finally {
            if (alive.current) setSyncBusy(false);
          }
        },
        [syncBusy, load, t]
      );
      const activeTab = tab && routes.some((r) => r.id === tab) ? tab : routes[0] && routes[0].id || "";
      const active = routes.find((r) => r.id === activeTab);
      const tabName = (route) => {
        const key = "tab." + route.id;
        const localized = t(key);
        return typeof localized === "string" && localized !== key ? localized : route.label || route.id;
      };
      const paneName = (route) => {
        const key = "name." + route.id;
        const localized = t(key);
        return typeof localized === "string" && localized !== key ? localized : route.label || route.id;
      };
      const routeText = (id, field, fallbackKey) => {
        const key = field === "panelNote" ? "panel.note." + id : "panel.title";
        const localized = t(key);
        if (typeof localized === "string" && localized !== key) return localized;
        return fallbackKey ? t(fallbackKey) : "";
      };
      const renderPoints = (React2, t2, points) => {
        if (!points || points.available === null || points.available === void 0) return null;
        const permanent = typeof points.permanent === "number" ? points.permanent : null;
        const daily = typeof points.daily === "number" ? points.daily : null;
        const cn = typeof points.cn === "number" ? points.cn : null;
        const intl = typeof points.intl === "number" ? points.intl : null;
        const bits = [];
        if (cn !== null) bits.push(t2("points.cn", { n: fmtPoints(cn) }));
        if (intl !== null) bits.push(t2("points.intl", { n: fmtPoints(intl) }));
        if (bits.length === 0) {
          if (permanent !== null) bits.push(t2("points.permanent", { n: fmtPoints(permanent) }));
          if (daily !== null) bits.push(t2("points.daily", { n: fmtPoints(daily) }));
        }
        return React2.createElement(
          "div",
          { className: "arc-points" },
          React2.createElement("span", { className: "arc-points__label" }, t2("points.label")),
          React2.createElement("span", { className: "arc-points__value" }, fmtPoints(points.available)),
          bits.length > 0 ? React2.createElement("span", { className: "arc-points__sub" }, bits.join(" \xB7 ")) : null
        );
      };
      const fmtPoints = (value) => {
        if (typeof value !== "number" || !Number.isFinite(value)) return "";
        return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
      };
      const okCount = routes.filter((r) => routeStatus(saved[r.id] || r).tone === "ok").length;
      const snapshotOf = (id) => saved[id] || {
        configured: false,
        akHint: "",
        skHint: "",
        credentialKind: void 0,
        baseUrl: "",
        authorizationHint: "",
        adminUrl: "",
        autoLaunched: false,
        updatedAt: null,
        models: 0,
        needsCredential: false,
        health: null,
        points: null
      };
      const generateMedia = async (routeId, kind, payload) => {
        const res = await fetch("/api/api-rules/media-generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ routeId, kind, payload })
        });
        let json = null;
        try {
          json = await res.json();
        } catch {
          json = null;
        }
        if (!res.ok) {
          const message = json && json.error ? json.error : "HTTP " + res.status;
          throw new Error(message);
        }
        return json;
      };
      const syncButton = React.createElement(
        "button",
        {
          type: "button",
          className: "arc-btn ghost arc-sync-btn",
          onClick: onSync,
          disabled: syncBusy
        },
        syncBusy ? t("sync.running") : t("sync.button")
      );
      const header = React.createElement(
        "div",
        { className: "arc-head" },
        React.createElement(
          "div",
          { className: "arc-headMain" },
          React.createElement("div", { className: "arc-title" }, t("card.title")),
          React.createElement("div", { className: "arc-sub" }, t("card.subtitle"))
        ),
        React.createElement(
          "div",
          { className: "arc-headSide" },
          routes.length > 0 ? React.createElement(
            "div",
            { className: "arc-chip" },
            React.createElement("span", { className: "arc-chip__dot" + (okCount === 0 ? " idle" : ""), "aria-hidden": "true" }),
            React.createElement(
              "span",
              null,
              okCount === routes.length ? t("card.chipAll", { total: String(routes.length) }) : t("card.chip", { ok: String(okCount), total: String(routes.length) })
            )
          ) : null,
          syncButton
        )
      );
      const syncLine = syncFlash ? syncFlash.text : modelSync ? t("sync.last", {
        added: String((modelSync.added || []).length),
        removed: String((modelSync.removed || []).length)
      }) : t("sync.idle");
      const syncNote = React.createElement(
        "div",
        { className: "arc-sync-note" },
        React.createElement(
          "div",
          { className: "arc-sync-line" + (syncFlash ? syncFlash.ok ? " ok" : " err" : "") },
          syncLine
        ),
        React.createElement("div", { className: "arc-sync-hint" }, t("sync.hint"))
      );
      const tabs = React.createElement(
        "div",
        { className: "arc-tabs", role: "tablist" },
        ...routes.map((r) => {
          const st = routeStatus(snapshotOf(r.id));
          return React.createElement(
            "button",
            {
              key: r.id,
              type: "button",
              role: "tab",
              "aria-selected": r.id === activeTab ? "true" : "false",
              className: "arc-tab",
              onClick: () => safeSet(setTab)(r.id)
            },
            React.createElement("span", { className: "arc-tab__dot" + (st.tone ? " " + st.tone : ""), "aria-hidden": "true" }),
            tabName(r)
          );
        })
      );
      const alert = global ? React.createElement("div", { className: "arc-alert", role: "alert" }, global) : proxyDown ? React.createElement(
        "div",
        { className: "arc-alert", role: "alert" },
        t("alert.proxyDown", {
          port: String(proxyDown.port ?? ""),
          error: proxyDown.error ? "\uFF1A" + proxyDown.error : ""
        })
      ) : null;
      let pane = null;
      if (!active) {
        pane = React.createElement(
          "div",
          { className: "arc-pane" },
          React.createElement("div", { className: "arc-paneDesc" }, t("empty.none"))
        );
      } else {
        const id = active.id;
        const snap = snapshotOf(id);
        const draft = drafts[id] || EMPTY_DRAFT;
        const err = errors[id];
        const st = routeStatus(snap);
        const endpoint = snap.credentialKind === "endpoint";
        const managed = snap.credentialKind === "managed" || snap.credentialKind === void 0 && !snap.needsCredential;
        const isCredential = Boolean(snap.needsCredential) && !managed;
        const baseUrlValue = draft.baseUrl !== "" ? draft.baseUrl : snap.baseUrl || "";
        const dirty = endpoint ? baseUrlValue.trim() !== String(snap.baseUrl || "").trim() || draft.authorization.trim() !== "" : draft.ak.trim() !== "" || draft.sk.trim() !== "";
        const isBusySave = busy === "save:" + id;
        const isBusyClear = busy === "clear:" + id || busy === "clear:" + id + ":go";
        const canSave = dirty && !err && busy === "";
        const field = (key, labelText, placeholder, value, invalid, type) => React.createElement(
          "div",
          { className: "arc-field" },
          React.createElement(
            "div",
            { className: "arc-fieldTop" },
            React.createElement("div", { className: "arc-label" }, labelText),
            snap.configured && (snap.akHint || snap.skHint || snap.authorizationHint) ? React.createElement(
              "div",
              { className: "arc-mask" },
              t("mask.saved", {
                hint: key === "ak" ? snap.akHint || "" : key === "sk" ? snap.skHint || "" : key === "authorization" ? "\u2022\u2022\u2022\u2022" : ""
              })
            ) : null
          ),
          React.createElement("input", {
            className: "arc-input" + (invalid ? " invalid" : ""),
            type: type || "password",
            value,
            placeholder,
            autoComplete: "off",
            spellCheck: false,
            "aria-invalid": invalid ? "true" : "false",
            onChange: (e) => {
              clearError(id);
              setDraft(id, { [key]: e.target.value });
            }
          }),
          err && err.field === key ? React.createElement("div", { className: "arc-fieldError" }, err.message) : null
        );
        const actions = React.createElement(
          "div",
          { className: "arc-actions" },
          snap.configured ? React.createElement(
            "button",
            {
              type: "button",
              className: "arc-btn ghost" + (busy === "clear:" + id ? " danger" : ""),
              onClick: () => onClear(id),
              disabled: busy !== "" && !isBusyClear
            },
            isBusyClear ? busy === "clear:" + id + ":go" ? t("action.clearing") : t("action.clearConfirm") : t("action.clear")
          ) : null,
          React.createElement(
            "button",
            { type: "button", className: "arc-btn primary", onClick: () => onSave(id), disabled: !canSave },
            isBusySave ? t("action.saving") : t("action.save")
          )
        );
        let body;
        const panelUrl = typeof snap.adminUrl === "string" ? snap.adminUrl.trim() : "";
        if (managed) {
          body = React.createElement(
            "div",
            { className: "arc-fields" },
            panelUrl !== "" ? React.createElement(
              "div",
              { className: "arc-panel" },
              React.createElement(
                "span",
                { className: "arc-panel__icon", "aria-hidden": "true" },
                React.createElement(
                  "svg",
                  { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" },
                  React.createElement("rect", { x: 3, y: 11, width: 18, height: 11, rx: 2 }),
                  React.createElement("path", { d: "M7 11V7a5 5 0 0 1 10 0v4" })
                )
              ),
              React.createElement(
                "div",
                { className: "arc-panel__text" },
                React.createElement("div", { className: "arc-panel__title" }, routeText(id, "panelTitle", "panel.title")),
                React.createElement(
                  "div",
                  { className: "arc-panel__note" },
                  routeText(id, "panelNote", "panel.note.default")
                )
              ),
              React.createElement(PanelLink, { React, href: panelUrl, label: t("panel.open") })
            ) : React.createElement("div", { className: "arc-paneDesc" }, t("panel.missing")),
            renderPoints(React, t, snap.points)
          );
        } else if (endpoint) {
          body = React.createElement(
            "div",
            { className: "arc-fields" },
            React.createElement("div", { className: "arc-paneDesc" }, t("field.endpointDesc")),
            field("baseUrl", t("field.baseUrl"), t("ph.baseUrl"), baseUrlValue, Boolean(err && err.field === "baseUrl"), "text"),
            field(
              "authorization",
              t("field.authorization"),
              snap.configured ? t("ph.saved") : t("ph.authorization"),
              draft.authorization,
              Boolean(err && err.field === "authorization")
            )
          );
        } else {
          body = React.createElement(
            "div",
            { className: "arc-fields" },
            field(
              "ak",
              t("field.ak"),
              snap.configured ? t("ph.saved") : t("ph.ak"),
              draft.ak,
              Boolean(err && err.field === "ak")
            ),
            field(
              "sk",
              t("field.sk"),
              snap.configured ? t("ph.saved") : t("ph.sk"),
              draft.sk,
              Boolean(err && err.field === "sk")
            )
          );
        }
        const metaBits = [];
        if (snap.models > 0) metaBits.push(t("meta.models", { n: String(snap.models) }));
        if (snap.autoLaunched) metaBits.push(t("meta.autolaunch"));
        const meta = metaBits.length > 0 ? React.createElement(
          "div",
          { className: "arc-meta" },
          ...metaBits.flatMap(
            (text, i) => i === 0 ? [React.createElement("span", { key: "m" + i }, text)] : [
              React.createElement("span", { key: "s" + i, className: "arc-meta__sep", "aria-hidden": "true" }),
              React.createElement("span", { key: "m" + i }, text)
            ]
          )
        ) : null;
        const paneDescKey = "desc." + id;
        const paneDesc = t(paneDescKey);
        const hasDesc = typeof paneDesc === "string" && paneDesc !== paneDescKey;
        pane = React.createElement(
          "div",
          { className: "arc-pane", role: "tabpanel" },
          React.createElement(
            "div",
            { className: "arc-paneHead" },
            React.createElement(
              "div",
              { style: { minWidth: 0 } },
              React.createElement("div", { className: "arc-paneTitle" }, paneName(active)),
              hasDesc ? React.createElement("div", { className: "arc-paneDesc" }, paneDesc) : null
            ),
            React.createElement(
              "span",
              { className: "arc-badge" + (st.tone ? " " + st.tone : "") },
              React.createElement("span", { className: "arc-badge__dot", "aria-hidden": "true" }),
              t(st.key)
            )
          ),
          meta,
          body,
          active && active.media ? React.createElement(MediaSection, {
            React,
            t,
            routeId: active.id,
            media: active.media,
            health: saved[active.id] && saved[active.id].health || (active.health || null),
            onGenerate: generateMedia
          }) : null,
          err && err.field === "route" ? React.createElement("div", { className: "arc-fieldError" }, err.message) : null,
          isCredential ? actions : null
        );
      }
      return React.createElement(
        "div",
        { className: "arc" },
        React.createElement("style", null, CSS),
        header,
        syncNote,
        tabs,
        alert,
        pane,
        React.createElement("div", { className: "arc-foot" }, t("foot"))
      );
    }
    const POINTS_CSS = [
      ".dsm-workbuddy-composer-credits{display:inline-flex;align-items:center;min-width:0;}",
      ".dsm-workbuddy-composer-credits-trigger{appearance:none;display:inline-flex;align-items:center;align-self:stretch;max-width:200px;overflow:hidden;text-overflow:ellipsis;padding:2px 6px;border:0;border-radius:6px;background:transparent;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#999);white-space:nowrap;cursor:pointer;font-variant-numeric:tabular-nums;}",
      ".dsm-workbuddy-composer-credits-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));}",
      ".dsm-workbuddy-composer-credits-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px;}",
      ".dsm-workbuddy-composer-panel{position:fixed;z-index:1100;box-sizing:border-box;width:min(260px,calc(100vw - 24px));max-height:340px;overflow-y:auto;padding:12px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));border-radius:var(--dsw-radius-lg,14px);background:var(--dsw-specific-menu,Canvas);box-shadow:var(--dsw-elevation-prominent,0 8px 32px rgba(0,0,0,.22));backdrop-filter:var(--dsw-menu-backdrop-filter,none);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#444);}",
      ".dsm-workbuddy-composer-panel-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:6px;}",
      ".dsm-workbuddy-composer-panel-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,CanvasText);}",
      ".dsm-workbuddy-composer-panel-total{flex:none;font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;}",
      ".dsm-workbuddy-composer-panel-breakdown{border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));padding-top:6px;margin-bottom:10px;}",
      ".dsm-workbuddy-composer-panel-breakdown-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:3px 0;}",
      ".dsm-workbuddy-composer-panel-breakdown-label{flex:1 1 auto;min-width:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#c7ccd4);}",
      ".dsm-workbuddy-composer-panel-breakdown-value{flex:none;font-size:14px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary,CanvasText);font-variant-numeric:tabular-nums;}",
      ".dsm-workbuddy-composer-panel-list{border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));padding-top:4px;margin-bottom:10px;}",
      ".dsm-workbuddy-composer-panel-row{display:flex;flex-direction:column;gap:2px;padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16));}",
      ".dsm-workbuddy-composer-panel-row:last-child{border-bottom:0;}",
      ".dsm-workbuddy-composer-panel-row-main{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0;}",
      ".dsm-workbuddy-composer-panel-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,#444);}",
      ".dsm-workbuddy-composer-panel-value{flex:none;font-weight:600;color:var(--dsw-alias-label-primary,CanvasText);font-variant-numeric:tabular-nums;}",
      ".dsm-workbuddy-composer-panel-sub{display:block;font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary,#999);white-space:normal;overflow-wrap:anywhere;}",
      ".dsm-workbuddy-composer-panel-open{display:block;width:100%;box-sizing:border-box;text-align:center;padding:6px 8px;border-radius:var(--dsw-radius-md,8px);border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.28));background:transparent;color:var(--dsw-alias-label-primary,CanvasText);font-size:12px;line-height:18px;text-decoration:none;cursor:pointer;overflow-wrap:anywhere;}",
      ".dsm-workbuddy-composer-panel-open:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));}"
    ].join("");
    const PLATFORM_NAMES = [
      { short: "loomy", keys: ["loomy2api", "loomy", "xunfei"] },
      { short: "minimax", keys: ["minimax2api", "minimax"] },
      { short: "raccoon", keys: ["raccoon", "sensenova", "sensenovaflash", "nova"] },
      { short: "trae", keys: ["trae2apihub", "trae"] },
      { short: "officeace", keys: ["officeace", "office", "wps"] },
      { short: "codearts", keys: ["codearts", "huawei"] },
      { short: "cline", keys: ["cline", "cline2api"] }
    ];
    const normName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const providerName = (id) => {
      const n = normName(id);
      if (!n) return "";
      for (const p of PLATFORM_NAMES) {
        if (p.keys.some((k) => {
          const kn = normName(k);
          return n === kn || n.includes(kn) || kn.includes(n);
        })) return p.short;
      }
      return String(id || "");
    };
    const formatCredit = (value) => {
      if (typeof value !== "number" || !Number.isFinite(value)) return "";
      return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
    };
    function ComposerProviderPoints(props) {
      const t = props.t;
      const useProjection = props.useProjection;
      const selection = useProjection ? useProjection("modelSelection") : void 0;
      const chosen = selection ? selection.next ?? selection.lastUsed : void 0;
      const routeId = chosen ? chosen.provider : null;
      const __store = typeof window !== "undefined" ? window : {};
      const [open, setOpenRaw] = ReactTop.useState(__store.__arcPillOpen === true);
      const setOpen = (value) => {
        const next = typeof value === "function" ? value(__store.__arcPillOpen === true) : value;
        __store.__arcPillOpen = next;
        setOpenRaw(next);
      };
      ReactTop.useEffect(() => {
        if (!open) return void 0;
        const closeOutside = (event) => {
          const target = event.target;
          if (target instanceof Node && rootRef.current?.contains(target) !== true && panelRef.current?.contains(target) !== true) setOpen(false);
        };
        document.addEventListener("pointerdown", closeOutside);
        return () => {
          document.removeEventListener("pointerdown", closeOutside);
        };
      }, [open]);
      const [detail, setDetail] = ReactTop.useState(null);
      const [position, setPosition] = ReactTop.useState(null);
      const rootRef = ReactTop.useRef(null);
      const panelRef = ReactTop.useRef(null);
      const openedAtRef = ReactTop.useRef(0);
      ReactTop.useEffect(() => {
        if (!routeId) return;
        let cancelled = false;
        const load = async () => {
          try {
            const res = await fetch("/api/api-rules/accounts");
            if (!res.ok) return;
            const data = await res.json();
            const list = Array.isArray(data.routes) ? data.routes : [];
            const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
            const pid = norm(routeId);
            const ALIAS = { raccoon: ["sensenova", "sensenovaflash", "nova"], officeace: ["office", "wps"], loomy2api: ["loomy", "xunfei"], minimax2api: ["minimax"], "trae2api-hub": ["trae"], codearts: ["codearts", "huawei"], cline: ["cline", "cline2api"] };
            const hit = list.find((r) => {
              const rid = norm(r.id);
              if (!pid || !rid) return false;
              if (rid === pid) return true;
              const aliases = ALIAS[r.id] || [];
              if (aliases.some((a) => pid === norm(a) || pid.includes(norm(a)) || norm(a).includes(pid))) return true;
              return pid.includes(rid) || rid.includes(pid);
            }) || null;
            if (!cancelled) setDetail(hit);
          } catch {
            if (!cancelled) setDetail(null);
          }
        };
        load();
        const timer = setInterval(load, 6e4);
        return () => {
          cancelled = true;
          clearInterval(timer);
        };
      }, [routeId]);
      ReactTop.useLayoutEffect(() => {
        if (!open) {
          setPosition(null);
          return void 0;
        }
        const gap = 8;
        const margin = 12;
        const place = () => {
          const rect = rootRef.current?.getBoundingClientRect();
          if (rect === void 0 || rect === null) return;
          const panel2 = panelRef.current;
          const width = panel2?.offsetWidth ?? 0;
          const height = panel2?.offsetHeight ?? 0;
          let left = rect.left;
          let top = rect.top - gap - height;
          if (width > 0) left = Math.min(Math.max(left, margin), window.innerWidth - width - margin);
          if (height > 0) top = Math.min(Math.max(top, margin), window.innerHeight - height - margin);
          setPosition({ left, top });
        };
        place();
        window.addEventListener("scroll", place, true);
        window.addEventListener("resize", place);
        const panel = panelRef.current;
        let observer = null;
        if (typeof ResizeObserver !== "undefined" && panel !== null) {
          observer = new ResizeObserver(place);
          observer.observe(panel);
        }
        return () => {
          observer?.disconnect();
          window.removeEventListener("scroll", place, true);
          window.removeEventListener("resize", place);
        };
      }, [open]);
      ReactTop.useEffect(() => {
        if (!open || !routeId) return;
        let cancelled = false;
        const load = async () => {
          try {
            const res = await fetch("/api/api-rules/detail?route=" + encodeURIComponent(routeId));
            if (!res.ok) return;
            const data = await res.json();
            if (!cancelled) setDetail((prev) => ({ ...prev || {}, accounts: data.accounts || [], points: data.points || prev && prev.points || null }));
          } catch {
          }
        };
        load();
        return () => {
          cancelled = true;
        };
      }, [open, routeId]);
      const name2 = providerName(routeId);
      const points = detail && detail.points;
      const available = points && typeof points.available === "number" ? points.available : null;
      const adminUrl = detail && detail.adminUrl;
      if (!routeId || !detail || available === null) return null;
      const breakdown = [];
      if (points && typeof points.permanent === "number") breakdown.push({ key: "permanent", label: t("points.permanentLabel"), value: formatCredit(points.permanent) });
      if (points && typeof points.daily === "number") breakdown.push({ key: "daily", label: t("points.dailyLabel"), value: formatCredit(points.daily) });
      if (points && typeof points.cn === "number") breakdown.push({ key: "cn", label: t("points.cnLabel"), value: formatCredit(points.cn) });
      if (points && typeof points.intl === "number") breakdown.push({ key: "intl", label: t("points.intlLabel"), value: formatCredit(points.intl) });
      const accounts = detail && Array.isArray(detail.accounts) ? detail.accounts : [];
      return ReactTop.createElement(
        "span",
        { className: "dsm-workbuddy-composer-credits", ref: rootRef },
        ReactTop.createElement("style", null, POINTS_CSS),
        ReactTop.createElement(
          "button",
          {
            type: "button",
            className: "dsm-workbuddy-composer-credits-trigger",
            "aria-haspopup": "dialog",
            "aria-expanded": open,
            onClick: () => setOpen(!open)
          },
          name2,
          " \xB7 ",
          available === null ? "\u2014" : formatCredit(available)
        ),
        open ? ReactDOMTop.createPortal(
          ReactTop.createElement(
            "div",
            {
              className: "dsm-workbuddy-composer-panel",
              ref: panelRef,
              role: "dialog",
              "aria-label": name2,
              style: position ?? { visibility: "hidden", left: 0, top: 0 }
            },
            ReactTop.createElement(
              "div",
              { className: "dsm-workbuddy-composer-panel-head" },
              ReactTop.createElement("span", { className: "dsm-workbuddy-composer-panel-title" }, t("points.popTitle", { name: name2 })),
              ReactTop.createElement("span", { className: "dsm-workbuddy-composer-panel-total" }, available === null ? "\u2014" : formatCredit(available))
            ),
            breakdown.length > 0 ? ReactTop.createElement(
              "div",
              { className: "dsm-workbuddy-composer-panel-breakdown" },
              ...breakdown.map(
                (it) => ReactTop.createElement(
                  "div",
                  { className: "dsm-workbuddy-composer-panel-breakdown-row", key: it.key },
                  ReactTop.createElement("span", { className: "dsm-workbuddy-composer-panel-breakdown-label" }, it.label),
                  ReactTop.createElement("span", { className: "dsm-workbuddy-composer-panel-breakdown-value" }, it.value)
                )
              )
            ) : null,
            accounts.length > 0 ? ReactTop.createElement(
              "div",
              { className: "dsm-workbuddy-composer-panel-list" },
              ...accounts.map((acct) => {
                const sub = [];
                if (typeof acct.permanent === "number") sub.push(t("points.permanent", { n: formatCredit(acct.permanent) }));
                if (typeof acct.daily === "number") sub.push(t("points.daily", { n: formatCredit(acct.daily) }));
                if (typeof acct.region === "string") sub.push(acct.region === "cn" ? t("points.cnLabel") : t("points.intlLabel"));
                return ReactTop.createElement(
                  "div",
                  { className: "dsm-workbuddy-composer-panel-row", key: acct.name },
                  ReactTop.createElement(
                    "div",
                    { className: "dsm-workbuddy-composer-panel-row-main" },
                    ReactTop.createElement("span", { className: "dsm-workbuddy-composer-panel-name" }, acct.name || ""),
                    ReactTop.createElement("span", { className: "dsm-workbuddy-composer-panel-value" }, formatCredit(acct.value))
                  ),
                  sub.length > 0 ? ReactTop.createElement("span", { className: "dsm-workbuddy-composer-panel-sub" }, sub.join(" \xB7 ")) : null
                );
              })
            ) : null,
            adminUrl ? ReactTop.createElement(
              "a",
              { className: "dsm-workbuddy-composer-panel-open", href: adminUrl, target: "_blank", rel: "noreferrer" },
              t("points.openPanel")
            ) : null
          ),
          document.body
        ) : null
      );
    }
    function apply(ctx) {
      try {
        const namespace = "settings.api-rules";
        ctx.effect(() => ctx.locale.register(namespace, { zh, en }), "dsh-api-rules: settings copy");
        const t = ctx.locale.bind(namespace);
        const React = require2("react");
        ctx.slots.inject(
          "plugins.bundle.config",
          () => ctx.slots.register(
            { name: "plugins.bundle.config", key: "@local/dsh-api-rules", locale: namespace },
            () => React.createElement(ApiRulesCard, { React, t })
          )
        );
        ctx.slots.inject(
          "conversation.input.right",
          () => ctx.slots.register(
            {
              name: "conversation.input.right",
              id: "dsh-api-rules-composer-points",
              order: 5,
              locale: namespace,
              inject: () => ({ t })
            },
            (props) => React.createElement(ComposerProviderPoints, props)
          )
        );
      } catch (e) {
        console.error("[dsh-api-rules] client apply failed:", e);
      }
    }
    return { apply, inject, name };
  }
});
