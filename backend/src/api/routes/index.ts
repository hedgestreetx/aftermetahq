import { Router } from "express";
import admin from "./admin";
import pools from "./pools";
import mints, { buyOrderRoute, buyQuoteRoute, mintQuoteRoute, mintRoute } from "./mints";
import tx from "./tx";

const api = Router();

api.use("/", admin);
api.use("/v1/pools", pools);
api.post("/v1/buy/quote", buyQuoteRoute);
api.post("/v1/buy/order", ...buyOrderRoute);
api.post("/v1/mint/quote", mintQuoteRoute);
api.post("/v1/mint", ...mintRoute);
api.use("/v1/mints", mints);
api.use("/v1/tx", tx);

export default api;
