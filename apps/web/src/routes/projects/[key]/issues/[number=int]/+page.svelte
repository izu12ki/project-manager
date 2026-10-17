<script lang="ts">
	import IssueView from './IssueView.svelte';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
</script>

<IssueView projectKey={params.key} number={params.number} />
