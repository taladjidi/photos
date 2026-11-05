<!--
  - SPDX-FileCopyrightText: 2022 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<!-- Errors handlers-->
	<NcEmptyContent v-if="errorFetchingFaces">
		{{ t('photos', 'An error occurred') }}
	</NcEmptyContent>

	<!-- Face list -->
	<div v-else class="faces">
		<NcLoadingIcon v-if="loadingFaces" />

		<!-- No faces -->
		<div v-if="noFaces && !loadingFaces" class="faces__empty">
			<NcEmptyContent class="empty-content-with-illustration">
				<template #icon>
					<AccountBoxMultipleOutline />
				</template>
				<template #desc>
					{{ t('photos', 'This might take some time depending on the size of your photo library.') }}
				</template>
				{{ t('photos', 'Recognized people will show up here') }}
			</NcEmptyContent>
		</div>

		<NcTextField
			v-if="!noFaces"
			class="faces__filter"
			:value="filterInput"
			:label="t('photos', 'Filter by name')"
			@update:value="onFilterInput" />

		<div v-if="!noFaces" class="faces__list">
			<RouterLink
				v-for="face in orderedFaces"
				:key="face.basename"
				:to="`/faces/${encodeURIComponent(face.basename)}`">
				<FaceCover :base-name="face.basename" />
			</RouterLink>
			<RouterLink
				key="unassigned"
				to="/faces/unassigned">
				<UnassignedFacesCover />
			</RouterLink>
		</div>
	</div>
</template>

<script lang='ts'>
import type { Collection } from '../services/collectionFetcher.js'

import { t } from '@nextcloud/l10n'
import { RouterLink } from 'vue-router'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import AccountBoxMultipleOutline from 'vue-material-design-icons/AccountBoxMultipleOutline.vue'
import FaceCover from '../components/Faces/FaceCover.vue'
import UnassignedFacesCover from '../components/Faces/UnassignedFacesCover.vue'
import FetchFacesMixin from '../mixins/FetchFacesMixin.js'

export default {
	name: 'FacesView',
	components: {
		UnassignedFacesCover,
		FaceCover,
		NcEmptyContent,
		NcLoadingIcon,
		NcTextField,
		RouterLink,
		AccountBoxMultipleOutline,
	},

	mixins: [FetchFacesMixin],

	data() {
		return {
			filterInput: '',
			filter: '',
			filterTimer: undefined as undefined | ReturnType<typeof setTimeout>,
		}
	},

	computed: {
		facesFiles() {
			return this.$store.state.faces.facesFiles
		},

		unassignedFilesCount() {
			return this.$store.state.faces.unassignedFilesCount
		},

		noFaces(): boolean {
			return Object.keys(this.faces).length === 0
		},

		orderedFaces() {
			// shortcut: filters the loaded list only; the API list is complete (min=1), so search?q= is unused.
			const needle = this.filter.trim().toLowerCase()
			return Object.values(this.faces as Collection[]).filter((f) => f.basename.toLowerCase().includes(needle)).sort((a, b) => {
				if (a.attributes.nbItems && b.attributes.nbItems) {
					return b.attributes.nbItems - a.attributes.nbItems
				}
				if (!this.facesFiles[b.basename] || !this.facesFiles[a.basename]) {
					return 0
				}
				return this.facesFiles[b.basename].length - this.facesFiles[a.basename].length
			})
		},
	},

	methods: {
		t,

		onFilterInput(value: string) {
			this.filterInput = value
			clearTimeout(this.filterTimer)
			this.filterTimer = setTimeout(() => {
				this.filter = value
			}, 250)
		},
	},
}
</script>

<style lang="scss" scoped>
.faces {
	display: flex;
	flex-direction: column;
	height: calc(100vh - var(--header-height));
	padding-inline-start: 64px;

	@media only screen and (max-width: 1020px) {
		padding: 0;
	}

	&__filter {
		max-width: 320px;
		margin-top: 12px;
	}

	&__header {
		display: flex;
		min-height: 60px;
		align-items: center;

		button {
			margin-inline-end: 32px;
		}
	}

	&__list {
		padding-top: 24px;
		padding-bottom: 32px;
		flex-grow: 1;
		display: flex;
		flex-wrap: wrap;
		gap: 32px;
		align-content: flex-start;
	}

	&__empty {
		display: flex;
		flex-direction: column;
		align-items: center;

		&__button {
			margin-top: 32px;
		}
	}
}

.empty-content-with-illustration :deep(.empty-content__icon) {
	width: 200px;
	height: 200px;

	svg {
		width: 200px;
		height: 200px;
	}
}
</style>
