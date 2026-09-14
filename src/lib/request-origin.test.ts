import { describe, expect, it } from "vitest";
import { rejectUntrustedApiRequest } from "./request-origin";
function request(headers: Record<string,string> = {}, url = "http://localhost:3000/api/settings/ai", method = "POST") { return new Request(url,{method,headers:{"content-type":"application/json",...headers}}); }
describe("本机 API 同源与 Host 保护",()=>{
  it("允许同源浏览器与本机脚本的JSON请求",()=>{ expect(rejectUntrustedApiRequest(request({origin:"http://localhost:3000"}))).toBeUndefined(); expect(rejectUntrustedApiRequest(request())).toBeUndefined(); });
  it("Next内部URL是127.0.0.1时仍按真实Host识别localhost来源",()=>{expect(rejectUntrustedApiRequest(request({host:"localhost:3000",origin:"http://localhost:3000"},"http://127.0.0.1:3000/api/analyze/stream"))).toBeUndefined();});
  it.each(["https://untrusted.invalid","null","http://localhost:4000"])("拒绝其他源 %s",origin=>{expect(rejectUntrustedApiRequest(request({origin}))?.status).toBe(403);});
  it("拒绝跨站Fetch及可简单发送的text/plain JSON",()=>{expect(rejectUntrustedApiRequest(request({"sec-fetch-site":"cross-site"}))?.status).toBe(403); expect(rejectUntrustedApiRequest(request({"content-type":"text/plain"}))?.status).toBe(415);});
  it("读取同样拒绝DNS重绑定Host，不能借恶意域名读书架",()=>{expect(rejectUntrustedApiRequest(request({host:"attacker.invalid"},"http://127.0.0.1:3000/api/library","GET"))?.status).toBe(403);});
  it("仅导入接口接受同源multipart",()=>{expect(rejectUntrustedApiRequest(request({origin:"http://localhost:3000","content-type":"multipart/form-data; boundary=test"},"http://localhost:3000/api/import"))).toBeUndefined();expect(rejectUntrustedApiRequest(request({"content-type":"multipart/form-data"}))?.status).toBe(415);});
  it("显式站点来源可支持反向代理，但不放行任意Origin",()=>{expect(rejectUntrustedApiRequest(request({origin:"https://reader.example",host:"localhost:3000"}),"https://reader.example")).toBeUndefined();expect(rejectUntrustedApiRequest(request({origin:"https://untrusted.invalid"}),"https://reader.example")?.status).toBe(403);});
  it("错误站点配置不会静默回退成开放接口",()=>{expect(rejectUntrustedApiRequest(request(),"not-a-url")?.status).toBe(503);});
});
