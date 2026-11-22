
"use client";

import React, { useEffect, useState, useRef } from "react";
import { transformToWebContainerFormat } from "../hooks/transformer";
import {
  CheckCircle,
  Loader2,
  XCircle,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { WebContainer } from "@webcontainer/api";
import type { TemplateFolder } from "@/modules/playground/lib/path-to-json";

interface WebContainerPreviewProps {
  templateData: TemplateFolder;
  serverUrl: string;
  isLoading: boolean;
  error: string | null;
  instance: WebContainer | null;
  writeFileSync: (
    path: string,
    content: string
  ) => Promise<void>;
  forceResetup?: boolean;
}

// Find package.json at the root or inside a nested project folder.
async function findPackageJsonDirectory(
  instance: WebContainer,
  directory = "/"
): Promise<string | null> {
  try {
    await instance.fs.readFile(
      directory === "/" ? "/package.json" : `${directory}/package.json`,
      "utf8"
    );

    return directory;
  } catch {
    // Continue searching.
  }

  let entries: string[];

  try {
    entries = await instance.fs.readdir(directory);
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (
      entry === "node_modules" ||
      entry === ".git" ||
      entry === ".next"
    ) {
      continue;
    }

    const childPath =
      directory === "/" ? `/${entry}` : `${directory}/${entry}`;

    const result = await findPackageJsonDirectory(
      instance,
      childPath
    );

    if (result !== null) return result;
  }

  return null;
}

// Remove existing files before mounting a different playground.
async function clearWebContainer(instance: WebContainer) {
  const entries = await instance.fs.readdir("/");

  for (const entry of entries) {
    if (entry === "." || entry === "..") continue;

    await instance.fs.rm(`/${entry}`, {
      recursive: true,
      force: true,
    });
  }
}

const WebContainerPreview = ({
  templateData,
  error,
  instance,
  isLoading,
  forceResetup = false,
}: WebContainerPreviewProps) => {
  const [previewUrl, setPreviewUrl] = useState("");

  const [loadingState, setLoadingState] = useState({
    transforming: false,
    mounting: false,
    installing: false,
    starting: false,
    ready: false,
  });

  const [TerminalComponent, setTerminalComponent] =
    useState<React.ForwardRefExoticComponent<any> | null>(null);

  const [currentStep, setCurrentStep] = useState(0);
  const totalSteps = 4;

  const [setupError, setSetupError] = useState<string | null>(null);

  const [isSetupComplete, setIsSetupComplete] = useState(false);
  const [isStaticWorkspace, setIsStaticWorkspace] = useState(false);

  const isSetupInProgressRef = useRef(false);
  const terminalRef = useRef<any>(null);
  const setupKeyRef = useRef<string | null>(null);

  const writeTerminal = (message: string) => {
    terminalRef.current?.writeToTerminal?.(message);
  };

  // Reset setup state when the selected template changes.
  useEffect(() => {
    if (!templateData) return;

    const templateKey = JSON.stringify(templateData);

    if (setupKeyRef.current === templateKey && !forceResetup) {
      return;
    }

    setupKeyRef.current = templateKey;
    isSetupInProgressRef.current = false;

    setIsSetupComplete(false);
setIsStaticWorkspace(false);
setSetupError(null);
setPreviewUrl("");
setCurrentStep(0);

    setLoadingState({
      transforming: false,
      mounting: false,
      installing: false,
      starting: false,
      ready: false,
    });
  }, [templateData, forceResetup]);

  // Main WebContainer setup.
  useEffect(() => {
    let cancelled = false;

    async function setupContainer() {
      if (
        !instance ||
        !templateData ||
        isLoading ||
        isSetupComplete ||
        isSetupInProgressRef.current
      ) {
        return;
      }

      isSetupInProgressRef.current = true;

      try {
        setSetupError(null);
        setPreviewUrl("");

        // STEP 1: Transform template.
        setLoadingState((prev) => ({
          ...prev,
          transforming: true,
        }));

        setCurrentStep(1);

        writeTerminal("Transforming template data...\r\n");

        const files = transformToWebContainerFormat(templateData);

        console.log("[WEBCONTAINER] Prepared root files:", Object.keys(files));

        if (cancelled) return;

        // STEP 2: Clear and mount the selected template.
        setLoadingState((prev) => ({
          ...prev,
          transforming: false,
          mounting: true,
        }));

        setCurrentStep(2);

        writeTerminal("Clearing previous project files...\r\n");

        await clearWebContainer(instance);

        if (cancelled) return;

        writeTerminal("Mounting selected playground...\r\n");

        console.log("========== MOUNT DEBUG ==========");
        console.log("Template folder:", templateData.folderName);
        console.log("Root files:", Object.keys(files));
        console.log("Payload size:", JSON.stringify(files).length);
        console.time("WebContainer mount");

        await instance.mount(files);

        console.timeEnd("WebContainer mount");

        if (cancelled) return;

        const rootFiles = await instance.fs.readdir("/");

        console.log("[WEBCONTAINER] Mounted root files:", rootFiles);

        writeTerminal("Files mounted successfully.\r\n");

        setLoadingState((prev) => ({
          ...prev,
          mounting: false,
        }));

        const projectRoot = await findPackageJsonDirectory(instance);

if (!projectRoot) {
  console.log(
    "[WEBCONTAINER] No package.json found. Opening as a regular workspace."
  );

  writeTerminal(
    "\r\nWorkspace opened successfully.\r\n" +
    "No package.json detected. Skipping dependency installation and development server.\r\n"
  );

  setIsStaticWorkspace(true);
  setIsSetupComplete(true);
  isSetupInProgressRef.current = false;
  setCurrentStep(2);

  setLoadingState({
    transforming: false,
    mounting: false,
    installing: false,
    starting: false,
    ready: false,
  });

  return;
}

console.log("[WEBCONTAINER] Project root:", projectRoot);

        console.log("[WEBCONTAINER] Project root:", projectRoot);

        // STEP 3: Install dependencies.
        setLoadingState((prev) => ({
          ...prev,
          installing: true,
        }));

        setCurrentStep(3);

        writeTerminal("\r\nInstalling dependencies...\r\n");
        writeTerminal(`Project directory: ${projectRoot}\r\n`);

        const installProcess = await instance.spawn(
          "npm",
          ["install", "--verbose"],
          { cwd: projectRoot }
        );

        const npmLogs: string[] = [];

        const outputPromise = installProcess.output.pipeTo(
          new WritableStream({
            write(data) {
              const output = String(data);
              npmLogs.push(output);
              console.log("[NPM INSTALL]", output);
              writeTerminal(output);
            },
          })
        );

        const installExitCode = await installProcess.exit;
        await outputPromise;

        try {
  const debugLog = await instance.fs.readFile(
    "/home/.npm/_logs/2026-11-22T15_40_17_259Z-debug-0.log",
    "utf8"
  );

  console.log("========== FULL NPM DEBUG LOG ==========");
  console.log(debugLog);
  console.log("========== END NPM DEBUG LOG ==========");
} catch (error) {
  console.error("Unable to read npm debug log:", error);
}

        console.log("[NPM] Exit code:", installExitCode);

        if (cancelled) return;

        if (installExitCode !== 0) {
          throw new Error(
            `npm install failed with exit code ${installExitCode}.\n\nLast npm output:\n${npmLogs.join("").slice(-12000)}`
          );
        }

        writeTerminal("Dependencies installed successfully!\r\n");

        // STEP 4: Start development server.
        setLoadingState((prev) => ({
          ...prev,
          installing: false,
          starting: true,
        }));

        setCurrentStep(4);

        const packageJsonPath =
          `${projectRoot === "/" ? "" : projectRoot}/package.json`;

        const rawPackageJson = await instance.fs.readFile(
          packageJsonPath,
          "utf8"
        );

        const packageJson = JSON.parse(rawPackageJson);
        const scripts = packageJson.scripts || {};

        const startScript = scripts.dev
          ? "dev"
          : scripts.start
            ? "start"
            : null;

        if (!startScript) {
          throw new Error(
            "No 'dev' or 'start' script found in package.json."
          );
        }

        writeTerminal(`Running npm run ${startScript}...\r\n`);

        // Listen before starting the process.
        const handleServerReady = (port: number, url: string) => {
          if (cancelled) return;

          console.log("[WEBCONTAINER] Server ready:", port, url);

          writeTerminal(`Server ready on port ${port}: ${url}\r\n`);

          setPreviewUrl(url);

          setLoadingState({
            transforming: false,
            mounting: false,
            installing: false,
            starting: false,
            ready: true,
          });

          setIsSetupComplete(true);
          isSetupInProgressRef.current = false;
        };

        instance.on("server-ready", handleServerReady);

        const startProcess = await instance.spawn(
          "npm",
          ["run", startScript],
          { cwd: projectRoot }
        );

        startProcess.output
          .pipeTo(
            new WritableStream({
              write(data) {
                console.log("[DEV SERVER]", data);
                writeTerminal(String(data));
              },
            })
          )
          .catch((streamError) => {
            console.error("Development server output error:", streamError);
          });

        startProcess.exit.then((exitCode) => {
          if (cancelled || exitCode === 0) return;

          console.error("Development server exited with code:", exitCode);

          setSetupError(
            `Development server exited with code ${exitCode}. Check terminal output.`
          );

          isSetupInProgressRef.current = false;
        });
      } catch (err) {
        if (cancelled) return;

        console.error("Error setting up container:", err);

        const errorMessage =
          err instanceof Error ? err.message : String(err);

        writeTerminal(`\r\nERROR: ${errorMessage}\r\n`);

        setSetupError(errorMessage);
        isSetupInProgressRef.current = false;

        setLoadingState({
          transforming: false,
          mounting: false,
          installing: false,
          starting: false,
          ready: false,
        });
      }
    }

    setupContainer();

    return () => {
      cancelled = true;
    };
  }, [
    instance,
    templateData,
    isLoading,
    isSetupComplete,
    forceResetup,
  ]);

  // Dynamically load terminal.
  useEffect(() => {
    let mounted = true;

    import("./terminal")
      .then(({ default: Terminal }) => {
        if (mounted) {
          setTerminalComponent(() => Terminal);
        }
      })
      .catch((error) => {
        console.error("Failed to load terminal:", error);
      });

    return () => {
      mounted = false;
    };
  }, []);

  // Initial WebContainer loading screen.
  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md p-6 rounded-lg bg-gray-50 dark:bg-gray-900">
          <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
          <h3 className="text-lg font-medium">
            Initializing WebContainer
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Setting up the environment for your project...
          </p>
        </div>
      </div>
    );
  }

  // Error screen.
  if (error || setupError) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-6 rounded-lg max-w-md">
          <div className="flex items-center gap-2 mb-3">
            <XCircle className="h-5 w-5" />
            <h3 className="font-semibold">Error</h3>
          </div>

          <p className="text-sm whitespace-pre-wrap break-words">
            {error || setupError}
          </p>

          <div className="mt-4 text-xs opacity-80">
            Check the terminal output and browser console for the detailed error.
          </div>
        </div>
      </div>
    );
  }

  // Step icons.
  const getStepIcon = (stepIndex: number) => {
    if (stepIndex < currentStep) {
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    }

    if (stepIndex === currentStep) {
      return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />;
    }

    return (
      <div className="h-5 w-5 rounded-full border-2 border-gray-300" />
    );
  };

  // Step labels.
  const getStepText = (stepIndex: number, label: string) => {
    const isActive = stepIndex === currentStep;
    const isComplete = stepIndex < currentStep;

    return (
      <span
        className={`text-sm font-medium ${
          isComplete
            ? "text-green-600"
            : isActive
              ? "text-blue-600"
              : "text-gray-500"
        }`}
      >
        {label}
      </span>
    );
  };

  return (
  <div className="h-full w-full flex flex-col">
    {isStaticWorkspace ? (
      <div className="h-full flex flex-col">
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md text-center space-y-3">
            <CheckCircle className="h-10 w-10 text-green-500 mx-auto" />

            <h3 className="text-lg font-semibold">
              Workspace Ready
            </h3>

            <p className="text-sm text-muted-foreground">
              Your files are ready to edit. This workspace does not
              contain a package.json, so no development server is
              required.
            </p>
          </div>
        </div>

        <div className="h-64 border-t">
          {TerminalComponent ? (
            <TerminalComponent
              ref={terminalRef}
              webContainerInstance={instance}
              theme="dark"
              className="h-full"
            />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              Loading terminal...
            </div>
          )}
        </div>
      </div>
    ) : !previewUrl ? (
        <div className="h-full flex flex-col">
          <div className="w-full max-w-md p-6 m-5 rounded-lg bg-white dark:bg-zinc-800 shadow-sm mx-auto">
            <Progress
              value={(currentStep / totalSteps) * 100}
              className="h-2 mb-6"
            />

            <div className="space-y-4 mb-6">
              <div className="flex items-center gap-3">
                {getStepIcon(1)}
                {getStepText(1, "Transforming template data")}
              </div>

              <div className="flex items-center gap-3">
                {getStepIcon(2)}
                {getStepText(2, "Mounting files")}
              </div>

              <div className="flex items-center gap-3">
                {getStepIcon(3)}
                {getStepText(3, "Installing dependencies")}
              </div>

              <div className="flex items-center gap-3">
                {getStepIcon(4)}
                {getStepText(4, "Starting development server")}
              </div>
            </div>
          </div>

          <div className="flex-1 p-4">
            {TerminalComponent ? (
              <TerminalComponent
                ref={terminalRef}
                webContainerInstance={instance}
                theme="dark"
                className="h-full"
              />
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                Loading terminal...
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="h-full flex flex-col">
          <div className="flex-1">
            <iframe
              src={previewUrl}
              className="w-full h-full border-none"
              title="WebContainer Preview"
            />
          </div>

          <div className="h-64 border-t">
            {TerminalComponent ? (
              <TerminalComponent
                ref={terminalRef}
                webContainerInstance={instance}
                theme="dark"
                className="h-full"
              />
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                Loading terminal...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default WebContainerPreview;
