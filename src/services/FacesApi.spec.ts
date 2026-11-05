/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import axios from '@nextcloud/axios'
import * as api from './FacesApi.ts'

vi.mock('@nextcloud/axios', () => ({ default: { get: vi.fn() } }))
vi.mock('@nextcloud/auth', () => ({ getCurrentUser: () => ({ uid: 'alice' }) }))

const get = axios.get as unknown as ReturnType<typeof vi.fn>
const now = () => Math.floor(Date.now() / 1000)
const tokenReply = (token: string, ttl = 3600) => ({ data: { token, expires: now() + ttl } })
const authOf = (call: unknown[]) => (call[1] as { headers: { Authorization: string } }).headers.Authorization

// Shapes from python/tests/test_api_server.py
const cluster = { id: 1, title: 'Alice Mum', count: 2, cover: '/recognize-faces/alice/2.jpg?md5=x&expires=1' }
const apiFile = {
	fileid: 10,
	path: 'Photos/a b.jpg',
	name: 'a b.jpg',
	mime: 'image/jpeg',
	etag: 'e10',
	mtime: 100,
	size: 1000,
	detection: { id: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.4, crop: '/recognize-faces/alice/1.jpg?md5=y' },
}

beforeEach(() => {
	get.mockReset()
	api.resetFacesApi()
})

describe('token', () => {
	test('is cached across calls', async () => {
		get.mockResolvedValueOnce(tokenReply('t1')).mockResolvedValue({ data: [] })
		await api.fetchClusters()
		await api.fetchClusters(5)
		expect(get.mock.calls.filter((c) => String(c[0]).includes('faces-token'))).toHaveLength(1)
		expect(authOf(get.mock.calls[2])).toBe('Bearer t1')
		expect(get.mock.calls[2][1].params).toEqual({ min: 5 })
	})

	test('is refreshed within 60 s of expiry', async () => {
		get.mockResolvedValueOnce(tokenReply('t1', 30)).mockResolvedValueOnce({ data: [] })
			.mockResolvedValueOnce(tokenReply('t2')).mockResolvedValueOnce({ data: [] })
		await api.fetchClusters()
		await api.fetchClusters()
		expect(authOf(get.mock.calls[3])).toBe('Bearer t2')
	})

	test('401 retries once with a fresh token, then fails', async () => {
		const unauthorized = { response: { status: 401 } }
		get.mockResolvedValueOnce(tokenReply('t1')).mockRejectedValueOnce(unauthorized)
			.mockResolvedValueOnce(tokenReply('t2')).mockResolvedValueOnce({ data: [cluster] })
		expect(await api.fetchClusters()).toEqual([cluster])
		expect(authOf(get.mock.calls[3])).toBe('Bearer t2')

		get.mockReset()
		get.mockResolvedValue(tokenReply('t3'))
		get.mockImplementation((url: string) => url.includes('faces-token') ? Promise.resolve(tokenReply('t3')) : Promise.reject(unauthorized))
		await expect(api.fetchClusters()).rejects.toBe(unauthorized)
		expect(get.mock.calls.filter((c) => !String(c[0]).includes('faces-token'))).toHaveLength(2)
	})
})

describe('paging', () => {
	test('loads pages of 500 until count is reached', async () => {
		const page = (n: number) => ({ id: 1, title: null, count: 501, files: Array.from({ length: n }, (_, i) => ({ ...apiFile, fileid: i })) })
		get.mockResolvedValueOnce(tokenReply('t1')).mockResolvedValueOnce({ data: page(500) }).mockResolvedValueOnce({ data: page(1) })
		const out = await api.fetchClusterFiles(1)
		expect(out.files).toHaveLength(501)
		expect(get.mock.calls[2][1].params).toEqual({ offset: 500, limit: 500 })
	})
})

describe('mapping', () => {
	test('cluster to face keeps name, count, cover, id', () => {
		const face = api.clusterToFace(cluster)
		expect(face.basename).toBe('Alice Mum')
		expect(face.attributes).toMatchObject({ nbItems: 2, cover: cluster.cover, clusterId: 1 })
		expect(api.clusterToFace({ ...cluster, title: null }).basename).toBe('1')
	})

	test('api file to node matches the DAV node', () => {
		const node = api.apiFileToNode(apiFile, cluster)
		expect(node.fileid).toBe(10)
		expect(node.basename).toBe('a b.jpg')
		expect(node.root + node.path).toBe('/files/alice/Photos/a b.jpg')
		expect(node.mime).toBe('image/jpeg')
		expect(node.size).toBe(1000)
		expect(node.mtime?.getTime()).toBe(100000)
		expect(node.attributes.etag).toBe('e10')
		expect(node.attributes['face-detections']).toEqual([
			{ id: 1, clusterId: 1, title: 'Alice Mum', x: 0.1, y: 0.2, width: 0.3, height: 0.4, crop: apiFile.detection.crop },
		])
	})
})

describe('fallback flag', () => {
	test('apiFailed marks the API down once', () => {
		expect(api.apiDown()).toBe(false)
		api.apiFailed(new Error('502'))
		api.apiFailed(new Error('502'))
		expect(api.apiDown()).toBe(true)
	})
})
