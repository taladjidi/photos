/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type * as PreviewQueue from './PreviewQueue.js'

import { beforeEach, describe, expect, test, vi } from 'vitest'

const CAP = 10

/** Let pending promise continuations run. */
const flush = () => new Promise((resolve) => setTimeout(resolve))

let queue: typeof PreviewQueue

beforeEach(async () => {
	// The queue keeps module-level state, so every test gets a fresh module.
	vi.resetModules()
	queue = await import('./PreviewQueue.js')
})

describe('acquireSlot / releaseSlot', () => {
	test('acquires beyond the cap wait', async () => {
		for (let i = 0; i < CAP; i++) {
			queue.acquireSlot()
		}
		let granted = false
		queue.acquireSlot().promise.then(() => {
			granted = true
		})
		await flush()
		expect(granted).toBe(false)
		expect(queue.activeSlotCount()).toBe(CAP)
	})

	test('release grants the next waiter', async () => {
		for (let i = 0; i < CAP; i++) {
			queue.acquireSlot()
		}
		let granted = false
		queue.acquireSlot().promise.then(() => {
			granted = true
		})
		queue.releaseSlot()
		await flush()
		expect(granted).toBe(true)
		expect(queue.activeSlotCount()).toBe(CAP)
	})

	test('cancel of a waiter does not change the active count', async () => {
		for (let i = 0; i < CAP; i++) {
			queue.acquireSlot()
		}
		const waiter = queue.acquireSlot()
		waiter.cancel()
		expect(queue.activeSlotCount()).toBe(CAP)

		// The cancelled waiter must not swallow the release.
		queue.releaseSlot()
		expect(queue.activeSlotCount()).toBe(CAP - 1)
	})

	test('stray release does not go negative', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		queue.releaseSlot()
		queue.releaseSlot()
		expect(queue.activeSlotCount()).toBe(0)
		expect(queue.acquireSlot().promise).toBeInstanceOf(Promise)
		expect(queue.activeSlotCount()).toBe(1)
		warn.mockRestore()
	})
})

describe('createSlotHolder', () => {
	test('a slot is held only once granted', async () => {
		for (let i = 0; i < CAP; i++) {
			queue.acquireSlot()
		}
		const holder = queue.createSlotHolder()
		const pending = holder.acquire()
		expect(holder.held).toBe(false)

		// Releasing while still waiting must not free a slot we never took.
		holder.release()
		// A cancelled wait never resolves, the same as the components rely on.
		let settled = false
		pending.then(() => {
			settled = true
		})
		await flush()
		expect(settled).toBe(false)
		expect(holder.held).toBe(false)
		expect(queue.activeSlotCount()).toBe(CAP)
	})

	test('release while the grant is in flight gives the slot back', async () => {
		const holder = queue.createSlotHolder()
		const pending = holder.acquire()
		holder.release()
		expect(await pending).toBe(false)
		expect(queue.activeSlotCount()).toBe(0)
	})

	test('a granted holder releases its slot exactly once', async () => {
		const holder = queue.createSlotHolder()
		expect(await holder.acquire()).toBe(true)
		expect(holder.held).toBe(true)
		holder.release()
		holder.release()
		expect(queue.activeSlotCount()).toBe(0)
	})

	test('randomized acquire/cancel/release never exceeds the cap or goes negative', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		// Seeded LCG so a failure is reproducible.
		let seed = 12345
		const random = () => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff
			return seed / 0x7fffffff
		}

		const holders = Array.from({ length: 40 }, () => queue.createSlotHolder())
		const busy = new Set<number>()

		for (let step = 0; step < 1000; step++) {
			const i = Math.floor(random() * holders.length)
			if (busy.has(i)) {
				holders[i].release()
				busy.delete(i)
			} else {
				void holders[i].acquire()
				busy.add(i)
			}
			await flush()

			const held = holders.filter((h) => h.held).length
			expect(queue.activeSlotCount()).toBe(held)
			expect(held).toBeLessThanOrEqual(CAP)
			expect(queue.activeSlotCount()).toBeGreaterThanOrEqual(0)
		}

		for (const h of holders) {
			h.release()
		}
		await flush()
		expect(queue.activeSlotCount()).toBe(0)
		warn.mockRestore()
	})
})
