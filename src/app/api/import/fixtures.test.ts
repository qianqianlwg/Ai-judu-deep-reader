import { describe, expect, it } from "vitest";
import { makeEpub, makePdf } from "./fixtures";
describe("synthetic import fixtures", () => {
  it("generates deterministic ZIP and PDF bytes without private files", () => {
    expect(makeEpub().subarray(0, 2).toString()).toBe("PK"); expect(makeEpub()).toEqual(makeEpub());
    expect(makePdf().subarray(0, 8).toString()).toBe("%PDF-1.4"); expect(makePdf()).toEqual(makePdf());
    expect(makeEpub(true)).not.toEqual(makeEpub());
  });
});
