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

		/**
		 * This will produce an inline style to apply to images
		 * to zoom toward the detected face
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

			// Zoom so the face fills the --photos-face-width box nicely. Never
			// zoom out, hence the floor of 1.
			const faceZoom = Math.max(1, (1 / detection.width) * 0.4)

			// The box is filled by panning the image until the face is centred,
			// which only works while there is image left to pan into. Centring a
			// face that sits off-centre needs a window of 1/zoom around it to
			// still fit inside the image:
			//     centre - 1/(2*zoom) >= 0  and  centre + 1/(2*zoom) <= 1
			// Both hold when zoom >= 1 / (2 * min(centre, 1 - centre)) on each
			// axis. Without this, a face large enough to floor faceZoom at 1 is
			// panned straight off the box and the photo's edge shows inside the
			// circle — which happened for about a third of clusters.
			const margin = Math.min(centerX, 1 - centerX, centerY, 1 - centerY)
			const coverZoom = margin > 0 ? 1 / (2 * margin) : MAX_COVER_ZOOM

			// Cap it: a face right at the frame edge would otherwise be magnified
			// into mush. Better a slight clip than an unrecognisable face.
			const zoom = Math.min(MAX_COVER_ZOOM, Math.max(faceZoom, coverZoom))

			const horizontalCenterOfFace = centerX * 100
			const verticalCenterOfFace = centerY * 100

			return {
				// We assume that the image is inside a div with width: var(--photos-face-width)
				width: '100%',
				// we translate the image so that the center of the detected face is in the center of the --photos-face-width box
				// and add the zoom
				transform: `translate(calc( var(--photos-face-width)/2 - ${horizontalCenterOfFace}% ), calc( var(--photos-face-width)/2 - ${verticalCenterOfFace}% )) scale(${zoom})`,
				// this is necessary for the zoom to zoom toward the center of the face
				transformOrigin: `${horizontalCenterOfFace}% ${verticalCenterOfFace}%`,
			}
		},
	},
})
