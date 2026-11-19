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
      "tab.minimax2api": "MiniMax",
      "name.minimax2api": "MiniMax \u8D26\u53F7",
      "desc.minimax2api": "\u7531\u63D2\u4EF6\u81EA\u52A8\u62C9\u8D77\u7684 MiniMax \u7F51\u5173\uFF0C\u5230\u9762\u677F\u7C98\u8D34 MiniMax Agent \u7684 JWT \u6DFB\u52A0\u8D26\u53F7\u5373\u53EF\u3002",
      "panel.title": "\u7BA1\u7406\u9762\u677F",
      "panel.note.officeace": "\u94FE\u63A5\u5DF2\u5E26\u597D\u53E3\u4EE4\uFF0C\u70B9\u5F00\u5373\u53EF\u7BA1\u7406\u8D26\u53F7\u3002",
      "panel.note.cline": "\u514D\u8D39\u6A21\u578B\u63D0\u793A\u8D26\u53F7\u4E0D\u8DB3\u65F6\uFF0C\u5728\u8FD9\u91CC\u6DFB\u52A0 Cline \u8D26\u53F7\u3002",
      "panel.note.raccoon": "\u9996\u6B21\u8FDB\u5165\u8981\u586B\u4E00\u6B21\u7BA1\u7406\u5BC6\u94A5\uFF1Araccoon-local-admin\uFF0C\u586B\u8FC7\u5C31\u4E0D\u518D\u8BE2\u95EE\u3002",
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
      "media.upstreamDown": "\u8BE5\u8DEF\u7531\u7684\u4E0A\u6E38\u6CA1\u6709\u76D1\u542C\uFF08\u5065\u5EB7\u68C0\u67E5 {status}\uFF09\uFF0C\u751F\u6210\u524D\u8BF7\u5148\u786E\u8BA4\u4E0A\u6E38\u5DF2\u542F\u52A8\u3002",
      "up.addButton": "\u6dfb\u52a0\u4e0a\u6e38",
      "up.listTitle": "\u5df2\u6dfb\u52a0\u4e0a\u6e38\uff08\u70b9\u300c\u5220\u9664\u300d\u4e24\u6b21\u786e\u8ba4\uff09",
      "up.addTitle": "\u6dfb\u52a0 OpenAI \u534f\u8bae\u4e0a\u6e38",
      "up.desc": "\u586b\u4e0a\u6e38\u7684 OpenAI \u517c\u5bb9\u5730\u5740\u4e0e\u5bc6\u94a5\uff0c\u4fdd\u5b58\u540e\u81ea\u52a8\u6210\u4e3a\u4e00\u6761\u8def\u7531\u5e76\u540c\u6b65\u8fdb\u6a21\u578b\u9009\u62e9\u5668\u3002",
      "up.idLabel": "ID\uff08\u53ef\u9009\uff0c\u7559\u7a7a\u6309\u540d\u79f0\u81ea\u52a8\u751f\u6210\uff09",
      "up.idPh": "\u4f8b\u5982 my-upstream",
      "up.nameLabel": "\u540d\u79f0",
      "up.namePh": "\u4f8b\u5982 My Upstream",
      "up.baseUrlLabel": "OpenAI \u517c\u5bb9\u5730\u5740",
      "up.baseUrlPh": "https://api.example.com/v1",
      "up.apiKeyLabel": "API Key",
      "up.apiKeyPh": "sk-...",
      "up.rulesLabel": "\u89c4\u5219\u5305\uff08\u9017\u53f7\u5206\u9694\uff09",
      "up.rulesPh": "\u7559\u7a7a = generic\uff1b\u5982 intern-ai",
      "up.modelsLabel": "\u6a21\u578b\u6e05\u5355\uff08\u9017\u53f7\u5206\u9694\uff09",
      "up.modelsPh": "\u5982 deepseek-v4.1-flash-1017, glm-5.3:131072",
      "up.concurrencyLabel": "\u5e76\u53d1\u6570\uff08\u53ef\u9009\uff09",
      "up.concurrencyPh": "\u5982 2",
      "up.timeoutLabel": "\u8d85\u65f6\u6beb\u79d2\uff08\u53ef\u9009\uff09",
      "up.timeoutPh": "\u5982 300000",
      "up.passthroughLabel": "\u900f\u4f20\u9274\u6743\uff08\u7528 DSH \u51ed\u636e\u91cc\u7684\u5bc6\u94a5\uff0c\u672c\u63d2\u4ef6\u4e0d\u5b58\uff09",
      "up.apiKeyEnvLabel": "DSH \u51ed\u636e\u540d\uff08\u900f\u4f20\u65f6\u7528\uff09",
      "up.apiKeyEnvPh": "\u5982 INTERN_AI_API_KEY\uff1b\u7559\u7a7a\u5219\u7528\u5360\u4f4d\u5bc6\u94a5",
      "up.modelsFetch": "\u62c9\u53d6\u6a21\u578b\u6e05\u5355",
      "up.modelsFetching": "\u62c9\u53d6\u4e2d\u2026",
      "up.modelsFetched": "\u5df2\u62c9\u53d6 {count} \u4e2a\u6a21\u578b",
      "up.modelsFetchedKept": "\u5df2\u62c9\u53d6 {count} \u4e2a\u6a21\u578b\uff0c\u53e6\u4fdd\u7559\u4e0a\u6e38\u672a\u5217\u51fa\u7684\uff1a{kept}",
      "up.modelsEmpty": "\u4e0a\u6e38\u6ca1\u8fd4\u56de\u4efb\u4f55\u6a21\u578b\uff08\u6e05\u5355\u4e3a\u7a7a\uff09",
      "error.upModels": "\u62c9\u53d6\u5931\u8d25\uff1a{message}",
      "up.add": "\u6dfb\u52a0",
      "up.edit": "\u7f16\u8f91",
      "up.update": "\u4fdd\u5b58\u4fee\u6539",
      "up.updating": "\u4fdd\u5b58\u4e2d\u2026",
      "up.editHint": "\u7f16\u8f91\u300c{id}\u300d：\u5730\u5740\u53ef\u6539，\u5bc6\u94a5\u7559\u7a7a\u5219\u4fdd\u7559\u539f\u503c\u3002",
      "up.adding": "\u6dfb\u52a0\u4e2d\u2026",
      "up.cancel": "\u53d6\u6d88",
      "up.advShow": "\u9ad8\u7ea7\u9009\u9879",
      "up.advHide": "\u6536\u8d77\u9ad8\u7ea7\u9009\u9879",
      "up.delete": "\u5220\u9664",
      "up.deleteConfirm": "\u518d\u70b9\u4e00\u6b21\u786e\u8ba4\u5220\u9664\u300c{id}\u300d",
      "up.empty": "\u8fd8\u6ca1\u6709\u52a8\u6001\u4e0a\u6e38\u3002\u70b9\u53f3\u4e0a\u300c\uff0b\u300d\u6dfb\u52a0\u4e00\u4e2a OpenAI \u534f\u8bae\u4e0a\u6e38\u3002",
      "up.added": "\u5df2\u6dfb\u52a0\u300c{id}\u300d\uff0c\u6a21\u578b\u540c\u6b65 +{added} -{removed}\u3002",
      "up.deleted": "\u5df2\u5220\u9664\u300c{id}\u300d\u3002",
      "error.upIdInvalid": "ID \u53ea\u80fd\u7528\u5c0f\u5199\u5b57\u6bcd\u3001\u6570\u5b57\u3001\u8fde\u5b57\u7b26\uff081\u201348 \u4f4d\uff0c\u5b57\u6bcd\u6216\u6570\u5b57\u5f00\u5934\uff09\u3002",
      "error.upBaseUrlRequired": "\u8bf7\u586b\u5199\u5408\u6cd5\u7684 http(s) \u4e0a\u6e38\u5730\u5740\u3002",
      "error.upApiKeyRequired": "\u8bf7\u586b\u5199 API Key\u3002",
      "error.tjUsernameRequired": "\u540c\u6d4e\u5de5\u53f7\u4e0d\u80fd\u4e3a\u7a7a\u3002",
      "error.upNameRequired": "\u8bf7\u586b\u5199\u540d\u79f0\uff08\u7528\u4e8e\u751f\u6210 ID\uff09\u3002",
      "error.upAdd": "\u6dfb\u52a0\u5931\u8d25\uff1a{message}",
      "error.upDelete": "\u5220\u9664\u5931\u8d25\uff1a{message}",
      "up.models": "{n} \u4e2a\u6a21\u578b",
      "up.cardAddress": "\u4e0a\u6e38 API \u5730\u5740",
      "up.cardKeyLabel": "\u0041\u0050\u0049\u0020\u004b\u0065\u0079\uff08\u7559\u7a7a\u4fdd\u7559\u539f\u503c\uff09",
      "up.cardProxyNote": "\u5730\u5740\u4ec5\u4f5c\u5c55\u793a\uff1b\u5b9e\u9645\u8bf7\u6c42\u4ecd\u7ecf\u672c\u63d2\u4ef6\u4ee3\u7406\uff0c\u89c4\u5219\u5305\u8282\u6d41\u7ee7\u7eed\u751f\u6548\u3002",
      "up.saved": "\u5df2\u4fdd\u5b58\u300c{id}\u300d\uff0c\u6a21\u578b\u540c\u6b65\u002b{added}\u0020\u002d{removed}\u3002",
      "up.tjUsernameLabel": "\u540c\u6d4e\u5de5\u53f7",
      "up.tjUsernamePh": "请填写学工号",
      "up.tjPasswordLabel": "\u7edf\u4e00\u8eab\u4efd\u8ba4\u8bc1\u5bc6\u7801",
      "up.tjAccountDesc": "\u7528\u4e8e\u81ea\u52a8\u8fde\u63a5\u540c\u6d4e VPN \u4e0e\u767b\u5f55 AIGC \u4e13\u533a\uff08\u5185\u7f51\u76f4\u8fde IAM\uff0c\u5916\u7f51\u5f39\u6d4f\u89c8\u5668\u589e\u5f3a\u8ba4\u8bc1\uff09\u3002",
      "up.tjSaveAccount": "\u4fdd\u5b58\u540c\u6d4e\u8d26\u53f7",
      "up.tjSaved": "\u5df2\u4fdd\u5b58",
      "up.tjSaving": "\u4fdd\u5b58\u4e2d\u2026",
      "error.tjUsernameRequired": "\u540c\u6d4e\u5de5\u53f7\u4e0d\u80fd\u4e3a\u7a7a\u3002",
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
      "tab.minimax2api": "MiniMax",
      "name.minimax2api": "MiniMax account",
      "desc.minimax2api": "MiniMax gateway launched by this plugin; paste your MiniMax Agent JWT in its panel to add an account.",
      "panel.title": "Admin panel",
      "panel.note.officeace": "The link already carries the token \u2014 just open it.",
      "panel.note.cline": "Add a Cline account here when a free model reports no account.",
      "panel.note.raccoon": "The first visit asks for the management key: raccoon-local-admin.",
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
      "media.upstreamDown": "The upstream for this route is not listening (health {status}); start it before generating.",
      "up.addButton": "Add upstream",
      "up.listTitle": "Added upstreams (click Delete twice to confirm)",
      "up.addTitle": "Add OpenAI-protocol upstream",
      "up.desc": "Enter the upstream's OpenAI-compatible base URL and API key. On save it becomes a route and syncs into the model selector.",
      "up.idLabel": "ID (optional, generated from name if blank)",
      "up.idPh": "e.g. my-upstream",
      "up.nameLabel": "Name",
      "up.namePh": "e.g. My Upstream",
      "up.baseUrlLabel": "OpenAI-compatible base URL",
      "up.baseUrlPh": "https://api.example.com/v1",
      "up.apiKeyLabel": "API Key",
      "up.apiKeyPh": "sk-...",
      "up.rulesLabel": "Rule packs (comma-separated)",
      "up.rulesPh": "blank = generic; e.g. intern-ai",
      "up.modelsLabel": "Models (comma-separated)",
      "up.modelsPh": "e.g. deepseek-v4.1-flash-1017, glm-5.3:131072",
      "up.concurrencyLabel": "Concurrency (optional)",
      "up.concurrencyPh": "e.g. 2",
      "up.timeoutLabel": "Timeout ms (optional)",
      "up.timeoutPh": "e.g. 300000",
      "up.passthroughLabel": "Passthrough auth (use the key held by DSH credentials; not stored here)",
      "up.apiKeyEnvLabel": "DSH credential ref (for passthrough)",
      "up.apiKeyEnvPh": "e.g. INTERN_AI_API_KEY; blank = placeholder key",
      "up.modelsFetch": "Fetch model list",
      "up.modelsFetching": "Fetching\u2026",
      "up.modelsFetched": "Fetched {count} models",
      "up.modelsFetchedKept": "Fetched {count} models; kept ones the upstream omits: {kept}",
      "up.modelsEmpty": "Upstream returned no models",
      "error.upModels": "Fetch failed: {message}",
      "up.add": "Add",
      "up.edit": "Edit",
      "up.update": "Save changes",
      "up.updating": "Saving\u2026",
      "up.editHint": "Editing \"{id}\": you can change the URL; leave the key blank to keep the current one.",
      "up.adding": "Adding…",
      "up.cancel": "Cancel",
      "up.advShow": "Advanced options",
      "up.advHide": "Hide advanced options",
      "up.delete": "Delete",
      "up.deleteConfirm": "Click again to confirm deleting \"{id}\"",
      "up.empty": "No dynamic upstreams yet. Click \"＋\" to add an OpenAI-protocol upstream.",
      "up.added": "Added \"{id}\". Model sync +{added} -{removed}.",
      "up.deleted": "Deleted \"{id}\".",
      "error.upIdInvalid": "ID may only use lowercase letters, digits, hyphens (1–48 chars, starts with a letter or digit).",
      "error.upBaseUrlRequired": "Enter a valid http(s) upstream URL.",
      "error.upApiKeyRequired": "Enter an API key.",
      "error.tjUsernameRequired": "Tongji ID is required.",
      "error.upNameRequired": "Enter a name (used to generate the ID).",
      "error.upAdd": "Add failed: {message}",
      "error.upDelete": "Delete failed: {message}",
      "up.models": "{n} models",
      "up.cardAddress": "Upstream API address",
      "up.cardKeyLabel": "API Key (leave blank to keep the current one)",
      "up.cardProxyNote": "Address shown for reference only; requests still go through this plugin proxy so rule-pack throttling stays active.",
      "up.saved": "Saved \"{id}\". Model sync +{added} -{removed}.",
      "up.tjUsernameLabel": "Tongji ID",
      "up.tjUsernamePh": "e.g. 1234567",
      "up.tjPasswordLabel": "SSO password",
      "up.tjAccountDesc": "Used to auto-connect Tongji VPN and sign in to AIGC (IAM on campus; browser MFA off campus).",
      "up.tjSaveAccount": "Save Tongji Account",
      "up.tjSaved": "Saved",
      "up.tjSaving": "Saving...",
      "error.tjUsernameRequired": "Tongji ID is required.",
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
      ".arc-flash{max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:24px;color:var(--dsw-alias-label-secondary,#5c5c5c);}",
      ".arc-flash.ok{color:var(--dsw-alias-state-success-primary,#2ea44f);}",
      ".arc-flash.err{color:var(--dsw-alias-state-error-primary,#d64545);}",
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
      ".arc-tabadd{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;margin-left:2px;border-radius:var(--dsw-radius-md,6px);border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.28));background:transparent;color:var(--dsw-alias-label-secondary,#8a8a8a);font-size:16px;line-height:1;cursor:pointer;flex:none;transition:background 140ms ease,color 140ms ease,border-color 140ms ease;}",
      ".arc-tabadd:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));color:var(--dsw-alias-label-primary,CanvasText);}",
      ".arc-tabadd:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4176e6));outline-offset:2px;}",
      ".arc-tabadd[aria-pressed='true']{background:var(--dsw-alias-button-primary-fill,#1b1b1c);color:var(--dsw-alias-label-primary-foreground,#fff);border-color:transparent;}",
      ".arc-addpanel{border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.28));border-radius:var(--dsw-radius-lg,8px);padding:14px 14px 12px;margin:0 0 14px;display:flex;flex-direction:column;gap:10px;}",
      ".arc-addTitle{font-size:var(--dsw-font-sm-14-font-size,14px);line-height:var(--dsw-font-sm-14-line-height,20px);font-weight:600;color:var(--dsw-alias-label-primary,CanvasText);margin:0;}",
      ".arc-addDesc{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:var(--dsw-font-xxs-12-line-height,18px);color:var(--dsw-alias-label-secondary,#5c5c5c);margin:0;}",
      ".arc-addGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px 12px;}",
      "@media (max-width:560px){.arc-addGrid{grid-template-columns:1fr;}}",
      ".arc-addAdv{padding-top:2px;}",
      ".arc-addAdv .arc-check{align-self:end;}",
      ".arc-advToggle{align-self:flex-start;height:26px;padding:0 10px;font-size:var(--dsw-font-xxs-12-font-size,12px);}",
      ".arc-upList{display:flex;flex-direction:column;gap:8px;margin:0 0 14px;}",
      ".arc-upRow{display:flex;align-items:center;gap:10px;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.28));border-radius:var(--dsw-radius-md,6px);}",
      ".arc-upMain{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}",
      ".arc-upName{font-size:var(--dsw-font-xs-13-font-size,13px);line-height:18px;font-weight:600;color:var(--dsw-alias-label-primary,CanvasText);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".arc-upMeta{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:16px;color:var(--dsw-alias-label-tertiary,#8a8a8a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".arc-check{display:flex;align-items:center;gap:8px;margin:8px 0 2px;font-size:var(--dsw-font-xs-13-font-size,13px);line-height:18px;color:var(--dsw-alias-label-secondary,#444);cursor:pointer;}",
      ".arc-check input{flex:none;margin:0;cursor:pointer;}",
      ".arc-fetchRow{display:flex;align-items:center;gap:10px;margin:2px 0 2px;flex-wrap:wrap;}",
      ".arc-fetchHint{font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:16px;color:var(--dsw-alias-label-tertiary,#8a8a8a);}",
      ".arc-upInfo{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.28));border-radius:var(--dsw-radius-md,6px);margin-bottom:12px;}",
      ".arc-upInfoRow{display:flex;align-items:baseline;gap:10px;min-width:0;}",
      ".arc-upInfoLabel{flex:none;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:var(--dsw-font-xxs-12-font-size,12px);line-height:18px;}",
      ".arc-upInfoValue{flex:1;min-width:0;color:var(--dsw-alias-label-primary,CanvasText);font-size:var(--dsw-font-xs-13-font-size,13px);line-height:18px;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}",
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
    const EMPTY_DRAFT = { ak: "", sk: "", baseUrl: "", authorization: "", apiKey: "" };
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
      const [showAdd, setShowAdd] = useState(false);
      const [showAdv, setShowAdv] = useState(false);
      const [upstreams, setUpstreams] = useState([]);
      const [addDraft, setAddDraft] = useState({
        id: "",
        name: "",
        baseUrl: "",
        apiKey: "",
        rules: "",
        models: "",
        concurrency: "",
        timeoutMs: "",
        passthroughAuth: false,
        apiKeyEnv: ""
      });
      const [addBusy, setAddBusy] = useState(false);
      const [addErr, setAddErr] = useState("");
      const [modelBusy, setModelBusy] = useState(false);
      const [modelHint, setModelHint] = useState("");
      const [delArm, setDelArm] = useState("");
      // 编辑已有动态上游：记录正在编辑的 id（null = 新增模式）。
      const [editingId, setEditingId] = useState(null);
      const [upEditId, setUpEditId] = useState(null);
      const [upDraft, setUpDraft] = useState({ baseUrl: "", apiKey: "" });
      const [upBusy, setUpBusy] = useState(false);
      const [upErr, setUpErr] = useState("");
      const [tjUsername, setTjUsername] = useState("");
      const [tjPassword, setTjPassword] = useState("");
      const [tjErr, setTjErr] = useState("");
      const [tjBusy, setTjBusy] = useState(false);
      const [tjSaved, setTjSaved] = useState(false);
      const upFetched = useRef(false);
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
              points: r.points || null,
              dynamicUpstream: r.dynamicUpstream === true,
              upstreamUrl: typeof r.upstreamUrl === "string" ? r.upstreamUrl : "",
              apiKeyEnv: typeof r.apiKeyEnv === "string" ? r.apiKeyEnv : "",
              passthroughAuth: r.passthroughAuth === true
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
              points: null,
              dynamicUpstream: false,
              upstreamUrl: "",
              apiKeyEnv: "",
              passthroughAuth: false
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

      const loadUpstreams = useCallback(async () => {
        try {
          const res = await fetch("/api/api-rules/upstreams");
          if (!res.ok) throw new Error("HTTP " + res.status);
          const data = await res.json().catch(() => ({}));
          if (!alive.current) return;
          setUpstreams(Array.isArray(data.upstreams) ? data.upstreams : []);
        } catch (e) {}
      }, []);

      const toggleAdd = useCallback(() => {
        setAddErr("");
        setDelArm("");
        setEditingId(null);
        setShowAdd((v) => {
          if (!v) loadUpstreams();
          return !v;
        });
      }, [loadUpstreams]);

      const startEdit = (snap) => {
        // 从 upstreams state 取 masked 明细（带 modelIds 模型 id 列表），snap 只有模型数量。
        const detail = upstreams.find((u) => u.id === snap.id) || snap || {};
        setAddErr("");
        setModelHint("");
        setShowAdv(false);
        setEditingId(snap.id);
        setAddDraft({
          id: detail.id || snap.id || "",
          name: detail.name || "",
          baseUrl: detail.baseUrl || snap.baseUrl || "",
          apiKey: "", // host 不回传明文 key；留空 = 保留旧 key
          rules: Array.isArray(detail.rules) ? detail.rules.join(",") : "",
          models: Array.isArray(detail.modelIds) ? detail.modelIds.join(",") : "",
          concurrency: typeof detail.concurrency === "number" ? String(detail.concurrency) : "",
          timeoutMs: typeof detail.timeoutMs === "number" ? String(detail.timeoutMs) : "",
          passthroughAuth: detail.passthroughAuth === true,
          apiKeyEnv: detail.apiKeyEnv || snap.apiKeyEnv || "",
        });
        setShowAdd(true);
      };

      const onAddUpstream = useCallback(async () => {
        const name = addDraft.name.trim();
        const baseUrl = addDraft.baseUrl.trim();
        const apiKey = addDraft.apiKey.trim();
        let id = addDraft.id.trim();
        if (!baseUrl || !/^https?:\/\//iu.test(baseUrl)) {
          setAddErr(t("error.upBaseUrlRequired"));
          return;
        }
        // 透传上游的密钥由 DSH 凭据持有，这里不要求填 apiKey。
        // 编辑模式：host 不回传明文 key，留空 = 保留旧 key（apiKeyKeep），也不必填。
        const keepKey = editingId !== null && apiKey === "";
        if (!apiKey && !keepKey && addDraft.passthroughAuth !== true) {
          setAddErr(t("error.upApiKeyRequired"));
          return;
        }
        if (editingId !== null) id = editingId;
        else if (!id) id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
        if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(id)) {
          setAddErr(t("error.upIdInvalid"));
          return;
        }
        const rules = addDraft.rules
          .split(/[,，\s]+/u)
          .map((s) => s.trim())
          .filter(Boolean);
        const models = addDraft.models
          .split(/[,，\n]+/u)
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => {
            const i = s.lastIndexOf(":");
            if (i > 0) {
              const mt = Number(s.slice(i + 1));
              const mid = s.slice(0, i).trim();
              if (Number.isFinite(mt) && mt > 0 && mid !== "") return { id: mid, maxTokens: mt };
            }
            return { id: s };
          })
          .filter((m) => m.id !== "" && m.id !== ":");
        const numField = (v) => {
          const n = Number(v);
          return v.trim() !== "" && Number.isFinite(n) && n > 0 ? n : undefined;
        };
        const concurrency = numField(addDraft.concurrency);
        const timeoutMs = numField(addDraft.timeoutMs);
        setAddBusy(true);
        setAddErr("");
        try {
          const res = await fetch("/api/api-rules/upstreams", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id,
              name: name || id,
              baseUrl,
              apiKey,
              rules,
              models,
              passthroughAuth: addDraft.passthroughAuth === true,
              apiKeyKeep: editingId !== null,
              ...(addDraft.apiKeyEnv.trim() !== "" ? { apiKeyEnv: addDraft.apiKeyEnv.trim() } : {}),
              ...(concurrency !== undefined ? { concurrency } : {}),
              ...(timeoutMs !== undefined ? { timeoutMs } : {})
            })
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok || body.ok === false) throw new Error((body && body.error) || "HTTP " + res.status);
          const sync = body.sync || {};
          if (alive.current) {
            setAddDraft({
              id: "",
              name: "",
              baseUrl: "",
              apiKey: "",
              rules: "",
              models: "",
              concurrency: "",
              timeoutMs: "",
              passthroughAuth: false,
              apiKeyEnv: ""
            });
            setShowAdd(false);
            setEditingId(null);
            setModelHint("");
          }
          await load();
          await loadUpstreams();
          safeSet(setSyncFlash)({
            ok: true,
            text: t("up.added", {
              id,
              added: String((sync.added || []).length),
              removed: String((sync.removed || []).length)
            })
          });
        } catch (e) {
          if (alive.current) setAddErr(t("error.upAdd", { message: String((e && e.message) || e) }));
        } finally {
          if (alive.current) setAddBusy(false);
        }
      }, [addDraft, editingId, load, loadUpstreams, t]);
      useEffect(() => {
        if (upFetched.current) return;
        upFetched.current = true;
        loadUpstreams();
      }, [loadUpstreams]);

      const upBegin = useCallback((snap) => {
        clearError(snap.id);
        setUpErr("");
        setUpEditId(snap.id);
        setUpDraft({ baseUrl: "", apiKey: "" });
      }, [clearError]);

      const upCancel = useCallback(() => {
        setUpEditId(null);
        setUpDraft({ baseUrl: "", apiKey: "" });
        setUpErr("");
      }, []);

      const upField = useCallback((key, value) => {
        setUpErr("");
        clearError(upEditId);
        setUpDraft((prev) => ({ ...prev, [key]: value }));
      }, [upEditId, clearError]);


      const onSaveTongjiAccount = useCallback(
        async () => {
          if (tjUsername.trim() === "") {
            setTjErr(t("error.tjUsernameRequired"));
            return;
          }
          setTjBusy(true);
          setTjErr("");
          setTjSaved(false);
          try {
            const res = await fetch("/api/api-rules/tongji-account", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ username: tjUsername.trim(), password: tjPassword })
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || body.ok === false) {
              throw new Error((body && (body.detail || body.error)) || "HTTP " + res.status);
            }
            setTjPassword("");
            setTjSaved(true);
          } catch (e) {
            setTjErr(String(e && e.message || e));
          } finally {
            setTjBusy(false);
          }
        },
        [t, tjUsername, tjPassword]
      );

      const onSaveUpstream = useCallback(
        async (id) => {
          const detail = upstreams.find((u) => u.id === id) || {};
          const baseUrl = (upDraft.baseUrl.trim() !== "" ? upDraft.baseUrl : detail.baseUrl || "").trim();
          const apiKey = upDraft.apiKey.trim();
          if (!/^https?:\/\//iu.test(baseUrl)) {
            setUpErr(t("error.upBaseUrlRequired"));
            return;
          }
          const keepKey = apiKey === "";
          if (!keepKey && detail.passthroughAuth !== true) {
            setUpErr(t("error.upApiKeyRequired"));
            return;
          }
          setUpBusy(true);
          setUpErr("");
          try {
            const res = await fetch("/api/api-rules/upstreams", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id,
                name: detail.name || id,
                baseUrl,
                apiKey,
                apiKeyKeep: keepKey,
                rules: Array.isArray(detail.rules) ? detail.rules : ["generic"],
                models: Array.isArray(detail.models) ? detail.models : [],
                passthroughAuth: detail.passthroughAuth === true,
                ...(detail.apiKeyEnv ? { apiKeyEnv: detail.apiKeyEnv } : {}),
                ...(typeof detail.concurrency === "number" ? { concurrency: detail.concurrency } : {}),
                ...(typeof detail.timeoutMs === "number" ? { timeoutMs: detail.timeoutMs } : {})
              })
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || body.ok === false) throw new Error((body && body.error) || "HTTP " + res.status);
            const sync = body.sync || {};
            setUpEditId(null);
            setUpDraft({ baseUrl: "", apiKey: "" });
            await load();
            await loadUpstreams();
            safeSet(setSyncFlash)({
              ok: true,
              text: t("up.saved", {
                id,
                added: String((sync.added || []).length),
                removed: String((sync.removed || []).length)
              })
            });
          } catch (e) {
            if (alive.current) setUpErr(t("error.upAdd", { message: String((e && e.message) || e) }));
          } finally {
            if (alive.current) setUpBusy(false);
          }
        },
        [upDraft, upstreams, load, loadUpstreams, t]
      );

      const onFetchModels = useCallback(async (opts) => {
        const silent = Boolean(opts) && opts.silent === true;
        const source = opts && opts.draft || addDraft;
        const baseUrl = String(source.baseUrl || "").trim();
        if (!baseUrl || !/^https?:\/\//iu.test(baseUrl)) {
          if (!silent) setAddErr(t("error.upBaseUrlRequired"));
          return;
        }
        setModelBusy(true);
        setAddErr("");
        setModelHint("");
        try {
          const res = await fetch("/api/api-rules/upstreams/models", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              baseUrl,
              apiKeyEnv: String(source.apiKeyEnv || "").trim(),
              apiKey: String(source.apiKey || "").trim()
            })
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok || body.ok !== true) throw new Error((body && body.error) || "HTTP " + res.status);
          const list = Array.isArray(body.models) ? body.models : [];
          if (list.length === 0) {
            if (alive.current) setModelHint(t("up.modelsEmpty"));
            return;
          }
          const parseModels = (text) => String(text || "").split(/[,，\n]+/u).map((s) => s.trim()).filter(Boolean).map((s) => {
            const i = s.lastIndexOf(":");
            if (i > 0) {
              const mt = Number(s.slice(i + 1));
              const mid = s.slice(0, i).trim();
              if (Number.isFinite(mt) && mt > 0 && mid !== "") return { id: mid, maxTokens: mt };
            }
            return { id: s };
          }).filter((m) => m.id !== "" && m.id !== ":");
          const before = parseModels(source.models);
          const beforeById = new Map(before.map((m) => [m.id, m]));
          const merged = [];
          const seenIds = new Set();
          for (const m of list) {
            if (seenIds.has(m.id)) continue;
            seenIds.add(m.id);
            const prev = beforeById.get(m.id);
            const maxTokens = m.maxTokens || (prev && prev.maxTokens);
            merged.push(maxTokens ? { id: m.id, maxTokens } : { id: m.id });
          }
          const kept = before.filter((m) => !seenIds.has(m.id));
          const all = merged.concat(kept);
          const text = all.map((m) => (m.maxTokens ? m.id + ":" + m.maxTokens : m.id)).join(", ");
          if (alive.current) {
            setAddDraft((prev) => ({ ...prev, models: text }));
            setModelHint(kept.length > 0 ? t("up.modelsFetchedKept", {
              count: String(list.length),
              kept: kept.map((m) => m.id).join("\u3001")
            }) : t("up.modelsFetched", { count: String(list.length) }));
          }
        } catch (e) {
          if (alive.current && !silent) setModelHint(t("error.upModels", { message: String((e && e.message) || e) }));
        } finally {
          if (alive.current) setModelBusy(false);
        }
      }, [addDraft, t]);

      const onDeleteUpstream = useCallback(
        async (id) => {
          if (delArm !== id) {
            setDelArm(id);
            if (confirmTimer.current) clearTimeout(confirmTimer.current);
            confirmTimer.current = setTimeout(() => {
              if (alive.current) setDelArm("")
            }, 4000);
            return;
          }
          setDelArm("");
          if (confirmTimer.current) {
            clearTimeout(confirmTimer.current);
            confirmTimer.current = null;
          }
          try {
            const res = await fetch("/api/api-rules/upstreams?id=" + encodeURIComponent(id), { method: "DELETE" });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || body.ok === false) throw new Error((body && body.error) || "HTTP " + res.status);
            safeSet(setSyncFlash)({ ok: true, text: t("up.deleted", { id }) });
            await load();
            await loadUpstreams();
            if (activeTab === id) safeSet(setTab)("");
          } catch (e) {
            safeSet(setSyncFlash)({ ok: false, text: t("error.upDelete", { message: String((e && e.message) || e) }) });
          }
        },
        [delArm, load, loadUpstreams, t, activeTab]
      );

      const upDelete = useCallback(
        (id) => {
          if (delArm !== id) {
            setDelArm(id);
            if (confirmTimer.current) clearTimeout(confirmTimer.current);
            confirmTimer.current = setTimeout(() => {
              if (alive.current) setDelArm("");
            }, 4000);
            return;
          }
          setDelArm("");
          if (confirmTimer.current) {
            clearTimeout(confirmTimer.current);
            confirmTimer.current = null;
          }
          onDeleteUpstream(id);
        },
        [delArm, onDeleteUpstream]
      );
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
        points: null,
        dynamicUpstream: false,
        upstreamUrl: "",
        apiKeyEnv: "",
        passthroughAuth: false
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
          syncFlash ? React.createElement(
            "span",
            { className: "arc-flash" + (syncFlash.ok ? " ok" : " err"), role: "status" },
            syncFlash.text
          ) : null,
          syncButton
        )
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
        }),
        React.createElement(
          "button",
          {
            key: "__add",
            type: "button",
            className: "arc-tabadd",
            "aria-pressed": showAdd ? "true" : "false",
            "aria-label": t("up.addButton"),
            title: t("up.addButton"),
            onClick: toggleAdd
          },
          "\uFF0B"
        )
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
        // 动态上游（upstreams.json）：卡片内直接显示真实地址与凭据名，并保留两步删除。
        const dynamic = snap.dynamicUpstream === true;
        const baseUrlValue = draft.baseUrl !== "" ? draft.baseUrl : snap.baseUrl || "";
        const dirty = endpoint ? baseUrlValue.trim() !== String(snap.baseUrl || "").trim() || draft.authorization.trim() !== "" : draft.ak.trim() !== "" || draft.sk.trim() !== "";
        const isBusySave = busy === "save:" + id;
        const isBusyClear = busy === "clear:" + id || busy === "clear:" + id + ":go";
        const canSave = dirty && !err && busy === "";
        const field = (key, labelText, placeholder, value, invalid, type, onFocus) => React.createElement(
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
                hint: key === "ak" ? snap.akHint || "" : key === "sk" ? snap.skHint || "" : key === "apiKey" ? snap.akHint || "\u2022\u2022\u2022\u2022" : key === "authorization" ? "\u2022\u2022\u2022\u2022" : ""
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
            },
            onFocus
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
        const upEditing = upEditId === id;
        const upBaseUrlValue = upEditing && upDraft.baseUrl.trim() !== "" ? upDraft.baseUrl : snap.upstreamUrl || "";
        const upDirty = upBaseUrlValue.trim() !== String(snap.upstreamUrl || "").trim() || (upEditing && upDraft.apiKey.trim() !== "");
        const upCanSave = upDirty && !upErr && !upBusy;
        if (dynamic) {
          body = React.createElement(
            "div",
            { className: "arc-fields" },
            React.createElement("div", { className: "arc-paneDesc" }, t("up.cardProxyNote")),
            field("baseUrl", t("up.cardAddress"), t("up.baseUrlPh"), upBaseUrlValue, false, "text", () => upBegin(snap)),
            field("apiKey", t("up.cardKeyLabel"), snap.configured ? t("ph.saved") : t("up.apiKeyPh"), upEditing ? upDraft.apiKey : "", false, undefined, () => upBegin(snap)),
            upErr ? React.createElement("div", { className: "arc-fieldError" }, upErr) : null,
            id === "tongji" ? React.createElement(
              "div",
              { className: "arc-fields" },
              React.createElement("div", { className: "arc-paneDesc" }, t("up.tjAccountDesc")),
              React.createElement(
                "div",
                { className: "arc-field" },
                React.createElement("div", { className: "arc-fieldTop" }, React.createElement("div", { className: "arc-label" }, t("up.tjUsernameLabel"))),
                React.createElement("input", {
                  className: "arc-input",
                  type: "text",
                  value: tjUsername,
                  placeholder: t("up.tjUsernamePh"),
                  autoComplete: "off",
                  spellCheck: false,
                  onChange: (e) => { setTjUsername(e.target.value); setTjSaved(false); }
                })
              ),
              React.createElement(
                "div",
                { className: "arc-field" },
                React.createElement("div", { className: "arc-fieldTop" }, React.createElement("div", { className: "arc-label" }, t("up.tjPasswordLabel"))),
                React.createElement("input", {
                  className: "arc-input",
                  type: "password",
                  value: tjPassword,
                  placeholder: snap.configured || tjSaved ? "\u2022\u2022\u2022\u2022\u2022\u2022" : t("up.tjPasswordLabel"),
                  autoComplete: "new-password",
                  spellCheck: false,
                  onChange: (e) => { setTjPassword(e.target.value); setTjSaved(false); }
                })
              ),
              tjErr ? React.createElement("div", { className: "arc-fieldError" }, tjErr) : null,
              React.createElement(
                "div",
                { className: "arc-actions" },
                React.createElement(
                  "button",
                  { type: "button", className: "arc-btn primary", onClick: () => onSaveTongjiAccount(), disabled: tjBusy || tjUsername.trim() === "" },
                  tjBusy ? t("up.tjSaving") : tjSaved ? t("up.tjSaved") : t("up.tjSaveAccount")
                )
              )
            ) : null
          );
        } else if (managed) {
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
          isCredential ? actions : null,
                              dynamic ? React.createElement(
            "div",
            { className: "arc-actions" },
            React.createElement(
              "button",
              { type: "button", className: "arc-btn ghost danger", onClick: () => upDelete(id), disabled: upBusy },
              delArm === id ? t("up.deleteConfirm", { id }) : t("up.delete"),
            ),
            upEditing ? React.createElement(
              "button",
              { type: "button", className: "arc-btn ghost", onClick: () => upCancel(), disabled: upBusy },
              t("up.cancel"),
            ) : null,
            upEditing ? React.createElement(
              "button",
              { type: "button", className: "arc-btn ghost", onClick: () => setUpDraft({ baseUrl: "", apiKey: "" }), disabled: !upDirty || upBusy },
              t("action.clear"),
            ) : null,
            React.createElement(
              "button",
              { type: "button", className: "arc-btn primary", onClick: () => onSaveUpstream(id), disabled: !upCanSave },
              upBusy ? t("action.saving") : t("action.save"),
            ),
          ) : null,
        );
      }
      const addField = (key, labelText, placeholder, value, invalid, type, onBlur) =>
        React.createElement(
          "div",
          { className: "arc-field" },
          React.createElement(
            "div",
            { className: "arc-fieldTop" },
            React.createElement("div", { className: "arc-label" }, labelText)
          ),
          React.createElement("input", {
            className: "arc-input" + (invalid ? " invalid" : ""),
            type: type || "text",
            value,
            placeholder,
            autoComplete: "off",
            spellCheck: false,
            "aria-invalid": invalid ? "true" : "false",
            onBlur: onBlur || undefined,
            onChange: (e) => {
              setAddErr("");
              setAddDraft((prev) => ({ ...prev, [key]: e.target.value }));
            }
          })
        );
      const upForm = showAdd
        ? React.createElement(
            "div",
            { className: "arc-addpanel" },
            editingId !== null
              ? React.createElement("div", { className: "arc-paneDesc" }, t("up.editHint", { id: editingId }))
              : null,
            React.createElement(
              "div",
              { className: "arc-addGrid" },
              addField("baseUrl", t("up.baseUrlLabel"), t("up.baseUrlPh"), addDraft.baseUrl, false, "text", (e) => {
                const next = e.target.value;
                if (/^https?:\/\/[^\s]+/iu.test(next.trim())) onFetchModels({
                  silent: true,
                  draft: { ...addDraft, baseUrl: next }
                });
              }),
              addField("apiKey", t("up.apiKeyLabel"), t("up.apiKeyPh"), addDraft.apiKey, false, "password"),
            ),
            React.createElement(
              "div",
              { className: "arc-fetchRow" },
              React.createElement(
                "button",
                {
                  type: "button",
                  className: "arc-btn ghost",
                  onClick: onFetchModels,
                  disabled: modelBusy || addBusy
                },
                modelBusy ? t("up.modelsFetching") : t("up.modelsFetch")
              ),
              modelHint ? React.createElement("span", { className: "arc-fetchHint" }, modelHint) : null
            ),
            React.createElement(
              "button",
              {
                type: "button",
                className: "arc-btn ghost arc-advToggle",
                "aria-expanded": showAdv ? "true" : "false",
                onClick: () => setShowAdv((prev) => !prev)
              },
              showAdv ? t("up.advHide") : t("up.advShow")
            ),
            showAdv ? React.createElement(
              "div",
              { className: "arc-addGrid arc-addAdv" },
                addField("apiKeyEnv", t("up.apiKeyEnvLabel"), t("up.apiKeyEnvPh"), addDraft.apiKeyEnv, false, "text", (e) => {
                  const next = e.target.value.trim();
                  if (next !== "" && /^https?:\/\/[^\s]+/iu.test(addDraft.baseUrl.trim())) onFetchModels({
                    silent: true,
                    draft: { ...addDraft, apiKeyEnv: next }
                  });
                }),
                addField("rules", t("up.rulesLabel"), t("up.rulesPh"), addDraft.rules, false, "text"),
                addField("models", t("up.modelsLabel"), t("up.modelsPh"), addDraft.models, false, "text"),
                addField("concurrency", t("up.concurrencyLabel"), t("up.concurrencyPh"), addDraft.concurrency, false, "text"),
                addField("timeoutMs", t("up.timeoutLabel"), t("up.timeoutPh"), addDraft.timeoutMs, false, "text")
            ) : null,
            showAdv ? React.createElement(
              "label",
              { className: "arc-check" },
              React.createElement("input", {
                type: "checkbox",
                checked: addDraft.passthroughAuth === true,
                onChange: (e) => {
                  setAddErr("");
                  setAddDraft((prev) => ({ ...prev, passthroughAuth: e.target.checked }));
                }
              }),
              React.createElement("span", null, t("up.passthroughLabel"))
            ) : null,
            addErr ? React.createElement("div", { className: "arc-fieldError" }, addErr) : null,
            React.createElement(
              "div",
              { className: "arc-actions" },
              React.createElement(
                "button",
                { type: "button", className: "arc-btn ghost", onClick: toggleAdd, disabled: addBusy },
                t("up.cancel")
              ),
              React.createElement(
                "button",
                { type: "button", className: "arc-btn primary", onClick: onAddUpstream, disabled: addBusy },
                addBusy ? (editingId !== null ? t("up.updating") : t("up.adding")) : editingId !== null ? t("up.update") : t("up.add")
              )
            )
          )
        : null;
      return React.createElement(
        "div",
        { className: "arc" },
        React.createElement("style", null, CSS),
        header,
        tabs,
        upForm,
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
            const ALIAS = { raccoon: ["sensenova", "sensenovaflash", "nova"], officeace: ["office", "wps"], minimax2api: ["minimax"], "trae2api-hub": ["trae"], codearts: ["codearts", "huawei"], cline: ["cline", "cline2api"] };
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

// === AIGC 专区卡片（从 dsh-tongji-aigc 整包并入，单独 ModuleLoader 块）===
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
      'card.usernamePlaceholder': '请填写学工号',
      'card.passwordPlaceholder': '统一身份认证密码',
      'up.tjUsernameLabel': '同济工号',
      'up.tjUsernamePh': '请填写学工号',
      'up.tjPasswordLabel': '统一身份认证密码',
      'up.tjAccountDesc': '用于自动连接同济 VPN 与登录 AIGC 专区（内网直连 IAM，外网弹浏览器增强认证）。',
      'up.tjSaveAccount': '保存同济账号',
      'up.tjSaved': '已保存',
      'up.tjSaving': '保存中…',
      'card.credSaveFailed': '凭据保存失败',
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
      'card.usernamePlaceholder': 'Tongji ID (e.g. 1234567)',
      'card.passwordPlaceholder': 'SSO password',
      'up.tjUsernameLabel': 'Tongji ID',
      'up.tjUsernamePh': 'e.g. 1234567',
      'up.tjPasswordLabel': 'SSO password',
      'up.tjAccountDesc': 'Used to auto-connect Tongji VPN and sign in to AIGC (IAM on campus; browser MFA off campus).',
      'up.tjSaveAccount': 'Save Tongji Account',
      'up.tjSaved': 'Saved',
      'up.tjSaving': 'Saving...',
      'card.credSaveFailed': 'Failed to save credentials',
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
      // ---- 工号/密码输入框（登录前先写入 tongji-vpn.env，供 throttle 钩子自动拨号）----
      const [formUsername, setFormUsername] = React.useState('')
      const [formPassword, setFormPassword] = React.useState('')
      const [saveBusy, setSaveBusy] = React.useState(false)

      // ---- 浏览器自动化登录（绕开 IAM 风控的人脸/短信增强认证）----
      const [browserBusy, setBrowserBusy] = React.useState(false)
      const [browserPolling, setBrowserPolling] = React.useState(false)

      /** 弹真浏览器登录（含人脸/短信），常驻 CDP 监听抓 token。 */
      const browserSignIn = async () => {
        if (browserBusy || browserPolling || busy !== '') return
        setFormErr(null)
        setBrowserBusy(true)
        // 先把工号/密码写入 tongji-vpn.env：
        // 为什么要先写：拨 VPN 必须走提权 PowerShell 进程，它读不到 React state，
        // 只能从 env 文件读。把凭据落到 env 后，throttle 钩子才能在 403 时自动拨号。
        // 密码留空 = 不覆盖（支持只改工号）；两个都空 = �描过保存直接走浏览器。
        if (formUsername.trim() !== '' || formPassword !== '') {
          try {
            const saveRes = await fetch('/api/api-rules/tongji-account', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username: formUsername.trim(), password: formPassword }),
              cache: 'no-store',
            })
            if (!saveRes.ok) {
              const saveData = await saveRes.json().catch(() => ({}))
              throw new Error(saveData?.detail || saveData?.error || 'save credentials failed')
            }
          } catch (error) {
            setFormErr(t('card.credSaveFailed') + '：' + String(error?.message || error))
            setBrowserBusy(false)
            return
          }
        }
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
                e('input', {
                  className: 'ta-input',
                  type: 'text',
                  autoComplete: 'off',
                  placeholder: t('card.usernamePlaceholder'),
                  'aria-label': t('card.usernamePlaceholder'),
                  value: formUsername,
                  onChange: (ev) => setFormUsername(String(ev?.target?.value ?? '')),
                  disabled: browserBusy || browserPolling,
                }),
                e('input', {
                  className: 'ta-input',
                  type: 'password',
                  autoComplete: 'off',
                  placeholder: t('card.passwordPlaceholder'),
                  'aria-label': t('card.passwordPlaceholder'),
                  value: formPassword,
                  onChange: (ev) => setFormPassword(String(ev?.target?.value ?? '')),
                  disabled: browserBusy || browserPolling,
                }),
                formErr ? e('p', { className: 'ta-form-err' }, formErr) : null,
                e(
                  'button',
                  {
                    className: 'ta-btn primary',
                    type: 'button',
                    onClick: browserPolling ? browserCancel : browserSignIn,
                    disabled: busy !== '' || saveBusy || (browserBusy && !browserPolling),
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

