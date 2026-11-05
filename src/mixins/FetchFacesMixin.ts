/**
 * SPDX-FileCopyrightText: 2022 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { File } from '@nextcloud/files'
import type { FileStat, ResponseDataDetailed } from 'webdav'

import { getCurrentUser } from '@nextcloud/auth'
import { showError } from '@nextcloud/dialogs'
import { resultToNode } from '@nextcloud/files/dav'
import { t } from '@nextcloud/l10n'
import he from 'he'
import { defineComponent } from 'vue'
import { davClient } from '../services/DavClient.ts'
import { getPropFind } from '../services/DavRequest.ts'
import { apiDown, apiFailed, apiFileToNode, clusterToFace, fetchClusterFiles, fetchClusters } from '../services/FacesApi.ts'
import logger from '../services/logger.js'
import AbortControllerMixin from './AbortControllerMixin.js'

// The face list only needs a cover image and a count.
const faceListDAVProps = [
	'<nc:face-preview-image/>',
	'<nc:nbItems/>',
]

// Cluster contents additionally need realpath to resolve files, and the
// detections themselves.
const faceContentDAVProps = [
	'<nc:face-detections/>',
	'<nc:realpath/>',
]

// Counting the unassigned-faces collection is a single PROPFIND for one
// number; it needs nbItems and nothing else.
const faceCountDAVProps = [
	'<nc:nbItems/>',
]

type FaceNode = File & {
	attributes: {
		'face-detections': string
		'face-preview-image': string
		realpath: string
	}
}

export default defineComponent({
	name: 'FetchFacesMixin',

	data() {
		return {
			errorFetchingFaces: null as null | number | Error | unknown,
			loadingFaces: false,
			errorFetchingFiles: null as null | number | Error | unknown,
			loadingFiles: false,
		}
	},

	mixins: [AbortControllerMixin],

	async beforeMount() {
		this.fetchFaces()
	},

	computed: {
		faces() {
			return this.$store.state.faces.faces
		},
	},

	methods: {
		async fetchFaces(force = false) {
			if (this.loadingFaces) {
				return
			}

			if (!force && Object.keys(this.faces).length) {
				return
			}

			if (!apiDown()) {
				try {
					this.loadingFaces = true
					this.errorFetchingFaces = null
					const faces = (await fetchClusters()).map(clusterToFace)
					const stale = Object.keys(this.faces).filter((name) => !faces.some((f) => f.basename === name))
					this.$store.commit('removeFaces', { faceNames: stale })
					this.$store.dispatch('addFaces', { faces })
					return
				} catch (error) {
					apiFailed(error)
				} finally {
					this.loadingFaces = false
				}
			}

			try {
				this.loadingFaces = true
				this.errorFetchingFaces = null

				const { data: fetchedRawFaces } = await davClient.getDirectoryContents(`/recognize/${getCurrentUser()?.uid}/faces/`, {
					data: getPropFind(faceListDAVProps),
					details: true,
					signal: this.abortController.signal,
				}) as ResponseDataDetailed<FileStat[]>

				const fetchedFace = fetchedRawFaces.map((file) => resultToNode(file, `/recognize/${getCurrentUser()?.uid}/faces/`) as FaceNode)
				this.$store.dispatch('addFaces', { faces: fetchedFace })
				logger.debug(`[FetchFacesMixin] Fetched ${fetchedFace.length} new faces: `, { fetchedFace })
			} catch (error) {
				if (error.response?.status === 404) {
					this.errorFetchingFaces = 404
				} else {
					this.errorFetchingFaces = error
				}
				logger.error(t('photos', 'Failed to fetch faces list.'), { error })
				showError(t('photos', 'Failed to fetch faces list.'))
			} finally {
				this.loadingFaces = false
			}
		},

		async fetchFaceContent(faceName, force) {
			if (this.loadingFiles) {
				return
			}

			if (!force && this.facesFiles[faceName] && this.facesFiles[faceName].length) {
				return
			}

			const clusterId = this.faces[faceName]?.attributes?.clusterId
			if (clusterId !== undefined && !apiDown()) {
				try {
					this.errorFetchingFiles = null
					this.loadingFiles = true
					const cluster = await fetchClusterFiles(clusterId)
					const files = cluster.files.map((f) => apiFileToNode(f, cluster))
					await this.$store.dispatch('appendFiles', files)
					if (files.length > 0) {
						this.$store.commit('addFilesToFace', { faceName, fileIdsToAdd: files.map((f) => '' + f.fileid) })
					}
					return
				} catch (error) {
					apiFailed(error)
				} finally {
					this.loadingFiles = false
				}
			}

			try {
				this.errorFetchingFiles = null
				this.loadingFiles = true

				const { data: fetchedRawFiles } = await davClient.getDirectoryContents(
					`/recognize/${getCurrentUser()?.uid}/faces/${faceName}`,
					{
						data: getPropFind(faceContentDAVProps),
						details: true,
						signal: this.abortController.signal,
					},
				) as ResponseDataDetailed<FileStat[]>

				const fetchedFiles = fetchedRawFiles
					.map((file) => ({
						...file,
						filename: he.decode(file.props?.realpath).replace(`/${getCurrentUser()?.uid}/files`, `/files/${getCurrentUser()?.uid}`),
					}))
					.map((file) => {
						const node = resultToNode(file) as FaceNode
						// Set the parsed detections after resultToNode: it builds attributes
						// as `{ ...node, ...props }`, so assigning before would be overwritten
						// by the raw JSON string still held in props.
						node.attributes['face-detections'] = JSON.parse(he.decode(file.props?.['face-detections']))
						return node
					})

				const fileIds = fetchedFiles.map((file) => file.fileid?.toString() as string)

				await this.$store.dispatch('appendFiles', fetchedFiles)

				if (fetchedFiles.length > 0) {
					await this.$store.commit('addFilesToFace', { faceName, fileIdsToAdd: fileIds })
				}

				logger.debug(`[FetchFacesMixin] Fetched ${fileIds.length} new files: `, { fileIds })
			} catch (error) {
				if (error.response?.status === 404) {
					this.errorFetchingFaces = 404
				} else {
					this.errorFetchingFaces = error
				}

				// cancelled request, moving on...
				logger.error('Error fetching face files', { error })
			} finally {
				this.loadingFiles = false
			}
		},

		async fetchUnassignedFaces(force) {
			if (this.loadingFiles) {
				return
			}

			if (!force && this.unassignedFiles && this.unassignedFiles.length) {
				return
			}

			try {
				this.errorFetchingFiles = null
				this.loadingFiles = true

				const { data: fetchedRawFiles } = await davClient.getDirectoryContents(
					`/recognize/${getCurrentUser()?.uid}/unassigned-faces`,
					{
						data: getPropFind(faceContentDAVProps),
						details: true,
						signal: this.abortController.signal,
					},
				) as ResponseDataDetailed<FileStat[]>

				const fetchedFiles = fetchedRawFiles
					.map((file) => ({
						...file,
						filename: he.decode(file.props?.realpath).replace(`/${getCurrentUser()?.uid}/files`, `/files/${getCurrentUser()?.uid}`),
					}))
					.map((file) => {
						const node = resultToNode(file) as FaceNode
						// Set the parsed detections after resultToNode: it builds attributes
						// as `{ ...node, ...props }`, so assigning before would be overwritten
						// by the raw JSON string still held in props.
						node.attributes['face-detections'] = JSON.parse(he.decode(file.props?.['face-detections']))
						return node
					})

				const fileIds = [...new Set(fetchedFiles.map((file) => '' + file.fileid))]
				await this.$store.dispatch('appendFiles', fetchedFiles)

				if (fetchedFiles.length > 0) {
					await this.$store.commit('addUnassignedFiles', { fileIdsToAdd: fileIds })
				}

				logger.debug(`[FetchFacesMixin] Fetched ${fileIds.length} new unassigned files: `, { fileIds })
			} catch (error) {
				if (error.response?.status === 404) {
					this.errorFetchingFaces = 404
				} else {
					this.errorFetchingFaces = error
				}

				// cancelled request, moving on...
				logger.error('Error fetching unassigned files', { error })
			} finally {
				this.loadingFiles = false
			}
		},

		async fetchUnassignedFacesCount() {
			try {
				const { data: unassignedFacesRoot } = await davClient.stat(
					`/recognize/${getCurrentUser()?.uid}/unassigned-faces`,
					{
						data: getPropFind(faceCountDAVProps),
						details: true,
						signal: this.abortController.signal,
					},
				) as ResponseDataDetailed<FileStat>

				const count = Number(unassignedFacesRoot.props?.nbItems)

				await this.$store.commit('setUnassignedFilesCount', count)

				logger.debug('[FetchFacesMixin] Fetched unassigned files count: ', { count })
			} catch (error) {
				// cancelled request, moving on...
				logger.error('Error fetching unassigned files count', { error })
			}
		},
	},
})
