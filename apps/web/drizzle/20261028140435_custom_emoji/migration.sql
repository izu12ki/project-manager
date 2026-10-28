-- ワークスペース共通のカスタム絵文字
CREATE TABLE `custom_emoji` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`creator_id` text NOT NULL,
	`content_type` text NOT NULL,
	`r2_key` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_custom_emoji_creator_id_user_id_fk` FOREIGN KEY (`creator_id`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_emoji_name_uq` ON `custom_emoji` (`name`);