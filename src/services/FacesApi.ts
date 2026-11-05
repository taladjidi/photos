/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { getCurrentUser } from '@nextcloud/auth'
import axios from '@nextcloud/axios'
import { File, Folder, Permission } from '@nextcloud/files'
import { generateRemoteUrl, generateUrl } from '@nextcloud/router'
import logger from './logger.js'

const API = '/recognize-api/v1'
const PAGE = 500

export type ApiCluster = { id: number, title: string | null, count: number, cover: string | null }
export type ApiDetection = { id: number, x: number, y: number, width: number, height: number, crop: string }
export type ApiFile = {
	fileid: number
	path: string
	name: string
	mime: string
	etag: string
	mtime: number
	size: number
	detection: ApiDetection
}
export type ApiClusterFiles = { id: number, title: string | null, count: number, files: ApiFile[] }

let cached: { token: string, expires: number } | null = null
let warned = false

/** Forget the cached token and the failure flag (tests). */
export function resetFacesApi() {
	cached = null
	warned = false
}

/**
 * Log the first API failure only; later reads go straight to WebDAV.
 *
 * @param error
 */
export function apiFailed(error: unknown) {
	if (!warned) {
		warned = true
		logger.warn('[FacesApi] unavailable, falling back to WebDAV', { error })
	}
}

/** True once an API call failed: callers use the DAV path. */
export function apiDown(): boolean {
	return warned
}

/**
 * @param fresh skip the cache
 */
async function getToken(fresh = false): Promise<string> {
	// Refresh 60 s before the server-side expiry.
	if (!fresh && cached && cached.expires - 60 > Date.now() / 1000) {
		return cached.token
	}
	const { data } = await axios.get(generateUrl('/apps/recognize/api/v1/faces-token'))
	cached = { token: data.token, expires: data.expires }
	return data.token
}

/**
 * @param path
 * @param params
 */
async function get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		const token = await getToken(attempt > 0)
		try {
			const { data } = await axios.get(API + path, { params, headers: { Authorization: `Bearer ${token}` } })
			return data as T
		} catch (error) {
			if (attempt === 0 && (error as { response?: { status?: number } }).response?.status === 401) {
				continue
			}
			throw error
		}
	}
}

export const fetchClusters = (min = 1) => get<ApiCluster[]>('/clusters', { min })
export const searchClusters = (q: string) => get<ApiCluster[]>('/search', { q })
export const fetchClusterPage = (id: number, offset = 0, limit = PAGE) => get<ApiClusterFiles>(`/clusters/${id}`, { offset, limit })

/**
 * All files of a cluster, in pages of 500.
 *
 * @param id
 */
export async function fetchClusterFiles(id: number): Promise<ApiClusterFiles> {
	const first = await fetchClusterPage(id, 0)
	const files = [...first.files]
	let last = first
	while (last.files.length === PAGE && files.length < first.count) {
		last = await fetchClusterPage(id, files.length)
		files.push(...last.files)
	}
	return { ...first, files }
}

/**
 * The name the DAV API (and our routes) give a cluster.
 *
 * @param c
 * @param c.id
 * @param c.title
 */
export const clusterName = (c: { id: number, title: string | null }) => c.title || `${c.id}`

/**
 * Cluster to the Collection shape the store uses; `cover` and `clusterId`
 * are extra attributes.
 *
 * @param cluster
 */
export function clusterToFace(cluster: ApiCluster): Folder {
	const uid = getCurrentUser()?.uid
	return new Folder({
		id: cluster.id,
		source: generateRemoteUrl(`dav/recognize/${uid}/faces/${clusterName(cluster)}`),
		root: `/recognize/${uid}/faces`,
		owner: uid ?? null,
		permissions: Permission.READ,
		attributes: { nbItems: cluster.count, cover: cluster.cover, clusterId: cluster.id },
	})
}

/**
 * API file to the node today's DAV listing produces, with the detection
 * attribute shaped like the parsed `face-detections` JSON.
 *
 * @param file
 * @param cluster
 * @param cluster.id
 * @param cluster.title
 */
export function apiFileToNode(file: ApiFile, cluster: { id: number, title: string | null }): File {
	const uid = getCurrentUser()?.uid
	const { id, ...box } = file.detection
	return new File({
		id: file.fileid,
		source: generateRemoteUrl(`dav/files/${uid}/${file.path}`),
		root: `/files/${uid}`,
		mime: file.mime,
		mtime: new Date(file.mtime * 1000),
		size: file.size,
		owner: uid ?? null,
		permissions: Permission.READ,
		attributes: {
			etag: file.etag,
			'face-detections': [{ id, clusterId: cluster.id, title: cluster.title, ...box }],
		},
	})
}
