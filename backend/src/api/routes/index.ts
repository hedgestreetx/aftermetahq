import { Router } from "express";

import mintRoutes from "./mint";

const router = Router();

router.use(mintRoutes);

export default router;
