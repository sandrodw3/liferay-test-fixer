import { TestResult } from '@/types/test-result'
import { History } from '@/types/testray'

export function hasHistory(testCase: { name: string }) {
	return (
		testCase.name !== 'Top Level Build' &&
		!testCase.name.includes('PortalLogAssertor')
	)
}

export function parseHistory(history: History): TestResult['history'] {
	return history.map((item) => ({
		gitHash: item.gitHash,
		status: item.status,
	}))
}
