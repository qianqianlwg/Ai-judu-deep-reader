const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export type RequestRejection = { status: 403 | 415 | 503; message: string };

export function rejectUntrustedApiRequest(request: Request, appOrigin?: string): RequestRejection | undefined {
  let requestUrl: URL, hostUrl: URL, configured: URL | undefined;
  try {
    requestUrl = new URL(request.url);
    hostUrl = new URL(requestUrl.protocol + "//" + (request.headers.get("host") ?? requestUrl.host));
    if (appOrigin) {
      configured = new URL(appOrigin);
      if (!["http:", "https:"].includes(configured.protocol) || configured.username || configured.password || configured.search || configured.hash || configured.pathname !== "/") throw new Error("无效站点来源");
    }
  } catch (error: unknown) {
    console.warn("API 来源配置或请求地址不合法", { name: error instanceof Error ? error.name : "UnknownError" });
    return { status: 503, message: "站点来源配置不合法，请检查服务配置" };
  }
  // WHY：默认仅支持本机访问，并限制 Host，避免恶意域名通过 DNS 重绑定访问本地模型配置。
  if (!LOOPBACK_HOSTS.has(hostUrl.hostname) && hostUrl.host !== configured?.host) return { status: 403, message: "当前服务未允许该访问地址" };
  const origin = request.headers.get("origin");
  const allowedOrigin = configured?.origin ?? hostUrl.origin;
  if (origin && origin !== allowedOrigin) return { status: 403, message: "不允许其他网站访问句读接口" };
  if (request.headers.get("sec-fetch-site") === "cross-site") return { status: 403, message: "不允许跨站请求操作句读接口" };
  if (SAFE_METHODS.has(request.method)) return;
  // WHY：浏览器可跨站发送 text/plain JSON；除导入外只接收 application/json，阻止利用已存 Key 发起请求。
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  const expected = requestUrl.pathname === "/api/import" ? "multipart/form-data" : "application/json";
  if (contentType !== expected) return { status: 415, message: "请求内容类型不受支持" };
}
