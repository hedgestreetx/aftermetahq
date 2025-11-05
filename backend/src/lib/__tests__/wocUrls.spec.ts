import { describe, expect, it } from "../../testUtils/vitest-shim";

import { wocApiBase, wocApiNetworkSegment, wocWebTxUrl } from "../wocUrls";

describe("wocUrls", () => {
  it("normalizes mainnet and livenet", () => {
    expect(wocApiNetworkSegment("mainnet")).toBe("main");
    expect(wocApiNetworkSegment("livenet")).toBe("main");
    expect(wocApiBase("mainnet")).toBe("https://api.whatsonchain.com/v1/bsv/main");
    expect(wocWebTxUrl("abc", "mainnet")).toBe("https://whatsonchain.com/tx/abc");
  });

  it("handles testnet aliases", () => {
    expect(wocApiNetworkSegment("testnet")).toBe("test");
    expect(wocApiNetworkSegment("test")).toBe("test");
    expect(wocApiBase("test")).toBe("https://api.whatsonchain.com/v1/bsv/test");
    expect(wocWebTxUrl("abc", "test")).toBe("https://test.whatsonchain.com/tx/abc");
  });

  it("supports stn", () => {
    expect(wocApiNetworkSegment("stn")).toBe("stn");
    expect(wocApiBase("stn")).toBe("https://api.whatsonchain.com/v1/bsv/stn");
    expect(wocWebTxUrl("abc", "stn")).toBe("https://stn.whatsonchain.com/tx/abc");
  });
});
