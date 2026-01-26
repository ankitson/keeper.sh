-- Tier 1 - Core Content
ALTER TABLE "event_states" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "event_states" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "event_states" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "event_states" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "event_states" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "event_states" ADD COLUMN "categories" text;--> statement-breakpoint
ALTER TABLE "event_states" ADD COLUMN "eventClass" text;--> statement-breakpoint
ALTER TABLE "event_states" ADD COLUMN "priority" text;--> statement-breakpoint
ALTER TABLE "event_states" ADD COLUMN "comment" text;--> statement-breakpoint
ALTER TABLE "event_states" ADD COLUMN "geo" text;--> statement-breakpoint
-- Tier 2 - Recurrence (JSON)
ALTER TABLE "event_states" ADD COLUMN "recurrenceRule" text;--> statement-breakpoint
ALTER TABLE "event_states" ADD COLUMN "exceptionDates" text;--> statement-breakpoint
ALTER TABLE "event_states" ADD COLUMN "recurrenceId" text;--> statement-breakpoint
-- Tier 3 - People (JSON)
ALTER TABLE "event_states" ADD COLUMN "organizer" text;--> statement-breakpoint
ALTER TABLE "event_states" ADD COLUMN "attendees" text;--> statement-breakpoint
-- Other
ALTER TABLE "event_states" ADD COLUMN "timeTransparent" text;--> statement-breakpoint
ALTER TABLE "event_states" ADD COLUMN "attach" text;
