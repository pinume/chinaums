(() => {
  const ROUTE = "/uisportalfront";
  let queryTracker = null;
  let downloadRefresh = null;
  const beginDownloadRefresh = () => {
    downloadRefresh?.observer?.disconnect();
    const tracker = { startedAt: performance.now(), candidate: null, candidateSince: 0, completed: null };
    tracker.capture = (entries) => {
      const completed = entries.filter((entry) => entry.name.includes("/qryExportDtls") &&
        entry.startTime >= tracker.startedAt && entry.responseEnd >= entry.startTime).at(-1);
      if (completed) tracker.completed = completed;
    };
    if (typeof PerformanceObserver === "function") {
      tracker.observer = new PerformanceObserver((list) => tracker.capture(list.getEntries()));
      tracker.observer.observe({ entryTypes: ["resource"] });
    }
    downloadRefresh = tracker;
  };
  const clean = (value, limit = 240) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
  const normalize = (value) => clean(value, 500).replace(/\s/g, "");
  const visible = (element) => {
    if (!(element instanceof Element)) return false;
    if (!element.getClientRects().length) return false;
    for (let node = element; node instanceof Element; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" ||
        style.visibility === "collapse" || style.opacity === "0") return false;
    }
    return true;
  };
  const textOf = (element) => clean(element?.innerText || element?.textContent, 6000);
  const onReportPage = () => location.hostname === "service.chinaums.com" &&
    location.pathname.replace(/\/+$/, "") === ROUTE && location.hash.includes("/auditOfTrade2026");
  const downloadGateAllowed = (args) => args.gate?.allowed === true &&
    args.gate.merchantNo === args.targetMerchantNo && Boolean(args.targetMerchantNo);
  const tradeDateInput = () => {
    const matches = [...document.querySelectorAll("input.deal-date")]
      .filter((input) => visible(input) && !input.disabled);
    if (matches.length !== 1) {
      return { error: `交易日期输入框识别异常：可用输入框 ${matches.length} 个。` };
    }
    return { input: matches[0] };
  };
  const exactButton = (label) => {
    const matches = [...document.querySelectorAll("button")]
      .filter(visible)
      .filter((element) => normalize(textOf(element)) === normalize(label));
    return matches.length === 1 && !matches[0].disabled ? matches[0] : null;
  };
  const findCalendar = () => {
    const matches = [...document.querySelectorAll(".layui-laydate")].filter(visible);
    return matches.length === 1 ? matches[0] : null;
  };
  const openCalendar = async (input) => {
    let calendar = findCalendar();
    if (calendar) return calendar;
    input.blur();
    input.focus();
    if (!findCalendar()) input.dispatchEvent(new Event("focus"));
    if (!findCalendar()) input.click();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      calendar = findCalendar();
      if (calendar) return calendar;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return findCalendar();
  };
  const monthFromPanel = (panel) => {
    const text = textOf(panel.querySelector(".laydate-set-ym"));
    const match = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
    return match ? { year: Number(match[1]), month: Number(match[2]) } : null;
  };
  const monthKey = ({ year, month }) => year * 12 + month - 1;
  const readCalendar = (calendar) => [...calendar.querySelectorAll(".layui-laydate-main")]
    .filter(visible)
    .map((panel) => ({ panel, month: monthFromPanel(panel) }))
    .filter((item) => item.month);
  const moveCalendarToMonth = async (calendar, year, month) => {
    const targetKey = monthKey({ year, month });
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const panels = readCalendar(calendar);
      if (!panels.length) return false;
      if (panels.some((item) => monthKey(item.month) === targetKey)) return true;
      const firstKey = monthKey(panels[0].month);
      const lastKey = monthKey(panels[panels.length - 1].month);
      const direction = targetKey < firstKey ? "prev" : targetKey > lastKey ? "next" : "none";
      if (direction === "none") return false;
      const panel = direction === "prev" ? panels[0].panel : panels[panels.length - 1].panel;
      const control = [...panel.querySelectorAll(`.laydate-${direction}-m`)]
        .filter((element) => visible(element) && !element.classList.contains("laydate-disabled"));
      if (control.length !== 1) return false;
      control[0].click();
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    return false;
  };
  const selectDay = (calendar, year, month, day) => {
    const match = readCalendar(calendar).find((item) =>
      item.month.year === year && item.month.month === month
    );
    if (!match) return false;
    const cells = [...match.panel.querySelectorAll(".layui-laydate-content td")]
      .filter(visible)
      .filter((cell) => !cell.classList.contains("laydate-day-prev") && !cell.classList.contains("laydate-day-next") && !cell.classList.contains("laydate-disabled"))
      .filter((cell) => normalize(textOf(cell)) === String(day));
    if (cells.length !== 1) return false;
    cells[0].click();
    return true;
  };
  const parseDate = (value) => {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) } : null;
  };
  const localDate = ({ year, month, day }) => `${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
  const normalizeRangeValue = (value) => normalize(String(value || "").replace(/-/g, "/"));
  const resultCount = () => {
    const match = textOf(document.body).match(/根据查询条件共查询到\s*([\d,]+)\s*条(?:记录)?/);
    return match ? Number(match[1].replace(/,/g, "")) : null;
  };
  const querySignature = () => {
    const rows = [...document.querySelectorAll(".el-table__body-wrapper tbody > tr")]
      .filter(visible)
      .map((row) => textOf(row))
      .slice(0, 3);
    const empty = [...document.querySelectorAll(".el-table__empty-text,.el-empty__description")]
      .filter(visible)
      .map(textOf)
      .join("|");
    return JSON.stringify({ count: resultCount(), rows, empty });
  };
  const queryBusy = () => {
    const buttons = [...document.querySelectorAll("button")]
      .filter(visible)
      .filter((element) => normalize(textOf(element)) === "查询");
    const button = buttons.length === 1 ? buttons[0] : null;
    return Boolean(
      [...document.querySelectorAll(".el-loading-mask,.layui-layer-loading,.loading")].some(visible) ||
      (button && (button.disabled || /查询中|加载中/.test(textOf(button))))
    );
  };
  // Record short loading cycles and redraws even when the next poll sees identical results.
  const observeQuery = (control) => {
    const tracker = queryTracker;
    if (typeof MutationObserver !== "function") return;
    tracker.observer = new MutationObserver((records) => {
      if (queryTracker !== tracker) return;
      const loadingSelector = ".el-loading-mask,.layui-layer-loading,.loading";
      if (queryBusy() || records.some((record) =>
        (record.target instanceof Element && record.target.matches(loadingSelector)) ||
        [...(record.addedNodes || []), ...(record.removedNodes || [])].some((node) =>
          node instanceof Element && (node.matches(loadingSelector) || node.querySelector(loadingSelector))) ||
        (record.target === control && record.attributeName === "disabled" && record.oldValue !== null))) {
        tracker.observedLoading = true;
        tracker.candidate = null;
      }
      if (records.some((record) => {
        if (!["childList", "characterData"].includes(record.type)) return false;
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        const result = target?.closest(".el-table__body-wrapper,.el-table__empty-block,.el-table__empty-text,.el-empty__description");
        return result && !result.closest(".el-dialog");
      })) {
        tracker.candidate = null;
      }
    });
    tracker.observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true,
      attributes: true, attributeOldValue: true, attributeFilter: ["class", "style", "disabled"] });
  };
  const finishQueryObservation = () => queryTracker?.observer?.disconnect();

  const dialogTexts = () => [...document.querySelectorAll(
    '[role="dialog"],[aria-modal="true"],.el-message-box,.el-dialog'
  )]
    .filter(visible)
    .map(textOf)
    .filter(Boolean);
  const classifySubmit = () => {
    const messages = dialogTexts();
    const accepted = messages.filter((text) => /申请已提交/.test(text));
    if (accepted.length) {
      const files = [...new Set(accepted.flatMap((text) => text.match(/MER_[A-Z0-9]+_\d{14}_yjhx\.xlsx/gi) || []))];
      return { status: "accepted", fileName: files.length === 1 ? files[0] : null };
    }
    if (messages.some((text) => /超过\s*\d+\s*条申请在处理中/.test(text))) return { status: "throttled" };
    if (messages.some((text) => /(?:申请失败|导出失败|系统异常)/.test(text))) {
      return { status: "failed", message: messages.find((text) => /(?:申请失败|导出失败|系统异常)/.test(text)) };
    }
    return { status: "unknown" };
  };
  const statusCode = (status) => status === "待处理" ? "pending" : status === "处理成功" ? "ready" : /^(?:处理失败|生成失败|导出失败)$/.test(status) ? "failed" : "unknown";

  const downloadTable = (dialog) => {
    const tables = [...dialog.querySelectorAll(".el-table")].filter(visible);
    return tables.map((element) => {
      const headers = [...element.querySelectorAll(".el-table__header-wrapper thead th, .el-table__header-wrapper [role=columnheader]")]
        .filter(visible)
        .map((cell) => clean(cell.querySelector(".cell")?.innerText || cell.innerText || cell.textContent, 100));
      return {
        element,
        headers,
        columns: {
          createdAt: headers.findIndex((header) => header.includes("创建时间")),
          fileName: headers.findIndex((header) => header.includes("文件名")),
          status: headers.findIndex((header) => header.includes("下载状态")),
          operation: headers.findIndex((header) => header.includes("操作"))
        }
      };
    }).find(({ columns }) => Object.values(columns).every((index) => index >= 0));
  };

  const reportComponent = () => [...document.querySelectorAll(".el-table")]
    .filter((table) => !table.closest(".el-dialog"))
    .map((table) => table.__vue__?.$parent)
    .find((component) => component?.$options?.name === "table");
  const queryMerchantIds = () => {
    const rows = reportComponent()?.tableData;
    if (!Array.isArray(rows) || !rows.length || rows.some((row) => !row.mchntId)) return [];
    return [...new Set(rows.map((row) => normalize(row.mchntId)))];
  };

  const downloadDialogComponent = (dialog) => {
    const instance = dialog.closest(".el-dialog__wrapper")?.__vue__;
    return [instance, instance?.$parent].find((component) => component?.$options?.name === "ElDialog");
  };
  const downloadDialogs = () => [...document.querySelectorAll(".el-dialog")]
    .filter((dialog) => normalize(textOf(dialog.querySelector(".el-dialog__title"))) === "下载暂存列表")
    .filter((dialog) => {
      const component = downloadDialogComponent(dialog);
      // 后台标签页的离场动画可能延迟；组件已关闭时，残留布局不代表列表仍打开。
      return typeof component?.visible === "boolean" ? component.visible : visible(dialog);
    });

  const parseDownloadTaskList = () => {
    const dialogs = downloadDialogs();
    const dialog = dialogs[0];
    if (!dialog) return { status: "not_open" };
    if (dialogs.length !== 1) return { status: "parse_error", rows: [] };
    if (queryBusy() || !visible(dialog)) return { status: "loading" };
    if (downloadRefresh) {
      downloadRefresh.capture(downloadRefresh.observer?.takeRecords() || []);
      downloadRefresh.capture(performance.getEntriesByType("resource"));
      const completed = downloadRefresh.completed;
      if (!completed) return { status: "loading" };
      if (completed.responseStatus !== undefined && (completed.responseStatus === 0 || completed.responseStatus >= 400)) {
        return { status: "refresh_error", reason: "暂存列表刷新请求失败。" };
      }
      const signature = textOf(dialog);
      if (signature !== downloadRefresh.candidate) {
        downloadRefresh.candidate = signature;
        downloadRefresh.candidateSince = Date.now();
        return { status: "loading" };
      }
      if (Date.now() - downloadRefresh.candidateSince < 500) return { status: "loading" };
      downloadRefresh.observer?.disconnect();
      downloadRefresh = null;
    }
    const totalMatch = textOf(dialog).match(/共\s*(\d+)\s*条(?:记录)?/);
    const activePage = dialog.querySelector(".el-pagination .number.active");
    const table = downloadTable(dialog);
    if (!table) return { status: "parse_error", total: totalMatch ? Number(totalMatch[1]) : null, rows: [] };

    const body = table.element.querySelector(".el-table__body-wrapper");
    const sourceRows = body ? [...body.querySelectorAll("tbody > tr")] : [];
    const rows = [...new Set(sourceRows.filter(visible))].slice(0, 50).map((row) => {
      const cells = [...row.children].filter((cell) => cell.tagName === "TD");
      const cellText = (index) => clean(cells[index]?.querySelector(".cell")?.innerText || cells[index]?.innerText || cells[index]?.textContent, 240);
      const operationCell = cells[table.columns.operation];
      const controls = operationCell
        ? [...operationCell.querySelectorAll('a,button,[role="button"]')]
          .filter((element) => normalize(textOf(element)) === "下载")
        : [];
      const control = controls.length === 1 ? controls[0] : null;
      const disabled = !control ? null : Boolean(control.disabled) ||
        control.getAttribute("aria-disabled") === "true" ||
        control.classList.contains("is-disabled") || Boolean(control.closest(".is-disabled"));
      const status = cellText(table.columns.status);
      return {
        createdAt: cellText(table.columns.createdAt),
        fileName: cellText(table.columns.fileName),
        status,
        statusCode: statusCode(status),
        downloadEnabled: disabled === null ? null : !disabled
      };
    }).filter((row) => row.createdAt || row.fileName || row.status);
    return {
      status: rows.length ? "found" : "empty",
      total: totalMatch ? Number(totalMatch[1]) : null,
      page: activePage ? Number(textOf(activePage)) || null : null,
      hasNext: (() => {
        const next = dialog.querySelector(".el-pagination .btn-next");
        return Boolean(next && !next.disabled && next.getAttribute("aria-disabled") !== "true" && !next.classList.contains("is-disabled"));
      })(),
      rowCount: rows.length,
      rows
    };
  };

  globalThis.__chinaumsTradeAuditAdapter = async (operation, args = {}) => {
    if (!onReportPage()) return { status: "wrong_page", reason: "当前不是以旧换新采集2026业务 frame。" };

    switch (operation) {
      case "submitDialogState":
        return { status: dialogTexts().length === 0 ? "clear" : "visible" };
      case "inspect": {
        const date = tradeDateInput();
        return {
          status: date.error ? "controls_missing" : "ready",
          reason: date.error || (!exactButton("查询") ? "可用查询按钮缺失或不唯一。" : null),
          dateValue: date.input?.value ?? null,
          hasQuery: Boolean(exactButton("查询")),
          hasExport: Boolean(exactButton("批量导出")),
          hasDownloadList: Boolean(exactButton("下载暂存列表")),
          count: resultCount()
        };
      }
      case "setDateRange": {
        const start = parseDate(args.start);
        const end = parseDate(args.end);
        if (!start || !end || `${args.start}` > `${args.end}`) return { status: "failed", reason: "日期参数无效。" };
        const date = tradeDateInput();
        if (date.error) return { status: "failed", reason: date.error };
        let calendar = await openCalendar(date.input);
        if (!calendar) return { status: "failed", reason: "聚焦并点击交易日期后，3 秒内日历仍未出现。" };
        if (!await moveCalendarToMonth(calendar, start.year, start.month)) {
          return { status: "failed", reason: "未能将日期日历移动到目标起始月份。" };
        }
        calendar = findCalendar();
        if (!calendar || !selectDay(calendar, start.year, start.month, start.day)) {
          return { status: "failed", reason: "未能唯一定位目标起始日。" };
        }
        await new Promise((resolve) => setTimeout(resolve, 40));
        calendar = findCalendar();
        if (!calendar || !await moveCalendarToMonth(calendar, end.year, end.month)) {
          return { status: "failed", reason: "未能将日期日历移动到目标结束月份。" };
        }
        calendar = findCalendar();
        if (!calendar || !selectDay(calendar, end.year, end.month, end.day)) {
          return { status: "failed", reason: "未能唯一定位目标结束日。" };
        }
        const confirm = [...calendar.querySelectorAll("span.laydate-btns-confirm")]
          .filter((element) => visible(element) && !element.classList.contains("laydate-disabled"))
          .filter((element) => normalize(textOf(element)) === "确定");
        if (confirm.length !== 1) return { status: "failed", reason: "日期日历中的“确定”控件缺失或不唯一。" };
        confirm[0].click();
        await new Promise((resolve) => setTimeout(resolve, 60));
        const updated = tradeDateInput();
        const expected = normalizeRangeValue(`${localDate(start)}~${localDate(end)}`);
        if (updated.error || normalizeRangeValue(updated.input.value) !== expected) {
          return { status: "failed", reason: "日期控件显示范围与目标月份不一致，已停止。", value: updated.input?.value ?? null };
        }
        finishQueryObservation();
        queryTracker = null;
        return { status: "set", value: updated.input.value };
      }
      case "query": {
        if (dialogTexts().length > 0) return { status: "blocked", reason: "弹窗尚未关闭，不启动下一次查询。" };
        const control = exactButton("查询");
        if (!control) return { status: "controls_missing", reason: "“查询”按钮缺失或不唯一。" };
        const date = tradeDateInput();
        if (date.error || !date.input.value.trim()) {
          return { status: "failed", reason: date.error || "交易日期为空，未提交查询。" };
        }
        finishQueryObservation();
        queryTracker = {
          dateValue: date.input.value,
          baseline: querySignature(),
          observedLoading: false,
          candidate: null,
          candidateSince: 0
        };
        observeQuery(control);
        control.click();
        queryTracker.observedLoading ||= queryBusy();
        return { status: "clicked" };
      }
      case "queryState": {
        if (!queryTracker) return { status: "waiting" };
        const date = tradeDateInput();
        if (date.error || date.input.value !== queryTracker.dateValue) {
          finishQueryObservation();
          return { status: "failed", reason: "查询期间交易日期发生变化或无法确认。" };
        }
        if (queryBusy()) {
          queryTracker.candidate = null;
          queryTracker.observedLoading = true;
          return { status: "waiting" };
        }
        const signature = querySignature();
        if (!queryTracker.observedLoading && signature === queryTracker.baseline) {
          return { status: "waiting" };
        }
        if (queryTracker.candidate !== signature) {
          queryTracker.candidate = signature;
          queryTracker.candidateSince = Date.now();
          return { status: "waiting" };
        }
        if (Date.now() - queryTracker.candidateSince < 500) return { status: "waiting" };
        const count = resultCount();
        const exportButton = exactButton("批量导出");
        const listButton = exactButton("下载暂存列表");
        const currentResult = JSON.parse(signature);
        const noDataText = [...document.querySelectorAll(".el-table__empty-text,.el-empty__description")]
          .filter(visible)
          .some((element) => /暂无数据/.test(textOf(element)) && !/请根据条件查询/.test(textOf(element)));
        if (count === 0 || (count === null && noDataText)) {
          queryTracker.resultState = "no_data";
          finishQueryObservation();
          return { status: "no_data", count: count ?? 0 };
        }
        if (count !== null && currentResult.rows.length > 0 && exportButton && listButton) {
          const merchants = queryMerchantIds();
          if (merchants.length !== 1 || (args.targetMerchantId && merchants[0] !== args.targetMerchantId)) {
            finishQueryObservation();
            return { status: "failed", reason: "查询结果没有唯一商户身份或与本轮商户不一致；未申请导出。" };
          }
          queryTracker.resultState = "ready";
          finishQueryObservation();
          queryTracker.merchantId = merchants[0];
          return { status: "ready", count, merchantId: merchants[0] };
        }
        return { status: "waiting" };
      }
      case "submitExport": {
        if (dialogTexts().length > 0) return { status: "blocked", reason: "弹窗尚未关闭，不申请导出。" };
        const gate = args.gate;
        if (gate?.authentication?.status !== "logged_in" || gate.authentication.confidence !== "high") {
          return { status: "blocked", reason: "商户门禁未通过，不允许申请导出。" };
        }
        if (queryTracker?.resultState !== "ready" || resultCount() === null ||
          !exactButton("批量导出") || !exactButton("下载暂存列表")) {
          return { status: "blocked", reason: "查询结果未就绪，导出操作已锁定。" };
        }
        const merchants = queryMerchantIds();
        if (gate?.allowed !== true || !args.targetMerchantId || gate.merchantId !== args.targetMerchantId ||
          queryTracker.merchantId !== args.targetMerchantId || merchants.length !== 1 || merchants[0] !== args.targetMerchantId) {
          return { status: "blocked", reason: "当前商户身份无法确认或已切换；未申请导出。" };
        }
        exactButton("批量导出").click();
        return { status: "clicked" };
      }
      case "classifySubmit":
        return classifySubmit();
      case "closeSubmitDialog": {
        const result = classifySubmit();
        if (dialogTexts().length === 0) return { status: "closed" };
        if (!["accepted", "throttled", "failed"].includes(result.status)) {
          return { status: "blocked", reason: "没有可安全关闭的已识别提交提示。" };
        }
        const closeLabel = result.status === "throttled" ? "确认" : "关闭";
        const dialogs = [...document.querySelectorAll(".el-message-box,.el-dialog")]
          .filter(visible)
          .filter((dialog) => /申请已提交|超过\s*\d+\s*条申请在处理中|申请失败|导出失败|系统异常/.test(textOf(dialog)));
        if (dialogs.length !== 1) return { status: "blocked", reason: "提交提示弹窗缺失或不唯一。" };
        const dialog = dialogs[0];
        const scoped = [...dialog.querySelectorAll("button")]
          .filter(visible)
          .filter((element) => !element.disabled && normalize(textOf(element)) === closeLabel);
        if (scoped.length !== 1) return { status: "blocked", reason: "提交提示内的确认/关闭按钮缺失或不唯一。" };
        scoped[0].click();
        const isClosed = () => !visible(dialog) && dialogTexts().length === 0;
        // 后台页面的连续短计时器会被节流；由 DOM 变化直接确认关闭。
        const closed = await new Promise((resolve) => {
          if (isClosed()) return resolve(true);
          let timer;
          const finish = (value) => {
            observer.disconnect();
            clearTimeout(timer);
            resolve(value);
          };
          const observer = new MutationObserver(() => {
            if (isClosed()) finish(true);
          });
          observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
            attributeFilter: ["class", "style", "hidden"] });
          const deadline = Math.min(Date.now() + 8000, args.operationDeadline ?? Infinity);
          timer = setTimeout(() => finish(isClosed()), Math.max(0, deadline - Date.now()));
          if (isClosed()) finish(true);
        });
        if (closed) return { status: "closed" };
        return { status: "blocked", reason: `关闭等待8秒后仍未就绪（目标提示${visible(dialog) ? "仍可见" : "已隐藏"}，可见弹窗${dialogTexts().length}个）；未继续下一步。` };
      }
      case "openDownloadList": {
        const dialogs = downloadDialogs();
        if (dialogs.length > 1) return { status: "blocked", reason: "下载暂存列表弹窗不唯一。" };
        if (dialogs.length === 1) {
          return { status: "already_open" };
        }
        const button = exactButton("下载暂存列表");
        if (!button) return { status: "controls_missing" };
        beginDownloadRefresh();
        button.focus();
        button.click();
        return { status: "clicked" };
      }
      case "snapshotExportTasks": {
        const deadline = args.operationDeadline ?? Date.now() + 15000;
        const controller = new AbortController();
        const checkDeadline = () => {
          if (controller.signal.aborted || Date.now() >= deadline) {
            controller.abort();
            throw new Error("暂存任务读取已超过截止时间。");
          }
        };
        checkDeadline();
        const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()));
        try {
          const component = reportComponent();
          if (!component?.$axiosApi?.axiosPromisePara) throw new Error("无法读取以旧换新暂存接口。");
          const day = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
          const today = new Date();
          const start = new Date(today); start.setDate(start.getDate() - 7);
          const rows = [];
          for (let current = 0; current < 100; current += 1) {
            checkDeadline();
            const response = await component.$axiosApi.axiosPromisePara({
              searchObj: "1", size: 100, current,
              beginApplyDate: `${day(start)} 00:00:00`, endApplyDate: `${day(today)} 23:59:59`
            }, "uis-tradein-server/portal/yjhx/v3/qryExportDtls", {
              signal: controller.signal,
              timeout: Math.max(1, deadline - Date.now()),
              headers: { userPortalToken: localStorage.getItem("userPortalVerifyToken") }
            });
            checkDeadline();
            if (!response?.success || !Array.isArray(response.data?.list)) throw new Error("以旧换新暂存接口结构异常。");
            rows.push(...response.data.list.map((row) => ({ id: String(row.id || ""), fileName: row.exportFileName })));
            if (current + 1 >= Number(response.data.pages)) {
              if (rows.length !== Number(response.data.total) || rows.some((row) => !row.id || !row.fileName) || new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error("以旧换新暂存任务分页不完整或身份重复。");
              return { status: "found", rows };
            }
          }
          throw new Error("以旧换新暂存任务页数超出读取范围。");
        } finally {
          clearTimeout(timer);
        }
      }
      case "parseDownloadTasks":
        return parseDownloadTaskList();
      case "closeDownloadList": {
        const dialogs = downloadDialogs();
        if (dialogs.length === 0) {
          downloadRefresh?.observer?.disconnect();
          downloadRefresh = null;
          return { status: "already_closed" };
        }
        if (dialogs.length !== 1) return { status: "blocked", reason: "下载暂存列表弹窗不唯一，未关闭。" };
        const close = [...dialogs[0].querySelectorAll(".el-dialog__headerbtn")].filter(visible);
        if (close.length !== 1) return { status: "blocked", reason: "下载暂存列表右上角关闭控件缺失或不唯一。" };
        close[0].click();
        const component = downloadDialogComponent(dialogs[0]);
        if (component) {
          await component.$nextTick();
          if (component.visible !== false) return { status: "blocked", reason: "点击关闭后，下载暂存列表组件仍保持打开。" };
        }
        downloadRefresh?.observer?.disconnect();
        downloadRefresh = null;
        return { status: "closed" };
      }
      case "nextDownloadPage": {
        const dialogs = downloadDialogs();
        const dialog = dialogs.length === 1 ? dialogs[0] : null;
        if (!dialog) return { status: "not_open" };
        const next = [...dialog.querySelectorAll(".el-pagination .btn-next")]
          .filter(visible)
          .filter((element) => !element.disabled && element.getAttribute("aria-disabled") !== "true" && !element.classList.contains("is-disabled"));
        if (next.length !== 1) return { status: "end" };
        beginDownloadRefresh();
        next[0].click();
        return { status: "clicked" };
      }
      case "selectDownloadPage": {
        const dialogs = downloadDialogs();
        const dialog = dialogs.length === 1 ? dialogs[0] : null;
        if (!dialog) return { status: "not_open" };
        const current = parseDownloadTaskList();
        if (Number(current.page) === Number(args.page)) return { status: "already_current" };
        const matches = [...dialog.querySelectorAll(".el-pagination .number")]
          .filter(visible)
          .filter((element) => normalize(textOf(element)) === String(args.page));
        if (matches.length !== 1) return { status: "unavailable" };
        beginDownloadRefresh();
        matches[0].click();
        return { status: "clicked" };
      }
      case "downloadTask": {
        if (!downloadGateAllowed(args)) return { status: "blocked", reason: "商户门禁未通过，不允许下载。" };
        const expectedFile = new RegExp(
          `^MER_${String(args.targetMerchantNo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_\\d{14}_yjhx\\.xlsx$`,
          "i"
        );
        if (!expectedFile.test(args.fileName || "")) {
          return { status: "blocked", reason: "文件名中的商户号与当前目标不符。" };
        }
        const dialogs = downloadDialogs();
        const dialog = dialogs.length === 1 ? dialogs[0] : null;
        if (!dialog) return { status: "not_open" };
        const table = downloadTable(dialog);
        if (downloadRefresh && parseDownloadTaskList().status !== "found") {
          return { status: "not_ready", reason: "本次暂存列表刷新尚未完成。" };
        }
        if (!table) return { status: "parse_error", reason: "下载表头无法确认。" };
        const matches = [...(table.element.querySelector(".el-table__body-wrapper")?.querySelectorAll("tbody > tr") || [])]
          .filter(visible)
          .filter((row) => {
            const cell = [...row.children][table.columns.fileName];
            return clean(cell?.querySelector(".cell")?.innerText || cell?.innerText || cell?.textContent, 240) === args.fileName;
          });
        if (matches.length !== 1) return { status: "unknown", reason: "目标文件行缺失或不唯一。" };
        const row = matches[0];
        const cells = [...row.children].filter((cell) => cell.tagName === "TD");
        const status = clean(cells[table.columns.status]?.querySelector(".cell")?.innerText || cells[table.columns.status]?.innerText || cells[table.columns.status]?.textContent, 80);
        const downloadCell = cells[table.columns.operation];
        const controls = downloadCell ? [...downloadCell.querySelectorAll('a,button,[role="button"]')]
          .filter((element) => normalize(textOf(element)) === "下载") : [];
        if (status !== "处理成功" || controls.length !== 1 || controls[0].disabled || controls[0].classList.contains("is-disabled") ||
          controls[0].getAttribute("aria-disabled") === "true" || controls[0].closest(".is-disabled")) {
          return { status: "not_ready", reason: "任务未显示“处理成功”或行内下载控件不可用。" };
        }
        controls[0].click();
        return { status: "download_requested" };
      }
      default:
        return { status: "unknown_operation" };
    }
  };
})();
