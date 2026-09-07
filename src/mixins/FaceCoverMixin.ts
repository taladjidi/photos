/**
 * SPDX-FileCopyrightText: 2022 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import he from 'he'
import { defineComponent } from 'vue'

/** Beyond this the face is magnified past usefulness; clip instead. */
const MAX_COVER_ZOOM = 6

type Cover = {
	detection: {
		x: number
		y: number
		width: number
		height: number
	}
}

export default defineComponent({
	name: 'FaceCoverMixin',

	data() {
		return {
			// Aspect ratio (w/h) of the loaded cover image. The preview endpoint
			// preserves aspect (getPreview's $crop defaults to false), so a 512
			// request returns e.g. 512x341 for a 3:2 photo — not a square. Until
			// the image loads we assume square, which is what the old code
			// implicitly did.
			coverAspect: 1,
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
	},

	methods: {
		getFaceCover(faceName): Cover {
			return JSON.parse(he.decode(this.faces[faceName].attributes['face-preview-image'] || '{}'))
		},

		/** Record the real aspect ratio once the browser has the image. */
		onCoverImageLoad(event: Event): void {
			const img = event.target as HTMLImageElement
			if (img?.naturalWidth > 0 && img?.naturalHeight > 0) {
				this.coverAspect = img.naturalWidth / img.naturalHeight
			}
		},

		/**
		 * Inline style that frames the detected face inside the round cover.
		 *
		 * The image is laid out at width:100% of the box, so it is BOX wide and
		 * BOX/aspect tall. It is then scaled about the face centre and panned so
		 * that centre lands in the middle of the box.
		 *
		 * Two things have to hold or the box is not filled and its background
		 * shows through the circle:
		 *
		 *   horizontally  zoom >= 1 / (2 * min(cx, 1 - cx))
		 *   vertically    zoom >= aspect / (2 * min(cy, 1 - cy))
		 *
		 * The vertical bound carries the aspect ratio because a landscape photo
		 * is already shorter than the box before any panning: at 3:2 — 65% of
		 * this library — a 128px box gets an 85px tall image, a 43px gap top and
		 * bottom. Considering only face size and position, as this did before,
		 * leaves that gap visible.
		 *
		 * @param faceName
		 */
		getCoverStyle(faceName: string): Record<string, never> | { transform: string, width: string, transformOrigin: string } {
			const cover = this.getFaceCover(faceName)
			if (!cover || !cover.detection) {
				return {}
			}
			const detection = cover.detection

			const centerX = detection.x + detection.width / 2
			const centerY = detection.y + detection.height / 2
			const aspect = this.coverAspect > 0 ? this.coverAspect : 1

			// Zoom enough that the face fills the box nicely; never zoom out.
			const faceZoom = Math.max(1, (1 / detection.width) * 0.4)

			const marginX = Math.min(centerX, 1 - centerX)
			const marginY = Math.min(centerY, 1 - centerY)
			const zoomToCoverX = marginX > 0 ? 1 / (2 * marginX) : MAX_COVER_ZOOM
			const zoomToCoverY = marginY > 0 ? aspect / (2 * marginY) : MAX_COVER_ZOOM

			// Capped: a face at the very frame edge would otherwise be magnified
			// past recognition. A slight clip beats an unreadable face.
			const zoom = Math.min(MAX_COVER_ZOOM, Math.max(faceZoom, zoomToCoverX, zoomToCoverY))

			const horizontalCenterOfFace = centerX * 100
			const verticalCenterOfFace = centerY * 100

			return {
				// We assume that the image is inside a div with width: var(--photos-face-width)
				width: '100%',
				// translate so the centre of the detected face is in the centre of
				// the --photos-face-width box, then apply the zoom
				transform: `translate(calc( var(--photos-face-width)/2 - ${horizontalCenterOfFace}% ), calc( var(--photos-face-width)/2 - ${verticalCenterOfFace}% )) scale(${zoom})`,
				// necessary for the zoom to zoom toward the centre of the face
				transformOrigin: `${horizontalCenterOfFace}% ${verticalCenterOfFace}%`,
			}
		},
	},
})
