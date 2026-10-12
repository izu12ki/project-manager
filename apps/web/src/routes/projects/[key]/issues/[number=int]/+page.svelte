<script lang="ts">
	import { Pencil, Trash2 } from '@lucide/svelte';
	import { autosize } from '$lib/autosize';
	import ConfirmAction from '$lib/components/ConfirmAction.svelte';
	import FormAlert from '$lib/components/FormAlert.svelte';
	import PriorityPill from '$lib/components/PriorityPill.svelte';
	import StatusPill from '$lib/components/StatusPill.svelte';
	import {
		PRIORITIES,
		PRIORITY_LABEL,
		STATUSES,
		STATUS_LABEL,
		colorFor,
		formatDateTime,
		milestoneLabel
	} from '$lib/labels';
	import { toast } from '$lib/toast.svelte';
	import {
		getComments,
		getIssueDetail,
		postComment,
		removeComment,
		saveIssue,
		updateComment
	} from './issue.remote';
	import type { PageProps } from './$types';

	let { data, params }: PageProps = $props();
	const ref = $derived({ key: params.key, number: params.number });
	// 2つの query は同時に取得を始め、コメントの更新では課題側を取り直さない
	const detailQuery = $derived(getIssueDetail(ref));
	const commentsQuery = $derived(getComments(ref));
	const detail = $derived(await detailQuery);
	const comments = $derived(await commentsQuery);
	const issue = $derived(detail.issue);
	const perms = $derived(detail.perms);
	const canSave = $derived(perms.edit || perms.changeStatus || perms.assign);
	let editing = $state(false);
	let editingComment = $state<string | null>(null);
	const attrFormId = 'issue-attributes';

	async function deleteComment(commentId: string) {
		try {
			await removeComment({ ...ref, commentId });
		} catch {
			failed();
		}
	}

	const failed = () => toast.error('エラーが発生しました。時間をおいて再度お試しください');

	// 送信直後に自分のコメントを仮表示し、サーバーの結果で本物に置き換える
	type PendingComment = { id: number; body: string };
	let pendingComments = $state<PendingComment[]>([]);
	let nextPendingId = 0;

	const commentForm = postComment.enhance(async ({ element, submit }) => {
		const textarea = element.querySelector('textarea')!;
		const body = textarea.value.trim();
		const pending = { id: ++nextPendingId, body };
		pendingComments.push(pending);
		element.reset();
		let ok = false;
		try {
			ok = await submit();
		} catch {
			failed();
		} finally {
			pendingComments = pendingComments.filter((c) => c.id !== pending.id);
		}
		if (!ok && !textarea.value) {
			textarea.value = body;
			textarea.dispatchEvent(new Event('input', { bubbles: true }));
		}
	});
</script>

