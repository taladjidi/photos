/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Semaphore that limits concurrent preview image loads.
 *
 * Without throttling, the Photos app fires thousands of preview requests
 * simultaneously over a single HTTP/2 connection, causing multi-second
 * queuing delays in nginx and browser-side timeouts (HTTP 499).
 *
 * Previews already cached by the service worker bypass this queue entirely.
 */

const MAX_CONCURRENT = 10
let active = 0

type Waiter = {
	resolve: () => void
	cancelled: boolean
}

const waiters: Waiter[] = []

/**
 * Acquire a loading slot. Resolves immediately if a slot is available,
 * otherwise waits until one is released.
 *
 * @return Object with promise (resolves when slot is acquired) and cancel function
 */
export function acquireSlot(): { promise: Promise<void>, cancel: () => void } {
	if (active < MAX_CONCURRENT) {
		active++
		return { promise: Promise.resolve(), cancel: () => {} }
	}

	const waiter: Waiter = { resolve: () => {}, cancelled: false }
	const promise = new Promise<void>((resolve) => {
		waiter.resolve = resolve
	})
	waiters.push(waiter)

	const cancel = () => {
		waiter.cancelled = true
		const idx = waiters.indexOf(waiter)
		if (idx !== -1) {
			waiters.splice(idx, 1)
		}
	}

	return { promise, cancel }
}

/**
 * Release a loading slot, allowing the next queued waiter to proceed.
 */
export function releaseSlot(): void {
	if (active === 0) {
		// A stray release would push the count negative and let the cap drift upward.
		if (process.env.NODE_ENV !== 'production') {
			// eslint-disable-next-line no-console
			console.warn('[PreviewQueue] releaseSlot() with no active slot')
		}
		return
	}
	while (waiters.length > 0) {
		const next = waiters.shift()!
		if (!next.cancelled) {
			next.resolve()
			return
		}
	}
	active--
}

/** Number of granted slots, for tests and debugging. */
export function activeSlotCount(): number {
	return active
}

/**
 * Per-component handle on the queue. A slot counts as held only once it is
 * granted, so release() while still waiting only cancels the wait and never
 * frees a slot that was never taken.
 */
export function createSlotHolder() {
	let held = false
	let pending: { cancel: () => void } | null = null

	return {
		get held(): boolean {
			return held
		},

		/** Resolves true once a slot is held, false if release() ran first. */
		async acquire(): Promise<boolean> {
			const wait = acquireSlot()
			const ticket = { cancel: wait.cancel }
			pending = ticket
			await wait.promise
			if (pending !== ticket) {
				// Released while the grant was in flight: give the slot back.
				releaseSlot()
				return false
			}
			pending = null
			held = true
			return true
		},

		release(): void {
			if (pending) {
				pending.cancel()
				pending = null
			}
			if (held) {
				held = false
				releaseSlot()
			}
		},
	}
}
