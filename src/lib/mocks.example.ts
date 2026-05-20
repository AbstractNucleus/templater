// Fresh-clone seed. On a new checkout: `cp src/lib/mocks.example.ts src/lib/mocks.ts`.
// To regenerate from a CSV in the project root: `npx tsx scripts/csv-to-mocks.ts`.
import type { Template } from "./types";

const ISO = "2026-05-19T18:00:00Z";

export const mockTemplates: Template[] = [
  {
    id: "tpl-decline-meeting",
    name: "Decline meeting politely",
    tags: ["email", "decline"],
    opening: "Hi {{name}},",
    body: "Thanks for the invite — unfortunately I won't be able to make it. Happy to find another time if helpful.",
    created_at: ISO,
    updated_at: ISO,
  },
  {
    id: "tpl-follow-up",
    name: "Follow-up after no response",
    tags: ["email", "follow-up"],
    opening: "Hi {{name}},",
    body: "Just bumping this in case it slipped past. No rush — let me know if {{topic}} is still on the table.",
    created_at: ISO,
    updated_at: ISO,
  },
  {
    id: "tpl-forum-thanks",
    name: "Forum thank-you reply",
    tags: ["forum", "thanks"],
    opening: "",
    body: "Thanks {{name}} — that fixed it. Posting the working config below for anyone hitting the same issue.",
    created_at: ISO,
    updated_at: ISO,
  },
  {
    id: "tpl-quick-yes",
    name: "Quick yes to a meeting",
    tags: ["email", "accept"],
    opening: "Hi {{name}},",
    body: "Works for me. {{time}} is good — I'll send a calendar invite shortly.",
    created_at: ISO,
    updated_at: ISO,
  },
];
