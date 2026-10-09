<script lang="ts">
	import * as Alert from '$lib/components/ui/alert';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import { CopyButton } from '$lib/components/ui/copy-button';

	let { url }: { url: string } = $props();
	const inputId = $props.id();
</script>

<Alert.Root role="status">
	<Alert.Description>
		<Field.Field>
			<Field.Label for={inputId}>招待リンク</Field.Label>
			<div class="flex items-center gap-2">
				<Input
					id={inputId}
					readonly
					value={url}
					class="font-mono text-xs"
					onfocus={(e) => e.currentTarget.select()}
				/>
				<CopyButton text={url} variant="outline" />
			</div>
			<Field.Description
				>このリンクは 7 日間有効です。メールが届かない場合は直接相手に渡してください。</Field.Description
			>
		</Field.Field>
	</Alert.Description>
</Alert.Root>
