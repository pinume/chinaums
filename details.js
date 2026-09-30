const STORAGE_KEY = "latestSnapshot";
const root = document.querySelector("#snapshot-content");
const copyButton = document.querySelector("#copy-details-button");
const copyStatus = document.querySelector("#copy-status");

const make = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

const addKeyValue = (parent, label, value) => {
  const row = make("div", "detail-row");
  row.append(make("span", "detail-label", label), make("span", "detail-value", value || "—"));
  parent.append(row);
};

const addList = (parent, heading, values, formatter = (value) => String(value)) => {
  const section = make("section", "detail-section");
  section.append(make("h3", "", heading));
  if (!values?.length) {
    section.append(make("p", "empty-value", "未发现"));
  } else {
    const list = make("ul", "detail-list");
    for (const value of values) list.append(make("li", "", formatter(value)));
    section.append(list);
  }
  parent.append(section);
};

const frameLabel = (item) => item.frameTitle
  ? `（${item.frameTitle} · frame ${item.frameId ?? "?"}）`
  : "";

const addTables = (parent, tables) => {
  const section = make("section", "detail-section");
  section.append(make("h3", "", "表格"));
  if (!tables?.length) {
    section.append(make("p", "empty-value", "未发现表格"));
    parent.append(section);
    return;
  }

  for (const table of tables) {
    const card = make("article", "table-card");
    card.append(make("h4", "", `表格 ${table.index ?? ""}${frameLabel(table)}`));
    addKeyValue(card, "数据行数", String(table.rowCount ?? 0));
    addKeyValue(card, "表头", table.headers?.join(" · ") || "未识别");
    if (table.previewRows?.length) {
      const preview = make("div", "table-preview");
      preview.append(make("p", "muted", "最多 3 行样例"));
      for (const row of table.previewRows) {
        preview.append(make("p", "sample-row", row.join(" | ") || "（空行）"));
      }
      card.append(preview);
    }
    section.append(card);
  }
  parent.append(section);
};

const addDownloadTaskLists = (parent, taskLists) => {
  if (!taskLists?.length) return;
  const section = make("section", "detail-section");
  section.append(make("h3", "", "下载暂存任务"));
  for (const taskList of taskLists) {
    const card = make("article", "table-card");
    card.append(make("h4", "", `${taskList.title || "下载暂存列表"}${frameLabel(taskList)}`));
    addKeyValue(card, "总任务数", taskList.total === null ? "未识别" : String(taskList.total));
    addKeyValue(card, "当前页", taskList.page === null ? "未识别" : String(taskList.page));
    addKeyValue(card, "已读取行数", String(taskList.rowCount ?? 0));
    addKeyValue(card, "解析状态", taskList.parseState || "未知");

    const statusCounts = new Map();
    for (const row of taskList.rows || []) {
      const status = row.status || "状态为空";
      statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
    }
    addKeyValue(card, "当前页状态统计", [...statusCounts]
      .map(([status, count]) => `${status} ${count}`)
      .join(" · "));

    if (taskList.rows?.length) {
      const rows = make("ul", "detail-list");
      for (const row of taskList.rows) {
        rows.append(make("li", "", [
          row.createdAt,
          row.fileName,
          row.status,
          `下载${row.downloadEnabled === null ? "状态未知" : row.downloadEnabled ? "可用" : "禁用"}`
        ].filter(Boolean).join(" · ")));
      }
      card.append(rows);
    }
    section.append(card);
  }
  parent.append(section);
};

const confidenceLabel = (confidence) => ({
  high: "高",
  medium: "中",
  low: "低"
}[confidence] || "未知");

const statusLabel = (status) => ({
  logged_in: "已登录",
  logged_out: "未登录",
  unknown: "无法确定"
}[status] || "未知");

const merchantStatusLabel = (status) => ({
  matched: "匹配目标商户",
  mismatched: "与目标商户不匹配",
  unknown: "尚未识别"
}[status] || "未知");

