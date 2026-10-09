<script lang="ts">
	import { enhance } from '$app/forms';
	import * as Alert from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import * as NativeSelect from '$lib/components/ui/native-select';
	import { Textarea } from '$lib/components/ui/textarea';
	import { PRIORITIES, PRIORITY_LABEL } from '$lib/labels';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<Card.Root class="max-w-2xl">
	<Card.Header>
		<Card.Title>新規課題</Card.Title>
	</Card.Header>
	<Card.Content>
		<form method="POST" use:enhance>
			<Field.Group>
				{#if form?.message}
					<Alert.Root variant="destructive">
						<Alert.Description>{form.message}</Alert.Description>
					</Alert.Root>
				{/if}
				<Field.Field>
					<Field.Label for="issue-title">タイトル</Field.Label>
					<Input id="issue-title" name="title" required maxlength={200} />
				</Field.Field>
				<Field.Field>
					<Field.Label for="issue-description">説明（Markdown）</Field.Label>
					<Textarea id="issue-description" name="description" rows={8} />
				</Field.Field>
				<div class="grid gap-4 md:grid-cols-3">
					<Field.Field>
						<Field.Label for="issue-priority">優先度</Field.Label>
						<NativeSelect.Root id="issue-priority" name="priority">
							{#each PRIORITIES as p (p)}
								<NativeSelect.Option value={p}>{PRIORITY_LABEL[p]}</NativeSelect.Option>
							{/each}
						</NativeSelect.Root>
					</Field.Field>
					<Field.Field>
						<Field.Label for="issue-due-date">期限</Field.Label>
						<Input id="issue-due-date" type="date" name="dueDate" />
					</Field.Field>
					{#if data.canAssign}
						<Field.Field>
							<Field.Label for="issue-assignee">担当者</Field.Label>
							<NativeSelect.Root id="issue-assignee" name="assigneeId">
								<NativeSelect.Option value="">未割り当て</NativeSelect.Option>
								{#each data.assignees as u (u.id)}
									<NativeSelect.Option value={u.id}>{u.name}</NativeSelect.Option>
								{/each}
							</NativeSelect.Root>
						</Field.Field>
					{/if}
				</div>
				<div><Button type="submit">起票する</Button></div>
			</Field.Group>
		</form>
	</Card.Content>
</Card.Root>
