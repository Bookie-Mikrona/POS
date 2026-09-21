import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, inputMode, step, autoComplete, ...props }, ref) => {
    const numericInputMode = type === "number"
      ? (step === "any" || (step != null && String(step).includes(".")) ? "decimal" : "numeric")
      : undefined
    const defaultAutoComplete = type === "email" || type === "tel" || type === "password"
      ? undefined
      : "off"
    return (
      <input
        type={type}
        inputMode={inputMode ?? numericInputMode}
        step={step}
        autoComplete={autoComplete ?? defaultAutoComplete}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
