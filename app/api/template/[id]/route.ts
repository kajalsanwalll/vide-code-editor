import { db } from "@/lib/db";
import { templatePaths } from "@/lib/template";
import { scanTemplateDirectory } from "@/modules/playground/lib/path-to-json";
import path from "path";
import { NextRequest } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return Response.json(
        { error: "Missing playground ID" },
        { status: 400 }
      );
    }

    // 1. Find playground
    const playground = await db.playground.findUnique({
      where: { id },
    });

    if (!playground) {
      console.error("Playground not found in database:", id);

      return Response.json(
        { error: "Playground not found", id },
        { status: 404 }
      );
    }

    // 2. Resolve template
    const templateKey = playground.template as keyof typeof templatePaths;
    const templatePath = templatePaths[templateKey];

    if (!templatePath) {
      console.error("Invalid template:", playground.template);
      console.error("Available templates:", Object.keys(templatePaths));

      return Response.json(
        {
          error: "Invalid template",
          template: playground.template,
          availableTemplates: Object.keys(templatePaths),
        },
        { status: 404 }
      );
    }

    // 3. Resolve the actual directory path
    const inputPath = path.resolve(
  process.cwd(),
  templatePath.replace(/^[/\\]+/, "")
);

    console.log("Loading playground:", id);
    console.log("Template key:", templateKey);
    console.log("Template directory:", inputPath);

    // 4. Scan directly - no temporary JSON file
    const result = await scanTemplateDirectory(inputPath);

    // 5. Return template
    return Response.json(
      {
        success: true,
        templateJson: result,
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("Template loading error:", error);

    return Response.json(
      {
        error: "Failed to generate template",
        details:
          error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}