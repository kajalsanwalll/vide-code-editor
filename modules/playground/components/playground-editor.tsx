"use client"

import { useRef, useEffect, useCallback, useState } from "react"
import Editor, { type Monaco } from "@monaco-editor/react"

import { TemplateFile } from "../lib/path-to-json"
import {
  configureMonaco,
  defaultEditorOptions,
  getEditorLanguage,
} from "../lib/editor-config"

interface PlaygroundEditorProps {
  activeFile: TemplateFile | undefined
  content: string
  onContentChange: (value: string) => void
  suggestion: string | null
  suggestionLoading: boolean
  suggestionPosition: { line: number; column: number } | null
  onAcceptSuggestion: (editor: any, monaco: any) => void
  onRejectSuggestion: (editor: any) => void
  onTriggerSuggestion: (type: string, editor: any) => void
}

export const PlaygroundEditor = ({
  activeFile,
  content,
  onContentChange,
  suggestion,
  suggestionLoading,
  suggestionPosition,
  onAcceptSuggestion,
  onRejectSuggestion,
  onTriggerSuggestion,
}: PlaygroundEditorProps) => {
  const editorRef = useRef<any>(null)
  const monacoRef = useRef<Monaco | null>(null)

  const inlineCompletionProviderRef = useRef<any>(null)

  const currentSuggestionRef = useRef<{
    text: string
    position: { line: number; column: number }
    id: string
  } | null>(null)

  // Keep the latest props available to the provider without
  // registering a new provider every time the suggestion changes.
  const suggestionRef = useRef<string | null>(suggestion)
  const suggestionPositionRef = useRef<{
    line: number
    column: number
  } | null>(suggestionPosition)

  const suggestionLoadingRef = useRef(suggestionLoading)

  const onAcceptSuggestionRef = useRef(onAcceptSuggestion)
  const onRejectSuggestionRef = useRef(onRejectSuggestion)
  const onTriggerSuggestionRef = useRef(onTriggerSuggestion)
  const onContentChangeRef = useRef(onContentChange)

  suggestionRef.current = suggestion
  suggestionPositionRef.current = suggestionPosition
  suggestionLoadingRef.current = suggestionLoading

  onAcceptSuggestionRef.current = onAcceptSuggestion
  onRejectSuggestionRef.current = onRejectSuggestion
  onTriggerSuggestionRef.current = onTriggerSuggestion
  onContentChangeRef.current = onContentChange

  const isAcceptingSuggestionRef = useRef(false)
  const suggestionAcceptedRef = useRef(false)

  const suggestionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )

  const acceptedResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )

  const [editorReady, setEditorReady] = useState(false)

  const generateSuggestionId = () =>
    `suggestion-${Date.now()}-${Math.random()}`

  // --------------------------------------------------
  // Clear current inline suggestion
  // --------------------------------------------------

  const clearCurrentSuggestion = useCallback(() => {
    currentSuggestionRef.current = null

    if (editorRef.current) {
      try {
        editorRef.current.trigger(
          "ai",
          "editor.action.inlineSuggest.hide",
          null,
        )
      } catch (error) {
        console.warn("Could not hide inline suggestion:", error)
      }
    }
  }, [])

  // --------------------------------------------------
  // Check whether a suggestion is at the current cursor
  // --------------------------------------------------

  const hasActiveSuggestionAtPosition = useCallback(() => {
    if (!editorRef.current || !currentSuggestionRef.current) {
      return false
    }

    const position = editorRef.current.getPosition()
    const currentSuggestion = currentSuggestionRef.current

    if (!position) return false

    return (
      position.lineNumber === currentSuggestion.position.line &&
      position.column >= currentSuggestion.position.column &&
      position.column <= currentSuggestion.position.column + 5
    )
  }, [])

  // --------------------------------------------------
  // Accept suggestion
  // --------------------------------------------------

  const acceptCurrentSuggestion = useCallback(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    const currentSuggestion = currentSuggestionRef.current

    if (!editor || !monaco || !currentSuggestion) {
      return false
    }

    if (
      isAcceptingSuggestionRef.current ||
      suggestionAcceptedRef.current
    ) {
      return false
    }

    // Lock immediately to prevent duplicate acceptance
    isAcceptingSuggestionRef.current = true
    suggestionAcceptedRef.current = true

    try {
      const cleanSuggestionText = currentSuggestion.text.replace(/\r/g, "")

      const currentPosition = editor.getPosition()
      const suggestionPos = currentSuggestion.position

      if (!currentPosition) {
        return false
      }

      // Verify the cursor is still near the suggestion
      if (
        currentPosition.lineNumber !== suggestionPos.line ||
        currentPosition.column < suggestionPos.column ||
        currentPosition.column > suggestionPos.column + 5
      ) {
        console.warn("Cursor moved. Cannot accept suggestion.")
        return false
      }

      const range = new monaco.Range(
        suggestionPos.line,
        suggestionPos.column,
        suggestionPos.line,
        suggestionPos.column,
      )

      const success = editor.executeEdits("ai-suggestion-accept", [
        {
          range,
          text: cleanSuggestionText,
          forceMoveMarkers: true,
        },
      ])

      if (!success) {
        console.error("Failed to insert suggestion")
        return false
      }

      // Calculate where the cursor should end up
      const lines = cleanSuggestionText.split("\n")

      const endLine = suggestionPos.line + lines.length - 1

      const endColumn =
        lines.length === 1
          ? suggestionPos.column + cleanSuggestionText.length
          : lines[lines.length - 1].length + 1

      editor.setPosition({
        lineNumber: endLine,
        column: endColumn,
      })

      editor.focus()

      clearCurrentSuggestion()

      // Notify parent
      onAcceptSuggestionRef.current(editor, monaco)

      return true
    } catch (error) {
      console.error("Error accepting suggestion:", error)
      return false
    } finally {
      isAcceptingSuggestionRef.current = false

      // Prevent accidental double acceptance briefly
      if (acceptedResetTimeoutRef.current) {
        clearTimeout(acceptedResetTimeoutRef.current)
      }

      acceptedResetTimeoutRef.current = setTimeout(() => {
        suggestionAcceptedRef.current = false
      }, 500)
    }
  }, [clearCurrentSuggestion])

  // --------------------------------------------------
  // Create Monaco inline completion provider
  // --------------------------------------------------

  const createInlineCompletionProvider = useCallback(
    (monaco: Monaco) => {
      return {
        provideInlineCompletions: async (
          model: any,
          position: any,
          context: any,
          token: any,
        ) => {
          // Ignore canceled requests
          if (token?.isCancellationRequested) {
            return { items: [] }
          }

          if (
            isAcceptingSuggestionRef.current ||
            suggestionAcceptedRef.current
          ) {
            return { items: [] }
          }

          const currentSuggestion = suggestionRef.current
          const currentSuggestionPosition =
            suggestionPositionRef.current

          if (
            !currentSuggestion ||
            !currentSuggestionPosition
          ) {
            return { items: [] }
          }

          const currentLine = position.lineNumber
          const currentColumn = position.column

          const isPositionMatch =
            currentLine === currentSuggestionPosition.line &&
            currentColumn >= currentSuggestionPosition.column &&
            currentColumn <= currentSuggestionPosition.column + 5

          if (!isPositionMatch) {
            return { items: [] }
          }

          // Don't provide stale results if Monaco canceled this request
          if (token?.isCancellationRequested) {
            return { items: [] }
          }

          const suggestionId = generateSuggestionId()

          currentSuggestionRef.current = {
            text: currentSuggestion,
            position: currentSuggestionPosition,
            id: suggestionId,
          }

          const cleanSuggestion = currentSuggestion.replace(/\r/g, "")

          return {
            items: [
              {
                insertText: cleanSuggestion,

                range: new monaco.Range(
                  currentSuggestionPosition.line,
                  currentSuggestionPosition.column,
                  currentSuggestionPosition.line,
                  currentSuggestionPosition.column,
                ),

                kind: monaco.languages.CompletionItemKind.Snippet,

                label: "AI Suggestion",

                detail: "AI-generated code suggestion",

                documentation: "Press Tab to accept",

                sortText: "0000",

                filterText: "",

                insertTextRules:
                  monaco.languages.CompletionItemInsertTextRule
                    .InsertAsSnippet,
              },
            ],
          }
        },

        // REQUIRED by Monaco 0.55.1
        // Replaces the old freeInlineCompletions method.
        disposeInlineCompletions: (
          completions: any,
          reason: any,
        ) => {
          // No external resources are held by these completions.
          // Monaco can safely dispose of them.
        },
      }
    },
    [],
  )

  // --------------------------------------------------
  // Register provider
  //
  // Provider is registered once per language rather than
  // once per AI suggestion.
  // --------------------------------------------------

  useEffect(() => {
    if (!editorReady || !editorRef.current || !monacoRef.current) {
      return
    }

    const monaco = monacoRef.current

    const language = getEditorLanguage(
      activeFile?.fileExtension || "",
    )

    // Dispose previous provider if language changes
    if (inlineCompletionProviderRef.current) {
      inlineCompletionProviderRef.current.dispose()
      inlineCompletionProviderRef.current = null
    }

    const provider = createInlineCompletionProvider(monaco)

    inlineCompletionProviderRef.current =
      monaco.languages.registerInlineCompletionsProvider(
        language,
        provider,
      )

    return () => {
      if (inlineCompletionProviderRef.current) {
        inlineCompletionProviderRef.current.dispose()
        inlineCompletionProviderRef.current = null
      }

      currentSuggestionRef.current = null
    }
  }, [editorReady, activeFile, createInlineCompletionProvider])

  // --------------------------------------------------
  // Trigger inline suggestion whenever the AI suggestion
  // or its position updates.
  // --------------------------------------------------

  useEffect(() => {
    const editor = editorRef.current

    if (!editor || !monacoRef.current) return

    if (!suggestion || !suggestionPosition) {
      clearCurrentSuggestion()
      return
    }

    if (
      isAcceptingSuggestionRef.current ||
      suggestionAcceptedRef.current
    ) {
      return
    }

    currentSuggestionRef.current = null

    // Hide previous ghost text
    editor.trigger(
      "ai",
      "editor.action.inlineSuggest.hide",
      null,
    )

    const timeout = setTimeout(() => {
      if (
        editorRef.current &&
        !isAcceptingSuggestionRef.current &&
        !suggestionAcceptedRef.current
      ) {
        editorRef.current.trigger(
          "ai",
          "editor.action.inlineSuggest.trigger",
          null,
        )
      }
    }, 50)

    return () => clearTimeout(timeout)
  }, [suggestion, suggestionPosition, clearCurrentSuggestion])

  // --------------------------------------------------
  // Update editor language when file changes
  // --------------------------------------------------

  const updateEditorLanguage = useCallback(() => {
    if (!activeFile || !monacoRef.current || !editorRef.current) {
      return
    }

    const model = editorRef.current.getModel()

    if (!model) return

    const language = getEditorLanguage(
      activeFile.fileExtension || "",
    )

    try {
      monacoRef.current.editor.setModelLanguage(model, language)
    } catch (error) {
      console.warn("Failed to set editor language:", error)
    }
  }, [activeFile])

  useEffect(() => {
    updateEditorLanguage()
  }, [updateEditorLanguage])

  // --------------------------------------------------
  // Editor mount
  // --------------------------------------------------

  const handleEditorDidMount = useCallback(
    (editor: any, monaco: Monaco) => {
      editorRef.current = editor
      monacoRef.current = monaco

      configureMonaco(monaco)

      editor.updateOptions({
        ...defaultEditorOptions,

        inlineSuggest: {
          enabled: true,
          mode: "prefix",
          suppressSuggestions: false,
        },

        suggest: {
          preview: false,
          showInlineDetails: false,
          insertMode: "replace",
        },

        quickSuggestions: {
          other: true,
          comments: false,
          strings: false,
        },

        cursorSmoothCaretAnimation: "on",
      })

      // Ctrl/Cmd + Space: manual AI completion
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space,
        () => {
          onTriggerSuggestionRef.current("completion", editor)
        },
      )

      // --------------------------------------------------
      // Tab: accept inline suggestion
      // --------------------------------------------------

      editor.addCommand(
        monaco.KeyCode.Tab,
        () => {
          if (isAcceptingSuggestionRef.current) {
            return
          }

          // If already accepted, let Tab behave normally
          if (suggestionAcceptedRef.current) {
            editor.trigger("keyboard", "tab", null)
            return
          }

          if (
            currentSuggestionRef.current &&
            hasActiveSuggestionAtPosition()
          ) {
            const accepted = acceptCurrentSuggestion()

            if (accepted) {
              return
            }
          }

          // Normal indentation
          editor.trigger("keyboard", "tab", null)
        },
        "editorTextFocus && !editorReadonly",
      )

      // --------------------------------------------------
      // Escape: reject suggestion
      // --------------------------------------------------

      editor.addCommand(monaco.KeyCode.Escape, () => {
        if (currentSuggestionRef.current) {
          onRejectSuggestionRef.current(editor)
          clearCurrentSuggestion()
        }
      })

      // --------------------------------------------------
      // Cursor position listener
      // --------------------------------------------------

      editor.onDidChangeCursorPosition((e: any) => {
        if (isAcceptingSuggestionRef.current) return

        const newPosition = e.position

        const currentSuggestion = currentSuggestionRef.current

        if (
          currentSuggestion &&
          !suggestionAcceptedRef.current
        ) {
          const suggestionPos = currentSuggestion.position

          const movedAway =
            newPosition.lineNumber !== suggestionPos.line ||
            newPosition.column < suggestionPos.column ||
            newPosition.column > suggestionPos.column + 10

          if (movedAway) {
            clearCurrentSuggestion()
            onRejectSuggestionRef.current(editor)
          }
        }

        // Debounce automatic suggestions
        if (
          !currentSuggestionRef.current &&
          !suggestionLoadingRef.current &&
          !suggestionAcceptedRef.current
        ) {
          if (suggestionTimeoutRef.current) {
            clearTimeout(suggestionTimeoutRef.current)
          }

          suggestionTimeoutRef.current = setTimeout(() => {
            if (
              editorRef.current &&
              !currentSuggestionRef.current &&
              !suggestionLoadingRef.current &&
              !suggestionAcceptedRef.current
            ) {
              onTriggerSuggestionRef.current(
                "completion",
                editor,
              )
            }
          }, 400)
        }
      })

      // --------------------------------------------------
      // Content changes
      // --------------------------------------------------

      editor.onDidChangeModelContent((e: any) => {
        if (isAcceptingSuggestionRef.current) {
          return
        }

        // Clear any existing AI suggestion when the user types
        if (
          currentSuggestionRef.current &&
          e.changes.length > 0 &&
          !suggestionAcceptedRef.current
        ) {
          const change = e.changes[0]

          const currentSuggestion =
            currentSuggestionRef.current

          const isOurInsertion =
            change.text === currentSuggestion.text ||
            change.text ===
              currentSuggestion.text.replace(/\r/g, "")

          if (!isOurInsertion) {
            clearCurrentSuggestion()
          }
        }

        // Trigger completion after useful typing patterns
        if (
          e.changes.length > 0 &&
          !suggestionAcceptedRef.current
        ) {
          const change = e.changes[0]

          const triggerCharacters = [
            "\n",
            "{",
            ".",
            "=",
            "(",
            ",",
            ":",
            ";",
          ]

          if (triggerCharacters.includes(change.text)) {
            if (suggestionTimeoutRef.current) {
              clearTimeout(suggestionTimeoutRef.current)
            }

            suggestionTimeoutRef.current = setTimeout(() => {
              if (
                editorRef.current &&
                !currentSuggestionRef.current &&
                !suggestionLoadingRef.current &&
                !suggestionAcceptedRef.current
              ) {
                onTriggerSuggestionRef.current(
                  "completion",
                  editor,
                )
              }
            }, 150)
          }
        }
      })

      updateEditorLanguage()

      setEditorReady(true)
    },
    [
      acceptCurrentSuggestion,
      clearCurrentSuggestion,
      hasActiveSuggestionAtPosition,
      updateEditorLanguage,
    ],
  )

  // --------------------------------------------------
  // Editor cleanup
  // --------------------------------------------------

  const handleEditorWillUnmount = useCallback(() => {
    setEditorReady(false)

    if (suggestionTimeoutRef.current) {
      clearTimeout(suggestionTimeoutRef.current)
      suggestionTimeoutRef.current = null
    }

    if (acceptedResetTimeoutRef.current) {
      clearTimeout(acceptedResetTimeoutRef.current)
      acceptedResetTimeoutRef.current = null
    }

    if (inlineCompletionProviderRef.current) {
      inlineCompletionProviderRef.current.dispose()
      inlineCompletionProviderRef.current = null
    }

    currentSuggestionRef.current = null

    editorRef.current = null
    monacoRef.current = null
  }, [])

  // --------------------------------------------------
  // Component unmount cleanup
  // --------------------------------------------------

  useEffect(() => {
    return () => {
      if (suggestionTimeoutRef.current) {
        clearTimeout(suggestionTimeoutRef.current)
      }

      if (acceptedResetTimeoutRef.current) {
        clearTimeout(acceptedResetTimeoutRef.current)
      }

      if (inlineCompletionProviderRef.current) {
        inlineCompletionProviderRef.current.dispose()
        inlineCompletionProviderRef.current = null
      }
    }
  }, [])

  // --------------------------------------------------
  // UI
  // --------------------------------------------------

  return (
    <div className="h-full relative">
      {/* AI loading indicator */}
      {suggestionLoading && (
        <div className="absolute top-2 right-2 z-10 bg-red-100 dark:bg-red-900 px-2 py-1 rounded text-xs text-red-700 dark:text-red-300 flex items-center gap-1">
          <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          AI thinking...
        </div>
      )}

      {/* Suggestion indicator */}
      {suggestion && !suggestionLoading && (
        <div className="absolute top-2 right-2 z-10 bg-green-100 dark:bg-green-900 px-2 py-1 rounded text-xs text-green-700 dark:text-green-300 flex items-center gap-1">
          <div className="w-2 h-2 bg-green-500 rounded-full" />
          Press Tab to accept
        </div>
      )}

      <Editor
        height="100%"
        value={content}
        onChange={(value) => onContentChangeRef.current(value || "")}
        onMount={handleEditorDidMount}
        onUnmount={handleEditorWillUnmount}
        language={
          activeFile
            ? getEditorLanguage(activeFile.fileExtension || "")
            : "plaintext"
        }
        options={defaultEditorOptions}
      />
    </div>
  )
}