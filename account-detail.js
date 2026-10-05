(() => {
  const ROUTE = "/uisportal/accountCheckDetailQry/toDetail";
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
  const textOf = (element) => clean(element?.innerText || element?.textContent, 4000);
  const exactControls = (selector, expected) => [...document.querySelectorAll(selector)]
    .filter(visible)
    .filter((element) => normalize(textOf(element)) === normalize(expected));
  const onReportPage = () => location.hostname === "service.chinaums.com" && location.pathname === ROUTE;
  const hasDownloadList = () => downloadDialogs().length === 1;
  const downloadGateAllowed = (args) => args.gate?.allowed === true &&
    normalize(args.gate.merchantNo) === normalize(args.targetMerchantNo) && Boolean(args.targetMerchantNo);
  const QUERY_DEFAULTS = [
    ["settDateBegin", ""], ["settDateEnd", ""], ["pageSize", "5"], ["dealDateBegin", ""],
    ["dealDateEnd", ""], ["transStatus", "1"], ["dealType", ""], ["busiTypeIdList", ""],
    ["fdId", ""], ["zdCode", ""], ["amount1", ""], ["amount2", ""], ["fkhNo", ""],
    ["bankCardNo1", ""], ["bankCardNo2", ""], ["dealMode", ""], ["bingJieFlag", ""],
    ["refNum", ""], ["merOrderId", ""], ["bankOrder", ""], ["searchNo", ""], ["searchObj", "1"]
  ];
  const baseQueryParams = () => new URLSearchParams(QUERY_DEFAULTS);
  const compactDate = (value) => {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return `${match[1]}${match[2]}${match[3]}`;
  };
  const buildQueryPayload = (pageNumber) => {
    if (!queryTracker?.beginSettDate || !queryTracker?.endSettDate) {
      return { error: "查询日期尚未安全设置。" };
    }
    const payload = baseQueryParams();
    payload.set("settDateBegin", queryTracker.beginSettDate);
    payload.set("settDateEnd", queryTracker.endSettDate);
    payload.set("pageNumber", String(pageNumber));
    return { payload, pageSize: 5 };
  };
  const readAccountQuery = async (deadline) => {
    const first = buildQueryPayload(1);
    if (first.error) throw new Error(first.error);
    const rows = [];
    let totalPages = null;
    let totalElements = null;
    for (let pageNumber = 1; ; pageNumber += 1) {
      if (Date.now() >= deadline) throw new Error("对账明细查询已超过截止时间。");
      const built = buildQueryPayload(pageNumber);
      if (built.error) throw new Error(built.error);
      if (built.pageSize !== first.pageSize) throw new Error("对账明细查询页大小发生变化。");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()));
      let response;
      try {
        response = await fetch("/uisportal/accountCheckDetailQry/qryAccountCheck", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
          },
          body: built.payload.toString(),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }
      if (!response?.ok) throw new Error(`对账明细查询接口 HTTP ${response?.status ?? "unknown"}。`);
      const data = await response.json();
      if (String(data?.respCode ?? "") !== "000000" || !Array.isArray(data?.pageObj?.content)) {
        throw new Error("对账明细查询接口结构异常。");
      }
      const page = data.pageObj;
      const currentPages = Number(page.totalPages);
      const currentTotal = Number(page.totalElements);
      const number = Number(page.number);
      const size = Number(page.size);
      if (!Number.isInteger(currentPages) || currentPages < 0 ||
        !Number.isInteger(currentTotal) || currentTotal < 0 ||
        number !== pageNumber - 1 || size !== first.pageSize) {
        throw new Error("对账明细查询分页信息异常。");
      }
      totalPages ??= currentPages;
      totalElements ??= currentTotal;
      if (currentPages !== totalPages || currentTotal !== totalElements) {
        throw new Error("对账明细查询总页数或总条数在分页读取过程中发生变化。");
      }
      rows.push(...page.content);
      if (currentTotal === 0) {
        if (pageNumber !== 1 || page.content.length !== 0) throw new Error("对账明细空查询分页结构异常。");
        break;
      }
      if (currentPages < 1 || pageNumber > currentPages) throw new Error("对账明细查询页数异常。");
      if (pageNumber >= currentPages) break;
    }
    if (rows.length !== totalElements ||
      new Set(rows.map((row) => JSON.stringify(row))).size !== rows.length ||
      rows.some((row) => !row?.mer_no || !/^\d{8}$/.test(String(row.sett_date || ""))) ||
      rows.some((row) => String(row.sett_date) < queryTracker.beginSettDate ||
        String(row.sett_date) > queryTracker.endSettDate)) {
      throw new Error("对账明细查询结果分页不完整或身份异常。");
    }
    const merchants = [...new Set(rows.map((row) => normalize(row.mer_no)).filter(Boolean))];
    if (totalElements > 0 && merchants.length !== 1) {
      throw new Error("对账明细查询结果没有唯一商户号；未申请导出。");
    }
    return { count: totalElements, merchantNo: merchants[0] || null };
  };

  const buildExportPayload = () => {
    if (!queryTracker?.beginSettDate || !queryTracker?.endSettDate) {
      return { error: "已确认查询日期缺失。" };
    }
    const payload = baseQueryParams();
    payload.set("settDateBegin", queryTracker.beginSettDate);
    payload.set("settDateEnd", queryTracker.endSettDate);
    payload.set("fileExt", "xlsx");
    payload.set("regularFee", "");
    payload.set("d", "");
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
  globalThis.__chinaumsAccountDetailAdapter = async (operation, args = {}) => {
    if (!onReportPage()) {
      return { status: "wrong_page", reason: "当前不是对账明细查询页。" };
    }

    switch (operation) {
      case "submitDialogState":
        return { status: visibleModals().filter((dialog) => textOf(dialog)).length === 0 ? "clear" : "visible" };
      case "inspect": {
        const apiReady = typeof fetch === "function";
        return {
          status: apiReady ? "ready" : "controls_missing",
          reason: apiReady ? null : "对账明细查询接口不可用。",
          hasQuery: apiReady,
          downloadListOpen: hasDownloadList()
        };
      }
      case "setDateRange": {
        const beginSettDate = compactDate(args.start);
        const endSettDate = compactDate(args.end);
        if (!beginSettDate || !endSettDate || beginSettDate > endSettDate) {
          return { status: "failed", reason: "日期参数无效。" };
        }
        queryTracker = {
          beginSettDate,
          endSettDate,
          resultState: "set",
          count: null,
          merchantNo: null,
          reason: null
        };
        return { status: "set", beginSettDate, endSettDate };
      }
      case "query": {
        if (visibleModals().filter((dialog) => textOf(dialog)).length > 0) {
          return { status: "blocked", reason: "弹窗尚未关闭，不启动下一次查询。" };
        }
        if (!queryTracker?.beginSettDate || !queryTracker?.endSettDate) {
          return { status: "failed", reason: "查询日期尚未安全设置。" };
        }
        queryTracker.resultState = "querying";
        try {
          const result = await readAccountQuery(args.operationDeadline ?? Date.now() + 60000);
          Object.assign(queryTracker, result.count === 0
            ? { resultState: "no_data", count: 0, merchantNo: null, reason: null }
            : { resultState: "ready", count: result.count, merchantNo: result.merchantNo,
              filterSignature: result.filterSignature, reason: null });
        } catch (error) {
          Object.assign(queryTracker, {
            resultState: "failed",
            count: null,
            merchantNo: null,
            reason: error?.name === "AbortError" ? "对账明细查询接口在截止时间前未完成。" :
              error?.message || "对账明细查询接口调用失败。"
          });
        }
        return { status: "clicked", source: "api" };
      }
      case "queryState": {
        if (!queryTracker || ["set", "querying"].includes(queryTracker.resultState)) return { status: "waiting" };
        if (queryTracker.resultState === "failed") {
          return { status: "failed", reason: queryTracker.reason || "对账明细查询失败。" };
        }
        if (queryTracker.resultState === "no_data") return { status: "no_data", count: 0 };
        if (queryTracker.resultState === "ready") {
          const expectedMerchantNo = normalize(args.targetMerchantNo);
          if (expectedMerchantNo && queryTracker.merchantNo !== expectedMerchantNo) {
            return { status: "failed", reason: "当前查询结果商户号与本轮已确认商户号不一致，未申请导出。" };
          }
          return { status: "ready", count: queryTracker.count, merchantNo: queryTracker.merchantNo };
        }
        return { status: "failed", reason: "对账明细查询结果状态无法识别。" };
      }
      case "submitExport": {
        if (visibleModals().filter((dialog) => textOf(dialog)).length > 0) return { status: "blocked", reason: "弹窗尚未关闭，不申请导出。" };
        const gate = args.gate;
        if (gate?.allowed !== true || normalize(gate.merchantNo) !== normalize(args.targetMerchantNo) ||
          queryTracker?.merchantNo !== normalize(args.targetMerchantNo) || !args.targetMerchantNo ||
          queryTracker?.resultState !== "ready" || !Number.isInteger(queryTracker.count) || queryTracker.count <= 0) {
          return { status: "blocked", reason: "当前查询结果商户号尚未确认或与本轮商户号不一致，不允许申请导出。" };
        }
        const verifyDeadline = Math.min(
          (args.operationDeadline ?? Date.now() + 60000) - 12000,
          Date.now() + 45000
        );
        if (verifyDeadline <= Date.now()) {
          return { status: "blocked", reason: "提交前商户接口复核没有剩余安全时间。" };
        }
        let verified;
        try {
          verified = await readAccountQuery(verifyDeadline);
        } catch (error) {
          return { status: "blocked", reason: `提交前接口复核失败：${error?.message || "查询身份无法确认"}` };
        }
        if (verified.count <= 0 || verified.count !== queryTracker.count ||
          verified.merchantNo !== queryTracker.merchantNo ||
          verified.merchantNo !== normalize(args.targetMerchantNo)) {
          return { status: "blocked", reason: "提交前接口复核发现商户或数据状态已变化；未申请导出。" };
        }
        const prepared = buildExportPayload();
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
                createdAt: String(row.apply_date || ""),
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
      case "closeDownloadList": {
        const dialogMatches = downloadDialogs();
        if (dialogMatches.length === 0) return { status: "already_closed" };
        if (dialogMatches.length !== 1) return { status: "blocked", reason: "下载暂存列表弹窗不唯一，未关闭。" };
        const dialog = dialogMatches[0];
        const candidates = [...new Set([
          ...dialog.querySelectorAll(".placeLoad-header .close-Load"),
          ...exactControls("button,a,[role=button]", "关闭").filter((element) => dialog.contains(element))
        ])].filter(visible);
        if (candidates.length !== 1) return { status: "blocked", reason: "下载暂存列表右上角关闭控件缺失或不唯一。" };
        candidates[0].click();
        return { status: "closed" };
      }
      case "downloadTaskDirect": {
        if (!downloadGateAllowed(args)) return { status: "blocked", reason: "商户门禁未通过，不允许下载。" };
        const fileMatch = String(args.fileName || "").match(/^([A-Z0-9]+)_MX_\d{14}(?:_[^.]*)?\.xlsx$/i);
        if (!fileMatch || normalize(fileMatch[1]) !== normalize(args.targetMerchantNo)) {
          return { status: "blocked", reason: "文件名中的商户号与当前目标不符。" };
        }
        const taskId = String(args.taskId || "");
        if (!/^[0-9a-f]{32}$/i.test(taskId)) {
          return { status: "blocked", reason: "暂存任务 ID 格式无效。" };
        }
        const frame = document.createElement("iframe");
        frame.hidden = true;
        frame.setAttribute("aria-hidden", "true");
        frame.src = `/uisportal/commonController/exportDeailBill?exportId=${encodeURIComponent(taskId)}`;
        document.body.append(frame);
        setTimeout(() => frame.remove(), 60000);
        return { status: "download_requested" };
      }
      default:
        return { status: "unknown_operation" };
    }
  };
})();

