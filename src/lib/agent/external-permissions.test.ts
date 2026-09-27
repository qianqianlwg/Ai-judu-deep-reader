import { describe, expect, it } from "vitest";
import { emptyExternalPermissions, readExternalPermissions } from "./external-permissions";
describe("本轮授权数据边界", () => { it("默认关闭且字段必须完整", () => { expect(readExternalPermissions(undefined)).toEqual(emptyExternalPermissions()); expect(() => readExternalPermissions({ web: true })).toThrow(); }); });
