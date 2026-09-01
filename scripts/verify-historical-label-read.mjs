import { getRuntimeBindings } from "../lib/runtime-bindings.mjs";
import { verifyHistoricalLabelRead } from "../lib/fulfillment-api-sync.mjs";

const result = await verifyHistoricalLabelRead(await getRuntimeBindings());
process.stdout.write(`${JSON.stringify(result)}\n`);
