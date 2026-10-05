CREATE TABLE "app_setting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_setting_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "settings_secret" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_secret_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"niche" text DEFAULT '' NOT NULL,
	"language" text DEFAULT 'de' NOT NULL,
	"style_prompt" text DEFAULT '' NOT NULL,
	"visual_style_prompt" text DEFAULT '' NOT NULL,
	"heygen_avatar_id" text,
	"heygen_voice_id" text,
	"video_provider" text DEFAULT 'heygen' NOT NULL,
	"script_approval_required" boolean DEFAULT true NOT NULL,
	"daily_budget_cents" integer DEFAULT 300 NOT NULL,
	"monthly_budget_cents" integer DEFAULT 6000 NOT NULL,
	"production_paused" boolean DEFAULT false NOT NULL,
	"pause_reason" text,
	"target_video_length_s" integer DEFAULT 40 NOT NULL,
	"topic_batch_size" integer DEFAULT 20 NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"max_videos_in_review" integer DEFAULT 3 NOT NULL,
	"timezone" text DEFAULT 'Europe/Berlin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_video_provider_check" CHECK ("project"."video_provider" in ('heygen', 'fallback')),
	CONSTRAINT "project_target_length_check" CHECK ("project"."target_video_length_s" between 30 and 45),
	CONSTRAINT "project_budget_check" CHECK ("project"."daily_budget_cents" >= 0 and "project"."monthly_budget_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "project_secret" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"display_name" text NOT NULL,
	"external_id" text,
	"access_token_enc" text,
	"refresh_token_enc" text,
	"token_expires_at" timestamp with time zone,
	"scopes" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"tiktok_mode" text DEFAULT 'inbox' NOT NULL,
	"youtube_visibility" text DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_platform_check" CHECK ("channel"."platform" in ('youtube', 'tiktok')),
	CONSTRAINT "channel_status_check" CHECK ("channel"."status" in ('connected', 'expired', 'audit_pending')),
	CONSTRAINT "channel_tiktok_mode_check" CHECK ("channel"."tiktok_mode" in ('inbox', 'direct')),
	CONSTRAINT "channel_youtube_visibility_check" CHECK ("channel"."youtube_visibility" in ('private', 'public'))
);
--> statement-breakpoint
CREATE TABLE "schedule_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"time_local" time NOT NULL,
	"timezone" text DEFAULT 'Europe/Berlin' NOT NULL,
	"videos_per_day" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_rule_weekday_check" CHECK ("schedule_rule"."weekday" between 0 and 6),
	CONSTRAINT "schedule_rule_videos_check" CHECK ("schedule_rule"."videos_per_day" >= 1)
);
--> statement-breakpoint
CREATE TABLE "topic" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"angle" text,
	"status" text DEFAULT 'suggested' NOT NULL,
	"fingerprint" text NOT NULL,
	"batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_status_check" CHECK ("topic"."status" in ('suggested', 'approved', 'rejected', 'used'))
);
--> statement-breakpoint
CREATE TABLE "video" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"topic_id" uuid,
	"status" text DEFAULT 'idea' NOT NULL,
	"resume_status" text,
	"script" text,
	"script_approved_at" timestamp with time zone,
	"heygen_session_id" text,
	"heygen_video_id" text,
	"visual_mode" text,
	"file_path" text,
	"storage_backend" text DEFAULT 'local' NOT NULL,
	"storage_ref" text,
	"local_deleted_at" timestamp with time zone,
	"duration_s" integer,
	"publish_at" timestamp with time zone,
	"slot_at" timestamp with time zone,
	"rejected_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_status_check" CHECK ("video"."status" in ('idea', 'scripting', 'script_ready', 'awaiting_script_approval', 'rendering', 'awaiting_review', 'scheduled', 'uploading', 'uploaded', 'partially_uploaded', 'failed', 'paused_budget', 'rejected')),
	CONSTRAINT "video_resume_status_check" CHECK ("video"."resume_status" is null or "video"."resume_status" in ('idea', 'scripting', 'script_ready', 'awaiting_script_approval', 'rendering', 'awaiting_review', 'scheduled', 'uploading', 'uploaded', 'partially_uploaded', 'failed', 'paused_budget', 'rejected')),
	CONSTRAINT "video_visual_mode_check" CHECK ("video"."visual_mode" is null or "video"."visual_mode" in ('faceless', 'avatar')),
	CONSTRAINT "video_storage_backend_check" CHECK ("video"."storage_backend" in ('local', 'onedrive'))
);
--> statement-breakpoint
CREATE TABLE "video_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"message" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_event_from_status_check" CHECK ("video_event"."from_status" is null or "video_event"."from_status" in ('idea', 'scripting', 'script_ready', 'awaiting_script_approval', 'rendering', 'awaiting_review', 'scheduled', 'uploading', 'uploaded', 'partially_uploaded', 'failed', 'paused_budget', 'rejected')),
	CONSTRAINT "video_event_to_status_check" CHECK ("video_event"."to_status" in ('idea', 'scripting', 'script_ready', 'awaiting_script_approval', 'rendering', 'awaiting_review', 'scheduled', 'uploading', 'uploaded', 'partially_uploaded', 'failed', 'paused_budget', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "metric_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publication_id" uuid NOT NULL,
	"date" date NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"shares" integer,
	"source" text DEFAULT 'api' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_snapshot_source_check" CHECK ("metric_snapshot"."source" in ('api', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "publication" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_label" boolean DEFAULT true NOT NULL,
	"meta_edited" boolean DEFAULT false NOT NULL,
	"external_post_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"mode" text,
	"uploaded_at" timestamp with time zone,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publication_ai_label_check" CHECK ("publication"."ai_label" = true),
	CONSTRAINT "publication_platform_check" CHECK ("publication"."platform" in ('youtube', 'tiktok')),
	CONSTRAINT "publication_status_check" CHECK ("publication"."status" in ('draft', 'pending', 'uploading', 'ok', 'failed')),
	CONSTRAINT "publication_mode_check" CHECK ("publication"."mode" is null or "publication"."mode" in ('inbox', 'direct', 'private'))
);
--> statement-breakpoint
CREATE TABLE "cost_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"video_id" uuid,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"amount_micro_usd" bigint NOT NULL,
	"units" bigint,
	"status" text DEFAULT 'reserved' NOT NULL,
	"reservation_expires_at" timestamp with time zone,
	"estimated" boolean DEFAULT false NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_entry_status_check" CHECK ("cost_entry"."status" in ('reserved', 'committed', 'released')),
	CONSTRAINT "cost_entry_amount_check" CHECK ("cost_entry"."amount_micro_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"type" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"dedupe_key" text,
	"read_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"delivery_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_severity_check" CHECK ("notification"."severity" in ('info', 'warning', 'error'))
);
--> statement-breakpoint
ALTER TABLE "project_secret" ADD CONSTRAINT "project_secret_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_rule" ADD CONSTRAINT "schedule_rule_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic" ADD CONSTRAINT "topic_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video" ADD CONSTRAINT "video_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video" ADD CONSTRAINT "video_topic_id_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topic"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_event" ADD CONSTRAINT "video_event_video_id_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."video"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshot" ADD CONSTRAINT "metric_snapshot_publication_id_publication_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publication"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication" ADD CONSTRAINT "publication_video_id_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."video"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication" ADD CONSTRAINT "publication_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_entry" ADD CONSTRAINT "cost_entry_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_entry" ADD CONSTRAINT "cost_entry_video_id_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."video"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_secret_project_key_uq" ON "project_secret" USING btree ("project_id","key");--> statement-breakpoint
CREATE INDEX "channel_project_idx" ON "channel" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "schedule_rule_project_idx" ON "schedule_rule" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "topic_project_fingerprint_uq" ON "topic" USING btree ("project_id","fingerprint");--> statement-breakpoint
CREATE INDEX "video_project_status_idx" ON "video" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "video_slot_idx" ON "video" USING btree ("slot_at");--> statement-breakpoint
CREATE INDEX "video_event_video_idx" ON "video_event" USING btree ("video_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_snapshot_publication_date_uq" ON "metric_snapshot" USING btree ("publication_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "publication_video_channel_uq" ON "publication" USING btree ("video_id","channel_id");--> statement-breakpoint
CREATE INDEX "publication_channel_idx" ON "publication" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "cost_entry_project_at_idx" ON "cost_entry" USING btree ("project_id","at");--> statement-breakpoint
CREATE INDEX "cost_entry_status_expiry_idx" ON "cost_entry" USING btree ("status","reservation_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_dedupe_key_uq" ON "notification" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notification_project_idx" ON "notification" USING btree ("project_id");