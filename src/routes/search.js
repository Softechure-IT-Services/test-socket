import express from "express";
import verifyToken from "../middleware/auth.js";
import { searchAll } from "../controllers/search.controller.js";

const router = express.Router();

router.use(verifyToken);

/** GET /search?q=<query> */
router.get("/", searchAll);

export default router;