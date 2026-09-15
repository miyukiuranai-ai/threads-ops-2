# Google Apps Script の 5 分おきトリガー

新しい Apps Script プロジェクトに次を貼り、スクリプトのプロパティに `BASE_URL`（新しい Vercel の URL）と `CRON_SECRET`（新しい値）を入れる。時間主導型トリガーを 5 分おきで `tickPublish` と `tickReplies` の 2 本作る。

```js
function tick_(path) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('BASE_URL') + path + '?key=' + encodeURIComponent(props.getProperty('CRON_SECRET'));
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  Logger.log(path + ' ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
}
function tickPublish() { tick_('/api/cron/publish'); }
function tickReplies() { tick_('/api/cron/replies'); }
```

本家の Apps Script には触れない。Vercel Cron（15:30 の生成、トークン延長）は vercel.json のまま。
