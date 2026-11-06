/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { shallowMount, type Wrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import FileComponent from './FileComponent.vue'
import { activeSlotCount, MAX_CONCURRENT } from '../services/PreviewQueue.js'

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
