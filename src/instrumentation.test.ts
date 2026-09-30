import { afterEach, expect, it, vi } from "vitest";
const start = vi.hoisted(() => vi.fn());
vi.mock("./lib/guide-runtime", () => ({ startGuideWorker: start }));
import { register } from "./instrumentation";
afterEach(() => { vi.unstubAllEnvs(); start.mockClear(); });
it("构建和edge不启动后台，node服务启动队列", async () => { vi.stubEnv("NEXT_RUNTIME", "edge"); await register(); expect(start).not.toHaveBeenCalled(); vi.stubEnv("NEXT_RUNTIME", "nodejs"); vi.stubEnv("NEXT_PHASE", "phase-production-build"); await register(); expect(start).not.toHaveBeenCalled(); vi.stubEnv("NEXT_PHASE", "phase-production-server"); await register(); expect(start).toHaveBeenCalledOnce(); });
