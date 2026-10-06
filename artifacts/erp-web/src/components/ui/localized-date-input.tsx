import * as React from "react";
import { CalendarDays } from "lucide-react";
import { cn, formatDatum, parseDatum } from "@/lib/utils";

/**
 * Browser locale never controls the visible date. The calendar and callers
 * still receive ISO dates; incomplete/invalid typing clears the caller's date.
 */
export const LocalizedDateInput = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ value, defaultValue, onChange, onBlur, className, name, disabled, readOnly, min, max, ...props }, ref) => {
    const initial = String(value ?? defaultValue ?? "");
    const [iso, setIso] = React.useState(initial);
    const [text, setText] = React.useState(initial ? formatDatum(initial) : "");
    const [touched, setTouched] = React.useState(false);
    const emitted = React.useRef(initial);
    const visibleInput = React.useRef<HTMLInputElement | null>(null);
    const calendarInput = React.useRef<HTMLInputElement | null>(null);
    React.useEffect(() => {
      if (value === undefined) return;
      const external = String(value);
      if (external !== emitted.current) {
        emitted.current = external;
        setIso(external);
        setText(external ? formatDatum(external) : "");
        setTouched(false);
      }
    }, [value]);

    const inRange = (date: string | null) => !!date
      && (!min || date >= String(min)) && (!max || date <= String(max));
    const parsed = parseDatum(text);
    const invalid = !!text && !inRange(parsed);
    const error = invalid ? "Vnesite veljaven datum v obliki dd.mm.yyyy v dovoljenem obdobju." : "";
    React.useEffect(() => { visibleInput.current?.setCustomValidity(error); }, [error, text]);
    const change = (event: React.ChangeEvent<HTMLInputElement>, next: string) => {
      emitted.current = next;
      setIso(next);
      const target = new Proxy(event.target, {
        get(input, key) {
          if (key === "value") return next;
          if (key === "name") return name ?? "";
          if (key === "type") return "date";
          const member = Reflect.get(input, key, input);
          return typeof member === "function" ? member.bind(input) : member;
        },
      });
      onChange?.(new Proxy(event, {
        get(original, key) {
          if (key === "target" || key === "currentTarget") return target;
          const member = Reflect.get(original, key, original);
          return typeof member === "function" ? member.bind(original) : member;
        },
      }));
    };
    const openCalendar = (input: HTMLInputElement | null) => {
      if (!input || disabled || readOnly) return;
      try { input.showPicker?.(); }
      catch {
        // Cross-origin preview frames may prohibit showPicker; the native
        // calendar indicator still retains the browser's default behaviour.
        input.focus();
      }
    };

    return (
      <div className="relative w-full">
        <input {...props} type="text" name={undefined} ref={node => {
          visibleInput.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }} disabled={disabled} readOnly={readOnly}
          value={text} placeholder={props.placeholder ?? "dd.mm.yyyy"} inputMode="numeric"
          className={cn(className, "pr-10", touched && invalid && "border-destructive")}
          aria-invalid={invalid || props["aria-invalid"]}
          onKeyDown={event => {
            props.onKeyDown?.(event);
            if (!event.defaultPrevented && !disabled && !readOnly && event.altKey && event.key === "ArrowDown") {
              event.preventDefault();
              openCalendar(calendarInput.current);
            }
          }}
          onChange={event => {
            const nextText = event.target.value;
            // Accept an ISO date pasted from another system, but show it
            // in the same Slovenian format as typed and calendar dates.
            const pastedIso = /^\d{4}-\d{2}-\d{2}$/.test(nextText)
              ? parseDatum(formatDatum(nextText)) : null;
            setText(pastedIso ? formatDatum(pastedIso) : nextText);
            const next = pastedIso ?? parseDatum(nextText);
            // Like a native date input, retain a syntactically valid date
            // outside min/max so the caller can explain its business rule.
            change(event, next ?? "");
            event.target.setCustomValidity(nextText && !inRange(next) ? "Vnesite datum v obliki dd.mm.yyyy." : "");
          }}
          onBlur={event => {
            setTouched(true);
            if (parsed && inRange(parsed)) setText(formatDatum(parsed));
            event.target.setCustomValidity(error);
            onBlur?.(event);
          }}
        />
        <span className="absolute right-0 top-0 flex h-9 w-9 items-center justify-center text-muted-foreground">
          <CalendarDays className="h-4 w-4 pointer-events-none" aria-hidden="true" />
          <input type="date" ref={calendarInput} name={name} value={iso} min={min} max={max} disabled={disabled || readOnly}
            tabIndex={-1} aria-label={`Koledar: ${props["aria-label"] ?? "datum"}`}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full"
            onClick={event => { openCalendar(event.currentTarget); }}
            onChange={event => {
              setText(event.target.value ? formatDatum(event.target.value) : "");
              setTouched(false);
              change(event, event.target.value);
            }}
          />
        </span>
        {touched && invalid && <p className="mt-1 text-xs text-destructive" role="alert">{error}</p>}
      </div>
    );
  },
);
LocalizedDateInput.displayName = "LocalizedDateInput";
