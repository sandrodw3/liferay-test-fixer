import { TestrayClient } from '@/lib/testray-client'

import { Case, History, Routine } from '@/types/testray'

const MAX_WORKERS = 12

export async function getCaseHistory({
	caseId,
	routineId,
	pageSize,
}: {
	caseId: Case['id']
	routineId?: Routine['id']
	pageSize?: number
}) {
	return await TestrayClient.get<History>({
		url: `https://testray.liferay.com/o/testray-rest/v1.0/testray-case-result-history/${caseId}`,
		params: {
			testrayRoutineIds: routineId,
			pageSize,
			sort: 'executionDate:desc',
		},
	})
}

export async function getCaseHistories({
	caseIds,
	routineId,
}: {
	caseIds: Array<Case['id']>
	routineId: Routine['id']
}): Promise<Map<Case['id'], History>> {
	const histories = new Map<Case['id'], History>()

	const workers = Math.max(1, Math.min(MAX_WORKERS, caseIds.length))

	let currentIndex = 0

	async function runWorker() {
		while (true) {
			const index = currentIndex

			if (index >= caseIds.length) {
				return
			}

			currentIndex += 1

			const caseId = caseIds[index]

			const history = await getCaseHistory({
				caseId,
				routineId,
				pageSize: 50,
			})

			histories.set(caseId, history)
		}
	}

	if (workers > 0) {
		await Promise.all(Array.from({ length: workers }, () => runWorker()))
	}

	return histories
}
