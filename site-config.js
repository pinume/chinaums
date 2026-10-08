globalThis.CHINAUMS_SITE_CONFIG = Object.freeze({
  host: "service.chinaums.com",
  portalRoot: "/uisportal",
  frontendRoot: "/uisportalfront",
  mainNavigation: Object.freeze([
    { path: "/uisportal/index_r", label: "首页" },
    { path: "/uisportal/accountingCenter", label: "账务中心" },
    { path: "/uisportal/marketingCoupon", label: "营销中心" },
    { path: "/uisportal/transactionData", label: "数据中心" },
    { path: "/uisportal/serviceMarket", label: "服务市场" },
    { path: "/uisportal/product/productView", label: "产品中心" }
  ]),
  pageRoutes: Object.freeze([
    { exact: "/uisportal/index_r" },
    { prefix: "/uisportal/accountingCenter" },
    { prefix: "/uisportal/marketingCoupon" },
    { prefix: "/uisportal/transactionData" },
    { prefix: "/uisportal/serviceMarket" },
    { prefix: "/uisportal/product" },
    { exact: "/uisportal/merInfoUser/userMerView" },
    { prefix: "/uisportal/user/newUser" },
    { prefix: "/uisportal/merInfoUser/businessCenter" },
    { prefix: "/uisportal/merInfoUser/myStaff" },
    { prefix: "/uisportal/qryCRealTimeTrans/toCRealTimeTrans" },
    { prefix: "/uisportal/accountCheckDetailQry/toDetail" },
    { prefix: "/uisportal/business/businessBidding" },
    { exact: "/uisportal/rt2" },
    { prefix: "/uisportalfront" }
  ])
});
