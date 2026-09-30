import { expect, it } from "vitest";
import { GUIDE_SCHEMA } from "./guide-schema";
import { guideFixture } from "./guide-test-support";
it("导读增量迁移幂等且不改阅读表", () => { const { db } = guideFixture(); db.exec(GUIDE_SCHEMA); expect(db.prepare("SELECT count(*) AS n FROM books").get()).toEqual({ n: 2 }); expect(db.prepare("SELECT count(*) AS n FROM guide_sources").get()).toEqual({ n: 0 }); db.close(); });
