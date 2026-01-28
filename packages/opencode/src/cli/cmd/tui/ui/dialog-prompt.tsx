import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
import { onMount, onCleanup, type JSX } from "solid-js"
import { useKeyboard } from "@opentui/solid"

export type DialogPromptProps = {
  title: string
  description?: () => JSX.Element
  placeholder?: string
  value?: string
  onConfirm?: (value: string) => void
  onCancel?: () => void
}

export function DialogPrompt(props: DialogPromptProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  let textarea: TextareaRenderable
  let focusTimeout: ReturnType<typeof setTimeout> | null = null
  let destroyed = false

  onCleanup(() => {
    destroyed = true
    if (focusTimeout) {
      clearTimeout(focusTimeout)
      focusTimeout = null
    }
  })

  useKeyboard((evt) => {
    if (evt.name === "return" && !destroyed && textarea && !textarea.isDestroyed) {
      props.onConfirm?.(textarea.plainText)
    }
  })

  onMount(() => {
    dialog.setSize("medium")
    focusTimeout = setTimeout(() => {
      if (!destroyed && textarea && !textarea.isDestroyed) {
        textarea.focus()
      }
    }, 1)
    if (textarea && !textarea.isDestroyed) {
      textarea.gotoLineEnd()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <box gap={1}>
        {props.description}
        <textarea
          onSubmit={() => {
            if (!destroyed && textarea && !textarea.isDestroyed) {
              props.onConfirm?.(textarea.plainText)
            }
          }}
          height={3}
          keyBindings={[{ name: "return", action: "submit" }]}
          ref={(val: TextareaRenderable) => (textarea = val)}
          initialValue={props.value}
          placeholder={props.placeholder ?? "Enter text"}
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
        />
      </box>
      <box paddingBottom={1} gap={1} flexDirection="row">
        <text fg={theme.text}>
          enter <span style={{ fg: theme.textMuted }}>submit</span>
        </text>
      </box>
    </box>
  )
}

DialogPrompt.show = (dialog: DialogContext, title: string, options?: Omit<DialogPromptProps, "title">) => {
  return new Promise<string | null>((resolve) => {
    dialog.replace(
      () => (
        <DialogPrompt title={title} {...options} onConfirm={(value) => resolve(value)} onCancel={() => resolve(null)} />
      ),
      () => resolve(null),
    )
  })
}
