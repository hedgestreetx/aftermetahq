import { Router } from "express";
import admin from "./admin";
import pools from "./pools";
import mints, { mintQuoteRoute, mintRoute } from "./mints";
import tx from "./tx";
import buy from "./buy";

const api = Router();

api.use("/", admin);
api.use("/v1/pools", pools);
api.post("/v1/mint/quote", mintQuoteRoute);
api.post("/v1/mint", ...mintRoute);
api.use("/v1/mints", mints);
api.use("/v1/tx", tx);
api.use(buy);

export default api;
