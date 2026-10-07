(() => {
  const config = globalThis.CHINAUMS_SITE_CONFIG;
  if (!config) throw new Error("银联商务站点配置未加载。");

  const matchesRoute = (path, route) => route.exact
    ? path === route.exact
    : path === route.prefix || path.startsWith(`${route.prefix}/`);

  const classify = (rawUrl, frames, mainNavigation, businessEntries) => {
    const signals = frames.map((frame) => frame.signals || {});
    if (signals.some((signal) => signal.hasPasswordInput)) {
      return { status: "logged_out", confidence: "high", reasons: ["检测到密码输入框"] };
    }

    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return { status: "unknown", confidence: "low", reasons: ["无法解析当前页面地址"] };
    }
    if (url.hostname !== config.host) {
      return { status: "unknown", confidence: "low", reasons: ["当前页面不是银联商务门户"] };
    }
    if (url.pathname === config.portalRoot || url.pathname === `${config.portalRoot}/` ||
      /login|signin|auth/i.test(url.pathname)) {
      return { status: "logged_out", confidence: "medium", reasons: ["当前 URL 是门户入口或登录相关路径"] };
    }

    const matchedRoute = config.pageRoutes.some((route) => matchesRoute(url.pathname, route));
    const knownBusinessEntries = [...new Set(businessEntries.map((item) => item.text).filter(Boolean))];
    const navigationMarkers = ["账务中心", "营销中心", "数据中心", "服务市场", "产品中心"];
    const navLabels = new Set(mainNavigation.map((item) => item.text));
    const matchedNavigation = navigationMarkers.filter((label) => navLabels.has(label));
    const accountCue = signals.some((signal) => signal.accountCue);

    const reasons = [];
    if (matchedRoute) reasons.push("命中已知登录后路由");
    if (knownBusinessEntries.length) reasons.push(`发现登录后业务入口：${knownBusinessEntries.join("、")}`);
    if (matchedNavigation.length >= 3) reasons.push(`发现业务主导航：${matchedNavigation.join("、")}`);
    if (accountCue) reasons.push("发现账号或商户区域线索");

    const features = Number(matchedRoute) + Number(knownBusinessEntries.length > 0) +
      Number(matchedNavigation.length >= 3) + Number(accountCue);

    if (features >= 2 || (matchedRoute && (matchedNavigation.length >= 3 || knownBusinessEntries.length > 0))) {
      return { status: "logged_in", confidence: "high", reasons };
    }
    if (features >= 1) {
      return { status: "logged_in", confidence: "medium", reasons };
    }
    if (signals.some((signal) => signal.loginControls)) {
      return { status: "logged_out", confidence: "medium", reasons: ["发现登录入口，未发现登录后业务特征"] };
    }
    return {
      status: "unknown",
      confidence: "low",
      reasons: reasons.length ? reasons : ["页面没有足够的登录状态特征"]
    };
  };

  globalThis.CHINAUMS_AUTH = Object.freeze({ classify });
})();
