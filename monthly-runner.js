(() => {
  const monthKey = (year, month) => `${year}-${String(month).padStart(2, "0")}`;
  const formatDate = (year, month, day) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

  const makeMonthRange = (year, month, today = new Date()) => {
    const lastDay = daysInMonth(year, month);
    const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1;
    return {
      key: monthKey(year, month),
      start: formatDate(year, month, 1),
      end: formatDate(year, month, isCurrentMonth ? Math.min(lastDay, today.getDate()) : lastDay)
    };
  };

  const yearToDateMonths = (today = new Date()) => Array.from(
    { length: today.getMonth() + 1 },
    (_, index) => makeMonthRange(today.getFullYear(), index + 1, today)
  );

  const run = async ({ months, reportType, invoke, gate, targetMerchantNo, checkpoint, sleep, transition, onMerchantVerified, now = () => Date.now() }) => {
    if (!Array.isArray(months) || !months.length) throw new Error("没有可执行的月份。");
    const results = [];
    let throttleAttempts = 0;
    let activeMerchantId = null;
    let activeMerchantNo = String(targetMerchantNo || gate?.merchantNo || "").replace(/[\s\u200B-\u200D\uFEFF]/g, "").toUpperCase();

    const setMonthState = async (month, status, extra = {}) => {
      const result = { month: month.key, status, ...extra };
      results.push(result);
      await transition(result);
      return result;
    };

    const bindTask = async ({ baselineRows, attemptedAt, response }) => {
      const unknown = !response;
      const merchantNo = String(activeMerchantNo || "").replace(/[\s\u200B-\u200D\uFEFF]/g, "").toUpperCase();
      const attemptedAtMs = new Date(attemptedAt).getTime();
      if (unknown && (!merchantNo || !Number.isFinite(attemptedAtMs))) {
        return { status: "unknown", reason: "缺少申请时间或已确认商户号，无法安全核对。" };
      }
      const previousIds = new Set(baselineRows.map((row) => unknown ? String(row?.id || "") : row.id));
      if (unknown && (previousIds.has("") || previousIds.size !== baselineRows.length)) {
        return { status: "unknown", reason: "申请前暂存任务基线缺失或身份重复，不能安全核对。" };
      }
      const deadline = now() + 15000;
      let snapshotReason = "";
      while (now() < deadline) {
        await checkpoint();
        let snapshot;
        try {
          snapshot = await invoke("snapshotExportTasks", {
            operationDeadline: Date.now() + Math.max(0, deadline - now())
          });
        } catch (error) {
          if (error?.message === "STOPPED_BY_USER") throw error;
          snapshot = { status: "unknown", reason: error?.message || "暂存读取未响应" };
        }
        if (!unknown && now() >= deadline) break;
        if (snapshot?.status === "found" && Array.isArray(snapshot.rows)) {
          snapshotReason = "";
          const added = snapshot.rows.filter((row) => !previousIds.has(unknown ? String(row.id || "") : row.id));
          if (added.length > 1) {
            return { status: "unknown", reason: "出现多个新暂存任务，无法唯一确认归属；禁止重提。" };
          }
          if (added.length === 1) {
            const task = added[0];
            const trade = unknown ? reportType === "trade-audit" : Boolean(activeMerchantId);
            const match = String(task.fileName || "").match(trade
              ? /^MER_([A-Z0-9]+)_\d{14}_yjhx\.xlsx$/i
              : /^([A-Z0-9]+)_MX_\d{14}(?:_[^.]*)?\.xlsx$/i);
            if (unknown) {
              const createdAtMs = Date.parse(String(task.createdAt || "").replace(/-/g, "/"));
              const idValid = trade ? /^\d{32}$/.test(String(task.id || ""))
                : /^[0-9a-f]{32}$/i.test(String(task.id || ""));
              const alreadyBound = results.some((month) =>
                month.remoteTaskId === task.id || month.remoteFileName === task.fileName);
              if (!idValid || !match || match[1].toUpperCase() !== merchantNo ||
                !Number.isFinite(createdAtMs) || createdAtMs < attemptedAtMs - 2000 ||
                createdAtMs > Date.now() + 2000 || alreadyBound) {
                return { status: "unknown", reason: "唯一新增暂存任务的商户、时间或身份校验未通过；不自动重提。" };
              }
            } else if (!match || (activeMerchantNo && match[1].toUpperCase() !== activeMerchantNo) ||
              (response.fileName && response.fileName !== task.fileName) ||
              baselineRows.some((row) => row.fileName === task.fileName)) {
              return { status: "unknown", reason: "新任务文件名或商户号无法确认；禁止重提。" };
            }
            return { status: "accepted", taskId: unknown ? String(task.id) : task.id, fileName: task.fileName,
              createdAt: task.createdAt, merchantNo: match[1].toUpperCase() };
          }
        } else {
          snapshotReason = snapshot?.reason || snapshot?.status || "暂存读取无返回结果";
          if ((!unknown || snapshot?.status) && !["unknown", "loading", "empty"].includes(snapshot?.status)) {
            return { status: "unknown", reason: snapshotReason };
          }
        }
        await sleep(Math.max(0, Math.min(500, deadline - now())));
      }
      return { status: "unknown", reason: unknown ? "15秒内未找到唯一新增暂存任务；不自动重提。"
        : `15秒内未确认新建暂存任务${snapshotReason ? `（${snapshotReason}）` : ""}；禁止重提。` };
    };

    for (const month of months) {
      await checkpoint();
      await transition({ month: month.key, status: "QUERYING" });
      let queryState;
      try {
        queryState = await invoke("query", {
          start: month.start, end: month.end,
          targetMerchantNo: activeMerchantNo || null, targetMerchantId: activeMerchantId
        });
      } catch (error) {
        if (error?.message === "STOPPED_BY_USER") throw error;
        const reason = `查询调用失败或超时：${error?.message || "页面未响应"}`;
        await setMonthState(month, "FAILED", { reason });
        throw new Error(`${month.key} 查询调用未能确认：${error?.message || "页面未响应"}`);
      }
      await checkpoint();
      if (!["ready", "no_data"].includes(queryState?.status)) {
        const reason = queryState?.reason || "查询结果状态无法确认，未申请导出。";
        await setMonthState(month, "FAILED", { reason });
        throw new Error(`${month.key} 查询失败：${reason}`);
      }
      if (queryState.status === "ready") {
        const actualMerchantNo = String(queryState.merchantNo || "").replace(/\s/g, "").toUpperCase();
        const actualMerchantId = String(queryState.merchantId || "").trim();
        if (!actualMerchantNo && !actualMerchantId) {
          await setMonthState(month, "FAILED", { reason: "查询结果中没有唯一可确认的商户号；未申请导出。" });
          throw new Error(`${month.key} 查询结果中没有唯一可确认的商户号；未申请导出。`);
        }
        if (activeMerchantNo && actualMerchantNo && actualMerchantNo !== activeMerchantNo) {
          await setMonthState(month, "FAILED", { reason: `查询结果商户号 ${actualMerchantNo} 与本轮已确认商户号 ${activeMerchantNo} 不一致；未申请导出。` });
          throw new Error(`${month.key} 查询结果商户号与本轮已确认商户号不一致；未申请导出。`);
        }
        if (activeMerchantId && actualMerchantId !== activeMerchantId) {
          await setMonthState(month, "FAILED", { reason: "查询结果的内部商户 ID 已切换；未申请导出。" });
          throw new Error(`${month.key} 商户身份已切换；未申请导出。`);
        }
        activeMerchantId = actualMerchantId || activeMerchantId;
        activeMerchantNo = actualMerchantNo || activeMerchantNo;
        try {
          if (onMerchantVerified && activeMerchantNo) await onMerchantVerified(activeMerchantNo);
        } catch (error) {
          await setMonthState(month, "FAILED", { reason: error?.message || "查询结果商户号核对未通过；未申请导出。" });
          throw error;
        }
        gate.allowed = true;
        gate.merchantNo = activeMerchantNo;
        gate.merchantId = activeMerchantId;
        gate.source = "query-result";
        await transition({ month: month.key, status: "QUERY_READY", count: queryState.count, merchantNo: activeMerchantNo });
      }
      if (queryState.status === "no_data") {
        await setMonthState(month, "NO_DATA", { count: 0 });
        throttleAttempts = 0;
        continue;
      }

      let submitted = false;
      while (!submitted) {
        await checkpoint();
        const baseline = await invoke("snapshotExportTasks", {});
        if (baseline?.status !== "found" || !Array.isArray(baseline.rows)) throw new Error(`${month.key} 无法读取申请前暂存任务；未申请导出。`);
        const attemptedAt = new Date().toISOString();
        await transition({ month: month.key, status: "SUBMITTING", attemptedAt });
        let submit;
        try {
          submit = await invoke("submitExport", { gate, targetMerchantNo: activeMerchantNo, targetMerchantId: activeMerchantId });
        } catch (error) {
          if (error?.message === "STOPPED_BY_USER") throw error;
          submit = { status: "unknown", reason: error?.message || "提交调用未响应" };
        }
        if (["blocked", "wrong_page"].includes(submit?.status)) {
          await setMonthState(month, "FAILED", { reason: submit?.reason || "导出请求未通过门禁检查。" });
          throw new Error(`${month.key} 导出已锁定：${submit?.reason || "请求状态未确认"}`);
        }

        const response = ["accepted", "throttled", "failed"].includes(submit?.status)
          ? submit
          : { status: "unknown", reason: submit?.reason };

        if (response?.status === "accepted") {
          const accepted = await setMonthState(month, "SUBMITTED", { submittedAt: attemptedAt, remoteFileName: response.fileName || null, count: queryState.count });
          throttleAttempts = 0;
          submitted = true;
          const binding = await bindTask({ baselineRows: baseline.rows, attemptedAt, response });
          if (binding.status !== "accepted") throw new Error(`${month.key} 已提交，但${binding.reason}`);
          activeMerchantNo = binding.merchantNo;
          gate.merchantNo = activeMerchantNo;
          Object.assign(accepted, { remoteFileName: binding.fileName, remoteTaskId: binding.taskId });
          await transition(accepted);
          if (onMerchantVerified) await onMerchantVerified(activeMerchantNo, "download-task");
          continue;
        }

        if (response?.status === "throttled") {
          throttleAttempts += 1;
          const waitMs = Math.min(30000 * 2 ** (throttleAttempts - 1), 120000);
          await transition({ month: month.key, status: "WAITING_FOR_SLOT", retryInMs: waitMs, attempt: throttleAttempts });
          const end = now() + waitMs;
          if (reportType === "account-detail") {
            const submittedTasks = results.filter((item) => item.status === "SUBMITTED" &&
              item.remoteTaskId && item.remoteFileName);
            const taskIds = submittedTasks.map((item) => String(item.remoteTaskId));
            let baselinePending = null;
            let slotReleased = false;
            try {
              while (taskIds.length && now() < end) {
                await checkpoint();
                const snapshot = await invoke("snapshotExportTasks", {
                  taskIds,
                  operationDeadline: Date.now() + Math.min(15000, Math.max(0, end - now()))
                });
                if (snapshot?.status !== "found" || !Array.isArray(snapshot.rows)) break;
                const byId = new Map(snapshot.rows.map((row) => [String(row.id || ""), row]));
                const rows = submittedTasks.map((item) => byId.get(String(item.remoteTaskId)));
                if (rows.some((row, index) => !row ||
                  row.fileName !== submittedTasks[index].remoteFileName ||
                  !["pending", "ready"].includes(row.statusCode))) break;
                const pending = rows.filter((row) => row.statusCode === "pending").length;
                await transition({ month: month.key, status: "WAITING_FOR_SLOT",
                  retryInMs: Math.max(0, end - now()), attempt: throttleAttempts,
                  pending, generated: rows.length - pending, slotSource: "api" });
                if (pending === 0 || (baselinePending !== null && pending < baselinePending)) {
                  slotReleased = true;
                  break;
                }
                baselinePending = pending;
                await sleep(Math.min(10000, Math.max(0, end - now())));
              }
            } catch (error) {
              if (error?.message === "STOPPED_BY_USER") throw error;
              // 接口读取失败时保留原有退避；服务器仍是下一次提交是否允许的最终判断。
            }
            if (slotReleased || now() >= end) {
              continue;
            }
          }
          while (now() < end) {
            await checkpoint();
            await sleep(Math.min(1000, end - now()));
          }
          continue;
        }

        if (response?.status === "failed") {
          await setMonthState(month, "FAILED", { reason: response.message || "服务器明确拒绝了申请。" });
          throw new Error(`${month.key} 导出失败：${response.message || "服务器返回明确失败"}`);
        }

        await transition({ month: month.key, status: "UNKNOWN", attemptedAt });
        let reconciliation = { status: "unknown" };
        try {
          reconciliation = await bindTask({ baselineRows: baseline.rows, attemptedAt });
        } catch (error) {
          if (error?.message === "STOPPED_BY_USER") throw error;
          reconciliation.reason = error?.message || "未知申请对账失败";
        }
        if (reconciliation?.status === "accepted") {
          await setMonthState(month, "SUBMITTED", {
            submittedAt: attemptedAt,
            remoteCreatedAt: reconciliation.createdAt || null,
            reconciled: true,
            remoteFileName: reconciliation.fileName || null,
            remoteTaskId: reconciliation.taskId || null,
            count: queryState.count
          });
          submitted = true;
          throttleAttempts = 0;
          continue;
        }
        await setMonthState(month, "UNKNOWN", { attemptedAt, reason: reconciliation?.reason || "服务端是否接受申请无法确认，禁止自动重提。" });
        throw new Error(`${month.key} 提交结果 UNKNOWN；已执行安全对账但仍无法确认，禁止自动重试。`);
      }
    }

    return results;
  };

  globalThis.CHINAUMS_MONTHLY_RUNNER = Object.freeze({
    makeMonthRange,
    yearToDateMonths,
    run
  });
})();
