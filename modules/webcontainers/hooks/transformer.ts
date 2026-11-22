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

type WebContainerNode = WebContainerFile | WebContainerDirectory;

type WebContainerFileSystem = Record<string, WebContainerNode>;

function isTemplateFolder(item: TemplateItem): item is TemplateFolder {
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

export function transformToWebContainerFormat(
  template: TemplateFolder
): WebContainerFileSystem {
  if (!template || !Array.isArray(template.items)) {
    throw new Error("Invalid template structure received.");
  }

  console.time("Template transformation");

  const result: WebContainerFileSystem = {};

  // Use an iterative approach instead of recursive calls.
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

      if (!name) {
        throw new Error("Template contains an item with an empty name.");
      }

      if (name in current.target) {
        throw new Error(`Duplicate template item: ${name}`);
      }

      if (isTemplateFolder(item)) {
        if (!Array.isArray(item.items)) {
          throw new Error(`Invalid folder structure: ${name}`);
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
        if (typeof item.content !== "string") {
          throw new Error(`Invalid file content: ${name}`);
        }

        current.target[name] = {
          file: {
            contents: item.content,
          },
        };

        processedFiles++;
      }
    }
  }

  console.log("Template transformation complete:", {
    files: processedFiles,
    folders: processedFolders,
  });

  console.timeEnd("Template transformation");

  return result;
}