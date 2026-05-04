import { getTypeLabel } from '@/lib/test-type'

import { TestResult } from '@/types/test-result'
import { Build } from '@/types/testray'

type RoutineBuild = { id: Build['id']; date: string; gitHash: string }

export function buildExport(results: TestResult[], build: RoutineBuild) {
	return {
		buildId: build.id,
		buildDate: build.date,
		hash: build.gitHash,
		failures: results.map((result) => {
			if (result.type === 'Java Log Assertor') {
				return {
					name: result.name,
					type: getTypeLabel(result.type),
					errorTrace: result.errorTrace,
				}
			}

			const { lastPassSha, firstFailSha } = findHashes(result.history)

			return {
				name: result.name,
				type: getTypeLabel(result.type),
				errorTrace: result.errorTrace,
				lastPassSha,
				firstFailSha,
			}
		}),
	}
}

function findHashes(history: TestResult['history']) {
	if (!history) {
		return { lastPassSha: null, firstFailSha: null }
	}

	let lastPassSha: string | null = null
	let firstFailSha: string | null = null

	for (const entry of history) {
		if (entry.status === 'PASSED') {
			lastPassSha = entry.gitHash
			break
		}

		if (entry.status === 'FAILED') {
			firstFailSha = entry.gitHash
		}
	}

	return { lastPassSha, firstFailSha }
}