<section class="detail">
	<div class="grid min-w-0 gap-6">
		<header class="grid gap-2">
			<div class="flex flex-wrap items-center gap-2">
				<span class="mono text-[13px] text-muted-foreground">{data.project.key}-{issue.number}</span
				>
				<StatusPill status={issue.status} />
				<PriorityPill priority={issue.priority} />
			</div>
			<h1 class="page-title" style="font-size: 22px; text-wrap: pretty">{issue.title}</h1>
			<p class="m-0 text-[13px] text-muted-foreground">
				{issue.reporterName} が {formatDateTime(issue.createdAt)} に起票
			</p>
		</header>

		{#each saveIssue.fields.allIssues() ?? [] as i (i.message)}<FormAlert
				message={i.message}
			/>{/each}

		{#if editing}
			<!-- title/description は右列の属性フォーム(id=issue-attributes)に form 属性で紐づけ、編集中だけ送信される -->
			<div class="card">
				<div class="field">
					<label class="label" for="issue-title">タイトル</label>
					<input
						class="input"
						id="issue-title"
						{...saveIssue.fields.title.as('text', issue.title)}
						form={attrFormId}
						required
						maxlength={200}
					/>
				</div>
				<div class="field">
					<label class="label" for="issue-description">本文</label>
					<textarea
						class="textarea autosize"
						id="issue-description"
						{...saveIssue.fields.description.as('text', issue.description)}
						form={attrFormId}
						rows="10"
						{@attach autosize}></textarea>
					<p class="hint">Markdown が使えます。右の「保存」で反映されます。</p>
				</div>
				<div>
					<button type="button" class="btn btn-outline btn-sm" onclick={() => (editing = false)}>
						編集をやめる
					</button>
				</div>
			</div>
		{:else}
			<div class="card body">
				{#if issue.description}
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- markdown-it(html:false) で生成した HTML -->
					<div class="markdown">{@html issue.descriptionHtml}</div>
				{:else}
					<p class="m-0 text-muted-foreground">本文はありません</p>
				{/if}
			</div>
		{/if}

		<section class="grid gap-4">
			<h2 class="m-0 text-base font-bold">
				コメント <span class="font-medium text-muted-foreground"
					>{comments.length + pendingComments.length}</span
				>
			</h2>
			{#if comments.length + pendingComments.length === 0}
				<p class="m-0 text-muted-foreground">まだコメントはありません</p>
			{/if}
			{#each comments as c (c.id)}
				<article class="comment">
					<span class="avatar" style:--c={colorFor(c.authorName)}>{c.authorName[0]}</span>
					<div class="grid min-w-0 gap-1">
						<div class="flex items-center gap-2">
							<span class="font-medium">{c.authorName}</span>
							<span class="text-xs text-muted-foreground">{formatDateTime(c.createdAt)}</span>
							{#if c.canModify}
								<div class="ml-auto flex items-center">
									<button
										type="button"
										class="icon-btn"
										aria-label="コメントを編集"
										title="コメントを編集"
										aria-expanded={editingComment === c.id}
										onclick={() => (editingComment = editingComment === c.id ? null : c.id)}
									>
										<Pencil />
									</button>
									<ConfirmAction
										onconfirm={() => deleteComment(c.id)}
										title="コメントを削除しますか？"
										description="このコメントは完全に削除され、元に戻せません。"
										confirmLabel="削除する"
										triggerClass="icon-btn danger-hover"
										triggerLabel="コメントを削除"
									>
										{#snippet trigger()}<Trash2 />{/snippet}
									</ConfirmAction>
								</div>
							{/if}
						</div>
						{#if editingComment === c.id}
							{@const edit = updateComment.for(c.id)}
							<form
								class="grid gap-2"
								{...edit.enhance(async ({ submit }) => {
									try {
										if (await submit()) editingComment = null;
									} catch {
										failed();
									}
								})}
							>
								{#each edit.fields.allIssues() ?? [] as i (i.message)}<FormAlert
										message={i.message}
									/>{/each}
								<input {...edit.fields.key.as('hidden', ref.key)} />
								<input {...edit.fields.number.as('hidden', ref.number)} />
								<input {...edit.fields.commentId.as('hidden', c.id)} />
								<textarea
									class="textarea autosize"
									{...edit.fields.body.as('text', c.body)}
									rows="4"
									required
									aria-label="コメントを編集"
									{@attach autosize}></textarea>
								<div class="flex justify-end gap-2">
									<button
										type="button"
										class="btn btn-outline btn-sm"
										onclick={() => (editingComment = null)}>キャンセル</button
									>
									<button type="submit" class="btn btn-primary btn-sm">更新</button>
								</div>
							</form>
						{:else}
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- markdown-it(html:false) で生成した HTML -->
							<div class="markdown">{@html c.html}</div>
						{/if}
					</div>
				</article>
			{/each}
			{#each pendingComments as c (c.id)}
				<article class="comment pending" aria-busy="true">
					<span class="avatar" style:--c={colorFor(data.user?.name ?? '')}
						>{data.user?.name[0]}</span
					>
					<div class="grid min-w-0 gap-1">
						<div class="flex items-center gap-2">
							<span class="font-medium">{data.user?.name}</span>
							<span class="text-xs text-muted-foreground">送信中…</span>
						</div>
						<p class="pending-body">{c.body}</p>
					</div>
				</article>
			{/each}
			{#if perms.writable}
				<form {...commentForm} class="new-comment">
					<input {...postComment.fields.key.as('hidden', ref.key)} />
					<input {...postComment.fields.number.as('hidden', ref.number)} />
					<label class="label" for="new-comment">コメントを追加</label>
					{#each postComment.fields.allIssues() ?? [] as i (i.message)}<FormAlert
							message={i.message}
						/>{/each}
					<textarea
						class="textarea autosize"
						id="new-comment"
						{...postComment.fields.body.as('text')}
						rows="3"
						required
						{@attach autosize}></textarea>
					<div class="flex justify-end">
						<button type="submit" class="btn btn-primary">コメントする</button>
					</div>
				</form>
			{/if}
		</section>
	</div>

	<aside class="side">
		<form
			id={attrFormId}
			class="card"
			style="padding: 20px"
			{...saveIssue.enhance(async ({ submit }) => {
				try {
					if (await submit()) {
						editing = false;
						toast.success('保存しました');
					}
				} catch {
					failed();
				}
			})}
		>
			<input {...saveIssue.fields.key.as('hidden', ref.key)} />
			<input {...saveIssue.fields.number.as('hidden', ref.number)} />
			<h2 class="card-title">属性</h2>
			<div class="prop-list">
				<div class="prop-row">
					<label for="issue-status">ステータス</label>
					<select
						class="select"
						id="issue-status"
						{...saveIssue.fields.status.as('select', issue.status)}
						disabled={!perms.changeStatus}
					>
						{#each STATUSES as s (s)}
							<option value={s}>{STATUS_LABEL[s]}</option>
						{/each}
					</select>
				</div>
				<div class="prop-row">
					<label for="issue-priority">優先度</label>
					<select
						class="select"
						id="issue-priority"
						{...saveIssue.fields.priority.as('select', issue.priority)}
						disabled={!perms.edit}
					>
						{#each PRIORITIES as p (p)}
							<option value={p}>{PRIORITY_LABEL[p]}</option>
						{/each}
					</select>
				</div>
				<div class="prop-row">
					<label for="issue-assignee">担当者</label>
					<select
						class="select"
						id="issue-assignee"
						{...saveIssue.fields.assigneeId.as('select', issue.assigneeId ?? '')}
						disabled={!perms.assign}
					>
						<option value="">未割当</option>
						{#each detail.assignees as u (u.id)}
							<option value={u.id}>{u.disabled ? `${u.name}（無効）` : u.name}</option>
						{/each}
					</select>
				</div>
				<div class="prop-row">
					<label for="issue-category">カテゴリー</label>
					<select
						class="select"
						id="issue-category"
						{...saveIssue.fields.categoryId.as('select', issue.categoryId ?? '')}
						disabled={!perms.edit}
					>
						<option value="">未設定</option>
						{#each detail.categories as c (c.id)}
							<option value={c.id}>{c.name}</option>
						{/each}
					</select>
				</div>
				<div class="prop-row">
					<label for="issue-milestone">マイルストーン</label>
					<select
						class="select"
						id="issue-milestone"
						{...saveIssue.fields.milestoneId.as('select', issue.milestoneId ?? '')}
						disabled={!perms.edit}
					>
						<option value="">未設定</option>
						{#each detail.milestones as m (m.id)}
							<option value={m.id}>{milestoneLabel(m)}</option>
						{/each}
					</select>
				</div>
				<div class="prop-row">
					<label for="issue-start">開始日</label>
					<input
						class="input"
						id="issue-start"
						{...saveIssue.fields.startDate.as('date', issue.startDate ?? '')}
						disabled={!perms.edit}
					/>
				</div>
				<div class="prop-row">
					<label for="issue-due">期限日</label>
					<input
						class="input"
						id="issue-due"
						{...saveIssue.fields.dueDate.as('date', issue.dueDate ?? '')}
						disabled={!perms.edit}
					/>
				</div>
			</div>
			{#if canSave || (perms.edit && !editing)}
				<div class="flex flex-wrap items-center gap-2">
					{#if canSave}<button type="submit" class="btn btn-primary">保存</button>{/if}
					{#if perms.edit && !editing}
						<button type="button" class="btn btn-outline btn-sm" onclick={() => (editing = true)}>
							<Pencil />タイトル・本文を編集
						</button>
					{/if}
				</div>
			{:else}
				<p class="hint">この課題の属性は変更できません</p>
			{/if}
		</form>
		{#if perms.delete}
			<ConfirmAction
				action="?/delete"
				title="課題を削除しますか？"
				description={`「${data.project.key}-${issue.number} ${issue.title}」とコメントがすべて削除されます。この操作は元に戻せません。`}
				confirmLabel="削除する"
				triggerClass="btn btn-danger w-full"
			>
				{#snippet trigger()}<Trash2 />課題を削除{/snippet}
			</ConfirmAction>
		{/if}
	</aside>
</section>

<style>
	.detail {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 24px;
		align-items: start;
	}
	.side {
		display: grid;
		gap: 16px;
	}
	@media (min-width: 1100px) {
		.detail {
			grid-template-columns: minmax(0, 1fr) 300px;
		}
		.side {
			position: sticky;
			top: 80px;
		}
	}
	.body {
		padding: 20px 24px;
	}
	.comment {
		display: grid;
		grid-template-columns: 32px minmax(0, 1fr);
		gap: 12px;
	}
	.comment :global(.danger-hover:hover) {
		color: var(--destructive);
	}
	.comment.pending {
		opacity: 0.6;
	}
	.pending-body {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.new-comment {
		display: grid;
		gap: 8px;
		padding-top: 20px;
		border-top: 1px solid var(--border);
	}
</style>
