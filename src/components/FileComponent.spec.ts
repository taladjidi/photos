/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { shallowMount, type Wrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import FileComponent from './FileComponent.vue'
import { activeSlotCount, MAX_CONCURRENT } from '../services/PreviewQueue.js'
import { lookupThumb } from '../services/ThumbsApi.ts'

vi.mock('../services/ThumbsApi.ts', () => ({ lookupThumb: vi.fn() }))
const lookup = lookupThumb as unknown as ReturnType<typeof vi.fn>

/** Let the component's nextTick and queue continuations run. */
const flush = () => new Promise((resolve) => setTimeout(resolve))

const BLURHASH = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj'

function makeFile(fileid: number, blurhash?: string) {
	return {
		fileid,
		basename: `file-${fileid}.jpg`,
		attributes: { etag: `etag-${fileid}`, ...(blurhash ? { 'metadata-blurhash': blurhash } : {}) },
	}
}

let wrappers: Wrapper<any>[] = []
const mount = (file: ReturnType<typeof makeFile>) => {
	const w = shallowMount(FileComponent, { propsData: { file } })
	wrappers.push(w)
	return w
}

beforeEach(() => {
	lookup.mockReset().mockResolvedValue(null)
	// jsdom has no canvas 2D context to draw the blurhash into.
	vi.spyOn((FileComponent as any).methods, 'drawBlurhash').mockImplementation(() => {})
})

afterEach(() => {
	wrappers.forEach((w) => w.destroy())
	wrappers = []
	vi.restoreAllMocks()
	// Every test must leave the shared queue empty, or the next one starts skewed.
	expect(activeSlotCount()).toBe(0)
})

describe('FileComponent slot handling', () => {
	test('holds one slot while mounted, moves it on file change, releases on destroy', async () => {
		const wrapper = mount(makeFile(1))
		await flush()
		expect(activeSlotCount()).toBe(1)

		await wrapper.setProps({ file: makeFile(2) })
		await flush()
		expect(activeSlotCount()).toBe(1)

		wrapper.destroy()
		wrappers = []
		await flush()
		expect(activeSlotCount()).toBe(0)
	})

	test('blurhash file: the large load alone releases the slot (no small <img> is rendered)', async () => {
		const wrapper = mount(makeFile(3, BLURHASH))
		await flush()
		expect(activeSlotCount()).toBe(1)
		expect(wrapper.find('img').exists()).toBe(true) // only the large one
		expect(wrapper.findAll('img').length).toBe(1)

		;(wrapper.vm as any).onLoadLarge()
		expect(activeSlotCount()).toBe(0)
	})

	test('file without blurhash, real order: small loads, then large is rendered and loads', async () => {
		const wrapper = mount(makeFile(4))
		await flush()
		expect(wrapper.findAll('img').length).toBe(1) // small only, large waits for it

		;(wrapper.vm as any).onLoadSmall()
		await flush()
		expect(wrapper.findAll('img').length).toBe(2) // large rendered now
		expect(activeSlotCount()).toBe(1) // still loading the large one

		;(wrapper.vm as any).onLoadLarge()
		expect(activeSlotCount()).toBe(0)
	})

	test('the queue keeps moving: a tile past the cap gets its slot when a blurhash tile finishes', async () => {
		const first = Array.from({ length: MAX_CONCURRENT }, (_, i) => mount(makeFile(100 + i, BLURHASH)))
		const waiting = mount(makeFile(200, BLURHASH))
		await flush()
		expect(activeSlotCount()).toBe(MAX_CONCURRENT)
		expect((waiting.vm as any).activeSrcLarge).toBe('')

		;(first[0].vm as any).onLoadLarge()
		await flush()
		expect((waiting.vm as any).activeSrcLarge).not.toBe('')
		expect(activeSlotCount()).toBe(MAX_CONCURRENT)
	})
})

describe('FileComponent thumbs', () => {
	const thumbs = (id: number, size: number) => `/recognize-thumbs/${id}-${size}`

	test('uses the thumb URLs, falls back to PHP once per img on error, and still releases the slot', async () => {
		lookup.mockImplementation(async (id: number, size: number) => thumbs(id, size))
		const wrapper = mount(makeFile(5))
		const vm = wrapper.vm as any
		await flush()
		expect(vm.activeSrcSmall).toBe(thumbs(5, 256))
		expect(vm.activeSrcLarge).toBe(thumbs(5, vm.isMobile ? 256 : 1024))

		vm.onErrorSmall()
		expect(vm.activeSrcSmall).toBe(vm.srcSmall) // PHP retry, not an error yet
		expect(vm.errorSmall).toBe(false)
		expect(activeSlotCount()).toBe(1)
		vm.onErrorSmall() // the PHP image fails too
		expect(vm.errorSmall).toBe(true)

		await flush()
		vm.onErrorLarge()
		expect(vm.activeSrcLarge).toBe(vm.srcLarge)
		expect(vm.errorLarge).toBe(false)
		expect(activeSlotCount()).toBe(1)
		vm.onLoadLarge() // the PHP retry loads
		expect(activeSlotCount()).toBe(0)
	})

	test('a lookup that resolves after the file was swapped is ignored', async () => {
		let resolveOld!: (url: string) => void
		lookup.mockImplementation((id: number) => (id === 6
			? new Promise((resolve) => { resolveOld = resolve })
			: Promise.resolve(null)))
		const wrapper = mount(makeFile(6, BLURHASH))
		const vm = wrapper.vm as any
		await flush()
		await wrapper.setProps({ file: makeFile(7, BLURHASH) })
		await flush()
		resolveOld('/recognize-thumbs/stale')
		await flush()
		expect(vm.activeSrcLarge).toBe(vm.srcLarge)
		expect(vm.activeSrcLarge).toContain('/preview/7?')
		expect(activeSlotCount()).toBe(1)
	})
})
