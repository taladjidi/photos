/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { shallowMount } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import FileComponent from './FileComponent.vue'
import { activeSlotCount } from '../services/PreviewQueue.js'

/** Let the component's nextTick and queue continuations run. */
const flush = () => new Promise((resolve) => setTimeout(resolve))

function makeFile(fileid: number) {
	return {
		fileid,
		basename: `file-${fileid}.jpg`,
		attributes: { etag: `etag-${fileid}` },
	}
}

describe('FileComponent slot handling', () => {
	test('holds one slot while mounted, moves it on file change, releases on destroy', async () => {
		const before = activeSlotCount()
		const wrapper = shallowMount(FileComponent, {
			propsData: { file: makeFile(1) },
		})
		await flush()
		expect(activeSlotCount()).toBe(before + 1)

		await wrapper.setProps({ file: makeFile(2) })
		await flush()
		expect(activeSlotCount()).toBe(before + 1)

		wrapper.destroy()
		await flush()
		expect(activeSlotCount()).toBe(before)
	})
})
