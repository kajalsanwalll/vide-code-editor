
"use server";

import { db } from "@/lib/db";
import type { TemplateFolder } from "../lib/path-to-json";
import { currentUser } from "@/modules/auth/actions";

export const getPlaygroundById = async (id: string) => {
  try {
    const user = await currentUser();

    if (!user) {
      throw new Error("Unauthorized");
    }

    const playground = await db.playground.findFirst({
      where: {
        id,
        userId: user.id,
      },
      select: {
        id: true,
        title: true,
        templateFiles: {
          select: {
            content: true,
          },
        },
      },
    });

    if (!playground) {
      throw new Error("Playground not found");
    }

    console.log("[GET PLAYGROUND]", {
      id: playground.id,
      title: playground.title,
      templateFileCount: playground.templateFiles.length,
      contentPreview: String(
  playground.templateFiles[0]?.content ?? ""
).slice(0, 300),
    });

    return playground;
  } catch (error) {
    console.error("getPlaygroundById error:", error);
    throw error;
  }
};

export const SaveUpdatedCode = async (
  playgroundId: string,
  data: TemplateFolder
) => {
  try {
    const user = await currentUser();

    if (!user) {
      throw new Error("Unauthorized");
    }

    const playground = await db.playground.findFirst({
      where: {
        id: playgroundId,
        userId: user.id,
      },
      select: {
        id: true,
      },
    });

    if (!playground) {
      throw new Error("Playground not found or unauthorized");
    }

    if (
      !data ||
      typeof data.folderName !== "string" ||
      !Array.isArray(data.items)
    ) {
      throw new Error("Invalid template structure");
    }

    const updatedPlayground = await db.templateFile.upsert({
      where: {
        playgroundId,
      },
      update: {
        content: JSON.stringify(data),
      },
      create: {
        playgroundId,
        content: JSON.stringify(data),
      },
    });

    return updatedPlayground;
  } catch (error) {
    console.error("SaveUpdatedCode error:", error);
    throw error;
  }
};
