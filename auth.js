(() => {
  const config = globalThis.CHINAUMS_SITE_CONFIG;
  if (!config) throw new Error("银联商务站点配置未加载。");

  const matchesRoute = (path, route) => route.exact
    ? path === route.exact
    : path === route.prefix || path.startsWith(`${route.prefix}/`);

  const classify = (rawUrl, frames, mainNavigation, businessEntries) => {
    const signals = frames.map((frame) => frame.signals || {});
    if (signals.some((signal) => signal.hasPasswordInput)) {
      return { status: "logged_out", confidence: "high", score: -100, reasons: ["检测到密码输入框"] };
    }

    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return { status: "unknown", confidence: "low", score: 0, reasons: ["无法解析当前页面地址"] };
    }
    if (url.hostname !== config.host) {
      return { status: "unknown", confidence: "low", score: 0, reasons: ["当前页面不是银联商务门户"] };
    }
    if (url.pathname === config.portalRoot || url.pathname === `${config.portalRoot}/` ||
      /login|signin|auth/i.test(url.pathname)) {
      return { status: "logged_out", confidence: "medium", score: -40, reasons: ["当前 URL 是门户入口或登录相关路径"] };
    }

    let score = 0;
    const reasons = [];
    if (config.pageRoutes.some((route) => matchesRoute(url.pathname, route))) {
      score += 40;
      reasons.push("命中已知登录后路由");
    }

    const knownBusinessEntries = [...new Set(businessEntries.map((item) => item.text).filter(Boolean))];
    if (knownBusinessEntries.length) {
      score += Math.min(knownBusinessEntries.length * 10, 40);
      reasons.push(`发现登录后业务入口：${knownBusinessEntries.join("、")}`);
    }

    const navigationMarkers = ["账务中心", "营销中心", "数据中心", "服务市场", "产品中心"];
    const navLabels = new Set(mainNavigation.map((item) => item.text));
    const matchedNavigation = navigationMarkers.filter((label) => navLabels.has(label));
    if (matchedNavigation.length >= 3) {
      score += 20;
      reasons.push(`发现业务主导航：${matchedNavigation.join("、")}`);
    }

    if (signals.some((signal) => signal.accountCue)) {
      score += 10;
      reasons.push("发现账号或商户区域线索");
    }

    if (score >= 70) return { status: "logged_in", confidence: "high", score: Math.min(score, 100), reasons };
    if (score >= 40) return { status: "logged_in", confidence: "medium", score: Math.min(score, 100), reasons };
    if (signals.some((signal) => signal.loginControls) && score === 0) {
      return { status: "logged_out", confidence: "medium", score: -20, reasons: ["发现登录入口，未发现登录后业务特征"] };
    }
    return {
      status: "unknown",
      confidence: "low",
      score,
      reasons: reasons.length ? reasons : ["页面没有足够的登录状态特征"]
    };
  };

  globalThis.CHINAUMS_AUTH = Object.freeze({ classify });
})();
