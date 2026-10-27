// Shared by the server and the browser UI: no Node.js imports here.

/** Someone using the studio, as `authorize` (or `startStudio`) reports them. */
export interface StudioUser {
  /** Recorded as the author (`createdBy`, `updatedBy`, history) of their changes. */
  id: string;
  /** Shown in the studio's header; default: `id`. */
  name?: string;
}

/** Requests that change data must carry this header, which browsers never add cross-site. */
export const CSRF_HEADER = 'x-laci-studio';
