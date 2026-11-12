# 新闻原文、修订与撤稿证据

基线 `0019ef6`。新增本地追加证据链和只读研究页，复用当前东财新闻fetch结果，不新增联网、通知、模型训练或交易任务。旧关键词分类仍是旧功能；本证据层不按标题判定利好/利空，也不认证新闻真实性。

## 操作

```sh
npm run news:evidence -- import /private/operator-news.json
npm run news:evidence -- list 600000
```

默认目录 `V6_BO/data/news-evidence`，0700，档案0600，已加入gitignore。运维可在进程环境固定 `V6_NEWS_EVIDENCE_DIR`；HTTP和导入内容不能选择输出路径。CLI输入须绝对路径、普通JSON文件且不能经过符号链接；单次最多200条/2MiB。只读查询不创建空目录。

单条导入示例（时间为毫秒epoch，必须是真实来源声明并不晚于收到时刻；不要照抄示例数值作为现场证据）：

```json
{
  "schemaVersion": 1,
  "source": "operator-source",
  "eventId": "publisher-event-id",
  "sourceRevisionId": "publisher-edition-id",
  "kind": "original",
  "supersedes": null,
  "url": "https://example.test/original",
  "title": "原文标题",
  "body": "声明的正文",
  "bodyScope": "declared-body",
  "securities": ["600000"],
  "publishedAt": null,
  "receivedAt": 1794466800000,
  "revisedAt": null
}
```

`publishedAt=null`表示原发布时间未知，不能补成抓取/导入时间。修订或撤稿使用新的`sourceRevisionId`、`kind=revised/retracted`和前一版返回的完整`eventHash`作为`supersedes`；必须同来源、同事件，且指向当前末版。首次原文的发布时间固定；不能事后改写。修订时点未知保留null，未来/无效时点拒绝。撤稿为终态，不能复活为原始支持证据；来源后续若重新发布应有新事件ID。

同source/event/revision的相同内容再次导入幂等，不改原接收时刻；同一版本ID的内容冲突拒绝。先验证整批，再逐份发布；写盘故障可能留下已成功发布的前缀，原样重试会复用已发布版本。日志是全局序号和前哈希链，使用锁、临时文件、fsync及不可覆盖硬链接发布。最多10000版/128MiB，不自动删旧档或轮转；达到上限须运维备份与规划，不允许清空来掩盖历史。

现有seed/refresh采集只将已经取得的raw传入适配器。供应商摘要明确`bodyScope=provider-summary`，摘要SHA不冒充完整正文SHA；内容hash作为本地版本去重ID，不是供应商签名。没有原始URL、发布时间、实际修订时间或完整正文就保持unknown；原文时间按明确中国时区解析，主机UTC不参与补时。无有效来源时点的修订不能获得研究支持资格。拒绝的未来/非法证据与撤稿不会进入新旧正面支持或摘要；采集归档失败时旧支持门禁保守显示未知。

## 只读查询

`GET /api/research/news-evidence?symbol=600000&limit=50`仅允许开发者身份（沿用本机直连/云端edit权限），不允许HTTP导入、路径或asOf参数，响应no-store。匿名、无效/观看令牌拒绝；失败422且`status=unknown`，不返回一份假空成功结果。limit为1–200，summary在截断前计算。

核心接口：`require('./src/core/news-evidence-journal').query(root,{symbol:null,limit:50,now:Date.now()})`。结果含`summary={totalRevisions,currentEvents,retractedEvents,eligibleForResearchSupport,unknownEvents}`。计数只包含symbol筛选后的事件；后三项统计当前末版，不把一条事件的多个修订当成多个独立事件。每版含`current/eligibleForResearchSupport/supportStatus`。已替代、撤稿、时间/链接/完整正文未知均不能作支持；来源声明完整仍未获独立真实性/时间认证。

研究页独立`newsEvidence`区块和`news-evidence-workbench.js`显示来源链接、原发布时间、接收、修订/撤稿时点、正文/摘要范围和链hash。动态内容全用textContent，原始链接只允许HTTP(S)且无用户名密码。权限/读取失败先清空旧结果，令牌变化会丢弃正在返回的旧请求。两张锁定主页未改。

## 验证与限制

```sh
cd V6_BO
node --test tests/news-evidence-journal.test.js tests/news-evidence-http.test.js tests/news-china-cloud-timezone.test.js
node _test_holiday_news.js
node _test_news_daily.js
node _test_news_kw.js
```

证据日志在交付`news-combined-targeted.tap`及`news-*-legacy.log`。核心测试包含同事件多次修订、终态撤稿、错误链/来源/日期、去重、隐私权限、篡改/缺档、超过200条seed完整捕获及旧消费者即时撤稿抑制；真实隔离HTTP使用临时口令和临时目录，以CLI写入、停服重启后重读，未调用任何真实供应商或消息服务。

本lane新专项及既有中国时区检查共16/16通过，0跳过；旧假期32/32、日报20/20通过。`_test_news_kw.js`为26通过/1失败：旧检查仅在锁定主页搜索字面APP_VER，得到undefined；在独立`0019ef6`基线相同26/1，未因本批回退，未为使旧检查变绿而改锁定主页。全量和最终CI由主集成流程执行。

另有真实asset的离线fixture浏览器检查（320/390/1366宽度）：未执行恶意标题/正文、无横向溢出、来源链接、权限失败清空和旧令牌响应丢弃。截图是明确fixture，不是线上行情、原图1:1或真机验收。

本地哈希只能发现与所保留链/独立备份不一致的普通损坏，不能阻止有写权限者整套重建、删除整个末尾或系统时钟回拨。必须独立保留末端hash/整库备份以核查截尾。所有认证、交易、训练和通知标志保持false。进程崩溃遗留.lock会拒绝读写；先核对写入者、归档及独立备份后由运维处理，不自动偷锁、不删除旧证据。回滚revert本批代码，保留私有档案；不从旧ZIP覆盖新主线。
