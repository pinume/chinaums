(() => {
  const ROUTE = "/uisportalfront";
  let queryTracker = null;
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
  const dialogTexts = () => [...document.querySelectorAll(
    '[role="dialog"],[aria-modal="true"],.el-message-box,.el-dialog'
  )]
    .filter(visible)
    .map(textOf)
    .filter(Boolean);
  const classifySubmit = () => {
    const messages = dialogTexts();
    if (messages.some((text) => /申请已提交/.test(text))) return { status: "accepted" };
    if (messages.some((text) => /超过\s*12\s*条申请在处理中/.test(text))) return { status: "throttled" };
    if (messages.some((text) => /(?:申请失败|导出失败|系统异常)/.test(text))) {
      return { status: "failed", message: messages.find((text) => /(?:申请失败|导出失败|系统异常)/.test(text)) };
    }
    return { status: "unknown" };
  };
  const statusCode = (status) => status === "待处理" ? "pending" : status === "处理成功" ? "ready" : "unknown";

  const parseDownloadTaskList = () => {
    const dialogs = [...document.querySelectorAll(".el-dialog")].filter(visible);
    const dialog = dialogs.find((element) => normalize(textOf(element.querySelector(".el-dialog__title"))) === "下载暂存列表");
    if (!dialog) return { status: "not_open" };
    const totalMatch = textOf(dialog).match(/共\s*(\d+)\s*条(?:记录)?/);
    const activePage = dialog.querySelector(".el-pagination .number.active");
    const tables = [...dialog.querySelectorAll(".el-table")].filter(visible);
    const table = tables.map((element) => {
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
        queryTracker = null;
        return { status: "set", value: updated.input.value };
      }
      case "query": {
        const control = exactButton("查询");
        if (!control) return { status: "controls_missing", reason: "“查询”按钮缺失或不唯一。" };
        const date = tradeDateInput();
        if (date.error || !date.input.value.trim()) {
          return { status: "failed", reason: date.error || "交易日期为空，未提交查询。" };
        }
        queryTracker = {
          dateValue: date.input.value,
          startedAt: Date.now(),
          baseline: querySignature(),
          observedLoading: false,
          candidate: null,
          candidateSince: 0
        };
        control.click();
        return { status: "clicked" };
      }
      case "queryState": {
        if (!queryTracker) return { status: "waiting" };
        const date = tradeDateInput();
        if (date.error || date.input.value !== queryTracker.dateValue) {
          return { status: "failed", reason: "查询期间交易日期发生变化或无法确认。" };
        }
        if (queryBusy()) {
          queryTracker.observedLoading = true;
          return { status: "waiting" };
        }
        const signature = querySignature();
        if (!queryTracker.observedLoading && signature === queryTracker.baseline &&
          !(args.refreshDownloadList === true && Date.now() - queryTracker.startedAt >= 3000)) {
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
          return { status: "no_data", count: count ?? 0 };
        }
        if (count !== null && currentResult.rows.length > 0 && exportButton && listButton) {
          queryTracker.resultState = "ready";
          return { status: "ready", count };
        }
        return { status: "waiting" };
      }
      case "submitExport": {
        const gate = args.gate;
        if (gate?.authentication?.status !== "logged_in" || gate.authentication.confidence !== "high") {
          return { status: "blocked", reason: "商户门禁未通过，不允许申请导出。" };
        }
        if (queryTracker?.resultState !== "ready" || resultCount() === null ||
          !exactButton("批量导出") || !exactButton("下载暂存列表")) {
          return { status: "blocked", reason: "查询结果未就绪，导出操作已锁定。" };
        }
        exactButton("批量导出").click();
        return { status: "clicked" };
      }
      case "classifySubmit":
        return classifySubmit();
      case "closeSubmitDialog": {
        const result = classifySubmit();
        if (!["accepted", "throttled", "failed"].includes(result.status)) {
          return { status: "blocked", reason: "没有可安全关闭的已识别提交提示。" };
        }
        const closeLabel = result.status === "throttled" ? "确认" : "关闭";
        const candidates = [...document.querySelectorAll(".el-message-box button,.el-dialog button,button")]
          .filter(visible)
          .filter((element) => normalize(textOf(element)) === closeLabel);
        const scoped = candidates.filter((element) => {
          let parent = element;
          for (let depth = 0; parent && depth < 6; parent = parent.parentElement, depth += 1) {
            if (dialogTexts().some((text) => /申请已提交|超过\s*12\s*条申请在处理中|申请失败|导出失败/.test(text)) &&
              /申请已提交|超过\s*12\s*条申请在处理中|申请失败|导出失败/.test(textOf(parent))) return true;
          }
          return false;
        });
        if (scoped.length !== 1) return { status: "blocked", reason: "提交提示内的确认/关闭按钮缺失或不唯一。" };
        scoped[0].click();
        return { status: "closed" };
      }
      case "openDownloadList": {
        if (parseDownloadTaskList().status !== "not_open") return { status: "already_open" };
        const button = exactButton("下载暂存列表");
        if (!button) return { status: "controls_missing" };
        button.click();
        return { status: "clicked" };
      }
      case "parseDownloadTasks":
        return parseDownloadTaskList();
      case "closeDownloadList": {
        const dialogs = [...document.querySelectorAll(".el-dialog")]
          .filter(visible)
          .filter((element) => normalize(textOf(element.querySelector(".el-dialog__title"))) === "下载暂存列表");
        if (dialogs.length === 0) return { status: "already_closed" };
        if (dialogs.length !== 1) return { status: "blocked", reason: "下载暂存列表弹窗不唯一，未关闭。" };
        const close = [...dialogs[0].querySelectorAll(".el-dialog__headerbtn")].filter(visible);
        if (close.length !== 1) return { status: "blocked", reason: "下载暂存列表右上角关闭控件缺失或不唯一。" };
        close[0].click();
        return { status: "closed" };
      }
      case "nextDownloadPage": {
        const dialog = [...document.querySelectorAll(".el-dialog")]
          .filter(visible)
          .find((element) => normalize(textOf(element.querySelector(".el-dialog__title"))) === "下载暂存列表");
        if (!dialog) return { status: "not_open" };
        const next = [...dialog.querySelectorAll(".el-pagination .btn-next")]
          .filter(visible)
          .filter((element) => !element.disabled && element.getAttribute("aria-disabled") !== "true" && !element.classList.contains("is-disabled"));
        if (next.length !== 1) return { status: "end" };
        next[0].click();
        return { status: "clicked" };
      }
      case "selectDownloadPage": {
        const dialog = [...document.querySelectorAll(".el-dialog")]
          .filter(visible)
          .find((element) => normalize(textOf(element.querySelector(".el-dialog__title"))) === "下载暂存列表");
        if (!dialog) return { status: "not_open" };
        const current = parseDownloadTaskList();
        if (Number(current.page) === Number(args.page)) return { status: "already_current" };
        const matches = [...dialog.querySelectorAll(".el-pagination .number")]
          .filter(visible)
          .filter((element) => normalize(textOf(element)) === String(args.page));
        if (matches.length !== 1) return { status: "unavailable" };
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
        const dialog = [...document.querySelectorAll(".el-dialog")]
          .filter(visible)
          .find((element) => normalize(textOf(element.querySelector(".el-dialog__title"))) === "下载暂存列表");
        if (!dialog) return { status: "not_open" };
        const matches = [...dialog.querySelectorAll(".el-table__body-wrapper tbody > tr")]
          .filter(visible)
          .filter((row) => [...row.querySelectorAll("td")]
            .some((cell) => clean(cell.querySelector(".cell")?.innerText || cell.innerText || cell.textContent, 240) === args.fileName));
        if (matches.length !== 1) return { status: "unknown", reason: "目标文件行缺失或不唯一。" };
        const row = matches[0];
        const cells = [...row.children].filter((cell) => cell.tagName === "TD");
        const status = clean(cells[2]?.querySelector(".cell")?.innerText || cells[2]?.innerText || cells[2]?.textContent, 80);
        const downloadCell = cells[3];
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
