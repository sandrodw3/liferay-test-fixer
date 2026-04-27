import { getTestResult } from '@/lib/get-test-result'
import { hasHistory } from '@/lib/test-history'
import { getTypeWeight } from '@/lib/test-type'

import { getRoutineBuilds } from '@/services/build'
import { getCases } from '@/services/case'
import { getBuildCaseResults } from '@/services/case-result'
import { getCaseTypes } from '@/services/case-type'
import { getCaseHistories } from '@/services/history'

import { TestResult } from '@/types/test-result'
import { Build, Routine } from '@/types/testray'

export async function getRoutineResults(routineId: Routine['id']): Promise<{
	results: TestResult[]
	build: { id: Build['id']; date: string; gitHash: string }
}> {
	const [lastBuild] = await getRoutineBuilds({
		routineId,
		limit: 1,
	})

	const caseResults = await getBuildCaseResults({
		buildId: lastBuild.id,
		statuses: ['FAILED', 'BLOCKED', 'UNTESTED'],
	})

	const caseIds = caseResults.map(
		(caseResult) => caseResult.r_caseToCaseResult_c_caseId
	)

	const cases = await getCases(caseIds)

	const caseTypeIds = [
		...new Set(
			cases.map((caseItem) => caseItem.r_caseTypeToCases_c_caseTypeId)
		),
	]

	const caseTypes = await getCaseTypes(caseTypeIds)

	const histories =
		cases.length > 50
			? new Map()
			: await getCaseHistories({
					caseIds: cases
						.filter((testCase) => hasHistory(testCase))
						.map((testCase) => testCase.id),
					routineId,
				})

	const casesMap = new Map(cases.map((caseItem) => [caseItem.id, caseItem]))

	const results: TestResult[] = []

	for (const caseResult of caseResults) {
		const caseId = caseResult.r_caseToCaseResult_c_caseId

		const testCase = casesMap.get(caseId)

		if (!testCase || testCase.name === 'Top Level Build') {
			continue
		}

		const history = histories.get(testCase.id) ?? null

		const result = getTestResult({
			caseResult,
			testCase,
			caseTypes,
			history,
		})

		results.push(result)
	}

	sortResults(results)

	return {
		results,
		build: {
			id: lastBuild.id,
			date: lastBuild.dateCreated,
			gitHash: lastBuild.gitHash,
		},
	}
}

function sortResults(results: TestResult[]) {
	return results.sort((a, b) => getTypeWeight(a.type) - getTypeWeight(b.type))
}
