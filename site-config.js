globalThis.CHINAUMS_SITE_CONFIG = Object.freeze({
  host: "service.chinaums.com",
  portalRoot: "/uisportal",
  frontendRoot: "/uisportalfront",
  targetMerchant: "北国商城股份有限公司",
  reportRoutes: Object.freeze({
    accountDetail: "/uisportal/accountCheckDetailQry/toDetail",
    tradeAuditPortal: "/uisportal/rt2?p=s,service.chinaums.com/uisportalfront/%23/auditOfTrade2026"
  }),
  mainNavigation: Object.freeze([
    { path: "/uisportal/index_r", label: "首页" },
    { path: "/uisportal/accountingCenter", label: "账务中心" },
    { path: "/uisportal/marketingCoupon", label: "营销中心" },
    { path: "/uisportal/transactionData", label: "数据中心" },
    { path: "/uisportal/serviceMarket", label: "服务市场" },
    { path: "/uisportal/product/productView", label: "产品中心" }
  ]),
  pageRoutes: Object.freeze([
    { category: "首页", exact: "/uisportal/index_r" },
    { category: "账务中心", prefix: "/uisportal/accountingCenter" },
    { category: "营销中心", prefix: "/uisportal/marketingCoupon" },
    { category: "数据中心", prefix: "/uisportal/transactionData" },
    { category: "服务市场", prefix: "/uisportal/serviceMarket" },
    { category: "产品中心", prefix: "/uisportal/product" },
    { category: "商户切换", exact: "/uisportal/merInfoUser/userMerView" },
    { category: "员工管理", prefix: "/uisportal/user/newUser" },
    { category: "商户信息", prefix: "/uisportal/merInfoUser/businessCenter" },
    { category: "员工管理", prefix: "/uisportal/merInfoUser/myStaff" },
    { category: "实时交易查询", prefix: "/uisportal/qryCRealTimeTrans/toCRealTimeTrans" },
    { category: "对账明细查询", prefix: "/uisportal/accountCheckDetailQry/toDetail" },
    { category: "POS业务申办", prefix: "/uisportal/business/businessBidding" },
    { category: "交易审计", exact: "/uisportal/rt2" },
    { category: "交易审计", prefix: "/uisportalfront" }
  ])
});
