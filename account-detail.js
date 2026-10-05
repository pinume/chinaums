(() => {
  let queryTracker = null;
  const clean = (value, limit = 240) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
  const normalize = (value) => clean(value, 500).replace(/\s/g, "");
  const onReportPage = () => location.hostname === "service.chinaums.com" && location.protocol === "https:";
  const downloadGateAllowed = (args) => args.gate?.allowed === true &&
    normalize(args.gate.merchantNo) === normalize(args.targetMerchantNo) && Boolean(args.targetMerchantNo);
  const QUERY_FIELDS = [
    "settDateBegin", "settDateEnd", "pageSize", "dealDateBegin", "dealDateEnd", "transStatus",
    "dealType", "busiTypeIdList", "fdId", "zdCode", "amount1", "amount2", "fkhNo",
    "bankCardNo1", "bankCardNo2", "dealMode", "bingJieFlag", "refNum", "merOrderId",
    "bankOrder", "searchNo", "searchObj"
  ];
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
  const queryParams = () => {
    const params = new URLSearchParams(QUERY_FIELDS.map((name) => [name, ""]));
    params.set("pageSize", "100");
    params.set("transStatus", "1");
    params.set("searchObj", "1");
    return params;
  };
  const buildQueryPayload = (pageNumber) => {
    if (!queryTracker?.beginSettDate || !queryTracker?.endSettDate) {
      return { error: "查询日期尚未安全设置。" };
    }
    const payload = queryParams();
    payload.set("settDateBegin", queryTracker.beginSettDate);
    payload.set("settDateEnd", queryTracker.endSettDate);
    payload.set("pageNumber", String(pageNumber));
    const pageSize = Number(payload.get("pageSize"));
    if (!Number.isInteger(pageSize) || pageSize <= 0) return { error: "查询参数中的 pageSize 无效。" };
    return { payload, pageSize };
  };
  const querySignature = (payload) => {
    const copy = new URLSearchParams(payload);
    copy.delete("pageNumber");
    return copy.toString();
  };
  const readAccountQuery = async (deadline) => {
    const first = buildQueryPayload(1);
    if (first.error) throw new Error(first.error);
    const expectedSignature = querySignature(first.payload);
    const rows = [];
    let totalPages = null;
    let totalElements = null;
    let exportFees = null;
    for (let pageNumber = 1; ; pageNumber += 1) {
      if (Date.now() >= deadline) throw new Error("对账明细查询已超过截止时间。");
      const built = buildQueryPayload(pageNumber);
      if (built.error) throw new Error(built.error);
      if (built.pageSize !== first.pageSize || querySignature(built.payload) !== expectedSignature) {
        throw new Error("对账明细查询条件在分页读取过程中发生变化。");
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()));
      let data;
      try {
        const response = await fetch("/uisportal/accountCheckDetailQry/qryAccountCheck", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest"
          },
          body: built.payload.toString(),
          signal: controller.signal
        });
        if (!response?.ok || response.redirected) throw new Error(`对账明细查询接口 HTTP ${response?.status ?? "unknown"} 或登录会话失效。`);
        data = await response.json();
        if (controller.signal.aborted || Date.now() >= deadline) throw new Error("对账明细查询已超过截止时间。");
      } finally {
        clearTimeout(timer);
      }
      if (String(data?.respCode ?? "") !== "000000" || !Array.isArray(data?.pageObj?.content)) {
        throw new Error("对账明细查询接口结构异常。");
      }
      const page = data.pageObj;
      exportFees ??= { regularFee: data.regularFee, d1Fee: data.d1Fee };
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
    return {
      count: totalElements,
      merchantNo: merchants[0] || null,
      filterSignature: expectedSignature,
      ...exportFees
    };
  };

  const buildExportPayload = (verified) => {
    const built = buildQueryPayload(1);
    if (built.error) return built;
    const payload = built.payload;
    if (querySignature(payload) !== verified.filterSignature) return { error: "申请前查询条件已变化。" };
    if (payload.get("transStatus") !== "1") return { error: "当前交易状态不支持 XLSX 导出，请选择普通交易。" };
    payload.delete("pageNumber");
    payload.set("fileExt", "xlsx");
    payload.set("regularFee", verified.regularFee ?? "");
    payload.set("d1Fee", verified.d1Fee ?? "");
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
  globalThis.__chinaumsAccountDetailAdapter = async (operation, args = {}) => {
    if (!onReportPage()) {
      return { status: "wrong_page", reason: "当前不是银联商务 HTTPS 网站。" };
    }

    switch (operation) {
      case "query": {
        queryTracker = null;
        const beginSettDate = compactDate(args.start);
        const endSettDate = compactDate(args.end);
        if (!beginSettDate || !endSettDate || beginSettDate > endSettDate) {
          return { status: "failed", reason: "日期参数无效。" };
        }
        queryTracker = { beginSettDate, endSettDate, resultState: "querying" };
        try {
          const result = await readAccountQuery(args.operationDeadline ?? Date.now() + 60000);
          const expectedMerchant = normalize(args.targetMerchantNo);
          if (result.count > 0 && expectedMerchant && result.merchantNo !== expectedMerchant) {
            throw new Error("对账明细查询结果商户身份与本轮已确认身份不一致，未申请导出。");
          }
          Object.assign(queryTracker, result, {
            resultState: result.count === 0 ? "no_data" : "ready"
          });
          return result.count === 0
            ? { status: "no_data", count: 0 }
            : { status: "ready", count: result.count, merchantNo: result.merchantNo };
        } catch (error) {
          queryTracker = null;
          return { status: "failed", reason: error?.name === "AbortError"
            ? "对账明细查询接口在截止时间前未完成。"
            : error?.message || "对账明细查询接口调用失败。" };
        }
      }
      case "submitExport": {
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
          verified.merchantNo !== normalize(args.targetMerchantNo) ||
          verified.filterSignature !== queryTracker.filterSignature) {
          return { status: "blocked", reason: "提交前接口复核发现商户、查询条件或数据状态已变化；未申请导出。" };
        }
        const prepared = buildExportPayload(verified);
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
          if (!response.ok || response.redirected) return { status: "unknown", reason: `提交接口 HTTP ${response.status} 或登录会话失效。` };
          return classifyExportResponse(await response.json());
        } catch (error) {
          return { status: "unknown", reason: error?.name === "AbortError" ? "提交接口 12 秒内未返回。" : error?.message || "提交接口调用失败。" };
        } finally {
          clearTimeout(timer);
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
        return { status: "download_requested", url: `https://service.chinaums.com/uisportal/commonController/exportDeailBill?exportId=${encodeURIComponent(taskId)}` };
      }
      default:
        return { status: "unknown_operation" };
    }
  };
})();
