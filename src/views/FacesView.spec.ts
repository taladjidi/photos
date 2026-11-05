/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as api from '../services/FacesApi.ts'
import FacesView from './FacesView.vue'

vi.mock('@nextcloud/auth', async (orig) => ({ ...(await orig() as object), getCurrentUser: () => ({ uid: 'alice' }) }))
vi.mock('@nextcloud/dialogs', () => ({ showError: vi.fn() }))
vi.mock('../services/FacesApi.ts', async (orig) => ({ ...(await orig() as object), searchClusters: vi.fn() }))

const big = { id: 1, title: 'big', count: 9, cover: null }
const small = { id: 2, title: 'bigsmall', count: 2, cover: null }

describe('FacesView name filter', () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => vi.useRealTimers())

	test('search hits are shown while filtering, never stored, and dropped when cleared', async () => {
		vi.mocked(api.searchClusters).mockResolvedValue([small])
		const dispatch = vi.fn()
		const faces = { big: api.clusterToFace(big) }
		const wrapper = shallowMount(FacesView, {
			methods: { fetchFaces: vi.fn() },
			mocks: { $store: { dispatch, state: { faces: { faces, facesFiles: {} } } } },
		})
		const names = () => wrapper.vm.orderedFaces.map((f) => f.basename)

		wrapper.vm.onFilterInput('big')
		vi.advanceTimersByTime(300)
		await vi.waitFor(() => expect(names()).toEqual(['big', 'bigsmall']))
		expect(dispatch).not.toHaveBeenCalled()

		wrapper.vm.onFilterInput('')
		vi.advanceTimersByTime(300)
		await wrapper.vm.$nextTick()
		expect(names()).toEqual(['big'])

		// Navigation adds only the clicked hit.
		wrapper.vm.openFace(api.clusterToFace(small))
		expect(dispatch).toHaveBeenCalledWith('addFaces', { faces: [expect.objectContaining({ basename: 'bigsmall' })] })
	})
})
