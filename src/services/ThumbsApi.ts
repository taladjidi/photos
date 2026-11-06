/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { apiGet } from './FacesApi.ts'

type Sizes = Record<string, string>
type Entry = { sizes: Promise<Sizes | null>, at: number, hit: boolean }

const BATCH_MS = 10
const CHUNK = 500
// The daemon generates thumbs in the background: ask again for a miss after a while.
const MISS_TTL = 5 * 60 * 1000
// The API answers 503 when briefly saturated: back off, never disable it for the session,
// and keep its failures out of FacesApi's flag (that would send Faces to WebDAV).
const BACKOFF_MS = 30 * 1000

let downUntil = 0

const cache = new Map<number, Entry>()
let batch: Map<number, (sizes: Sizes | null) => void> | null = null

/** Forget every cached answer (tests). */
export function resetThumbsApi() {
	cache.clear()
	batch = null
	downUntil = 0
}

async function flush() {
	const queued = batch!
	batch = null
	const ids = [...queued.keys()]
	await Promise.all(Array.from({ length: Math.ceil(ids.length / CHUNK) }, async (_, i) => {
		const chunk = ids.slice(i * CHUNK, (i + 1) * CHUNK)
		let data: Record<string, Sizes> = {}
		try {
			data = await apiGet<Record<string, Sizes>>('/thumbs', { ids: chunk.join(',') })
		} catch {
			downUntil = Date.now() + BACKOFF_MS
			chunk.forEach((id) => cache.delete(id)) // not a miss: ask again after the back-off
		}
		chunk.forEach((id) => queued.get(id)!(data[id] ?? null))
	}))
}

function enqueue(fileid: number): Promise<Sizes | null> {
	if (!batch) {
		batch = new Map()
		setTimeout(flush, BATCH_MS)
	}
	return new Promise((resolve) => batch!.set(fileid, resolve))
}

/**
 * Signed same-origin thumbnail URL of a file, or null when the API has none
 * (or is down): callers then use the PHP preview. Never rejects.
 *
 * @param fileid
 * @param size
 */
export async function lookupThumb(fileid: number, size: 256 | 1024): Promise<string | null> {
	if (Date.now() < downUntil) {
		return null
	}
	let entry = cache.get(fileid)
	if (!entry || (!entry.hit && entry.at + MISS_TTL < Date.now())) {
		const sizes = enqueue(fileid)
		const fresh: Entry = { sizes, at: Date.now(), hit: false }
		void sizes.then((s) => { fresh.hit = s !== null })
		cache.set(fileid, fresh)
		entry = fresh
	}
	return (await entry.sizes)?.[size] ?? null
}
