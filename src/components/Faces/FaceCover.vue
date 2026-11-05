<!--
 - SPDX-FileCopyrightText: 2022 Nextcloud GmbH and Nextcloud contributors
 - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<div class="face-cover" :class="[small && 'face-cover--small']" @click="$emit('click')">
		<div class="face-cover__crop-container">
			<img
				v-if="apiCover || activeSrc"
				ref="image"
				class="face-cover__image"
				:src="apiCover || activeSrc"
				:style="apiCover ? undefined : coverDimensions"
				decoding="async"
				@load="onLoaded"
				@error="onLoaded">
		</div>
		<div class="face-cover__details">
			<div v-if="!baseName.match(/^[0-9]+$/)" class="face-cover__details__first-line">
				<span class="face-cover__details__name">
					{{ baseName }}
				</span>
			</div>
			<div v-if="!small" class="face-cover__details__second-line">
				{{ n('photos', '%n photos', '%n photos', face.attributes.nbItems) }}
			</div>
		</div>
	</div>
</template>

<script lang='ts'>
import type { Collection } from '../../services/collectionFetcher.js'

import { translatePlural as n } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import { markRaw } from 'vue'
import FaceCoverMixin from '../../mixins/FaceCoverMixin.js'
import FetchFacesMixin from '../../mixins/FetchFacesMixin.js'
import { createSlotHolder } from '../../services/PreviewQueue.js'

export default {
	name: 'FaceCover',

	mixins: [
		FetchFacesMixin,
		FaceCoverMixin,
	],

	props: {
		baseName: {
			type: String,
			required: true,
		},

		small: {
			type: Boolean,
			default: false,
		},
	},

	data() {
		return {
			slotHolder: markRaw(createSlotHolder()),
			observer: null,
			// Set once a queue slot is free. The Faces overview renders one
			// cover per cluster — hundreds of them — and setting every src at
			// once saturates php-fpm: measured 700 requests at an implied
			// concurrency of 68, so each spent ~0.7s queueing for ~25ms of work,
			// and unrelated requests (including the page's own PROPFIND) queued
			// behind them. The photo grid already goes through this semaphore.
			activeSrc: '',
		}
	},

	computed: {
		files() {
			return this.$store.state.files.files
		},

		faces() {
			return this.$store.state.faces.faces
		},

		facesFiles() {
			return this.$store.state.faces.facesFiles
		},

		face(): Collection {
			return this.faces[this.baseName]
		},

		coverUrl(): string {
			if (!this.cover) {
				return ''
			}

			return generateUrl(`/apps/photos/api/v1/preview/${this.cover.fileid}?x=${1024}&y=${1024}`)
		},

		/** Signed crop from the Python API: a plain JPEG, no framing maths. */
		apiCover(): string {
			return this.face.attributes.cover || ''
		},

		cover() {
			if (this.apiCover) {
				return null
			}

			return this.getFaceCover(this.face.basename)
		},

		coverDimensions() {
			if (!this.cover) {
				return {}
			}

			return this.getCoverStyle(this.face.basename)
		},
	},

	watch: {
		coverUrl() {
			this.slotHolder.release()
			this.activeSrc = ''
			this.queueLoad()
		},
	},

	async mounted() {
		await this.queueLoad()
	},

	beforeDestroy() {
		this.slotHolder.release()
	},

	methods: {
		n,

		/** Wait for a slot before asking the server for this cover. */
		async queueLoad() {
			if (this.apiCover || !this.coverUrl) {
				return
			}

			if (!(await this.slotHolder.acquire())) {
				return
			}

			this.activeSrc = this.coverUrl
		},

		/**
		 * Free the slot whether the image loaded or failed.
		 *
		 * @param {Event} event
		 */
		onLoaded(event) {
			this.onCoverImageLoad(event)
			this.slotHolder.release()
		},
	},
}
</script>

<style lang="scss" scoped>
@use '../../mixins/FaceCover';
</style>
