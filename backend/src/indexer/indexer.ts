import { ENV } from "../lib/env";

async function loop() {
  console.log(`[INDEXER] (stub) network=${ENV.NETWORK}`);
  setTimeout(loop, 3000);
}
loop();
