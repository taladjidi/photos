/**
 * SPDX-FileCopyrightText: 2024 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import facesModule from './faces.ts'

// Mock external dependencies
vi.mock('../services/DavClient.ts', () => ({
	davClient: {
		moveFile: vi.fn().mockResolvedValue(undefined),
		deleteFile: vi.fn().mockResolvedValue(undefined),
	},
}))

vi.mock('@nextcloud/auth', () => ({
	getCurrentUser: () => ({ uid: 'testuser' }),
}))

vi.mock('@nextcloud/dialogs', () => ({
	showError: vi.fn(),
}))

vi.mock('@nextcloud/l10n', () => ({
	t: (_app: string, str: string) => str,
}))

vi.mock('../services/logger.js', () => ({
	default: {
		error: vi.fn(),
	},
}))

vi.mock('../utils/semaphoreWithPriority.js', () => ({
	default: class {
		async acquire() { return Symbol('test') }
		release() {}
	},
}))

vi.mock('vue', () => ({
	default: {
		set: (obj: Record<string, unknown>, key: string, value: unknown) => { obj[key] = value },
		delete: (obj: Record<string, unknown>, key: string) => { delete obj[key] },
	},
}))

const { mutations, actions } = facesModule

describe('faces store mutations', () => {
	let state: ReturnType<typeof createState>

	function createState() {
		return {
			faces: {} as Record<string, unknown>,
			facesFiles: {} as Record<string, string[]>,
			unassignedFiles: [] as string[],
			unassignedFilesCount: 0,
		}
	}

	beforeEach(() => {
		state = createState()
	})

	test('addFilesToFace creates face entry if missing', () => {
		mutations.addFilesToFace(state, { faceName: 'Alice', fileIdsToAdd: ['1', '2'] })
		expect(state.facesFiles.Alice).toEqual(['1', '2'])
	})

	test('addFilesToFace does not add duplicate fileIds', () => {
		state.facesFiles.Alice = ['1']
		mutations.addFilesToFace(state, { faceName: 'Alice', fileIdsToAdd: ['1', '2'] })
		expect(state.facesFiles.Alice).toEqual(['1', '2'])
	})

	test('removeFilesFromFace removes specified fileIds', () => {
		state.facesFiles.Alice = ['1', '2', '3']
		mutations.removeFilesFromFace(state, { faceName: 'Alice', fileIdsToRemove: ['2'] })
		expect(state.facesFiles.Alice).toEqual(['1', '3'])
	})

	test('addUnassignedFiles adds without duplicates', () => {
		state.unassignedFiles = ['1']
		mutations.addUnassignedFiles(state, { fileIdsToAdd: ['1', '2'] })
		expect(state.unassignedFiles).toEqual(['1', '2'])
	})

	test('removeUnassignedFile removes specified fileIds', () => {
		state.unassignedFiles = ['1', '2', '3']
		mutations.removeUnassignedFile(state, { fileIdsToRemove: ['2'] })
		expect(state.unassignedFiles).toEqual(['1', '3'])
	})

	test('setUnassignedFilesCount sets count', () => {
		mutations.setUnassignedFilesCount(state, 42)
		expect(state.unassignedFilesCount).toBe(42)
	})
})

describe('faces store actions', () => {
	function createContext(fileOverrides: Record<string, unknown> = {}) {
		const state = {
			faces: {} as Record<string, unknown>,
			facesFiles: {} as Record<string, string[]>,
			unassignedFiles: [] as string[],
			unassignedFilesCount: 0,
		}
		const commits: Array<[string, unknown]> = []

		return {
			state,
			rootState: {
				files: {
					files: {
						'42': {
							basename: 'photo.jpg',
							attributes: {
								'face-detections': JSON.stringify([
									{ title: 'OldFace', x: 0.5, y: 0.5 },
									{ title: 'OtherFace', x: 0.1, y: 0.1 },
								]),
							},
							...fileOverrides,
						},
					},
				},
			},
			commit: vi.fn((mutation: string, payload: unknown) => {
				commits.push([mutation, payload])
			}),
			dispatch: vi.fn(),
			getters: {},
			commits,
		}
	}

	test('moveFilesToFace reads face-detections from file.attributes without crashing', async () => {
		const context = createContext()
		const { davClient } = await import('../services/DavClient.ts')

		// This is the core bug fix: the old code accessed file.faceDetections (undefined)
		// and crashed with TypeError. The fix reads file.attributes['face-detections'] instead.
		await actions.moveFilesToFace(context as never, {
			oldFace: 'OldFace',
			faceName: 'NewFace',
			fileIdsToMove: ['42'],
		})

		// Verify DAV move was called with correct paths
		expect(davClient.moveFile).toHaveBeenCalledWith(
			'/recognize/testuser/faces/OldFace/photo.jpg',
			'/recognize/testuser/faces/NewFace/photo.jpg',
		)

		// Verify commits were called correctly
		expect(context.commit).toHaveBeenCalledWith('addFilesToFace', { faceName: 'NewFace', fileIdsToAdd: ['42'] })
		expect(context.commit).toHaveBeenCalledWith('removeFilesFromFace', { faceName: 'OldFace', fileIdsToRemove: ['42'] })
	})

	test('moveFilesToFace handles already-parsed face-detections array', async () => {
		const context = createContext({
			attributes: {
				'face-detections': [
					{ title: 'OldFace', x: 0.5, y: 0.5 },
				],
			},
		})

		await actions.moveFilesToFace(context as never, {
			oldFace: 'OldFace',
			faceName: 'NewFace',
			fileIdsToMove: ['42'],
		})

		const detections = context.rootState.files.files['42'].attributes['face-detections']
		expect(detections[0].title).toBe('NewFace')
	})

	test('moveFilesToFace handles missing face-detections gracefully', async () => {
		const context = createContext({
			attributes: {},
		})

		// Should not throw
		await actions.moveFilesToFace(context as never, {
			oldFace: 'OldFace',
			faceName: 'NewFace',
			fileIdsToMove: ['42'],
		})

		expect(context.commit).toHaveBeenCalledWith('addFilesToFace', { faceName: 'NewFace', fileIdsToAdd: ['42'] })
	})

	test('moveFilesToFace handles malformed JSON in face-detections', async () => {
		const context = createContext({
			attributes: {
				'face-detections': 'not valid json{{{',
			},
		})

		// Should not throw
		await actions.moveFilesToFace(context as never, {
			oldFace: 'OldFace',
			faceName: 'NewFace',
			fileIdsToMove: ['42'],
		})

		expect(context.commit).toHaveBeenCalledWith('addFilesToFace', { faceName: 'NewFace', fileIdsToAdd: ['42'] })
	})

	test('moveFilesToFace from unassigned commits removeUnassignedFile', async () => {
		const context = createContext()

		await actions.moveFilesToFace(context as never, {
			oldFace: undefined,
			faceName: 'NewFace',
			fileIdsToMove: ['42'],
		})

		expect(context.commit).toHaveBeenCalledWith('removeUnassignedFile', { fileIdsToRemove: ['42'] })
		expect(context.commit).not.toHaveBeenCalledWith('removeFilesFromFace', expect.anything())
	})

	test('removeFilesFromFace accesses files via rootState.files.files', async () => {
		const context = createContext()
		context.state.facesFiles.Alice = ['42']
		const { davClient } = await import('../services/DavClient.ts')

		await actions.removeFilesFromFace(context as never, {
			faceName: 'Alice',
			fileIdsToRemove: ['42'],
		})

		expect(davClient.deleteFile).toHaveBeenCalledWith(
			'/recognize/testuser/faces/Alice/photo.jpg',
		)
	})
})
