import { TestrayClient } from '@/lib/testray-client'

import { Build, CaseResult, Status } from '@/types/testray'

export async function getBuildCaseResults({
	buildId,
	statuses,
	limit,
}: {
	buildId: Build['id']
	statuses?: Status[]
	limit?: number
}) {
	let filter = `r_buildToCaseResult_c_buildId eq '${buildId}'`

	if (statuses?.length) {
		const statusFilter = statuses
			.map((status) => `dueStatus eq '${status}'`)
			.join(' or ')

		filter += ` and (${statusFilter})`
	}

	if (!limit) {
		const pageSize = 500

		const allCaseResults: CaseResult[] = []

		let page = 1

		while (true) {
			const pageItems = await TestrayClient.get<CaseResult[]>({
				url: 'https://testray.liferay.com/o/c/caseresults/',
				params: {
					filter,
					pageSize,
					page,
					sort: 'id:asc',
				},
			})

			allCaseResults.push(...pageItems)

			if (pageItems.length < pageSize) {
				break
			}

			page += 1
		}

		return allCaseResults
	}

	return await TestrayClient.get<CaseResult[]>({
		url: 'https://testray.liferay.com/o/c/caseresults/',
		params: {
			filter,
			pageSize: limit,
			sort: 'id:asc',
		},
	})
}
