/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import axios from '@nextcloud/axios'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { apiDown, resetFacesApi } from './FacesApi.ts'
import { lookupThumb, resetThumbsApi } from './ThumbsApi.ts'

vi.mock('@nextcloud/axios', () => ({ default: { get: vi.fn() } }))
vi.mock('@nextcloud/auth', () => ({ getCurrentUser: () => ({ uid: 'alice' }) }))

const get = axios.get as unknown as ReturnType<typeof vi.fn>
const token = { data: { token: 't', expires: Math.floor(Date.now() / 1000) + 3600 } }
const thumbCalls = () => get.mock.calls.filter((c) => String(c[0]).endsWith('/thumbs'))
const idsOf = (call: unknown[]) => ((call[1] as { params: { ids: string } }).params.ids).split(',').map(Number)

/** Answer /thumbs with a thumb for every id in `have`. */
function serve(have: (id: number) => boolean = () => true) {
	get.mockImplementation(async (url: string, opts?: { params: { ids: string } }) => {
		if (!url.endsWith('/thumbs')) {
			return token
		}
		const data: Record<string, unknown> = {}
		for (const id of opts!.params.ids.split(',').map(Number)) {
			if (have(id)) {
				data[id] = { 256: `/recognize-thumbs/${id}-256`, 1024: `/recognize-thumbs/${id}-1024` }
			}
		}
		return { data }
	})
}

beforeEach(() => {
	vi.useFakeTimers()
	get.mockReset()
	resetFacesApi()
	resetThumbsApi()
})

afterEach(() => vi.useRealTimers())

describe('lookupThumb', () => {
	test('coalesces lookups made together into one request', async () => {
		serve()
		const all = Promise.all([lookupThumb(1, 256), lookupThumb(2, 1024), lookupThumb(1, 1024)])
		await vi.advanceTimersByTimeAsync(10)
		expect(await all).toEqual(['/recognize-thumbs/1-256', '/recognize-thumbs/2-1024', '/recognize-thumbs/1-1024'])
		expect(thumbCalls()).toHaveLength(1)
		expect(idsOf(thumbCalls()[0])).toEqual([1, 2])
	})

	test('splits more than 500 ids into chunks of 500', async () => {
		serve()
		const all = Promise.all(Array.from({ length: 1201 }, (_, i) => lookupThumb(i + 1, 256)))
		await vi.advanceTimersByTimeAsync(10)
		await all
		expect(thumbCalls().map((c) => idsOf(c).length)).toEqual([500, 500, 201])
	})

	test('caches hits and misses, and asks a miss again after 5 minutes', async () => {
		serve((id) => id === 1)
		const first = Promise.all([lookupThumb(1, 256), lookupThumb(2, 256)])
		await vi.advanceTimersByTimeAsync(10)
		expect(await first).toEqual(['/recognize-thumbs/1-256', null])

		expect(await Promise.all([lookupThumb(1, 1024), lookupThumb(2, 256)])).toEqual(['/recognize-thumbs/1-1024', null])
		expect(thumbCalls()).toHaveLength(1)

		await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1)
		serve()
		const again = Promise.all([lookupThumb(1, 256), lookupThumb(2, 256)])
		await vi.advanceTimersByTimeAsync(10)
		expect(await again).toEqual(['/recognize-thumbs/1-256', '/recognize-thumbs/2-256'])
		expect(thumbCalls()).toHaveLength(2)
		expect(idsOf(thumbCalls()[1])).toEqual([2]) // the hit is not asked again
	})

	test('API failure: null, no request during a 30 s back-off, Faces unaffected, then asked again', async () => {
		get.mockRejectedValue({ response: { status: 503 } })
		const failed = lookupThumb(1, 256)
		await vi.advanceTimersByTimeAsync(10)
		expect(await failed).toBeNull()
		expect(apiDown()).toBe(false) // a thumbs 503 must not send Faces to WebDAV

		get.mockClear()
		expect(await lookupThumb(2, 256)).toBeNull()
		expect(get).not.toHaveBeenCalled()

		await vi.advanceTimersByTimeAsync(30 * 1000)
		serve()
		const again = lookupThumb(1, 256) // the failed id is not cached as a miss
		await vi.advanceTimersByTimeAsync(10)
		expect(await again).toBe('/recognize-thumbs/1-256')
	})
})

describe('lookupThumb robustness', () => {
	const run = async <T>(p: Promise<T>) => { await vi.advanceTimersByTimeAsync(10); return p }
	const backedOff = async () => { get.mockClear(); const r = await lookupThumb(99, 256); return r === null && get.mock.calls.length === 0 }

	test('non-object body: null, every id resolved, back-off starts', async () => {
		get.mockImplementation(async (url: string) => (url.endsWith('/thumbs') ? { data: null } : token))
		expect(await run(Promise.all([lookupThumb(1, 256), lookupThumb(2, 256)]))).toEqual([null, null])
		expect(await backedOff()).toBe(true)
	})

	test('timeout: asked with 5 s, null, back-off', async () => {
		get.mockImplementation(async (url: string) => {
			if (!url.endsWith('/thumbs')) { return token }
			throw Object.assign(new Error('timeout'), { code: 'ECONNABORTED' })
		})
		expect(await run(lookupThumb(1, 256))).toBeNull()
		expect(thumbCalls()[0][1]).toMatchObject({ timeout: 5000 })
		expect(await backedOff()).toBe(true)
	})

	test('an etag change asks the API again', async () => {
		serve()
		await run(lookupThumb(1, 256, 'a'))
		await lookupThumb(1, 1024, 'a')
		expect(thumbCalls()).toHaveLength(1)
		await run(lookupThumb(1, 256, 'b'))
		expect(thumbCalls()).toHaveLength(2)
	})

	test('a hit expires after 12 h', async () => {
		serve()
		await run(lookupThumb(1, 256))
		await vi.advanceTimersByTimeAsync(12 * 3600 * 1000 - 1000)
		await lookupThumb(1, 256)
		expect(thumbCalls()).toHaveLength(1)
		await vi.advanceTimersByTimeAsync(2000)
		await run(lookupThumb(1, 256))
		expect(thumbCalls()).toHaveLength(2)
	})

	test('cache is capped at 20000 entries, oldest dropped, use refreshes', async () => {
		serve()
		await run(Promise.all(Array.from({ length: 20000 }, (_, i) => lookupThumb(i + 1, 256))))
		await lookupThumb(1, 256) // refresh id 1: id 2 is now the oldest
		await run(lookupThumb(20001, 256))
		get.mockClear()
		await lookupThumb(1, 256)
		expect(thumbCalls()).toHaveLength(0)
		await run(lookupThumb(2, 256))
		expect(thumbCalls()).toHaveLength(1)
	})

	test('cached hits are served during the back-off', async () => {
		serve()
		await run(lookupThumb(1, 256))
		get.mockRejectedValue({ response: { status: 503 } })
		await run(lookupThumb(2, 256))
		get.mockClear()
		expect(await lookupThumb(1, 256)).toBe('/recognize-thumbs/1-256')
		expect(get).not.toHaveBeenCalled()
	})

	test('reset with a pending timer: no flush, no crash', async () => {
		serve()
		void lookupThumb(1, 256)
		resetThumbsApi()
		await vi.advanceTimersByTimeAsync(50)
		expect(thumbCalls()).toHaveLength(0)
	})
})
