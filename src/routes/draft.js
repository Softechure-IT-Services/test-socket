import express from "express";
import { saveDraft, getDraft, deleteDraft } from "../controllers/draft.controller.js";
import authenticateToken from "../middleware/auth.js";

const router = express.Router();

router.post("/", authenticateToken, saveDraft);
router.get("/:entityType/:entityId", authenticateToken, getDraft);
router.delete("/:entityType/:entityId", authenticateToken, deleteDraft);

export default router;
