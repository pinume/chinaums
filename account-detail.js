(() => {
  const ROUTE = "/uisportal/accountCheckDetailQry/toDetail";
  let queryTracker = null;
  let downloadRefresh = null;
  const beginDownloadRefresh = () => {
    downloadRefresh?.observer?.disconnect();
    const tracker = { startedAt: performance.now(), candidate: null, candidateSince: 0, completed: null };
    tracker.capture = (entries) => {
      const completed = entries.filter((entry) => entry.name.includes("/accountCheckDetailQry/selectDeailBillList") &&
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
  const textOf = (element) => clean(element?.innerText || element?.textContent, 4000);
  const exactControls = (selector, expected) => [...document.querySelectorAll(selector)]
    .filter(visible)
    .filter((element) => normalize(textOf(element)) === normalize(expected));
  const onReportPage = () => location.hostname === "service.chinaums.com" && location.pathname === ROUTE;
  const hasDownloadList = () => downloadDialogs().length === 1;
  const downloadGateAllowed = (args) => args.gate?.allowed === true &&
    normalize(args.gate.merchantNo) === normalize(args.targetMerchantNo) && Boolean(args.targetMerchantNo);
  const field = () => {
    const matches = [...document.querySelectorAll("#settDate")].filter(visible);
    if (matches.length !== 1 || !(matches[0] instanceof HTMLInputElement) || matches[0].disabled) {
      return { error: `清算时间控件不唯一或不可用（${matches.length}）。` };
    }
    let context = matches[0];
    for (let depth = 0; context && depth < 5; depth += 1, context = context.parentElement) {
      if (/清算时间/.test(textOf(context))) return { input: matches[0] };
    }
    return { error: "#settDate 附近未能确认“清算时间”标签，未修改日期。" };
  };
  const queryControl = () => {
    const matches = [...document.querySelectorAll("#d_search")]
      .filter(visible)
      .filter((element) => normalize(textOf(element)) === "查询");
    return matches.length === 1 && !matches[0].disabled ? matches[0] : null;
  };
  const resultSignature = () => {
    const bodyText = textOf(document.body);
    const count = bodyText.match(/根据输入条件共查询到\s*([\d,]+)\s*条/);
    const tableRows = [...document.querySelectorAll("table tr")]
      .filter(visible)
      .map((row) => textOf(row))
      .filter((text) => text && !/清算时间|交易时间|申请下载xlsx/.test(text))
      .slice(0, 3);
    const emptyText = bodyText.match(/暂无数据[^。\n]*/)?.[0] || "";
    return JSON.stringify({ count: count?.[1]?.replace(/,/g, "") ?? null, tableRows, emptyText });
  };
  const queryResultMerchantNumbers = () => {
    const values = [];
    for (const table of [...document.querySelectorAll("table")].filter(visible)) {
      const rows = [...table.querySelectorAll("tr")].filter(visible);
      const headerIndex = rows.findIndex((row) => [...row.children]
        .some((cell) => /^(商户号|商户编号)$/.test(normalize(textOf(cell)))));
      if (headerIndex < 0) continue;
      const headers = [...rows[headerIndex].children];
      const merchantIndex = headers.findIndex((cell) => /^(商户号|商户编号)$/.test(normalize(textOf(cell))));
      if (merchantIndex < 0) continue;
      for (const row of rows.slice(headerIndex + 1)) {
        const merchantCell = [...row.children][merchantIndex];
        const merchantNo = normalize(textOf(merchantCell));
        if (merchantNo) values.push(merchantNo);
      }
    }
    return [...new Set(values)];
  };
  const queryBusy = () => {
    const buttons = [...document.querySelectorAll("#d_search")].filter(visible);
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
        const result = target?.closest("table");
        return result && !result.closest("#downloadList,.loadSave-row") &&
          [...result.querySelectorAll("th,td")].some((cell) => /^(商户号|商户编号)$/.test(normalize(textOf(cell))));
      })) {
        tracker.candidate = null;
      }
    });
    tracker.observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true,
      attributes: true, attributeOldValue: true, attributeFilter: ["class", "style", "disabled"] });
  };
  const finishQueryObservation = () => queryTracker?.observer?.disconnect();

  const exportControl = () => {
    const matches = [...document.querySelectorAll("#crtt_download_xlsx")].filter(visible);
    return matches.length === 1 && !matches[0].disabled ? matches[0] : null;
  };
  const buildExportPayload = (control) => {
    const range = String(queryTracker?.dateValue || "").match(/^(\d{4})\/(\d{2})\/(\d{2})\s~\s(\d{4})\/(\d{2})\/(\d{2})$/);
    if (!range) return { error: "已确认查询日期格式无法转换为导出参数。" };
    const expectedBegin = `${range[1]}${range[2]}${range[3]}`;
    const expectedEnd = `${range[4]}${range[5]}${range[6]}`;
    const forms = [...document.querySelectorAll("form")].filter((form) =>
      form.querySelector('[name="settDateBegin"]') && form.querySelector('[name="settDateEnd"]')
    );
    const nearest = control?.closest("form");
    const form = nearest && forms.includes(nearest) ? nearest : forms.length === 1 ? forms[0] : null;
    if (!form) return { error: `导出查询表单缺失或不唯一（${forms.length}）。` };

    const payload = new URLSearchParams();
    for (const [name, value] of new FormData(form)) {
      if (typeof value !== "string") return { error: `导出字段 ${name} 包含非文本值。` };
      payload.append(name, value);
    }
    payload.set("fileExt", "xlsx");
    if (payload.get("settDateBegin") !== expectedBegin || payload.get("settDateEnd") !== expectedEnd) {
      return { error: "导出表单中的清算日期与刚刚确认的查询结果不一致。" };
    }
    return { payload };
  };
  const classifyExportResponse = (data) => {
    const code = String(data?.respCode ?? "");
    const message = clean(data?.respDesc, 500);
    if (code === "000000" && /对账明细下载成功/.test(message)) {
      return { status: "accepted", message, source: "api" };
    }
    if (code === "999999" && /超过\s*\d+\s*条.*(?:未处理|处理中的导出文件)/.test(message)) {
      return { status: "throttled", message, source: "api" };
    }
    return { status: "unknown", reason: message ? `服务器返回 ${code || "无状态码"}：${message}` : "提交接口返回无法识别。" };
  };
  const modalSelector = '[role="dialog"],[aria-modal="true"],.layui-layer,.layui-layer-dialog,.layui-layer-content,.modal,.modal-dialog,.el-dialog__wrapper,.el-dialog,.el-message-box__wrapper,.el-message-box,.placeLoad-row,.openAlert';
  const visibleModals = () => [...document.querySelectorAll(modalSelector)].filter(visible);
  const downloadDialogs = () => [...document.querySelectorAll(".loadSave-row")].filter(visible)
    .filter((dialog) => {
      const table = dialog.querySelector("table#downloadList");
      if (!table || !visible(table)) return false;
      const header = [...(table.querySelector("tr")?.querySelectorAll("th,td") || [])].map(textOf);
      return /^(请求时间|创建时间)$/.test(header[0] || "") &&
        header[1] === "文件名" && header[2] === "下载状态" && header[3] === "操作";
    });
  const downloadPageControl = (dialog, label) => {
    const controls = [...dialog.querySelectorAll('a,button,[role="button"],span#first,span#prev,span#next,span#last')].filter(visible)
      .filter((element) => normalize(textOf(element)) === label && !element.disabled &&
        element.getAttribute("aria-disabled") !== "true" && !element.classList.contains("disabled"));
    return controls.length === 1 ? controls[0] : null;
  };
  const submitMessagePattern = /申请已提交|超过\s*\d+\s*条|申请失败|导出失败|系统异常/;
  const submitMessageVisible = () => visibleModals().some((dialog) => submitMessagePattern.test(textOf(dialog)));
  const messageTexts = () => [...new Set([
    ...visibleModals().map(textOf),
    textOf(document.body)
  ].filter(Boolean))];
  const classifySubmit = () => {
    const messages = messageTexts();
    const accepted = messages.filter((text) => /申请已提交/.test(text));
    if (accepted.length) {
      const files = [...new Set(visibleModals().map(textOf).filter((text) => /申请已提交/.test(text)).flatMap((text) => text.match(/[A-Z0-9]+_MX_\d{14}(?:_[^\s<>"\']+)?\.xlsx/gi) || []))];
      return { status: "accepted", fileName: files.length === 1 ? files[0] : null };
    }
    if (messages.some((text) => /超过\s*\d+\s*条.*(?:未处理|处理中的导出文件)/.test(text))) {
      return { status: "throttled" };
    }
    if (messages.some((text) => /(?:申请失败|导出失败|系统异常)/.test(text))) {
      return { status: "failed", message: messages.find((text) => /(?:申请失败|导出失败|系统异常)/.test(text)) };
    }
    return { status: "unknown" };
  };
  const downloadEnabled = (row) => {
    const controls = [...row.querySelectorAll('a,button,[role="button"],div.pwedDown')]
      .filter((element) => normalize(textOf(element)) === "下载");
    if (controls.length !== 1) return null;
    const element = controls[0];
    return !element.disabled && element.getAttribute("aria-disabled") !== "true" &&
      !element.classList.contains("is-disabled") && !element.closest(".is-disabled");
  };
  const scanDownloadTasks = () => {
    const dialogs = downloadDialogs();
    if (dialogs.length !== 1) {
      return { status: "not_found", rows: [] };
    }
    const dialog = dialogs[0];
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
    const visibleText = textOf(dialog);
    const rows = [...dialog.querySelectorAll("table tr")]
      .filter(visible)
      .map((row) => ({
        element: row,
        cells: [...row.querySelectorAll("th,td")].map((cell) => clean(cell.innerText || cell.textContent, 240))
      }))
      .filter(({ cells }) => cells.length >= 4 && /\.xlsx$/i.test(cells[1] || ""))
      .map(({ element, cells }) => {
        const status = cells[2] || "";
        return {
          createdAt: cells[0] || "",
          fileName: cells[1] || "",
          status,
          statusCode: ["排队中", "生成中"].includes(status) ? "pending" : status === "已生成" ? "ready" : /^(?:处理失败|生成失败|导出失败)$/.test(status) ? "failed" : "unknown",
          downloadEnabled: downloadEnabled(element)
        };
      });
    const totalMatch = visibleText.match(/共\s*(\d+)\s*条/);
    const pageElement = dialog.querySelector(".el-pagination .number.active,.layui-laypage-curr em,[aria-current=page]");
    const pageMatch = visibleText.match(/第\s*(\d+)\s*页\s*\/\s*第\s*(\d+)\s*页/);
    const nextButton = dialog.querySelector(".el-pagination .btn-next,.layui-laypage-next,[aria-label='下一页']") ||
      downloadPageControl(dialog, "下一页");
    const hasNext = nextButton
      ? !nextButton.disabled && nextButton.getAttribute("aria-disabled") !== "true" && !nextButton.classList.contains("disabled") &&
        (!pageMatch || Number(pageMatch[1]) < Number(pageMatch[2]))
      : false;
    return {
      status: rows.length ? "found" : "empty",
      total: totalMatch ? Number(totalMatch[1]) : null,
      page: pageMatch ? Number(pageMatch[1]) : pageElement ? Number(clean(pageElement.innerText || pageElement.textContent, 20)) || 1 : 1,
      hasNext,
      rowCount: rows.length,
      rows: rows.slice(0, 50)
    };
  };

  const dispatchValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
  };

  globalThis.__chinaumsAccountDetailAdapter = async (operation, args = {}) => {
    if (!onReportPage() && !(operation === "parseDownloadTasks" && hasDownloadList()) &&
      !(operation === "downloadTask" && hasDownloadList()) &&
      !(operation === "nextDownloadPage" && hasDownloadList()) &&
      !(operation === "selectDownloadPage" && hasDownloadList())) {
      return { status: "wrong_page", reason: "当前不是对账明细查询页或可识别的下载暂存列表。" };
    }

    switch (operation) {
      case "submitDialogState":
        return { status: visibleModals().filter((dialog) => textOf(dialog)).length === 0 ? "clear" : "visible" };
      case "inspect": {
        const dateField = field();
        return {
          status: dateField.error ? "controls_missing" : "ready",
          dateValue: dateField.input?.value ?? null,
          hasQuery: Boolean(queryControl()),
          hasExport: Boolean(exportControl()),
          hasDownloadList: [...document.querySelectorAll("button#download")].filter(visible)
            .filter((element) => !element.disabled).length === 1,
        };
      }
      case "setDateRange": {
        const dateField = field();
        if (dateField.error) return { status: "failed", reason: dateField.error };
        const { start, end } = args;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start || "") || !/^\d{4}-\d{2}-\d{2}$/.test(end || "")) {
          return { status: "failed", reason: "日期参数必须是 YYYY-MM-DD。" };
        }
        const format = (value) => value.replace(/-/g, "/");
        const value = `${format(start)} ~ ${format(end)}`;
        dispatchValue(dateField.input, value);
        if (normalize(dateField.input.value) !== normalize(value)) {
          return { status: "failed", reason: "清算时间输入框未保留目标日期，未继续查询。" };
        }
        finishQueryObservation();
        queryTracker = null;
        return { status: "set", value };
      }
      case "query": {
        if (visibleModals().filter((dialog) => textOf(dialog)).length > 0) return { status: "blocked", reason: "弹窗尚未关闭，不启动下一次查询。" };
        const control = queryControl();
        if (!control) return { status: "controls_missing", reason: "“查询”按钮缺失或不唯一。" };
        const dateField = field();
        if (dateField.error || !dateField.input.value.trim()) {
          return { status: "failed", reason: dateField.error || "清算时间为空，未提交查询。" };
        }
        if (!/^\d{4}\/\d{2}\/\d{2}\s~\s\d{4}\/\d{2}\/\d{2}$/.test(dateField.input.value.trim())) {
          return { status: "failed", reason: "清算时间格式不符合页面要求（yyyy/MM/dd ~ yyyy/MM/dd），未提交查询。" };
        }
        finishQueryObservation();
        queryTracker = {
          dateValue: dateField.input.value,
          baseline: resultSignature(),
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
        const dateField = field();
        if (dateField.error || dateField.input.value !== queryTracker.dateValue) {
          finishQueryObservation();
          return { status: "failed", reason: "查询期间清算时间发生变化或无法确认。" };
        }
        if (queryBusy()) {
          queryTracker.candidate = null;
          queryTracker.observedLoading = true;
          return { status: "waiting" };
        }
        if (!queryTracker.observedLoading && resultSignature() === queryTracker.baseline) {
          return { status: "waiting" };
        }
        const signature = resultSignature();
        if (queryTracker.candidate !== signature) {
          queryTracker.candidate = signature;
          queryTracker.candidateSince = Date.now();
          return { status: "waiting" };
        }
        if (Date.now() - queryTracker.candidateSince < 500) return { status: "waiting" };
        const bodyText = textOf(document.body);
        const match = bodyText.match(/根据输入条件共查询到\s*([\d,]+)\s*条/);
        if (match) {
          const count = Number(match[1].replace(/,/g, ""));
          if (count === 0) {
            queryTracker.resultState = "no_data";
            finishQueryObservation();
            return { status: "no_data", count };
          }
          const currentResult = JSON.parse(signature);
          if (currentResult.tableRows.length > 0 && exportControl()) {
            const expectedMerchantNo = normalize(args.targetMerchantNo);
            const merchantNumbers = queryResultMerchantNumbers();
            if (merchantNumbers.length !== 1) {
              const reason = merchantNumbers.length === 0
                ? "查询结果中未读取到商户号"
                : `查询结果中出现多个商户号（${merchantNumbers.join("、")}）`;
              finishQueryObservation();
              return { status: "failed", reason: `${reason}，未申请导出。` };
            }
            const actualMerchantNo = merchantNumbers[0];
            if (expectedMerchantNo && actualMerchantNo !== expectedMerchantNo) {
              finishQueryObservation();
              return {
                status: "failed",
                reason: `当前查询结果商户号 ${actualMerchantNo} 与本次已确认商户号 ${expectedMerchantNo} 不一致，未申请导出。`
              };
            }
            queryTracker.merchantNo = actualMerchantNo;
            queryTracker.resultState = "ready";
            finishQueryObservation();
            return { status: "ready", count, merchantNo: actualMerchantNo };
          }
        }
        return { status: "waiting" };
      }
      case "submitExport": {
        if (visibleModals().filter((dialog) => textOf(dialog)).length > 0) return { status: "blocked", reason: "弹窗尚未关闭，不申请导出。" };
        const gate = args.gate;
        if (gate?.allowed !== true || normalize(gate.merchantNo) !== normalize(args.targetMerchantNo) ||
          queryTracker?.merchantNo !== normalize(args.targetMerchantNo) || !args.targetMerchantNo) {
          return { status: "blocked", reason: "当前查询结果商户号尚未确认或与本轮商户号不一致，不允许申请导出。" };
        }
        const control = exportControl();
        if (!control || queryTracker?.resultState !== "ready" || !/根据输入条件共查询到/.test(textOf(document.body))) {
          return { status: "blocked", reason: "查询结果未就绪或 XLSX 申请入口不唯一。" };
        }
        const prepared = buildExportPayload(control);
        if (prepared.error) return { status: "blocked", reason: prepared.error };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        try {
          const response = await fetch("/uisportal/accountCheckDetailQry/downDeailBill", {
            method: "POST",
            credentials: "same-origin",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              "X-Requested-With": "XMLHttpRequest"
            },
            body: prepared.payload.toString(),
            signal: controller.signal
          });
          if (!response.ok) return { status: "unknown", reason: `提交接口 HTTP ${response.status}。` };
          return classifyExportResponse(await response.json());
        } catch (error) {
          return { status: "unknown", reason: error?.name === "AbortError" ? "提交接口 12 秒内未返回。" : error?.message || "提交接口调用失败。" };
        } finally {
          clearTimeout(timer);
        }
      }
      case "classifySubmit":
        return classifySubmit();
      case "closeSubmitDialog": {
        const result = classifySubmit();
        if (visibleModals().filter((dialog) => textOf(dialog)).length === 0) return { status: "closed" };
        if (!["accepted", "throttled", "failed"].includes(result.status)) {
          return { status: "blocked", reason: "没有可安全关闭的已识别提交提示。" };
        }
        const submitModals = visibleModals().filter((dialog) => submitMessagePattern.test(textOf(dialog)));
        const closeLabels = result.status === "accepted" ? ["关闭"] : ["关闭", "确定", "确认"];
        const normalizedLabels = closeLabels.map(normalize);
        const matchingMessageNodes = [...document.querySelectorAll("*")]
          .filter(visible)
          .filter((element) => submitMessagePattern.test(textOf(element)));
        const messageLeaves = matchingMessageNodes.filter((element) =>
          ![...element.children].some((child) => visible(child) && submitMessagePattern.test(textOf(child)))
        );
        const messageRoots = messageLeaves.map((message) => {
          let ancestor = message;
          for (let depth = 0; ancestor && depth < 12; depth += 1, ancestor = ancestor.parentElement) {
            const ancestorText = normalize(textOf(ancestor));
            if (submitMessagePattern.test(textOf(ancestor)) && normalizedLabels.some((label) => ancestorText.includes(label))) {
              return ancestor;
            }
          }
          return null;
        }).filter(Boolean);
        const submitRoots = [...new Set([...submitModals, ...messageRoots])];
        const findTextTargets = (roots) => [...new Set(roots.flatMap((root) => [root, ...root.querySelectorAll("*")]))]
          .filter(visible)
          .filter((element) => normalizedLabels.includes(normalize(textOf(element))))
          .filter((element) => ![...element.children].some((child) =>
            visible(child) && normalizedLabels.includes(normalize(textOf(child)))
          ));
        const findCloseIcons = (roots) => {
          const candidates = [...new Set(roots.flatMap((dialog) => [
            ...dialog.querySelectorAll(".layui-layer-close,.layui-layer-setwin a,button.el-dialog__headerbtn,.el-dialog__close,[aria-label='关闭'],[aria-label='Close'],[title='关闭'],[title='Close']")
          ]))].filter(visible);
          const controls = candidates.filter((element) => element.matches("button,a,[role=button],[onclick]"));
          return controls.length ? controls : candidates;
        };
        const scopedTextMatches = findTextTargets(submitRoots);
        const pageTextMatches = findTextTargets([document.body]);
        const modalControls = exactControls("button,a,[role=button],[onclick],.layui-layer-btn a,.layui-layer-btn0", "关闭")
          .filter((element) => submitRoots.some((dialog) => dialog.contains(element)));
        const pageControls = closeLabels.flatMap((label) =>
          exactControls("button,a,[role=button],[onclick],.layui-layer-btn a,.layui-layer-btn0", label)
        );
        let matches = scopedTextMatches.length ? scopedTextMatches : modalControls;
        if (!matches.length) matches = pageTextMatches.length ? pageTextMatches : pageControls;
        if (matches.length !== 1) {
          const closeIcons = findCloseIcons(submitRoots);
          if (closeIcons.length === 1) matches = closeIcons;
        }
        if (matches.length !== 1) return { status: "blocked", reason: "提交提示中的关闭按钮缺失或不唯一。" };
        matches[0].click();
        const waitForNoticeToClose = async (milliseconds) => {
          const deadline = Date.now() + milliseconds;
          while (submitMessageVisible() && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return !submitMessageVisible();
        };
        if (!await waitForNoticeToClose(2500)) {
          const currentModals = visibleModals().filter((dialog) => submitMessagePattern.test(textOf(dialog)));
          const fallbackRoots = [...new Set([...currentModals, ...submitRoots])];
          const fallbackIcons = findCloseIcons(fallbackRoots);
          if (fallbackIcons.length === 1) fallbackIcons[0].click();
          if (!await waitForNoticeToClose(1500)) {
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, which: 27, bubbles: true }));
            await waitForNoticeToClose(1500);
          }
        }
        if (submitMessageVisible()) {
          return { status: "clicked_but_still_visible", reason: "点击关闭按钮和弹窗右上角后提示仍显示。" };
        }
        return { status: "closed" };
      }
      case "openDownloadList": {
        if (hasDownloadList()) return { status: "already_open" };
        const deadline = Date.now() + 5000;
        let matches = [];
        while (Date.now() < deadline) {
          if (hasDownloadList()) return { status: "already_open" };
          matches = [...document.querySelectorAll("button#download")].filter(visible);
          if (matches.length > 1) return { status: "blocked", reason: "可见的下载暂存列表入口不唯一。" };
          if (matches.length === 1 && !matches[0].disabled) {
            beginDownloadRefresh();
            matches[0].click();
            return { status: "clicked" };
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return { status: "controls_missing", reason: `等待 5 秒后，下载暂存列表入口仍不可用（可见 ${matches.length} 个，禁用 ${Boolean(matches[0]?.disabled)}）。` };
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
          const targetTaskIds = new Set((Array.isArray(args.taskIds) ? args.taskIds : [])
            .map((id) => String(id || "")).filter(Boolean));
          const rows = [];
          for (let page = 1; page <= 100; page += 1) {
            checkDeadline();
            const response = await fetch(`/uisportal/accountCheckDetailQry/selectDeailBillList?page.size=100&page=${page}`, { signal: controller.signal });
            checkDeadline();
            if (!response.ok) throw new Error("读取对账暂存任务失败。");
            const data = await response.json();
            checkDeadline();
            if (data.respCode !== "000000" || !Array.isArray(data.list?.content)) throw new Error("对账暂存接口结构异常。");
            rows.push(...data.list.content.map((row) => {
              const taskStatus = String(row.task_status || "");
              return {
                id: String(row.export_id || ""),
                fileName: String(row.file_name || ""),
                taskStatus,
                statusCode: taskStatus === "30" ? "ready" : "pending"
              };
            }));
            if (rows.some((row) => !row.id || !row.fileName) || new Set(rows.map((row) => row.id)).size !== rows.length) {
              throw new Error("对账暂存任务身份缺失或重复。");
            }
            if (targetTaskIds.size && [...targetTaskIds].every((id) => rows.some((row) => row.id === id))) {
              return { status: "found", rows: rows.filter((row) => targetTaskIds.has(row.id)) };
            }
            if (page >= Number(data.list.totalPages)) {
              if (!targetTaskIds.size && rows.length !== Number(data.list.totalElements)) throw new Error("对账暂存任务分页不完整。");
              return { status: "found", rows: targetTaskIds.size ? rows.filter((row) => targetTaskIds.has(row.id)) : rows };
            }
          }
          throw new Error("对账暂存任务页数超出读取范围。");
        } finally {
          clearTimeout(timer);
        }
      }
      case "parseDownloadTasks":
        return scanDownloadTasks();
      case "setDownloadPageSize": {
        const dialogs = downloadDialogs();
        if (dialogs.length !== 1) return { status: "unavailable" };
        const selects = [...dialogs[0].querySelectorAll("select.page-size-select")].filter(visible);
        if (selects.length !== 1 || selects[0].disabled) return { status: "unavailable" };
        const select = selects[0];
        const option = [...select.options].find((item) => !item.disabled && item.text.trim() === "20");
        if (!option) return { status: "unavailable" };
        if (select.value === option.value) return { status: "unchanged" };
        beginDownloadRefresh();
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return { status: "set", size: 20 };
      }
      case "closeDownloadList": {
        const dialogMatches = downloadDialogs();
        if (dialogMatches.length === 0) { downloadRefresh?.observer?.disconnect(); downloadRefresh = null; return { status: "already_closed" }; }
        if (dialogMatches.length !== 1) return { status: "blocked", reason: "下载暂存列表弹窗不唯一，未关闭。" };
        const dialog = dialogMatches[0];
        const candidates = [...new Set([
          ...dialog.querySelectorAll(".placeLoad-header .close-Load"),
          ...exactControls("button,a,[role=button]", "关闭").filter((element) => dialog.contains(element))
        ])].filter(visible);
        if (candidates.length !== 1) return { status: "blocked", reason: "下载暂存列表右上角关闭控件缺失或不唯一。" };
        candidates[0].click();
        downloadRefresh?.observer?.disconnect();
        downloadRefresh = null;
        return { status: "closed" };
      }
      case "nextDownloadPage": {
        const dialogs = downloadDialogs();
        if (dialogs.length !== 1 || !scanDownloadTasks().hasNext) return { status: "end" };
        const next = [...dialogs[0].querySelectorAll(".el-pagination .btn-next,.layui-laypage-next,[aria-label='下一页']")]
          .filter(visible)
          .filter((element) => !element.disabled && element.getAttribute("aria-disabled") !== "true" && !element.classList.contains("disabled"));
        if (!next.length) {
          const nativeNext = downloadPageControl(dialogs[0], "下一页");
          if (nativeNext) next.push(nativeNext);
        }
        if (next.length !== 1) return { status: "end" };
        beginDownloadRefresh();
        next[0].click();
        return { status: "clicked" };
      }
      case "selectDownloadPage": {
        const current = scanDownloadTasks();
        if (Number(current.page) === Number(args.page)) return { status: "already_current" };
        const dialogs = downloadDialogs();
        if (dialogs.length !== 1 || !Number.isInteger(args.page) || args.page < 1) return { status: "unavailable" };
        const matches = [...dialogs[0].querySelectorAll(".el-pagination .number,.layui-laypage a,[aria-label]")]
          .filter(visible)
          .filter((element) => clean(element.innerText || element.textContent || element.getAttribute("aria-label"), 20) === String(args.page));
        if (matches.length === 1) { beginDownloadRefresh(); matches[0].click(); return { status: "clicked" }; }
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
          const current = scanDownloadTasks();
          if (!["found", "empty"].includes(current.status)) {
            await new Promise((resolve) => setTimeout(resolve, 200));
            continue;
          }
          const page = current.page;
          if (page === args.page) return { status: "clicked" };
          const label = args.page === 1 ? "首页" : page < args.page ? "下一页" : "上一页";
          const control = downloadPageControl(dialogs[0], label);
          if (!control) return { status: "unavailable" };
          beginDownloadRefresh();
          control.click();
          while (Date.now() < deadline && scanDownloadTasks().page === page) {
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }
        return { status: "unavailable" };
      }
      case "downloadTask": {
        if (downloadRefresh && scanDownloadTasks().status !== "found") return { status: "not_ready", reason: "暂存列表刷新尚未完成。" };
        if (!downloadGateAllowed(args)) return { status: "blocked", reason: "商户门禁未通过，不允许下载。" };
        if (!new RegExp(`^${args.targetMerchantNo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_MX_\\d{14}(?:_[^.]*)?\\.xlsx$`, "i").test(args.fileName || "")) {
          return { status: "blocked", reason: "文件名中的商户号与当前目标不符。" };
        }
        const dialogs = downloadDialogs();
        if (dialogs.length !== 1) return { status: "not_found" };
        const matches = [...dialogs[0].querySelectorAll("table tr")]
          .filter(visible)
          .filter((row) => [...row.querySelectorAll("td")].some((cell) => clean(cell.innerText || cell.textContent, 240) === args.fileName));
        if (matches.length !== 1) return { status: "unknown", reason: "目标文件行缺失或不唯一。" };
        const cells = [...matches[0].querySelectorAll("td")];
        const status = clean(cells[2]?.innerText || cells[2]?.textContent, 80);
        if (status !== "已生成" || downloadEnabled(matches[0]) !== true) {
          return { status: "not_ready", reason: "任务尚未生成或下载控件不可用。" };
        }
        const control = [...matches[0].querySelectorAll('a,button,[role="button"],div.pwedDown')]
          .filter((element) => normalize(textOf(element)) === "下载");
        if (control.length !== 1) return { status: "unknown", reason: "任务行中的下载按钮缺失或不唯一。" };
        control[0].click();
        return { status: "download_requested" };
      }
      default:
        return { status: "unknown_operation" };
    }
  };
})();

