import { parseHistory } from '@/lib/test-history'

import { TestResult } from '@/types/test-result'
import { Case, CaseResult, CaseType, History } from '@/types/testray'

export function getTestResult({
	caseResult,
	testCase,
	history,
	caseTypes,
}: {
	caseResult: CaseResult
	testCase: Case
	history: History | null
	caseTypes: CaseType[]
}): TestResult {
	const type = getType(testCase, caseTypes)

	return {
		name: testCase.name,
		errorTrace: caseResult.errors,
		history: history && parseHistory(history),
		type,
	}
}

function getType(testCase: Case, types: CaseType[]): TestResult['type'] {
	if (testCase.name.includes('PortalLogAssertor')) {
		return 'Java Log Assertor'
	}

	const type = types.find(
		({ id }) => id === testCase.r_caseTypeToCases_c_caseTypeId
	)

	return type!.name
}
