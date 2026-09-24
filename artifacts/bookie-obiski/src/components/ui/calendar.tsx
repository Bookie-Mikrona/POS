import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { sl } from "date-fns/locale"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  classNames,
  components,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      locale={sl}
      weekStartsOn={1}
      showOutsideDays={showOutsideDays}
      className={cn("w-full", className)}
      classNames={{
        months: "relative w-full",
        month: "w-full",
        month_caption: "flex h-10 items-center justify-center",
        caption_label: "text-base font-semibold capitalize",
        nav: "absolute inset-x-0 top-0 flex h-10 items-center justify-between",
        button_previous: "inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary",
        button_next: "inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary",
        table: "w-full table-fixed border-collapse",
        weekdays: "h-9",
        weekday: "text-center text-xs font-medium text-muted-foreground",
        week: "h-11",
        day: "p-0 text-center",
        day_button: "mx-auto flex h-10 w-10 items-center justify-center rounded-lg text-sm transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary",
        selected: "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary",
        today: "[&>button]:font-bold [&>button]:ring-1 [&>button]:ring-primary/50",
        outside: "text-muted-foreground/50",
        disabled: "[&>button]:cursor-not-allowed [&>button]:text-muted-foreground/40 [&>button]:hover:bg-transparent",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...chevronProps }) =>
          orientation === "left"
            ? <ChevronLeft {...chevronProps} className="h-4 w-4" />
            : <ChevronRight {...chevronProps} className="h-4 w-4" />,
        ...components,
      }}
      {...props}
    />
  )
}

Calendar.displayName = "Calendar"

export { Calendar }