const renderSnapshot = (snapshot) => {
  document.querySelector("#snapshot-time").textContent = snapshot.scannedAt
    ? `检测时间：${new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "full",
      timeStyle: "short"
    }).format(new Date(snapshot.scannedAt))}`
    : "";

  const overview = make("section", "overview-card");
  overview.append(make("h2", "", snapshot.page?.title || "（无页面标题）"));
  addKeyValue(overview, "网站", snapshot.site?.host || "—");
  addKeyValue(overview, "URL", snapshot.page?.url);
  addKeyValue(overview, "页面类型", `${snapshot.page?.category || "未知页面"}（${snapshot.page?.categorySource === "url" ? "URL 路由" : "DOM 特征"}，置信度：${confidenceLabel(snapshot.page?.categoryConfidence)}）`);
  addKeyValue(overview, "登录状态", `${statusLabel(snapshot.authentication?.status)}（置信度：${confidenceLabel(snapshot.authentication?.confidence)}；评分：${snapshot.authentication?.score ?? "—"}）`);
  addKeyValue(overview, "判断依据", (snapshot.authentication?.reasons || []).join("；") || "—");
  addKeyValue(overview, "导出商户识别", "扫描快照不用于门禁；运行时从报表查询结果读取商户号");
  addKeyValue(overview, "快照门禁状态", "未开放；页面扫描不会申请导出");
  addKeyValue(overview, "结构数量", `主导航 ${snapshot.counts?.mainNavigation ?? 0} · 业务入口 ${snapshot.counts?.businessEntries ?? 0} · 可点击元素 ${snapshot.counts?.interactiveElements ?? 0} · 链接 ${snapshot.counts?.links ?? 0} · 业务按钮 ${snapshot.counts?.buttons ?? 0} · 输入框 ${snapshot.counts?.inputs ?? 0} · select ${snapshot.counts?.selects ?? 0} · 表格 ${snapshot.counts?.tables ?? 0} · iframe ${snapshot.frames?.count ?? 0} · 已扫描文档 ${snapshot.counts?.scannedDocuments ?? 0} · 可见文字 ${snapshot.counts?.visibleTextChars ?? 0} 字`);
  addKeyValue(overview, "Frame 扫描", snapshot.frameScan?.complete ? "已完成" : snapshot.frameScan?.note || "部分完成");
  root.append(overview);

  const merchant = make("section", "overview-card");
  merchant.id = "merchant-context";
  merchant.append(make("h2", "", "页面商户线索（仅供诊断）"));
  addKeyValue(merchant, "导出商户号", "运行时从报表查询结果识别");
  addKeyValue(merchant, "识别到的商户号", snapshot.merchant?.currentMerchantNo || "未读取");
  addKeyValue(merchant, "目标商户", snapshot.merchant?.target);
  addKeyValue(merchant, "识别到的当前商户", snapshot.merchant?.current || "未识别（unknown，不等于不匹配）");
  addKeyValue(merchant, "名称线索状态", `${merchantStatusLabel(snapshot.merchant?.status)}（置信度：${confidenceLabel(snapshot.merchant?.confidence)}；来源：${snapshot.merchant?.source || "—"}）`);
  addKeyValue(merchant, "商户面板", snapshot.merchant?.merchantPanel?.visible ? "可见" : "未发现");
  addKeyValue(merchant, "当前商户语义标签", snapshot.merchant?.merchantPanel?.currentMerchantLabelVisible
    ? "当前商户"
    : snapshot.merchant?.merchantPanel?.merchantNameLabelVisible ? "商户名称（在商户上下文中）" : "未发现");
  const merchantControl = snapshot.merchant?.merchantControl || {};
  addKeyValue(merchant, "“我的商户”入口", merchantControl.found
    ? `${merchantControl.text}（${merchantControl.tag}；${merchantControl.clickable ? "可点击" : "未确认可点击"}；${merchantControl.selector || "无 selector"}）`
    : "未发现");
  if (merchantControl.onclick) addKeyValue(merchant, "入口 onclick", merchantControl.onclick);
  const switchControl = snapshot.merchant?.switchControl || {};
  addKeyValue(merchant, "“切换商户”入口", switchControl.found
    ? `${switchControl.text}（${switchControl.tag}；${switchControl.clickable ? "可点击" : "未确认可点击"}；${switchControl.selector || "无 selector"}）`
    : "未发现");
  if (switchControl.onclick) addKeyValue(merchant, "切换入口 onclick", switchControl.onclick);
  root.append(merchant);

  const navigation = make("section", "overview-card");
  navigation.append(make("h2", "", "导航与业务入口"));
  addList(navigation, "主导航", snapshot.navigation?.main || [], (item) =>
    `${item.text}${item.active ? "（当前）" : ""} — ${item.href}${frameLabel(item)}`);
  addList(navigation, "业务入口", snapshot.navigation?.businessEntries || [], (item) =>
    `${item.text} — ${item.target}${frameLabel(item)}`);
  root.append(navigation);

  const controls = make("section", "overview-card");
  controls.append(make("h2", "", "页面控件"));
  addList(controls, "业务按钮", snapshot.controls?.buttons || [], (item) =>
    `${item.text}（${item.type}${item.disabled ? "；禁用" : ""}）${item.selector ? ` — ${item.selector}` : ""}${frameLabel(item)}`);
  addList(controls, "统一可点击元素", snapshot.controls?.interactiveElements || [], (item) =>
    `${item.text}（${item.tag}${item.role ? `；role=${item.role}` : ""}）${item.selector ? ` — ${item.selector}` : ""}${item.onclick ? `；onclick=${item.onclick}` : ""}${frameLabel(item)}`);
  addList(controls, "输入框", snapshot.controls?.inputs || [], (item) => {
    const label = item.label || item.name || item.id || "未命名";
    return `${label}（${item.tag}/${item.type}）${item.required ? "；必填" : ""}${item.disabled ? "；禁用" : ""}${frameLabel(item)}`;
  });
  addList(controls, "下拉框（select）", snapshot.controls?.selects || [], (item) => {
    const label = item.label || item.name || item.id || "未命名";
    const options = item.options?.length ? `；选项：${item.options.join("、")}` : "";
    return `${label}${item.required ? "（必填）" : ""}${options}${frameLabel(item)}`;
  });
  addList(controls, "链接", snapshot.controls?.links || [], (item) =>
    `${item.text || "（无文字）"} — ${item.href}${frameLabel(item)}`);
  root.append(controls);

  const content = make("section", "overview-card");
  content.append(make("h2", "", "页面内容"));
  addList(content, "标题", snapshot.content?.headings || [], (item) =>
    `${item.text}${frameLabel(item)}`);
  addTables(content, snapshot.content?.tables || []);
  addDownloadTaskLists(content, snapshot.content?.downloadTaskLists || []);
  addList(content, "主要可见文字", (snapshot.content?.visibleText || "").split("\n").filter(Boolean));
  root.append(content);

  const frames = make("section", "overview-card");
  frames.append(make("h2", "", `iframe 与 Frame（${snapshot.frames?.count ?? 0} 个 iframe）`));
  addList(frames, "iframe", snapshot.frames?.items || [], (item) => {
    const label = item.title || item.name || `iframe ${item.index}`;
    return `${label} — ${item.url || "（无 URL）"}${item.scanned ? `（已扫描，frame ${item.scannedFrameId}）` : "（未确认可访问）"}`;
  });
  addList(frames, "已扫描文档", snapshot.frames?.scannedDocuments || [], (item) =>
    `${item.isTopFrame ? "顶层页面" : `Frame ${item.frameId}`} — ${item.title || "（无标题）"} — ${item.url}`);
  root.append(frames);

  if (snapshot.frameScan?.note) root.append(make("p", "notice", snapshot.frameScan.note));
  root.append(make("p", "privacy-note", "此快照保存在本机 Chrome 扩展存储中。输入框当前值不会被采集；普通表格最多保留 3 行样例，下载暂存列表只读取当前页任务信息。"));
};

chrome.storage.local.get(STORAGE_KEY).then((result) => {
  const snapshot = result[STORAGE_KEY];
  if (!snapshot || snapshot.schemaVersion !== 3) {
    root.append(make("section", "empty-card", "没有新版页面快照。请返回银联商务页面，打开扩展并点击“检测当前页面”。"));
    copyButton.disabled = true;
    return;
  }
  renderSnapshot(snapshot);
}).catch(() => {
  root.append(make("section", "empty-card", "无法读取本地页面快照。"));
});

copyButton.addEventListener("click", async () => {
  copyStatus.textContent = "";
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const snapshot = result[STORAGE_KEY];
    if (!snapshot || snapshot.schemaVersion !== 3) throw new Error("没有可复制的新版本检测结果。");
    const serialized = JSON.stringify(snapshot, null, 2);
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(serialized);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = serialized;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) throw new Error("浏览器未允许访问剪贴板。");
    }
    copyStatus.textContent = "已复制 JSON，可以粘贴发送。";
  } catch (error) {
    copyStatus.textContent = error?.message || "复制失败。";
  }
});
