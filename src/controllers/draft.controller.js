import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const saveDraft = async (req, res) => {
  try {
    const userId = req.user.id;
    const { entityType, entityId, content, files } = req.body;

    if (!entityType || !entityId) {
      return res.status(400).json({ error: "entityType and entityId are required" });
    }

    const draft = await prisma.drafts.upsert({
      where: {
        user_id_entity_type_entity_id: {
          user_id: userId,
          entity_type: entityType,
          entity_id: parseInt(entityId, 10),
        },
      },
      update: {
        content: content || "",
        files: files ? JSON.stringify(files) : "[]",
      },
      create: {
        user_id: userId,
        entity_type: entityType,
        entity_id: parseInt(entityId, 10),
        content: content || "",
        files: files ? JSON.stringify(files) : "[]",
      },
    });

    res.json({ success: true, draft });
  } catch (error) {
    console.error("Error saving draft:", error);
    res.status(500).json({ error: "Failed to save draft" });
  }
};

export const getDraft = async (req, res) => {
  try {
    const userId = req.user.id;
    const { entityType, entityId } = req.params;

    if (!entityType || !entityId) {
      return res.status(400).json({ error: "entityType and entityId are required" });
    }

    const draft = await prisma.drafts.findUnique({
      where: {
        user_id_entity_type_entity_id: {
          user_id: userId,
          entity_type: entityType,
          entity_id: parseInt(entityId, 10),
        },
      },
    });

    if (!draft) {
      return res.json({ draft: null });
    }

    res.json({ draft });
  } catch (error) {
    console.error("Error fetching draft:", error);
    res.status(500).json({ error: "Failed to fetch draft" });
  }
};

export const deleteDraft = async (req, res) => {
  try {
    const userId = req.user.id;
    const { entityType, entityId } = req.params;

    if (!entityType || !entityId) {
      return res.status(400).json({ error: "entityType and entityId are required" });
    }

    await prisma.drafts.deleteMany({
      where: {
        user_id: userId,
        entity_type: entityType,
        entity_id: parseInt(entityId, 10),
      },
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting draft:", error);
    res.status(500).json({ error: "Failed to delete draft" });
  }
};
