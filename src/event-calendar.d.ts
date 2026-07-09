// @event-calendar/core ships no TypeScript declarations (a plain JS/Svelte
// build with no "types" export condition) -- minimal hand-written types for
// the small surface this app actually uses.
declare module "@event-calendar/core" {
  export interface CalendarInstance {
    setOption(name: string, value: any): void;
    /** Returns dateClick-shaped info ({ date, allDay, dayEl, ... }) for a
     *  given viewport point, or null if the point isn't on the calendar. */
    dateFromPoint(x: number, y: number): { date: Date; allDay: boolean; dayEl: HTMLElement } | null;
    next(): void;
    prev(): void;
  }
  export function createCalendar(
    el: HTMLElement,
    plugins: any[],
    options: Record<string, any>
  ): CalendarInstance;
  export function destroyCalendar(instance: CalendarInstance): void;
  export const DayGrid: any;
  export const TimeGrid: any;
  export const List: any;
  export const Interaction: any;
  export const ResourceTimeline: any;
  export const ResourceTimeGrid: any;
}

declare module "@event-calendar/core/index.css";
