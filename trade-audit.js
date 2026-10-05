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

  const modalOpen = (dialog) => {
    const wrapper = dialog.closest?.(".el-message-box__wrapper,.el-dialog__wrapper");
    const component = [dialog.__vue__, wrapper?.__vue__, wrapper?.__vue__?.$parent]
      .find((candidate) => typeof candidate?.visible === "boolean");
    return typeof component?.visible === "boolean" ? component.visible : visible(dialog);
  };
  const waitForModalClose = (isClosed, operationDeadline) => new Promise((resolve) => {
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
    const deadline = Math.min(Date.now() + 8000, operationDeadline ?? Infinity);
    timer = setTimeout(() => finish(isClosed()), Math.max(0, deadline - Date.now()));
    if (isClosed()) finish(true);
  });
  const dialogTexts = () => [...document.querySelectorAll(
    '[role="dialog"],[aria-modal="true"],.el-message-box,.el-dialog'
  )]
    .filter(modalOpen)
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
  const tradePost = async (endpoint, payload, deadline) => {
    const userPortalToken = localStorage.getItem("userPortalVerifyToken");
    if (!userPortalToken) throw new Error("页面登录令牌不可用。");
    if (Date.now() >= deadline) throw new Error("以旧换新接口调用已超过截止时间。");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()));
    try {
      const response = await fetch(`/uisportal/api/uis-tradein-server/portal/yjhx/v3/${endpoint}`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          userPortalToken
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!response?.ok) throw new Error(`以旧换新接口 HTTP ${response?.status ?? "unknown"}。`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  };
  const readQueryList = async (beginTransDate, endTransDate, deadline) => {
    const checkDeadline = () => {
      if (Date.now() >= deadline) throw new Error("以旧换新查询已超过截止时间。");
    };
    const rows = [];
      let expectedTotal = null;
      let expectedPages = null;
      for (let current = 0; ; current += 1) {
        checkDeadline();
        const response = await tradePost("queryList", {
          merOrderId: "",
          transRef: "",
          status: [],
          beginTransDate,
          endTransDate,
          current,
          size: 10
        }, deadline);
        checkDeadline();
        if (response?.success !== true || String(response.code ?? "") !== "000000" ||
          !Array.isArray(response.data?.list)) {
          throw new Error("以旧换新查询接口结构异常。");
        }
        const page = response.data;
        const total = Number(page.total);
        const pages = Number(page.pages);
        const size = Number(page.size);
        const returnedCurrent = Number(page.current);
        if (!Number.isInteger(total) || total < 0 || !Number.isInteger(pages) || pages < 0 ||
          size !== 10 || returnedCurrent !== current) {
          throw new Error("以旧换新查询分页信息异常。");
        }
        expectedTotal ??= total;
        expectedPages ??= pages;
        if (total !== expectedTotal || pages !== expectedPages) {
          throw new Error("以旧换新查询分页总数在读取过程中发生变化。");
        }
        rows.push(...page.list);
        if (total === 0) {
          if (current !== 0 || page.list.length !== 0) throw new Error("以旧换新空查询分页结构异常。");
          break;
        }
        if (pages < 1 || current >= pages) throw new Error("以旧换新查询页数异常。");
        if (current + 1 >= pages) break;
      }
      if (rows.length !== expectedTotal ||
        rows.some((row) => !row?.id || !row?.mchntId || !/^\d{8}$/.test(String(row.transDate || ""))) ||
        new Set(rows.map((row) => String(row.id))).size !== rows.length ||
        rows.some((row) => String(row.transDate) < beginTransDate || String(row.transDate) > endTransDate)) {
        throw new Error("以旧换新查询结果分页不完整或身份异常。");
      }
      const merchants = [...new Set(rows.map((row) => normalize(row.mchntId)).filter(Boolean))];
      if (expectedTotal > 0 && merchants.length !== 1) {
        throw new Error("查询结果没有唯一商户身份；未申请导出。");
      }
      return { count: expectedTotal, merchantId: merchants[0] || null };
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

  globalThis.__chinaumsTradeAuditAdapter = async (operation, args = {}) => {
    if (!onReportPage()) return { status: "wrong_page", reason: "当前不是以旧换新采集2026业务 frame。" };

    switch (operation) {
      case "submitDialogState":
        return { status: dialogTexts().length === 0 ? "clear" : "visible" };
      case "inspect": {
        const apiReady = typeof fetch === "function";
        return {
          status: apiReady ? "ready" : "controls_missing",
          reason: apiReady ? null : "以旧换新查询接口不可用。",
          hasQuery: apiReady,
          downloadListOpen: downloadDialogs().length > 0,
          count: Number.isInteger(queryTracker?.count) ? queryTracker.count : null
        };
      }
      case "setDateRange": {
        const beginTransDate = compactDate(args.start);
        const endTransDate = compactDate(args.end);
        if (!beginTransDate || !endTransDate || beginTransDate > endTransDate) {
          return { status: "failed", reason: "日期参数无效。" };
        }
        queryTracker = {
          beginTransDate,
          endTransDate,
          resultState: "set",
          count: null,
          merchantId: null,
          reason: null
        };
        return { status: "set", beginTransDate, endTransDate };
      }
      case "query": {
        if (dialogTexts().length > 0) return { status: "blocked", reason: "弹窗尚未关闭，不启动下一次查询。" };
        if (!queryTracker?.beginTransDate || !queryTracker?.endTransDate) {
          return { status: "failed", reason: "查询日期尚未安全设置。" };
        }
        queryTracker.resultState = "querying";
        try {
          const result = await readQueryList(
            queryTracker.beginTransDate,
            queryTracker.endTransDate,
            args.operationDeadline ?? Date.now() + 60000
          );
          Object.assign(queryTracker, result.count === 0
            ? { resultState: "no_data", count: 0, merchantId: null, reason: null }
            : { resultState: "ready", count: result.count, merchantId: result.merchantId, reason: null });
        } catch (error) {
          Object.assign(queryTracker, {
            resultState: "failed",
            count: null,
            merchantId: null,
            reason: error?.message || "以旧换新查询接口调用失败。"
          });
        }
        return { status: "clicked", source: "api" };
      }
      case "queryState": {
        if (!queryTracker || ["set", "querying"].includes(queryTracker.resultState)) return { status: "waiting" };
        if (queryTracker.resultState === "failed") {
          return { status: "failed", reason: queryTracker.reason || "以旧换新查询失败。" };
        }
        if (queryTracker.resultState === "no_data") return { status: "no_data", count: 0 };
        if (queryTracker.resultState === "ready") {
          if (args.targetMerchantId && queryTracker.merchantId !== args.targetMerchantId) {
            return { status: "failed", reason: "查询结果的内部商户 ID 与本轮已确认身份不一致；未申请导出。" };
          }
          return { status: "ready", count: queryTracker.count, merchantId: queryTracker.merchantId };
        }
        return { status: "failed", reason: "以旧换新查询结果状态无法识别。" };
      }
      case "submitExport": {
        if (dialogTexts().length > 0) return { status: "blocked", reason: "弹窗尚未关闭，不申请导出。" };
        const gate = args.gate;
        if (gate?.authentication?.status !== "logged_in" || gate.authentication.confidence !== "high") {
          return { status: "blocked", reason: "商户门禁未通过，不允许申请导出。" };
        }
        if (queryTracker?.resultState !== "ready" || !Number.isInteger(queryTracker.count) || queryTracker.count <= 0) {
          return { status: "blocked", reason: "查询结果未就绪，导出操作已锁定。" };
        }
        if (gate?.allowed !== true || !args.targetMerchantId || gate.merchantId !== args.targetMerchantId ||
          queryTracker.merchantId !== args.targetMerchantId) {
          return { status: "blocked", reason: "当前商户身份无法确认或已切换；未申请导出。" };
        }
        try {
          const verifyDeadline = Math.min(
            (args.operationDeadline ?? Date.now() + 60000) - 12000,
            Date.now() + 45000
          );
          if (verifyDeadline <= Date.now()) return { status: "blocked", reason: "提交前商户接口复核没有剩余安全时间。" };
          const verified = await readQueryList(queryTracker.beginTransDate, queryTracker.endTransDate, verifyDeadline);
          if (verified.count <= 0 || verified.merchantId !== queryTracker.merchantId ||
            verified.merchantId !== args.targetMerchantId) {
            return { status: "blocked", reason: "提交前接口复核发现商户身份已变化或查询已无数据；未申请导出。" };
          }
        } catch (error) {
          return { status: "blocked", reason: `提交前接口复核失败：${error?.message || "查询身份无法确认"}` };
        }
        const userPortalToken = localStorage.getItem("userPortalVerifyToken");
        if (!userPortalToken) {
          return { status: "blocked", reason: "页面登录令牌不可用，未申请导出。" };
        }
        try {
          const response = await tradePost("applyExport", {
            merOrderId: "",
            transRef: "",
            statusList: [],
            beginTransDate: queryTracker.beginTransDate,
            endTransDate: queryTracker.endTransDate
          }, Math.min(args.operationDeadline ?? Date.now() + 12000, Date.now() + 12000));
          const code = String(response?.code ?? "");
          const message = clean(response?.message, 500);
          if (response?.success === true && code === "000000") {
            return { status: "accepted", message, source: "api" };
          }
          if (response?.success === false && code === "999999" &&
            /超过\s*\d+\s*条申请在处理中/.test(message)) {
            return { status: "throttled", message, source: "api" };
          }
          return { status: "unknown", reason: message
            ? `服务器返回 ${code || "无状态码"}：${message}`
            : "提交接口返回无法识别。" };
        } catch (error) {
          return { status: "unknown", reason: error?.name === "TimeoutError"
            ? "提交接口 12 秒内未返回。" : error?.message || "提交接口调用失败。" };
        }
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
          .filter(modalOpen)
          .filter((dialog) => /申请已提交|超过\s*\d+\s*条申请在处理中|申请失败|导出失败|系统异常/.test(textOf(dialog)));
        if (dialogs.length !== 1) return { status: "blocked", reason: "提交提示弹窗缺失或不唯一。" };
        const dialog = dialogs[0];
        const scoped = [...dialog.querySelectorAll("button")]
          .filter(visible)
          .filter((element) => !element.disabled && normalize(textOf(element)) === closeLabel);
        if (scoped.length !== 1) return { status: "blocked", reason: "提交提示内的确认/关闭按钮缺失或不唯一。" };
        scoped[0].click();
        const isClosed = () => !modalOpen(dialog) && dialogTexts().length === 0;
        // 后台页面的连续短计时器会被节流；由 DOM 变化直接确认关闭。
        const closed = await waitForModalClose(isClosed, args.operationDeadline);
        if (closed) return { status: "closed" };
        return { status: "blocked", reason: `关闭等待8秒后仍未就绪（目标提示${modalOpen(dialog) ? "仍打开" : "已关闭"}，仍打开弹窗${dialogTexts().length}个）；未继续下一步。` };
      }
      case "snapshotExportTasks": {
        const deadline = args.operationDeadline ?? Date.now() + 15000;
        const checkDeadline = () => {
          if (Date.now() >= deadline) throw new Error("暂存任务读取已超过截止时间。");
        };
        checkDeadline();
        const day = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
          const today = new Date();
          const start = new Date(today); start.setDate(start.getDate() - 7);
          const targetTaskIds = new Set((Array.isArray(args.taskIds) ? args.taskIds : [])
            .map((id) => String(id || "")).filter(Boolean));
          const rows = [];
          for (let current = 0; current < 100; current += 1) {
            checkDeadline();
            const response = await tradePost("qryExportDtls", {
              searchObj: "1", size: 100, current,
              beginApplyDate: `${day(start)} 00:00:00`, endApplyDate: `${day(today)} 23:59:59`
            }, deadline);
            checkDeadline();
            if (!response?.success || !Array.isArray(response.data?.list)) throw new Error("以旧换新暂存接口结构异常。");
            rows.push(...response.data.list.map((row) => {
              const exportStatus = clean(row.exportStatus, 40);
              const exportStatusDesc = clean(row.exportStatusDesc, 80);
              const errorMsg = clean(row.errorMsg, 240) || null;
              return {
                id: String(row.id || ""),
                fileName: row.exportFileName,
                createdAt: String(row.createTime || ""),
                exportStatus,
                exportStatusDesc,
                errorMsg,
                statusCode: errorMsg || /失败/.test(exportStatusDesc)
                  ? "failed" : exportStatus === "02" && exportStatusDesc === "成功" ? "ready" : "pending"
              };
            }));
            if (rows.some((row) => !row.id || !row.fileName) || new Set(rows.map((row) => row.id)).size !== rows.length) {
              throw new Error("以旧换新暂存任务身份缺失或重复。");
            }
            if (targetTaskIds.size && [...targetTaskIds].every((id) => rows.some((row) => row.id === id))) {
              return { status: "found", rows: rows.filter((row) => targetTaskIds.has(row.id)) };
            }
            if (current + 1 >= Number(response.data.pages)) {
              if (!targetTaskIds.size && rows.length !== Number(response.data.total)) throw new Error("以旧换新暂存任务分页不完整。");
              return { status: "found", rows: targetTaskIds.size ? rows.filter((row) => targetTaskIds.has(row.id)) : rows };
            }
          }
        throw new Error("以旧换新暂存任务页数超出读取范围。");
      }
      case "closeDownloadList": {
        const dialogs = downloadDialogs();
        if (dialogs.length === 0) return { status: "already_closed" };
        if (dialogs.length !== 1) return { status: "blocked", reason: "下载暂存列表弹窗不唯一，未关闭。" };
        const close = [...dialogs[0].querySelectorAll(".el-dialog__headerbtn")].filter(visible);
        if (close.length !== 1) return { status: "blocked", reason: "下载暂存列表右上角关闭控件缺失或不唯一。" };
        close[0].click();
        const component = downloadDialogComponent(dialogs[0]);
        if (component && component.visible !== false) {
          const isClosed = () => component.visible === false || downloadDialogs().length === 0;
          const closed = await waitForModalClose(isClosed, args.operationDeadline);
          if (!closed) return { status: "blocked", reason: "点击关闭后，下载暂存列表组件在8秒内仍保持打开。" };
        }
        return { status: "closed" };
      }
      case "downloadTaskDirect": {
        if (!downloadGateAllowed(args)) return { status: "blocked", reason: "商户门禁未通过，不允许下载。" };
        const fileMatch = String(args.fileName || "").match(/^MER_([A-Z0-9]+)_\d{14}_yjhx\.xlsx$/i);
        if (!fileMatch || normalize(fileMatch[1]) !== normalize(args.targetMerchantNo)) {
          return { status: "blocked", reason: "文件名中的商户号与当前目标不符。" };
        }
        const taskId = String(args.taskId || "");
        if (!/^\d{32}$/.test(taskId)) {
          return { status: "blocked", reason: "暂存任务 ID 格式无效。" };
        }
        const userPortalToken = localStorage.getItem("userPortalVerifyToken");
        if (!userPortalToken) return { status: "blocked", reason: "页面登录令牌不可用，不允许下载。" };
        const frame = document.createElement("iframe");
        frame.hidden = true;
        frame.setAttribute("aria-hidden", "true");
        frame.src = `/uisportal/api/uis-tradein-server/portal/yjhx/v3/downloadExportFile/${encodeURIComponent(taskId)}?userPortalToken=${encodeURIComponent(userPortalToken)}`;
        document.body.append(frame);
        setTimeout(() => frame.remove(), 60000);
        return { status: "download_requested" };
      }
      default:
        return { status: "unknown_operation" };
    }
  };
})();
