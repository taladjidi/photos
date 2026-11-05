/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { shallowMount } from '@vue/test-utils'
import { describe, expect, test, vi } from 'vitest'
import FaceContent from './FaceContent.vue'

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
		expect(fetchFaces).toHaveBeenCalledWith(true)
		expect(fetchFaceContent).toHaveBeenCalledWith('alice', true)
	})
})
