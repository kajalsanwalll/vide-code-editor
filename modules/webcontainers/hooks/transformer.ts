
import type {
  TemplateFile,
  TemplateFolder,
  TemplateItem,
} from "@/modules/playground/lib/path-to-json";

interface WebContainerFile {
  file: {
    contents: string;
  };
}

interface WebContainerDirectory {
  directory: {
    [key: string]: WebContainerFile | WebContainerDirectory;
  };
}

type WebContainerNode =
  | WebContainerFile
  | WebContainerDirectory;

type WebContainerFileSystem = Record<
  string,
  WebContainerNode
>;

function isTemplateFolder(
  item: TemplateItem
): item is TemplateFolder {
  return "folderName" in item;
}

function getItemName(item: TemplateItem): string {
  if (isTemplateFolder(item)) {
    return item.folderName;
  }

  return item.fileExtension
    ? `${item.filename}.${item.fileExtension}`
    : item.filename;
}

function validateTemplateFile(
  item: TemplateFile,
  name: string
) {
  if (
    typeof item.filename !== "string" ||
    typeof item.content !== "string"
  ) {
    throw new Error(
      `Invalid template file: ${name}`
    );
  }

  if (
    name.includes("/") ||
    name.includes("\\") ||
    name === "." ||
    name === ".."
  ) {
    throw new Error(
      `Invalid template filename: ${name}`
    );
  }
}

export function transformToWebContainerFormat(
  template: TemplateFolder
): WebContainerFileSystem {
  if (
    !template ||
    !Array.isArray(template.items)
  ) {
    throw new Error(
      "Invalid template structure received."
    );
  }

  const result: WebContainerFileSystem = {};

  const stack: {
    items: TemplateItem[];
    target: WebContainerFileSystem;
  }[] = [
    {
      items: template.items,
      target: result,
    },
  ];

  let processedFiles = 0;
  let processedFolders = 0;

  while (stack.length > 0) {
    const current = stack.pop()!;

    for (const item of current.items) {
      const name = getItemName(item);

      if (!name || typeof name !== "string") {
        throw new Error(
          "Template contains an item with an empty name."
        );
      }

      if (
        name.includes("/") ||
        name.includes("\\") ||
        name === "." ||
        name === ".."
      ) {
        throw new Error(
          `Invalid template path: ${name}`
        );
      }

      if (
        Object.prototype.hasOwnProperty.call(
          current.target,
          name
        )
      ) {
        throw new Error(
          `Duplicate template item: ${name}`
        );
      }

      if (isTemplateFolder(item)) {
        if (!Array.isArray(item.items)) {
          throw new Error(
            `Invalid folder structure: ${name}`
          );
        }

        const directory: WebContainerDirectory = {
          directory: {},
        };

        current.target[name] = directory;

        stack.push({
          items: item.items,
          target: directory.directory,
        });

        processedFolders++;
      } else {
        validateTemplateFile(item, name);

        current.target[name] = {
          file: {
            contents: item.content,
          },
        };

        processedFiles++;
      }
    }
  }

  const rootFiles = Object.keys(result);

  const hasPackageJson =
    rootFiles.includes("package.json");

  console.log(
    "[TRANSFORMER] Transformation complete:",
    {
      folderName: template.folderName,
      files: processedFiles,
      folders: processedFolders,
      rootFiles,
      hasPackageJson,
    }
  );

  if (!hasPackageJson) {
    console.warn(
      "[TRANSFORMER] No root package.json found. Check which template was supplied."
    );
  }

  return result;
}
