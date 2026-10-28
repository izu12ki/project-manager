-- コメントへの絵文字リアクション
CREATE TABLE `comment_reaction` (
	`comment_id` text NOT NULL,
	`user_id` text NOT NULL,
	`emoji` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `comment_reaction_pk` PRIMARY KEY(`comment_id`, `user_id`, `emoji`),
	CONSTRAINT `fk_comment_reaction_comment_id_comment_id_fk` FOREIGN KEY (`comment_id`) REFERENCES `comment`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_comment_reaction_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
