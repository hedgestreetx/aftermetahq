import { afterEach, describe, expect, it, vi } from "../../testUtils/vitest-shim";

async function importFresh<T>(modulePath: string): Promise<T> {
  const version = `?v=${Date.now()}-${Math.random()}-${vi.moduleVersion}`;
  return (await import(modulePath + version)) as T;
}

const networks = [
  { input: "mainnet", segment: "/v1/bsv/main/tx/demo/status" },
  { input: "livenet", segment: "/v1/bsv/main/tx/demo/status" },
  { input: "testnet", segment: "/v1/bsv/test/tx/demo/status" },
  { input: "test", segment: "/v1/bsv/test/tx/demo/status" },
  { input: "stn", segment: "/v1/bsv/stn/tx/demo/status" },
];

describe("queryWocTxStatus", () => {
  afterEach(() => {
    delete process.env.NETWORK;
    delete process.env.WOC_BASE;
    vi.resetModules();
  });

  for (const { input, segment } of networks) {
    it(`uses correct API path for ${input}`, async () => {
      process.env.NETWORK = input;
      vi.resetModules();

      const { queryWocTxStatus, __setFetch } = await importFresh<
        typeof import("../woc")
      >("../woc");

      const fetchMock = vi.fn().mockImplementation(async (url: string) => {
        expect(url.includes(segment)).toBe(true);
        return new Response(
          JSON.stringify({ confirmed: true, confirmations: 3, block_height: 123 }),
          { status: 200 }
        );
      });

      __setFetch(fetchMock as any);

      const result = await queryWocTxStatus("demo");
      expect(result.ok).toBe(true);
      expect(result.confirmed).toBe(true);
      expect(result.confirmations).toBe(3);
      expect(result.blockHeight).toBe(123);
    });
  }
});
