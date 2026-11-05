/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { shallowMount } from '@vue/test-utils'
import { describe, expect, test, vi } from 'vitest'
import * as api from '../services/FacesApi.ts'
import FaceContent from './FaceContent.vue'

vi.mock('@nextcloud/auth', async (orig) => ({ ...(await orig() as object), getCurrentUser: () => ({ uid: 'alice' }) }))
vi.mock('../services/FacesApi.ts', async (orig) => ({
	...(await orig() as object),
	searchClusters: vi.fn(),
	fetchClusterPage: vi.fn(),
	fetchClusterFiles: vi.fn().mockResolvedValue({ id: 2, title: 'bob', count: 0, files: [] }),
}))
vi.mock('@nextcloud/dialogs', () => ({ showError: vi.fn(), showSuccess: vi.fn(), showInfo: vi.fn() }))

describe('FaceContent remove files from face', () => {
	test('refreshes the cluster list and the cluster files after a remove', async () => {
		const fetchFaces = vi.fn()
		const fetchFaceContent = vi.fn()
		const dispatch = vi.fn().mockResolvedValue(undefined)
		const wrapper = shallowMount(FaceContent, {
			propsData: { faceName: 'alice' },
			methods: { fetchFaces, fetchFaceContent },
			mocks: {
				$store: { dispatch, state: { faces: { faces: {}, facesFiles: {} }, files: { files: {} } } },
				$router: { push: vi.fn() },
			},
		})
		fetchFaces.mockClear()
		fetchFaceContent.mockClear()

		await wrapper.vm.handleRemoveFilesFromFace(['10'])

		expect(dispatch).toHaveBeenCalledWith('removeFilesFromFace', { faceName: 'alice', fileIdsToRemove: ['10'] })
		expect(fetchFaces).toHaveBeenCalledWith(true, 'alice')
		expect(fetchFaceContent).toHaveBeenCalledWith('alice', true)
	})
})

describe('FaceContent small cluster by URL', () => {
	const mountAt = (faceName: string) => {
		const dispatch = vi.fn().mockResolvedValue(undefined)
		const wrapper = shallowMount(FaceContent, {
			propsData: { faceName },
			methods: { fetchFaces: vi.fn() },
			mocks: { $store: { dispatch, state: { faces: { faces: {}, facesFiles: {} }, files: { files: {} } } }, $router: { push: vi.fn() } },
		})
		return { wrapper, dispatch }
	}

	test('resolves a title by exact search match and loads through the API', async () => {
		vi.mocked(api.searchClusters).mockResolvedValue([{ id: 3, title: 'bobby', count: 2, cover: null }, { id: 2, title: 'bob', count: 3, cover: null }])
		const { dispatch } = mountAt('bob')
		await vi.waitFor(() => expect(api.fetchClusterFiles).toHaveBeenCalledWith(2))
		expect(dispatch).toHaveBeenCalledWith('addFaces', { faces: [expect.objectContaining({ basename: 'bob' })] })
	})

	test('resolves a numeric name by id', async () => {
		vi.mocked(api.fetchClusterPage).mockResolvedValue({ id: 7, title: null, count: 2, files: [] })
		mountAt('7')
		await vi.waitFor(() => expect(api.fetchClusterFiles).toHaveBeenCalledWith(7))
	})
})
