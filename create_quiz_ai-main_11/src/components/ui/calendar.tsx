"use client"

import * as React from "react"
import { ChevronUp, ChevronDown } from "lucide-react"
import { DayPicker } from "react-day-picker"
import "react-day-picker/style.css"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      hideWeekdays={true}
      captionLayout="dropdown"
      fromYear={2000}
      toYear={2100}
      classNames={{
        months: "rdp-months",
        month: "rdp-month",
        month_caption: "flex justify-start pt-1 relative items-center mb-4",
        caption_label: "hidden",
        dropdowns: "flex gap-2",
        dropdown: "p-1 rounded-md bg-background text-sm font-medium border shadow-sm cursor-pointer hover:bg-muted/50",
        nav: "absolute right-0 top-0 flex flex-col items-center gap-0.5 pr-1 pt-1 z-30",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "h-5 w-5 p-0 bg-transparent border-none text-muted-foreground hover:text-foreground hover:bg-muted"
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "h-5 w-5 p-0 bg-transparent border-none text-muted-foreground hover:text-foreground hover:bg-muted"
        ),
        month_grid: "w-full border-collapse",
        weekdays: "hidden",
        week: "flex w-full",
        day: "h-9 w-9 text-center text-sm p-0 relative",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal cursor-pointer flex items-center justify-center hover:bg-accent hover:text-accent-foreground"
        ),
        selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        today: "bg-accent text-accent-foreground",
        outside: "text-muted-foreground opacity-50",
        disabled: "text-muted-foreground opacity-50",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => (
          orientation === "up" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
        ),
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
