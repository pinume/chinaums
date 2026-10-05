(() => {
  let queryTracker = null;
  const clean = (value, limit = 240) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
  const normalize = (value) => clean(value, 500).replace(/\s/g, "");
  const onReportPage = () => location.hostname === "service.chinaums.com" && location.protocol === "https:";
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

  let sessionInitialized = false;
  const initializeSession = async (signal) => {
    const response = await fetch("/uisportal/api/userPortalVerify/init", {
      method: "POST", credentials: "same-origin", signal,
      headers: { "Content-Type": "application/json" }, body: "{}"
    });
    if (!response.ok || response.redirected) throw new Error("以旧换新登录令牌初始化失败，请重新登录门户。");
    const data = await response.json();
    if (data?.success !== true || String(data.code ?? "") !== "000000" ||
      typeof data.data !== "string" || !data.data.trim()) throw new Error("以旧换新登录令牌初始化失败，请重新登录门户。");
    localStorage.setItem("userPortalVerifyToken", data.data);
    sessionInitialized = true;
  };
  const request = async (payload, endpoint, options = {}, canRefresh = true) => {
    if (!sessionInitialized || !localStorage.getItem("userPortalVerifyToken")) await initializeSession(options.signal);
    const userPortalToken = localStorage.getItem("userPortalVerifyToken");
    const response = await fetch(`/uisportal/api/${endpoint}`, {
      method: "POST", credentials: "same-origin", signal: options.signal,
      headers: { "Content-Type": "application/json", userPortalToken },
      body: JSON.stringify(payload)
    });
    if (!response.ok || response.redirected) throw new Error(`以旧换新接口 HTTP ${response.status} 或登录会话失效。`);
    const data = await response.json();
    if (canRefresh && String(data?.code ?? "") === "999998" &&
      ["queryList", "qryExportDtls"].includes(endpoint.split("/").at(-1))) {
      await initializeSession(options.signal);
      return request(payload, endpoint, options, false);
    }
    if (String(data?.code ?? "") === "999998") throw new Error("以旧换新业务会话失效，请重新登录门户；未自动重提导出申请。");
    return data;
  };
  const readQueryList = async (beginTransDate, endTransDate, deadline) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()));
    const checkDeadline = () => {
      if (controller.signal.aborted || Date.now() >= deadline) {
        controller.abort();
        throw new Error("以旧换新查询已超过截止时间。");
      }
    };
    try {
      const rows = [];
      let expectedTotal = null;
      let expectedPages = null;
      for (let current = 0; ; current += 1) {
        checkDeadline();
        const response = await request({
          merOrderId: "",
          transRef: "",
          status: [],
          beginTransDate,
          endTransDate,
          current,
          size: 10
        }, "uis-tradein-server/portal/yjhx/v3/queryList", {
          signal: controller.signal
        });
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
    } finally {
      clearTimeout(timer);
    }
  };
  globalThis.__chinaumsTradeAuditAdapter = async (operation, args = {}) => {
    if (!onReportPage()) return { status: "wrong_page", reason: "当前不是银联商务 HTTPS 网站。" };

    switch (operation) {
      case "query": {
        queryTracker = null;
        const beginTransDate = compactDate(args.start);
        const endTransDate = compactDate(args.end);
        if (!beginTransDate || !endTransDate || beginTransDate > endTransDate) {
          return { status: "failed", reason: "日期参数无效。" };
        }
        queryTracker = { beginTransDate, endTransDate, resultState: "querying" };
        try {
          const result = await readQueryList(beginTransDate, endTransDate, args.operationDeadline ?? Date.now() + 60000);
          const expectedMerchant = args.targetMerchantId;
          if (result.count > 0 && expectedMerchant && result.merchantId !== expectedMerchant) {
            throw new Error("以旧换新查询结果商户身份与本轮已确认身份不一致，未申请导出。");
          }
          Object.assign(queryTracker, result, {
            resultState: result.count === 0 ? "no_data" : "ready"
          });
          return result.count === 0
            ? { status: "no_data", count: 0 }
            : { status: "ready", count: result.count, merchantId: result.merchantId };
        } catch (error) {
          queryTracker = null;
          return { status: "failed", reason: error?.name === "AbortError"
            ? "以旧换新查询接口在截止时间前未完成。"
            : error?.message || "以旧换新查询接口调用失败。" };
        }
      }
      case "submitExport": {
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
          const response = await request({
            merOrderId: "",
            transRef: "",
            statusList: [],
            beginTransDate: queryTracker.beginTransDate,
            endTransDate: queryTracker.endTransDate
          }, "uis-tradein-server/portal/yjhx/v3/applyExport", {
            signal: AbortSignal.timeout(Math.max(1, Math.min(12000,
              (args.operationDeadline ?? Date.now() + 12000) - Date.now())))
          });
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
          const day = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
          const today = new Date();
          const start = new Date(today); start.setDate(start.getDate() - 7);
          const targetTaskIds = new Set((Array.isArray(args.taskIds) ? args.taskIds : [])
            .map((id) => String(id || "")).filter(Boolean));
          const rows = [];
          for (let current = 0; current < 100; current += 1) {
            checkDeadline();
            const response = await request({
              searchObj: "1", size: 100, current,
              beginApplyDate: `${day(start)} 00:00:00`, endApplyDate: `${day(today)} 23:59:59`
            }, "uis-tradein-server/portal/yjhx/v3/qryExportDtls", {
              signal: controller.signal
            });
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
        } finally {
          clearTimeout(timer);
        }
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
        return { status: "download_requested", url: `https://service.chinaums.com/uisportal/api/uis-tradein-server/portal/yjhx/v3/downloadExportFile/${encodeURIComponent(taskId)}?userPortalToken=${encodeURIComponent(userPortalToken)}` };
      }
      default:
        return { status: "unknown_operation" };
    }
  };
})();
