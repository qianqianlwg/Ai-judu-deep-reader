import { expect, it } from "vitest";
import { guideFixture } from "./guide-test-support";
it("导读测试书库与正式书库隔离", () => { const { db } = guideFixture(); expect(db.prepare("SELECT count(*) AS n FROM books").get()).toEqual({ n: 2 }); db.close(); });
