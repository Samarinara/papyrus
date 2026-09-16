<script lang="ts">
	import { onMount, untrack } from 'svelte';

	let {
		value,
		suffix = '',
		label,
		strong = false
	}: { value: number; suffix?: string; label?: string; strong?: boolean } = $props();
	let displayed = $state(untrack(() => value));
	let reduced = $state(true);
	let element: HTMLSpanElement;

	onMount(() => {
		const preference = matchMedia('(prefers-reduced-motion: reduce)');
		const update = () => (reduced = preference.matches);
		update();
		preference.addEventListener('change', update);
		return () => preference.removeEventListener('change', update);
	});

	$effect(() => {
		const target = value;
		const start = untrack(() => displayed);
		if (reduced || start === target) {
			displayed = target;
			return;
		}
		const growing = target > start;
		const duration = strong ? 420 : 180;
		const started = performance.now();
		const punch = element.animate(
			[
				{ transform: 'scale(1) rotate(0deg)' },
				{
					transform: `scale(${growing ? (strong ? 1.18 : 1.12) : 0.94}) rotate(${growing ? -2 : 1}deg)`,
					offset: 0.3
				},
				{ transform: 'scale(1) rotate(0deg)' }
			],
			{ duration, easing: 'cubic-bezier(.2,.8,.2,1)' }
		);
		let frame: number;
		const update = (now: number) => {
			const progress = Math.min(1, (now - started) / duration);
			displayed = Math.round(start + (target - start) * (1 - (1 - progress) ** 3));
			if (progress < 1) frame = requestAnimationFrame(update);
		};
		frame = requestAnimationFrame(update);
		return () => {
			cancelAnimationFrame(frame);
			punch.cancel();
		};
	});
</script>

<span
	bind:this={element}
	class="animated-number"
	role="img"
	aria-label={label ?? `${value}${suffix}`}>{displayed}{suffix}</span
>

<style>
	.animated-number {
		display: inline-block;
		transform-origin: 50% 70%;
	}
</style>
